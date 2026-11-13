/*
WHAT THIS PINS (INV-PROFILE-PASSWORD-ROLE-MESSAGES): the profile page
must show the new-password minimum that actually applies to the signed-in
role — 12 for admin/super_admin, 8 for everyone else (INV-PASSWORD-ROLE-
MINIMUMS) — instead of a fixed 8. Live 2026-11-13 a super_admin was told
8, then rejected at 8, and only 12 worked.
*/
import { describe, it, expect } from 'vitest';
import {
  ADMIN_MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordMinLengthForRole,
  passwordMinLengthHint,
} from './security';

describe('profile password minimum hint', () => {
  it('keeps the policy minima (8 ordinary, 12 admin)', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(ADMIN_MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('requires 12 for admin and super_admin, 8 for other roles', () => {
    expect(passwordMinLengthForRole('super_admin')).toBe(12);
    expect(passwordMinLengthForRole('admin')).toBe(12);
    expect(passwordMinLengthForRole('cashier')).toBe(8);
    expect(passwordMinLengthForRole('unknown-role')).toBe(8);
    expect(passwordMinLengthForRole(undefined)).toBe(8);
  });

  it('shows 12 in the hint for a super_admin, 8 for a cashier', () => {
    expect(passwordMinLengthHint('super_admin')).toBe('كلمة المرور الجديدة يجب ألا تقل عن 12 أحرف.');
    expect(passwordMinLengthHint('cashier')).toBe('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.');
  });
});
