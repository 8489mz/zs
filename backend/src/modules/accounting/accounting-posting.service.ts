import { allocateInstallmentInterest } from './engines/installment-interest.engine';
import { Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Transaction } from 'kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AccountingTenantFoundationService } from './accounting-tenant-foundation.service';
import { AppError } from '../../common/errors/app-error';
import { type CogsResidualGroup } from './engines/cogs-residual.engine';
import { lockAccountingPeriod } from './accounting-period-lock';
import { tenantBaseCurrency } from './accounting-currency';
import { resolveBusinessDateKey } from './engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney, toMinorUnits, fromMinorUnits, MoneyDigits } from './engines/money-minor-units.engine';
import { scaledBomOverhead } from '../manufacturing/engines/manufacturing-overhead.engine';
import { partitionPurchaseLineTotals } from '../purchases/helpers/purchases-write.helper';
import { PdcPostingService } from './services/pdc-posting.service';
import { JournalPostingCoreService } from './services/journal-posting-core.service';
import { SalesAndReturnsPostingService } from './services/sales-returns-posting.service';
import { PurchasesAndTreasuryPostingService } from './services/purchases-treasury-posting.service';
import { HrPayrollPostingService } from './services/hr-payroll-posting.service';

export type DbOrTx = Kysely<Database> | Transaction<Database>;

export type JournalLineDraft = {
  accountId: number;
  description: string;
  debit: number;
  credit: number;
  partnerType: 'none' | 'customer' | 'supplier' | 'employee' | 'rep';
  partnerId: number | null;
  branchId: number | null;
  locationId: number | null;
  costCenterId?: number | null;
};

export type DomainJournalLineDraft = Omit<JournalLineDraft, 'branchId' | 'locationId'> & {
  branchId?: number | null;
  locationId?: number | null;
};

@Injectable()
export class AccountingPostingService {
  private readonly logger = new Logger(AccountingPostingService.name);

  private journalPostingCore: JournalPostingCoreService | null = null;

  private readonly pdcPosting: PdcPostingService;

  private readonly salesReturnsPosting: SalesAndReturnsPostingService;
  private readonly purchasesTreasuryPosting: PurchasesAndTreasuryPostingService;
  private readonly hrPayrollPosting: HrPayrollPostingService;

  constructor(
    private readonly accountingTenantFoundation: AccountingTenantFoundationService,
  ) {
    this.pdcPosting = new PdcPostingService({
      foundation: accountingTenantFoundation,
      getTenantAccountingSettings: this.getTenantAccountingSettings.bind(this),
      toMoney: this.toMoney.bind(this),
      addLine: this.addLine.bind(this),
      insertPostedJournal: this.insertPostedJournal.bind(this),
      resolveSystemAccountByCode: this.resolveSystemAccountByCode.bind(this),
    });
    this.salesReturnsPosting = new SalesAndReturnsPostingService({
      foundation: accountingTenantFoundation,
      getTenantAccountingSettings: this.getTenantAccountingSettings.bind(this),
      toMoney: this.toMoney.bind(this),
      maxAllowedDifference: this.maxAllowedDifference.bind(this),
      addLine: this.addLine.bind(this),
      insertPostedJournal: this.insertPostedJournal.bind(this),
      resolveSystemAccountByCode: this.resolveSystemAccountByCode.bind(this),
      resolveAccountWithFallback: this.resolveAccountWithFallback.bind(this),
      getExistingSaleJournal: this.getExistingSaleJournal.bind(this),
      getExistingSaleReversalJournal: this.getExistingSaleReversalJournal.bind(this),
      getExistingSalesReturnJournal: this.getExistingSalesReturnJournal.bind(this),
      getActiveAccountMap: this.getActiveAccountMap.bind(this),
      assertTransaction: this.assertTransaction.bind(this),
      logger: this.logger,
    });
    this.purchasesTreasuryPosting = new PurchasesAndTreasuryPostingService({
      foundation: accountingTenantFoundation,
      logger: this.logger,
      getTenantAccountingSettings: this.getTenantAccountingSettings.bind(this),
      toMoney: this.toMoney.bind(this),
      maxAllowedDifference: this.maxAllowedDifference.bind(this),
      addLine: this.addLine.bind(this),
      insertPostedJournal: this.insertPostedJournal.bind(this),
      postDomainJournal: this.postDomainJournal.bind(this),
      resolveSystemAccountByCode: this.resolveSystemAccountByCode.bind(this),
      resolveAccountWithFallback: this.resolveAccountWithFallback.bind(this),
      getActiveAccountMap: this.getActiveAccountMap.bind(this),
      assertTransaction: this.assertTransaction.bind(this),
      getExistingPurchaseJournal: this.getExistingPurchaseJournal.bind(this),
      getExistingPurchaseReversalJournal: this.getExistingPurchaseReversalJournal.bind(this),
      getExistingSupplierPaymentJournal: this.getExistingSupplierPaymentJournal.bind(this),
      getExistingSupplierPaymentScheduleSettlementJournal: this.getExistingSupplierPaymentScheduleSettlementJournal.bind(this),
      getExistingCustomerPaymentJournal: this.getExistingCustomerPaymentJournal.bind(this),
      getExistingExpenseJournal: this.getExistingExpenseJournal.bind(this),
    });
    this.hrPayrollPosting = new HrPayrollPostingService({
      foundation: accountingTenantFoundation,
      toMoney: this.toMoney.bind(this),
      addLine: this.addLine.bind(this),
      insertPostedJournal: this.insertPostedJournal.bind(this),
      resolveSystemAccountByCode: this.resolveSystemAccountByCode.bind(this),
    });
  }

  /**
   * Lazily-built journal core. The core is built on first use rather than
   * in the constructor, which also keeps the posting-digits-required spec
   * working: it drives addLine on Object.create(AccountingPostingService
   * .prototype) without ever running the constructor, and the original
   * addLine only needed the prototype method toMoney. Deps that need
   * instance state (logger, foundation) stay undefined on such an object,
   * exactly as the originals did, so those paths fail the same way they
   * did before the move.
   */
  private get postingCore(): JournalPostingCoreService {
    if (!this.journalPostingCore) {
      this.journalPostingCore = new JournalPostingCoreService({
        accountingTenantFoundation: this.accountingTenantFoundation,
        toMoney: this.toMoney.bind(this),
        maxAllowedDifference: this.maxAllowedDifference.bind(this),
        logger: this.logger,
      });
    }
    return this.journalPostingCore;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.accountingTenantFoundation.ensureForAuth(queryable, auth);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string) {
    return queryable
      .selectFrom('accounting_settings')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', 1)
      .executeTakeFirst();
  }

