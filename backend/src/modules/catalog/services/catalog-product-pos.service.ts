import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { InventoryScopeService } from '../../inventory/services/inventory-scope.service';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { buildPosCatalogVersion } from '../engines/pos-catalog-version.engine';
import { normalizePgDateOnly } from '../../../common/utils/tenant-timezone.util';
import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { availableAcrossLocations, posSellsFromAllOperationalLocations } from '../../../common/engines/branch-sellable-locations.engine';
import { findPosProductsByBarcodeWithDb } from './pos-barcode-lookup.helper';
import { ProductRow, ProductWriteExecutor, ProductOfferColumnCapabilities, ProductOfferReadRow, ProductUnitReadRow, PosProductLookupRow } from './catalog-product-types';

/**
 * CatalogProductPosService — slice P4 of the catalog-product split.
 * Pure move of 12 methods from CatalogProductService (POS catalog: version,
 * product lookup/search, units, offers, BOM combos, row mapping, scoped stock).
 * No behavior change: the bodies are byte-identical except the 4 delegate-called
 * methods (getPosCatalogVersion, listPosProducts, mapOffersByProduct,
 * resolveScopedStockByProduct) which are public here — the facade, a different
 * class, cannot call a private slice method (tsc TS2341) — while the other 8
 * stay private (called only from inside this slice, so the facade keeps no
 * delegate for them). The facade keeps thin delegates with the same
 * names/signatures for exactly the 4 externally-called methods.
 * Bound deps (HR kernel / earlier-slice pattern, passed bound from the facade
 * ctor so the moved bodies stay byte-identical): db + inventoryScope (ctor
 * deps), bookDigits (P1) + getProductOfferColumnCapabilities (P2), and the
 * kernel helpers productIdAny + normalizeUnitName + getListProductStock +
 * tenantId + tenantPredicate. The 7 leading // comment lines above
 * getPosCatalogVersion (PERF-9 + trigger + counts + freshness) travel with
 * that method. Clock pins travel with their methods, assertion text unchanged:
 * normalizePgDateOnly x2 in mapOffersByProduct (clock-b5 section F pin — offer
 * start/end bounds are pg-aware, never through the UTC slice) + toISOString x2
 * in getPosCatalogVersion (lastUpdatedAt; new Date(0) fallback). The types
 * ProductRow / ProductOfferReadRow / ProductUnitReadRow / PosProductLookupRow /
 * ProductOfferColumnCapabilities / ProductWriteExecutor come from
 * ./catalog-product-types, the module P1 creates at the first merge.
 * Driving specs (merge-owned RED): listPosProducts (4 specs) + fetchPosBomCombos
 * + resolveScopedStockByProduct (PERF-2 calls it directly on the facade instance
 * — the merge repoints it to construct this slice directly, storefront PERF-4
 * precedent; productIdAny stays in the kernel, no repoint).
 */

export interface CatalogProductPosDeps {
  db: Kysely<Database>;
  inventoryScope: InventoryScopeService;
  // Bound deps (HR kernel / earlier-slice pattern): methods that stay in the
  // facade (kernel helpers, P1 bookDigits, P2 capabilities), passed bound so
  // the moved bodies stay byte-identical. Return types are the exact inferred
  // types of the source methods (sql<boolean>`...` is RawBuilder<boolean>;
  // getListProductStock returns Number(...) so number; tsc-probed at generation).
  bookDigits: (executor: ProductWriteExecutor, actor: AuthContext) => Promise<MoneyDigits>;
  getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;
  productIdAny: (column: string, ids: number[]) => RawBuilder<boolean>;
  normalizeUnitName: (name: unknown) => string;
  getListProductStock: (product: Pick<ProductRow, 'id' | 'stock_qty'>, scopedLocationId: number | null, scopedStockByProduct: Map<string, number>) => number;
  tenantId: (actor: AuthContext) => string;
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
}

