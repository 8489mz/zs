import { createHash, randomBytes } from 'node:crypto';

/**
 * المصدر الوحيد للحقيقة لرموز استعادة كلمة المرور.
 *
 * هذا الرمز ليس رمز بوابة (`portal-token.ts`): رمز البوابة بلا حالة ويعيش 30 يوماً ويثبت هوية
 * مستمرة، أما رمز الاستعادة **يجب** أن يكون ذا حالة — يُستهلك مرة واحدة، ويُلغى عند إصدار رمز
 * أحدث، ويموت بعد دقائق. لذلك هو صف في قاعدة البيانات لا توقيع HMAC.
 *
 * ثلاث قواعد مفروضة هنا:
 *  1. **لا يُخزَّن الرمز نفسه أبداً.** المخزَّن هو تجزئته فقط، فمن يقرأ نسخة احتياطية أو يفتح
 *     القاعدة بالعين لا يستطيع تغيير كلمة مرور أحد (نفس منطق O48 بالمقلوب: هنا لا يوجد سر أصلاً).
 *  2. **الرمز يأتي من مولّد عشوائي آمن بطول 256 بت.** لذلك التجزئة SHA-256 كافية ولا داعي
 *     لـbcrypt: لا يوجد "قاموس" لرمز عشوائي كامل الإنتروبيا، والبحث لا بد أن يتم بفهرس على
 *     التجزئة في استعلام واحد (bcrypt كان سيفرض مسحاً كاملاً للجدول عند كل محاولة).
 *  3. **الصلاحية تُقرأ من مكان واحد** حتى لا يختلف عمر الرمز بين مسار الإصدار ومسار التحقق.
 */

/** طول الرمز بالبايت قبل الترميز (256 بت). */
const TOKEN_BYTES = 32;

/** العمر الافتراضي للرمز بالدقائق حين لا يُضبط `PASSWORD_RESET_TOKEN_TTL_MINUTES`. */
const DEFAULT_TTL_MINUTES = 30;

/** الحد الأقصى المسموح به للعمر — رمز استعادة يعيش ساعات ليس رمز استعادة. */
const MAX_TTL_MINUTES = 120;

/** العمر الفعلي بالمللي ثانية، مقصوصاً داخل حدود معقولة. */
export function passwordResetTokenTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(String(env.PASSWORD_RESET_TOKEN_TTL_MINUTES || '').trim());
  const minutes = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_TTL_MINUTES) : DEFAULT_TTL_MINUTES;
  return Math.round(minutes * 60 * 1000);
}

/** رمز جديد يُرسل للمستخدم ولا يُخزَّن. */
export function generatePasswordResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** التجزئة المخزَّنة في `password_reset_tokens.token_hash`. */
export function hashPasswordResetToken(token: string): string {
  return createHash('sha256')
    .update(String(token || ''), 'utf8')
    .digest('hex');
}

export type PasswordResetTokenRow = {
  user_id: number;
  tenant_id: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  invalidated_at: Date | string | null;
};

export type PasswordResetTokenState = 'usable' | 'used' | 'invalidated' | 'expired';

/**
 * حالة الرمز وقت التحقق. مفصولة عن الخدمة عمداً لأنها القاعدة التي يحرسها الجناح:
 * رمز مستهلك أو ملغى أو منتهٍ لا يفتح الباب مهما كان مسار الاستدعاء.
 */
export function classifyPasswordResetToken(
  row: PasswordResetTokenRow | undefined | null,
  now: Date = new Date(),
): PasswordResetTokenState | 'unknown' {
  if (!row) return 'unknown';
  if (row.used_at) return 'used';
  if (row.invalidated_at) return 'invalidated';
  const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at));
  if (!(expiresAt.getTime() > now.getTime())) return 'expired';
  return 'usable';
}
