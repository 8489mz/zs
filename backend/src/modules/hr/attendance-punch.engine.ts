import { todayTenantDate } from '../../common/utils/tenant-timezone.util';
import { firstDayOfTenantMonth } from '../../common/utils/client-date-bounds.util';

/**
 * محرك نقي لحسم لحظة البصمة وتاريخ يوم العمل.
 *
 * **لماذا محرك منفصل:** ميزة "مرساة وقت السيرفر" (`useServerTime`/`punchAction`) وُجدت
 * لتحصين الحضور ضد التلاعب بساعة جهاز العميل. لكن تثبيت **الوقت** وحده لا يكفي:
 * `work_date` هو ما يحدد اليوم الذي تُقيَّد عليه البصمة، وهو ما يقرؤه مسيّر الرواتب.
 * لو ظل `work_date` قادماً من العميل، يستطيع عميل معدَّل أن يرسل بصمة بتوقيت سيرفر
 * صحيح لكن على **أي يوم يختاره** — فتسقط الحصانة من الباب الخلفي.
 *
 * القاعدة المفروضة هنا: **إذا كانت البصمة مثبّتة بوقت السيرفر، فتاريخ يوم العمل
 * يُشتق من ساعة السيرفر بتوقيت المستأجر، ويُتجاهل أي `workDate` مرسل من العميل.**
 * يبقى `workDate` من العميل مسموحاً فقط في التحرير اليدوي (بلا مرساة)، حيث تُدخل
 * الموارد البشرية حضوراً عن يوم سابق عمداً.
 */

export type AttendancePunchInput = {
  useServerTime?: boolean;
  punchAction?: 'check_in' | 'check_out';
  mode?: string;
  allowRecheckin?: boolean;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workDate?: string | null;
};

export type AttendancePunchResolution = {
  workDate: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  /** true عندما تكون اللحظة مثبّتة بساعة السيرفر (لا يُقبل تاريخ من العميل) */
  serverAnchored: boolean;
};

export class AttendancePunchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AttendancePunchError';
  }
}

/** هل هذا الطلب مثبّت بساعة السيرفر؟ */
export function isServerAnchoredPunch(input: AttendancePunchInput): boolean {
  return Boolean(input.useServerTime || input.punchAction);
}

/**
 * يحسم `workDate` و`checkInAt`/`checkOutAt` من حمولة الطلب.
 *
 * @param normalizeDateOnly دالة تطبيع التاريخ المستخدمة في الخدمة (تمرَّر لتفادي التكرار)
 */
export function resolveAttendancePunch(
  input: AttendancePunchInput,
  tenantTimezone: string,
  normalizeDateOnly: (value: unknown) => string | null,
  now: Date = new Date(),
): AttendancePunchResolution {
  const serverAnchored = isServerAnchoredPunch(input);

  if (serverAnchored) {
    // اللحظة والتاريخ كلاهما من السيرفر — أي `workDate` من العميل يُتجاهل عمداً.
    const isCheckOut = input.punchAction === 'check_out';
    return {
      workDate: todayTenantDate(tenantTimezone, now),
      checkInAt: isCheckOut ? null : now,
      checkOutAt: isCheckOut ? now : null,
      serverAnchored: true,
    };
  }

  // تحرير يدوي: التاريخ والأوقات من العميل، مع التحقق منها.
  // Manual corrections stay possible, but bounded to the OPEN PAYROLL
  // MONTH — [first day of the tenant's current month, today]. Anything
  // older or in the future is a tampered or mistaken date, not a
  // correction. Days inside approved/paid payroll runs stay blocked by
  // assertAttendanceDayNotPosted in the service; this is the outer fence.
  const suppliedWorkDate = normalizeDateOnly(input.workDate);
  if (suppliedWorkDate) {
    const todayKey = todayTenantDate(tenantTimezone, now);
    if (suppliedWorkDate < firstDayOfTenantMonth(todayKey) || suppliedWorkDate > todayKey) {
      throw new AttendancePunchError(
        'Attendance date is outside the open payroll month',
        'HR_ATTENDANCE_DATE_OUT_OF_RANGE',
      );
    }
  }
  const workDate = suppliedWorkDate || todayTenantDate(tenantTimezone, now);
  const checkInAt = input.checkInAt ? new Date(input.checkInAt) : null;
  const checkOutAt = input.checkOutAt ? new Date(input.checkOutAt) : null;

  if ((checkInAt && Number.isNaN(checkInAt.getTime())) || (checkOutAt && Number.isNaN(checkOutAt.getTime()))) {
    throw new AttendancePunchError('Attendance check-in/out time is invalid', 'HR_ATTENDANCE_TIME_INVALID');
  }

  return { workDate, checkInAt, checkOutAt, serverAnchored: false };
}

/**
 * هل يبدأ هذا الطلب وردية/جلسة جديدة فوق يوم مكتمل (حضور وانصراف مسجلان)؟
 *
 * `punchAction === 'check_out'` **لا** يبدأ جلسة جديدة حتى لو أُرسل `allowRecheckin`:
 * الفرع القديم كان يفحص `mode`/`allowRecheckin` وحدهما فيكتب طلب انصراف كأنه حضور جديد.
 */
export function startsNewSession(input: AttendancePunchInput, hasCompletedSession: boolean): boolean {
  if (!hasCompletedSession) return false;
  if (input.punchAction === 'check_out') return false;
  return input.mode === 'new_session' || Boolean(input.allowRecheckin);
}
