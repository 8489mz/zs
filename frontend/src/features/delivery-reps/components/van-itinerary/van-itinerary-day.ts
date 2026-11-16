import type { VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';

const DAY_ALIASES: Record<string, string[]> = {
  sunday: ['sunday', 'الأحد', 'الاحد', 'أحد', 'احد'],
  monday: ['monday', 'الإثنين', 'الاثنين', 'إثنين', 'اثنين', 'الاتنين', 'اتنين'],
  tuesday: ['tuesday', 'الثلاثاء', 'الثلاثا', 'ثلاثاء', 'ثلاثا', 'التلات', 'تلات'],
  wednesday: ['wednesday', 'الأربعاء', 'الاربعاء', 'أربعاء', 'اربعاء', 'الأربعا', 'الاربعا', 'اربعا'],
  thursday: ['thursday', 'الخميس', 'خميس'],
  friday: ['friday', 'الجمعة', 'الجمعه', 'جمعة', 'جمعه'],
  saturday: ['saturday', 'السبت', 'سبت'],
};

export const DAY_KEY_TO_ARABIC: Record<string, string> = {
  saturday: 'السبت',
  sunday: 'الأحد',
  monday: 'الإثنين',
  tuesday: 'الثلاثاء',
  wednesday: 'الأربعاء',
  thursday: 'الخميس',
  friday: 'الجمعة',
};

export const ALL_WEEK_DAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'] as const;

export function normalizeDayKey(day?: string | null): string {
  if (!day) return '';
  const d = String(day).trim().toLowerCase();
  for (const [key, aliases] of Object.entries(DAY_ALIASES)) {
    if (aliases.some((a) => d === a || d.includes(a))) {
      return key;
    }
  }
  return d;
}

function customerMatchesDay(
  item: VanCustomerItineraryItem,
  targetDay: string,
  todayArabicName: string,
): boolean {
  if (!targetDay || targetDay === 'all') return true;

  const todayKey = normalizeDayKey(todayArabicName);
  const targetKey = targetDay === 'today' ? todayKey : normalizeDayKey(targetDay);
  if (!targetKey) return true;

  // Extract customer scheduled days (prefer array visitDays, fallback to singular visitDay)
  const rawDays = Array.isArray(item.visitDays) && item.visitDays.length > 0
    ? item.visitDays
    : (item.visitDay ? [item.visitDay] : []);

  // If customer has no specific restricted visit days:
  // They are available in the daily open route
  if (rawDays.length === 0) {
    return true;
  }

  // Match customer assigned days against the active target day key
  return rawDays.some((d) => normalizeDayKey(d) === targetKey);
}
