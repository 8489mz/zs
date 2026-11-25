/*
 * Sales and returns posting (split-3 out of AccountingPostingService).
 * Pure move: the sales/returns posting methods + residual COGS helpers,
 * unchanged, behind the AccountingPostingService delegating facade. The
 * facade owns the shared journal helpers; this service receives them bound
 * via SalesAndReturnsPostingDeps, so the moved bodies are byte-identical to
 * the originals (except the nine private helpers the facade keeps delegating
 * to — saleCogsResidual, readSaleResidualLines, residualCogsGroups,
 * salesReturnCogsResidual, salesReturnCogsAmount, addSaleRevenueCreditLegs,
 * priorSalesReturnRelief, priorSalesReturnReceivableCredit and
 * deliveryCustodyPartner — whose declarations drop `private` so the facade
 * delegations can call them: TS2341 forbids calling a private method of
 * another class. Their bodies are unchanged, and the facade keeps the exact
 * original private signatures, so the residualCogsGroups text pin still
 * passes and no outside caller changes.)
 */
import { Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { type CogsResidualGroup } from '../engines/cogs-residual.engine';
import { MoneyDigits } from '../engines/money-minor-units.engine';
import { Logger } from '@nestjs/common';
import type { DbOrTx, JournalLineDraft } from '../accounting-posting.service';
import { type SalesAndReturnsPostingDeps } from './sales-returns-posting/sales-returns-posting-types';
import { SaleCogsResidualService } from './sales-returns-posting/sale-cogs-residual';
import { PostSaleService } from './sales-returns-posting/post-sale';
import { PostSaleEditService } from './sales-returns-posting/post-sale-edit';
import { ReverseSaleJournalService } from './sales-returns-posting/reverse-sale-journal';
import { SalesReturnReliefService } from './sales-returns-posting/sales-return-relief';
import { DeliveryCustodyService } from './sales-returns-posting/delivery-custody';
import { PostSalesReturnService } from './sales-returns-posting/post-sales-return';

export class SalesAndReturnsPostingService {
  private readonly foundation: AccountingTenantFoundationService;
  private readonly getTenantAccountingSettings: SalesAndReturnsPostingDeps['getTenantAccountingSettings'];
  private readonly toMoney: SalesAndReturnsPostingDeps['toMoney'];
  private readonly maxAllowedDifference: SalesAndReturnsPostingDeps['maxAllowedDifference'];
  private readonly addLine: SalesAndReturnsPostingDeps['addLine'];
  private readonly insertPostedJournal: SalesAndReturnsPostingDeps['insertPostedJournal'];
  private readonly resolveSystemAccountByCode: SalesAndReturnsPostingDeps['resolveSystemAccountByCode'];
  private readonly resolveAccountWithFallback: SalesAndReturnsPostingDeps['resolveAccountWithFallback'];
  private readonly getExistingSaleJournal: SalesAndReturnsPostingDeps['getExistingSaleJournal'];
  private readonly getExistingSaleReversalJournal: SalesAndReturnsPostingDeps['getExistingSaleReversalJournal'];
  private readonly getExistingSalesReturnJournal: SalesAndReturnsPostingDeps['getExistingSalesReturnJournal'];
  private readonly getActiveAccountMap: SalesAndReturnsPostingDeps['getActiveAccountMap'];
  private readonly assertTransaction: SalesAndReturnsPostingDeps['assertTransaction'];
  private readonly logger: Logger;
  private readonly postSaleService: PostSaleService;
  private readonly postSaleEditService: PostSaleEditService;
  private readonly reverseSaleJournalService: ReverseSaleJournalService;
  private readonly salesReturnReliefService: SalesReturnReliefService;
  private readonly deliveryCustodyService: DeliveryCustodyService;
  private readonly postSalesReturnService: PostSalesReturnService;

  private readonly saleCogsResidualService = new SaleCogsResidualService();

  constructor(deps: SalesAndReturnsPostingDeps) {
    this.foundation = deps.foundation;
    this.getTenantAccountingSettings = deps.getTenantAccountingSettings;
    this.toMoney = deps.toMoney;
    this.maxAllowedDifference = deps.maxAllowedDifference;
    this.addLine = deps.addLine;
    this.insertPostedJournal = deps.insertPostedJournal;
    this.resolveSystemAccountByCode = deps.resolveSystemAccountByCode;
    this.resolveAccountWithFallback = deps.resolveAccountWithFallback;
    this.getExistingSaleJournal = deps.getExistingSaleJournal;
    this.getExistingSaleReversalJournal = deps.getExistingSaleReversalJournal;
    this.getExistingSalesReturnJournal = deps.getExistingSalesReturnJournal;
    this.getActiveAccountMap = deps.getActiveAccountMap;
    this.assertTransaction = deps.assertTransaction;
    this.logger = deps.logger;
    this.salesReturnReliefService = new SalesReturnReliefService(this.toMoney);
    this.deliveryCustodyService = new DeliveryCustodyService(
      this.assertTransaction,
      this.toMoney,
      this.resolveAccountWithFallback,
      this.addLine,
      this.insertPostedJournal,
      this.deliverySettlementBasis.bind(this),
      this.ensureTenantFoundation.bind(this),
    );
    this.postSalesReturnService = new PostSalesReturnService(
      this.assertTransaction,
      this.toMoney,
      this.getExistingSalesReturnJournal,
      this.logger,
      this.getTenantAccountingSettings,
      this.resolveAccountWithFallback,
      this.addLine,
      this.resolveSystemAccountByCode,
      this.maxAllowedDifference,
      this.getActiveAccountMap,
      this.insertPostedJournal,
      this.salesReturnCogsAmount.bind(this),
      this.computeSalesReturnRelief.bind(this),
      this.hasDeliveryCustodyReclassification.bind(this),
      this.deliveryCustodyPartner.bind(this),
      this.ensureTenantFoundation.bind(this),
    );
    this.reverseSaleJournalService = new ReverseSaleJournalService(
      this.toMoney,
      this.getExistingSaleReversalJournal,
      this.logger,
      this.resolveAccountWithFallback,
      this.maxAllowedDifference,
      this.insertPostedJournal,
      this.ensureTenantFoundation.bind(this),
    );
    this.postSaleService = new PostSaleService(
      this.toMoney,
      this.resolveSystemAccountByCode,
      this.assertTransaction,
      this.getExistingSaleJournal,
      this.getTenantAccountingSettings,
      this.addLine,
      this.resolveAccountWithFallback,
      this.getActiveAccountMap,
      this.maxAllowedDifference,
      this.insertPostedJournal,
      this.saleCogsResidual.bind(this),
      this.postSalesReturn.bind(this),
      this.ensureTenantFoundation.bind(this),
    );
    this.postSaleEditService = new PostSaleEditService(
      this.toMoney,
      this.assertTransaction,
      this.getTenantAccountingSettings,
      this.resolveAccountWithFallback,
      this.addLine,
      this.getActiveAccountMap,
      this.maxAllowedDifference,
      this.insertPostedJournal,
      this.residualCogsGroups.bind(this),
      this.saleCogsResidual.bind(this),
      this.addSaleRevenueCreditLegs.bind(this),
      this.reverseSaleJournal.bind(this),
      this.postSalesReturn.bind(this),
      this.ensureTenantFoundation.bind(this),
    );
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.foundation.ensureForAuth(queryable, auth);
  }

  async saleCogsResidual(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
  ): Promise<number> {
    return this.saleCogsResidualService.saleCogsResidual(queryable, tenantId, saleId, bookDigits);
  }

  async readSaleResidualLines(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
  ): Promise<
    Array<{
      id: number;
      product_id: number | null;
      qty: number | string;
      cost_price: number | string | null;
      unit_multiplier: number | string | null;
      modifiers: unknown;
    }>
  > {
    return this.saleCogsResidualService.readSaleResidualLines(queryable, tenantId, saleId);
  }

  async residualCogsGroups(
    queryable: Transaction<Database>,
    tenantId: string,
    saleItems: Array<{
      id: number;
      product_id: number | null;
      qty: number | string;
      cost_price: number | string | null;
      unit_multiplier: number | string | null;
      modifiers: unknown;
    }>,
    qtySoldBySaleItemId: Map<number, number> | null,
  ): Promise<CogsResidualGroup[]> {
    return this.saleCogsResidualService.residualCogsGroups(queryable, tenantId, saleItems, qtySoldBySaleItemId);
  }

  async salesReturnCogsResidual(
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
    returnedQtyBySaleItemId: Map<number, number>,
  ): Promise<number> {
    return this.saleCogsResidualService.salesReturnCogsResidual(
      queryable,
      tenantId,
      saleId,
      bookDigits,
      returnedQtyBySaleItemId,
    );
  }

  // resolveSalesReturnCostLines lives in sales-returns-posting/sale-cogs-residual.ts (S1 slice).
  async salesReturnCogsAmount(
    queryable: Transaction<Database>,
    tenantId: string,
    sale: { id: number } | null,
    returnItems: Array<{
      product_id: number | null;
      sale_item_id: number | null;
      qty: number | string;
      cost_price?: number | string | null;
    }>,
    saleItems: Array<{ id: number; product_id: number | null; cost_price: number | string | null }>,
    bookDigits: MoneyDigits,
  ): Promise<number> {
    return this.saleCogsResidualService.salesReturnCogsAmount(
      queryable,
      tenantId,
      sale,
      returnItems,
      saleItems,
      bookDigits,
    );
  }

  async addSaleRevenueCreditLegs(
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
    return this.postSaleService.addSaleRevenueCreditLegs(queryable, tenantId, add, input, bookDigits);
  }

  async postSale(
    queryable: Transaction<Database>,
    saleId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number }> {
    return this.postSaleService.postSale(queryable, saleId, auth);
  }

  async postSaleEdit(
    queryable: Transaction<Database>,
    saleId: number,
    auth: AuthContext,
    reason?: string,
    options?: {
      preparedWaste?: {
        oldItems: Array<{
          id: number;
          product_id: number | null;
          qty: number | string;
          cost_price: number | string | null;
          unit_multiplier: number | string | null;
          modifiers: unknown;
        }>;
        restoredQtyBySaleItemId: Map<number, number>;
      };
    },
  ): Promise<{ posted: boolean; journalEntryId: number }> {
    return this.postSaleEditService.postSaleEdit(queryable, saleId, auth, reason, options);
  }

  async reverseSaleJournal(
    queryable: DbOrTx,
    saleId: number,
    reason: string,
    auth: AuthContext,
    options?: { isPreparedWaste?: boolean; preparedWasteCogsExclusion?: number },
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    return this.reverseSaleJournalService.reverseSaleJournal(queryable, saleId, reason, auth, options);
  }

  async reverseSaleJournalById(
    queryable: DbOrTx,
    saleId: number,
    journalId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    return this.reverseSaleJournalService.reverseSaleJournalById(queryable, saleId, journalId, reason, auth);
  }

  async priorSalesReturnRelief(
    queryable: DbOrTx,
    tenantId: string,
    saleId: number,
    excludeReturnId: number | null,
  ): Promise<{ tip: number; courier: number }> {
    return this.salesReturnReliefService.priorSalesReturnRelief(queryable, tenantId, saleId, excludeReturnId);
  }

  async priorSalesReturnReceivableCredit(queryable: DbOrTx, tenantId: string, saleId: number): Promise<number> {
    return this.salesReturnReliefService.priorSalesReturnReceivableCredit(queryable, tenantId, saleId);
  }

  async deliverySettlementBasis(
    queryable: DbOrTx,
    saleId: number,
    auth: AuthContext,
  ): Promise<{ totalDebt: number; remainingReceivable: number; remainingFee: number }> {
    return this.salesReturnReliefService.deliverySettlementBasis(queryable, saleId, auth);
  }

  async postDeliveryCustodyReclassification(
    queryable: Transaction<Database>,
    saleId: number,
    repId: number,
    auth: AuthContext,
  ): Promise<{
    posted: boolean;
    journalEntryId: number | null;
    amount: number;
    customerId: number | null;
    docNo: string;
  }> {
    return this.deliveryCustodyService.postDeliveryCustodyReclassification(queryable, saleId, repId, auth);
  }

  async hasDeliveryCustodyReclassification(queryable: DbOrTx, saleId: number, auth: AuthContext): Promise<boolean> {
    return this.deliveryCustodyService.hasDeliveryCustodyReclassification(queryable, saleId, auth);
  }

  async deliveryCustodyPartner(
    queryable: DbOrTx,
    saleId: number,
  ): Promise<{ partnerType: 'rep' | 'none'; partnerId: number | null }> {
    return this.deliveryCustodyService.deliveryCustodyPartner(queryable, saleId);
  }

  async getRepCustodyBalance(queryable: DbOrTx, repId: number, auth: AuthContext): Promise<number> {
    return this.deliveryCustodyService.getRepCustodyBalance(queryable, repId, auth);
  }

  async computeSalesReturnRelief(
    queryable: DbOrTx,
    tenantId: string,
    sale:
      | {
          id: number;
          subtotal?: unknown;
          discount?: unknown;
          tip_amount?: unknown;
          delivery_fee?: unknown;
          delivery_fee_mode?: unknown;
          service_charge?: unknown;
          tax_amount?: unknown;
          prices_include_tax?: unknown;
        }
      | null
      | undefined,
    returnTotal: number,
    netReturnAmount: number,
    excludeReturnId: number | null,
  ): Promise<{ tipRelief: number; courierRelief: number; totalRelief: number }> {
    return this.salesReturnReliefService.computeSalesReturnRelief(
      queryable,
      tenantId,
      sale,
      returnTotal,
      netReturnAmount,
      excludeReturnId,
    );
  }

  async postSalesReturn(
    queryable: Transaction<Database>,
    returnId: number,
    auth: AuthContext,
    collectExchangeLines?: (lines: JournalLineDraft[]) => void,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postSalesReturnService.postSalesReturn(queryable, returnId, auth, collectExchangeLines);
  }
}
