import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import type { CashDrawerMovementType } from './helpers/cash-drawer.helper';
import { type ShiftCustomerCollectionsByChannel } from './helpers/shift-customer-collections.helper';
import type { ShiftRow, ShiftServiceBreakdown, ShiftSalesBreakdown, ShiftSaleReturnTotals, CloseOperationDetailInput, BlindCloseMetadata } from './cash-drawer.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { AuditService } from '../../core/audit/audit.service';
import { CashDrawerAuthService } from './cash-drawer-auth.service';
import { CashDrawerComputeService } from './cash-drawer-compute.service';
import { CashDrawerReadsService } from './cash-drawer-reads.service';
import { CashDrawerWriteService } from './cash-drawer-write.service';

const BLIND_CLOSE_NOTE_PREFIX = 'BLIND_CLOSE::';

@Injectable()
export class CashDrawerService {
  private readonly auth: CashDrawerAuthService;
  private readonly compute: CashDrawerComputeService;

  private readonly reads: CashDrawerReadsService;

  private readonly write: CashDrawerWriteService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly accountingPosting: AccountingPostingService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
    // F5: optional so specs that construct the service directly keep
    // working without an audit dep; the write slice guards the call.
    @Optional() private readonly audit?: AuditService,
  ) {
    this.auth = new CashDrawerAuthService({
      db: this.db,
      scope: this.scope.bind(this),
    });
    this.compute = new CashDrawerComputeService({
      db: this.db,
      scope: this.scope.bind(this),
      toBookMoney: this.toBookMoney.bind(this),
    });
    this.reads = new CashDrawerReadsService({
      db: this.db,
      scope: this.scope.bind(this),
      computeShiftAttributedSaleCash: this.computeShiftAttributedSaleCash.bind(this),
      computeShiftSalesBreakdown: this.computeShiftSalesBreakdown.bind(this),
      computeShiftServiceBreakdown: this.computeShiftServiceBreakdown.bind(this),
      computeShiftCashDrawerMovements: this.computeShiftCashDrawerMovements.bind(this),
      computeShiftSaleReturnTotals: this.computeShiftSaleReturnTotals.bind(this),
      computeShiftSupplierPaymentsTotal: this.computeShiftSupplierPaymentsTotal.bind(this),
      computeShiftExpensesTotal: this.computeShiftExpensesTotal.bind(this),
      computeShiftCustomerCollectionsByChannel: this.computeShiftCustomerCollectionsByChannel.bind(this),
      computeShiftCancelledSaleCashReceipts: this.computeShiftCancelledSaleCashReceipts.bind(this),
      computeShiftExpectedCashFromShift: this.computeShiftExpectedCashFromShift.bind(this),
      parseBlindCloseNote: this.parseBlindCloseNote.bind(this),
      serializeBlindCloseNote: this.serializeBlindCloseNote.bind(this),
    });
    this.write = new CashDrawerWriteService({
      db: this.db,
      tx: this.tx,
      accountingPosting: this.accountingPosting,
      whatsappService: this.whatsappService,
      audit: this.audit,
      scope: this.scope.bind(this),
      toBookMoney: this.toBookMoney.bind(this),
      serializeBlindCloseNote: this.serializeBlindCloseNote.bind(this),
      parseBlindCloseNote: this.parseBlindCloseNote.bind(this),
      normalizeOperationCount: this.normalizeOperationCount.bind(this),
      normalizeOperationDetails: this.normalizeOperationDetails.bind(this),
      isPasswordRequiredOnShiftOpen: this.isPasswordRequiredOnShiftOpen.bind(this),
      assertCurrentUserPassword: this.assertCurrentUserPassword.bind(this),
      // F5: shift open/close verify the signed-in user's own password
      // only — no manager fallback (see CashDrawerAuthService).
      assertCurrentUserPasswordStrict: this.assertCurrentUserPasswordStrict.bind(this),
      assertCashDrawerApproval: this.assertCashDrawerApproval.bind(this),
      canReviewPendingShift: this.canReviewPendingShift.bind(this),
      computeShiftExpectedCashFromShift: this.computeShiftExpectedCashFromShift.bind(this),
      computeShiftSalesBreakdown: this.computeShiftSalesBreakdown.bind(this),
      computeShiftServiceBreakdown: this.computeShiftServiceBreakdown.bind(this),
      computeShiftSaleReturnTotals: this.computeShiftSaleReturnTotals.bind(this),
      computeShiftCustomerCollectionsByChannel: this.computeShiftCustomerCollectionsByChannel.bind(this),
      getShift: this.getShift.bind(this),
      listCashierShifts: this.listCashierShifts.bind(this),
      getCashierShortageTolerance: this.getCashierShortageTolerance.bind(this),
      findOpenTablesBlockingClose: this.findOpenTablesBlockingClose.bind(this),
    });
  }

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

  private async assertManagerPin(pin: string, auth: AuthContext): Promise<void> {
    return this.auth.assertManagerPin(pin, auth);
  }

  private canReviewPendingShift(auth: AuthContext): boolean {
    return this.auth.canReviewPendingShift(auth);
  }

  private async assertCurrentUserPassword(password: string, auth: AuthContext): Promise<void> {
    return this.auth.assertCurrentUserPassword(password, auth);
  }

  private async assertCurrentUserPasswordStrict(password: string, auth: AuthContext): Promise<void> {
    return this.auth.assertCurrentUserPasswordStrict(password, auth);
  }

  private async isPasswordRequiredOnShiftOpen(auth: AuthContext): Promise<boolean> {
    return this.auth.isPasswordRequiredOnShiftOpen(auth);
  }

  private async assertCashDrawerApproval(movementType: CashDrawerMovementType, approvalSecret: string, auth: AuthContext): Promise<void> {
    return this.auth.assertCashDrawerApproval(movementType, approvalSecret, auth);
  }

  private async computeShiftCashDrawerMovements(shiftId: number, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<{
    cashInTotal: number;
    deliveryCashInTotal: number;
    manualCashInTotal: number;
    cashOutTotal: number;
    netMovementTotal: number;
  }> {
    return this.compute.computeShiftCashDrawerMovements(shiftId, auth, queryable, digits);
  }

  private async computeShiftSupplierPaymentsTotal(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<number> {
    return this.compute.computeShiftSupplierPaymentsTotal(shift, auth, queryable, digits);
  }

  private async computeShiftExpensesTotal(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<number> {
    return this.compute.computeShiftExpensesTotal(shift, auth, queryable, digits);
  }

  private async computeShiftServiceBreakdown(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<ShiftServiceBreakdown> {
    return this.compute.computeShiftServiceBreakdown(shift, auth, queryable, digits);
  }

  private async computeShiftSalesBreakdown(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<ShiftSalesBreakdown> {
    return this.compute.computeShiftSalesBreakdown(shift, auth, queryable, digits);
  }

  private async computeShiftSaleReturnTotals(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<ShiftSaleReturnTotals> {
    return this.compute.computeShiftSaleReturnTotals(shift, auth, queryable, digits);
  }

  private async computeShiftCustomerCollectionsByChannel(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<ShiftCustomerCollectionsByChannel> {
    return this.compute.computeShiftCustomerCollectionsByChannel(shift, auth, queryable, digits);
  }

  private async computeShiftCancelledSaleCashReceipts(
    shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits,
  ): Promise<number> {
    return this.compute.computeShiftCancelledSaleCashReceipts(shift, auth, queryable, digits);
  }

  private async computeShiftAttributedSaleCash(shift: ShiftRow, auth: AuthContext, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<{
    total: number;
    items: Array<{ id: string; kind: 'cash_in' | 'cash_out'; kindLabel: string; amount: number; note: string; createdAt: string }>;
  }> {
    return this.compute.computeShiftAttributedSaleCash(shift, auth, queryable, digits);
  }

  private async computeShiftExpectedCashFromShift(shift: ShiftRow, auth: AuthContext, salesBreakdown?: ShiftSalesBreakdown, serviceBreakdown?: ShiftServiceBreakdown, queryable?: Kysely<Database>, digits?: MoneyDigits): Promise<number> {
    return this.compute.computeShiftExpectedCashFromShift(shift, auth, salesBreakdown, serviceBreakdown, queryable, digits);
  }

  private async fetchShiftMovementItems(shiftId: number, shift: ShiftRow, auth: AuthContext): Promise<Array<{
    id: string;
    kind: 'cash_in' | 'cash_out' | 'delivery' | 'expense' | 'supplier_payment' | 'return';
    kindLabel: string;
    amount: number;
    note: string;
    createdAt: string;
  }>> {
    return this.reads.fetchShiftMovementItems(shiftId, shift, auth);
  }

  async getShift(shiftId: number, auth: AuthContext, queryable?: Kysely<Database>): Promise<ShiftRow | null> {
    return this.reads.getShift(shiftId, auth, queryable);
  }

  async computeShiftExpectedCash(shiftId: number, auth: AuthContext, queryable?: Kysely<Database>): Promise<number> {
    return this.reads.computeShiftExpectedCash(shiftId, auth, queryable);
  }

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
    return this.reads.refreshClosedShiftSummary(queryable, shiftId, stamp);
  }

  async listCashierShifts(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reads.listCashierShifts(query, auth);
  }

  private async getCashierShortageTolerance(queryable: Kysely<Database>, tenantId: string, digits: MoneyDigits): Promise<number> {
    return this.reads.getCashierShortageTolerance(queryable, tenantId, digits);
  }

  private async findOpenTablesBlockingClose(
    queryable: Kysely<Database>,
    tenantId: string,
    shift: ShiftRow,
  ): Promise<{ heldCount: number; heldTables: string[]; draftCount: number; totalCount: number }> {
    return this.reads.findOpenTablesBlockingClose(queryable, tenantId, shift);
  }

  async openCashierShift(payload: { openingCash?: number; note?: string; branchId?: number | string | null; locationId?: number | string | null; password?: string; managerPin?: string; terminalCode?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.openCashierShift(payload, auth);
  }

  async recordCashMovement(shiftId: number, payload: { type?: string; amount?: number; note?: string; managerPin?: string; requestKey?: string; counterpartAccountId?: number }, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.recordCashMovement(shiftId, payload, auth);
  }

  async closeCashierShift(shiftId: number, payload: { countedCash?: number; cardDeclaredTotal?: number; cardOperationCount?: number; walletDeclaredTotal?: number; walletOperationCount?: number; instapayDeclaredTotal?: number; instapayOperationCount?: number; cardDetails?: Array<{ amount?: number; reference?: string }>; walletDetails?: Array<{ amount?: number; reference?: string }>; instapayDetails?: Array<{ amount?: number; reference?: string }>; note?: string; managerPin?: string; approverSecret?: string; openTablesOverrideSecret?: string; openTablesOverrideReason?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.closeCashierShift(shiftId, payload, auth);
  }

  async reviewCashierShiftClose(shiftId: number, payload: { decision?: string; note?: string }, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.write.reviewCashierShiftClose(shiftId, payload, auth);
  }
}
