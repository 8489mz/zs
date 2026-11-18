import { getCurrencyDecimals, getCurrencySymbol, getGlobalSystemCurrency } from './currencies';

/*
 * Module-level Intl formatter caches. Constructing an Intl formatter
 * is expensive and the POS path formats every price on every render,
 * so one formatter per decimals value (locale is fixed 'en-US') is
 * built once and reused. `getCurrencyDecimals` only ever returns 2
 * or 3, but the cache is keyed on the decimals value itself, so any
 * future value gets its own formatter with no behaviour change.
 * Output is byte-identical to a freshly constructed formatter.
 */
const currencyFormatters = new Map<number, Intl.NumberFormat>();

function getCurrencyFormatter(decimals: number): Intl.NumberFormat {
  let formatter = currencyFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    currencyFormatters.set(decimals, formatter);
  }
  return formatter;
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export function formatCurrency(value: number | string | undefined | null, currencyCode?: string | null): string {
  const code = currencyCode || getGlobalSystemCurrency();
  const decimals = getCurrencyDecimals(code);
  const num = Number(value || 0);
  return getCurrencyFormatter(decimals).format(num);
}

export function formatCurrencyWithSymbol(value: number | string | undefined | null, currencyCode?: string | null): string {
  const code = currencyCode || getGlobalSystemCurrency();
  const symbol = getCurrencySymbol(code);
  return `${formatCurrency(value, code)} ${symbol}`;
}

export function formatCurrencyWithCode(value: number | string | undefined | null, currencyCode?: string | null): string {
  const code = currencyCode || getGlobalSystemCurrency();
  return `${formatCurrency(value, code)} ${code}`;
}

export function formatWhatsAppNumber(phone: string) {
  let cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
  if (cleaned.length === 11 && cleaned.startsWith('01')) {
    cleaned = '2' + cleaned;
  }
  if (cleaned.length === 10 && cleaned.startsWith('05')) {
    cleaned = '966' + cleaned.slice(1);
  }
  if (cleaned.length === 8 && /^[2569]/.test(cleaned)) {
    cleaned = '965' + cleaned;
  }
  return cleaned;
}

export function formatDate(value?: string | Date | number | null) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormatter.format(date);
}

export function toArabicDigits(str: string): string {
  return String(str || '');
}

/**
 * Today's date key (YYYY-MM-DD) from the LOCAL calendar parts, never from
 * `toISOString()` (INV-IMPORT-COMPLIANCE-HS-ACI-DATES). A date-input
 * default built from the UTC slice is the previous day for the first two
 * hours after midnight in the tenant's zone (Africa/Cairo, UTC+2): a PI
 * created at 00:03 EET on 2026-11-09 defaulted to 11/08/2026 while its
 * server-issued number — keyed by the tenant-local business day — read
 * 261109. Local parts are the browser's own day, which is the tenant's
 * day for the operator sitting in the tenant's zone. A traveller in a
 * different zone still sees their own local day: a fully tenant-zone
 * default needs the settings timezone plumbed into the frontend.
 */
export function todayLocalDateKey(referenceDate?: Date): string {
  const d = referenceDate ? new Date(referenceDate) : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tenantZoneParts(instant: Date, timeZone: string): { year: string; month: string; day: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    if (!map.year || !map.month || !map.day) return null;
    return { year: map.year, month: map.month, day: map.day };
  } catch {
    return null;
  }
}

/**
 * Today's date key (YYYY-MM-DD) in the TENANT's timezone
 * (INV-TOISO-DATE-SWEEP-CORE). Mirrors the backend's todayTenantDate
 * (tenant-timezone.util.ts): the zone is a REQUIRED parameter — never a
 * silent default — so a call site must pass the tenant's zone explicitly
 * (settings.timezone / serverTimezone) and the reader can see which zone
 * the key is in. An unknown/invalid zone falls back to the browser-local
 * calendar day (todayLocalDateKey), the same fallback
 * formatTenantDateKey uses — never silently to Africa/Cairo.
 *
 * The UTC-midnight edge it closes: 01:00 in Cairo is still the previous
 * UTC day, so the UTC ISO slice keys a business
 * date to yesterday for the first two hours after midnight (UTC+2;
 * three hours for UTC+3 zones). This helper keys the instant in the
 * tenant zone instead.
 */
