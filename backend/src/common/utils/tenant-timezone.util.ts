import { sql, type Kysely } from '../../database/kysely';
import type { Database } from '../../database/database.types';

// In-memory cache for tenant timezone (5 minutes TTL)
const timezoneCache = new Map<string, { timezone: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Validates if a timezone string is a valid IANA timezone name
 */
export function isValidTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retrieves the configured timezone for a tenant from the settings table.
 * Falls back to process.env.BUSINESS_TIMEZONE or 'Africa/Cairo'.
 */
export async function getTenantTimezone(db: Kysely<Database>, tenantId?: string | null): Promise<string> {
  const fallback = process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
  if (!tenantId) return fallback;

  const cached = timezoneCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.timezone;
  }

  let row: { rows: Array<{ value: unknown }> };
  try {
    row = await sql<{ value: unknown }>`
      SELECT value FROM settings
      WHERE tenant_id = ${tenantId} AND key = 'timezone'
      LIMIT 1
    `.execute(db);
  } catch {
    // عطل عابر في القاعدة: نرجع للقيمة الاحتياطية لهذا الطلب فقط و**لا نخزّنها**.
    // تخزينها كان يثبّت التوقيت الخطأ 5 دقائق كاملة بعد عطل لحظي — وقرب منتصف
    // الليل ذلك يعني كتابة `work_date` بيوم خاطئ يذهب مباشرة لمسيّر الرواتب.
    return fallback;
  }

  if (row.rows.length > 0 && row.rows[0].value) {
    let rawVal = row.rows[0].value;
    if (typeof rawVal === 'string') {
      try {
        rawVal = JSON.parse(rawVal);
      } catch {
        // already a raw string
      }
    }
    const tzCandidate = String(rawVal || '').trim();
    if (isValidTimezone(tzCandidate)) {
      timezoneCache.set(tenantId, { timezone: tzCandidate, expiresAt: Date.now() + CACHE_TTL_MS });
      return tzCandidate;
    }
  }

  // الاستعلام نجح ولا يوجد إعداد صالح — تخزين القيمة الاحتياطية هنا صحيح ومقصود.
  timezoneCache.set(tenantId, { timezone: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
  return fallback;
}

/**
 * Invalidate the timezone cache for a specific tenant or all tenants
 */
export function invalidateTenantTimezoneCache(tenantId?: string): void {
  if (tenantId) {
    timezoneCache.delete(tenantId);
  } else {
    timezoneCache.clear();
  }
}

/**
 * Returns today's date formatted as YYYY-MM-DD according to the specified timezone
 */
export function todayTenantDate(timezone: string, date: Date = new Date()): string {
  const safeTz = isValidTimezone(timezone) ? timezone : process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
  return new Intl.DateTimeFormat('en-CA', { timeZone: safeTz }).format(date);
}

/**
 * Formats an instant as a 24-hour HH:mm:ss wall time in the given
 * timezone. The day half of the same instant comes from
 * todayTenantDate in the SAME zone — date and time must always agree
 * (ZATCA IssueDate/IssueTime). NEVER use toTimeString(): it renders
 * the HOST's wall time, not the tenant's. hourCycle h23 (not hour12
 * false) so midnight formats as 00:00:00, never 24:00:00.
 */
export function formatTenantTime24(timezone: string, date: Date = new Date()): string {
  const safeTz = isValidTimezone(timezone) ? timezone : process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/**
 * Formats a Date that represents a CALENDAR DAY at local midnight into
 * its YYYY-MM-DD key, from the host-local calendar parts. node-postgres
 * returns DATE columns as local-midnight Dates, so toISOString() (UTC)
 * renders the previous day on any host east of UTC -- this recovers the
 * stored day on every host. NEVER use for instants: format those with
 * todayTenantDate in the tenant's zone.
 */
export function formatLocalCalendarDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Normalizes a STORED pg DATE value (or a date-only string) to its
 * YYYY-MM-DD key. node-postgres returns DATE columns as host-local-midnight
 * Dates, so the UTC slice (`toISOString().slice(0, 10)`)
 * renders the previous day on any host east of UTC -- a Date input
 * here MUST key from the host-local calendar parts
 * (formatLocalCalendarDay). Date-only strings pass through on their
 * first 10 chars; non-ISO text parses as a local midnight and keys
 * from its local parts (the day as written).
 *
 * This is the pg-DATE twin of the UTC-slice normalizers
 * (`normalizeDateOnly` in the sales helper / storefront engine):
 * those are for UTC-midnight Dates built from DTO date-only strings,
 * where the UTC slice IS the written day -- NEVER pass a pg DATE
 * row's start/end/due/expiry day to them. Offer bounds, installment
 * due days, batch expiries and holiday rows all come here.
 */
export function normalizePgDateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return formatLocalCalendarDay(value);
  }
  const text = String(value).trim();
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatLocalCalendarDay(parsed);
}

/**
 * Formats a Date or UTC ISO string into localized time in the specified timezone
 */
export function formatTimeInTimezone(
  dateValue: Date | string | null | undefined,
  timezone: string,
  locale = 'ar-EG',
): string {
  if (!dateValue) return '—';
  const d = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
  if (Number.isNaN(d.getTime())) return '—';

  const safeTz = isValidTimezone(timezone) ? timezone : process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
  return d.toLocaleTimeString(locale, {
    timeZone: safeTz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Offset of a zone at an instant, in ms (positive east of UTC).
 * Reads the zone's wall clock for the instant via formatToParts and
 * diffs it against the instant's UTC clock. hourCycle h23 so midnight
 * formats as 00, never 24.
 */
function timezoneOffsetMs(timezone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUTC - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant a wall time on a calendar day is in a zone: start of
 * the tenant day (00:00:00.000) or end of it (23:59:59.999). The
 * offset is applied twice so a DST transition inside the day still
 * lands on the intended wall time. NEVER build these from UTC
 * midnight: for a zone west of UTC a UTC-midnight instant is the
 * PREVIOUS local day, and for a zone east of UTC an end-of-day
 * UTC-midnight instant is the NEXT local day.
 */
export function tenantDayStartInstant(dayKey: string, timezone: string): Date {
  const safeTz = isValidTimezone(timezone) ? timezone : process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
  const [y, m, d] = dayKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const first = new Date(guess - timezoneOffsetMs(safeTz, new Date(guess)));
  return new Date(guess - timezoneOffsetMs(safeTz, first));
}

export function tenantDayEndInstant(dayKey: string, timezone: string): Date {
  const safeTz = isValidTimezone(timezone) ? timezone : process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
  const [y, m, d] = dayKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const first = new Date(guess - timezoneOffsetMs(safeTz, new Date(guess)));
  return new Date(guess - timezoneOffsetMs(safeTz, first));
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalizes a coupon date bound for storage (TIMESTAMPTZ). A coupon's
 * start/end date means the WHOLE tenant day: a date-only string stores
 * as the tenant day's start (startDate) or end (endDate) in the tenant
 * zone. A full ISO timestamp passes through untouched -- an explicit
 * instant means what it says. Empty input stores NULL. Storing the
 * date-only string as `new Date(value)` (UTC midnight) is the NEW-I
 * defect: the coupon then dies at 02:00 Cairo on its last day, and a
 * day early for any zone west of UTC.
 */
export function couponBoundInstant(
  value: string | Date | null | undefined,
  timezone: string,
  isEnd: boolean,
): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const text = String(value).trim();
  if (!text) return null;
  if (!DATE_ONLY_RE.test(text)) return new Date(text);
  return isEnd ? tenantDayEndInstant(text, timezone) : tenantDayStartInstant(text, timezone);
}

/**
 * Whether a coupon is usable on a tenant day, keyed on calendar days
 * in the tenant zone -- never on instants. The stored bounds are
 * TIMESTAMPTZ instants; comparing them to `now` kills a coupon whose
 * end was stored as UTC midnight at 02:00 Cairo on its last day
 * (NEW-I), and a start stored the same way starts 2h late. A NULL
 * bound is open-ended. An unparseable stored value is treated as no
 * bound (the write path never stores one).
 */
export function couponDayState(
  startValue: Date | string | null | undefined,
  endValue: Date | string | null | undefined,
  todayKey: string,
  timezone: string,
): 'active' | 'not-started' | 'expired' {
  const dayOf = (value: Date | string | null | undefined): string => {
    if (value === null || value === undefined) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return todayTenantDate(timezone, d);
  };
  const startDay = dayOf(startValue);
  if (startDay && startDay > todayKey) return 'not-started';
  const endDay = dayOf(endValue);
  if (endDay && endDay < todayKey) return 'expired';
  return 'active';
}
