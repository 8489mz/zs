import { Injectable } from '@nestjs/common';
import { sql, Kysely } from '../../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { InventoryScopeService } from '../../inventory/services/inventory-scope.service';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import {
  compileProductSearchQuery,
  scoreProductSearchMatch,
  compareRankedProductMatches,
} from '../engines/product-search-rank.engine';
import {
  ProductRow,
  ProductOfferColumnCapabilities,
  ProductOfferReadRow,
  ProductCountRow,
  ProductUnitSearchRow,
  ProductUnitReadRow,
  CustomerPriceReadRow,
} from './catalog-product-types';

/**
 * CatalogProductListService — slice P5 of the catalog-product split.
 * Pure move of 10 methods from CatalogProductService (the list paths: the
 * shared base query, the per-page tail, the SQL-paged path, the public
 * listProducts entry, the query parser, and the JS-filter path — context,
 * filter, relations, mapping, summary). No behavior change: the bodies are
 * byte-identical except fetchListProductRelations + mapListProducts are
 * PUBLIC here (private in the facade delegate — the facade, a different
 * class, cannot call a private slice method, tsc TS2341; the facade keeps
 * thin PRIVATE delegates for them, and P7 getProduct calls them via bound
 * deps at its merge). The other 7 methods stay private (called only inside
 * this slice) and have NO facade delegate. Deps: db + inventoryScope +
 * the kernel helpers tenantPredicate / tenantId / canViewCostPrice /
 * productIdAny / normalizeUnitName / getListProductStock (stay REAL private
 * methods in the facade, passed bound via the HR kernel pattern, stored
 * under their ORIGINAL names so the moved bodies stay byte-identical) +
 * the cross-slice deps resolveScopedStockByProduct + mapOffersByProduct
 * (P4, wired from this.posService at merge) + getProductOfferColumnCapabilities
 * (P2, wired from this.offersService at merge). ensureAdvancedOffersSupported
 * is NOT a dep: the prep §2.5 lists it for P5, but grep proves 0 uses in the
 * moved text. The 7 type aliases used here come from ./catalog-product-types
 * (created by P1 at the first merge — MERGE DEPENDENCY, same as P2).
 * Clock: exactly 1 site, L1491 new Date(product.catalog_updated_at).toISOString()
 * in mapListProducts (catalogUpdatedAt display stamp) — pure move, no fix.
 * No toFixed2, no inlineRound, no FX in this slice. listProducts is driven
 * (prep §6.5); PERF-2 :111 contextBody slice lives here (merge repoint).
 */

export interface CatalogProductListDeps {
  db: Kysely<Database>;
  inventoryScope: InventoryScopeService;
  // Bound kernel helpers (stay REAL private methods in the facade, HR kernel
  // pattern): stored under their ORIGINAL names so the moved bodies stay
  // byte-identical. productIdAny / tenantPredicate return RawBuilder<boolean>
  // (the exact inferred type of the sql<boolean> template; P3-probed for
  // tenantPredicate, same shape for productIdAny); getListProductStock
  // returns number (Number(...) in its body).
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  tenantId: (actor: AuthContext) => string;
  canViewCostPrice: (actor: AuthContext) => boolean;
  productIdAny: (column: string, ids: number[]) => RawBuilder<boolean>;
  normalizeUnitName: (name: unknown) => string;
  getListProductStock: (
    product: Pick<ProductRow, 'id' | 'stock_qty'>,
    scopedLocationId: number | null,
    scopedStockByProduct: Map<string, number>,
  ) => number;
  // Bound cross-slice deps (sibling slices, wired from their facade fields at
  // merge — P4 merges before P5, P2 before P4; the merge coordinator owns the
  // rebase of this ctor hunk onto the merged facade).
  resolveScopedStockByProduct: (
    productIds: number[],
    eligibleLocationIds: number[],
    products: Array<Pick<ProductRow, 'id' | 'stock_qty'>>,
    actor: AuthContext,
    isFullCatalog?: boolean,
  ) => Promise<{ stock: Map<string, number>; locations: Map<string, number[]> }>;
  mapOffersByProduct: (offers: ProductOfferReadRow[]) => Map<string, Record<string, unknown>[]>;
  getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;
}

@Injectable()
export class CatalogProductListService {
  private readonly db: Kysely<Database>;
  private readonly inventoryScope: InventoryScopeService;
  private readonly tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly tenantId: (actor: AuthContext) => string;
  private readonly canViewCostPrice: (actor: AuthContext) => boolean;
  private readonly productIdAny: (column: string, ids: number[]) => RawBuilder<boolean>;
  private readonly normalizeUnitName: (name: unknown) => string;
  private readonly getListProductStock: (
    product: Pick<ProductRow, 'id' | 'stock_qty'>,
    scopedLocationId: number | null,
    scopedStockByProduct: Map<string, number>,
  ) => number;
  private readonly resolveScopedStockByProduct: (
    productIds: number[],
    eligibleLocationIds: number[],
    products: Array<Pick<ProductRow, 'id' | 'stock_qty'>>,
    actor: AuthContext,
    isFullCatalog?: boolean,
  ) => Promise<{ stock: Map<string, number>; locations: Map<string, number[]> }>;
  private readonly mapOffersByProduct: (offers: ProductOfferReadRow[]) => Map<string, Record<string, unknown>[]>;
  private readonly getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;

