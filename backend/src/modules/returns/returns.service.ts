import { revalueStockReturn, valueStockReceipt } from '../accounting/inventory-valuation';
import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { hasUnpaidExchangeBalance } from './engines/exchange-store-credit.engine';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney as roundBookMoney } from '../accounting/engines/money-minor-units.engine';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { ensureReturnQtyWithinLimit } from '../../common/utils/financial-integrity';
import { applyStockDelta, lockStockProducts, previewConsumableStockQty } from '../../common/utils/location-stock-ledger';
import { normalizeReturnItems } from './helpers/return-payload.helper';
import { buildPurchaseReturnLine, buildSaleReturnLine, calculateReturnDocumentTotal, originalPurchaseReturnUnitCost } from './helpers/returns-write.helper';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { CreateReturnDto } from './dto/create-return.dto';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { IdempotencyService } from '../../core/idempotency/idempotency.service';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { allocateRefundTenders, type RefundTender } from './engines/refund-tender.engine';
import { type ConditionalDiscountForfeitBreakdown, type ConditionalDiscountForfeitResult } from './engines/conditional-header-discount-return.engine';
import { allocateInvoiceDiscount } from '../sales/engines/invoice-discount.engine';
import { settlePosExchange } from '../sales/engines/pos-exchange.engine';
import { selectPurchaseReturnSerials, selectPurchaseReturnBatch } from './helpers/purchase-return-traceability.helper';
import { restoreImportLotsFromSalesReturn } from '../import-sales/helpers/import-lot-allocation.helper';
import { ReturnsWriteHelpersService } from './returns-write-helpers.service';
import type { ReturnDocumentInput } from './returns.types';
import { ReturnsReliefService } from './returns-relief.service';
import { ReturnsReadsService } from './returns-reads.service';
import { ReturnsCreateService } from './returns-create.service';

export interface ExchangeReturnContext {
  returnId: number;
  total: number;
  customerId: number;
  branchId: number | null;
  locationId: number | null;
  refundBase: Omit<Parameters<typeof allocateRefundTenders>[0], 'amount' | 'requested'>;
}

type ReturnInputItem = { productId: number; productName: string; qty: number; saleItemId?: number; purchaseItemId?: number; batchId?: number; serials?: string[] };
type ReturnDocumentInput = { returnType: 'sale' | 'purchase'; invoiceId: number; settlementMode: string; refundMethod: string; total: number; note: string; branchId: number | null; locationId: number | null; refundAllocations?: Array<{ tender: RefundTender | 'payable'; amount: number }>; tipRelief?: number; courierRelief?: number; forfeitedHeaderDiscount?: number | null; goodwillAmount?: number | null; goodwillReason?: string | null; headerDiscountMode?: string | null };

@Injectable()
export class ReturnsService {
  private readonly reads: ReturnsReadsService;
  private readonly relief: ReturnsReliefService;
  private readonly writeHelpers: ReturnsWriteHelpersService;
  private readonly createService: ReturnsCreateService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly idempotency: IdempotencyService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {
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
  }

