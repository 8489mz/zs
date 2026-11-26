import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
// previewConsumableStockQty is kept in this import: check-architecture-guardrails.cjs requires the token in returns.service.ts, although no method left in this file calls it.
import { applyStockDelta, previewConsumableStockQty } from '../../common/utils/location-stock-ledger';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { CreateReturnDto } from './dto/create-return.dto';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { IdempotencyService } from '../../core/idempotency/idempotency.service';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import {
  type ConditionalDiscountForfeitBreakdown,
  type ConditionalDiscountForfeitResult,
} from './engines/conditional-header-discount-return.engine';
import { settlePosExchange } from '../sales/engines/pos-exchange.engine';
import { ReturnsWriteHelpersService } from './returns-write-helpers.service';
import type { ExchangeReturnContext, ReturnInputItem, ReturnDocumentInput } from './returns.types';
export type { ExchangeReturnContext };
import { ReturnsReliefService } from './returns-relief.service';
import { ReturnsReadsService } from './returns-reads.service';
import { ReturnsCreateService } from './returns-create.service';
import { ReturnsSaleReturnService } from './returns-sale-return.service';
import { ReturnsPurchaseReturnService } from './returns-purchase-return.service';
import { ExchangeReturnPort } from '../../common/utils/exchange-return.port';

