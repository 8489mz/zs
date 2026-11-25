/**
 * محرك نقي لتقسيم سنة مالية إلى فتراتها الشهرية.
 *
 * كان هذا المنطق مكتوباً داخل `fiscal-year.service.ts` وحده، وجناح الاختبار كان **يعيد كتابته
 * نسخةً ثانية داخل الاختبار** ثم يفحص النسخة. يعني الخدمة تستطيع أن تتغير والجناح يبقى أخضر —
 * وهو أسوأ من غياب الجناح، لأنه يوهم بتغطية غير موجودة.
 *
 * الحساب هنا لا يلمس قاعدة بيانات ولا وقتاً حاضراً، فيُستورَد كما هو في الخدمة وفي الاختبار،
 * ويبقى مصدراً واحداً للحقيقة (§2.3 — محركات الحساب النقية).
 */

export const ARABIC_MONTH_NAMES = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

export type GeneratedFiscalPeriod = {
  periodNumber: number;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
};

/**
 * يقسّم المدى `[startDateStr, endDateStr]` إلى فترات شهرية.
 *
 * - الفترة الأولى تبدأ من تاريخ بداية السنة نفسه لا من أول الشهر (سنة مالية تبدأ 15 مارس
 *   فترتها الأولى 15–31 مارس).
 * - الفترة الأخيرة تنتهي بتاريخ نهاية السنة لا بنهاية الشهر.
 * - آخر يوم في الشهر يُحسب بـ`Date.UTC(y, m + 1, 0)` فتُعالَج السنة الكبيسة من نفس التقويم
 *   بلا استثناء مكتوب بالعين.
 * - كل الحسابات بـUTC: التواريخ هنا تواريخ تقويمية لا لحظات زمنية، وخلطها بالتوقيت المحلي
 *   كان سيزحزح حدود الشهر بيوم في نصف الكرة الأرضية.
 */
export function buildMonthlyFiscalPeriods(startDateStr: string, endDateStr: string): GeneratedFiscalPeriod[] {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (endDateStr < startDateStr) return [];

  const periods: GeneratedFiscalPeriod[] = [];
  let periodNumber = 1;
  let curr = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (curr <= endUtc) {
    const yearNum = curr.getUTCFullYear();
    const monthIdx = curr.getUTCMonth();

    const pStart =
      periodNumber === 1 ? startDateStr : new Date(Date.UTC(yearNum, monthIdx, 1)).toISOString().slice(0, 10);

    const lastDayOfMonth = new Date(Date.UTC(yearNum, monthIdx + 1, 0));
    const pEnd = lastDayOfMonth > endUtc ? endDateStr : lastDayOfMonth.toISOString().slice(0, 10);

    periods.push({
      periodNumber,
      name: `${ARABIC_MONTH_NAMES[monthIdx]} ${yearNum}`,
      code: `${yearNum}-${String(monthIdx + 1).padStart(2, '0')}`,
      startDate: pStart,
      endDate: pEnd,
    });

    periodNumber += 1;
    curr = new Date(Date.UTC(yearNum, monthIdx + 1, 1));
    if (pEnd >= endDateStr) break;
  }

  return periods;
}
