import { revalueStockReturn } from '../accounting/inventory-valuation';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney as roundBookMoney } from '../accounting/engines/money-minor-units.engine';
import { Injectable } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { type TenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { ensureReturnQtyWithinLimit } from '../../common/utils/financial-integrity';
import { lockStockProducts, previewConsumableStockQty } from '../../common/utils/location-stock-ledger';
import { recordStockMovement } from '../../common/utils/stock-movement-writer';
import {
  buildPurchaseReturnLine,
  calculateReturnDocumentTotal,
  originalPurchaseReturnUnitCost,
} from './helpers/returns-write.helper';
import { Database } from '../../database/database.types';
import { CreateReturnDto } from './dto/create-return.dto';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { selectPurchaseReturnSerials, selectPurchaseReturnBatch } from './helpers/purchase-return-traceability.helper';
import { type ReturnInputItem, type ReturnDocumentInput } from './returns.types';

/**
 * ReturnsPurchaseReturnService — slice S6 of the returns split.
 * Pure move of the purchase-return writer from ReturnsService. No behavior
 * change: the body is byte-identical except for the forced visibility
 * change below; the facade keeps a thin private delegate with the same
 * name and signature. This slice reaches the kernel helpers, the relief
 * helper, the write helpers and the posting service only through bound
 * deps — it never imports another slice service. The writer is public
 * here (private in the facade) — the facade, a different class, cannot
 * call a private slice method (tsc TS2341); the facade delegate stays
 * private, so the facade public surface is unchanged.
 */

export interface ReturnsPurchaseReturnDeps {
  accountingPosting: AccountingPostingService;
  scope: (auth: AuthContext) => TenantScope;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  tenantFields: (auth: AuthContext) => { tenant_id: string; account_id: string };
  verifyManagerAuthorization: (trx: Kysely<Database>, secret: string, auth: AuthContext) => Promise<string>;
  insertReturnDocument: (
    trx: Kysely<Database>,
    row: ReturnDocumentInput,
    auth: AuthContext,
  ) => Promise<{ id: number; docNo: string }>;
  insertReturnItem: (
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
  ) => Promise<void>;
  addSupplierLedgerEntry: (
    trx: Kysely<Database>,
    supplierId: number,
    amount: number,
    entryType: string,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
  ) => Promise<void>;
  addTreasuryTransaction: (
    trx: Kysely<Database>,
    txnType: string,
    amount: number,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
    cashRefund?: boolean,
  ) => Promise<void>;
}

@Injectable()
export class ReturnsPurchaseReturnService {
  private readonly accountingPosting: AccountingPostingService;
  private readonly scope: (auth: AuthContext) => TenantScope;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly tenantFields: (auth: AuthContext) => { tenant_id: string; account_id: string };
  private readonly verifyManagerAuthorization: (
    trx: Kysely<Database>,
    secret: string,
    auth: AuthContext,
  ) => Promise<string>;
  private readonly insertReturnDocument: (
    trx: Kysely<Database>,
    row: ReturnDocumentInput,
    auth: AuthContext,
  ) => Promise<{ id: number; docNo: string }>;
  private readonly insertReturnItem: (
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
  ) => Promise<void>;
  private readonly addSupplierLedgerEntry: (
    trx: Kysely<Database>,
    supplierId: number,
    amount: number,
    entryType: string,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
  ) => Promise<void>;
  private readonly addTreasuryTransaction: (
    trx: Kysely<Database>,
    txnType: string,
    amount: number,
    note: string,
    returnDocumentId: number,
    auth: AuthContext,
    branchId: number | null,
    locationId: number | null,
    cashRefund?: boolean,
  ) => Promise<void>;

  constructor(deps: ReturnsPurchaseReturnDeps) {
    this.accountingPosting = deps.accountingPosting;
    this.scope = deps.scope;
    this.tenantPredicate = deps.tenantPredicate;
    this.tenantFields = deps.tenantFields;
    this.verifyManagerAuthorization = deps.verifyManagerAuthorization;
    this.insertReturnDocument = deps.insertReturnDocument;
    this.insertReturnItem = deps.insertReturnItem;
    this.addSupplierLedgerEntry = deps.addSupplierLedgerEntry;
    this.addTreasuryTransaction = deps.addTreasuryTransaction;
  }

  async createPurchaseReturn(
    trx: Transaction<Database>,
    payload: CreateReturnDto,
    items: ReturnInputItem[],
    auth: AuthContext,
    approvalRequest?: { secret: string; threshold: number },
  ): Promise<number[]> {
    const scope = this.scope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
    const purchase = await trx
      .selectFrom('purchases')
      .selectAll()
      .where('id', '=', Number(payload.invoiceId))
      .where('status', '=', 'posted')
      .where(this.tenantPredicate(auth))
      .forUpdate()
      .executeTakeFirst();
    if (!purchase) throw new AppError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
    await lockStockProducts(trx, { ...scope, productIds: items.map((item) => item.productId) });
    const purchaseItems = await trx
      .selectFrom('purchase_items')
      .selectAll()
      .where('purchase_id', '=', Number(payload.invoiceId))
      .where(this.tenantPredicate(auth))
      .orderBy('id', 'asc')
      .forUpdate()
      .execute();
    const normalizedLines: Array<{
      productId: number;
      productName: string;
      qty: number;
      unitTotal: number;
      lineTotal: number;
      allocatedTax: number;
      costPrice: number;
      saleItemId?: number;
      purchaseItemId?: number;
    }> = [];

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
      const cents = last
        ? originalTaxCents - allocatedTaxCents
        : Math.min(
            originalTaxCents - allocatedTaxCents,
            Math.round((originalTaxCents * Number(line.line_total || 0)) / netLinesTotal),
          );
      allocatedTaxCents += cents;
      taxByLine.set(Number(line.id), cents / scale);
    }

    const pendingQtyByProduct = new Map<number, number>();
    const pendingQtyByLine = new Map<number, number>();

    const returnedRows = await trx
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) =>
        join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'),
      )
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
        throw new AppError(
          'مرتجع شراء سابق يحتاج تسوية ضريبية قبل مرتجع جديد',
          'PURCHASE_RETURN_TAX_RECONCILIATION_REQUIRED',
          409,
        );
      }
      if (legacyReturnedProducts.has(requestItem.productId)) {
        throw new AppError(
          'مرتجع شراء سابق بلا ربط بسطر الفاتورة يحتاج تسوية أولاً',
          'PURCHASE_RETURN_LEGACY_RECONCILIATION_REQUIRED',
          409,
        );
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
      pendingQtyByProduct.set(
        requestItem.productId,
        (pendingQtyByProduct.get(requestItem.productId) || 0) + requestItem.qty,
      );
      pendingQtyByLine.set(purchaseLineId, (pendingQtyByLine.get(purchaseLineId) || 0) + requestItem.qty);

      const availableQty = await previewConsumableStockQty(trx, {
        productId: requestItem.productId,
        branchId: purchase.branch_id,
        locationId: purchaseItem.location_id ?? purchase.location_id,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
      });
      const product = await trx
        .selectFrom('products')
        .select(['id', 'stock_qty', 'track_serials', 'cost_price'])
        .where('id', '=', requestItem.productId)
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();
      if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const sourceTax = taxByLine.get(purchaseLineId) || 0;
      const sourceGross = Number(purchaseItem.line_total || 0) + (purchase.prices_include_tax ? 0 : sourceTax);
      const preparedLine = buildPurchaseReturnLine(
        { ...purchaseItem, line_total: sourceGross, allocated_tax: sourceTax },
        { ...product, stock_qty: availableQty },
        requestItem,
        {
          qty: returnedQtyByLine.get(purchaseLineId) || 0,
          amount: returnedAmountByLine.get(purchaseLineId) || 0,
          tax: returnedTaxByLine.get(purchaseLineId) || 0,
        },
        moneyDigits,
      );

      // The serial ledger and general stock ledger must leave the warehouse together.
      const itemLocationId = purchaseItem.location_id ?? purchase.location_id;
      // A purchased serial moved to another warehouse is no longer returnable
      // from this line's source location, even if its status is still in_stock.
      let serialQuery = trx
        .selectFrom('product_serials')
        .select(['id', 'serial_number', 'imei_2', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', requestItem.productId)
        .where('purchase_id', '=', Number(purchase.id))
        .where('purchase_item_id', '=', purchaseLineId)
        .where('status', '=', 'in_stock');
      serialQuery =
        itemLocationId == null
          ? serialQuery.where('location_id', 'is', null)
          : serialQuery.where('location_id', '=', itemLocationId);
      serialQuery =
        purchase.branch_id == null
          ? serialQuery.where('branch_id', 'is', null)
          : serialQuery.where('branch_id', '=', purchase.branch_id);
      const purchaseSerials = await serialQuery.orderBy('id', 'asc').forUpdate().execute();
      // Legacy products may have existing serial rows without track_serials set.
      // Do not silently treat their remaining stock as untracked.
      const anySerial = await trx
        .selectFrom('product_serials')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', requestItem.productId)
        .limit(1)
        .executeTakeFirst();
      if (product.track_serials === true || anySerial) {
        const chosen = selectPurchaseReturnSerials(purchaseSerials, requestItem.serials, preparedLine.stockDelta);
        await trx
          .updateTable('product_serials')
          .set({ status: 'returned', updated_at: sql`NOW()` })
          .where('tenant_id', '=', scope.tenantId)
          .where(
            'id',
            'in',
            chosen.map((row) => row.id),
          )
          .execute();
      } else if (requestItem.serials?.length) {
        throw new AppError('لا توجد سيريالات مرتبطة بسطر فاتورة الشراء', 'PURCHASE_RETURN_SERIAL_NOT_AVAILABLE', 400);
      }

      // Drug lots are a separate quantity ledger. Never deduct product stock without
      // deducting the corresponding unexpired/held lot from the same location.
      const drug = await trx
        .selectFrom('pharmacy_drugs')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', requestItem.productId)
        .executeTakeFirst();
      const anyBatch = await trx
        .selectFrom('pharmacy_batches')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', requestItem.productId)
        .limit(1)
        .executeTakeFirst();
      if (drug || anyBatch) {
        const sourceBatchNumber = String(purchaseItem.batch_number || '').trim();
        if (!sourceBatchNumber) {
          throw new AppError(
            'تشغيلة بند الشراء غير محفوظة؛ لا يمكن إرجاع كمية دوائية دون مصالحة',
            'PURCHASE_RETURN_BATCH_PROVENANCE_REQUIRED',
            409,
          );
        }
        let batchQuery = trx
          .selectFrom('pharmacy_batches')
          .select(['id', 'quantity', 'batch_number'])
          .where('tenant_id', '=', scope.tenantId)
          .where('product_id', '=', requestItem.productId);
        batchQuery =
          itemLocationId == null
            ? batchQuery.where('location_id', 'is', null)
            : batchQuery.where('location_id', '=', itemLocationId);
        const batches = await batchQuery.orderBy('id', 'asc').forUpdate().execute();
        const batch = selectPurchaseReturnBatch(batches, requestItem.batchId, preparedLine.stockDelta);
        if (String(batch.batch_number || '').trim() !== sourceBatchNumber) {
          throw new AppError(
            'تشغيلة المرتجع لا تطابق تشغيلة فاتورة الشراء الأصلية',
            'PURCHASE_RETURN_BATCH_ORIGIN_MISMATCH',
            409,
          );
        }
        await trx
          .updateTable('pharmacy_batches')
          .set({
            quantity: Number((Number(batch.quantity) - preparedLine.stockDelta).toFixed(3)),
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', batch.id)
          .execute();
      } else if (requestItem.batchId) {
        throw new AppError('الصنف ليس دواءً مسجلاً بتشغيلة', 'PURCHASE_RETURN_BATCH_NOT_APPLICABLE', 400);
      }

      // Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the original-cost
      // computation does not depend on the ledger result, so it moves
      // BEFORE the writer call (the writer needs unitCost upfront);
      // revalueStockReturn below then uses the returned globalAfter.
      // The writer's total is roundMoney(stockDelta * perBaseUnit,
      // moneyDigits) — the same roundBookMoney expression (an alias
      // for roundMoney) the old row used.
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
      const movement = await recordStockMovement(trx, {
        productId: requestItem.productId,
        delta: -preparedLine.stockDelta,
        branchId: purchase.branch_id,
        locationId: itemLocationId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        errorCode: 'PURCHASE_RETURN_STOCK_INVALID',
        errorMessage: 'Invalid stock for purchase return',
        disableAutoDrain: true,
        movementType: 'purchase_return',
        referenceType: 'purchase_return',
        referenceId: Number(payload.invoiceId),
        reason: 'purchase_return',
        note: 'purchase return PUR-' + String(purchase.id),
        unitCost: originalCost.perBaseUnit,
        moneyDigits,
        createdBy: auth.userId,
      });
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
      await revalueStockReturn(
        trx,
        scope.tenantId,
        requestItem.productId,
        movement.globalAfter,
        preparedLine.stockDelta,
        roundBookMoney(preparedLine.qty * originalCost.perSoldUnit, moneyDigits),
      );
      normalizedLines.push({
        productId: preparedLine.productId,
        productName: preparedLine.productName,
        qty: preparedLine.qty,
        unitTotal: preparedLine.unitTotal,
        lineTotal: preparedLine.lineTotal,
        allocatedTax: preparedLine.allocatedTax,
        costPrice: originalCost.perSoldUnit,
        purchaseItemId: purchaseLineId,
      });
    }

    const total = calculateReturnDocumentTotal(normalizedLines, moneyDigits);
    if (!(total > 0)) throw new AppError('مرتجع الشراء يجب أن تكون قيمته موجبة', 'PURCHASE_RETURN_AMOUNT_INVALID', 400);
    const refundMethod = payload.refundMethod === 'card' ? 'card' : 'cash';
    // Supplier payments may have already settled part of an originally credit invoice.
    // Never reverse more payable than both the invoice remainder and supplier balance.
    // Only the excess is a real cash/bank refund, not a negative supplier payable.
    let payableCents = 0;
    if (purchase.payment_type === 'credit' && purchase.supplier_id) {
      const supplier = await trx
        .selectFrom('suppliers')
        .select(['balance'])
        .where('id', '=', Number(purchase.supplier_id))
        .where(this.tenantPredicate(auth))
        .forUpdate()
        .executeTakeFirstOrThrow();
      const priorReturns = await trx
        .selectFrom('return_documents')
        .select(['total', 'refund_allocations'])
        .where('return_type', '=', 'purchase')
        .where('invoice_id', '=', Number(purchase.id))
        .where(this.tenantPredicate(auth))
        .execute();
      // A previous partial return may have been settled BOTH by reducing the
      // payable and by a bank/cash refund. Only its payable leg reduces the
      // remaining invoice debt; subtracting its entire gross value understates it.
      let priorPayableCents = 0;
      for (const prior of priorReturns) {
        const rawAllocations: unknown =
          typeof prior.refund_allocations === 'string'
            ? JSON.parse(prior.refund_allocations)
            : prior.refund_allocations;
        if (Array.isArray(rawAllocations)) {
          for (const allocation of rawAllocations) {
            if (allocation?.tender === 'payable') {
              const cents = Math.round(Number(allocation.amount) * scale);
              if (!Number.isSafeInteger(cents) || cents < 0) {
                throw new AppError(
                  'تسوية مرتجع شراء سابقة غير صالحة',
                  'PURCHASE_RETURN_SETTLEMENT_RECONCILIATION_REQUIRED',
                  409,
                );
              }
              priorPayableCents += cents;
            }
          }
        } else if (rawAllocations == null) {
          // The legacy credit-return flow reversed the entire document against
          // supplier payables without storing a tender breakdown.
          priorPayableCents += Math.round(Number(prior.total || 0) * scale);
        } else {
          throw new AppError(
            'تسوية مرتجع شراء سابقة غير صالحة',
            'PURCHASE_RETURN_SETTLEMENT_RECONCILIATION_REQUIRED',
            409,
          );
        }
      }
      const scheduledPayments = await trx
        .selectFrom('supplier_payment_schedules')
        .select(sql<number>`coalesce(sum(paid_amount), 0)`.as('paid'))
        .where('purchase_id', '=', Number(purchase.id))
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();
      const scheduledPaidCents = Math.round(Number(scheduledPayments?.paid || 0) * scale);
      const unpaidInvoiceCents = Math.max(
        0,
        Math.round((Number(purchase.total || 0) - Number(purchase.paid_amount || 0)) * scale) -
          priorPayableCents -
          scheduledPaidCents,
      );
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
    const { id: returnDocumentId, docNo: returnDocNo } = await this.insertReturnDocument(
      trx,
      {
        returnType: 'purchase',
        invoiceId: Number(payload.invoiceId),
        settlementMode: 'refund',
        refundMethod: allocations.length > 1 ? 'mixed' : allocations[0].tender,
        refundAllocations: allocations,
        total,
        note: String(payload.note || '').trim(),
        branchId: purchase.branch_id,
        locationId: purchase.location_id,
      },
      auth,
    );
    for (const line of normalizedLines)
      await this.insertReturnItem(
        trx,
        {
          returnDocumentId,
          productId: line.productId,
          productName: line.productName,
          qty: line.qty,
          unitTotal: line.unitTotal,
          lineTotal: line.lineTotal,
          allocatedTax: line.allocatedTax,
          costPrice: line.costPrice,
          purchaseItemId: line.purchaseItemId,
        },
        auth,
      );
    if (payableCents > 0 && purchase.supplier_id) {
      await this.addSupplierLedgerEntry(
        trx,
        Number(purchase.supplier_id),
        -(payableCents / scale),
        'purchase_return',
        'purchase return ' + returnDocNo,
        returnDocumentId,
        auth,
        purchase.branch_id,
        purchase.location_id,
      );
    }
    if (refundCents > 0)
      await this.addTreasuryTransaction(
        trx,
        'purchase_return_refund',
        refundCents / scale,
        'purchase return ' + returnDocNo,
        returnDocumentId,
        auth,
        purchase.branch_id,
        purchase.location_id,
        refundMethod === 'cash',
      );

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
