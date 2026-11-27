/*
 * Daily-split settlement engine (INV-VAN-DAILY-SPLIT-SETTLEMENT, P1).
 *
 * Pure functions, no DB, no Nest: the settle service and the red spec
 * import this file identically, so the spec proves the production
 * computation instead of a copy of it.
 *
 * MONEY RULES:
 * - A "business day" is ALWAYS a tenant-local calendar day
 *   (YYYY-MM-DD in the tenant timezone via todayTenantDate). NEVER
 *   derive it from UTC toISOString(): in UTC+2 that renders the
 *   previous day and a 23:30Z sale lands on the wrong day.
 * - Per-day due = cash sales + collections - cash refunds of that
 *   tenant day. Cash sales are the cash the rep physically holds:
 *   a cash sale contributes its total; a split sale contributes
 *   total - creditOwed (the credit leg lives on the customer, not in
 *   the rep's pocket); card / InstaPay / credit contribute 0.
 * - Allocations attribute the handed-over cash to the day's invoices
 *   (sales, in created order) then to the day's collections
 *   (customer_payments, in created order), each capped at the item's
 *   cash amount. A cash refund of the day reduces the day's due, so
 *   the last items may be partially allocated or skipped; an overage
 *   above cashSales + collections stays unallocated (the variance
 *   covers it) — allocations never invent an invoice.
 */

import { roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { todayTenantDate } from '../../common/utils/tenant-timezone.util';

export interface PerDayCashInput {
  businessDay: string;
  countedCash: number;
}

export interface TripCashRow {
  kind: 'sale' | 'collection' | 'refund';
  id: number;
  createdAt: Date | string;
  /** Cash the rep holds from this row (already the cash portion). */
  cashAmount: number;
}

export interface DayBucketItem {
  id: number;
  amount: number;
}

export interface DayBucket {
  businessDay: string;
  cashSales: number;
  collections: number;
  refunds: number;
  /** Cash the rep holds for this day: cashSales + collections - refunds. */
  due: number;
  sales: DayBucketItem[];
  payments: DayBucketItem[];
  refundItems: DayBucketItem[];
  saleIds: number[];
  paymentIds: number[];
  refundIds: number[];
  hasActivity: boolean;
}

export interface DayAllocation {
  businessDay: string;
  saleId: number | null;
  customerPaymentId: number | null;
  amount: number;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tenant-local calendar day (YYYY-MM-DD) of an instant. */
export function tenantDayKey(instant: Date | string, timezone: string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new Error('SETTLEMENT_PER_DAY_INVALID_INSTANT');
  return todayTenantDate(timezone, d);
}

export function isBusinessDayKey(value: unknown): boolean {
  if (typeof value !== 'string' || !DAY_KEY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validates + normalizes a client-supplied per-day counted-cash
 * breakdown. Throws a plain Error whose message IS the error code;
 * the service maps it to an AppError with an Arabic message.
 * An explicit empty array is a client bug (throw); `undefined`
 * (absent) means "no breakdown supplied" and is handled by the
 * caller, never here.
 */
export function normalizePerDayCash(input: unknown, bookDigits: MoneyDigits): PerDayCashInput[] {
  if (!Array.isArray(input)) throw new Error('SETTLEMENT_PER_DAY_NOT_AN_ARRAY');
  if (input.length === 0) throw new Error('SETTLEMENT_PER_DAY_EMPTY');
  const seen = new Set<string>();
  const out: PerDayCashInput[] = [];
  for (const row of input as Array<Record<string, unknown>>) {
    const businessDay = String(row?.businessDay || '').trim();
    if (!isBusinessDayKey(businessDay)) throw new Error('SETTLEMENT_PER_DAY_INVALID_DAY');
    if (seen.has(businessDay)) throw new Error('SETTLEMENT_PER_DAY_DUPLICATE_DAY');
    seen.add(businessDay);
    const counted = Number(row?.countedCash);
    if (!Number.isFinite(counted) || counted < 0) throw new Error('SETTLEMENT_PER_DAY_INVALID_AMOUNT');
    out.push({ businessDay, countedCash: roundMoney(counted, bookDigits) });
  }
  out.sort((a, b) => (a.businessDay < b.businessDay ? -1 : 1));
  return out;
}

/**
 * Parses the trip's stored submitted breakdown (JSONB: pg returns an
 * object, Kysely may hand back a string). Returns null when nothing
 * was submitted; throws on a stored value that no longer parses.
 */
export function parseSubmittedPerDayCash(value: unknown, bookDigits: MoneyDigits): PerDayCashInput[] | null {
  if (value === null || value === undefined || value === '') return null;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('SETTLEMENT_PER_DAY_INVALID_STORED');
    }
  }
  return normalizePerDayCash(parsed, bookDigits);
}

export function sumPerDayCash(days: PerDayCashInput[], bookDigits: MoneyDigits): number {
  return roundMoney(
    days.reduce((s, d) => s + Number(d.countedCash || 0), 0),
    bookDigits,
  );
}

/**
 * Cash the rep holds from one sale row. `creditOwed` is the sale's
 * credit leg (sum of its customer_ledger 'sale_credit' rows, 0 when
 * none): a split sale's cash is total - creditOwed, and a split sale
 * whose credit leg has no ledger row is treated as fully cash — the
 * credit leg is always written in the same transaction as the sale,
 * so a missing row means creditOwed was 0.
 */
export function cashPortionOfSale(
  sale: { paymentType?: string | null; paymentChannel?: string | null; total: number; creditOwed?: number },
  bookDigits: MoneyDigits,
): number {
  const total = roundMoney(Number(sale.total || 0), bookDigits);
  const channel = String(sale.paymentChannel || '')
    .trim()
    .toLowerCase();
  const type = String(sale.paymentType || '')
    .trim()
    .toLowerCase();
  if (channel === 'cash' || type === 'cash') return total;
  if (type === 'split' || channel === 'mixed') {
    return roundMoney(Math.max(0, total - Number(sale.creditOwed || 0)), bookDigits);
  }
  return 0;
}

/**
 * Buckets trip cash rows by tenant day. Rows must arrive pre-sorted
 * by (created_at, id) — the order inside a day is the allocation
 * order. Days come back sorted ascending.
 */
export function bucketTripCashByDay(rows: TripCashRow[], timezone: string, bookDigits: MoneyDigits): DayBucket[] {
  const byDay = new Map<string, DayBucket>();
  for (const row of rows) {
    const day = tenantDayKey(row.createdAt, timezone);
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = {
        businessDay: day,
        cashSales: 0,
        collections: 0,
        refunds: 0,
        due: 0,
        sales: [],
        payments: [],
        refundItems: [],
        saleIds: [],
        paymentIds: [],
        refundIds: [],
        hasActivity: false,
      };
      byDay.set(day, bucket);
    }
    const amount = roundMoney(Number(row.cashAmount || 0), bookDigits);
    if (row.kind === 'sale') {
      bucket.cashSales = roundMoney(bucket.cashSales + amount, bookDigits);
      bucket.sales.push({ id: Number(row.id), amount });
      bucket.saleIds.push(Number(row.id));
    } else if (row.kind === 'collection') {
      bucket.collections = roundMoney(bucket.collections + amount, bookDigits);
      bucket.payments.push({ id: Number(row.id), amount });
      bucket.paymentIds.push(Number(row.id));
    } else {
      bucket.refunds = roundMoney(bucket.refunds + amount, bookDigits);
      bucket.refundItems.push({ id: Number(row.id), amount });
      bucket.refundIds.push(Number(row.id));
    }
    bucket.hasActivity = true;
  }
  const out = [...byDay.values()].sort((a, b) => (a.businessDay < b.businessDay ? -1 : 1));
  for (const bucket of out) {
    bucket.due = roundMoney(bucket.cashSales + bucket.collections - bucket.refunds, bookDigits);
  }
  return out;
}

/**
 * Attributes one day's handed-over cash to the day's invoices then
 * collections, in created order, each capped at the item's cash
 * amount. Returns [] when nothing was remitted for the day. The
 * total allocated is min(remitted, cashSales + collections): a
 * shortfall stays a shortage (variance), an overage stays
 * unallocated — neither invents an invoice.
 */
export function allocateDayRemittance(
  bucket: DayBucket,
  remittedAmount: number,
  bookDigits: MoneyDigits,
): DayAllocation[] {
  const out: DayAllocation[] = [];
  let remaining = roundMoney(Number(remittedAmount || 0), bookDigits);
  if (remaining <= 0) return out;
  for (const item of bucket.sales) {
    if (remaining <= 0) break;
    const take = roundMoney(Math.min(remaining, Math.max(0, item.amount)), bookDigits);
    if (take > 0) {
      out.push({ businessDay: bucket.businessDay, saleId: item.id, customerPaymentId: null, amount: take });
      remaining = roundMoney(remaining - take, bookDigits);
    }
  }
  for (const item of bucket.payments) {
    if (remaining <= 0) break;
    const take = roundMoney(Math.min(remaining, Math.max(0, item.amount)), bookDigits);
    if (take > 0) {
      out.push({ businessDay: bucket.businessDay, saleId: null, customerPaymentId: item.id, amount: take });
      remaining = roundMoney(remaining - take, bookDigits);
    }
  }
  return out;
}
