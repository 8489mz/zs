/**
 * Van Sales & Wholesale Itinerary Route Scheduling Engine
 * Unified Day Normalization, Multi-Day Visit Matching & Timezone Resolution.
 */

export const DAY_ALIASES: Record<string, string[]> = {
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

export const CANONICAL_ARABIC_DAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'] as const;

/**
 * Normalizes any Arabic or English day string into canonical English key.
 * (e.g. 'الاثنين' -> 'monday', 'الإثنين' -> 'monday', 'الجمعه' -> 'friday')
 */
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

/**
 * Extracts and harmonizes customer visit days from metadata.
 * Ensures visit_days (array) and visit_day (string) are always 100% in sync.
 */
export function extractCustomerVisitDays(meta: any): {
  visitDays: string[];
  visitDay: string;
} {
  if (!meta || typeof meta !== 'object') {
    return { visitDays: [], visitDay: '' };
  }

  let rawList: string[] = [];
  if (Array.isArray(meta.visit_days) && meta.visit_days.length > 0) {
    rawList = meta.visit_days;
  } else if (Array.isArray(meta.visitDays) && meta.visitDays.length > 0) {
    rawList = meta.visitDays;
  } else if (meta.visit_day) {
    rawList = [meta.visit_day];
  } else if (meta.visitDay) {
    rawList = [meta.visitDay];
  }

  const keys = Array.from(new Set(rawList.map((d) => normalizeDayKey(d)).filter(Boolean)));
  const normalizedArabicDays = keys.map((k) => DAY_KEY_TO_ARABIC[k] || k);
  const primaryDay = normalizedArabicDays[0] || '';

  return {
    visitDays: normalizedArabicDays,
    visitDay: primaryDay,
  };
}

/**
 * Determines whether a customer is scheduled to be visited on target day key.
 * If customer has no specific restricted visit days, they are considered available in daily open route.
 */
export function isCustomerScheduledForDay(visitDays: string[], targetDayKey: string): boolean {
  if (!visitDays || visitDays.length === 0) {
    return true;
  }
  return visitDays.some((d) => normalizeDayKey(d) === targetDayKey);
}

/**
 * Returns current business day name & key based on Egyptian / local timezone.
 */
export function getCurrentBusinessDay(timezone = 'Africa/Cairo'): {
  dayKey: string;
  dayArabicName: string;
} {
  try {
    const weekdayEnglish = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    })
      .format(new Date())
      .toLowerCase();

    const dayKey = normalizeDayKey(weekdayEnglish);
    const dayArabicName = DAY_KEY_TO_ARABIC[dayKey] || 'الأربعاء';
    return { dayKey, dayArabicName };
  } catch {
    // The requested zone is unusable — retry in the canonical
    // default zone (env BUSINESS_TIMEZONE, else Africa/Cairo)
    // before falling back to host-local parts, so a bad setting
    // still yields a deterministic business day.
    try {
      const fallbackZone = process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
      const fallbackWeekday = new Intl.DateTimeFormat('en-US', {
        timeZone: fallbackZone,
        weekday: 'long',
      })
        .format(new Date())
        .toLowerCase();
      const fallbackDayKey = normalizeDayKey(fallbackWeekday);
      return { dayKey: fallbackDayKey, dayArabicName: DAY_KEY_TO_ARABIC[fallbackDayKey] || 'الأربعاء' };
    } catch {
      const arabicDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const englishDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const idx = new Date().getDay();
      return {
        dayKey: englishDays[idx],
        dayArabicName: arabicDays[idx],
      };
    }
  }
}
