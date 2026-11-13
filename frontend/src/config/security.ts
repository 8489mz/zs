export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_MIN_LENGTH_HINT = 'كلمة المرور مطلوبة.';

/** Minimum login-password length for admin/super_admin accounts. Mirrors the backend policy (INV-PASSWORD-ROLE-MINIMUMS). */
export const ADMIN_MIN_PASSWORD_LENGTH = 12;

/**
 * Role-aware login-password minimum, mirroring the backend
 * passwordMinLengthForRole: admin and super_admin require 12 characters;
 * every other role requires 8. Unknown or missing roles fail to the
 * ordinary 8-character floor.
 */
export function passwordMinLengthForRole(role: unknown): number {
  const normalized = String(role ?? '').trim().toLowerCase();
  return normalized === 'admin' || normalized === 'super_admin'
    ? ADMIN_MIN_PASSWORD_LENGTH
    : MIN_PASSWORD_LENGTH;
}

/** The hint the profile page shows under the new-password field, with the minimum that actually applies to this role. */
export function passwordMinLengthHint(role: unknown): string {
  return `كلمة المرور الجديدة يجب ألا تقل عن ${passwordMinLengthForRole(role)} أحرف.`;
}
