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
export async function getTenantTimezone(
  db: Kysely<Database>,
  tenantId?: string | null,
): Promise<string> {
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
  const safeTz = isValidTimezone(timezone) ? timezone : (process.env.BUSINESS_TIMEZONE || 'Africa/Cairo');
  return new Intl.DateTimeFormat('en-CA', { timeZone: safeTz }).format(date);
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

  const safeTz = isValidTimezone(timezone) ? timezone : (process.env.BUSINESS_TIMEZONE || 'Africa/Cairo');
  return d.toLocaleTimeString(locale, {
    timeZone: safeTz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
