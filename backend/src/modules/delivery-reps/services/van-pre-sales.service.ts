import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { reserveLocationStock, releaseLocationStock } from '../../../common/utils/location-stock-ledger';
import { sortItemsByProductId, generateDailySequenceNumber, listRepUsableWarehouseScope, assertWarehouseInRepScope } from './van-common.util';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { normalizeDateOnly, todayLocalIsoDate } from '../../sales/helpers/sales-write.helper';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { SalesService } from '../../sales/sales.service';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

export interface PreSalesCatalogItem {
  id: number;
  name: string;
  barcode: string | null;
  stockQty: number;
  warehouseStock?: number;
  reservedQty: number;
  warehouseReserved?: number;
  availableQty: number;
  warehouseAvailable?: number;
  // INV-REP-SCOPED-DRIVER-READS (M19/D9): the four non-retail prices
  // are present only on staff reads. A driver call (repId present)
  // omits them entirely — the driver sees the retail price only, like
  // getDriverAvailableProducts.
  costPrice?: number;
  retailPrice: number;
  creditPrice?: number;
  consumerPrice?: number;
  wholesalePrice?: number;
  supplierId?: number | null;
  supplierName?: string | null;
  categoryId?: number | null;
  categoryName?: string | null;
  packagingUnit?: { name: string; multiplier: number } | null;
  units: Array<{
    id: number;
    name: string;
    multiplier: number;
    isBaseUnit: boolean;
    isSaleUnitDefault: boolean;
    isBase?: boolean;
    isSaleDefault?: boolean;
  }>;
  activeOffers: Array<{
    id: number;
    offerType: string;
    value: number;
    minQty: number;
    startDate: string | null;
    endDate: string | null;
  }>;
  offers?: Array<{
    id: number;
    offerType: string;
    value: number;
    minQty: number;
  }>;
}

export interface CreatePreSalesOrderDto {
  customerId?: number;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  warehouseLocationId?: number;
  paymentMethod: 'cash' | 'credit';
  items: Array<{
    productId: number;
    qty?: number;
    quantity?: number;
    unitName?: string;
    unitMultiplier?: number;
    unitPrice?: number;
  }>;
  notes?: string;
  deliveryDate?: string;
}