  private scope(auth: AuthContext) { return requireTenantScope(auth); }
  private tenantPredicate(auth: AuthContext, alias?: string) { const tenantId = this.scope(auth).tenantId; return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}` : sql<boolean>`tenant_id = ${tenantId}`; }
  private tenantFields(auth: AuthContext) { const scope = this.scope(auth); return { tenant_id: scope.tenantId, account_id: scope.accountId }; }

  private async addTreasuryTransaction(trx: Kysely<Database>, txnType: string, amount: number, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null, cashRefund = false): Promise<void> {
    return this.writeHelpers.addTreasuryTransaction(trx, txnType, amount, note, returnDocumentId, auth, branchId, locationId, cashRefund);
  }

  private async addCustomerLedgerEntry(trx: Kysely<Database>, customerId: number, amount: number, entryType: string, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null): Promise<void> {
    return this.writeHelpers.addCustomerLedgerEntry(trx, customerId, amount, entryType, note, returnDocumentId, auth, branchId, locationId);
  }

  private async addSupplierLedgerEntry(trx: Kysely<Database>, supplierId: number, amount: number, entryType: string, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null): Promise<void> {
    return this.writeHelpers.addSupplierLedgerEntry(trx, supplierId, amount, entryType, note, returnDocumentId, auth, branchId, locationId);
  }

  private async addStoreCredit(trx: Kysely<Database>, customerId: number, amount: number, auth: AuthContext): Promise<void> {
    return this.writeHelpers.addStoreCredit(trx, customerId, amount, auth);
  }

  private async restoreReturnedPharmacyBatches(
    trx: Kysely<Database>, saleId: number, saleItemId: number, productId: number,
    previousReturnedBaseQty: number, returnBaseQty: number, auth: AuthContext,
  ): Promise<void> {
    return this.writeHelpers.restoreReturnedPharmacyBatches(trx, saleId, saleItemId, productId, previousReturnedBaseQty, returnBaseQty, auth);
  }

  private async restoreReturnedInventoryBatches(
    trx: Kysely<Database>, saleId: number, saleItemId: number, productId: number,
    previousReturnedBaseQty: number, returnBaseQty: number, auth: AuthContext,
  ): Promise<void> {
    return this.writeHelpers.restoreReturnedInventoryBatches(trx, saleId, saleItemId, productId, previousReturnedBaseQty, returnBaseQty, auth);
  }

  private async insertReturnDocument(trx: Kysely<Database>, row: ReturnDocumentInput, auth: AuthContext): Promise<{ id: number; docNo: string }> {
    return this.writeHelpers.insertReturnDocument(trx, row, auth);
  }

  private async insertReturnItem(trx: Kysely<Database>, row: { returnDocumentId: number; productId: number | null; productName: string; qty: number; unitTotal: number; lineTotal: number; allocatedTax?: number | null; costPrice?: number | null; saleItemId?: number; purchaseItemId?: number }, auth: AuthContext): Promise<void> {
    return this.writeHelpers.insertReturnItem(trx, row, auth);
  }

  async listReturns(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reads.listReturns(query, auth);
  }

  async getReturnById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reads.getReturnById(id, auth);
  }

  async getInvoiceReturnedQuantities(type: string, invoiceId: number, auth: AuthContext):
    Promise<{ returnedQtyByLine: Record<string, number>; blockedProductIds: string[] }> {
    return this.reads.getInvoiceReturnedQuantities(type, invoiceId, auth);
  }

  private computeForfeitForReturn(args: {
    sale: { discount: number | string | null; total: number | string | null; tax_amount: number | string | null; prices_include_tax: boolean | null };
    saleItems: Array<{ id: number | string; qty: number | string | null; unit_price: number | string | null; line_total: number | string | null; line_discount?: number | string | null; net_line_total?: number | string | null; allocated_discount?: number | string | null; allocated_tax?: number | string | null }>;
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

  async previewReturnRelief(payload: CreateReturnDto, auth: AuthContext): Promise<{ goodsTotal: number; originalGoodsTotal: number; tipRelief: number; courierRelief: number; totalRelief: number; refundTotal: number; forfeit?: ConditionalDiscountForfeitBreakdown }> {
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

  async prepareExchangeReturn(trx: Transaction<Database>, payload: CreateReturnDto, auth: AuthContext): Promise<ExchangeReturnContext> {
    return this.createService.prepareExchangeReturn(trx, payload, auth);
  }

  async settleExchangeReturn(trx: Transaction<Database>, context: ExchangeReturnContext, saleTotal: number,
    requested: 'cash' | 'card' | 'store_credit', auth: AuthContext, managerPin?: string): Promise<ReturnType<typeof settlePosExchange>> {
    return this.createService.settleExchangeReturn(trx, context, saleTotal, requested, auth, managerPin);
  }

  private async createSaleReturn(trx: Transaction<Database>, payload: CreateReturnDto, items: ReturnInputItem[], auth: AuthContext, approvedByName?: string,
    exchangePrepared?: (context: ExchangeReturnContext) => void, approvalRequest?: { secret: string; threshold: number }): Promise<number[]> {
    const scope = this.scope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
    const sale = await trx.selectFrom('sales').selectAll().where('id', '=', Number(payload.invoiceId)).where('status', '=', 'posted').where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
    if (!sale) throw new AppError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    // INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the forfeit reprices a
    // refund; an exchange grants store credit for the return total
    // instead, so the two must never mix in one document.
    if (exchangePrepared && (payload.forfeitHeaderDiscount || payload.goodwillRefundAmount != null)) {
      throw new AppError('إلغاء خصم الفاتورة أو التسوية الودية غير متاح مع الاستبدال', 'FORFEIT_EXCHANGE_NOT_SUPPORTED', 400);
    }
    if (exchangePrepared && (!sale.customer_id || hasUnpaidExchangeBalance(Number(sale.total), Number(sale.paid_amount), Number(sale.store_credit_used || 0), moneyDigits))) {
      throw new AppError('الاستبدال يتطلب فاتورة مسددة وعميلها مسجلاً؛ سوِّ المديونية أولاً', 'EXCHANGE_UNPAID_SOURCE', 422);
    }
    if (payload.settlementMode === 'store_credit' && !sale.customer_id) {
      throw new AppError('رصيد المتجر يتطلب عميلاً مرتبطاً بالفاتورة', 'RETURN_STORE_CREDIT_CUSTOMER_REQUIRED', 400);
    }
    await lockStockProducts(trx, { ...scope, productIds: items.map((item) => item.productId) });
    if (sale.customer_id) {
      await trx.selectFrom('customers').select('id').where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(sale.customer_id)).forUpdate().executeTakeFirstOrThrow();
    }
    const saleItems = await trx.selectFrom('sale_items').selectAll().where('sale_id', '=', Number(payload.invoiceId)).where(this.tenantPredicate(auth)).orderBy('id', 'asc').forUpdate().execute();
    const settlementMode = payload.settlementMode === 'store_credit' ? 'store_credit' : 'refund';
    // INV-SALE-RETURN-CASH-ONLY: every sale return refunds the FULL
    // amount in CASH from the drawer, never back to the card — there
    // is no shop mechanism to refund to Visa, so a requested 'card'
    // is ignored (never trust a caller-supplied method). Only the
    // store_credit settlement mode is not cash.
    const refundMethod = 'cash';
    const originalPayments = await trx.selectFrom('sale_payments').select(['payment_channel', 'amount'])
      .where('sale_id', '=', Number(sale.id)).where('tenant_id', '=', scope.tenantId).execute();
    const previousRefundRows = await trx.selectFrom('return_documents')
      .select(['refund_method', 'settlement_mode', 'refund_allocations', 'total'])
      .where('return_type', '=', 'sale').where('invoice_id', '=', Number(sale.id))
      .where('tenant_id', '=', scope.tenantId).execute();
    const originalPaid = originalPayments.length
      ? originalPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0) : Number(sale.paid_amount || 0);
    // INV-SALE-RETURN-CASH-ONLY: the original payment split is NOT
    // a cap on cash — the whole paid amount is cash-available, so
    // allocateRefundTenders can only emit a cash leg (after the
    // receivable leg) for a refund. The non-cash share is zero: the
    // card money stays in the shop's bank account and is never
    // recorded as a card deduction. This also feeds the exchange
    // refundBase below, so exchange remainders are cash-only too.
    const originalCashPaid = originalPaid;
    const originalNonCashPaid = 0;
    const priorAllocations: Array<{ tender: RefundTender; amount: number }> = [];
    for (const previous of previousRefundRows) {
      if (previous.refund_allocations != null) {
        const parsed: unknown = typeof previous.refund_allocations === 'string'
          ? JSON.parse(previous.refund_allocations) : previous.refund_allocations;
        if (!Array.isArray(parsed) || parsed.some((entry) => !entry ||
          !['cash', 'card', 'store_credit', 'receivable'].includes(entry.tender) ||
          !Number.isFinite(Number(entry.amount)) || Number(entry.amount) < 0)) {
          throw new AppError('توزيع استرداد سابق غير صالح', 'REFUND_HISTORY_INVALID', 409);
        }
        priorAllocations.push(...parsed as Array<{ tender: RefundTender; amount: number }>);
      } else {
        const tender: RefundTender = previous.settlement_mode === 'store_credit' ? 'store_credit'
          : sale.payment_type === 'credit' ? 'receivable'
            : previous.refund_method === 'cash' ? 'cash' : 'card';
        priorAllocations.push({ tender, amount: Number(previous.total || 0) });
      }
    }
    const priorTotal = (tender: RefundTender) => priorAllocations
      .filter((entry) => entry.tender === tender).reduce((sum, entry) => sum + entry.amount, 0);
    const previousCashRefunded = priorTotal('cash');
    const previousNonCashRefunded = priorTotal('card');
    const previousDebtReversed = priorTotal('receivable');
    const normalizedLines: Array<{ productId: number; productName: string; qty: number; unitTotal: number; lineTotal: number; allocatedTax: number; costPrice?: number | null; saleItemId?: number; purchaseItemId?: number }> = [];

    const pendingQtyByProduct = new Map<number, number>();
    const pendingQtyByLine = new Map<number, number>();

    const returnedRows = await trx
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'))
      .select([
        'ri.product_id',
        'ri.sale_item_id',
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.qty'), sql<number>`0`).as('total_qty'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.line_total'), sql<number>`0`).as('total_amount'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.allocated_tax'), sql<number>`0`).as('total_tax'),
        sql<number>`sum(case when ri.allocated_tax is null then 1 else 0 end)`.as('unpriced_count'),
      ])
      .where('rd.return_type', '=', 'sale')
      .where('rd.invoice_id', '=', Number(payload.invoiceId))
      .where(this.tenantPredicate(auth, 'rd'))
      .where(this.tenantPredicate(auth, 'ri'))
      .groupBy(['ri.product_id', 'ri.sale_item_id'])
      .execute();

    const returnedQtyByLine = new Map<number, number>();
    const returnedAmountByLine = new Map<number, number>();
    const returnedTaxByLine = new Map<number, number>();
    const returnedQtyByProduct = new Map<number, number>();
    const legacyReturnedProducts = new Set<number>();
    const unreconciledReturnLines = new Set<number>();
    for (const r of returnedRows) {
      const q = Number(r.total_qty || 0);
      if (r.sale_item_id) {
        returnedQtyByLine.set(Number(r.sale_item_id), q);
        returnedAmountByLine.set(Number(r.sale_item_id), Number(r.total_amount || 0));
        returnedTaxByLine.set(Number(r.sale_item_id), Number(r.total_tax || 0));
        if (Number(r.unpriced_count || 0) > 0) unreconciledReturnLines.add(Number(r.sale_item_id));
      }
      const pId = Number(r.product_id || 0);
      if (!r.sale_item_id && q > 0) legacyReturnedProducts.add(pId);
      returnedQtyByProduct.set(pId, (returnedQtyByProduct.get(pId) || 0) + q);
    }

    const legacyPricedLineIds = new Set(saleItems.filter((line) => line.net_line_total == null).map((line) => Number(line.id)));
    if (legacyPricedLineIds.size > 0) {
      const allocations = allocateInvoiceDiscount({
        lines: saleItems.map((line) => ({ lineTotal: Number(line.line_total || 0), qty: Number(line.qty || 0) })),
        invoiceDiscount: Number(sale.discount || 0), invoiceTax: Number(sale.tax_amount || 0),
        pricesIncludeTax: Boolean(sale.prices_include_tax), digits: moneyDigits,
      });
      for (let index = 0; index < saleItems.length; index += 1) {
        const line = saleItems[index];
        if (line.net_line_total != null) continue;
        const allocation = allocations[index];
        await trx.updateTable('sale_items').set({
          net_unit_price: allocation.netUnitPrice, net_line_total: allocation.netLineTotal,
          allocated_discount: allocation.allocatedDiscount, allocated_tax: allocation.allocatedTax,
        }).where('id', '=', Number(line.id)).where('tenant_id', '=', scope.tenantId).execute();
        Object.assign(line, {
          net_unit_price: allocation.netUnitPrice, net_line_total: allocation.netLineTotal,
          allocated_discount: allocation.allocatedDiscount, allocated_tax: allocation.allocatedTax,
        });
      }
    }

    for (const requestItem of [...items].sort((a, b) => a.productId - b.productId)) {
      const matchingLines = saleItems.filter((entry) => Number(entry.product_id) === requestItem.productId);
      if (!requestItem.saleItemId && matchingLines.length > 1) {
        throw new AppError('حدد سطر الفاتورة الأصلي للصنف المتكرر', 'SALE_ITEM_ID_REQUIRED', 400);
      }
      const saleItem = requestItem.saleItemId
        ? matchingLines.find((entry) => Number(entry.id) === requestItem.saleItemId)
        : matchingLines[0];
      if (!saleItem) throw new AppError('Return item not found', 'NOT_FOUND', 404);
      const saleLineId = Number(saleItem.id);
      // A prepared restaurant dish consumes both its parent stock and separate
      // ingredients. A refund is financial only: none of those consumed units
      // physically return to inventory, and their historical COGS must stay
      // expensed. The immutable return line records zero *restocked* cost so
      // postSalesReturn reverses revenue/tender without inventing inventory GL.
      const consumedComponent = await trx.selectFrom('sale_line_stock_allocations')
        .select('id').where('tenant_id', '=', scope.tenantId)
        .where('sale_line_id', '=', saleLineId)
        .where('product_id', '!=', Number(saleItem.product_id))
        .executeTakeFirst();
      const isPreparedComposite = Boolean(consumedComponent);
      if (unreconciledReturnLines.has(saleLineId) || (legacyPricedLineIds.has(saleLineId) && (returnedQtyByLine.get(saleLineId) || 0) > 0)) {
        throw new AppError('مرتجع سابق يحتاج تسوية الضريبة والخصم قبل مرتجع جديد', 'RETURN_LEGACY_RECONCILIATION_REQUIRED', 409);
      }
      if (legacyReturnedProducts.has(requestItem.productId)) {
        throw new AppError('مرتجع سابق بلا ربط بسطر الفاتورة يحتاج تسوية قبل مرتجع جديد', 'RETURN_LEGACY_RECONCILIATION_REQUIRED', 409);
      }
      const soldForProduct = matchingLines.reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
      ensureReturnQtyWithinLimit(
        requestItem.qty + (pendingQtyByProduct.get(requestItem.productId) || 0),
        returnedQtyByProduct.get(requestItem.productId) || 0,
        soldForProduct,
      );
      ensureReturnQtyWithinLimit(
        requestItem.qty + (pendingQtyByLine.get(saleLineId) || 0),
        returnedQtyByLine.get(saleLineId) || 0,
        Number(saleItem.qty || 0),
      );
      pendingQtyByProduct.set(requestItem.productId, (pendingQtyByProduct.get(requestItem.productId) || 0) + requestItem.qty);
      pendingQtyByLine.set(saleLineId, (pendingQtyByLine.get(saleLineId) || 0) + requestItem.qty);

      const product = await trx.selectFrom('products').select(['id', 'stock_qty', 'track_serials', 'cost_price']).where('id', '=', requestItem.productId).where(this.tenantPredicate(auth)).executeTakeFirst();
      if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const preparedLine = buildSaleReturnLine(saleItem, product, requestItem, {
        qty: returnedQtyByLine.get(saleLineId) || 0,
        amount: returnedAmountByLine.get(saleLineId) || 0,
        tax: returnedTaxByLine.get(saleLineId) || 0,
      }, moneyDigits);
      const returnedUnitCost = Number(saleItem.cost_price || 0) / Number(saleItem.unit_multiplier || 1);
      // Serialized goods must always use the traceable retail restock workflow.
      if (isPreparedComposite && (product.track_serials === true || requestItem.serials?.length)) {
        throw new AppError('Composite serialized item requires manual stock reconciliation',
          'COMPOSITE_RETURN_SERIAL_RECONCILIATION_REQUIRED', 409);
      }
      if (!isPreparedComposite) {
      const previouslyReturnedBaseQty = Number((
        (returnedQtyByLine.get(saleLineId) || 0) +
        (pendingQtyByLine.get(saleLineId) || 0) - requestItem.qty
      ) * Number(saleItem.unit_multiplier || 1));
      await this.restoreReturnedPharmacyBatches(trx, Number(sale.id), saleLineId, requestItem.productId,
        previouslyReturnedBaseQty, preparedLine.stockDelta, auth);
      // INV-VAN-GENERIC-FEFO: same restore for the generic ledger.
      await this.restoreReturnedInventoryBatches(trx, Number(sale.id), saleLineId, requestItem.productId,
        previouslyReturnedBaseQty, preparedLine.stockDelta, auth);
      await restoreImportLotsFromSalesReturn(trx as any, {
        tenantId: scope.tenantId,
        saleId: Number(sale.id),
        saleItemId: saleLineId,
        productId: requestItem.productId,
        returnQty: preparedLine.stockDelta,
      });

      const originalSerials = typeof saleItem.serials === 'string'
        ? JSON.parse(saleItem.serials || '[]') as unknown : saleItem.serials;
      const hasSerials = product.track_serials === true || (Array.isArray(originalSerials) && originalSerials.length > 0);
      if (hasSerials) {
        if (!Number.isInteger(preparedLine.stockDelta)) {
          throw new AppError('كمية المرتجع التسلسلي يجب أن تكون عدداً صحيحاً', 'RETURN_SERIAL_QUANTITY_INVALID', 400);
        }
        const soldSerials = await trx.selectFrom('product_serials')
          .select(['id', 'serial_number', 'imei_2'])
          .where('tenant_id', '=', scope.tenantId)
          .where('product_id', '=', requestItem.productId)
          .where('sale_id', '=', Number(sale.id)).where('sale_item_id', '=', saleLineId)
          .where('status', '=', 'sold').orderBy('id', 'asc').forUpdate().execute();
        const requestedSerials = (requestItem.serials || []).map((serial) => serial.trim().toLowerCase());
        if (requestedSerials.length === 0 && soldSerials.length !== preparedLine.stockDelta) {
          throw new AppError('حدد سيريالات القطع المراد إرجاعها جزئياً', 'RETURN_SERIALS_REQUIRED', 400);
        }
        const chosen = requestedSerials.length === 0
          ? soldSerials
          : soldSerials.filter((row) => requestedSerials.includes(row.serial_number.toLowerCase()) ||
            (row.imei_2 && requestedSerials.includes(row.imei_2.toLowerCase())));
        if (chosen.length !== preparedLine.stockDelta ||
            (requestedSerials.length > 0 && (requestedSerials.length !== chosen.length || new Set(requestedSerials).size !== requestedSerials.length))) {
          throw new AppError('السيريال غير مباع في سطر الفاتورة أو تم إرجاعه سابقاً', 'RETURN_SERIAL_NOT_SOLD', 409);
        }
        await trx.updateTable('product_serials')
          .set({ status: 'in_stock', sale_id: null, sale_item_id: null, updated_at: sql`NOW()` })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', 'in', chosen.map((row) => row.id)).execute();
      } else if (requestItem.serials?.length) {
        throw new AppError('سطر الفاتورة لا يحتوي على سيريالات', 'RETURN_SERIAL_NOT_SOLD', 400);
      }

      const allocations = await trx.selectFrom('sale_line_stock_allocations')
         .selectAll()
         .where('sale_line_id', '=', saleLineId)
         .where('product_id', '=', requestItem.productId)
         .where(this.tenantPredicate(auth))
         .orderBy('allocation_order', 'desc')
         .execute();

      if (allocations.length > 0) {
         let remainingToSkip = Number((((returnedQtyByLine.get(saleLineId) || 0) + (pendingQtyByLine.get(saleLineId) || 0) - requestItem.qty) * Number(saleItem.unit_multiplier || 1)).toFixed(3));
         let remainingToReturn = preparedLine.stockDelta;

         for (const alloc of allocations) {
            if (remainingToReturn <= 0) break;
            const allocQty = Number(alloc.quantity || 0);
            
            let availableInAlloc = allocQty;
            if (remainingToSkip > 0) {
               const skipFromThis = Math.min(availableInAlloc, remainingToSkip);
               remainingToSkip -= skipFromThis;
               availableInAlloc -= skipFromThis;
            }

            if (availableInAlloc > 0) {
               const returnToThis = Math.min(availableInAlloc, remainingToReturn);
               remainingToReturn = Number((remainingToReturn - returnToThis).toFixed(3));

                const locData = await trx
                  .selectFrom('stock_locations')
                  .select('branch_id')
                  .where('id', '=', alloc.location_id)
                  .where(this.tenantPredicate(auth))
                  .executeTakeFirst();
                if (!locData) {
                  throw new AppError('مخزن السطر الأصلي للمرتجع غير موجود أو خارج نطاق المنشأة', 'SALE_RETURN_ORIGINAL_LOCATION_MISSING', 409);
                }
                const branchId = locData.branch_id ?? sale.branch_id;

               const stockChange = await applyStockDelta(trx, { productId: requestItem.productId, delta: returnToThis, branchId: branchId, locationId: alloc.location_id, tenantId: scope.tenantId, accountId: scope.accountId, allowNegative: true, disableAutoDrain: true });
               await valueStockReceipt(trx, scope.tenantId, requestItem.productId, stockChange.globalAfter, returnToThis, returnedUnitCost * returnToThis);
               await trx.insertInto('stock_movements').values({ product_id: requestItem.productId, movement_type: 'sale_return', qty: returnToThis, before_qty: stockChange.scopeBefore, after_qty: stockChange.scopeAfter, unit_cost: returnedUnitCost, total_cost: roundBookMoney(returnedUnitCost * returnToThis, moneyDigits), reason: 'sale_return', note: 'sale return S-' + String(sale.id), reference_type: 'sale_return', reference_id: Number(payload.invoiceId), branch_id: branchId, location_id: alloc.location_id, created_by: auth.userId, ...this.tenantFields(auth) }).execute();
            }
         }
         
         // Once original location allocations exist, a missing allocation is a
         // damaged audit trail. Never silently return goods to a default warehouse;
         // a partial refund must not create stock in the wrong location.
         if (remainingToReturn > 0.0001) {
           throw new AppError('توزيع مخزون البيع الأصلي غير مكتمل؛ يلزم تسوية المخزن قبل المرتجع', 'SALE_RETURN_STOCK_ALLOCATION_RECONCILIATION_REQUIRED', 409);
         }
      } else {
         const stockChange = await applyStockDelta(trx, { productId: requestItem.productId, delta: preparedLine.stockDelta, branchId: sale.branch_id, locationId: sale.location_id, tenantId: scope.tenantId, accountId: scope.accountId, allowNegative: true, disableAutoDrain: true });
         await valueStockReceipt(trx, scope.tenantId, requestItem.productId, stockChange.globalAfter, preparedLine.stockDelta, returnedUnitCost * preparedLine.stockDelta);
         await trx.insertInto('stock_movements').values({ product_id: requestItem.productId, movement_type: 'sale_return', qty: preparedLine.stockDelta, before_qty: stockChange.scopeBefore, after_qty: stockChange.scopeAfter, unit_cost: returnedUnitCost, total_cost: roundBookMoney(returnedUnitCost * preparedLine.stockDelta, moneyDigits), reason: 'sale_return', note: 'sale return S-' + String(sale.id), reference_type: 'sale_return', reference_id: Number(payload.invoiceId), branch_id: sale.branch_id, location_id: sale.location_id, created_by: auth.userId, ...this.tenantFields(auth) }).execute();
      }

      } // End restock path. Prepared meals remain consumed and must never create stock.
      normalizedLines.push({ productId: preparedLine.productId, productName: preparedLine.productName, qty: preparedLine.qty, unitTotal: preparedLine.unitTotal, lineTotal: preparedLine.lineTotal, allocatedTax: preparedLine.allocatedTax, costPrice: isPreparedComposite ? 0 : Number(saleItem.cost_price || 0), saleItemId: saleLineId });
    }

    const originalGoodsTotal = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
    let total = originalGoodsTotal;
    // INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: TWO merchant-chosen
    // modes — the system cannot know whether the header discount was
    // a bundle deal or a general discount, so the dialog shows both
    // amounts and the merchant picks per return:
    // - 'original' (default): the recorded net line after discount
    //   allocation (267 per piece); goodwill above it rides on the
    //   pro-rata lines, capped at the returned pieces' gross price.
    // - 'forfeit': the kept pieces reprice at original price and the
    //   whole header discount forfeits (200 per piece); the engine's
    //   lines replace the pro-rata pricing above.
    // Stock restock above is qty-based and already done at frozen
    // cost, so it is untouched by either mode. The relief, tender
    // allocation, journal and treasury below all read this total,
    // so they follow the priced refund automatically. The chosen
    // mode is stored on the document (header_discount_mode).
    let forfeit: ConditionalDiscountForfeitResult | null = null;
    let goodwillAmount = 0;
    let goodwillReason: string | undefined;
    if (payload.forfeitHeaderDiscount || payload.goodwillRefundAmount != null) {
      forfeit = this.computeForfeitForReturn({
        sale, saleItems, returnedQtyByLine, returnedAmountByLine, items, moneyDigits,
        requestedGoodsRefund: payload.forfeitHeaderDiscount ? payload.goodwillRefundAmount : undefined,
      });
    }
    if (payload.forfeitHeaderDiscount && forfeit?.applies) {
      const pricedByLine = new Map(forfeit.lines.map((entry) => [entry.saleItemId, entry]));
      for (const line of normalizedLines) {
        const priced = line.saleItemId == null ? undefined : pricedByLine.get(line.saleItemId);
        if (!priced) throw new AppError('تعذر تسعير بند المرتجع بعد إلغاء خصم الفاتورة', 'CONDITIONAL_DISCOUNT_FORFEIT_LINE_MISSING', 500);
        line.lineTotal = priced.lineTotal;
        line.allocatedTax = priced.allocatedTax;
        line.unitTotal = priced.unitTotal;
      }
      total = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
      if (Math.abs(total - (forfeit.computedGoodsRefund + forfeit.goodwillAmount)) > 0.001) {
        throw new AppError('إجمالي المرتجع بعد إلغاء الخصم لا يطابق الحسبة', 'CONDITIONAL_DISCOUNT_FORFEIT_TOTAL_MISMATCH', 500);
      }
      goodwillAmount = forfeit.goodwillAmount;
    } else if (payload.goodwillRefundAmount != null) {
      // Original mode: the goodwill extra rides on the pro-rata
      // lines, capped at the returned pieces' gross price — the
      // same cap as the forfeit mode.
      const cap = forfeit?.applies ? forfeit.goodwillCap : originalGoodsTotal;
      goodwillAmount = this.applyRaisedGoodsTotal(normalizedLines, originalGoodsTotal, Number(payload.goodwillRefundAmount), cap, moneyDigits);
      total = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
      if (Math.abs(total - Number(payload.goodwillRefundAmount)) > 0.001) {
        throw new AppError('إجمالي المرتجع بعد التسوية الودية لا يطابق المبلغ المطلوب', 'CONDITIONAL_DISCOUNT_FORFEIT_TOTAL_MISMATCH', 500);
      }
    }
    if (goodwillAmount > 0) {
      goodwillReason = String(payload.goodwillRefundReason || '').trim();
      if (!goodwillReason) {
        throw new AppError('التسوية الودية تحتاج سبباً واضحاً', 'GOODWILL_REASON_REQUIRED', 400);
      }
      // A goodwill extra above the computed refund always needs a
      // manager's credential for non-admins — same gate as the
      // refund-method override above. Admins see the warning in the
      // dialog; the backend does not block them.
      if (!['admin', 'super_admin'].includes(auth.role) && approvedByName === undefined) {
        approvedByName = await this.verifyManagerAuthorization(trx, payload.managerPin || '', auth);
      }
    }
    // R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F1, Option A: compute the
    // tip / courier-fee relief BEFORE allocating, and allocate the
    // refund total + relief — the same numbers postSalesReturn
    // journals (computeSalesReturnRelief, one function for both).
    // Before this fix the allocations summed to the return total
    // alone while the journal credited total + relief, so the
    // treasury / store-credit / customer-ledger writers below
    // moved totalRelief too little on the last tender. The
    // large-cash-refund approval check below now reads the FINAL
    // cash leg by construction. The exchange path is exempt: a
    // prepared exchange return grants store credit for the return
    // total only — its relief rides in the new sale's journal,
    // not in a refund payout.
    const returnTaxAmount = normalizedLines.reduce((sum, line) => sum + Number(line.allocatedTax || 0), 0);
    const netReturnAmount = Math.max(0, total - returnTaxAmount);
    const returnRelief = exchangePrepared
      ? { tipRelief: 0, courierRelief: 0, totalRelief: 0 }
      : await this.accountingPosting.computeSalesReturnRelief(
        trx, scope.tenantId, sale, total, netReturnAmount, null,
      );
    const refundTotal = roundBookMoney(total + returnRelief.totalRelief, moneyDigits);
    const overrideRequested = Boolean(String(payload.refundOverrideReason || '').trim());
    const overrideAllowed = Boolean(approvedByName) || auth.role === 'admin' || auth.role === 'super_admin';
    if (overrideRequested && !overrideAllowed) throw new AppError('تجاوز سقف وسيلة الاسترداد يتطلب اعتماد مشرف', 'REFUND_OVERRIDE_MANAGER_REQUIRED', 403);
    const refundAllocations = allocateRefundTenders({
      digits: moneyDigits,
      requested: settlementMode === 'store_credit' ? 'store_credit' : refundMethod,
      amount: refundTotal,
      originalCashPaid, originalNonCashPaid,
      originalDebt: Math.max(0, Number(sale.total || 0) - Number(sale.store_credit_used || 0) - Math.max(originalPaid, Number(sale.paid_amount || 0))),
      previousCashRefunded, previousNonCashRefunded, previousDebtReversed,
      hasCustomer: Boolean(sale.customer_id),
      override: overrideRequested, overrideReason: payload.refundOverrideReason,
    });
    // INV-SPIRIT-LARGE-CASH-REFUND: only a large cash refund needs
    // manager approval. The check runs inside this same transaction,
    // before any document or treasury write, so a rejection rolls
    // back the restock work above with nothing half-posted.
    if (approvalRequest && approvedByName === undefined) {
      const cashRefund = refundAllocations
        .filter((allocation) => allocation.tender === 'cash')
        .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      if (cashRefund >= approvalRequest.threshold) {
        approvedByName = await this.verifyManagerAuthorization(trx, approvalRequest.secret, auth);
      }
    }
    // The forfeit counts as APPLIED only when the merchant chose it
    // and it applies: computing it for display (or for the cap)
    // must never record a forfeited discount on an original-mode
    // document.
    const forfeitApplied = Boolean(payload.forfeitHeaderDiscount && forfeit?.applies);
    const forfeitNote = forfeitApplied && forfeit
      ? `إلغاء خصم فاتورة مشروط ${forfeit.forfeitedHeaderDiscount} (المبلغ المحسوب ${forfeit.computedGoodsRefund})${goodwillAmount > 0 ? `؛ تسوية ودية ${goodwillAmount} بسبب: ${goodwillReason}${approvedByName ? ` (اعتماد: ${approvedByName})` : ''}` : ''}`
      : goodwillAmount > 0
        ? `تسوية ودية ${goodwillAmount} بسبب: ${goodwillReason}${approvedByName ? ` (اعتماد: ${approvedByName})` : ''}`
        : '';
    const returnNote = [overrideRequested
      ? `${String(payload.note || '').trim()} | اعتماد تجاوز وسيلة الاسترداد: ${String(payload.refundOverrideReason).trim()}`.trim()
      : `${String(payload.note || '').trim()}${exchangePrepared && approvedByName ? ` | اعتماد المشرف: ${approvedByName}` : ''}`.trim(),
    forfeitNote].filter(Boolean).join(' | ');
    // The posting service reverses the returned lines using their original sale-line costs.
    const { id: returnDocumentId, docNo: returnDocNo } = await this.insertReturnDocument(trx, {
      returnType: 'sale', invoiceId: Number(payload.invoiceId), settlementMode,
      refundMethod: refundAllocations.length === 1 ? refundAllocations[0].tender : 'mixed',
      refundAllocations, total, note: returnNote, branchId: sale.branch_id, locationId: sale.location_id,
      tipRelief: returnRelief.tipRelief, courierRelief: returnRelief.courierRelief,
      forfeitedHeaderDiscount: forfeitApplied ? (forfeit?.forfeitedHeaderDiscount ?? null) : null,
      goodwillAmount: goodwillAmount > 0 ? goodwillAmount : null,
      goodwillReason: goodwillReason ?? null,
      headerDiscountMode: forfeitApplied ? 'forfeit' : 'original',
    }, auth);
    for (const line of normalizedLines) await this.insertReturnItem(trx, { returnDocumentId, productId: line.productId, productName: line.productName, qty: line.qty, unitTotal: line.unitTotal, lineTotal: line.lineTotal, allocatedTax: line.allocatedTax, costPrice: line.costPrice, saleItemId: line.saleItemId }, auth);
    const customerId = sale.customer_id ? Number(sale.customer_id) : null;
    let postedReceivableLeg = false;
    for (const allocation of refundAllocations) {
      if (allocation.tender === 'store_credit' && customerId) await this.addStoreCredit(trx, customerId, allocation.amount, auth);
      else if (allocation.tender === 'receivable' && customerId) {
        // D-SF-02 (INV-SF-COD-CUSTODY-GL): the receivable left the
        // customer's books at dispatch, so a pre-settle return must
        // not take it off the customer ledger again — the balance
        // is already zero for this order. Post the net-zero pair
        // (same shape as the fully-settled case below) so the
        // return stays visible in the statement while the balance
        // stays exactly unchanged. A settled sale keeps the old
        // single leg.
        if (await this.accountingPosting.hasDeliveryCustodyReclassification(trx, Number(sale.id), auth)
          && String((sale as any).delivery_status || '') !== 'settled') {
          await this.addCustomerLedgerEntry(trx, customerId, -allocation.amount, 'sale_return', 'sale return ' + returnDocNo, returnDocumentId, auth, sale.branch_id, sale.location_id);
          await this.addCustomerLedgerEntry(trx, customerId, allocation.amount, 'sale_return_refund', 'sale return refund ' + returnDocNo, returnDocumentId, auth, sale.branch_id, sale.location_id);
        } else {
          await this.addCustomerLedgerEntry(trx, customerId, -allocation.amount, 'sale_return', 'sale return ' + returnDocNo, returnDocumentId, auth, sale.branch_id, sale.location_id);
        }
        postedReceivableLeg = true;
      }
      else if (allocation.tender === 'cash') await this.addTreasuryTransaction(trx, 'sale_return_refund', -allocation.amount, 'sale return ' + returnDocNo, returnDocumentId, auth, sale.branch_id, sale.location_id, true);
    }
    // INV-CUSTOMER-SUPPLIER-STATEMENTS: a return of a fully-settled
    // sale allocates no 'receivable' tender (there is no recorded debt
    // to reverse -- the original sale posted a net-zero charge /
    // settlement pair, not a debt leg), and the 'card' tender writes
    // no ledger row at all, so the return document vanished from the
    // customer statement. When this return posted no receivable leg,
    // post the reversal and its refund as a pair netting to zero, so
    // the return stays visible while the customer balance stays
    // exactly unchanged. 'sale_return_refund' is a distinct type so
    // no reader mistakes the refund leg for another reversal.
    // R7-A F1: the pair shows the ACTUAL refund (total + relief),
    // as the journal credits it — the legs still net to zero, so
    // the customer balance stays exactly unchanged.
    if (customerId && !postedReceivableLeg && total > 0) {
      await this.addCustomerLedgerEntry(trx, customerId, -refundTotal, 'sale_return', 'sale return ' + returnDocNo, returnDocumentId, auth, sale.branch_id, sale.location_id);
      await this.addCustomerLedgerEntry(trx, customerId, refundTotal, 'sale_return_refund', 'sale return refund ' + returnDocNo, returnDocumentId, auth, sale.branch_id, sale.location_id);
    }

    // Reconcile Customer Loyalty Points on Return (ZS-070)
    if (customerId) {
      const originalSaleTotal = Number(sale.total) || 1;

      // Cumulative returns calculation so repeated partial returns never over-reconcile
      const previousReturns = await trx
        .selectFrom('return_documents')
        .select(sql<number>`COALESCE(SUM(total), 0)`.as('returned_sum'))
        .where('return_type', '=', 'sale')
        .where('invoice_id', '=', Number(sale.id))
        .where('id', '!=', returnDocumentId)
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();
      const cumulativeReturned = Number(previousReturns?.returned_sum || 0) + total;
      const cumulativeRatio = Math.min(1, Math.max(0, cumulativeReturned / originalSaleTotal));

      // 1. Clawback earned loyalty points proportionally
      const earnLog = await trx
        .selectFrom('customer_loyalty_logs')
        .select(['points_change'])
        .where('sale_id', '=', Number(sale.id))
        .where('action_type', '=', 'earn')
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();

      if (earnLog && Number(earnLog.points_change) > 0) {
        const earnedPoints = Number(earnLog.points_change);
        const previousClawbacks = await trx
          .selectFrom('customer_loyalty_logs')
          .select(sql<number>`COALESCE(SUM(ABS(points_change)), 0)`.as('total_clawed'))
          .where('sale_id', '=', Number(sale.id))
          .where('action_type', '=', 'return_clawback')
          .where(this.tenantPredicate(auth))
          .executeTakeFirst();
        const alreadyClawed = Number(previousClawbacks?.total_clawed || 0);

        const targetClawback = Math.min(earnedPoints, Math.round(earnedPoints * cumulativeRatio));
        const clawbackPoints = Math.max(0, Math.min(targetClawback - alreadyClawed, earnedPoints - alreadyClawed));

        if (clawbackPoints > 0) {
          const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(this.tenantPredicate(auth)).executeTakeFirst();
          const currentBal = Number(cust?.loyalty_points || 0);
          const balanceAfter = Math.max(0, Number((currentBal - clawbackPoints).toFixed(2)));

          await trx
            .updateTable('customers')
            .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
            .where('id', '=', customerId)
            .where(this.tenantPredicate(auth))
            .execute();

          await trx
            .insertInto('customer_loyalty_logs')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              customer_id: customerId,
              points_change: -clawbackPoints,
              balance_after: balanceAfter,
              action_type: 'return_clawback',
              sale_id: Number(sale.id),
              notes: `خصم ${clawbackPoints} نقطة ولاء مكتسبة بسبب مرتجع مبيعات ${returnDocNo} على الفاتورة S-${sale.id}`,
              created_at: sql`NOW()`,
            } as any)
            .execute();
        }
      }

      // 2. Refund redeemed loyalty points proportionally if customer had used points for discount
      const redeemLog = await trx
        .selectFrom('customer_loyalty_logs')
        .select(['points_change'])
        .where('sale_id', '=', Number(sale.id))
        .where('action_type', '=', 'redeem')
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();

      if (redeemLog && Number(redeemLog.points_change) < 0) {
        const totalRedeemed = Math.abs(Number(redeemLog.points_change));
        const previousRefunds = await trx
          .selectFrom('customer_loyalty_logs')
          .select(sql<number>`COALESCE(SUM(points_change), 0)`.as('total_refunded'))
          .where('sale_id', '=', Number(sale.id))
          .where('action_type', '=', 'return_refund')
          .where(this.tenantPredicate(auth))
          .executeTakeFirst();
        const alreadyRefunded = Number(previousRefunds?.total_refunded || 0);

        const targetRefund = Math.min(totalRedeemed, Math.round(totalRedeemed * cumulativeRatio));
        const refundPoints = Math.max(0, Math.min(targetRefund - alreadyRefunded, totalRedeemed - alreadyRefunded));

        if (refundPoints > 0) {
          const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(this.tenantPredicate(auth)).executeTakeFirst();
          const currentBal = Number(cust?.loyalty_points || 0);
          const balanceAfter = Number((currentBal + refundPoints).toFixed(2));

          await trx
            .updateTable('customers')
            .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
            .where('id', '=', customerId)
            .where(this.tenantPredicate(auth))
            .execute();

          await trx
            .insertInto('customer_loyalty_logs')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              customer_id: customerId,
              points_change: refundPoints,
              balance_after: balanceAfter,
              action_type: 'return_refund',
              sale_id: Number(sale.id),
              notes: `رد ${refundPoints} نقطة ولاء مستبدلة سابقاً بسبب مرتجع مبيعات ${returnDocNo} على الفاتورة S-${sale.id}`,
              created_at: sql`NOW()`,
            } as any)
            .execute();
        }
      }
    }

    if (exchangePrepared) {
      exchangePrepared({ returnId: returnDocumentId, total, customerId: Number(sale.customer_id),
        branchId: sale.branch_id, locationId: sale.location_id,
        refundBase: { originalCashPaid, originalNonCashPaid, originalDebt: 0,
          previousCashRefunded, previousNonCashRefunded, previousDebtReversed, hasCustomer: true } });
      return [returnDocumentId];
    }
    try {
      const posting = await this.accountingPosting.postSalesReturn(trx, returnDocumentId, auth);
      if (!posting.journalEntryId) throw new Error(`Sales return ${returnDocumentId} has no journal entry`);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error instanceof Error ? error.message : 'Failed to post accounting journal for sales return',
        'SALES_RETURN_ACCOUNTING_POST_FAILED',
        500,
      );
    }
    return [returnDocumentId];
  }

  private async createPurchaseReturn(trx: Transaction<Database>, payload: CreateReturnDto, items: ReturnInputItem[], auth: AuthContext, approvalRequest?: { secret: string; threshold: number }): Promise<number[]> {
    const scope = this.scope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
    const purchase = await trx.selectFrom('purchases').selectAll().where('id', '=', Number(payload.invoiceId)).where('status', '=', 'posted').where(this.tenantPredicate(auth)).forUpdate().executeTakeFirst();
    if (!purchase) throw new AppError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    await lockStockProducts(trx, { ...scope, productIds: items.map((item) => item.productId) });
    const purchaseItems = await trx.selectFrom('purchase_items').selectAll().where('purchase_id', '=', Number(payload.invoiceId)).where(this.tenantPredicate(auth)).orderBy('id', 'asc').forUpdate().execute();
    const normalizedLines: Array<{ productId: number; productName: string; qty: number; unitTotal: number; lineTotal: number; allocatedTax: number; costPrice: number; saleItemId?: number; purchaseItemId?: number }> = [];

    // Purchase items hold after-discount values. Distribute the invoice's actual
    // input VAT to original lines in cents, including the last-line remainder.
    // Inclusive purchase prices already contain VAT; exclusive prices do not.
    const scale = 10 ** moneyDigits;
    const originalTaxCents = Math.round(Number(purchase.tax_amount || 0) * scale);
    const weightedLines = purchaseItems.filter((line) => Number(line.line_total || 0) > 0);
    const netLinesTotal = weightedLines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    const taxByLine = new Map<number, number>();
    let allocatedTaxCents = 0;
    for (let index = 0; index < weightedLines.length; index += 1) {
      const line = weightedLines[index];
      const last = index === weightedLines.length - 1;
      const cents = last ? originalTaxCents - allocatedTaxCents
        : Math.min(originalTaxCents - allocatedTaxCents, Math.round(originalTaxCents * Number(line.line_total || 0) / netLinesTotal));
      allocatedTaxCents += cents;
      taxByLine.set(Number(line.id), cents / scale);
    }

    const pendingQtyByProduct = new Map<number, number>();
    const pendingQtyByLine = new Map<number, number>();

    const returnedRows = await trx
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'))
      .select([
        'ri.product_id',
        'ri.purchase_item_id',
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.qty'), sql<number>`0`).as('total_qty'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.line_total'), sql<number>`0`).as('total_amount'),
        (eb) => eb.fn.coalesce(eb.fn.sum<number>('ri.allocated_tax'), sql<number>`0`).as('total_tax'),
        sql<number>`sum(case when ri.allocated_tax is null then 1 else 0 end)`.as('unallocated_tax_lines'),
      ])
      .where('rd.return_type', '=', 'purchase')
      .where('rd.invoice_id', '=', Number(payload.invoiceId))
      .where(this.tenantPredicate(auth, 'rd'))
      .where(this.tenantPredicate(auth, 'ri'))
      .groupBy(['ri.product_id', 'ri.purchase_item_id'])
      .execute();

    const returnedQtyByLine = new Map<number, number>();
    const returnedAmountByLine = new Map<number, number>();
    const returnedTaxByLine = new Map<number, number>();
    const unreconciledTaxLineIds = new Set<number>();
    const returnedQtyByProduct = new Map<number, number>();
    const legacyReturnedProducts = new Set<number>();
    for (const r of returnedRows) {
      const q = Number(r.total_qty || 0);
      if (r.purchase_item_id) {
        returnedQtyByLine.set(Number(r.purchase_item_id), q);
        returnedAmountByLine.set(Number(r.purchase_item_id), Number(r.total_amount || 0));
        returnedTaxByLine.set(Number(r.purchase_item_id), Number(r.total_tax || 0));
        if (Number(r.unallocated_tax_lines || 0) > 0) unreconciledTaxLineIds.add(Number(r.purchase_item_id));
      }
      const pId = Number(r.product_id || 0);
      if (!r.purchase_item_id && q > 0) legacyReturnedProducts.add(pId);
      returnedQtyByProduct.set(pId, (returnedQtyByProduct.get(pId) || 0) + q);
    }

    for (const requestItem of [...items].sort((a, b) => a.productId - b.productId)) {
      const matchingLines = purchaseItems.filter((entry) => Number(entry.product_id) === requestItem.productId);
      if (!requestItem.purchaseItemId && matchingLines.length > 1) {
        throw new AppError('حدد سطر فاتورة الشراء الأصلي للصنف المتكرر', 'PURCHASE_ITEM_ID_REQUIRED', 400);
      }
      const purchaseItem = requestItem.purchaseItemId
        ? matchingLines.find((entry) => Number(entry.id) === requestItem.purchaseItemId)
        : matchingLines[0];
      if (!purchaseItem) throw new AppError('Return item not found', 'NOT_FOUND', 404);
      const purchaseLineId = Number(purchaseItem.id);
      // Traceable supplier returns reconcile serials and batches below in the
      // SAME stock transaction. The generic quantity-only guard must not block
      // this explicitly reconciled path.
      if (originalTaxCents > 0 && unreconciledTaxLineIds.has(purchaseLineId)) {
        throw new AppError('مرتجع شراء سابق يحتاج تسوية ضريبية قبل مرتجع جديد', 'PURCHASE_RETURN_TAX_RECONCILIATION_REQUIRED', 409);
      }
      if (legacyReturnedProducts.has(requestItem.productId)) {
        throw new AppError('مرتجع شراء سابق بلا ربط بسطر الفاتورة يحتاج تسوية أولاً', 'PURCHASE_RETURN_LEGACY_RECONCILIATION_REQUIRED', 409);
      }
      const purchasedForProduct = matchingLines.reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
      ensureReturnQtyWithinLimit(
        requestItem.qty + (pendingQtyByProduct.get(requestItem.productId) || 0),
        returnedQtyByProduct.get(requestItem.productId) || 0,
        purchasedForProduct,
      );
      ensureReturnQtyWithinLimit(
        requestItem.qty + (pendingQtyByLine.get(purchaseLineId) || 0),
        returnedQtyByLine.get(purchaseLineId) || 0,
        Number(purchaseItem.qty || 0),
      );
      pendingQtyByProduct.set(requestItem.productId, (pendingQtyByProduct.get(requestItem.productId) || 0) + requestItem.qty);
      pendingQtyByLine.set(purchaseLineId, (pendingQtyByLine.get(purchaseLineId) || 0) + requestItem.qty);

      const availableQty = await previewConsumableStockQty(trx, { productId: requestItem.productId, branchId: purchase.branch_id, locationId: purchaseItem.location_id ?? purchase.location_id, tenantId: scope.tenantId, accountId: scope.accountId });
      const product = await trx.selectFrom('products').select(['id', 'stock_qty', 'track_serials', 'cost_price'])
        .where('id', '=', requestItem.productId).where(this.tenantPredicate(auth)).executeTakeFirst();
      if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const sourceTax = taxByLine.get(purchaseLineId) || 0;
      const sourceGross = Number(purchaseItem.line_total || 0) + (purchase.prices_include_tax ? 0 : sourceTax);
      const preparedLine = buildPurchaseReturnLine({ ...purchaseItem, line_total: sourceGross, allocated_tax: sourceTax }, { ...product, stock_qty: availableQty }, requestItem, {
        qty: returnedQtyByLine.get(purchaseLineId) || 0,
        amount: returnedAmountByLine.get(purchaseLineId) || 0,
        tax: returnedTaxByLine.get(purchaseLineId) || 0,
      }, moneyDigits);

      // The serial ledger and general stock ledger must leave the warehouse together.
      const itemLocationId = purchaseItem.location_id ?? purchase.location_id;
      // A purchased serial moved to another warehouse is no longer returnable
      // from this line's source location, even if its status is still in_stock.
      let serialQuery = trx.selectFrom('product_serials')
        .select(['id', 'serial_number', 'imei_2', 'status'])
        .where('tenant_id', '=', scope.tenantId).where('product_id', '=', requestItem.productId)
        .where('purchase_id', '=', Number(purchase.id)).where('purchase_item_id', '=', purchaseLineId)
        .where('status', '=', 'in_stock');
      serialQuery = itemLocationId == null ? serialQuery.where('location_id', 'is', null)
        : serialQuery.where('location_id', '=', itemLocationId);
      serialQuery = purchase.branch_id == null ? serialQuery.where('branch_id', 'is', null)
        : serialQuery.where('branch_id', '=', purchase.branch_id);
      const purchaseSerials = await serialQuery.orderBy('id', 'asc').forUpdate().execute();
      // Legacy products may have existing serial rows without track_serials set.
      // Do not silently treat their remaining stock as untracked.
      const anySerial = await trx.selectFrom('product_serials').select('id')
        .where('tenant_id', '=', scope.tenantId).where('product_id', '=', requestItem.productId)
        .limit(1).executeTakeFirst();
      if (product.track_serials === true || anySerial) {
        const chosen = selectPurchaseReturnSerials(purchaseSerials, requestItem.serials, preparedLine.stockDelta);
        await trx.updateTable('product_serials')
          .set({ status: 'returned', updated_at: sql`NOW()` })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', 'in', chosen.map(row => row.id)).execute();
      } else if (requestItem.serials?.length) {
        throw new AppError('لا توجد سيريالات مرتبطة بسطر فاتورة الشراء', 'PURCHASE_RETURN_SERIAL_NOT_AVAILABLE', 400);
      }

      // Drug lots are a separate quantity ledger. Never deduct product stock without
      // deducting the corresponding unexpired/held lot from the same location.
      const drug = await trx.selectFrom('pharmacy_drugs').select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', requestItem.productId).executeTakeFirst();
      const anyBatch = await trx.selectFrom('pharmacy_batches').select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', requestItem.productId).limit(1).executeTakeFirst();
      if (drug || anyBatch) {
        const sourceBatchNumber = String(purchaseItem.batch_number || '').trim();
        if (!sourceBatchNumber) {
          throw new AppError('تشغيلة بند الشراء غير محفوظة؛ لا يمكن إرجاع كمية دوائية دون مصالحة',
            'PURCHASE_RETURN_BATCH_PROVENANCE_REQUIRED', 409);
        }
        let batchQuery = trx.selectFrom('pharmacy_batches').select(['id', 'quantity', 'batch_number'])
          .where('tenant_id', '=', scope.tenantId)
          .where('product_id', '=', requestItem.productId);
        batchQuery = itemLocationId == null ? batchQuery.where('location_id', 'is', null)
          : batchQuery.where('location_id', '=', itemLocationId);
        const batches = await batchQuery.orderBy('id', 'asc').forUpdate().execute();
        const batch = selectPurchaseReturnBatch(batches, requestItem.batchId, preparedLine.stockDelta);
        if (String(batch.batch_number || '').trim() !== sourceBatchNumber) {
          throw new AppError('تشغيلة المرتجع لا تطابق تشغيلة فاتورة الشراء الأصلية',
            'PURCHASE_RETURN_BATCH_ORIGIN_MISMATCH', 409);
        }
        await trx.updateTable('pharmacy_batches')
          .set({ quantity: Number((Number(batch.quantity) - preparedLine.stockDelta).toFixed(3)), updated_at: sql`NOW()` })
          .where('tenant_id', '=', scope.tenantId).where('id', '=', batch.id).execute();
      } else if (requestItem.batchId) {
        throw new AppError('الصنف ليس دواءً مسجلاً بتشغيلة', 'PURCHASE_RETURN_BATCH_NOT_APPLICABLE', 400);
      }

      const stockChange = await applyStockDelta(trx, { productId: requestItem.productId, delta: -preparedLine.stockDelta, branchId: purchase.branch_id, locationId: itemLocationId, tenantId: scope.tenantId, accountId: scope.accountId, errorCode: 'PURCHASE_RETURN_STOCK_INVALID', errorMessage: 'Invalid stock for purchase return', disableAutoDrain: true });
      // INV-PURCHASE-RETURN-ORIGINAL-COST: cost the return at the ORIGINAL
      // purchase line's net cost, not the current product WAC. The return is
      // lot-identified (purchase_item_id, plus serial/batch provenance where
      // applicable), so it reverses that purchase; costing it at a later
      // WAC would dump the whole WAC drift into the 5190 variance account.
      // The same original cost feeds both the stock movement and the
      // return_items.cost_price that postPurchaseReturn journals from, so
      // the movement and the GL inventory leg cannot diverge.
      const originalCost = originalPurchaseReturnUnitCost({
        unitCost: (purchaseItem as any).unit_cost,
        unitMultiplier: (purchaseItem as any).unit_multiplier,
        taxRate: (purchase as any).tax_rate,
        pricesIncludeTax: (purchase as any).prices_include_tax,
      });
      await trx.insertInto('stock_movements').values({ product_id: requestItem.productId, movement_type: 'purchase_return', qty: -preparedLine.stockDelta, before_qty: stockChange.scopeBefore, after_qty: stockChange.scopeAfter, unit_cost: originalCost.perBaseUnit, total_cost: roundBookMoney(preparedLine.stockDelta * originalCost.perBaseUnit, moneyDigits), reason: 'purchase_return', note: 'purchase return PUR-' + String(purchase.id), reference_type: 'purchase_return', reference_id: Number(payload.invoiceId), branch_id: purchase.branch_id, location_id: itemLocationId, created_by: auth.userId, ...this.tenantFields(auth) }).execute();
      // INV-PURCHASE-RETURN-WAC-RECOMPUTE: the return leaves at the
      // ORIGINAL cost, so re-blend the remaining pool at that cost in
      // the SAME transaction. Without this, the GL inventory leg
      // (original cost) and the physical pool (qty * cost_price)
      // diverge by the whole WAC drift. The subtracted value is the
      // line's GL inventory credit at book digits (sold qty x original
      // per-sold-unit cost), exactly what postPurchaseReturn sums from
      // return_items — not the stock movement's per-base-unit total,
      // which can differ by rounding dust when a unit multiplier
      // applies. Never in postPurchaseReturn: recovery re-posts
      // journals for already-created documents and must never
      // reprice stock twice.
      await revalueStockReturn(trx, scope.tenantId, requestItem.productId, stockChange.globalAfter, preparedLine.stockDelta, roundBookMoney(preparedLine.qty * originalCost.perSoldUnit, moneyDigits));
      normalizedLines.push({ productId: preparedLine.productId, productName: preparedLine.productName, qty: preparedLine.qty, unitTotal: preparedLine.unitTotal, lineTotal: preparedLine.lineTotal, allocatedTax: preparedLine.allocatedTax, costPrice: originalCost.perSoldUnit, purchaseItemId: purchaseLineId });
    }

    const total = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
    if (!(total > 0)) throw new AppError('مرتجع الشراء يجب أن تكون قيمته موجبة', 'PURCHASE_RETURN_AMOUNT_INVALID', 400);
    const refundMethod = payload.refundMethod === 'card' ? 'card' : 'cash';
    // Supplier payments may have already settled part of an originally credit invoice.
    // Never reverse more payable than both the invoice remainder and supplier balance.
    // Only the excess is a real cash/bank refund, not a negative supplier payable.
    let payableCents = 0;
    if (purchase.payment_type === 'credit' && purchase.supplier_id) {
      const supplier = await trx.selectFrom('suppliers').select(['balance']).where('id', '=', Number(purchase.supplier_id))
        .where(this.tenantPredicate(auth)).forUpdate().executeTakeFirstOrThrow();
      const priorReturns = await trx.selectFrom('return_documents')
        .select(['total', 'refund_allocations'])
        .where('return_type', '=', 'purchase').where('invoice_id', '=', Number(purchase.id))
        .where(this.tenantPredicate(auth)).execute();
      // A previous partial return may have been settled BOTH by reducing the
      // payable and by a bank/cash refund. Only its payable leg reduces the
      // remaining invoice debt; subtracting its entire gross value understates it.
      let priorPayableCents = 0;
      for (const prior of priorReturns) {
        const rawAllocations: unknown = typeof prior.refund_allocations === 'string'
          ? JSON.parse(prior.refund_allocations) : prior.refund_allocations;
        if (Array.isArray(rawAllocations)) {
          for (const allocation of rawAllocations) {
            if (allocation?.tender === 'payable') {
              const cents = Math.round(Number(allocation.amount) * scale);
              if (!Number.isSafeInteger(cents) || cents < 0) {
                throw new AppError('تسوية مرتجع شراء سابقة غير صالحة', 'PURCHASE_RETURN_SETTLEMENT_RECONCILIATION_REQUIRED', 409);
              }
              priorPayableCents += cents;
            }
          }
        } else if (rawAllocations == null) {
          // The legacy credit-return flow reversed the entire document against
          // supplier payables without storing a tender breakdown.
          priorPayableCents += Math.round(Number(prior.total || 0) * scale);
        } else {
          throw new AppError('تسوية مرتجع شراء سابقة غير صالحة', 'PURCHASE_RETURN_SETTLEMENT_RECONCILIATION_REQUIRED', 409);
        }
      }
      const scheduledPayments = await trx.selectFrom('supplier_payment_schedules')
        .select(sql<number>`coalesce(sum(paid_amount), 0)`.as('paid'))
        .where('purchase_id', '=', Number(purchase.id)).where(this.tenantPredicate(auth))
        .executeTakeFirst();
      const scheduledPaidCents = Math.round(Number(scheduledPayments?.paid || 0) * scale);
      const unpaidInvoiceCents = Math.max(0,
        Math.round((Number(purchase.total || 0) - Number(purchase.paid_amount || 0)) * scale) - priorPayableCents - scheduledPaidCents);
      const supplierOutstandingCents = Math.max(0, Math.round(Number(supplier.balance || 0) * scale));
      payableCents = Math.min(Math.round(total * scale), unpaidInvoiceCents, supplierOutstandingCents);
    }
    const refundCents = Math.round(total * scale) - payableCents;
    const allocations: Array<{ tender: 'payable' | 'cash' | 'card'; amount: number }> = [];
    if (payableCents > 0) allocations.push({ tender: 'payable', amount: payableCents / scale });
    if (refundCents > 0) allocations.push({ tender: refundMethod, amount: refundCents / scale });
    // INV-SPIRIT-LARGE-CASH-REFUND: same threshold as sale returns --
    // only a large cash refund from the supplier needs approval.
    if (approvalRequest) {
      const cashRefund = refundMethod === 'cash' ? refundCents / scale : 0;
      if (cashRefund >= approvalRequest.threshold) {
        await this.verifyManagerAuthorization(trx, approvalRequest.secret, auth);
      }
    }
    const { id: returnDocumentId, docNo: returnDocNo } = await this.insertReturnDocument(trx, {
      returnType: 'purchase', invoiceId: Number(payload.invoiceId), settlementMode: 'refund',
      refundMethod: allocations.length > 1 ? 'mixed' : allocations[0].tender,
      refundAllocations: allocations, total, note: String(payload.note || '').trim(),
      branchId: purchase.branch_id, locationId: purchase.location_id,
    }, auth);
    for (const line of normalizedLines) await this.insertReturnItem(trx, { returnDocumentId, productId: line.productId, productName: line.productName, qty: line.qty, unitTotal: line.unitTotal, lineTotal: line.lineTotal, allocatedTax: line.allocatedTax, costPrice: line.costPrice, purchaseItemId: line.purchaseItemId }, auth);
    if (payableCents > 0 && purchase.supplier_id) {
      await this.addSupplierLedgerEntry(trx, Number(purchase.supplier_id), -(payableCents / scale), 'purchase_return', 'purchase return ' + returnDocNo, returnDocumentId, auth, purchase.branch_id, purchase.location_id);
    }
    if (refundCents > 0) await this.addTreasuryTransaction(trx, 'purchase_return_refund', refundCents / scale, 'purchase return ' + returnDocNo, returnDocumentId, auth, purchase.branch_id, purchase.location_id, refundMethod === 'cash');

    try {
      const posting = await this.accountingPosting.postPurchaseReturn(trx, returnDocumentId, auth);
      if (!posting.journalEntryId) throw new Error(`Purchase return ${returnDocumentId} has no journal entry`);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Failed to post accounting journal for purchase return',
        'PURCHASE_RETURN_ACCOUNTING_POST_FAILED',
        500,
      );
    }

    return [returnDocumentId];
  }
}