  constructor(deps: CatalogProductListDeps) {
    this.db = deps.db;
    this.inventoryScope = deps.inventoryScope;
    this.tenantPredicate = deps.tenantPredicate;
    this.tenantId = deps.tenantId;
    this.canViewCostPrice = deps.canViewCostPrice;
    this.productIdAny = deps.productIdAny;
    this.normalizeUnitName = deps.normalizeUnitName;
    this.getListProductStock = deps.getListProductStock;
    this.resolveScopedStockByProduct = deps.resolveScopedStockByProduct;
    this.mapOffersByProduct = deps.mapOffersByProduct;
    this.getProductOfferColumnCapabilities = deps.getProductOfferColumnCapabilities;
  }

  // INV-SLOW-INITIAL-LOADS: the unfiltered products list used to fetch the
  // whole tenant catalog on every page request and paginate in Node. The
  // shared base query below is the single SELECT list both paths use; the
  // fast path adds LIMIT/OFFSET in SQL, the slow path keeps the old
  // full-fetch + JS-filter behaviour for filtered / sorted / grouped
  // requests, where the filter semantics (Arabic-normalized search,
  // scoped stock, fashion grouping) cannot move to SQL unchanged.
  private listProductsBaseQuery(actor: AuthContext, view: string) {
    return this.db
      .selectFrom('products')
      .leftJoin('manufacturing_boms as b', (join) =>
        join
          .onRef('b.product_id', '=', 'products.id')
          .onRef('b.tenant_id', '=', 'products.tenant_id')
          .on('b.is_active', '=', true),
      )
      .leftJoin('stock_locations as sl', (join) =>
        join.onRef('sl.id', '=', 'products.default_location_id').on(this.tenantPredicate(actor, 'sl')),
      )
      .select([
        'products.id',
        'products.name',
        'products.name_en',
        'products.barcode',
        'products.sku',
        'products.catalog_updated_at',
        'products.item_type',
        'products.item_kind',
        'products.style_code',
        'products.color',
        'products.size',
        'products.bin_location',
        'products.track_serials',
        'products.category_id',
        'products.supplier_id',
        'products.cost_price',
        'products.retail_price',
        'products.wholesale_price',
        'products.half_wholesale_price',
        'products.credit_price',
        'products.consumer_price',
        'products.min_selling_price',
        'products.stock_qty',
        'products.min_stock_qty',
        'sl.id as default_location_id',
        'products.notes',
        'products.metadata',
        'b.id as bom_id',
        'sl.name as default_location_name',
        'products.is_active',
        'products.calories',
        'products.allergens',
        'products.is_spicy',
        'products.is_vegetarian',
        'products.is_gluten_free',
      ])
      .where(view === 'archived' ? sql<boolean>`products.is_active = false` : sql<boolean>`products.is_active = true`)
      .where(this.tenantPredicate(actor, 'products'));
  }

  // INV-SLOW-INITIAL-LOADS: the per-page tail both list paths share —
  // relations + movement existence for the page rows only, then the row
  // mapping. The page rows are the only products it ever touches.
  private async mapPagedListProducts(
    pagedBaseRows: ProductRow[],
    options: {
      canViewCost: boolean;
      scopedLocationId: number | null;
      scopedStockByProduct: Map<string, number>;
      activeLocationsByProduct?: Map<string, number[]>;
      categoriesById: Record<string, string>;
      suppliersById: Record<string, string>;
      locationsById: Record<string, string>;
      brief: boolean;
      offerCapabilities: ProductOfferColumnCapabilities;
      actor: AuthContext;
    },
  ): Promise<Record<string, unknown>[]> {
    const pagedIds = pagedBaseRows.map((row) => Number(row.id));
    const [relations, movementRows, importRows, purchaseRows, saleRows] = await Promise.all([
      options.brief
        ? Promise.resolve({ unitsByProduct: new Map(), offersByProduct: new Map(), pricesByProduct: new Map() })
        : this.fetchListProductRelations(pagedIds, options.offerCapabilities.hasMinQty, options.actor),
      pagedIds.length > 0
        ? this.db
            .selectFrom('stock_movements')
            .select('product_id')
            .where('product_id', 'in', pagedIds)
            .where(this.tenantPredicate(options.actor))
            .groupBy('product_id')
            .execute()
        : Promise.resolve([]),
      pagedIds.length > 0
        ? this.db
            .selectFrom('import_shipment_items')
            .select('product_id')
            .where('product_id', 'in', pagedIds)
            .where(sql<boolean>`tenant_id = ${this.tenantId(options.actor)}`)
            .groupBy('product_id')
            .execute()
            .catch(() => [])
        : Promise.resolve([]),
      pagedIds.length > 0
        ? this.db
            .selectFrom('purchase_items')
            .select('product_id')
            .where('product_id', 'in', pagedIds)
            .where(this.tenantPredicate(options.actor))
            .groupBy('product_id')
            .execute()
            .catch(() => [])
        : Promise.resolve([]),
      pagedIds.length > 0
        ? this.db
            .selectFrom('sale_items')
            .select('product_id')
            .where('product_id', 'in', pagedIds)
            .where(this.tenantPredicate(options.actor))
            .groupBy('product_id')
            .execute()
            .catch(() => [])
        : Promise.resolve([]),
    ]);
    const productIdsWithMovements = new Set([
      ...(movementRows as any[]).map((r) => Number(r.product_id)),
      ...(importRows as any[]).map((r) => Number(r.product_id)),
      ...(purchaseRows as any[]).map((r) => Number(r.product_id)),
      ...(saleRows as any[]).map((r) => Number(r.product_id)),
    ]);
    return this.mapListProducts(pagedBaseRows, {
      canViewCost: options.canViewCost,
      scopedLocationId: options.scopedLocationId,
      scopedStockByProduct: options.scopedStockByProduct,
      activeLocationsByProduct: options.activeLocationsByProduct,
      categoriesById: options.categoriesById,
      suppliersById: options.suppliersById,
      locationsById: options.locationsById,
      unitsByProduct: relations.unitsByProduct,
      offersByProduct: relations.offersByProduct,
      pricesByProduct: relations.pricesByProduct,
      productIdsWithMovements,
    });
  }