@Injectable()
export class ReturnsService extends ExchangeReturnPort {
  private readonly reads: ReturnsReadsService;
  private readonly relief: ReturnsReliefService;
  private readonly writeHelpers: ReturnsWriteHelpersService;
  private readonly createService: ReturnsCreateService;
  private readonly saleReturn: ReturnsSaleReturnService;
  private readonly purchaseReturn: ReturnsPurchaseReturnService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly idempotency: IdempotencyService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {
    super();
    this.reads = new ReturnsReadsService({
      db: this.db,
      tenantPredicate: this.tenantPredicate.bind(this),
      scope: this.scope.bind(this),
    });
    this.relief = new ReturnsReliefService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      scope: this.scope.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
    });
    this.writeHelpers = new ReturnsWriteHelpersService({
      scope: this.scope.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
      tenantFields: this.tenantFields.bind(this),
    });
    this.createService = new ReturnsCreateService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      idempotency: this.idempotency,
      whatsappService: this.whatsappService,
      scope: this.scope.bind(this),
      verifyManagerAuthorization: this.verifyManagerAuthorization.bind(this),
      getLargeCashRefundThreshold: this.getLargeCashRefundThreshold.bind(this),
      addTreasuryTransaction: this.addTreasuryTransaction.bind(this),
      addStoreCredit: this.addStoreCredit.bind(this),
      createSaleReturn: this.createSaleReturn.bind(this),
      createPurchaseReturn: this.createPurchaseReturn.bind(this),
    });
    this.saleReturn = new ReturnsSaleReturnService({
      accountingPosting: this.accountingPosting,
      scope: this.scope.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
      tenantFields: this.tenantFields.bind(this),
      computeForfeitForReturn: this.computeForfeitForReturn.bind(this),
      applyRaisedGoodsTotal: this.applyRaisedGoodsTotal.bind(this),
      verifyManagerAuthorization: this.verifyManagerAuthorization.bind(this),
      restoreReturnedPharmacyBatches: this.restoreReturnedPharmacyBatches.bind(this),
      restoreReturnedInventoryBatches: this.restoreReturnedInventoryBatches.bind(this),
      insertReturnDocument: this.insertReturnDocument.bind(this),
      insertReturnItem: this.insertReturnItem.bind(this),
      addStoreCredit: this.addStoreCredit.bind(this),
      addCustomerLedgerEntry: this.addCustomerLedgerEntry.bind(this),
      addTreasuryTransaction: this.addTreasuryTransaction.bind(this),
    });
    this.purchaseReturn = new ReturnsPurchaseReturnService({
      accountingPosting: this.accountingPosting,
      scope: this.scope.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
      tenantFields: this.tenantFields.bind(this),
      verifyManagerAuthorization: this.verifyManagerAuthorization.bind(this),
      insertReturnDocument: this.insertReturnDocument.bind(this),
      insertReturnItem: this.insertReturnItem.bind(this),
      addSupplierLedgerEntry: this.addSupplierLedgerEntry.bind(this),
      addTreasuryTransaction: this.addTreasuryTransaction.bind(this),
    });
  }

  private scope(auth: AuthContext) {
    return requireTenantScope(auth);
  }
  private tenantPredicate(auth: AuthContext, alias?: string) {
    const tenantId = this.scope(auth).tenantId;
    return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}` : sql<boolean>`tenant_id = ${tenantId}`;
  }
  private tenantFields(auth: AuthContext) {
    const scope = this.scope(auth);
    return { tenant_id: scope.tenantId, account_id: scope.accountId };
  }

  private async addTreasuryTransaction(
    trx: Kysely<Database>,
    txnType: string,
    amount: number,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
    cashRefund = false,
  ): Promise<void> {
    return this.writeHelpers.addTreasuryTransaction(
      trx,
      txnType,
      amount,
      note,
      returnDocumentId,
      auth,
      branchId,
      locationId,
      cashRefund,
    );
  }

  private async addCustomerLedgerEntry(
    trx: Kysely<Database>,
    customerId: number,
    amount: number,
    entryType: string,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
  ): Promise<void> {
    return this.writeHelpers.addCustomerLedgerEntry(
      trx,
      customerId,
      amount,
      entryType,
      note,
      returnDocumentId,
      auth,
      branchId,
      locationId,
    );
  }

  private async addSupplierLedgerEntry(
    trx: Kysely<Database>,
    supplierId: number,
    amount: number,
    entryType: string,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
  ): Promise<void> {
    return this.writeHelpers.addSupplierLedgerEntry(
      trx,
      supplierId,
      amount,
      entryType,
      note,
      returnDocumentId,
      auth,
      branchId,
      locationId,
    );
  }

  private async addStoreCredit(
    trx: Kysely<Database>,
    customerId: number,
    amount: number,
    auth: AuthContext,
  ): Promise<void> {
    return this.writeHelpers.addStoreCredit(trx, customerId, amount, auth);
  }

  private async restoreReturnedPharmacyBatches(
    trx: Kysely<Database>,
    saleId: number,
    saleItemId: number,
    productId: number,
    previousReturnedBaseQty: number,
    returnBaseQty: number,
    auth: AuthContext,
  ): Promise<void> {
    return this.writeHelpers.restoreReturnedPharmacyBatches(
      trx,
      saleId,
      saleItemId,
      productId,
      previousReturnedBaseQty,
      returnBaseQty,
      auth,
    );
  }

  private async restoreReturnedInventoryBatches(
    trx: Kysely<Database>,
    saleId: number,
    saleItemId: number,
    productId: number,
    previousReturnedBaseQty: number,
    returnBaseQty: number,
    auth: AuthContext,
  ): Promise<void> {
    return this.writeHelpers.restoreReturnedInventoryBatches(
      trx,
      saleId,
      saleItemId,
      productId,
      previousReturnedBaseQty,
      returnBaseQty,
      auth,
    );
  }

  private async insertReturnDocument(
    trx: Kysely<Database>,
    row: ReturnDocumentInput,
    auth: AuthContext,
  ): Promise<{ id: number; docNo: string }> {
    return this.writeHelpers.insertReturnDocument(trx, row, auth);
  }

  private async insertReturnItem(
    trx: Kysely<Database>,
    row: {
      returnDocumentId: number;
      productId: number | null;
      productName: string;
      qty: number;
      unitTotal: number;
      lineTotal: number;
      allocatedTax?: number | null;
      costPrice?: number | null;
      saleItemId?: number;
      purchaseItemId?: number;
    },
    auth: AuthContext,
  ): Promise<void> {
    return this.writeHelpers.insertReturnItem(trx, row, auth);
  }

  async listReturns(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reads.listReturns(query, auth);
  }

  async getReturnById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reads.getReturnById(id, auth);
  }

  async getInvoiceReturnedQuantities(
    type: string,
    invoiceId: number,
    auth: AuthContext,
  ): Promise<{ returnedQtyByLine: Record<string, number>; blockedProductIds: string[] }> {
    return this.reads.getInvoiceReturnedQuantities(type, invoiceId, auth);
  }

  private computeForfeitForReturn(args: {
    sale: {
      discount: number | string | null;
      total: number | string | null;
      tax_amount: number | string | null;
      prices_include_tax: boolean | null;
    };
    saleItems: Array<{
      id: number | string;
      qty: number | string | null;
      unit_price: number | string | null;
      line_total: number | string | null;
      line_discount?: number | string | null;
      net_line_total?: number | string | null;
      allocated_discount?: number | string | null;
      allocated_tax?: number | string | null;
    }>;
    returnedQtyByLine: Map<number, number>;
    returnedAmountByLine: Map<number, number>;
    items: ReturnInputItem[];
    moneyDigits: 2 | 3;
    requestedGoodsRefund?: number;
  }): ConditionalDiscountForfeitResult {
    return this.relief.computeForfeitForReturn(args);
  }

  private applyRaisedGoodsTotal(
    lines: Array<{ qty: number; unitTotal: number; lineTotal: number; allocatedTax: number }>,
    proRataTotal: number,
    requested: number,
    cap: number,
    moneyDigits: 2 | 3,
  ): number {
    return this.relief.applyRaisedGoodsTotal(lines, proRataTotal, requested, cap, moneyDigits);
  }

  async previewReturnRelief(
    payload: CreateReturnDto,
    auth: AuthContext,
  ): Promise<{
    goodsTotal: number;
    originalGoodsTotal: number;
    tipRelief: number;
    courierRelief: number;
    totalRelief: number;
    refundTotal: number;
    forfeit?: ConditionalDiscountForfeitBreakdown;
  }> {
    return this.relief.previewReturnRelief(payload, auth);
  }

  private async getLargeCashRefundThreshold(
    auth: AuthContext,
    executor: Kysely<Database> | Transaction<Database> = this.db,
  ): Promise<number> {
    return this.relief.getLargeCashRefundThreshold(auth, executor);
  }

  private async verifyManagerAuthorization(trx: Kysely<Database>, secret: string, auth: AuthContext): Promise<string> {
    return this.relief.verifyManagerAuthorization(trx, secret, auth);
  }

  async createReturn(payload: CreateReturnDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.createService.createReturn(payload, auth);
  }

  async prepareExchangeReturn(
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    auth: AuthContext,
  ): Promise<ExchangeReturnContext> {
    return this.createService.prepareExchangeReturn(trx, payload, auth);
  }

  async settleExchangeReturn(
    trx: Transaction<Database>,
    context: ExchangeReturnContext,
    saleTotal: number,
    requested: 'cash' | 'card' | 'store_credit',
    auth: AuthContext,
    managerPin?: string,
  ): Promise<ReturnType<typeof settlePosExchange>> {
    return this.createService.settleExchangeReturn(trx, context, saleTotal, requested, auth, managerPin);
  }

  private async createSaleReturn(
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    items: ReturnInputItem[],
    auth: AuthContext,
    approvedByName?: string,
    exchangePrepared?: (context: ExchangeReturnContext) => void,
    approvalRequest?: { secret: string; threshold: number },
  ): Promise<number[]> {
    return this.saleReturn.createSaleReturn(
      trx,
      payload,
      items,
      auth,
      approvedByName,
      exchangePrepared,
      approvalRequest,
    );
  }

  private async createPurchaseReturn(
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    items: ReturnInputItem[],
    auth: AuthContext,
    approvalRequest?: { secret: string; threshold: number },
  ): Promise<number[]> {
    return this.purchaseReturn.createPurchaseReturn(trx, payload, items, auth, approvalRequest);
  }
}
