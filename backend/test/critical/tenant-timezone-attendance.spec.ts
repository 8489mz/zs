import { strict as assert } from 'node:assert';
import { isValidTimezone, todayTenantDate, formatTimeInTimezone } from '../../src/common/utils/tenant-timezone.util';
import {
  AttendancePunchError,
  isServerAnchoredPunch,
  resolveAttendancePunch,
  startsNewSession,
} from '../../src/modules/hr/attendance-punch.engine';

/**
 * يستورد المحرك من الإنتاج مباشرة (AGENTS.md Rule 13). النسخة السابقة من هذا
 * الجناح كانت **تعيد كتابة** منطق الحسم داخل ملف الاختبار، فكانت تؤكد أن
 * `workDate` المرسل من العميل يُتجاهَل — بينما الإنتاج كان يعطيه الأولوية.
 * اختبار يحرس نسخته الخاصة لا يحرس شيئاً.
 */

// نفس تطبيع التاريخ المستخدم في الخدمة
function normalizeDateOnly(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function run(): void {
  // ── 1. التحقق من صحة المنطقة الزمنية ──────────────────────────────────────
  for (const tz of ['Africa/Cairo', 'Asia/Kuwait', 'Asia/Riyadh', 'Asia/Dubai', 'UTC', 'Europe/London']) {
    assert.equal(isValidTimezone(tz), true, `${tz} should be valid`);
  }
  for (const bad of ['', '   ', 'Mars/Olympus', 'Invalid/Zone', null, undefined]) {
    assert.equal(isValidTimezone(bad as any), false);
  }

  // ── 2. تاريخ اليوم بتوقيت المستأجر عبر حدود منتصف الليل ───────────────────
  const lateUtc = new Date('2026-09-20T22:30:00Z');
  assert.equal(todayTenantDate('Africa/Cairo', lateUtc), '2026-09-21', 'Cairo crosses midnight');
  assert.equal(todayTenantDate('Asia/Kuwait', lateUtc), '2026-09-21', 'Kuwait crosses midnight');
  assert.equal(todayTenantDate('America/New_York', lateUtc), '2026-09-20', 'New York is still the 20th');
  assert.equal(todayTenantDate('Invalid/Timezone', new Date('2026-09-20T12:00:00Z')), '2026-09-20');

  // ── 3. تنسيق الوقت ────────────────────────────────────────────────────────
  const sample = new Date('2026-09-20T10:00:00Z');
  assert.match(formatTimeInTimezone(sample, 'Asia/Kuwait', 'en-US'), /01:00/);
  assert.match(formatTimeInTimezone(sample, 'Asia/Dubai', 'en-US'), /02:00/);
  for (const empty of [null, undefined, 'invalid-date']) {
    assert.equal(formatTimeInTimezone(empty as any, 'Africa/Cairo'), '—');
  }

  // ── 4. مرساة وقت السيرفر: الوقت **والتاريخ** كلاهما من السيرفر ────────────
  const tz = 'Asia/Kuwait';
  const serverNow = new Date('2026-09-20T10:30:00.000Z');

  const tampered = resolveAttendancePunch(
    {
      useServerTime: true,
      punchAction: 'check_in',
      checkInAt: '2026-09-20T08:00:00.000Z', // ساعة جهاز مزوَّرة
      workDate: '2026-09-19', // يوم عمل مزوَّر
    },
    tz,
    normalizeDateOnly,
    serverNow,
  );

  assert.equal(tampered.checkInAt!.toISOString(), '2026-09-20T10:30:00.000Z', 'must use server clock');
  assert.equal(tampered.workDate, '2026-09-20', 'must ignore the client-supplied workDate');
  assert.equal(tampered.checkOutAt, null);
  assert.equal(tampered.serverAnchored, true);

  // الانصراف المثبّت يملأ checkOutAt وحده
  const anchoredOut = resolveAttendancePunch(
    { punchAction: 'check_out', workDate: '2020-01-01' },
    tz,
    normalizeDateOnly,
    serverNow,
  );
  assert.equal(anchoredOut.checkOutAt!.toISOString(), '2026-09-20T10:30:00.000Z');
  assert.equal(anchoredOut.checkInAt, null, 'check_out must not write a check-in');
  assert.equal(anchoredOut.workDate, '2026-09-20', 'check_out must ignore client workDate too');

  // مرساة بلا punchAction صريح تُعامَل كحضور
  const anchoredDefault = resolveAttendancePunch({ useServerTime: true }, tz, normalizeDateOnly, serverNow);
  assert.equal(anchoredDefault.checkInAt!.toISOString(), '2026-09-20T10:30:00.000Z');
  assert.equal(anchoredDefault.checkOutAt, null);

  assert.equal(isServerAnchoredPunch({ useServerTime: true }), true);
  assert.equal(isServerAnchoredPunch({ punchAction: 'check_out' }), true);
  assert.equal(isServerAnchoredPunch({ workDate: '2026-09-20' }), false);

  // ── 5. التحرير اليدوي: التاريخ والأوقات من العميل عمداً ───────────────────
  const manual = resolveAttendancePunch(
    {
      workDate: '2026-09-15',
      checkInAt: '2026-09-15T06:00:00.000Z',
      checkOutAt: '2026-09-15T14:00:00.000Z',
    },
    tz,
    normalizeDateOnly,
    serverNow,
  );
  assert.equal(manual.workDate, '2026-09-15', 'manual edit keeps the chosen date');
  assert.equal(manual.checkInAt!.toISOString(), '2026-09-15T06:00:00.000Z');
  assert.equal(manual.checkOutAt!.toISOString(), '2026-09-15T14:00:00.000Z');
  assert.equal(manual.serverAnchored, false);

  // تحرير يدوي بلا تاريخ يسقط على تاريخ اليوم بتوقيت المستأجر
  assert.equal(
    resolveAttendancePunch({}, tz, normalizeDateOnly, new Date('2026-09-20T22:30:00Z')).workDate,
    '2026-09-21',
  );

  // وقت غير صالح في التحرير اليدوي يُرفض
  assert.throws(
    () => resolveAttendancePunch({ checkInAt: 'not-a-date' }, tz, normalizeDateOnly, serverNow),
    (error: unknown) => error instanceof AttendancePunchError && error.code === 'HR_ATTENDANCE_TIME_INVALID',
  );

  // ── 6. بدء وردية جديدة لا يبتلع طلب انصراف ────────────────────────────────
  assert.equal(startsNewSession({ mode: 'new_session', punchAction: 'check_in' }, true), true);
  assert.equal(startsNewSession({ allowRecheckin: true, punchAction: 'check_in' }, true), true);
  assert.equal(
    startsNewSession({ allowRecheckin: true, punchAction: 'check_out' }, true),
    false,
    'a check-out must never be rewritten as a new check-in',
  );
  assert.equal(startsNewSession({ mode: 'new_session' }, false), false, 'needs a completed session first');

  console.log('tenant-timezone-attendance.spec: ok');
}

run();