  // INV-SLOW-INITIAL-LOADS: the SQL-paged path for unfiltered lists.
  // Totals + summary come from SQL aggregates over the whole unfiltered
  // set, the page rows from LIMIT/OFFSET, and scoped stock / locations
  // only for the page rows — so one page request reads one page, not the
  // catalog. The coalesce()s mirror the JS oracle: Number(x || 0) treats
  // NULL as 0, so a NULL stock counts as low / out of stock exactly as
  // before, and brief requests report 0 offer / customer-price counts,
  // as before.
  private async listProductsPageInSql(options: {
    page: number;
    pageSize: number;
    view: string;
    brief: boolean;
    canViewCost: boolean;
    offerCapabilities: ProductOfferColumnCapabilities;
    actor: AuthContext;
  }): Promise<Record<string, unknown>> {
    const { page, pageSize, view, brief, canViewCost, offerCapabilities, actor } = options;
    const isActive = view !== 'archived';
    const aggregates = await this.db
      .selectFrom('products')
      .select([
        sql<number>`count(*)`.as('total'),
        sql<number>`count(*) filter (where coalesce(stock_qty, 0) <= coalesce(min_stock_qty, 0))`.as('low_stock_count'),
        sql<number>`count(*) filter (where coalesce(stock_qty, 0) <= 0)`.as('out_of_stock_count'),
        sql<number>`coalesce(sum(coalesce(stock_qty, 0) * coalesce(cost_price, 0)), 0)`.as('inventory_cost'),
        sql<number>`coalesce(sum(coalesce(stock_qty, 0) * coalesce(retail_price, 0)), 0)`.as('inventory_sale_value'),
      ])
      .where('products.is_active', '=', isActive)
      .where(this.tenantPredicate(actor, 'products'))
      .executeTakeFirstOrThrow();
    const total = Number(aggregates.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;

    const [offerTotal, customerPriceTotal] = brief
      ? [0, 0]
      : await Promise.all([
          this.db
            .selectFrom('product_offers')
            .select(sql<number>`count(*)`.as('n'))
            .where('is_active', '=', true)
            .where(this.tenantPredicate(actor))
            .where('product_id', 'in', (eb) =>
              eb
                .selectFrom('products')
                .select('products.id')
                .where('products.is_active', '=', isActive)
                .where(this.tenantPredicate(actor, 'products')),
            )
            .executeTakeFirstOrThrow()
            .then((row) => Number(row.n || 0)),
          this.db
            .selectFrom('product_customer_prices')
            .select(sql<number>`count(*)`.as('n'))
            .where(this.tenantPredicate(actor))
            .where('product_id', 'in', (eb) =>
              eb
                .selectFrom('products')
                .select('products.id')
                .where('products.is_active', '=', isActive)
                .where(this.tenantPredicate(actor, 'products')),
            )
            .executeTakeFirstOrThrow()
            .then((row) => Number(row.n || 0)),
        ]);

    const [pagedBaseRows, categories, suppliers, locations] = await Promise.all([
      this.listProductsBaseQuery(actor, view).orderBy('id', 'desc').limit(pageSize).offset(start).execute() as Promise<
        ProductRow[]
      >,
      this.db
        .selectFrom('product_categories')
        .select(['id', 'name'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .execute(),
      this.db
        .selectFrom('suppliers')
        .select(['id', 'name'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .execute(),
      this.db
        .selectFrom('stock_locations')
        .select(['id', 'name'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .execute(),
    ]);
    const pagedIds = pagedBaseRows.map((row) => Number(row.id));
    const scopedStockResult = brief
      ? {
          stock: new Map<string, number>(pagedBaseRows.map((p) => [String(p.id), Number(p.stock_qty || 0)])),
          locations: new Map<string, number[]>(),
        }
      : await this.resolveScopedStockByProduct(pagedIds, [], pagedBaseRows, actor);
    const categoriesById = Object.fromEntries(categories.map((entry) => [String(entry.id), String(entry.name || '')]));
    const suppliersById = Object.fromEntries(suppliers.map((entry) => [String(entry.id), String(entry.name || '')]));
    const locationsById = Object.fromEntries(locations.map((entry) => [String(entry.id), String(entry.name || '')]));
    const pagedRows = await this.mapPagedListProducts(pagedBaseRows, {
      canViewCost,
      scopedLocationId: null,
      scopedStockByProduct: scopedStockResult.stock,
      activeLocationsByProduct: scopedStockResult.locations,
      categoriesById,
      suppliersById,
      locationsById,
      brief,
      offerCapabilities,
      actor,
    });
    return {
      products: pagedRows,
      pagination: { page: safePage, pageSize, totalItems: total, totalPages },
      summary: {
        totalProducts: total,
        lowStockCount: Number(aggregates.low_stock_count || 0),
        outOfStockCount: Number(aggregates.out_of_stock_count || 0),
        inventoryCost: canViewCost ? Number(aggregates.inventory_cost || 0) : null,
        inventorySaleValue: Number(aggregates.inventory_sale_value || 0),
        activeOffersCount: offerTotal,
        customerPriceCount: customerPriceTotal,
      },
    };
  }

  async listProducts(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    const {
      page,
      pageSize,
      q,
      rawQuery,
      identityOnly,
      preferInStock,
      view,
      requestedLocationId,
      categoryId,
      supplierId,
      brief,
      sortBy,
      sortDir,
    } = this.parseListProductsQuery(query);
    const canViewCost = this.canViewCostPrice(actor);
    const offerCapabilities = await this.getProductOfferColumnCapabilities();
    const scopedLocation =
      requestedLocationId > 0 && actor
        ? await this.inventoryScope.assertLocationScope(requestedLocationId, actor).catch(() => null)
        : null;

    // Sorting order determination (moved up: the fast-path decision needs it):
    // 1. Explicit sort request takes highest precedence across the entire tenant catalog.
    // 2. Otherwise:
    //    - 'low' view defaults to least stock first (stock ASC).
    //    - 'out' view defaults to category then name (category ASC, name ASC).
    //    - 'all' and all other views default to newest products first (id DESC) as fetched from DB.
    const effectiveSortBy = sortBy || (view === 'low' ? 'stock' : view === 'out' ? 'category' : 'id');
    const effectiveSortDir = sortDir || (view === 'low' ? 'asc' : view === 'out' ? 'asc' : 'desc');
    // Fashion pages are counted by models, never by individual sizes.
    const groupedFashion = String(query.groupFashion || '') === 'true';

    // INV-SLOW-INITIAL-LOADS: unfiltered requests (the default products
    // page, the route prefetch, the frontend listAll() loop) page in SQL
    // instead of re-reading the whole catalog per page request. Any
    // filter, custom sort or fashion grouping keeps the old path below,
    // whose JS filter/sort semantics are unchanged.
    const canPageInSql =
      !q &&
      !categoryId &&
      !supplierId &&
      !scopedLocation &&
      (view === 'all' || view === 'archived') &&
      !groupedFashion &&
      effectiveSortBy === 'id' &&
      effectiveSortDir === 'desc';
    if (canPageInSql) {
      return this.listProductsPageInSql({ page, pageSize, view, brief, canViewCost, offerCapabilities, actor });
    }

    const [products, categories, suppliers, locations] = await Promise.all([
      this.listProductsBaseQuery(actor, view).orderBy('id', 'desc').execute() as Promise<ProductRow[]>,
      this.db
        .selectFrom('product_categories')
        .select(['id', 'name'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .execute(),
      this.db
        .selectFrom('suppliers')
        .select(['id', 'name'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .execute(),
      this.db
        .selectFrom('stock_locations')
        .select(['id', 'name'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .execute(),
    ]);

    const productIds = products.map((product) => Number(product.id));
    const scopedStockResult =
      brief && !scopedLocation && !q
        ? {
            stock: new Map<string, number>(products.map((p) => [String(p.id), Number(p.stock_qty || 0)])),
            locations: new Map<string, number[]>(),
          }
        : await this.resolveScopedStockByProduct(
            productIds,
            scopedLocation ? [scopedLocation.id] : [],
            products,
            actor,
          );
    const listContext = await this.buildListProductsContext(productIds, q, categories, suppliers, locations, actor, {
      brief,
      view,
    });
    const searchScoresById = new Map<string, number>();
    const filteredBaseRows = this.filterListProducts(products, {
      q,
      rawQuery,
      identityOnly,
      searchScoresById,
      view,
      scopedLocationId: scopedLocation?.id || null,
      scopedStockByProduct: scopedStockResult.stock,
      activeLocationsByProduct: scopedStockResult.locations,
      categoryId,
      supplierId,
      ...listContext,
    });

    if (q && !sortBy && view === 'all') {
      const scopedLocId = scopedLocation?.id || null;
      filteredBaseRows.sort((a, b) =>
        compareRankedProductMatches(
          {
            id: Number(a.id),
            score: searchScoresById.get(String(a.id)) || 0,
            stock: this.getListProductStock(a, scopedLocId, scopedStockResult.stock),
          },
          {
            id: Number(b.id),
            score: searchScoresById.get(String(b.id)) || 0,
            stock: this.getListProductStock(b, scopedLocId, scopedStockResult.stock),
          },
          { preferInStock },
        ),
      );
    } else if (effectiveSortBy !== 'id' || effectiveSortDir !== 'desc') {
      filteredBaseRows.sort((a, b) => {
        if (effectiveSortBy === 'name') {
          const comp = String(a.name || '').localeCompare(String(b.name || ''), 'ar');
          return effectiveSortDir === 'desc' ? -comp : comp;
        }
        if (effectiveSortBy === 'barcode') {
          const comp = String(a.barcode || '').localeCompare(String(b.barcode || ''));
          return effectiveSortDir === 'desc' ? -comp : comp;
        }
        if (effectiveSortBy === 'stock') {
          const aStock = scopedStockResult.stock.get(String(a.id)) ?? Number(a.stock_qty || 0);
          const bStock = scopedStockResult.stock.get(String(b.id)) ?? Number(b.stock_qty || 0);
          return effectiveSortDir === 'desc' ? bStock - aStock : aStock - bStock;
        }
        if (effectiveSortBy === 'price' || effectiveSortBy === 'retail_price') {
          const aPrice = Number(a.retail_price || 0);
          const bPrice = Number(b.retail_price || 0);
          return effectiveSortDir === 'desc' ? bPrice - aPrice : aPrice - bPrice;
        }
        if (effectiveSortBy === 'category') {
          const catA = listContext.categoriesById[String(a.category_id || '')] || '';
          const catB = listContext.categoriesById[String(b.category_id || '')] || '';
          const catComp = catA.localeCompare(catB, 'ar');
          if (catComp !== 0) return effectiveSortDir === 'desc' ? -catComp : catComp;
          return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
        }
        if (effectiveSortBy === 'id') {
          return effectiveSortDir === 'desc' ? Number(b.id) - Number(a.id) : Number(a.id) - Number(b.id);
        }
        return 0;
      });
    }

    // Fashion pages are counted by models, never by individual sizes.
    // Every selected model returns all of its tenant-scoped active variants.
    const pageGroups: ProductRow[][] = [];
    if (groupedFashion) {
      const groupByKey = new Map<string, ProductRow[]>();
      for (const row of filteredBaseRows) {
        const key = row.item_kind === 'fashion' && row.style_code ? `style:${row.style_code}` : `product:${row.id}`;
        if (!groupByKey.has(key)) groupByKey.set(key, []);
        groupByKey.get(key)!.push(row);
      }
      // Index the complete source once; avoid O(modelCount × productCount)
      // scans at larger apparel retailers.
      const allByStyle = new Map<string, ProductRow[]>();
      for (const product of products) {
        if (product.item_kind !== 'fashion' || !product.style_code) continue;
        const list = allByStyle.get(product.style_code) || [];
        list.push(product);
        allByStyle.set(product.style_code, list);
      }
      for (const [key, rows] of groupByKey.entries()) {
        if (key.startsWith('style:')) {
          const present = new Set(rows.map((p) => Number(p.id)));
          for (const sibling of allByStyle.get(key.slice(6)) || []) {
            if (!present.has(Number(sibling.id))) rows.push(sibling);
          }
        }
        pageGroups.push(rows);
      }
    }
    const total = groupedFashion ? pageGroups.length : filteredBaseRows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const pagedBaseRows = groupedFashion
      ? pageGroups.slice(start, start + pageSize).flat()
      : filteredBaseRows.slice(start, start + pageSize);
    const pagedRows = await this.mapPagedListProducts(pagedBaseRows, {
      canViewCost,
      scopedLocationId: scopedLocation?.id || null,
      scopedStockByProduct: scopedStockResult.stock,
      activeLocationsByProduct: scopedStockResult.locations,
      categoriesById: listContext.categoriesById,
      suppliersById: listContext.suppliersById,
      locationsById: listContext.locationsById,
      brief,
      offerCapabilities,
      actor,
    });

    return {
      products: pagedRows,
      pagination: { page: safePage, pageSize, totalItems: total, totalPages },
      summary: this.buildListSummary(filteredBaseRows, {
        canViewCost,
        scopedLocationId: scopedLocation?.id || null,
        scopedStockByProduct: scopedStockResult.stock,
        offerCountByProduct: listContext.offerCountByProduct,
        customerPriceCountByProduct: listContext.customerPriceCountByProduct,
      }),
    };
  }

  private parseListProductsQuery(query: Record<string, unknown>) {
    const rawSortBy = query.sortBy ? String(query.sortBy).trim().toLowerCase() : undefined;
    const rawSortDir = query.sortDir ? String(query.sortDir).trim().toLowerCase() : undefined;
    return {
      page: Math.max(1, Number(query.page || 1)),
      pageSize: Math.min(10000, Math.max(5, Number(query.pageSize || 20))),
      q: normalizeArabicSearch(query.q),
      rawQuery: String(query.q ?? '').trim(),
      identityOnly: String(query.identityOnly || '').toLowerCase() === 'true' || query.identityOnly === true,
      preferInStock: String(query.preferInStock || '').toLowerCase() === 'true' || query.preferInStock === true,
      view: String(query.view || 'all'),
      requestedLocationId: Number(query.locationId || 0),
      categoryId: query.categoryId ? Number(query.categoryId) : undefined,
      supplierId: query.supplierId ? Number(query.supplierId) : undefined,
      brief: String(query.brief || '').toLowerCase() === 'true' || query.brief === true,
      sortBy: rawSortBy,
      sortDir: rawSortDir === 'asc' || rawSortDir === 'desc' ? rawSortDir : undefined,
    };
  }

  private async buildListProductsContext(
    productIds: number[],
    q: string,
    categories: Array<{ id: number; name: string }>,
    suppliers: Array<{ id: number; name: string }>,
    locations: Array<{ id: number; name: string }>,
    actor: AuthContext,
    options?: { brief?: boolean; view?: string },
  ) {
    const needCounts = !options?.brief || options?.view === 'offers' || options?.view === 'special';
    const [unitSearchRows, offerCountRows, customerPriceCountRows] = await Promise.all([
      q && productIds.length
        ? (this.db
            .selectFrom('product_units')
            .select(['product_id', 'name', 'barcode'])
            .where(this.productIdAny('product_id', productIds))
            .where(this.tenantPredicate(actor))
            .orderBy('product_id', 'asc')
            .execute() as Promise<ProductUnitSearchRow[]>)
        : Promise.resolve([]),
      needCounts && productIds.length
        ? (this.db
            .selectFrom('product_offers')
            .select(['product_id', (eb) => eb.fn.countAll<number>().as('count')])
            .where('is_active', '=', true)
            .where(this.productIdAny('product_id', productIds))
            .where(this.tenantPredicate(actor))
            .groupBy('product_id')
            .execute() as Promise<ProductCountRow[]>)
        : Promise.resolve([]),
      needCounts && productIds.length
        ? (this.db
            .selectFrom('product_customer_prices')
            .select(['product_id', (eb) => eb.fn.countAll<number>().as('count')])
            .where(this.productIdAny('product_id', productIds))
            .where(this.tenantPredicate(actor))
            .groupBy('product_id')
            .execute() as Promise<ProductCountRow[]>)
        : Promise.resolve([]),
    ]);

    const categoriesById = Object.fromEntries(categories.map((entry) => [String(entry.id), String(entry.name || '')]));
    const suppliersById = Object.fromEntries(suppliers.map((entry) => [String(entry.id), String(entry.name || '')]));
    const locationsById = Object.fromEntries(locations.map((entry) => [String(entry.id), String(entry.name || '')]));
    const unitSearchValuesByProduct = new Map<string, string[]>();
    for (const unit of unitSearchRows) {
      const key = String(unit.product_id);
      if (!unitSearchValuesByProduct.has(key)) unitSearchValuesByProduct.set(key, []);
      unitSearchValuesByProduct.get(key)!.push(String(unit.name || ''), String(unit.barcode || ''));
    }

    const offerCountByProduct = new Map<string, number>();
    for (const row of offerCountRows) offerCountByProduct.set(String(row.product_id), Number(row.count || 0));

    const customerPriceCountByProduct = new Map<string, number>();
    for (const row of customerPriceCountRows)
      customerPriceCountByProduct.set(String(row.product_id), Number(row.count || 0));

    return {
      categoriesById,
      suppliersById,
      locationsById,
      unitSearchValuesByProduct,
      offerCountByProduct,
      customerPriceCountByProduct,
    };
  }

  private filterListProducts(
    products: ProductRow[],
    context: {
      q: string;
      rawQuery?: string;
      identityOnly?: boolean;
      searchScoresById?: Map<string, number>;
      view: string;
      scopedLocationId: number | null;
      scopedStockByProduct: Map<string, number>;
      activeLocationsByProduct?: Map<string, number[]>;
      categoriesById: Record<string, string>;
      suppliersById: Record<string, string>;
      locationsById: Record<string, string>;
      unitSearchValuesByProduct: Map<string, string[]>;
      offerCountByProduct: Map<string, number>;
      customerPriceCountByProduct: Map<string, number>;
      categoryId?: number;
      supplierId?: number;
    },
  ): ProductRow[] {
    const compiledQuery = compileProductSearchQuery(context.rawQuery ?? context.q);
    return products.filter((product) => {
      const key = String(product.id);
      const stock = this.getListProductStock(product, context.scopedLocationId, context.scopedStockByProduct);
      const minStock = Number(product.min_stock_qty || 0);
      const offerCount = Number(context.offerCountByProduct.get(key) || 0);
      const customerPriceCount = Number(context.customerPriceCountByProduct.get(key) || 0);

      if (context.categoryId && Number(product.category_id) !== context.categoryId) return false;
      if (context.supplierId && Number(product.supplier_id) !== context.supplierId) return false;

      if (context.scopedLocationId) {
        const activeLocIds = context.activeLocationsByProduct?.get(key) || [];
        const inLocation =
          activeLocIds.includes(context.scopedLocationId) ||
          Number(product.default_location_id) === context.scopedLocationId;
        if (!inLocation) return false;
      }

      if (context.view !== 'all') {
        if (context.view === 'low' && !(stock <= minStock)) return false;
        if (context.view === 'out' && !(stock <= 0)) return false;
        if (context.view === 'offers' && offerCount <= 0 && !(product as any).bom_id) return false;
        if (context.view === 'special' && customerPriceCount <= 0) return false;
      }

      if (!compiledQuery.norm) return true;

      let secondaryValues: string[] | undefined;
      if (!context.identityOnly) {
        const activeLocIds = context.activeLocationsByProduct?.get(key) || [];
        const activeLocNames = activeLocIds.map((id) => context.locationsById[String(id)] || '').filter(Boolean);
        const defaultLocName =
          product.default_location_name || context.locationsById[String(product.default_location_id || '')] || '';
        secondaryValues = [
          context.categoriesById[String(product.category_id || '')] || '',
          context.suppliersById[String(product.supplier_id || '')] || '',
          defaultLocName,
          ...activeLocNames,
          String(product.notes || ''),
        ];
      }

      const score = scoreProductSearchMatch(
        compiledQuery,
        {
          name: product.name,
          nameEn: product.name_en,
          barcode: product.barcode,
          sku: product.sku,
          styleCode: product.style_code,
          color: product.color,
          size: product.size,
          unitSearchValues: context.unitSearchValuesByProduct.get(key),
          secondaryValues,
        },
        { identityOnly: context.identityOnly },
      );

      if (score <= 0) return false;
      context.searchScoresById?.set(key, score);
      return true;
    });
  }

  async fetchListProductRelations(pagedIds: number[], hasMinQty: boolean, actor: AuthContext) {
    const [units, offers, customerPrices] = pagedIds.length
      ? await Promise.all([
          this.db
            .selectFrom('product_units')
            .select([
              'id',
              'product_id',
              'name',
              'multiplier',
              'barcode',
              'is_base_unit',
              'is_sale_unit_default',
              'is_purchase_unit_default',
            ])
            .where('product_id', 'in', pagedIds)
            .where(this.tenantPredicate(actor))
            .orderBy('product_id', 'asc')
            .orderBy('is_base_unit', 'desc')
            .orderBy('id', 'asc')
            .execute() as Promise<ProductUnitReadRow[]>,
          hasMinQty
            ? (this.db
                .selectFrom('product_offers')
                .select(['id', 'product_id', 'offer_type', 'value', 'start_date', 'end_date', 'min_qty'])
                .where('is_active', '=', true)
                .where('product_id', 'in', pagedIds)
                .where(this.tenantPredicate(actor))
                .orderBy('id', 'desc')
                .execute() as Promise<ProductOfferReadRow[]>)
            : (this.db
                .selectFrom('product_offers')
                .select(['id', 'product_id', 'offer_type', 'value', 'start_date', 'end_date'])
                .where('is_active', '=', true)
                .where('product_id', 'in', pagedIds)
                .where(this.tenantPredicate(actor))
                .orderBy('id', 'desc')
                .execute() as Promise<ProductOfferReadRow[]>),
          this.db
            .selectFrom('product_customer_prices')
            .select(['id', 'product_id', 'customer_id', 'price'])
            .where('product_id', 'in', pagedIds)
            .where(this.tenantPredicate(actor))
            .orderBy('id', 'desc')
            .execute() as Promise<CustomerPriceReadRow[]>,
        ])
      : [[], [], []];

    const unitsByProduct = new Map<string, Record<string, unknown>[]>();
    for (const unit of units) {
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

    const offersByProduct = this.mapOffersByProduct(offers);

    const pricesByProduct = new Map<string, Record<string, unknown>[]>();
    for (const cp of customerPrices) {
      const key = String(cp.product_id);
      if (!pricesByProduct.has(key)) pricesByProduct.set(key, []);
      pricesByProduct
        .get(key)!
        .push({ id: String(cp.id), customerId: String(cp.customer_id), price: Number(cp.price || 0) });
    }

    return { unitsByProduct, offersByProduct, pricesByProduct };
  }

  mapListProducts(
    pagedBaseRows: ProductRow[],
    context: {
      canViewCost: boolean;
      scopedLocationId: number | null;
      scopedStockByProduct: Map<string, number>;
      activeLocationsByProduct?: Map<string, number[]>;
      categoriesById?: Record<string, string>;
      suppliersById?: Record<string, string>;
      locationsById?: Record<string, string>;
      unitsByProduct: Map<string, Record<string, unknown>[]>;
      offersByProduct: Map<string, Record<string, unknown>[]>;
      pricesByProduct: Map<string, Record<string, unknown>[]>;
      productIdsWithMovements?: Set<number>;
    },
  ): Record<string, unknown>[] {
    return pagedBaseRows.map((product) => {
      const activeLocIds = context.activeLocationsByProduct?.get(String(product.id)) || [];
      const activeLocationNames = activeLocIds
        .map((id) => context.locationsById?.[String(id)])
        .filter(Boolean) as string[];
      const categoryName = context.categoriesById?.[String(product.category_id || '')] || undefined;
      const supplierName = context.suppliersById?.[String(product.supplier_id || '')] || undefined;
      const hasMovements = context.productIdsWithMovements
        ? context.productIdsWithMovements.has(Number(product.id))
        : false;
      const currentStock = this.getListProductStock(product, context.scopedLocationId, context.scopedStockByProduct);

      const mapped: Record<string, unknown> = {
        id: String(product.id),
        name: product.name || '',
        nameEn: product.name_en || '',
        name_en: product.name_en || '',
        barcode: product.barcode || '',
        sku: product.sku || '',
        catalogUpdatedAt: product.catalog_updated_at ? new Date(product.catalog_updated_at).toISOString() : undefined,
        categoryId: product.category_id ? String(product.category_id) : '',
        categoryName,
        supplierId: product.supplier_id ? String(product.supplier_id) : '',
        supplierName,
        itemType:
          product.item_type === 'raw_material'
            ? 'raw_material'
            : product.item_type === 'service'
              ? 'service'
              : 'product',
        itemKind: product.item_kind === 'fashion' ? 'fashion' : 'standard',
        styleCode: product.style_code || '',
        color: product.color || '',
        size: product.size || '',
        binLocation: product.bin_location || '',
        trackSerials: Boolean(product.track_serials),
        costPrice: Number(product.cost_price || 0),
        retailPrice: Number(product.retail_price || 0),
        wholesalePrice: Number(product.wholesale_price || 0),
        halfWholesalePrice: product.half_wholesale_price != null ? Number(product.half_wholesale_price) : null,
        minSellingPrice: product.min_selling_price == null ? null : Number(product.min_selling_price),
        stock: currentStock,
        minStock: Number(product.min_stock_qty || 0),
        isActive: product.is_active !== false,
        is_active: product.is_active !== false,
        hasMovements,
        canDelete: !hasMovements && Math.abs(currentStock) <= 0.0001,
        notes: product.notes || '',
        bomId: product.bom_id ? Number(product.bom_id) : undefined,
        hasBom: !!product.bom_id,
        defaultLocationId: product.default_location_id ? String(product.default_location_id) : undefined,
        defaultLocationName:
          product.default_location_name ||
          context.locationsById?.[String(product.default_location_id || '')] ||
          undefined,
        activeLocationIds: activeLocIds.map(String),
        activeLocationNames,
        units: context.unitsByProduct.get(String(product.id)) || [
          {
            id: `base-${product.id}`,
            name: 'قطعة',
            multiplier: 1,
            barcode: product.barcode || '',
            isBaseUnit: true,
            isSaleUnit: true,
            isPurchaseUnit: true,
          },
        ],
        offers: context.offersByProduct.get(String(product.id)) || [],
        customerPrices: context.pricesByProduct.get(String(product.id)) || [],
        icon:
          (product as any).metadata?.icon ||
          (typeof (product as any).metadata === 'string'
            ? (() => {
                try {
                  return JSON.parse((product as any).metadata)?.icon;
                } catch {
                  return null;
                }
              })()
            : null) ||
          null,
        imageUrl:
          (product as any).metadata?.imageUrl ||
          (typeof (product as any).metadata === 'string'
            ? (() => {
                try {
                  return JSON.parse((product as any).metadata)?.imageUrl;
                } catch {
                  return null;
                }
              })()
            : null) ||
          null,
        metadata: (product as any).metadata || null,
      };
      if (!context.canViewCost) delete mapped.costPrice;
      return mapped;
    });
  }

  private buildListSummary(
    filteredBaseRows: ProductRow[],
    context: {
      canViewCost: boolean;
      scopedLocationId: number | null;
      scopedStockByProduct: Map<string, number>;
      offerCountByProduct: Map<string, number>;
      customerPriceCountByProduct: Map<string, number>;
    },
  ) {
    return {
      totalProducts: filteredBaseRows.length,
      lowStockCount: filteredBaseRows.filter(
        (row) =>
          this.getListProductStock(row, context.scopedLocationId, context.scopedStockByProduct) <=
          Number(row.min_stock_qty || 0),
      ).length,
      outOfStockCount: filteredBaseRows.filter(
        (row) => this.getListProductStock(row, context.scopedLocationId, context.scopedStockByProduct) <= 0,
      ).length,
      inventoryCost: context.canViewCost
        ? filteredBaseRows.reduce(
            (sum, row) =>
              sum +
              this.getListProductStock(row, context.scopedLocationId, context.scopedStockByProduct) *
                Number(row.cost_price || 0),
            0,
          )
        : null,
      inventorySaleValue: filteredBaseRows.reduce(
        (sum, row) =>
          sum +
          this.getListProductStock(row, context.scopedLocationId, context.scopedStockByProduct) *
            Number(row.retail_price || 0),
        0,
      ),
      activeOffersCount: filteredBaseRows.reduce(
        (sum, row) => sum + Number(context.offerCountByProduct.get(String(row.id)) || 0),
        0,
      ),
      customerPriceCount: filteredBaseRows.reduce(
        (sum, row) => sum + Number(context.customerPriceCountByProduct.get(String(row.id)) || 0),
        0,
      ),
    };
  }
}
