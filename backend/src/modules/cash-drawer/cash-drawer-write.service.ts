import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AppError } from '../../common/errors/app-error';
import { assertCashDrawerAmount, assertCashDrawerCountedCash, assertCashDrawerNote, buildCashDrawerShiftDocNo, computeCashDrawerVariance, isCashDrawerOutboundType, normalizeCashDrawerMovementType, normalizeShiftOpenPayload, requiresSecondApproval, toSignedCashDrawerAmount, isCashDrawerTransferType, type BlindCloseChannelReconciliation, type BlindCloseReconciliation, type CashDrawerMovementType } from './helpers/cash-drawer.helper';
import type { ShiftCustomerCollectionsByChannel } from './helpers/shift-customer-collections.helper';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import type { TenantScope } from '../../core/auth/utils/tenant-boundary';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { AUDIT_EVENT_CODES, type AuditService } from '../../core/audit/audit.service';
import type {
  ShiftRow,
  BlindCloseMetadata,
  ShiftSalesBreakdown,
  ShiftServiceBreakdown,
  ShiftSaleReturnTotals,
} from './cash-drawer.types';

/**
 * CashDrawerWriteService — slice S4 of the cash-drawer split.
 * Pure move of the shift write operations from the drawer service.
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin public delegates with the same names and signatures. This slice
 * reaches the kernel helpers and the other slices only through bound
 * deps — it never imports another slice service. The four delegated
 * operations stay public here; one helper stays private here because
 * it is called only from inside this slice, so it needs no delegate.
 */

