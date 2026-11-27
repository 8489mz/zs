/**
 * PurchasesWriteReceiveGoodsService — slice S8 of the purchases-write split.
 * Pure move of the receive-goods method from PurchasesWriteService. No
 * behavior change: the body is byte-identical; the facade keeps a thin
 * delegate with the same name and signature. Deps are db + financeService
 * + accountingPosting. No logger. The explicit transaction form is kept.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { purchaseReceiptBaseUnitCost } from '../engines/purchase-receipt-cost.engine';
import { advancePurchaseOrderReceipt } from '../engines/purchase-order-receipt.engine';
import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { recordStockMovement } from '../../../common/utils/stock-movement-writer';
import { Database } from '../../../database/database.types';
import { calculatePurchaseStockIncrease } from '../helpers/purchases-write.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface PurchasesWriteReceiveGoodsDeps {
  db: Kysely<Database>;
  financeService: PurchasesFinanceService;
  accountingPosting: AccountingPostingService;
}

@Injectable()
export class PurchasesWriteReceiveGoodsService {
  private readonly db: Kysely<Database>;
  private readonly financeService: PurchasesFinanceService;
  private readonly accountingPosting: AccountingPostingService;

  constructor(deps: PurchasesWriteReceiveGoodsDeps) {
    this.db = deps.db;
    this.financeService = deps.financeService;
    this.accountingPosting = deps.accountingPosting;
  }

  async receivePurchaseGoods(
    purchaseId: number,
    receivedItems: { itemId: number; receivedQty: number; serials?: any[] }[],
    auth: AuthContext,
  ): Promise<{ purchaseId: number; lifecycleStatus: string; matchedStatus: string }> {
    const scope = requireTenantScope(auth);

    return this.db.transaction().execute(async (trx) => {
      const purchase = await trx
        .selectFrom('purchases')
        .selectAll()
        .where('id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();

      if (!purchase) {
        throw new AppError('Purchase not found', 'PURCHASE_NOT_FOUND', 404);
      }

      if (purchase.status === 'cancelled') {
        throw new AppError('Cannot receive goods for a cancelled purchase', 'PURCHASE_CANCELLED', 400);
      }
      if (purchase.grn_id || purchase.po_id) {
        if (purchase.po_id) {
          await trx
            .selectFrom('purchase_orders')
            .select('id')
            .where('tenant_id', '=', scope.tenantId)
            .where('id', '=', Number(purchase.po_id))
            .forUpdate()
            .executeTakeFirstOrThrow();
        }
        const postedReceipt = purchase.grn_id
          ? await trx
              .selectFrom('goods_receipt_notes')
              .select(['id', 'status'])
              .where('tenant_id', '=', scope.tenantId)
              .where('id', '=', Number(purchase.grn_id))
              .forUpdate()
              .executeTakeFirst()
          : await trx
              .selectFrom('goods_receipt_notes')
              .select(['id', 'status'])
              .where('tenant_id', '=', scope.tenantId)
              .where('purchase_order_id', '=', Number(purchase.po_id))
              .where('status', '=', 'posted')
              .limit(1)
              .executeTakeFirst();
        if (postedReceipt?.status === 'posted') {
          throw new AppError(
            'The linked GRN already posted stock; receiving this bill would post it twice',
            'PURCHASE_STOCK_ALREADY_RECEIVED',
            409,
          );
        }
      }

      const existingItems = await trx
        .selectFrom('purchase_items')
        .selectAll()
        .where('purchase_id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      const itemsMap = new Map<number, any>();
      for (const it of existingItems) {
        itemsMap.set(Number(it.id), it);
      }

      if (!receivedItems.length)
        throw new AppError('Receipt must contain at least one line', 'PURCHASE_RECEIPT_EMPTY', 400);
      const seenItemIds = new Set<number>();
      let receiptQty = 0;
      for (const rec of receivedItems) {
        const itemId = Number(rec.itemId);
        const item = itemsMap.get(itemId);
        if (!item) throw new AppError(`Purchase item ${itemId} not found`, 'ITEM_NOT_FOUND', 404);
        if (seenItemIds.has(itemId))
          throw new AppError('Duplicate purchase receipt line', 'PURCHASE_RECEIPT_DUPLICATE_LINE', 400);
        seenItemIds.add(itemId);
        const qty = Number(rec.receivedQty);
        const alreadyReceived = Number(item.received_qty || 0);
        const ordered = Number(item.qty || 0);
        if (
          !Number.isFinite(qty) ||
          qty <= 0 ||
          !Number.isFinite(ordered) ||
          alreadyReceived + qty > ordered + 0.0001
        ) {
          throw new AppError(
            'Received quantity must be positive and cannot exceed ordered quantity',
            'PURCHASE_RECEIPT_QTY_INVALID',
            400,
          );
        }
        receiptQty += qty;
      }
      const totalRemaining = existingItems.reduce(
        (sum, item) => sum + Math.max(0, Number(item.qty || 0) - Number(item.received_qty || 0)),
        0,
      );
      if (purchase.status === 'draft' && receiptQty + 0.0001 < totalRemaining) {
        throw new AppError(
          'Partial receipts require a GRN so each stock movement has its own accrual journal',
          'PURCHASE_PARTIAL_RECEIPT_REQUIRES_GRN',
          422,
        );
      }

      await lockStockProducts(trx, {
        ...scope,
        productIds: receivedItems.map((rec) => Number(itemsMap.get(rec.itemId)?.product_id)),
      });

      for (const rec of [...receivedItems].sort(
        (a, b) => Number(itemsMap.get(a.itemId)?.product_id || 0) - Number(itemsMap.get(b.itemId)?.product_id || 0),
      )) {
        const item = itemsMap.get(rec.itemId);
        if (!item) {
          throw new AppError(`Purchase item ${rec.itemId} not found`, 'ITEM_NOT_FOUND', 404);
        }

        const qtyToReceive = Number(rec.receivedQty || 0);
        const currentReceived = Number(item.received_qty || 0);
        const newReceivedQty = currentReceived + qtyToReceive;
        const unitMultiplier = Number(item.unit_multiplier ?? 1);
        const effectiveUnitCost = purchaseReceiptBaseUnitCost(
          Number(item.unit_cost),
          unitMultiplier,
          Number(purchase.tax_rate || 0),
          Boolean(purchase.prices_include_tax),
        );

        await trx
          .updateTable('purchase_items')
          .set({ received_qty: newReceivedQty })
          .where('id', '=', item.id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

        item.received_qty = newReceivedQty;

        const itemSerials = Array.isArray(rec.serials) ? rec.serials : [];
        if (itemSerials.length > 0) {
          const serialRows = itemSerials
            .map((s: any) => {
              const serialNumber = typeof s === 'string' ? s.trim() : (s?.serialNumber || s?.serial || '').trim();
              const imei2 = typeof s === 'object' ? s?.imei2 || null : null;
              return {
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
                product_id: item.product_id,
                serial_number: serialNumber,
                imei_2: imei2,
                branch_id: purchase.branch_id ?? null,
                location_id: item.location_id ?? purchase.location_id,
                status: 'in_stock' as const,
                cost_price: Number(effectiveUnitCost.toFixed(6)),
                purchase_id: purchaseId,
                purchase_item_id: item.id,
                warranty_end_date: null,
                notes: null,
              };
            })
            .filter((r) => r.serial_number);

          if (serialRows.length > 0) {
            await trx.insertInto('product_serials').values(serialRows).execute();
          }
        }

        const { increasedQty } = calculatePurchaseStockIncrease(qtyToReceive, unitMultiplier, 0);
        const itemLocationId = item.location_id ?? purchase.location_id;
        const branchId = purchase.branch_id;

        // Phase 1 A10: the row goes through recordStockMovement
        // (full-precision mode) — the total is computed from the FULL
        // repeating-decimal effective unit (totalUnitCost), not the 6dp
        // stored unit: roundMoney(effectiveUnitCost x increasedQty) books
        // 2.52 where the 6dp unit would book 2.53 (A8 §4). moneyDigits is
        // resolved once here (it was inline in the old total expression).
        // The stored unit stays the 6dp effective unit, exactly as today.
        const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
        const stockChange = await recordStockMovement(trx, {
          productId: Number(item.product_id),
          delta: increasedQty,
          branchId: branchId ? Number(branchId) : undefined,
          locationId: itemLocationId ? Number(itemLocationId) : undefined,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          movementType: 'purchase_receipt',
          unitCost: Number(effectiveUnitCost.toFixed(6)),
          totalUnitCost: effectiveUnitCost,
          moneyDigits,
          referenceType: 'purchase',
          referenceId: purchaseId,
          reason: 'purchase_receipt',
          note: `استلام بضاعة لأمر شراء PUR-${purchaseId}`,
          createdBy: auth.userId,
        });

        // INV-WAC-SINGLE-WRITER: every receipt blends through the one
        // writer (quantity recovery + algebraic blend + write). A
        // zero-quantity line writes nothing: no receipt to blend and
        // the stored cost is unchanged. The product row is locked by
        // the stock delta above, so the writer's read cannot miss it.
        if (increasedQty > 0) {
          await valueStockReceipt(
            trx,
            scope.tenantId,
            item.product_id,
            stockChange.globalAfter,
            increasedQty,
            increasedQty * effectiveUnitCost,
          );
        }
      }

      // INV-PO-RECEIVED-QUANTITY-ADVANCE: reflect this receipt on its
      // purchase order in the same transaction, after every stock write
      // above succeeded, so a failed receipt advances nothing. The advance
      // is in purchase-item units (qtyToReceive), not base stock units:
      // the PO item quantity and the bill item quantity share those units.
      const receivedByPoItem = new Map<number, number>();
      let hasLinkedItem = false;
      for (const rec of receivedItems) {
        const item = itemsMap.get(Number(rec.itemId));
        const poItemId = item?.po_item_id ? Number(item.po_item_id) : 0;
        if (poItemId > 0) {
          hasLinkedItem = true;
          receivedByPoItem.set(
            poItemId,
            Number(((receivedByPoItem.get(poItemId) || 0) + Number(rec.receivedQty || 0)).toFixed(3)),
          );
        }
      }
      if (hasLinkedItem && !purchase.po_id) {
        throw new AppError(
          'بند فاتورة مرتبط بأمر شراء دون ارتباط الفاتورة نفسها بأمر الشراء؛ تعذر تحديث الكمية المستلمة',
          'PO_RECEIPT_LINKAGE_INVALID',
          409,
        );
      }
      if (purchase.po_id && receivedByPoItem.size > 0) {
        await advancePurchaseOrderReceipt(
          trx,
          scope.tenantId,
          Number(purchase.po_id),
          [...receivedByPoItem.entries()].map(([poItemId, quantity]) => ({ poItemId, quantity })),
        );
      }

      let totalOrdered = 0;
      let totalReceived = 0;
      for (const it of existingItems) {
        totalOrdered += Number(it.qty || 0);
        totalReceived += Number(it.received_qty || 0);
      }

      const isFullyReceived = totalReceived >= totalOrdered;
      const lifecycleStatus = isFullyReceived ? 'posted' : 'grn_received';
      const matchedStatus = isFullyReceived ? 'matched' : totalReceived > 0 ? 'partial' : 'pending';

      await trx
        .updateTable('purchases')
        .set({
          lifecycle_status: lifecycleStatus,
          matched_status: matchedStatus,
          status: 'posted',
          updated_at: sql`NOW()`,
        })
        .where('id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      if (purchase.status === 'draft') {
        const total = Number(purchase.total || 0);
        const supplierId = Number(purchase.supplier_id);
        const branchId = purchase.branch_id ? Number(purchase.branch_id) : null;
        const locationId = purchase.location_id ? Number(purchase.location_id) : null;

        if (purchase.payment_type === 'credit') {
          await this.financeService.addSupplierLedgerEntry(
            trx,
            supplierId,
            total,
            'purchase_credit',
            `فاتورة شراء PUR-${purchaseId}`,
            'purchase',
            purchaseId,
            auth,
            branchId,
            locationId,
          );
        } else {
          await this.financeService.addTreasuryTransaction(
            trx,
            'purchase',
            -total,
            `فاتورة شراء PUR-${purchaseId}`,
            'purchase',
            purchaseId,
            auth,
            branchId,
            locationId,
          );
        }

        await this.accountingPosting.postPurchase(trx, purchaseId, auth);
      }

      return { purchaseId, lifecycleStatus, matchedStatus };
    });
  }
}
