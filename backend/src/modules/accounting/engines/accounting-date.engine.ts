import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';

/**
 * Calendar accounting dates are TENANT-LOCAL business days
 * (INV-BUSINESS-DATE-TENANT-LOCAL): the business day is the calendar
 * day in the tenant's configured timezone (settings key 'timezone',
 * default Africa/Cairo), never the UTC day and never the host
 * machine's local day. The previous comment claimed a different day
 * rule; that was the split this invariant closes -- a 00:30 Cairo sale carried a
 * next-day document number while the period gates checked the
 * previous UTC day. Report end bounds are exclusive.
 */
export function nextAccountingDay(value: string | Date): Date {
  const day = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new Error('Invalid accounting calendar date');
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

/**
 * Resolve an entry instant (or date string) to its business-day key
 * in the tenant's timezone. A string that is already a calendar day
 * (YYYY-MM-DD) passes through untouched -- it is a day, not an
 * instant, and reinterpreting it in a timezone would shift it. A
 * Date (or datetime string) is formatted in the tenant's zone, so the
 * same instant keys the same business day in the period gates, the
 * tax lock, and the document numbers. An unparseable value falls
 * back to the old UTC slice so the caller's own validation -- not
 * this helper -- decides the error.
 */
export async function resolveBusinessDateKey(
  db: Kysely<Database>,
  tenantId: string,
  entry: Date | string,
): Promise<string> {
  if (typeof entry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry)) return entry;
  const instant = entry instanceof Date ? entry : new Date(entry);
  if (!Number.isFinite(instant.getTime())) return String(entry).slice(0, 10);
  const timeZone = await getTenantTimezone(db, tenantId);
  return todayTenantDate(timeZone, instant);
}
