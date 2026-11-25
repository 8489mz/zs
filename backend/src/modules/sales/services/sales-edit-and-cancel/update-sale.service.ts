import { AppError } from '../../../../common/errors/app-error';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { UpsertSaleDto } from '../../dto/upsert-sale.dto';
import { normalizeSalePayload } from '../../helpers/sales-payload.helper';
import { buildPreparedSaleItem, calculateAllowedSaleUnitPrice, calculateCollectibleTotal, calculateRemainingDebt, calculateStoreCreditBalance, computeSaleAllocationLegs, findBelowFloorSaleItems, paidAmountExceedsRecordedPayments, resolvePostedSalePaymentChannel, restoreFrozenSaleLineCosts, roundSaleInvoiceTotals, roundSaleResidual } from '../../helpers/sales-write.helper';
import { assertPosSubmitGates } from '../../engines/pos-submit-gates.engine';
import { allocateInvoiceDiscount } from '../../engines/invoice-discount.engine';
import { resolveSaleTaxRate } from '../../engines/sale-tax-rate.engine';
import { resolveSaleServiceCharge } from '../../engines/sale-service-charge.engine';
import { assertSaleNotZatcaSigned } from '../../../tax-integration/services/zatca/zatca-invoice-status';
import { diffContributions, tripSaleContribution } from '../../../delivery-reps/van-trip-counters.engine';
import { allocateSaleFromImportLots, restoreImportLotsFromCancelledSale } from '../../../import-sales/helpers/import-lot-allocation.helper';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { sql } from '../../../../database/kysely';
import { getTenantTimezone } from '../../../../common/utils/tenant-timezone.util';
import { computeInvoiceTotals } from '../../../../common/utils/invoice-totals';
import { ensureUniqueFlowItems } from '../../../../common/utils/financial-integrity';
import { applyStockDelta, previewConsumableStockQty } from '../../../../common/utils/location-stock-ledger';
import { posSellsFromAllOperationalLocations } from '../../../../common/engines/branch-sellable-locations.engine';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { formatCreditLimitExceededMessage } from '../credit-limit-message';
import { type SalesEditAndCancelDeps, applyTripCounterDelta, lockOpenTripRow } from './sales-edit-and-cancel-types';
import type { PreparedWasteAndShiftRefreshService } from './prepared-waste-and-shift-refresh.service';

export class UpdateSaleService {
  constructor(
    private readonly db: SalesEditAndCancelDeps['db'],
    private readonly tx: SalesEditAndCancelDeps['tx'],
    private readonly audit: SalesEditAndCancelDeps['audit'],
    private readonly authz: SalesEditAndCancelDeps['authz'],
    private readonly finance: SalesEditAndCancelDeps['finance'],
    private readonly query: SalesEditAndCancelDeps['query'],
    private readonly accountingPosting: SalesEditAndCancelDeps['accountingPosting'],
    private readonly planFeatureService: SalesEditAndCancelDeps['planFeatureService'],
    private readonly assertDiscountChangeAllowed: SalesEditAndCancelDeps['assertDiscountChangeAllowed'],
    private readonly assertUnitPriceChangeAllowed: SalesEditAndCancelDeps['assertUnitPriceChangeAllowed'],
    private readonly getTenantSettingsMap: SalesEditAndCancelDeps['getTenantSettingsMap'],
    private readonly claimSaleSerials: SalesEditAndCancelDeps['claimSaleSerials'],
    private readonly releaseSaleSerials: SalesEditAndCancelDeps['releaseSaleSerials'],
    private readonly resolveSaleModifierCosts: SalesEditAndCancelDeps['resolveSaleModifierCosts'],
    private readonly loadFlatAddonCosts: SalesEditAndCancelDeps['loadFlatAddonCosts'],
    private readonly enforceRestaurantModifierContract: SalesEditAndCancelDeps['enforceRestaurantModifierContract'],
    private readonly autoProduceShortfall: SalesEditAndCancelDeps['autoProduceShortfall'],
    private readonly deductPharmacyBatchesFefo: SalesEditAndCancelDeps['deductPharmacyBatchesFefo'],
    private readonly deductInventoryBatchesFefo: SalesEditAndCancelDeps['deductInventoryBatchesFefo'],
    private readonly restoreSalePharmacyBatches: SalesEditAndCancelDeps['restoreSalePharmacyBatches'],
    private readonly restoreSaleInventoryBatches: SalesEditAndCancelDeps['restoreSaleInventoryBatches'],
    private readonly recordImportLotShortfalls: SalesEditAndCancelDeps['recordImportLotShortfalls'],
    private readonly getAllowNegativeStockSales: SalesEditAndCancelDeps['getAllowNegativeStockSales'],
    private readonly buildInsufficientStockError: SalesEditAndCancelDeps['buildInsufficientStockError'],
    private readonly lockProductRow: SalesEditAndCancelDeps['lockProductRow'],
    private readonly lockSaleStockRows: SalesEditAndCancelDeps['lockSaleStockRows'],
    private readonly getCurrentProductOffers: SalesEditAndCancelDeps['getCurrentProductOffers'],
    private readonly detectPreparedWasteSale: PreparedWasteAndShiftRefreshService['detectPreparedWasteSale'],
    private readonly refreshClosedShiftForPostCloseChange: PreparedWasteAndShiftRefreshService['refreshClosedShiftForPostCloseChange'],
  ) {}

  async updateSale(saleId: number, payload: UpsertSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const normalized = normalizeSalePayload(payload);
    const editReason = String((payload as unknown as { editReason?: string })?.editReason || '').trim();
    const managerPin = String((payload as unknown as { managerPin?: string })?.managerPin || '').trim();

    if (!normalized.items.length) throw new AppError('Sale must include at least one item', 'SALE_ITEMS_REQUIRED', 400);
    ensureUniqueFlowItems(normalized.items, 'SALE_DUPLICATE_PRODUCT', 'Sale must not contain duplicate product rows with the same unit and price');
    if (normalized.discount < 0) throw new AppError('Discount cannot be negative', 'INVALID_DISCOUNT', 400);
    if (!editReason) throw new AppError('سبب التعديل مطلوب.', 'SALE_EDIT_REASON_REQUIRED', 400);
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin && !managerPin) throw new AppError('رمز اعتماد المدير مطلوب قبل تعديل الفاتورة.', 'MANAGER_AUTH_REQUIRED', 400);
    if (!isAdmin || managerPin) await this.authz.authorizeDiscountOverride(managerPin, auth, this.db);

