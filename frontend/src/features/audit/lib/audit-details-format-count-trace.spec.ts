/*
 * audit-details-format-count-trace.spec.ts — INV-AUDIT-RAW-JSON.
 *
 * The audit log showed raw JSON for the count-session serial/batch
 * trace event ('مطابقة سيريالات وتشغيلات جرد بلا فرق كمي'):
 * formatGenericObjectDetails rendered array items through
 * stringifyDetailValue, which JSON.stringify's any object — and the
 * writer stores batchCounts as an ARRAY OF OBJECTS
 * ({batchId, batchNumber, expiryDate, countedQty}), so the row read
 * `batchCounts: {"batchId":3,"batchNumber":"B-7","countedQty":2}`.
 * countedSerials (string[]) and every other count-session payload
 * (scalars / arrays of numbers) already rendered as text.
 *
 * WHAT THIS PINS, driving the REAL formatAuditDetails:
 * - the recorded serial-match payload renders as readable Arabic
 *   labels with no raw JSON: no '{', no '"', no 'batchCounts',
 *   no 'batchId'; serials joined, each batch row labelled.
 * - an empty trace (no serials, no batches) still renders text.
 * - a second batch row joins without raw JSON.
 * - the create-session payload (INV-AUDIT-GENERAL-LOG-CONTENT)
 *   still renders through the shared branch unchanged.
 */
import { describe, expect, it } from 'vitest';
import { formatAuditDetails } from '@/features/audit/lib/audit-details-format';
import type { AuditLog } from '@/types/domain';

const TRACE_DETAILS = JSON.stringify({
  sessionId: 20,
  itemId: 7,
  productId: 10,
  locationId: 61,
  quantity: 2,
  countedSerials: ['SN-1', 'SN-2'],
  batchCounts: [{ batchId: 3, batchNumber: 'B-7', countedQty: 2 }],
});

function row(details: string, action: string): AuditLog {
  return { id: '1', action, details, createdAt: '2026-11-04T10:00:00.000Z' };
}

describe('formatAuditDetails — count-session serial/batch trace (INV-AUDIT-RAW-JSON)', () => {
  it('renders the serial-match event as readable text, never raw JSON', () => {
    const out = formatAuditDetails(row(TRACE_DETAILS, 'مطابقة سيريالات وتشغيلات جرد بلا فرق كمي'));
    expect(out).not.toContain('{');
    expect(out).not.toContain('"');
    expect(out).not.toContain('batchCounts');
    expect(out).not.toContain('batchId');
    expect(out).not.toContain('countedSerials');
    expect(out).toContain('رقم الجلسة: 20');
    expect(out).toContain('الصنف: #10');
    expect(out).toContain('السيريالات: SN-1، SN-2');
    expect(out).toContain('التشغيلات:');
    expect(out).toContain('B-7');
    expect(out).toContain('الكمية المعدودة: 2');
  });

  it('renders an empty trace as text without raw JSON', () => {
    const out = formatAuditDetails(
      row(
        JSON.stringify({ sessionId: 20, itemId: 7, productId: 10, locationId: 61, quantity: 0, countedSerials: [], batchCounts: [] }),
        'مطابقة سيريالات وتشغيلات جرد بلا فرق كمي',
      ),
    );
    expect(out).not.toContain('{');
    expect(out).not.toContain('"');
    expect(out).toContain('رقم الجلسة: 20');
    expect(out).toContain('الصنف: #10');
  });

  it('joins a second batch row without raw JSON', () => {
    const out = formatAuditDetails(
      row(
        JSON.stringify({
          sessionId: 20,
          itemId: 7,
          productId: 10,
          locationId: 61,
          quantity: 5,
          countedSerials: [],
          batchCounts: [
            { batchId: 3, batchNumber: 'B-7', countedQty: 2 },
            { batchNumber: 'B-9', expiryDate: '2027-01-31', countedQty: 3 },
          ],
        }),
        'مطابقة سيريالات وتشغيلات جرد بلا فرق كمي',
      ),
    );
    expect(out).not.toContain('{');
    expect(out).not.toContain('"');
    expect(out).toContain('B-7');
    expect(out).toContain('B-9');
    expect(out).toContain('2027-01-31');
  });

  it('keeps the create-session payload rendering unchanged', () => {
    const out = formatAuditDetails(
      row(
        JSON.stringify({
          actorUserId: 5,
          after: { sessionId: 20, branchId: 31, branchName: 'الفرع الرئيسي', locationId: 61, locationName: 'المخزن الرئيسي', status: 'draft' },
        }),
        'جلسة جرد مخزون',
      ),
    );
    expect(out).not.toContain('{');
    expect(out).not.toContain('"');
    expect(out).toContain('رقم الجلسة: 20');
    expect(out).toContain('الفرع: الفرع الرئيسي');
    expect(out).toContain('المخزن: المخزن الرئيسي');
    expect(out).toContain('الحالة: مسودة');
  });
});
