import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppError } from '../../../common/errors/app-error';

/**
 * سر التثبيت المحلي — بديل السر الثابت المكتوب في الكود.
 *
 * قبل هذا الإصلاح كان `portal-token.ts` و`mfa-secret-cipher.ts` يرجعان سراً ثابتاً
 * مكتوباً حرفياً في الكود العام (`zs-desktop-offline-...`) لأي تثبيت ديسكتوب بلا
 * `SESSION_SECRET`، فأي نسخة تستطيع تزوير رموز بوابات أي نسخة أخرى. من الآن لا
 * يوجد سر افتراضي في أي وضع إطلاقاً:
 *
 * - السحابة: السر من البيئة فقط (`SESSION_SECRET` / `SESSION_CSRF_SECRET` /
 *   `MFA_ENCRYPTION_KEY`)، وغيابه يرمي 500 — كما كان.
 * - الديسكتوب/الأوفلاين: سر عشوائي (32 بايت) يُولَّد عند أول تشغيل ويُحفَظ في
 *   ملف محلي واحد لهذا الجهاز والمستخدم (`~/.zs/install-secret`، أو المسار
 *   الذي يحدده `ZS_INSTALL_SECRET_PATH`). الملف يُنشأ بوضع 0600 ومجلده 0700.
 *
 * قواعد هذا الملف:
 * 1. **لا قراءة من الذاكرة المخزَّنة:** السر يُقرأ من القرص عند كل استدعاء،
 *    فيدخل التدوير حيّز التنفيذ فوراً بلا إعادة تشغيل، ويُختبَر التدوير
 *    داخل عملية واحدة.
 * 2. **فشل مغلق:** ملف تالف أو غير قابل للقراءة يوقف البوابات والمصادقة
 *    الثنائية (500) بدل التوقيع بسر معروف. الاسترداد: حذف الملف وإعادة
 *    التشغيل يولّد سراً جديداً — والرموز الصادرة بالسر القديم تموت معه،
 *    وهذا مقصود (السر القديم عام، فلا توافق خلفي معه).
 * 3. **فصل الأغراض:** البوابات والـMFA لا يستعملان السر الخام نفسه أبداً؛
 *    كل غرض يُشتق بمفتاحه عبر SHA-256(السر + الغرض).
 * 4. **السحابة لا تلمس القرص إطلاقاً:** هذه الدوال لا تُستدعى إلا من فرع
 *    الديسكتوب في المُحلِّلَين، فلا يُنشأ الملف على الخادم أبداً.
 */

export const INSTALL_SECRET_PATH_ENV = 'ZS_INSTALL_SECRET_PATH';
const INSTALL_SECRET_DIR_NAME = '.zs';
const INSTALL_SECRET_FILE_NAME = 'install-secret';
const INSTALL_SECRET_BYTES = 32;
const SECRET_FORMAT = /^[0-9a-f]{64}$/;

export type InstallSecretPurpose = 'portal-token' | 'mfa-encryption';

function installSecretUnavailable(message: string): AppError {
  return new AppError(message, 'INSTALL_SECRET_UNAVAILABLE', 500);
}

/** مسار ملف سر التثبيت: متغير بيئة للاختبارات، وإلا `~/.zs/install-secret`. */
export function resolveInstallSecretPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = String(env[INSTALL_SECRET_PATH_ENV] || '').trim();
  if (override) return override;
  let home: string;
  try {
    home = os.homedir();
  } catch {
    throw installSecretUnavailable('تعذّر تحديد مجلد المنزل لحفظ سر التثبيت المحلي. اضبط ZS_INSTALL_SECRET_PATH.');
  }
  return path.join(home, INSTALL_SECRET_DIR_NAME, INSTALL_SECRET_FILE_NAME);
}

function readInstallSecretFile(filePath: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw installSecretUnavailable('تعذّر قراءة ملف سر التثبيت المحلي.');
  }
  const secret = raw.trim();
  if (!SECRET_FORMAT.test(secret)) {
    throw installSecretUnavailable(
      'ملف سر التثبيت المحلي تالف. احذف الملف وأعد التشغيل لتوليد سر جديد (الرموز الصادرة بالسر القديم تتوقف).',
    );
  }
  return secret;
}

function createInstallSecretFile(filePath: string): string {
  const secret = randomBytes(INSTALL_SECRET_BYTES).toString('hex');
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, `${secret}\n`, { flag: 'wx', mode: 0o600 });
    return secret;
  } catch (error: unknown) {
    // سباق أول تشغيل بين عمليتين: الملف ظهر أثناء التوليد — اقرأ الموجود.
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      const existing = readInstallSecretFile(filePath);
      if (existing) return existing;
    }
    throw installSecretUnavailable('تعذّر إنشاء ملف سر التثبيت المحلي.');
  }
}

/** السر الخام للتثبيت (64 محرف hex) — يُقرأ من القرص عند كل استدعاء، بلا تخزين. */
export function resolveInstallSecret(env: NodeJS.ProcessEnv = process.env): string {
  const filePath = resolveInstallSecretPath(env);
  return readInstallSecretFile(filePath) ?? createInstallSecretFile(filePath);
}

/**
 * مفتاح مشتق لغرض واحد من سر التثبيت. الغرضان الحاليان `portal-token`
 * (توقيع رموز البوابات HMAC) و`mfa-encryption` (مدخل scrypt لتشفير سر TOTP).
 */
export function deriveInstallSecret(purpose: InstallSecretPurpose, env: NodeJS.ProcessEnv = process.env): string {
  const secret = resolveInstallSecret(env);
  return createHash('sha256').update(`${secret}:${purpose}`, 'utf8').digest('hex');
}
