import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AppError } from '../../common/errors/app-error';
import { assertCashDrawerAmount, assertCashDrawerCountedCash, assertCashDrawerNote, buildCashDrawerShiftDocNo, computeCashDrawerVariance, filterCashDrawerRows, mapCashDrawerShiftRow, normalizeCashDrawerMovementType, normalizeShiftOpenPayload, paginateCashDrawerRows, summarizeCashDrawerRows, toSignedCashDrawerAmount, buildShiftCashReturnItem, isDrawerCashTender } from './helpers/cash-drawer.helper';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { verifyPassword } from '../../core/auth/utils/password-hasher';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';

type ShiftRow = {
  id?: number | string;
  doc_no?: string | null;
  branch_id?: number | string | null;
  location_id?: number | string | null;
  opened_by?: number | string | null;
  cash_sales_total?: number | string | null;
  card_sales_total?: number | string | null;
  wallet_sales_total?: number | string | null;
  instapay_sales_total?: number | string | null;
  credit_sales_total?: number | string | null;
  delivery_sales_total?: number | string | null;
  delivery_fee_total?: number | string | null;
  freelance_delivery_fee_total?: number | string | null;
  store_delivery_fee_total?: number | string | null;
  net_store_sales_total?: number | string | null;
  shift_sales_total?: number | string | null;
  tip_sales_total?: number | string | null;
  sale_count?: number | string | null;
  mixed_sale_count?: number | string | null;
  card_operation_count?: number | string | null;
  wallet_operation_count?: number | string | null;
  instapay_operation_count?: number | string | null;
  cash_drawer_movement_total?: number | string | null;
  cash_drawer_cash_in_total?: number | string | null;
  cash_drawer_delivery_cash_in_total?: number | string | null;
  cash_drawer_manual_cash_in_total?: number | string | null;
  cash_drawer_cash_out_total?: number | string | null;
  supplier_payments_total?: number | string | null;
  expenses_total?: number | string | null;
  service_cash_total?: number | string | null;
  service_card_total?: number | string | null;
  service_total?: number | string | null;
  sale_return_cash_refund_total?: number | string | null;
  sale_return_card_refund_total?: number | string | null;
  sale_return_total?: number | string | null;
  opening_cash?: number | string | null;
  opening_note?: string | null;
  status?: string | null;
  expected_cash?: number | string | null;
  counted_cash?: number | string | null;
  variance?: number | string | null;
  close_note?: string | null;
  closed_by?: number | string | null;
  closed_at?: Date | string | null;
  created_at?: Date | string | null;
  branch_name?: string | null;
  location_name?: string | null;
  opened_by_name?: string | null;
  closed_by_name?: string | null;
  movement_items?: Array<{ id: string; kind: 'cash_in' | 'cash_out' | 'delivery' | 'expense' | 'supplier_payment' | 'return'; kindLabel: string; amount: number; note: string; createdAt: string }>;
};

type SettingsRow = { key?: string; value?: string | null };
type UserPasswordRow = { id?: number | string; is_active?: boolean | number | string | null; password_hash?: string | null; password_salt?: string | null };
type CashDrawerMovementRow = { cash_drawer_movement_total?: number | string | null };
type ShiftServiceBreakdown = { serviceCashTotal: number; serviceCardTotal: number; serviceTotal: number };
type ShiftSalesBreakdown = {
  cashSalesTotal: number;
  cardSalesTotal: number;
  walletSalesTotal: number;
  instapaySalesTotal: number;
  creditSalesTotal: number;
  deliverySalesTotal: number;
  shiftSalesTotal: number;
  tipSalesTotal: number;
  deliveryFeeTotal: number;
  freelanceDeliveryFeeTotal: number;
  storeDeliveryFeeTotal: number;
  netStoreSalesTotal: number;
  saleCount: number;
  mixedSalesCount: number;
  cardOperationCount: number;
  walletOperationCount: number;
  instapayOperationCount: number;
};
type ShiftSaleReturnTotals = { saleReturnCashRefundTotal: number; saleReturnCardRefundTotal: number; saleReturnTotal: number };
type CloseOperationDetailInput = { amount?: number; reference?: string };
type BlindCloseMetadata = { blindClose: true; declared: { cash: number; cardTotal: number; cardCount: number; walletTotal: number; walletCount: number; instapayTotal: number; instapayCount: number }; detailTotals: { card: number; wallet: number; instapay: number }; details: { card: Array<{ amount: number; reference?: string }>; wallet: Array<{ amount: number; reference?: string }>; instapay: Array<{ amount: number; reference?: string }> }; managerReview?: { note: string; reviewedById: number; reviewedByName: string; reviewedAt: string }; note: string };

const BLIND_CLOSE_NOTE_PREFIX = 'BLIND_CLOSE::';

