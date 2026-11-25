import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { buildExpectedCashBreakdown } from './helpers/cash-drawer.helper';
import {
  computeShiftCustomerCollectionsByChannel,
  type ShiftCustomerCollectionsByChannel,
} from './helpers/shift-customer-collections.helper';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { type TenantScope } from '../../core/auth/utils/tenant-boundary';
import { Database } from '../../database/database.types';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import {
  type ShiftRow,
  type ShiftServiceBreakdown,
  type ShiftSalesBreakdown,
  type ShiftSaleReturnTotals,
} from './cash-drawer.types';

/**
 * CashDrawerComputeService — slice S2 of the cash-drawer split.
 * Pure move of the read-only expected-cash computation helpers from
 * the drawer service. No behavior change: the bodies are
 * byte-identical except for the forced visibility change below; the
 * facade keeps thin private delegates with the same names and
 * signatures. This slice reaches the kernel helpers only through
 * bound deps — it never imports another slice service.
 * The ten delegated helpers are public here (private in the
 * facade) — the facade, a different class, cannot call a private
 * slice method; the facade delegates stay private, so the facade
 * public surface is unchanged. One helper stays private here:
 * it is called only from inside this slice, so it needs no delegate.
 */

export interface CashDrawerComputeDeps {
  db: Kysely<Database>;
  // Bound kernel helpers (stay in the facade; passed bound so the moved
  // bodies stay byte-identical).
  scope: (auth: AuthContext) => TenantScope;
  toBookMoney: (value: unknown, digits: MoneyDigits) => number;
}

@Injectable()
export class CashDrawerComputeService {
  private readonly db: Kysely<Database>;
  private readonly scope: (auth: AuthContext) => TenantScope;
  private readonly toBookMoney: (value: unknown, digits: MoneyDigits) => number;

  constructor(deps: CashDrawerComputeDeps) {
    this.db = deps.db;
    this.scope = deps.scope;
    this.toBookMoney = deps.toBookMoney;
  }

