/*
 * audit-details-format-activity-log.spec.ts — INV-AUDIT-ACTIVITY-LOG-JSON.
 *
 * Batch 15 P2 fixed count-session events on /audit, but the same events
 * in the employee activity log (Reports → employee reports → user
 * details → activity log) still rendered raw JSON, because that renderer
 * printed row.details verbatim and never called formatAuditDetails:
 * `اعتماد جلسة جرد — {"actorUserId":"67","after":{"sessionId":22,
 * "status":"posted","skippedItemIds":[]}}`. And on /audit itself the
 * post-batch event still showed untranslated keys (firstItemId /
 * itemCount / remaining) because FIELD_LABELS had no labels for them
 * and `remaining` (a boolean) rendered as true/false.
 *
 * WHAT THIS PINS, driving the REAL formatAuditDetails (the one formatter
 * both renderers now call — /audit directly, the activity log through
 * formatEmployeeActivityDetails):
 * - the recorded post-batch event renders as labelled readable text:
 *   session, first item, item count, journal entry, remaining by meaning
 *   (يوجد / لا يوجد — never true/false), deferred items by label.
 * - the recorded approve-session event renders the same way, in both
 *   row shapes: the /audit row (action + details) and the raw
 *   activity-log row (title = the action, details = the raw JSON).
 * - a null journalEntryId renders nothing (no 'null', no raw JSON).
 * - a plain-sentence activity-log detail still passes through verbatim.
 */
import { describe, expect, it } from 'vitest';
import { formatAuditDetails, formatEmployeeActivityDetails } from '@/features/audit/lib/audit-details-format';
import type { AuditLog } from '@/types/domain';

const POST_BATCH_DETAILS = JSON.stringify({
  sessionId: 22,
  firstItemId: '5210',
  itemCount: 1,
  journalEntryId: null,
  remaining: false,
  skippedItemIds: [],
});

const POST_BATCH_WITH_REMAINDER = JSON.stringify({
  sessionId: 22,
  firstItemId: '5210',
  itemCount: 3,
  journalEntryId: 123,
  remaining: true,
  skippedItemIds: [12, 15],
});

const APPROVE_DETAILS = JSON.stringify({
  actorUserId: '67',
  after: { sessionId: 22, status: 'posted', skippedItemIds: [] },
});

const RAW_KEYS = ['firstItemId', 'itemCount', 'journalEntryId', 'remaining', 'skippedItemIds', 'sessionId', 'actorUserId', 'after'];

function auditRow(details: string, action: string): AuditLog {
  return { id: '1', action, details, createdAt: '2026-11-07T10:00:00.000Z' };
}

function assertReadable(out: string): void {
  expect(out).not.toContain('{');
  expect(out).not.toContain('"');
  expect(out).not.toContain('true');
  expect(out).not.toContain('false');
  expect(out).not.toContain('null');
  for (const key of RAW_KEYS) expect(out).not.toContain(key);
}

describe('formatAuditDetails — count-session events in the activity log (INV-AUDIT-ACTIVITY-LOG-JSON)', () => {
  it('renders the recorded post-batch event as labelled text on /audit, remaining by meaning', () => {
    const out = formatAuditDetails(auditRow(POST_BATCH_DETAILS, 'ترحيل دفعة جرد'));
    assertReadable(out);
    expect(out).toContain('رقم الجلسة: 22');
    expect(out).toContain('رقم أول بند: #5210');
    expect(out).toContain('عدد البنود: 1');
    expect(out).toContain('بنود متبقية: لا يوجد');
  });

  it('renders a post-batch event with a journal entry, remainder and deferred items', () => {
    const out = formatAuditDetails(auditRow(POST_BATCH_WITH_REMAINDER, 'ترحيل دفعة جرد'));
    assertReadable(out);
    expect(out).toContain('رقم الجلسة: 22');
    expect(out).toContain('رقم أول بند: #5210');
    expect(out).toContain('عدد البنود: 3');
    expect(out).toContain('رقم القيد: #123');
    expect(out).toContain('بنود متبقية: يوجد');
    expect(out).toContain('البنود المؤجلة: 12، 15');
  });

  it('renders the recorded approve-session event as labelled text on /audit', () => {
    const out = formatAuditDetails(auditRow(APPROVE_DETAILS, 'اعتماد جلسة جرد'));
    assertReadable(out);
    expect(out).toContain('رقم المستخدم: 67');
    expect(out).toContain('رقم الجلسة: 22');
    expect(out).toContain('الحالة: مرحّلة');
  });

  it('renders the same post-batch event as labelled text from a raw activity-log row (title = the action)', () => {
    const out = formatEmployeeActivityDetails({ title: 'ترحيل دفعة جرد', details: POST_BATCH_DETAILS });
    assertReadable(out);
    expect(out).toContain('رقم الجلسة: 22');
    expect(out).toContain('رقم أول بند: #5210');
    expect(out).toContain('عدد البنود: 1');
    expect(out).toContain('بنود متبقية: لا يوجد');
  });

  it('renders the same approve-session event as labelled text from a raw activity-log row', () => {
    const out = formatEmployeeActivityDetails({ title: 'اعتماد جلسة جرد', details: APPROVE_DETAILS });
    assertReadable(out);
    expect(out).toContain('رقم المستخدم: 67');
    expect(out).toContain('رقم الجلسة: 22');
    expect(out).toContain('الحالة: مرحّلة');
  });

  it('renders a raw activity-log row through formatAuditDetails itself (title as action)', () => {
    const out = formatAuditDetails(auditRow(APPROVE_DETAILS, 'اعتماد جلسة جرد'));
    assertReadable(out);
    expect(out).toContain('رقم الجلسة: 22');
    expect(out).toContain('الحالة: مرحّلة');
  });

  it('leaves a plain-sentence activity-log detail verbatim', () => {
    const out = formatEmployeeActivityDetails({ title: 'تسجيل مصروف', details: 'تم تسجيل مصروف بواسطة admin' });
    expect(out).toBe('تم تسجيل مصروف بواسطة admin');
  });
});
