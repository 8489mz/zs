/*
 * audit-activity-presenter.spec.ts — INV-AUDIT-GENERAL-LOG-CONTENT (و).
 *
 * Choosing "continue with the current password" logs a distinct dismiss
 * action ('تخطي تغيير كلمة المرور'), but getAuditActionLabel matched the
 * password-change pattern first: its 'تغيير كلمة المرور' also matches
 * inside the dismiss text, so the skip showed up as a password change.
 *
 * WHAT THIS PINS, driving the REAL getAuditActionLabel:
 * - the dismiss action labels as 'تخطي تغيير كلمة المرور' (Arabic) and
 *   'Skipped Password Change' (English), never as a password change.
 * - the details-side phrasing ('اختار المتابعة بكلمة المرور الحالية')
 *   labels the same way.
 * - a completed password change still labels 'تغيير كلمة المرور'.
 */
import { describe, expect, it } from 'vitest';
import { getAuditActionLabel } from '@/features/audit/lib/audit-activity-presenter';

describe('getAuditActionLabel — skipped password change (INV-AUDIT-GENERAL-LOG-CONTENT)', () => {
  it('labels the dismiss action as a skip, not a password change', () => {
    expect(getAuditActionLabel('تخطي تغيير كلمة المرور')).toBe('تخطي تغيير كلمة المرور');
    expect(getAuditActionLabel('تخطي تغيير كلمة المرور')).not.toBe('تغيير كلمة المرور');
  });

  it('labels the dismiss action in English as a skip', () => {
    expect(getAuditActionLabel('تخطي تغيير كلمة المرور', true)).toBe('Skipped Password Change');
  });

  it('labels the continue-with-current-password phrasing as a skip', () => {
    expect(getAuditActionLabel('اختار المتابعة بكلمة المرور الحالية')).toBe('تخطي تغيير كلمة المرور');
  });

  it('still labels a completed password change as a change', () => {
    expect(getAuditActionLabel('تغيير كلمة المرور')).toBe('تغيير كلمة المرور');
    expect(getAuditActionLabel('Password change completed', true)).toBe('Password Change');
  });
});