  async computeShiftCashDrawerMovements(
    shiftId: number,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<{
    cashInTotal: number;
    deliveryCashInTotal: number;
    manualCashInTotal: number;
    cashOutTotal: number;
    netMovementTotal: number;
  }> {
    const scope = this.scope(auth);
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{
      cash_in_total?: number | string | null;
      delivery_cash_in_total?: number | string | null;
      manual_cash_in_total?: number | string | null;
      cash_out_total?: number | string | null;
      net_total?: number | string | null;
    }>`
      select coalesce(sum(case when tt.amount > 0 then tt.amount else 0 end), 0) as cash_in_total,
             coalesce(sum(case when tt.amount > 0 and (tt.note like '%دليفري%' or tt.note like '%مندوب%') then tt.amount else 0 end), 0) as delivery_cash_in_total,
             coalesce(sum(case when tt.amount > 0 and not (tt.note like '%دليفري%' or tt.note like '%مندوب%') then tt.amount else 0 end), 0) as manual_cash_in_total,
             coalesce(sum(case when tt.amount < 0 then abs(tt.amount) else 0 end), 0) as cash_out_total,
             coalesce(sum(tt.amount), 0) as net_total
      from treasury_transactions tt
      where tt.tenant_id = ${scope.tenantId}
        and tt.reference_type = 'cashier_shift'
        and tt.reference_id = ${shiftId}
        and coalesce(tt.payment_channel,'cash') = 'cash'
        and (tt.return_document_id is null or tt.txn_type = 'purchase_return_refund')
        and coalesce(tt.txn_type, '') not in ('supplier_payment_schedule', 'supplier_payment')
    `.execute(queryable ?? this.db);
    const row = result.rows?.[0] || {};
    return {
      cashInTotal: this.toBookMoney(row.cash_in_total || 0, bookDigits),
      deliveryCashInTotal: this.toBookMoney(row.delivery_cash_in_total || 0, bookDigits),
      manualCashInTotal: this.toBookMoney(row.manual_cash_in_total || 0, bookDigits),
      cashOutTotal: this.toBookMoney(row.cash_out_total || 0, bookDigits),
      netMovementTotal: this.toBookMoney(row.net_total || 0, bookDigits),
    };
  }

  async computeShiftSupplierPaymentsTotal(
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<number> {
    const openerId = Number(shift.opened_by || 0);
    const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return 0;
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const shiftId = Number(shift.id || 0);
    const result = await sql<{ total?: number | string | null }>`
      select (
        coalesce((
          select sum(sp.amount)
          from supplier_payments sp
          where sp.tenant_id = ${scope.tenantId} and coalesce(sp.payment_channel,'cash') = 'cash'
            and sp.created_by = ${openerId} and sp.created_at >= ${shift.created_at}
            and (${shift.closed_at || null}::timestamptz is null or sp.created_at <= ${shift.closed_at || null})
            and (${shift.branch_id || null}::int is null or sp.branch_id is null or sp.branch_id = ${Number(shift.branch_id || 0) || null})
            and (${shift.location_id || null}::int is null or sp.location_id is null or sp.location_id = ${Number(shift.location_id || 0) || null})
        ), 0)
        +
        coalesce((
          select sum(abs(tt.amount))
          from treasury_transactions tt
          where tt.tenant_id = ${scope.tenantId}
            and tt.txn_type in ('supplier_payment_schedule', 'supplier_payment')
            and coalesce(tt.payment_channel,'cash') = 'cash'
            and tt.reference_type = 'cashier_shift'
            and tt.reference_id = ${shiftId}
        ), 0)
      ) as total
    `.execute(queryable ?? this.db);
    return this.toBookMoney(result.rows?.[0]?.total || 0, bookDigits);
  }

  async computeShiftExpensesTotal(
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<number> {
    const openerId = Number(shift.opened_by || 0);
    const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return 0;
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{ total?: number | string | null }>`
      select coalesce(sum(e.amount), 0) as total
      from expenses e
      where e.tenant_id = ${scope.tenantId} and e.created_by = ${openerId}
        and e.cancelled_at is null
        and e.created_at >= ${shift.created_at}
        and (${shift.closed_at || null}::timestamptz is null or e.created_at <= ${shift.closed_at || null})
        and (${shift.branch_id || null}::int is null or e.branch_id is null or e.branch_id = ${Number(shift.branch_id || 0) || null})
        and (${shift.location_id || null}::int is null or e.location_id is null or e.location_id = ${Number(shift.location_id || 0) || null})
    `.execute(queryable ?? this.db);
    return this.toBookMoney(result.rows?.[0]?.total || 0, bookDigits);
  }

  async computeShiftServiceBreakdown(
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<ShiftServiceBreakdown> {
    const openerId = Number(shift.opened_by || 0);
    const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return { serviceCashTotal: 0, serviceCardTotal: 0, serviceTotal: 0 };
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{
      service_cash_total?: number | string | null;
      service_card_total?: number | string | null;
      service_total?: number | string | null;
    }>`
      select coalesce(sum(case when coalesce(s.payment_channel, 'cash') = 'cash' then s.amount else 0 end), 0) as service_cash_total,
             coalesce(sum(case when coalesce(s.payment_channel, 'cash') = 'card' then s.amount else 0 end), 0) as service_card_total,
             coalesce(sum(s.amount), 0) as service_total
      from services s
      where s.tenant_id = ${scope.tenantId} and s.created_by = ${openerId}
        and s.created_at >= ${shift.created_at}
        and (${shift.closed_at || null}::timestamptz is null or s.created_at <= ${shift.closed_at || null})
        and (${shift.branch_id || null}::int is null or s.branch_id is null or s.branch_id = ${Number(shift.branch_id || 0) || null})
        and (${shift.location_id || null}::int is null or s.location_id is null or s.location_id = ${Number(shift.location_id || 0) || null})
    `.execute(queryable ?? this.db);
    const row = result.rows?.[0] || {};
    return {
      serviceCashTotal: this.toBookMoney(row.service_cash_total || 0, bookDigits),
      serviceCardTotal: this.toBookMoney(row.service_card_total || 0, bookDigits),
      serviceTotal: this.toBookMoney(row.service_total || 0, bookDigits),
    };
  }

  /**
   * INV-SHIFT-SALE-CASH-ATTRIBUTION: the ONE key that attributes a
   * sale's cash to a shift. It is used by the sales breakdown, the
   * cancelled-sale receipt restore, and the attributed sale-cash
   * totals/items below — never three different predicates. A sale
   * belongs to a shift when it was created by the shift's opener
   * inside the shift's window on the same branch/location (the
   * historical rule), OR when no shift of its creator covers it and
   * this open shift is the only open shift covering it on the
   * branch/location (a sale posted by another login at the same
   * terminal), OR — INV-REST-SHIFT-CLOSE-CONTROL (I24) — when the
   * sale carries this shift's POS station code (pos_terminal_code)
   * and its creator has no covering shift. Rep-custody cash never
   * belongs to a shift's sale cash: a sale whose collection_status
   * is prepaid_by_rep (van field cash and rep-prepaid deliveries)
   * is excluded from the main branch exactly like the fallback
   * branches — the cash sits with the rep, not in any drawer, until
   * settlement credits the receiving shift with a treasury row
   * (INV-REP-PREPAID-SHIFT-TREASURY). The creation shift therefore
   * never expects it, and the cancelled-sale receipt restore and
   * the attributed sale-cash list inherit the same rule because
   * they share this key.
   * Call sites always alias the sales table `s`. Only columns that
   * every drawer fixture carries are referenced (no sale_origin /
   * van_trip_id: minimal harnesses do not seed them).
   */
  private shiftSaleCashAttribution(tenantId: string, shift: ShiftRow, openerId: number) {
    // INV-REST-SHIFT-CLOSE-CONTROL (I24): a sale also belongs to a
    // shift when it carries that shift's POS station code and its
    // creator has no shift covering it. The terminal uniquely
    // identifies the station (partial unique index), so no
    // exactly-one-open-shift count is needed here — but the
    // creator-no-covering-shift guard is kept, or a sale whose
    // creator DOES have a shift would be claimed twice. Never
    // sales.terminal_id: that is the EDC card-terminal id, null
    // on cash sales; the station code is pos_terminal_code.
    const terminalCode = String(shift.terminal_code || '').trim();
    const terminalBranch = terminalCode
      ? sql<boolean>`or (
          s.pos_terminal_code = ${terminalCode}
          and coalesce(s.collection_status, '') <> 'prepaid_by_rep'
          and not exists (
            select 1 from cashier_shifts cs
            where cs.tenant_id = ${tenantId} and cs.opened_by = s.created_by
              and s.created_at >= cs.created_at
              and (cs.closed_at is null or s.created_at <= cs.closed_at)
              and (cs.branch_id is null or s.branch_id is null or cs.branch_id = s.branch_id)
              and (cs.location_id is null or s.location_id is null or cs.location_id = s.location_id)
          )
          and (${shift.branch_id || null}::int is null or s.branch_id is null or s.branch_id = ${Number(shift.branch_id || 0) || null})
          and (${shift.location_id || null}::int is null or s.location_id is null or s.location_id = ${Number(shift.location_id || 0) || null})
        )`
      : sql<boolean>``;
    const fallback =
      String(shift.status || 'open') === 'open'
        ? sql<boolean>`or (
          coalesce(s.collection_status, '') <> 'prepaid_by_rep'
          and not exists (
            select 1 from cashier_shifts cs
            where cs.tenant_id = ${tenantId} and cs.opened_by = s.created_by
              and s.created_at >= cs.created_at
              and (cs.closed_at is null or s.created_at <= cs.closed_at)
              and (cs.branch_id is null or s.branch_id is null or cs.branch_id = s.branch_id)
              and (cs.location_id is null or s.location_id is null or cs.location_id = s.location_id)
          )
          and (
            select count(*) from cashier_shifts cs2
            where cs2.tenant_id = ${tenantId} and cs2.status = 'open'
              and s.created_at >= cs2.created_at
              and (cs2.branch_id is null or s.branch_id is null or cs2.branch_id = s.branch_id)
              and (cs2.location_id is null or s.location_id is null or cs2.location_id = s.location_id)
          ) = 1
        ) ${terminalBranch}`
        : sql<boolean>`or false`;
    return sql<boolean>`(
        (s.created_by = ${openerId} and coalesce(s.collection_status, '') <> 'prepaid_by_rep')
        ${fallback}
      )
      and s.created_at >= ${shift.created_at}
      and (${shift.closed_at || null}::timestamptz is null or s.created_at <= ${shift.closed_at || null})
      and (${shift.branch_id || null}::int is null or s.branch_id is null or s.branch_id = ${Number(shift.branch_id || 0) || null})
      and (${shift.location_id || null}::int is null or s.location_id is null or s.location_id = ${Number(shift.location_id || 0) || null})`;
  }

  async computeShiftSalesBreakdown(
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<ShiftSalesBreakdown> {
    const openerId = Number(shift.opened_by || 0);
    const scope = this.scope(auth);
    const empty: ShiftSalesBreakdown = {
      cashSalesTotal: 0,
      cardSalesTotal: 0,
      walletSalesTotal: 0,
      instapaySalesTotal: 0,
      creditSalesTotal: 0,
      deliverySalesTotal: 0,
      shiftSalesTotal: 0,
      tipSalesTotal: 0,
      deliveryFeeTotal: 0,
      freelanceDeliveryFeeTotal: 0,
      storeDeliveryFeeTotal: 0,
      netStoreSalesTotal: 0,
      saleCount: 0,
      mixedSalesCount: 0,
      cardOperationCount: 0,
      walletOperationCount: 0,
      instapayOperationCount: 0,
    };
    if (!(openerId > 0) || !shift.created_at) return empty;
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<any>`
      with shift_sales as (
        select s.id, s.total, s.paid_amount, s.payment_type, s.payment_channel, s.collection_status,
               coalesce(s.delivery_fee, 0) as delivery_fee,
               coalesce(s.delivery_fee_mode, 'freelance_courier') as delivery_fee_mode,
               coalesce(s.tip_amount, 0) as tip_amount
        from sales s
        where s.tenant_id = ${scope.tenantId} and s.status = 'posted' and ${this.shiftSaleCashAttribution(scope.tenantId, shift, openerId)}
      ), payment_rows as (
        select sp.sale_id, sp.payment_channel, sp.amount from sale_payments sp inner join shift_sales ss on ss.id = sp.sale_id where sp.tenant_id = ${scope.tenantId} and coalesce(ss.collection_status, '') != 'cod'
        union all
        select ss.id as sale_id, case when ss.payment_channel in ('card','wallet','instapay') then ss.payment_channel else 'cash' end as payment_channel, ss.paid_amount as amount from shift_sales ss where ss.payment_channel in ('cash','card','wallet','instapay') and not exists (select 1 from sale_payments sp where sp.tenant_id = ${scope.tenantId} and sp.sale_id = ss.id) and coalesce(ss.collection_status, '') != 'cod'
      )
      select coalesce(sum(case when payment_channel = 'cash' then amount else 0 end), 0) as cash_sales_total,
             coalesce(sum(case when payment_channel = 'card' then amount else 0 end), 0) as card_sales_total,
             coalesce(sum(case when payment_channel = 'wallet' then amount else 0 end), 0) as wallet_sales_total,
             coalesce(sum(case when payment_channel = 'instapay' then amount else 0 end), 0) as instapay_sales_total,
             coalesce((select sum(total) from shift_sales where (payment_type = 'credit' or payment_channel = 'credit') and coalesce(collection_status, '') != 'cod' and coalesce(payment_channel, '') != 'cod'), 0) as credit_sales_total,
             coalesce((select sum(total) from shift_sales where coalesce(collection_status, '') = 'cod' or payment_channel = 'cod'), 0) as delivery_sales_total,
             coalesce((select sum(total) from shift_sales), 0) as shift_sales_total,
             coalesce((select sum(tip_amount) from shift_sales), 0) as tip_sales_total,
             coalesce((select sum(delivery_fee) from shift_sales), 0) as delivery_fee_total,
             coalesce((select sum(case when delivery_fee_mode = 'freelance_courier' then delivery_fee else 0 end) from shift_sales), 0) as freelance_delivery_fee_total,
             coalesce((select sum(case when delivery_fee_mode = 'store_fleet' then delivery_fee else 0 end) from shift_sales), 0) as store_delivery_fee_total,
             coalesce((select count(*) from shift_sales), 0)::int as sale_count,
             coalesce((select count(*) from shift_sales where payment_channel = 'mixed'), 0)::int as mixed_sale_count,
             coalesce(sum(case when payment_channel = 'card' then 1 else 0 end), 0)::int as card_operation_count,
             coalesce(sum(case when payment_channel = 'wallet' then 1 else 0 end), 0)::int as wallet_operation_count,
             coalesce(sum(case when payment_channel = 'instapay' then 1 else 0 end), 0)::int as instapay_operation_count
      from payment_rows
    `.execute(queryable ?? this.db);
    const row = result.rows?.[0] || {};
    const shiftSalesTotal = this.toBookMoney(row.shift_sales_total || 0, bookDigits);
    const deliverySalesTotal = this.toBookMoney(row.delivery_sales_total || 0, bookDigits);
    const deliveryFeeTotal = this.toBookMoney(row.delivery_fee_total || 0, bookDigits);
    const freelanceDeliveryFeeTotal = this.toBookMoney(row.freelance_delivery_fee_total || 0, bookDigits);
    const storeDeliveryFeeTotal = this.toBookMoney(row.store_delivery_fee_total || 0, bookDigits);
    const netStoreSalesTotal = this.toBookMoney(Math.max(0, shiftSalesTotal - freelanceDeliveryFeeTotal), bookDigits);

    return {
      cashSalesTotal: this.toBookMoney(row.cash_sales_total || 0, bookDigits),
      cardSalesTotal: this.toBookMoney(row.card_sales_total || 0, bookDigits),
      walletSalesTotal: this.toBookMoney(row.wallet_sales_total || 0, bookDigits),
      instapaySalesTotal: this.toBookMoney(row.instapay_sales_total || 0, bookDigits),
      creditSalesTotal: this.toBookMoney(row.credit_sales_total || 0, bookDigits),
      deliverySalesTotal,
      shiftSalesTotal,
      tipSalesTotal: this.toBookMoney(row.tip_sales_total || 0, bookDigits),
      deliveryFeeTotal,
      freelanceDeliveryFeeTotal,
      storeDeliveryFeeTotal,
      netStoreSalesTotal,
      saleCount: Number(row.sale_count || 0),
      mixedSalesCount: Number(row.mixed_sale_count || 0),
      cardOperationCount: Number(row.card_operation_count || 0),
      walletOperationCount: Number(row.wallet_operation_count || 0),
      instapayOperationCount: Number(row.instapay_operation_count || 0),
    };
  }

  async computeShiftSaleReturnTotals(
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<ShiftSaleReturnTotals> {
    const openerId = Number(shift.opened_by || 0);
    const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at)
      return { saleReturnCashRefundTotal: 0, saleReturnCardRefundTotal: 0, saleReturnTotal: 0 };
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{
      sale_return_cash_refund_total: number | string;
      sale_return_card_refund_total: number | string;
      sale_return_total: number | string;
    }>`
      select coalesce((
        select sum(abs(tt.amount))
        from treasury_transactions tt
        inner join return_documents rd on rd.id = tt.return_document_id and rd.tenant_id = tt.tenant_id
        where tt.tenant_id = ${scope.tenantId}
          and tt.reference_type = 'cashier_shift' and tt.reference_id = ${Number(shift.id)}
          and tt.amount < 0 and rd.return_type = 'sale'
          and coalesce(tt.payment_channel, 'cash') = 'cash'
          and rd.settlement_mode = 'refund'
      ), 0) as sale_return_cash_refund_total,
      coalesce(sum(case when rd.refund_allocations is not null then (
        select coalesce(sum((alloc.value->>'amount')::numeric), 0)
        from jsonb_array_elements(rd.refund_allocations) as alloc(value)
        where alloc.value->>'tender' = 'card'
      ) when rd.settlement_mode = 'refund' and rd.refund_method = 'card' then rd.total else 0 end), 0) as sale_return_card_refund_total,
      coalesce(sum(rd.total), 0) as sale_return_total
      from return_documents rd
      where rd.tenant_id = ${scope.tenantId} and rd.return_type = 'sale'
        and rd.created_by = ${openerId} and rd.created_at >= ${shift.created_at}
        and (${shift.closed_at || null}::timestamptz is null or rd.created_at <= ${shift.closed_at || null})
        and (${shift.branch_id || null}::int is null or rd.branch_id is null or rd.branch_id = ${Number(shift.branch_id || 0) || null})
        and (${shift.location_id || null}::int is null or rd.location_id is null or rd.location_id = ${Number(shift.location_id || 0) || null})
    `.execute(queryable ?? this.db);
    const row = result.rows?.[0] || {};
    return {
      saleReturnCashRefundTotal: this.toBookMoney(row.sale_return_cash_refund_total || 0, bookDigits),
      saleReturnCardRefundTotal: this.toBookMoney(row.sale_return_card_refund_total || 0, bookDigits),
      saleReturnTotal: this.toBookMoney(row.sale_return_total || 0, bookDigits),
    };
  }

  async computeShiftCustomerCollectionsByChannel(
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<ShiftCustomerCollectionsByChannel> {
    const openerId = Number(shift.opened_by || 0);
    const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at)
      return { cash: 0, card: 0, wallet: 0, instapay: 0, cashCount: 0, cardCount: 0, walletCount: 0, instapayCount: 0 };
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    return computeShiftCustomerCollectionsByChannel(
      queryable ?? this.db,
      {
        tenantId: scope.tenantId,
        openerId,
        createdAt: shift.created_at,
        closedAt: shift.closed_at,
        branchId: shift.branch_id,
        locationId: shift.location_id,
      },
      bookDigits,
    );
  }

  async computeShiftCancelledSaleCashReceipts(
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<number> {
    const openerId = Number(shift.opened_by || 0);
    if (!(openerId > 0) || !shift.created_at) return 0;
    const scope = this.scope(auth);
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    // A sale cancelled LATER still brought cash into its ORIGINAL shift.
    // Restore that cash to the original shift's expected drawer, and account
    // for the outgoing refund separately in whichever shift actually paid it.
    const result = await sql<{ total: string | number }>`
      select coalesce(sum(case when sp.sale_id is not null then sp.cash_paid
        when s.payment_channel = 'cash' then s.paid_amount else 0 end), 0) as total
      from sales s
      left join lateral (
        select s.id as sale_id,
          sum(case when sp.payment_channel = 'cash' then sp.amount else 0 end) as cash_paid
        from sale_payments sp
        where sp.tenant_id = ${scope.tenantId} and sp.sale_id = s.id
        having count(*) > 0
      ) sp on true
      where s.tenant_id = ${scope.tenantId} and s.status = 'cancelled'
        and ${this.shiftSaleCashAttribution(scope.tenantId, shift, openerId)}
    `.execute(queryable ?? this.db);
    return this.toBookMoney(result.rows?.[0]?.total || 0, bookDigits);
  }

  /**
   * INV-SHIFT-SALE-CASH-ATTRIBUTION: the sale-cash rows of this
   * shift's attributed sales, for the drawer movement view only.
   * The same attribution key as the breakdown, over the
   * sale-linked treasury rows (reference_type 'sale'). Cancelled
   * sales are excluded (their receipt is restored separately and
   * their refund is a shift-linked movement); COD sales never
   * wrote a sale treasury row. This total is DISPLAY ONLY: the
   * expected-cash computation still reads the sales breakdown, so
   * showing the rows here can never double-count the cash.
   */
  async computeShiftAttributedSaleCash(
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<{
    total: number;
    items: Array<{
      id: string;
      kind: 'cash_in' | 'cash_out';
      kindLabel: string;
      amount: number;
      note: string;
      createdAt: string;
    }>;
  }> {
    const openerId = Number(shift.opened_by || 0);
    const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return { total: 0, items: [] };
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{
      id?: number | string | null;
      amount?: number | string | null;
      note?: string | null;
      txn_type?: string | null;
      created_at?: string | Date | null;
      sale_id?: number | string | null;
    }>`
      select tt.id, tt.amount, tt.note, tt.txn_type, tt.created_at, s.id as sale_id
      from treasury_transactions tt
      inner join sales s on s.id = tt.reference_id and s.tenant_id = tt.tenant_id
      where tt.tenant_id = ${scope.tenantId} and tt.reference_type = 'sale'
        and s.status = 'posted' and coalesce(s.collection_status, '') != 'cod'
        and coalesce(tt.payment_channel, 'cash') = 'cash'
        and ${this.shiftSaleCashAttribution(scope.tenantId, shift, openerId)}
      order by tt.id asc
    `.execute(queryable ?? this.db);
    let total = 0;
    const items: Array<{
      id: string;
      kind: 'cash_in' | 'cash_out';
      kindLabel: string;
      amount: number;
      note: string;
      createdAt: string;
    }> = [];
    for (const row of result.rows || []) {
      const amount = Number(row.amount || 0);
      total += amount;
      items.push({
        id: `sale-tt-${row.id}`,
        kind: amount >= 0 ? 'cash_in' : 'cash_out',
        kindLabel: amount >= 0 ? 'مبيعات نقدية' : 'عكس نقدية فاتورة بيع',
        amount: Math.abs(amount),
        note: String(row.note || '').trim() || `فاتورة بيع S-${row.sale_id}`,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      });
    }
    return { total: this.toBookMoney(total, bookDigits), items };
  }

  /**
   * INV-EXPECTED-CASH-SINGLE-WINDOW: every time-windowed component of
   * expected cash is predicated on ONE timestamp — the row's
   * created_at, the moment the cash actually moved — inside
   * [shift.created_at, shift.closed_at]. Business dates
   * (expense_date, service_date, payment_date) are stored and shown
   * on their own screens but never drive drawer attribution: an
   * expense created in shift 1 with a business date inside shift 2
   * used to count in both shifts, and a supplier payment dated
   * inside a shift but recorded later counted in a shift that never
   * held the cash. Windows on created_at partition time, so each
   * movement counts exactly once across consecutive shifts of the
   * same opener. The shift-linked treasury legs carry no time
   * predicate: they are exactly-once by link and are unchanged.
   * Sales, returns, and collections already used created_at and
   * are unchanged.
   */
  async computeShiftExpectedCashFromShift(
    shift: ShiftRow,
    auth: AuthContext,
    salesBreakdown?: ShiftSalesBreakdown,
    serviceBreakdown?: ShiftServiceBreakdown,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ): Promise<number> {
    const bookDigits =
      digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, this.scope(auth).tenantId));
    const shiftId = Number(shift.id || 0);
    if (!(shiftId > 0)) return this.toBookMoney(shift.opening_cash || 0, bookDigits);
    const movements = await this.computeShiftCashDrawerMovements(shiftId, auth, queryable, bookDigits);
    const breakdown = salesBreakdown || (await this.computeShiftSalesBreakdown(shift, auth, queryable, bookDigits));
    const services = serviceBreakdown || (await this.computeShiftServiceBreakdown(shift, auth, queryable, bookDigits));
    const saleReturnTotals = await this.computeShiftSaleReturnTotals(shift, auth, queryable, bookDigits);
    const supplierPaymentsTotal = await this.computeShiftSupplierPaymentsTotal(shift, auth, queryable, bookDigits);
    const expensesTotal = await this.computeShiftExpensesTotal(shift, auth, queryable, bookDigits);
    const customerCollections = (
      await this.computeShiftCustomerCollectionsByChannel(shift, auth, queryable, bookDigits)
    ).cash;
    const cancelledCheckoutCash = await this.computeShiftCancelledSaleCashReceipts(shift, auth, queryable, bookDigits);
    const netDrawerMovement = movements.cashInTotal - movements.cashOutTotal;
    // INV-REST-SHIFT-CLOSE-CONTROL (I25): the sum is the one pure
    // buildExpectedCashBreakdown — the same rows the close card and
    // the Z-report render — so the stored figure and the shown
    // figure can never drift apart again.
    return buildExpectedCashBreakdown(
      {
        openingCash: Number(shift.opening_cash || 0),
        netDrawerMovement,
        cashSalesTotal: breakdown.cashSalesTotal,
        cancelledSaleCashTotal: cancelledCheckoutCash,
        serviceCashTotal: services.serviceCashTotal,
        customerCollectionsTotal: customerCollections,
        saleReturnCashRefundTotal: saleReturnTotals.saleReturnCashRefundTotal,
        supplierPaymentsTotal,
        expensesTotal,
      },
      bookDigits,
    ).total;
  }
}