@Injectable()
export class CashDrawerService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly accountingPosting: AccountingPostingService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {}

  private toMoney(value: unknown): number { return Number(Number(value || 0).toFixed(2)); }
  /**
   * Book-precision rounding for the EXPECTED-CASH computation only.
   * The legacy toMoney (2dp) stays for blind-close declared totals, which
   * are deliberately untouched by this change (see header).
   */
  private toBookMoney(value: unknown, digits: MoneyDigits): number { return roundMoney(Number(value || 0), digits); }
  private scope(auth: AuthContext) { return requireTenantScope(auth); }
  private normalizeOperationCount(value: unknown): number { const parsed = Number(value || 0); return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0; }
  private normalizeOperationDetails(details: unknown, maxCount: number): Array<{ amount: number; reference?: string }> {
    if (!Array.isArray(details) || details.length === 0) return [];
    const effectiveLimit = Math.max(maxCount, details.length);
    if (effectiveLimit <= 0) return [];
    return details.slice(0, effectiveLimit).map((entry) => {
      const amount = this.toMoney((entry as CloseOperationDetailInput)?.amount || 0);
      const reference = String((entry as CloseOperationDetailInput)?.reference || '').trim();
      return { amount: amount >= 0 ? amount : 0, ...(reference ? { reference } : {}) };
    });
  }
  private serializeBlindCloseNote(meta: BlindCloseMetadata): string { return `${BLIND_CLOSE_NOTE_PREFIX}${JSON.stringify(meta)}`; }
  private parseBlindCloseNote(rawNote: unknown): BlindCloseMetadata | null {
    const text = String(rawNote || '');
    if (!text.startsWith(BLIND_CLOSE_NOTE_PREFIX)) return null;
    try {
      const parsed = JSON.parse(text.slice(BLIND_CLOSE_NOTE_PREFIX.length).trim()) as BlindCloseMetadata;
      return parsed && typeof parsed === 'object' && parsed.blindClose === true ? parsed : null;
    } catch { return null; }
  }

  private async getManagerPin(auth: AuthContext): Promise<string> {
    const scope = this.scope(auth);
    const result = await sql<SettingsRow>`select key, value from settings where tenant_id = ${scope.tenantId} and key in ('managerPin', 'managerApprovalPin', 'manager_pin')`.execute(this.db);
    const value = result.rows?.find((row) => String(row.key || '').length > 0)?.value;
    if (typeof value === 'string' && value.trim()) {
      try { const parsed = JSON.parse(value); if (typeof parsed === 'string' && parsed.trim()) return parsed.trim(); } catch { return value.trim(); }
    }
    return '';
  }

  private async assertManagerPin(pin: string, auth: AuthContext): Promise<void> {
    const normalizedPin = String(pin || '').trim();
    if (!normalizedPin) {
      throw new AppError('أدخل رمز المشرف أو كلمة مرور الإدارة', 'MANAGER_PIN_INVALID', 400);
    }
    const expected = await this.getManagerPin(auth);
    if (expected && normalizedPin === expected) return;

    // Check if entered pin is an admin user password
    const scope = this.scope(auth);
    const adminUsers = await sql<UserPasswordRow>`
      select id, is_active, password_hash, password_salt
      from users
      where tenant_id = ${scope.tenantId} and is_active = true and role in ('admin', 'super_admin')
    `.execute(this.db);

    for (const admin of adminUsers.rows || []) {
      const check = await verifyPassword(normalizedPin, String(admin.password_hash || ''), String(admin.password_salt || ''));
      if (check.valid) return;
    }

    throw new AppError('رمز الاعتماد غير صحيح', 'MANAGER_PIN_INVALID', 400);
  }
  private shouldRequireManagerApprovalForCashOut(auth: AuthContext): boolean { return !['admin', 'super_admin', 'manager'].includes(String(auth.role || '').trim()); }
  private canReviewPendingShift(auth: AuthContext): boolean { return ['admin', 'super_admin', 'manager'].includes(String(auth.role || '').trim()); }

  private async assertCurrentUserPassword(password: string, auth: AuthContext): Promise<void> {
    const providedPassword = String(password || '').trim();
    if (!providedPassword) throw new AppError('أدخل كلمة مرور المستخدم الحالي', 'CURRENT_USER_PASSWORD_REQUIRED', 400);
    const scope = this.scope(auth);
    const result = await sql<UserPasswordRow>`select id, is_active, password_hash, password_salt from users where id = ${auth.userId} and tenant_id = ${scope.tenantId} limit 1`.execute(this.db);
    const user = result.rows?.[0] || null;
    if (!user || user.is_active === false || user.is_active === 0 || user.is_active === 'false') throw new AppError('المستخدم الحالي غير متاح', 'CURRENT_USER_NOT_FOUND', 400);
    const passwordCheck = await verifyPassword(providedPassword, String(user.password_hash || ''), String(user.password_salt || ''));
    if (!passwordCheck.valid) {
      try {
        await this.assertManagerPin(providedPassword, auth);
        return;
      } catch {
        throw new AppError('كلمة مرور المستخدم الحالي غير صحيحة', 'CURRENT_USER_PASSWORD_INVALID', 400);
      }
    }
  }

  private async isPasswordRequiredOnShiftOpen(auth: AuthContext): Promise<boolean> {
    const scope = this.scope(auth);
    const result = await sql<SettingsRow>`select key, value from settings where tenant_id = ${scope.tenantId} and key = 'requirePasswordOnShiftOpen' limit 1`.execute(this.db);
    const raw = result.rows?.[0]?.value;
    if (raw == null) return false;
    if (typeof raw === 'boolean') return raw;
    try {
      const parsed = JSON.parse(String(raw));
      return parsed === true || parsed === 'true' || parsed === 1 || parsed === '1';
    } catch {
      return String(raw).trim() === 'true' || String(raw).trim() === '1';
    }
  }

  private async assertCashDrawerApproval(movementType: 'cash_in' | 'cash_out', approvalSecret: string, auth: AuthContext): Promise<void> {
    if (movementType === 'cash_out' && this.shouldRequireManagerApprovalForCashOut(auth)) { await this.assertManagerPin(approvalSecret, auth); return; }
    await this.assertCurrentUserPassword(approvalSecret, auth);
  }

  private async computeShiftCashDrawerMovements(shiftId: number, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<{
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

  private async computeShiftSupplierPaymentsTotal(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<number> {
    const openerId = Number(shift.opened_by || 0); const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return 0;
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const shiftId = Number(shift.id || 0);
    const result = await sql<{ total?: number | string | null }>`
      select (
        coalesce((
          select sum(sp.amount)
          from supplier_payments sp
          where sp.tenant_id = ${scope.tenantId} and coalesce(sp.payment_channel,'cash') = 'cash'
            and sp.created_by = ${openerId} and sp.payment_date >= ${shift.created_at}
            and (${shift.closed_at || null}::timestamptz is null or sp.payment_date <= ${shift.closed_at || null})
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

  private async computeShiftExpensesTotal(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<number> {
    const openerId = Number(shift.opened_by || 0); const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return 0;
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{ total?: number | string | null }>`
      select coalesce(sum(e.amount), 0) as total
      from expenses e
      where e.tenant_id = ${scope.tenantId} and e.created_by = ${openerId}
        and (e.expense_date >= ${shift.created_at} or e.created_at >= ${shift.created_at})
        and (${shift.closed_at || null}::timestamptz is null or (e.expense_date <= ${shift.closed_at || null} and e.created_at <= ${shift.closed_at || null}))
        and (${shift.branch_id || null}::int is null or e.branch_id is null or e.branch_id = ${Number(shift.branch_id || 0) || null})
        and (${shift.location_id || null}::int is null or e.location_id is null or e.location_id = ${Number(shift.location_id || 0) || null})
    `.execute(queryable ?? this.db);
    return this.toBookMoney(result.rows?.[0]?.total || 0, bookDigits);
  }

  private async computeShiftServiceBreakdown(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<ShiftServiceBreakdown> {
    const openerId = Number(shift.opened_by || 0); const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return { serviceCashTotal: 0, serviceCardTotal: 0, serviceTotal: 0 };
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{ service_cash_total?: number | string | null; service_card_total?: number | string | null; service_total?: number | string | null }>`
      select coalesce(sum(case when coalesce(s.payment_channel, 'cash') = 'cash' then s.amount else 0 end), 0) as service_cash_total,
             coalesce(sum(case when coalesce(s.payment_channel, 'cash') = 'card' then s.amount else 0 end), 0) as service_card_total,
             coalesce(sum(s.amount), 0) as service_total
      from services s
      where s.tenant_id = ${scope.tenantId} and s.created_by = ${openerId}
        and (s.service_date >= ${shift.created_at} or s.created_at >= ${shift.created_at})
        and (${shift.closed_at || null}::timestamptz is null or (s.service_date <= ${shift.closed_at || null} and s.created_at <= ${shift.closed_at || null}))
        and (${shift.branch_id || null}::int is null or s.branch_id is null or s.branch_id = ${Number(shift.branch_id || 0) || null})
        and (${shift.location_id || null}::int is null or s.location_id is null or s.location_id = ${Number(shift.location_id || 0) || null})
    `.execute(queryable ?? this.db);
    const row = result.rows?.[0] || {};
    return { serviceCashTotal: this.toBookMoney(row.service_cash_total || 0, bookDigits), serviceCardTotal: this.toBookMoney(row.service_card_total || 0, bookDigits), serviceTotal: this.toBookMoney(row.service_total || 0, bookDigits) };
  }

  private async computeShiftSalesBreakdown(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<ShiftSalesBreakdown> {
    const openerId = Number(shift.opened_by || 0); const scope = this.scope(auth);
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
        where s.tenant_id = ${scope.tenantId} and s.status = 'posted' and s.created_by = ${openerId} and s.created_at >= ${shift.created_at}
          and (${shift.closed_at || null}::timestamptz is null or s.created_at <= ${shift.closed_at || null})
          and (${shift.branch_id || null}::int is null or s.branch_id is null or s.branch_id = ${Number(shift.branch_id || 0) || null})
          and (${shift.location_id || null}::int is null or s.location_id is null or s.location_id = ${Number(shift.location_id || 0) || null})
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

  private async computeShiftSaleReturnTotals(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<ShiftSaleReturnTotals> {
    const openerId = Number(shift.opened_by || 0); const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return { saleReturnCashRefundTotal: 0, saleReturnCardRefundTotal: 0, saleReturnTotal: 0 };
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{ sale_return_cash_refund_total: number | string; sale_return_card_refund_total: number | string; sale_return_total: number | string }>`
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
    return { saleReturnCashRefundTotal: this.toBookMoney(row.sale_return_cash_refund_total || 0, bookDigits), saleReturnCardRefundTotal: this.toBookMoney(row.sale_return_card_refund_total || 0, bookDigits), saleReturnTotal: this.toBookMoney(row.sale_return_total || 0, bookDigits) };
  }

  private async computeShiftCustomerCollections(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<number> {
    const openerId = Number(shift.opened_by || 0);
    const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return 0;
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{ total: string | number }>`
      select coalesce(sum(cp.amount), 0) as total
      from customer_payments cp
      where cp.tenant_id = ${scope.tenantId} and coalesce(cp.payment_channel,'cash') = 'cash' and cp.created_by = ${openerId}
        and cp.created_at >= ${shift.created_at}
        and (${shift.closed_at || null}::timestamptz is null or cp.created_at <= ${shift.closed_at || null})
        and (${shift.branch_id || null}::int is null or cp.branch_id is null or cp.branch_id = ${Number(shift.branch_id || 0) || null})
        and (${shift.location_id || null}::int is null or cp.location_id is null or cp.location_id = ${Number(shift.location_id || 0) || null})
    `.execute(queryable ?? this.db);
    return this.toBookMoney(result.rows?.[0]?.total || 0, bookDigits);
  }

  private async computeShiftCancelledSaleCashReceipts(
    shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits,
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
        and s.created_by = ${openerId} and s.created_at >= ${shift.created_at}
        and (${shift.closed_at || null}::timestamptz is null or s.created_at <= ${shift.closed_at || null})
        and (${shift.branch_id || null}::int is null or s.branch_id is null or s.branch_id = ${Number(shift.branch_id || 0) || null})
        and (${shift.location_id || null}::int is null or s.location_id is null or s.location_id = ${Number(shift.location_id || 0) || null})
    `.execute(queryable ?? this.db);
    return this.toBookMoney(result.rows?.[0]?.total || 0, bookDigits);
  }

  private async computeShiftExpectedCashFromShift(shift: ShiftRow, auth: AuthContext, salesBreakdown?: ShiftSalesBreakdown, serviceBreakdown?: ShiftServiceBreakdown, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<number> {
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, this.scope(auth).tenantId));
    const shiftId = Number(shift.id || 0);
    if (!(shiftId > 0)) return this.toBookMoney(shift.opening_cash || 0, bookDigits);
    const movements = await this.computeShiftCashDrawerMovements(shiftId, auth, queryable, bookDigits);
    const breakdown = salesBreakdown || await this.computeShiftSalesBreakdown(shift, auth, queryable, bookDigits);
    const services = serviceBreakdown || await this.computeShiftServiceBreakdown(shift, auth, queryable, bookDigits);
    const saleReturnTotals = await this.computeShiftSaleReturnTotals(shift, auth, queryable, bookDigits);
    const supplierPaymentsTotal = await this.computeShiftSupplierPaymentsTotal(shift, auth, queryable, bookDigits);
    const expensesTotal = await this.computeShiftExpensesTotal(shift, auth, queryable, bookDigits);
    const customerCollections = await this.computeShiftCustomerCollections(shift, auth, queryable, bookDigits);
    const cancelledCheckoutCash = await this.computeShiftCancelledSaleCashReceipts(shift, auth, queryable, bookDigits);
    const netDrawerMovement = movements.cashInTotal - movements.cashOutTotal;
    return this.toBookMoney(Number(shift.opening_cash || 0) + netDrawerMovement + breakdown.cashSalesTotal + cancelledCheckoutCash + services.serviceCashTotal + customerCollections - saleReturnTotals.saleReturnCashRefundTotal - supplierPaymentsTotal - expensesTotal, bookDigits);
  }

  private async fetchShiftMovementItems(shiftId: number, shift: ShiftRow, auth: AuthContext): Promise<Array<{
    id: string;
    kind: 'cash_in' | 'cash_out' | 'delivery' | 'expense' | 'supplier_payment' | 'return';
    kindLabel: string;
    amount: number;
    note: string;
    createdAt: string;
  }>> {
    const scope = this.scope(auth);
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
    const ttRows = await sql<{ id: number; amount: number | string; note?: string | null; txn_type?: string | null; created_at?: string | Date | null }>`
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
      const isDelivery = !isPurchaseRefund && !isSaleCancellation && (rawNote.includes('دليفري') || rawNote.includes('مندوب'));
      const kind = isDelivery ? 'delivery' : (amt > 0 ? 'cash_in' : 'cash_out');
      const kindLabel = isPurchaseRefund ? 'استرداد نقدي من مورد بعد مرتجع شراء'
        : isSaleCancellation ? 'رد نقدية فاتورة بيع ملغاة'
        : isDelivery
          ? (amt > 0 ? 'تحصيل وتسوية دليفري' : 'صرف أجرة طيار دليفري')
          : (amt > 0 ? 'إيداع نقدي بالدرج (يدوياً)' : 'مسحوبات نقدية من الدرج');

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
      const expRows = await sql<{ id: number; amount: number | string; title?: string | null; note?: string | null; expense_date?: string | Date | null; created_at?: string | Date | null }>`
        select e.id, e.amount, e.title, e.note, e.expense_date, e.created_at
        from expenses e
        where e.tenant_id = ${scope.tenantId} and e.created_by = ${openerId}
          and (e.expense_date >= ${shift.created_at} or e.created_at >= ${shift.created_at})
          and (${shift.closed_at || null}::timestamptz is null or (e.expense_date <= ${shift.closed_at || null} and e.created_at <= ${shift.closed_at || null}))
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
          createdAt: exp.expense_date ? new Date(exp.expense_date).toISOString() : (exp.created_at ? new Date(exp.created_at).toISOString() : ''),
        });
      }

      // 4. Supplier payments
      const supRows = await sql<{ id: number; amount: number | string; note?: string | null; supplier_name?: string | null; payment_date?: string | Date | null; payment_channel?: string | null }>`
        select sp.id, sp.amount, sp.note, sp.payment_date, sp.payment_channel, sup.name as supplier_name
        from supplier_payments sp
        left join suppliers sup on sup.id = sp.supplier_id and sup.tenant_id = sp.tenant_id
        where sp.tenant_id = ${scope.tenantId}
          and coalesce(sp.payment_channel, 'cash') = 'cash'
          and sp.created_by = ${openerId} and sp.payment_date >= ${shift.created_at}
          and (${shift.closed_at || null}::timestamptz is null or sp.payment_date <= ${shift.closed_at || null})
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
          createdAt: sup.payment_date ? new Date(sup.payment_date).toISOString() : '',
        });
      }

      // Customer debt collections are physical receipts at the same cashier drawer.
      // They are not sales and must not be counted in sales turnover.
      const customerRows = await sql<{ id: number; amount: number | string; note?: string | null; created_at?: string | Date | null }>`
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
        items.push({ id: `cp-${receipt.id}`, kind: 'cash_in', kindLabel: 'تحصيل من عميل آجل',
          amount: Math.abs(Number(receipt.amount || 0)), note: String(receipt.note || 'سند قبض عميل').trim(),
          createdAt: receipt.created_at ? new Date(receipt.created_at).toISOString() : '' });
      }

      // 5. Cash paid out by THIS drawer for sale returns. A return document
      // may have mixed cash/card/store-credit allocations or may belong to
      // a different cashier's shift. Only linked cash treasury legs belong here.
      const retRows = await sql<{ id: number; doc_no?: string | null;
        cash_refund?: number | string | null; note?: string | null;
        created_at?: string | Date | null }>`
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
        const item = buildShiftCashReturnItem(ret);
        if (item) items.push(item);
      }
    }

    return items;
  }

  private async hydrateShiftRow(row: ShiftRow, auth: AuthContext): Promise<ShiftRow> {
    const shiftId = Number(row.id || 0);
    if (!(shiftId > 0)) return row;
    const salesBreakdown = await this.computeShiftSalesBreakdown(row, auth);
    const serviceBreakdown = await this.computeShiftServiceBreakdown(row, auth);
    const movements = await this.computeShiftCashDrawerMovements(shiftId, auth);
    const saleReturnTotals = await this.computeShiftSaleReturnTotals(row, auth);
    const supplierPaymentsTotal = await this.computeShiftSupplierPaymentsTotal(row, auth);
    const expensesTotal = await this.computeShiftExpensesTotal(row, auth);
    const movementItems = await this.fetchShiftMovementItems(shiftId, row, auth);
    const expectedCash = String(row.status || 'open') === 'open' ? await this.computeShiftExpectedCashFromShift(row, auth, salesBreakdown, serviceBreakdown) : Number(row.expected_cash || 0);
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
      supplier_payments_total: supplierPaymentsTotal,
      expenses_total: expensesTotal,
      service_cash_total: serviceBreakdown.serviceCashTotal,
      service_card_total: serviceBreakdown.serviceCardTotal,
      service_total: serviceBreakdown.serviceTotal,
      sale_return_cash_refund_total: saleReturnTotals.saleReturnCashRefundTotal,
      sale_return_card_refund_total: saleReturnTotals.saleReturnCardRefundTotal,
      sale_return_total: saleReturnTotals.saleReturnTotal,
      movement_items: movementItems,
    };
  }

  private async rawList(auth: AuthContext, filterStatus?: string): Promise<Array<Record<string, unknown>>> {
    const scope = this.scope(auth);
    let query = sql<ShiftRow>`select s.id, s.doc_no, s.branch_id, s.location_id, s.opened_by, s.opening_cash, s.opening_note, s.status, s.expected_cash, s.counted_cash, s.variance, s.close_note, s.closed_by, s.closed_at, s.created_at, coalesce(b.name, '') as branch_name, coalesce(l.name, '') as location_name, coalesce(ou.username, '') as opened_by_name, coalesce(cu.username, '') as closed_by_name from cashier_shifts s left join branches b on b.id = s.branch_id and b.tenant_id = s.tenant_id left join stock_locations l on l.id = s.location_id and l.tenant_id = s.tenant_id left join users ou on ou.id = s.opened_by and ou.tenant_id = s.tenant_id left join users cu on cu.id = s.closed_by and cu.tenant_id = s.tenant_id where s.tenant_id = ${scope.tenantId}`;
    if (filterStatus === 'open') {
      query = sql<ShiftRow>`${query} and s.status = 'open'`;
    } else if (filterStatus === 'closed') {
      query = sql<ShiftRow>`${query} and s.status = 'closed'`;
    } else if (filterStatus === 'pending_review') {
      query = sql<ShiftRow>`${query} and s.status = 'pending_review'`;
    }
    query = sql<ShiftRow>`${query} order by s.id desc`;
    const result = await query.execute(this.db);
    const hydratedRows = await Promise.all(
      (result.rows ?? []).map((row) => {
        if (String(row.status || 'open') === 'open') {
          return this.hydrateShiftRow(row, auth);
        }
        return row;
      }),
    );
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
        cashDrawerMovementTotal: 0,
        cashDrawerCashInTotal: 0,
        cashDrawerDeliveryCashInTotal: 0,
        cashDrawerManualCashInTotal: 0,
        cashDrawerCashOutTotal: 0,
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
    const result = await sql<ShiftRow>`select * from cashier_shifts where tenant_id = ${scope.tenantId} and id = ${shiftId} limit 1`.execute(db);
    return result.rows?.[0] || null;
  }

  async computeShiftExpectedCash(shiftId: number, auth: AuthContext, queryable?: Kysely<Database>): Promise<number> {
    const shift = await this.getShift(shiftId, auth, queryable);
    return shift ? this.computeShiftExpectedCashFromShift(shift, auth, undefined, undefined, queryable) : 0;
  }

  async listCashierShifts(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const filter = String(query.filter || query.status || 'all').trim().toLowerCase();
    const filterStatus = filter === 'open' || filter === 'closed' || filter === 'pending_review' ? filter : undefined;
    const mapped = await this.rawList(auth, filterStatus);
    const filtered = filterCashDrawerRows(mapped, { ...query, filter });
    const paged = paginateCashDrawerRows(filtered, query);
    return { cashierShifts: paged.rows, pagination: paged.pagination, summary: summarizeCashDrawerRows(filtered), viewerRole: auth.role };
  }

  async openCashierShift(payload: { openingCash?: number; note?: string; branchId?: number | string | null; locationId?: number | string | null; password?: string; managerPin?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    const { openingCash, note, branchId, locationId, password } = normalizeShiftOpenPayload(payload);
    if (!Number.isFinite(openingCash) || openingCash < 0 || openingCash > 1_000_000_000_000) {
      throw new AppError('رصيد الافتتاح يجب أن يكون رقماً صالحاً وغير سالب', 'OPENING_CASH_INVALID', 400);
    }
    for (const id of [branchId, locationId]) {
      if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) throw new AppError('Invalid branch/location ID', 'SHIFT_SCOPE_INVALID', 400);
    }

    const isPasswordRequired = await this.isPasswordRequiredOnShiftOpen(auth);
    if (isPasswordRequired) {
      if (!password) {
        throw new AppError('أدخل كلمة المرور لتأكيد فتح الوردية', 'CURRENT_USER_PASSWORD_REQUIRED', 400);
      }
      await this.assertCurrentUserPassword(password, auth);
    }

    await this.tx.runInTransaction(this.db, async (trx) => {
      let resolvedBranchId = branchId;
      // Serialize opens for the same cashier before checking for an existing shift.
      const user = await trx.selectFrom('users').select(['id', 'default_branch_id'])
        .where('id', '=', auth.userId).where('tenant_id', '=', scope.tenantId)
        .forUpdate().executeTakeFirst();
      if (!user) throw new AppError('المستخدم غير موجود في المنشأة', 'CASHIER_NOT_FOUND', 404);
      if (branchId != null) {
        const branch = await trx.selectFrom('branches').select('id')
          .where('id', '=', branchId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        if (!branch) throw new AppError('الفرع غير موجود في المنشأة', 'BRANCH_NOT_FOUND', 404);
      }
      if (locationId != null) {
        const location = await trx.selectFrom('stock_locations').select(['id', 'branch_id'])
          .where('id', '=', locationId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        if (!location || (branchId != null && Number(location.branch_id) !== Number(branchId))) {
          throw new AppError('المخزن لا يتبع الفرع المحدد', 'SHIFT_LOCATION_MISMATCH', 400);
        }
        if (resolvedBranchId == null && location.branch_id != null) resolvedBranchId = Number(location.branch_id);
      }
      if (!['owner', 'admin', 'super_admin'].includes(auth.role)) {
        if (resolvedBranchId == null) throw new AppError('يجب فتح وردية في فرع مسند للمستخدم', 'SHIFT_BRANCH_REQUIRED', 403);
        const assigned = await trx.selectFrom('user_branches')
          .select('branch_id').where('tenant_id', '=', scope.tenantId)
          .where('user_id', '=', auth.userId).where('branch_id', '=', resolvedBranchId)
          .executeTakeFirst();
        if (!assigned && Number(user.default_branch_id) !== resolvedBranchId) {
          throw new AppError('الفرع غير مسند لهذا الكاشير', 'SHIFT_BRANCH_FORBIDDEN', 403);
        }
      }
      const active = await trx.selectFrom('cashier_shifts').select('id')
        .where('tenant_id', '=', scope.tenantId).where('opened_by', '=', auth.userId)
        .where('status', '=', 'open').executeTakeFirst();
      if (active) throw new AppError('يوجد وردية مفتوحة بالفعل لهذا المستخدم', 'SHIFT_ALREADY_OPEN', 400);
      const inserted = await sql<{ id?: number }>`insert into cashier_shifts (doc_no, branch_id, location_id, opened_by, opening_cash, opening_note, status, expected_cash, tenant_id, account_id) values (null, ${resolvedBranchId}, ${locationId}, ${auth.userId}, ${openingCash}, ${note}, 'open', ${openingCash}, ${scope.tenantId}, ${scope.accountId}) returning id`.execute(trx);
      const shiftId = Number(inserted.rows?.[0]?.id || 0);
      if (!shiftId) throw new AppError('Could not open cashier shift', 'SHIFT_OPEN_FAILED', 400);
      await sql`update cashier_shifts set doc_no = ${buildCashDrawerShiftDocNo(shiftId)} where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
    });
    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary };
  }

  async recordCashMovement(shiftId: number, payload: { type?: string; amount?: number; note?: string; managerPin?: string; requestKey?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    if (!(shiftId > 0)) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    const shift = await this.getShift(shiftId, auth);
    if (!shift) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    if (String(shift.status || 'open') !== 'open') throw new AppError('لا يمكن تسجيل حركة على وردية مغلقة', 'SHIFT_CLOSED', 400);
    if (Number(shift.opened_by || 0) !== Number(auth.userId || 0) && auth.role !== 'super_admin') throw new AppError('غير مسموح لك بتعديل هذه الوردية', 'SHIFT_FORBIDDEN', 403);
    const movementType = normalizeCashDrawerMovementType(payload.type);
    const amount = Number(payload.amount || 0);
    const note = String(payload.note || '').trim();
    assertCashDrawerAmount(amount); assertCashDrawerNote(note);
    // Idempotency key: mandatory, client-supplied, no server default --
    // mirroring createExpense. Checked before the approval check so an
    // invalid key fails fast without consuming a password/PIN attempt.
    const requestKey = String(payload.requestKey || '').trim();
    if (requestKey.length < 8 || requestKey.length > 160) {
      throw new AppError('A stable drawer movement request key is required', 'DRAWER_REQUEST_KEY_REQUIRED', 400);
    }
    await this.assertCashDrawerApproval(movementType, String(payload.managerPin || '').trim(), auth);
    const signedAmount = toSignedCashDrawerAmount(movementType, amount);

    // The drawer movement and the expected_cash recomputation must be atomic and serialized on the
    // shift row. Without the lock, two concurrent movements interleave as insert/insert/compute/compute
    // and the second UPDATE overwrites the first with a stale figure (lost update). Re-checking the
    // status under the lock also closes the window where a movement lands on a shift being closed.
    await this.tx.runInTransaction(this.db, async (trx) => {
      const lockedShift = await trx
        .selectFrom('cashier_shifts')
        .selectAll()
        .where('id', '=', shiftId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedShift) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
      if (String(lockedShift.status || 'open') !== 'open') throw new AppError('لا يمكن تسجيل حركة على وردية مغلقة', 'SHIFT_CLOSED', 400);

      // INV-CASH-DRAWER-MOVEMENT-IDEMPOTENCY: a retry with the same key
      // and the same payload returns the current listing without
      // inserting a second treasury row or posting a second journal.
      // The lookup runs under the shift-row lock, so two retries for
      // the same shift serialize here. The stored row carries only
      // txn_type, signed amount, and the composed note, so the payload
      // comparison reconstructs exactly those stored values (the
      // manager PIN is an approval credential, not payload identity,
      // and is deliberately excluded). A row inserted between the
      // lookup and the insert (same key on another shift) hits the
      // partial unique index and surfaces as a 409 conflict.
      const expectedNote = `وردية ${shift.doc_no || shift.id}: ${note}`;
      const existing = await sql<{ id: number; txn_type: string; amount: number; note: string }>`
        SELECT id, txn_type, amount, note
        FROM treasury_transactions
        WHERE tenant_id = ${scope.tenantId} AND request_key = ${requestKey}
          AND reference_type = 'cashier_shift' AND reference_id = ${shiftId}
        FOR UPDATE
      `.execute(trx);
      const prior = existing.rows[0];
      if (prior) {
        if (String(prior.txn_type || '') !== movementType
          || Number(prior.amount) !== signedAmount
          || String(prior.note || '') !== expectedNote) {
          throw new AppError('Drawer movement request key was already used with different data', 'DRAWER_IDEMPOTENCY_CONFLICT', 409);
        }
        return false;
      }

      let insertRes: { rows: Array<{ id: number }> };
      try {
        insertRes = await sql<{ id: number }>`insert into treasury_transactions (txn_type, amount, note, reference_type, reference_id, branch_id, location_id, created_by, tenant_id, account_id, request_key) values (${movementType}, ${signedAmount}, ${expectedNote}, 'cashier_shift', ${shiftId}, ${shift.branch_id ? Number(shift.branch_id) : null}, ${shift.location_id ? Number(shift.location_id) : null}, ${auth.userId}, ${scope.tenantId}, ${scope.accountId}, ${requestKey}) returning id`.execute(trx);
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        const message = err instanceof Error ? err.message : String(err || '');
        if (code === '23505' || message.includes('idx_treasury_txns_drawer_request_key_uniq')) {
          throw new AppError('Drawer movement request key was already used with different data', 'DRAWER_IDEMPOTENCY_CONFLICT', 409);
        }
        throw err;
      }
      const expectedCash = await this.computeShiftExpectedCashFromShift(lockedShift as ShiftRow, auth, undefined, undefined, trx);
      await sql`update cashier_shifts set expected_cash = ${expectedCash} where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);

      if (movementType === 'cash_in' || movementType === 'cash_out') {
        const txnId = Number(insertRes.rows?.[0]?.id || 0);
        if (txnId > 0) {
          await this.accountingPosting.postCashDrawerMovement(
            trx,
            txnId,
            movementType,
            amount,
            `وردية ${shift.doc_no || shift.id}: ${note}`,
            shift.branch_id ? Number(shift.branch_id) : null,
            shift.location_id ? Number(shift.location_id) : null,
            auth,
          );
        }
      }
      return true;
    });

    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary };
  }

  async closeCashierShift(shiftId: number, payload: { countedCash?: number; cardDeclaredTotal?: number; cardOperationCount?: number; walletDeclaredTotal?: number; walletOperationCount?: number; instapayDeclaredTotal?: number; instapayOperationCount?: number; cardDetails?: Array<{ amount?: number; reference?: string }>; walletDetails?: Array<{ amount?: number; reference?: string }>; instapayDetails?: Array<{ amount?: number; reference?: string }>; note?: string; managerPin?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    if (!(shiftId > 0)) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    const shift = await this.getShift(shiftId, auth);
    if (!shift) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    if (String(shift.status || 'open') !== 'open') throw new AppError('الوردية مغلقة بالفعل', 'SHIFT_ALREADY_CLOSED', 400);
    if (Number(shift.opened_by || 0) !== Number(auth.userId || 0) && auth.role !== 'super_admin') throw new AppError('غير مسموح لك بإغلاق هذه الوردية', 'SHIFT_FORBIDDEN', 403);
    const countedCash = Number(payload.countedCash || 0);
    const note = String(payload.note || '').trim();
    const isBlindCloseCashier = String(auth.role || '').trim() === 'cashier';
    assertCashDrawerCountedCash(countedCash);
    await this.assertCurrentUserPassword(String(payload.managerPin || '').trim(), auth);
    const cardOperationCount = this.normalizeOperationCount(payload.cardOperationCount);
    const walletOperationCount = this.normalizeOperationCount(payload.walletOperationCount);
    const instapayOperationCount = this.normalizeOperationCount(payload.instapayOperationCount);
    const cardDetails = this.normalizeOperationDetails(payload.cardDetails, cardOperationCount);
    const walletDetails = this.normalizeOperationDetails(payload.walletDetails, walletOperationCount);
    const instapayDetails = this.normalizeOperationDetails(payload.instapayDetails, instapayOperationCount);
    const blindCloseMeta: BlindCloseMetadata | null = isBlindCloseCashier ? { blindClose: true, declared: { cash: this.toMoney(countedCash), cardTotal: this.toMoney(payload.cardDeclaredTotal || 0), cardCount: cardOperationCount, walletTotal: this.toMoney(payload.walletDeclaredTotal || 0), walletCount: walletOperationCount, instapayTotal: this.toMoney(payload.instapayDeclaredTotal || 0), instapayCount: instapayOperationCount }, detailTotals: { card: this.toMoney(cardDetails.reduce((sum, row) => sum + row.amount, 0)), wallet: this.toMoney(walletDetails.reduce((sum, row) => sum + row.amount, 0)), instapay: this.toMoney(instapayDetails.reduce((sum, row) => sum + row.amount, 0)) }, details: { card: cardDetails, wallet: walletDetails, instapay: instapayDetails }, note } : null;
    const closeStatus = isBlindCloseCashier ? 'pending_review' : 'closed';
    const closeNoteValue = blindCloseMeta ? this.serializeBlindCloseNote(blindCloseMeta) : note;

    await this.tx.runInTransaction(this.db, async (trx) => {
      const lockedShift = await trx
        .selectFrom('cashier_shifts')
        .selectAll()
        .where('id', '=', shiftId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedShift) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
      if (String(lockedShift.status || 'open') !== 'open') throw new AppError('الوردية مغلقة بالفعل', 'SHIFT_ALREADY_CLOSED', 400);

      // Compute on the transaction, not on the pool: reading via this.db uses a separate connection
      // that cannot see anything written in this transaction, and reads outside the row lock taken above.
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const expectedCash = await this.computeShiftExpectedCashFromShift(lockedShift as ShiftRow, auth, undefined, undefined, trx);
      const variance = computeCashDrawerVariance(countedCash, expectedCash, digits);
      // Any real variance needs a note: the old 0.01 cutoff let a KWD
      // cashier close a shift 9 fils short with no explanation at all.
      if (!isBlindCloseCashier && variance !== 0) assertCashDrawerNote(note);

      await sql`update cashier_shifts set status = ${closeStatus}, expected_cash = ${expectedCash}, counted_cash = ${countedCash}, variance = ${variance}, close_note = ${closeNoteValue}, closed_by = ${auth.userId}, closed_at = now() where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
      if (closeStatus === 'closed') {
        await this.accountingPosting.postCashierShiftVariance(trx, shiftId, auth);
      }
    });

    if (this.whatsappService) {
      void this.whatsappService.sendShiftCloseNotification(shiftId, scope.tenantId).catch(() => undefined);
    }

    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary };
  }

  async reviewCashierShiftClose(shiftId: number, payload: { note?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    if (!(shiftId > 0)) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    if (!this.canReviewPendingShift(auth)) throw new AppError('غير مسموح لك بمراجعة إغلاق الوردية', 'SHIFT_REVIEW_FORBIDDEN', 403);
    const shift = await this.getShift(shiftId, auth);
    if (!shift) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    if (String(shift.status || '') !== 'pending_review') throw new AppError('الوردية ليست في انتظار مراجعة المدير', 'SHIFT_NOT_PENDING_REVIEW', 400);
    const managerNote = String(payload.note || '').trim();
    const rawCloseNote = String(shift.close_note || '');
    const parsedBlindClose = this.parseBlindCloseNote(rawCloseNote);
    let closeNoteValue = rawCloseNote;
    if (parsedBlindClose) {
      parsedBlindClose.managerReview = { note: managerNote, reviewedById: Number(auth.userId || 0), reviewedByName: String(auth.username || ''), reviewedAt: new Date().toISOString() };
      closeNoteValue = this.serializeBlindCloseNote(parsedBlindClose);
    } else if (managerNote) {
      closeNoteValue = rawCloseNote ? `${rawCloseNote}\n\nملاحظة مراجعة المدير: ${managerNote}` : `ملاحظة مراجعة المدير: ${managerNote}`;
    }

    await this.tx.runInTransaction(this.db, async (trx) => {
      const lockedShift = await trx.selectFrom('cashier_shifts').select('status').where('id', '=', shiftId).where('tenant_id', '=', scope.tenantId).forUpdate().executeTakeFirst();
      if (!lockedShift || lockedShift.status !== 'pending_review') throw new AppError('الوردية ليست في انتظار مراجعة المدير', 'SHIFT_NOT_PENDING_REVIEW', 409);

      await sql`update cashier_shifts set status = 'closed', close_note = ${closeNoteValue}, closed_by = coalesce(closed_by, ${auth.userId}), closed_at = coalesce(closed_at, now()), updated_at = now() where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
      await this.accountingPosting.postCashierShiftVariance(trx, shiftId, auth);
    });
    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary };
  }
}
