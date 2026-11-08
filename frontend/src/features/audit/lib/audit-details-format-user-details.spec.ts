/*
 * audit-details-format-user-details.spec.ts — INV-ACTIVITY-LOG-USER-DETAILS-LABELS.
 *
 * Batch 16 R1 fixed count-session events on /audit and in the Reports
 * activity log, but the Settings user-details log (تفاصيل المستخدم →
 * نشاط المستخدم) renders the SAME activity rows through a third path
 * that prints row.details verbatim: the recorded events #26296 /
 * #26295 / #26294 (session 24) and #26278 / #26277 (session 23) showed
 * raw JSON there. That path must call the same adapter the Reports log
 * calls (formatEmployeeActivityDetails), so the recorded rows below
 * render as labelled text here too.
 *
 * And on /audit itself three recorded HR sentences still showed
 * untranslated English heads, because normalizeAuditDetailText had
 * sentence patterns only for the id-bearing loan/leave forms:
 * 'Leave request created for employee #105 by muse',
 * 'Leave type Annual saved by muse' and 'Employee loan created by
 * muse' (no id) fell through to the generic cleanup. The same
 * English ACTION titles ('Create HR employee loan',
 * 'Save HR attendance day') also showed verbatim as the title column
 * of both activity logs, although getAuditActionLabel already maps
 * them — the title cells never called it.
 *
 * WHAT THIS PINS, driving the REAL formatter + presenter:
 * - the recorded user-details rows render as labelled text through
 *   formatEmployeeActivityDetails (no JSON, no raw keys, no
 *   true/false/null), with the same labels as on /audit;
 * - the three recorded HR sentences render Arabic through
 *   normalizeAuditDetailText (no English words left — the actor
 *   username 'muse' is user data, not prose, and stays);
 * - the recorded HR action titles label Arabic through
 *   getAuditActionLabel, and an unknown title passes through verbatim.
 */
import { describe, expect, it } from 'vitest';
import { formatEmployeeActivityDetails } from '@/features/audit/lib/audit-details-format';
import { getAuditActionLabel, normalizeAuditDetailText } from '@/features/audit/lib/audit-activity-presenter';

// Recorded live 2026-11-08 in the user-details activity log (session 24).
const APPROVE_SESSION_24 = JSON.stringify({
  actorUserId: '67',
  after: { sessionId: 24, status: 'posted', skippedItemIds: [] },
});

// Recorded live 2026-11-08 in the user-details activity log (session 24).
const POST_BATCH_SESSION_24 = JSON.stringify({
  sessionId: 24,
  firstItemId: '5212',
  itemCount: 1,
  journalEntryId: 15018,
  remaining: false,
  skippedItemIds: [],
});

const RAW_KEYS = ['firstItemId', 'itemCount', 'journalEntryId', 'remaining', 'skippedItemIds', 'sessionId', 'actorUserId', 'after'];

function assertReadable(out: string): void {
  expect(out).not.toContain('{');
  expect(out).not.toContain('"');
  expect(out).not.toContain('true');
  expect(out).not.toContain('false');
  expect(out).not.toContain('null');
  for (const key of RAW_KEYS) expect(out).not.toContain(key);
}

describe('user-details activity log — count-session events as labelled text (INV-ACTIVITY-LOG-USER-DETAILS-LABELS)', () => {
  it('renders the recorded approve-session event #26296 as labelled text', () => {
    const out = formatEmployeeActivityDetails({ title: 'اعتماد جلسة جرد', details: APPROVE_SESSION_24 });
    assertReadable(out);
    expect(out).toContain('رقم المستخدم: 67');
    expect(out).toContain('رقم الجلسة: 24');
    expect(out).toContain('الحالة: مرحّلة');
  });

  it('renders the recorded post-batch event #26295 as labelled text', () => {
    const out = formatEmployeeActivityDetails({ title: 'ترحيل دفعة جرد', details: POST_BATCH_SESSION_24 });
    assertReadable(out);
    expect(out).toContain('رقم الجلسة: 24');
    expect(out).toContain('رقم أول بند: #5212');
    expect(out).toContain('عدد البنود: 1');
    expect(out).toContain('رقم القيد: #15018');
    expect(out).toContain('بنود متبقية: لا يوجد');
  });
});

describe('HR event sentences — Arabic labels on /audit (INV-ACTIVITY-LOG-USER-DETAILS-LABELS)', () => {
  it('translates the recorded leave-request sentence', () => {
    const out = normalizeAuditDetailText('Leave request created for employee #105 by muse');
    expect(out).toContain('تم تقديم طلب إجازة للموظف #105');
    expect(out).toContain('بواسطة muse');
    for (const word of ['Leave', 'request', 'created', 'for', 'employee']) expect(out).not.toContain(word);
  });

  it('translates the recorded leave-type sentence, keeping the type name', () => {
    const out = normalizeAuditDetailText('Leave type Annual saved by muse');
    expect(out).toContain('تم حفظ نوع الإجازة Annual');
    expect(out).toContain('بواسطة muse');
    for (const word of ['Leave', 'type', 'saved']) expect(out).not.toContain(word);
  });

  it('translates the recorded no-id loan sentence', () => {
    const out = normalizeAuditDetailText('Employee loan created by muse');
    expect(out).toContain('تم إنشاء سلفة موظف');
    expect(out).toContain('بواسطة muse');
    for (const word of ['Employee', 'loan', 'created']) expect(out).not.toContain(word);
  });

  it('translates the recorded no-id loan sentence through the activity-log adapter too', () => {
    const out = formatEmployeeActivityDetails({ title: 'Create HR employee loan', details: 'Employee loan created by muse' });
    expect(out).toContain('تم إنشاء سلفة موظف بواسطة muse');
    expect(out).not.toContain('Employee loan');
  });

  it('keeps translating the id-bearing loan and leave sentences (regression)', () => {
    expect(normalizeAuditDetailText('Employee loan #12 updated by muse')).toContain('تم تعديل سلفة الموظف #12 بواسطة muse');
    expect(normalizeAuditDetailText('Leave request #7 approved by muse')).toContain('تم الموافقة على طلب الإجازة #7 بواسطة muse');
  });
});

describe('HR action titles — Arabic labels in the activity logs (INV-ACTIVITY-LOG-USER-DETAILS-LABELS)', () => {
  it('labels the recorded HR actions in Arabic', () => {
    expect(getAuditActionLabel('Create HR employee loan')).toBe('إنشاء سلفة موظف');
    expect(getAuditActionLabel('Save HR attendance day')).toBe('حفظ حضور اليوم');
    expect(getAuditActionLabel('Create HR leave request')).toBe('تقديم طلب إجازة');
    expect(getAuditActionLabel('Create HR leave type')).toBe('تحديث نوع إجازة');
  });

  it('leaves an unknown title verbatim', () => {
    expect(getAuditActionLabel('بيع نقدي')).toBe('بيع نقدي');
  });
});
