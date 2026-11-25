/**
 * DeliveryRepsReadsService — slice S2 of the delivery-reps split.
 * Pure move of 5 read/report methods from DeliveryRepsService (rep
 * order list, settlement list, rep KPIs, rep summary, lifetime
 * report). No behavior change: the bodies are byte-identical except
 * for 9 pre-existing trailing-whitespace lines normalized to clean
 * line ends (see the generation log); the facade keeps thin
 * delegates with the same names and signatures. Deps are db plus
 * the bound kernel predicate and the bound shared-helper methods
 * from the facade (S10 form). The lifetime report reuses the
 * van-settlement-split bucketing engine. Display rounding in the
 * KPI method travels verbatim. No logger.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { boundedPage } from '../../common/utils/bounded-page';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { discountedSaleSql } from '../sales/helpers/sales-discount-filter.helper';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { getBusinessDayBounds } from '../reports/helpers/reports-range.helper';
// INV-VAN-PROFIT-REP-REPORTING: the lifetime per-day due reuses P1's
// bucketing engine on rep-wide rows (same cash-portion rule, same
// day buckets — the only difference from computeTripDayBuckets is
// the row source: all the rep's trips instead of one).
import { bucketTripCashByDay, cashPortionOfSale, type DayBucket } from './van-settlement-split.engine';

export interface DeliveryRepsReadsDeps {
  db: Kysely<Database>;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // bodies stay byte-identical).
  tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;
  // Bound cross-slice deps (S6, S10 form): the facade own private
  // delegates — S6 is generated later; the merge owns the binding.
  getDeliveryFeeMode: (trx: Kysely<Database>, actor: AuthContext) => Promise<'freelance_courier' | 'store_fleet'>;
  repOrderCashDue: (
    order: {
      id: number;
      delivery_fee_mode: string | null;
      collection_status?: string | null;
      paid_amount?: number | string | null;
    },
    defaultMode: 'freelance_courier' | 'store_fleet',
    moneyDigits: MoneyDigits,
    actor: AuthContext,
  ) => Promise<number>;
}

@Injectable()
export class DeliveryRepsReadsService {
  private readonly db: Kysely<Database>;
  private readonly tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;
  private readonly getDeliveryFeeMode: (
    trx: Kysely<Database>,
    actor: AuthContext,
  ) => Promise<'freelance_courier' | 'store_fleet'>;
  private readonly repOrderCashDue: (
    order: {
      id: number;
      delivery_fee_mode: string | null;
      collection_status?: string | null;
      paid_amount?: number | string | null;
    },
    defaultMode: 'freelance_courier' | 'store_fleet',
    moneyDigits: MoneyDigits,
    actor: AuthContext,
  ) => Promise<number>;

  constructor(deps: DeliveryRepsReadsDeps) {
    this.db = deps.db;
    this.tenantPredicate = deps.tenantPredicate;
    this.getDeliveryFeeMode = deps.getDeliveryFeeMode;
    this.repOrderCashDue = deps.repOrderCashDue;
  }

  async listOrders(
    repId: number,
    actor: AuthContext,
    filters?: {
      dateFrom?: string;
      dateTo?: string;
      status?: string;
      discountedOnly?: boolean;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(actor);
    const { page, pageSize, offset } = boundedPage(filters?.page, filters?.pageSize);
    let query = this.db
      .selectFrom('sales')
      .leftJoin('customers', (join) =>
        join.onRef('customers.id', '=', 'sales.customer_id').onRef('customers.tenant_id', '=', 'sales.tenant_id'),
      )
      .leftJoin('users as settled_user', (join) =>
        join.onRef('settled_user.id', '=', 'sales.settled_by').onRef('settled_user.tenant_id', '=', 'sales.tenant_id'),
      )
      .leftJoin('users as created_user', (join) =>
        join.onRef('created_user.id', '=', 'sales.created_by').onRef('created_user.tenant_id', '=', 'sales.tenant_id'),
      )
      .select([
        'sales.id',
        'sales.doc_no as docNo',
        'sales.total',
        'sales.delivery_fee as deliveryFee',
        'sales.delivery_fee_mode as deliveryFeeMode',
        'customers.name as customerName',
        'customers.phone as customerPhone',
        'customers.address as customerAddress',
        'sales.order_type as orderType',
        'sales.delivery_rep_id as deliveryRepId',
        'sales.delivery_status as deliveryStatus',
        'sales.collection_status as collectionStatus',
        sql<string | null>`sales.delivery_signature`.as('deliverySignature'),
        sql<string | null>`sales.delivery_photo_url`.as('deliveryPhotoUrl'),
        sql<number | null>`sales.delivery_gps_lat`.as('deliveryGpsLat'),
        sql<number | null>`sales.delivery_gps_lng`.as('deliveryGpsLng'),
        sql<string | null>`sales.delivery_notes`.as('deliveryNotes'),
        'sales.settled_at as settledAt',
        'sales.created_at as createdAt',
        'settled_user.username as settledByName',
        'created_user.username as createdByName',
      ])
      .where('sales.delivery_rep_id', '=', repId)
      .where('sales.tenant_id', '=', tenantId);

    if (filters?.status) {
      if (filters.status === 'unsettled') {
        query = query.where((eb) =>
          eb.or([eb('sales.delivery_status', '!=', 'settled'), eb('sales.delivery_status', 'is', null)]),
        );
      } else {
        query = query.where('sales.delivery_status', '=', filters.status as any);
      }
    }

    if (filters?.dateFrom) {
      query = query.where('sales.created_at', '>=', new Date(filters.dateFrom));
    }

    if (filters?.dateTo) {
      const dateTo = new Date(filters.dateTo);
      dateTo.setHours(23, 59, 59, 999);
      query = query.where('sales.created_at', '<=', dateTo);
    }

    // INV-VAN-PROFIT-REP-REPORTING: discounted-invoices-only — the
    // shared predicate (invoice discount OR any line discount).
    if (filters?.discountedOnly) {
      query = query.where(discountedSaleSql('sales'));
    }

    const orders = await query
      .orderBy('sales.created_at', 'desc')
      .orderBy('sales.id', 'desc')
      .limit(pageSize + 1)
      .offset(offset)
      .execute();
    // INV-SF-REP-CUSTODY-NET-RETURNS (D-SF-10): each row carries
    // its remaining cash due from deliverySettlementBasis, so the
    // row and the badge agree with the settle gate. `total` stays
    // the invoice total; `remainingAmount` is what the rep still
    // owes for this order (0 for a fully-returned order). Only
    // the page rows are priced (pageSize <= 200), never the
    // lookahead row.
    const pageRows = orders.slice(0, pageSize);
    const defaultMode = await this.getDeliveryFeeMode(this.db, actor);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const ordersWithRemaining = [];
    for (const row of pageRows) {
      const remainingAmount = await this.repOrderCashDue(
        { id: Number(row.id), delivery_fee_mode: row.deliveryFeeMode ?? null },
        defaultMode,
        moneyDigits,
        actor,
      );
      ordersWithRemaining.push({ ...row, remainingAmount });
    }
    return { ok: true, orders: ordersWithRemaining, pagination: { page, pageSize, hasMore: orders.length > pageSize } };
  }

  async listSettlements(
    repId: number,
    actor: AuthContext,
    filters?: { dateFrom?: string; dateTo?: string; page?: number; pageSize?: number },
  ): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(actor);
    const { page, pageSize, offset } = boundedPage(filters?.page, filters?.pageSize);
    let query = this.db
      .selectFrom('sales as s')
      .leftJoin('users as u', (join) =>
        join.onRef('u.id', '=', 's.settled_by').onRef('u.tenant_id', '=', 's.tenant_id'),
      )
      .leftJoin('users as cu', (join) =>
        join.onRef('cu.id', '=', 's.created_by').onRef('cu.tenant_id', '=', 's.tenant_id'),
      )
      .select([
        's.id',
        's.doc_no as docNo',
        's.total as amount',
        's.delivery_fee as deliveryFee',
        's.collection_status as collectionStatus',
        's.created_at as orderDate',
        's.settled_at as createdAt',
        'u.username as settledByName',
        'cu.username as createdByName',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('s.delivery_rep_id', '=', repId)
      .where('s.delivery_status', '=', 'settled');

    if (filters?.dateFrom) {
      query = query.where('s.settled_at', '>=', new Date(filters.dateFrom));
    }

    if (filters?.dateTo) {
      const dateTo = new Date(filters.dateTo);
      dateTo.setHours(23, 59, 59, 999);
      query = query.where('s.settled_at', '<=', dateTo);
    }

    const settlements = await query
      .orderBy('s.settled_at', 'desc')
      .orderBy('s.id', 'desc')
      .limit(pageSize + 1)
      .offset(offset)
      .execute();
    return {
      ok: true,
      settlements: settlements.slice(0, pageSize),
      pagination: { page, pageSize, hasMore: settlements.length > pageSize },
    };
  }

  async getRepKPIs(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(actor);

    const totals = await this.db
      .selectFrom('sales')
      .select([
        sql<number>`count(*)::int`.as('total_orders'),
        sql<number>`count(*) filter (where status = 'returned')::int`.as('returned_orders'),
        sql<number>`count(*) filter (where status is distinct from 'returned' and delivery_status = 'settled')::int`.as(
          'successful_orders',
        ),
        sql<number>`coalesce(avg(extract(epoch from (settled_at - created_at)) * 1000)
          filter (where status is distinct from 'returned' and delivery_status = 'settled' and settled_at > created_at), 0)`.as(
          'average_delay_ms',
        ),
      ])
      .where('delivery_rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    const totalOrders = Number(totals.total_orders);
    const returnedOrders = Number(totals.returned_orders);
    const successfulOrders = Number(totals.successful_orders);
    const averageDelayMs = Number(totals.average_delay_ms);
    const averageDelayHours = averageDelayMs / 3_600_000;
    const averageDelayMins = Math.round(averageDelayMs / 60_000);
    const successRate = totalOrders > 0 ? (successfulOrders / totalOrders) * 100 : 0;

    // Rating logic (Starts at 5, deducts based on issues)
    let rating = 5.0;

    // Deduct 0.5 for every 10% returns
    const returnRate = totalOrders > 0 ? (returnedOrders / totalOrders) * 100 : 0;
    rating -= (returnRate / 10) * 0.5;

    // Deduct for delay: 0.1 for every hour of average delay above 2 hours
    if (averageDelayHours > 2) {
      rating -= (averageDelayHours - 2) * 0.1;
    }

    // Ensure rating is between 0 and 5
    rating = Math.max(0, Math.min(5, Number(rating.toFixed(1))));

    return {
      ok: true,
      kpis: {
        totalOrders,
        successfulOrders,
        returnedOrders,
        successRate: Number(successRate.toFixed(1)),
        averageDelayHours: Number(averageDelayHours.toFixed(1)),
        averageDelayMins,
        rating,
      },
    };
  }

  async getRepSummary(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const rep = await this.db
      .selectFrom('delivery_representatives')
      .select(['id', 'name'])
      .where('id', '=', repId)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!rep) throw new AppError('Delivery representative not found', 'NOT_FOUND', 404);

    const defaultMode = await this.getDeliveryFeeMode(this.db, actor);
    const { tenantId } = requireTenantScope(actor);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    // INV-SF-REP-CUSTODY-NET-RETURNS (D-SF-10): the summary is
    // computed from deliverySettlementBasis per order — the same
    // single source of truth the settle gates and the posting
    // use — not from gross sales.total. A fully-returned
    // unsettled order contributes 0 (its receivable is already
    // zero via the return journal), so the phantom clears without
    // any status flip; a settled-then-returned order likewise
    // stops counting the returned share as collected. Per-order
    // basis calls match the settleAllOrders precedent (<= 200
    // orders); re-implementing the basis in SQL would create the
    // second computation this fix exists to delete.
    const orders = await this.db
      .selectFrom('sales')
      .select(['id', 'delivery_fee_mode', 'delivery_status', 'collection_status', 'paid_amount'])
      .where('delivery_rep_id', '=', repId)
      .where(this.tenantPredicate(actor))
      .execute();
    let collectedAmount = 0;
    let pendingAmount = 0;
    for (const order of orders) {
      const cashDue = await this.repOrderCashDue(
        {
          id: Number(order.id),
          delivery_fee_mode: order.delivery_fee_mode ?? null,
          collection_status: order.collection_status ?? null,
          paid_amount: order.paid_amount ?? null,
        },
        defaultMode,
        moneyDigits,
        actor,
      );
      if (order.delivery_status === 'settled') {
        collectedAmount += cashDue;
      } else if (order.collection_status === 'cod' || order.collection_status === 'prepaid_by_rep') {
        // INV-REP-PREPAID-SHIFT-TREASURY (M6/A7): an unsettled
        // rep-prepaid order is cash the rep still holds, exactly
        // like an unsettled COD order — it belongs in pending, or
        // the badge says the rep owes nothing while holding the
        // full amount.
        pendingAmount += cashDue;
      }
    }

    return {
      ok: true,
      summary: {
        totalOrders: orders.length,
        collectedAmount: roundMoney(collectedAmount, moneyDigits),
        pendingAmount: roundMoney(pendingAmount, moneyDigits),
      },
    };
  }

  /**
   * INV-VAN-PROFIT-REP-REPORTING: unified rep lifetime report — one
   * response instead of five separate calls. Lifetime sales +
   * collections + discounts + targets history + per-day due (P1
   * buckets, rep-wide) + today's sales + the current target.
   *
   * Attribution is by delivery_rep_id everywhere, never by the login
   * user who created the sale: a supervisor-created van sale belongs
   * to its rep. Sales aggregates count POSTED sales only (drafts are
   * not sales); the per-day due mirrors P1's computeTripDayBuckets
   * exactly (all sales on the rep's trips regardless of status,
   * cash refunds, collections) so the buckets agree with
   * getTripDueByDay summed over the rep's trips. Lifetime returns
   * count APPROVED returns only — a pending return has not happened
   * yet. "Today" is the tenant-local business day
   * (INV-BUSINESS-DATE-TENANT-LOCAL), not the UTC day.
   */
  async getRepLifetimeReport(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(actor);
    const rep = await this.db
      .selectFrom('delivery_representatives')
      .select(['id', 'name'])
      .where('id', '=', repId)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!rep) throw new AppError('Delivery representative not found', 'NOT_FOUND', 404);

    const timezone = await getTenantTimezone(this.db, tenantId);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const money = (v: unknown): number => roundMoney(Number(v || 0), bookDigits);
    const todayBounds = getBusinessDayBounds(new Date(), timezone);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const salesBase = () =>
      this.db
        .selectFrom('sales')
        .where('delivery_rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'posted');

    const [lifetimeRow, todayRow, mtdRow, discountedRow] = await Promise.all([
      salesBase()
        .select([
          sql<number>`count(*)::int`.as('sales_count'),
          sql<number>`coalesce(sum(total), 0)`.as('sales_total'),
          sql<number>`coalesce(sum(discount), 0)`.as('invoice_discounts_total'),
          sql<number>`coalesce(sum(tax_amount), 0)`.as('tax_total'),
          sql<number>`coalesce(sum(paid_amount), 0)`.as('paid_total'),
        ])
        .executeTakeFirst(),
      salesBase()
        .select([sql<number>`count(*)::int`.as('sales_count'), sql<number>`coalesce(sum(total), 0)`.as('sales_total')])
        .where('created_at', '>=', todayBounds.start)
        .where('created_at', '<=', todayBounds.end)
        .executeTakeFirst(),
      salesBase()
        .select([sql<number>`coalesce(sum(total), 0)`.as('sales_total')])
        .where('created_at', '>=', monthStart)
        .where('created_at', '<=', monthEnd)
        .executeTakeFirst(),
      salesBase()
        .select([
          sql<number>`count(*)::int`.as('discounted_count'),
          sql<number>`coalesce(sum(total), 0)`.as('discounted_total'),
        ])
        .where(discountedSaleSql('sales'))
        .executeTakeFirst(),
    ]);

    const lineDiscountsRow = await this.db
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', (j) => j.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id'))
      .select([sql<number>`coalesce(sum(si.line_discount), 0)`.as('line_discounts_total')])
      .where('s.delivery_rep_id', '=', repId)
      .where('s.tenant_id', '=', tenantId)
      .where('s.status', '=', 'posted')
      .executeTakeFirst();

    const collectionsBase = () =>
      this.db.selectFrom('customer_payments').where('rep_id', '=', repId).where('tenant_id', '=', tenantId);
    const [collectionsRow, todayCollectionsRow, mtdCollectionsRow] = await Promise.all([
      collectionsBase()
        .select([
          sql<number>`count(*)::int`.as('collections_count'),
          sql<number>`coalesce(sum(amount), 0)`.as('collections_total'),
        ])
        .executeTakeFirst(),
      collectionsBase()
        .select([sql<number>`coalesce(sum(amount), 0)`.as('collections_total')])
        .where('created_at', '>=', todayBounds.start)
        .where('created_at', '<=', todayBounds.end)
        .executeTakeFirst(),
      collectionsBase()
        .select([sql<number>`coalesce(sum(amount), 0)`.as('collections_total')])
        .where('created_at', '>=', monthStart)
        .where('created_at', '<=', monthEnd)
        .executeTakeFirst(),
    ]);

    const returnsBase = () =>
      this.db
        .selectFrom('van_field_returns')
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'approved');
    const [returnsRow, todayReturnsRow] = await Promise.all([
      returnsBase()
        .select([
          sql<number>`count(*)::int`.as('returns_count'),
          sql<number>`coalesce(sum(total_amount), 0)`.as('returns_total'),
        ])
        .executeTakeFirst(),
      returnsBase()
        .select([sql<number>`coalesce(sum(total_amount), 0)`.as('returns_total')])
        .where('created_at', '>=', todayBounds.start)
        .where('created_at', '<=', todayBounds.end)
        .executeTakeFirst(),
    ]);

    const [currentTargetRow, targetsHistory] = await Promise.all([
      this.db
        .selectFrom('delivery_rep_targets')
        .select(['period_month', 'target_amount', 'collection_target', 'visits_target'])
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .where('period_month', '=', monthKey)
        .executeTakeFirst(),
      this.db
        .selectFrom('delivery_rep_targets')
        .select(['period_month', 'target_amount', 'collection_target', 'visits_target'])
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .orderBy('period_month', 'desc')
        .limit(24)
        .execute(),
    ]);

    // Per-day due, rep-wide: the same three row sets P1's
    // computeTripDayBuckets reads per trip, bucketed by the same
    // engine — so the sum over days equals the sum of
    // getTripDueByDay over the rep's trips.
    const dueSales = await this.db
      .selectFrom('sales')
      .select(['id', 'created_at', 'total', 'payment_type', 'payment_channel'])
      .where('delivery_rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const splitIds = (dueSales as Array<Record<string, unknown>>)
      .filter(
        (s) =>
          String(s.payment_type || '').toLowerCase() === 'split' ||
          String(s.payment_channel || '').toLowerCase() === 'mixed',
      )
      .map((s) => Number(s.id));
    const creditOwedBySale = new Map<number, number>();
    if (splitIds.length > 0) {
      const ledgerRows = await this.db
        .selectFrom('customer_ledger')
        .select(['reference_id', sql<number>`cast(coalesce(sum(amount), 0) as numeric)`.as('creditOwed')])
        .where('tenant_id', '=', tenantId)
        .where('reference_type', '=', 'sale')
        .where('entry_type', '=', 'sale_credit')
        .where('reference_id', 'in', splitIds)
        .groupBy('reference_id')
        .execute();
      for (const r of ledgerRows as Array<{ reference_id: unknown; creditOwed: unknown }>) {
        creditOwedBySale.set(Number(r.reference_id), Number(r.creditOwed || 0));
      }
    }
    const [duePayments, dueRefunds] = await Promise.all([
      this.db
        .selectFrom('customer_payments')
        .select(['id', 'created_at', 'amount'])
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .execute(),
      this.db
        .selectFrom('van_field_returns')
        .select(['id', 'created_at', 'total_amount'])
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .where('refund_method', '=', 'cash')
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .execute(),
    ]);
    const dueRows: Array<{
      kind: 'sale' | 'collection' | 'refund';
      id: number;
      createdAt: Date | string;
      cashAmount: number;
    }> = [];
    for (const s of dueSales as Array<Record<string, unknown>>) {
      dueRows.push({
        kind: 'sale',
        id: Number(s.id),
        createdAt: s.created_at as Date | string,
        cashAmount: cashPortionOfSale(
          {
            paymentType: String(s.payment_type || ''),
            paymentChannel: String(s.payment_channel || ''),
            total: Number(s.total || 0),
            creditOwed: creditOwedBySale.get(Number(s.id)) || 0,
          },
          bookDigits,
        ),
      });
    }
    for (const p of duePayments as Array<Record<string, unknown>>) {
      dueRows.push({
        kind: 'collection',
        id: Number(p.id),
        createdAt: p.created_at as Date | string,
        cashAmount: Number(p.amount || 0),
      });
    }
    for (const r of dueRefunds as Array<Record<string, unknown>>) {
      dueRows.push({
        kind: 'refund',
        id: Number(r.id),
        createdAt: r.created_at as Date | string,
        cashAmount: Number(r.total_amount || 0),
      });
    }
    dueRows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id);
    const dueByDay: DayBucket[] = bucketTripCashByDay(dueRows, timezone, bookDigits);

    const invoiceDiscountsTotal = money((lifetimeRow as any)?.invoice_discounts_total);
    const lineDiscountsTotal = money((lineDiscountsRow as any)?.line_discounts_total);
    const actualSalesMtd = money((mtdRow as any)?.sales_total);
    const actualCollectionsMtd = money((mtdCollectionsRow as any)?.collections_total);

    return {
      ok: true,
      rep: { id: rep.id, name: rep.name },
      lifetime: {
        salesCount: Number((lifetimeRow as any)?.sales_count || 0),
        salesTotal: money((lifetimeRow as any)?.sales_total),
        invoiceDiscountsTotal,
        lineDiscountsTotal,
        discountsTotal: roundMoney(invoiceDiscountsTotal + lineDiscountsTotal, bookDigits),
        taxTotal: money((lifetimeRow as any)?.tax_total),
        paidTotal: money((lifetimeRow as any)?.paid_total),
        collectionsCount: Number((collectionsRow as any)?.collections_count || 0),
        collectionsTotal: money((collectionsRow as any)?.collections_total),
        returnsCount: Number((returnsRow as any)?.returns_count || 0),
        returnsTotal: money((returnsRow as any)?.returns_total),
        discountedInvoicesCount: Number((discountedRow as any)?.discounted_count || 0),
        discountedInvoicesTotal: money((discountedRow as any)?.discounted_total),
      },
      today: {
        businessDay: todayBounds.key,
        salesCount: Number((todayRow as any)?.sales_count || 0),
        salesTotal: money((todayRow as any)?.sales_total),
        collectionsTotal: money((todayCollectionsRow as any)?.collections_total),
        returnsTotal: money((todayReturnsRow as any)?.returns_total),
      },
      currentTarget: currentTargetRow
        ? {
            periodMonth: (currentTargetRow as any).period_month,
            targetAmount: money((currentTargetRow as any).target_amount),
            collectionTarget:
              (currentTargetRow as any).collection_target == null
                ? null
                : money((currentTargetRow as any).collection_target),
            visitsTarget:
              (currentTargetRow as any).visits_target == null ? null : Number((currentTargetRow as any).visits_target),
            actualSalesMtd,
            actualCollectionsMtd,
          }
        : null,
      targetsHistory: (targetsHistory as Array<Record<string, unknown>>).map((t) => ({
        periodMonth: t.period_month,
        targetAmount: money(t.target_amount),
        collectionTarget: t.collection_target == null ? null : money(t.collection_target),
        visitsTarget: t.visits_target == null ? null : Number(t.visits_target),
      })),
      dueByDay,
      totalDue: roundMoney(
        dueByDay.reduce((s, d) => s + d.due, 0),
        bookDigits,
      ),
    };
  }
}
