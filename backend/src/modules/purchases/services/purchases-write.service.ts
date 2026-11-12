import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, type Selectable } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { assertUntrackedStockMutation } from '../../inventory/helpers/inventory-tracked-stock.helper';
import { reversePurchaseTrackedStock } from '../helpers/purchase-cancellation-trace.helper';
import { computeInvoiceTotals } from '../../../common/utils/invoice-totals';
import { purchaseReceiptBaseUnitCost } from '../engines/purchase-receipt-cost.engine';
import { allocateLandedCosts } from '../engines/landed-cost-allocation.engine';
import { advancePurchaseOrderReceipt } from '../engines/purchase-order-receipt.engine';
import { revalueStockReturn, valueStockReceipt } from '../../accounting/inventory-valuation';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { ensureNonNegativeStock, ensureUniqueFlowItems } from '../../../common/utils/financial-integrity';
import { authorizeManagerSecret } from '../../../common/utils/manager-approval';
import { applyStockDelta, lockStockProducts, previewConsumableStockQty } from '../../../common/utils/location-stock-ledger';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { CreateCustomerPaymentDto, CreateSupplierPaymentDto } from '../dto/create-party-payment.dto';
import { UpsertPurchaseDto } from '../dto/upsert-purchase.dto';
import { allocatePurchaseInvoiceDiscount, buildHistoricCostMap, buildNormalizedPurchaseItem, buildPurchaseReferenceNote, calculatePurchaseStockDecrease, calculatePurchaseStockIncrease, calculatePurchaseSubtotal, assertNonCashTransferReference, normalizeInstapayAddress, normalizeOptionalNote, normalizePurchaseScope, normalizeTransferReference, type DiscountAllocatedPurchaseItem } from '../helpers/purchases-write.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { PurchasesQueryService } from './purchases-query.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { detectDuplicateBills, normalizeBillNumber, type HistoricalPurchaseRecord } from '../engines/duplicate-bill-detector.engine';
import { assertCustomerPaymentJobOwnership } from '../helpers/customer-payment-job-ownership';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, fromMinorUnits, roundMoney, toMinorUnits } from '../../accounting/engines/money-minor-units.engine';

type PurchaseRepricingCandidate = {
  productId: number;
  name: string;
  itemKind: 'standard' | 'fashion';
  styleCode: string;
  previousCost: number;
  newCost: number;
  retailPrice: number;
  wholesalePrice: number;
};

type PurchaseRepricingProduct = Pick<Selectable<Database['products']>, 'id' | 'name' | 'item_kind' | 'style_code' | 'cost_price' | 'retail_price' | 'wholesale_price'>;

type PurchaseRepricingInsights = {
  purchaseId: number;
  supplierId: number;
  supplierName: string;
  affectedCount: number;
  increasedCount: number;
  decreasedCount: number;
  unchangedCount: number;
  productIds: number[];
  rows: Array<{
    productId: number;
    name: string;
    itemKind: 'standard' | 'fashion';
    styleCode: string;
    previousCost: number;
    newCost: number;
    costChangePercent: number;
    retailPrice: number;
    wholesalePrice: number;
    recommendedRetailPrice: number;
    recommendedWholesalePrice: number;
    recommendedRetailDelta: number;
    recommendedWholesaleDelta: number;
  }>;
};