@Injectable()
export class CatalogProductPosService {
  private readonly db: Kysely<Database>;
  private readonly inventoryScope: InventoryScopeService;
  private readonly bookDigits: (executor: ProductWriteExecutor, actor: AuthContext) => Promise<MoneyDigits>;
  private readonly getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;
  private readonly productIdAny: (column: string, ids: number[]) => RawBuilder<boolean>;
  private readonly normalizeUnitName: (name: unknown) => string;
  private readonly getListProductStock: (product: Pick<ProductRow, 'id' | 'stock_qty'>, scopedLocationId: number | null, scopedStockByProduct: Map<string, number>) => number;
  private readonly tenantId: (actor: AuthContext) => string;
  private readonly tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;

  constructor(deps: CatalogProductPosDeps) {
    this.db = deps.db;
    this.inventoryScope = deps.inventoryScope;
    this.bookDigits = deps.bookDigits;
    this.getProductOfferColumnCapabilities = deps.getProductOfferColumnCapabilities;
    this.productIdAny = deps.productIdAny;
    this.normalizeUnitName = deps.normalizeUnitName;
    this.getListProductStock = deps.getListProductStock;
    this.tenantId = deps.tenantId;
    this.tenantPredicate = deps.tenantPredicate;
  }

  // PERF-9 (PERFORMANCE_CONSTITUTION.md): every POS terminal re-downloads its whole offline catalog
  // when this version changes, so it must move ONLY when something in that catalog changed.
  // `products.catalog_updated_at` is maintained by a trigger (migration 137) that ignores stock/cost
  // columns — never go back to `products.updated_at` here: applyStockDelta stamps it on every sale,
  // which made every terminal reload the full catalog every 5 minutes all day.
  // Unit/offer counts catch deletions (a deleted row cannot raise MAX(updated_at)).
  // Stock freshness for the offline copy is the terminal's hourly full reload, not this version.
  async getPosCatalogVersion(actor: AuthContext): Promise<{ version: string; totalCount: number; lastUpdatedAt: string }> {
    const result = await sql<{ max_updated: string | null; total_count: string | number; unit_count: string | number; offer_count: string | number }>`
      SELECT
        GREATEST(
          COALESCE(MAX(p.catalog_updated_at), '1970-01-01'::timestamptz),
          COALESCE((SELECT MAX(pu.updated_at) FROM product_units pu WHERE ${this.tenantPredicate(actor, 'pu')}), '1970-01-01'::timestamptz),
          COALESCE((SELECT MAX(po.updated_at) FROM product_offers po WHERE ${this.tenantPredicate(actor, 'po')}), '1970-01-01'::timestamptz)
        ) as max_updated,
        COUNT(p.id) as total_count,
        (SELECT COUNT(*) FROM product_units pu WHERE ${this.tenantPredicate(actor, 'pu')}) as unit_count,
        (SELECT COUNT(*) FROM product_offers po WHERE po.is_active = true AND ${this.tenantPredicate(actor, 'po')}) as offer_count
      FROM products p
      WHERE p.is_active = true
        AND ${this.tenantPredicate(actor, 'p')}
    `.execute(this.db);

    const row = result.rows[0];
    const totalCount = Number(row?.total_count || 0);
    const lastUpdatedAt = row?.max_updated ? new Date(row.max_updated).toISOString() : new Date(0).toISOString();
    const version = buildPosCatalogVersion({
      productCount: totalCount,
      unitCount: Number(row?.unit_count || 0),
      offerCount: Number(row?.offer_count || 0),
      lastUpdatedAt,
    });

    return {
      version,
      totalCount,
      lastUpdatedAt,
    };
  }

