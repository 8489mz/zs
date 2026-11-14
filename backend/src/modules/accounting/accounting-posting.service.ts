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
import { VanAndDeliveryPostingService } from './services/van-and-delivery-posting.service';
import { InventoryManufacturingCashPostingService } from './services/inventory-manufacturing-cash-posting.service';

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
  private readonly vanAndDeliveryPosting: VanAndDeliveryPostingService;
  private readonly inventoryManufacturingCashPosting: InventoryManufacturingCashPostingService;

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
    this.vanAndDeliveryPosting = new VanAndDeliveryPostingService({
      foundation: accountingTenantFoundation,
      getTenantAccountingSettings: this.getTenantAccountingSettings.bind(this),
      toMoney: this.toMoney.bind(this),
      maxAllowedDifference: this.maxAllowedDifference.bind(this),
      addLine: this.addLine.bind(this),
      insertPostedJournal: this.insertPostedJournal.bind(this),
      postDomainJournal: this.postDomainJournal.bind(this),
      resolveSystemAccountByCode: this.resolveSystemAccountByCode.bind(this),
      resolveAccountWithFallback: this.resolveAccountWithFallback.bind(this),
      deliverySettlementBasis: this.deliverySettlementBasis.bind(this),
      hasDeliveryCustodyReclassification: this.hasDeliveryCustodyReclassification.bind(this),
      deliveryCustodyPartner: this.deliveryCustodyPartner.bind(this),
      readSaleResidualLines: this.readSaleResidualLines.bind(this),
      salesReturnCogsResidual: this.salesReturnCogsResidual.bind(this),
    });
    this.inventoryManufacturingCashPosting = new InventoryManufacturingCashPostingService({
      foundation: accountingTenantFoundation,
      getTenantAccountingSettings: this.getTenantAccountingSettings.bind(this),
      toMoney: this.toMoney.bind(this),
      maxAllowedDifference: this.maxAllowedDifference.bind(this),
      addLine: this.addLine.bind(this),
      insertPostedJournal: this.insertPostedJournal.bind(this),
      postDomainJournal: this.postDomainJournal.bind(this),
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
    return this.inventoryManufacturingCashPosting.postInventoryAdjustment(queryable, movementId, auth);
  }

  async postDamagedStock(queryable: DbOrTx, damageRecordId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    return this.inventoryManufacturingCashPosting.postDamagedStock(queryable, damageRecordId, auth);
  }

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
    return this.vanAndDeliveryPosting.postVanDamagedSwap(queryable, swapId, params, auth);
  }

  async postFoodWaste(queryable: DbOrTx, wasteLogId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.inventoryManufacturingCashPosting.postFoodWaste(queryable, wasteLogId, auth);
  }

  async postStockCount(queryable: DbOrTx, sessionId: number, auth: AuthContext, itemIds?: number[]): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    return this.inventoryManufacturingCashPosting.postStockCount(queryable, sessionId, auth, itemIds);
  }

  async postService(queryable: DbOrTx, serviceId: number, revision: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.inventoryManufacturingCashPosting.postService(queryable, serviceId, revision, auth);
  }

  async reverseService(queryable: DbOrTx, serviceId: number, revision: number, auth: AuthContext): Promise<void> {
    return this.inventoryManufacturingCashPosting.reverseService(queryable, serviceId, revision, auth);
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
    async postCashierShiftVariance(queryable: DbOrTx, shiftId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.inventoryManufacturingCashPosting.postCashierShiftVariance(queryable, shiftId, auth);
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
    return this.inventoryManufacturingCashPosting.postManufacturingWorkOrder(queryable, workOrderId, auth);
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
    return this.inventoryManufacturingCashPosting.postManufacturingUnbuildOrder(queryable, unbuildId, auth);
  }
  async postDeliveryRepSettlement(queryable: DbOrTx, saleId: number, amount: number, branchId: number | null, locationId: number | null, auth: AuthContext, opts?: { countedCash?: number }): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.vanAndDeliveryPosting.postDeliveryRepSettlement(queryable, saleId, amount, branchId, locationId, auth, opts);
  }

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
    return this.vanAndDeliveryPosting.postRepShortageCashCollection(queryable, settlementItemId, params, auth);
  }

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
    return this.vanAndDeliveryPosting.postRepShortageWaiver(queryable, settlementItemId, params, auth);
  }

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
    return this.vanAndDeliveryPosting.postVanTripSettlement(queryable, tripId, params, auth);
  }

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
    return this.vanAndDeliveryPosting.postVanStockTransfer(queryable, tripId, params, auth);
  }

  async postVanFieldCollection(
    queryable: DbOrTx,
    collectionId: number,
    params: { amount: number; customerId: number; branchId: number | null; locationId: number | null; paymentMethod?: string; transferReference?: string },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.vanAndDeliveryPosting.postVanFieldCollection(queryable, collectionId, params, auth);
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
    return this.vanAndDeliveryPosting.postVanFieldReturn(queryable, returnId, params, auth);
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
    return this.inventoryManufacturingCashPosting.postCashDrawerMovement(queryable, txnId, movementType, amount, note, branchId, locationId, auth, counterpartAccountId);
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
    return this.inventoryManufacturingCashPosting.postCustomerInstallmentInterest(queryable, planId, auth);
  }
  /** Daily and closing callers share one locked accrual path; no historical plan is guessed. */
  async recognizeInstallmentInterest(queryable: DbOrTx, tenantId: string, throughDate: string, createdBy: number | null = null): Promise<void> {
    return this.inventoryManufacturingCashPosting.recognizeInstallmentInterest(queryable, tenantId, throughDate, createdBy);
  }

}