@Injectable()
export class PurchasesWriteService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly financeService: PurchasesFinanceService,
    private readonly queryService: PurchasesQueryService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private hasPermission(auth: AuthContext, permission: string): boolean {
    return auth.role === 'super_admin' || auth.permissions.includes(permission);
  }

  /*
   * INV-SPIRIT-PURCHASE-MANAGER-APPROVAL: editing or cancelling a
   * purchase reverses stock, supplier and journal balances, so the
   * manager secret the dialogs already collect is actually verified
   * here — it used to travel to the server and be discarded. The rule
   * mirrors sale edit: a non-admin must supply the shared manager PIN
   * or a manager account password; an admin bypasses unless a secret
   * was supplied, in which case it is verified too.
   */
  private async assertManagerApprovalForPurchaseChange(secret: string, auth: AuthContext): Promise<void> {
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin && !secret) {
      throw new AppError('رمز اعتماد المدير مطلوب قبل تعديل أو إلغاء فاتورة المشتريات.', 'MANAGER_AUTH_REQUIRED', 400);
    }
    if (!isAdmin || secret) {
      await authorizeManagerSecret(this.db, auth, secret);
    }
  }

  private roundCurrency(value: number, digits: 2 | 3 = 2): number {
    return Number(Number(value || 0).toFixed(digits));
  }

  private buildRecommendedSellPrice(currentSellPrice: number, previousCost: number, newCost: number, digits: 2 | 3 = 2): number {
    const safeCurrentSell = Number(currentSellPrice || 0);
    const safePreviousCost = Number(previousCost || 0);
    const safeNewCost = Number(newCost || 0);
    if (safeCurrentSell <= 0) return 0;
    if (safePreviousCost > 0 && safeNewCost > 0) {
      return this.roundCurrency((safeCurrentSell / safePreviousCost) * safeNewCost, digits);
    }
    if (safeNewCost > 0) {
      const absoluteMarkup = Math.max(0, safeCurrentSell - Math.max(0, safePreviousCost));
      return this.roundCurrency(safeNewCost + absoluteMarkup, digits);
    }
    return this.roundCurrency(safeCurrentSell, digits);
  }

  private buildPurchaseRepricingCandidate(product: PurchaseRepricingProduct, newCost: number): PurchaseRepricingCandidate {
    return {
      productId: Number(product.id),
      name: String(product.name || ''),
      itemKind: product.item_kind === 'fashion' ? 'fashion' : 'standard',
      styleCode: String(product.style_code || ''),
      previousCost: Number(product.cost_price || 0),
      newCost,
      retailPrice: Number(product.retail_price || 0),
      wholesalePrice: Number(product.wholesale_price || 0),
    };
  }

  private buildPurchaseRepricingInsights(
    purchaseId: number,
    supplier: { id: number; name: string },
    candidates: PurchaseRepricingCandidate[],
    moneyDigits: 2 | 3 = 2,
  ): PurchaseRepricingInsights | null {
    const rows = candidates
      .filter((candidate) => Math.abs(Number(candidate.newCost || 0) - Number(candidate.previousCost || 0)) > 0.0001)
      .map((candidate) => {
        const previousCost = Number(candidate.previousCost || 0);
        const newCost = Number(candidate.newCost || 0);
        const retailPrice = Number(candidate.retailPrice || 0);
        const wholesalePrice = Number(candidate.wholesalePrice || 0);
        const recommendedRetailPrice = this.buildRecommendedSellPrice(retailPrice, previousCost, newCost, moneyDigits);
        const recommendedWholesalePrice = this.buildRecommendedSellPrice(wholesalePrice, previousCost, newCost, moneyDigits);
        const costChangePercent = previousCost > 0
          ? this.roundCurrency(((newCost - previousCost) / previousCost) * 100)
          : (newCost > 0 ? 100 : 0);
        return {
          productId: Number(candidate.productId),
          name: candidate.name,
          itemKind: candidate.itemKind,
          styleCode: candidate.styleCode,
          previousCost: this.roundCurrency(previousCost, moneyDigits),
          newCost: this.roundCurrency(newCost, moneyDigits),
          costChangePercent,
          retailPrice: this.roundCurrency(retailPrice, moneyDigits),
          wholesalePrice: this.roundCurrency(wholesalePrice, moneyDigits),
          recommendedRetailPrice,
          recommendedWholesalePrice,
          recommendedRetailDelta: this.roundCurrency(recommendedRetailPrice - retailPrice, moneyDigits),
          recommendedWholesaleDelta: this.roundCurrency(recommendedWholesalePrice - wholesalePrice, moneyDigits),
        };
      });

    if (!rows.length) return null;

    return {
      purchaseId,
      supplierId: Number(supplier.id),
      supplierName: supplier.name,
      affectedCount: rows.length,
      increasedCount: rows.filter((row) => row.newCost > row.previousCost).length,
      decreasedCount: rows.filter((row) => row.newCost < row.previousCost).length,
      unchangedCount: Math.max(0, candidates.length - rows.length),
      productIds: rows.map((row) => row.productId),
      rows,
    };
  }

  private async buildPurchaseMutationResponse(
    purchaseId: number,
    auth: AuthContext,
    extras: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const purchaseResult = await this.queryService.getPurchaseById(purchaseId, auth);
    const purchases = await this.queryService.listPurchases({ page: 1, pageSize: 25 }, auth);
    return { ok: true, purchaseId, purchase: purchaseResult.purchase, purchases: purchases.purchases, ...extras };
  }

  /*
   * INV-LANDED-COST-ALLOCATION: freight carried on the invoice itself.
   * The invoice total is payable to this supplier alone, so a landed
   * cost naming any other vendor fails closed here — third-party
   * freight (carrier, customs broker) still belongs to the
   * post-posting landed-costs step, which credits each vendor
   * separately. A purchase order carries no receipt yet, so freight
   * on it is rejected too; the receipt is where the cost blends.
   * Amounts must land exactly on the tenant's book digits.
   */
  private validateAtReceiptLandedCosts(
    landedCosts: UpsertPurchaseDto['landedCosts'],
    moneyDigits: 2 | 3,
    supplierId: number,
    lifecycleStatus?: string,
  ): {
    total: number;
    allocationMethod: 'value' | 'qty' | 'equal';
    notes: string;
    costs: Array<{ costType: 'freight' | 'customs' | 'handling' | 'insurance' | 'other'; description: string; amount: number; vendorId: number | null }>;
  } | null {
    if (!landedCosts || !Array.isArray(landedCosts.costs) || !landedCosts.costs.length) return null;
    if (lifecycleStatus === 'purchase_order') {
      throw new AppError('لا يمكن تحميل شحن على أمر شراء قبل الاستلام؛ أضف الشحن عند إنشاء فاتورة الشراء.', 'PURCHASE_LANDED_COST_UNSUPPORTED_DOCUMENT', 400);
    }
    const allocationMethod = landedCosts.allocationMethod || 'value';
    if (allocationMethod !== 'value' && allocationMethod !== 'qty' && allocationMethod !== 'equal') {
      throw new AppError('طريقة توزيع الشحن غير صالحة.', 'PURCHASE_LANDED_COST_INVALID_METHOD', 400);
    }
    const costTypes = new Set(['freight', 'customs', 'handling', 'insurance', 'other']);
    let totalMinor = 0;
    const costs = landedCosts.costs.map((cost) => {
      if (!costTypes.has(String(cost.costType))) {
        throw new AppError('نوع تكلفة الوصول غير صالح.', 'PURCHASE_LANDED_COST_INVALID_TYPE', 400);
      }
      if (!String(cost.description || '').trim()) {
        throw new AppError('وصف تكلفة الوصول مطلوب.', 'PURCHASE_LANDED_COST_INVALID', 400);
      }
      let minor: number;
      try {
        minor = toMinorUnits(Number(cost.amount), moneyDigits);
        if (minor <= 0) throw new Error('Non-positive');
      } catch {
        throw new AppError('مبالغ الشحن لا تطابق دقة عملة الأساس.', 'PURCHASE_LANDED_COST_PRECISION', 400);
      }
      totalMinor += minor;
      if (!Number.isSafeInteger(totalMinor)) {
        throw new AppError('مبالغ الشحن لا تطابق دقة عملة الأساس.', 'PURCHASE_LANDED_COST_PRECISION', 400);
      }
      const vendorId = cost.vendorId == null ? null : Number(cost.vendorId);
      if (vendorId != null && (!Number.isSafeInteger(vendorId) || vendorId <= 0)) {
        throw new AppError('معرّف مورد الشحن غير صالح.', 'PURCHASE_LANDED_COST_INVALID_VENDOR', 400);
      }
      if (vendorId != null && vendorId !== Number(supplierId)) {
        throw new AppError('الشحن في الفاتورة نفسها يكون من مورد الفاتورة؛ شحن مورد آخر يضاف بعد الترحيل من خطوة تكاليف الوصول.', 'PURCHASE_LANDED_COST_VENDOR_MISMATCH', 400);
      }
      return { costType: cost.costType, description: String(cost.description).trim(), amount: Number(cost.amount), vendorId };
    });
    const total = fromMinorUnits(totalMinor, moneyDigits);
    if (!(total > 0)) {
      throw new AppError('مبالغ الشحن لا تطابق دقة عملة الأساس.', 'PURCHASE_LANDED_COST_PRECISION', 400);
    }
    return { total, allocationMethod, notes: String(landedCosts.notes || '').trim(), costs };
  }

  /*
   * Split at-receipt freight over the stocked lines only, by the same
   * basis the post-posting step uses ('value' by default). Service
   * lines never carry freight into stock: their amount is expensed
   * by postPurchase, never capitalised. The canonical allocator sums
   * exactly at book digits, so no penny is lost or invented.
   */
  private allocateAtReceiptLandedCosts(
    items: DiscountAllocatedPurchaseItem[],
    landed: { total: number; allocationMethod: 'value' | 'qty' | 'equal' },
    moneyDigits: 2 | 3,
  ): Map<number, number> {
    const stocked = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.isService);
    if (!stocked.length) {
      throw new AppError('الشحن يحتاج صنفاً مخزنياً واحداً على الأقل في الفاتورة؛ سطور الخدمة وحدها لا تحمل تكلفة وصول.', 'PURCHASE_LANDED_COST_NO_STOCKED_ITEMS', 400);
    }
    const weights = stocked.map(({ item }) => {
      if (landed.allocationMethod === 'qty') return Math.max(0, Number(item.qty || 0) * Number(item.unitMultiplier || 1));
      if (landed.allocationMethod === 'equal') return 1;
      return Math.max(0, Number(item.effectiveLineTotal || 0));
    });
    const shares = allocateLandedCosts(landed.total, weights, moneyDigits);
    const result = new Map<number, number>();
    stocked.forEach(({ index }, i) => result.set(index, shares[i]));
    return result;
  }

  async createPurchase(payload: UpsertPurchaseDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);

    // SINGLE reservation point. The IdempotencyInterceptor is NOT applied to PurchasesController.
    // This is the only place reserveOperation is called for purchase_create.
    if (idempotencyKey) {
      const existingResult = await this.idempotency.reserveOperation({
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        idempotencyKey,
        operationType: 'purchase_create',
        requestHash: this.idempotency.generateRequestHash(payload),
      });
      // If operation was already processed, return the cached result.
      if (existingResult?.status === 'committed' && existingResult.responsePayload) {
        const cached = existingResult.responsePayload;
        const purchaseId = Number(cached.purchaseId || existingResult.documentId);
        if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) {
          throw new AppError('Committed purchase requires recovery', 'PURCHASE_RECOVERY_REQUIRED', 422);
        }
        return this.buildPurchaseMutationResponse(purchaseId, auth, { repricingInsights: cached.repricingInsights || null });
      }
      if (existingResult?.status === 'failed') {
        throw new AppError(existingResult.errorCode || 'Operation previously failed', 'PURCHASE_IDEMPOTENCY_FAILED', 400);
      }
      if (existingResult?.status === 'processing') {
        throw new AppError('Operation is currently processing, retry later', 'PURCHASE_PROCESSING', 409);
      }
      if (existingResult?.status === 'recovery_required') {
        throw new AppError('Operation requires manual recovery', 'PURCHASE_RECOVERY_REQUIRED', 422);
      }
    }

    try {
    const created = await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const supplier = await trx.selectFrom('suppliers').select(['id', 'name']).where('id', '=', payload.supplierId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('is_active', '=', true).forUpdate().executeTakeFirst();
      if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);

      const items = payload.items || [];
      if (!items.length) throw new AppError('Purchase must include at least one item', 'PURCHASE_ITEMS_REQUIRED', 400);
      ensureUniqueFlowItems(items, 'PURCHASE_DUPLICATE_PRODUCT', 'Purchase must not contain duplicate product rows with the same unit and cost');
      await lockStockProducts(trx, { ...scope, productIds: items.map((item) => item.productId) });

      const normalizedItems = [];
      const repricingCandidates: PurchaseRepricingCandidate[] = [];
      const settingsResult = await trx
        .selectFrom('settings')
        .select(['key', 'value'])
        .where('key', 'in', ['allowZeroPurchaseCost', 'currentLocationId'])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      
      const allowZeroRow = settingsResult.find((r) => r.key === 'allowZeroPurchaseCost');
      let allowZeroPurchaseCost = false;
      if (allowZeroRow && allowZeroRow.value) {
        try { allowZeroPurchaseCost = JSON.parse(allowZeroRow.value) === true; } catch { allowZeroPurchaseCost = String(allowZeroRow.value).toLowerCase() === 'true'; }
      }
      
      const defaultReceivingLocationRow = settingsResult.find((r) => r.key === 'currentLocationId');
      const defaultReceivingLocationId = defaultReceivingLocationRow?.value ? Number(defaultReceivingLocationRow.value) : null;
      
      const activeLocations = await trx.selectFrom('stock_locations').select('id').where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('is_active', '=', true).where((eb) => eb.or([eb('location_type', 'is', null), eb('location_type', '!=', 'in_transit')])).execute();
      const singleActiveLocationId = activeLocations.length === 1 ? Number(activeLocations[0].id) : null;

      for (const item of items) {
        if (Number(item.cost || 0) <= 0 && !allowZeroPurchaseCost) {
          throw new AppError('Purchase item cost must be greater than zero', 'INVALID_PURCHASE_COST', 400);
        }
        const product = await trx.selectFrom('products').select(['id', 'name', 'item_type', 'item_kind', 'style_code', 'cost_price', 'retail_price', 'wholesale_price', 'default_location_id']).where('id', '=', item.productId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('is_active', '=', true).executeTakeFirst();
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);
        // INV-SERVICE-ITEM-QUICK-CREATE: a service line needs no receiving
        // location and posts no stock; only its amount is expensed.
        const isServiceLine = product.item_type === 'service';
        let finalLocationId = item.locationId ? Number(item.locationId) : null;
        if (!finalLocationId && payload.locationId) {
          finalLocationId = Number(payload.locationId);
        }
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
        
        normalizedItems.push(buildNormalizedPurchaseItem(item, product, moneyDigits));
        repricingCandidates.push(this.buildPurchaseRepricingCandidate(product, Number(item.cost || 0)));
      }

      const subtotal = calculatePurchaseSubtotal(normalizedItems, moneyDigits);
      const discount = Number(payload.discount || 0);
      if (!this.hasPermission(auth, 'canDiscount') && Math.abs(discount) > 0.0001) {
        throw new AppError('Discount change is not allowed', 'DISCOUNT_NOT_ALLOWED', 403);
      }
      if (discount < 0 || discount > subtotal) throw new AppError('Discount is invalid', 'INVALID_DISCOUNT', 400);
      const { taxAmount, total: itemsTotal } = computeInvoiceTotals(subtotal, discount, Number(payload.taxRate || 0), Boolean(payload.pricesIncludeTax));
      // INV-LANDED-COST-ALLOCATION: freight on the invoice is part of
      // the supplier bill, so the invoice total — and the inventory
      // debit postPurchase derives from it — includes it. Freight is
      // never taxed: it is added after the tax computation.
      const atReceiptLanded = this.validateAtReceiptLandedCosts(payload.landedCosts, moneyDigits, supplier.id, payload.lifecycleStatus);
      const total = roundMoney(itemsTotal + (atReceiptLanded ? atReceiptLanded.total : 0), moneyDigits);
      const paymentType = payload.paymentType === 'credit' ? 'credit' : 'cash';
      const { branchId, locationId } = normalizePurchaseScope(payload);

      // Fraud & Duplicate Bill Protection
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const historicalRows = await trx
        .selectFrom('purchases')
        .select(['id', 'doc_no', 'supplier_id', 'supplier_invoice_no', 'total', 'created_at', 'status'])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where('supplier_id', '=', supplier.id)
        .where('status', '!=', 'cancelled')
        .where((eb) =>
          eb.or([
            eb('created_at', '>=', ninetyDaysAgo),
            eb('supplier_invoice_no', 'is not', null),
          ]),
        )
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
          total,
          date: payload.requiredDate || new Date(),
        },
        historical,
      );

      const supplierInvoiceNo = normalizeBillNumber(payload.supplierInvoiceNo);
      if (supplierInvoiceNo && historical.some((row) => normalizeBillNumber(row.supplierInvoiceNo) === supplierInvoiceNo)) {
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
            throw new AppError(
              'يجب إدخال سبب لتجاوز حظر الفاتورة المكررة',
              'DUPLICATE_OVERRIDE_REASON_REQUIRED',
              422,
            );
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
      } else if (duplicateCheck.hasSuspiciousDuplicates && !payload.confirmedDuplicateWarning && !payload.allowDuplicateOverride) {
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
          throw new AppError('مشروع الاستيراد المحدد غير موجود أو لا ينتمي لهذه المنشأة.', 'IMPORT_PROJECT_NOT_FOUND', 400);
        }
      }

      const insert = await trx
        .insertInto('purchases')
        .values({
          supplier_id: supplier.id,
          payment_type: paymentType,
          subtotal: roundMoney(subtotal, moneyDigits),
          discount,
          tax_rate: Number(payload.taxRate || 0),
          tax_amount: taxAmount,
          prices_include_tax: Boolean(payload.pricesIncludeTax),
          total,
          supplier_invoice_no: normalizeBillNumber(payload.supplierInvoiceNo) || null,
          duplicate_override_reason: payload.allowDuplicateOverride ? String(payload.duplicateOverrideReason || '').trim() : null,
          duplicate_overridden_by: payload.allowDuplicateOverride ? auth.userId : null,
          note: normalizeOptionalNote(payload.note),
          status: payload.lifecycleStatus === 'purchase_order' ? 'draft' : 'posted',
          lifecycle_status: payload.lifecycleStatus || 'posted',
          matched_status: payload.lifecycleStatus === 'purchase_order' ? 'pending' : 'matched',
          branch_id: branchId,
          location_id: locationId,
          created_by: auth.userId,
          cancel_reason: '',
          required_date: payload.requiredDate || null,
          currency: payload.currency || '',
          company_name: payload.companyName || '',
          contact_id: payload.contactId || null,
          shipping_address_id: payload.shippingAddressId || null,
          cost_center_id: payload.costCenterId || null,
          project_id: payload.projectId || null,
          import_project_id: payload.importProjectId || null,
          terms_template: payload.termsTemplate || '',
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const id = Number(insert.id);
      const docNo = await this.generatePurchaseDocNo(trx, id, scope.tenantId);
      await trx.updateTable('purchases').set({ doc_no: docNo, updated_at: sql`NOW()` }).where('id', '=', id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      const allocatedItems = allocatePurchaseInvoiceDiscount(normalizedItems, discount, moneyDigits);
      const sortedAllocatedItems = [...allocatedItems].sort((a, b) => a.productId - b.productId);
      const landedBySortedIndex = atReceiptLanded
        ? this.allocateAtReceiptLandedCosts(sortedAllocatedItems, atReceiptLanded, moneyDigits)
        : new Map<number, number>();
      for (const [sortedIndex, item] of sortedAllocatedItems.entries()) {
        const itemSerials = Array.isArray(item.serials) ? item.serials : [];
        // Recoverable input VAT is a separate asset, not inventory/COGS cost.
        const netPurchaseUnitCost = payload.pricesIncludeTax
          ? item.effectiveUnitCost / (1 + Number(payload.taxRate || 0) / 100)
          : item.effectiveUnitCost;
        // INV-LANDED-COST-ALLOCATION: this line's share of the invoice
        // freight, by value unless another basis was chosen. Zero for
        // service lines and for invoices without freight.
        const allocatedFreight = landedBySortedIndex.get(sortedIndex) || 0;
        const insertedItem = await trx.insertInto('purchase_items').values({
          purchase_id: id,
          product_id: item.productId,
          product_name: item.name,
          qty: item.qty,
          unit_cost: item.effectiveUnitCost,
          line_total: item.effectiveLineTotal,
          unit_name: item.unitName,
          unit_multiplier: item.unitMultiplier,
          category_id: item.categoryId ?? null,
          location_id: item.locationId ?? null,
          received_qty: payload.lifecycleStatus === 'purchase_order' ? 0 : item.qty,
          serials: itemSerials.length > 0 ? JSON.stringify(itemSerials) : '[]',
          batch_number: item.batchNumber || null,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          // INV-LANDED-COST-ALLOCATION: the landed unit cost is the
          // proof the freight reached this line; unit_cost stays the
          // net item cost, exactly as the post-posting step stores it.
          ...(atReceiptLanded ? {
            allocated_landed_cost: allocatedFreight,
            landed_unit_cost: Number((netPurchaseUnitCost + (item.qty > 0 ? allocatedFreight / item.qty : 0)).toFixed(6)),
          } : {}),
        } as any).returning('id').executeTakeFirst();

        const itemLocationId = item.locationId!;
        const isPurchaseOrderOnly = payload.lifecycleStatus === 'purchase_order';
        // INV-SERVICE-ITEM-QUICK-CREATE: services have no serials and no stock.
        if (itemSerials.length > 0 && !isPurchaseOrderOnly && !item.isService) {
          const serialRows = itemSerials.map((s: any) => {
            const serialNumber = typeof s === 'string' ? s.trim() : (s?.serialNumber || s?.serial || '').trim();
            const imei2 = typeof s === 'object' ? s?.imei2 || null : null;
            return {
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              product_id: item.productId,
              serial_number: serialNumber,
              imei_2: imei2,
              status: 'in_stock' as const,
              branch_id: branchId || null,
              location_id: itemLocationId || null,
              cost_price: netPurchaseUnitCost / item.unitMultiplier,
              purchase_id: id,
              purchase_item_id: insertedItem ? Number(insertedItem.id) : null,
              warranty_end_date: null,
              notes: null,
            };
          }).filter((r) => r.serial_number);

          if (serialRows.length > 0) {
            await trx.insertInto('product_serials').values(serialRows as any).execute();
          }
        }

        // INV-SERVICE-ITEM-QUICK-CREATE: a service line posts no stock at
        // all — no receipt, no WAC blend, no stock movement, no pharmacy
        // batch. Its amount is expensed by postPurchase instead.
        if (!isPurchaseOrderOnly && !item.isService) {
          const { increasedQty } = calculatePurchaseStockIncrease(item.qty, item.unitMultiplier, 0);
          const stockChange = await applyStockDelta(trx, {
            productId: item.productId,
            delta: increasedQty,
            branchId,
            locationId: itemLocationId,
            tenantId: scope.tenantId,
            accountId: scope.accountId,
          });

          // Inventory cost is per base stock unit, not per purchased carton.
          const baseUnitCost = netPurchaseUnitCost / item.unitMultiplier;
          // INV-LANDED-COST-ALLOCATION: freight carried on the invoice
          // blends into the receipt value, so the WAC reflects the true
          // landed cost instead of the bare item cost.
          const landedBaseUnitCost = allocatedFreight > 0 && increasedQty > 0
            ? baseUnitCost + allocatedFreight / increasedQty
            : baseUnitCost;
          // INV-WAC-SINGLE-WRITER: every receipt blends through the one
          // writer (quantity recovery + algebraic blend + write). A
          // zero-quantity line writes nothing: no receipt to blend and
          // the stored cost is unchanged.
          if (increasedQty > 0) {
            await valueStockReceipt(trx, scope.tenantId, item.productId, stockChange.globalAfter, increasedQty, increasedQty * landedBaseUnitCost);
          }
          await trx.insertInto('stock_movements').values({
            product_id: item.productId,
            movement_type: 'purchase',
            qty: increasedQty,
            unit_cost: Number(landedBaseUnitCost.toFixed(6)),
            total_cost: roundMoney(netPurchaseUnitCost * item.qty, moneyDigits) + allocatedFreight,
            before_qty: stockChange.scopeBefore,
            after_qty: stockChange.scopeAfter,
            reason: 'purchase',
            note: `فاتورة شراء PUR-${id}`,
            reference_type: 'purchase',
            reference_id: id,
            branch_id: branchId,
            location_id: itemLocationId,
            created_by: auth.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).execute();

          const batchNo = item.batchNumber ? String(item.batchNumber).trim() : '';
          const expiryDate = item.expiryDate ? String(item.expiryDate).trim() : '';
          const drug = await trx.selectFrom('pharmacy_drugs').select('id')
            .where('tenant_id', '=', scope.tenantId).where('product_id', '=', item.productId)
            .executeTakeFirst();
          if (drug && (!batchNo || !expiryDate)) {
            throw new AppError('الصنف الدوائي يتطلب رقم تشغيلة وتاريخ صلاحية عند الاستلام', 'PHARMACY_BATCH_REQUIRED', 422);
          }
          if (batchNo) {
              const today = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
              if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(expiryDate) ||
                (expiryDate.length === 7 ? expiryDate < today.slice(0, 7) : expiryDate < today)) {
                throw new AppError('تاريخ صلاحية التشغيلة غير صالح أو منتهٍ', 'PHARMACY_BATCH_EXPIRED', 422);
              }
              const existingBatch = await trx
                .selectFrom('pharmacy_batches')
                .selectAll()
                .where('product_id', '=', item.productId)
                .where('batch_number', '=', batchNo)
                .where('location_id', '=', itemLocationId)
                .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                .forUpdate()
                .executeTakeFirst();

              if (existingBatch) {
                if (String(existingBatch.expiry_date).slice(0, 10) !== expiryDate) {
                  throw new AppError('تاريخ صلاحية التشغيلة المسجلة لا يطابق الفاتورة', 'PHARMACY_BATCH_EXPIRY_MISMATCH', 422);
                }
                const updatedQty = Number(existingBatch.quantity || 0) + increasedQty;
                await trx
                  .updateTable('pharmacy_batches')
                  .set({
                    quantity: updatedQty,
                    unit_cost: netPurchaseUnitCost / item.unitMultiplier,
                    status: 'active',
                    expiry_date: expiryDate,
                    updated_at: sql`NOW()`,
                  } as any)
                  .where('id', '=', Number(existingBatch.id))
                  .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                  .execute();
              } else {
                await trx
                  .insertInto('pharmacy_batches')
                  .values({
                    tenant_id: scope.tenantId,
                    account_id: scope.accountId,
                    product_id: item.productId,
                    drug_id: drug?.id || null,
                    batch_number: batchNo,
                    expiry_date: expiryDate,
                    quantity: increasedQty,
                    unit_cost: netPurchaseUnitCost / item.unitMultiplier,
                    location_id: itemLocationId || null,
                    supplier_name: supplier?.name || null,
                    status: 'active',
                    notes: `وارد فاتورة شراء PUR-${id}`,
                  } as any)
                  .execute();
              }
          }
        }
      }

      // INV-LANDED-COST-ALLOCATION: record the freight breakdown and
      // stamp the header exactly as the post-posting step does, so the
      // cancel guard and the detail view see the same applied state.
      if (atReceiptLanded) {
        await trx.insertInto('purchase_landed_costs').values(
          atReceiptLanded.costs.map((cost) => ({
            tenant_id: scope.tenantId,
            purchase_id: id,
            cost_type: cost.costType,
            description: cost.description,
            amount: cost.amount,
            vendor_id: Number(cost.vendorId || supplier.id),
            allocation_method: atReceiptLanded.allocationMethod,
          })),
        ).execute();
        await trx.updateTable('purchases').set({
          landed_cost_total: atReceiptLanded.total,
          landed_cost_allocation_method: atReceiptLanded.allocationMethod,
          landed_cost_notes: atReceiptLanded.notes || null,
          landed_cost_applied_at: new Date(),
        }).where('id', '=', id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      }

      if (payload.attachments && payload.attachments.length > 0) {
        await trx
          .insertInto('purchase_attachments')
          .values(
            payload.attachments.map((attachment) => ({
              purchase_id: id,
              file_name: attachment.fileName,
              file_url: attachment.fileUrl,
              file_size: attachment.fileSize,
              file_type: attachment.fileType,
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
            } as any))
          )
          .execute();
      }

      const isPurchaseOrderOnly = payload.lifecycleStatus === 'purchase_order';
      if (!isPurchaseOrderOnly) {
        if (paymentType === 'credit') {
          await this.financeService.addSupplierLedgerEntry(trx, supplier.id, total, 'purchase_credit', `فاتورة شراء PUR-${id}`, 'purchase', id, auth, branchId, locationId);
        } else {
          await this.financeService.addTreasuryTransaction(trx, 'purchase', -total, `فاتورة شراء PUR-${id}`, 'purchase', id, auth, branchId, locationId);
        }

        await this.accountingPosting.postPurchase(trx, id, auth);
      }

      const repricingInsights = this.buildPurchaseRepricingInsights(id, { id: Number(supplier.id), name: String(supplier.name || '') }, repricingCandidates, moneyDigits);

      // Commit idempotency record atomically inside the same business transaction.
      if (idempotencyKey) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType: 'purchase_create' },
          { purchaseId: id, repricingInsights },
          String(id)
        );
      }

      return {
        purchaseId: id,
        repricingInsights,
      };
    });

    await this.audit.log('شراء', `تم تسجيل فاتورة شراء PUR-${created.purchaseId} بواسطة ${auth.username}`, auth);
    return this.buildPurchaseMutationResponse(created.purchaseId, auth, { repricingInsights: created.repricingInsights });
    } catch (error: any) {
      // Business transaction has rolled back at this point.
      // Only mark 'failed' for known validation/AppErrors (statusCode < 500) — rollback is guaranteed.
      // For unknown/technical errors, mark 'recovery_required' — outcome is ambiguous.
      if (idempotencyKey) {
        const isKnownError = error instanceof AppError && error.statusCode < 500;
        if (isKnownError) {
          await this.idempotency.recordFailure(
            { tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType: 'purchase_create' },
            error.code || 'PURCHASE_VALIDATION_FAILED'
          ).catch(() => { /* best effort */ });
        } else {
          // Unknown/5xx error — mark recovery_required (never automatically mark failed).
          await this.db
            .updateTable('operation_executions')
            .set({ status: 'recovery_required', updated_at: sql`CURRENT_TIMESTAMP` })
            .where('tenant_id', '=', scope.tenantId)
            .where('account_id', '=', scope.accountId)
            .where('idempotency_key', '=', idempotencyKey)
            .where('operation_type', '=', 'purchase_create')
            .where('status', '=', 'processing')
            .where('document_id', 'is', null)
            .execute()
            .catch(() => { /* best effort */ });
        }
      }
      throw error;
    }
  }

  async updatePurchase(purchaseId: number, payload: UpsertPurchaseDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const editReason = String(payload.editReason || '').trim();
    if (!editReason) throw new AppError('سبب التعديل مطلوب.', 'PURCHASE_EDIT_REASON_REQUIRED', 400);
    await this.assertManagerApprovalForPurchaseChange(String(payload.managerPin || '').trim(), auth);

    const updated = await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const purchase = await trx.selectFrom('purchases').selectAll().where('id', '=', purchaseId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
      if (!purchase) throw new AppError('Purchase not found', 'PURCHASE_NOT_FOUND', 404);
      if (purchase.status === 'cancelled') throw new AppError('Cancelled purchase cannot be edited', 'PURCHASE_CANCELLED', 400);
      // Posted GL journals are immutable. Do not mutate invoice stock/supplier balances without a
      // balancing correction document and journal.
      if (purchase.status === 'posted') {
        throw new AppError('لا يمكن تعديل فاتورة مشتريات مرحلة؛ استخدم مستند تصحيح أو مرتجعاً رسمياً', 'POSTED_PURCHASE_EDIT_FORBIDDEN', 422);
      }
      // This legacy edit flow reverses physical movements unconditionally; purchase-order-only
      // drafts have never posted stock/treasury, so edits need a separate metadata-only command.
      if (purchase.lifecycle_status === 'purchase_order' || purchase.status === 'draft') {
        throw new AppError('مسودة المشتريات تحتاج مسار تعديل منفصل دون عكس حركة مخزون أو قيد', 'PURCHASE_DRAFT_EDIT_UNSUPPORTED', 422);
      }
      if (purchase.lifecycle_status === 'grn_bill') throw new AppError('فاتورة GRN مرحّلة؛ يلزم إشعار دائن محاسبي للتعديل', 'GRNI_BILL_IMMUTABLE', 422);

      const oldItems = await trx.selectFrom('purchase_items').selectAll().where('purchase_id', '=', purchaseId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      // INV-SERVICE-ITEM-QUICK-CREATE: service lines never posted stock, so
      // an edit has nothing to reverse for them. Look their type up once.
      const oldServiceProductIds = new Set<number>();
      const oldLookupIds = oldItems.map((item) => Number(item.product_id)).filter((id) => id > 0);
      if (oldLookupIds.length) {
        const oldProducts = await trx.selectFrom('products').select(['id', 'item_type']).where('id', 'in', oldLookupIds).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
        for (const row of oldProducts) if (row.item_type === 'service') oldServiceProductIds.add(Number(row.id));
      }
      if (!(payload.items || []).length) throw new AppError('Purchase must include at least one item', 'PURCHASE_ITEMS_REQUIRED', 400);
      if (!(Number(payload.supplierId || 0) > 0)) throw new AppError('Supplier is required', 'SUPPLIER_REQUIRED', 400);
      await lockStockProducts(trx, { ...scope, productIds: [...oldItems.map((item) => Number(item.product_id)), ...(payload.items || []).map((item) => item.productId)] });
      oldItems.sort((a, b) => Number(a.product_id || 0) - Number(b.product_id || 0));
      for (const item of oldItems) {
        if (!item.product_id) continue;
        if (oldServiceProductIds.has(Number(item.product_id))) continue;
        const itemLocationId = item.location_id ?? purchase.location_id;
        const availableQty = await previewConsumableStockQty(trx, { productId: Number(item.product_id), branchId: purchase.branch_id, locationId: itemLocationId, tenantId: scope.tenantId, accountId: scope.accountId });
        const { removedQty: removeQty, beforeQty } = calculatePurchaseStockDecrease(item.qty, item.unit_multiplier, availableQty);
        if (beforeQty < removeQty) throw new AppError(`Cannot edit purchase because stock would go negative for product #${item.product_id}`, 'PURCHASE_EDIT_STOCK_INVALID', 400);
      }

      for (const item of oldItems) {
        if (!item.product_id) continue;
        if (oldServiceProductIds.has(Number(item.product_id))) continue;
        const itemLocationId = item.location_id ?? purchase.location_id;
        const availableQty = await previewConsumableStockQty(trx, { productId: Number(item.product_id), branchId: purchase.branch_id, locationId: itemLocationId, tenantId: scope.tenantId, accountId: scope.accountId });
        const { removedQty: removeQty, afterQty } = calculatePurchaseStockDecrease(item.qty, item.unit_multiplier, availableQty);
        ensureNonNegativeStock(afterQty, 'PURCHASE_EDIT_STOCK_INVALID', `Cannot edit purchase because stock would go negative for product #${item.product_id}`);
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
        await trx.insertInto('stock_movements').values({
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
        }).execute();
      }

      if (purchase.payment_type === 'credit' && purchase.supplier_id) {
        await this.financeService.addSupplierLedgerEntry(trx, purchase.supplier_id, -Number(purchase.total || 0), 'purchase_edit_restore', `${buildPurchaseReferenceNote('عكس فاتورة شراء', purchase)} قبل التعديل`, 'purchase', purchaseId, auth, purchase.branch_id, purchase.location_id);
      } else {
        await this.financeService.addTreasuryTransaction(trx, 'purchase_edit_restore', Number(purchase.total || 0), `${buildPurchaseReferenceNote('عكس فاتورة شراء', purchase)} قبل التعديل`, 'purchase', purchaseId, auth, purchase.branch_id, purchase.location_id);
      }

      await trx.deleteFrom('purchase_items').where('purchase_id', '=', purchaseId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      const supplier = await trx.selectFrom('suppliers').select(['id', 'name']).where('id', '=', payload.supplierId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('is_active', '=', true).executeTakeFirst();
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

      const settingsRaw = await trx.selectFrom('settings').selectAll().where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      const settings = settingsRaw.reduce<Record<string, unknown>>((acc, row) => { try { acc[row.key] = JSON.parse(row.value); } catch { acc[row.key] = row.value; } return acc; }, {});
      const activeLocs = await trx.selectFrom('stock_locations').select('id').where('is_active', '=', true).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      const activeLocationsCount = activeLocs.length;
      const singleActiveLocationId = activeLocationsCount === 1 ? activeLocs[0].id : null;
      const defaultReceivingLocationId = settings.currentLocationId ? Number(settings.currentLocationId) : null;

      for (const item of payload.items || []) {
        if (Number(item.cost || 0) <= 0 && !allowZeroPurchaseCost) {
          throw new AppError('Purchase item cost must be greater than zero', 'INVALID_PURCHASE_COST', 400);
        }
        const product = await trx.selectFrom('products').select(['id', 'name', 'stock_qty', 'item_type', 'item_kind', 'style_code', 'cost_price', 'retail_price', 'wholesale_price', 'default_location_id']).where('id', '=', item.productId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('is_active', '=', true).executeTakeFirst();
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);
        // INV-SERVICE-ITEM-QUICK-CREATE: a service line needs no receiving
        // location and posts no stock; only its amount is expensed.
        const isServiceLine = product.item_type === 'service';
        const incomingCost = Number(item.cost || 0);
        const originalCost = oldByProduct.has(Number(item.productId)) ? Number(oldByProduct.get(Number(item.productId)) || 0) : incomingCost;
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
      const totals = computeInvoiceTotals(subtotal, discount, Number(payload.taxRate || 0), Boolean(payload.pricesIncludeTax));
      const paymentType = payload.paymentType === 'credit' ? 'credit' : 'cash';

      const allocatedItems = allocatePurchaseInvoiceDiscount(normalizedItems, discount, moneyDigits);
      for (const normalizedItem of [...allocatedItems].sort((a, b) => a.productId - b.productId)) {
        const repricedCost = Number(normalizedItem.effectiveUnitCost || 0);
        const netRepricedCost = payload.pricesIncludeTax
          ? repricedCost / (1 + Number(payload.taxRate || 0) / 100)
          : repricedCost;

        await trx.insertInto('purchase_items').values({
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
        }).execute();

        // INV-SERVICE-ITEM-QUICK-CREATE: a service line posts no stock on
        // edit-apply either — only its purchase_items row above is written.
        if (!normalizedItem.isService) {
          const { increasedQty: increaseQty } = calculatePurchaseStockIncrease(normalizedItem.qty, normalizedItem.unitMultiplier, 0);
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
            await valueStockReceipt(trx, scope.tenantId, normalizedItem.productId, stockChange.globalAfter, increaseQty, increaseQty * baseUnitCost);
          }
          await trx.insertInto('stock_movements').values({
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
          }).execute();
        }
      }

      if (paymentType === 'credit') {
        await this.financeService.addSupplierLedgerEntry(trx, supplier.id, totals.total, 'purchase_edit_apply', buildPurchaseReferenceNote('تطبيق تعديل فاتورة شراء', purchase), 'purchase', purchaseId, auth, branchId, locationId);
      } else {
        await this.financeService.addTreasuryTransaction(trx, 'purchase_edit_apply', -totals.total, buildPurchaseReferenceNote('تطبيق تعديل فاتورة شراء', purchase), 'purchase', purchaseId, auth, branchId, locationId);
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
        .where((eb) =>
          eb.or([
            eb('created_at', '>=', ninetyDaysAgo),
            eb('supplier_invoice_no', 'is not', null),
          ]),
        )
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
      if (supplierInvoiceNo && historical.some((row) => normalizeBillNumber(row.supplierInvoiceNo) === supplierInvoiceNo)) {
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
            throw new AppError(
              'يجب إدخال سبب لتجاوز حظر الفاتورة المكررة',
              'DUPLICATE_OVERRIDE_REASON_REQUIRED',
              422,
            );
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
      } else if (duplicateCheck.hasSuspiciousDuplicates && !payload.confirmedDuplicateWarning && !payload.allowDuplicateOverride) {
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
          throw new AppError('مشروع الاستيراد المحدد غير موجود أو لا ينتمي لهذه المنشأة.', 'IMPORT_PROJECT_NOT_FOUND', 400);
        }
      }

      await trx.updateTable('purchases').set({
        supplier_id: supplier.id,
        payment_type: paymentType,
        subtotal: roundMoney(subtotal, moneyDigits),
        discount,
        tax_rate: Number(payload.taxRate || 0),
        tax_amount: totals.taxAmount,
        prices_include_tax: Boolean(payload.pricesIncludeTax),
        total: totals.total,
        supplier_invoice_no: normalizeBillNumber(payload.supplierInvoiceNo) || null,
        duplicate_override_reason: payload.allowDuplicateOverride ? String(payload.duplicateOverrideReason || '').trim() : null,
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
        import_project_id: payload.importProjectId !== undefined ? (payload.importProjectId || null) : undefined,
        terms_template: payload.termsTemplate || '',
        updated_at: sql`NOW()`,
      }).where('id', '=', purchaseId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      return {
        repricingInsights: this.buildPurchaseRepricingInsights(purchaseId, { id: Number(supplier.id), name: String(supplier.name || '') }, repricingCandidates),
      };
    });

    await this.audit.log('تعديل فاتورة شراء', `تم تعديل فاتورة شراء #${purchaseId} بواسطة ${auth.username}. السبب: ${editReason}`, auth);
    return this.buildPurchaseMutationResponse(purchaseId, auth, { repricingInsights: updated.repricingInsights });
  }

  async cancelPurchase(purchaseId: number, reason: string, auth: AuthContext, managerPin?: string): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    await this.assertManagerApprovalForPurchaseChange(String(managerPin || '').trim(), auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      const purchase = await trx.selectFrom('purchases').selectAll().where('id', '=', purchaseId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
      if (!purchase) throw new AppError('Purchase not found', 'PURCHASE_NOT_FOUND', 404);
      if (purchase.status === 'cancelled') throw new AppError('Purchase already cancelled', 'PURCHASE_ALREADY_CANCELLED', 400);
      if (purchase.lifecycle_status === 'purchase_order' || purchase.status === 'draft') {
        // No stock/treasury/journal was posted by an unreceived draft: only cancel the document.
        await trx.updateTable('purchases').set({
          status: 'cancelled',
          cancel_reason: String(reason || '').trim(),
          cancelled_by: auth.userId,
          cancelled_at: sql`NOW()`,
          updated_at: sql`NOW()`,
        }).where('id', '=', purchaseId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
        return;
      }
      if (purchase.lifecycle_status === 'grn_bill') throw new AppError('لا يمكن إلغاء فاتورة GRN بعد تسوية الاستحقاق؛ يلزم إشعار دائن محاسبي', 'GRNI_BILL_IMMUTABLE', 422);

      // Cancellation reverses the *entire* invoice. Once its cost is capitalised,
      // some debt is settled, or any line has been returned, that reversal would
      // double-reverse stock or supplier balances. Require adjustment documents.
      const existingReturn = await trx.selectFrom('return_documents').select('id')
        .where('return_type', '=', 'purchase').where('invoice_id', '=', purchaseId)
        .where('tenant_id', '=', scope.tenantId).limit(1).executeTakeFirst();
      if (existingReturn) throw new AppError('لا يمكن إلغاء فاتورة مشتريات لها مرتجعات؛ استخدم تسوية محاسبية', 'PURCHASE_CANCEL_HAS_RETURNS', 422);
      if (purchase.landed_cost_applied_at || Number(purchase.landed_cost_total || 0) > 0) {
        throw new AppError('لا يمكن إلغاء فاتورة مشتريات عليها مصاريف شراء محملة؛ يلزم مستند تصحيح', 'PURCHASE_CANCEL_HAS_LANDED_COST', 422);
      }
      if (purchase.payment_type === 'credit' && Number(purchase.paid_amount || 0) > 0.001) {
        throw new AppError('لا يمكن إلغاء فاتورة مشتريات آجل مسددة جزئياً أو كلياً؛ يلزم مستند تصحيح', 'PURCHASE_CANCEL_PARTIALLY_PAID', 422);
      }
      const scheduledSettlements = await trx.selectFrom('supplier_payment_schedules')
        .select([
          sql<number>`coalesce(sum(paid_amount), 0)`.as('paid'),
          sql<number>`count(*) filter (where status <> 'cancelled')`.as('active_count'),
        ])
        .where('purchase_id', '=', purchaseId).where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (Number(scheduledSettlements?.paid || 0) > 0.001) {
        throw new AppError('فاتورة الشراء عليها أقساط مورد مسددة؛ لا يمكن عكسها بإلغاء مباشر', 'PURCHASE_CANCEL_SCHEDULE_HAS_PAYMENTS', 422);
      }
      // Unpaid installment schedules are commitments, not financial entries.
      // Retire them atomically with the purchase to avoid ghost due payments.
      if (Number(scheduledSettlements?.active_count || 0) > 0) {
        await trx.updateTable('supplier_payment_schedules')
          .set({ status: 'cancelled', updated_by: auth.userId, updated_at: sql`NOW()` })
          .where('purchase_id', '=', purchaseId).where('tenant_id', '=', scope.tenantId)
          .where('status', '!=', 'cancelled').execute();
      }

      // Book digits for the WAC removal value below, resolved once on the
      // transaction handle like every other purchase posting path.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const items = await trx.selectFrom('purchase_items').selectAll().where('purchase_id', '=', purchaseId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      // INV-SERVICE-ITEM-QUICK-CREATE: service lines never posted stock, so
      // a cancel has nothing to reverse for them.
      const cancelServiceProductIds = new Set<number>();
      const cancelLookupIds = items.map((item) => Number(item.product_id)).filter((id) => id > 0);
      if (cancelLookupIds.length) {
        const cancelProducts = await trx.selectFrom('products').select(['id', 'item_type']).where('id', 'in', cancelLookupIds).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
        for (const row of cancelProducts) if (row.item_type === 'service') cancelServiceProductIds.add(Number(row.id));
      }
      await lockStockProducts(trx, { ...scope, productIds: items.map((item) => Number(item.product_id)) });
      for (const item of [...items].sort((a, b) => Number(a.product_id || 0) - Number(b.product_id || 0))) {
        if (!item.product_id) continue;
        if (cancelServiceProductIds.has(Number(item.product_id))) continue;
        // Traceable intake must be reversed with the stock movement and journal.
        const itemLocationId = item.location_id ?? purchase.location_id;
        const availableQty = await previewConsumableStockQty(trx, { productId: Number(item.product_id), branchId: purchase.branch_id, locationId: itemLocationId, tenantId: scope.tenantId, accountId: scope.accountId });
        const { removedQty: removeQty, beforeQty, afterQty } = calculatePurchaseStockDecrease(item.qty, item.unit_multiplier, availableQty);
        if (beforeQty < removeQty) throw new AppError(`Cannot cancel purchase because stock would go negative for product #${item.product_id}`, 'PURCHASE_CANCEL_STOCK_INVALID', 400);
        ensureNonNegativeStock(afterQty, 'PURCHASE_EDIT_STOCK_INVALID', `Cannot edit purchase because stock would go negative for product #${item.product_id}`);
        await reversePurchaseTrackedStock(trx, scope, {
          productId: Number(item.product_id), purchaseId, purchaseItemId: Number(item.id),
          locationId: itemLocationId, branchId: purchase.branch_id,
          quantity: removeQty, batchNumber: item.batch_number,
        });
        const stockChange = await applyStockDelta(trx, {
          productId: Number(item.product_id),
          delta: -removeQty,
          branchId: purchase.branch_id,
          locationId: itemLocationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          errorCode: 'PURCHASE_CANCEL_STOCK_INVALID',
          errorMessage: `Cannot cancel purchase because stock would go negative for product #${item.product_id}`,
          disableAutoDrain: true,
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
            throw new AppError('سعر تكلفة سطر الشراء الأصلي غير محفوظ؛ لا يمكن إلغاء الفاتورة دون إعادة حساب متوسط التكلفة', 'PURCHASE_CANCEL_COST_INVALID', 409);
          }
          const removedBaseUnitCost = purchaseReceiptBaseUnitCost(
            Number(item.unit_cost),
            Number(item.unit_multiplier ?? 1),
            Number(purchase.tax_rate || 0),
            Boolean(purchase.prices_include_tax),
          );
          await revalueStockReturn(trx, scope.tenantId, Number(item.product_id), stockChange.globalAfter, removeQty, roundMoney(removeQty * removedBaseUnitCost, moneyDigits));
        }
        await trx.insertInto('stock_movements').values({
          product_id: item.product_id,
          movement_type: 'purchase_cancel',
          qty: -removeQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: 'purchase_cancel',
          note: buildPurchaseReferenceNote('Cancel', purchase),
          reference_type: 'purchase',
          reference_id: purchaseId,
          branch_id: purchase.branch_id,
          location_id: itemLocationId,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).execute();
      }

      if (purchase.payment_type === 'credit' && purchase.supplier_id) {
        const supplier = await trx.selectFrom('suppliers').select(['balance'])
          .where('id', '=', purchase.supplier_id).where('tenant_id', '=', scope.tenantId)
          .forUpdate().executeTakeFirstOrThrow();
        if (Number(supplier.balance || 0) + 0.001 < Number(purchase.total || 0)) {
          throw new AppError('رصيد المورد لا يغطي عكس فاتورة الشراء بالكامل؛ راجع التسويات والمدفوعات', 'PURCHASE_CANCEL_SUPPLIER_BALANCE', 422);
        }
        await this.financeService.addSupplierLedgerEntry(trx, purchase.supplier_id, -Number(purchase.total || 0), 'purchase_cancel', buildPurchaseReferenceNote('إلغاء فاتورة شراء', purchase), 'purchase', purchaseId, auth, purchase.branch_id, purchase.location_id);
      } else {
        await this.financeService.addTreasuryTransaction(trx, 'purchase_cancel', Number(purchase.total || 0), buildPurchaseReferenceNote('إلغاء فاتورة شراء', purchase), 'purchase', purchaseId, auth, purchase.branch_id, purchase.location_id);
      }

      await trx.updateTable('purchases').set({
        status: 'cancelled',
        cancel_reason: String(reason || '').trim(),
        cancelled_by: auth.userId,
        cancelled_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      }).where('id', '=', purchaseId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      await this.accountingPosting.reversePurchaseJournal(trx, purchaseId, String(reason || '').trim(), auth);
    });

    await this.audit.log('إلغاء فاتورة شراء', `تم إلغاء فاتورة شراء #${purchaseId} بواسطة ${auth.username}`, auth);
    return this.buildPurchaseMutationResponse(purchaseId, auth);
  }

  async createSupplierPayment(payload: CreateSupplierPaymentDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const operationType = 'supplier_payment_create';
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const scale = 10 ** digits;
    if (idempotencyKey) {
      const existing = await this.idempotency.reserveOperation({
        tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
        requestHash: this.idempotency.generateRequestHash(payload),
      });
      if (existing?.status === 'committed') {
        return { ok: true, supplierPayments: (await this.queryService.listSupplierPayments(auth)).supplierPayments };
      }
      if (existing?.status === 'processing') throw new AppError('Payment is currently processing', 'PAYMENT_PROCESSING', 409);
      if (existing?.status === 'failed') throw new AppError(existing.errorCode || 'Payment previously failed', 'PAYMENT_IDEMPOTENCY_FAILED', 400);
      if (existing?.status === 'recovery_required') throw new AppError('Payment requires manual recovery', 'PAYMENT_RECOVERY_REQUIRED', 422);
    }
    try {
    const paymentResult = await this.tx.runInTransaction(this.db, async (trx) => {
      const supplier = await trx.selectFrom('suppliers').select(['id', 'name', 'balance']).where('id', '=', payload.supplierId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('is_active', '=', true).forUpdate().executeTakeFirst();
      if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);
      const amount = Number(payload.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * scale - Math.round(amount * scale)) > 0.000001) {
        throw new AppError('Supplier payment must be positive and have at most tenant currency minor-unit precision', 'INVALID_AMOUNT', 400);
      }
      const currentBalance = Number(supplier.balance || 0);
      if (!(currentBalance > 0)) throw new AppError('Supplier has no outstanding balance', 'SUPPLIER_NO_BALANCE', 400);
      if (amount > currentBalance + 0.0001) throw new AppError('Supplier payment cannot exceed outstanding balance', 'SUPPLIER_OVERPAYMENT', 400);
      // Amounts reserved by active installment schedules are not free supplier
      // debt. Otherwise an ordinary payment can settle the same payable while
      // its installment remains outstanding, leaving duplicate obligations.
      const reservedSchedules = await trx.selectFrom('supplier_payment_schedules')
        .select(sql<number>`coalesce(sum(greatest(amount - paid_amount, 0)), 0)`.as('reserved'))
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .where('supplier_id', '=', supplier.id)
        .where('status', '!=', 'cancelled').executeTakeFirst();
      const unrestrictedBalance = Math.max(0, Math.round((currentBalance - Number(reservedSchedules?.reserved || 0)) * scale) / scale);
      if (amount > unrestrictedBalance + 0.0001) {
        throw new AppError('جزء من رصيد المورد محجوز في أقساط؛ سددها من جدول الأقساط أو استخدم الرصيد غير المجدول',
          'SUPPLIER_PAYMENT_SCHEDULE_RESERVED', 409);
      }

      // Gateway: three-way match must not be blocking.
      // The match previously only wrote a status label on the invoice; nothing consulted it, so an
      // invoice flagged quantity_mismatch (billed more than was received) was paid without friction.
      await this.financeService.assertNoBlockingThreeWayMatch(trx, supplier.id, scope.tenantId);

      const { branchId, locationId } = normalizePurchaseScope(payload);

      const insert = await trx
        .insertInto('supplier_payments')
        .values({
          supplier_id: supplier.id,
          amount,
          payment_channel: payload.paymentChannel || 'cash',
          instapay_address: normalizeInstapayAddress(payload.paymentChannel, payload.instapayAddress),
          note: normalizeOptionalNote(payload.note),
          branch_id: branchId,
          location_id: locationId,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const id = Number(insert.id);
      const docNo = await this.generateSupplierPaymentDocNo(trx, id, scope.tenantId);
      await trx.updateTable('supplier_payments').set({ doc_no: docNo }).where('id', '=', id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      const paymentNote = normalizeOptionalNote(payload.note);
      await this.financeService.addSupplierLedgerEntry(trx, supplier.id, -amount, 'supplier_payment', `دفع إلى ${supplier.name}${paymentNote ? ` - ${paymentNote}` : ''}`, 'supplier_payment', id, auth, branchId, locationId);
      await this.financeService.addTreasuryTransaction(trx, 'supplier_payment', -amount, `دفع إلى ${supplier.name}${paymentNote ? ` - ${paymentNote}` : ''}`, 'supplier_payment', id, auth, branchId, locationId, payload.paymentChannel || 'cash');
      const posting = await this.accountingPosting.postSupplierPayment(trx, id, auth);
      if (!posting.journalEntryId) throw new AppError(`Supplier payment ${id} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
      await this.audit.logWithExecutor(trx, 'دفع لمورد', `تم تسجيل دفع لمورد ${docNo} بواسطة ${auth.username}`, auth);
      if (idempotencyKey) {
        await this.idempotency.commitOperation(trx, {
          tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
        }, { id, docNo }, String(id));
      }
      return { id, docNo };
    });

    return { ok: true, supplierPayments: (await this.queryService.listSupplierPayments(auth)).supplierPayments };
    } catch (error) {
      if (idempotencyKey) {
        if (error instanceof AppError && error.statusCode < 500) {
          await this.idempotency.recordFailure({ tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType }, error.code).catch(() => undefined);
        } else {
          await this.db.updateTable('operation_executions')
            .set({ status: 'recovery_required', updated_at: sql`CURRENT_TIMESTAMP` })
            .where('tenant_id', '=', scope.tenantId).where('account_id', '=', scope.accountId)
            .where('idempotency_key', '=', idempotencyKey).where('operation_type', '=', operationType)
            .where('status', '=', 'processing').where('document_id', 'is', null).execute().catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async createCustomerPayment(payload: CreateCustomerPaymentDto, auth: AuthContext, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const amount = Number(payload.amount);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const scale = 10 ** digits;
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * scale - Math.round(amount * scale)) > 0.000001) {
      throw new AppError('Customer payment must be positive and have at most tenant currency minor-unit precision', 'INVALID_PAYMENT_AMOUNT', 400);
    }
    // INV-REP-NONCASH-EVIDENCE-GATE (PD1): refuse a non-cash general
    // receipt with no real transfer reference BEFORE any idempotency
    // reservation, ledger write or Dr 1120 posting. A free-text note
    // alone is not evidence. Cash receipts are untouched.
    assertNonCashTransferReference(payload.paymentChannel, payload.transferReference);
    const operationType = 'customer_payment_create';
    if (idempotencyKey) {
      const existing = await this.idempotency.reserveOperation({
        tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
        requestHash: this.idempotency.generateRequestHash(payload),
      });
      if (existing?.status === 'committed') {
        const recorded = existing.responsePayload as Record<string, unknown> | undefined;
        if (recorded?.id) return { ok: true, ...recorded };
        throw new AppError('Customer payment result requires reconciliation', 'PAYMENT_RECOVERY_REQUIRED', 422);
      }
      if (existing?.status === 'processing') throw new AppError('Payment is currently processing', 'PAYMENT_PROCESSING', 409);
      if (existing?.status === 'failed') throw new AppError(existing.errorCode || 'Payment previously failed', 'PAYMENT_IDEMPOTENCY_FAILED', 400);
      if (existing?.status === 'recovery_required') throw new AppError('Payment requires manual recovery', 'PAYMENT_RECOVERY_REQUIRED', 422);
    }
    try {
    const paymentResult = await this.tx.runInTransaction(this.db, async (trx) => {
      const customer = await trx
        .selectFrom('customers')
        .select(['id', 'name', 'balance'])
        .where('id', '=', payload.customerId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);

      const currentBalance = Number(customer.balance || 0);
      const { branchId, locationId } = normalizePurchaseScope(payload);

      let targetJobId: number | null = payload.jobId ? Number(payload.jobId) : null;

      // Explicit payment-to-job linkage must be verified before the receipt or ledger is posted.
      // Auto-match jobs are also checked under the same lock, so concurrent receipts cannot
      // overwrite client_paid_total using a stale snapshot.
      let verifiedJob: { job_number: string | null; client_invoiced_total: number | string | null; client_paid_total: number | string | null } | null = null;

      // Smart Auto-Match: If no explicit job specified, check if customer has exactly ONE active maritime job needing payment
      if (!targetJobId) {
        try {
          const activeJobs = await trx
            .selectFrom('maritime_jobs')
            .select(['id', 'job_number', 'client_invoiced_total', 'client_paid_total', 'payment_status'])
            .where('tenant_id', '=', scope.tenantId)
            .where('customer_id', '=', customer.id)
            .where('status', '=', 'active')
            .where('payment_status', '!=', 'paid')
            .execute();

          if (activeJobs.length === 1) {
            targetJobId = Number(activeJobs[0].id);
          }
        } catch {
          // Ignore if table not ready
        }
      }

      if (targetJobId) {
        const job = await trx
          .selectFrom('maritime_jobs')
          .select(['id', 'job_number', 'customer_id', 'client_invoiced_total', 'client_paid_total'])
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', String(targetJobId))
          .forUpdate()
          .executeTakeFirst();
        if (!job) throw new AppError('Maritime job not found', 'MARITIME_JOB_NOT_FOUND', 404);
        assertCustomerPaymentJobOwnership(Number(customer.id), job.customer_id);
        verifiedJob = job;
      }

      const insert = await trx
        .insertInto('customer_payments')
        .values({
          customer_id: customer.id,
          amount,
          payment_channel: payload.paymentChannel || 'cash',
          instapay_address: normalizeInstapayAddress(payload.paymentChannel, payload.instapayAddress),
          transfer_reference: normalizeTransferReference(payload.paymentChannel, payload.transferReference),
          note: normalizeOptionalNote(payload.note),
          branch_id: branchId,
          location_id: locationId,
          job_id: targetJobId || null,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const paymentId = Number(insert.id);
      const paymentNote = normalizeOptionalNote(payload.note);
      const isAdvance = currentBalance <= 0;
      const isOverpayment = currentBalance > 0 && amount > currentBalance;
      const descPrefix = isAdvance
        ? `دفعة مقدمة / عربون من العميل ${customer.name}`
        : isOverpayment
          ? `تحصيل وسداد مع دفعة مقدمة من العميل ${customer.name}`
          : `تحصيل من العميل ${customer.name}`;

      const fullDesc = `${descPrefix}${paymentNote ? ` - ${paymentNote}` : ''}`;
      await this.financeService.addCustomerLedgerEntry(trx, customer.id, -amount, fullDesc, 'customer_payment', paymentId, auth, branchId, locationId);
      await this.financeService.addTreasuryTransaction(trx, 'customer_payment', amount, fullDesc, 'customer_payment', paymentId, auth, branchId, locationId, payload.paymentChannel || 'cash');
      const posting = await this.accountingPosting.postCustomerPayment(trx, paymentId, auth);
      if (!posting.journalEntryId) throw new AppError(`Customer payment ${paymentId} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);

      const docNo = await this.generateCustomerPaymentDocNo(trx, scope.tenantId, paymentId);

      let allocatedJobNumber: string | null = null;
      if (verifiedJob && targetJobId) {
        allocatedJobNumber = verifiedJob.job_number;
        const currentPaid = Number(verifiedJob.client_paid_total || 0);
        const newPaid = currentPaid + amount;
        const invoiced = Number(verifiedJob.client_invoiced_total || 0);
        const newPaymentStatus = (invoiced > 0 && newPaid >= invoiced) ? 'paid' : (newPaid > 0 ? 'partially_paid' : 'unpaid');

        await trx
          .updateTable('maritime_jobs')
          .set({
            client_paid_total: newPaid,
            payment_status: newPaymentStatus,
            paid_at: newPaymentStatus === 'paid' ? sql`NOW()` : null,
            updated_at: sql`NOW()`,
          } as any)
          .where('id', '=', String(targetJobId))
          .where('tenant_id', '=', scope.tenantId)
          .where('customer_id', '=', customer.id)
          .execute();

        await trx
          .insertInto('maritime_job_milestones')
          .values({
            tenant_id: scope.tenantId,
            job_id: String(targetJobId),
            milestone_key: 'PAYMENT',
            milestone_title: `سداد مالي: سند قبض #${docNo} (${newPaymentStatus === 'paid' ? 'مسدد بالكامل' : 'سداد جزئي'})`,
            location: 'الخزينة والحسابات',
            notes: `تم ربط وتخصيص دفعة نقدية بقيمة ${amount} ج.م من سند القبض ${docNo} للشحنة ${verifiedJob.job_number}`,
            recorded_by: auth.userId ? Number(auth.userId) : null,
          } as any)
          .execute();
      }

      const receipt = {
        id: paymentId,
        docNo,
        customerId: customer.id,
        customerName: customer.name,
        amount,
        balanceBefore: currentBalance,
        balanceAfter: currentBalance - amount,
        note: paymentNote,
        jobId: targetJobId,
        jobNumber: allocatedJobNumber,
        createdAt: new Date().toISOString(),
      };
      // The audit record is part of the same atomic voucher transaction; an
      // audit failure cannot turn an already-posted payment into an HTTP failure.
      await this.audit.logWithExecutor(trx, 'سند قبض / تحصيل عميل',
        `تم تسجيل سند قبض ${docNo} للعميل ${customer.name} بمبلغ ${amount} بواسطة ${auth.username}`, auth);
      // Commit the operation and the financial voucher in the SAME DB transaction.
      if (idempotencyKey) {
        await this.idempotency.commitOperation(trx, {
          tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
        }, receipt, String(paymentId));
      }
      return receipt;
    });

    return { ok: true, ...paymentResult };
    } catch (error) {
      if (idempotencyKey) {
        if (error instanceof AppError && error.statusCode < 500) {
          await this.idempotency.recordFailure({
            tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType,
          }, error.code).catch(() => undefined);
        } else {
          await this.db.updateTable('operation_executions')
            .set({ status: 'recovery_required', updated_at: sql`CURRENT_TIMESTAMP` })
            .where('tenant_id', '=', scope.tenantId).where('account_id', '=', scope.accountId)
            .where('idempotency_key', '=', idempotencyKey).where('operation_type', '=', operationType)
            .where('status', '=', 'processing').where('document_id', 'is', null).execute().catch(() => undefined);
        }
      }
      throw error;
    }
  }

  private async generatePurchaseDocNo(trx: Kysely<Database>, purchaseId: number, tenantId: string): Promise<string> {
    const settingRow = await trx
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'invoiceNumberingScheme')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    let scheme = 'daily';
    if (settingRow?.value) {
      try {
        scheme = JSON.parse(settingRow.value);
      } catch {
        scheme = String(settingRow.value);
      }
    }

    if (scheme === 'sequential') {
      return `ZP-${purchaseId}`;
    }

    // Daily date-based numbering: ZP-YYMMDD-0001
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(purchaseId).padStart(6, '0');
    return `ZP-${datePrefix}-${seq}`;
  }

  private async generateSupplierPaymentDocNo(trx: Kysely<Database>, paymentId: number, tenantId: string): Promise<string> {
    const settingRow = await trx
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'invoiceNumberingScheme')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    let scheme = 'daily';
    if (settingRow?.value) {
      try {
        scheme = JSON.parse(settingRow.value);
      } catch {
        scheme = String(settingRow.value);
      }
    }

    if (scheme === 'sequential') {
      return `ZPV-${paymentId}`;
    }

    // Daily date-based numbering: ZPV-YYMMDD-0001
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(paymentId).padStart(6, '0');
    return `ZPV-${datePrefix}-${seq}`;
  }

  private async generateCustomerPaymentDocNo(trx: Kysely<Database>, tenantId: string, paymentId: number): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(paymentId).padStart(6, '0');
    return `REC-${datePrefix}-${seq}`;
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
          await trx.selectFrom('purchase_orders').select('id')
            .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(purchase.po_id))
            .forUpdate().executeTakeFirstOrThrow();
        }
        const postedReceipt = purchase.grn_id
          ? await trx.selectFrom('goods_receipt_notes').select(['id', 'status'])
            .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(purchase.grn_id))
            .forUpdate().executeTakeFirst()
          : await trx.selectFrom('goods_receipt_notes').select(['id', 'status'])
            .where('tenant_id', '=', scope.tenantId).where('purchase_order_id', '=', Number(purchase.po_id))
            .where('status', '=', 'posted').limit(1).executeTakeFirst();
        if (postedReceipt?.status === 'posted') {
          throw new AppError('The linked GRN already posted stock; receiving this bill would post it twice', 'PURCHASE_STOCK_ALREADY_RECEIVED', 409);
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

      if (!receivedItems.length) throw new AppError('Receipt must contain at least one line', 'PURCHASE_RECEIPT_EMPTY', 400);
      const seenItemIds = new Set<number>();
      let receiptQty = 0;
      for (const rec of receivedItems) {
        const itemId = Number(rec.itemId);
        const item = itemsMap.get(itemId);
        if (!item) throw new AppError(`Purchase item ${itemId} not found`, 'ITEM_NOT_FOUND', 404);
        if (seenItemIds.has(itemId)) throw new AppError('Duplicate purchase receipt line', 'PURCHASE_RECEIPT_DUPLICATE_LINE', 400);
        seenItemIds.add(itemId);
        const qty = Number(rec.receivedQty);
        const alreadyReceived = Number(item.received_qty || 0);
        const ordered = Number(item.qty || 0);
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(ordered) ||
            alreadyReceived + qty > ordered + 0.0001) {
          throw new AppError('Received quantity must be positive and cannot exceed ordered quantity', 'PURCHASE_RECEIPT_QTY_INVALID', 400);
        }
        receiptQty += qty;
      }
      const totalRemaining = existingItems.reduce((sum, item) =>
        sum + Math.max(0, Number(item.qty || 0) - Number(item.received_qty || 0)), 0);
      if (purchase.status === 'draft' && receiptQty + 0.0001 < totalRemaining) {
        throw new AppError('Partial receipts require a GRN so each stock movement has its own accrual journal', 'PURCHASE_PARTIAL_RECEIPT_REQUIRES_GRN', 422);
      }

      await lockStockProducts(trx, {
        ...scope,
        productIds: receivedItems.map((rec) => Number(itemsMap.get(rec.itemId)?.product_id)),
      });

      for (const rec of [...receivedItems].sort((a, b) => Number(itemsMap.get(a.itemId)?.product_id || 0) - Number(itemsMap.get(b.itemId)?.product_id || 0))) {
        const item = itemsMap.get(rec.itemId);
        if (!item) {
          throw new AppError(`Purchase item ${rec.itemId} not found`, 'ITEM_NOT_FOUND', 404);
        }

        const qtyToReceive = Number(rec.receivedQty || 0);
        const currentReceived = Number(item.received_qty || 0);
        const newReceivedQty = currentReceived + qtyToReceive;
        const unitMultiplier = Number(item.unit_multiplier ?? 1);
        const effectiveUnitCost = purchaseReceiptBaseUnitCost(
          Number(item.unit_cost), unitMultiplier, Number(purchase.tax_rate || 0), Boolean(purchase.prices_include_tax),
        );

        await trx
          .updateTable('purchase_items')
          .set({ received_qty: newReceivedQty } as any)
          .where('id', '=', item.id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

        item.received_qty = newReceivedQty;

        const itemSerials = Array.isArray(rec.serials) ? rec.serials : [];
        if (itemSerials.length > 0) {
          const serialRows = itemSerials.map((s: any) => {
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
          }).filter((r) => r.serial_number);

          if (serialRows.length > 0) {
            await trx.insertInto('product_serials').values(serialRows as any).execute();
          }
        }

        const { increasedQty } = calculatePurchaseStockIncrease(qtyToReceive, unitMultiplier, 0);
        const itemLocationId = item.location_id ?? purchase.location_id;
        const branchId = purchase.branch_id;

        const stockChange = await applyStockDelta(trx, {
          productId: Number(item.product_id),
          delta: increasedQty,
          branchId: branchId ? Number(branchId) : undefined,
          locationId: itemLocationId ? Number(itemLocationId) : undefined,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
        });

        // INV-WAC-SINGLE-WRITER: every receipt blends through the one
        // writer (quantity recovery + algebraic blend + write). A
        // zero-quantity line writes nothing: no receipt to blend and
        // the stored cost is unchanged. The product row is locked by
        // the stock delta above, so the writer's read cannot miss it.
        if (increasedQty > 0) {
          await valueStockReceipt(trx, scope.tenantId, item.product_id, stockChange.globalAfter, increasedQty, increasedQty * effectiveUnitCost);
        }

        await trx.insertInto('stock_movements').values({
          product_id: item.product_id,
          movement_type: 'purchase_receipt',
          qty: increasedQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          unit_cost: Number(effectiveUnitCost.toFixed(6)),
          total_cost: roundMoney(effectiveUnitCost * increasedQty, currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId))),
          reason: 'purchase_receipt',
          note: `استلام بضاعة لأمر شراء PUR-${purchaseId}`,
          reference_type: 'purchase',
          reference_id: purchaseId,
          branch_id: branchId ? Number(branchId) : undefined,
          location_id: itemLocationId ? Number(itemLocationId) : undefined,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any).execute();
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
          receivedByPoItem.set(poItemId, Number(((receivedByPoItem.get(poItemId) || 0) + Number(rec.receivedQty || 0)).toFixed(3)));
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
      const matchedStatus = isFullyReceived ? 'matched' : (totalReceived > 0 ? 'partial' : 'pending');

      await trx
        .updateTable('purchases')
        .set({
          lifecycle_status: lifecycleStatus,
          matched_status: matchedStatus,
          status: 'posted',
          updated_at: sql`NOW()`,
        } as any)
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
