import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { getTenantTimezone } from '../../../../common/utils/tenant-timezone.util';
import { resolveListEffectivePrice, resolvePriceListContext } from '../../engines/price-list-resolution.engine';
import { buildPreparedSaleItem, calculateAllowedSaleUnitPrice } from '../../helpers/sales-write.helper';
import type { CreateSaleContext, CreateSaleDeps } from './create-sale-types';

export class PrepareSaleItemsService {
  constructor(
    private readonly assertUnitPriceChangeAllowed: CreateSaleDeps['assertUnitPriceChangeAllowed'],
    private readonly buildInsufficientStockError: CreateSaleDeps['buildInsufficientStockError'],
  ) {}

  /**
   * Phase 2 — load products, offers, BOMs and stock; build the prepared
   * items, their subtotal and the auto-production list. Facade L831-1004.
   */
  async prepareSaleItems(ctx: CreateSaleContext): Promise<void> {
    const { trx, scope, normalized, auth, effectiveTerms, moneyDigits, allowNegativeStockSales, eligibleLocations } =
      ctx;
    // P7 (single-server-clock rule): offer windows are evaluated in
    // the TENANT day — resolve the zone once per sale on this
    // transaction handle and pass it to the shared selector.
    const businessTimezone = await getTenantTimezone(trx, scope.tenantId);
    const productIds = Array.from(new Set(normalized.items.map((it) => it.productId)));
    const productRows =
      productIds.length > 0
        ? await trx
            .selectFrom('products as p')
            .leftJoin('manufacturing_boms as b', (join) =>
              join
                .onRef('b.product_id', '=', 'p.id')
                .onRef('b.tenant_id', '=', 'p.tenant_id')
                .on('b.is_active', '=', true),
            )
            .select([
              'p.id',
              'p.name',
              'p.name_en',
              'p.stock_qty',
              'p.reserved_qty',
              'p.retail_price',
              'p.wholesale_price',
              'p.half_wholesale_price',
              'p.credit_price',
              'p.cost_price',
              'p.min_selling_price',
              'p.item_type',
              'b.id as bom_id',
            ])
            .where('p.id', 'in', productIds)
            .where(sql<boolean>`p.tenant_id = ${scope.tenantId}`)
            .where('p.is_active', '=', true)
            .execute()
        : [];
    const productMap = new Map(productRows.map((p) => [Number(p.id), p]));

    const allOffers =
      productIds.length > 0
        ? await trx
            .selectFrom('product_offers')
            .select([
              'product_id',
              'offer_type',
              'value',
              'start_date',
              'end_date',
              'min_qty',
              'bogo_buy_qty',
              'bogo_get_qty',
              'bogo_discount_percent',
              'happy_hour_start',
              'happy_hour_end',
              'days_of_week',
            ])
            .where('product_id', 'in', productIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .where('is_active', '=', true)
            .orderBy('id', 'desc')
            .execute()
        : [];
    const offersByProductId = new Map<number, typeof allOffers>();
    for (const off of allOffers) {
      const pId = Number(off.product_id);
      if (!offersByProductId.has(pId)) offersByProductId.set(pId, []);
      offersByProductId.get(pId)!.push(off);
    }

    const bomIds = productRows.map((p) => (p.bom_id ? Number(p.bom_id) : 0)).filter((id) => id > 0);
    const allBomLines =
      bomIds.length > 0
        ? await trx
            .selectFrom('manufacturing_bom_lines as l')
            .innerJoin('products as p', (join) =>
              join.onRef('p.id', '=', 'l.component_product_id').on('p.tenant_id', '=', scope.tenantId),
            )
            .select(['l.bom_id', 'p.name as component_name'])
            .where('l.bom_id', 'in', bomIds)
            .execute()
        : [];
    const bomNamesByBomId = new Map<number, string[]>();
    for (const bl of allBomLines) {
      const bId = Number(bl.bom_id);
      if (!bomNamesByBomId.has(bId)) bomNamesByBomId.set(bId, []);
      bomNamesByBomId.get(bId)!.push(String(bl.component_name || ''));
    }

    const allStockRows =
      normalized.locationId && productIds.length > 0
        ? await trx
            .selectFrom('product_location_stock')
            .select(['product_id', 'location_id', 'branch_id', 'qty', 'reserved_qty'])
            .where('product_id', 'in', productIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute()
        : [];
    const stockRowsByProductId = new Map<number, typeof allStockRows>();
    for (const sr of allStockRows) {
      const pId = Number(sr.product_id);
      if (!stockRowsByProductId.has(pId)) stockRowsByProductId.set(pId, []);
      stockRowsByProductId.get(pId)!.push(sr);
    }

    // INV-VAN-PRICE-LIST-WIRING: the customer's list (assigned, or
    // the tenant default) is resolved ONCE per sale, on the sale
    // transaction — the customer row was already locked by
    // loadSaleContext, and a pool-handle read inside the open
    // transaction would deadlock on PGlite's single connection.
    // Walk-in sales (no customer) have no list and price at retail.
    const priceListContext = normalized.customerId
      ? await resolvePriceListContext(trx, scope.tenantId, normalized.customerId)
      : null;
    // The engine's credit branch runs only for non-wholesale
    // customers on credit terms (wholesale beats credit).
    const enginePaymentTerms: 'cash' | 'credit' =
      ctx.customer?.customer_type === 'wholesale' ? 'cash' : normalized.paymentType === 'credit' ? 'credit' : 'cash';

    let subtotal = 0;
    const preparedItems = [];
    const autoProduceItems = [];
    for (const item of normalized.items) {
      if (Number(item.price || 0) <= 0) {
        throw new AppError('Sale item price must be greater than zero', 'INVALID_SALE_PRICE', 400);
      }
      const product = productMap.get(item.productId);
      if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);

      const activeOffers = offersByProductId.get(item.productId) || [];
      // INV-VAN-PRICE-LIST-WIRING: the tier is derived server-side
      // from the customer type — the client-supplied priceType is
      // accepted by the DTO for compatibility but is never the
      // authority (a caller cannot claim wholesale by sending it).
      // Walk-in (no customer) prices at retail; VIP without a list
      // prices at retail (a list, when assigned, wins via the
      // engine below). The customer's assigned list (or the tenant
      // default), resolved once per sale above, discounts from the
      // tier base; when a list rule applies, the list price is the
      // allowed price and offers do not stack on it.
      const customerType = ctx.customer?.customer_type as string | undefined;
      const derivedPriceType: 'retail' | 'wholesale' | 'half_wholesale' | 'credit' =
        customerType === 'wholesale'
          ? 'wholesale'
          : customerType === 'half_wholesale'
            ? 'half_wholesale'
            : customerType === 'credit'
              ? 'credit'
              : 'retail';
      const tierBasePrice =
        Number(
          derivedPriceType === 'wholesale'
            ? product.wholesale_price || product.retail_price
            : derivedPriceType === 'half_wholesale'
              ? product.half_wholesale_price || product.wholesale_price || product.retail_price
              : derivedPriceType === 'credit'
                ? product.credit_price || product.retail_price
                : product.retail_price,
        ) || 0;
      const listPrice = await resolveListEffectivePrice(
        trx,
        scope.tenantId,
        priceListContext,
        item.productId,
        item.qty,
        tierBasePrice,
        { paymentTerms: enginePaymentTerms },
        moneyDigits,
      );
      const listApplies = listPrice.appliedRule !== 'none';
      const allowedUnitPrice = calculateAllowedSaleUnitPrice({
        retailPrice: product.retail_price,
        wholesalePrice: product.wholesale_price,
        halfWholesalePrice: product.half_wholesale_price,
        creditPrice: product.credit_price,
        priceType: derivedPriceType,
        listEffectivePrice: listApplies ? listPrice.effectivePrice : null,
        offers: activeOffers,
        qty: item.qty,
        unitMultiplier: item.unitMultiplier,
        businessTimezone,
        moneyDigits,
      });
      // The derived tier is what the prepared item (and the stored
      // sale_items row) carries — the client's priceType never does.
      item.priceType = derivedPriceType;
      const approvedUnitPrice = effectiveTerms?.approvedUnitPrices?.[item.productId];
      const isApprovedPrice =
        approvedUnitPrice !== undefined && Math.abs(Number(item.price || 0) - Number(approvedUnitPrice)) <= 0.0001;
      if (!isApprovedPrice) {
        await this.assertUnitPriceChangeAllowed(
          trx,
          auth,
          Number(item.price || 0),
          allowedUnitPrice,
          item.productId,
          normalized.managerPin,
        );
      }
      const effectiveAllowedUnitPrice =
        isApprovedPrice && approvedUnitPrice !== undefined ? Number(approvedUnitPrice) : allowedUnitPrice;

      let availableStockQty = 0;
      const productStockRows = stockRowsByProductId.get(item.productId) || [];
      if (!normalized.locationId) {
        availableStockQty = Math.max(0, Number(product.stock_qty || 0) - Number(product.reserved_qty || 0));
      } else if (eligibleLocations.length === 1) {
        const locRow = productStockRows.find((r) => Number(r.location_id) === Number(normalized.locationId));
        const unassignedRow = productStockRows.find((r) => r.location_id == null && r.branch_id == null);
        const locAvail = Math.max(0, Number(locRow?.qty || 0) - Number(locRow?.reserved_qty || 0));
        const unassignedAvail = Math.max(0, Number(unassignedRow?.qty || 0) - Number(unassignedRow?.reserved_qty || 0));
        availableStockQty = Number((locAvail + unassignedAvail).toFixed(3));
      } else {
        // If all_operational_locations is enabled, sum the stock of all eligible locations + unassigned
        const locIds = eligibleLocations.map((l) => l.id).filter((id) => id != null);
        let totalEligible = 0;
        for (const row of productStockRows) {
          const rowAvail = Math.max(0, Number(row.qty || 0) - Number(row.reserved_qty || 0));
          if (row.location_id == null && row.branch_id == null) {
            totalEligible += rowAvail;
          } else if (row.location_id != null && locIds.includes(Number(row.location_id))) {
            totalEligible += rowAvail;
          }
        }
        availableStockQty = Number(totalEligible.toFixed(3));
      }

      const hasBOM = !!product.bom_id;
      let finalProductName = product.name;

      if (hasBOM) {
        const bomLines = bomNamesByBomId.get(Number(product.bom_id)) || [];
        if (bomLines.length > 0) {
          finalProductName = `${product.name} (${bomLines.join(' + ')})`;
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
        {
          allowNegativeStockSales: allowNegativeStockSales || hasBOM || (product as any).item_type === 'service',
          moneyDigits,
        },
      );

      subtotal += preparedItem.lineTotal;
      preparedItems.push({
        ...preparedItem,
        isService: (product as any).item_type === 'service',
        effectiveAllowedUnitPrice,
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
    ctx.productMap = productMap;
    ctx.offersByProductId = offersByProductId;
    ctx.bomNamesByBomId = bomNamesByBomId;
    ctx.stockRowsByProductId = stockRowsByProductId;
    ctx.subtotal = subtotal;
    ctx.preparedItems = preparedItems;
    ctx.autoProduceItems = autoProduceItems;
  }
}
