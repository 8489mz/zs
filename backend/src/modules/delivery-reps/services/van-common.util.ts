import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { formatDailyDocumentNumber, getDailyDocumentPrefix } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { AppError } from '../../../common/errors/app-error';

export const FLEET_VEHICLE_STATUSES = ['available', 'assigned', 'maintenance', 'retired'] as const;

/**
 * Matches the ascending-productId lock order the rest of the codebase uses (sales-write.service.ts,
 * reserveLocationStock) — applyStockDelta locks products then product_location_stock per item, so two
 * concurrent trips touching the same products in a different order can deadlock otherwise.
 */
export function sortItemsByProductId<T extends { productId: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(a.productId) - Number(b.productId));
}

export interface MoveVanStockParams {
  productId: number;
  delta: number;
  locationId: number;
  branchId?: number | null;
  tenantId: string;
  accountId: string;
  userId?: number | null;
  movementType: string;
  note: string;
  referenceType: string;
  referenceId: number;
  skipGlobalUpdate: boolean;
  unitCost?: number;
}

/**
 * Single entry point for every van stock movement.
 * Routing through applyStockDelta restores the canonical lock order
 * (products before product_location_stock) and keeps the perpetual inventory ledger consistent.
 */
export async function moveVanStock(
  trx: Kysely<Database>,
  params: MoveVanStockParams,
): Promise<{ scopeBefore: number; scopeAfter: number }> {
  const change = await applyStockDelta(trx, {
    productId: params.productId,
    delta: params.delta,
    branchId: params.branchId ?? null,
    locationId: params.locationId,
    tenantId: params.tenantId,
    accountId: params.accountId,
    skipGlobalUpdate: params.skipGlobalUpdate,
    errorCode: 'INSUFFICIENT_VAN_STOCK',
    errorMessage: 'رصيد غير كافٍ لتنفيذ حركة سيارة التوزيع',
  });

  await (trx as any)
    .insertInto('stock_movements')
    .values({
      tenant_id: params.tenantId,
      account_id: params.accountId,
      product_id: params.productId,
      movement_type: params.movementType,
      qty: params.delta,
      before_qty: change.scopeBefore,
      after_qty: change.scopeAfter,
      unit_cost: params.unitCost ?? 0,
      total_cost: Number((Math.abs(params.delta) * (params.unitCost ?? 0)).toFixed(4)),
      reason: params.movementType,
      note: params.note,
      reference_type: params.referenceType,
      reference_id: params.referenceId,
      branch_id: params.branchId ?? null,
      location_id: params.locationId,
      created_by: params.userId ?? null,
    })
    .execute();

  return { scopeBefore: change.scopeBefore, scopeAfter: change.scopeAfter };
}

/**
 * Ensures the delivery rep has an assigned mobile warehouse (stock_location) of type van_stock.
 */