export function todayTenantDateKey(timeZone: string, referenceDate?: Date): string {
  const instant = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(instant.getTime())) return todayLocalDateKey(new Date());
  const parts = tenantZoneParts(instant, timeZone);
  if (!parts) return todayLocalDateKey(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * The calendar day N days from today (or from the reference instant) in
 * the TENANT's timezone (INV-TOISO-DATE-SWEEP-CORE). Whole-calendar-day
 * arithmetic: the zone's calendar day is read first, N days are added to
 * it, and the result is keyed — adding raw milliseconds to the instant
 * would drift across a DST transition inside the window. Negative N
 * counts backwards (e.g. -14 for a "last 14 days" range start). Same
 * required-zone contract and invalid-zone fallback as todayTenantDateKey.
 */
export function addDaysTenantDateKey(timeZone: string, days: number, referenceDate?: Date): string {
  const instant = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(instant.getTime())) return addDaysLocalDateKey(days, new Date());
  const parts = tenantZoneParts(instant, timeZone);
  if (!parts) return addDaysLocalDateKey(days, instant);
  const shifted = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days));
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The calendar day N days from today (or from the reference instant) in
 * the browser-local calendar (INV-TOISO-DATE-SWEEP-CORE). The local twin
 * of addDaysTenantDateKey, for the call sites where the tenant zone is
 * not in scope: local `setDate` arithmetic keeps the wall time, so the
 * key is the local calendar day N days on. Replaces the
 * `Date.now() + N * 86400000` + UTC-slice idiom, whose UTC slice keys
 * yesterday in the 00:00–02:00 window and whose raw millisecond step
 * drifts across DST.
 */
export function addDaysLocalDateKey(days: number, referenceDate?: Date): string {
  const d = referenceDate ? new Date(referenceDate) : new Date();
  d.setDate(d.getDate() + days);
  return todayLocalDateKey(d);
}

/**
 * Business-day key (YYYY-MM-DD) of an entry instant in the TENANT's
 * timezone (INV-IMPORT-JE-LIST-TENANT-TIMEZONE-DATE, proposed). Mirrors
 * the backend's resolveBusinessDateKey contract: a string that is
 * already a calendar day (YYYY-MM-DD) passes through untouched -- it is
 * a day, not an instant, and reinterpreting it in a timezone would
 * shift it. A timestamptz instant (what the API returns for
 * journal_entries.entry_date) is read in the tenant's zone, never from
 * the UTC ISO slice: JE-00015025 posted at 00:03 EET on 2026-11-09
 * arrives as 2026-11-08T22:03:00.000Z, and String(...).slice(0, 10)
 * displayed the wrong day, 2026-11-08. An unknown/invalid zone falls
 * back to the browser-local calendar day (todayLocalDateKey), the same
 * fallback the tenant-timezone displays elsewhere use.
 */
export function formatTenantDateKey(value?: string | Date | null, timeZone = 'Africa/Cairo'): string {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return String(value);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return todayLocalDateKey(instant);
  }
}

export function formatDateOnly(value?: string | Date) {
  if (!value) return '—';
  let year = '';
  let month = '';
  let day = '';
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      year = match[1];
      month = match[2];
      day = match[3];
    }
  }
  if (!year) {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return String(value);
    day = String(date.getDate()).padStart(2, '0');
    month = String(date.getMonth() + 1).padStart(2, '0');
    year = String(date.getFullYear());
  }
  return `${year}/${month}/${day}`;
}

export function formatDateTimeArabic(date?: Date | string | null) {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return String(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'م' : 'ص';
  hours = hours % 12 || 12;
  const formattedHours = String(hours).padStart(2, '0');
  return `${day}/${month}/${year} - ${formattedHours}:${minutes} ${period}`;
}

function toIsoUtc(date: Date) {
  return new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  )).toISOString();
}

export function dayRangeLast30(referenceDate?: Date) {
  const end = referenceDate ? new Date(referenceDate) : new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return { from: toIsoUtc(start), to: toIsoUtc(end) };
}
