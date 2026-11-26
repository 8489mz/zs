import { valueStockReceipt } from '../accounting/inventory-valuation';
import { hasUnpaidExchangeBalance } from './engines/exchange-store-credit.engine';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney as roundBookMoney } from '../accounting/engines/money-minor-units.engine';
import { Injectable } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { type TenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { ensureReturnQtyWithinLimit } from '../../common/utils/financial-integrity';
import { lockStockProducts } from '../../common/utils/location-stock-ledger';
import { recordStockMovement } from '../../common/utils/stock-movement-writer';
import { buildSaleReturnLine, calculateReturnDocumentTotal } from './helpers/returns-write.helper';
import { Database } from '../../database/database.types';
import { CreateReturnDto } from './dto/create-return.dto';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { allocateRefundTenders, type RefundTender } from './engines/refund-tender.engine';
import { type ConditionalDiscountForfeitResult } from './engines/conditional-header-discount-return.engine';
import { allocateInvoiceDiscount } from '../sales/engines/invoice-discount.engine';
import { restoreImportLotsFromSalesReturn } from '../import-sales/helpers/import-lot-allocation.helper';
import { type ReturnInputItem, type ExchangeReturnContext, type ReturnDocumentInput } from './returns.types';

/**
 * ReturnsSaleReturnService — slice S5 of the returns split.
 * Pure move of the sale-return writer from ReturnsService. No behavior
 * change: the body is byte-identical except for the forced visibility
 * change below; the facade keeps a thin private delegate with the same
 * name and signature. This slice reaches the kernel helpers, the relief
 * helpers, the write helpers and the posting service only through bound
 * deps — it never imports another slice service. The writer is public
 * here (private in the facade) — the facade, a different class, cannot
 * call a private slice method (tsc TS2341); the facade delegate stays
 * private, so the facade public surface is unchanged.
 */

export interface ReturnsSaleReturnDeps {
  accountingPosting: AccountingPostingService;
  scope: (auth: AuthContext) => TenantScope;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  tenantFields: (auth: AuthContext) => { tenant_id: string; account_id: string };
  computeForfeitForReturn: (args: { sale: { discount: number | string | null; total: number | string | null; tax_amount: number | string | null; prices_include_tax: boolean | null }; saleItems: Array<{ id: number | string; qty: number | string | null; unit_price: number | string | null; line_total: number | string | null; line_discount?: number | string | null; net_line_total?: number | string | null; allocated_discount?: number | string | null; allocated_tax?: number | string | null }>; returnedQtyByLine: Map<number, number>; returnedAmountByLine: Map<number, number>; items: ReturnInputItem[]; moneyDigits: 2 | 3; requestedGoodsRefund?: number; }) => ConditionalDiscountForfeitResult;
  applyRaisedGoodsTotal: (lines: Array<{ qty: number; unitTotal: number; lineTotal: number; allocatedTax: number }>, proRataTotal: number, requested: number, cap: number, moneyDigits: 2 | 3) => number;
  verifyManagerAuthorization: (trx: Kysely<Database>, secret: string, auth: AuthContext) => Promise<string>;
  restoreReturnedPharmacyBatches: (trx: Kysely<Database>, saleId: number, saleItemId: number, productId: number, previousReturnedBaseQty: number, returnBaseQty: number, auth: AuthContext) => Promise<void>;
  restoreReturnedInventoryBatches: (trx: Kysely<Database>, saleId: number, saleItemId: number, productId: number, previousReturnedBaseQty: number, returnBaseQty: number, auth: AuthContext) => Promise<void>;
  insertReturnDocument: (trx: Kysely<Database>, row: ReturnDocumentInput, auth: AuthContext) => Promise<{ id: number; docNo: string }>;
  insertReturnItem: (trx: Kysely<Database>, row: { returnDocumentId: number; productId: number | null; productName: string; qty: number; unitTotal: number; lineTotal: number; allocatedTax?: number | null; costPrice?: number | null; saleItemId?: number; purchaseItemId?: number }, auth: AuthContext) => Promise<void>;
  addStoreCredit: (trx: Kysely<Database>, customerId: number, amount: number, auth: AuthContext) => Promise<void>;
  addCustomerLedgerEntry: (trx: Kysely<Database>, customerId: number, amount: number, entryType: string, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null) => Promise<void>;
  addTreasuryTransaction: (trx: Kysely<Database>, txnType: string, amount: number, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null, cashRefund?: boolean) => Promise<void>;
}

@Injectable()
export class ReturnsSaleReturnService {
  private readonly accountingPosting: AccountingPostingService;
  private readonly scope: (auth: AuthContext) => TenantScope;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly tenantFields: (auth: AuthContext) => { tenant_id: string; account_id: string };
  private readonly computeForfeitForReturn: (args: { sale: { discount: number | string | null; total: number | string | null; tax_amount: number | string | null; prices_include_tax: boolean | null }; saleItems: Array<{ id: number | string; qty: number | string | null; unit_price: number | string | null; line_total: number | string | null; line_discount?: number | string | null; net_line_total?: number | string | null; allocated_discount?: number | string | null; allocated_tax?: number | string | null }>; returnedQtyByLine: Map<number, number>; returnedAmountByLine: Map<number, number>; items: ReturnInputItem[]; moneyDigits: 2 | 3; requestedGoodsRefund?: number; }) => ConditionalDiscountForfeitResult;
  private readonly applyRaisedGoodsTotal: (lines: Array<{ qty: number; unitTotal: number; lineTotal: number; allocatedTax: number }>, proRataTotal: number, requested: number, cap: number, moneyDigits: 2 | 3) => number;
  private readonly verifyManagerAuthorization: (trx: Kysely<Database>, secret: string, auth: AuthContext) => Promise<string>;
  private readonly restoreReturnedPharmacyBatches: (trx: Kysely<Database>, saleId: number, saleItemId: number, productId: number, previousReturnedBaseQty: number, returnBaseQty: number, auth: AuthContext) => Promise<void>;
  private readonly restoreReturnedInventoryBatches: (trx: Kysely<Database>, saleId: number, saleItemId: number, productId: number, previousReturnedBaseQty: number, returnBaseQty: number, auth: AuthContext) => Promise<void>;
  private readonly insertReturnDocument: (trx: Kysely<Database>, row: ReturnDocumentInput, auth: AuthContext) => Promise<{ id: number; docNo: string }>;
  private readonly insertReturnItem: (trx: Kysely<Database>, row: { returnDocumentId: number; productId: number | null; productName: string; qty: number; unitTotal: number; lineTotal: number; allocatedTax?: number | null; costPrice?: number | null; saleItemId?: number; purchaseItemId?: number }, auth: AuthContext) => Promise<void>;
  private readonly addStoreCredit: (trx: Kysely<Database>, customerId: number, amount: number, auth: AuthContext) => Promise<void>;
  private readonly addCustomerLedgerEntry: (trx: Kysely<Database>, customerId: number, amount: number, entryType: string, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null) => Promise<void>;
  private readonly addTreasuryTransaction: (trx: Kysely<Database>, txnType: string, amount: number, note: string, returnDocumentId: number, auth: AuthContext, branchId: number | null, locationId: number | null, cashRefund?: boolean) => Promise<void>;

  constructor(deps: ReturnsSaleReturnDeps) {
    this.accountingPosting = deps.accountingPosting;
    this.scope = deps.scope;
    this.tenantPredicate = deps.tenantPredicate;
    this.tenantFields = deps.tenantFields;
    this.computeForfeitForReturn = deps.computeForfeitForReturn;
    this.applyRaisedGoodsTotal = deps.applyRaisedGoodsTotal;
    this.verifyManagerAuthorization = deps.verifyManagerAuthorization;
    this.restoreReturnedPharmacyBatches = deps.restoreReturnedPharmacyBatches;
    this.restoreReturnedInventoryBatches = deps.restoreReturnedInventoryBatches;
    this.insertReturnDocument = deps.insertReturnDocument;
    this.insertReturnItem = deps.insertReturnItem;
    this.addStoreCredit = deps.addStoreCredit;
    this.addCustomerLedgerEntry = deps.addCustomerLedgerEntry;
    this.addTreasuryTransaction = deps.addTreasuryTransaction;
  }

  async createSaleReturn(trx: Transaction<Database>, payload: CreateReturnDto, items: ReturnInputItem[], auth: AuthContext, approvedByName?: string,
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

               // Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the alloc
               // leg goes through the row-writer first, then
               // valueStockReceipt uses the returned globalAfter — same
               // transaction, so a throw still rolls the row back. The
               // writer's total is roundMoney(returnedUnitCost *
               // returnToThis, moneyDigits), the same roundBookMoney
               // expression (an alias for roundMoney) the old row used.
               const movement = await recordStockMovement(trx, { productId: requestItem.productId, delta: returnToThis, branchId: branchId, locationId: alloc.location_id, tenantId: scope.tenantId, accountId: scope.accountId, allowNegative: true, disableAutoDrain: true, movementType: 'sale_return', referenceType: 'sale_return', referenceId: Number(payload.invoiceId), reason: 'sale_return', note: 'sale return S-' + String(sale.id), unitCost: returnedUnitCost, moneyDigits, createdBy: auth.userId });
               await valueStockReceipt(trx, scope.tenantId, requestItem.productId, movement.globalAfter, returnToThis, returnedUnitCost * returnToThis);
            }
         }

         // Once original location allocations exist, a missing allocation is a
         // damaged audit trail. Never silently return goods to a default warehouse;
         // a partial refund must not create stock in the wrong location.
         if (remainingToReturn > 0.0001) {
           throw new AppError('توزيع مخزون البيع الأصلي غير مكتمل؛ يلزم تسوية المخزن قبل المرتجع', 'SALE_RETURN_STOCK_ALLOCATION_RECONCILIATION_REQUIRED', 409);
         }
      } else {
         // Phase 1 A9: same writer routing as the alloc leg above
         // (writer first, then valueStockReceipt on the returned
         // globalAfter).
         const movement = await recordStockMovement(trx, { productId: requestItem.productId, delta: preparedLine.stockDelta, branchId: sale.branch_id, locationId: sale.location_id, tenantId: scope.tenantId, accountId: scope.accountId, allowNegative: true, disableAutoDrain: true, movementType: 'sale_return', referenceType: 'sale_return', referenceId: Number(payload.invoiceId), reason: 'sale_return', note: 'sale return S-' + String(sale.id), unitCost: returnedUnitCost, moneyDigits, createdBy: auth.userId });
         await valueStockReceipt(trx, scope.tenantId, requestItem.productId, movement.globalAfter, preparedLine.stockDelta, returnedUnitCost * preparedLine.stockDelta);
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
}