export async function getOrCreateVanLocation(
  db: Kysely<Database>,
  repId: number,
  tenantId: string,
  accountId: string,
): Promise<{ id: number; name: string }> {
  const anyDb = db as any;
  const rep = await anyDb
    .selectFrom('delivery_representatives')
    .select(['id', 'name', 'van_location_id', 'vehicle_plate'])
    .where('id', '=', repId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();

  if (!rep) {
    throw new AppError('المندوب غير مسجل في النظام', 'REP_NOT_FOUND', 404);
  }

  if (rep.van_location_id) {
    const loc = await anyDb
      .selectFrom('stock_locations')
      .select(['id', 'name'])
      .where('id', '=', Number(rep.van_location_id))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (loc) {
      return { id: Number(loc.id), name: loc.name || `سيارة ${rep.name}` };
    }
  }

  // Get default branch
  const branch = await anyDb
    .selectFrom('branches')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('is_active', '=', true)
    .orderBy('id', 'asc')
    .executeTakeFirst();

  const branchId = branch?.id ? Number(branch.id) : null;
  const locationName = `سيارة مندوب: ${rep.name}${rep.vehicle_plate ? ` (${rep.vehicle_plate})` : ''}`;
  const locationCode = `VAN_${rep.id}`;

  const inserted = await anyDb
    .insertInto('stock_locations')
    .values({
      name: locationName,
      code: locationCode,
      branch_id: branchId,
      location_type: 'van_stock',
      is_active: true,
      tenant_id: tenantId,
      account_id: accountId,
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow();

  await anyDb
    .updateTable('delivery_representatives')
    .set({
      van_location_id: Number(inserted.id),
      is_van_rep: true,
      updated_at: sql`NOW()`,
    })
    .where('id', '=', repId)
    .where('tenant_id', '=', tenantId)
    .execute();

  return { id: Number(inserted.id), name: inserted.name || locationName };
}

export interface RepWarehouseScope {
  /** Operational warehouses the rep has actually loaded from (trip sources + requisition sources). */
  sourceWarehouseIds: Set<number>;
  /** The rep's most recent load source, for defaulting a driver read to his own scope. */
  mostRecentSourceWarehouseId: number | null;
  /** The rep's own van_stock location (his van stock, never a load source). */
  vanLocationId: number | null;
  /** True once any load history exists; false for a brand-new rep with no trips/requisitions yet. */
  hasLoadHistory: boolean;
}

/**
 * INV-REP-SCOPED-DRIVER-READS (M19/D10): the warehouses a driver may
 * read stock from. There is NO rep<->warehouse assignment anywhere in
 * the schema — submitLoadRequisition accepts any operational warehouse
 * as a load source — so the scope is EVIDENCE, not assignment: the
 * source warehouses of the rep's own trips and load requisitions, plus
 * his own van_stock location. A rep with no load history yet has no
 * evidence to restrict him to, so callers fall back to the full
 * operational list for him (bootstrap); without that fallback his very
 * first load requisition could name no source warehouse at all. Once
 * his first trip/requisition exists the scope closes to his own
 * sources automatically.
 */
export async function listRepUsableWarehouseScope(
  anyDb: any,
  tenantId: string,
  repId: number,
): Promise<RepWarehouseScope> {
  const rep = await anyDb
    .selectFrom('delivery_representatives')
    .select(['van_location_id'])
    .where('id', '=', repId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  const vanLocationId = rep?.van_location_id ? Number(rep.van_location_id) : null;

  const [tripSources, reqSources] = await Promise.all([
    anyDb
      .selectFrom('van_sales_trips')
      .select('source_warehouse_id')
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .where('source_warehouse_id', 'is not', null)
      .orderBy('id', 'desc')
      .execute(),
    anyDb
      .selectFrom('van_load_requisitions')
      .select('source_warehouse_id')
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .where('source_warehouse_id', 'is not', null)
      .orderBy('id', 'desc')
      .execute(),
  ]);
  const sourceWarehouseIds = new Set<number>();
  for (const row of [...(tripSources || []), ...(reqSources || [])]) {
    const id = Number((row as any).source_warehouse_id);
    if (Number.isInteger(id) && id > 0) sourceWarehouseIds.add(id);
  }
  const mostRecentRow = (tripSources || [])[0] || (reqSources || [])[0];
  const mostRecentSourceWarehouseId = mostRecentRow?.source_warehouse_id
    ? Number(mostRecentRow.source_warehouse_id)
    : null;
  return {
    sourceWarehouseIds,
    mostRecentSourceWarehouseId,
    vanLocationId,
    hasLoadHistory: sourceWarehouseIds.size > 0,
  };
}

/**
 * INV-REP-SCOPED-DRIVER-READS (M19/D10): refuses an explicitly
 * requested warehouse outside the rep's own scope with a specific
 * error naming the problem (existing 403 style). A rep with no load
 * history yet is not refused — see listRepUsableWarehouseScope.
 */
export function assertWarehouseInRepScope(scope: RepWarehouseScope, warehouseId: number): void {
  if (!scope.hasLoadHistory) return;
  if (scope.sourceWarehouseIds.has(warehouseId)) return;
  if (scope.vanLocationId !== null && scope.vanLocationId === warehouseId) return;
  throw new AppError(
    'هذا المستودع ليس من المستودعات التي تحمل منها، لا يمكنك الاطلاع على مخزونه',
    'REP_WAREHOUSE_NOT_USABLE',
    403,
  );
}

/**
 * Generates a collision-proof, tenant-scoped daily sequence number (0001, 0002, ...)
 * strictly adhering to the Universal Document Numbering Standard (PREFIX-YYMMDD-XXXX).
 * Automatically resets to 0001 every single day, and guards against legacy high IDs.
 *
 * INV-SEQUENCE-NUMBER-FAIL-CLOSED: the first argument MUST be a transaction
 * handle. A pg_advisory_xact_lock lives only for its transaction, so calling
 * with the pool handle (the `db` itself) would release the lock the moment
 * the SELECT returns and silently unserialize the MAX+1 read. Passing the
 * pool is therefore rejected outright, and a lock failure is rethrown as a
 * named error instead of silently degrading to an unguarded MAX+1: a
 * document is never numbered without its lock. Test doubles must support
 * the advisory-lock query; there is no silent fallback for mocks.
 */
export async function generateDailySequenceNumber(
  trxOrDb: any,
  db: Kysely<Database>,
  tableName: string,
  columnName: string,
  prefix: string,
  tenantId: string,
  date = new Date(),
): Promise<string> {
  if (trxOrDb === db) {
    throw new AppError(
      'Daily sequence numbering requires a transaction handle',
      'SEQUENCE_REQUIRES_TRANSACTION',
      500,
    );
  }

  // Resolve through the caller's handle (trxOrDb), NOT the pool db:
  // on PGlite's single connection a pool query inside an open
  // transaction waits forever; on Postgres it would still be a
  // second connection for a value the transaction could read itself.
  const businessTz = await getTenantTimezone(trxOrDb, tenantId);
  const dailyPrefix = getDailyDocumentPrefix(prefix, date, businessTz);

  // Advisory transaction lock to prevent concurrent races for this tenant + daily prefix.
  // Fail closed: any lock failure means the number is not issued.
  try {
    await trxOrDb.executeQuery(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'daily_seq_' + tenantId + '_' + dailyPrefix}))`.compile(db),
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Daily sequence lock failed; the document was not numbered',
      'SEQUENCE_LOCK_FAILED',
      500,
    );
  }

  let lastSeq = 0;
  if (tableName === 'customer_payments') {
    const res = await trxOrDb
      .selectFrom('customer_payments')
      .select(
        sql<number>`COALESCE(MAX(
          CASE WHEN note ~ ${'#' + dailyPrefix + '[0-9]{1,4}\\)'}
               THEN CAST(SUBSTRING(note FROM ${'#' + dailyPrefix + '([0-9]{1,4})\\)'}) AS INTEGER)
               ELSE 0 END
        ), 0)`.as('last_seq'),
      )
      .where('tenant_id', '=', tenantId)
      .where('note', 'like', `%#${dailyPrefix}%`)
      .executeTakeFirst();
    lastSeq = Number(res?.last_seq || 0);
  } else {
    const res = await trxOrDb
      .selectFrom(tableName)
      .select(
        sql<number>`COALESCE(MAX(
          CASE WHEN ${sql.ref(columnName)} ~ ${'^' + dailyPrefix + '[0-9]{1,4}$'}
               THEN CAST(SPLIT_PART(${sql.ref(columnName)}, '-', 3) AS INTEGER)
               ELSE 0 END
        ), 0)`.as('last_seq'),
      )
      .where('tenant_id', '=', tenantId)
      .where(sql.ref(columnName), 'like', `${dailyPrefix}%`)
      .executeTakeFirst();
    lastSeq = Number(res?.last_seq || 0);
  }

  const nextSeq = lastSeq + 1;
  return formatDailyDocumentNumber(prefix, nextSeq, date, 4, businessTz);
}

export async function getMonthlyOfficialHolidayDates(
  anyDb: any,
  tenantId: string,
  startOfMonth: Date,
  endOfMonth: Date,
): Promise<string[]> {
  try {
    const startStr = startOfMonth.toISOString().slice(0, 10);
    const endStr = endOfMonth.toISOString().slice(0, 10);
    const rows = await anyDb
      .selectFrom('hr_holidays')
      .select(['start_date', 'end_date'])
      .where('tenant_id', '=', tenantId)
      .where('end_date', '>=', startStr)
      .where('start_date', '<=', endStr)
      .execute();

    const datesSet = new Set<string>();
    for (const row of rows || []) {
      if (!row.start_date || !row.end_date) continue;
      const cur = new Date(row.start_date);
      const end = new Date(row.end_date);
      while (cur <= end) {
        const dStr = cur.toISOString().slice(0, 10);
        if (dStr >= startStr && dStr <= endStr) {
          datesSet.add(dStr);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }
    return Array.from(datesSet);
  } catch {
    return [];
  }
}

import {
  aggregateCustomerBalancesByRep,
  CustomerRepBalanceBreakdown,
  CustomerRepLedgerEntryInput,
} from '../rep-target.engine';
import { type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/**
 * Format customer code consistently as C-XXXX (e.g. C-0001, C-04185).
 * Never uses '#' and ensures minimum 4 digits.
 */
export function formatCustomerCode(id: number | string): string {
  const num = Number(id);
  if (isNaN(num) || num <= 0) return `C-${String(id).replace(/\D/g, '') || '0001'}`;
  return `C-${String(num).padStart(4, '0')}`;
}

export function normalizeCustomerCode(code: string | undefined | null, fallbackId: number | string): string {
  if (code && typeof code === 'string' && code.trim()) {
    const trimmed = code.trim().replace(/^#/, '');
    if (/^C-\d{4,}$/.test(trimmed)) {
      return trimmed;
    }
    const numMatch = trimmed.match(/\d+$/);
    if (numMatch) {
      return formatCustomerCode(numMatch[0]);
    }
  }
  return formatCustomerCode(fallbackId);
}

/**
 * Computes per-customer per-rep isolated balance breakdowns from `customer_ledger`
 * joined with `van_sales_trips`, `sales`, `van_field_returns`, and `delivery_representatives`.
 */
export async function getCustomerRepBalancesMap(
  anyDb: any,
  tenantId: string,
  options: {
    customerIds?: number[];
    customerTotalBalances?: Record<number, number>;
    // REQUIRED (INV-REP-COMMISSION-DIGITS): balances are money, so the
    // aggregation must round at the tenant's book digits, never at an
    // assumed 2 decimals. Callers derive it from the tenant's base
    // currency and reuse the same value for the isolated-balance
    // calls that read this map.
    moneyDigits: MoneyDigits;
  },
): Promise<Map<number, CustomerRepBalanceBreakdown>> {
  const customerIds = (options?.customerIds || []).filter((id) => Number.isInteger(Number(id)) && Number(id) > 0);
  if (options?.customerIds && customerIds.length === 0) {
    return aggregateCustomerBalancesByRep([], options?.customerTotalBalances, options.moneyDigits);
  }

  let query = anyDb
    .selectFrom('customer_ledger as cl')
    .leftJoin('van_sales_trips as vt', (join: any) =>
      join.onRef('vt.id', '=', 'cl.van_trip_id').onRef('vt.tenant_id', '=', 'cl.tenant_id'),
    )
    .leftJoin('sales as s', (join: any) =>
      join
        .onRef('s.id', '=', 'cl.reference_id')
        .onRef('s.tenant_id', '=', 'cl.tenant_id')
        .on('cl.reference_type', '=', 'sale'),
    )
    .leftJoin('van_field_returns as vfr', (join: any) =>
      join
        .onRef('vfr.id', '=', 'cl.reference_id')
        .onRef('vfr.tenant_id', '=', 'cl.tenant_id')
        .on('cl.reference_type', '=', 'van_field_return'),
    )
    .leftJoin(
      'delivery_representatives as dr',
      (join: any) =>
        join
          .on('dr.id', '=', sql`COALESCE(vt.rep_id, s.delivery_rep_id, vfr.rep_id)`)
          .onRef('dr.tenant_id', '=', 'cl.tenant_id'),
    )
    .select([
      'cl.customer_id',
      sql<number | null>`COALESCE(vt.rep_id, s.delivery_rep_id, vfr.rep_id)`.as('rep_id'),
      'dr.name as rep_name',
      sql<number>`COALESCE(SUM(CASE WHEN cl.amount > 0 THEN cl.amount ELSE 0 END), 0)`.as('total_debit'),
      sql<number>`COALESCE(SUM(CASE WHEN cl.amount < 0 THEN cl.amount ELSE 0 END), 0)`.as('total_credit_neg'),
    ])
    .where('cl.tenant_id', '=', tenantId)
    .groupBy([
      'cl.customer_id',
      sql`COALESCE(vt.rep_id, s.delivery_rep_id, vfr.rep_id)`,
      'dr.name',
    ]);

  if (customerIds.length > 0) {
    query = query.where('cl.customer_id', 'in', customerIds);
  }

  const rows = await query.execute();
  const entries: CustomerRepLedgerEntryInput[] = [];

  for (const r of rows || []) {
    const cid = Number(r.customer_id);
    const repId = r.rep_id !== null && r.rep_id !== undefined ? Number(r.rep_id) : null;
    const repName = r.rep_name ? String(r.rep_name) : null;
    const debit = Number(r.total_debit || 0);
    const creditNeg = Number(r.total_credit_neg || 0);
    if (debit !== 0) {
      entries.push({ customerId: cid, repId, repName, amount: debit });
    }
    if (creditNeg !== 0) {
      entries.push({ customerId: cid, repId, repName, amount: creditNeg });
    }
  }

  return aggregateCustomerBalancesByRep(entries, options?.customerTotalBalances, options.moneyDigits);
}

/**
 * Field-collection twin scope (INV-FIELD-COLLECTION-TWIN-SCOPE): the
 * columns that identify one field collection on customer_payments.
 * The pre-0268 rapid-fire backstop matched customer + amount only, so
 * a second legitimate collection — another trip, another rep, another
 * channel — inside 4 seconds was swallowed and reported as the first.
 * The scope narrows the match to the same trip, rep, and channel, and
 * carries the client transaction id in its own column (migration
 * 2040000000268) instead of only inside the free-text note tag.
 *
 * Channel mapping: the collection payload vocabulary
 * (cash/instapay/vodafone_cash/bank_transfer) is mapped onto the
 * customer_payments.payment_channel check constraint
 * (cash/bank/card/wallet/instapay, migration 0251). An omitted method
 * is cash, matching the collection posting's own default
 * (paymentMethod || 'cash').
 */
export type FieldCollectionChannel = 'cash' | 'bank' | 'wallet' | 'instapay';

export function resolveFieldCollectionChannel(
  paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer' | string,
): FieldCollectionChannel {
  if (paymentMethod === 'instapay') return 'instapay';
  if (paymentMethod === 'vodafone_cash') return 'wallet';
  if (paymentMethod === 'bank_transfer') return 'bank';
  return 'cash';
}

export function fieldCollectionPaymentScope(input: {
  tripId: number;
  repId: number;
  paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer' | string;
  clientTxId?: string;
}): {
  van_trip_id: number;
  rep_id: number;
  client_tx_id: string | null;
  payment_channel: FieldCollectionChannel;
} {
  return {
    van_trip_id: input.tripId,
    rep_id: input.repId,
    client_tx_id: input.clientTxId ?? null,
    payment_channel: resolveFieldCollectionChannel(input.paymentMethod),
  };
}