  private async getDeliveryFeeMode(queryable: DbOrTx, tenantId: string): Promise<'freelance_courier' | 'store_fleet'> {
    const row = await queryable
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'deliveryFeeMode')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    if (!row?.value) return 'freelance_courier';
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return parsed === 'store_fleet' ? 'store_fleet' : 'freelance_courier';
    } catch {
      return String(row.value).includes('store_fleet') ? 'store_fleet' : 'freelance_courier';
    }
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) throw new AppError('Journal amount must be finite', 'INVALID_JOURNAL_AMOUNT', 400);
    return roundMoney(amount, digits);
  }

  private maxAllowedDifference(bookDigits: MoneyDigits): number {
    return 10 ** -bookDigits;
  }

  private async resolveAccountWithFallback(
    queryable: DbOrTx,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ): Promise<number> {
    return this.postingCore.resolveAccountWithFallback(queryable, tenantId, configuredId, fallbackCode);
  }

  private async getExistingSaleJournal(queryable: DbOrTx, saleId: number, tenantId: string) {
    return this.postingCore.getExistingSaleJournal(queryable, saleId, tenantId);
  }

  private async getExistingSaleEditJournal(queryable: DbOrTx, saleId: number, tenantId: string) {
    return this.postingCore.getExistingSaleEditJournal(queryable, saleId, tenantId);
  }

  private async getExistingPurchaseJournal(queryable: DbOrTx, purchaseId: number, tenantId: string) {
    return this.postingCore.getExistingPurchaseJournal(queryable, purchaseId, tenantId);
  }

  private async getExistingSupplierPaymentJournal(queryable: DbOrTx, paymentId: number, tenantId: string) {
    return this.postingCore.getExistingSupplierPaymentJournal(queryable, paymentId, tenantId);
  }

  private async getExistingSupplierPaymentScheduleSettlementJournal(queryable: DbOrTx, settlementId: number, tenantId: string) {
    return this.postingCore.getExistingSupplierPaymentScheduleSettlementJournal(queryable, settlementId, tenantId);
  }

  private async getExistingCustomerPaymentJournal(queryable: DbOrTx, paymentId: number, tenantId: string) {
    return this.postingCore.getExistingCustomerPaymentJournal(queryable, paymentId, tenantId);
  }

  private async getExistingExpenseJournal(queryable: DbOrTx, expenseId: number, tenantId: string) {
    return this.postingCore.getExistingExpenseJournal(queryable, expenseId, tenantId);
  }

  private async getExistingSaleReversalJournal(queryable: DbOrTx, saleId: number, tenantId: string) {
    return this.postingCore.getExistingSaleReversalJournal(queryable, saleId, tenantId);
  }

  private async getExistingPurchaseReversalJournal(queryable: DbOrTx, purchaseId: number, tenantId: string) {
    return this.postingCore.getExistingPurchaseReversalJournal(queryable, purchaseId, tenantId);
  }

  private async getExistingSalesReturnJournal(queryable: DbOrTx, returnId: number, tenantId: string) {
    return this.postingCore.getExistingSalesReturnJournal(queryable, returnId, tenantId);
  }

  private async getActiveAccountMap(queryable: DbOrTx, tenantId: string, accountIds: number[]): Promise<Map<number, boolean>> {
    return this.postingCore.getActiveAccountMap(queryable, tenantId, accountIds);
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    this.postingCore.addLine(lines, next, digits);
  }

  async postDomainJournal(
    queryable: DbOrTx,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date;
      description: string;
      branchId?: number | null;
      locationId?: number | null;
      createdBy: number | null;
      postedBy?: number | null;
      cashFlowCategory?: 'operating' | 'investing' | 'financing' | null;
      /** Links the new entry as the reversal of a posted original; insertPostedJournal validates and stamps the original. */
      reversalOfEntryId?: number | null;
      lines: DomainJournalLineDraft[];
    },
  ): Promise<number> {
    return this.postingCore.postDomainJournal(queryable, params);
  }

  async postTradeInCashPurchase(queryable: DbOrTx, tradeInId: number, auth: AuthContext): Promise<number | null> {
    return this.purchasesTreasuryPosting.postTradeInCashPurchase(queryable, tradeInId, auth);
  }

  private async insertPostedJournal(
    queryable: any,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date;
      description: string;
      branchId: number | null;
      locationId: number | null;
      createdBy: number | null;
      postedBy: number | null;
      cashFlowCategory?: 'operating' | 'investing' | 'financing' | null;
      lines: JournalLineDraft[];
      reversalOfEntryId?: number | null;
    },
  ): Promise<number> {
    return this.postingCore.insertPostedJournal(queryable, params);
  }

  private assertTransaction(queryable: unknown, method: string): asserts queryable is Transaction<Database> {
    // TS2775: an assertion body may only call another assertion through a
    // name with an explicit type annotation — a getter's return type does
    // not count, so bind the core to an explicitly-typed local first.
    const core: JournalPostingCoreService = this.postingCore;
    core.assertTransaction(queryable, method);
  }

  private async saleCogsResidual(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
  ): Promise<number> {
    return this.salesReturnsPosting.saleCogsResidual(queryable, tenantId, saleId, bookDigits);
  }

  private async readSaleResidualLines(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
  ): Promise<Array<{ id: number; product_id: number | null; qty: number | string; cost_price: number | string | null; unit_multiplier: number | string | null; modifiers: unknown }>> {
    return this.salesReturnsPosting.readSaleResidualLines(queryable, tenantId, saleId);
  }

  private async residualCogsGroups(
    queryable: Transaction<Database>,
    tenantId: string,
    saleItems: Array<{ id: number; product_id: number | null; qty: number | string; cost_price: number | string | null; unit_multiplier: number | string | null; modifiers: unknown }>,
    qtySoldBySaleItemId: Map<number, number> | null,
  ): Promise<CogsResidualGroup[]> {
    return this.salesReturnsPosting.residualCogsGroups(queryable, tenantId, saleItems, qtySoldBySaleItemId);
  }

  private async salesReturnCogsResidual(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
    returnedQtyBySaleItemId: Map<number, number>,
  ): Promise<number> {
    return this.salesReturnsPosting.salesReturnCogsResidual(queryable, tenantId, saleId, bookDigits, returnedQtyBySaleItemId);
  }

  private async salesReturnCogsAmount(
    queryable: Transaction<Database>,
    tenantId: string,
    sale: { id: number } | null,
    returnItems: Array<{ product_id: number | null; sale_item_id: number | null; qty: number | string; cost_price?: number | string | null }>,
    saleItems: Array<{ id: number; product_id: number | null; cost_price: number | string | null }>,
    bookDigits: MoneyDigits,
  ): Promise<number> {
    return this.salesReturnsPosting.salesReturnCogsAmount(queryable, tenantId, sale, returnItems, saleItems, bookDigits);
  }

  private async addSaleRevenueCreditLegs(
    queryable: DbOrTx,
    tenantId: string,
    add: (line: JournalLineDraft) => void,
    input: {
      subtotal: number;
      taxAmount: number;
      deliveryFee: number;
      deliveryFeeMode: string | null | undefined;
      serviceCharge: number;
      tipAmount: number;
      pricesIncludeTax: boolean;
      revenueCredit: number;
      goodsAccountId: number;
      branchId: number | null;
      locationId: number | null;
      contextLabel: string;
    },
    bookDigits: MoneyDigits,
  ): Promise<void> {
    return this.salesReturnsPosting.addSaleRevenueCreditLegs(queryable, tenantId, add, input, bookDigits);
  }

  async postSale(queryable: Transaction<Database>, saleId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number }> {
    return this.salesReturnsPosting.postSale(queryable, saleId, auth);
  }

  async postSaleEdit(
    queryable: Transaction<Database>,
    saleId: number,
    auth: AuthContext,
    reason?: string,
    options?: {
      preparedWaste?: {
        oldItems: Array<{ id: number; product_id: number | null; qty: number | string; cost_price: number | string | null; unit_multiplier: number | string | null; modifiers: unknown }>;
        restoredQtyBySaleItemId: Map<number, number>;
      };
    },
  ): Promise<{ posted: boolean; journalEntryId: number }> {
    return this.salesReturnsPosting.postSaleEdit(queryable, saleId, auth, reason, options);
  }

  async reverseSaleJournal(queryable: DbOrTx, saleId: number, reason: string, auth: AuthContext, options?: { isPreparedWaste?: boolean; preparedWasteCogsExclusion?: number }): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    return this.salesReturnsPosting.reverseSaleJournal(queryable, saleId, reason, auth, options);
  }

  async reverseSaleJournalById(
    queryable: DbOrTx,
    saleId: number,
    journalId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    return this.salesReturnsPosting.reverseSaleJournalById(queryable, saleId, journalId, reason, auth);
  }

  private async priorSalesReturnRelief(
    queryable: DbOrTx,
    tenantId: string,
    saleId: number,
    excludeReturnId: number | null,
  ): Promise<{ tip: number; courier: number }> {
    return this.salesReturnsPosting.priorSalesReturnRelief(queryable, tenantId, saleId, excludeReturnId);
  }

  private async priorSalesReturnReceivableCredit(
    queryable: DbOrTx,
    tenantId: string,
    saleId: number,
  ): Promise<number> {
    return this.salesReturnsPosting.priorSalesReturnReceivableCredit(queryable, tenantId, saleId);
  }

  async deliverySettlementBasis(
    queryable: DbOrTx,
    saleId: number,
    auth: AuthContext,
  ): Promise<{ totalDebt: number; remainingReceivable: number; remainingFee: number }> {
    return this.salesReturnsPosting.deliverySettlementBasis(queryable, saleId, auth);
  }

  async postDeliveryCustodyReclassification(
    queryable: Transaction<Database>,
    saleId: number,
    repId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; amount: number; customerId: number | null; docNo: string }> {
    return this.salesReturnsPosting.postDeliveryCustodyReclassification(queryable, saleId, repId, auth);
  }

  async hasDeliveryCustodyReclassification(
    queryable: DbOrTx,
    saleId: number,
    auth: AuthContext,
  ): Promise<boolean> {
    return this.salesReturnsPosting.hasDeliveryCustodyReclassification(queryable, saleId, auth);
  }

  private async deliveryCustodyPartner(
    queryable: DbOrTx,
    saleId: number,
  ): Promise<{ partnerType: 'rep' | 'none'; partnerId: number | null }> {
    return this.salesReturnsPosting.deliveryCustodyPartner(queryable, saleId);
  }

  async getRepCustodyBalance(
    queryable: DbOrTx,
    repId: number,
    auth: AuthContext,
  ): Promise<number> {
    return this.salesReturnsPosting.getRepCustodyBalance(queryable, repId, auth);
  }

  async computeSalesReturnRelief(
    queryable: DbOrTx,
    tenantId: string,
    sale: { id: number; subtotal?: unknown; discount?: unknown; tip_amount?: unknown; delivery_fee?: unknown; delivery_fee_mode?: unknown; service_charge?: unknown; tax_amount?: unknown; prices_include_tax?: unknown } | null | undefined,
    returnTotal: number,
    netReturnAmount: number,
    excludeReturnId: number | null,
  ): Promise<{ tipRelief: number; courierRelief: number; totalRelief: number }> {
    return this.salesReturnsPosting.computeSalesReturnRelief(queryable, tenantId, sale, returnTotal, netReturnAmount, excludeReturnId);
  }

  async postSalesReturn(queryable: Transaction<Database>, returnId: number, auth: AuthContext,
    collectExchangeLines?: (lines: JournalLineDraft[]) => void): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.salesReturnsPosting.postSalesReturn(queryable, returnId, auth, collectExchangeLines);
  }

  async postPurchase(queryable: Transaction<Database>, purchaseId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number }> {
    return this.purchasesTreasuryPosting.postPurchase(queryable, purchaseId, auth);
  }
  async postPurchaseReturn(queryable: Transaction<Database>, returnId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.postPurchaseReturn(queryable, returnId, auth);
  }
  async reversePurchaseJournal(queryable: DbOrTx, purchaseId: number, reason: string, auth: AuthContext): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.reversePurchaseJournal(queryable, purchaseId, reason, auth);
  }
  async postSupplierPayment(queryable: DbOrTx, paymentId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.postSupplierPayment(queryable, paymentId, auth);
  }
  /* INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT: apply an advance against a
   * later bill — Dr 2110 / Cr 1185 (see
   * PurchasesAndTreasuryPostingService.postSupplierAdvanceApplication). */
  async postSupplierAdvanceApplication(queryable: DbOrTx, advancePaymentId: number, applyAmount: number, purchaseId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null; appliedAmount: number; remainingAdvance: number }> {
    return this.purchasesTreasuryPosting.postSupplierAdvanceApplication(queryable, advancePaymentId, applyAmount, purchaseId, auth);
  }
  async postSupplierPaymentScheduleSettlement(queryable: DbOrTx, settlementId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.postSupplierPaymentScheduleSettlement(queryable, settlementId, auth);
  }
  async postCustomerPayment(queryable: DbOrTx, paymentId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.postCustomerPayment(queryable, paymentId, auth);
  }
  async postExpense(queryable: DbOrTx, expenseId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.postExpense(queryable, expenseId, auth);
  }
  async postExpenseReversal(queryable: DbOrTx, expenseId: number, reason: string, auth: AuthContext): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.postExpenseReversal(queryable, expenseId, reason, auth);
  }

  async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.postingCore.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  async postInventoryAdjustment(queryable: DbOrTx, movementId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    // Check for idempotency via database unique constraint on insert
    const movement = await queryable
      .selectFrom('stock_movements')
      .selectAll()
      .where('id', '=', movementId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!movement) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    const delta = Number(movement.after_qty || 0) - Number(movement.before_qty || 0);
    const isFinalIssue = movement.movement_type === 'transfer_final_issue' && movement.reason === 'final_issue';
    const isTransitLoss = movement.movement_type === 'transfer_transit_loss' && movement.reason === 'transit_shrinkage';
    if (Math.abs(delta) < 0.001) return { posted: false, journalEntryId: null, hasFinancialImpact: false }; // No variance

    const rawCost = Number(movement.unit_cost || 0);
    const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
    // Use the immutable amount recorded at the time of the physical movement.
    // Re-multiplying a rounded per-unit cost can drift by cents for fractional quantities.
    const rawTotal = movement.total_cost == null ? null : Number(movement.total_cost);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = rawTotal != null && Number.isFinite(rawTotal) && rawTotal >= 0
      ? this.toMoney(rawTotal, moneyDigits) : this.toMoney(Math.abs(delta) * unitCost, moneyDigits);

    if (amount <= 0) {
      return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing`);
    const inventoryAccountId = Number(settings.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      // Fallback code 1140
      const fallbackId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      if (!fallbackId) throw new Error('Inventory account not configured and fallback 1140 not found');
    }

    const accountIdToUse = inventoryAccountId > 0 ? inventoryAccountId : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const lines: JournalLineDraft[] = [];
    const branchId = movement.branch_id ? Number(movement.branch_id) : null;
    const locationId = movement.location_id ? Number(movement.location_id) : null;

    if (delta > 0) {
      // Gain
      const gainAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      this.addLine(lines, { accountId: accountIdToUse, description: 'تسوية زيادة مخزون', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
      this.addLine(lines, { accountId: gainAccountId, description: 'أرباح تسوية مخزون', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
    } else {
      // Loss
      const lossAccountCode = isFinalIssue ? '6900' : isTransitLoss ? '5300' : '5200';
      const lossAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, lossAccountCode);
      this.addLine(lines, { accountId: lossAccountId, description: isFinalIssue ? 'مواد تشغيل مصروفة نهائياً' : isTransitLoss ? 'هالك وفاقد بضاعة أثناء النقل' : 'خسائر تسوية مخزون', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
      this.addLine(lines, { accountId: accountIdToUse, description: isFinalIssue ? 'تخفيض المخزون بموجب إذن صرف نهائي' : isTransitLoss ? 'تخفيض مخزون البضاعة بالطريق بسبب الفاقد' : 'نقص تسوية مخزون', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'inventory_adjustment',
        sourceId: movementId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: movement.created_at ? new Date(movement.created_at) : new Date(),
        description: isFinalIssue ? `قيد صرف مخزون نهائي - حركة #${movementId}` : `قيد تسوية مخزون - حركة #${movementId}`,
        branchId,
        locationId,
        createdBy: movement.created_by ? Number(movement.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'inventory_adjustment').where('source_id', '=', movementId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }

  async postDamagedStock(queryable: DbOrTx, damageRecordId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const record = await queryable
      .selectFrom('damaged_stock_records')
      .selectAll()
      .where('id', '=', damageRecordId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!record) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    const qty = Number(record.qty || 0);
    if (qty <= 0) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    const rawCost = Number(record.unit_cost || 0);
    const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
    // Post the immutable stored cost of the physical write, never independently
    // round quantity * WAC to cents for a 3-decimal tenant.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const storedTotal = record.total_cost == null ? null : Number(record.total_cost);
    const amount = this.toMoney(
      storedTotal != null && Number.isFinite(storedTotal) && storedTotal >= 0
        ? storedTotal : qty * unitCost,
      moneyDigits,
    );

    if (amount <= 0) {
      return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
    }
    const damagedExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    const branchId = record.branch_id ? Number(record.branch_id) : null;
    const locationId = record.location_id ? Number(record.location_id) : null;

    const lines: JournalLineDraft[] = [];
    this.addLine(lines, { accountId: damagedExpenseAccountId, description: 'مصروف مخزون تالف', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
    this.addLine(lines, { accountId: inventoryAccountId, description: 'نقص مخزون بسبب التلف', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'damaged_stock',
        sourceId: damageRecordId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: record.created_at ? new Date(record.created_at) : new Date(),
        description: `قيد بضاعة تالفة - سجل #${damageRecordId}`,
        branchId,
        locationId,
        createdBy: record.created_by ? Number(record.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'damaged_stock').where('source_id', '=', damageRecordId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }

  /**
   * INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE: the ONE balanced journal
   * for a field damaged-goods swap, posted in the same transaction as
   * the stock moves by executeDamagedSwap. A swap is not a plain
   * damage write-off (postDamagedStock covers only Dr 5300 / Cr 1140
   * for the damaged item) — the replacement also leaves the van and
   * the price difference moves the customer's balance — so the legs
   * are, all at tenant book digits:
   *   Dr 5300 damagedCost — the damaged item is written off at cost
   *     (it sits quarantined in the damaged location at zero GL value).
   *   Dr 5100 replacementCost — cost of the replacement given out.
   *   Cr 1140 damagedCost + replacementCost — inventory out of the van
   *     (replacement) and out of the damaged location (write-off).
   *   priceDiff > 0 with a customer: Dr 1130 / Cr 4100 — the customer
   *     owes the extra value; priceDiff < 0: Dr 4100 / Cr 1130 — the
   *     customer is owed it. The 1130 leg is the GL mirror of the
   *     customer_ledger 'swap_price_adjustment' row, so subledger and
   *     GL agree. With no customer there is no receivable and no
   *     revenue leg: the cost legs already carry the economics and the
   *     retail-value difference has no money movement to record.
   * Idempotent: source ('van_damaged_swap', swapId) is unique per
   * swap — the pre-insert SELECT plus the extended
   * idx_journal_entries_van_sales_uniq (migration 0315) mean a
   * retried swap can never double-post, even if the caller retries
   * the whole swap. Zero-amount legs are skipped individually so a
   * free replacement or a zero-cost damaged item still posts the
   * remaining legs; all-zero posts nothing.
   */
  async postVanDamagedSwap(
    queryable: DbOrTx,
    swapId: number,
    params: {
      damagedQty: number;
      damagedUnitCost: number;
      replacementQty: number;
      replacementUnitCost: number;
      priceDifference: number;
      customerId?: number | null;
      branchId: number | null;
      locationId: number | null;
      damagedLocationId: number | null;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_damaged_swap')
      .where('source_id', '=', swapId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id), hasFinancialImpact: true };

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const damagedCost = this.toMoney(Number(params.damagedQty || 0) * Number(params.damagedUnitCost || 0), moneyDigits);
    const replacementCost = this.toMoney(Number(params.replacementQty || 0) * Number(params.replacementUnitCost || 0), moneyDigits);
    const priceDiff = this.toMoney(params.priceDifference, moneyDigits);
    const customerId = params.customerId != null ? Number(params.customerId) : null;
    if (damagedCost <= 0 && replacementCost <= 0 && !(priceDiff !== 0 && customerId != null)) {
      return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
    }
    let cogsAccountId = Number(settings?.cogs_account_id || 0);
    if (!(cogsAccountId > 0)) {
      cogsAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5100');
    }
    let revenueAccountId = Number(settings?.sales_revenue_account_id || 0);
    if (!(revenueAccountId > 0)) {
      revenueAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '4100');
    }
    let receivableAccountId = Number(settings?.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0)) {
      receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    }
    const damagedExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    const branchId = params.branchId;
    const vanLocationId = params.locationId;
    const damagedLocationId = params.damagedLocationId;
    const lines: JournalLineDraft[] = [];
    if (damagedCost > 0) {
      this.addLine(lines, { accountId: damagedExpenseAccountId, description: `مصروف بضاعة تالفة - استبدال ميداني #${swapId}`, debit: damagedCost, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId: damagedLocationId }, moneyDigits);
      this.addLine(lines, { accountId: inventoryAccountId, description: `نقص مخزون بسبب تلف - استبدال ميداني #${swapId}`, debit: 0, credit: damagedCost, partnerType: 'none', partnerId: null, branchId, locationId: damagedLocationId }, moneyDigits);
    }
    if (replacementCost > 0) {
      this.addLine(lines, { accountId: cogsAccountId, description: `تكلفة البضاعة البديلة - استبدال ميداني #${swapId}`, debit: replacementCost, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId: vanLocationId }, moneyDigits);
      this.addLine(lines, { accountId: inventoryAccountId, description: `صرف بضاعة بديلة من السيارة - استبدال ميداني #${swapId}`, debit: 0, credit: replacementCost, partnerType: 'none', partnerId: null, branchId, locationId: vanLocationId }, moneyDigits);
    }
    if (priceDiff > 0 && customerId != null) {
      this.addLine(lines, { accountId: receivableAccountId, description: `فارق سعر استبدال تالف مستحق على العميل - استبدال ميداني #${swapId}`, debit: priceDiff, credit: 0, partnerType: 'customer', partnerId: customerId, branchId, locationId: vanLocationId }, moneyDigits);
      this.addLine(lines, { accountId: revenueAccountId, description: `إيراد فارق سعر استبدال تالف - استبدال ميداني #${swapId}`, debit: 0, credit: priceDiff, partnerType: 'none', partnerId: null, branchId, locationId: vanLocationId }, moneyDigits);
    }
    if (priceDiff < 0 && customerId != null) {
      const owed = Math.abs(priceDiff);
      this.addLine(lines, { accountId: revenueAccountId, description: `عكس إيراد فارق سعر استبدال تالف - استبدال ميداني #${swapId}`, debit: owed, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId: vanLocationId }, moneyDigits);
      this.addLine(lines, { accountId: receivableAccountId, description: `فارق سعر استبدال تالف مستحق للعميل - استبدال ميداني #${swapId}`, debit: 0, credit: owed, partnerType: 'customer', partnerId: customerId, branchId, locationId: vanLocationId }, moneyDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_damaged_swap',
        sourceId: swapId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد استبدال تالف ميداني #${swapId}`,
        branchId,
        locationId: vanLocationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_van_sales_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
         const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'van_damaged_swap').where('source_id', '=', swapId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing2?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }

  async postFoodWaste(queryable: DbOrTx, wasteLogId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const log = await queryable
      .selectFrom('restaurant_food_waste_logs')
      .selectAll()
      .where('id', '=', wasteLogId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!log) return { posted: false, journalEntryId: null };

    const totalCost = Number(log.total_cost || 0);
    if (totalCost <= 0) return { posted: false, journalEntryId: null };

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = this.toMoney(totalCost, moneyDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
    }
    const wasteExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    const branchId = log.branch_id ? Number(log.branch_id) : null;
    const locationId: number | null = null;

    const lines: JournalLineDraft[] = [];
    this.addLine(lines, {
      accountId: wasteExpenseAccountId,
      description: `مصروف هدر وتالف مطبخ - ${log.reason}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    }, moneyDigits);
    this.addLine(lines, {
      accountId: inventoryAccountId,
      description: 'نقص مخزون بسبب هدر المطبخ',
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    }, moneyDigits);

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'food_waste',
        sourceId: wasteLogId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: log.created_at ? new Date(log.created_at) : new Date(),
        description: `قيد هدر وتالف مطبخ - سجل #${wasteLogId}`,
        branchId,
        locationId,
        createdBy: log.logged_by ? Number(log.logged_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'food_waste')
          .where('source_id', '=', wasteLogId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postStockCount(queryable: DbOrTx, sessionId: number, auth: AuthContext, itemIds?: number[]): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const stockCountDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, requireTenantScope(auth).tenantId));
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const session = await queryable.selectFrom('stock_count_sessions').selectAll().where('id', '=', sessionId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (!session) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    let itemQuery = queryable.selectFrom('stock_count_items').selectAll()
      .where('session_id', '=', sessionId).where('tenant_id', '=', scope.tenantId);
    if (itemIds) {
      if (!itemIds.length) return { posted: false, journalEntryId: null, hasFinancialImpact: false };
      itemQuery = itemQuery.where('id', 'in', itemIds);
    }
    const items = await itemQuery.execute();
    const productIds = items.map((item) => Number(item.product_id));
    const movements = productIds.length ? await queryable.selectFrom('stock_movements').selectAll()
      .where('reference_type', '=', 'stock_count_session').where('reference_id', '=', sessionId)
      .where('tenant_id', '=', scope.tenantId).where('product_id', 'in', productIds).execute() : [];
    const movementByProduct = new Map(movements.map((movement) => [Number(movement.product_id), movement]));

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const gainAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
    const lossAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5200');
    const damagedExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    let totalGain = 0;
    let totalLoss = 0;
    let totalDamageLoss = 0;

    for (const item of items) {
       const variance = Number(item.variance_qty || 0);

       const mov = movementByProduct.get(Number(item.product_id));
       // INV-STOCK-COUNT-ACTUAL-DELTA: the movement row carries the
       // actual scoped delta the stock write really moved. Value the
       // journal on it, not on the frozen available-basis variance.
       // Fall back to the stored variance only when no movement row
       // exists (chunks posted before this fix, whose movements carry
       // the frozen variance) -- prospective only, no history rewritten.
       const delta = mov ? Number((mov as any).qty ?? 0) : variance;
       if (delta === 0) continue;

       const rawCost = Number(mov?.unit_cost || 0);
       const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
       const lineCost = roundMoney(Math.abs(delta) * unitCost, stockCountDigits);
       if (lineCost <= 0) continue;

       if (delta > 0) {
          totalGain += lineCost;
       } else if (delta < 0) {
          if (String(item.reason || '').toLowerCase() === 'damage') {
             totalDamageLoss += lineCost;
          } else {
             totalLoss += lineCost;
          }
       }
    }

    if (totalGain === 0 && totalLoss === 0 && totalDamageLoss === 0) {
       return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const branchId = session.branch_id ? Number(session.branch_id) : null;
    const locationId = session.location_id ? Number(session.location_id) : null;

    const lines: JournalLineDraft[] = [];
    if (totalGain > 0) {
       this.addLine(lines, { accountId: inventoryAccountId, description: 'فائض جرد مخزون', debit: totalGain, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
       this.addLine(lines, { accountId: gainAccountId, description: 'أرباح جرد مخزون', debit: 0, credit: totalGain, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
    }
    if (totalLoss > 0) {
       this.addLine(lines, { accountId: lossAccountId, description: 'عجز جرد مخزون', debit: totalLoss, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
       this.addLine(lines, { accountId: inventoryAccountId, description: 'نقص مخزون بسبب العجز', debit: 0, credit: totalLoss, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
    }
    if (totalDamageLoss > 0) {
       this.addLine(lines, { accountId: damagedExpenseAccountId, description: 'عجز جرد (تالف)', debit: totalDamageLoss, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
       this.addLine(lines, { accountId: inventoryAccountId, description: 'نقص مخزون (تالف بالجرد)', debit: 0, credit: totalDamageLoss, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: itemIds ? 'stock_count_chunk' : 'stock_count',
        sourceId: itemIds ? itemIds[0] : sessionId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: session.posted_at ? new Date(session.posted_at) : new Date(),
        description: `قيد تسوية جرد - جلسة #${sessionId}`,
        branchId,
        locationId,
        createdBy: session.approved_by ? Number(session.approved_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (e.code === '23505' && (
        e.constraint?.includes('idx_journal_entries_round1_uniq')
        || e.constraint?.includes('idx_journal_entries_stock_count_chunk_uniq')
      )) {
         const existing = await queryable.selectFrom('journal_entries').select('id')
           .where('source_type', '=', itemIds ? 'stock_count_chunk' : 'stock_count')
           .where('source_id', '=', itemIds ? itemIds[0] : sessionId)
           .where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }

  async postService(queryable: DbOrTx, serviceId: number, revision: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const service = await queryable.selectFrom('services').selectAll().where('id', '=', serviceId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (!service) return { posted: false, journalEntryId: null };

    const amount = toBookMoney(service.amount);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let cashAccountId = Number(settings?.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');

    let bankAccountId = Number(settings?.bank_account_id || 0);
    if (!(bankAccountId > 0)) bankAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');

    const revenueAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '4200');

    const branchId = service.branch_id ? Number(service.branch_id) : null;
    const locationId = service.location_id ? Number(service.location_id) : null;
    const isCard = service.payment_channel === 'card';

    const lines: JournalLineDraft[] = [];
    if (isCard) {
      this.addLine(lines, { accountId: bankAccountId, description: `إيراد خدمة بنكي: ${service.name}`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    } else {
      this.addLine(lines, { accountId: cashAccountId, description: `إيراد خدمة نقدي: ${service.name}`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }
    this.addLine(lines, { accountId: revenueAccountId, description: `إيراد خدمة: ${service.name}`, debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);

    // Use composite source_id for idempotency on revisions
    const sourceIdComposite = Number(`${serviceId}000${revision}`);

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'service',
        sourceId: sourceIdComposite,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: service.service_date ? new Date(service.service_date) : new Date(),
        description: `قيد إيراد خدمة - #${serviceId} Rev ${revision}`,
        branchId,
        locationId,
        createdBy: service.created_by ? Number(service.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'service').where('source_id', '=', sourceIdComposite).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async reverseService(queryable: DbOrTx, serviceId: number, revision: number, auth: AuthContext): Promise<void> {
    const scope = requireTenantScope(auth);
    // Find the original journal entry for this specific revision
    const sourceIdComposite = Number(`${serviceId}000${revision}`);
    const original = await queryable.selectFrom('journal_entries').selectAll().where('source_type', '=', 'service').where('source_id', '=', sourceIdComposite).where('tenant_id', '=', scope.tenantId).where('status', '=', 'posted').executeTakeFirst();
    if (!original) return; // Nothing to reverse

    const originalLines = await queryable.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', original.id).where('tenant_id', '=', scope.tenantId).execute();

    const lines: JournalLineDraft[] = originalLines.map(l => ({
      accountId: Number(l.account_id),
      description: `عكس ${l.description}`,
      debit: Number(l.credit), // Flip
      credit: Number(l.debit), // Flip
      partnerType: l.partner_type as any,
      partnerId: l.partner_id ? Number(l.partner_id) : null,
      branchId: l.branch_id ? Number(l.branch_id) : null,
      locationId: l.location_id ? Number(l.location_id) : null,
    }));

    try {
      await this.insertPostedJournal(queryable, {
        sourceType: 'service_reversal',
        sourceId: sourceIdComposite,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `عكس قيد خدمة - #${serviceId} Rev ${revision}`,
        branchId: original.branch_id ? Number(original.branch_id) : null,
        locationId: original.location_id ? Number(original.location_id) : null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
    } catch (e: any) {
       if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
          // Already reversed
          return;
       }
       throw e;
    }
  }

  /**
   * Cash shortage tolerance per shift. Shortages at or below it are absorbed as an operating
   * expense; anything above becomes a receivable on the custodian. When the tenant has never
   * configured cashierShortageTolerance, the default is one minor unit
   * (INV-CASHIER-SHORTAGE-TOLERANCE-DEFAULT): a dust shortage of a fils is an operating cost of
   * running a till, not a receivable that accumulates per cashier. An explicitly configured
   * value — including 0 — is honoured exactly; only the unset case (no row, null, or empty
   * value) defaults. Unparseable or negative values fail closed to 0, as before, and a read
   * error fails closed to 0 as well. There is no settings UI for this key; it is set directly
   * in settings.
   */
  private async getCashierShortageTolerance(queryable: DbOrTx, tenantId: string, digits: MoneyDigits): Promise<number> {
    try {
      const row = await queryable
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', tenantId)
        .where('key', '=', 'cashierShortageTolerance')
        .executeTakeFirst();
      if (row == null || row.value == null || String(row.value).trim() === '') return this.maxAllowedDifference(digits);
      let raw: unknown = row.value;
      try { raw = JSON.parse(String(row.value)); } catch { /* plain scalar */ }
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  async postCashierShiftVariance(queryable: DbOrTx, shiftId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const shift = await queryable.selectFrom('cashier_shifts').selectAll().where('id', '=', shiftId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (!shift || shift.status !== 'closed') return { posted: false, journalEntryId: null };

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const expected = Number(shift.expected_cash || 0);
    const counted = Number(shift.counted_cash || 0);
    // Any non-zero book variance posts. The old < 0.01 gate dropped every
    // sub-cent variance from the GL while the shift stored it, so GL cash
    // and physical cash diverged by one shift's worth of fils, invisibly.
    const variance = toBookMoney(counted - expected);
    if (variance === 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let cashAccountId = Number(settings?.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const branchId = shift.branch_id ? Number(shift.branch_id) : null;
    const locationId = shift.location_id ? Number(shift.location_id) : null;

    // Shortages up to the configured tolerance are an operating cost of running a till.
    // Beyond it, the shortage is a debt of the custodian and must sit on a receivable in their name,
    // not be silently written off to expense.
    const shortageTolerance = await this.getCashierShortageTolerance(queryable, scope.tenantId, bookDigits);
    let resolution: 'within_tolerance' | 'charged_to_cashier' | 'surplus_recognized';
    let chargedToUserId: number | null = null;

    if (variance < 0) {
       const amount = Math.abs(variance);
       const custodianId = shift.opened_by ? Number(shift.opened_by) : null;
       const chargeToCashier = amount > shortageTolerance && custodianId !== null && custodianId > 0;

       if (chargeToCashier) {
         const receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1135');
         addBookLine({ accountId: receivableAccountId, description: `عجز وردية رقم #${shiftId} محمّل على أمين الصندوق`, debit: amount, credit: 0, partnerType: 'employee', partnerId: custodianId, branchId, locationId });
         resolution = 'charged_to_cashier';
         chargedToUserId = custodianId;
       } else {
         const shortageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7210');
         addBookLine({ accountId: shortageAccountId, description: `عجز وردية رقم #${shiftId} ضمن حد التسامح`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
         resolution = 'within_tolerance';
       }
       addBookLine({ accountId: cashAccountId, description: `عجز وردية نقدية`, debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId });
    } else {
       // Overage. Never netted against another shift's shortage: it lands on its own income account.
       const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7110');
       const amount = variance;
       addBookLine({ accountId: cashAccountId, description: `زيادة وردية رقم #${shiftId}`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
       addBookLine({ accountId: overageAccountId, description: `زيادة وردية نقدية`, debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId });
       resolution = 'surplus_recognized';
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'cashier_shift_variance',
        sourceId: shiftId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: shift.closed_at ? new Date(shift.closed_at) : new Date(),
        description: `قيد فروقات وردية - #${shiftId}`,
        branchId,
        locationId,
        createdBy: shift.closed_by ? Number(shift.closed_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });

      await queryable
        .updateTable('cashier_shifts')
        .set({
          variance_resolution: resolution,
          variance_journal_entry_id: entryId,
          variance_charged_to_user_id: chargedToUserId,
          variance_approved_by: auth.userId ?? null,
          variance_approved_at: sql`NOW()`,
        } as any)
        .where('id', '=', shiftId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'cashier_shift_variance').where('source_id', '=', shiftId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

    async postPayrollAccrual(queryable: DbOrTx, runId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.hrPayrollPosting.postPayrollAccrual(queryable, runId, auth);
  }

    async postPayrollPayment(queryable: DbOrTx, runId: number, paymentChannel: string, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.hrPayrollPosting.postPayrollPayment(queryable, runId, paymentChannel, auth);
  }

    async postPayrollItemPayment(
    queryable: DbOrTx,
    itemId: number,
    paymentChannel: string,
    auth: AuthContext,
    options?: { branchId?: number | null; locationId?: number | null; employeeName?: string }
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.hrPayrollPosting.postPayrollItemPayment(queryable, itemId, paymentChannel, auth, options);
  }

    async postEmployeeLoanDisbursement(queryable: DbOrTx, loanId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.hrPayrollPosting.postEmployeeLoanDisbursement(queryable, loanId, auth);
  }

    async postEmployeeLoanManualRepayment(queryable: DbOrTx, ledgerId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.hrPayrollPosting.postEmployeeLoanManualRepayment(queryable, ledgerId, auth);
  }

  async postManufacturingWorkOrder(queryable: DbOrTx, workOrderId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    // Idempotency check using 'manufacturing_work_order' source
    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'manufacturing_work_order')
      .where('source_id', '=', workOrderId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const wo = await queryable.selectFrom('manufacturing_work_orders as wo')
      .innerJoin('manufacturing_boms as bom', 'bom.id', 'wo.bom_id')
      .select([
        'wo.total_cost',
        'wo.quantity_to_produce',
        'bom.overhead_cost',
        'bom.quantity as bom_quantity',
        'wo.created_at',
        'wo.completed_at',
        'wo.created_by',
        'wo.destination_location_id'
      ])
      .where('wo.id', '=', workOrderId)
      .where('wo.tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!wo) return { posted: false, journalEntryId: null };

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const fgCost = toBookMoney(Number(wo.total_cost || 0));
    const consumed = await queryable.selectFrom('manufacturing_wo_consumptions as c')
      .innerJoin('manufacturing_work_orders as w', 'w.id', 'c.work_order_id')
      .select(sql<number>`coalesce(sum(c.line_total), 0)`.as('amount'))
      .where('w.tenant_id', '=', scope.tenantId).where('w.id', '=', workOrderId).executeTakeFirst();
    const rmCost = toBookMoney(consumed?.amount || 0);

    // INV-MANUFACTURING-COST-DERIVATION: overhead is NEVER a residual.
    // The old derivation (stored total minus raw materials) debited
    // the full stored total to finished goods -- overstating the Dr
    // 1140 leg above the finished-goods stock movement by exactly
    // the by-product value -- left the by-product stock increase
    // with no journal leg at all, and laundered any drift in
    // wo.total_cost into "overhead". Every component is now re-derived
    // from its stored
    // rows: operations from manufacturing_wo_operations, scaled BOM
    // overhead via the single scaledBomOverhead function that
    // completeWorkOrder also calls, the
    // finished-goods value from its stamped stock movement, and the
    // by-product value from its stamped movements. The stored total
    // is only a cross-check: any difference beyond one minor unit
    // (the codebase's own maxAllowedDifference) is data drift and
    // fails closed instead of posting.
    const operations = await queryable.selectFrom('manufacturing_wo_operations')
      .select(sql<number>`coalesce(sum(total_cost), 0)`.as('amount'))
      .where('work_order_id', '=', workOrderId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const opsCost = toBookMoney(operations?.amount || 0);
    const bomQuantity = Number(wo.bom_quantity || 1);
    const scaledOverheadCost = scaledBomOverhead(
      Number(wo.overhead_cost || 0),
      Number(wo.quantity_to_produce || 0),
      bomQuantity,
      bookDigits,
    );
    const overheadCost = toBookMoney(opsCost + scaledOverheadCost);
    const fgMovement = await queryable.selectFrom('stock_movements')
      .select('total_cost')
      .where('reference_type', '=', 'manufacturing_work_order')
      .where('reference_id', '=', workOrderId)
      .where('movement_type', '=', 'manufacturing_production')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const finishedValue = toBookMoney(fgMovement?.total_cost || 0);
    const byProducts = await queryable.selectFrom('stock_movements')
      .select(sql<number>`coalesce(sum(total_cost), 0)`.as('amount'))
      .where('reference_type', '=', 'manufacturing_work_order')
      .where('reference_id', '=', workOrderId)
      .where('movement_type', '=', 'manufacturing_byproduct')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const byProductValue = toBookMoney(byProducts?.amount || 0);
    const expectedTotal = toBookMoney(rmCost + opsCost + scaledOverheadCost);
    const difference = roundMoney(expectedTotal - finishedValue - byProductValue, bookDigits);
    if (rmCost < 0 || opsCost < 0 || scaledOverheadCost < 0 || byProductValue < 0 || finishedValue < 0) {
      throw new AppError('Manufacturing cost components are inconsistent', 'MANUFACTURING_COST_MISMATCH', 409);
    }
    if (Math.abs(difference) > this.maxAllowedDifference(bookDigits)) {
      throw new AppError('Manufacturing stored total does not reconcile with its cost components', 'MANUFACTURING_COST_MISMATCH', 409);
    }

    // INV-MANUFACTURING-ZERO-COST: a genuinely zero-cost work order posts
    // nothing and does not throw (same precedent as
    // postManufacturingUnbuildOrder). The mismatch guard above runs
    // first, so this is reachable only when every component is zero, in
    // practice fgCost == rmCost == 0. Returning before the account
    // resolution also means a zero-cost order needs no 5400 account and
    // never hits the empty-journal guard.
    if (fgCost <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      if (!inventoryAccountId) throw new AppError('Inventory account not configured and fallback 1140 not found', 'ACCOUNT_NOT_FOUND', 400);
    }

    let overheadAccountId = Number(settings?.manufacturing_overhead_account_id || 0);
    if (!(overheadAccountId > 0)) {
      overheadAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5400');
      if (!overheadAccountId) throw new AppError('Manufacturing Overhead account 5400 not found', 'ACCOUNT_NOT_FOUND', 400);
    }

    // The variance account is resolved only when a rounding-scale
    // difference actually exists (the unbuild poster's convention);
    // it auto-creates as a known system account when absent.
    const varianceAccountId = difference !== 0
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5190')
      : 0;

    const lines: JournalLineDraft[] = [];
    const branchId = null;
    const locationId = wo.destination_location_id ? Number(wo.destination_location_id) : null;

    // 1. Debit FG (Inventory) at finishedValue -- exactly the value
    // stamped on the finished-goods stock movement.
    this.addLine(lines, { accountId: inventoryAccountId, description: `منتج تام إضافي - أمر #${workOrderId}`, debit: finishedValue, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);

    // 2. Debit by-products (Inventory) as their OWN leg. Both legs
    // debit 1140 (both are inventory increases) but stay separate
    // lines: the by-product value is no longer buried in the 5400
    // residual, and the 5400 credit below is only operations +
    // scaled overhead.
    if (byProductValue > 0) {
      this.addLine(lines, { accountId: inventoryAccountId, description: `منتج ثانوي ناتج عن التصنيع - أمر #${workOrderId}`, debit: byProductValue, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }

    // 3. Credit RM (Inventory)
    if (rmCost > 0) {
      this.addLine(lines, { accountId: inventoryAccountId, description: `خامات مستهلكة - أمر #${workOrderId}`, debit: 0, credit: rmCost, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }

    // 4. Credit operations + scaled overhead (5400 only -- never the
    // by-product value, never a residual).
    if (overheadCost > 0) {
      this.addLine(lines, { accountId: overheadAccountId, description: `مصاريف صناعية محملة - أمر #${workOrderId}`, debit: 0, credit: overheadCost, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }

    // 5. Rounding-scale variance to 5190 (unbuild convention: debit
    // when the components exceed the recorded output, credit when
    // the recorded output exceeds the components). Anything larger
    // already threw above.
    if (difference > 0) {
      this.addLine(lines, { accountId: varianceAccountId, description: `فرق تصنيع - أمر #${workOrderId}`, debit: difference, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    } else if (difference < 0) {
      this.addLine(lines, { accountId: varianceAccountId, description: `فرق تصنيع - أمر #${workOrderId}`, debit: 0, credit: -difference, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'manufacturing_work_order',
        sourceId: workOrderId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: wo.completed_at ? new Date(wo.completed_at) : (() => { throw new AppError('Manufacturing completion date missing', 'MANUFACTURING_DATE_MISSING', 409); })(),
        description: `قيد أمر تصنيع #${workOrderId}`,
        branchId,
        locationId,
        createdBy: wo.created_by ? Number(wo.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'manufacturing_work_order').where('source_id', '=', workOrderId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: existing ? existing.id : null };
      }
      throw e;
    }
  }
  // INV-MANUFACTURING-UNBUILD-JOURNAL: an unbuild used to move stock
  // with no journal at all. The balanced entry reads both legs from
  // the stamped stock movements -- the finished goods consumed at
  // their live WAC and the components recovered at theirs -- and
  // routes the difference to the price-variance account 5190
  // (decided 2026-10-31), debit when the finished goods were worth
  // more than the recovery, credit when the recovery is worth more.
  // A zero-cost unbuild posts nothing; 5190 is resolved through the
  // system-account resolver, which auto-creates it as a known system
  // account when absent. INV-MANUFACTURING-UNBUILD-5190-CAP-ALERT:
  // the 5190 difference is capped at one minor unit (see the guard
  // below); anything larger fails closed and is never posted.
  async postManufacturingUnbuildOrder(queryable: DbOrTx, unbuildId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'manufacturing_unbuild_order')
      .where('source_id', '=', unbuildId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const order = await queryable.selectFrom('manufacturing_unbuild_orders')
      .select(['created_at', 'created_by', 'warehouse_id'])
      .where('id', '=', unbuildId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!order) return { posted: false, journalEntryId: null };

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const fgMovement = await queryable.selectFrom('stock_movements')
      .select('total_cost')
      .where('reference_type', '=', 'manufacturing_unbuild_order').where('reference_id', '=', unbuildId)
      .where('movement_type', '=', 'manufacturing_unbuild')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const recovered = await queryable.selectFrom('stock_movements')
      .select(sql<number>`coalesce(sum(total_cost), 0)`.as('amount'))
      .where('reference_type', '=', 'manufacturing_unbuild_order').where('reference_id', '=', unbuildId)
      .where('movement_type', '=', 'manufacturing_unbuild_recovery')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const fgCost = toBookMoney(fgMovement?.total_cost || 0);
    const recoveredCost = toBookMoney(recovered?.amount || 0);
    if (fgCost <= 0 && recoveredCost <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      if (!inventoryAccountId) throw new AppError('Inventory account not configured and fallback 1140 not found', 'ACCOUNT_NOT_FOUND', 400);
    }

    const difference = roundMoney(fgCost - recoveredCost, bookDigits);
    // INV-MANUFACTURING-UNBUILD-5190-CAP-ALERT: the variance to 5190
    // is capped at one minor unit -- the same rounding tolerance the
    // work-order poster fails closed on. A larger difference means
    // real WAC drift, not rounding, and must never be buried in the
    // variance account: fail closed BEFORE any posting or 5190
    // resolution, so the whole unbuild (stock, order, journal)
    // rolls back. The caller records the review alert and the
    // operator investigates the drift and retries; nothing posts
    // until the variance is within the cap.
    const varianceCap = this.maxAllowedDifference(bookDigits);
    if (Math.abs(difference) > varianceCap) {
      throw new AppError(
        `Unbuild variance ${difference.toFixed(bookDigits)} exceeds the one-minor-unit review cap ${varianceCap.toFixed(bookDigits)} for unbuild order #${unbuildId} (finished-goods cost ${fgCost.toFixed(bookDigits)}, recovered cost ${recoveredCost.toFixed(bookDigits)}); review the WAC drift before retrying -- nothing was posted.`,
        'MANUFACTURING_UNBUILD_VARIANCE_REVIEW_REQUIRED',
        409,
      );
    }
    // The system resolver auto-creates 5190 as a known system account
    // when it is absent (the same treatment GRN price variance gets);
    // it throws only when the accounting foundation itself is missing.
    const varianceAccountId = difference !== 0
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5190')
      : 0;

    const lines: JournalLineDraft[] = [];
    const branchId = null;
    const locationId = order.warehouse_id ? Number(order.warehouse_id) : null;

    if (recoveredCost > 0) {
      this.addLine(lines, { accountId: inventoryAccountId, description: `مواد مسترجعة من تفكيك - أمر #${unbuildId}`, debit: recoveredCost, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }
    if (fgCost > 0) {
      this.addLine(lines, { accountId: inventoryAccountId, description: `منتج تام مفكك - أمر #${unbuildId}`, debit: 0, credit: fgCost, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }
    if (difference > 0) {
      this.addLine(lines, { accountId: varianceAccountId, description: `فرق تفكيك - أمر #${unbuildId}`, debit: difference, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    } else if (difference < 0) {
      this.addLine(lines, { accountId: varianceAccountId, description: `فرق تفكيك - أمر #${unbuildId}`, debit: 0, credit: -difference, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'manufacturing_unbuild_order',
        sourceId: unbuildId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: order.created_at ? new Date(order.created_at) : new Date(),
        description: `قيد أمر تفكيك #${unbuildId}`,
        branchId,
        locationId,
        createdBy: order.created_by ? Number(order.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
         const existingEntry = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'manufacturing_unbuild_order').where('source_id', '=', unbuildId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: existingEntry ? existingEntry.id : null };
      }
      throw e;
    }
  }
  async postDeliveryRepSettlement(queryable: DbOrTx, saleId: number, amount: number, branchId: number | null, locationId: number | null, auth: AuthContext, opts?: { countedCash?: number }): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    if (!Number.isFinite(amount) || amount < 0) throw new AppError('Invalid delivery settlement', 'DELIVERY_SETTLEMENT_INVALID', 400);
    // INV-SF-SINGLE-SETTLE-COUNTED-CASH (D-SF-01): `amount` is the
    // BOOK cash due, as before. `opts.countedCash` is the cash the
    // rep actually handed over, counted by the cashier — supplied
    // only by settleOrder. When it is absent the counted cash is
    // the book amount and the posting is exactly the old one. A
    // counted amount that differs from the book amount is a
    // shortage (Dr 7200) or an overage (Cr 7100), mirroring
    // postVanTripSettlement — unreceived cash is never booked as
    // received. A computed book amount that does not reconcile
    // with the remaining fee still fails closed below (the R7-A
    // gate): a human-counted difference is a variance to book,
    // a computed difference is a caller bug to reject.
    const bookCash = toBookMoney(amount);
    const countedCash = opts?.countedCash !== undefined && opts?.countedCash !== null
      ? toBookMoney(opts.countedCash)
      : bookCash;
    if (!Number.isFinite(countedCash) || countedCash < 0) throw new AppError('Invalid delivery settlement', 'DELIVERY_SETTLEMENT_INVALID', 400);

    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'delivery_rep_settlement')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting delivery settlement for sale ${saleId}`);

    const sale = await queryable.selectFrom('sales').select(['customer_id', 'doc_no', 'total', 'delivery_fee'])
      .where('id', '=', saleId).where('tenant_id', '=', scope.tenantId).executeTakeFirstOrThrow();

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');

    // R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: the fee and the
    // credit leg are derived from the REMAINING amounts
    // (deliverySettlementBasis), not the original total. A prior
    // return already credited 1130 for its receivable leg and
    // relieved part of 2115, so settling total - originalFee
    // over-credits 1130 and double-relieves 2115. The fee must
    // equal the remaining fee EXACTLY — including zero: a zero
    // collection against a still-owed fee (e.g. the rest was
    // covered by store credit) fails closed for manual
    // reconciliation instead of silently dropping the fee.
    // A stale book amount (total - original fee, total -
    // remaining fee) throws DELIVERY_SETTLEMENT_INVALID here —
    // pinned by sale-money-truth F9 and returns-payout-truth.
    const basis = await this.deliverySettlementBasis(queryable, saleId, auth);
    const remainingReceivable = basis.remainingReceivable;
    const remainingFee = basis.remainingFee;
    const fee = toBookMoney(remainingReceivable - bookCash);
    if (fee < 0 || Math.abs(fee - remainingFee) > this.maxAllowedDifference(bookDigits)) throw new AppError('Delivery settlement does not reconcile with courier fee', 'DELIVERY_SETTLEMENT_INVALID', 409);
    // INV-SF-SINGLE-SETTLE-COUNTED-CASH (D-SF-01): the difference
    // between the counted cash and the reconciled book cash is
    // the variance — a shortage (Dr 7200) or an overage
    // (Cr 7100), mirroring postVanTripSettlement. When counted
    // == book the variance is zero and the legs are exactly the
    // old ones (Dr 2115 fee + Dr 1110 cash / Cr 1130 receivable).
    const variance = toBookMoney(countedCash - bookCash);
    // A fully-returned order has nothing left to collect and no
    // fee left to relieve: post no (empty) journal — the
    // receivable is already zero via the return journal — and let
    // the caller mark the order settled. insertPostedJournal
    // throws EMPTY_JOURNAL on zero lines, so this returns before
    // the lines are built. (A counted amount on a fully-returned
    // order is not "nothing": it is a pure overage, booked below
    // as Dr 1110 / Cr 7100.)
    if (remainingReceivable === 0 && countedCash === 0) return { posted: false, journalEntryId: null };
    const lines: JournalLineDraft[] = [];
    if (fee > 0) {
      // R4-A (INV-REST-SALE-MONEY-TRUTH): the sale now posts the
      // freelance fee as Cr 2115 (Courier Fees Payable), so the
      // settlement relieves that payable — it must NOT book Dr 6400
      // expense, or the fee would hit P&L twice and 2115 would never
      // be relieved. The fee leg only fires for a freelance courier:
      // both settlement callers pass the full total (fee 0) for a
      // store-fleet sale, whose fee is 4200 revenue at sale time.
      const courierPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2115');
      addBookLine({ accountId: courierPayableId, description: 'رسوم مندوب حر مخصومة من التحصيل', debit: fee, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    }
    if (variance < -this.maxAllowedDifference(bookDigits)) {
      const shortageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
      addBookLine({ accountId: shortageAccountId, description: `عجز تسوية مندوب لفاتورة #${sale.doc_no || saleId}`, debit: Math.abs(variance), credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    } else if (variance > this.maxAllowedDifference(bookDigits)) {
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({ accountId: overageAccountId, description: `زيادة تسوية مندوب لفاتورة #${sale.doc_no || saleId}`, debit: 0, credit: variance, partnerType: 'none', partnerId: null, branchId, locationId });
    }
    addBookLine({
      accountId: cashAccountId,
      description: `تحصيل من مندوب عن فاتورة #${sale.doc_no || saleId}`,
      debit: countedCash,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    });
    // D-SF-02 (INV-SF-COD-CUSTODY-GL) + M12 (INV-REP-CUSTODY-LEDGER):
    // the receivable was moved to courier custody at dispatch, so the
    // settlement credits the custody leg — the SAME partner the
    // dispatch posted (deliveryCustodyPartner: 'rep' + repId post-M12,
    // the old 'none' for a pre-M12 dispatch) — never the customer leg:
    // crediting the customer would drive it negative while the
    // custody debit stands, and crediting a different partner would
    // strand the rep balance. A sale settled without dispatch keeps
    // the old customer-leg credit.
    const inCourierCustody = await this.hasDeliveryCustodyReclassification(queryable, saleId, auth);
    const custodyPartner = inCourierCustody ? await this.deliveryCustodyPartner(queryable, saleId) : null;
    addBookLine({
      accountId: customerAccountId,
      description: `تسديد مديونية فاتورة #${sale.doc_no || saleId}`,
      debit: 0,
      // R7-A F2: credit the REMAINING receivable, not the original
      // total — a prior return already credited 1130 for its
      // receivable leg, so crediting the full total would
      // over-credit 1130 by the returned share.
      credit: remainingReceivable,
      partnerType: custodyPartner ? custodyPartner.partnerType : (sale.customer_id ? 'customer' : 'none'),
      partnerId: custodyPartner ? custodyPartner.partnerId : (sale.customer_id ? Number(sale.customer_id) : null),
      branchId,
      locationId,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'delivery_rep_settlement',
        sourceId: saleId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد تسوية مندوب لفاتورة #${sale.doc_no || saleId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'delivery_rep_settlement').where('source_id', '=', saleId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: existing ? existing.id : null };
      }
      throw e;
    }
  }

  /**
   * INV-REP-SHORTAGE-CASH-SETTLE: cash a rep hands over later for a pending
   * shortage is NEW cash. Trip settlement already debited 1110 only for the
   * counted cash and booked the shortage itself — Dr 7200 for a cash
   * shortage, Dr 1160 rep custody for a stock shortage charged to the rep —
   * so collecting it posts Dr 1110 / Cr 7200 (cash-shortage recovery) or
   * Cr 1160 (stock-shortage custody cleared), reversing exactly what trip
   * settlement booked. The caller serializes on the settlement row
   * (FOR UPDATE) and writes the treasury row and the status flip in the
   * same transaction; this method additionally pre-checks for an existing
   * posted journal for the item as a defensive dedup (no unique index
   * covers this source type). The credit accounts are the same codes
   * postVanTripSettlement used at trip settlement — flagged for reversal
   * if the owner prefers a different recovery account.
   */
  async postRepShortageCashCollection(
    queryable: DbOrTx,
    settlementItemId: number,
    params: {
      amount: number;
      entryType: 'cash_shortage' | 'stock_shortage';
      branchId: number | null;
      locationId: number | null;
    },
    auth: AuthContext,
  ): Promise<number> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = this.toMoney(params.amount, bookDigits);
    if (!(amount > 0)) {
      throw new AppError('مبلغ تحصيل العجز يجب أن يكون أكبر من صفر', 'SETTLEMENT_AMOUNT_INVALID', 400);
    }
    const creditCode = params.entryType === 'cash_shortage' ? '7200' : '1160';
    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting rep shortage cash collection ${settlementItemId}`);
    let cashAccountId = Number(settings.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');
    const creditAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, creditCode);
    const existing = await queryable.selectFrom('journal_entries').select('id')
      .where('source_type', '=', 'rep_shortage_cash_collection')
      .where('source_id', '=', settlementItemId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    if (existing) return Number(existing.id);
    return this.postDomainJournal(queryable, {
      sourceType: 'rep_shortage_cash_collection',
      sourceId: settlementItemId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: params.entryType === 'cash_shortage'
        ? `تحصيل نقدي لعجز كاش مندوب - بند تسوية #${settlementItemId}`
        : `تحصيل نقدي لعجز مخزني محمل على المندوب - بند تسوية #${settlementItemId}`,
      branchId: params.branchId,
      locationId: params.locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines: [
        { accountId: cashAccountId, description: 'نقدية محصلة من مندوب لسداد عجز', debit: amount, credit: 0, partnerType: 'none', partnerId: null },
        { accountId: creditAccountId, description: params.entryType === 'cash_shortage' ? 'استرداد عجز كاش سبق إثباته كمصروف' : 'تصفية عهدة المندوب من عجز مخزني محمل عليه', debit: 0, credit: amount, partnerType: 'none', partnerId: null },
      ],
    });
  }

  /**
   * INV-VAN-REP-SHORTAGE-WAIVER-REVERSAL: waiving a pending stock
   * shortage charged to the rep must reverse what trip settlement
   * booked — Dr 7200 / Cr 1160 — or the rep custody debit 1160
   * stands stranded forever. A cash shortage needs no reversal
   * (Dr 7200 already stands at trip settlement), so this method is
   * called only for stock_shortage waivers. The caller serializes
   * on the settlement row (FOR UPDATE) and flips the status in the
   * same transaction; this method additionally pre-checks for an
   * existing posted journal for the item as a defensive dedup (no
   * unique index covers this source type).
   */
  async postRepShortageWaiver(
    queryable: DbOrTx,
    settlementItemId: number,
    params: {
      amount: number;
      branchId: number | null;
      locationId: number | null;
    },
    auth: AuthContext,
  ): Promise<number> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = this.toMoney(params.amount, bookDigits);
    if (!(amount > 0)) {
      throw new AppError('مبلغ إعفاء العجز يجب أن يكون أكبر من صفر', 'SETTLEMENT_AMOUNT_INVALID', 400);
    }
    const expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
    const custodyAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1160');
    const existing = await queryable.selectFrom('journal_entries').select('id')
      .where('source_type', '=', 'rep_shortage_waiver')
      .where('source_id', '=', settlementItemId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    if (existing) return Number(existing.id);
    return this.postDomainJournal(queryable, {
      sourceType: 'rep_shortage_waiver',
      sourceId: settlementItemId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `إعفاء إداري لعجز مخزني محمل على المندوب - بند تسوية #${settlementItemId}`,
      branchId: params.branchId,
      locationId: params.locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines: [
        { accountId: expenseAccountId, description: 'إعفاء عجز مخزني محمل على المندوب - تحويل العهدة إلى مصروف', debit: amount, credit: 0, partnerType: 'none', partnerId: null },
        { accountId: custodyAccountId, description: 'تصفية عهدة المندوب من عجز مخزني معفى', debit: 0, credit: amount, partnerType: 'none', partnerId: null },
      ],
    });
  }

  /**
   * A van/field sale posts (via postSale) as a receivable rather than straight to cash — the money,
   * if any was collected, is physically in the rep's pocket, not the till. This is the same "collect
   * now, settle later" shape as postDeliveryRepSettlement, generalized to a whole trip: it reduces
   * that pooled receivable by the amount the rep actually hands over, and reconciles the difference
   * against a shortage/overage account (mirroring the cashier-shift variance treatment) rather than
   * silently adjusting cash by whatever was collected.
   */
  async postVanTripSettlement(
    queryable: DbOrTx,
    tripId: number,
    params: {
      expectedCash: number;
      countedCash: number;
      tripExpenses?: number;
      branchId: number | null;
      locationId: number | null;
      stockShortageAmount?: number;
      // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: mirror of
      // stockShortageAmount. Overage units found in the van are
      // journaled Dr 1140 / Cr 7100 so the added stock value is
      // accounted, never silently added to stock or income.
      stockOverageAmount?: number;
      chargeStockVarianceToRep?: boolean;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_trip_settlement')
      .where('source_id', '=', tripId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const expected = toBookMoney(params.expectedCash);
    const counted = toBookMoney(params.countedCash);
    const tripExpenses = params.tripExpenses ? toBookMoney(params.tripExpenses) : 0;
    const stockShortage = params.stockShortageAmount ? toBookMoney(params.stockShortageAmount) : 0;
    const stockOverage = params.stockOverageAmount ? toBookMoney(params.stockOverageAmount) : 0;

    if (expected <= 0 && counted <= 0 && tripExpenses <= 0 && stockShortage <= 0 && stockOverage <= 0) return { posted: false, journalEntryId: null };
    const variance = toBookMoney(counted - expected);

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting van trip settlement ${tripId}`);

    let cashAccountId = Number(settings.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');
    let receivableAccountId = Number(settings.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0)) receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const lines: JournalLineDraft[] = [];
    const branchId = params.branchId;
    const locationId = params.locationId;

    const grossReceivableToClear = toBookMoney(expected + tripExpenses);
    if (grossReceivableToClear > 0) {
      addBookLine({ accountId: receivableAccountId, description: `تصفية عهدة نقدية مندوب - رحلة #${tripId}`, debit: 0, credit: grossReceivableToClear, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (tripExpenses > 0) {
      const expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6400');
      addBookLine({ accountId: expenseAccountId, description: `مصروفات تشغيلية ووقود رحلة توزيع #${tripId}`, debit: tripExpenses, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (variance < -this.maxAllowedDifference(bookDigits)) {
      const shortageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
      addBookLine({ accountId: shortageAccountId, description: `عجز تصفية رحلة توزيع #${tripId}`, debit: Math.abs(variance), credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    } else if (variance > this.maxAllowedDifference(bookDigits)) {
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({ accountId: overageAccountId, description: `زيادة تصفية رحلة توزيع #${tripId}`, debit: 0, credit: variance, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (counted > 0) {
      addBookLine({ accountId: cashAccountId, description: `نقدية مسلَّمة من مندوب - رحلة #${tripId}`, debit: counted, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (stockShortage > 0) {
      let inventoryAccountId = Number(settings.inventory_account_id || 0);
      if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

      let debitAccountId: number;
      let debitDesc: string;
      if (params.chargeStockVarianceToRep) {
        debitAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1160');
        debitDesc = `عجز مخزني محمل على عهدة وسلف المندوب - رحلة #${tripId}`;
      } else {
        debitAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
        debitDesc = `خسائر عجز مخزني سيارة التوزيع - رحلة #${tripId}`;
      }

      addBookLine({ accountId: debitAccountId, description: debitDesc, debit: stockShortage, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
      addBookLine({ accountId: inventoryAccountId, description: `تسوية عجز مخزني سيارة التوزيع - رحلة #${tripId}`, debit: 0, credit: stockShortage, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: overage mirror of the
    // shortage block above. Found units raise the van's inventory
    // asset (Dr 1140) against an overage gain (Cr 7100, the same
    // account cash overage credits in this journal). Shortage legs
    // above are byte-identical; this block only adds legs.
    if (stockOverage > 0) {
      let inventoryAccountId = Number(settings.inventory_account_id || 0);
      if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({ accountId: inventoryAccountId, description: `تسوية زيادة مخزنية سيارة التوزيع - رحلة #${tripId}`, debit: stockOverage, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
      addBookLine({ accountId: overageAccountId, description: `إيراد زيادة جرد بضاعة سيارة التوزيع - رحلة #${tripId}`, debit: 0, credit: stockOverage, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (lines.length === 0) return { posted: false, journalEntryId: null };

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_trip_settlement',
        sourceId: tripId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد تصفية رحلة توزيع #${tripId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_van_sales_uniq')) {
        const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'van_trip_settlement').where('source_id', '=', tripId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }

  /**
   * Posts inventory movement journal entry between warehouse and mobile van location.
   */
  async postVanStockTransfer(
    queryable: DbOrTx,
    tripId: number,
    params: {
      sourceLocationId: number;
      targetLocationId: number;
      totalCost: number;
      branchId?: number | null;
      type: 'load' | 'unload';
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);


    const cost = toBookMoney(params.totalCost);
    if (!(cost > 0)) return { posted: false, journalEntryId: null };

    const sourceType = params.type === 'load' ? 'van_load_transfer' : 'van_unload_transfer';
    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', sourceType)
      .where('source_id', '=', tripId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const descAr = params.type === 'load'
      ? `تحميل بضاعة لسيارة التوزيع - رحلة #${tripId}`
      : `تفريغ وإعادة بضاعة سيارة التوزيع للمستودع - رحلة #${tripId}`;

    const lines: JournalLineDraft[] = [
      { accountId: inventoryAccountId, description: `${descAr} (دخول)`, debit: cost, credit: 0, partnerType: 'none', partnerId: null, branchId: params.branchId ?? null, locationId: params.targetLocationId },
      { accountId: inventoryAccountId, description: `${descAr} (خروج)`, debit: 0, credit: cost, partnerType: 'none', partnerId: null, branchId: params.branchId ?? null, locationId: params.sourceLocationId },
    ];

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType,
        sourceId: tripId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد ${descAr}`,
        branchId: params.branchId ?? null,
        locationId: params.targetLocationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_van_sales_uniq')) {
        const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', sourceType).where('source_id', '=', tripId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }

  /**
   * A field debt collection is also cash sitting with the rep until the trip is settled, so it
   * cannot go straight to the cash account either. It moves the amount out of the customer's own
   * receivable and into the same pooled "none"-partner receivable that postVanTripSettlement later
   * clears against cash — the mirror image of postSale crediting a customer's receivable into that
   * same pool at sale time.
   */
  async postVanFieldCollection(
    queryable: DbOrTx,
    collectionId: number,
    params: { amount: number; customerId: number; branchId: number | null; locationId: number | null; paymentMethod?: string; transferReference?: string },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);


    const amount = toBookMoney(params.amount);
    if (!(amount > 0)) return { posted: false, journalEntryId: null };

    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_field_collection')
      .where('source_id', '=', collectionId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting van field collection ${collectionId}`);

    let receivableAccountId = Number(settings.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0)) receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const branchId = params.branchId;
    const locationId = params.locationId;
    const electronic = params.paymentMethod != null && params.paymentMethod !== 'cash';
    // INV-VAN-FIELD-NONCASH-EVIDENCE-GATE: an electronic collection
    // debits bank 1120 below, so it must carry a transfer
    // reference — the field service enforces supervisor PIN +
    // reference before this point, and this is the last line of
    // defence for any future caller that reaches the posting
    // without evidence. Cash collections are untouched.
    if (electronic) {
      const reference = String(params.transferReference || '').trim();
      if (reference.length < 3) {
        throw new Error(
          `Van field collection ${collectionId}: refusing to debit bank 1120 for an electronic collection without a transfer reference of at least 3 characters`,
        );
      }
    }
    const debitAccountId = electronic ? await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120') : receivableAccountId;
    const lines: JournalLineDraft[] = [
      { accountId: debitAccountId, description: electronic ? 'تحصيل ميداني إلكتروني إلى البنك' : 'تحصيل ميداني بواسطة مندوب - عهدة نقدية', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId },
      { accountId: receivableAccountId, description: `تحصيل ميداني بواسطة مندوب - سداد مديونية عميل`, debit: 0, credit: amount, partnerType: 'customer', partnerId: params.customerId, branchId, locationId },
    ];

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_field_collection',
        sourceId: collectionId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد تحصيل ميداني #${collectionId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_van_sales_uniq')) {
        const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'van_field_collection').where('source_id', '=', collectionId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }

  /**
   * An approved field return reverses the two things the original sale posted: the revenue (net of
   * whatever discount the return price itself already reflects) and the COGS/inventory pair, using
   * the product's actual cost — not the return's unit price, which is a selling price, not a cost.
   * The receivable side always credits the named customer (submitFieldReturn requires one), whether
   * the original sale was cash-via-rep-custody or a real customer credit sale, matching what
   * approveFieldReturn already writes to customers.balance/customer_ledger for every return.
   */
  /*
   * INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR: a LINKED field return
   * reverses COGS on the same residual basis the sale posted it — the
   * returned quantity per original sale line is fed through the shared
   * residual grouping (salesReturnCogsResidual) at the FROZEN sale-line
   * costs, with the post-sale remaining quantity reconstructed from the
   * post-restock stock read, so sequential field returns telescope to
   * the posted COGS and a full return nets COGS to zero. The caller
   * supplies the current product cost per item; the mirror ignores it
   * in favour of the frozen cost, because the current cost is what
   * stranded the divergence this mirror closes. Eligibility is
   * deliberately narrow: a linked sale whose every returned item
   * resolves to exactly one sale line (by saleItemId, or by a unique
   * product line), and a non-damaged restock. Anything else — no
   * linked sale, a damaged-location restock, an unresolvable or
   * ambiguous line (including several sale lines at differing frozen
   * costs with no saleItemId to disambiguate), or a missing sale —
   * keeps the legacy plain qty x caller cost computation. A resolved
   * line whose frozen cost is missing or invalid fails closed with
   * VAN_FIELD_RETURN_FROZEN_COST_INVALID instead of silently
   * falling back to the current product cost. A zero frozen cost
   * (prepared composite) contributes nothing, as in the sales-return
   * mirror, and its COGS stays expensed.
   */
  private async vanFieldReturnCogsAmount(
    queryable: DbOrTx,
    tenantId: string,
    params: {
      items: { productId: number; qty: number; costPrice: number; saleItemId?: number | null }[];
      saleId?: number | null;
      isDamaged?: boolean;
    },
    bookDigits: MoneyDigits,
  ): Promise<number> {
    const legacy = params.items.reduce((sum, it) => sum + (Number(it.qty || 0) * Number(it.costPrice || 0)), 0);
    const saleId = params.saleId ? Number(params.saleId) : 0;
    if (!(saleId > 0) || params.isDamaged) return legacy;
    // The residual grouping reads stock on a transaction handle; the
    // only caller passes the approval transaction, which also carries
    // the restock, so the read and the journal commit or roll back
    // together.
    const trx = queryable as Transaction<Database>;
    const saleItems = await this.readSaleResidualLines(trx, tenantId, saleId);
    if (!saleItems.length) return legacy;
    const byId = new Map(saleItems.map((item) => [Number(item.id), item]));
    const byProduct = new Map<number, typeof saleItems>();
    for (const item of saleItems) {
      const pid = Number(item.product_id || 0);
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      byProduct.get(pid)!.push(item);
    }
    const returnedQtyBySaleItemId = new Map<number, number>();
    for (const item of params.items) {
      const qty = Number(item.qty || 0);
      if (!(qty > 0)) continue;
      const productId = Number(item.productId || 0);
      let line: (typeof saleItems)[number] | undefined;
      if (item.saleItemId != null) {
        line = byId.get(Number(item.saleItemId));
        if (!line || Number(line.product_id || 0) !== productId) return legacy;
      } else {
        const candidates = byProduct.get(productId) || [];
        if (candidates.length !== 1) return legacy;
        line = candidates[0];
      }
      const rawCost = line.cost_price;
      if (rawCost == null) {
        throw new AppError(
          `Frozen sale cost is missing for field-return product ${productId}; refusing to reverse COGS at the current product cost`,
          'VAN_FIELD_RETURN_FROZEN_COST_INVALID',
          400,
        );
      }
      const frozen = Number(rawCost);
      if (!Number.isFinite(frozen) || frozen < 0) {
        throw new AppError(
          `Frozen sale cost is invalid for field-return product ${productId}; refusing to reverse COGS at the current product cost`,
          'VAN_FIELD_RETURN_FROZEN_COST_INVALID',
          400,
        );
      }
      if (frozen === 0) continue;
      returnedQtyBySaleItemId.set(Number(line.id), (returnedQtyBySaleItemId.get(Number(line.id)) || 0) + qty);
    }
    if (returnedQtyBySaleItemId.size === 0) return 0;
    return this.salesReturnCogsResidual(trx, tenantId, saleId, bookDigits, returnedQtyBySaleItemId);
  }

  async postVanFieldReturn(
    queryable: DbOrTx,
    returnId: number,
    params: {
      customerId: number;
      totalAmount: number;
      refundMethod?: 'credit' | 'cash';
      items: { productId: number; qty: number; costPrice: number; saleItemId?: number | null }[];
      branchId: number | null;
      locationId: number | null;
      saleId?: number | null;
      isDamaged?: boolean;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const amount = toBookMoney(params.totalAmount);
    if (!(amount > 0)) return { posted: false, journalEntryId: null };

    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_field_return')
      .where('source_id', '=', returnId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    // INV-VAN-RETURN-METHOD-MATCH: the posting must debit the leg
    // that actually holds the money. The returns service already
    // enforces the match; this re-derives the linked sale's payment
    // type at the money boundary so a mismatched refund can never
    // post even if a future caller passes refundMethod unchecked.
    // A split sale allows either method — its leg bounds are
    // enforced by the returns service, not here.
    if (params.saleId != null) {
      const linkedSale = await queryable
        .selectFrom('sales')
        .select(['payment_type'])
        .where('id', '=', params.saleId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      const salePayment = String((linkedSale as any)?.payment_type || '').trim();
      const wantsCash = params.refundMethod === 'cash';
      if (!linkedSale || !['cash', 'credit', 'card', 'split', 'instapay', 'vodafone_cash'].includes(salePayment)) {
        throw new AppError(
          `تعذّرت مطابقة طريقة رد المرتجع #${returnId} مع الفاتورة الأصلية — طريقة دفع الفاتورة غير معروفة`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
      if ((salePayment === 'credit' && wantsCash) || (salePayment === 'cash' && !wantsCash)) {
        throw new AppError(
          `طريقة رد المرتجع #${returnId} (${wantsCash ? 'نقدي' : 'كائتمان'}) لا تطابق طريقة دفع الفاتورة الأصلية (${salePayment})`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
      if (salePayment === 'card' || salePayment === 'instapay' || salePayment === 'vodafone_cash') {
        throw new AppError(
          `لا يمكن رد مرتجع #${returnId} على فاتورة مسددة (${salePayment}) نقداً أو كائتمان من عهدة المندوب — المبلغ مستقر في البنك ويتطلب عكساً بنكياً`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting van field return ${returnId}`);

    let revenueAccountId = Number(settings.sales_revenue_account_id || 0);
    if (!(revenueAccountId > 0)) revenueAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '4100');
    let receivableAccountId = Number(settings.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0)) receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    let cogsAccountId = Number(settings.cogs_account_id || 0);
    if (!(cogsAccountId > 0)) cogsAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5100');
    let inventoryAccountId = Number(settings.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const branchId = params.branchId;
    const locationId = params.locationId;
    const isCashRefund = params.refundMethod === 'cash';
    const lines: JournalLineDraft[] = [
      { accountId: revenueAccountId, description: `عكس إيراد مبيعات - مرتجع ميداني #${returnId}`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId },
      isCashRefund
        ? { accountId: receivableAccountId, description: `تخفيض عهدة نقدية مندوب - مرتجع ميداني مسدد نقداً #${returnId}`, debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }
        : { accountId: receivableAccountId, description: `تخفيض مديونية عميل - مرتجع ميداني #${returnId}`, debit: 0, credit: amount, partnerType: 'customer', partnerId: params.customerId, branchId, locationId },
    ];

    // INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR: linked returns reverse
    // COGS on the shared residual basis at frozen sale-line costs; every
    // other shape keeps the legacy plain computation (see
    // vanFieldReturnCogsAmount).
    const cogsAmount = toBookMoney(await this.vanFieldReturnCogsAmount(queryable, scope.tenantId, params, bookDigits));
    if (cogsAmount > 0) {
      addBookLine({ accountId: inventoryAccountId, description: `إعادة بضاعة للمخزون - مرتجع ميداني #${returnId}`, debit: cogsAmount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
      addBookLine({ accountId: cogsAccountId, description: `عكس تكلفة البضاعة المباعة - مرتجع ميداني #${returnId}`, debit: 0, credit: cogsAmount, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_field_return',
        sourceId: returnId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد مرتجع ميداني معتمد #${returnId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'van_field_return').where('source_id', '=', returnId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeReceive(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequeReceive(queryable, chequeId, auth);
  }

  async postPdcChequeDeposit(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequeDeposit(queryable, chequeId, auth);
  }

  async postPdcChequeCollect(queryable: DbOrTx, chequeId: number, bankAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequeCollect(queryable, chequeId, bankAccountId, auth);
  }

  async postPdcChequeBounce(queryable: DbOrTx, chequeId: number, bouncedFee: number, bankAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequeBounce(queryable, chequeId, bouncedFee, bankAccountId, auth);
  }

  async postPdcChequeEndorse(queryable: DbOrTx, chequeId: number, supplierId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequeEndorse(queryable, chequeId, supplierId, auth);
  }

  async postPdcChequeIssue(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequeIssue(queryable, chequeId, auth);
  }

  async postPdcChequeClear(queryable: DbOrTx, chequeId: number, bankAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequeClear(queryable, chequeId, bankAccountId, auth);
  }

  async postPdcChequePayableBounce(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequePayableBounce(queryable, chequeId, auth);
  }

  async postPdcChequeCancelOrReturn(
    queryable: DbOrTx,
    chequeId: number,
    action: 'cancel' | 'return',
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequeCancelOrReturn(queryable, chequeId, action, auth);
  }

  async postPdcChequeRestore(
    queryable: DbOrTx,
    chequeId: number,
    previousStatus: string,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.pdcPosting.postPdcChequeRestore(queryable, chequeId, previousStatus, auth);
  }

  async postWithholdingTaxRemittance(queryable: DbOrTx, transactionId: number, paymentMethod: 'bank' | 'cash', auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.postWithholdingTaxRemittance(queryable, transactionId, paymentMethod, auth);
  }

    async postEndOfServiceSettlement(queryable: DbOrTx, settlementId: number, treasuryAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.hrPayrollPosting.postEndOfServiceSettlement(queryable, settlementId, treasuryAccountId, auth);
  }


  async recordPostingFailure(
    queryable: DbOrTx,
    scope: { tenantId: string; accountId: string },
    sourceType: string,
    sourceId: number,
    errorMessage: string,
  ): Promise<void> {
    return this.postingCore.recordPostingFailure(queryable, scope, sourceType, sourceId, errorMessage);
  }

  async clearPostingFailure(
    queryable: DbOrTx,
    scope: { tenantId: string; accountId: string },
    sourceType: string,
    sourceId: number,
  ): Promise<void> {
    return this.postingCore.clearPostingFailure(queryable, scope, sourceType, sourceId);
  }

  /**
   * Cash drawer manual cash_in and cash_out double-entry posting
   */
  async postCashDrawerMovement(
    queryable: DbOrTx,
    txnId: number,
    movementType: 'cash_in' | 'cash_out' | string,
    amount: number,
    note: string,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    counterpartAccountId?: number | null,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const moneyAmount = this.toMoney(amount, bookDigits);

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let cashAccountId = Number(settings?.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');

    // INV-CASH-DRAWER-MOVEMENT-TYPES: safe transfers are
    // asset-to-asset journals, never profit legs. The counterpart
    // is caller-named — the dedicated safe/cash-box account is
    // 1111 (INV-DRAWER-DISBURSE-CASHIER-PASSWORD, migration 0324)
    // — and is validated here — the journal writer fails closed —
    // exactly like a treasury transfer, under lock, before any
    // line is built. An unknown movement type throws instead of
    // returning unposted: a silent skip would leave the treasury
    // row posted with no journal and no trace.
    const isTransferType = movementType === 'safe_drop' || movementType === 'safe_replenishment';
    let counterpartId = 0;
    if (isTransferType) {
      counterpartId = Number(counterpartAccountId || 0);
      if (!(counterpartId > 0)) throw new AppError('A counterpart cash or bank account is required for a safe transfer', 'DRAWER_COUNTERPART_REQUIRED', 400);
      const counterpart = await queryable
        .selectFrom('accounting_accounts')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', counterpartId)
        .where('account_type', '=', 'asset')
        .where('normal_balance', '=', 'debit')
        .where('is_cash_bank', '=', true)
        .where('is_active', '=', true)
        .forUpdate()
        .executeTakeFirst();
      if (!counterpart) throw new AppError('The counterpart must be an active cash or bank account in this tenant', 'TREASURY_ACCOUNT_NOT_FOUND', 400);
      if (counterpartId === cashAccountId) throw new AppError('The counterpart must differ from the drawer cash account', 'DRAWER_COUNTERPART_SAME_AS_CASH', 400);
    } else if (movementType !== 'cash_in' && movementType !== 'cash_out') {
      throw new AppError('Unknown cash drawer movement type', 'DRAWER_MOVEMENT_TYPE_UNKNOWN', 400);
    }
    if (moneyAmount <= 0) return { posted: false, journalEntryId: null };

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    if (movementType === 'cash_in') {
      const incomeAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({
        accountId: cashAccountId,
        description: `توريد نقدية للدرج: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: incomeAccountId,
        description: `إيرادات / توريدات نقدية متفرقة: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else if (movementType === 'cash_out') {
      let expenseAccountId = Number(settings?.expenses_account_id || 0);
      if (!(expenseAccountId > 0)) expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6950');
      addBookLine({
        accountId: expenseAccountId,
        description: `صرف نقدية من الدرج: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: cashAccountId,
        description: `سحب نقدية من الدرج: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else if (movementType === 'safe_drop') {
      addBookLine({
        accountId: counterpartId,
        description: `تحويل نقدية من الدرج إلى الخزنة: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: cashAccountId,
        description: `سحب نقدية من الدرج إلى الخزنة: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else if (movementType === 'safe_replenishment') {
      addBookLine({
        accountId: cashAccountId,
        description: `تغذية الدرج من الخزنة: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: counterpartId,
        description: `تحويل نقدية من الخزنة إلى الدرج: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else {
      throw new AppError('Unknown cash drawer movement type', 'DRAWER_MOVEMENT_TYPE_UNKNOWN', 400);
    }

    const movementLabel = movementType === 'cash_in' ? 'توريد' : movementType === 'cash_out' ? 'صرف' : movementType === 'safe_drop' ? 'تحويل للخزنة' : 'تغذية من الخزنة';
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: `cash_drawer_${movementType}`,
      sourceId: txnId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد حركة درج نقدية #${txnId} (${movementLabel})`,
      branchId,
      locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines,
    });
    return { posted: true, journalEntryId: entryId };
  }

  async postCustomerOpeningBalance(
    queryable: DbOrTx,
    customerId: number,
    amount: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.postCustomerOpeningBalance(queryable, customerId, amount, auth);
  }
  async postSupplierOpeningBalance(
    queryable: DbOrTx,
    supplierId: number,
    amount: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.purchasesTreasuryPosting.postSupplierOpeningBalance(queryable, supplierId, amount, auth);
  }

  /**
   * Customer installment plan finance interest double-entry posting
   */
  async postCustomerInstallmentInterest(
    queryable: DbOrTx,
    planId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const plan = await queryable
      .selectFrom('customer_installment_plans')
      .selectAll()
      .where('id', '=', planId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!plan) return { posted: false, journalEntryId: null };
    const interest = toBookMoney(plan.interest_amount);
    if (interest <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let arAccountId = Number(settings?.customer_receivable_account_id || 0);
    if (!(arAccountId > 0)) arAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    const financeIncomeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2155');

    const lines: JournalLineDraft[] = [];
    addBookLine({
      accountId: arAccountId,
      description: `فوائد تقسيط - خطة تقسيط #${plan.plan_number}`,
      debit: interest,
      credit: 0,
      partnerType: plan.customer_id ? 'customer' : 'none',
      partnerId: plan.customer_id ? Number(plan.customer_id) : null,
      branchId: plan.branch_id ? Number(plan.branch_id) : null,
      locationId: null,
    });
    addBookLine({
      accountId: financeIncomeId,
      description: `فوائد تمويل غير مكتسبة - خطة تقسيط #${plan.plan_number}`,
      debit: 0,
      credit: interest,
      partnerType: 'none',
      partnerId: null,
      branchId: plan.branch_id ? Number(plan.branch_id) : null,
      locationId: null,
    });

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'customer_installment_interest',
      sourceId: planId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: plan.created_at ? new Date(plan.created_at) : new Date(),
      description: `قيد فوائد تمويل خطة تقسيط #${plan.plan_number}`,
      branchId: plan.branch_id ? Number(plan.branch_id) : null,
      locationId: null,
      createdBy: plan.created_by ? Number(plan.created_by) : auth.userId,
      postedBy: auth.userId,
      lines,
    });
    const installments = await queryable.selectFrom('customer_installments').select(['id', 'amount', 'due_date'])
      .where('tenant_id', '=', scope.tenantId).where('plan_id', '=', planId).orderBy('installment_number').execute();
    const allocations = allocateInstallmentInterest(Number(plan.financed_amount), installments.map(item => Number(item.amount)), interest, bookDigits);
    // The plan-creation floor is the tenant-local business day of the creation
    // instant, not its UTC day.
    const createdDay = await resolveBusinessDateKey(queryable, scope.tenantId, new Date(plan.created_at));
    for (const [index, item] of installments.entries()) {
      const amount = allocations[index];
      if (!amount) continue;
      const dueDay = new Date(item.due_date).toISOString().slice(0, 10);
      const recognitionDay = dueDay < createdDay ? createdDay : dueDay;
      await sql`insert into accounting_installment_interest (tenant_id, plan_id, installment_id, recognition_date, amount, account_id)
        values (${scope.tenantId}, ${planId}, ${item.id}, ${recognitionDay}, ${amount}, ${scope.accountId})
        on conflict (tenant_id, installment_id) do nothing`.execute(queryable);
    }
    return { posted: true, journalEntryId: entryId };
  }
  /** Daily and closing callers share one locked accrual path; no historical plan is guessed. */
  async recognizeInstallmentInterest(queryable: DbOrTx, tenantId: string, throughDate: string, createdBy: number | null = null): Promise<void> {
    if (!queryable.isTransaction) return queryable.transaction().execute(trx => this.recognizeInstallmentInterest(trx, tenantId, throughDate, createdBy));
    await lockAccountingPeriod(queryable, tenantId);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);

    const pending = await sql<{ id: number; amount: number; recognition_date: string | Date; account_id: string; branch_id: number | null }>`
      select i.id, i.amount, i.recognition_date, i.account_id, p.branch_id from accounting_installment_interest i
      join customer_installment_plans p on p.id = i.plan_id and p.tenant_id = i.tenant_id
      where i.tenant_id = ${tenantId} and i.journal_entry_id is null and i.recognition_date <= ${throughDate}::date
      order by i.recognition_date, i.id for update of i
    `.execute(queryable);
    if (!pending.rows.length) return;
    const deferred = await this.resolveSystemAccountByCode(queryable, tenantId, '2155');
    const revenue = await this.resolveSystemAccountByCode(queryable, tenantId, '7100');
    for (const item of pending.rows) {
      const amount = toBookMoney(item.amount);
      const entryId = await this.postDomainJournal(queryable, { tenantId, accountId: item.account_id || tenantId, sourceType: 'installment_interest_accrual', sourceId: Number(item.id),
        entryDate: new Date(item.recognition_date), branchId: item.branch_id, description: 'استحقاق إيراد فوائد التمويل وفق العائد الفعلي', createdBy,
        lines: [
          { accountId: deferred, description: 'تحرير فوائد التمويل المكتسبة', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId: item.branch_id },
          { accountId: revenue, description: 'إيراد تمويل مكتسب', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId: item.branch_id },
        ],
      });
      await sql`update accounting_installment_interest set journal_entry_id = ${entryId}
        where tenant_id = ${tenantId} and id = ${item.id}`.execute(queryable);
    }
  }

}
