/*
 * audit-details-format.spec.ts — INV-AUDIT-GENERAL-LOG-CONTENT (ج).
 *
 * The general tab used to show the stock-count session entry as raw JSON:
 * formatAuditDetails parsed the outer object, but formatGenericObjectDetails
 * took the nested `after` value as a label and JSON.stringify'd it, so the
 * row read `after: {"sessionId":20,"branchId":"31",...}`.
 *
 * WHAT THIS PINS, driving the REAL formatAuditDetails:
 * - the recorded legacy text (ids only) renders with human labels and no
 *   raw JSON: no '{', no '"', no 'sessionId'; session 20, branch #31,
 *   location #61, status 'مسودة'.
 * - the new writer shape (resolved names beside the ids) renders the
 *   names and drops the raw ids entirely.
 * - a literal `after: {...}` prefixed text is parsed the same way.
 * - plain-sentence details still pass through verbatim, and the damaged
 *   stock branch is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { formatAuditDetails } from '@/features/audit/lib/audit-details-format';
import type { AuditLog } from '@/types/domain';

const LEGACY_DETAILS = JSON.stringify({
  actorUserId: 5,
  after: { sessionId: 20, branchId: '31', locationId: '61', status: 'draft' },
});

const NAMED_DETAILS = JSON.stringify({
  actorUserId: 5,
  after: {
    sessionId: 20,
    branchId: 31,
    branchName: 'الفرع الرئيسي',
    locationId: 61,
    locationName: 'المخزن الرئيسي',
    status: 'draft',
  },
});

function row(details: string, action = 'جلسة جرد مخزون'): AuditLog {
  return { id: '1', action, details, createdAt: '2026-11-04T10:00:00.000Z' };
}

describe('formatAuditDetails — stock-count session entry (INV-AUDIT-GENERAL-LOG-CONTENT)', () => {
  it('renders the recorded legacy text with human labels and no raw JSON', () => {
    const out = formatAuditDetails(row(LEGACY_DETAILS));
    expect(out).not.toContain('{');
    expect(out).not.toContain('"');
    expect(out).not.toContain('sessionId');
    expect(out).not.toContain('after');
    expect(out).toContain('رقم المستخدم: 5');
    expect(out).toContain('رقم الجلسة: 20');
    expect(out).toContain('الفرع: #31');
    expect(out).toContain('المخزن: #61');
    expect(out).toContain('الحالة: مسودة');
  });

  it('renders resolved branch/location names and drops the raw ids', () => {
    const out = formatAuditDetails(row(NAMED_DETAILS));
    expect(out).not.toContain('{');
    expect(out).not.toContain('"');
    expect(out).not.toContain('sessionId');
    expect(out).toContain('الفرع: الفرع الرئيسي');
    expect(out).toContain('المخزن: المخزن الرئيسي');
    expect(out).not.toContain('#31');
    expect(out).not.toContain('#61');
  });

  it('parses a literal after: {...} prefixed text the same way', () => {
    const out = formatAuditDetails(
      row('after: {"sessionId":20,"branchId":"31","locationId":"61","status":"draft"}'),
    );
    expect(out).not.toContain('{');
    expect(out).not.toContain('"');
    expect(out).not.toContain('sessionId');
    expect(out).toContain('رقم الجلسة: 20');
    expect(out).toContain('الحالة: مسودة');
  });

  it('leaves plain-sentence details verbatim', () => {
    const out = formatAuditDetails(row('تم تسجيل مصروف بواسطة admin', 'تسجيل مصروف'));
    expect(out).toBe('تم تسجيل مصروف بواسطة admin');
  });

  it('keeps the damaged-stock branch unchanged', () => {
    const out = formatAuditDetails(
      row(JSON.stringify({ productId: 10, qty: 2, reason: 'كسر', locationId: 61 }), 'تسجيل تالف'),
    );
    expect(out).toContain('الصنف #10');
    expect(out).toContain('الكمية التالفة 2');
  });
});