  async listPosProducts(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    const { q, barcode, limit, requestedLocationId, requestedBranchId, view, isFullCatalog, categoryId } = this.parsePosProductLookupQuery(query);
    const offerCapabilities = await this.getProductOfferColumnCapabilities();
    const scopedLocation = requestedLocationId > 0 ? await this.inventoryScope.assertLocationScope(requestedLocationId, actor).catch(() => null) : null;
    let productRows: PosProductLookupRow[];
    if (barcode) {
      productRows = await this.findPosProductsByBarcode(barcode, limit, actor);
      // POS-PARTIAL-CODE-FALLBACK: an exact barcode/SKU/serial/unit match
      // keeps priority; only when it returns nothing do we fall back to
      // substring search (LIKE %term% on barcode/sku/name), so a partial
      // code like "200" finds barcodes containing it instead of [].
      if (!productRows.length) {
        productRows = await this.searchPosProducts(barcode, limit, view === 'offers' ? 'offers' : 'all', actor, categoryId);
      }
    } else {
      productRows = await this.searchPosProducts(q, limit, view === 'offers' ? 'offers' : 'all', actor, categoryId);
    }

    const uniqueRows = this.uniquePosProductRows(productRows).slice(0, limit);
    const productIds = uniqueRows.map((product) => Number(product.id));

    let eligibleLocationIds: number[] = scopedLocation ? [scopedLocation.id] : [];
    if (requestedBranchId > 0) {
      const branch = await this.db.selectFrom('branches').select(['default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock']).where('id', '=', requestedBranchId).where(this.tenantPredicate(actor)).executeTakeFirst();
      if (branch && posSellsFromAllOperationalLocations(branch, actor.activityType)) {
        const allLocs = await this.db.selectFrom('stock_locations')
          .select(['id', 'location_type', 'branch_id'])
          .where(this.tenantPredicate(actor))
          .where('is_active', '=', true)
          .where('location_type', 'not in', ['damaged', 'in_transit', 'quarantine', 'van_stock'])
          .execute();

        const defaultLocId = branch.default_stock_location_id;
        const sortedLocs = allLocs.filter(l => {
           if (Number(l.id) === Number(defaultLocId)) return true;
           if (Number(l.branch_id) === Number(requestedBranchId)) return true;
           if (l.location_type === 'internal_warehouse' && l.branch_id === null) return true;
           if (branch.allow_external_sales_stock && l.location_type === 'external_warehouse') return true;
           return false;
        });
        eligibleLocationIds = sortedLocs.map(l => l.id);
      } else if (branch && !scopedLocation && branch.default_stock_location_id) {
        // INV-POS-NET-STOCK-DISPLAY: single_location mode sells from the
        // branch default only (checkout: one eligible location), so the
        // display scope is the default location too — not the global
        // figure the empty-eligible fallback used to return.
        eligibleLocationIds = [Number(branch.default_stock_location_id)];
      }
    }

    const bomIds = uniqueRows.map((r) => r.bom_id ? Number(r.bom_id) : null).filter((id): id is number => typeof id === 'number' && id > 0);

    const [unitsByProduct, scopedStockResult, offersByProduct, bomCombosById] = await Promise.all([
      this.fetchPosProductUnits(isFullCatalog ? [] : productIds, actor, isFullCatalog),
      this.resolveScopedStockByProduct(isFullCatalog ? [] : productIds, eligibleLocationIds, uniqueRows, actor, isFullCatalog),
      this.fetchProductOffers(isFullCatalog ? [] : productIds, offerCapabilities.hasMinQty, actor, isFullCatalog),
      this.fetchPosBomCombos(bomIds, actor),
    ]);

    return {
      products: uniqueRows.map((product) => this.mapPosProduct(product, {
        scopedLocationId: scopedLocation?.id || null,
        scopedStockByProduct: scopedStockResult.stock,
        // INV-POS-NET-STOCK-DISPLAY: the scoped figure must reach the
        // `stock` field even when no explicit locationId was passed
        // (branch-scoped lookup): getListProductStock falls back to the
        // global figure when scopedLocationId is null, which discarded
        // the scoped computation entirely for branch-only lookups.
        useScopedStock: eligibleLocationIds.length > 0,
        unitsByProduct,
        offersByProduct,
        bomCombosById,
      })),
      meta: {
        q,
        barcode,
        limit,
        view,
        fullCatalog: isFullCatalog,
        categoryId: categoryId > 0 ? categoryId : undefined,
        locationId: scopedLocation?.id ? String(scopedLocation.id) : '',
      },
    };
  }

