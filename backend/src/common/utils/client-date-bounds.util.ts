import { todayTenantDate } from './tenant-timezone.util';

/**
 * Single-server-clock rule (P6, RC-5): a client-supplied business date is
 * never trusted beyond a parse. Every channel validates the supplied value
 * against the TENANT day before it is stored or posted — the same window
 * the system already uses for offline stamps ([now-7d, now+5min], P2),
 * expressed in whole tenant days.
 *
 * Day granularity is deliberate: these values are business DAYS (an
 * expense date, a receipt date, a work date), not instants. A datetime a
 * few minutes into tomorrow (client clock ahead near midnight) is
 * rejected at the day boundary — stricter than P2's instant rule at the
 * midnight edge, and safe: the client retries with today's date.
 *
 * UTC-calendar math on YYYY-MM-DD strings only (never host-local parts,
 * never UTC toISOString() after a local-midnight construction).
 */

/** Past bound for client-supplied business days — mirrors OFFLINE_CREATED_AT_MAX_AGE_MS (P2). */
export const CLIENT_BUSINESS_DATE_PAST_DAYS = 7;
/** Future horizon for dates that are future by nature (delivery, promise, follow-up). */
export const CLIENT_BUSINESS_DATE_FUTURE_DAYS = 365;
/** Longest sane installment schedule: first due at most 5 years after the plan starts. */
export const CLIENT_INSTALLMENT_SCHEDULE_YEARS = 5;

export type ClientDateCheckResult =
  { ok: true; date: Date; dayKey: string } | { ok: false; reason: 'INVALID' | 'TOO_OLD' | 'TOO_FAR_FUTURE' };

export type ClientDateWindow = {
  /** Day key the window is anchored on; defaults to the tenant's today. */
  anchorDayKey?: string;
  /** Earliest accepted day, as an offset in days from the anchor (negative = past). */
  minDayOffset: number;
  /** Latest accepted day, as an offset in days from the anchor. */
  maxDayOffset: number;
};

/** Parse a client-supplied date the way the services do today; null when unparseable or blank. */
export function parseClientDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * The tenant-day key of a client-supplied value. A strict YYYY-MM-DD
 * passes through unchanged (it IS a day); any other parseable value is
 * rendered in the tenant zone. Null when unparseable or not a real
 * calendar day (2026-02-30, 2026-13-01).
 */
export function dayKeyOfClientDate(value: unknown, tenantTimezone: string): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const strictDay = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (strictDay) {
    const probe = new Date(`${text}T00:00:00Z`);
    if (!Number.isFinite(probe.getTime())) return null;
    if (probe.toISOString().slice(0, 10) !== text) return null;
    return text;
  }
  const parsed = parseClientDate(text);
  if (!parsed) return null;
  return todayTenantDate(tenantTimezone, parsed);
}

/** Add whole days to a YYYY-MM-DD key (UTC-calendar math on the day string). */
export function addDaysToDayKey(dayKey: string, days: number): string | null {
  const probe = new Date(`${dayKey}T00:00:00Z`);
  if (!Number.isFinite(probe.getTime())) return null;
  if (probe.toISOString().slice(0, 10) !== dayKey) return null;
  return new Date(probe.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** First day (YYYY-MM-DD) of the month containing the given tenant day key. */
export function firstDayOfTenantMonth(todayKey: string): string {
  return `${todayKey.slice(0, 7)}-01`;
}

/**
 * Validate a client-supplied business date against the tenant day.
 * The window is [anchor + minDayOffset, anchor + maxDayOffset] in whole
 * tenant days; the anchor defaults to the tenant's today.
 */
export function checkClientBusinessDay(
  value: unknown,
  tenantTimezone: string,
  window: ClientDateWindow,
  now: Date = new Date(),
): ClientDateCheckResult {
  const dayKey = dayKeyOfClientDate(value, tenantTimezone);
  if (!dayKey) return { ok: false, reason: 'INVALID' };
  const anchorKey = window.anchorDayKey ?? todayTenantDate(tenantTimezone, now);
  const minKey = addDaysToDayKey(anchorKey, window.minDayOffset);
  const maxKey = addDaysToDayKey(anchorKey, window.maxDayOffset);
  if (!minKey || !maxKey) return { ok: false, reason: 'INVALID' };
  if (dayKey < minKey) return { ok: false, reason: 'TOO_OLD' };
  if (dayKey > maxKey) return { ok: false, reason: 'TOO_FAR_FUTURE' };
  return { ok: true, date: parseClientDate(value)!, dayKey };
}
