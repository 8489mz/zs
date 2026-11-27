import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { getTenantTimezone, normalizePgDateOnly, todayTenantDate } from '../../../../common/utils/tenant-timezone.util';
import { listRepUsableWarehouseScope, assertWarehouseInRepScope } from '../van-common.util';
import type { ListWarehouseCatalogQuery, ListWarehouseCatalogResult, PreSalesCatalogItem } from './van-pre-sales-types';

export class WarehouseCatalogSlice {
  constructor(private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db;
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
    query?: ListWarehouseCatalogQuery,
    repId?: number,
  ): Promise<ListWarehouseCatalogResult> {
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
        ...(repId != null ? [] : ['p.cost_price', 'p.wholesale_price', 'p.credit_price', 'p.consumer_price']),
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
      qb = qb.where((eb: any) => eb.or([eb('p.name', 'ilike', search), eb('p.barcode', 'ilike', search)]));
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

    // Fetch active offers — the offer day is the TENANT day (P7,
    // single-server-clock rule), never the host-local day.
    const nowIso = todayTenantDate(await getTenantTimezone(this.anyDb, tenantId));
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
      const start = normalizePgDateOnly(off.start_date);
      const end = normalizePgDateOnly(off.end_date);
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

      const productUnits = (
        unitsByProduct.get(pid) || [{ id: 0, name: 'قطعة', multiplier: 1, isBaseUnit: true, isSaleUnitDefault: true }]
      ).map((u) => ({
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
}
