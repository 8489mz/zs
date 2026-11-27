import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import {
  computeCashDrawerVariance,
  filterCashDrawerRows,
  mapCashDrawerShiftRow,
  paginateCashDrawerRows,
  summarizeCashDrawerRows,
  buildShiftCashReturnItem,
  isDrawerCashTender,
} from './helpers/cash-drawer.helper';
import { type ShiftCustomerCollectionsByChannel } from './helpers/shift-customer-collections.helper';
import { type ShiftDiscountSummary } from './helpers/shift-discount-summary.helper';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { type TenantScope } from '../../core/auth/utils/tenant-boundary';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { Database } from '../../database/database.types';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import {
  type ShiftRow,
  type ShiftServiceBreakdown,
  type ShiftSalesBreakdown,
  type ShiftSaleReturnTotals,
  type BlindCloseMetadata,
  type PostCloseCorrectionStamp,
} from './cash-drawer.types';

/**
 * CashDrawerReadsService — slice S3 of the cash-drawer split.
 * Pure move of the read and hydration helpers from the drawer
 * service. No behavior change: the bodies are byte-identical
 * except for the forced visibility change below; the facade keeps
 * thin delegates with the same names and signatures. This slice
 * reaches the kernel helpers and the compute helpers only through
 * bound deps — it never imports another slice service.
 * The delegated helpers are public here — the facade, a different
 * class, cannot call a private slice method; the facade delegates
 * keep the original visibility, so the facade public surface is
 * unchanged. Three helpers stay private here: they are called only
 * from inside this slice, so they need no delegate.
 */

