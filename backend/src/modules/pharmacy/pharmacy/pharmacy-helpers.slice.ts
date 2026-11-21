import { formatLocalCalendarDay } from '../../../common/utils/tenant-timezone.util';

/*
INV-PHARMACY-BATCH-FROZEN: batch identity helpers. An expiry is a
real calendar date (YYYY-MM-DD) or a real month (YYYY-MM, the form
the acceptance suite already creates with). The past check mirrors
the FEFO sale gate's boundary exactly (month form against the
current month, full date against the tenant-local today), so a batch the
gate would skip can never be (re-)activated as saleable here.
*/
export function pharmacyExpiryText(value: unknown): string | null {
  if (value == null) return null;
  // A stored batch expiry is a pg DATE (node-postgres local-midnight
  // Date): it keys from the host-local calendar parts. The UTC slice
  // rendered the previous day on any host east of UTC, so the frozen
  // check below compared the DTO day against yesterday's stored day
  // and rejected a legitimate edit with PHARMACY_BATCH_EXPIRY_FROZEN.
  if (value instanceof Date) return formatLocalCalendarDay(value);
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

export function isValidPharmacyExpiry(value: string): boolean {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return true;
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/.exec(value);
  if (!match) return false;
  const day = Number(match[3]);
  return day >= 1 && day <= new Date(Number(match[1]), Number(match[2]), 0).getDate();
}

export function isPastPharmacyExpiry(normalized: string, todayIso: string): boolean {
  return normalized.length === 7 ? normalized < todayIso.slice(0, 7) : normalized < todayIso;
}

export const PHARMACY_BATCH_STATUSES = ['active', 'expired', 'depleted'];
