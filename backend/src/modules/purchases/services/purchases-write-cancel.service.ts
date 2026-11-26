/**
 * PurchasesWriteCancelService — slice S5 of the purchases-write split.
 * Pure move of the cancel method from PurchasesWriteService. No behavior change:
 * the body is byte-identical; the facade keeps a thin delegate with the same
 * name and signature. Deps are db + tx + audit + financeService +
 * accountingPosting, plus the two shared-helper delegates bound from the
 * facade. No logger.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { AuditService } from '../../../core/audit/audit.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { reversePurchaseTrackedStock } from '../helpers/purchase-cancellation-trace.helper';
import { buildPurchaseReferenceNote, calculatePurchaseStockDecrease } from '../helpers/purchases-write.helper';
import { purchaseReceiptBaseUnitCost } from '../engines/purchase-receipt-cost.engine';
import { revalueStockReturn } from '../../accounting/inventory-valuation';
import { lockStockProducts, previewConsumableStockQty } from '../../../common/utils/location-stock-ledger';
import { recordStockMovement } from '../../../common/utils/stock-movement-writer';
import { ensureNonNegativeStock } from '../../../common/utils/financial-integrity';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export interface PurchasesWriteCancelDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  financeService: PurchasesFinanceService;
  accountingPosting: AccountingPostingService;
  assertManagerApprovalForPurchaseChange: (secret: string, auth: AuthContext) => Promise<void>;
  buildPurchaseMutationResponse: (
    purchaseId: number,
    auth: AuthContext,
    extras?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}

@Injectable()
export class PurchasesWriteCancelService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly financeService: PurchasesFinanceService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly assertManagerApprovalForPurchaseChange: (secret: string, auth: AuthContext) => Promise<void>;
  private readonly buildPurchaseMutationResponse: (
    purchaseId: number,
    auth: AuthContext,
    extras?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;

  constructor(deps: PurchasesWriteCancelDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.financeService = deps.financeService;
    this.accountingPosting = deps.accountingPosting;
    this.assertManagerApprovalForPurchaseChange = deps.assertManagerApprovalForPurchaseChange;
    this.buildPurchaseMutationResponse = deps.buildPurchaseMutationResponse;
  }

  async cancelPurchase(
    purchaseId: number,
    reason: string,
    auth: AuthContext,
    managerPin?: string,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    await this.assertManagerApprovalForPurchaseChange(String(managerPin || '').trim(), auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      const purchase = await trx
        .selectFrom('purchases')
        .selectAll()
        .where('id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!purchase) throw new AppError('Purchase not found', 'PURCHASE_NOT_FOUND', 404);
      if (purchase.status === 'cancelled')
        throw new AppError('Purchase already cancelled', 'PURCHASE_ALREADY_CANCELLED', 400);
      if (purchase.lifecycle_status === 'purchase_order' || purchase.status === 'draft') {
        // No stock/treasury/journal was posted by an unreceived draft: only cancel the document.
        await trx
          .updateTable('purchases')
          .set({
            status: 'cancelled',
            cancel_reason: String(reason || '').trim(),
            cancelled_by: auth.userId,
            cancelled_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', purchaseId)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
        return;
      }
      if (purchase.lifecycle_status === 'grn_bill')
        throw new AppError(
          'لا يمكن إلغاء فاتورة GRN بعد تسوية الاستحقاق؛ يلزم إشعار دائن محاسبي',
          'GRNI_BILL_IMMUTABLE',
          422,
        );

      // Cancellation reverses the *entire* invoice. Once its cost is capitalised,
      // some debt is settled, or any line has been returned, that reversal would
      // double-reverse stock or supplier balances. Require adjustment documents.
      const existingReturn = await trx
        .selectFrom('return_documents')
        .select('id')
        .where('return_type', '=', 'purchase')
        .where('invoice_id', '=', purchaseId)
        .where('tenant_id', '=', scope.tenantId)
        .limit(1)
        .executeTakeFirst();
      if (existingReturn)
        throw new AppError(
          'لا يمكن إلغاء فاتورة مشتريات لها مرتجعات؛ استخدم تسوية محاسبية',
          'PURCHASE_CANCEL_HAS_RETURNS',
          422,
        );
      if (purchase.landed_cost_applied_at || Number(purchase.landed_cost_total || 0) > 0) {
        throw new AppError(
          'لا يمكن إلغاء فاتورة مشتريات عليها مصاريف شراء محملة؛ يلزم مستند تصحيح',
          'PURCHASE_CANCEL_HAS_LANDED_COST',
          422,
        );
      }
      if (purchase.payment_type === 'credit' && Number(purchase.paid_amount || 0) > 0.001) {
        throw new AppError(
          'لا يمكن إلغاء فاتورة مشتريات آجل مسددة جزئياً أو كلياً؛ يلزم مستند تصحيح',
          'PURCHASE_CANCEL_PARTIALLY_PAID',
          422,
        );
      }
      const scheduledSettlements = await trx
        .selectFrom('supplier_payment_schedules')
        .select([
          sql<number>`coalesce(sum(paid_amount), 0)`.as('paid'),
          sql<number>`count(*) filter (where status <> 'cancelled')`.as('active_count'),
        ])
        .where('purchase_id', '=', purchaseId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (Number(scheduledSettlements?.paid || 0) > 0.001) {
        throw new AppError(
          'فاتورة الشراء عليها أقساط مورد مسددة؛ لا يمكن عكسها بإلغاء مباشر',
          'PURCHASE_CANCEL_SCHEDULE_HAS_PAYMENTS',
          422,
        );
      }
      // Unpaid installment schedules are commitments, not financial entries.
      // Retire them atomically with the purchase to avoid ghost due payments.
      if (Number(scheduledSettlements?.active_count || 0) > 0) {
        await trx
          .updateTable('supplier_payment_schedules')
          .set({ status: 'cancelled', updated_by: auth.userId, updated_at: sql`NOW()` })
          .where('purchase_id', '=', purchaseId)
          .where('tenant_id', '=', scope.tenantId)
          .where('status', '!=', 'cancelled')
          .execute();
      }

      // Book digits for the WAC removal value below, resolved once on the
      // transaction handle like every other purchase posting path.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const items = await trx
        .selectFrom('purchase_items')
        .selectAll()
        .where('purchase_id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      // INV-SERVICE-ITEM-QUICK-CREATE: service lines never posted stock, so
      // a cancel has nothing to reverse for them.
      const cancelServiceProductIds = new Set<number>();
      const cancelLookupIds = items.map((item) => Number(item.product_id)).filter((id) => id > 0);
      if (cancelLookupIds.length) {
        const cancelProducts = await trx
          .selectFrom('products')
          .select(['id', 'item_type'])
          .where('id', 'in', cancelLookupIds)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
        for (const row of cancelProducts) if (row.item_type === 'service') cancelServiceProductIds.add(Number(row.id));
      }
      await lockStockProducts(trx, { ...scope, productIds: items.map((item) => Number(item.product_id)) });
      for (const item of [...items].sort((a, b) => Number(a.product_id || 0) - Number(b.product_id || 0))) {
        if (!item.product_id) continue;
        if (cancelServiceProductIds.has(Number(item.product_id))) continue;
        // Traceable intake must be reversed with the stock movement and journal.
        const itemLocationId = item.location_id ?? purchase.location_id;
        const availableQty = await previewConsumableStockQty(trx, {
          productId: Number(item.product_id),
          branchId: purchase.branch_id,
          locationId: itemLocationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
        });
        const {
          removedQty: removeQty,
          beforeQty,
          afterQty,
        } = calculatePurchaseStockDecrease(item.qty, item.unit_multiplier, availableQty);
        if (beforeQty < removeQty)
          throw new AppError(
            `Cannot cancel purchase because stock would go negative for product #${item.product_id}`,
            'PURCHASE_CANCEL_STOCK_INVALID',
            400,
          );
        ensureNonNegativeStock(
          afterQty,
          'PURCHASE_EDIT_STOCK_INVALID',
          `Cannot edit purchase because stock would go negative for product #${item.product_id}`,
        );
        await reversePurchaseTrackedStock(trx, scope, {
          productId: Number(item.product_id),
          purchaseId,
          purchaseItemId: Number(item.id),
          locationId: itemLocationId,
          branchId: purchase.branch_id,
          quantity: removeQty,
          batchNumber: item.batch_number,
        });
        // Phase 1 A8: the cancel row goes through the single writer
        // (INV-PHASE1-A8-PURCHASES-MANUFACTURING-WRITER). The old row
        // carried NO unit_cost/total_cost at all, so the writer stores
        // the A6/A7 0/0 shape; the WAC revalue below still reads the
        // returned globalAfter, exactly as before. disableAutoDrain
        // passes through untouched.
        const stockChange = await recordStockMovement(trx, {
          productId: Number(item.product_id),
          delta: -removeQty,
          branchId: purchase.branch_id,
          locationId: itemLocationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          errorCode: 'PURCHASE_CANCEL_STOCK_INVALID',
          errorMessage: `Cannot cancel purchase because stock would go negative for product #${item.product_id}`,
          disableAutoDrain: true,
          movementType: 'purchase_cancel',
          referenceType: 'purchase',
          referenceId: purchaseId,
          reason: 'purchase_cancel',
          note: buildPurchaseReferenceNote('Cancel', purchase),
          createdBy: auth.userId,
          moneyDigits,
        });
        // INV-PURCHASE-CANCEL-WAC-RECOMPUTE: the cancelled receipt leaves
        // the pool at its ORIGINAL receipt value — the exact inverse of
        // the creation blend (purchaseReceiptBaseUnitCost over the
        // stored unit_cost, VAT-stripped, per base unit, at book
        // digits). Without this, cost_price keeps the cancelled blend
        // and every later COGS is priced off stock that no longer
        // exists. The location-scoped guard above already makes cancel
        // all-or-nothing per line, so removeQty is the full receipt
        // quantity whenever this runs; valuation itself is global,
        // through applyStockDelta's corrected globalAfter, exactly
        // like the purchase-return revaluation. A missing or corrupt
        // stored cost fails the cancel closed instead of silently
        // keeping the stale WAC.
        if (removeQty > 0) {
          if (item.unit_cost == null || !Number.isFinite(Number(item.unit_cost)) || Number(item.unit_cost) < 0) {
            throw new AppError(
              'سعر تكلفة سطر الشراء الأصلي غير محفوظ؛ لا يمكن إلغاء الفاتورة دون إعادة حساب متوسط التكلفة',
              'PURCHASE_CANCEL_COST_INVALID',
              409,
            );
          }
          const removedBaseUnitCost = purchaseReceiptBaseUnitCost(
            Number(item.unit_cost),
            Number(item.unit_multiplier ?? 1),
            Number(purchase.tax_rate || 0),
            Boolean(purchase.prices_include_tax),
          );
          await revalueStockReturn(
            trx,
            scope.tenantId,
            Number(item.product_id),
            stockChange.globalAfter,
            removeQty,
            roundMoney(removeQty * removedBaseUnitCost, moneyDigits),
          );
        }
      }

      if (purchase.payment_type === 'credit' && purchase.supplier_id) {
        const supplier = await trx
          .selectFrom('suppliers')
          .select(['balance'])
          .where('id', '=', purchase.supplier_id)
          .where('tenant_id', '=', scope.tenantId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (Number(supplier.balance || 0) + 0.001 < Number(purchase.total || 0)) {
          throw new AppError(
            'رصيد المورد لا يغطي عكس فاتورة الشراء بالكامل؛ راجع التسويات والمدفوعات',
            'PURCHASE_CANCEL_SUPPLIER_BALANCE',
            422,
          );
        }
        await this.financeService.addSupplierLedgerEntry(
          trx,
          purchase.supplier_id,
          -Number(purchase.total || 0),
          'purchase_cancel',
          buildPurchaseReferenceNote('إلغاء فاتورة شراء', purchase),
          'purchase',
          purchaseId,
          auth,
          purchase.branch_id,
          purchase.location_id,
        );
      } else {
        await this.financeService.addTreasuryTransaction(
          trx,
          'purchase_cancel',
          Number(purchase.total || 0),
          buildPurchaseReferenceNote('إلغاء فاتورة شراء', purchase),
          'purchase',
          purchaseId,
          auth,
          purchase.branch_id,
          purchase.location_id,
        );
      }

      await trx
        .updateTable('purchases')
        .set({
          status: 'cancelled',
          cancel_reason: String(reason || '').trim(),
          cancelled_by: auth.userId,
          cancelled_at: sql`NOW()`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      await this.accountingPosting.reversePurchaseJournal(trx, purchaseId, String(reason || '').trim(), auth);
    });

    await this.audit.log('إلغاء فاتورة شراء', `تم إلغاء فاتورة شراء #${purchaseId} بواسطة ${auth.username}`, auth);
    return this.buildPurchaseMutationResponse(purchaseId, auth);
  }
}
