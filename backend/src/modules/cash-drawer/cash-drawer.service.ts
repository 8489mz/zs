import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AppError } from '../../common/errors/app-error';
import { assertCashDrawerAmount, assertCashDrawerCountedCash, assertCashDrawerNote, buildCashDrawerShiftDocNo, buildExpectedCashBreakdown, computeCashDrawerVariance, filterCashDrawerRows, mapCashDrawerShiftRow, normalizeCashDrawerMovementType, normalizeShiftOpenPayload, paginateCashDrawerRows, requiresSecondApproval, summarizeCashDrawerRows, toSignedCashDrawerAmount, buildShiftCashReturnItem, isDrawerCashTender, isCashDrawerTransferType } from './helpers/cash-drawer.helper';
import type { BlindCloseChannelReconciliation, BlindCloseReconciliation, CashDrawerMovementType } from './helpers/cash-drawer.helper';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { verifyPassword } from '../../core/auth/utils/password-hasher';
import { authorizeManagerSecret } from '../../common/utils/manager-approval';
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
  sale_cash_total?: number | string | null;
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
  terminal_code?: string | null;
  customerCollectionsTotal?: number | string | null;
  cancelledSaleCashTotal?: number | string | null;
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
type BlindCloseMetadata = { blindClose: true; declared: { cash: number; cardTotal: number; cardCount: number; walletTotal: number; walletCount: number; instapayTotal: number; instapayCount: number }; detailTotals: { card: number; wallet: number; instapay: number }; details: { card: Array<{ amount: number; reference?: string }>; wallet: Array<{ amount: number; reference?: string }>; instapay: Array<{ amount: number; reference?: string }> }; managerReview?: { note: string; reviewedById: number; reviewedByName: string; reviewedAt: string }; rejection?: { note: string; rejectedById: number; rejectedByName: string; rejectedAt: string }; reconciliation?: BlindCloseReconciliation; postCloseCorrections?: Array<PostCloseCorrectionStamp>; note: string };

/**
 * One stamped post-close correction (INV-CLOSED-SHIFT-POST-CLOSE-REFRESH):
 * the recomputed summary for a closed shift after a sale edit/cancel,
 * with the original figures preserved so the close record is never
 * silently overwritten. Stored inside the blind-close JSON for blind
 * closes; rendered as a text line for ordinary close notes.
 */
export type PostCloseCorrectionStamp = {
  at: string;
  saleId: number;
  kind: 'edit' | 'cancel' | 'offline_sync';
  previousExpectedCash: number;
  correctedExpectedCash: number;
  previousVariance: number;
  correctedVariance: number;
  reason: string;
  byUserId: number | null;
  byUsername: string;
};

const BLIND_CLOSE_NOTE_PREFIX = 'BLIND_CLOSE::';

