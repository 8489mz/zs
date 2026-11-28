import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { releaseLocationStock } from '../../../../common/utils/location-stock-ledger';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { assertBusinessAccountingDate } from '../../../accounting/accounting-boundaries';
import { currencyMoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import {
  ALL_OPERATIONAL_LOCATIONS,
  posSellsFromAllOperationalLocations,
  resolveBranchSellableLocations,
} from '../../../../common/engines/branch-sellable-locations.engine';
import { assertProductsNot86ed } from '../restaurant-advanced-fnb.service';
import { resolvePosOfflineSyncIdentity } from '../../engines/pos-offline-sale.engine';
import type { ExchangeReturnContext } from '../../../../common/utils/exchange-return.port';
import type { CreateSaleContext, CreateSaleDeps } from './create-sale-types';

export class LoadSaleContextService {
  constructor(
    private readonly lockSaleStockRows: CreateSaleDeps['lockSaleStockRows'],
    private readonly planFeatureService: CreateSaleDeps['planFeatureService'],
    private readonly returnsService: CreateSaleDeps['returnsService'],
    private readonly getAllowNegativeStockSales: CreateSaleDeps['getAllowNegativeStockSales'],
    private readonly enforceRestaurantModifierContract: CreateSaleDeps['enforceRestaurantModifierContract'],
  ) {}
  /**
   * Phase 1 — load the sale context: accounting date, money digits,
   * modifier contract, the 86 check, exchange context, online order,
   * conversion release, customer, branch, sellable locations, negative
   * stock permission. Facade L608-829.
   */
  async loadSaleContext(ctx: CreateSaleContext): Promise<void> {
    const { trx, scope, normalized, payload, auth, effectiveTerms, returnedItems, isExchange, conversionRelease } = ctx;
    const offlineIdentity = resolvePosOfflineSyncIdentity(payload);
    // INV-OFFLINE-SYNC-SERVER-TIMESTAMP: the accounting date is the
    // server sync instant, never the client-claimed offline date —
    // a device clock set days back must not move the posting into
    // another business day. The client date stays on the context
    // as evidence only.
    await assertBusinessAccountingDate(trx, scope.tenantId, offlineIdentity.serverSyncAt, true);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
    // R4-C INV-REST-MODIFIER-CONTRACT-2: re-price modifiers from
    // server truth and enforce group rules FIRST — before any stock
    // lock, so an unverifiable modifier price fails as 422
    // RESTAURANT_MODIFIER_PRICE_UNVERIFIED instead of the stock
    // lock's 404 PRODUCT_NOT_FOUND for a ghost modifier productId,
    // and before the prepared-items loop freezes lineTotal.
    await this.enforceRestaurantModifierContract(
      trx,
      normalized.items,
      scope.tenantId,
      this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant'),
      // SF-3 D-SF-03: an online order converts at its frozen modifier
      // prices (resolveOnlineOrderTerms above); a walk-in sale passes
      // none and keeps re-pricing from current truth.
      effectiveTerms?.approvedModifierPrices,
    );
    // INV-REST-FNB-TRUTH-2 (R-I11): 86 enforcement at line
    // validation, before totals and before any stock lock — an
    // 86'd line fails as 422 ITEM_86ED naming the item, including
    // a held draft whose item became 86'd after the hold. The
    // line is never silently dropped; the cashier removes it.
    await assertProductsNot86ed(
      trx,
      scope.tenantId,
      normalized.branchId ?? null,
      normalized.items.map((item: any) => ({ productId: item.productId })),
    );
    let exchange: ExchangeReturnContext | undefined;
    if (isExchange) {
      const original = await trx
        .selectFrom('sales')
        .select(['id', 'customer_id', 'branch_id'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(payload.exchangeSaleId))
        .where('status', '=', 'posted')
        .forUpdate()
        .executeTakeFirst();
      if (
        !original ||
        !normalized.customerId ||
        Number(original.customer_id) !== normalized.customerId ||
        Number(original.branch_id) !== Number(normalized.branchId)
      ) {
        throw new AppError('الاستبدال يتطلب نفس العميل المسجل وفرع الفاتورة الأصلية', 'EXCHANGE_SOURCE_MISMATCH', 422);
      }
      await this.lockSaleStockRows(trx, scope, [...normalized.items, ...returnedItems]);
      await trx
        .selectFrom('customers')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', normalized.customerId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      exchange = await this.returnsService.prepareExchangeReturn(
        trx,
        {
          type: 'sale',
          invoiceId: Number(original.id),
          managerPin: payload.managerPin,
          note: 'استبدال فوري ذري',
          items: returnedItems.map((item) => ({
            productId: item.productId,
            qty: Math.abs(item.qty),
            saleItemId: item.originalSaleItemId,
            serials: item.serials,
          })),
        },
        auth,
      );
    }
    let onlineOrderToRelease: any = null;
    if (payload.onlineOrderId) {
      onlineOrderToRelease = await trx
        .selectFrom('online_orders')
        .selectAll()
        .where('id', '=', Number(payload.onlineOrderId))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();

      if (onlineOrderToRelease?.sale_id) {
        throw new AppError('تم تحويل هذا الطلب لفاتورة مبيعات مسبقاً', 'ORDER_ALREADY_INVOICED', 400);
      }
      if (
        !onlineOrderToRelease ||
        ['cancelled', 'payment_failed', 'review_required'].includes(onlineOrderToRelease.status)
      ) {
        throw new AppError(
          'لا يمكن إصدار فاتورة لهذا الطلب قبل تسوية حالة الدفع',
          'ORDER_PAYMENT_REVIEW_REQUIRED',
          400,
        );
      }
      if (onlineOrderToRelease.gateway_order_id && onlineOrderToRelease.payment_status !== 'paid') {
        throw new AppError('توجد جلسة دفع إلكترونية معلقة لهذا الطلب', 'ORDER_PAYMENT_PENDING', 400);
      }

      if (onlineOrderToRelease?.stock_reserved) {
        let orderItems: Array<any> = [];
        try {
          const raw = onlineOrderToRelease.items_json;
          orderItems = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
        } catch {}
        if (orderItems.length > 0) {
          await this.lockSaleStockRows(trx, scope, [...normalized.items, ...orderItems]);
          await releaseLocationStock(trx, {
            branchId: onlineOrderToRelease.reserved_branch_id ?? onlineOrderToRelease.branch_id,
            locationId: onlineOrderToRelease.reserved_location_id,
            tenantId: scope.tenantId,
            accountId: scope.accountId,
            items: orderItems.map((it) => ({
              productId: Number(it.productId),
              qty: Number(it.quantity ?? it.qty ?? 1),
            })),
          });
        }
      }
    }

    if (!onlineOrderToRelease?.stock_reserved) {
      await this.lockSaleStockRows(trx, scope, normalized.items);
    }

    if (normalized.discount < 0) throw new AppError('Discount cannot be negative', 'INVALID_DISCOUNT', 400);
    if (normalized.storeCreditUsed < 0)
      throw new AppError('Store credit cannot be negative', 'INVALID_STORE_CREDIT', 400);

    // INV-SALES-ORDER-CONVERSION-STOCK-LEGS: a sales-order conversion
    // releases its reservation here, inside the sale transaction, under
    // the product locks taken above — never before the sale, where a
    // concurrent sale could consume the freed stock, and never after,
    // where a rollback would leave the reservation silently lost.
    // The order must still be in the 'converting' state claimed by
    // convertToSale; anything else fails closed before any stock moves.
    if (conversionRelease && conversionRelease.items.length > 0) {
      const converting = await trx
        .selectFrom('sales_orders')
        .select('id')
        .where('id', '=', conversionRelease.salesOrderId)
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '=', 'converting')
        .forUpdate()
        .executeTakeFirst();
      if (!converting) {
        throw new AppError('Sales order is not being converted', 'SALES_ORDER_NOT_CONVERTING', 409);
      }
      await releaseLocationStock(trx, {
        branchId: conversionRelease.branchId,
        locationId: conversionRelease.locationId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        items: conversionRelease.items,
      });
    }

    const customer = normalized.customerId
      ? await trx
          .selectFrom('customers')
          .select([
            'id',
            'name',
            'balance',
            'credit_limit',
            'store_credit_balance',
            'loyalty_points',
            'is_credit_blocked',
            'credit_block_reason',
            'customer_type',
            'price_list_id',
          ])
          .where('id', '=', normalized.customerId)
          .where('tenant_id', '=', scope.tenantId)
          .where('is_active', '=', true)
          .forUpdate()
          .executeTakeFirst()
      : null;
    if (normalized.customerId && !customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
    if (normalized.paymentType === 'credit' && !customer)
      throw new AppError('Credit sale requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);

    let branch: any = null;
    if (normalized.source === 'pos') {
      // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): POS is a source-scoped
      // feature gate, not a sidebar toggle. A wholesale_van tenant
      // without a super-admin 'pos' grant is refused here — before any
      // branch/stock validation — and a grant (auth.featureOverrides,
      // loaded from tenant_feature_overrides at session resolution) opens
      // it even where the mode default blocks POS. The sales controller
      // deliberately carries NO @RequireFeature('pos'): /sales invoicing
      // must stay open for wholesale_van.
      if (
        !this.planFeatureService.hasFeature(
          auth.planId,
          auth.extraFeatures,
          'pos',
          auth.pillar,
          auth.activityType,
          auth.featureOverrides,
        )
      ) {
        throw new AppError('نقطة البيع غير متاحة لهذه المنشأة.', 'POS_FEATURE_NOT_AVAILABLE', 403);
      }
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
        throw new AppError(
          'المخزن الافتراضي لا يجوز أن يكون مخزن تالف أو بضاعة بالطريق أو حجر صحي',
          'POS_DEFAULT_LOCATION_NOT_SELLABLE',
          409,
        );
      }
      if (defaultLocation.branch_id != null && Number(defaultLocation.branch_id) !== Number(normalized.branchId)) {
        throw new AppError('المخزن الافتراضي يتبع فرعاً آخر', 'POS_DEFAULT_LOCATION_BRANCH_MISMATCH', 409);
      }
      normalized.locationId = branch.default_stock_location_id;
    }

    // Validate an explicitly selected sale warehouse too: the default branch
    // guard alone does not protect manually entered or edited invoices.
    if (normalized.locationId) {
      const selectedLocation = await trx
        .selectFrom('stock_locations')
        .select(['id', 'is_active', 'location_type'])
        .where('id', '=', normalized.locationId)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .executeTakeFirst();
      if (!selectedLocation || !selectedLocation.is_active) {
        throw new AppError('مخزن البيع غير موجود أو غير نشط', 'SALE_LOCATION_UNAVAILABLE', 409);
      }
      if (['damaged', 'in_transit', 'quarantine'].includes(selectedLocation.location_type || '')) {
        throw new AppError(
          'لا يمكن بيع المخزون التالف أو البضاعة بالطريق أو المحجوز صحياً',
          'SALE_LOCATION_NOT_SELLABLE',
          409,
        );
      }
    }

    // أي المخازن يجوز لهذا الفرع السحب منها — القاعدة في `branch-sellable-locations.engine.ts`،
    // ويستدعيها مسار طلب المتجر الإلكتروني أيضاً. كانت مكتوبة هنا وحدها، فكان الكاشير يبيع صنفاً
    // يرفضه الموقع على نفس الفرع ونفس المخزون.
    let eligibleLocations: Array<{ id: number | null; branchId: number | null }> = [
      { id: normalized.locationId, branchId: normalized.branchId },
    ];
    if (normalized.source === 'pos' && posSellsFromAllOperationalLocations(branch, auth.activityType)) {
      const allLocs = await trx
        .selectFrom('stock_locations')
        .select(['id', 'location_type', 'branch_id'])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .where('is_active', '=', true)
        .execute();
      // F9: the engine itself gates on the branch mode, so a
      // wholesale_van tenant hands it the EFFECTIVE mode (the
      // storefront precedent: { ...branch, sales_stock_mode:
      // effectiveMode }) — passing the raw single_location row
      // would collapse the widened pool back to the default
      // location, and display (46) and checkout (4) would disagree.
      eligibleLocations = resolveBranchSellableLocations(
        { ...branch, sales_stock_mode: ALL_OPERATIONAL_LOCATIONS },
        normalized.branchId,
        allLocs,
      );
    }

    // SF-2 D-SF-11: one stock gate for storefront orders — the
    // conversion honours the storefront placement promise carried in
    // the approved terms (an order the store was allowed to take must
    // be convertible), OR the POS negative-stock policy. Walk-in POS
    // sales carry no terms flag and keep the POS setting alone.
    const allowNegativeStockSales =
      (await this.getAllowNegativeStockSales(trx, scope.tenantId)) || effectiveTerms?.allowNegativeStock === true;
    ctx.moneyDigits = moneyDigits;
    ctx.exchange = exchange;
    ctx.onlineOrderToRelease = onlineOrderToRelease;
    ctx.customer = customer;
    ctx.branch = branch;
    ctx.eligibleLocations = eligibleLocations;
    ctx.allowNegativeStockSales = allowNegativeStockSales;
    ctx.isOfflineSyncSale = offlineIdentity.isOfflineSyncSale;
    ctx.offlineDocNo = offlineIdentity.offlineDocNo;
    ctx.offlineCreatedAt = offlineIdentity.offlineCreatedAt;
    ctx.serverSyncAt = offlineIdentity.serverSyncAt;
    ctx.posTerminalCode = offlineIdentity.posTerminalCode;
  }
}
