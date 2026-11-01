/**
 * Universal Document & Voucher Numbering Standard (دستور الترقيم الموحد للوثائق والأذونات)
 * Constitutional Standard: All document/voucher numbers must strictly embed the 6-digit YYMMDD date.
 * Example: JOB-260914-0001, RFQ-260914-0001, MR-260914-0001, CSH-260914-0001
 */

/**
 * The day embedded in a document number is the TENANT's business day
 * (INV-BUSINESS-DATE-TENANT-LOCAL), never the host machine's local day:
 * on a Portable machine in Cairo the host-local day runs 2-3 hours
 * ahead of UTC, so a host-local number disagreed with the
 * tenant-local period gates. Pass the tenant timezone (resolved via
 * getTenantTimezone) whenever the caller knows the tenant; callers
 * that cannot resolve one keep the old host-local behaviour and are
 * recorded as remaining work in the invariant -- they must NOT be
 * silently converted, because a wrong-but-consistent day is
 * debuggable while a guessed timezone is not.
 */
export function getDailyDocumentPrefix(prefix: string, date: Date = new Date(), timeZone?: string): string {
  const cleanPrefix = prefix.trim().toUpperCase();
  if (timeZone) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
    const [yyyy, mm, dd] = day.split('-');
    return `${cleanPrefix}-${yyyy.slice(-2)}${mm}${dd}-`;
  }
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${cleanPrefix}-${yy}${mm}${dd}-`;
}

export function formatDailyDocumentNumber(
  prefix: string,
  sequence: number,
  date: Date = new Date(),
  padding = 4,
  timeZone?: string,
): string {
  const dailyPrefix = getDailyDocumentPrefix(prefix, date, timeZone);
  const seq = String(sequence).padStart(padding, '0');
  return `${dailyPrefix}${seq}`;
}
