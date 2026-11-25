/**
 * PurchasesWriteUpdateService — slice S4 of the purchases-write split.
 * Pure move of updatePurchase from PurchasesWriteService. No behavior change:
 * the body is byte-identical; the facade keeps a thin delegate with the same
 * name and signature. Deps are db + tx + financeService + audit, plus the
 * repricing and shared-helper methods bound from the facade own methods.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { computeInvoiceTotals } from '../../../common/utils/invoice-totals';
import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import {
  checkClientBusinessDay,
  CLIENT_BUSINESS_DATE_FUTURE_DAYS,
} from '../../../common/utils/client-date-bounds.util';
import { ensureNonNegativeStock } from '../../../common/utils/financial-integrity';
import {
  applyStockDelta,
  lockStockProducts,
  previewConsumableStockQty,
} from '../../../common/utils/location-stock-ledger';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { UpsertPurchaseDto } from '../dto/upsert-purchase.dto';
import {
  allocatePurchaseInvoiceDiscount,
  buildHistoricCostMap,
  buildNormalizedPurchaseItem,
  buildPurchaseReferenceNote,
  calculatePurchaseStockDecrease,
  calculatePurchaseStockIncrease,
  normalizePurchaseScope,
} from '../helpers/purchases-write.helper';
import { PurchasesFinanceService } from './purchases-finance.service';
import {
  detectDuplicateBills,
  normalizeBillNumber,
  HistoricalPurchaseRecord,
} from '../engines/duplicate-bill-detector.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import type {
  PurchaseRepricingCandidate,
  PurchaseRepricingInsights,
  PurchaseRepricingProduct,
} from './purchases-write.types';

export interface PurchasesWriteUpdateDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  financeService: PurchasesFinanceService;
  audit: AuditService;
  buildPurchaseRepricingCandidate: (product: PurchaseRepricingProduct, newCost: number) => PurchaseRepricingCandidate;
  buildPurchaseRepricingInsights: (
    purchaseId: number,
    supplier: { id: number; name: string },
    candidates: PurchaseRepricingCandidate[],
    moneyDigits?: 2 | 3,
  ) => PurchaseRepricingInsights | null;
  assertManagerApprovalForPurchaseChange: (secret: string, auth: AuthContext) => Promise<void>;
  hasPermission: (auth: AuthContext, permission: string) => boolean;
  buildPurchaseMutationResponse: (
    purchaseId: number,
    auth: AuthContext,
    extras?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}

@Injectable()
export class PurchasesWriteUpdateService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly financeService: PurchasesFinanceService;
  private readonly audit: AuditService;
  private readonly buildPurchaseRepricingCandidate: (
    product: PurchaseRepricingProduct,
    newCost: number,
  ) => PurchaseRepricingCandidate;
  private readonly buildPurchaseRepricingInsights: (
    purchaseId: number,
    supplier: { id: number; name: string },
    candidates: PurchaseRepricingCandidate[],
    moneyDigits?: 2 | 3,
  ) => PurchaseRepricingInsights | null;
  private readonly assertManagerApprovalForPurchaseChange: (secret: string, auth: AuthContext) => Promise<void>;
  private readonly hasPermission: (auth: AuthContext, permission: string) => boolean;
  private readonly buildPurchaseMutationResponse: (
    purchaseId: number,
    auth: AuthContext,
    extras?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;

  constructor(deps: PurchasesWriteUpdateDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.financeService = deps.financeService;
    this.audit = deps.audit;
    this.buildPurchaseRepricingCandidate = deps.buildPurchaseRepricingCandidate;
    this.buildPurchaseRepricingInsights = deps.buildPurchaseRepricingInsights;
    this.assertManagerApprovalForPurchaseChange = deps.assertManagerApprovalForPurchaseChange;
    this.hasPermission = deps.hasPermission;
    this.buildPurchaseMutationResponse = deps.buildPurchaseMutationResponse;
  }

  async updatePurchase(
    purchaseId: number,
    payload: UpsertPurchaseDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    // Same P6 delivery window as createPurchase (see above), checked
    // before the edit-reason / manager-approval gates.
    if (payload.requiredDate !== undefined && payload.requiredDate !== null) {
      const requiredDayKey =
        payload.requiredDate instanceof Date
          ? payload.requiredDate.toISOString().slice(0, 10)
          : String(payload.requiredDate).slice(0, 10);
      const requiredCheck = checkClientBusinessDay(requiredDayKey, await getTenantTimezone(this.db, scope.tenantId), {
        minDayOffset: 0,
        maxDayOffset: CLIENT_BUSINESS_DATE_FUTURE_DAYS,
      });
      if (!requiredCheck.ok) {
        throw new AppError('تاريخ التسليم المطلوب خارج النطاق المسموح به.', 'PURCHASE_REQUIRED_DATE_OUT_OF_RANGE', 400);
      }
    }
    const editReason = String(payload.editReason || '').trim();
    if (!editReason) throw new AppError('سبب التعديل مطلوب.', 'PURCHASE_EDIT_REASON_REQUIRED', 400);
    await this.assertManagerApprovalForPurchaseChange(String(payload.managerPin || '').trim(), auth);

    const updated = await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const purchase = await trx
        .selectFrom('purchases')
        .selectAll()
        .where('id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!purchase) throw new AppError('Purchase not found', 'PURCHASE_NOT_FOUND', 404);
      if (purchase.status === 'cancelled')
        throw new AppError('Cancelled purchase cannot be edited', 'PURCHASE_CANCELLED', 400);
      // Posted GL journals are immutable. Do not mutate invoice stock/supplier balances without a
      // balancing correction document and journal.
      if (purchase.status === 'posted') {
        throw new AppError(
          'لا يمكن تعديل فاتورة مشتريات مرحلة؛ استخدم مستند تصحيح أو مرتجعاً رسمياً',
          'POSTED_PURCHASE_EDIT_FORBIDDEN',
          422,
        );
      }
      // This legacy edit flow reverses physical movements unconditionally; purchase-order-only
      // drafts have never posted stock/treasury, so edits need a separate metadata-only command.
      if (purchase.lifecycle_status === 'purchase_order' || purchase.status === 'draft') {
        throw new AppError(
          'مسودة المشتريات تحتاج مسار تعديل منفصل دون عكس حركة مخزون أو قيد',
          'PURCHASE_DRAFT_EDIT_UNSUPPORTED',
          422,
        );
      }
      if (purchase.lifecycle_status === 'grn_bill')
        throw new AppError('فاتورة GRN مرحّلة؛ يلزم إشعار دائن محاسبي للتعديل', 'GRNI_BILL_IMMUTABLE', 422);

      const oldItems = await trx
        .selectFrom('purchase_items')
        .selectAll()
        .where('purchase_id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      // INV-SERVICE-ITEM-QUICK-CREATE: service lines never posted stock, so
      // an edit has nothing to reverse for them. Look their type up once.
      const oldServiceProductIds = new Set<number>();
      const oldLookupIds = oldItems.map((item) => Number(item.product_id)).filter((id) => id > 0);
      if (oldLookupIds.length) {
        const oldProducts = await trx
          .selectFrom('products')
          .select(['id', 'item_type'])
          .where('id', 'in', oldLookupIds)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
        for (const row of oldProducts) if (row.item_type === 'service') oldServiceProductIds.add(Number(row.id));
      }
      if (!(payload.items || []).length)
        throw new AppError('Purchase must include at least one item', 'PURCHASE_ITEMS_REQUIRED', 400);
      if (!(Number(payload.supplierId || 0) > 0)) throw new AppError('Supplier is required', 'SUPPLIER_REQUIRED', 400);
      await lockStockProducts(trx, {
        ...scope,
        productIds: [
          ...oldItems.map((item) => Number(item.product_id)),
          ...(payload.items || []).map((item) => item.productId),
        ],
      });
      oldItems.sort((a, b) => Number(a.product_id || 0) - Number(b.product_id || 0));
      for (const item of oldItems) {
        if (!item.product_id) continue;
        if (oldServiceProductIds.has(Number(item.product_id))) continue;
        const itemLocationId = item.location_id ?? purchase.location_id;
        const availableQty = await previewConsumableStockQty(trx, {
          productId: Number(item.product_id),
          branchId: purchase.branch_id,
          locationId: itemLocationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
        });
        const { removedQty: removeQty, beforeQty } = calculatePurchaseStockDecrease(
          item.qty,
          item.unit_multiplier,
          availableQty,
        );
        if (beforeQty < removeQty)
          throw new AppError(
            `Cannot edit purchase because stock would go negative for product #${item.product_id}`,
            'PURCHASE_EDIT_STOCK_INVALID',
            400,
          );
      }

      for (const item of oldItems) {
        if (!item.product_id) continue;
        if (oldServiceProductIds.has(Number(item.product_id))) continue;
        const itemLocationId = item.location_id ?? purchase.location_id;
        const availableQty = await previewConsumableStockQty(trx, {
          productId: Number(item.product_id),
          branchId: purchase.branch_id,
          locationId: itemLocationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
        });
        const { removedQty: removeQty, afterQty } = calculatePurchaseStockDecrease(
          item.qty,
          item.unit_multiplier,
          availableQty,
        );
        ensureNonNegativeStock(
          afterQty,
          'PURCHASE_EDIT_STOCK_INVALID',
          `Cannot edit purchase because stock would go negative for product #${item.product_id}`,
        );
        const stockChange = await applyStockDelta(trx, {
          productId: Number(item.product_id),
          delta: -removeQty,
          branchId: purchase.branch_id,
          locationId: itemLocationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          errorCode: 'PURCHASE_EDIT_STOCK_INVALID',
          errorMessage: `Cannot edit purchase because stock would go negative for product #${item.product_id}`,
        });
        await trx
          .insertInto('stock_movements')
          .values({
            product_id: item.product_id,
            movement_type: 'purchase_edit_restore',
            qty: -removeQty,
            before_qty: stockChange.scopeBefore,
            after_qty: stockChange.scopeAfter,
            reason: 'purchase_edit_restore',
            note: buildPurchaseReferenceNote('Edit restore', purchase),
            reference_type: 'purchase',
            reference_id: purchaseId,
            branch_id: purchase.branch_id,
            location_id: itemLocationId,
            created_by: auth.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          })
          .execute();
      }

      if (purchase.payment_type === 'credit' && purchase.supplier_id) {
        await this.financeService.addSupplierLedgerEntry(
          trx,
          purchase.supplier_id,
          -Number(purchase.total || 0),
          'purchase_edit_restore',
          `${buildPurchaseReferenceNote('عكس فاتورة شراء', purchase)} قبل التعديل`,
          'purchase',
          purchaseId,
          auth,
          purchase.branch_id,
          purchase.location_id,
        );
      } else {
        await this.financeService.addTreasuryTransaction(
          trx,
          'purchase_edit_restore',
          Number(purchase.total || 0),
          `${buildPurchaseReferenceNote('عكس فاتورة شراء', purchase)} قبل التعديل`,
          'purchase',
          purchaseId,
          auth,
          purchase.branch_id,
          purchase.location_id,
        );
      }

      await trx
        .deleteFrom('purchase_items')
        .where('purchase_id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      const supplier = await trx
        .selectFrom('suppliers')
        .select(['id', 'name'])
        .where('id', '=', payload.supplierId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);
      const oldByProduct = buildHistoricCostMap(oldItems);
      const { branchId, locationId } = normalizePurchaseScope(payload);

      let subtotal = 0;
      const normalizedItems = [];
      const repricingCandidates: PurchaseRepricingCandidate[] = [];
      const allowZeroPurchaseCost = await trx
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'allowZeroPurchaseCost')
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst()
        .then((row) => {
          if (!row || !row.value) return false;
          try {
            return JSON.parse(row.value) === true;
          } catch {
            return String(row.value).toLowerCase() === 'true';
          }
        });

      const settingsRaw = await trx
        .selectFrom('settings')
        .selectAll()
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      const settings = settingsRaw.reduce<Record<string, unknown>>((acc, row) => {
        try {
          acc[row.key] = JSON.parse(row.value);
        } catch {
          acc[row.key] = row.value;
        }
        return acc;
      }, {});
      const activeLocs = await trx
        .selectFrom('stock_locations')
        .select('id')
        .where('is_active', '=', true)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      const activeLocationsCount = activeLocs.length;
      const singleActiveLocationId = activeLocationsCount === 1 ? activeLocs[0].id : null;
      const defaultReceivingLocationId = settings.currentLocationId ? Number(settings.currentLocationId) : null;

      for (const item of payload.items || []) {
        if (Number(item.cost || 0) <= 0 && !allowZeroPurchaseCost) {
          throw new AppError('Purchase item cost must be greater than zero', 'INVALID_PURCHASE_COST', 400);
        }
        const product = await trx
          .selectFrom('products')
          .select([
            'id',
            'name',
            'stock_qty',
            'item_type',
            'item_kind',
            'style_code',
            'cost_price',
            'retail_price',
            'wholesale_price',
            'default_location_id',
          ])
          .where('id', '=', item.productId)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true)
          .executeTakeFirst();
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);
        // INV-SERVICE-ITEM-QUICK-CREATE: a service line needs no receiving
        // location and posts no stock; only its amount is expensed.
        const isServiceLine = product.item_type === 'service';
        const incomingCost = Number(item.cost || 0);
        const originalCost = oldByProduct.has(Number(item.productId))
          ? Number(oldByProduct.get(Number(item.productId)) || 0)
          : incomingCost;
        if (Math.abs(incomingCost - originalCost) > 0.0001 && !this.hasPermission(auth, 'canEditPrice')) {
          throw new AppError(`Cost edit is not allowed for ${product.name}`, 'COST_EDIT_NOT_ALLOWED', 403);
        }
        let finalLocationId = item.locationId ? Number(item.locationId) : null;
        if (!finalLocationId) {
          finalLocationId = product.default_location_id ? Number(product.default_location_id) : null;
        }
        if (!finalLocationId) {
          finalLocationId = defaultReceivingLocationId;
        }
        if (!finalLocationId && singleActiveLocationId) {
          finalLocationId = singleActiveLocationId;
        }
        if (!finalLocationId) {
          const stockRows = await trx
            .selectFrom('product_location_stock')
            .select(['location_id'])
            .where('product_id', '=', item.productId)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .where('qty', '>', 0)
            .execute();
          if (stockRows.length === 1) {
            finalLocationId = Number(stockRows[0].location_id);
          }
        }
        if (!finalLocationId && !isServiceLine) {
          throw new AppError(`يجب تحديد مكان الاستلام للسطر الخاص بالصنف ${product.name}`, 'LOCATION_REQUIRED', 400);
        }
        item.locationId = finalLocationId ?? undefined;

        const normalizedItem = buildNormalizedPurchaseItem({ ...item, cost: incomingCost }, product, moneyDigits);
        normalizedItems.push(normalizedItem);
        repricingCandidates.push(this.buildPurchaseRepricingCandidate(product, incomingCost));
        subtotal += normalizedItem.total;
      }

      const discount = Number(payload.discount || 0);
      if (!this.hasPermission(auth, 'canDiscount') && Math.abs(discount - Number(purchase.discount || 0)) > 0.0001) {
        throw new AppError('Discount change is not allowed', 'DISCOUNT_NOT_ALLOWED', 403);
      }
      if (discount < 0 || discount > subtotal) throw new AppError('Discount is invalid', 'INVALID_DISCOUNT', 400);
      const totals = computeInvoiceTotals(
        subtotal,
        discount,
        Number(payload.taxRate || 0),
        Boolean(payload.pricesIncludeTax),
      );
      const paymentType = payload.paymentType === 'credit' ? 'credit' : 'cash';

      const allocatedItems = allocatePurchaseInvoiceDiscount(normalizedItems, discount, moneyDigits);
      for (const normalizedItem of [...allocatedItems].sort((a, b) => a.productId - b.productId)) {
        const repricedCost = Number(normalizedItem.effectiveUnitCost || 0);
        const netRepricedCost = payload.pricesIncludeTax
          ? repricedCost / (1 + Number(payload.taxRate || 0) / 100)
          : repricedCost;

        await trx
          .insertInto('purchase_items')
          .values({
            purchase_id: purchaseId,
            product_id: normalizedItem.productId,
            product_name: normalizedItem.name,
            qty: normalizedItem.qty,
            unit_cost: repricedCost,
            line_total: normalizedItem.effectiveLineTotal,
            unit_name: normalizedItem.unitName,
            unit_multiplier: normalizedItem.unitMultiplier,
            category_id: normalizedItem.categoryId ?? null,
            location_id: normalizedItem.locationId ?? null,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          })
          .execute();

        // INV-SERVICE-ITEM-QUICK-CREATE: a service line posts no stock on
        // edit-apply either — only its purchase_items row above is written.
        if (!normalizedItem.isService) {
          const { increasedQty: increaseQty } = calculatePurchaseStockIncrease(
            normalizedItem.qty,
            normalizedItem.unitMultiplier,
            0,
          );
          const itemLocationId = normalizedItem.locationId!;
          const stockChange = await applyStockDelta(trx, {
            productId: normalizedItem.productId,
            delta: increaseQty,
            branchId,
            locationId: itemLocationId,
            tenantId: scope.tenantId,
            accountId: scope.accountId,
          });

          const baseUnitCost = netRepricedCost / normalizedItem.unitMultiplier;
          // INV-WAC-SINGLE-WRITER: every receipt blends through the one
          // writer (quantity recovery + algebraic blend + write). A
          // zero-quantity line writes nothing: no receipt to blend and
          // the stored cost is unchanged.
          if (increaseQty > 0) {
            await valueStockReceipt(
              trx,
              scope.tenantId,
              normalizedItem.productId,
              stockChange.globalAfter,
              increaseQty,
              increaseQty * baseUnitCost,
            );
          }
          await trx
            .insertInto('stock_movements')
            .values({
              product_id: normalizedItem.productId,
              movement_type: 'purchase_edit_apply',
              qty: increaseQty,
              before_qty: stockChange.scopeBefore,
              after_qty: stockChange.scopeAfter,
              reason: 'purchase_edit_apply',
              note: buildPurchaseReferenceNote('Edit apply', purchase),
              reference_type: 'purchase',
              reference_id: purchaseId,
              branch_id: branchId,
              location_id: itemLocationId,
              created_by: auth.userId,
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
            })
            .execute();
        }
      }

      if (paymentType === 'credit') {
        await this.financeService.addSupplierLedgerEntry(
          trx,
          supplier.id,
          totals.total,
          'purchase_edit_apply',
          buildPurchaseReferenceNote('تطبيق تعديل فاتورة شراء', purchase),
          'purchase',
          purchaseId,
          auth,
          branchId,
          locationId,
        );
      } else {
        await this.financeService.addTreasuryTransaction(
          trx,
          'purchase_edit_apply',
          -totals.total,
          buildPurchaseReferenceNote('تطبيق تعديل فاتورة شراء', purchase),
          'purchase',
          purchaseId,
          auth,
          branchId,
          locationId,
        );
      }

      // Fraud & Duplicate Bill Protection on Edit
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const historicalRows = await trx
        .selectFrom('purchases')
        .select(['id', 'doc_no', 'supplier_id', 'supplier_invoice_no', 'total', 'created_at', 'status'])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where('supplier_id', '=', supplier.id)
        .where('status', '!=', 'cancelled')
        .where('id', '!=', purchaseId)
        .where((eb) => eb.or([eb('created_at', '>=', ninetyDaysAgo), eb('supplier_invoice_no', 'is not', null)]))
        .execute();

      const historical: HistoricalPurchaseRecord[] = historicalRows.map((r) => ({
        id: Number(r.id),
        docNo: r.doc_no || `PUR-${r.id}`,
        supplierId: Number(r.supplier_id),
        supplierInvoiceNo: r.supplier_invoice_no || null,
        total: Number(r.total || 0),
        createdAt: r.created_at,
        status: r.status,
      }));

      const duplicateCheck = detectDuplicateBills(
        {
          supplierId: supplier.id,
          supplierInvoiceNo: payload.supplierInvoiceNo || null,
          total: totals.total,
          date: payload.requiredDate || purchase.created_at,
          excludePurchaseId: purchaseId,
        },
        historical,
      );

      const supplierInvoiceNo = normalizeBillNumber(payload.supplierInvoiceNo);
      if (
        supplierInvoiceNo &&
        historical.some((row) => normalizeBillNumber(row.supplierInvoiceNo) === supplierInvoiceNo)
      ) {
        throw new AppError('رقم فاتورة المورد مسجل بالفعل لهذا المورد', 'DUPLICATE_VENDOR_BILL', 409);
      }

      if (duplicateCheck.hasBlockingDuplicates) {
        if (payload.allowDuplicateOverride === true) {
          if (auth.role !== 'admin' && auth.role !== 'super_admin') {
            throw new AppError(
              'تجاوز حظر فواتير الموردين المكررة يتطلب صلاحية مسؤول النظام (Admin)',
              'DUPLICATE_OVERRIDE_UNAUTHORIZED',
              403,
            );
          }
          const reason = String(payload.duplicateOverrideReason || '').trim();
          if (!reason) {
            throw new AppError('يجب إدخال سبب لتجاوز حظر الفاتورة المكررة', 'DUPLICATE_OVERRIDE_REASON_REQUIRED', 422);
          }
        } else {
          const firstBlocking = duplicateCheck.matches.find((m) => m.severity === 'blocking');
          throw new AppError(
            firstBlocking?.message || 'تم حظر العملية: هذه الفاتورة مكررة تماماً لنفس المورد',
            'DUPLICATE_VENDOR_BILL',
            422,
            { duplicates: duplicateCheck.matches },
          );
        }
      } else if (
        duplicateCheck.hasSuspiciousDuplicates &&
        !payload.confirmedDuplicateWarning &&
        !payload.allowDuplicateOverride
      ) {
        const firstWarning = duplicateCheck.matches.find((m) => m.severity === 'warning');
        throw new AppError(
          firstWarning?.message || 'تنبيه رقابي: اشتباه في تكرار فاتورة المورد، يرجى التأكيد للمتابعة',
          'SUSPICIOUS_VENDOR_BILL',
          422,
          { duplicates: duplicateCheck.matches, requiresConfirmation: true },
        );
      }

      if (payload.importProjectId) {
        const imp = await trx
          .selectFrom('import_projects')
          .select('id')
          .where('id', '=', payload.importProjectId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        if (!imp) {
          throw new AppError(
            'مشروع الاستيراد المحدد غير موجود أو لا ينتمي لهذه المنشأة.',
            'IMPORT_PROJECT_NOT_FOUND',
            400,
          );
        }
      }

      await trx
        .updateTable('purchases')
        .set({
          supplier_id: supplier.id,
          payment_type: paymentType,
          subtotal: roundMoney(subtotal, moneyDigits),
          discount,
          tax_rate: Number(payload.taxRate || 0),
          tax_amount: totals.taxAmount,
          prices_include_tax: Boolean(payload.pricesIncludeTax),
          total: totals.total,
          supplier_invoice_no: normalizeBillNumber(payload.supplierInvoiceNo) || null,
          duplicate_override_reason: payload.allowDuplicateOverride
            ? String(payload.duplicateOverrideReason || '').trim()
            : null,
          duplicate_overridden_by: payload.allowDuplicateOverride ? auth.userId : null,
          note: String(payload.note || '').trim(),
          branch_id: branchId,
          location_id: locationId,
          required_date: payload.requiredDate || null,
          currency: payload.currency || '',
          company_name: payload.companyName || '',
          contact_id: payload.contactId || null,
          shipping_address_id: payload.shippingAddressId || null,
          cost_center_id: payload.costCenterId || null,
          project_id: payload.projectId || null,
          import_project_id: payload.importProjectId !== undefined ? payload.importProjectId || null : undefined,
          terms_template: payload.termsTemplate || '',
          updated_at: sql`NOW()`,
        })
        .where('id', '=', purchaseId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      return {
        repricingInsights: this.buildPurchaseRepricingInsights(
          purchaseId,
          { id: Number(supplier.id), name: String(supplier.name || '') },
          repricingCandidates,
        ),
      };
    });

    await this.audit.log(
      'تعديل فاتورة شراء',
      `تم تعديل فاتورة شراء #${purchaseId} بواسطة ${auth.username}. السبب: ${editReason}`,
      auth,
    );
    return this.buildPurchaseMutationResponse(purchaseId, auth, { repricingInsights: updated.repricingInsights });
  }
}
