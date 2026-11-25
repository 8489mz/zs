import { ReportRangeQueryDto } from '../dto/report-query.dto';
import { AppError } from '../../../common/errors/app-error';

export type Range = {
  from: string;
  to: string;
  branchId?: string;
  locationId?: string;
};

export type TrendPoint = {
  key: string;
  value: number;
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Canonical no-tenant fallback for the reports path (INV-SINGLE-SERVER-CLOCK-TENANT-TZ):
 * env BUSINESS_TIMEZONE, else Africa/Cairo — the same chain getTenantTimezone
 * uses. NEVER UTC: a UTC default made every report day the UTC day whenever
 * the server env was unset. Callers with a tenant MUST pass the tenant's
 * resolved timezone explicitly; this default only covers callers that have
 * no tenant context at all.
 */
export function getDefaultBusinessTimezone(): string {
  return normalizeTimezone(process.env.BUSINESS_TIMEZONE || 'Africa/Cairo');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function normalizeTimezone(value: string | null | undefined): string {
  const candidate = String(value || '').trim();
  if (!candidate) return 'Africa/Cairo';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    // Invalid zone: last resort of the canonical chain. A literal here
    // (never a call back into getDefaultBusinessTimezone) so an invalid
    // BUSINESS_TIMEZONE env value cannot recurse.
    return 'Africa/Cairo';
  }
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getZonedParts(value: Date, timezone: string): ZonedDateParts {
  // Normalize here — the single choke point for every zoned derivation
  // (dateKey, getBusinessDayBounds, buildLastNDays): an invalid explicit
  // zone falls back to the canonical env-or-Cairo default instead of
  // throwing RangeError, the same chain getTenantTimezone uses.
  const parts = getFormatter(normalizeTimezone(timezone)).formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get('year') || 0),
    month: Number(map.get('month') || 0),
    day: Number(map.get('day') || 0),
    hour: Number(map.get('hour') || 0),
    minute: Number(map.get('minute') || 0),
    second: Number(map.get('second') || 0),
  };
}

function getTimezoneOffsetMs(value: Date, timezone: string): number {
  const zoned = getZonedParts(value, timezone);
  const utcFromZoned = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return utcFromZoned - value.getTime();
}

function zonedDateTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const offset = getTimezoneOffsetMs(new Date(utcGuess), timezone);
  let corrected = utcGuess - offset;
  const nextOffset = getTimezoneOffsetMs(new Date(corrected), timezone);
  if (nextOffset !== offset) {
    corrected = utcGuess - nextOffset;
  }
  return new Date(corrected);
}

export function getBusinessDayBounds(value: Date | string = new Date(), timezone = getDefaultBusinessTimezone()): { start: Date; end: Date; key: string } {
  const source = value instanceof Date ? value : new Date(value);
  const zoned = getZonedParts(source, timezone);
  const start = zonedDateTimeToUtc(timezone, zoned.year, zoned.month, zoned.day, 0, 0, 0, 0);
  const nextDayStart = zonedDateTimeToUtc(timezone, zoned.year, zoned.month, zoned.day + 1, 0, 0, 0, 0);
  return {
    start,
    end: new Date(nextDayStart.getTime() - 1),
    key: `${zoned.year}-${pad2(zoned.month)}-${pad2(zoned.day)}`,
  };
}

export function parseRange(query: ReportRangeQueryDto, timezone = getDefaultBusinessTimezone()): Range {
  const today = getBusinessDayBounds(new Date(), timezone);
  const thirtyDaysAgo = new Date(today.start);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  return {
    from: query.from || thirtyDaysAgo.toISOString(),
    to: query.to || today.end.toISOString(),
    branchId: query.branchId ? String(query.branchId) : undefined,
    locationId: query.locationId ? String(query.locationId) : undefined,
  };
}

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * INV-VAN-SALES-LIST-DATE-FILTER: resolve an explicit from/to pair to
 * tenant-day bounds. A bare calendar date means the WHOLE tenant day
 * (from = tenant midnight, to = tenant 23:59:59.999); a full datetime
 * passes through verbatim. This is the fix for the parseRange trap:
 * parseRange passes a bare `to` through as midnight UTC and silently
 * drops the whole last day. Missing bounds stay undefined (the caller
 * supplies defaults); garbage or from-after-to is a 400, never a
 * silent full-range answer.
 */
