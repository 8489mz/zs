import { formatLocalCalendarDay } from '../../../common/utils/tenant-timezone.util';

export class ImportContainerHelpersSlice {
  // -------------------------------------------------------------
  // CONTAINER SECURITY DEPOSITS & RETURN
  // -------------------------------------------------------------
  // I6-E helpers: a 23505 is a lost race on a uniqueness index, never
  // a raw error to surface; and a DATE value (Date object from the
  // driver or 'yyyy-mm-dd' string) normalises to its calendar key.
  isUniqueViolation(err: any): boolean {
    return (
      err?.code === '23505' || String(err?.message || '').includes('duplicate key value violates unique constraint')
    );
  }

  dateKey(value: unknown): string {
    // The stored side is a pg DATE (node-postgres local-midnight
    // Date): it keys from the host-local calendar parts. The UTC
    // slice rendered the previous day on any host east of UTC, so a
    // same-payload retry compared yesterday's stored day against
    // the DTO day and failed closed with a spurious duplicate-key
    // conflict. The DTO side is a date-only string: its UTC-midnight
    // parse slices back to the written day, unchanged.
    if (value instanceof Date) return formatLocalCalendarDay(value);
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toISOString().slice(0, 10);
  }
}
