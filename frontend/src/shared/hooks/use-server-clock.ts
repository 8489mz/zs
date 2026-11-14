/*
 * Shared server clock (clock P8, RC-7).
 *
 * The quick-shortcut anchor pattern, extracted for every screen whose
 * default "now" used to come from the client clock: the page's list
 * response already carries the server instant (`serverTime`, ISO) in the
 * tenant zone (`serverTimezone`). Anchor that epoch once, then derive the
 * current server time by adding `performance.now()` elapsed — the clock
 * keeps ticking without ever trusting the client OS clock, and a device
 * clock set hours (or a month) off cannot move a posted date.
 *
 * The pure helpers do the zone math and are spec-pinned; the hook owns
 * the anchor. Until the list query resolves (no anchor yet) the hook
 * falls back to the client clock — the dialogs only open after the page
 * loads, so in practice the anchor is always present; the fallback keeps
 * the UI usable if the query fails. The date inputs stay user-editable;
 * only the DEFAULT comes from the server.
 */
import { useEffect, useRef } from 'react';

export const SERVER_CLOCK_FALLBACK_TIMEZONE = 'Africa/Cairo';

function safeTimezone(timezone?: string): string {
  if (!timezone) return SERVER_CLOCK_FALLBACK_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch {
    return SERVER_CLOCK_FALLBACK_TIMEZONE;
  }
}

function zoneParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

/** YYYY-MM-DD day key of an instant in the tenant zone (mirrors the backend's todayTenantDate). */
export function serverDayKey(serverTime: string | Date | undefined | null, timezone?: string): string {
  if (!serverTime) return '';
  const instant = serverTime instanceof Date ? serverTime : new Date(serverTime);
  if (Number.isNaN(instant.getTime())) return '';
  try {
    const map = zoneParts(instant, safeTimezone(timezone));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return '';
  }
}

/** HH:mm of an instant in the tenant zone. */
export function serverTimeHHmm(serverTime: string | Date | undefined | null, timezone?: string): string {
  if (!serverTime) return '';
  const instant = serverTime instanceof Date ? serverTime : new Date(serverTime);
  if (Number.isNaN(instant.getTime())) return '';
  try {
    const map = zoneParts(instant, safeTimezone(timezone));
    const hh = String(Number(map.hour) % 24).padStart(2, '0');
    return `${hh}:${map.minute}`;
  } catch {
    return '';
  }
}

export interface ServerClock {
  /** The tenant zone in effect (server value, or the Africa/Cairo fallback). */
  timezone: string;
  /** Current server-derived instant (anchor + elapsed); client clock only until the anchor arrives. */
  now: () => Date;
  /** YYYY-MM-DD of now() in the tenant zone. */
  todayKey: () => string;
  /** HH:mm of now() in the tenant zone. */
  timeHHmm: () => string;
}

export function useServerClock(serverTime?: string, serverTimezone?: string): ServerClock {
  const timezone = serverTimezone || SERVER_CLOCK_FALLBACK_TIMEZONE;
  const anchorRef = useRef<{ serverEpochMs: number; perfStart: number } | null>(null);

  // Synchronize the server anchor whenever the list response resolves
  // (same pattern as quick-attendance-shortcut.tsx).
  useEffect(() => {
    if (!serverTime) return;
    const serverEpoch = new Date(serverTime).getTime();
    if (Number.isNaN(serverEpoch)) return;
    anchorRef.current = {
      serverEpochMs: serverEpoch,
      perfStart: typeof performance !== 'undefined' ? performance.now() : 0,
    };
  }, [serverTime]);

  const now = (): Date => {
    const anchor = anchorRef.current;
    if (!anchor) return new Date();
    const elapsed = typeof performance !== 'undefined' ? performance.now() - anchor.perfStart : 0;
    return new Date(anchor.serverEpochMs + elapsed);
  };

  return {
    timezone,
    now,
    todayKey: () => serverDayKey(now(), timezone),
    timeHHmm: () => serverTimeHHmm(now(), timezone),
  };
}
