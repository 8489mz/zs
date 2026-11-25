import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * المصدر الوحيد لحساب رموز المصادقة الثنائية (TOTP — RFC 6238) في المشروع.
 *
 * بلا أي اعتمادية خارجية عمداً: الخوارزمية ثابتة ومعرَّفة في معيار منشور، ومُتحقَّق منها هنا
 * بمتجهات الاختبار الرسمية للمعيار (`totp-mfa.spec.ts`). إضافة حزمة لهذا الغرض تعني حزمة
 * جديدة في مسار المصادقة نفسه، وهو آخر مكان يُحتمل فيه مفاجأة من التبعيات.
 *
 * قاعدتان مفروضتان هنا:
 *  1. **مقارنة ثابتة الزمن** للرمز، لا `===` على النص.
 *  2. **الرمز يُعاد كرقم الخطوة الزمنية التي طابقته**، لا كـ`true`. بدون ذلك يستطيع من يلتقط
 *     رمزاً صالحاً إعادة استعماله خلال نفس الثلاثين ثانية؛ المستدعي يخزّن آخر خطوة استُهلكت
 *     ويرفض ما ليس أحدث منها.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** طول الخطوة الزمنية بالثواني، كما تتوقعه كل تطبيقات المصادقة. */
export const TOTP_STEP_SECONDS = 30;

/** عدد خانات الرمز. */
export const TOTP_DIGITS = 6;

/**
 * كم خطوة قبل/بعد الحالية تُقبل. خطوة واحدة (±30 ثانية) تكفي لانحراف ساعة الهاتف المعتاد
 * وللوقت الذي يستغرقه المستخدم في الكتابة، بلا توسيع نافذة التخمين أكثر من اللازم.
 */
export const TOTP_DRIFT_STEPS = 1;

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(secret: string): Buffer {
  const clean = String(secret || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('INVALID_BASE32_SECRET');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** سر جديد بطول 160 بت — الطول الذي يفترضه RFC 4226 لمفتاح HMAC-SHA1. */
export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** رقم الخطوة الزمنية الحالية. */
export function totpStep(atMs: number = Date.now(), stepSeconds: number = TOTP_STEP_SECONDS): number {
  return Math.floor(atMs / 1000 / stepSeconds);
}

export function generateTotpCode(
  secretBase32: string,
  options?: { atMs?: number; digits?: number; stepSeconds?: number },
): string {
  const digits = options?.digits ?? TOTP_DIGITS;
  const step = totpStep(options?.atMs ?? Date.now(), options?.stepSeconds ?? TOTP_STEP_SECONDS);
  return hotp(decodeBase32(secretBase32), step, digits);
}

function codesMatch(expected: string, provided: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * يعيد رقم الخطوة التي طابقها الرمز، أو `null`. المستدعي **يجب** أن يرفض أي خطوة ليست أحدث
 * من آخر خطوة استهلكها هذا المستخدم، وإلا صار الرمز قابلاً لإعادة الاستعمال داخل نافذته.
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  options?: { atMs?: number; driftSteps?: number; digits?: number; stepSeconds?: number },
): number | null {
  const digits = options?.digits ?? TOTP_DIGITS;
  const normalized = String(code || '').replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return null;

  let secret: Buffer;
  try {
    secret = decodeBase32(secretBase32);
  } catch {
    return null;
  }
  if (secret.length === 0) return null;

  const drift = Math.max(0, options?.driftSteps ?? TOTP_DRIFT_STEPS);
  const current = totpStep(options?.atMs ?? Date.now(), options?.stepSeconds ?? TOTP_STEP_SECONDS);

  for (let offset = -drift; offset <= drift; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    if (codesMatch(hotp(secret, step, digits), normalized)) return step;
  }
  return null;
}

/**
 * الرابط الذي تقرأه تطبيقات المصادقة (Google Authenticator / Authy / 1Password …).
 * على الهاتف يفتح التطبيق مباشرة، وعلى سطح المكتب يُضاف السر يدوياً.
 */
export function buildOtpauthUri(params: { issuer: string; account: string; secret: string }): string {
  const issuer = encodeURIComponent(params.issuer);
  const account = encodeURIComponent(params.account);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${issuer}:${account}?${query.toString()}`;
}

/** السر معروضاً في مجموعات من أربعة محارف — الشكل الذي يُدخله الناس يدوياً بلا أخطاء. */
export function formatSecretForDisplay(secret: string): string {
  return String(secret || '')
    .replace(/(.{4})/g, '$1 ')
    .trim();
}