export interface CashDrawerReadsDeps {
  db: Kysely<Database>;
  // Bound kernel helper (stays in the facade; passed bound so the moved
  // bodies stay byte-identical).
  scope: (auth: AuthContext) => TenantScope;
  // Bound cross-slice helpers (facade delegates, bound so the moved
  // bodies stay byte-identical; never a direct slice import).
  computeShiftAttributedSaleCash: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<{
    total: number;
    items: Array<{
      id: string;
      kind: 'cash_in' | 'cash_out';
      kindLabel: string;
      amount: number;
      note: string;
      createdAt: string;
    }>;
  }>;
  computeShiftSalesBreakdown: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftSalesBreakdown>;
  // INV-SHIFT-CLOSE-DISCOUNT-SUMMARY: display-only discount summary
  // (header + per-line over posted sales, % of gross). Bound facade
  // delegate, like the other compute helpers.
  computeShiftDiscountSummary: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftDiscountSummary>;
  computeShiftServiceBreakdown: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftServiceBreakdown>;
  computeShiftCashDrawerMovements: (
    shiftId: number,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<{
    cashInTotal: number;
    deliveryCashInTotal: number;
    manualCashInTotal: number;
    cashOutTotal: number;
    netMovementTotal: number;
  }>;
  computeShiftSaleReturnTotals: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftSaleReturnTotals>;
  computeShiftSupplierPaymentsTotal: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<number>;
  computeShiftExpensesTotal: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<number>;
  computeShiftCustomerCollectionsByChannel: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftCustomerCollectionsByChannel>;
  computeShiftCancelledSaleCashReceipts: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<number>;
  computeShiftExpectedCashFromShift: (
    shift: ShiftRow,
    auth: AuthContext,
    salesBreakdown?: ShiftSalesBreakdown,
    serviceBreakdown?: ShiftServiceBreakdown,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<number>;
  parseBlindCloseNote: (rawNote: unknown) => BlindCloseMetadata | null;
  serializeBlindCloseNote: (meta: BlindCloseMetadata) => string;
}

@Injectable()
export class CashDrawerReadsService {
  private readonly db: Kysely<Database>;
  private readonly scope: (auth: AuthContext) => TenantScope;
  private readonly computeShiftAttributedSaleCash: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<{
    total: number;
    items: Array<{
      id: string;
      kind: 'cash_in' | 'cash_out';
      kindLabel: string;
      amount: number;
      note: string;
      createdAt: string;
    }>;
  }>;
  private readonly computeShiftSalesBreakdown: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftSalesBreakdown>;
  private readonly computeShiftDiscountSummary: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftDiscountSummary>;
  private readonly computeShiftServiceBreakdown: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftServiceBreakdown>;
  private readonly computeShiftCashDrawerMovements: (
    shiftId: number,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<{
    cashInTotal: number;
    deliveryCashInTotal: number;
    manualCashInTotal: number;
    cashOutTotal: number;
    netMovementTotal: number;
  }>;
  private readonly computeShiftSaleReturnTotals: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftSaleReturnTotals>;
  private readonly computeShiftSupplierPaymentsTotal: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<number>;
  private readonly computeShiftExpensesTotal: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<number>;
  private readonly computeShiftCustomerCollectionsByChannel: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<ShiftCustomerCollectionsByChannel>;
  private readonly computeShiftCancelledSaleCashReceipts: (
    shift: ShiftRow,
    auth: AuthContext,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<number>;
  private readonly computeShiftExpectedCashFromShift: (
    shift: ShiftRow,
    auth: AuthContext,
    salesBreakdown?: ShiftSalesBreakdown,
    serviceBreakdown?: ShiftServiceBreakdown,
    queryable?: Kysely<Database>,
    digits?: MoneyDigits,
  ) => Promise<number>;
  private readonly parseBlindCloseNote: (rawNote: unknown) => BlindCloseMetadata | null;
  private readonly serializeBlindCloseNote: (meta: BlindCloseMetadata) => string;

  constructor(deps: CashDrawerReadsDeps) {
    this.db = deps.db;
    this.scope = deps.scope;
    this.computeShiftAttributedSaleCash = deps.computeShiftAttributedSaleCash;
    this.computeShiftSalesBreakdown = deps.computeShiftSalesBreakdown;
    this.computeShiftDiscountSummary = deps.computeShiftDiscountSummary;
    this.computeShiftServiceBreakdown = deps.computeShiftServiceBreakdown;
    this.computeShiftCashDrawerMovements = deps.computeShiftCashDrawerMovements;
    this.computeShiftSaleReturnTotals = deps.computeShiftSaleReturnTotals;
    this.computeShiftSupplierPaymentsTotal = deps.computeShiftSupplierPaymentsTotal;
    this.computeShiftExpensesTotal = deps.computeShiftExpensesTotal;
    this.computeShiftCustomerCollectionsByChannel = deps.computeShiftCustomerCollectionsByChannel;
    this.computeShiftCancelledSaleCashReceipts = deps.computeShiftCancelledSaleCashReceipts;
    this.computeShiftExpectedCashFromShift = deps.computeShiftExpectedCashFromShift;
    this.parseBlindCloseNote = deps.parseBlindCloseNote;
    this.serializeBlindCloseNote = deps.serializeBlindCloseNote;
  }

  async fetchShiftMovementItems(
    shiftId: number,
    shift: ShiftRow,
    auth: AuthContext,
  ): Promise<
    Array<{
      id: string;
      kind: 'cash_in' | 'cash_out' | 'delivery' | 'expense' | 'supplier_payment' | 'return';
      kindLabel: string;
      amount: number;
      note: string;
      createdAt: string;
    }>
  > {
    const scope = this.scope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const openerId = Number(shift.opened_by || 0);
    const items: Array<{
      id: string;
      kind: 'cash_in' | 'cash_out' | 'delivery' | 'expense' | 'supplier_payment' | 'return';
      kindLabel: string;
      amount: number;
      note: string;
      createdAt: string;
    }> = [];

    // 1. Delivery reps map for note enrichment
    const repRows = await sql<{ id: number; name: string }>`
      select id, name from delivery_representatives where tenant_id = ${scope.tenantId}
    `.execute(this.db);
    const repMap = new Map<number, string>();
    for (const r of repRows.rows || []) {
      repMap.set(Number(r.id), String(r.name).trim());
    }

    // 2. Treasury transactions (Drawer cash in / cash out / delivery)
    const ttRows = await sql<{
      id: number;
      amount: number | string;
      note?: string | null;
      txn_type?: string | null;
      created_at?: string | Date | null;
    }>`
      select tt.id, tt.amount, tt.note, tt.txn_type, tt.created_at
      from treasury_transactions tt
      where tt.tenant_id = ${scope.tenantId}
        and tt.reference_type = 'cashier_shift'
        and tt.reference_id = ${shiftId}
        and coalesce(tt.payment_channel,'cash') = 'cash'
        and (tt.return_document_id is null or tt.txn_type = 'purchase_return_refund')
        and coalesce(tt.txn_type, '') not in ('supplier_payment_schedule', 'supplier_payment')
      order by tt.id asc
    `.execute(this.db);

    for (const tt of ttRows.rows || []) {
      const amt = Number(tt.amount || 0);
      const rawNote = String(tt.note || '').trim();
      const isPurchaseRefund = tt.txn_type === 'purchase_return_refund';
      const isSaleCancellation = tt.txn_type === 'sale_cancel_restore';
      const isDelivery =
        !isPurchaseRefund && !isSaleCancellation && (rawNote.includes('دليفري') || rawNote.includes('مندوب'));
      const kind = isDelivery ? 'delivery' : amt > 0 ? 'cash_in' : 'cash_out';
      const isSafeDrop = tt.txn_type === 'safe_drop';
      const isSafeReplenishment = tt.txn_type === 'safe_replenishment';
      const kindLabel = isSafeDrop
        ? 'تحويل نقدية للخزنة (إيداع آمن)'
        : isSafeReplenishment
          ? 'تغذية الدرج من الخزنة'
          : isPurchaseRefund
            ? 'استرداد نقدي من مورد بعد مرتجع شراء'
            : isSaleCancellation
              ? 'رد نقدية فاتورة بيع ملغاة'
              : isDelivery
                ? amt > 0
                  ? 'تحصيل وتسوية دليفري'
                  : 'صرف أجرة طيار دليفري'
                : amt > 0
                  ? 'إيداع نقدي بالدرج (يدوياً)'
                  : 'مسحوبات نقدية من الدرج';

      items.push({
        id: `tt-${tt.id}`,
        kind,
        kindLabel,
        amount: Math.abs(amt),
        note: rawNote || (amt > 0 ? 'إيداع نقدي بالدرج' : 'مسحوبات نقدية من الدرج'),
        createdAt: tt.created_at ? new Date(tt.created_at).toISOString() : '',
      });
    }

    // 3. Expenses during shift
    if (openerId > 0 && shift.created_at) {
      const expRows = await sql<{
        id: number;
        amount: number | string;
        title?: string | null;
        note?: string | null;
        expense_date?: string | Date | null;
        created_at?: string | Date | null;
      }>`
        select e.id, e.amount, e.title, e.note, e.expense_date, e.created_at
        from expenses e
        where e.tenant_id = ${scope.tenantId} and e.created_by = ${openerId}
          and e.cancelled_at is null
          and e.created_at >= ${shift.created_at}
          and (${shift.closed_at || null}::timestamptz is null or e.created_at <= ${shift.closed_at || null})
          and (${shift.branch_id || null}::int is null or e.branch_id is null or e.branch_id = ${Number(shift.branch_id || 0) || null})
          and (${shift.location_id || null}::int is null or e.location_id is null or e.location_id = ${Number(shift.location_id || 0) || null})
        order by e.id asc
      `.execute(this.db);

      for (const exp of expRows.rows || []) {
        const amt = Number(exp.amount || 0);
        const note = [exp.title, exp.note].filter(Boolean).join(' - ');
        items.push({
          id: `exp-${exp.id}`,
          kind: 'expense',
          kindLabel: 'مصروفات تشغيلية',
          amount: Math.abs(amt),
          note: note.trim() || 'مصروفات تشغيلية',
          createdAt: exp.created_at ? new Date(exp.created_at).toISOString() : '',
        });
      }

      // 4. Supplier payments
      const supRows = await sql<{
        id: number;
        amount: number | string;
        note?: string | null;
        supplier_name?: string | null;
        payment_date?: string | Date | null;
        created_at?: string | Date | null;
        payment_channel?: string | null;
      }>`
        select sp.id, sp.amount, sp.note, sp.payment_date, sp.created_at, sp.payment_channel, sup.name as supplier_name
        from supplier_payments sp
        left join suppliers sup on sup.id = sp.supplier_id and sup.tenant_id = sp.tenant_id
        where sp.tenant_id = ${scope.tenantId}
          and coalesce(sp.payment_channel, 'cash') = 'cash'
          and sp.created_by = ${openerId} and sp.created_at >= ${shift.created_at}
          and (${shift.closed_at || null}::timestamptz is null or sp.created_at <= ${shift.closed_at || null})
          and (${shift.branch_id || null}::int is null or sp.branch_id is null or sp.branch_id = ${Number(shift.branch_id || 0) || null})
          and (${shift.location_id || null}::int is null or sp.location_id is null or sp.location_id = ${Number(shift.location_id || 0) || null})
        order by sp.id asc
      `.execute(this.db);

      for (const sup of supRows.rows || []) {
        if (!isDrawerCashTender(sup.payment_channel)) continue;
        const amt = Number(sup.amount || 0);
        const note = [sup.supplier_name, sup.note].filter(Boolean).join(' - ');
        items.push({
          id: `sp-${sup.id}`,
          kind: 'supplier_payment',
          kindLabel: 'سداد مورد',
          amount: Math.abs(amt),
          note: note.trim() || 'سداد مورد',
          createdAt: sup.created_at ? new Date(sup.created_at).toISOString() : '',
        });
      }

      // Customer debt collections are physical receipts at the same cashier drawer.
      // They are not sales and must not be counted in sales turnover.
      const customerRows = await sql<{
        id: number;
        amount: number | string;
        note?: string | null;
        created_at?: string | Date | null;
      }>`
        select cp.id, cp.amount, cp.note, cp.created_at
        from customer_payments cp
        where cp.tenant_id = ${scope.tenantId} and coalesce(cp.payment_channel,'cash') = 'cash' and cp.created_by = ${openerId}
          and cp.created_at >= ${shift.created_at}
          and (${shift.closed_at || null}::timestamptz is null or cp.created_at <= ${shift.closed_at || null})
          and (${shift.branch_id || null}::int is null or cp.branch_id is null or cp.branch_id = ${Number(shift.branch_id || 0) || null})
          and (${shift.location_id || null}::int is null or cp.location_id is null or cp.location_id = ${Number(shift.location_id || 0) || null})
        order by cp.id asc
      `.execute(this.db);
      for (const receipt of customerRows.rows || []) {
        items.push({
          id: `cp-${receipt.id}`,
          kind: 'cash_in',
          kindLabel: 'تحصيل من عميل آجل',
          amount: Math.abs(Number(receipt.amount || 0)),
          note: String(receipt.note || 'سند قبض عميل').trim(),
          createdAt: receipt.created_at ? new Date(receipt.created_at).toISOString() : '',
        });
      }

      // 5. Cash paid out by THIS drawer for sale returns. A return document
      // may have mixed cash/card/store-credit allocations or may belong to
      // a different cashier's shift. Only linked cash treasury legs belong here.
      const retRows = await sql<{
        id: number;
        doc_no?: string | null;
        cash_refund?: number | string | null;
        note?: string | null;
        created_at?: string | Date | null;
      }>`
        select rd.id, rd.doc_no, rd.note, min(tt.created_at) as created_at,
               sum(abs(tt.amount)) as cash_refund
        from treasury_transactions tt
        inner join return_documents rd
          on rd.id = tt.return_document_id and rd.tenant_id = tt.tenant_id
        where tt.tenant_id = ${scope.tenantId}
          and tt.reference_type = 'cashier_shift'
          and tt.reference_id = ${shiftId}
          and tt.amount < 0
          and coalesce(tt.payment_channel, 'cash') = 'cash'
          and rd.return_type = 'sale' and rd.settlement_mode = 'refund'
        group by rd.id, rd.doc_no, rd.note
        order by rd.id asc
      `.execute(this.db);

      for (const ret of retRows.rows || []) {
        const item = buildShiftCashReturnItem(ret, digits);
        if (item) items.push(item);
      }
    }

    // INV-SHIFT-SALE-CASH-ATTRIBUTION: the day's sale cash, under
    // the same key as the breakdown, so the movement list a cashier
    // reviews finally shows the sales themselves.
    const attributedSaleCash = await this.computeShiftAttributedSaleCash(shift, auth);
    for (const item of attributedSaleCash.items) items.push(item);

    return items;
  }

  private async hydrateShiftRow(row: ShiftRow, auth: AuthContext): Promise<ShiftRow> {
    const shiftId = Number(row.id || 0);
    if (!(shiftId > 0)) return row;
    const salesBreakdown = await this.computeShiftSalesBreakdown(row, auth);
    const discountSummary = await this.computeShiftDiscountSummary(row, auth);
    const serviceBreakdown = await this.computeShiftServiceBreakdown(row, auth);
    const movements = await this.computeShiftCashDrawerMovements(shiftId, auth);
    const saleReturnTotals = await this.computeShiftSaleReturnTotals(row, auth);
    const supplierPaymentsTotal = await this.computeShiftSupplierPaymentsTotal(row, auth);
    const expensesTotal = await this.computeShiftExpensesTotal(row, auth);
    const movementItems = await this.fetchShiftMovementItems(shiftId, row, auth);
    const attributedSaleCash = await this.computeShiftAttributedSaleCash(row, auth);
    // INV-REST-SHIFT-CLOSE-CONTROL (I25): the two expected-cash
    // components the close card used to hide are hydrated here so
    // the row the frontend renders already carries them.
    const collectionsByChannel = await this.computeShiftCustomerCollectionsByChannel(row, auth);
    const customerCollectionsTotal = collectionsByChannel.cash;
    const cancelledSaleCashTotal = await this.computeShiftCancelledSaleCashReceipts(row, auth);
    const expectedCash =
      String(row.status || 'open') === 'open'
        ? await this.computeShiftExpectedCashFromShift(row, auth, salesBreakdown, serviceBreakdown)
        : Number(row.expected_cash || 0);
    return {
      ...row,
      expected_cash: expectedCash,
      cash_sales_total: salesBreakdown.cashSalesTotal,
      card_sales_total: salesBreakdown.cardSalesTotal,
      wallet_sales_total: salesBreakdown.walletSalesTotal,
      instapay_sales_total: salesBreakdown.instapaySalesTotal,
      credit_sales_total: salesBreakdown.creditSalesTotal,
      delivery_sales_total: salesBreakdown.deliverySalesTotal,
      delivery_fee_total: salesBreakdown.deliveryFeeTotal,
      freelance_delivery_fee_total: salesBreakdown.freelanceDeliveryFeeTotal,
      store_delivery_fee_total: salesBreakdown.storeDeliveryFeeTotal,
      net_store_sales_total: salesBreakdown.netStoreSalesTotal,
      shift_sales_total: salesBreakdown.shiftSalesTotal,
      tip_sales_total: salesBreakdown.tipSalesTotal,
      // INV-SHIFT-CLOSE-DISCOUNT-SUMMARY: display-only; the close
      // table and the printed receipt read these three fields.
      shiftDiscountTotal: discountSummary.discountTotal,
      shiftDiscountGrossTotal: discountSummary.grossSalesTotal,
      shiftDiscountPercent: discountSummary.discountPercent,
      sale_count: salesBreakdown.saleCount,
      mixed_sale_count: salesBreakdown.mixedSalesCount,
      card_operation_count: salesBreakdown.cardOperationCount,
      wallet_operation_count: salesBreakdown.walletOperationCount,
      instapay_operation_count: salesBreakdown.instapayOperationCount,
      cash_drawer_movement_total: movements.netMovementTotal,
      cash_drawer_cash_in_total: movements.cashInTotal,
      cash_drawer_delivery_cash_in_total: movements.deliveryCashInTotal,
      cash_drawer_manual_cash_in_total: movements.manualCashInTotal,
      cash_drawer_cash_out_total: movements.cashOutTotal,
      sale_cash_total: attributedSaleCash.total,
      supplier_payments_total: supplierPaymentsTotal,
      expenses_total: expensesTotal,
      service_cash_total: serviceBreakdown.serviceCashTotal,
      service_card_total: serviceBreakdown.serviceCardTotal,
      service_total: serviceBreakdown.serviceTotal,
      sale_return_cash_refund_total: saleReturnTotals.saleReturnCashRefundTotal,
      sale_return_card_refund_total: saleReturnTotals.saleReturnCardRefundTotal,
      sale_return_total: saleReturnTotals.saleReturnTotal,
      customerCollectionsTotal,
      customerCollectionsByChannel: collectionsByChannel,
      cancelledSaleCashTotal,
      movement_items: movementItems,
    };
  }

  private async rawList(auth: AuthContext, filterStatus?: string): Promise<Array<Record<string, unknown>>> {
    const scope = this.scope(auth);
    let query = sql<ShiftRow>`select s.id, s.doc_no, s.branch_id, s.location_id, s.opened_by, s.opening_cash, s.opening_note, s.status, s.terminal_code, s.expected_cash, s.counted_cash, s.variance, s.close_note, s.closed_by, s.closed_at, s.created_at, coalesce(b.name, '') as branch_name, coalesce(l.name, '') as location_name, coalesce(ou.username, '') as opened_by_name, coalesce(cu.username, '') as closed_by_name from cashier_shifts s left join branches b on b.id = s.branch_id and b.tenant_id = s.tenant_id left join stock_locations l on l.id = s.location_id and l.tenant_id = s.tenant_id left join users ou on ou.id = s.opened_by and ou.tenant_id = s.tenant_id left join users cu on cu.id = s.closed_by and cu.tenant_id = s.tenant_id where s.tenant_id = ${scope.tenantId}`;
    if (filterStatus === 'open') {
      query = sql<ShiftRow>`${query} and s.status = 'open'`;
    } else if (filterStatus === 'closed') {
      query = sql<ShiftRow>`${query} and s.status = 'closed'`;
    } else if (filterStatus === 'pending_review') {
      query = sql<ShiftRow>`${query} and s.status = 'pending_review'`;
    }
    query = sql<ShiftRow>`${query} order by s.id desc`;
    const result = await query.execute(this.db);
    // INV-CLOSED-SHIFT-ROW: every row is hydrated, not only open
    // ones. Closed and pending_review rows used to be returned as
    // the raw database row, and this SELECT does not select the
    // sales-total columns at all, so the row showed sales 0.00 and
    // the frontend recomputed the difference from the zeroed cash
    // sales (the reported +625.80). hydrateShiftRow already keeps a
    // non-open shift's stored expected_cash, so the frozen close
    // figure is preserved; only the sales breakdown is computed
    // live, over the same frozen [created_at, closed_at] window the
    // close itself used.
    const hydratedRows = await Promise.all((result.rows ?? []).map((row) => this.hydrateShiftRow(row, auth)));
    const mapped = hydratedRows.map((row) => mapCashDrawerShiftRow(row));
    if (auth.role === 'cashier') {
      return mapped.map((row) => ({
        ...row,
        expectedCash: 0,
        variance: 0,
        cashSalesTotal: 0,
        cardSalesTotal: 0,
        walletSalesTotal: 0,
        instapaySalesTotal: 0,
        creditSalesTotal: 0,
        shiftSalesTotal: 0,
        // INV-SHIFT-CLOSE-DISCOUNT-SUMMARY: blinded for the cashier
        // viewer exactly like the other sales figures — the summary
        // is the manager's review figure.
        shiftDiscountTotal: 0,
        shiftDiscountGrossTotal: 0,
        shiftDiscountPercent: 0,
        cashDrawerMovementTotal: 0,
        cashDrawerCashInTotal: 0,
        cashDrawerDeliveryCashInTotal: 0,
        cashDrawerManualCashInTotal: 0,
        cashDrawerCashOutTotal: 0,
        saleCashTotal: 0,
        supplierPaymentsTotal: 0,
        expensesTotal: 0,
        serviceCashTotal: 0,
        serviceCardTotal: 0,
        serviceTotal: 0,
        saleReturnCashRefundTotal: 0,
        saleReturnCardRefundTotal: 0,
        saleReturnTotal: 0,
      }));
    }
    return mapped;
  }

  async getShift(shiftId: number, auth: AuthContext, queryable?: Kysely<Database>): Promise<ShiftRow | null> {
    const scope = this.scope(auth);
    const db = queryable || this.db;
    const result =
      await sql<ShiftRow>`select * from cashier_shifts where tenant_id = ${scope.tenantId} and id = ${shiftId} limit 1`.execute(
        db,
      );
    return result.rows?.[0] || null;
  }

  async computeShiftExpectedCash(shiftId: number, auth: AuthContext, queryable?: Kysely<Database>): Promise<number> {
    const shift = await this.getShift(shiftId, auth, queryable);
    return shift ? this.computeShiftExpectedCashFromShift(shift, auth, undefined, undefined, queryable) : 0;
  }

  /**
   * INV-CLOSED-SHIFT-POST-CLOSE-REFRESH: refresh the STORED summary of
   * a closed or pending_review shift after a post-close sale edit or
   * cancel, inside the caller's transaction. The correction recomputes
   * exactly what close would compute — the same
   * computeShiftExpectedCashFromShift over the same stored closed_at
   * window — and rewrites expected_cash/variance only when the
   * recomputation differs, stamping the original figures onto
   * close_note. Open shifts return refreshed=false (their figures
   * recompute on read); a recomputation equal to the stored figures
   * (the usual cancel outcome) also writes nothing. The POSTED
   * variance journal from close is never restated or re-posted here.
   * The caller must hold the sale mutation in the same transaction so
   * a failed refresh rolls the sale change back with it.
   */
  async refreshClosedShiftSummary(
    queryable: Kysely<Database>,
    shiftId: number,
    stamp: { saleId: number; kind: 'edit' | 'cancel' | 'offline_sync'; reason: string; auth: AuthContext },
  ): Promise<{
    refreshed: boolean;
    previousExpectedCash: number;
    correctedExpectedCash: number;
    previousVariance: number;
    correctedVariance: number;
  }> {
    const auth = stamp.auth;
    const scope = this.scope(auth);
    const locked = await queryable
      .selectFrom('cashier_shifts')
      .selectAll()
      .where('id', '=', shiftId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();
    const previousExpectedCash = Number((locked as ShiftRow | undefined)?.expected_cash || 0);
    const previousVariance = Number((locked as ShiftRow | undefined)?.variance || 0);
    const noChange = {
      refreshed: false,
      previousExpectedCash,
      correctedExpectedCash: previousExpectedCash,
      previousVariance,
      correctedVariance: previousVariance,
    };
    if (!locked || String((locked as ShiftRow).status || '') === 'open') return noChange;

    const digits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const correctedExpectedCash = await this.computeShiftExpectedCashFromShift(
      locked as ShiftRow,
      auth,
      undefined,
      undefined,
      queryable,
      digits,
    );
    const countedCash = Number((locked as ShiftRow).counted_cash || 0);
    const correctedVariance = computeCashDrawerVariance(countedCash, correctedExpectedCash, digits);
    if (correctedExpectedCash === previousExpectedCash && correctedVariance === previousVariance) {
      return noChange;
    }

    const correction: PostCloseCorrectionStamp = {
      at: new Date().toISOString(),
      saleId: Number(stamp.saleId),
      kind: stamp.kind,
      previousExpectedCash,
      correctedExpectedCash,
      previousVariance,
      correctedVariance,
      reason: String(stamp.reason || '')
        .trim()
        .slice(0, 200),
      byUserId: Number(auth.userId || 0) || null,
      byUsername: String(auth.username || ''),
    };
    const closeNote = this.appendPostCloseCorrectionNote((locked as ShiftRow).close_note, correction);
    await sql`update cashier_shifts set expected_cash = ${correctedExpectedCash}, variance = ${correctedVariance}, close_note = ${closeNote} where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(
      queryable,
    );
    return {
      refreshed: true,
      previousExpectedCash,
      correctedExpectedCash,
      previousVariance,
      correctedVariance,
    };
  }

  private appendPostCloseCorrectionNote(rawNote: unknown, stamp: PostCloseCorrectionStamp): string {
    const parsed = this.parseBlindCloseNote(rawNote);
    if (parsed) {
      const corrections = [...(parsed.postCloseCorrections || []), stamp];
      return this.serializeBlindCloseNote({ ...parsed, postCloseCorrections: corrections });
    }
    const kindLabel = stamp.kind === 'edit' ? 'تعديل' : stamp.kind === 'offline_sync' ? 'مزامنة أوفلاين' : 'إلغاء';
    const line = `تصحيح بعد الإغلاق [${stamp.at}]: فاتورة S-${stamp.saleId} (${kindLabel}) — المتوقع من ${stamp.previousExpectedCash} إلى ${stamp.correctedExpectedCash}، الفرق من ${stamp.previousVariance} إلى ${stamp.correctedVariance}، السبب: ${stamp.reason}، بواسطة ${stamp.byUsername}.`;
    const existing = String(rawNote || '').trim();
    return existing ? `${existing}\n\n${line}` : line;
  }

  async listCashierShifts(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const filter = String(query.filter || query.status || 'all')
      .trim()
      .toLowerCase();
    const filterStatus = filter === 'open' || filter === 'closed' || filter === 'pending_review' ? filter : undefined;
    const mapped = await this.rawList(auth, filterStatus);
    // "today" filter keys shifts on the tenant day, not the UTC day (INV-SINGLE-SERVER-CLOCK-TENANT-TZ).
    const filtered = filterCashDrawerRows(
      mapped,
      { ...query, filter },
      undefined,
      await getTenantTimezone(this.db, this.scope(auth).tenantId),
    );
    const paged = paginateCashDrawerRows(filtered, query);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, this.scope(auth).tenantId));
    return {
      cashierShifts: paged.rows,
      pagination: paged.pagination,
      summary: summarizeCashDrawerRows(filtered, digits),
      viewerRole: auth.role,
    };
  }

  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I21): the second-approval cap is
   * the SAME cashierShortageTolerance the variance posting reads
   * (accounting-posting.service.ts getCashierShortageTolerance):
   * unset → one minor unit; an explicitly configured value —
   * including 0 — honoured exactly; unparseable or negative → 0;
   * a read error → 0. A second cap would let the close gate and
   * the GL charge disagree about what "within tolerance" means.
   */
  async getCashierShortageTolerance(
    queryable: Kysely<Database>,
    tenantId: string,
    digits: MoneyDigits,
  ): Promise<number> {
    try {
      const row = await queryable
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', tenantId)
        .where('key', '=', 'cashierShortageTolerance')
        .executeTakeFirst();
      if (row == null || row.value == null || String(row.value).trim() === '') return 10 ** -digits;
      let raw: unknown = row.value;
      try {
        raw = JSON.parse(String(row.value));
      } catch {
        /* plain scalar */
      }
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I20): what still strands a
   * close — held (open-table) sales of the opener on this branch
   * from this shift's window, and draft sales of the opener in
   * the window. Both are read under the shift-row lock on the
   * transaction handle, so a table held a millisecond before the
   * close cannot slip through.
   */
  async findOpenTablesBlockingClose(
    queryable: Kysely<Database>,
    tenantId: string,
    shift: ShiftRow,
  ): Promise<{ heldCount: number; heldTables: string[]; draftCount: number; totalCount: number }> {
    const openerId = Number(shift.opened_by || 0);
    const branchId = shift.branch_id ? Number(shift.branch_id) : null;
    const held = await sql<{ table_number?: string | null }>`
      select table_number from held_sales
      where tenant_id = ${tenantId} and created_by = ${openerId}
        and created_at >= ${shift.created_at}
        and (${branchId}::int is null or branch_id is null or branch_id = ${branchId})
    `.execute(queryable);
    const drafts = await sql<{ id?: number }>`
      select id from sales
      where tenant_id = ${tenantId} and status = 'draft' and created_by = ${openerId}
        and created_at >= ${shift.created_at}
        and (${branchId}::int is null or branch_id is null or branch_id = ${branchId})
    `.execute(queryable);
    const heldTables = (held.rows || []).map((row) => String(row.table_number || '').trim()).filter(Boolean);
    const heldCount = (held.rows || []).length;
    const draftCount = (drafts.rows || []).length;
    return { heldCount, heldTables, draftCount, totalCount: heldCount + draftCount };
  }
}