  private parsePosProductLookupQuery(query: Record<string, unknown>) {
    const requestedLimit = Number(query.limit || 30);
    const safeLimit = Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 30;
    const view = String(query.view || '').trim() === 'offers' ? 'offers' : 'all';
    const isFullCatalog = String(query.fullCatalog || '').trim() === 'true';
    const maxLimit = isFullCatalog ? 25000 : (view === 'offers' ? 240 : 1000);
    return {
      q: String(query.q || '').trim(),
      barcode: String(query.barcode || '').trim(),
      limit: Math.min(maxLimit, Math.max(1, safeLimit)),
      requestedLocationId: Number(query.locationId || 0),
      requestedBranchId: Number(query.branchId || 0),
      categoryId: Number(query.categoryId || 0),
      view,
      isFullCatalog,
    };
  }

  private async findPosProductsByBarcode(barcode: string, limit: number, actor: AuthContext): Promise<PosProductLookupRow[]> {
    // INV-POS-BARCODE-DASH + Scale PLU leading-zero equivalence + style_code fallback
    return findPosProductsByBarcodeWithDb<PosProductLookupRow>(
      this.db,
      (alias?: string) => this.tenantPredicate(actor, alias),
      barcode,
      limit,
    );
  }

  private async searchPosProducts(q: string, limit: number, view: 'all' | 'offers' = 'all', actor: AuthContext, categoryId = 0): Promise<PosProductLookupRow[]> {
    const normalized = normalizeArabicSearch(q);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    let productQuery = this.db
      .selectFrom('products as p')
      .leftJoin('product_units as pu', (join) => join.onRef('pu.product_id', '=', 'p.id').on(this.tenantPredicate(actor, 'pu')))
      .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true).on(this.tenantPredicate(actor, 'b')))
      .select([
        'p.id',
        'p.name',
        'p.name_en',
        'p.barcode',
        'p.sku',
        'p.item_type',
        'p.item_kind',
        'p.style_code',
        'p.color',
        'p.size',
        'p.retail_price',
        'p.wholesale_price',
        'p.half_wholesale_price',
        'p.credit_price',
        'p.consumer_price',
        'p.min_selling_price',
        'p.stock_qty',
        'p.min_stock_qty',
        'b.id as bom_id',
        'p.category_id',
        'p.track_serials',
        'p.metadata',
      ])
      .where('p.is_active', '=', true)
      .where(this.tenantPredicate(actor, 'p'));

    // INV-POS-CATEGORY-TILE-FILTER: a category tile must be a server-side
    // filter. The POS browse list is a bounded window (first 300 by name),
    // so filtering client-side over the loaded page shows EMPTY for any
    // category whose products sit outside that window.
    if (categoryId > 0) {
      productQuery = productQuery.where('p.category_id', '=', categoryId);
    }

    for (const token of tokens) {
      const pattern = `%${token}%`;
      productQuery = productQuery.where(sql<boolean>`(
        TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${pattern}
        OR LOWER(COALESCE(p.name_en, '')) LIKE ${pattern}
        OR LOWER(COALESCE(p.barcode, '')) LIKE ${pattern}
        OR LOWER(COALESCE(p.sku, '')) LIKE ${pattern}
        OR LOWER(COALESCE(p.style_code, '')) LIKE ${pattern}
        OR TRANSLATE(LOWER(COALESCE(p.color, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${pattern}
        OR LOWER(COALESCE(p.size, '')) LIKE ${pattern}
        OR LOWER(COALESCE(pu.barcode, '')) LIKE ${pattern}
        OR TRANSLATE(LOWER(COALESCE(pu.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${pattern}
      )`);
    }

    if (view === 'offers') {
      productQuery = productQuery.where(sql<boolean>`(
        exists (
          select 1
          from product_offers po
          where po.product_id = p.id
            and po.is_active = true
            and po.tenant_id = ${this.tenantId(actor)}
        )
        OR b.id is not null
        OR exists (
          select 1
          from manufacturing_boms mb
          where mb.product_id = p.id
            and mb.is_active = true
            and mb.tenant_id = ${this.tenantId(actor)}
        )
      )`);
    }

    if (tokens.length > 0) {
      const rawLower = q.trim().toLowerCase();
      const normStartWord = `${normalized} %`;
      const normWholeWord = `% ${normalized} %`;
      const normPrefix = `${normalized}%`;
      const normWordPrefix = `% ${normalized}%`;
      const codePrefix = `${rawLower}%`;
      productQuery = productQuery.orderBy(
        sql<number>`CASE
          WHEN LOWER(COALESCE(p.barcode, '')) = ${rawLower}
            OR LOWER(COALESCE(p.sku, '')) = ${rawLower}
            OR LOWER(COALESCE(p.style_code, '')) = ${rawLower}
            OR LOWER(COALESCE(pu.barcode, '')) = ${rawLower}
            OR TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') = ${normalized}
          THEN 0
          WHEN TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${normStartWord}
          THEN 1
          WHEN (' ' || TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') || ' ') LIKE ${normWholeWord}
          THEN 2
          WHEN TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE ${normPrefix}
          THEN 3
          WHEN (' ' || TRANSLATE(LOWER(COALESCE(p.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه')) LIKE ${normWordPrefix}
          THEN 4
          WHEN LOWER(COALESCE(p.barcode, '')) LIKE ${codePrefix}
            OR LOWER(COALESCE(p.sku, '')) LIKE ${codePrefix}
          THEN 5
          ELSE 6
        END`,
        'asc',
      );
    }

    const sqlFetchLimit = tokens.length > 0 ? Math.min(25000, limit * 3) : limit;
    return productQuery
      .orderBy('p.name', 'asc')
      .orderBy('p.id', 'asc')
      .limit(sqlFetchLimit)
      .execute() as Promise<PosProductLookupRow[]>;
  }

  private uniquePosProductRows(rows: PosProductLookupRow[]): PosProductLookupRow[] {
    const seen = new Set<number>();
    const uniqueRows: PosProductLookupRow[] = [];
    for (const row of rows) {
      const id = Number(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      uniqueRows.push(row);
    }
    return uniqueRows;
  }

  private async fetchPosProductUnits(productIds: number[], actor: AuthContext, isFullCatalog = false): Promise<Map<string, Record<string, unknown>[]>> {
    if (!isFullCatalog && !productIds.length) return new Map();
    let query = this.db
      .selectFrom('product_units')
      .select(['id', 'product_id', 'name', 'multiplier', 'barcode', 'is_base_unit', 'is_sale_unit_default', 'is_purchase_unit_default'])
      .where(this.tenantPredicate(actor));

    if (!isFullCatalog) {
      query = query.where('product_id', 'in', productIds);
    }

    const unitRows = await query
      .orderBy('product_id', 'asc')
      .orderBy('is_base_unit', 'desc')
      .orderBy('id', 'asc')
      .execute() as ProductUnitReadRow[];

    const unitsByProduct = new Map<string, Record<string, unknown>[]>();
    for (const unit of unitRows) {
      const key = String(unit.product_id);
      if (!unitsByProduct.has(key)) unitsByProduct.set(key, []);
      unitsByProduct.get(key)!.push({
        id: String(unit.id),
        name: this.normalizeUnitName(unit.name),
        multiplier: Number(unit.multiplier || 1),
        barcode: unit.barcode || '',
        isBaseUnit: Boolean(unit.is_base_unit),
        isSaleUnit: Boolean(unit.is_sale_unit_default),
        isPurchaseUnit: Boolean(unit.is_purchase_unit_default),
      });
    }
    return unitsByProduct;
  }

  private async fetchProductOffers(productIds: number[], hasMinQty: boolean, actor: AuthContext, isFullCatalog = false): Promise<Map<string, Record<string, unknown>[]>> {
    if (!isFullCatalog && !productIds.length) return new Map();
    const capabilities = await this.getProductOfferColumnCapabilities();
    const selectCols: any[] = ['id', 'product_id', 'offer_type', 'value', 'start_date', 'end_date'];
    if (capabilities.hasMinQty) selectCols.push('min_qty');
    if (capabilities.hasAdvancedPromotions) {
      selectCols.push('bogo_buy_qty', 'bogo_get_qty', 'bogo_discount_percent', 'happy_hour_start', 'happy_hour_end', 'days_of_week');
    }

    let query = this.db
      .selectFrom('product_offers')
      .select(selectCols)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor));

    if (!isFullCatalog) {
      query = query.where('product_id', 'in', productIds);
    }

    const offers = await query
      .orderBy('id', 'desc')
      .execute() as ProductOfferReadRow[];

    return this.mapOffersByProduct(offers);
  }

  mapOffersByProduct(offers: ProductOfferReadRow[]): Map<string, Record<string, unknown>[]> {
    const offersByProduct = new Map<string, Record<string, unknown>[]>();
    for (const offer of offers) {
      const key = String(offer.product_id);
      if (!offersByProduct.has(key)) offersByProduct.set(key, []);
      offersByProduct.get(key)!.push({
        id: String(offer.id),
        type: offer.offer_type === 'bogo'
          ? 'bogo'
          : offer.offer_type === 'bundle'
          ? 'bundle'
          : offer.offer_type === 'price'
          ? 'price'
          : offer.offer_type === 'fixed'
          ? 'fixed'
          : 'percent',
        value: Number(offer.value || 0),
        minQty: Math.max(1, Number(offer.min_qty || 1)),
        // Offer bounds are STORED pg DATEs (node-postgres
        // local-midnight Dates) -- they key through
        // normalizePgDateOnly, never through the UTC slice.
        from: normalizePgDateOnly(offer.start_date),
        to: normalizePgDateOnly(offer.end_date),
        bogoBuyQty: offer.bogo_buy_qty ? Number(offer.bogo_buy_qty) : null,
        bogoGetQty: offer.bogo_get_qty ? Number(offer.bogo_get_qty) : null,
        bogoDiscountPercent: offer.bogo_discount_percent != null ? Number(offer.bogo_discount_percent) : 100,
        happyHourStart: offer.happy_hour_start || null,
        happyHourEnd: offer.happy_hour_end || null,
        daysOfWeek: offer.days_of_week || null,
      });
    }
    return offersByProduct;
  }

  private async fetchPosBomCombos(bomIds: number[], actor: AuthContext): Promise<Map<number, { comboOriginalPrice: number; componentsSummary: string }>> {
    const result = new Map<number, { comboOriginalPrice: number; componentsSummary: string }>();
    if (!bomIds.length) return result;

    const bomLines = await this.db
      .selectFrom('manufacturing_bom_lines as bl')
      .innerJoin('products as p', 'p.id', 'bl.component_product_id')
      .select([
        'bl.bom_id',
        'bl.component_product_id',
        'bl.quantity',
        'p.name as component_name',
        'p.retail_price as component_retail_price',
      ])
      .where('bl.bom_id', 'in', bomIds)
      .where(this.tenantPredicate(actor, 'p'))
      .execute();

    for (const line of bomLines) {
      const bomId = Number(line.bom_id);
      if (!result.has(bomId)) {
        result.set(bomId, { comboOriginalPrice: 0, componentsSummary: '' });
      }
      const entry = result.get(bomId)!;
      const lineQty = Number(line.quantity || 1);
      const linePrice = Number(line.component_retail_price || 0);
      entry.comboOriginalPrice += (linePrice * lineQty);
      const compLabel = `${line.component_name || ''}${lineQty > 1 ? ` (${lineQty})` : ''}`;
      entry.componentsSummary = entry.componentsSummary ? `${entry.componentsSummary} + ${compLabel}` : compLabel;
    }

    // D6a: the combo original price is a computed money value (sum of
    // component retail prices x quantities) shown at POS, so it rounds
    // at the tenant's book digits via the file's own bookDigits helper
    // (fail-closed on a base-currency/rate mismatch). Digits resolve
    // only when a combo actually exists, so plain-product lookups
    // never pay for the settings read.
    if (result.size > 0) {
      const digits = await this.bookDigits(this.db, actor);
      for (const [, entry] of result) {
        entry.comboOriginalPrice = roundMoney(entry.comboOriginalPrice, digits);
      }
    }

    return result;
  }

  private mapPosProduct(
    product: PosProductLookupRow,
    context: {
      scopedLocationId: number | null;
      scopedStockByProduct: Map<string, number>;
      useScopedStock?: boolean;
      unitsByProduct: Map<string, Record<string, unknown>[]>;
      offersByProduct: Map<string, Record<string, unknown>[]>;
      bomCombosById?: Map<number, { comboOriginalPrice: number; componentsSummary: string }>;
    },
  ): Record<string, unknown> {
    const units = context.unitsByProduct.get(String(product.id)) || [
      {
        id: `base-${product.id}`,
        name: 'قطعة',
        multiplier: 1,
        barcode: product.barcode || '',
        isBaseUnit: true,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
    ];

    const bomCombo = product.bom_id ? context.bomCombosById?.get(Number(product.bom_id)) : null;

    return {
      id: String(product.id),
      name: product.name || '',
      nameEn: product.name_en || null,
      name_en: product.name_en || null,
      barcode: product.barcode || '',
      sku: product.sku || '',
      itemType: product.item_type === 'raw_material' ? 'raw_material' : product.item_type === 'service' ? 'service' : 'product',
      itemKind: product.item_kind === 'fashion' ? 'fashion' : 'standard',
      styleCode: product.style_code || '',
      color: product.color || '',
      size: product.size || '',
      retailPrice: Number(product.retail_price || 0),
      wholesalePrice: Number(product.wholesale_price || 0),
      creditPrice: product.credit_price != null ? Number(product.credit_price) : null,
      halfWholesalePrice: product.half_wholesale_price != null ? Number(product.half_wholesale_price) : null,
      consumerPrice: product.consumer_price != null ? Number(product.consumer_price) : null,
      minSellingPrice: product.min_selling_price == null ? null : Number(product.min_selling_price),
      categoryId: product.category_id ? String(product.category_id) : undefined,
      stock: context.useScopedStock
        ? Number(context.scopedStockByProduct.get(String(product.id)) || 0)
        : this.getListProductStock(product, context.scopedLocationId, context.scopedStockByProduct),
      globalStock: Number(product.stock_qty || 0),
      minStock: Number(product.min_stock_qty || 0),
      locationId: context.scopedLocationId ? String(context.scopedLocationId) : '',
      matchedUnitId: product.matched_unit_id ? String(product.matched_unit_id) : '',
      matchedUnit: product.matched_unit_id
        ? {
            id: String(product.matched_unit_id),
            name: this.normalizeUnitName(product.matched_unit_name),
            multiplier: Number(product.matched_unit_multiplier || 1),
            barcode: product.matched_unit_barcode || '',
        }
        : null,
      bomId: product.bom_id ? Number(product.bom_id) : undefined,
      hasBom: !!product.bom_id,
      comboOriginalPrice: bomCombo?.comboOriginalPrice || undefined,
      comboComponentsSummary: bomCombo?.componentsSummary || undefined,
      trackSerials: Boolean(product.track_serials),
      matchedSerialNumber: product.matched_serial_number || null,
      icon: (product as any).metadata?.icon || (typeof (product as any).metadata === 'string' ? (() => { try { return JSON.parse((product as any).metadata)?.icon; } catch { return null; } })() : null) || null,
      imageUrl: (product as any).metadata?.imageUrl || (typeof (product as any).metadata === 'string' ? (() => { try { return JSON.parse((product as any).metadata)?.imageUrl; } catch { return null; } })() : null) || null,
      units,
      offers: context.offersByProduct.get(String(product.id)) || [],
      calories: product.calories != null ? Number(product.calories) : null,
      allergens: Array.isArray(product.allergens) ? product.allergens : [],
      isSpicy: Boolean(product.is_spicy),
      isVegetarian: Boolean(product.is_vegetarian),
      isGlutenFree: Boolean(product.is_gluten_free),
    };
  }

  async resolveScopedStockByProduct(productIds: number[], eligibleLocationIds: number[], products: Array<Pick<ProductRow, 'id' | 'stock_qty'>>, actor: AuthContext, isFullCatalog = false): Promise<{ stock: Map<string, number>, locations: Map<string, number[]> }> {
    const scopedStockByProduct = new Map<string, number>();
    const activeLocationsByProduct = new Map<string, number[]>();
    if (!isFullCatalog && !productIds.length) return { stock: scopedStockByProduct, locations: activeLocationsByProduct };

    let query = this.db
      .selectFrom('product_location_stock as pls')
      .select(['pls.product_id', 'pls.location_id', 'pls.branch_id', 'pls.qty', 'pls.reserved_qty'])
      .where(this.tenantPredicate(actor, 'pls'));

    if (!isFullCatalog) {
      query = query.where(this.productIdAny('pls.product_id', productIds));
    }

    const stockRows = await query.execute();

    // PERF-2 (ARCHITECTURE_INVARIANTS.md §2.6): every per-product figure is aggregated in this ONE pass
    // over stockRows. The product loop below must only read these maps — a `stockRows.filter(...)` per
    // product was O(products × stock rows): ~600M comparisons for a 20k-item full POS catalog.
    const eligibleLocationSet = new Set(eligibleLocationIds.map((id) => Number(id)));
    const eligibleRowsByProduct = new Map<string, Array<{ qty: number; reserved: number }>>();
    const unassignedByProduct = new Map<string, { qty: number; reserved: number }>();
    for (const row of stockRows) {
      const key = String(row.product_id);
      const qty = Number(row.qty || 0);
      const reserved = Number((row as { reserved_qty?: unknown }).reserved_qty || 0);

      if (!activeLocationsByProduct.has(key)) activeLocationsByProduct.set(key, []);
      if (row.location_id) activeLocationsByProduct.get(key)!.push(row.location_id);

      // The unassigned pool is the single row with neither a location nor a
      // branch (location-stock-ledger.ts): the same bucket checkout reads.
      if (row.location_id == null && (row as { branch_id?: unknown }).branch_id == null) {
        const bucket = unassignedByProduct.get(key) || { qty: 0, reserved: 0 };
        bucket.qty += qty;
        bucket.reserved += reserved;
        unassignedByProduct.set(key, bucket);
      } else if (eligibleLocationSet.has(Number(row.location_id || 0))) {
        const rows = eligibleRowsByProduct.get(key) || [];
        rows.push({ qty, reserved });
        eligibleRowsByProduct.set(key, rows);
      }
    }

    for (const product of products) {
      const key = String(product.id);
      if (eligibleLocationIds.length > 0) {
        // INV-POS-NET-STOCK-DISPLAY: the displayed figure is the checkout
        // figure — availableAcrossLocations, the same helper the
        // reservation path documents as the catalog number (net of
        // reserved, per row, eligible locations + unassigned pool).
        // The old code summed gross qty and then added a
        // `stock_qty − Σ assigned` "discrepancy" whenever the pool was
        // empty: phantom stock checkout never credits, so a reserved
        // item looked sellable and the sale failed at the till.
        const available = availableAcrossLocations(
          eligibleRowsByProduct.get(key) || [],
          unassignedByProduct.get(key) || { qty: 0, reserved: 0 },
        );
        scopedStockByProduct.set(key, Number(available.toFixed(3)));
      } else {
        scopedStockByProduct.set(key, Number(product.stock_qty || 0));
      }
    }

    return { stock: scopedStockByProduct, locations: activeLocationsByProduct };
  }
}