@Injectable()
export class VanPreSalesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly salesService?: SalesService,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Resolves the primary warehouse location for Pre-Sales booking.
   * Priority:
   * 1. Explicit preferredLocationId (if active and operational)
   * 2. If productIds are provided, the operational warehouse with the highest stock for these items
   * 3. Main internal warehouse (`location_type = 'internal_warehouse'`)
   * 4. Branch's default stock location (`b.default_stock_location_id`)
   * 5. Any operational warehouse location (excluding van_stock, damaged, in_transit)
   */
  async resolveDefaultWarehouseLocationId(
    tenantId: string,
    preferredLocationId?: number,
    productIds?: number[],
  ): Promise<number | null> {
    if (preferredLocationId && preferredLocationId > 0) {
      const explicit = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('id', '=', preferredLocationId)
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .where('location_type', 'not in', ['van_stock', 'damaged', 'in_transit', 'quarantine'])
        .executeTakeFirst();
      if (explicit) return Number(explicit.id);
    }

    // 1. If productIds are provided, check which operational warehouse has actual stock for these products!
    if (productIds && productIds.length > 0) {
      const locWithStock = await this.anyDb
        .selectFrom('product_location_stock as pls')
        .innerJoin('stock_locations as sl', 'sl.id', 'pls.location_id')
        .select(['sl.id', sql<number>`sum(coalesce(pls.qty, 0))`.as('total_qty')])
        .where('pls.product_id', 'in', productIds)
        .where('pls.tenant_id', '=', tenantId)
        .where('sl.is_active', '=', true)
        .where('sl.location_type', 'not in', ['van_stock', 'damaged', 'in_transit', 'quarantine'])
        .groupBy('sl.id')
        .orderBy('total_qty', 'desc')
        .executeTakeFirst();
      if (locWithStock && Number(locWithStock.total_qty || 0) > 0) {
        return Number(locWithStock.id);
      }
    }

    // 2. Main internal warehouse (internal_warehouse)
    const internalWh = await this.anyDb
      .selectFrom('stock_locations')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .where('location_type', '=', 'internal_warehouse')
      .orderBy('id', 'asc')
      .executeTakeFirst();
    if (internalWh) return Number(internalWh.id);

    // 3. Branch's default stock location
    const branchDefault = await this.anyDb
      .selectFrom('branches as b')
      .innerJoin('stock_locations as sl', 'sl.id', 'b.default_stock_location_id')
      .select(['sl.id'])
      .where('b.tenant_id', '=', tenantId)
      .where('sl.is_active', '=', true)
      .where('sl.location_type', 'not in', ['van_stock', 'damaged', 'in_transit', 'quarantine'])
      .orderBy('b.id', 'asc')
      .executeTakeFirst();
    if (branchDefault) return Number(branchDefault.id);

    // 4. Any operational warehouse location (excluding van_stock, damaged, in_transit)
    const operationalWh = await this.anyDb
      .selectFrom('stock_locations')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .where('location_type', 'not in', ['van_stock', 'damaged', 'in_transit', 'quarantine'])
      .orderBy('id', 'asc')
      .executeTakeFirst();
    if (operationalWh) return Number(operationalWh.id);

    return null;
  }

  /**
   * Lists catalog items from the warehouse with live available stock, pricing tiers, and active offers.
   */
  async listWarehouseCatalog(
    tenantId: string,
    warehouseLocationId?: number,
    query?: { search?: string; categoryId?: number; limit?: number; offset?: number },
    repId?: number,
  ): Promise<{ ok?: boolean; items: PreSalesCatalogItem[]; products?: PreSalesCatalogItem[]; total: number; targetWarehouseId?: number | null }> {
    // INV-REP-SCOPED-DRIVER-READS (M19/D9): a driver call carries
    // repId (driver controller). His catalog shows the retail price
    // only — cost/wholesale/credit/consumer prices are never selected
    // for him — and its stock resolves to a warehouse he loads from.
    // No rep<->category assignment exists anywhere in the schema, so
    // hiding "categories not assigned to the rep" is NOT possible
    // without inventing an assignment source; the price hiding above
    // plus the warehouse scoping below are the scopable parts.
    let effectiveWarehouseLocationId = warehouseLocationId;
    if (repId != null) {
      const scope = await listRepUsableWarehouseScope(this.anyDb, tenantId, repId);
      if (effectiveWarehouseLocationId) {
        assertWarehouseInRepScope(scope, Number(effectiveWarehouseLocationId));
      } else if (scope.hasLoadHistory && scope.mostRecentSourceWarehouseId) {
        effectiveWarehouseLocationId = scope.mostRecentSourceWarehouseId;
      }
    }

    let qb = this.anyDb
      .selectFrom('products as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .leftJoin('product_categories as pc', 'pc.id', 'p.category_id')
      .select([
        'p.id',
        'p.name',
        'p.barcode',
        'p.stock_qty',
        'p.reserved_qty',
        ...(repId != null
          ? []
          : ['p.cost_price', 'p.wholesale_price', 'p.credit_price', 'p.consumer_price']),
        'p.retail_price',
        'p.category_id',
        'p.supplier_id',
        's.name as supplier_name',
        'pc.name as category_name',
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('p.is_active', '=', true);

    if (query?.search?.trim()) {
      const search = `%${query.search.trim().toLowerCase()}%`;
      qb = qb.where((eb: any) =>
        eb.or([
          eb('p.name', 'ilike', search),
          eb('p.barcode', 'ilike', search),
        ]),
      );
    }

    if (query?.categoryId) {
      qb = qb.where('p.category_id', '=', Number(query.categoryId));
    }

    const limit = query?.limit ? Math.min(Number(query.limit), 1000) : 500;
    const offset = query?.offset ? Number(query.offset) : 0;

    const rawProducts = await qb.orderBy('p.name', 'asc').limit(limit).offset(offset).execute();
    if (!rawProducts.length) {
      return { items: [], total: 0 };
    }

    const productIds = rawProducts.map((p: any) => Number(p.id));

    // Fetch units
    const units = await this.anyDb
      .selectFrom('product_units')
      .select(['id', 'product_id', 'name', 'multiplier', 'is_base_unit', 'is_sale_unit_default'])
      .where('product_id', 'in', productIds)
      .where('tenant_id', '=', tenantId)
      .execute();

    const unitsByProduct = new Map<number, any[]>();
    for (const u of units) {
      const pid = Number(u.product_id);
      if (!unitsByProduct.has(pid)) unitsByProduct.set(pid, []);
      unitsByProduct.get(pid)!.push({
        id: Number(u.id),
        name: u.name,
        multiplier: Number(u.multiplier || 1),
        isBaseUnit: Boolean(u.is_base_unit),
        isSaleUnitDefault: Boolean(u.is_sale_unit_default),
      });
    }

    // Fetch active offers
    const nowIso = todayLocalIsoDate();
    const offers = await this.anyDb
      .selectFrom('product_offers')
      .select(['id', 'product_id', 'offer_type', 'value', 'min_qty', 'start_date', 'end_date'])
      .where('product_id', 'in', productIds)
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .execute();

    const offersByProduct = new Map<number, any[]>();
    for (const off of offers) {
      const pid = Number(off.product_id);
      const start = normalizeDateOnly(off.start_date);
      const end = normalizeDateOnly(off.end_date);
      if ((!start || start <= nowIso) && (!end || end >= nowIso)) {
        if (!offersByProduct.has(pid)) offersByProduct.set(pid, []);
        offersByProduct.get(pid)!.push({
          id: Number(off.id),
          offerType: off.offer_type,
          value: Number(off.value || 0),
          minQty: Number(off.min_qty || 1),
          startDate: start,
          endDate: end,
        });
      }
    }

    // Resolve target warehouse location consistently
    const targetWhId = await this.resolveDefaultWarehouseLocationId(tenantId, effectiveWarehouseLocationId, productIds);

    // Query location-specific stock AND unassigned stock for accurate availability matching reserveLocationStock
    const locationStockMap = new Map<number, number>();
    const locationReservedMap = new Map<number, number>();
    if (targetWhId) {
      const locStocks = await this.anyDb
        .selectFrom('product_location_stock')
        .select([
          'product_id',
          sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty'),
          sql<number>`cast(coalesce(reserved_qty, 0) as numeric)`.as('reserved_qty'),
        ])
        .where('product_id', 'in', productIds)
        .where('location_id', '=', targetWhId)
        .where('tenant_id', '=', tenantId)
        .execute();
      for (const ls of locStocks) {
        locationStockMap.set(Number(ls.product_id), Number(ls.qty || 0));
        locationReservedMap.set(Number(ls.product_id), Number(ls.reserved_qty || 0));
      }
    }

    const unassignedStocks = await this.anyDb
      .selectFrom('product_location_stock')
      .select([
        'product_id',
        sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty'),
        sql<number>`cast(coalesce(reserved_qty, 0) as numeric)`.as('reserved_qty'),
      ])
      .where('product_id', 'in', productIds)
      .where('location_id', 'is', null)
      .where('tenant_id', '=', tenantId)
      .execute();
    const unassignedStockMap = new Map<number, number>();
    const unassignedReservedMap = new Map<number, number>();
    for (const us of unassignedStocks) {
      unassignedStockMap.set(Number(us.product_id), Number(us.qty || 0));
      unassignedReservedMap.set(Number(us.product_id), Number(us.reserved_qty || 0));
    }

    const items: PreSalesCatalogItem[] = rawProducts.map((p: any) => {
      const pid = Number(p.id);
      let stock = 0;
      let reserved = 0;
      let available = 0;

      const globalStock = Number(p.stock_qty || 0);
      const globalReserved = Number(p.reserved_qty || 0);
      const globalAvailable = Math.max(0, globalStock - globalReserved);

      if (targetWhId) {
        const locQty = locationStockMap.get(pid) ?? 0;
        const locReserved = locationReservedMap.get(pid) ?? 0;
        const unassignedQty = unassignedStockMap.get(pid) ?? 0;
        const unassignedReserved = unassignedReservedMap.get(pid) ?? 0;

        // Mirror reserveLocationStock logic exactly:
        const availableAtLocation = Math.max(0, locQty - locReserved) + Math.max(0, unassignedQty - unassignedReserved);
        available = Math.min(availableAtLocation, globalAvailable);
        stock = locQty + unassignedQty;
        reserved = locReserved + unassignedReserved;

        // If product has global stock but no location rows yet (legacy single-table stock):
        if (available === 0 && globalAvailable > 0 && locQty === 0 && unassignedQty === 0) {
          available = globalAvailable;
          stock = globalStock;
          reserved = globalReserved;
        }
      } else {
        stock = globalStock;
        reserved = globalReserved;
        available = globalAvailable;
      }

      const retail = Number(p.retail_price || 0);
      const credit = p.credit_price != null && Number(p.credit_price) > 0 ? Number(p.credit_price) : retail;
      const consumer = p.consumer_price != null && Number(p.consumer_price) > 0 ? Number(p.consumer_price) : retail;

      const productUnits = (unitsByProduct.get(pid) || [{ id: 0, name: 'قطعة', multiplier: 1, isBaseUnit: true, isSaleUnitDefault: true }]).map((u) => ({
        ...u,
        isBase: u.isBaseUnit,
        isSaleDefault: u.isSaleUnitDefault,
      }));
      const activeOffers = offersByProduct.get(pid) || [];
      const packUnit = productUnits.find((u) => Number(u.multiplier) > 1);
      const packagingUnit = packUnit ? { name: packUnit.name, multiplier: Number(packUnit.multiplier) } : null;

      return {
        id: pid,
        name: p.name,
        barcode: p.barcode || null,
        stockQty: stock,
        warehouseStock: stock,
        reservedQty: reserved,
        warehouseReserved: reserved,
        availableQty: available,
        warehouseAvailable: available,
        // INV-REP-SCOPED-DRIVER-READS (M19/D9): driver reads carry no
        // cost/wholesale/credit/consumer price at all — retail only.
        ...(repId != null
          ? {}
          : {
              costPrice: Number(p.cost_price || 0),
              creditPrice: credit,
              consumerPrice: consumer,
              wholesalePrice: Number(p.wholesale_price || retail),
            }),
        retailPrice: retail,
        supplierId: p.supplier_id ? Number(p.supplier_id) : null,
        supplierName: (p.supplier_name || '').trim() || 'الشركة العامة',
        categoryId: p.category_id ? Number(p.category_id) : null,
        categoryName: (p.category_name || '').trim() || 'عام',
        packagingUnit,
        units: productUnits,
        activeOffers,
        offers: activeOffers,
      };
    });

    return { ok: true, items, products: items, total: items.length, targetWarehouseId: targetWhId };
  }

  /**
   * Rep books a Pre-Sales order from warehouse catalog, reserving inventory atomically.
   */
  async createPreSalesOrder(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: CreatePreSalesOrderDto,
  ): Promise<{ ok: boolean; orderId: number; orderNumber: string; totalAmount: number; itemsCount: number }> {
    if (!payload.items || !payload.items.length) {
      throw new AppError('يجب تحديد صنف واحد على الأقل لحجز الطلبية', 'EMPTY_PRESALE_ITEMS', 400);
    }

    // Resolve or create customer
    let customerId: number | null = payload.customerId ? Number(payload.customerId) : null;
    let customerName = (payload.customerName || '').trim() || 'عميل تجزئة ميداني';

    if (payload.paymentMethod === 'credit' && !customerId && !payload.customerName) {
      throw new AppError('الطلبيات الآجلة تتطلب تحديد اسم العميل', 'CREDIT_REQUIRES_CUSTOMER', 400);
    }

    // INV-VAN-PRE-SALES-CUSTOMER-ATTRIBUTION: when the rep picked an
    // existing customer, resolve the name (and phone/address) from the
    // tenant-scoped customer row — otherwise the order is stored
    // under the generic default 'عميل تجزئة ميداني' and no read path
    // can attribute it (every read selects the denormalized
    // so.customer_name). The row is authoritative for an existing
    // customer; the default survives only when no row is found.
    // Phone/address come from the row only when the payload omits
    // them.
    let customerPhone = payload.customerPhone || null;
    let customerAddress = payload.customerAddress || null;
    if (customerId) {
      const byId = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'phone', 'address'])
        .where('id', '=', customerId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (byId) {
        customerName = byId.name;
        if (!customerPhone) customerPhone = byId.phone || null;
        if (!customerAddress) customerAddress = byId.address || null;
      }
    }

    if (!customerId && payload.customerName?.trim()) {
      const existing = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name'])
        .where('name', '=', payload.customerName.trim())
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (existing) {
        customerId = Number(existing.id);
        customerName = existing.name;
      } else {
        const [created] = await this.anyDb
          .insertInto('customers')
          .values({
            name: payload.customerName.trim(),
            phone: payload.customerPhone || null,
            address: payload.customerAddress || null,
            is_active: true,
            tenant_id: tenantId,
            account_id: accountId,
          })
          .returning(['id', 'name'])
          .execute();
        customerId = Number(created.id);
        customerName = created.name;
      }
    }

    // Resolve warehouse location consistently using smart resolution
    const productIdsForLookup = payload.items.map((it: any) => Number(it.productId)).filter((id: number) => id > 0);
    let warehouseLocId = payload.warehouseLocationId ? Number(payload.warehouseLocationId) : 0;
    if (!warehouseLocId) {
      const resolved = await this.resolveDefaultWarehouseLocationId(tenantId, undefined, productIdsForLookup);
      if (resolved) warehouseLocId = resolved;
    }

    let orderId = 0;
    let finalOrderNumber = '';
    let totalAmount = 0;
    let grossSubtotalAmount = 0;
    let totalDiscountAmount = 0;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      // Book digits resolved once on THIS transaction handle (D4):
      // every derived pre-sale price/total below rounds at book digits.
      const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      const sortedItems = sortItemsByProductId(payload.items);
      const productIds = sortedItems.map((it) => Number(it.productId));

      // Fetch active offers for these products
      const nowIso = todayLocalIsoDate();
      const offers = await trxAny
        .selectFrom('product_offers')
        .select(['product_id', 'offer_type', 'value', 'min_qty', 'start_date', 'end_date', 'bogo_buy_qty', 'bogo_get_qty', 'bogo_discount_percent'])
        .where('product_id', 'in', productIds)
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .execute();

      const offersByProduct = new Map<number, any[]>();
      for (const off of offers) {
        const pid = Number(off.product_id);
        const start = normalizeDateOnly(off.start_date);
        const end = normalizeDateOnly(off.end_date);
        if ((!start || start <= nowIso) && (!end || end >= nowIso)) {
          if (!offersByProduct.has(pid)) offersByProduct.set(pid, []);
          offersByProduct.get(pid)!.push(off);
        }
      }

      const preparedOrderItems: any[] = [];

      for (const item of sortedItems) {
        const pid = Number(item.productId);
        const qty = Number(item.qty ?? (item as any).quantity ?? 0);
        if (qty <= 0) continue;

        // Canonical Lock: Lock product row first
        const prod = await trxAny
          .selectFrom('products')
          .select(['id', 'name', 'cost_price', 'retail_price', 'wholesale_price', 'credit_price', 'consumer_price', 'stock_qty', 'reserved_qty'])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!prod) {
          throw new AppError(`الصنف رقم #${pid} غير موجود في الكتالوج`, 'PRODUCT_NOT_FOUND', 404);
        }

        const rawMultiplier = item.unitMultiplier ?? (item as any).multiplier ?? 1;
        const multiplier = Number(rawMultiplier) > 0 ? Number(rawMultiplier) : 1;
        const totalBaseQty = Number((qty * multiplier).toFixed(3));
        const availableStock = Math.max(0, Number(prod.stock_qty || 0) - Number(prod.reserved_qty || 0));

        if (availableStock < totalBaseQty) {
          throw new AppError(
            `رصيد المخزن المتاح للصنف "${prod.name}" لا يكفي. المتاح للحجز: ${availableStock}، المطلوب: ${totalBaseQty}`,
            'INSUFFICIENT_WAREHOUSE_STOCK',
            400,
          );
        }

        // Determine baseline list price (Credit Price is official catalog baseline):
        const creditBasePrice = prod.credit_price != null && Number(prod.credit_price) > 0
          ? Number(prod.credit_price) * multiplier
          : Number(prod.retail_price || 0) * multiplier;

        const cashBasePrice = Number(prod.retail_price || 0) * multiplier;
        const listPrice = Math.max(creditBasePrice, cashBasePrice);

        const isCredit = payload.paymentMethod === 'credit';
        // When cash: grant cash discount equal to difference between list/credit price and cash price
        const cashDiscountPerUnit = isCredit ? 0 : Math.max(0, roundMoney(listPrice - cashBasePrice, moneyDigits));

        let unitPrice = isCredit ? listPrice : (item.unitPrice ? Number(item.unitPrice) : cashBasePrice);
        let pricingTierType: 'cash' | 'credit' | 'offer' = isCredit ? 'credit' : 'cash';
        let unitOfferSavings = 0;

        // Check applicable offers
        const activeOffers = offersByProduct.get(pid) || [];
        const getMinQty = (o: any) => o.offer_type === 'bogo' ? (Number(o.bogo_buy_qty || 1) + Number(o.bogo_get_qty || 1)) : Math.max(1, Number(o.min_qty || 1));
        const matchingOffer = activeOffers
          .filter((off) => totalBaseQty >= getMinQty(off))
          .sort((a, b) => getMinQty(b) - getMinQty(a))[0];

        if (matchingOffer && !item.unitPrice) {
          const offerVal = Number(matchingOffer.value || 0);
          if (matchingOffer.offer_type === 'percent' && offerVal > 0) {
            unitPrice = Math.max(0, roundMoney(unitPrice * (1 - offerVal / 100), moneyDigits));
            pricingTierType = 'offer';
            unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
          } else if (matchingOffer.offer_type === 'fixed' && offerVal > 0) {
            unitPrice = Math.max(0, roundMoney(unitPrice - (offerVal * multiplier), moneyDigits));
            pricingTierType = 'offer';
            unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
          } else if (matchingOffer.offer_type === 'price' && offerVal > 0) {
            unitPrice = roundMoney(offerVal * multiplier, moneyDigits);
            pricingTierType = 'offer';
            unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
          } else if (matchingOffer.offer_type === 'bundle' && offerVal > 0) {
            const minQ = Math.max(1, Number(matchingOffer.min_qty || 1));
            const bundles = Math.floor(qty / minQ);
            const rem = qty % minQ;
            const bundleTotal = (bundles * offerVal) + (rem * listPrice);
            unitPrice = roundMoney(bundleTotal / qty, moneyDigits);
            pricingTierType = 'offer';
            unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
          } else if (matchingOffer.offer_type === 'bogo') {
            const buyQ = Math.max(1, Number(matchingOffer.bogo_buy_qty || 1));
            const getQ = Math.max(1, Number(matchingOffer.bogo_get_qty || 1));
            const discPct = Math.min(100, Math.max(0, Number(matchingOffer.bogo_discount_percent ?? (offerVal || 100))));
            const cycle = buyQ + getQ;
            if (qty >= cycle) {
              const fullCycles = Math.floor(qty / cycle);
              const rem = qty % cycle;
              const freeUnits = (fullCycles * getQ) + Math.max(0, rem - buyQ);
              const discAmt = freeUnits * listPrice * (discPct / 100);
              const netTot = Math.max(0, (qty * listPrice) - discAmt);
              unitPrice = roundMoney(netTot / qty, moneyDigits);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, roundMoney(listPrice - unitPrice, moneyDigits));
            }
          }
        }

        const lineGrossTotal = roundMoney(listPrice * qty, moneyDigits);
        const lineNetTotal = roundMoney(unitPrice * qty, moneyDigits);
        const lineDiscount = Math.max(0, roundMoney(lineGrossTotal - lineNetTotal, moneyDigits));

        grossSubtotalAmount += lineGrossTotal;
        totalDiscountAmount += lineDiscount;
        totalAmount += lineNetTotal;

        const consumerPrice = prod.consumer_price != null && Number(prod.consumer_price) > 0
          ? roundMoney(Number(prod.consumer_price) * multiplier, moneyDigits)
          : null;

        preparedOrderItems.push({
          productId: pid,
          productName: prod.name,
          unitName: item.unitName || 'قطعة',
          quantity: qty,
          unitMultiplier: multiplier,
          totalBaseQty,
          listPrice,
          unitPrice,
          consumerPrice,
          pricingTierType,
          unitOfferSavings,
          cashDiscountPerUnit,
          lineDiscount,
          lineTotal: lineNetTotal,
        });
      }

      // Atomically reserve inventory at location and product level
      await reserveLocationStock(trx as any, {
        tenantId,
        accountId,
        locationId: warehouseLocId > 0 ? warehouseLocId : null,
        items: preparedOrderItems.map((item) => ({
          productId: item.productId,
          qty: item.totalBaseQty,
        })),
      });

      // Generate order number SO-YYMMDD-XXXX
      const tempOrderNo = `TMP-SO-${Date.now()}`;
      const [insertedOrder] = await trxAny
        .insertInto('sales_orders')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          order_number: tempOrderNo,
          customer_id: customerId,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_address: customerAddress,
          branch_id: null,
          warehouse_location_id: warehouseLocId > 0 ? warehouseLocId : null,
          rep_id: repId,
          order_source: 'pre_sales_rep',
          payment_terms: payload.paymentMethod,
          subtotal: roundMoney(grossSubtotalAmount, moneyDigits),
          discount_amount: roundMoney(totalDiscountAmount, moneyDigits),
          tax_amount: 0,
          total_amount: roundMoney(totalAmount, moneyDigits),
          status: 'pending_approval',
          notes: payload.notes || null,
          delivery_date: payload.deliveryDate ? new Date(payload.deliveryDate) : null,
          created_by: null,
          created_at: sql`NOW()`,
          updated_at: sql`NOW()`,
        })
        .returning(['id'])
        .execute();

      orderId = Number(insertedOrder.id);
      finalOrderNumber = formatDailyDocumentNumber('SO', orderId);

      await trxAny
        .updateTable('sales_orders')
        .set({ order_number: finalOrderNumber })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();

      for (const poi of preparedOrderItems) {
        await trxAny
          .insertInto('sales_order_items')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            sales_order_id: orderId,
            product_id: poi.productId,
            product_name: poi.productName,
            unit_name: poi.unitName,
            unit_multiplier: poi.unitMultiplier,
            quantity: poi.quantity,
            reserved_quantity: poi.totalBaseQty,
            delivered_quantity: 0,
            unit_price: poi.unitPrice,
            consumer_price: poi.consumerPrice,
            pricing_tier_type: poi.pricingTierType,
            unit_offer_savings: poi.unitOfferSavings,
            discount: poi.lineDiscount,
            total: poi.lineTotal,
            created_at: sql`NOW()`,
          })
          .execute();
      }
    });

    return {
      ok: true,
      orderId,
      orderNumber: finalOrderNumber,
      totalAmount,
      itemsCount: payload.items.length,
    };
  }

  /**
   * Lists Pre-Sales orders booked by reps with comprehensive filters.
   */
  async listPreSalesOrders(
    tenantId: string,
    filters?: {
      repId?: number;
      customerId?: number;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    let qb = this.anyDb
      .selectFrom('sales_orders as so')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'so.rep_id')
      .leftJoin('customers as c', 'c.id', 'so.customer_id')
      .select([
        'so.id',
        'so.order_number as orderNumber',
        'so.customer_id as customerId',
        'so.customer_name as customerName',
        'so.customer_phone as customerPhone',
        'so.customer_address as customerAddress',
        'so.rep_id as repId',
        'dr.full_name as repName',
        'so.warehouse_location_id as warehouseLocationId',
        'so.order_source as orderSource',
        'so.payment_terms as paymentTerms',
        'so.subtotal as subtotalAmount',
        'so.discount_amount as discountAmount',
        'so.total_amount as totalAmount',
        'so.status',
        'so.supervisor_approved_at as supervisorApprovedAt',
        'so.supervisor_approved_by as supervisorApprovedBy',
        'so.supervisor_rejection_reason as supervisorRejectionReason',
        'so.notes',
        'so.created_at as createdAt',
      ])
      .where('so.tenant_id', '=', tenantId)
      .where('so.order_source', '=', 'pre_sales_rep');

    if (filters?.repId) {
      qb = qb.where('so.rep_id', '=', Number(filters.repId));
    }

    if (filters?.customerId) {
      qb = qb.where('so.customer_id', '=', Number(filters.customerId));
    }

    if (filters?.status && filters.status !== 'all') {
      if (filters.status === 'pending_approval' || filters.status === 'pending_supervisor') {
        qb = qb.where('so.status', 'in', ['pending_approval', 'pending_supervisor']);
      } else {
        qb = qb.where('so.status', '=', filters.status);
      }
    }

    if (filters?.dateFrom) {
      qb = qb.where('so.created_at', '>=', new Date(filters.dateFrom));
    }

    if (filters?.dateTo) {
      const endOfDay = new Date(filters.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      qb = qb.where('so.created_at', '<=', endOfDay);
    }

    if (filters?.search?.trim()) {
      const search = `%${filters.search.trim().toLowerCase()}%`;
      qb = qb.where((eb: any) =>
        eb.or([
          eb('so.order_number', 'ilike', search),
          eb('so.customer_name', 'ilike', search),
          eb('dr.full_name', 'ilike', search),
        ]),
      );
    }

    const limit = filters?.limit ? Math.min(Number(filters.limit), 100) : 50;
    const offset = filters?.offset ? Number(filters.offset) : 0;

    const orders = await qb.orderBy('so.id', 'desc').limit(limit).offset(offset).execute();

    return {
      orders: orders.map((o: any) => ({
        ...o,
        id: Number(o.id),
        subtotalAmount: Number(o.subtotalAmount || 0),
        discountAmount: Number(o.discountAmount || 0),
        totalAmount: Number(o.totalAmount || 0),
      })),
      total: orders.length,
    };
  }

  /**
   * Retrieves full details of a single Pre-Sales order including items and consumer pricing.
   */
  async getPreSalesOrderDetails(orderId: number, tenantId: string, repId?: number) {
    const order = await this.anyDb
      .selectFrom('sales_orders as so')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'so.rep_id')
      .leftJoin('stock_locations as sl', 'sl.id', 'so.warehouse_location_id')
      .select([
        'so.id',
        'so.order_number as orderNumber',
        'so.customer_id as customerId',
        'so.customer_name as customerName',
        'so.customer_phone as customerPhone',
        'so.customer_address as customerAddress',
        'so.rep_id as repId',
        'dr.full_name as repName',
        'dr.phone as repPhone',
        'so.warehouse_location_id as warehouseLocationId',
        'sl.name as warehouseName',
        'so.order_source as orderSource',
        'so.payment_terms as paymentTerms',
        'so.subtotal as subtotalAmount',
        'so.discount_amount as discountAmount',
        'so.total_amount as totalAmount',
        'so.status',
        'so.supervisor_approved_at as supervisorApprovedAt',
        'so.supervisor_approved_by as supervisorApprovedBy',
        'so.supervisor_rejection_reason as supervisorRejectionReason',
        'so.notes',
        'so.delivery_date as deliveryDate',
        'so.created_at as createdAt',
      ])
      .where('so.id', '=', orderId)
      .where('so.tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!order) {
      throw new AppError('أمر الحجز الميداني غير موجود', 'PRESALE_ORDER_NOT_FOUND', 404);
    }

    // INV-DRIVER-PORTAL-REP-SCOPED-READS: a driver-portal read supplies the
    // calling repId and may only see orders assigned to that rep. An order
    // with no rep (or another rep) is not the caller's. Staff callers pass
    // no repId and keep the unscoped supervisor view.
    if (repId != null && Number((order as any).repId) !== Number(repId)) {
      throw new AppError('غير مصرح لك بالاطلاع على أمر حجز ميداني لمندوب آخر', 'FORBIDDEN', 403);
    }

    const items = await this.anyDb
      .selectFrom('sales_order_items as soi')
      .select([
        'soi.id',
        'soi.product_id as productId',
        'soi.product_name as productName',
        'soi.unit_name as unitName',
        'soi.unit_multiplier as unitMultiplier',
        'soi.quantity',
        'soi.reserved_quantity as reservedQuantity',
        'soi.unit_price as unitPrice',
        'soi.consumer_price as consumerPrice',
        'soi.pricing_tier_type as pricingTierType',
        'soi.unit_offer_savings as unitOfferSavings',
        'soi.discount',
        'soi.total',
      ])
      .where('soi.sales_order_id', '=', orderId)
      .where('soi.tenant_id', '=', tenantId)
      .orderBy('soi.id', 'asc')
      .execute();

    return {
      ...order,
      id: Number(order.id),
      subtotalAmount: Number(order.subtotalAmount || 0),
      discountAmount: Number(order.discountAmount || 0),
      totalAmount: Number(order.totalAmount || 0),
      items: items.map((it: any) => ({
        ...it,
        id: Number(it.id),
        productId: Number(it.productId),
        quantity: Number(it.quantity || 0),
        unitMultiplier: Number(it.unitMultiplier || 1),
        unitPrice: Number(it.unitPrice || 0),
        consumerPrice: it.consumerPrice != null ? Number(it.consumerPrice) : null,
        unitOfferSavings: it.unitOfferSavings != null ? Number(it.unitOfferSavings) : 0,
        discount: Number(it.discount || 0),
        total: Number(it.total || 0),
      })),
    };
  }

  /**
   * Supervisor reviews and approves the pre-sales order for warehouse preparation.
   */
  async approvePreSalesOrder(
    orderId: number,
    supervisorUserId: number,
    tenantId: string,
    accountId: string,
  ): Promise<{ ok: boolean; status: string }> {
    const order = await this.anyDb
      .selectFrom('sales_orders')
      .select(['id', 'status', 'customer_id', 'payment_terms', 'total_amount'])
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!order) {
      throw new AppError('طلب الحجز غير موجود', 'ORDER_NOT_FOUND', 404);
    }

    if (order.status !== 'pending_approval' && order.status !== 'pending_supervisor') {
      throw new AppError(`لا يمكن اعتماد طلب بحالة "${order.status}"`, 'INVALID_ORDER_STATUS', 400);
    }

    // If payment is credit, check customer credit limit
    if (order.payment_terms === 'credit' && order.customer_id) {
      const cust = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'credit_limit', 'balance', 'is_credit_blocked'])
        .where('id', '=', order.customer_id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (cust?.is_credit_blocked) {
        throw new AppError(`العميل "${cust.name}" محظور من التعاملات الآجلة`, 'CUSTOMER_BLOCKED', 400);
      }

      if (cust?.credit_limit && Number(cust.credit_limit) > 0) {
        const currentBalance = Number(cust.balance || 0);
        const orderTotal = Number(order.total_amount || 0);
        if (currentBalance + orderTotal > Number(cust.credit_limit)) {
          throw new AppError(
            `قيمة الطلب تتجاوز سقف الائتمان المسموح للعميل. الرصيد الحالي: ${currentBalance}، الحد الأقصى: ${cust.credit_limit}`,
            'CREDIT_LIMIT_EXCEEDED',
            400,
          );
        }
      }
    }

    await this.anyDb
      .updateTable('sales_orders')
      .set({
        status: 'approved',
        supervisor_approved_at: sql`NOW()`,
        supervisor_approved_by: supervisorUserId,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, status: 'approved' };
  }

  /**
   * Supervisor rejects the pre-sales order and releases all reserved stock atomically.
   */
  async rejectPreSalesOrder(
    orderId: number,
    supervisorUserId: number,
    tenantId: string,
    accountId: string,
    reason?: string,
  ): Promise<{ ok: boolean; status: string }> {
    const order = await this.anyDb
      .selectFrom('sales_orders')
      .select(['id', 'status', 'warehouse_location_id'])
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!order) {
      throw new AppError('طلب الحجز غير موجود', 'ORDER_NOT_FOUND', 404);
    }

    if (order.status !== 'pending_approval' && order.status !== 'pending_supervisor' && order.status !== 'approved') {
      throw new AppError(`لا يمكن رفض طلب بحالة "${order.status}"`, 'INVALID_ORDER_STATUS', 400);
    }

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      const items = await trxAny
        .selectFrom('sales_order_items')
        .select(['product_id', 'reserved_quantity'])
        .where('sales_order_id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const whLocId = order.warehouse_location_id ? Number(order.warehouse_location_id) : 0;

      const itemsToRelease = items
        .filter((item: any) => Number(item.reserved_quantity || 0) > 0)
        .map((item: any) => ({
          productId: Number(item.product_id),
          qty: Number(item.reserved_quantity),
        }));

      if (itemsToRelease.length > 0) {
        await releaseLocationStock(trx as any, {
          tenantId,
          accountId,
          locationId: whLocId > 0 ? whLocId : null,
          items: itemsToRelease,
        });
      }

      await trxAny
        .updateTable('sales_orders')
        .set({
          status: 'rejected',
          supervisor_rejection_reason: reason || 'تم الرفض بواسطة المشرف',
          updated_at: sql`NOW()`,
        })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();
    });

    return { ok: true, status: 'rejected' };
  }

  /**
   * Consolidates multiple approved Pre-Sales orders into a single Morning Van Load Requisition (VL-YYMMDD-XXXX)
   * for a target delivery representative. Atomically releases the order-level warehouse reservation
   * so that approving/dispatching the load requisition can cleanly move physical stock into the van,
   * and marks the source Pre-Sales orders as 'converted'.
   */
  async consolidatePreSalesOrdersToRequisition(
    tenantId: string,
    accountId: string,
    supervisorUserId: number,
    payload: {
      orderIds: number[];
      targetRepId: number;
      sourceWarehouseId?: number;
      notes?: string;
    },
  ): Promise<{
    ok: boolean;
    requisitionId: number;
    docNo: string;
    consolidatedOrdersCount: number;
    itemsCount: number;
    targetRepId: number;
    targetRepName: string;
  }> {
    const rawOrderIds = Array.isArray(payload?.orderIds) ? payload.orderIds : [];
    const uniqueOrderIds = Array.from(
      new Set(rawOrderIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    );

    if (uniqueOrderIds.length === 0) {
      throw new AppError('يرجى تحديد طلب حجز واحد على الأقل للتجميع في إذن التحميل', 'NO_ORDERS_SELECTED', 400);
    }

    const targetRepId = Number(payload?.targetRepId || 0);
    if (!targetRepId || targetRepId <= 0) {
      throw new AppError('يرجى تحديد المندوب / السيارة المستهدفة لتحميل البضاعة', 'TARGET_REP_REQUIRED', 400);
    }

    return await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      const rep = await trxAny
        .selectFrom('delivery_representatives')
        .select(['id', 'name', 'is_active'])
        .where('id', '=', targetRepId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!rep) {
        throw new AppError('مندوب التوزيع المحدد غير موجود', 'REP_NOT_FOUND', 404);
      }

      const orders = await trxAny
        .selectFrom('sales_orders')
        .select([
          'id',
          'order_number',
          'status',
          'warehouse_location_id',
          'customer_name',
          'notes',
        ])
        .where('id', 'in', uniqueOrderIds)
        .where('tenant_id', '=', tenantId)
        .where('order_source', '=', 'van_presales')
        .forUpdate()
        .execute();

      if (orders.length !== uniqueOrderIds.length) {
        throw new AppError('بعض طلبات الحجز المحددة غير موجودة أو لا تنتمي لهذه المنشأة', 'ORDERS_NOT_FOUND', 404);
      }

      const nonApproved = orders.filter((o: any) => o.status !== 'approved');
      if (nonApproved.length > 0) {
        const nums = nonApproved.map((o: any) => o.order_number).join('، ');
        throw new AppError(
          `يجب أن تكون كافة الطلبات المحددة في حالة (معتمد) قبل التجميع. الطلبات غير المعتمدة: ${nums}`,
          'ORDERS_NOT_APPROVED',
          400,
        );
      }

      const orderItems = await trxAny
        .selectFrom('sales_order_items')
        .select([
          'id',
          'sales_order_id',
          'product_id',
          'product_name',
          'unit_name',
          'quantity',
          'reserved_quantity',
          'unit_multiplier',
        ])
        .where('sales_order_id', 'in', uniqueOrderIds)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (!orderItems || orderItems.length === 0) {
        throw new AppError('طلبات الحجز المحددة لا تحتوي على أصناف لتحميلها', 'EMPTY_ORDER_ITEMS', 400);
      }

      const orderById = new Map<number, any>();
      for (const ord of orders) {
        orderById.set(Number(ord.id), ord);
      }

      // 1. Group reserved stock releases by warehouse_location_id and release in canonical lock order
      const releasesByLocation = new Map<number, Map<number, number>>();
      const consolidatedMap = new Map<
        number,
        {
          productId: number;
          productName: string;
          requestedQty: number;
          approvedQty: number;
          sourceOrders: Set<string>;
        }
      >();

      for (const item of orderItems) {
        const pid = Number(item.product_id);
        const ord = orderById.get(Number(item.sales_order_id));
        const whLocId = Number(ord?.warehouse_location_id || 0);
        const reservedQty = Number(item.reserved_quantity || 0);

        if (reservedQty > 0) {
          if (!releasesByLocation.has(whLocId)) {
            releasesByLocation.set(whLocId, new Map<number, number>());
          }
          const locMap = releasesByLocation.get(whLocId)!;
          locMap.set(pid, Number(((locMap.get(pid) || 0) + reservedQty).toFixed(4)));
        }

        const multiplier = Math.max(0.0001, Number(item.unit_multiplier || 1));
        const baseQty =
          reservedQty > 0
            ? reservedQty
            : Number((Number(item.quantity || 0) * multiplier).toFixed(4));

        if (baseQty > 0) {
          const existing = consolidatedMap.get(pid);
          if (existing) {
            existing.requestedQty = Number((existing.requestedQty + baseQty).toFixed(4));
            existing.approvedQty = existing.requestedQty;
            if (ord?.order_number) existing.sourceOrders.add(String(ord.order_number));
          } else {
            const sourceSet = new Set<string>();
            if (ord?.order_number) sourceSet.add(String(ord.order_number));
            consolidatedMap.set(pid, {
              productId: pid,
              productName: String(item.product_name || `صنف #${pid}`),
              requestedQty: baseQty,
              approvedQty: baseQty,
              sourceOrders: sourceSet,
            });
          }
        }
      }

      for (const [locId, prodMap] of releasesByLocation.entries()) {
        const itemsToRelease = sortItemsByProductId(
          Array.from(prodMap.entries()).map(([productId, qty]) => ({ productId, qty })),
        );
        if (itemsToRelease.length > 0) {
          await releaseLocationStock(trx as any, {
            tenantId,
            accountId,
            locationId: locId > 0 ? locId : null,
            items: itemsToRelease,
          });
        }
      }

      // 2. Resolve source warehouse for the consolidated Van Load Requisition
      const firstOrderWarehouseId = Number(
        orders.find((o: any) => Number(o.warehouse_location_id || 0) > 0)?.warehouse_location_id || 0,
      );
      const resolvedWarehouseId =
        Number(payload.sourceWarehouseId || 0) ||
        firstOrderWarehouseId ||
        (await this.resolveDefaultWarehouseLocationId(
          tenantId,
          undefined,
          Array.from(consolidatedMap.keys()),
        )) ||
        1;

      const consolidatedItems = sortItemsByProductId(
        Array.from(consolidatedMap.values()).map((entry) => ({
          productId: entry.productId,
          productName: entry.productName,
          requestedQty: entry.requestedQty,
          approvedQty: entry.approvedQty,
          sourceOrders: Array.from(entry.sourceOrders),
        })),
      );

      const docNo = await generateDailySequenceNumber(
        trxAny,
        this.db,
        'van_load_requisitions',
        'doc_no',
        'VL',
        tenantId,
      );

      const orderNumbersList = orders.map((o: any) => o.order_number).join('، ');
      const autoNotes = [
        `تجميع آلي لطلبات الحجز المسبق (${orders.length}): ${orderNumbersList}`,
        payload.notes ? String(payload.notes).trim() : '',
      ]
        .filter(Boolean)
        .join(' — ');

      const insertedReq = await trxAny
        .insertInto('van_load_requisitions')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          doc_no: docNo,
          rep_id: targetRepId,
          source_warehouse_id: resolvedWarehouseId,
          status: 'pending',
          requested_items: JSON.stringify(consolidatedItems),
          notes: autoNotes,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      // 3. Mark source Pre-Sales orders as converted and clear reserved_quantity
      await trxAny
        .updateTable('sales_order_items')
        .set((eb: any) => ({
          reserved_quantity: 0,
          delivered_quantity: eb.ref('quantity'),
        }))
        .where('sales_order_id', 'in', uniqueOrderIds)
        .where('tenant_id', '=', tenantId)
        .execute();

      for (const ord of orders) {
        const updatedNote = [
          ord.notes ? String(ord.notes).trim() : '',
          `[تم التجميع في إذن تحميل رقم ${docNo} للمندوب ${rep.name}]`,
        ]
          .filter(Boolean)
          .join(' | ');

        await trxAny
          .updateTable('sales_orders')
          .set({
            status: 'converted',
            notes: updatedNote,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', Number(ord.id))
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      return {
        ok: true,
        requisitionId: Number(insertedReq.id),
        docNo,
        consolidatedOrdersCount: orders.length,
        itemsCount: consolidatedItems.length,
        targetRepId,
        targetRepName: String(rep.name || ''),
      };
    });
  }

  /**
   * Directly converts an approved Pre-Sales order into an official Wholesale Sale Invoice,
   * releasing the Pre-Sales stock reservation and posting the sale from the order's warehouse.
   */
  async convertPreSalesOrderToInvoice(
    orderId: number,
    auth: AuthContext,
    payload?: {
      paymentType?: 'cash' | 'credit';
      paidAmount?: number;
      notes?: string;
    },
  ): Promise<{
    ok: boolean;
    orderId: number;
    saleId: number;
    docNo: string | null;
  }> {
    const tenantId = auth.tenantId || 'default';
    const accountId = auth.accountId || 'default';

    if (!this.salesService) {
      throw new AppError('خدمة الفواتير غير متاحة حالياً', 'SALES_SERVICE_UNAVAILABLE', 500);
    }

    const order = await this.anyDb
      .selectFrom('sales_orders')
      .selectAll()
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .where('order_source', '=', 'van_presales')
      .executeTakeFirst();

    if (!order) {
      throw new AppError('طلب الحجز غير موجود', 'ORDER_NOT_FOUND', 404);
    }

    if (order.status === 'converted' && order.sale_id) {
      throw new AppError('تم تحويل طلب الحجز إلى فاتورة مبيعات مسبقاً', 'ORDER_ALREADY_CONVERTED', 400);
    }

    // 'converting' is let through to the claim below on purpose — the
    // claim fails, and the re-read there decides whether the
    // conversion is in flight (ORDER_CONVERSION_IN_PROGRESS) or
    // already done. Rejecting it here would make that decision
    // unreachable (the same reason sales-orders convertToSale lets
    // 'converting' through).
    if (order.status !== 'approved' && order.status !== 'converting') {
      throw new AppError('يجب اعتماد طلب الحجز أولاً قبل تحويله إلى فاتورة مبيعات', 'ORDER_NOT_APPROVED', 400);
    }

    const items = await this.anyDb
      .selectFrom('sales_order_items')
      .selectAll()
      .where('sales_order_id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .execute();

    if (!items || items.length === 0) {
      throw new AppError('لا يمكن تحويل طلب حجز فارغ إلى فاتورة', 'EMPTY_ORDER_ITEMS', 400);
    }

    const whLocId = order.warehouse_location_id ? Number(order.warehouse_location_id) : null;
    let branchId = order.branch_id ? Number(order.branch_id) : null;

    if (!branchId && whLocId) {
      const locRow = await this.anyDb
        .selectFrom('stock_locations')
        .select(['branch_id'])
        .where('id', '=', whLocId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (locRow?.branch_id) branchId = Number(locRow.branch_id);
    }

    if (!branchId) {
      const primaryBranch = await this.anyDb
        .selectFrom('branches')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      branchId = primaryBranch ? Number(primaryBranch.id) : 1;
    }

    const releaseItems = sortItemsByProductId<{ productId: number; qty: number }>(
      items
        .filter((item: any) => Number(item.reserved_quantity || 0) > 0)
        .map((item: any) => ({
          productId: Number(item.product_id),
          qty: Number(item.reserved_quantity),
        })),
    );

    // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the old shape ran three
    // separate transactions — release the reservation, create the sale,
    // then flip the order — with only snapshot status checks between
    // them. Two concurrent converts both released the same reservation
    // (double-freeing stock), both created a sale, and both flipped
    // the order. The new shape follows the canonical sales-order
    // conversion (INV-SALES-ORDER-CONVERSION-STOCK-LEGS /
    // INV-CONVERSION-LIFECYCLE-RACES, sales-orders.service
    // convertToSale): claim the order approved -> 'converting' with a
    // conditional update (the atomic guard — the loser affects zero
    // rows), hand the reservation to createSale as a
    // SalesOrderConversionRelease so it is released INSIDE the sale
    // transaction under the product locks (createSale verifies the
    // 'converting' state first), and flip 'converting' -> 'converted'
    // with a status predicate. A failed sale reverts the claim to
    // 'approved'; no re-reserve is ever needed, because the
    // reservation was only ever released inside the sale transaction
    // and a failed sale rolls it back with itself. createSale owns
    // its own transaction, so the claim + in-sale release +
    // conditional flip is the atomic unit — the same unit the
    // canonical conversion uses.
    const claimed = await this.anyDb
      .updateTable('sales_orders')
      .set({ status: 'converting', updated_at: sql`NOW()` })
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'approved')
      .returning('id')
      .executeTakeFirst();
    if (!claimed) {
      const current = await this.anyDb
        .selectFrom('sales_orders')
        .select(['status', 'sale_id'])
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (current?.status === 'converted' && current.sale_id) {
        throw new AppError('تم تحويل طلب الحجز إلى فاتورة مبيعات مسبقاً', 'ORDER_ALREADY_CONVERTED', 400);
      }
      if (current?.status === 'converting') {
        throw new AppError('طلب الحجز قيد التحويل حالياً', 'ORDER_CONVERSION_IN_PROGRESS', 409);
      }
      throw new AppError('يجب اعتماد طلب الحجز أولاً قبل تحويله إلى فاتورة مبيعات', 'ORDER_NOT_APPROVED', 400);
    }
    const conversionRelease = releaseItems.length > 0
      ? { salesOrderId: orderId, branchId, locationId: whLocId, items: releaseItems }
      : undefined;

    const paymentType: 'cash' | 'credit' =
      payload?.paymentType || (order.payment_terms === 'credit' ? 'credit' : 'cash');
    const totalAmount = Number(order.total_amount || 0);
    const paidAmount =
      payload?.paidAmount !== undefined && payload?.paidAmount !== null
        ? Math.max(0, Number(payload.paidAmount))
        : paymentType === 'cash'
          ? totalAmount
          : 0;

    const approvedUnitPrices: Record<number, number> = {};
    const saleItems = items.map((item: any) => {
      const pid = Number(item.product_id);
      const unitPrice = Number(item.unit_price || 0);
      approvedUnitPrices[pid] = unitPrice;
      return {
        productId: pid,
        qty: Number(item.quantity),
        unitPrice,
        price: unitPrice,
        discount: Number(item.discount || 0),
        unitName: item.unit_name || undefined,
        priceType: 'wholesale' as const,
      };
    });

    const salePayload: any = {
      branchId,
      locationId: whLocId || undefined,
      customerId: order.customer_id ? Number(order.customer_id) : undefined,
      customerName: order.customer_name || undefined,
      customerPhone: order.customer_phone || undefined,
      deliveryRepId: order.rep_id ? Number(order.rep_id) : undefined,
      note: [
        `فاتورة جملة محولة من طلب حجز مسبق #${order.order_number}`,
        order.notes ? String(order.notes).trim() : '',
        payload?.notes ? String(payload.notes).trim() : '',
      ]
        .filter(Boolean)
        .join(' — '),
      items: saleItems,
      discount: Number(order.discount_amount || 0),
      paymentType,
      paymentChannel: paymentType === 'credit' && paidAmount <= 0 ? 'credit' : 'cash',
      paidAmount,
      source: 'dashboard',
      payments:
        paidAmount > 0
          ? [
              {
                paymentChannel: 'cash',
                amount: paidAmount,
              },
            ]
          : [],
    };

    let saleResult: any;
    try {
      saleResult = await this.salesService.createSale(salePayload, auth, {
        approvedDiscount: Number(order.discount_amount || 0),
        approvedUnitPrices,
      }, conversionRelease);
    } catch (err) {
      // Revert the 'converting' claim to 'approved'. No re-reserve:
      // the reservation was only ever released inside the sale
      // transaction, so a failed sale rolled it back with the sale.
      await this.anyDb
        .updateTable('sales_orders')
        .set({ status: 'approved', updated_at: sql`NOW()` })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'converting')
        .execute();
      throw err;
    }

    const saleId = Number(saleResult?.sale?.id || saleResult?.id || 0);
    const docNo = String(saleResult?.sale?.docNo || saleResult?.sale?.doc_no || saleResult?.docNo || '') || null;

    // Conditional flip: only the converter that still holds the
    // 'converting' claim may mark the order converted. Zero affected
    // rows means the claim moved under us — fail closed loudly (the
    // sale already committed, so this needs manual reconciliation,
    // never a silent second flip).
    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      const updated = await trxAny
        .updateTable('sales_orders')
        .set({
          status: 'converted',
          sale_id: saleId > 0 ? saleId : null,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'converting')
        .returning('id')
        .execute();
      if (updated.length !== 1) {
        throw new AppError('تعذر تأكيد تحويل طلب الحجز بعد إنشاء الفاتورة؛ يلزم تدخل يدوي', 'ORDER_CONVERSION_MARK_FAILED', 500);
      }

      await trxAny
        .updateTable('sales_order_items')
        .set((eb: any) => ({
          reserved_quantity: 0,
          delivered_quantity: eb.ref('quantity'),
        }))
        .where('sales_order_id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();
    });

    return {
      ok: true,
      orderId,
      saleId,
      docNo,
    };
  }
}