export interface CashDrawerWriteDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  accountingPosting: AccountingPostingService;
  whatsappService?: WhatsAppGatewayService;
  // F5: shift open/close/review audit. Optional — specs that build the
  // service without an audit dep keep working; the calls guard it.
  audit?: AuditService;
  // Bound kernel helpers (stay in the facade; passed bound so the moved
  // bodies stay byte-identical).
  scope: (auth: AuthContext) => TenantScope;
  toBookMoney: (value: unknown, digits: MoneyDigits) => number;
  serializeBlindCloseNote: (meta: BlindCloseMetadata) => string;
  parseBlindCloseNote: (rawNote: unknown) => BlindCloseMetadata | null;
  normalizeOperationCount: (value: unknown) => number;
  normalizeOperationDetails: (details: unknown, maxCount: number, digits: MoneyDigits) => Array<{ amount: number; reference?: string }>;
  // Bound cross-slice deps (facade delegates, bound from the facade's
  // own methods so the moved bodies stay byte-identical).
  isPasswordRequiredOnShiftOpen: (auth: AuthContext) => Promise<boolean>;
  assertCurrentUserPassword: (password: string, auth: AuthContext) => Promise<void>;
  // F5: strict (own-password-only) assertion for shift open/close.
  assertCurrentUserPasswordStrict: (password: string, auth: AuthContext) => Promise<void>;
  assertCashDrawerApproval: (movementType: CashDrawerMovementType, approvalSecret: string, auth: AuthContext) => Promise<void>;
  canReviewPendingShift: (auth: AuthContext) => boolean;
  computeShiftExpectedCashFromShift: (shift: ShiftRow, auth: AuthContext, salesBreakdown?: ShiftSalesBreakdown, serviceBreakdown?: ShiftServiceBreakdown, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<number>;
  computeShiftSalesBreakdown: (shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<ShiftSalesBreakdown>;
  computeShiftServiceBreakdown: (shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<ShiftServiceBreakdown>;
  computeShiftSaleReturnTotals: (shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<ShiftSaleReturnTotals>;
  computeShiftCustomerCollectionsByChannel: (shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<ShiftCustomerCollectionsByChannel>;
  getShift: (shiftId: number, auth: AuthContext, queryable?: Kysely<Database>) => Promise<ShiftRow | null>;
  listCashierShifts: (query: Record<string, unknown>, auth: AuthContext) => Promise<Record<string, unknown>>;
  getCashierShortageTolerance: (queryable: Kysely<Database>, tenantId: string, digits: MoneyDigits) => Promise<number>;
  findOpenTablesBlockingClose: (queryable: Kysely<Database>, tenantId: string, shift: ShiftRow) => Promise<{ heldCount: number; heldTables: string[]; draftCount: number; totalCount: number }>;
}

@Injectable()
export class CashDrawerWriteService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly accountingPosting: AccountingPostingService;
  private readonly whatsappService?: WhatsAppGatewayService;
  private readonly audit?: AuditService;
  private readonly scope: (auth: AuthContext) => TenantScope;
  private readonly toBookMoney: (value: unknown, digits: MoneyDigits) => number;
  private readonly serializeBlindCloseNote: (meta: BlindCloseMetadata) => string;
  private readonly parseBlindCloseNote: (rawNote: unknown) => BlindCloseMetadata | null;
  private readonly normalizeOperationCount: (value: unknown) => number;
  private readonly normalizeOperationDetails: (details: unknown, maxCount: number, digits: MoneyDigits) => Array<{ amount: number; reference?: string }>;
  private readonly isPasswordRequiredOnShiftOpen: (auth: AuthContext) => Promise<boolean>;
  private readonly assertCurrentUserPassword: (password: string, auth: AuthContext) => Promise<void>;
  private readonly assertCurrentUserPasswordStrict: (password: string, auth: AuthContext) => Promise<void>;
  private readonly assertCashDrawerApproval: (movementType: CashDrawerMovementType, approvalSecret: string, auth: AuthContext) => Promise<void>;
  private readonly canReviewPendingShift: (auth: AuthContext) => boolean;
  private readonly computeShiftExpectedCashFromShift: (shift: ShiftRow, auth: AuthContext, salesBreakdown?: ShiftSalesBreakdown, serviceBreakdown?: ShiftServiceBreakdown, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<number>;
  private readonly computeShiftSalesBreakdown: (shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<ShiftSalesBreakdown>;
  private readonly computeShiftServiceBreakdown: (shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<ShiftServiceBreakdown>;
  private readonly computeShiftSaleReturnTotals: (shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<ShiftSaleReturnTotals>;
  private readonly computeShiftCustomerCollectionsByChannel: (shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits) => Promise<ShiftCustomerCollectionsByChannel>;
  private readonly getShift: (shiftId: number, auth: AuthContext, queryable?: Kysely<Database>) => Promise<ShiftRow | null>;
  private readonly listCashierShifts: (query: Record<string, unknown>, auth: AuthContext) => Promise<Record<string, unknown>>;
  private readonly getCashierShortageTolerance: (queryable: Kysely<Database>, tenantId: string, digits: MoneyDigits) => Promise<number>;
  private readonly findOpenTablesBlockingClose: (queryable: Kysely<Database>, tenantId: string, shift: ShiftRow) => Promise<{ heldCount: number; heldTables: string[]; draftCount: number; totalCount: number }>;

  constructor(deps: CashDrawerWriteDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.accountingPosting = deps.accountingPosting;
    this.whatsappService = deps.whatsappService;
    this.audit = deps.audit;
    this.scope = deps.scope;
    this.toBookMoney = deps.toBookMoney;
    this.serializeBlindCloseNote = deps.serializeBlindCloseNote;
    this.parseBlindCloseNote = deps.parseBlindCloseNote;
    this.normalizeOperationCount = deps.normalizeOperationCount;
    this.normalizeOperationDetails = deps.normalizeOperationDetails;
    this.isPasswordRequiredOnShiftOpen = deps.isPasswordRequiredOnShiftOpen;
    this.assertCurrentUserPassword = deps.assertCurrentUserPassword;
    this.assertCurrentUserPasswordStrict = deps.assertCurrentUserPasswordStrict;
    this.assertCashDrawerApproval = deps.assertCashDrawerApproval;
    this.canReviewPendingShift = deps.canReviewPendingShift;
    this.computeShiftExpectedCashFromShift = deps.computeShiftExpectedCashFromShift;
    this.computeShiftSalesBreakdown = deps.computeShiftSalesBreakdown;
    this.computeShiftServiceBreakdown = deps.computeShiftServiceBreakdown;
    this.computeShiftSaleReturnTotals = deps.computeShiftSaleReturnTotals;
    this.computeShiftCustomerCollectionsByChannel = deps.computeShiftCustomerCollectionsByChannel;
    this.getShift = deps.getShift;
    this.listCashierShifts = deps.listCashierShifts;
    this.getCashierShortageTolerance = deps.getCashierShortageTolerance;
    this.findOpenTablesBlockingClose = deps.findOpenTablesBlockingClose;
  }

  async openCashierShift(payload: { openingCash?: number; note?: string; branchId?: number | string | null; locationId?: number | string | null; password?: string; managerPin?: string; terminalCode?: string; offlineOpenedAt?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    const { openingCash, note, branchId, locationId, password, terminalCode, offlineOpenedAt } = normalizeShiftOpenPayload(payload);
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
      await this.assertCurrentUserPasswordStrict(password, auth);
    } else if (password) {
      // A supplied password is never silently ignored: the shift-open modal
      // always shows the confirmation field, so a typed password must verify.
      await this.assertCurrentUserPasswordStrict(password, auth);
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
        inserted = offlineOpenedAt
          ? await sql<{ id?: number }>`insert into cashier_shifts (doc_no, branch_id, location_id, opened_by, opening_cash, opening_note, status, expected_cash, tenant_id, account_id, terminal_code, created_at) values (null, ${resolvedBranchId}, ${locationId}, ${auth.userId}, ${openingCash}, ${note}, 'open', ${openingCash}, ${scope.tenantId}, ${scope.accountId}, ${terminalCode}, ${offlineOpenedAt.toISOString()}) returning id`.execute(trx)
          : await sql<{ id?: number }>`insert into cashier_shifts (doc_no, branch_id, location_id, opened_by, opening_cash, opening_note, status, expected_cash, tenant_id, account_id, terminal_code) values (null, ${resolvedBranchId}, ${locationId}, ${auth.userId}, ${openingCash}, ${note}, 'open', ${openingCash}, ${scope.tenantId}, ${scope.accountId}, ${terminalCode}) returning id`.execute(trx);
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        if (code === '23505') throw new AppError('توجد وردية مفتوحة بالفعل على هذه المحطة في الفرع', 'SHIFT_TERMINAL_OCCUPIED', 400);
        throw err;
      }
      const shiftId = Number(inserted.rows?.[0]?.id || 0);
      if (!shiftId) throw new AppError('Could not open cashier shift', 'SHIFT_OPEN_FAILED', 400);
      const businessTz = await getTenantTimezone(trx, scope.tenantId);
      const docNo = buildCashDrawerShiftDocNo(shiftId, offlineOpenedAt ?? undefined, businessTz);
      await sql`update cashier_shifts set doc_no = ${docNo} where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
      // F5: one audit row per shift open, in this same transaction —
      // a rolled-back open leaves no audit trace, and a committed
      // open always has one. The function check guards harnesses
      // that pass no audit dep; in production Nest injects the real
      // AuditService (cf. INV-VAN-TRIP-STARTED-AUDIT).
      if (this.audit && typeof this.audit.logWithExecutor === 'function') {
        await this.audit.logWithExecutor(
          trx,
          'فتح وردية',
          `فتح ${String(auth.username || '')} وردية #${shiftId} (${docNo}) — رصيد افتتاح ${openingCash}`,
          auth,
          { eventCode: AUDIT_EVENT_CODES.CASHIER_SHIFT_OPENED },
        );
      }
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
    if (isCashDrawerOutboundType(movementType)) {
      const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
      const secret = String(payload.managerPin || '').trim();
      if (!isAdmin || secret) {
        await this.assertCashDrawerApproval(movementType, secret, auth);
      }
    }
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
    // F5: strict — only the signed-in user's own password closes a
    // shift. The old fallback accepted an admin's password here.
    await this.assertCurrentUserPasswordStrict(String(payload.managerPin || '').trim(), auth);
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

    // P9 (RC-9) — one stamp source for the row: closed_at was DB
    // now() while the review stamps in the same row's JSON close note
    // are app new Date(). Capture ONE server instant for this close
    // and stamp the closed_at column with it, so the row never mixes
    // two clocks. Same host clock as DB now() in practice; the value
    // is identical to within milliseconds, and the variance journal
    // reads closed_at as its entry date (day unchanged).
    const closeNow = new Date();

    // F5: the close result returned to the caller (see the update
    // inside the transaction below).
    let closedShiftResult: {
      id: number;
      docNo: string;
      status: string;
      countedCash: number;
      hasVariance: boolean;
      expectedCash: number | null;
      variance: number | null;
    } | null = null;

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
      // blocked although a note was typed).
      // INV-SECOND-MANAGER-PASSWORD-REMOVED: the override needs a
      // reason only — NO second-manager password is collected or
      // required from any closer. The closer's own
      // password-confirmed close plus the recorded reason is the
      // control, and the override is stamped into the close note
      // with who overrode it.
      const openTables = await this.findOpenTablesBlockingClose(trx, scope.tenantId, lockedShift as ShiftRow);
      if (openTables.totalCount > 0) {
        const overrideReason = String(payload.openTablesOverrideReason || '').trim() || note;
        const tables = openTables.heldTables.length > 0 ? ` (طاولات: ${openTables.heldTables.join('، ')})` : '';
        const isPrivilegedCloser = ['admin', 'super_admin'].includes(String(auth.role || '').trim());
        if (!overrideReason) {
          throw new AppError(`لا يمكن إغلاق الوردية: توجد ${openTables.heldCount} طاولة مفتوحة${tables} و${openTables.draftCount} فاتورة مسودة`, 'SHIFT_CLOSE_OPEN_TABLES', 400);
        }
        if (overrideReason.length < 10) throw new AppError('اكتب سبب تجاوز الطاولات المفتوحة (10 أحرف على الأقل)', 'SHIFT_CLOSE_OVERRIDE_REASON_REQUIRED', 400);
        noteStamps.push(`تجاوز طاولات مفتوحة: ${openTables.heldCount} طاولة${tables} + ${openTables.draftCount} فاتورة مسودة — السبب: ${overrideReason} — بواسطة ${String(auth.username || '')}${isPrivilegedCloser ? ' (إغلاق إداري)' : ''}`);
      }

      const expectedCash = await this.computeShiftExpectedCashFromShift(lockedShift as ShiftRow, auth, undefined, undefined, trx);
      const variance = computeCashDrawerVariance(countedCash, expectedCash, digits);

      // Declared totals are a PRESENCE gate, not a match gate: a
      // per-method total must be PRESENT in the payload whenever the
      // server's own breakdown of this shift shows operations for
      // that method. An explicitly entered 0.00 stays acceptable
      // (the cashier counted and found zero); a missing total means
      // the cashier never declared the method at all — the retrial
      // close of 2026-11-15 went through with Visa / wallets /
      // InstaPay all 0.00 although the shift had operations on all
      // three. An admin/super_admin closer skips this gate
      // (INV-ADMIN-CLOSE-DECLARED-TOTALS-WAIVER): the declaration
      // rows render only for a cashier closer, and for a non-blind
      // close the declared values are discarded anyway — the
      // waiver is stamped into the close note below instead.
      // Counts come from the server-computed breakdowns on
      // this transaction, never from the caller-supplied operation
      // counts in the payload (a gate that trusts caller flags is
      // bypassed by omitting them). The sales and collections
      // breakdowns carry counts; services, returns and cash sales
      // carry amounts only, so a nonzero computed amount for the
      // method is operation evidence there. The gate runs before
      // the variance checks and before the status update, so a
      // refused close posts nothing.
      const serverSales = await this.computeShiftSalesBreakdown(lockedShift as ShiftRow, auth, trx, digits);
      const serverServices = await this.computeShiftServiceBreakdown(lockedShift as ShiftRow, auth, trx, digits);
      const serverReturns = await this.computeShiftSaleReturnTotals(lockedShift as ShiftRow, auth, trx, digits);
      const serverCollections = await this.computeShiftCustomerCollectionsByChannel(lockedShift as ShiftRow, auth, trx, digits);
      const serverCardOperations = serverSales.cardOperationCount + serverCollections.cardCount
        + (serverServices.serviceCardTotal > 0 ? 1 : 0)
        + (serverReturns.saleReturnCardRefundTotal > 0 ? 1 : 0);
      const serverWalletOperations = serverSales.walletOperationCount + serverCollections.walletCount;
      const serverInstapayOperations = serverSales.instapayOperationCount + serverCollections.instapayCount;
      const serverCashOperations = serverCollections.cashCount
        + (serverSales.cashSalesTotal > 0 ? 1 : 0)
        + (serverServices.serviceCashTotal > 0 ? 1 : 0)
        + (serverReturns.saleReturnCashRefundTotal > 0 ? 1 : 0);
      const hasDeclaredTotal = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
      // INV-ADMIN-CLOSE-DECLARED-TOTALS-WAIVER: the declared-totals
      // presence gate was meant for the cashier only — the close
      // form renders the declaration rows only when the closer is
      // a cashier, so an admin closer has no input to satisfy it,
      // and for a non-blind close the declared values are discarded
      // anyway (blindCloseMeta is null unless the opener is a
      // cashier). An admin/super_admin closer therefore skips the
      // gate; every method whose total is missing is named in a
      // waiver stamp on the close note, so the audit trail shows
      // the missing declaration instead of silently dropping it.
      // The cashier path below is byte-identical.
      const isPrivilegedCloser = ['admin', 'super_admin'].includes(String(auth.role || '').trim());
      const waivedDeclaredMethods: string[] = [];
      if (serverCardOperations > 0 && !hasDeclaredTotal(payload.cardDeclaredTotal)) waivedDeclaredMethods.push('الفيزا');
      if (serverWalletOperations > 0 && !hasDeclaredTotal(payload.walletDeclaredTotal)) waivedDeclaredMethods.push('المحافظ');
      if (serverInstapayOperations > 0 && !hasDeclaredTotal(payload.instapayDeclaredTotal)) waivedDeclaredMethods.push('InstaPay');
      if (serverCashOperations > 0 && !hasDeclaredTotal(payload.countedCash)) waivedDeclaredMethods.push('النقدية');
      if (isPrivilegedCloser) {
        if (waivedDeclaredMethods.length > 0) {
          noteStamps.push(`إقرار معفى بقرار إداري — أغلق ${String(auth.username || '')} الوردية دون إقرار ${waivedDeclaredMethods.join(' / ')} المعلن`);
        }
      } else {
        if (serverCardOperations > 0 && !hasDeclaredTotal(payload.cardDeclaredTotal)) throw new AppError('أدخل إجمالي الفيزا المعلن قبل الإغلاق — توجد عمليات فيزا في هذه الوردية', 'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED', 400);
        if (serverWalletOperations > 0 && !hasDeclaredTotal(payload.walletDeclaredTotal)) throw new AppError('أدخل إجمالي المحافظ المعلن قبل الإغلاق — توجد عمليات محافظ في هذه الوردية', 'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED', 400);
        if (serverInstapayOperations > 0 && !hasDeclaredTotal(payload.instapayDeclaredTotal)) throw new AppError('أدخل إجمالي InstaPay المعلن قبل الإغلاق — توجد عمليات InstaPay في هذه الوردية', 'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED', 400);
        if (serverCashOperations > 0 && !hasDeclaredTotal(payload.countedCash)) throw new AppError('أدخل النقدية المعدودة قبل الإغلاق — توجد عمليات نقدية في هذه الوردية', 'SHIFT_CLOSE_DECLARED_TOTAL_REQUIRED', 400);
      }

      // Any real variance needs a note: the old 0.01 cutoff let a KWD
      // cashier close a shift 9 fils short with no explanation at all.
      if (!isBlindClose && variance !== 0) assertCashDrawerNote(note);

      // INV-REST-SHIFT-CLOSE-CONTROL (I21): a variance over the
      // shortage-tolerance cap needs a note of at least 10
      // characters. The closer's auth is passed into the variance
      // posting, so variance_approved_by is the closer.
      // Blind closes skip this: the reviewer approves at review.
      // INV-SOLO-ADMIN-SHIFT-CLOSE-OVER-TOLERANCE
      // (INV-SECOND-MANAGER-PASSWORD-REMOVED): NO second-manager
      // password is collected or required from ANY closer — an
      // admin, a manager, or any other role closes alone with the
      // >=10-char note. A supplied approverSecret is ignored. The
      // override is NOT silent: it still needs the >=10-char note,
      // and the override is stamped into the close note with who
      // closed, the variance and the tolerance cap;
      // variance_approved_by stays the closer, so the approver of
      // record is visible on the row.
      const postingAuth = auth;
      const toleranceCap = closeStatus === 'closed' ? await this.getCashierShortageTolerance(trx, scope.tenantId, digits) : 0;
      if (closeStatus === 'closed' && requiresSecondApproval(variance, toleranceCap)) {
        assertCashDrawerNote(note, 'SHIFT_SECOND_APPROVAL_NOTE_REQUIRED', 10);
        noteStamps.push(`اعتماد فرق منفرد بقرار إداري — أغلق ${String(auth.username || '')} الوردية — الفرق ${variance} وحد التسامح ${toleranceCap}`);
      }

      const stampedNote = [...(note ? [note] : []), ...noteStamps].join('\n\n');
      const closeNoteValue = blindCloseMeta ? this.serializeBlindCloseNote({ ...blindCloseMeta, note: stampedNote }) : stampedNote;

      await sql`update cashier_shifts set status = ${closeStatus}, expected_cash = ${expectedCash}, counted_cash = ${countedCash}, variance = ${variance}, close_note = ${closeNoteValue}, closed_by = ${auth.userId}, closed_at = ${closeNow} where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
      // F5: the close result the caller can show AFTER submitting.
      // Blind close: the closer never sees expected/variance amounts
      // (blind semantics — only the flag travels back); non-blind
      // close: the figures were visible in the form already, so the
      // response carries them. The audit row carries the full figures
      // either way — the reviewer reads them from the log.
      closedShiftResult = {
        id: shiftId,
        docNo: String(lockedShift.doc_no || ''),
        status: closeStatus,
        countedCash,
        hasVariance: variance !== 0,
        expectedCash: isBlindClose ? null : expectedCash,
        variance: isBlindClose ? null : variance,
      };
      if (this.audit && typeof this.audit.logWithExecutor === 'function') {
        await this.audit.logWithExecutor(
          trx,
          'إغلاق وردية',
          `أغلق ${String(auth.username || '')} وردية #${shiftId} — المتوقع ${expectedCash}، المعدود ${countedCash}، الفرق ${variance} — الحالة ${closeStatus}`,
          auth,
          { eventCode: AUDIT_EVENT_CODES.CASHIER_SHIFT_CLOSED },
        );
      }
      if (closeStatus === 'closed') {
        await this.accountingPosting.postCashierShiftVariance(trx, shiftId, postingAuth);
      }
    });

    if (this.whatsappService) {
      void this.whatsappService.sendShiftCloseNotification(shiftId, scope.tenantId).catch(() => undefined);
    }

    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, closedShift: closedShiftResult, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary };
  }

  /**
   * INV-BLIND-CLOSE-DECLARED-RECONCILIATION: the authoritative
   * declared-vs-computed reconciliation at book digits, computed
   * on the review transaction from the same breakdowns the listing
   * hydrates. The computed side mirrors the review screen's
   * definition exactly: card = card sales + service card − card
   * return refunds + customer card collections; wallet/instapay =
   * their sales totals + their customer collections, counts included.
   * Declared figures are re-rounded to book digits so shifts closed
   * at 2dp before this package reconcile against their stored values
   * unchanged.
   * INV-REST-SHIFT-CLOSE-CONTROL (I22): the reconciliation also
   * compares the itemised detail totals against the declared
   * totals (detailDelta). A mismatch never blocks review by
   * itself — it is recorded — but approving one now requires a
   * >=3-char note (see reviewCashierShiftClose).
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
    const collections = await this.computeShiftCustomerCollectionsByChannel(shift, auth, queryable, digits);
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
      card: channel(declared.cardTotal, declared.cardCount, breakdown.cardSalesTotal + services.serviceCardTotal - returns.saleReturnCardRefundTotal + collections.card, breakdown.cardOperationCount + collections.cardCount, Number(details.card || 0)),
      wallet: channel(declared.walletTotal, declared.walletCount, breakdown.walletSalesTotal + collections.wallet, breakdown.walletOperationCount + collections.walletCount, Number(details.wallet || 0)),
      instapay: channel(declared.instapayTotal, declared.instapayCount, breakdown.instapaySalesTotal + collections.instapay, breakdown.instapayOperationCount + collections.instapayCount, Number(details.instapay || 0)),
    };
  }

  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I22): the review is a decision.
   * 'approve' closes the shift and posts the variance — but any
   * mismatch (declared/computed delta, count delta, or
   * itemised-detail delta) requires a note of at least 3
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
    // P9 (RC-9) — one stamp source for the row: the JSON note stamps
    // (rejectedAt / reviewedAt) were app new Date() while the same
    // row's updated_at / closed_at were DB now(). Capture ONE server
    // instant for this review and use it for both, so the row never
    // mixes two clocks.
    const reviewNow = new Date();
    const managerNote = String(payload.note || '').trim();
    if (decision === 'reject' && managerNote.length < 3) {
      throw new AppError('اكتب سبب الرفض (3 أحرف على الأقل) قبل إعادة فتح الوردية', 'SHIFT_REVIEW_NOTE_REQUIRED', 400);
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
          parsedBlindClose.rejection = { note: managerNote, rejectedById: Number(auth.userId || 0), rejectedByName: String(auth.username || ''), rejectedAt: reviewNow.toISOString() };
          closeNoteValue = this.serializeBlindCloseNote(parsedBlindClose);
        } else {
          const line = `رفض مراجعة المدير: ${managerNote} — بواسطة ${String(auth.username || '')}`;
          closeNoteValue = rawCloseNote ? `${rawCloseNote}\n\n${line}` : line;
        }
        await sql`update cashier_shifts set status = 'open', counted_cash = null, variance = null, close_note = ${closeNoteValue}, closed_by = null, closed_at = null, updated_at = ${reviewNow} where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
        // F5: the rejection is audited with the figures it rejects.
        if (this.audit && typeof this.audit.logWithExecutor === 'function') {
          await this.audit.logWithExecutor(
            trx,
            'مراجعة إغلاق وردية',
            `رفض ${String(auth.username || '')} إغلاق وردية #${shiftId} — ${managerNote} — المتوقع ${Number((lockedShift as ShiftRow).expected_cash || 0)}، المعدود ${Number((lockedShift as ShiftRow).counted_cash || 0)}، الفرق ${Number((lockedShift as ShiftRow).variance || 0)}`,
            auth,
            { eventCode: AUDIT_EVENT_CODES.CASHIER_SHIFT_REVIEWED },
          );
        }
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
        if (hasMismatch && managerNote.length < 3) {
          throw new AppError('يوجد فرق في إقرار الإغلاق؛ اكتب ملاحظة مراجعة (3 أحرف على الأقل) قبل الاعتماد', 'SHIFT_REVIEW_NOTE_REQUIRED', 400);
        }
        parsedBlindClose.managerReview = { note: managerNote, reviewedById: Number(auth.userId || 0), reviewedByName: String(auth.username || ''), reviewedAt: reviewNow.toISOString() };
        parsedBlindClose.reconciliation = reconciliation;
        closeNoteValue = this.serializeBlindCloseNote(parsedBlindClose);
      } else if (managerNote) {
        closeNoteValue = rawCloseNote ? `${rawCloseNote}\n\nملاحظة مراجعة المدير: ${managerNote}` : `ملاحظة مراجعة المدير: ${managerNote}`;
      }

      await sql`update cashier_shifts set status = 'closed', close_note = ${closeNoteValue}, closed_by = coalesce(closed_by, ${auth.userId}), closed_at = coalesce(closed_at, ${reviewNow}), updated_at = ${reviewNow} where tenant_id = ${scope.tenantId} and id = ${shiftId}`.execute(trx);
      await this.accountingPosting.postCashierShiftVariance(trx, shiftId, auth);
      // F5: the approval is audited with the figures it approves.
      if (this.audit && typeof this.audit.logWithExecutor === 'function') {
        await this.audit.logWithExecutor(
          trx,
          'مراجعة إغلاق وردية',
          `اعتمد ${String(auth.username || '')} إغلاق وردية #${shiftId} — المتوقع ${Number((lockedShift as ShiftRow).expected_cash || 0)}، المعدود ${Number((lockedShift as ShiftRow).counted_cash || 0)}، الفرق ${Number((lockedShift as ShiftRow).variance || 0)}`,
          auth,
          { eventCode: AUDIT_EVENT_CODES.CASHIER_SHIFT_REVIEWED },
        );
      }
    });
    const listing = await this.listCashierShifts({}, auth);
    return { ok: true, cashierShifts: listing.cashierShifts, pagination: listing.pagination, summary: listing.summary, reconciliation };
  }
}
