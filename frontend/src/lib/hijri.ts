/**
 * Z-Systems Umm Al-Qura (Hijri) & Dual Calendar Engine
 * Comprehensive dual calendar formatting (Umm al-Qura Hijri + Gregorian)
 * Compliant with Saudi ZATCA & GCC enterprise standards.
 */

import { todayLocalDateKey } from './format';
export const HIJRI_MONTHS_AR = [
  'محرم',
  'صفر',
  'ربيع الأول',
  'ربيع الثاني',
  'جمادى الأولى',
  'جمادى الآخرة',
  'رجب',
  'شعبان',
  'رمضان',
  'شوال',
  'ذو القعدة',
  'ذو الحجة',
] as const;

export const GREGORIAN_MONTHS_AR = [
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

export const DAYS_AR = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

/**
 * Converts Eastern Arabic numerals (٠-٩) to Latin/Standard digits (0-9)
 */
export function toLatinDigits(str: string): string {
  const easternDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return str.replace(/[٠-٩]/g, (w) => easternDigits.indexOf(w).toString());
}

/**
 * Converts standard digits to Eastern Arabic numerals (٠-٩)
 */
export function toEasternDigits(str: string | number): string {
  const easternDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(str).replace(/\d/g, (d) => easternDigits[parseInt(d, 10)]);
}

/**
 * Parse input into valid Date object
 */
function normalizeDate(dateInput?: Date | string | number | null): Date {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? new Date() : dateInput;
  const d = new Date(dateInput);
  return isNaN(d.getTime()) ? new Date() : d;
}

export interface HijriDateInfo {
  day: number;
  month: number;
  monthName: string;
  year: number;
  formatted: string;
  dayName: string;
}

export interface DualDateInfo {
  hijri: HijriDateInfo;
  gregorian: {
    day: number;
    month: number;
    monthName: string;
    year: number;
    formatted: string;
    dayName: string;
  };
  combined: string;
  dayName: string;
}

/**
 * Formats a date in Umm al-Qura Hijri calendar
 */
export function formatHijriDate(
  dateInput?: Date | string | number | null,
  options: { latinDigits?: boolean; includeSuffix?: boolean } = { latinDigits: true, includeSuffix: true }
): string {
  const d = normalizeDate(dateInput);
  try {
    const formatter = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    let formatted = formatter.format(d);
    if (options.latinDigits) {
      formatted = toLatinDigits(formatted);
    }
    if (options.includeSuffix && !formatted.includes('هـ')) {
      formatted += ' هـ';
    }
    return formatted;
  } catch {
    // Fallback if Intl is unavailable
    return todayLocalDateKey(d);
  }
}

/**
 * Extracts structured Hijri date components (day, month, year, monthName)
 */
export function getHijriDateInfo(
  dateInput?: Date | string | number | null,
  latinDigits = true
): HijriDateInfo {
  const d = normalizeDate(dateInput);
  const dayName = DAYS_AR[d.getDay()];

  try {
    const partsFormatter = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
    const parts = partsFormatter.formatToParts(d);
    const day = parseInt(parts.find((p) => p.type === 'day')?.value || '1', 10);
    const month = parseInt(parts.find((p) => p.type === 'month')?.value || '1', 10);
    const year = parseInt(parts.find((p) => p.type === 'year')?.value || '1448', 10);
    const monthName = HIJRI_MONTHS_AR[Math.max(0, Math.min(11, month - 1))] || 'محرم';

    const formatted = `${latinDigits ? day : toEasternDigits(day)} ${monthName} ${latinDigits ? year : toEasternDigits(year)} هـ`;

    return {
      day,
      month,
      monthName,
      year,
      formatted,
      dayName,
    };
  } catch {
    return {
      day: 1,
      month: 1,
      monthName: HIJRI_MONTHS_AR[0],
      year: 1448,
      formatted: '1 محرم 1448 هـ',
      dayName,
    };
  }
}

/**
 * Formats both Hijri and Gregorian dates together
 * Example: "26 ربيع الأول 1448 هـ / 08 سبتمبر 2026 م"
 */
export function getDualDate(
  dateInput?: Date | string | number | null,
  options: { latinDigits?: boolean; separator?: string } = { latinDigits: true, separator: ' / ' }
): DualDateInfo {
  const d = normalizeDate(dateInput);
  const hijri = getHijriDateInfo(d, options.latinDigits ?? true);

  const gDay = d.getDate();
  const gMonth = d.getMonth() + 1;
  const gYear = d.getFullYear();
  const gMonthName = GREGORIAN_MONTHS_AR[d.getMonth()] || '';
  const dayName = DAYS_AR[d.getDay()];

  const gDayStr = String(gDay).padStart(2, '0');
  const gregorianFormatted = `${gDayStr} ${gMonthName} ${gYear} م`;

  const combined = `${hijri.formatted}${options.separator || ' / '}${gregorianFormatted}`;

  return {
    hijri,
    gregorian: {
      day: gDay,
      month: gMonth,
      monthName: gMonthName,
      year: gYear,
      formatted: gregorianFormatted,
      dayName,
    },
    combined,
    dayName,
  };
}