export function resolveTenantDayRange(
  from: unknown,
  to: unknown,
  timezone = getDefaultBusinessTimezone(),
): { from?: Date; to?: Date } {
  const parseBound = (value: unknown, name: 'from' | 'to'): Date | undefined => {
    if (value == null) return undefined;
    const raw = String(value).trim();
    if (!raw) return undefined;
    if (BARE_DATE_RE.test(raw)) {
      // Noon UTC on the calendar day: getBusinessDayBounds derives the
      // tenant day from the zoned parts, and noon UTC lands on the same
      // calendar day for every zone in UTC-12..UTC+12 (midnight UTC
      // would shift the day for zones west of UTC).
      const [y, m, d] = raw.split('-').map(Number);
      const bounds = getBusinessDayBounds(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)), timezone);
      return name === 'from' ? bounds.start : bounds.end;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(
        name === 'from' ? 'تاريخ البداية غير صالح' : 'تاريخ النهاية غير صالح',
        'INVALID_DATE_RANGE',
        400,
      );
    }
    return parsed;
  };
  const fromDate = parseBound(from, 'from');
  const toDate = parseBound(to, 'to');
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new AppError('تاريخ البداية بعد تاريخ النهاية', 'INVALID_DATE_RANGE', 400);
  }
  return { from: fromDate, to: toDate };
}

export function dateKey(value: Date | string | null | undefined, timezone = getDefaultBusinessTimezone()): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const zoned = getZonedParts(date, timezone);
  return `${zoned.year}-${pad2(zoned.month)}-${pad2(zoned.day)}`;
}

export function getPagination(query: ReportRangeQueryDto, defaultSize = 25): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || defaultSize)));
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export interface ReportPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  nextCursor?: string | null;
  [key: string]: unknown;
}

export function buildPagination(page: number, pageSize: number, totalItems: number, nextCursor?: string | null): ReportPagination {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const rangeStart = totalItems ? ((safePage - 1) * pageSize) + 1 : 0;
  const rangeEnd = totalItems ? Math.min(totalItems, rangeStart + pageSize - 1) : 0;
  return {
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
    rangeStart,
    rangeEnd,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
}

export function paginate<T>(rows: T[], query: ReportRangeQueryDto, defaultSize = 25): { rows: T[]; pagination: Record<string, any> } {
  const { page, pageSize } = getPagination(query, defaultSize);
  const totalItems = rows.length;
  const pagination = buildPagination(page, pageSize, totalItems);
  const start = (pagination.page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    pagination,
  };
}

export function filterScope<T extends { branch_id?: number | null; location_id?: number | null; created_by?: number | null }>(rows: T[], query: ReportRangeQueryDto): T[] {
  return rows.filter((row) => {
    if (query.branchId && Number(row.branch_id || 0) !== Number(query.branchId)) return false;
    if (query.locationId && Number(row.location_id || 0) !== Number(query.locationId)) return false;
    if (query.userId && Number(row.created_by || 0) !== Number(query.userId)) return false;
    return true;
  });
}

export function buildLastNDays(days: number, timezone = getDefaultBusinessTimezone(), anchor = new Date()): string[] {
  const today = getBusinessDayBounds(anchor, timezone).start;
  return Array.from({ length: days }).map((_, index) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (days - index - 1));
    return dateKey(date, timezone);
  });
}

export function normalizeProduct(row: {
  id: number;
  name: string | null;
  category_id: number | null;
  supplier_id: number | null;
  retail_price: number | string | null;
  stock_qty: number | string | null;
  min_stock_qty: number | string | null;
}): Record<string, unknown> {
  return {
    id: String(row.id),
    name: row.name || '',
    barcode: '',
    categoryId: row.category_id ? String(row.category_id) : '',
    supplierId: row.supplier_id ? String(row.supplier_id) : '',
    retailPrice: Number(row.retail_price || 0),
    wholesalePrice: 0,
    stock: Number(row.stock_qty || 0),
    minStock: Number(row.min_stock_qty || 0),
    notes: '',
    units: [],
    offers: [],
    customerPrices: [],
  };
}
