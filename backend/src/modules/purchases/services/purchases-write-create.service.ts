/**
 * PurchasesWriteCreateService — slice S3 of the purchases-write split.
 * Pure move of the create group from PurchasesWriteService (createPurchase
 * plus the in-slice helpers validateAtReceiptLandedCosts,
 * allocateAtReceiptLandedCosts and generatePurchaseDocNo). No behavior
 * change: the bodies are byte-identical; the facade keeps one thin delegate
 * for createPurchase with the same name and signature. The three private
 * helpers stay private in the slice — their only caller is createPurchase.
 * Deps are db, tx, audit, financeService, accountingPosting, idempotency
 * plus the bound cross-slice methods from the repricing and shared-helpers
 * slices, reached through the facade own bound methods. No logger.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { upsertInventoryBatchFromReceipt } from '../helpers/inventory-batch-receipt.helper';
import { computeInvoiceTotals } from '../../../common/utils/invoice-totals';
import { allocateLandedCosts } from '../engines/landed-cost-allocation.engine';
import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import {
  checkClientBusinessDay,
  CLIENT_BUSINESS_DATE_FUTURE_DAYS,
} from '../../../common/utils/client-date-bounds.util';
import { ensureUniqueFlowItems } from '../../../common/utils/financial-integrity';
import { lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { recordStockMovement } from '../../../common/utils/stock-movement-writer';
import { Database } from '../../../database/database.types';
import { UpsertPurchaseDto } from '../dto/upsert-purchase.dto';
import {
  allocatePurchaseInvoiceDiscount,
  buildNormalizedPurchaseItem,
  calculatePurchaseStockIncrease,
  calculatePurchaseSubtotal,
  normalizeOptionalNote,
  normalizePurchaseScope,
  type DiscountAllocatedPurchaseItem,
} from '../helpers/purchases-write.helper';
import {
  detectDuplicateBills,
  normalizeBillNumber,
  type HistoricalPurchaseRecord,
} from '../engines/duplicate-bill-detector.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  fromMinorUnits,
  roundMoney,
  toMinorUnits,
} from '../../accounting/engines/money-minor-units.engine';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { AuditService } from '../../../core/audit/audit.service';
import { PurchasesFinanceService } from './purchases-finance.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import type {
  PurchaseRepricingCandidate,
  PurchaseRepricingProduct,
  PurchaseRepricingInsights,
} from './purchases-write.types';

export interface PurchasesWriteCreateDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  financeService: PurchasesFinanceService;
  accountingPosting: AccountingPostingService;
  idempotency: IdempotencyService;
  // Bound cross-slice deps (S10 form): the facade binds its own delegate
  // methods so this slice stays standalone-compilable. The repricing
  // methods live in S1; the permission/response helpers live in S2.
  buildPurchaseRepricingCandidate: (product: PurchaseRepricingProduct, newCost: number) => PurchaseRepricingCandidate;
  buildPurchaseRepricingInsights: (
    purchaseId: number,
    supplier: { id: number; name: string },
    candidates: PurchaseRepricingCandidate[],
    moneyDigits?: 2 | 3,
  ) => PurchaseRepricingInsights | null;
  hasPermission: (auth: AuthContext, permission: string) => boolean;
  buildPurchaseMutationResponse: (
    purchaseId: number,
    auth: AuthContext,
    extras?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}

@Injectable()
export class PurchasesWriteCreateService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly financeService: PurchasesFinanceService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly idempotency: IdempotencyService;
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
  private readonly hasPermission: (auth: AuthContext, permission: string) => boolean;
  private readonly buildPurchaseMutationResponse: (
    purchaseId: number,
    auth: AuthContext,
    extras?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;

  constructor(deps: PurchasesWriteCreateDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.financeService = deps.financeService;
    this.accountingPosting = deps.accountingPosting;
    this.idempotency = deps.idempotency;
    this.buildPurchaseRepricingCandidate = deps.buildPurchaseRepricingCandidate;
    this.buildPurchaseRepricingInsights = deps.buildPurchaseRepricingInsights;
    this.hasPermission = deps.hasPermission;
    this.buildPurchaseMutationResponse = deps.buildPurchaseMutationResponse;
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
    costs: Array<{
      costType: 'freight' | 'customs' | 'handling' | 'insurance' | 'other';
      description: string;
      amount: number;
      vendorId: number | null;
    }>;
  } | null {
    if (!landedCosts || !Array.isArray(landedCosts.costs) || !landedCosts.costs.length) return null;
    if (lifecycleStatus === 'purchase_order') {
      throw new AppError(
        'لا يمكن تحميل شحن على أمر شراء قبل الاستلام؛ أضف الشحن عند إنشاء فاتورة الشراء.',
        'PURCHASE_LANDED_COST_UNSUPPORTED_DOCUMENT',
        400,
      );
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
        throw new AppError(
          'الشحن في الفاتورة نفسها يكون من مورد الفاتورة؛ شحن مورد آخر يضاف بعد الترحيل من خطوة تكاليف الوصول.',
          'PURCHASE_LANDED_COST_VENDOR_MISMATCH',
          400,
        );
      }
      return {
        costType: cost.costType,
        description: String(cost.description).trim(),
        amount: Number(cost.amount),
        vendorId,
      };
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
    const stocked = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.isService);
    if (!stocked.length) {
      throw new AppError(
        'الشحن يحتاج صنفاً مخزنياً واحداً على الأقل في الفاتورة؛ سطور الخدمة وحدها لا تحمل تكلفة وصول.',
        'PURCHASE_LANDED_COST_NO_STOCKED_ITEMS',
        400,
      );
    }
    const weights = stocked.map(({ item }) => {
      if (landed.allocationMethod === 'qty')
        return Math.max(0, Number(item.qty || 0) * Number(item.unitMultiplier || 1));
      if (landed.allocationMethod === 'equal') return 1;
      return Math.max(0, Number(item.effectiveLineTotal || 0));
    });
    const shares = allocateLandedCosts(landed.total, weights, moneyDigits);
    const result = new Map<number, number>();
    stocked.forEach(({ index }, i) => result.set(index, shares[i]));
    return result;
  }

  async createPurchase(
    payload: UpsertPurchaseDto,
    auth: AuthContext,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);

    // Bound the client-supplied requested delivery date to the P6
    // sales-order delivery window [today, today+365] in the tenant zone.
    // A DTO Date built from a date-only string is UTC-midnight: the UTC
    // day IS the intended calendar day, so check the UTC day string —
    // rendering that instant in the tenant zone would shift west-of-UTC
    // tenants a day early. Absent requiredDate keeps the existing
    // fallbacks (duplicate check uses now, store uses null).
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
        return this.buildPurchaseMutationResponse(purchaseId, auth, {
          repricingInsights: cached.repricingInsights || null,
        });
      }
      if (existingResult?.status === 'failed') {
        throw new AppError(
          existingResult.errorCode || 'Operation previously failed',
          'PURCHASE_IDEMPOTENCY_FAILED',
          400,
        );
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
        const supplier = await trx
          .selectFrom('suppliers')
          .select(['id', 'name'])
          .where('id', '=', payload.supplierId)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true)
          .forUpdate()
          .executeTakeFirst();
        if (!supplier) throw new AppError('Supplier not found', 'SUPPLIER_NOT_FOUND', 404);

        const items = payload.items || [];
        if (!items.length)
          throw new AppError('Purchase must include at least one item', 'PURCHASE_ITEMS_REQUIRED', 400);
        ensureUniqueFlowItems(
          items,
          'PURCHASE_DUPLICATE_PRODUCT',
          'Purchase must not contain duplicate product rows with the same unit and cost',
        );
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
          try {
            allowZeroPurchaseCost = JSON.parse(allowZeroRow.value) === true;
          } catch {
            allowZeroPurchaseCost = String(allowZeroRow.value).toLowerCase() === 'true';
          }
        }

        const defaultReceivingLocationRow = settingsResult.find((r) => r.key === 'currentLocationId');
        const defaultReceivingLocationId = defaultReceivingLocationRow?.value
          ? Number(defaultReceivingLocationRow.value)
          : null;

        const activeLocations = await trx
          .selectFrom('stock_locations')
          .select('id')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true)
          .where((eb) => eb.or([eb('location_type', 'is', null), eb('location_type', '!=', 'in_transit')]))
          .execute();
        const singleActiveLocationId = activeLocations.length === 1 ? Number(activeLocations[0].id) : null;

        for (const item of items) {
          if (Number(item.cost || 0) <= 0 && !allowZeroPurchaseCost) {
            throw new AppError('Purchase item cost must be greater than zero', 'INVALID_PURCHASE_COST', 400);
          }
          const product = await trx
            .selectFrom('products')
            .select([
              'id',
              'name',
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
        const { taxAmount, total: itemsTotal } = computeInvoiceTotals(
          subtotal,
          discount,
          Number(payload.taxRate || 0),
          Boolean(payload.pricesIncludeTax),
        );
        // INV-LANDED-COST-ALLOCATION: freight on the invoice is part of
        // the supplier bill, so the invoice total — and the inventory
        // debit postPurchase derives from it — includes it. Freight is
        // never taxed: it is added after the tax computation.
        const atReceiptLanded = this.validateAtReceiptLandedCosts(
          payload.landedCosts,
          moneyDigits,
          supplier.id,
          payload.lifecycleStatus,
        );
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
            total,
            date: payload.requiredDate || new Date(),
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
            duplicate_override_reason: payload.allowDuplicateOverride
              ? String(payload.duplicateOverrideReason || '').trim()
              : null,
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
        await trx
          .updateTable('purchases')
          .set({ doc_no: docNo, updated_at: sql`NOW()` })
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

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
          const insertedItem = await trx
            .insertInto('purchase_items')
            .values({
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
              ...(atReceiptLanded
                ? {
                    allocated_landed_cost: allocatedFreight,
                    landed_unit_cost: Number(
                      (netPurchaseUnitCost + (item.qty > 0 ? allocatedFreight / item.qty : 0)).toFixed(6),
                    ),
                  }
                : {}),
            } as any)
            .returning('id')
            .executeTakeFirst();

          const itemLocationId = item.locationId!;
          const isPurchaseOrderOnly = payload.lifecycleStatus === 'purchase_order';
          // INV-SERVICE-ITEM-QUICK-CREATE: services have no serials and no stock.
          if (itemSerials.length > 0 && !isPurchaseOrderOnly && !item.isService) {
            const serialRows = itemSerials
              .map((s: any) => {
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
              })
              .filter((r) => r.serial_number);

            if (serialRows.length > 0) {
              await trx
                .insertInto('product_serials')
                .values(serialRows as any)
                .execute();
            }
          }

          // INV-SERVICE-ITEM-QUICK-CREATE: a service line posts no stock at
          // all — no receipt, no WAC blend, no stock movement, no pharmacy
          // batch. Its amount is expensed by postPurchase instead.
          if (!isPurchaseOrderOnly && !item.isService) {
            const { increasedQty } = calculatePurchaseStockIncrease(item.qty, item.unitMultiplier, 0);
            // Inventory cost is per base stock unit, not per purchased carton.
            const baseUnitCost = netPurchaseUnitCost / item.unitMultiplier;
            // INV-LANDED-COST-ALLOCATION: freight carried on the invoice
            // blends into the receipt value, so the WAC reflects the true
            // landed cost instead of the bare item cost.
            const landedBaseUnitCost =
              allocatedFreight > 0 && increasedQty > 0 ? baseUnitCost + allocatedFreight / increasedQty : baseUnitCost;
            // Phase 1 A10: the row goes through recordStockMovement
            // (composite mode) — the bare total at book digits plus the
            // exact freight share, computed once by the writer. The total
            // is computed from the BARE base unit (totalUnitCost), not
            // the landed 6dp unit: roundMoney(increasedQty x baseUnit)
            // equals roundMoney(netUnit x qty) (BF1, 2M lines), so the
            // stored total is identical to the old spelling to the
            // piastre, and the stored unit stays the landed 6dp unit.
            const stockChange = await recordStockMovement(trx, {
              productId: item.productId,
              delta: increasedQty,
              branchId,
              locationId: itemLocationId,
              tenantId: scope.tenantId,
              accountId: scope.accountId,
              movementType: 'purchase',
              unitCost: Number(landedBaseUnitCost.toFixed(6)),
              totalUnitCost: baseUnitCost,
              freightShare: allocatedFreight,
              moneyDigits,
              referenceType: 'purchase',
              referenceId: id,
              reason: 'purchase',
              note: `فاتورة شراء PUR-${id}`,
              createdBy: auth.userId,
            });

            // INV-WAC-SINGLE-WRITER: every receipt blends through the one
            // writer (quantity recovery + algebraic blend + write). A
            // zero-quantity line writes nothing: no receipt to blend and
            // the stored cost is unchanged.
            if (increasedQty > 0) {
              await valueStockReceipt(
                trx,
                scope.tenantId,
                item.productId,
                stockChange.globalAfter,
                increasedQty,
                increasedQty * landedBaseUnitCost,
              );
            }
            const batchNo = item.batchNumber ? String(item.batchNumber).trim() : '';
            const expiryDate = item.expiryDate ? String(item.expiryDate).trim() : '';
            const drug = await trx
              .selectFrom('pharmacy_drugs')
              .select('id')
              .where('tenant_id', '=', scope.tenantId)
              .where('product_id', '=', item.productId)
              .executeTakeFirst();
            if (drug && (!batchNo || !expiryDate)) {
              throw new AppError(
                'الصنف الدوائي يتطلب رقم تشغيلة وتاريخ صلاحية عند الاستلام',
                'PHARMACY_BATCH_REQUIRED',
                422,
              );
            }
            // INV-VAN-GENERIC-FEFO: drug-linked products keep the pharmacy
            // ledger above; every other product with a batch number lands
            // in the generic ledger.
            if (batchNo && drug) {
              const today = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
              if (
                !/^\d{4}-\d{2}(?:-\d{2})?$/.test(expiryDate) ||
                (expiryDate.length === 7 ? expiryDate < today.slice(0, 7) : expiryDate < today)
              ) {
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
                  throw new AppError(
                    'تاريخ صلاحية التشغيلة المسجلة لا يطابق الفاتورة',
                    'PHARMACY_BATCH_EXPIRY_MISMATCH',
                    422,
                  );
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
            if (batchNo && !drug) {
              // INV-VAN-GENERIC-FEFO: expiry optional (NULL when absent);
              // merge requires identical expiry. The helper owns the
              // validation; drug-linked products never reach it.
              await upsertInventoryBatchFromReceipt(trx, {
                tenantId: scope.tenantId,
                accountId: scope.accountId,
                productId: item.productId,
                batchNumber: batchNo,
                expiryDate,
                qty: increasedQty,
                unitCost: netPurchaseUnitCost / item.unitMultiplier,
                locationId: itemLocationId || null,
                supplierName: supplier?.name || null,
                notes: `وارد فاتورة شراء PUR-${id}`,
              });
            }
          }
        }

        // INV-LANDED-COST-ALLOCATION: record the freight breakdown and
        // stamp the header exactly as the post-posting step does, so the
        // cancel guard and the detail view see the same applied state.
        if (atReceiptLanded) {
          await trx
            .insertInto('purchase_landed_costs')
            .values(
              atReceiptLanded.costs.map((cost) => ({
                tenant_id: scope.tenantId,
                purchase_id: id,
                cost_type: cost.costType,
                description: cost.description,
                amount: cost.amount,
                vendor_id: Number(cost.vendorId || supplier.id),
                allocation_method: atReceiptLanded.allocationMethod,
              })),
            )
            .execute();
          await trx
            .updateTable('purchases')
            .set({
              landed_cost_total: atReceiptLanded.total,
              landed_cost_allocation_method: atReceiptLanded.allocationMethod,
              landed_cost_notes: atReceiptLanded.notes || null,
              landed_cost_applied_at: new Date(),
            })
            .where('id', '=', id)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
        }

        if (payload.attachments && payload.attachments.length > 0) {
          await trx
            .insertInto('purchase_attachments')
            .values(
              payload.attachments.map(
                (attachment) =>
                  ({
                    purchase_id: id,
                    file_name: attachment.fileName,
                    file_url: attachment.fileUrl,
                    file_size: attachment.fileSize,
                    file_type: attachment.fileType,
                    tenant_id: scope.tenantId,
                    account_id: scope.accountId,
                  }) as any,
              ),
            )
            .execute();
        }

        const isPurchaseOrderOnly = payload.lifecycleStatus === 'purchase_order';
        if (!isPurchaseOrderOnly) {
          if (paymentType === 'credit') {
            await this.financeService.addSupplierLedgerEntry(
              trx,
              supplier.id,
              total,
              'purchase_credit',
              `فاتورة شراء PUR-${id}`,
              'purchase',
              id,
              auth,
              branchId,
              locationId,
            );
          } else {
            await this.financeService.addTreasuryTransaction(
              trx,
              'purchase',
              -total,
              `فاتورة شراء PUR-${id}`,
              'purchase',
              id,
              auth,
              branchId,
              locationId,
            );
          }

          await this.accountingPosting.postPurchase(trx, id, auth);
        }

        const repricingInsights = this.buildPurchaseRepricingInsights(
          id,
          { id: Number(supplier.id), name: String(supplier.name || '') },
          repricingCandidates,
          moneyDigits,
        );

        // Commit idempotency record atomically inside the same business transaction.
        if (idempotencyKey) {
          await this.idempotency.commitOperation(
            trx,
            { tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey, operationType: 'purchase_create' },
            { purchaseId: id, repricingInsights },
            String(id),
          );
        }

        return {
          purchaseId: id,
          repricingInsights,
        };
      });

      await this.audit.log('شراء', `تم تسجيل فاتورة شراء PUR-${created.purchaseId} بواسطة ${auth.username}`, auth);
      return this.buildPurchaseMutationResponse(created.purchaseId, auth, {
        repricingInsights: created.repricingInsights,
      });
    } catch (error: any) {
      // Business transaction has rolled back at this point.
      // Only mark 'failed' for known validation/AppErrors (statusCode < 500) — rollback is guaranteed.
      // For unknown/technical errors, mark 'recovery_required' — outcome is ambiguous.
      if (idempotencyKey) {
        const isKnownError = error instanceof AppError && error.statusCode < 500;
        if (isKnownError) {
          await this.idempotency
            .recordFailure(
              {
                tenantId: scope.tenantId,
                accountId: scope.accountId,
                idempotencyKey,
                operationType: 'purchase_create',
              },
              error.code || 'PURCHASE_VALIDATION_FAILED',
            )
            .catch(() => {
              /* best effort */
            });
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
            .catch(() => {
              /* best effort */
            });
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
}