    let postCloseEdit = false;
    let postCloseShiftId: number | null = null;
    await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      // P7 (single-server-clock rule): offer windows are evaluated in
      // the TENANT day — resolve the zone once per edit on this
      // transaction handle and pass it to the shared selector.
      const businessTimezone = await getTenantTimezone(trx, scope.tenantId);
      const sale = await trx
        .selectFrom('sales')
        .selectAll()
        .where('id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!sale) throw new AppError('الفاتورة غير موجودة.', 'SALE_NOT_FOUND', 404);
      if (sale.exchange_return_id) throw new AppError('فاتورة استبدال مترابطة؛ استخدم مرتجعاً بدلاً من تعديلها', 'EXCHANGE_IMMUTABLE', 422);
      if (sale.status !== 'posted') throw new AppError('لا يمكن تعديل فاتورة غير مرحّلة أو ملغاة.', 'SALE_EDIT_STATUS_FORBIDDEN', 400);
      // A signed ZATCA invoice attests to these exact amounts and has
      // consumed an ICV; editing it would leave the attestation stale
      // and burn a second ICV on the replacement. Correct via credit note.
      assertSaleNotZatcaSigned((sale as any).zatca_status);

      // R4-C INV-REST-MODIFIER-CONTRACT-2: same pre-pass as createSale
      // — re-price modifiers from server truth and enforce group rules
      // before the stock lock, so an unverifiable modifier price fails
      // as 422 instead of the lock's 404 PRODUCT_NOT_FOUND.
      await this.enforceRestaurantModifierContract(
        trx, normalized.items, scope.tenantId,
        this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant'),
      );

      // A field sale's trip counters were raised at creation time and
      // must move with the edit. Lock the trip row now (before any
      // stock work, the order settleTrip uses); the delta itself is
      // applied below, once the replacement rows exist. A settled
      // trip's counters are history and stay untouched.
      const tripId = Number((sale as any).van_trip_id || 0) || null;
      const tripOpen = tripId ? await lockOpenTripRow(trx, scope.tenantId, tripId) : false;

      // A cashier shift is a historical cash accountability period. A sale
      // belonging to a closed shift cannot be edited in place: doing so would
      // retroactively change that shift's computed totals and cash exposure.
      const shiftBase = trx.selectFrom('cashier_shifts')
        .select(['id', 'opened_by', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('opened_by', '=', Number(sale.created_by || 0))
        .where('created_at', '<=', sale.created_at)
        .where((eb) => eb.or([eb('closed_at', 'is', null), eb('closed_at', '>=', sale.created_at)]));
      const originalShift = await (sale.branch_id == null
        ? shiftBase.where('branch_id', 'is', null)
        : shiftBase.where('branch_id', '=', sale.branch_id))
        .orderBy('id', 'desc').forUpdate().executeTakeFirst();
      // INV-SPIRIT-POST-CLOSE-EDIT: editing after the original shift closed
      // (closed or pending_review) is allowed with manager PIN/password +
      // reason, and is recorded as post-close below; the closed shift's
      // stored figures are then refreshed (recompute + stamp, see
      // refreshClosedShiftForPostCloseChange) while the posted variance
      // journal is never restated. An OPEN shift belonging to another
      // cashier still blocks the edit, and a missing original shift for
      // a POS sale still blocks it (fail closed).
      postCloseEdit = originalShift ? String(originalShift.status || '') !== 'open' : false;
      postCloseShiftId = postCloseEdit && originalShift ? Number(originalShift.id) : null;
      if (postCloseEdit && !isAdmin) {
        if (!managerPin) throw new AppError('رمز اعتماد المدير مطلوب قبل تعديل فاتورة بعد إغلاق ورديتها.', 'MANAGER_AUTH_REQUIRED', 400);
        await this.authz.authorizeDiscountOverride(managerPin, auth, trx);
      }
      if (originalShift && !postCloseEdit && Number(originalShift.opened_by) !== auth.userId) {
        throw new AppError(
          'لا يمكن تعديل فاتورة تخص وردية مقفولة أو وردية كاشير آخر؛ استخدم مستند مرتجع أو تسوية',
          'SALE_EDIT_ORIGINAL_SHIFT_LOCKED', 422,
        );
      }
      if (normalized.source === 'pos' && !originalShift) {
        throw new AppError('لا يمكن تعديل فاتورة كاشير خارج ورديتها الأصلية؛ استخدم مرتجعاً أو تسوية', 'SALE_EDIT_ORIGINAL_SHIFT_MISSING', 422);
      }
      // A later receipt is an independent GL event and must remain attached to
      // the original debt. This edit route reverses the entire old invoice and
      // must not silently leave that receipt allocated against its replacement.
      const laterAllocation = await trx.selectFrom('payment_allocations')
        .select('id').where('tenant_id', '=', scope.tenantId)
        .where('invoice_type', '=', 'sale').where('invoice_id', '=', saleId)
        .limit(1).executeTakeFirst();
      if (laterAllocation) {
        throw new AppError('الفاتورة عليها سند قبض مخصص؛ يلزم مستند تصحيح بدلاً من تعديلها', 'SALE_EDIT_HAS_LATER_PAYMENTS', 422);
      }

      let branch: any = null;
      if (normalized.source === 'pos') {
        if (!normalized.branchId) {
          throw new AppError('يجب تحديد الفرع لعمليات البيع عبر الكاشير.', 'POS_BRANCH_REQUIRED', 400);
        }
        branch = await trx
          .selectFrom('branches')
          .select(['id', 'name', 'default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock'])
          .where('id', '=', normalized.branchId)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        const branchLabel = branch?.name ? `"${branch.name}"` : `#${normalized.branchId}`;

        if (!branch?.default_stock_location_id) {
          throw new AppError(
            `الفرع ${branchLabel} لا يملك مخزناً افتراضياً. يرجى الذهاب إلى الإعدادات > الفروع وتعيين مخزن افتراضي صحيح لهذا الفرع قبل البيع.`,
            'POS_DEFAULT_STOCK_REQUIRED',
            400,
          );
        }

        // Verify the assigned default stock location actually exists and is active
        const defaultLocation = await trx
          .selectFrom('stock_locations')
          .select(['id', 'name', 'is_active', 'location_type', 'branch_id'])
          .where('id', '=', branch.default_stock_location_id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (!defaultLocation) {
          throw new AppError(
            `المخزن الافتراضي المرتبط بالفرع ${branchLabel} تم حذفه أو لا يوجد. يرجى الذهاب إلى الإعدادات > الفروع وتعيين مخزن افتراضي صحيح.`,
            'POS_DEFAULT_STOCK_DELETED',
            400,
          );
        }

        if (!defaultLocation.is_active) {
          const locationLabel = defaultLocation.name ? `"${defaultLocation.name}"` : `#${defaultLocation.id}`;
          throw new AppError(
            `المخزن الافتراضي ${locationLabel} للفرع ${branchLabel} معطّل. يرجى تفعيل المخزن أو تغيير المخزن الافتراضي من الإعدادات > الفروع.`,
            'POS_DEFAULT_STOCK_INACTIVE',
            400,
          );
        }

        if (['damaged', 'in_transit', 'quarantine'].includes(defaultLocation.location_type || '')) {
          throw new AppError('المخزن الافتراضي لا يجوز أن يكون مخزن تالف أو بضاعة بالطريق أو حجر صحي',
            'POS_DEFAULT_LOCATION_NOT_SELLABLE', 409);
        }
        if (defaultLocation.branch_id != null && Number(defaultLocation.branch_id) !== Number(normalized.branchId)) {
          throw new AppError('المخزن الافتراضي يتبع فرعاً آخر', 'POS_DEFAULT_LOCATION_BRANCH_MISMATCH', 409);
        }
        normalized.locationId = branch.default_stock_location_id;
      }

      // Validate an explicitly selected sale warehouse too: the default branch
      // guard alone does not protect manually entered or edited invoices.
      if (normalized.locationId) {
        const selectedLocation = await trx.selectFrom('stock_locations')
          .select(['id', 'is_active', 'location_type'])
          .where('id', '=', normalized.locationId)
          .where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId)
          .executeTakeFirst();
        if (!selectedLocation || !selectedLocation.is_active) {
          throw new AppError('مخزن البيع غير موجود أو غير نشط', 'SALE_LOCATION_UNAVAILABLE', 409);
        }
        if (['damaged', 'in_transit', 'quarantine'].includes(selectedLocation.location_type || '')) {
          throw new AppError('لا يمكن بيع المخزون التالف أو البضاعة بالطريق أو المحجوز صحياً', 'SALE_LOCATION_NOT_SELLABLE', 409);
        }
      }

      let eligibleLocations = [{ id: normalized.locationId, branchId: normalized.branchId }];
      if (normalized.source === 'pos' && posSellsFromAllOperationalLocations(branch, auth.activityType)) {
        const allLocs = await trx.selectFrom('stock_locations')
          .select(['id', 'location_type', 'branch_id'])
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true)
          .where('location_type', 'not in', ['damaged', 'in_transit', 'quarantine', 'van_stock'])
          .execute();
        const defaultLocId = branch.default_stock_location_id;
        
        const sortedLocs = allLocs.filter(l => {
           if (l.id === defaultLocId) return true;
           if (l.branch_id === normalized.branchId) return true;
           if (l.location_type === 'internal_warehouse' && l.branch_id === null) return true;
           if (branch.allow_external_sales_stock && l.location_type === 'external_warehouse') return true;
           return false;
        }).sort((a, b) => {
           if (a.id === defaultLocId) return -1;
           if (b.id === defaultLocId) return 1;
           if (a.branch_id === normalized.branchId && b.branch_id !== normalized.branchId) return -1;
           if (a.branch_id !== normalized.branchId && b.branch_id === normalized.branchId) return 1;
           if (a.location_type === 'internal_warehouse' && b.location_type !== 'internal_warehouse') return -1;
           if (a.location_type !== 'internal_warehouse' && b.location_type === 'internal_warehouse') return 1;
           return 0;
        });
        
        eligibleLocations = sortedLocs.map(l => ({ id: l.id, branchId: l.branch_id }));
      }

      const existingReturns = await trx
        .selectFrom('return_documents')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('return_type', '=', 'sale')
        .where('invoice_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (Number(existingReturns?.count || 0) > 0) {
        throw new AppError('لا يمكن تعديل هذه الفاتورة بعد إلغائها أو وجود عمليات مرتبطة تمنع التعديل.', 'SALE_EDIT_LINKED_OPERATIONS_FORBIDDEN', 400);
      }

      const existingEditedJournal = await trx
        .selectFrom('journal_entries')
        .select(['id'])
        .where('source_type', '=', 'sale_edit')
        .where('source_id', '=', saleId)
        .where('status', 'in', ['draft', 'posted'])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (existingEditedJournal) {
        throw new AppError('تم تعديل هذه الفاتورة سابقًا. أنشئ فاتورة جديدة بدلًا من إعادة التعديل.', 'SALE_EDIT_ALREADY_APPLIED', 400);
      }

      const currentItems = await trx
        .selectFrom('sale_items')
        .selectAll()
        .where('sale_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      const currentPayments = await trx
        .selectFrom('sale_payments')
        .select(['id', 'amount', 'payment_channel', 'tendered_amount', 'change_amount'])
        .where('sale_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      if (currentPayments.length > 0 &&
          paidAmountExceedsRecordedPayments(currentPayments, sale.paid_amount, moneyDigits)) {
        throw new AppError('الفاتورة عليها تحصيلات إضافية لا يمكن عكسها بتعديل الفاتورة', 'SALE_EDIT_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }
      if (currentPayments.length === 0 && Number(sale.paid_amount || 0) > 0 && sale.payment_channel === 'mixed') {
        throw new AppError('لا يمكن تعديل فاتورة قديمة ذات سداد مختلط دون تفاصيل وسائل الدفع', 'SALE_EDIT_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }

      await this.lockSaleStockRows(trx, scope, [...currentItems, ...(payload.items || [])]);
      await this.restoreSalePharmacyBatches(trx, saleId, currentItems, scope, true);
      await this.restoreSaleInventoryBatches(trx, saleId, currentItems, scope, true);
      // The old and replacement customers may differ. Lock both in ascending ID order
      // after product locks, before reversing the old receivable or testing the new limit.
      for (const customerId of [...new Set([Number(sale.customer_id || 0), Number(normalized.customerId || 0)])]
        .filter((id) => id > 0).sort((a, b) => a - b)) {
        await trx.selectFrom('customers').select('id')
          .where('id', '=', customerId).where('tenant_id', '=', scope.tenantId)
          .forUpdate().executeTakeFirst();
      }
      // INV-SALE-EDIT-PREPARED-WASTE: a served dine-in/takeaway/delivery
      // sale is prepared waste (the same detection cancelSale uses). Its
      // consumed allocations are not resurrected: restoration is capped
      // at the edited lines' new consumption, so kept quantities net to
      // zero and only reduced/removed quantities stay consumed. Retail
      // sales (predicate false) restore exactly as before.
      const isPreparedWaste = await this.detectPreparedWasteSale(trx, sale, scope.tenantId);
      const wasteConsumptionByProduct = new Map<number, number>();
      const wasteRestoredByProduct = new Map<number, number>();
      const restoredBaseBySaleItemId = new Map<number, number>();
      if (isPreparedWaste) {
        const restaurantOn = await this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant');
        const optionIds = new Set<number>();
        for (const payloadItem of normalized.items || []) {
          for (const mod of payloadItem.modifiers || []) {
            if (mod?.optionId) optionIds.add(Number(mod.optionId));
          }
        }
        const modifierOptions = new Map<number, { componentProductId: number; consumptionQty: number }>();
        if (restaurantOn && optionIds.size > 0) {
          const optionRows = await trx.selectFrom('pos_modifier_options').selectAll()
            .where('tenant_id', '=', scope.tenantId).where('id', 'in', [...optionIds]).execute();
          for (const optionRow of optionRows) {
            modifierOptions.set(Number(optionRow.id), {
              componentProductId: Number(optionRow.component_product_id || 0),
              consumptionQty: Number(optionRow.consumption_qty || 1),
            });
          }
        }
        const addWasteConsumption = (productId: number, qty: number): void => {
          if (!productId || !(qty > 0)) return;
          wasteConsumptionByProduct.set(productId, Number((Number(wasteConsumptionByProduct.get(productId) || 0) + qty).toFixed(3)));
        };
        for (const payloadItem of normalized.items || []) {
          const itemQty = Number(payloadItem.qty || 0);
          const itemMultiplier = Number(payloadItem.unitMultiplier || 1);
          addWasteConsumption(Number(payloadItem.productId), Number((itemQty * itemMultiplier).toFixed(3)));
          if (!restaurantOn) continue;
          for (const mod of payloadItem.modifiers || []) {
            const option = mod?.optionId ? modifierOptions.get(Number(mod.optionId)) : undefined;
            const componentId = option ? option.componentProductId : Number(mod?.productId || mod?.componentProductId || 0);
            const consumption = option ? option.consumptionQty : Number(mod?.consumptionQty || mod?.consumption_qty || 1);
            addWasteConsumption(componentId, Number((Number(mod?.qty || 1) * itemQty * consumption).toFixed(3)));
          }
        }
      }
      for (const item of [...currentItems].sort((a, b) => Number(a.product_id || 0) - Number(b.product_id || 0))) {
        if (!item.product_id) continue;
        const restoreQty = Number((Number(item.qty || 0) * Number(item.unit_multiplier || 1)).toFixed(3));

        const allocations = await trx.selectFrom('sale_line_stock_allocations')
           .selectAll()
           .where('sale_line_id', '=', item.id)
           .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
           .execute();

        if (allocations.length > 0) {
           let remainingToRestore = restoreQty;
           for (const alloc of allocations) {
             const isParentProduct = Number(alloc.product_id) === Number(item.product_id);
             if (isParentProduct && remainingToRestore <= 0) continue;
             const allocQty = Number(alloc.quantity || 0);
             let qtyToRestore = isParentProduct ? Math.min(allocQty, remainingToRestore) : allocQty;
             if (isPreparedWaste) {
               const productKey = Number(alloc.product_id);
               const remainingBudget = Math.max(0, Number((Number(wasteConsumptionByProduct.get(productKey) || 0) - Number(wasteRestoredByProduct.get(productKey) || 0)).toFixed(3)));
               qtyToRestore = Math.min(qtyToRestore, remainingBudget);
               if (qtyToRestore > 0) {
                 wasteRestoredByProduct.set(productKey, Number((Number(wasteRestoredByProduct.get(productKey) || 0) + qtyToRestore).toFixed(3)));
                 if (isParentProduct) {
                   restoredBaseBySaleItemId.set(Number(item.id), Number((Number(restoredBaseBySaleItemId.get(Number(item.id)) || 0) + qtyToRestore).toFixed(3)));
                 }
               }
             }
             if (qtyToRestore <= 0) continue;
             if (isParentProduct) {
               remainingToRestore -= qtyToRestore;
             }

             // Find branch for this location
             const locData = await trx.selectFrom('stock_locations').select('branch_id')
               .where('id', '=', alloc.location_id).where('tenant_id', '=', scope.tenantId)
               .executeTakeFirst();
             if (!locData) throw new AppError('مخزن سطر الفاتورة الأصلي غير موجود؛ يجب تسوية المخزون قبل التعديل', 'SALE_EDIT_LOCATION_RECONCILIATION_REQUIRED', 409);
             const branchId = locData.branch_id ?? sale.branch_id;

             const stockChange = await applyStockDelta(trx, {
               productId: Number(alloc.product_id),
               delta: qtyToRestore,
               branchId: branchId,
               locationId: alloc.location_id,
               tenantId: scope.tenantId,
               accountId: scope.accountId,
             });

             await trx.insertInto('stock_movements').values({
               product_id: Number(alloc.product_id),
               movement_type: 'sale_edit_reversal',
               qty: qtyToRestore,
               before_qty: stockChange.scopeBefore,
               after_qty: stockChange.scopeAfter,
               reason: 'sale_edit_reversal',
               note: `Edit reversal S-${saleId}`,
               reference_type: 'sale',
               reference_id: saleId,
               branch_id: branchId,
               location_id: alloc.location_id,
               created_by: auth.userId,
               tenant_id: scope.tenantId,
               account_id: scope.accountId,
             }).execute();
           }
           // Prepared waste: the un-restored remainder is consumed food,
           // not a reconciliation gap, so the completeness throw is
           // skipped exactly for waste sales.
           if (remainingToRestore > 0.0001 && !isPreparedWaste) {
             throw new AppError('توزيع مخزون سطر البيع الأصلي غير مكتمل؛ لا يمكن تعديل الفاتورة دون تسوية', 'SALE_EDIT_STOCK_ALLOCATION_RECONCILIATION_REQUIRED', 409);
           }
        } else {
           // Fallback for legacy sales without allocations. For prepared
           // waste the fallback is capped at the same new-consumption
           // budget, so a removed legacy line stays consumed.
           const fallbackRestoreQty = isPreparedWaste
             ? Math.min(restoreQty, Math.max(0, Number((Number(wasteConsumptionByProduct.get(Number(item.product_id)) || 0) - Number(wasteRestoredByProduct.get(Number(item.product_id)) || 0)).toFixed(3))))
             : restoreQty;
           if (fallbackRestoreQty > 0) {
             const stockChange = await applyStockDelta(trx, {
               productId: Number(item.product_id),
               delta: fallbackRestoreQty,
               branchId: sale.branch_id,
               locationId: sale.location_id,
               tenantId: scope.tenantId,
               accountId: scope.accountId,
             });
             await trx.insertInto('stock_movements').values({
               product_id: item.product_id,
               movement_type: 'sale_edit_reversal',
               qty: fallbackRestoreQty,
               before_qty: stockChange.scopeBefore,
               after_qty: stockChange.scopeAfter,
               reason: 'sale_edit_reversal',
               note: `Edit reversal S-${saleId}`,
               reference_type: 'sale',
               reference_id: saleId,
               branch_id: sale.branch_id,
               location_id: sale.location_id,
               created_by: auth.userId,
               tenant_id: scope.tenantId,
               account_id: scope.accountId,
             }).execute();
             if (isPreparedWaste) {
               wasteRestoredByProduct.set(Number(item.product_id), Number((Number(wasteRestoredByProduct.get(Number(item.product_id)) || 0) + fallbackRestoreQty).toFixed(3)));
               restoredBaseBySaleItemId.set(Number(item.id), Number((Number(restoredBaseBySaleItemId.get(Number(item.id)) || 0) + fallbackRestoreQty).toFixed(3)));
             }
           }
        }
      }

      // INV-SALE-EDIT-PREPARED-WASTE: snapshot the old lines and the
      // restored sold quantity per line so postSaleEdit can exclude the
      // consumed portion's residual COGS from the reversal, exactly as
      // cancelSale excludes it in full. Kept lines restore fully, so
      // their exclusion is zero.
      const preparedWasteEdit = isPreparedWaste ? {
        oldItems: currentItems.map((oldItem) => ({
          id: Number(oldItem.id),
          product_id: Number(oldItem.product_id || 0),
          qty: Number(oldItem.qty || 0),
          cost_price: Number(oldItem.cost_price || 0),
          unit_multiplier: Number(oldItem.unit_multiplier || 1),
          modifiers: oldItem.modifiers ?? null,
        })),
        restoredQtyBySaleItemId: new Map<number, number>(
          [...restoredBaseBySaleItemId.entries()].map(([saleItemId, baseQty]) => {
            const oldItem = currentItems.find((candidate) => Number(candidate.id) === saleItemId);
            const multiplier = Number(oldItem?.unit_multiplier || 1) || 1;
            return [saleItemId, Number((baseQty / multiplier).toFixed(3))] as [number, number];
          }),
        ),
      } : undefined;

      const oldCollectibleTotal = Math.max(0, Number(sale.total || 0) - Number(sale.store_credit_used || 0));
      const oldPaid = currentPayments.length
        ? currentPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        : Number(sale.paid_amount || 0);
      const oldDebt = calculateRemainingDebt(oldCollectibleTotal, oldPaid, moneyDigits);
      if (sale.customer_id && oldDebt > 0) {
        await this.finance.createCustomerLedgerEntry(trx, sale.customer_id, -oldDebt, `عكس تعديل فاتورة بيع S-${saleId}`, saleId, auth);
      }
      for (const payment of currentPayments) {
        if (payment.payment_channel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(trx, -Number(payment.amount || 0), `عكس تعديل فاتورة بيع S-${saleId}`, saleId, auth, sale.branch_id, sale.location_id);
      }

      if (Number(sale.store_credit_used || 0) > 0 && sale.customer_id) {
        const customerBefore = await trx
          .selectFrom('customers')
          .select(['store_credit_balance'])
          .where('id', '=', sale.customer_id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();
        if (customerBefore) {
          await trx.updateTable('customers').set({
            store_credit_balance: calculateStoreCreditBalance(Number(customerBefore.store_credit_balance || 0), Number(sale.store_credit_used || 0), moneyDigits),
            updated_at: sql`NOW()`,
          }).where('id', '=', sale.customer_id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
        }
      }

      // Reconcile Customer Loyalty Points on Edit (ZS-078)
      if (sale.customer_id) {
        const customerId = Number(sale.customer_id);

        const earnLog = await trx
          .selectFrom('customer_loyalty_logs')
          .select(['points_change'])
          .where('sale_id', '=', saleId)
          .where('action_type', '=', 'earn')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (earnLog && Number(earnLog.points_change) > 0) {
          const earnedPoints = Number(earnLog.points_change);
          const previousClawbacks = await trx
            .selectFrom('customer_loyalty_logs')
            .select(sql<number>`COALESCE(SUM(ABS(points_change)), 0)`.as('total_clawed'))
            .where('sale_id', '=', saleId)
            .where('action_type', 'in', ['return_clawback', 'cancel_clawback', 'edit_clawback'])
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
          const alreadyClawed = Number(previousClawbacks?.total_clawed || 0);
          const clawbackDelta = Math.max(0, earnedPoints - alreadyClawed);

          if (clawbackDelta > 0) {
            const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
            const currentBal = Number(cust?.loyalty_points || 0);
            const balanceAfter = Math.max(0, Number((currentBal - clawbackDelta).toFixed(2)));

            await trx
              .updateTable('customers')
              .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
              .where('id', '=', customerId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();

            await trx
              .insertInto('customer_loyalty_logs')
              .values({
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
                customer_id: customerId,
                points_change: -clawbackDelta,
                balance_after: balanceAfter,
                action_type: 'edit_clawback',
                sale_id: saleId,
                notes: `عكس ${clawbackDelta} نقطة ولاء مكتسبة بسبب تعديل الفاتورة S-${saleId}`,
                created_at: sql`NOW()`,
              } as any)
              .execute();
          }
        }

        const redeemLog = await trx
          .selectFrom('customer_loyalty_logs')
          .select(['points_change'])
          .where('sale_id', '=', saleId)
          .where('action_type', '=', 'redeem')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (redeemLog && Number(redeemLog.points_change) < 0) {
          const totalRedeemed = Math.abs(Number(redeemLog.points_change));
          const previousRefunds = await trx
            .selectFrom('customer_loyalty_logs')
            .select(sql<number>`COALESCE(SUM(points_change), 0)`.as('total_refunded'))
            .where('sale_id', '=', saleId)
            .where('action_type', 'in', ['return_refund', 'cancel_refund', 'edit_refund'])
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
          const alreadyRefunded = Number(previousRefunds?.total_refunded || 0);
          const refundDelta = Math.max(0, totalRedeemed - alreadyRefunded);

          if (refundDelta > 0) {
            const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
            const currentBal = Number(cust?.loyalty_points || 0);
            const balanceAfter = Number((currentBal + refundDelta).toFixed(2));

            await trx
              .updateTable('customers')
              .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
              .where('id', '=', customerId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();

            await trx
              .insertInto('customer_loyalty_logs')
              .values({
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
                customer_id: customerId,
                points_change: refundDelta,
                balance_after: balanceAfter,
                action_type: 'edit_refund',
                sale_id: saleId,
                notes: `رد ${refundDelta} نقطة ولاء مستبدلة سابقاً بسبب تعديل الفاتورة S-${saleId}`,
                created_at: sql`NOW()`,
              } as any)
              .execute();
          }
        }
      }

      // NOTE (Risk #1 / Risk #2): do NOT reverse the sale journal here.
      // postSaleEdit() at the end of this transaction is the sole reverser:
      // it reverses the latest active journal and posts the new sale_edit
      // journal atomically in this same transaction. An explicit reversal
      // here would leave zero active journals, and postSaleEdit() would
      // then throw SALE_ALREADY_REVERSED (it cannot distinguish a reversal
      // made by this edit from one made by a cancellation, from counts alone).
      // The edit reason is still recorded by the audit log after commit.

      // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: the deleteFrom('sale_payments')
      // that used to sit here is deleted, not moved — the stored legs are
      // the sale's payments, and this edit leaves them byte-identical.
      // The only writer of sale_payments after posting is POST
      // /api/sales/:id/payment-adjustment (besides the original sale
      // insert).
      await this.releaseSaleSerials(trx, saleId, scope.tenantId);
      await restoreImportLotsFromCancelledSale(trx, { tenantId: scope.tenantId, saleId });
      await trx.deleteFrom('sale_items').where('sale_id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      const customer = normalized.customerId
        ? await trx.selectFrom('customers').select(['id', 'name', 'balance', 'credit_limit', 'store_credit_balance', 'is_credit_blocked']).where('id', '=', normalized.customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('is_active', '=', true).forUpdate().executeTakeFirst()
        : null;
      if (normalized.customerId && !customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
      if (normalized.paymentType === 'credit' && !customer) throw new AppError('Credit sale requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
      const allowNegativeStockSales = await this.getAllowNegativeStockSales(trx, scope.tenantId);

      let subtotal = 0;
      const preparedItems = [];
      const autoProduceItems = [];
      for (const item of normalized.items) {
        if (Number(item.price || 0) <= 0) {
          throw new AppError('Sale item price must be greater than zero', 'INVALID_SALE_PRICE', 400);
        }
        const product = await trx.selectFrom('products as p')
          .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
          .select(['p.id', 'p.name', 'p.stock_qty', 'p.retail_price', 'p.wholesale_price', 'p.cost_price', 'p.min_selling_price', 'p.item_type', 'b.id as bom_id'])
          .where('p.id', '=', item.productId)
          .where(sql<boolean>`p.tenant_id = ${scope.tenantId}`)
          .where('p.is_active', '=', true)
          .executeTakeFirst();
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);
        
        const activeOffers = await this.getCurrentProductOffers(trx, item.productId, scope.tenantId);
        const allowedUnitPrice = calculateAllowedSaleUnitPrice({
          retailPrice: product.retail_price,
          wholesalePrice: product.wholesale_price,
          priceType: item.priceType,
          offers: activeOffers,
          qty: item.qty,
          unitMultiplier: item.unitMultiplier,
          businessTimezone,
          moneyDigits,
        });
        await this.assertUnitPriceChangeAllowed(trx, auth, Number(item.price || 0), allowedUnitPrice, item.productId, normalized.managerPin, saleId);
        
        const availableStockQty = normalized.locationId
          ? await previewConsumableStockQty(trx, { productId: item.productId, branchId: normalized.branchId, locationId: normalized.locationId, tenantId: scope.tenantId, accountId: scope.accountId })
          : Number(product.stock_qty || 0);
          
        const hasBOM = !!product.bom_id;
        let finalProductName = product.name;

        if (hasBOM) {
          const bomLines = await trx.selectFrom('manufacturing_bom_lines as l')
            .innerJoin('products as p', 'p.id', 'l.component_product_id')
            .select('p.name')
            .where('l.bom_id', '=', Number(product.bom_id))
            .execute();
          
          if (bomLines.length > 0) {
            finalProductName = `${product.name} (${bomLines.map(l => l.name).join(' + ')})`;
          }
        }

        const requiredQty = Number((Number(item.qty || 0) * Number(item.unitMultiplier || 1)).toFixed(3));
        const canAllowNegative = allowNegativeStockSales || hasBOM || (product as any).item_type === 'service';
        if (!canAllowNegative && availableStockQty < requiredQty) {
          throw await this.buildInsufficientStockError(trx, {
            productId: item.productId,
            productName: finalProductName,
            currentLocationId: eligibleLocations.length === 1 ? eligibleLocations[0].id : null,
            currentLocationName: eligibleLocations.length > 1 ? 'المخازن المتاحة للفرع' : undefined,
            excludedLocationIds: eligibleLocations.map((l) => l.id).filter((id): id is number => id != null),
            currentAvailableQty: availableStockQty,
            requiredQty,
            tenantId: scope.tenantId,
          });
        }

        const preparedItem = buildPreparedSaleItem(
          { ...product, name: finalProductName, stock_qty: availableStockQty }, 
          item, 
          { allowNegativeStockSales: allowNegativeStockSales || hasBOM || (product as any).item_type === 'service', moneyDigits }
        );
        subtotal += preparedItem.lineTotal;
        preparedItems.push({
          ...preparedItem,
          isService: (product as any).item_type === 'service',
          // INV-SALE-EDIT-COST-FLOOR: carry the floor inputs on the
          // rebuilt line so the edit floor check below can use them.
          // The pre-approved override is the edit's own allowed
          // (retail/offer) price, as at creation for non-system-approved
          // sales; updateSale has no approved-terms channel.
          effectiveAllowedUnitPrice: allowedUnitPrice,
          minSellingPrice: Number((product as any).min_selling_price || 0),
        });
        
        if (hasBOM) {
          autoProduceItems.push({
            productId: item.productId,
            requiredQty: preparedItem.requiredQty,
            availableQty: availableStockQty,
            hasBOM: true,
            bomId: Number(product.bom_id),
            unitMultiplier: item.unitMultiplier,
          });
        }
      }

      // INV-CONVERSION-LINE-DISCOUNTS-PRESERVED: same gate inclusion as
      // createSale — per-line discounts count toward the gated amount.
      const editLineDiscountTotal = roundSaleResidual(normalized.items.reduce((sum, item) => sum + Number((item as { lineDiscount?: number }).lineDiscount || 0), 0), moneyDigits);
      await this.assertDiscountChangeAllowed(trx, auth, roundSaleResidual(normalized.discount + editLineDiscountTotal, moneyDigits), managerPin, subtotal);
      if (normalized.discount > subtotal) throw new AppError('Discount cannot exceed subtotal', 'INVALID_DISCOUNT', 400);
      // Tax F1 (same rule as createSale): an edit re-derives the tax
      // from the payload rate, so it must pass the same configured-or-0
      // gate before the replacement totals are computed — otherwise an
      // edit could rewrite a posted invoice's tax rate and history.
      const taxSettingsMap = await this.getTenantSettingsMap(trx, scope.tenantId);
      normalized.taxRate = resolveSaleTaxRate(
        normalized.taxRate,
        taxSettingsMap.get('taxRate') ?? taxSettingsMap.get('tax_rate'),
      );
      // R4-A (INV-REST-SALE-MONEY-TRUTH): same server recompute as
      // createSale — an edit re-derives the charge from the tenant
      // settings, so an edit cannot rewrite a posted invoice's
      // service charge from a tampered payload. The base here is
      // subtotal - normalized.discount (updateSale has no loyalty
      // path); the overwrite happens BEFORE computeInvoiceTotals.
      const recomputedEditServiceCharge = resolveSaleServiceCharge({
        orderType: normalized.orderType,
        source: normalized.source,
        enabled: taxSettingsMap.get('restaurantServiceChargeEnabled') ?? taxSettingsMap.get('restaurant_service_charge_enabled'),
        percent: taxSettingsMap.get('restaurantServiceChargePercent') ?? taxSettingsMap.get('restaurant_service_charge_rate'),
        netBase: subtotal - normalized.discount,
        digits: moneyDigits,
      });
      if (recomputedEditServiceCharge !== null) normalized.serviceCharge = recomputedEditServiceCharge;
      const { taxAmount, total } = roundSaleInvoiceTotals(
        computeInvoiceTotals(subtotal, normalized.discount, normalized.taxRate, normalized.pricesIncludeTax, normalized.deliveryFee, normalized.serviceCharge, Number((normalized as any).tipAmount || 0)),
        moneyDigits,
      );
      const { taxAmount: itemOnlyTaxAmount } = roundSaleInvoiceTotals(
        computeInvoiceTotals(subtotal, normalized.discount, normalized.taxRate, normalized.pricesIncludeTax, 0, 0, 0),
        moneyDigits,
      );
      const allocatedLines = allocateInvoiceDiscount({
        lines: preparedItems.map((item) => ({ lineTotal: item.lineTotal, qty: item.qty })),
        invoiceDiscount: normalized.discount, invoiceTax: itemOnlyTaxAmount, pricesIncludeTax: normalized.pricesIncludeTax, digits: moneyDigits,
      });
      const allocationByItem = new Map(preparedItems.map((item, index) => [item, allocatedLines[index]]));
      if (normalized.storeCreditUsed > total + 0.0001) throw new AppError('Store credit cannot exceed invoice total', 'INVALID_STORE_CREDIT', 400);
      const collectibleTotal = calculateCollectibleTotal(total, normalized.storeCreditUsed, moneyDigits);
      if (normalized.storeCreditUsed > 0) {
        if (!customer) throw new AppError('Store credit requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
        if (normalized.storeCreditUsed > Number(customer.store_credit_balance || 0) + 0.0001) throw new AppError('Store credit exceeds available balance', 'STORE_CREDIT_EXCEEDED', 400);
      }

      // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: recorded payment legs are
      // immutable in a sale edit. The payload's payments NEVER re-state
      // them — and neither does the old tender fallback, which invented
      // a single leg for the new total whenever the payload carried no
      // legs (every dashboard edit). The legs below ARE the stored rows,
      // byte-identical, and paidAmount is their sum. The edit may change
      // items/totals; any difference between the new total and the
      // stored legs is a receivable settled only via POST
      // /api/sales/:id/payment-adjustment — never by this path. The COD
      // tender-fallback suppression died with the allocation: no
      // fallback leg is ever invented now, so a COD edit cannot invent
      // a cash leg either.
      const payments = currentPayments.map((leg) => ({
        paymentChannel: String(leg.payment_channel || 'cash') as 'cash' | 'card' | 'wallet' | 'instapay',
        amount: roundMoney(Number(leg.amount || 0), moneyDigits),
        tenderedAmount: roundMoney(Number(leg.tendered_amount ?? leg.amount ?? 0), moneyDigits),
        changeAmount: roundMoney(Number(leg.change_amount || 0), moneyDigits),
      }));
      const paidAmount = roundMoney(payments.reduce((sum, leg) => sum + leg.amount, 0), moneyDigits);
      const storedTenderedAmount = roundMoney(payments.reduce((sum, leg) => sum + leg.tenderedAmount, 0), moneyDigits);
      const storedChangeAmount = roundMoney(payments.reduce((sum, leg) => sum + leg.changeAmount, 0), moneyDigits);
      if (normalized.source === 'pos' && !await this.authz.hasOpenCashierShift(trx, auth, normalized.branchId)) {
        throw new AppError('وردية كاشير مفتوحة مطلوبة لتعديل فاتورة نقطة البيع', 'OPEN_SHIFT_REQUIRED', 400);
      }
      // INV-REST-PAID-GATES-2 (R4-D, I28, D-R4D-1/D-R4D-4): same
      // POS-gated flip removal as createSale — the edit path had the
      // same silent reclassification. Today's callers send no source
      // (dashboard), so the helper returns early for them.
      const isPartialCredit = normalized.source !== 'pos' && Boolean(normalized.customerId) && paidAmount + 0.0001 < collectibleTotal;
      // The edit never restates the payment type: a flipped (underpaid,
      // customer-carried) sale becomes 'credit' with its channel
      // re-derived from the stored legs below; otherwise the stored
      // payment_type stays exactly as recorded — including 'split' for
      // van split sales, which the old code collapsed to 'cash'.
      const effectivePaymentType = isPartialCredit ? 'credit' : String((sale as any).payment_type || 'cash');
      const effectivePaymentChannel = isPartialCredit
        ? resolvePostedSalePaymentChannel('credit', payments)
        : String((sale as any).payment_channel || 'cash');
      // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: an edit that lowers the
      // total below the recorded payments cannot proceed — the stored
      // legs would overpay the new total and postSaleEdit's journal
      // (cash debits from the legs, revenue credits from the new total)
      // would not balance. Settle it first via the payment-adjustment
      // endpoint (reduce a leg), then edit. Underpayment is NOT refused:
      // the receivable absorbs it and the adjustment endpoint settles it.
      // (This replaces INVALID_PAID_AMOUNT, whose premise — a payload
      // tender allocation — no longer exists.)
      const paymentTolerance = 1 / 10 ** moneyDigits;
      if (paidAmount > collectibleTotal + paymentTolerance) {
        throw new AppError(
          `المبلغ المسدد المسجل (${paidAmount}) يتجاوز إجمالي الفاتورة الجديد (${collectibleTotal}) — خفّض الدفعات من تعديل الدفعات (payment-adjustment) أولاً ثم أعد التعديل`,
          'SALE_EDIT_OVERPAID_LEGS',
          422,
        );
      }
      assertPosSubmitGates({
        source: normalized.source,
        customerId: normalized.customerId,
        paidAmount,
        collectibleTotal,
        total,
        orderType: normalized.orderType,
        collectionStatus: normalized.collectionStatus,
        tableNumber: normalized.tableNumber,
        cardAmount: payments.find((entry) => entry.paymentChannel === 'card')?.amount ?? 0,
        terminalApprovedAmount: normalized.terminalApprovedAmount,
        terminalAuthCode: normalized.terminalAuthCode,
        discount: normalized.discount,
        subtotal,
      });
      const newDebt = roundMoney(Math.max(0, collectibleTotal - paidAmount), moneyDigits);
      if (newDebt > 0) {
        if (!customer) throw new AppError('Credit sale requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
        if (Number(customer.balance || 0) + newDebt > Number(customer.credit_limit || 0) + 0.001
          && Number(customer.credit_limit || 0) > 0) {
          throw new AppError(
            formatCreditLimitExceededMessage({
              creditLimit: Number(customer.credit_limit || 0),
              currentBalance: Number(customer.balance || 0),
              requestedAmount: newDebt,
              digits: moneyDigits,
            }),
            'CUSTOMER_CREDIT_LIMIT',
            400,
          );
        }
        if (customer.is_credit_blocked) throw new AppError('Customer credit is blocked', 'CUSTOMER_CREDIT_BLOCKED', 400);
      }

      await trx.updateTable('sales').set({
        customer_id: normalized.customerId,
        customer_name: customer?.name || 'عميل نقدي',
        customer_phone: payload.customerPhone || null,
        customer_address: payload.customerAddress || null,
        payment_type: effectivePaymentType,
        payment_channel: effectivePaymentChannel,
        subtotal: roundMoney(subtotal, moneyDigits),
        discount: normalized.discount,
        delivery_fee: normalized.deliveryFee,
        service_charge: normalized.serviceCharge || 0,
        tip_amount: Number((normalized as any).tipAmount || 0),
        tax_rate: normalized.taxRate,
        tax_amount: taxAmount,
        prices_include_tax: normalized.pricesIncludeTax,
        total,
        paid_amount: paidAmount,
        applied_amount: paidAmount,
        tendered_amount: storedTenderedAmount,
        change_amount: storedChangeAmount,
        store_credit_used: normalized.storeCreditUsed,
        note: normalized.note,
        branch_id: normalized.branchId,
        location_id: normalized.locationId,
        updated_at: sql`NOW()`,
      } as any).where('id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: the sale_payments re-insert
      // that used to sit here is deleted, not moved — the stored legs
      // above are the sale's payments, and this edit leaves them
      // byte-identical. The only writer of sale_payments after posting
      // is POST /api/sales/:id/payment-adjustment (besides the original
      // sale insert).

      // The trip counters move with the edit: the old sale's
      // contribution is reversed and the replacement's applied, as one
      // delta, while the trip row is still locked by this transaction.
      if (tripOpen && tripId) {
        let oldLedgerCredit: number | null = null;
        if (String((sale as any).payment_channel || '').toLowerCase() === 'mixed') {
          const ledgerRow = await trx.selectFrom('customer_ledger').select('amount')
            .where('reference_type', '=', 'sale').where('reference_id', '=', saleId)
            .where('entry_type', '=', 'sale_credit').where('tenant_id', '=', scope.tenantId)
            .orderBy('id', 'desc').executeTakeFirst();
          oldLedgerCredit = ledgerRow ? Number((ledgerRow as any).amount || 0) : null;
        }
        const oldContribution = tripSaleContribution({
          total: (sale as any).total,
          paidAmount: (sale as any).paid_amount,
          paymentChannel: (sale as any).payment_channel,
          payments: currentPayments as any,
          ledgerCreditAmount: oldLedgerCredit ?? undefined,
        });
        const newContribution = tripSaleContribution({
          total,
          paidAmount,
          paymentChannel: resolvePostedSalePaymentChannel(effectivePaymentType as 'cash' | 'credit', payments),
          payments: payments.map((payment: any) => ({ amount: payment.amount, payment_channel: payment.paymentChannel })),
        });
        await applyTripCounterDelta(trx, scope.tenantId, tripId, diffContributions(newContribution, oldContribution));
      }

      await this.lockSaleStockRows(trx, scope, preparedItems);
      await this.autoProduceShortfall(trx, autoProduceItems, saleId, normalized.branchId, normalized.locationId, scope, auth);
      await this.resolveSaleModifierCosts(trx, preparedItems, scope.tenantId,
        this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant'));

      // INV-SALE-EDIT-FROZEN-COST: resolveSaleModifierCosts just re-costed
      // every rebuilt line at the CURRENT product WAC. Restore the original
      // per-unit cost for lines whose physical composition (product, sold
      // unit, modifiers) is unchanged, so a price/discount/tax-only edit
      // cannot move COGS between periods. currentItems was loaded before
      // the old sale_items rows were deleted, so it still carries the
      // original costs; createSale has no old lines and is untouched.
      restoreFrozenSaleLineCosts(preparedItems, currentItems);

      // INV-SALE-EDIT-COST-FLOOR: creation refuses a net line below the
      // selling floor, but edits previously re-ran only the deviation
      // gate, so an admin could edit below cost with no PIN and a
      // manager approving the edit never saw a floor computation. Run
      // the same shared check here, AFTER the frozen-cost restore, so
      // the floor is computed on the cost that will actually be stored
      // and posted by postSaleEdit. The approval and the sale-note tag
      // mirror creation; the tag is written back to the sales row
      // updated above, inside this same transaction.
      const belowFloorProductIds = findBelowFloorSaleItems(preparedItems.map((item) => ({
        productId: item.productId,
        isService: item.isService,
        costPrice: item.costPrice,
        unitMultiplier: item.unitMultiplier,
        qty: item.qty,
        minSellingPrice: item.minSellingPrice,
        effectiveAllowedUnitPrice: item.effectiveAllowedUnitPrice,
        netLineTotal: allocationByItem.get(item)!.netLineTotal,
      })));
      // INV-POS-ADMIN-DISCOUNT-AUTHORITY: an admin edit below the floor
      // is not blocked; the lines are recorded in the note (no approver).
      const isAdminEditor = auth.role === 'admin' || auth.role === 'super_admin';
      const editFloorApproval = belowFloorProductIds.length && !isAdminEditor
        ? await this.authz.authorizeDiscountOverride(normalized.managerPin, auth, trx)
        : null;
      if (belowFloorProductIds.length) {
        const floorTag = editFloorApproval
          ? `[اعتماد بيع تحت الحد: ${editFloorApproval.authorizedByName}; أصناف ${belowFloorProductIds.join(',')}]`
          : `[بيع تحت الحد: أصناف ${belowFloorProductIds.join(',')}]`;
        const editNote = normalized.note ? `${normalized.note} | ${floorTag}` : floorTag;
        await trx.updateTable('sales').set({ note: editNote } as any)
          .where('id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      }

      // Deadlock prevention: identical canonical lock ordering as createSale (see note there).
      // R8-A INV-REST-FLAT-ADDON-COSTING: flat addons carry no stock —
      // the deduction loop below must skip them entirely (see createSale).
      const flatAddonCosts = await this.loadFlatAddonCosts(trx, scope.tenantId, preparedItems);
      const stockOrderedItems = [...preparedItems].sort((a, b) => Number(a.productId || 0) - Number(b.productId || 0));

      for (const item of stockOrderedItems) {
        const itemSerials = Array.isArray(item.serials) ? item.serials : [];
        const insertedLine = await trx.insertInto('sale_items').values({
          sale_id: saleId,
          product_id: item.productId,
          product_name: item.productName,
          qty: item.qty,
          unit_price: item.unitPrice,
          line_total: item.lineTotal,
          line_discount: Number(item.lineDiscount || 0),
          net_unit_price: allocationByItem.get(item)!.netUnitPrice,
          net_line_total: allocationByItem.get(item)!.netLineTotal,
          allocated_discount: allocationByItem.get(item)!.allocatedDiscount,
          allocated_tax: allocationByItem.get(item)!.allocatedTax,
          unit_name: item.unitName,
          unit_multiplier: item.unitMultiplier,
          cost_price: item.costPrice,
          price_type: item.priceType as 'retail' | 'wholesale' | 'half_wholesale' | 'credit',
          modifiers: item.modifiers ? JSON.stringify(item.modifiers) : '[]',
          serials: itemSerials.length > 0 ? JSON.stringify(itemSerials) : '[]',
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any).returning('id').executeTakeFirstOrThrow();
        const saleLineId = Number(insertedLine.id);

        const claimedSerials = await this.claimSaleSerials(trx, item, saleId, saleLineId, scope.tenantId);
        if (claimedSerials.length > 0) await trx.updateTable('sale_items')
          .set({ serials: JSON.stringify(claimedSerials) })
          .where('tenant_id', '=', scope.tenantId).where('id', '=', saleLineId).execute();

        if (item.isService) {
          continue;
        }

        let remainingQty = item.requiredQty;
        let allocationOrder = 1;
        const allocations = [];

        // Lock-order normalization: applyStockDelta (and therefore purchases, transfers and
        // production) always locks products BEFORE product_location_stock. Taking the location rows
        // first here would invert that order and deadlock against those flows (ABBA). Acquiring the
        // product row up front makes the global order products -> product_location_stock everywhere.
        await this.lockProductRow(trx, item.productId, scope);

        // INV-FLOATING-POOL-ALLOCATION-LEG: assigned locations first,
        // then the unassigned pool as the final leg (see
        // computeSaleAllocationLegs in sales-write.helper.ts). The pool
        // row is read only when the assigned legs leave a shortfall,
        // and never when an eligible leg already targets a null
        // location (that read already targets a null-location row).
        const locationAvailabilities: Array<{ locationId: number | null; branchId: number | null; availableQty: number }> = [];
        for (const loc of eligibleLocations) {
          const locStock = await trx.selectFrom('product_location_stock')
            .select(['qty', 'reserved_qty'])
            .where('product_id', '=', item.productId)
            .where('location_id', '=', loc.id)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .forUpdate()
            .executeTakeFirst();

          locationAvailabilities.push({
            locationId: loc.id,
            branchId: loc.branchId,
            availableQty: Math.max(0, Number(locStock?.qty || 0) - Number(locStock?.reserved_qty || 0)),
          });
        }
        let allocationLegs = computeSaleAllocationLegs({
          requiredQty: remainingQty,
          locationAvailabilities,
          poolAvailableQty: 0,
          saleLocationId: normalized.locationId,
          saleBranchId: normalized.branchId,
        });
        if (allocationLegs.remainingQty > 0 && !eligibleLocations.some((loc) => loc.id == null)) {
          const poolRow = await trx.selectFrom('product_location_stock')
            .select(['qty', 'reserved_qty'])
            .where('product_id', '=', item.productId)
            .where('location_id', 'is', null)
            .where('branch_id', 'is', null)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .forUpdate()
            .executeTakeFirst();
          allocationLegs = computeSaleAllocationLegs({
            requiredQty: remainingQty,
            locationAvailabilities,
            poolAvailableQty: Math.max(0, Number(poolRow?.qty || 0) - Number(poolRow?.reserved_qty || 0)),
            saleLocationId: normalized.locationId,
            saleBranchId: normalized.branchId,
          });
        }
        for (const leg of allocationLegs.legs) {
          allocations.push({ locationId: leg.locationId, branchId: leg.branchId, qty: leg.qty });
        }
        remainingQty = allocationLegs.remainingQty;

        if (remainingQty > 0) {
           if (!allowNegativeStockSales) {
              throw await this.buildInsufficientStockError(trx, {
                productId: item.productId,
                productName: item.productName,
                currentLocationId: eligibleLocations.length === 1 ? eligibleLocations[0].id : null,
                currentLocationName: eligibleLocations.length > 1 ? 'المخازن المتاحة للفرع' : undefined,
                excludedLocationIds: eligibleLocations.map((l) => l.id).filter((id): id is number => id != null),
                currentAvailableQty: allocationLegs.pooledAvailableQty,
                requiredQty: item.qty,
                tenantId: scope.tenantId,
              });
           }
           allocations.push({ locationId: normalized.locationId, branchId: normalized.branchId, qty: remainingQty });
           remainingQty = 0;
        }

        for (const alloc of allocations) {
          const stockChange = await applyStockDelta(trx, {
            productId: item.productId,
            delta: -alloc.qty,
            branchId: alloc.branchId,
            locationId: alloc.locationId,
            tenantId: scope.tenantId,
            accountId: scope.accountId,
            errorCode: 'INSUFFICIENT_STOCK',
            errorMessage: `Insufficient stock for ${item.productName}`,
            allowNegative: allowNegativeStockSales,
          });

          await trx.insertInto('stock_movements').values({
            product_id: item.productId,
            movement_type: 'sale_edit',
            qty: -alloc.qty,
            before_qty: stockChange.scopeBefore,
            after_qty: stockChange.scopeAfter,
            reason: 'sale_edit',
            note: `Sale edit S-${saleId}`,
            reference_type: 'sale',
            reference_id: saleId,
            branch_id: alloc.branchId,
            location_id: alloc.locationId,
            created_by: auth.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).execute();

          await trx.insertInto('sale_line_stock_allocations').values({
             tenant_id: scope.tenantId,
             account_id: scope.accountId,
             sale_id: saleId,
             sale_line_id: saleLineId,
             product_id: item.productId,
             location_id: alloc.locationId as number,
             quantity: alloc.qty,
             allocation_order: allocationOrder++,
          }).execute();
        }

        await this.deductPharmacyBatchesFefo(trx, item.productId, allocations, scope, saleId, saleLineId);
        await this.deductInventoryBatchesFefo(trx, item.productId, allocations, scope, saleId, saleLineId);
        for (const alloc of allocations) {
          const lotAllocation = await allocateSaleFromImportLots(trx, {
            tenantId: scope.tenantId,
            saleId: saleId,
            locationId: alloc.locationId ?? normalized.locationId,
            items: [{
              itemId: saleLineId,
              productId: item.productId,
              qty: alloc.qty,
              netUnitPrice: allocationByItem.get(item)!.netUnitPrice,
              locationId: alloc.locationId ?? normalized.locationId,
            }],
          });
          // INV-IMPORT-LOT-SHORTFALL-RECORD: never discard the coverage.
          await this.recordImportLotShortfalls(trx, scope, saleId, saleLineId, lotAllocation, auth);
        }

        if (item.modifiers && Array.isArray(item.modifiers) && this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant')) {
          for (const mod of item.modifiers) {
            // R8-A: flat addons have no stock to deduct (see createSale).
            const isFlatAddon = Number(mod.productId || 0) > 0
              && !Number(mod.optionId || mod.option_id || mod.id || 0)
              && flatAddonCosts.has(Number(mod.productId));
            if (mod.productId && !isFlatAddon) {
              const modifierQty = Number((Number(mod.qty || 1) * Number(item.qty || 1) * Number(mod.consumptionQty || 1)).toFixed(3));
              
              let modRemainingQty = modifierQty;
              let modAllocationOrder = 1;
              const modAllocations = [];

              // Same canonical lock order as the parent item (products -> product_location_stock).
              await this.lockProductRow(trx, Number(mod.productId), scope);

              // INV-FLOATING-POOL-ALLOCATION-LEG: same assigned-first,
              // pool-last leg computation as the parent item (see
              // computeSaleAllocationLegs in sales-write.helper.ts).
              const modLocationAvailabilities: Array<{ locationId: number | null; branchId: number | null; availableQty: number }> = [];
              for (const loc of eligibleLocations) {
                const locStock = await trx.selectFrom('product_location_stock')
                  .select(['qty', 'reserved_qty'])
                  .where('product_id', '=', Number(mod.productId))
                  .where('location_id', '=', loc.id)
                  .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                  .forUpdate()
                  .executeTakeFirst();

                modLocationAvailabilities.push({
                  locationId: loc.id,
                  branchId: loc.branchId,
                  availableQty: Math.max(0, Number(locStock?.qty || 0) - Number(locStock?.reserved_qty || 0)),
                });
              }
              let modAllocationLegs = computeSaleAllocationLegs({
                requiredQty: modRemainingQty,
                locationAvailabilities: modLocationAvailabilities,
                poolAvailableQty: 0,
                saleLocationId: normalized.locationId,
                saleBranchId: normalized.branchId,
              });
              if (modAllocationLegs.remainingQty > 0 && !eligibleLocations.some((loc) => loc.id == null)) {
                const modPoolRow = await trx.selectFrom('product_location_stock')
                  .select(['qty', 'reserved_qty'])
                  .where('product_id', '=', Number(mod.productId))
                  .where('location_id', 'is', null)
                  .where('branch_id', 'is', null)
                  .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                  .forUpdate()
                  .executeTakeFirst();
                modAllocationLegs = computeSaleAllocationLegs({
                  requiredQty: modRemainingQty,
                  locationAvailabilities: modLocationAvailabilities,
                  poolAvailableQty: Math.max(0, Number(modPoolRow?.qty || 0) - Number(modPoolRow?.reserved_qty || 0)),
                  saleLocationId: normalized.locationId,
                  saleBranchId: normalized.branchId,
                });
              }
              for (const leg of modAllocationLegs.legs) {
                modAllocations.push({ locationId: leg.locationId, branchId: leg.branchId, qty: leg.qty });
              }
              modRemainingQty = modAllocationLegs.remainingQty;

              if (modRemainingQty > 0) {
                 if (!allowNegativeStockSales) {
                    throw new AppError(`Insufficient stock for modifier ${mod.name}`, 'INSUFFICIENT_MODIFIER_STOCK', 400);
                 }
                 modAllocations.push({ locationId: normalized.locationId, branchId: normalized.branchId, qty: modRemainingQty });
                 modRemainingQty = 0;
              }

              for (const alloc of modAllocations) {
                const modStockChange = await applyStockDelta(trx, {
                  productId: Number(mod.productId),
                  delta: -alloc.qty,
                  branchId: alloc.branchId,
                  locationId: alloc.locationId,
                  tenantId: scope.tenantId,
                  accountId: scope.accountId,
                  errorCode: 'INSUFFICIENT_MODIFIER_STOCK',
                  errorMessage: `Insufficient stock for modifier ${mod.name}`,
                  allowNegative: allowNegativeStockSales,
                });

                await trx
                  .insertInto('stock_movements')
                  .values({
                    product_id: Number(mod.productId),
                    movement_type: 'sale_edit',
                    qty: -alloc.qty,
                    before_qty: modStockChange.scopeBefore,
                    after_qty: modStockChange.scopeAfter,
                    reason: 'sale_edit_modifier',
                    note: `Sale edit S-${saleId} (${item.productName})`,
                    reference_type: 'sale',
                    reference_id: saleId,
                    branch_id: alloc.branchId,
                    location_id: alloc.locationId,
                    created_by: auth.userId,
                    tenant_id: scope.tenantId,
                    account_id: scope.accountId,
                  } as any)
                  .execute();

                await trx.insertInto('sale_line_stock_allocations').values({
                   tenant_id: scope.tenantId,
                   account_id: scope.accountId,
                   sale_id: saleId,
                   sale_line_id: saleLineId,
                   product_id: Number(mod.productId),
                   location_id: alloc.locationId as number,
                   quantity: alloc.qty,
                   allocation_order: modAllocationOrder++,
                }).execute();
              }
            }
          }
        }
      }

      if (normalized.storeCreditUsed > 0 && customer) {
        await trx.updateTable('customers').set({
          store_credit_balance: calculateStoreCreditBalance(Number(customer.store_credit_balance || 0), -normalized.storeCreditUsed, moneyDigits),
          updated_at: sql`NOW()`,
        }).where('id', '=', customer.id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      }

      const remainingDebt = roundMoney(Math.max(0, collectibleTotal - paidAmount), moneyDigits);
      if (customer && remainingDebt > 0) {
        await this.finance.createCustomerLedgerEntry(
          trx,
          customer.id,
          remainingDebt,
          `تعديل فاتورة بيع S-${saleId}${paidAmount > 0 ? ' (متبقي آجل)' : ''}`,
          saleId,
          auth,
        );
      } else if (customer && remainingDebt === 0) {
        // INV-CUSTOMER-SUPPLIER-STATEMENTS: same fully-settled pair as
        // createSale above -- a settled edit must leave the invoice
        // visible in the statement instead of writing no row. Net zero,
        // so the balance is unchanged; 'sale_paid' keeps the
        // 'sale_credit' readers (van split sales, trip counters) from
        // mistaking this charge for a debt.
        const settled = roundMoney(collectibleTotal - remainingDebt, moneyDigits);
        if (settled > 0) {
          await this.finance.addCustomerLedgerLeg(trx, customer.id, settled, 'sale_paid', `تعديل فاتورة بيع S-${saleId}`, 'sale', saleId, auth);
          await this.finance.addCustomerPaymentLedgerEntry(trx, customer.id, -settled, `سداد تعديل فاتورة بيع S-${saleId}`, 'sale', saleId, auth, normalized.branchId, normalized.locationId);
        }
      }

      for (const payment of payments) {
        if (payment.paymentChannel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(trx, payment.amount, `تعديل فاتورة بيع S-${saleId}`, saleId, auth, normalized.branchId, normalized.locationId);
      }

      if (postCloseEdit) {
        await trx.insertInto('pos_audit_events').values({
          tenant_id: scope.tenantId, account_id: scope.accountId, event_type: 'sale_edit_post_close',
          user_id: auth.userId, sale_id: saleId, product_id: null, amount: Number(sale.total || 0),
          reason: editReason, metadata: { postClose: true, originalShiftId: postCloseShiftId, managerApproved: true },
        }).execute();
      }

      await this.accountingPosting.postSaleEdit(trx, saleId, auth, editReason, preparedWasteEdit ? { preparedWaste: preparedWasteEdit } : undefined);

      if (postCloseEdit && postCloseShiftId) {
        await this.refreshClosedShiftForPostCloseChange(trx, postCloseShiftId, saleId, 'edit', editReason, auth);
      }
    });

    await this.audit.log('تعديل فاتورة بيع', `تم تعديل الفاتورة S-${saleId} بواسطة ${auth.username} | السبب: ${editReason}${postCloseEdit ? ` | تعديل بعد إغلاق الوردية الأصلية #${postCloseShiftId}` : ''}`, auth);
    const sale = await this.query.getSaleById(saleId, auth);
    return { ok: true, sale: sale.sale };
  }
}