@Injectable()
export class CashDrawerService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly accountingPosting: AccountingPostingService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {}

  /**
   * Book-precision rounding for the EXPECTED-CASH computation and,
   * since INV-BLIND-CLOSE-DECLARED-RECONCILIATION, for blind-close
   * declared totals too: the legacy 2dp toMoney truncated a KWD
   * 100.005 declaration to 100.01 at close, manufacturing a 0.005
   * reconciliation delta out of storage rounding alone. Declared
   * values stored at 2dp before the package parse back identically.
   */
  private toBookMoney(value: unknown, digits: MoneyDigits): number { return roundMoney(Number(value || 0), digits); }
  private scope(auth: AuthContext) { return requireTenantScope(auth); }
  private normalizeOperationCount(value: unknown): number { const parsed = Number(value || 0); return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0; }
  private normalizeOperationDetails(details: unknown, maxCount: number, digits: MoneyDigits): Array<{ amount: number; reference?: string }> {
    if (!Array.isArray(details) || details.length === 0) return [];
    const effectiveLimit = Math.max(maxCount, details.length);
    if (effectiveLimit <= 0) return [];
    return details.slice(0, effectiveLimit).map((entry) => {
      const amount = this.toBookMoney((entry as CloseOperationDetailInput)?.amount || 0, digits);
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

  // INV-REST-MANAGER-PIN-HASHED: the drawer no longer keeps its own
  // plaintext copy of the manager-PIN check. The shared
  // authorizeManagerSecret is the one rule (bcrypt compare, legacy
  // plaintext migrates in place on first success, admin login-password
  // fallback) — the drawer's observable errors stay its own
  // (MANAGER_PIN_INVALID + the drawer messages), so callers see no change.
  private async assertManagerPin(pin: string, auth: AuthContext): Promise<void> {
    try {
      await authorizeManagerSecret(this.db, auth, pin);
    } catch (err) {
      const code = (err as AppError)?.code;
      if (code === 'MANAGER_AUTH_REQUIRED') {
        throw new AppError('أدخل رمز المشرف أو كلمة مرور الإدارة', 'MANAGER_PIN_INVALID', 400);
      }
      if (code === 'MANAGER_AUTH_INVALID') {
        throw new AppError('رمز الاعتماد غير صحيح', 'MANAGER_PIN_INVALID', 400);
      }
      throw err;
    }
  }
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

  // INV-DRAWER-DISBURSE-CASHIER-PASSWORD: drawer disbursements
  // (cash_out + safe_drop) accept the CASHIER'S OWN password —
  // the same current-user confirmation as deposits — instead of a
  // manager PIN. The cashier is recorded in the audit trail
  // (treasury row created_by = auth.userId). The manager PIN is
  // still accepted as a fallback inside assertCurrentUserPassword
  // (the deposits pattern). Posted-invoice edit and stock-count
  // approval stay manager-gated: they do not call this method.
  private async assertCashDrawerApproval(movementType: CashDrawerMovementType, approvalSecret: string, auth: AuthContext): Promise<void> {
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

  private async computeShiftExpensesTotal(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<number> {
    const openerId = Number(shift.opened_by || 0); const scope = this.scope(auth);
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
        and s.created_at >= ${shift.created_at}
        and (${shift.closed_at || null}::timestamptz is null or s.created_at <= ${shift.closed_at || null})
        and (${shift.branch_id || null}::int is null or s.branch_id is null or s.branch_id = ${Number(shift.branch_id || 0) || null})
        and (${shift.location_id || null}::int is null or s.location_id is null or s.location_id = ${Number(shift.location_id || 0) || null})
    `.execute(queryable ?? this.db);
    const row = result.rows?.[0] || {};
    return { serviceCashTotal: this.toBookMoney(row.service_cash_total || 0, bookDigits), serviceCardTotal: this.toBookMoney(row.service_card_total || 0, bookDigits), serviceTotal: this.toBookMoney(row.service_total || 0, bookDigits) };
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
    const fallback = String(shift.status || 'open') === 'open'
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
  private async computeShiftAttributedSaleCash(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<{
    total: number;
    items: Array<{ id: string; kind: 'cash_in' | 'cash_out'; kindLabel: string; amount: number; note: string; createdAt: string }>;
  }> {
    const openerId = Number(shift.opened_by || 0); const scope = this.scope(auth);
    if (!(openerId > 0) || !shift.created_at) return { total: 0, items: [] };
    const bookDigits = digits ?? currencyMoneyDigits(await tenantBaseCurrency(queryable ?? this.db, scope.tenantId));
    const result = await sql<{
      id?: number | string | null; amount?: number | string | null; note?: string | null;
      txn_type?: string | null; created_at?: string | Date | null; sale_id?: number | string | null;
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
    const items: Array<{ id: string; kind: 'cash_in' | 'cash_out'; kindLabel: string; amount: number; note: string; createdAt: string }> = [];
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
    // INV-REST-SHIFT-CLOSE-CONTROL (I25): the sum is the one pure
    // buildExpectedCashBreakdown — the same rows the close card and
    // the Z-report render — so the stored figure and the shown
    // figure can never drift apart again.
    return buildExpectedCashBreakdown({
      openingCash: Number(shift.opening_cash || 0),
      netDrawerMovement,
      cashSalesTotal: breakdown.cashSalesTotal,
      cancelledSaleCashTotal: cancelledCheckoutCash,
      serviceCashTotal: services.serviceCashTotal,
      customerCollectionsTotal: customerCollections,
      saleReturnCashRefundTotal: saleReturnTotals.saleReturnCashRefundTotal,
      supplierPaymentsTotal,
      expensesTotal,
    }, bookDigits).total;
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
      const isSafeDrop = tt.txn_type === 'safe_drop';
      const isSafeReplenishment = tt.txn_type === 'safe_replenishment';
      const kindLabel = isSafeDrop ? 'تحويل نقدية للخزنة (إيداع آمن)'
        : isSafeReplenishment ? 'تغذية الدرج من الخزنة'
        : isPurchaseRefund ? 'استرداد نقدي من مورد بعد مرتجع شراء'
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
      const supRows = await sql<{ id: number; amount: number | string; note?: string | null; supplier_name?: string | null; payment_date?: string | Date | null; created_at?: string | Date | null; payment_channel?: string | null }>`
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
    const customerCollectionsTotal = await this.computeShiftCustomerCollections(row, auth);
    const cancelledSaleCashTotal = await this.computeShiftCancelledSaleCashReceipts(row, auth);
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
    const hydratedRows = await Promise.all(
      (result.rows ?? []).map((row) => this.hydrateShiftRow(row, auth)),
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
    const result = await sql<ShiftRow>`select * from cashier_shifts where tenant_id = ${scope.tenantId} and id = ${shiftId} limit 1`.execute(db);
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
      locked as ShiftRow, auth, undefined, undefined, queryable, digits,
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
      reason: String(stamp.reason || '').trim().slice(0, 200),
      byUserId: Number(auth.userId || 0) || null,
      byUsername: String(auth.username || ''),
    };
    const closeNote = this.appendPostCloseCorrectionNote((locked as ShiftRow).close_note, correction);
    await sql`update cashier_shifts set expected_cash = ${correctedExpectedCash}, variance = ${correctedVariance}, close_note = ${closeNote} where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(queryable);
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
    const filter = String(query.filter || query.status || 'all').trim().toLowerCase();
    const filterStatus = filter === 'open' || filter === 'closed' || filter === 'pending_review' ? filter : undefined;
    const mapped = await this.rawList(auth, filterStatus);
    const filtered = filterCashDrawerRows(mapped, { ...query, filter });
    const paged = paginateCashDrawerRows(filtered, query);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, this.scope(auth).tenantId));
    return { cashierShifts: paged.rows, pagination: paged.pagination, summary: summarizeCashDrawerRows(filtered, digits), viewerRole: auth.role };
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
  private async getCashierShortageTolerance(queryable: Kysely<Database>, tenantId: string, digits: MoneyDigits): Promise<number> {
    try {
      const row = await queryable
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', tenantId)
        .where('key', '=', 'cashierShortageTolerance')
        .executeTakeFirst();
      if (row == null || row.value == null || String(row.value).trim() === '') return 10 ** -digits;
      let raw: unknown = row.value;
      try { raw = JSON.parse(String(row.value)); } catch { /* plain scalar */ }
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
  private async findOpenTablesBlockingClose(
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
    const heldTables = (held.rows || [])
      .map((row) => String(row.table_number || '').trim())
      .filter(Boolean);
    const heldCount = (held.rows || []).length;
    const draftCount = (drafts.rows || []).length;
    return { heldCount, heldTables, draftCount, totalCount: heldCount + draftCount };
  }

  async openCashierShift(payload: { openingCash?: number; note?: string; branchId?: number | string | null; locationId?: number | string | null; password?: string; managerPin?: string; terminalCode?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    const { openingCash, note, branchId, locationId, password, terminalCode } = normalizeShiftOpenPayload(payload);
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
    } else if (password) {
      // A supplied password is never silently ignored: the shift-open modal
      // always shows the confirmation field, so a typed password must verify.
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
      // INV-REST-SHIFT-CLOSE-CONTROL (I24): one open shift per
      // branch+terminal. A second login at the same station must
      // not open a parallel shift — its cash would attribute to
      // no shift. The partial unique index is the race backstop;
      // the pre-check is the readable error.
      if (terminalCode) {
        const occupied = await sql<{ id?: number }>`select id from cashier_shifts where tenant_id = ${scope.tenantId} and status = 'open' and terminal_code = ${terminalCode} and branch_id is not distinct from ${resolvedBranchId} limit 1`.execute(trx);
        if (occupied.rows?.[0]?.id) throw new AppError('توجد وردية مفتوحة بالفعل على هذه المحطة في الفرع', 'SHIFT_TERMINAL_OCCUPIED', 400);
      }
      let inserted: { rows: Array<{ id?: number }> };
      try {
        inserted = await sql<{ id?: number }>`insert into cashier_shifts (doc_no, branch_id, location_id, opened_by, opening_cash, opening_note, status, expected_cash, tenant_id, account_id, terminal_code) values (null, ${resolvedBranchId}, ${locationId}, ${auth.userId}, ${openingCash}, ${note}, 'open', ${openingCash}, ${scope.tenantId}, ${scope.accountId}, ${terminalCode}) returning id`.execute(trx);
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        if (code === '23505') throw new AppError('توجد وردية مفتوحة بالفعل على هذه المحطة في الفرع', 'SHIFT_TERMINAL_OCCUPIED', 400);
        throw err;
      }
      const shiftId = Number(inserted.rows?.[0]?.id || 0);
      if (!shiftId) throw new AppError('Could not open cashier shift', 'SHIFT_OPEN_FAILED', 400);
      await sql`update cashier_shifts set doc_no = ${buildCashDrawerShiftDocNo(shiftId)} where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
    });
    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary };
  }

  async recordCashMovement(shiftId: number, payload: { type?: string; amount?: number; note?: string; managerPin?: string; requestKey?: string; counterpartAccountId?: number }, auth: AuthContext): Promise<Record<string, unknown>> {
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
    // INV-CASH-DRAWER-MOVEMENT-TYPES: a safe transfer names its
    // counterpart cash/bank account. The dedicated safe/cash-box
    // account is 1111 (INV-DRAWER-DISBURSE-CASHIER-PASSWORD,
    // migration 0324), so a safe drop lands in the safe; the caller
    // may still name any other active cash/bank account, and it is
    // validated exactly like a treasury transfer (active cash/bank
    // asset, debit normal balance). This fail-fast check runs before
    // the approval check so a bad counterpart never consumes a
    // password/PIN attempt; the journal writer re-validates under
    // lock inside the transaction before anything is written.
    if (isCashDrawerTransferType(movementType)) {
      const counterpartId = Number(payload.counterpartAccountId || 0);
      if (!(counterpartId > 0)) throw new AppError('A counterpart cash or bank account is required for a safe transfer', 'DRAWER_COUNTERPART_REQUIRED', 400);
      const counterpart = await this.db
        .selectFrom('accounting_accounts')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', counterpartId)
        .where('account_type', '=', 'asset')
        .where('normal_balance', '=', 'debit')
        .where('is_cash_bank', '=', true)
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (!counterpart) throw new AppError('The counterpart must be an active cash or bank account in this tenant', 'TREASURY_ACCOUNT_NOT_FOUND', 400);
      // INV-DRAWER-DISBURSE-CASHIER-PASSWORD (trial T31): the drawer
      // cash account itself can never be the counterpart — a transfer
      // from the drawer to itself is not a transfer, and the journal
      // writer throws DRAWER_COUNTERPART_SAME_AS_CASH for it after
      // the treasury row is already inserted (whole transaction rolls
      // back, surfacing as a generic failure). Fail here, before the
      // approval check and before any write, with the clear code.
      // The drawer cash account is the tenant's cash_account_id
      // (seeded 1110); the 1110-row lookup is the same fallback the
      // journal writer uses.
      const settingsRow = await this.db
        .selectFrom('accounting_settings')
        .select('cash_account_id')
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      let drawerCashAccountId = Number((settingsRow as { cash_account_id?: number | null } | undefined)?.cash_account_id || 0);
      if (!(drawerCashAccountId > 0)) {
        const cashByCode = await this.db
          .selectFrom('accounting_accounts')
          .select('id')
          .where('tenant_id', '=', scope.tenantId)
          .where('code', '=', '1110')
          .executeTakeFirst();
        drawerCashAccountId = Number((cashByCode as { id?: number | null } | undefined)?.id || 0);
      }
      if (drawerCashAccountId > 0 && counterpartId === drawerCashAccountId) {
        throw new AppError('لا يمكن تحويل النقدية إلى حساب الدرج نفسه؛ اختر حساب الخزنة الآمنة (1111) أو البنك', 'DRAWER_COUNTERPART_SAME_AS_CASH', 400);
      }
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

      if (movementType === 'cash_in' || movementType === 'cash_out' || movementType === 'safe_drop' || movementType === 'safe_replenishment') {
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
            isCashDrawerTransferType(movementType) ? Number(payload.counterpartAccountId || 0) : null,
          );
        }
      }
      return true;
    });

    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary };
  }

  async closeCashierShift(shiftId: number, payload: { countedCash?: number; cardDeclaredTotal?: number; cardOperationCount?: number; walletDeclaredTotal?: number; walletOperationCount?: number; instapayDeclaredTotal?: number; instapayOperationCount?: number; cardDetails?: Array<{ amount?: number; reference?: string }>; walletDetails?: Array<{ amount?: number; reference?: string }>; instapayDetails?: Array<{ amount?: number; reference?: string }>; note?: string; managerPin?: string; approverSecret?: string; openTablesOverrideSecret?: string; openTablesOverrideReason?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    if (!(shiftId > 0)) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    const shift = await this.getShift(shiftId, auth);
    if (!shift) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    if (String(shift.status || 'open') !== 'open') throw new AppError('الوردية مغلقة بالفعل', 'SHIFT_ALREADY_CLOSED', 400);
    // INV-SHIFT-CLOSE-ADMIN-CLOSE-ANY: an admin closes ANY cashier's
    // shift (admin-as-super_admin in all in-tenant permissions;
    // super_admin exists only for package/subscription changes).
    // A cashier closes only their own shift, never another
    // cashier's. The old owner-only gate (super_admin excepted)
    // blocked the shop owner from closing a cashier who forgot
    // or left — live on test10k 2026-11-13, admin closing
    // cashier_test SHIFT-261112-0026.
    if (Number(shift.opened_by || 0) !== Number(auth.userId || 0) && !['admin', 'super_admin'].includes(String(auth.role || '').trim())) throw new AppError('غير مسموح لك بإغلاق هذه الوردية', 'SHIFT_FORBIDDEN', 403);
    const countedCash = Number(payload.countedCash || 0);
    const note = String(payload.note || '').trim();
    assertCashDrawerCountedCash(countedCash);
    await this.assertCurrentUserPassword(String(payload.managerPin || '').trim(), auth);
    const cardOperationCount = this.normalizeOperationCount(payload.cardOperationCount);
    const walletOperationCount = this.normalizeOperationCount(payload.walletOperationCount);
    const instapayOperationCount = this.normalizeOperationCount(payload.instapayOperationCount);
    // INV-BLIND-CLOSE-DECLARED-RECONCILIATION: declared totals and
    // detail amounts are stored at book digits, on the pool read
    // like the expected-cash computation — the stored declaration
    // must survive whole so review can reconcile it exactly.
    const closeDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const cardDetails = this.normalizeOperationDetails(payload.cardDetails, cardOperationCount, closeDigits);
    const walletDetails = this.normalizeOperationDetails(payload.walletDetails, walletOperationCount, closeDigits);
    const instapayDetails = this.normalizeOperationDetails(payload.instapayDetails, instapayOperationCount, closeDigits);

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
      const noteStamps: string[] = [];

      // INV-REST-SHIFT-CLOSE-CONTROL (I21): blind close keys off
      // the OPENER's role, not the closer's. A super_admin closing
      // a cashier's shift used to skip declaration + review
      // entirely; now the shift goes to pending_review like the
      // cashier's own close. When the opener row is gone, fall
      // back to the closer's role (the old rule).
      const openerRow = await trx.selectFrom('users').select('role')
        .where('id', '=', Number(lockedShift.opened_by || 0))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      const openerRole = String((openerRow as { role?: unknown } | undefined)?.role || '').trim();
      const isBlindClose = openerRole ? openerRole === 'cashier' : String(auth.role || '').trim() === 'cashier';
      const blindCloseMeta: BlindCloseMetadata | null = isBlindClose ? { blindClose: true, declared: { cash: this.toBookMoney(countedCash, closeDigits), cardTotal: this.toBookMoney(payload.cardDeclaredTotal || 0, closeDigits), cardCount: cardOperationCount, walletTotal: this.toBookMoney(payload.walletDeclaredTotal || 0, closeDigits), walletCount: walletOperationCount, instapayTotal: this.toBookMoney(payload.instapayDeclaredTotal || 0, closeDigits), instapayCount: instapayOperationCount }, detailTotals: { card: this.toBookMoney(cardDetails.reduce((sum, row) => sum + row.amount, 0), closeDigits), wallet: this.toBookMoney(walletDetails.reduce((sum, row) => sum + row.amount, 0), closeDigits), instapay: this.toBookMoney(instapayDetails.reduce((sum, row) => sum + row.amount, 0), closeDigits) }, details: { card: cardDetails, wallet: walletDetails, instapay: instapayDetails }, note } : null;
      const closeStatus = isBlindClose ? 'pending_review' : 'closed';

      // INV-REST-SHIFT-CLOSE-CONTROL (I20): closing mid-service
      // strands real tables, so open tables / draft sales block
      // the close. A >=10-char reason overrides — the reason is
      // read from the override-reason box OR the closing note
      // (ملاحظة الإغلاق), because the note is the handover
      // justification the closer actually types
      // (INV-SHIFT-CLOSE-HANDOVER-NOTE-REASON: a reason typed in
      // the visible note field used to die in the validator, which
      // read only the separate override-reason field — live
      // SHIFT-261105-0025, expected 6,853.40 counted 6,853.4,
      // blocked although a note was typed). For a cashier closer
      // the override still needs a DIFFERENT manager's secret
      // (account password — the shared PIN has no identity). An
      // admin/super_admin closer needs no second manager: the
      // admin is the shop owner (admin-as-super_admin in all
      // in-tenant permissions), their own password-confirmed
      // close plus the recorded reason is the control, and the
      // override is stamped into the close note either way.
      const openTables = await this.findOpenTablesBlockingClose(trx, scope.tenantId, lockedShift as ShiftRow);
      if (openTables.totalCount > 0) {
        const overrideSecret = String(payload.openTablesOverrideSecret || '').trim();
        const overrideReason = String(payload.openTablesOverrideReason || '').trim() || note;
        const tables = openTables.heldTables.length > 0 ? ` (طاولات: ${openTables.heldTables.join('، ')})` : '';
        const isPrivilegedCloser = ['admin', 'super_admin'].includes(String(auth.role || '').trim());
        if (isPrivilegedCloser) {
          if (!overrideReason && !overrideSecret) {
            throw new AppError(`لا يمكن إغلاق الوردية: توجد ${openTables.heldCount} طاولة مفتوحة${tables} و${openTables.draftCount} فاتورة مسودة`, 'SHIFT_CLOSE_OPEN_TABLES', 400);
          }
          if (overrideReason.length < 10) throw new AppError('اكتب سبب تجاوز الطاولات المفتوحة (10 أحرف على الأقل)', 'SHIFT_CLOSE_OVERRIDE_REASON_REQUIRED', 400);
          noteStamps.push(`تجاوز طاولات مفتوحة: ${openTables.heldCount} طاولة${tables} + ${openTables.draftCount} فاتورة مسودة — السبب: ${overrideReason} — بواسطة ${String(auth.username || '')} (إغلاق إداري)`);
        } else {
          if (!overrideSecret) {
            throw new AppError(`لا يمكن إغلاق الوردية: توجد ${openTables.heldCount} طاولة مفتوحة${tables} و${openTables.draftCount} فاتورة مسودة`, 'SHIFT_CLOSE_OPEN_TABLES', 400);
          }
          if (overrideReason.length < 10) throw new AppError('اكتب سبب تجاوز الطاولات المفتوحة (10 أحرف على الأقل)', 'SHIFT_CLOSE_OVERRIDE_REASON_REQUIRED', 400);
          const override = await authorizeManagerSecret(trx, auth, overrideSecret);
          if (override.mode !== 'account' || !override.authorizedById || override.authorizedById === Number(auth.userId)) {
            throw new AppError('تجاوز الطاولات المفتوحة يتطلب اعتماد مدير آخر غير من يغلق الوردية', 'SHIFT_CLOSE_OVERRIDE_IDENTITY_REQUIRED', 400);
          }
          noteStamps.push(`تجاوز طاولات مفتوحة: ${openTables.heldCount} طاولة${tables} + ${openTables.draftCount} فاتورة مسودة — السبب: ${overrideReason} — بواسطة ${override.authorizedByName}`);
        }
      }

      const expectedCash = await this.computeShiftExpectedCashFromShift(lockedShift as ShiftRow, auth, undefined, undefined, trx);
      const variance = computeCashDrawerVariance(countedCash, expectedCash, digits);
      // Any real variance needs a note: the old 0.01 cutoff let a KWD
      // cashier close a shift 9 fils short with no explanation at all.
      if (!isBlindClose && variance !== 0) assertCashDrawerNote(note);

      // INV-REST-SHIFT-CLOSE-CONTROL (I21): a variance over the
      // shortage-tolerance cap needs a second approver — a
      // manager/admin other than the closer, by account password —
      // and a note of at least 10 characters. The approver's auth
      // is passed into the variance posting, so
      // variance_approved_by is the approver, not the closer.
      // Blind closes skip this: the reviewer approves at review.
      let postingAuth = auth;
      if (closeStatus === 'closed' && requiresSecondApproval(variance, await this.getCashierShortageTolerance(trx, scope.tenantId, digits))) {
        const approverSecret = String(payload.approverSecret || '').trim();
        if (!approverSecret) throw new AppError('الفرق فوق حد التسامح يتطلب اعتماد مدير ثانٍ', 'SHIFT_SECOND_APPROVAL_REQUIRED', 400);
        const approval = await authorizeManagerSecret(trx, auth, approverSecret);
        if (approval.mode !== 'account' || !approval.authorizedById || approval.authorizedById === Number(auth.userId)) {
          throw new AppError('اعتماد الفرق يتطلب مديراً آخر غير من يغلق الوردية', 'SHIFT_SECOND_APPROVER_MUST_DIFFER', 400);
        }
        assertCashDrawerNote(note, 'SHIFT_SECOND_APPROVAL_NOTE_REQUIRED', 10);
        postingAuth = { ...auth, userId: approval.authorizedById, username: approval.authorizedByName };
        noteStamps.push(`اعتماد فرق فوق حد التسامح بواسطة ${approval.authorizedByName}`);
      }

      const stampedNote = [...(note ? [note] : []), ...noteStamps].join('\n\n');
      const closeNoteValue = blindCloseMeta ? this.serializeBlindCloseNote({ ...blindCloseMeta, note: stampedNote }) : stampedNote;

      await sql`update cashier_shifts set status = ${closeStatus}, expected_cash = ${expectedCash}, counted_cash = ${countedCash}, variance = ${variance}, close_note = ${closeNoteValue}, closed_by = ${auth.userId}, closed_at = now() where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
      if (closeStatus === 'closed') {
        await this.accountingPosting.postCashierShiftVariance(trx, shiftId, postingAuth);
      }
    });

    if (this.whatsappService) {
      void this.whatsappService.sendShiftCloseNotification(shiftId, scope.tenantId).catch(() => undefined);
    }

    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary };
  }

  /**
   * INV-BLIND-CLOSE-DECLARED-RECONCILIATION: the authoritative
   * declared-vs-computed reconciliation at book digits, computed
   * on the review transaction from the same breakdowns the listing
   * hydrates. The computed side mirrors the review screen's
   * definition exactly: card = card sales + service card − card
   * return refunds; wallet/instapay = their sales totals. Counts
   * come from the breakdown's operation counts. Declared figures
   * are re-rounded to book digits so shifts closed at 2dp before
   * this package reconcile against their stored values unchanged.
   * INV-REST-SHIFT-CLOSE-CONTROL (I22): the reconciliation also
   * compares the itemised detail totals against the declared
   * totals (detailDelta). A mismatch never blocks review by
   * itself — it is recorded — but approving one now requires a
   * >=10-char note (see reviewCashierShiftClose).
   */
  private async computeBlindCloseReconciliation(
    shift: ShiftRow,
    declared: { cardTotal: number; cardCount: number; walletTotal: number; walletCount: number; instapayTotal: number; instapayCount: number; detailTotals?: { card: number; wallet: number; instapay: number } },
    auth: AuthContext,
    queryable: Kysely<Database>,
    digits: MoneyDigits,
  ): Promise<BlindCloseReconciliation> {
    const breakdown = await this.computeShiftSalesBreakdown(shift, auth, queryable, digits);
    const services = await this.computeShiftServiceBreakdown(shift, auth, queryable, digits);
    const returns = await this.computeShiftSaleReturnTotals(shift, auth, queryable, digits);
    const channel = (declaredTotal: number, declaredCount: number, computed: number, computedCount: number, detailTotal: number): BlindCloseChannelReconciliation => ({
      declared: this.toBookMoney(declaredTotal, digits),
      computed: this.toBookMoney(computed, digits),
      delta: this.toBookMoney(declaredTotal - computed, digits),
      declaredCount,
      computedCount,
      countDelta: declaredCount - computedCount,
      detailTotal: this.toBookMoney(detailTotal, digits),
      detailDelta: this.toBookMoney(detailTotal - declaredTotal, digits),
    });
    const details = declared.detailTotals || { card: 0, wallet: 0, instapay: 0 };
    return {
      card: channel(declared.cardTotal, declared.cardCount, breakdown.cardSalesTotal + services.serviceCardTotal - returns.saleReturnCardRefundTotal, breakdown.cardOperationCount, Number(details.card || 0)),
      wallet: channel(declared.walletTotal, declared.walletCount, breakdown.walletSalesTotal, breakdown.walletOperationCount, Number(details.wallet || 0)),
      instapay: channel(declared.instapayTotal, declared.instapayCount, breakdown.instapaySalesTotal, breakdown.instapayOperationCount, Number(details.instapay || 0)),
    };
  }

  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I22): the review is a decision.
   * 'approve' closes the shift and posts the variance — but any
   * mismatch (declared/computed delta, count delta, or
   * itemised-detail delta) requires a note of at least 10
   * characters. 'reject' reopens the shift (status back to open,
   * counted cash / variance / closer cleared, reason stamped) and
   * posts NO variance journal: the cashier re-counts and closes
   * again. The old always-approve behaviour silently closed
   * mismatched shifts.
   */
  async reviewCashierShiftClose(shiftId: number, payload: { decision?: string; note?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    if (!(shiftId > 0)) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    if (!this.canReviewPendingShift(auth)) throw new AppError('غير مسموح لك بمراجعة إغلاق الوردية', 'SHIFT_REVIEW_FORBIDDEN', 403);
    const decision = String((payload as { decision?: unknown }).decision || '').trim();
    if (decision !== 'approve' && decision !== 'reject') throw new AppError('حدد قرار المراجعة: اعتماد أو رفض', 'SHIFT_REVIEW_DECISION_REQUIRED', 400);
    const shift = await this.getShift(shiftId, auth);
    if (!shift) throw new AppError('الوردية غير موجودة', 'SHIFT_NOT_FOUND', 404);
    if (String(shift.status || '') !== 'pending_review') throw new AppError('الوردية ليست في انتظار مراجعة المدير', 'SHIFT_NOT_PENDING_REVIEW', 400);
    const managerNote = String(payload.note || '').trim();
    if (decision === 'reject' && managerNote.length < 10) {
      throw new AppError('اكتب سبب الرفض (10 أحرف على الأقل) قبل إعادة فتح الوردية', 'SHIFT_REVIEW_NOTE_REQUIRED', 400);
    }
    const rawCloseNote = String(shift.close_note || '');
    const parsedBlindClose = this.parseBlindCloseNote(rawCloseNote);
    let closeNoteValue = rawCloseNote;
    let reconciliation: BlindCloseReconciliation | null = null;

    await this.tx.runInTransaction(this.db, async (trx) => {
      const lockedShift = await trx.selectFrom('cashier_shifts').selectAll().where('id', '=', shiftId).where('tenant_id', '=', scope.tenantId).forUpdate().executeTakeFirst();
      if (!lockedShift || lockedShift.status !== 'pending_review') throw new AppError('الوردية ليست في انتظار مراجعة المدير', 'SHIFT_NOT_PENDING_REVIEW', 409);

      if (decision === 'reject') {
        if (parsedBlindClose) {
          parsedBlindClose.rejection = { note: managerNote, rejectedById: Number(auth.userId || 0), rejectedByName: String(auth.username || ''), rejectedAt: new Date().toISOString() };
          closeNoteValue = this.serializeBlindCloseNote(parsedBlindClose);
        } else {
          const line = `رفض مراجعة المدير: ${managerNote} — بواسطة ${String(auth.username || '')}`;
          closeNoteValue = rawCloseNote ? `${rawCloseNote}\n\n${line}` : line;
        }
        await sql`update cashier_shifts set status = 'open', counted_cash = null, variance = null, close_note = ${closeNoteValue}, closed_by = null, closed_at = null, updated_at = now() where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
        return;
      }

      if (parsedBlindClose) {
        const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
        reconciliation = await this.computeBlindCloseReconciliation(
          lockedShift as ShiftRow,
          {
            cardTotal: Number(parsedBlindClose.declared?.cardTotal || 0),
            cardCount: Number(parsedBlindClose.declared?.cardCount || 0),
            walletTotal: Number(parsedBlindClose.declared?.walletTotal || 0),
            walletCount: Number(parsedBlindClose.declared?.walletCount || 0),
            instapayTotal: Number(parsedBlindClose.declared?.instapayTotal || 0),
            instapayCount: Number(parsedBlindClose.declared?.instapayCount || 0),
            detailTotals: {
              card: Number(parsedBlindClose.detailTotals?.card || 0),
              wallet: Number(parsedBlindClose.detailTotals?.wallet || 0),
              instapay: Number(parsedBlindClose.detailTotals?.instapay || 0),
            },
          },
          auth,
          trx,
          digits,
        );
        const hasMismatch = (['card', 'wallet', 'instapay'] as const).some((channelName) => {
          const channel = reconciliation?.[channelName];
          return !!channel && (channel.delta !== 0 || channel.countDelta !== 0 || channel.detailDelta !== 0);
        });
        if (hasMismatch && managerNote.length < 10) {
          throw new AppError('يوجد فرق في إقرار الإغلاق؛ اكتب ملاحظة مراجعة (10 أحرف على الأقل) قبل الاعتماد', 'SHIFT_REVIEW_NOTE_REQUIRED', 400);
        }
        parsedBlindClose.managerReview = { note: managerNote, reviewedById: Number(auth.userId || 0), reviewedByName: String(auth.username || ''), reviewedAt: new Date().toISOString() };
        parsedBlindClose.reconciliation = reconciliation;
        closeNoteValue = this.serializeBlindCloseNote(parsedBlindClose);
      } else if (managerNote) {
        closeNoteValue = rawCloseNote ? `${rawCloseNote}\n\nملاحظة مراجعة المدير: ${managerNote}` : `ملاحظة مراجعة المدير: ${managerNote}`;
      }

      await sql`update cashier_shifts set status = 'closed', close_note = ${closeNoteValue}, closed_by = coalesce(closed_by, ${auth.userId}), closed_at = coalesce(closed_at, now()), updated_at = now() where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
      await this.accountingPosting.postCashierShiftVariance(trx, shiftId, auth);
    });
    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary, reconciliation };
  }
}
