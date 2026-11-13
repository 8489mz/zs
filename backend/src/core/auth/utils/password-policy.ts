import { AppError } from '../../../common/errors/app-error';

export const MIN_PASSWORD_LENGTH = 8;

/** Minimum login-password length for admin/super_admin accounts. */
export const ADMIN_MIN_PASSWORD_LENGTH = 12;

/**
 * Role-aware login-password minimum. Admin and super_admin accounts
 * guard tenant-wide money and settings, so they require 12 characters;
 * every other role requires 8. Unknown or missing roles fail to the
 * ordinary 8-character floor, never to the old one-character rule.
 */
export function passwordMinLengthForRole(role: unknown): number {
  const normalized = String(role ?? '').trim().toLowerCase();
  return normalized === 'admin' || normalized === 'super_admin'
    ? ADMIN_MIN_PASSWORD_LENGTH
    : MIN_PASSWORD_LENGTH;
}

/**
 * Common trivial/weak passcodes that should be rejected across portals and field credentials.
 */
const TRIVIAL_PASSCODE_PATTERNS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '2345', '3456', '4567', '5678', '6789', '0123',
  '4321', '5432', '6543', '7654', '8765', '9876', '3210',
  '1212', '2121', '1122', '2211', '123123',
  '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999',
  '123456', '654321', '12345678', '87654321',
  'password', 'admin', '12345',
]);

export function assertSecurePasscode(
  passcode: string,
  context?: { phone?: string; identifier?: string },
): void {
  const normalized = String(passcode ?? '').trim();
  if (!normalized) {
    throw new AppError('رمز الدخول السري أو كلمة المرور مطلوبة', 'PASSCODE_REQUIRED', 400);
  }

  if (normalized.length < 4) {
    throw new AppError('يجب ألا يقل رمز الدخول أو كلمة المرور عن 4 خانات', 'PASSCODE_TOO_SHORT', 400);
  }

  // Reject single repeated digit (e.g. 0000, 111111, 7777777)
  if (/^(\d)\1+$/.test(normalized)) {
    throw new AppError('رمز الدخول ضعيف جداً (أرقام مكررة). يرجى اختيار رمز أو كلمة مرور غير متوقعة', 'WEAK_PASSCODE', 400);
  }

  // Reject blacklisted trivial patterns
  if (TRIVIAL_PASSCODE_PATTERNS.has(normalized.toLowerCase())) {
    throw new AppError('رمز الدخول بديهي وسهل التخمين (مثل 1234 أو 0000). يرجى تعيين رمز أو كلمة مرور قوية لحماية الحساب', 'WEAK_PASSCODE', 400);
  }

  // Reject if it matches the last 4 or 6 digits of the phone number
  if (context?.phone) {
    const cleanPhoneDigits = String(context.phone).replace(/\D/g, '');
    if (cleanPhoneDigits.length >= 4) {
      const last4 = cleanPhoneDigits.slice(-4);
      const last6 = cleanPhoneDigits.length >= 6 ? cleanPhoneDigits.slice(-6) : null;
      if (normalized === last4 || (last6 && normalized === last6)) {
        throw new AppError('لا يمكن استخدام أرقام مطابقة لنهاية رقم الهاتف كرمز دخول. يرجى اختيار رمز غير متوقع', 'WEAK_PASSCODE', 400);
      }
    }
  }
}

export function assertStrongPassword(
  password: string,
  options?: { minLength?: number; role?: unknown; code?: string; message?: string },
): void {
  const minLength = options?.minLength ?? passwordMinLengthForRole(options?.role);
  const normalized = String(password ?? '');
  const trimmed = normalized.trim();

  if (!trimmed) {
    throw new AppError('Password is required', 'PASSWORD_REQUIRED', 400);
  }

  if (trimmed.length < minLength) {
    throw new AppError(
      options?.message ||
        `كلمة المرور الجديدة قصيرة جداً: يجب ألا تقل عن ${minLength} أحرف.`,
      options?.code || 'PASSWORD_TOO_WEAK',
      400,
      { minLength },
    );
  }
}
