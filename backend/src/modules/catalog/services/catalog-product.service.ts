import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, Transaction, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { NormalizedFashionVariant, NormalizedProductOffer, NormalizedUpsertProduct, UpsertProductDto, SaveFashionGroupDto } from '../dto/upsert-product.dto';
import { InventoryScopeService } from '../../inventory/services/inventory-scope.service';
import { normalizeArabicInput, normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { buildPosCatalogVersion } from '../engines/pos-catalog-version.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { assertFashionExpectedStock, assertFashionRemovedStockSafe, fashionLocationAccessMode } from '../engines/fashion-stock-safety.engine';
import { stockMovementTotal } from '../engines/stock-movement-total.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { StorefrontMediaService } from '../../storefront/storefront-media.service';
import { availableAcrossLocations } from '../../../common/engines/branch-sellable-locations.engine';

type ProductRow = {
  id: number;
  name: string;
  name_en?: string | null;
  barcode: string | null;
  sku?: string | null;
  catalog_updated_at?: Date | string | null;
  item_type?: 'product' | 'raw_material' | 'service';
  item_kind: 'standard' | 'fashion' | null;
  style_code: string | null;
  color: string | null;
  size: string | null;
  bin_location: string | null;
  category_id: number | null;
  supplier_id: number | null;
  cost_price: string | number;
  retail_price: string | number;
  wholesale_price: string | number;
  credit_price?: string | number | null;
  consumer_price?: string | number | null;
  min_selling_price?: string | number | null;
  stock_qty: string | number;
  min_stock_qty: string | number;
  bom_id?: number | null;
  default_location_id?: number | null;
  default_location_name?: string | null;
  notes: string;
  track_serials?: boolean | null;
  metadata?: string | Record<string, any> | null;
  is_active?: boolean | null;
  calories?: number | null;
  allergens?: any;
  is_spicy?: boolean | null;
  is_vegetarian?: boolean | null;
  is_gluten_free?: boolean | null;
};

type ProductWriteExecutor = Kysely<Database> | Transaction<Database>;
type ProductOfferColumnCapabilities = { hasMinQty: boolean; hasAdvancedPromotions: boolean };
type ProductOfferReadRow = {
  id: number;
  product_id: number;
  offer_type: string;
  value: string | number;
  start_date: string | null;
  end_date: string | null;
  min_qty?: string | number | null;
  bogo_buy_qty?: string | number | null;
  bogo_get_qty?: string | number | null;
  bogo_discount_percent?: string | number | null;
  happy_hour_start?: string | null;
  happy_hour_end?: string | null;
  days_of_week?: string | null;
};

type ProductCountRow = {
  product_id: number;
  count: string | number | bigint;
};

type ProductUnitSearchRow = {
  product_id: number;
  name: string | null;
  barcode: string | null;
};

type ProductUnitReadRow = {
  id: number;
  product_id: number;
  name: string;
  multiplier: string | number;
  barcode: string | null;
  is_base_unit: boolean;
  is_sale_unit_default: boolean;
  is_purchase_unit_default: boolean;
};

type PosProductLookupRow = Pick<ProductRow, 'id' | 'name' | 'name_en' | 'barcode' | 'sku' | 'item_type' | 'item_kind' | 'style_code' | 'color' | 'size' | 'retail_price' | 'wholesale_price' | 'credit_price' | 'consumer_price' | 'min_selling_price' | 'stock_qty' | 'min_stock_qty' | 'bom_id' | 'category_id' | 'track_serials' | 'metadata'> & {
  calories?: number | null;
  allergens?: any;
  is_spicy?: boolean | null;
  is_vegetarian?: boolean | null;
  is_gluten_free?: boolean | null;
  matched_unit_id?: number | null;
  matched_unit_name?: string | null;
  matched_unit_multiplier?: string | number | null;
  matched_unit_barcode?: string | null;
  matched_serial_number?: string | null;
};

type CustomerPriceReadRow = {
  id: number;
  product_id: number;
  customer_id: number;
  price: string | number;
};

@Injectable()
export class CatalogProductService {
  private productOfferColumnCapabilitiesPromise?: Promise<ProductOfferColumnCapabilities>;

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>, private readonly audit: AuditService,
    private readonly inventoryScope: InventoryScopeService,
    @Optional() private readonly accountingPosting?: AccountingPostingService,
    @Optional() private readonly accountingFoundation?: AccountingTenantFoundationService,
    @Optional() private readonly mediaService?: StorefrontMediaService) {}

  private async ensureOpeningStockAccounts(actor: AuthContext): Promise<void> {
    if (!this.accountingPosting || !this.accountingFoundation) {
      throw new AppError('Accounting services are required for opening stock', 'OPENING_STOCK_LEDGER_UNAVAILABLE', 500);
    }
    await this.accountingFoundation.ensureForAuth(this.db, actor);
  }

  // INV-CATALOG-STOCK-TOTALS-BOOK-DIGITS: book digits resolved on the
  // caller's own handle (the open transaction inside write flows),
  // fail closed on a base-currency/rate mismatch via tenantBaseCurrency.
  private async bookDigits(executor: ProductWriteExecutor, actor: AuthContext): Promise<MoneyDigits> {
    return currencyMoneyDigits(await tenantBaseCurrency(executor, this.tenantId(actor)));
  }

  private async postOpeningStock(trx: ProductWriteExecutor, productId: number, qty: number, unitCost: number,
    locationId: number | null, actor: AuthContext): Promise<void> {
    const amount = stockMovementTotal(qty, unitCost, await this.bookDigits(trx, actor));
    if (amount <= 0) return;
    const accounts = await trx.selectFrom('accounting_accounts').select(['id', 'code'])
      .where('tenant_id', '=', this.tenantId(actor)).where('code', 'in', ['1140', '3100'])
      .where('is_active', '=', true).execute();
    const byCode = new Map(accounts.map((account) => [account.code, Number(account.id)]));
    if (!byCode.get('1140') || !byCode.get('3100')) {
      throw new AppError('Inventory or opening capital account is unavailable', 'OPENING_STOCK_ACCOUNT_MISSING', 422);
    }
    await this.accountingPosting!.postDomainJournal(trx, {
      sourceType: 'catalog_opening_stock', sourceId: productId,
      tenantId: this.tenantId(actor), accountId: this.accountId(actor), entryDate: new Date(),
      description: `رصيد افتتاحي للصنف ${productId}`, createdBy: actor.userId,
      lines: [
        { accountId: byCode.get('1140')!, debit: amount, credit: 0, description: 'إثبات مخزون افتتاحي',
          partnerType: 'none', partnerId: null, branchId: null, locationId },
        { accountId: byCode.get('3100')!, debit: 0, credit: amount, description: 'مقابل المخزون الافتتاحي ضمن رأس المال',
          partnerType: 'none', partnerId: null, branchId: null, locationId },
      ],
    });
  }

  private scope(actor: AuthContext) {
    return requireTenantScope(actor);
  }

  private canViewCostPrice(actor: AuthContext): boolean {
    if (actor.role === 'super_admin' || actor.role === 'admin') return true;
    const perms = actor.permissions || [];
    return perms.includes('canViewProfit') || perms.includes('purchases') || perms.includes('inventory') || perms.includes('canViewCost');
  }

  private hasPermission(actor: AuthContext, permission: string): boolean {
    if (permission === 'canViewCost') {
      return this.canViewCostPrice(actor);
    }
    return actor.role === 'super_admin' || Boolean(actor.permissions?.includes(permission));
  }

  private tenantId(actor: AuthContext): string {
    return this.scope(actor).tenantId;
  }

  private accountId(actor: AuthContext): string {
    return this.scope(actor).accountId;
  }

  private tenantFields(actor: AuthContext) {
    return { tenant_id: this.tenantId(actor), account_id: this.accountId(actor) };
  }

  private tenantPredicate(actor: AuthContext, alias?: string) {
    const tenantId = this.tenantId(actor);
    const accountId = this.accountId(actor);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId} AND (${sql.ref(`${alias}.account_id`)} = ${accountId} OR ${sql.ref(`${alias}.account_id`)} = ${tenantId} OR ${sql.ref(`${alias}.account_id`)} IS NULL)`
      : sql<boolean>`tenant_id = ${tenantId} AND (account_id = ${accountId} OR account_id = ${tenantId} OR account_id IS NULL)`;
  }

  // PERF-2: for id lists that can span the whole tenant catalog (listProducts passes every active
  // product). `IN (?, ?, ...)` sends one bind parameter per id — slow to plan, and Postgres rejects a
  // statement over 65,535 parameters, i.e. a large catalog would crash the page. One array parameter.
  private productIdAny(column: string, ids: number[]) {
    return sql<boolean>`${sql.ref(column)} = ANY(${ids.map((id) => Number(id))}::bigint[])`;
  }

  private normalizeDateOnly(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
    const text = String(value).trim();
    if (!text) return '';
    const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
  }

  private async getProductOfferColumnCapabilities(): Promise<ProductOfferColumnCapabilities> {
    if (!this.productOfferColumnCapabilitiesPromise) {
      this.productOfferColumnCapabilitiesPromise = sql<{ column_name: string }>`
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'product_offers'
        `
        .execute(this.db)
        .then((result) => {
          const columns = new Set(result.rows.map((row) => String(row.column_name || '').toLowerCase()));
          return {
            hasMinQty: columns.has('min_qty'),
            hasAdvancedPromotions: columns.has('bogo_buy_qty'),
          };
        })
        .catch(() => ({ hasMinQty: false, hasAdvancedPromotions: false }));
    }
    return this.productOfferColumnCapabilitiesPromise;
  }

  private ensureAdvancedOffersSupported(payload: NormalizedUpsertProduct, capabilities: ProductOfferColumnCapabilities): void {
    const requiresAdvancedOfferSchema = payload.offers.some((offer) => offer.type === 'price' || Number(offer.minQty || 1) > 1);
    if (requiresAdvancedOfferSchema && !capabilities.hasMinQty) {
      throw new AppError(
        'Advanced product offers require the latest database migration. Run backend migrations first, then retry saving offers.',
        'PRODUCT_OFFERS_MIGRATION_REQUIRED',
        400,
      );
    }
  }

  async getNextStyleCode(actor: AuthContext): Promise<{ styleCode: string }> {
    const result = await this.db
      .selectFrom('products')
      .select(['style_code'])
      .where('style_code', 'is not', null)
      .where(this.tenantPredicate(actor))
      .execute();
      
    let maxNumeric = 1000;
    for (const row of result) {
      if (!row.style_code) continue;
      const parsed = parseInt(row.style_code.trim(), 10);
      if (!isNaN(parsed) && parsed.toString() === row.style_code.trim()) {
        if (parsed > maxNumeric) {
          maxNumeric = parsed;
        }
      }
    }
    
    return { styleCode: (maxNumeric + 1).toString() };
  }

  async allocateStyleCode(actor: AuthContext): Promise<{ styleCode: string }> {
    return this.db.transaction().execute(async (trx) => {
      const { tenantId } = requireTenantScope(actor);
      let counter = await trx
        .selectFrom('style_code_counters')
        .select('next_value')
        .where('tenant_id', '=', tenantId)
        .where('scope', '=', 'fashion')
        .forUpdate()
        .executeTakeFirst();

      if (!counter) {
        const maxResult = await trx
          .selectFrom('products')
          .select(['style_code'])
          .where('style_code', 'is not', null)
          .where(this.tenantPredicate(actor))
          .execute();
          
        let maxNumeric = 1000;
        for (const row of maxResult) {
          if (!row.style_code) continue;
          const parsed = parseInt(row.style_code.trim(), 10);
          // Exclude legacy timestamp-like codes: the counter column is an INTEGER.
          if (Number.isSafeInteger(parsed) && parsed <= 2_000_000_000 && parsed.toString() === row.style_code.trim()) {
            if (parsed > maxNumeric) maxNumeric = parsed;
          }
        }
        
        const seedValue = maxNumeric + 1;
        await trx
          .insertInto('style_code_counters')
          .values({
            tenant_id: tenantId,
            scope: 'fashion',
            next_value: seedValue
          })
          .onConflict((oc) => oc.columns(['tenant_id', 'scope']).doNothing())
          .execute();
          
        counter = await trx
          .selectFrom('style_code_counters')
          .select('next_value')
          .where('tenant_id', '=', tenantId)
          .where('scope', '=', 'fashion')
          .forUpdate()
          .executeTakeFirst();
      }

      let allocated = Math.max(1001, Number(counter!.next_value));
      // Manual product codes can be created after the counter was seeded.
      // Never suggest a style code that is already in use by this tenant.
      while (allocated <= 2_000_000_000) {
        const taken = await trx.selectFrom('products').select('id')
          .where('style_code', '=', String(allocated))
          .where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
        if (!taken) break;
        allocated++;
      }
      if (allocated > 2_000_000_000) throw new AppError('نفدت أكواد الموديلات المتاحة', 'STYLE_CODE_EXHAUSTED', 409);

      await trx
        .updateTable('style_code_counters')
        .set({ next_value: allocated + 1 })
        .where('tenant_id', '=', tenantId)
        .where('scope', '=', 'fashion')
        .execute();
        
      return { styleCode: allocated.toString() };
    });
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
      .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'products.id').onRef('b.tenant_id', '=', 'products.tenant_id').on('b.is_active', '=', true))
      .leftJoin('stock_locations as sl', (join) => join.onRef('sl.id', '=', 'products.default_location_id').on(this.tenantPredicate(actor, 'sl')))
      .select(['products.id', 'products.name', 'products.name_en', 'products.barcode', 'products.sku', 'products.catalog_updated_at', 'products.item_type', 'products.item_kind', 'products.style_code', 'products.color', 'products.size', 'products.bin_location', 'products.track_serials', 'products.category_id', 'products.supplier_id', 'products.cost_price', 'products.retail_price', 'products.wholesale_price', 'products.credit_price', 'products.consumer_price', 'products.min_selling_price', 'products.stock_qty', 'products.min_stock_qty', 'sl.id as default_location_id', 'products.notes', 'products.metadata', 'b.id as bom_id', 'sl.name as default_location_name', 'products.is_active', 'products.calories', 'products.allergens', 'products.is_spicy', 'products.is_vegetarian', 'products.is_gluten_free'])
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
              eb.selectFrom('products').select('products.id')
                .where('products.is_active', '=', isActive)
                .where(this.tenantPredicate(actor, 'products')),
            )
            .executeTakeFirstOrThrow().then((row) => Number(row.n || 0)),
          this.db
            .selectFrom('product_customer_prices')
            .select(sql<number>`count(*)`.as('n'))
            .where(this.tenantPredicate(actor))
            .where('product_id', 'in', (eb) =>
              eb.selectFrom('products').select('products.id')
                .where('products.is_active', '=', isActive)
                .where(this.tenantPredicate(actor, 'products')),
            )
            .executeTakeFirstOrThrow().then((row) => Number(row.n || 0)),
        ]);

    const [pagedBaseRows, categories, suppliers, locations] = await Promise.all([
      this.listProductsBaseQuery(actor, view).orderBy('id', 'desc').limit(pageSize).offset(start).execute() as Promise<ProductRow[]>,
      this.db.selectFrom('product_categories').select(['id', 'name']).where('is_active', '=', true).where(this.tenantPredicate(actor)).execute(),
      this.db.selectFrom('suppliers').select(['id', 'name']).where('is_active', '=', true).where(this.tenantPredicate(actor)).execute(),
      this.db.selectFrom('stock_locations').select(['id', 'name']).where('is_active', '=', true).where(this.tenantPredicate(actor)).execute(),
    ]);
    const pagedIds = pagedBaseRows.map((row) => Number(row.id));
    const scopedStockResult = brief
      ? { stock: new Map<string, number>(pagedBaseRows.map((p) => [String(p.id), Number(p.stock_qty || 0)])), locations: new Map<string, number[]>() }
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
    const { page, pageSize, q, view, requestedLocationId, categoryId, supplierId, brief, sortBy, sortDir } = this.parseListProductsQuery(query);
    const canViewCost = this.canViewCostPrice(actor);
    const offerCapabilities = await this.getProductOfferColumnCapabilities();
    const scopedLocation = requestedLocationId > 0 && actor ? await this.inventoryScope.assertLocationScope(requestedLocationId, actor).catch(() => null) : null;

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
      !q && !categoryId && !supplierId && !scopedLocation &&
      (view === 'all' || view === 'archived') &&
      !groupedFashion &&
      effectiveSortBy === 'id' && effectiveSortDir === 'desc';
    if (canPageInSql) {
      return this.listProductsPageInSql({ page, pageSize, view, brief, canViewCost, offerCapabilities, actor });
    }

    const [products, categories, suppliers, locations] = await Promise.all([
      this.listProductsBaseQuery(actor, view).orderBy('id', 'desc').execute() as Promise<ProductRow[]>,
      this.db.selectFrom('product_categories').select(['id', 'name']).where('is_active', '=', true).where(this.tenantPredicate(actor)).execute(),
      this.db.selectFrom('suppliers').select(['id', 'name']).where('is_active', '=', true).where(this.tenantPredicate(actor)).execute(),
      this.db.selectFrom('stock_locations').select(['id', 'name']).where('is_active', '=', true).where(this.tenantPredicate(actor)).execute(),
    ]);

    const productIds = products.map((product) => Number(product.id));
    const scopedStockResult = (brief && !scopedLocation && !q)
      ? { stock: new Map<string, number>(products.map((p) => [String(p.id), Number(p.stock_qty || 0)])), locations: new Map<string, number[]>() }
      : await this.resolveScopedStockByProduct(productIds, scopedLocation ? [scopedLocation.id] : [], products, actor);
    const listContext = await this.buildListProductsContext(productIds, q, categories, suppliers, locations, actor, { brief, view });
    const filteredBaseRows = this.filterListProducts(products, {
      q,
      view,
      scopedLocationId: scopedLocation?.id || null,
      scopedStockByProduct: scopedStockResult.stock,
      activeLocationsByProduct: scopedStockResult.locations,
      categoryId,
      supplierId,
      ...listContext,
    });

    if (effectiveSortBy !== 'id' || effectiveSortDir !== 'desc') {
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
        const key = row.item_kind === 'fashion' && row.style_code
          ? `style:${row.style_code}` : `product:${row.id}`;
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
      view: String(query.view || 'all'),
      requestedLocationId: Number(query.locationId || 0),
      categoryId: query.categoryId ? Number(query.categoryId) : undefined,
      supplierId: query.supplierId ? Number(query.supplierId) : undefined,
      brief: String(query.brief || '').toLowerCase() === 'true' || query.brief === true,
      sortBy: rawSortBy,
      sortDir: (rawSortDir === 'asc' || rawSortDir === 'desc') ? rawSortDir : undefined,
    };
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
    const { q, barcode, limit, requestedLocationId, requestedBranchId, view, isFullCatalog } = this.parsePosProductLookupQuery(query);
    const offerCapabilities = await this.getProductOfferColumnCapabilities();
    const scopedLocation = requestedLocationId > 0 ? await this.inventoryScope.assertLocationScope(requestedLocationId, actor).catch(() => null) : null;
    const productRows = barcode
      ? await this.findPosProductsByBarcode(barcode, limit, actor)
      : await this.searchPosProducts(q, limit, view === 'offers' ? 'offers' : 'all', actor);

    const uniqueRows = this.uniquePosProductRows(productRows).slice(0, limit);
    const productIds = uniqueRows.map((product) => Number(product.id));

    let eligibleLocationIds: number[] = scopedLocation ? [scopedLocation.id] : [];
    if (requestedBranchId > 0) {
      const branch = await this.db.selectFrom('branches').select(['default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock']).where('id', '=', requestedBranchId).where(this.tenantPredicate(actor)).executeTakeFirst();
      if (branch && branch.sales_stock_mode === 'all_operational_locations') {
        const allLocs = await this.db.selectFrom('stock_locations')
          .select(['id', 'location_type', 'branch_id'])
          .where(this.tenantPredicate(actor))
          .where('is_active', '=', true)
          .where('location_type', 'not in', ['damaged', 'in_transit'])
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
      view,
      isFullCatalog,
    };
  }

  private async findPosProductsByBarcode(barcode: string, limit: number, actor: AuthContext): Promise<PosProductLookupRow[]> {
    if (!barcode) return [];
    // INV-POS-BARCODE-DASH: barcode lookup is case-insensitive. The POS
    // frontend matches barcodes case-insensitively (trim + lowercase) and a
    // cashier may type a dashed code in lowercase while the stored value is
    // uppercase (or scan a supplier label whose case differs from the stored
    // value). A case-sensitive `=` missed those rows entirely, while
    // digits-only barcodes always worked because digits have no case.
    const lookupCode = barcode.trim().toLowerCase();
    let productMatches = await this.db
      .selectFrom('products as p')
      .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
      .select(['p.id', 'p.name', 'p.name_en', 'p.barcode', 'p.sku', 'p.item_type', 'p.item_kind', 'p.style_code', 'p.color', 'p.size', 'p.retail_price', 'p.wholesale_price', 'p.credit_price', 'p.consumer_price', 'p.stock_qty', 'p.min_stock_qty', 'b.id as bom_id', 'p.category_id', 'p.track_serials', 'p.metadata'])
      .where('p.is_active', '=', true)
      .where(sql<boolean>`LOWER(p.barcode) = ${lookupCode}`)
      .where(this.tenantPredicate(actor, 'p'))
      .orderBy('p.id', 'asc')
      .limit(limit)
      .execute() as PosProductLookupRow[];

    // Prefer the physical barcode; a SKU is a fallback, not a competing code.
    // A separate exact query preserves barcode precedence and the existing POS contract.
    if (!productMatches.length) {
      productMatches = await this.db
        .selectFrom('products as p')
        .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
        .select(['p.id', 'p.name', 'p.name_en', 'p.barcode', 'p.sku', 'p.item_type', 'p.item_kind',
          'p.style_code', 'p.color', 'p.size', 'p.retail_price', 'p.wholesale_price',
          'p.credit_price', 'p.consumer_price', 'p.stock_qty', 'p.min_stock_qty',
          'b.id as bom_id', 'p.category_id', 'p.track_serials', 'p.metadata'])
        .where('p.is_active', '=', true)
        .where(sql<boolean>`LOWER(p.sku) = ${lookupCode}`)
        .where(this.tenantPredicate(actor, 'p'))
        .orderBy('p.id', 'asc').limit(limit).execute() as PosProductLookupRow[];
    }

    const seenProductIds = productMatches.map((product) => Number(product.id));
    let remaining = limit - productMatches.length;

    let serialMatches: PosProductLookupRow[] = [];
    if (remaining > 0) {
      const serialRows = await this.db
        .selectFrom('product_serials as ps')
        .innerJoin('products as p', 'p.id', 'ps.product_id')
        .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
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
          'p.credit_price',
          'p.consumer_price',
          'p.min_selling_price',
          'p.stock_qty',
          'p.min_stock_qty',
          'b.id as bom_id',
          'p.category_id',
          'p.track_serials',
          'p.metadata',
          'ps.serial_number as matched_serial_number',
        ])
        .where('p.is_active', '=', true)
        .where('ps.status', '=', 'in_stock')
        .where(this.tenantPredicate(actor, 'ps'))
        .where((eb) =>
          eb.or([
            sql<boolean>`LOWER(ps.serial_number) = ${lookupCode}`,
            sql<boolean>`LOWER(ps.imei_2) = ${lookupCode}`,
          ]),
        )
        .limit(remaining)
        .execute() as PosProductLookupRow[];
      serialMatches = serialRows;
      for (const sm of serialMatches) seenProductIds.push(Number(sm.id));
      remaining = limit - productMatches.length - serialMatches.length;
    }

    if (remaining <= 0) return [...productMatches, ...serialMatches];

    let unitQuery = this.db
      .selectFrom('product_units as pu')
      .innerJoin('products as p', 'p.id', 'pu.product_id')
      .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
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
        'p.credit_price',
        'p.consumer_price',
        'p.min_selling_price',
        'p.stock_qty',
        'p.min_stock_qty',
        'b.id as bom_id',
        'p.category_id',
        'p.track_serials',
        'p.metadata',
        'pu.id as matched_unit_id',
        'pu.name as matched_unit_name',
        'pu.multiplier as matched_unit_multiplier',
        'pu.barcode as matched_unit_barcode',
      ])
      .where('p.is_active', '=', true)
      .where(sql<boolean>`LOWER(pu.barcode) = ${lookupCode}`)
      .where(this.tenantPredicate(actor, 'p'));

    if (seenProductIds.length) unitQuery = unitQuery.where('p.id', 'not in', seenProductIds);

    const unitMatches = await unitQuery
      .orderBy('p.id', 'asc')
      .limit(remaining)
      .execute() as PosProductLookupRow[];

    return [...productMatches, ...serialMatches, ...unitMatches];
  }

  private async searchPosProducts(q: string, limit: number, view: 'all' | 'offers' = 'all', actor: AuthContext): Promise<PosProductLookupRow[]> {
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

    return productQuery
      .orderBy('p.name', 'asc')
      .orderBy('p.id', 'asc')
      .limit(limit)
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

  private normalizeUnitName(name: unknown): string {
    const text = String(name || '').trim();
    if (!text) return 'قطعة';
    const lower = text.toLowerCase();
    if (['piece', 'pieces', 'pcs', 'pc', 'item', 'items', 'unit', 'units', 'قطعه', 'حبة', 'حبه'].includes(lower)) return 'قطعة';
    if (lower === 'kg' || lower === 'كجم' || lower === 'كيلو' || lower === 'كيلوجرام') return 'kg';
    if (lower === 'g' || lower === 'gm' || lower === 'gram' || lower === 'جرام') return 'g';
    if (['box', 'boxes', 'carton', 'cartons', 'كرتونه'].includes(lower)) return 'كرتونة';
    if (['packet', 'pack', 'packs'].includes(lower)) return 'باكت';
    if (['bottle', 'bottles'].includes(lower)) return 'زجاجة';
    if (['can', 'cans'].includes(lower)) return 'علبة';
    if (['liter', 'liters', 'ltr', 'l'].includes(lower)) return 'لتر';
    if (['meter', 'meters', 'm'].includes(lower)) return 'متر';
    if (['service', 'services', 'خدمه'].includes(lower)) return 'خدمة';
    return text;
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

  private mapOffersByProduct(offers: ProductOfferReadRow[]): Map<string, Record<string, unknown>[]> {
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
        from: this.normalizeDateOnly(offer.start_date),
        to: this.normalizeDateOnly(offer.end_date),
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

  private async resolveScopedStockByProduct(productIds: number[], eligibleLocationIds: number[], products: Array<Pick<ProductRow, 'id' | 'stock_qty'>>, actor: AuthContext, isFullCatalog = false): Promise<{ stock: Map<string, number>, locations: Map<string, number[]> }> {
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
        ? this.db
            .selectFrom('product_units')
            .select(['product_id', 'name', 'barcode'])
            .where(this.productIdAny('product_id', productIds))
            .where(this.tenantPredicate(actor))
            .orderBy('product_id', 'asc')
            .execute() as Promise<ProductUnitSearchRow[]>
        : Promise.resolve([]),
      needCounts && productIds.length
        ? this.db
            .selectFrom('product_offers')
            .select(['product_id', (eb) => eb.fn.countAll<number>().as('count')])
            .where('is_active', '=', true)
            .where(this.productIdAny('product_id', productIds))
            .where(this.tenantPredicate(actor))
            .groupBy('product_id')
            .execute() as Promise<ProductCountRow[]>
        : Promise.resolve([]),
      needCounts && productIds.length
        ? this.db
            .selectFrom('product_customer_prices')
            .select(['product_id', (eb) => eb.fn.countAll<number>().as('count')])
            .where(this.productIdAny('product_id', productIds))
            .where(this.tenantPredicate(actor))
            .groupBy('product_id')
            .execute() as Promise<ProductCountRow[]>
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
    for (const row of customerPriceCountRows) customerPriceCountByProduct.set(String(row.product_id), Number(row.count || 0));

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
        const inLocation = activeLocIds.includes(context.scopedLocationId) || Number(product.default_location_id) === context.scopedLocationId;
        if (!inLocation) return false;
      }

      if (context.view !== 'all') {
        if (context.view === 'low' && !(stock <= minStock)) return false;
        if (context.view === 'out' && !(stock <= 0)) return false;
        if (context.view === 'offers' && offerCount <= 0 && !(product as any).bom_id) return false;
        if (context.view === 'special' && customerPriceCount <= 0) return false;
      }

      if (!context.q) return true;
      const activeLocIds = context.activeLocationsByProduct?.get(key) || [];
      const activeLocNames = activeLocIds.map((id) => context.locationsById[String(id)] || '').filter(Boolean);
      const defaultLocName = product.default_location_name || context.locationsById[String(product.default_location_id || '')] || '';

      const haystack = [
        String(product.name || ''),
        String(product.name_en || ''),
        String(product.barcode || ''),
        context.categoriesById[String(product.category_id || '')] || '',
        context.suppliersById[String(product.supplier_id || '')] || '',
        defaultLocName,
        ...activeLocNames,
        String(product.notes || ''),
        String(product.style_code || ''),
        String(product.sku || ''),
        String(product.color || ''),
        String(product.size || ''),
        ...(context.unitSearchValuesByProduct.get(key) || []),
      ].join(' ');
      return normalizeArabicSearch(haystack).includes(context.q);
    });
  }

  private async fetchListProductRelations(pagedIds: number[], hasMinQty: boolean, actor: AuthContext) {
    const [units, offers, customerPrices] = pagedIds.length
      ? await Promise.all([
          this.db
            .selectFrom('product_units')
            .select(['id', 'product_id', 'name', 'multiplier', 'barcode', 'is_base_unit', 'is_sale_unit_default', 'is_purchase_unit_default'])
            .where('product_id', 'in', pagedIds)
            .where(this.tenantPredicate(actor))
            .orderBy('product_id', 'asc')
            .orderBy('is_base_unit', 'desc')
            .orderBy('id', 'asc')
            .execute() as Promise<ProductUnitReadRow[]>,
          hasMinQty
            ? this.db
                .selectFrom('product_offers')
                .select(['id', 'product_id', 'offer_type', 'value', 'start_date', 'end_date', 'min_qty'])
                .where('is_active', '=', true)
                .where('product_id', 'in', pagedIds)
                .where(this.tenantPredicate(actor))
                .orderBy('id', 'desc')
                .execute() as Promise<ProductOfferReadRow[]>
            : this.db
                .selectFrom('product_offers')
                .select(['id', 'product_id', 'offer_type', 'value', 'start_date', 'end_date'])
                .where('is_active', '=', true)
                .where('product_id', 'in', pagedIds)
                .where(this.tenantPredicate(actor))
                .orderBy('id', 'desc')
                .execute() as Promise<ProductOfferReadRow[]>,
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
      pricesByProduct.get(key)!.push({ id: String(cp.id), customerId: String(cp.customer_id), price: Number(cp.price || 0) });
    }

    return { unitsByProduct, offersByProduct, pricesByProduct };
  }

  private mapListProducts(
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
      const activeLocationNames = activeLocIds.map((id) => context.locationsById?.[String(id)]).filter(Boolean) as string[];
      const categoryName = context.categoriesById?.[String(product.category_id || '')] || undefined;
      const supplierName = context.suppliersById?.[String(product.supplier_id || '')] || undefined;
      const hasMovements = context.productIdsWithMovements ? context.productIdsWithMovements.has(Number(product.id)) : false;
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
        itemType: product.item_type === 'raw_material' ? 'raw_material' : product.item_type === 'service' ? 'service' : 'product',
        itemKind: product.item_kind === 'fashion' ? 'fashion' : 'standard',
        styleCode: product.style_code || '',
        color: product.color || '',
        size: product.size || '',
        binLocation: product.bin_location || '',
        trackSerials: Boolean(product.track_serials),
        costPrice: Number(product.cost_price || 0),
        retailPrice: Number(product.retail_price || 0),
        wholesalePrice: Number(product.wholesale_price || 0),
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
        defaultLocationName: product.default_location_name || context.locationsById?.[String(product.default_location_id || '')] || undefined,
        activeLocationIds: activeLocIds.map(String),
        activeLocationNames,
        units: context.unitsByProduct.get(String(product.id)) || [{ id: `base-${product.id}`, name: 'قطعة', multiplier: 1, barcode: product.barcode || '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
        offers: context.offersByProduct.get(String(product.id)) || [],
        customerPrices: context.pricesByProduct.get(String(product.id)) || [],
        icon: (product as any).metadata?.icon || (typeof (product as any).metadata === 'string' ? (() => { try { return JSON.parse((product as any).metadata)?.icon; } catch { return null; } })() : null) || null,
        imageUrl: (product as any).metadata?.imageUrl || (typeof (product as any).metadata === 'string' ? (() => { try { return JSON.parse((product as any).metadata)?.imageUrl; } catch { return null; } })() : null) || null,
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
      lowStockCount: filteredBaseRows.filter((row) => this.getListProductStock(row, context.scopedLocationId, context.scopedStockByProduct) <= Number(row.min_stock_qty || 0)).length,
      outOfStockCount: filteredBaseRows.filter((row) => this.getListProductStock(row, context.scopedLocationId, context.scopedStockByProduct) <= 0).length,
      inventoryCost: context.canViewCost
        ? filteredBaseRows.reduce((sum, row) => sum + (this.getListProductStock(row, context.scopedLocationId, context.scopedStockByProduct) * Number(row.cost_price || 0)), 0)
        : null,
      inventorySaleValue: filteredBaseRows.reduce((sum, row) => sum + (this.getListProductStock(row, context.scopedLocationId, context.scopedStockByProduct) * Number(row.retail_price || 0)), 0),
      activeOffersCount: filteredBaseRows.reduce((sum, row) => sum + Number(context.offerCountByProduct.get(String(row.id)) || 0), 0),
      customerPriceCount: filteredBaseRows.reduce((sum, row) => sum + Number(context.customerPriceCountByProduct.get(String(row.id)) || 0), 0),
    };
  }

  private getListProductStock(product: Pick<ProductRow, 'id' | 'stock_qty'>, scopedLocationId: number | null, scopedStockByProduct: Map<string, number>) {
    if (!scopedLocationId) return Number(product.stock_qty || 0);
    return Number(scopedStockByProduct.get(String(product.id)) || 0);
  }
  private normalizeProductPayload(payload: UpsertProductDto): NormalizedUpsertProduct {
    const units = payload.units?.length
      ? payload.units
      : [{ name: 'قطعة', multiplier: 1, barcode: payload.barcode || '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }];

    const normalizedUnits = units.map((unit, index) => ({
      name: this.normalizeUnitName(unit.name) || (index === 0 ? 'قطعة' : 'وحدة'),
      multiplier: Number(unit.multiplier || 1),
      barcode: String(unit.barcode || '').trim(),
      isBaseUnit: Boolean(unit.isBaseUnit),
      isSaleUnit: Boolean(unit.isSaleUnit),
      isPurchaseUnit: Boolean(unit.isPurchaseUnit),
    }));

    if (!normalizedUnits.some((unit) => unit.isBaseUnit)) {
      normalizedUnits[0].isBaseUnit = true;
      normalizedUnits[0].multiplier = 1;
    }

    const baseUnits = normalizedUnits.filter((unit) => unit.isBaseUnit);
    if (baseUnits.length !== 1) throw new AppError('Product must have exactly one base unit', 'INVALID_UNITS', 400);
    baseUnits[0].multiplier = 1;

    for (const unit of normalizedUnits) {
      if (!unit.isBaseUnit && Number(unit.multiplier || 0) <= 1) {
        throw new AppError(`مضاعف الوحدة "${unit.name}" يجب أن يكون أكبر من 1 مقارنة بالوحدة الأساسية`, 'INVALID_UNITS', 400);
      }
    }
    if (!normalizedUnits.some((unit) => unit.isSaleUnit)) baseUnits[0].isSaleUnit = true;
    if (!normalizedUnits.some((unit) => unit.isPurchaseUnit)) baseUnits[0].isPurchaseUnit = true;
    if (normalizedUnits.filter((unit) => unit.isSaleUnit).length !== 1) throw new AppError('Choose exactly one default sale unit', 'INVALID_UNITS', 400);
    if (normalizedUnits.filter((unit) => unit.isPurchaseUnit).length !== 1) throw new AppError('Choose exactly one default purchase unit', 'INVALID_UNITS', 400);

    const seenNames = new Set<string>();
    const seenBarcodes = new Set<string>();
    for (const unit of normalizedUnits) {
      if (!(Number(unit.multiplier || 0) > 0)) throw new AppError('Unit multiplier must be greater than zero', 'INVALID_UNITS', 400);
      const nameKey = unit.name.toLowerCase();
      if (seenNames.has(nameKey)) throw new AppError('Unit names must be unique per product', 'INVALID_UNITS', 400);
      seenNames.add(nameKey);
      if (unit.barcode) {
        if (seenBarcodes.has(unit.barcode)) throw new AppError('Unit barcodes must be unique per product', 'INVALID_UNITS', 400);
        seenBarcodes.add(unit.barcode);
      }
    }

    const offers: NormalizedProductOffer[] = (payload.offers || [])
      .map((offer): NormalizedProductOffer => ({
        type: offer.type === 'bogo'
          ? 'bogo'
          : offer.type === 'bundle'
          ? 'bundle'
          : offer.type === 'price'
          ? 'price'
          : offer.type === 'fixed'
          ? 'fixed'
          : 'percent',
        value: Number(offer.value || 0),
        minQty: Math.max(1, Number(offer.minQty || 1)),
        from: offer.from || null,
        to: offer.to || null,
        bogoBuyQty: (offer as any).bogoBuyQty ? Number((offer as any).bogoBuyQty) : ((offer as any).bogo_buy_qty ? Number((offer as any).bogo_buy_qty) : null),
        bogoGetQty: (offer as any).bogoGetQty ? Number((offer as any).bogoGetQty) : ((offer as any).bogo_get_qty ? Number((offer as any).bogo_get_qty) : null),
        bogoDiscountPercent: (offer as any).bogoDiscountPercent != null ? Number((offer as any).bogoDiscountPercent) : ((offer as any).bogo_discount_percent != null ? Number((offer as any).bogo_discount_percent) : 100),
        happyHourStart: (offer as any).happyHourStart || (offer as any).happy_hour_start || null,
        happyHourEnd: (offer as any).happyHourEnd || (offer as any).happy_hour_end || null,
        daysOfWeek: (offer as any).daysOfWeek || (offer as any).days_of_week || null,
      }))
      .filter((offer) => offer.value > 0 || offer.type === 'bogo');

    const customerPrices = (payload.customerPrices || [])
      .map((entry) => ({ customerId: Number(entry.customerId || 0), price: Number(entry.price || 0) }))
      .filter((entry) => entry.customerId > 0);

    const fashionVariants: NormalizedFashionVariant[] =
      (payload.fashionVariants || [])
        .map((entry) => ({
          color: normalizeArabicInput(entry.color),
          size: normalizeArabicInput(entry.size),
          barcode: String(entry.barcode || '').trim(),
          stock: Math.max(0, Number(entry.stock || 0)),
          costPrice: entry.costPrice !== undefined && entry.costPrice !== null && !isNaN(Number(entry.costPrice)) && Number(entry.costPrice) >= 0 ? Number(entry.costPrice) : undefined,
          retailPrice: entry.retailPrice !== undefined && entry.retailPrice !== null && !isNaN(Number(entry.retailPrice)) && Number(entry.retailPrice) >= 0 ? Number(entry.retailPrice) : undefined,
          wholesalePrice: entry.wholesalePrice !== undefined && entry.wholesalePrice !== null && !isNaN(Number(entry.wholesalePrice)) && Number(entry.wholesalePrice) >= 0 ? Number(entry.wholesalePrice) : undefined,
          minStock: entry.minStock !== undefined && entry.minStock !== null && !isNaN(Number(entry.minStock)) && Number(entry.minStock) >= 0 ? Number(entry.minStock) : undefined,
          sku: entry.sku ? String(entry.sku).trim() : undefined,
          imageUrl: entry.imageUrl !== undefined ? String(entry.imageUrl).trim() : undefined,
        }))
        .filter((entry) => entry.color || entry.size);
    const seenVariants = new Set<string>();
    for (const variant of fashionVariants) {
      const key = `${normalizeArabicSearch(variant.color)}::${normalizeArabicSearch(variant.size)}`;
      if (seenVariants.has(key)) throw new AppError('يوجد لون ومقاس مكرر في المجموعة', 'VARIANT_DUPLICATE', 400);
      seenVariants.add(key);
    }

    const rawName = normalizeArabicInput(payload.name);
    // INV-PRODUCTS-WORKSPACE-SAVE: keep nameEn undefined when the caller
    // omits the key, so updateProduct's preserve branch can tell "leave it"
    // (omitted) from "clear it" (''). Without this the branch was
    // unreachable — the normalizer always assigned a string-or-null — so every
    // update that did not carry nameEn (barcode/offer/price cards, partial
    // edits) silently wiped the stored English name to NULL.
    const rawNameEn = payload.nameEn === undefined ? undefined : (payload.nameEn ? String(payload.nameEn).trim() : null);
    return {
      name: rawName || '',
      nameEn: rawNameEn,
      barcode: String(payload.barcode || '').trim(),
      sku: String(payload.sku || '').trim(),
      itemType: payload.itemType === 'raw_material' ? 'raw_material' : payload.itemType === 'service' ? 'service' : 'product',
      itemKind: payload.itemKind === 'fashion' ? 'fashion' : 'standard',
      styleCode: String(payload.styleCode || '').trim(),
      color: normalizeArabicInput(payload.color),
      size: normalizeArabicInput(payload.size),
      binLocation: String(payload.binLocation || '').trim(),
      trackSerials: Boolean(payload.trackSerials),
      categoryId: payload.categoryId ? Number(payload.categoryId) : null,
      supplierId: payload.supplierId ? Number(payload.supplierId) : null,
      costPrice: Number(payload.costPrice || 0),
      retailPrice: Number(payload.retailPrice || 0),
      wholesalePrice: Number(payload.wholesalePrice || 0),
      creditPrice: payload.creditPrice === undefined ? undefined : payload.creditPrice === null ? null : Number(payload.creditPrice),
      consumerPrice: payload.consumerPrice === undefined ? undefined : payload.consumerPrice === null ? null : Number(payload.consumerPrice),
      minSellingPrice: payload.minSellingPrice === undefined ? undefined : payload.minSellingPrice === null ? null : Number(payload.minSellingPrice),
      minStock: Number(payload.minStock || 0),
      notes: normalizeArabicInput(payload.notes),
      units: normalizedUnits,
      offers,
      customerPrices,
      fashionVariants,
      icon: payload.icon ? String(payload.icon).trim() : undefined,
      imageUrl: payload.imageUrl !== undefined ? (payload.imageUrl ? String(payload.imageUrl).trim() : '') : undefined,
      metadata: {
        ...(payload.metadata || {}),
        ...(payload.icon ? { icon: String(payload.icon).trim() } : {}),
        ...(payload.imageUrl !== undefined ? { imageUrl: payload.imageUrl ? String(payload.imageUrl).trim() : '' } : {}),
        ...(payload.expiryDate ? { expiryDate: String(payload.expiryDate).trim() } : {}),
      },
      stock: payload.stock != null ? Number(payload.stock) : undefined,
      warehouseId: payload.warehouseId ? Number(payload.warehouseId) : undefined,
      calories: payload.calories != null ? Number(payload.calories) : null,
      allergens: Array.isArray(payload.allergens) ? payload.allergens : [],
      isSpicy: Boolean(payload.isSpicy),
      isVegetarian: Boolean(payload.isVegetarian),
      isGlutenFree: Boolean(payload.isGlutenFree),
    };
  }

  private buildVariantLabel(variant: Pick<NormalizedFashionVariant, 'color' | 'size'>): string {
    const color = String(variant.color || '').trim();
    const size = String(variant.size || '').trim();
    if (color && size) return `${color} / ${size}`;
    return color || size;
  }

  private normalizeArabicDigits(value: string): string {
    const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
    return String(value || '').replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)));
  }

  private coerceNewStyleCode(rawValue: string): string {
    const trimmed = String(rawValue || '').trim();
    if (!trimmed) return '';
    const normalized = this.normalizeArabicDigits(trimmed);
    if (!/^\d+$/.test(normalized)) {
      throw new AppError('كود المجموعة / الصنف الرئيسي يجب أن يكون أرقامًا فقط', 'STYLE_CODE_INVALID', 400);
    }
    return normalized;
  }

  private async ensureStyleCodeAvailable(
    styleCode: string | null | undefined,
    itemKind: 'standard' | 'fashion' | null | undefined,
    actor: AuthContext,
    excludeProductIds: number[] = [],
    drafts: Pick<NormalizedUpsertProduct, 'color' | 'size'>[] = [],
  ): Promise<void> {
    const normalized = String(styleCode || '').trim();
    if (!normalized) return;
    
    let query = this.db
      .selectFrom('products')
      .select(['id', 'item_kind', 'color', 'size'])
      .where('is_active', '=', true)
      .where('style_code', '=', normalized)
      .where(this.tenantPredicate(actor));

    if (excludeProductIds.length) {
      query = query.where('id', 'not in', excludeProductIds);
    }
    const existingRows = await query.execute();
    if (existingRows.length === 0) return;

    if (itemKind !== 'fashion') {
      throw new AppError('هذا الكود مستخدم بالفعل في صنف سابق', 'STYLE_CODE_EXISTS', 400);
    }

    const hasNonFashion = existingRows.some(row => row.item_kind !== 'fashion');
    if (hasNonFashion) {
      throw new AppError('هذا الكود مستخدم بالفعل في صنف غير ملابس', 'STYLE_CODE_EXISTS', 400);
    }

    for (const row of existingRows) {
      const normExistingColor = normalizeArabicSearch(row.color || '');
      const normExistingSize = normalizeArabicSearch(row.size || '');
      
      for (const draft of drafts) {
        const normDraftColor = normalizeArabicSearch(draft.color || '');
        const normDraftSize = normalizeArabicSearch(draft.size || '');
        if (normExistingColor === normDraftColor && normExistingSize === normDraftSize) {
          throw new AppError('هذا اللون والمقاس موجودان بالفعل لهذا الموديل', 'VARIANT_EXISTS', 400);
        }
      }
    }
  }

  private async ensureProductIdentityAvailable(payload: NormalizedUpsertProduct, actor: AuthContext, productId?: number): Promise<void> {
    if (payload.name) {
      let query = this.db.selectFrom('products').select('id').where(sql`LOWER(name)`, '=', payload.name.toLowerCase()).where('is_active', '=', true).where(this.tenantPredicate(actor));
      if (productId) query = query.where('id', '!=', productId);
      const existing = await query.executeTakeFirst();
      if (existing) throw new AppError('يوجد صنف مسجل بالفعل بنفس هذا الاسم.', 'PRODUCT_EXISTS', 400);
    }

    // Product and unit barcodes share one logical scanner namespace. The two tables
    // have separate unique indexes, so check both for *every* proposed unit barcode.
    const proposedBarcodes = [...new Set([payload.barcode, ...payload.units.map((u) => u.barcode)]
      .map((barcode) => String(barcode || '').trim().toLowerCase()).filter(Boolean))];
    if (proposedBarcodes.length) {
      let query = this.db.selectFrom('products').select('id')
        .where(sql`LOWER(barcode)`, 'in', proposedBarcodes).where('is_active', '=', true).where(this.tenantPredicate(actor));
      if (productId) query = query.where('id', '!=', productId);
      if (await query.executeTakeFirst()) throw new AppError('الباركود مستخدم بالفعل لصنف آخر.', 'BARCODE_EXISTS', 400);
      let unitQuery = this.db.selectFrom('product_units').select('product_id')
        .where(sql`LOWER(barcode)`, 'in', proposedBarcodes).where(this.tenantPredicate(actor));
      if (productId) unitQuery = unitQuery.where('product_id', '!=', productId);
      if (await unitQuery.executeTakeFirst()) throw new AppError('الباركود مستخدم بالفعل كوحدة لصنف آخر.', 'BARCODE_EXISTS', 400);
    }
    if (payload.sku) {
      let query = this.db.selectFrom('products').select('id').where(sql`LOWER(sku)`, '=', payload.sku.toLowerCase()).where('is_active', '=', true).where(this.tenantPredicate(actor));
      if (productId) query = query.where('id', '!=', productId);
      if (await query.executeTakeFirst()) throw new AppError('رمز SKU مستخدم بالفعل لصنف آخر.', 'SKU_EXISTS', 400);
    }
  }

  private async ensureCategoryAndSupplierInTenant(payload: NormalizedUpsertProduct, actor: AuthContext): Promise<void> {
    const tenantId = this.tenantId(actor);
    if (payload.itemType === 'service' && !payload.categoryId) {
      let existingCategory = await this.db
        .selectFrom('product_categories')
        .select(['id', 'is_active'])
        .where(sql`LOWER(TRIM(name))`, '=', 'خدمات')
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (existingCategory) {
        if (!existingCategory.is_active) {
          await this.db
            .updateTable('product_categories')
            .set({ is_active: true })
            .where('id', '=', existingCategory.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
        payload.categoryId = Number(existingCategory.id);
      } else {
        try {
          const createdCategory = await this.db
            .insertInto('product_categories')
            .values({
              name: 'خدمات',
              is_active: true,
              tenant_id: tenantId,
              account_id: this.accountId(actor),
            })
            .returning('id')
            .executeTakeFirst();

          if (createdCategory) {
            payload.categoryId = Number(createdCategory.id);
          }
        } catch {
          const fallback = await this.db
            .selectFrom('product_categories')
            .select('id')
            .where(sql`LOWER(TRIM(name))`, '=', 'خدمات')
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();
          if (fallback) {
            payload.categoryId = Number(fallback.id);
          }
        }
      }
    } else if (payload.categoryId) {
      const category = await this.db
        .selectFrom('product_categories')
        .select('id')
        .where('id', '=', payload.categoryId)
        .where('is_active', '=', true)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!category) throw new AppError('القسم المحدد غير موجود أو تم حذفه.', 'CATEGORY_NOT_FOUND', 404);
    }

    if (payload.supplierId) {
      const supplier = await this.db
        .selectFrom('suppliers')
        .select('id')
        .where('id', '=', payload.supplierId)
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .executeTakeFirst();
      if (!supplier) throw new AppError('المورد المحدد غير موجود أو غير مسجل.', 'SUPPLIER_NOT_FOUND', 404);
    }
  }

  private async ensureCustomerPricesInTenant(payload: NormalizedUpsertProduct, actor: AuthContext): Promise<void> {
    if (!payload.customerPrices.length) return;
    const uniqueCustomerIds = [...new Set(payload.customerPrices.map((entry) => Number(entry.customerId || 0)).filter((id) => id > 0))];
    const duplicateCustomerIds = uniqueCustomerIds.length !== payload.customerPrices.length;
    if (duplicateCustomerIds) {
      throw new AppError('Customer price duplicates are not allowed', 'CUSTOMER_PRICE_DUPLICATE', 400);
    }

    const rows = await this.db
      .selectFrom('customers')
      .select(['id'])
      .where('id', 'in', uniqueCustomerIds)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .execute();

    if (rows.length !== uniqueCustomerIds.length) {
      throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
    }
  }

  private async replaceProductRelations(db: ProductWriteExecutor, productId: number, payload: NormalizedUpsertProduct, actor: AuthContext): Promise<void> {
    const offerCapabilities = await this.getProductOfferColumnCapabilities();
    this.ensureAdvancedOffersSupported(payload, offerCapabilities);

    await db.deleteFrom('product_units').where('product_id', '=', productId).where(this.tenantPredicate(actor)).execute();
    await db.deleteFrom('product_offers').where('product_id', '=', productId).where(this.tenantPredicate(actor)).execute();
    await db.deleteFrom('product_customer_prices').where('product_id', '=', productId).where(this.tenantPredicate(actor)).execute();

    for (const unit of payload.units) {
      await db.insertInto('product_units').values({
        product_id: productId,
        name: unit.name,
        multiplier: unit.multiplier,
        barcode: unit.barcode || null,
        is_base_unit: unit.isBaseUnit,
        is_sale_unit_default: unit.isSaleUnit,
        is_purchase_unit_default: unit.isPurchaseUnit,
        ...this.tenantFields(actor),
      }).execute();
    }

    for (const offer of payload.offers) {
      const offerData: any = {
        product_id: productId,
        offer_type: offer.type,
        value: offer.value || (offer.type === 'bogo' ? (offer.bogoDiscountPercent ?? 100) : 0),
        start_date: offer.from,
        end_date: offer.to,
        is_active: true,
        ...this.tenantFields(actor),
      };
      if (offerCapabilities.hasMinQty) {
        offerData.min_qty = offer.minQty;
      }
      if (offerCapabilities.hasAdvancedPromotions) {
        offerData.bogo_buy_qty = offer.bogoBuyQty || null;
        offerData.bogo_get_qty = offer.bogoGetQty || null;
        offerData.bogo_discount_percent = offer.bogoDiscountPercent ?? 100;
        offerData.happy_hour_start = offer.happyHourStart || null;
        offerData.happy_hour_end = offer.happyHourEnd || null;
        offerData.days_of_week = offer.daysOfWeek || null;
      }
      await db.insertInto('product_offers').values(offerData).execute();
    }

    for (const price of payload.customerPrices) {
      await db.insertInto('product_customer_prices').values({ product_id: productId, customer_id: price.customerId, price: price.price, ...this.tenantFields(actor) }).execute();
    }

    await db.updateTable('products').set({
      catalog_updated_at: sql`NOW()`,
    } as any).where('id', '=', productId).where(this.tenantPredicate(actor)).execute();
  }


  /**
   * All-or-nothing fashion group replacement. Existing rows retain unit IDs,
   * promotions, customer prices, metadata and their full stock ledgers.
   * Removed variants are archived rather than deleted.
   */
  async saveFashionGroup(oldStyleCode: string, payload: SaveFashionGroupDto, actor: AuthContext): Promise<{ ok: boolean; updated: number; created: number; archived: number }> {
    const originalStyle = this.coerceNewStyleCode(oldStyleCode);
    const rows = payload?.rows || [];
    if (!originalStyle || !Array.isArray(rows) || rows.length < 1 || rows.length > 400) {
      throw new AppError('Fashion group must contain between 1 and 400 variants', 'FASHION_GROUP_INVALID', 400);
    }
    const drafts = rows.map((row) => ({ id: Number(row.id || 0), input: row, value: this.normalizeProductPayload(row) }));
    // Per-variant photos: normalize each distinct draft image once through
    // the storefront-media writer (SF-9), mirroring createProduct. Runs
    // before the transaction; a draft whose image fails to normalize keeps
    // the original ref. An explicit '' clears the photo (metadata.imageUrl
    // is dropped so the insert/update branches never store an empty ref).
    {
      const normalizedGroupImages = new Map<string, string>();
      for (const draft of drafts) {
        if (draft.value.imageUrl === '') {
          const metadata = { ...(draft.value.metadata || {}) };
          delete metadata.imageUrl;
          draft.value.metadata = metadata;
          continue;
        }
        const raw = draft.value.imageUrl ? String(draft.value.imageUrl).trim() : '';
        if (!raw || !this.mediaService) continue;
        if (!normalizedGroupImages.has(raw)) {
          try {
            normalizedGroupImages.set(raw, await this.mediaService.normalizeImageRef(this.tenantId(actor), raw));
          } catch {
            normalizedGroupImages.set(raw, raw);
          }
        }
        const resolved = normalizedGroupImages.get(raw)!;
        draft.value.imageUrl = resolved;
        draft.value.metadata = { ...(draft.value.metadata || {}), imageUrl: resolved };
      }
    }
    const newStyle = this.coerceNewStyleCode(drafts[0].value.styleCode);
    const groupKind = drafts[0].value.itemKind;
    if (groupKind !== 'fashion') throw new AppError('Only fashion variants can be saved as a fashion group', 'FASHION_GROUP_INVALID', 400);
    if (!newStyle) throw new AppError('Style code is required', 'STYLE_CODE_INVALID', 400);
    const seenCombinations = new Set<string>();
    const seenNames = new Set<string>();
    const seenBarcodes = new Set<string>();
    const seenSkus = new Set<string>();
    const seenIds = new Set<number>();
    let fallbackWarehouseId: number | null = null;
    if (drafts.some((d) => !d.id && Number(d.value.stock || 0) > 0 && !d.value.warehouseId)) {
      const existingGroupRow = await this.db.selectFrom('products').select('default_location_id')
        .where('style_code', '=', originalStyle).where('item_kind', '=', groupKind)
        .where('is_active', '=', true).where('default_location_id', 'is not', null)
        .where(this.tenantPredicate(actor)).executeTakeFirst();
      if (existingGroupRow?.default_location_id) {
        fallbackWarehouseId = Number(existingGroupRow.default_location_id);
      } else {
        const settingsRaw = await this.db.selectFrom('settings').selectAll().where(this.tenantPredicate(actor)).execute();
        const settings = settingsRaw.reduce<Record<string, unknown>>((acc, row) => { try { acc[row.key] = JSON.parse(row.value); } catch { acc[row.key] = row.value; } return acc; }, {});
        if (settings.currentLocationId) {
          fallbackWarehouseId = Number(settings.currentLocationId);
        } else {
          const activeLocs = await this.db.selectFrom('stock_locations').select('id').where('is_active', '=', true).where((eb) => eb.or([eb('location_type', 'is', null), eb('location_type', '!=', 'in_transit')])).where(this.tenantPredicate(actor)).execute();
          if (activeLocs.length >= 1) fallbackWarehouseId = Number(activeLocs[0].id);
        }
      }
    }

    for (const { id, value } of drafts) {
      if (value.itemKind !== groupKind || this.coerceNewStyleCode(value.styleCode) !== newStyle || !value.name || !(value.color || value.size)) {
        throw new AppError('Invalid fashion variant or mixed style codes', 'FASHION_GROUP_INVALID', 400);
      }
      const combination = `${normalizeArabicSearch(value.color)}::${normalizeArabicSearch(value.size)}`;
      const name = normalizeArabicSearch(value.name);
      const barcode = value.barcode.toLowerCase();
      const sku = value.sku.toLowerCase();
      if (seenCombinations.has(combination) || seenNames.has(name) ||
          (barcode && seenBarcodes.has(barcode)) || (sku && seenSkus.has(sku)) || (id && seenIds.has(id))) {
        throw new AppError('Duplicate variant, barcode or SKU in fashion group', 'FASHION_GROUP_DUPLICATE', 400);
      }
      seenCombinations.add(combination);
      seenNames.add(name);
      if (barcode) seenBarcodes.add(barcode);
      if (sku) seenSkus.add(sku);
      if (id) seenIds.add(id);
      if (value.stock !== undefined && (!Number.isFinite(Number(value.stock)) || Number(value.stock) < 0)) {
        throw new AppError('الكمية يجب أن تكون رقماً موجباً أو صفراً', 'INVALID_STOCK_QTY', 400);
      }
      await this.ensureCategoryAndSupplierInTenant(value, actor);
      if (!id) {
        if (!value.warehouseId && fallbackWarehouseId) value.warehouseId = fallbackWarehouseId;
        if (value.stock && !value.warehouseId) throw new AppError('حدد مخزنًا للرصيد الافتتاحي', 'LOCATION_REQUIRED', 400);
        await this.ensureCustomerPricesInTenant(value, actor);
        this.ensureAdvancedOffersSupported(value, await this.getProductOfferColumnCapabilities());
      }
      if (value.warehouseId) {
        await this.inventoryScope.assertLocationScope(value.warehouseId, actor, false,
          fashionLocationAccessMode(!id, value.stock !== undefined, Boolean(payload.consolidateStock || payload.zeroRemovedStock)));
      }
    }

    if (drafts.some((draft) => !draft.id && Number(draft.value.stock || 0) > 0)) {
      if (!this.hasPermission(actor, 'canAdjustInventory')) {
        throw new AppError('Opening stock requires canAdjustInventory permission', 'INVENTORY_ADJUSTMENT_FORBIDDEN', 403);
      }
      await this.ensureOpeningStockAccounts(actor);
    }

    const result = await this.db.transaction().execute(async (trx) => {
      // Both styles are locked in a stable order to avoid a style-renaming deadlock.
      for (const style of [...new Set([originalStyle, newStyle])].sort()) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${this.tenantId(actor)}), hashtext(${style}))`.execute(trx);
      }
      const existing = await trx.selectFrom('products').selectAll()
        .where('style_code', '=', originalStyle).where('item_kind', '=', groupKind)
        .where('is_active', '=', true).where(this.tenantPredicate(actor)).forUpdate().execute();
      if (!existing.length) throw new AppError('Fashion group no longer exists', 'FASHION_GROUP_NOT_FOUND', 404);
      const byId = new Map(existing.map((p) => [Number(p.id), p]));
      const authorizedStockLocationIds = new Set<number>();
      const assertStockLocationWriteScope = async (locationId: number | null) => {
        if (locationId === null || authorizedStockLocationIds.has(locationId)) return;
        await this.inventoryScope.assertLocationScope(locationId, actor, false, 'write', trx);
        authorizedStockLocationIds.add(locationId);
      };
      for (const draft of drafts) if (draft.id && !byId.has(draft.id)) {
        throw new AppError('Variant does not belong to this group', 'FASHION_VARIANT_SCOPE', 403);
      }
      // Reject stale browser tabs before the first SQL write. Stock-only changes
      // do not advance catalog_updated_at and therefore do not create false conflicts.
      for (const draft of drafts) {
        const expected = draft.input.expectedCatalogUpdatedAt;
        if (!draft.id || !expected) continue;
        const current = byId.get(draft.id)!.catalog_updated_at;
        if (!current || !Number.isFinite(Date.parse(expected)) ||
            Math.abs(new Date(current).getTime() - new Date(expected).getTime()) > 1) {
          throw new AppError('تم تعديل هذا الموديل من جهاز آخر. حدّث الشاشة قبل حفظ التعديلات', 'FASHION_GROUP_STALE', 409);
        }
      }
      if (newStyle !== originalStyle) {
        const taken = await trx.selectFrom('products').select('id').where('style_code', '=', newStyle)
          .where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
        if (taken) throw new AppError('Style code already belongs to another group', 'STYLE_CODE_EXISTS', 400);
      }

      const oldIds = existing.map((p) => Number(p.id));
      const removedWithStock = existing.filter((p) => !seenIds.has(Number(p.id)) && (Math.abs(Number(p.stock_qty || 0)) > 0.0001 || Number(p.reserved_qty || 0) > 0));
      // Stock moves do not update catalog_updated_at. Explicit adjustments must
      // compare the original browser snapshot under the locked product rows.
      const stockEdits = drafts.filter((d) => d.id
        ? d.value.stock !== undefined && Math.abs(Number(d.value.stock) - Number(byId.get(d.id)!.stock_qty || 0)) > 0.0001
        : Number(d.value.stock || 0) > 0);
      for (const draft of drafts) {
        if (draft.id && draft.value.stock !== undefined) {
          assertFashionExpectedStock(draft.input.expectedStock, Number(byId.get(draft.id)!.stock_qty || 0));
        }
      }
      const performsStockOperation = stockEdits.length > 0 ||
        (removedWithStock.length > 0 && (payload.consolidateStock || payload.zeroRemovedStock));
      if (performsStockOperation && !this.hasPermission(actor, 'canAdjustInventory')) {
        throw new AppError('Inventory adjustments require canAdjustInventory permission', 'INVENTORY_ADJUSTMENT_FORBIDDEN', 403);
      }
      if (removedWithStock.length) {
        const stillUnresolvedWithStock: typeof removedWithStock = [];

        if (payload.consolidateStock) {
          // INV-VARIANT-CONSOLIDATION-BOOK-DIGITS: consolidation
          // movement totals use the single book-digits computation,
          // resolved once on this transaction handle. Each leg keeps
          // its own unit cost (target vs removed); only the rounding
          // granularity changes — the valuation question stays open.
          const consolidationDigits = await this.bookDigits(trx, actor);
          for (const removedProduct of removedWithStock) {
            const removedId = Number(removedProduct.id);
            // Strictly consolidate only into the EXACT SAME color
            const target = drafts.find((d) => d.id && normalizeArabicSearch(d.value.color) === normalizeArabicSearch(removedProduct.color || ''));
            const targetId = Number(target?.id);
            // If no matching color target exists among remaining variants, it CANNOT be consolidated into a different color!
            if (!target || !targetId || targetId === removedId) {
              stillUnresolvedWithStock.push(removedProduct);
              continue;
            }

            const locStocks = await trx.selectFrom('product_location_stock')
              .selectAll().where('product_id', '=', removedId)
              .where('qty', '>', 0).where(this.tenantPredicate(actor)).execute();
            assertFashionRemovedStockSafe(removedProduct, locStocks, Number(target?.value.costPrice ?? 0));
            for (const locStock of locStocks) await assertStockLocationWriteScope(locStock.location_id);

            for (const ls of locStocks) {
              const qtyToMove = Number(ls.qty || 0);
              if (qtyToMove <= 0) continue;

              const rawLocId = ls.location_id != null && Number(ls.location_id) > 0 ? Number(ls.location_id) : null;
              const effectiveLocId = rawLocId || (removedProduct.default_location_id ? Number(removedProduct.default_location_id) : fallbackWarehouseId);

              await applyStockDelta(trx, {
                productId: removedId,
                locationId: rawLocId,
                branchId: ls.branch_id ? Number(ls.branch_id) : undefined,
                delta: -qtyToMove,
                tenantId: this.tenantId(actor),
                accountId: actor.accountId,
                disableAutoDrain: true,
                allowNegative: false,
              });

              await applyStockDelta(trx, {
                productId: targetId,
                locationId: rawLocId,
                branchId: ls.branch_id ? Number(ls.branch_id) : undefined,
                delta: qtyToMove,
                tenantId: this.tenantId(actor),
                accountId: actor.accountId,
                disableAutoDrain: true,
                allowNegative: true,
              });

              const targetPrior = byId.get(targetId);
              const prevTargetStock = Number(targetPrior?.stock_qty || 0);
              const nextTargetStock = prevTargetStock + qtyToMove;
              if (targetPrior) {
                targetPrior.stock_qty = Number(nextTargetStock.toFixed(3)) as any;
              }
              const prevRemovedStock = Number(removedProduct.stock_qty || 0);
              removedProduct.stock_qty = Number(Math.max(0, prevRemovedStock - qtyToMove).toFixed(3)) as any;

              await trx.insertInto('stock_movements').values({
                product_id: targetId,
                movement_type: 'transfer',
                qty: qtyToMove,
                before_qty: prevTargetStock,
                after_qty: nextTargetStock,
                unit_cost: Number(target.value.costPrice || 0),
                total_cost: stockMovementTotal(qtyToMove, Number(target.value.costPrice || 0), consolidationDigits),
                reason: 'variant_consolidation',
                note: `دمج رصيد المقاس الملغي (${removedProduct.name || removedProduct.size}) إلى نفس اللون (${target.value.color || target.value.name})`,
                reference_type: 'product',
                reference_id: removedId,
                location_id: effectiveLocId || null,
                branch_id: ls.branch_id ? Number(ls.branch_id) : undefined,
                created_by: actor.userId,
                ...this.tenantFields(actor),
              } as any).execute();

              await trx.insertInto('stock_movements').values({
                product_id: removedId,
                movement_type: 'transfer',
                qty: -qtyToMove,
                before_qty: prevRemovedStock,
                after_qty: Math.max(0, prevRemovedStock - qtyToMove),
                unit_cost: Number(removedProduct.cost_price || 0),
                total_cost: stockMovementTotal(qtyToMove, Number(removedProduct.cost_price || 0), consolidationDigits),
                reason: 'variant_consolidation',
                note: `تحويل ودمج رصيد المقاس الملغي إلى نفس اللون (${target.value.color || target.value.name})`,
                reference_type: 'product',
                reference_id: targetId,
                location_id: effectiveLocId || null,
                branch_id: ls.branch_id ? Number(ls.branch_id) : undefined,
                created_by: actor.userId,
                ...this.tenantFields(actor),
              } as any).execute();
            }
          }
        } else {
          stillUnresolvedWithStock.push(...removedWithStock);
        }

        if (stillUnresolvedWithStock.length) {
          if (payload.zeroRemovedStock) {
            for (const removedProduct of stillUnresolvedWithStock) {
              const removedId = Number(removedProduct.id);
              const locStocks = await trx.selectFrom('product_location_stock')
                .selectAll().where('product_id', '=', removedId)
                .where('qty', '>', 0).where(this.tenantPredicate(actor)).execute();

              assertFashionRemovedStockSafe(removedProduct, locStocks, undefined, { allowMismatchForZeroing: true });
              for (const locStock of locStocks) await assertStockLocationWriteScope(locStock.location_id);

              const bookDigits = await this.bookDigits(trx, actor);
              for (const ls of locStocks) {
                const qtyToDeduct = Number(ls.qty || 0);
                if (qtyToDeduct <= 0) continue;

                const rawLocId = ls.location_id != null && Number(ls.location_id) > 0 ? Number(ls.location_id) : null;
                const effectiveLocId = rawLocId || (removedProduct.default_location_id ? Number(removedProduct.default_location_id) : fallbackWarehouseId);

                await applyStockDelta(trx, {
                  productId: removedId,
                  locationId: rawLocId,
                  branchId: ls.branch_id ? Number(ls.branch_id) : undefined,
                  delta: -qtyToDeduct,
                  tenantId: this.tenantId(actor),
                  accountId: actor.accountId,
                  disableAutoDrain: true,
                  allowNegative: true,
                });

                removedProduct.stock_qty = Number(Math.max(0, Number(removedProduct.stock_qty || 0) - qtyToDeduct).toFixed(3)) as any;

                const unitCost = Number(removedProduct.cost_price || 0);
                const insertedMovement = await trx.insertInto('stock_movements').values({
                  product_id: removedId,
                  movement_type: 'deduct',
                  qty: -qtyToDeduct,
                  before_qty: qtyToDeduct,
                  after_qty: 0,
                  unit_cost: unitCost,
                  total_cost: stockMovementTotal(qtyToDeduct, unitCost, bookDigits),
                  reason: 'fashion_matrix_adjustment',
                  note: `تسوية وتصفير رصيد المقاس الملغي (${removedProduct.name || removedProduct.size}) عند تعديل الموديل`,
                  reference_type: 'inventory_adjustment',
                  reference_id: removedId,
                  location_id: effectiveLocId || null,
                  branch_id: ls.branch_id ? Number(ls.branch_id) : undefined,
                  created_by: actor.userId,
                  ...this.tenantFields(actor),
                } as any).returning('id').executeTakeFirst();

                if (insertedMovement?.id && this.accountingPosting) {
                  await this.accountingPosting.postInventoryAdjustment(trx, Number(insertedMovement.id), actor);
                }
              }
            }
          } else {
            const names = stillUnresolvedWithStock.map((p) => `${p.name || p.color || p.size || p.id} (رصيد: ${p.stock_qty})`).join('، ');
            throw new AppError(`لا يمكن إخفاء المقاسات التالية لأن لها رصيد مخزني: ${names}. يرجى تسوية رصيدها أولاً، حيث يُمنع منعاً باتاً دمج رصيد صنف في لون مختلف`, 'FASHION_VARIANT_HAS_STOCK', 409);
          }
        }
      }
      const outsiderProducts = await trx.selectFrom('products')
        .select(['id', 'name', 'barcode', 'sku']).where('is_active', '=', true).where(this.tenantPredicate(actor))
        .where('id', 'not in', oldIds).execute();
      for (const other of outsiderProducts) {
        if (seenNames.has(normalizeArabicSearch(other.name || '')) ||
            (other.barcode && seenBarcodes.has(String(other.barcode).toLowerCase())) ||
            (other.sku && seenSkus.has(String(other.sku).toLowerCase()))) {
          throw new AppError('Variant name, barcode or SKU is already in use', 'FASHION_VARIANT_EXISTS', 400);
        }
      }
      if (seenBarcodes.size) {
        const otherUnitBarcodes = await trx.selectFrom('product_units')
          .select(['product_id', 'barcode'])
          .where(sql`LOWER(barcode)`, 'in', [...seenBarcodes])
          .where('product_id', 'not in', oldIds).where(this.tenantPredicate(actor)).execute();
        if (otherUnitBarcodes.length) throw new AppError('Barcode is used by another product unit', 'BARCODE_EXISTS', 400);
      }

      // Release keys on kept variants (and on any archived variant whose barcode/SKU is being reused
      // by a kept/new variant), preserving historical barcode/SKU on archived variants otherwise.
      const keptIdSet = new Set(drafts.filter((row) => row.id).map((row) => Number(row.id)));
      const releaseBarcodeIds = existing
        .filter((p) => keptIdSet.has(Number(p.id)) || (p.barcode && seenBarcodes.has(String(p.barcode).toLowerCase())))
        .map((p) => Number(p.id));
      const releaseSkuIds = existing
        .filter((p) => keptIdSet.has(Number(p.id)) || (p.sku && seenSkus.has(String(p.sku).toLowerCase())))
        .map((p) => Number(p.id));
      if (releaseBarcodeIds.length) {
        await trx.updateTable('products').set({ barcode: null })
          .where('id', 'in', releaseBarcodeIds).where(this.tenantPredicate(actor)).execute();
        await trx.updateTable('product_units').set({ barcode: null })
          .where('product_id', 'in', releaseBarcodeIds).where('is_base_unit', '=', true)
          .where(this.tenantPredicate(actor)).execute();
      }
      if (releaseSkuIds.length) {
        await trx.updateTable('products').set({ sku: null })
          .where('id', 'in', releaseSkuIds).where(this.tenantPredicate(actor)).execute();
      }

      const template = existing[0];
      let created = 0;
      let updated = 0;
      for (const { id, value } of drafts) {
        if (id) {
          const prior = byId.get(id)!;
          const priceChanged = Number(prior.cost_price) !== value.costPrice ||
            Number(prior.retail_price) !== value.retailPrice || Number(prior.wholesale_price) !== value.wholesalePrice;
          if (priceChanged && !this.hasPermission(actor, 'canEditPrice')) {
            throw new AppError('Price changes require canEditPrice permission', 'PRICE_CHANGE_FORBIDDEN', 403);
          }

          if (value.stock !== undefined && value.stock !== null) {
            const targetStock = Math.max(0, Number(value.stock));
            const currentStock = Number(prior.stock_qty || 0);
            const stockDelta = Number((targetStock - currentStock).toFixed(3));

            if (Math.abs(stockDelta) > 0.0001) {
              const locStock = await trx.selectFrom('product_location_stock')
                .selectAll().where('product_id', '=', id)
                .where(this.tenantPredicate(actor)).orderBy('qty', 'desc').limit(1).executeTakeFirst();
              const rawLocId = locStock?.location_id != null && Number(locStock.location_id) > 0 ? Number(locStock.location_id) : null;
              const effectiveLocationId = rawLocId 
                || (value.warehouseId && Number(value.warehouseId) > 0 ? Number(value.warehouseId) : null)
                || (prior.default_location_id ? Number(prior.default_location_id) : null)
                || fallbackWarehouseId
                || null;

              if (!effectiveLocationId) {
                throw new AppError('حدد مخزنًا لتسوية رصيد الصنف', 'LOCATION_REQUIRED', 400);
              }

              await applyStockDelta(trx, {
                productId: id,
                locationId: effectiveLocationId,
                branchId: locStock?.branch_id ? Number(locStock.branch_id) : undefined,
                delta: stockDelta,
                tenantId: this.tenantId(actor),
                accountId: actor.accountId,
                disableAutoDrain: true,
                allowNegative: false,
              });

              const unitCost = Number(value.costPrice || prior.cost_price || 0);
              const absDelta = Math.abs(stockDelta);
              const bookDigits = await this.bookDigits(trx, actor);
              const insertedMovement = await trx.insertInto('stock_movements').values({
                product_id: id,
                movement_type: stockDelta > 0 ? 'add' : 'deduct',
                qty: stockDelta,
                before_qty: currentStock,
                after_qty: targetStock,
                unit_cost: unitCost,
                total_cost: stockMovementTotal(absDelta, unitCost, bookDigits),
                reason: 'fashion_matrix_adjustment',
                note: stockDelta > 0
                  ? `تسوية زيادة رصيد المقاس (${value.color || ''} / ${value.size || ''}) من شاشة الموديل`
                  : `تسوية خفض/تصفير رصيد المقاس (${value.color || ''} / ${value.size || ''}) من شاشة الموديل`,
                reference_type: 'inventory_adjustment',
                reference_id: id,
                location_id: effectiveLocationId,
                branch_id: locStock?.branch_id ? Number(locStock.branch_id) : undefined,
                created_by: actor.userId,
                ...this.tenantFields(actor),
              } as any).returning('id').executeTakeFirst();

              if (insertedMovement?.id && this.accountingPosting) {
                await this.accountingPosting.postInventoryAdjustment(trx, Number(insertedMovement.id), actor);
              }
            }
          }

          // Per-variant photo change: merge into the stored metadata (the
          // update below otherwise never touches metadata, so a photo set
          // in the group matrix would silently vanish). Only when the row
          // carried an image decision; rows without one keep their photo.
          let metadataUpdate: string | undefined;
          if (value.imageUrl !== undefined) {
            const priorMetaRaw = (prior as { metadata?: unknown }).metadata;
            let nextMeta: Record<string, unknown> = {};
            if (priorMetaRaw && typeof priorMetaRaw === 'object') nextMeta = { ...(priorMetaRaw as Record<string, unknown>) };
            else if (typeof priorMetaRaw === 'string') {
              try {
                const parsed: unknown = JSON.parse(priorMetaRaw);
                if (parsed && typeof parsed === 'object') nextMeta = { ...(parsed as Record<string, unknown>) };
              } catch {}
            }
            if (value.imageUrl) nextMeta.imageUrl = (value.metadata && value.metadata.imageUrl) || value.imageUrl;
            else delete nextMeta.imageUrl;
            metadataUpdate = JSON.stringify(nextMeta);
          }

          await trx.updateTable('products').set({
            name: value.name, barcode: value.barcode || null, sku: value.sku || null,
            item_type: value.itemType, item_kind: groupKind, style_code: newStyle,
            color: value.color || null, size: value.size || null,
            category_id: value.categoryId, supplier_id: value.supplierId,
            cost_price: value.costPrice, retail_price: value.retailPrice,
            wholesale_price: value.wholesalePrice, min_stock_qty: value.minStock,
            notes: value.notes, default_location_id: value.warehouseId || prior.default_location_id,
            ...(metadataUpdate !== undefined ? { metadata: metadataUpdate } : {}),
            catalog_updated_at: sql`NOW()`, updated_at: sql`NOW()`,
          }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
          await trx.updateTable('product_units').set({ barcode: value.barcode || null })
            .where('product_id', '=', id).where('is_base_unit', '=', true)
            .where(this.tenantPredicate(actor)).execute();
          updated++;
        } else {
          const stock = Number(value.stock || 0);
          const resolvedWarehouseId = (value.warehouseId && Number(value.warehouseId) > 0 ? Number(value.warehouseId) : null)
            || (template?.default_location_id ? Number(template.default_location_id) : null)
            || fallbackWarehouseId
            || null;
          const inserted = await trx.insertInto('products').values({
            name: value.name, name_en: value.nameEn || template?.name_en || null,
            barcode: value.barcode || null, sku: value.sku || null,
            item_type: value.itemType, item_kind: groupKind, style_code: newStyle,
            color: value.color || null, size: value.size || null,
            bin_location: value.binLocation || template?.bin_location || null,
            category_id: value.categoryId, supplier_id: value.supplierId,
            cost_price: value.costPrice, retail_price: value.retailPrice,
            wholesale_price: value.wholesalePrice,
            credit_price: value.creditPrice ?? (template?.credit_price != null ? Number(template.credit_price) : null),
            consumer_price: value.consumerPrice ?? (template?.consumer_price != null ? Number(template.consumer_price) : null),
            min_selling_price: value.minSellingPrice ?? (template?.min_selling_price != null ? Number(template.min_selling_price) : null),
            min_stock_qty: value.minStock,
            stock_qty: stock, default_location_id: resolvedWarehouseId,
            notes: value.notes, is_active: true, track_serials: false,
            metadata: value.metadata
              ? JSON.stringify(value.metadata)
              : (template?.metadata ? (typeof template.metadata === 'string' ? template.metadata : JSON.stringify(template.metadata)) : null),
            catalog_updated_at: sql`NOW()`, ...this.tenantFields(actor),
          } as any).returning('id').executeTakeFirstOrThrow();
          const productId = Number(inserted.id);
          const newValue = { ...value, units: value.units.map((u) => u.isBaseUnit ? { ...u, barcode: value.barcode } : u) };
          await this.replaceProductRelations(trx, productId, newValue, actor);
          if (stock > 0) {
            const bookDigits = await this.bookDigits(trx, actor);
            const openingTotal = stockMovementTotal(stock, value.costPrice, bookDigits);
            await trx.insertInto('product_location_stock').values({
              product_id: productId, branch_id: null, location_id: resolvedWarehouseId!, qty: stock,
              ...this.tenantFields(actor),
            }).execute();
            await trx.insertInto('stock_movements').values({
              product_id: productId, movement_type: 'opening_balance', qty: stock,
              before_qty: 0, after_qty: stock,
              unit_cost: value.costPrice, total_cost: openingTotal,
              reason: 'opening_balance',
              note: 'رصيد افتتاحي لمقاس جديد', reference_type: 'product',
              reference_id: productId, location_id: resolvedWarehouseId!, created_by: actor.userId,
              ...this.tenantFields(actor),
            } as any).execute();
            await this.postOpeningStock(trx, productId, stock, value.costPrice, resolvedWarehouseId, actor);
          }
          created++;
        }
      }
      const kept = new Set(drafts.filter((row) => row.id).map((row) => row.id));
      const removed = existing.filter((p) => !kept.has(Number(p.id)));
      if (removed.length) {
        await trx.updateTable('products').set({ is_active: false, catalog_updated_at: sql`NOW()`, updated_at: sql`NOW()` })
          .where('id', 'in', removed.map((p) => Number(p.id))).where(this.tenantPredicate(actor)).execute();
      }
      return { ok: true, updated, created, archived: removed.length };
    });
    (await import('../../storefront/storefront.service')).StorefrontService.invalidateGlobalCatalogCache();
    await this.audit.log('تعديل مجموعة ملابس', `تم حفظ الموديل ${originalStyle} بواسطة ${actor.username}: ${result.updated} تعديل، ${result.created} إضافة، ${result.archived} أرشفة`, actor);
    return result;
  }

  async createProduct(payload: UpsertProductDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const normalized = this.normalizeProductPayload(payload);
    // Either language satisfies the name requirement: the Arabic field
    // stays empty for an English-only product (no write-time copy).
    if (!normalized.name && !normalized.nameEn) throw new AppError('اسم الصنف الأساسي مطلوب (بالعربية أو الإنجليزية).', 'PRODUCT_NAME_REQUIRED', 400);
    normalized.styleCode = this.coerceNewStyleCode(normalized.styleCode);
    const shouldExpandVariants = normalized.fashionVariants.length > 0 && (normalized.itemKind === 'fashion' || Boolean(normalized.styleCode));
    const drafts = shouldExpandVariants
      ? normalized.fashionVariants.map((variant) => {
          const label = this.buildVariantLabel(variant);
          const draft = {
            ...normalized,
            name: label ? `${normalized.name} - ${label}` : normalized.name,
            barcode: variant.barcode || '',
            sku: variant.sku || '',
            units: normalized.units.map((unit) => unit.isBaseUnit ? { ...unit, barcode: variant.barcode || '' } : unit),
            color: variant.color,
            size: variant.size,
            stock: variant.stock,
            costPrice: variant.costPrice !== undefined && variant.costPrice !== null && !isNaN(Number(variant.costPrice)) && Number(variant.costPrice) >= 0 ? Number(variant.costPrice) : normalized.costPrice,
            retailPrice: variant.retailPrice !== undefined && variant.retailPrice !== null && !isNaN(Number(variant.retailPrice)) && Number(variant.retailPrice) >= 0 ? Number(variant.retailPrice) : normalized.retailPrice,
            wholesalePrice: variant.wholesalePrice !== undefined && variant.wholesalePrice !== null && !isNaN(Number(variant.wholesalePrice)) && Number(variant.wholesalePrice) >= 0 ? Number(variant.wholesalePrice) : normalized.wholesalePrice,
            minStock: variant.minStock !== undefined && variant.minStock !== null && !isNaN(Number(variant.minStock)) && Number(variant.minStock) >= 0 ? Number(variant.minStock) : normalized.minStock,
            fashionVariants: [],
          };
          // Per-variant photo: an explicit variant image wins; an explicit ''
          // clears the inherited parent photo; undefined inherits the parent
          // photo (the pre-expansion behaviour for every child).
          if (variant.imageUrl !== undefined) {
            draft.imageUrl = variant.imageUrl;
            const metadata = { ...(normalized.metadata || {}) };
            if (variant.imageUrl) metadata.imageUrl = variant.imageUrl;
            else delete metadata.imageUrl;
            draft.metadata = metadata;
          }
          return draft;
        })
      : [normalized];

    await this.ensureStyleCodeAvailable(normalized.styleCode, normalized.itemKind, actor, [], drafts);
    this.ensureAdvancedOffersSupported(normalized, await this.getProductOfferColumnCapabilities());
    await this.ensureCategoryAndSupplierInTenant(normalized, actor);
    await this.ensureCustomerPricesInTenant(normalized, actor);
    if (normalized.warehouseId) await this.inventoryScope.assertLocationScope(normalized.warehouseId, actor, false, 'write');

    const duplicateDraftNames = new Set<string>();
    const duplicateDraftBarcodes = new Set<string>();
    const duplicateDraftSkus = new Set<string>();
    for (const draft of drafts) {
      const nameKey = draft.name.toLowerCase();
      if (duplicateDraftNames.has(nameKey)) throw new AppError('توجد أصناف فرعية مكررة بنفس الاسم أو المواصفات.', 'PRODUCT_EXISTS', 400);
      duplicateDraftNames.add(nameKey);
      if (draft.barcode) {
        const barcodeKey = draft.barcode.toLowerCase();
        if (duplicateDraftBarcodes.has(barcodeKey)) throw new AppError('الباركود مكرر ومستخدم بالفعل لصنف فرعي آخر.', 'BARCODE_EXISTS', 400);
        duplicateDraftBarcodes.add(barcodeKey);
      }
      if (draft.sku) {
        const key = draft.sku.toLowerCase();
        if (duplicateDraftSkus.has(key)) throw new AppError('رمز SKU مكرر ومستخدم بالفعل لصنف فرعي آخر.', 'SKU_EXISTS', 400);
        duplicateDraftSkus.add(key);
      }
      await this.ensureProductIdentityAvailable(draft, actor);
    }

    let resolvedLocationId = normalized.warehouseId || null;
    const hasAnyInitialStock = drafts.some(d => Number(d.stock || 0) > 0);
    if (hasAnyInitialStock && !this.hasPermission(actor, 'canAdjustInventory')) {
      throw new AppError('Opening stock requires canAdjustInventory permission', 'INVENTORY_ADJUSTMENT_FORBIDDEN', 403);
    }
    if (hasAnyInitialStock) await this.ensureOpeningStockAccounts(actor);
    if (hasAnyInitialStock && !resolvedLocationId) {
      const settingsRaw = await this.db.selectFrom('settings').selectAll().where(this.tenantPredicate(actor)).execute();
      const settings = settingsRaw.reduce<Record<string, unknown>>((acc, row) => { try { acc[row.key] = JSON.parse(row.value); } catch { acc[row.key] = row.value; } return acc; }, {});
      if (settings.currentLocationId) {
        resolvedLocationId = Number(settings.currentLocationId);
      } else {
        const activeLocs = await this.db.selectFrom('stock_locations').select('id').where('is_active', '=', true).where((eb) => eb.or([eb('location_type', 'is', null), eb('location_type', '!=', 'in_transit')])).where(this.tenantPredicate(actor)).execute();
        if (activeLocs.length === 1) {
          resolvedLocationId = activeLocs[0].id;
        } else if (activeLocs.length > 1) {
          throw new AppError('يجب تحديد مكان استلام عند إضافة رصيد افتتاحي، وتوجد عدة أماكن متاحة.', 'LOCATION_REQUIRED', 400);
        }
      }
    }
    if (resolvedLocationId) await this.inventoryScope.assertLocationScope(resolvedLocationId, actor, false, 'write');

    let firstProductId: number | null = null;
    // Per-draft photos: normalize each distinct draft image once through the
    // storefront-media writer (SF-9), exactly as the single-product path did
    // for the parent image. A draft without its own image already carries the
    // parent image from the expansion override above; a draft whose image
    // fails to normalize keeps the original ref (the same fallback the
    // single-product path used). Runs before the transaction, as before.
    if (this.mediaService) {
      const normalizedDraftImages = new Map<string, string>();
      for (const draft of drafts) {
        const raw = draft.imageUrl ? String(draft.imageUrl).trim() : '';
        if (!raw) continue;
        if (!normalizedDraftImages.has(raw)) {
          try {
            normalizedDraftImages.set(raw, await this.mediaService.normalizeImageRef(this.tenantId(actor), raw));
          } catch {
            normalizedDraftImages.set(raw, raw);
          }
        }
        const resolved = normalizedDraftImages.get(raw)!;
        draft.imageUrl = resolved;
        draft.metadata = { ...(draft.metadata || {}), imageUrl: resolved };
      }
    }

    await this.db.transaction().execute(async (trx) => {
      if (normalized.styleCode) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${this.tenantId(actor)}), hashtext(${normalized.styleCode}))`.execute(trx);
        await this.ensureStyleCodeAvailable(normalized.styleCode, normalized.itemKind, actor, [], drafts);
      }
      for (const draft of drafts) {
        const initialStockQty = Number(draft.stock || 0);
        const metaObj = {
          ...(draft.metadata || {}),
          ...(draft.icon ? { icon: draft.icon } : {}),
          ...(draft.imageUrl ? { imageUrl: draft.imageUrl } : {}),
        };
        const hasMeta = Object.keys(metaObj).length > 0;
        const result = await trx
          .insertInto('products')
          .values({
            name: draft.name,
            name_en: draft.nameEn || null,
            barcode: draft.barcode || null,
            sku: draft.sku || null,
            item_type: draft.itemType === 'service' ? 'service' : draft.itemType === 'raw_material' ? 'raw_material' : 'product',
            item_kind: draft.itemKind,
            style_code: draft.styleCode || null,
            color: draft.color || null,
            size: draft.size || null,
            bin_location: draft.binLocation || null,
            track_serials: Boolean(draft.trackSerials),
            category_id: draft.categoryId,
            supplier_id: draft.supplierId,
            cost_price: draft.costPrice,
            retail_price: draft.retailPrice,
            wholesale_price: draft.wholesalePrice,
            credit_price: draft.creditPrice ?? null,
            consumer_price: draft.consumerPrice ?? null,
            min_selling_price: draft.minSellingPrice ?? null,
            stock_qty: initialStockQty,
            min_stock_qty: draft.minStock,
            default_location_id: resolvedLocationId,
            notes: draft.notes,
            metadata: hasMeta ? JSON.stringify(metaObj) : null,
            calories: draft.calories ?? null,
            allergens: draft.allergens ? sql`${JSON.stringify(draft.allergens)}::jsonb` : sql`'[]'::jsonb`,
            is_spicy: Boolean(draft.isSpicy),
            is_vegetarian: Boolean(draft.isVegetarian),
            is_gluten_free: Boolean(draft.isGlutenFree),
            is_active: true,
            catalog_updated_at: sql`NOW()`,
            ...this.tenantFields(actor),
          } as any)
          .returning('id')
          .executeTakeFirstOrThrow();
        const productId = Number(result.id);
        if (firstProductId === null) firstProductId = productId;
        await this.replaceProductRelations(trx, productId, draft, actor);
        if (initialStockQty > 0) {
          const bookDigits = await this.bookDigits(trx, actor);
          const openingTotal = stockMovementTotal(initialStockQty, draft.costPrice, bookDigits);
          await trx.insertInto('product_location_stock').values({ product_id: productId, branch_id: null, location_id: resolvedLocationId, qty: initialStockQty, ...this.tenantFields(actor) }).execute();
          // Opening balance must appear in the perpetual ledger, otherwise rebuilding stock from
          // stock_movements starts from zero and disagrees with products.stock_qty forever.
          await trx.insertInto('stock_movements').values({
            product_id: productId,
            movement_type: 'opening_balance',
            qty: initialStockQty,
            before_qty: 0,
            after_qty: initialStockQty,
            unit_cost: draft.costPrice,
            total_cost: openingTotal,
            reason: 'opening_balance',
            note: 'رصيد افتتاحي عند إنشاء الصنف',
            reference_type: 'product',
            reference_id: productId,
            location_id: resolvedLocationId,
            created_by: actor.userId,
            ...this.tenantFields(actor),
          } as any).execute();
          await this.postOpeningStock(trx, productId, initialStockQty, draft.costPrice, resolvedLocationId, actor);
        }
      }
    });

    const auditLabel = drafts.length > 1
      ? `تم إضافة مجموعة أصناف ${normalized.name} بعدد ${drafts.length} عناصر فرعية بواسطة ${actor.username}`
      : `تم إضافة الصنف ${normalized.name} بواسطة ${actor.username}`;
    await this.audit.log('إضافة صنف', auditLabel, actor);
    (await import('../../storefront/storefront.service')).StorefrontService.invalidateGlobalCatalogCache();
    // INV-PRODUCTS-WORKSPACE-SAVE: return only the saved product. The old
    // response re-ran the full-catalog listProducts (10,001 rows x ~40 cols,
    // no LIMIT/OFFSET) on every save, so a create/edit paid for a whole
    // catalog scan — and a multi-megabyte payload — that no caller used.
    if (firstProductId === null) throw new AppError('Product creation failed', 'PRODUCT_CREATE_FAILED', 500);
    return { ok: true, id: firstProductId, product: await this.getProduct(firstProductId, actor) };
  }

  async updateProduct(id: number, payload: UpsertProductDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const existing = await this.db.selectFrom('products').selectAll().where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!existing) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    const normalized = this.normalizeProductPayload(payload);
    // Either language satisfies the name requirement: the Arabic field
    // stays empty for an English-only product (no write-time copy).
    if (!normalized.name && !normalized.nameEn) throw new AppError('اسم الصنف الأساسي مطلوب (بالعربية أو الإنجليزية).', 'PRODUCT_NAME_REQUIRED', 400);

    const existingStyleCode = String(existing.style_code || '').trim();
    const requestedStyleCode = String(normalized.styleCode || '').trim();
    const styleCodeChanged = requestedStyleCode !== existingStyleCode;
    if (styleCodeChanged) {
      normalized.styleCode = this.coerceNewStyleCode(requestedStyleCode);
    } else {
      normalized.styleCode = existingStyleCode;
    }

    await this.ensureStyleCodeAvailable(normalized.styleCode, normalized.itemKind, actor, [id], [normalized]);

    await this.ensureProductIdentityAvailable(normalized, actor, id);
    this.ensureAdvancedOffersSupported(normalized, await this.getProductOfferColumnCapabilities());
    await this.ensureCategoryAndSupplierInTenant(normalized, actor);
    await this.ensureCustomerPricesInTenant(normalized, actor);
    if (normalized.warehouseId) await this.inventoryScope.assertLocationScope(normalized.warehouseId, actor, false, 'write');

    const priceChanged = Number(normalized.costPrice || 0) !== Number(existing.cost_price || 0)
      || Number(normalized.retailPrice || 0) !== Number(existing.retail_price || 0)
      || Number(normalized.wholesalePrice || 0) !== Number(existing.wholesale_price || 0)
      || (normalized.minSellingPrice !== undefined
        && normalized.minSellingPrice !== (existing.min_selling_price == null ? null : Number(existing.min_selling_price)));
    if (priceChanged && !this.hasPermission(actor, 'canEditPrice')) {
      throw new AppError('Price changes require canEditPrice permission', 'PRICE_CHANGE_FORBIDDEN', 403);
    }
    if (normalized.stock !== undefined && normalized.stock !== null) {
      throw new AppError('Stock cannot be edited from product master data. Use inventory adjustment.', 'STOCK_UPDATE_FORBIDDEN', 400);
    }

    let storedImageUrl = payload.imageUrl;
    if (storedImageUrl && this.mediaService) {
      try {
        storedImageUrl = await this.mediaService.normalizeImageRef(this.tenantId(actor), storedImageUrl);
      } catch {}
    }

    const existingMeta = typeof existing.metadata === 'object' && existing.metadata ? existing.metadata : {};
    const metaObj = {
      ...existingMeta,
      ...(normalized.metadata || {}),
      ...(normalized.icon ? { icon: normalized.icon } : {}),
      ...(payload.imageUrl !== undefined ? (storedImageUrl ? { imageUrl: storedImageUrl } : {}) : {}),
    };
    if (payload.imageUrl === '') {
      delete metaObj.imageUrl;
    }
    const hasMeta = Object.keys(metaObj).length > 0;

    await this.db.transaction().execute(async (trx) => {

      await trx.updateTable('products').set({
        name: normalized.name,
        name_en: normalized.nameEn !== undefined ? (normalized.nameEn || null) : (existing as any).name_en,
        barcode: normalized.barcode || null,
        sku: payload.sku === undefined ? (existing.sku || null) : (normalized.sku || null),
        item_type: normalized.itemType === 'service' ? 'service' : normalized.itemType === 'raw_material' ? 'raw_material' : 'product',
        item_kind: normalized.itemKind,
        style_code: normalized.styleCode || null,
        color: normalized.color || null,
        size: normalized.size || null,
        bin_location: normalized.binLocation || null,
        track_serials: normalized.trackSerials !== undefined ? Boolean(normalized.trackSerials) : undefined,
        category_id: normalized.categoryId,
        supplier_id: normalized.supplierId,
        cost_price: normalized.costPrice,
        retail_price: normalized.retailPrice,
        wholesale_price: normalized.wholesalePrice,
        credit_price: normalized.creditPrice === undefined ? (existing as any).credit_price : (normalized.creditPrice ?? null),
        consumer_price: normalized.consumerPrice === undefined ? (existing as any).consumer_price : (normalized.consumerPrice ?? null),
        min_selling_price: normalized.minSellingPrice === undefined ? existing.min_selling_price : normalized.minSellingPrice,
        min_stock_qty: normalized.minStock,
        default_location_id: normalized.warehouseId || existing.default_location_id || null,
        notes: normalized.notes,
        metadata: hasMeta ? JSON.stringify(metaObj) : null,
        calories: normalized.calories ?? null,
        allergens: normalized.allergens ? sql`${JSON.stringify(normalized.allergens)}::jsonb` : sql`'[]'::jsonb`,
        is_spicy: Boolean(normalized.isSpicy),
        is_vegetarian: Boolean(normalized.isVegetarian),
        is_gluten_free: Boolean(normalized.isGlutenFree),
        ...(payload.isActive !== undefined ? { is_active: Boolean(payload.isActive) } : {}),
        catalog_updated_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      } as any).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
      await this.replaceProductRelations(trx, id, normalized, actor);
    });

    (await import('../../storefront/storefront.service')).StorefrontService.invalidateGlobalCatalogCache();
    await this.audit.log('تعديل صنف', `تم تحديث الصنف #${id} بواسطة ${actor.username}`, actor);
    // INV-PRODUCTS-WORKSPACE-SAVE: return only the saved product (see
    // createProduct — the full-catalog listProducts response is gone).
    return { ok: true, product: await this.getProduct(id, actor) };
  }

  async deleteProduct(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    try {
      await this.db.transaction().execute(async (trx) => {
        const product = await trx.selectFrom('products').select(['id', 'stock_qty']).where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
        if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
        if (Math.abs(Number(product.stock_qty || 0)) > 0.0001) throw new AppError('Product still has stock on hand', 'PRODUCT_HAS_STOCK', 400);
        const movementCount = await trx.selectFrom('stock_movements').select((eb) => eb.fn.countAll<number>().as('count')).where('product_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow();
        if (Number(movementCount.count || 0) > 0) throw new AppError('Product has transaction history and cannot be deleted', 'PRODUCT_HAS_HISTORY', 400);

        // Pre-check linked transaction tables:
        const [importCount, purchaseCount, saleCount] = await Promise.all([
          trx.selectFrom('import_shipment_items').select((eb) => eb.fn.countAll<number>().as('count')).where('product_id', '=', id).where(sql<boolean>`tenant_id = ${this.tenantId(actor)}`).executeTakeFirst().catch(() => ({ count: 0 })),
          trx.selectFrom('purchase_items').select((eb) => eb.fn.countAll<number>().as('count')).where('product_id', '=', id).executeTakeFirst().catch(() => ({ count: 0 })),
          trx.selectFrom('sale_items').select((eb) => eb.fn.countAll<number>().as('count')).where('product_id', '=', id).executeTakeFirst().catch(() => ({ count: 0 })),
        ]);
        if (Number(importCount?.count || 0) > 0 || Number(purchaseCount?.count || 0) > 0 || Number(saleCount?.count || 0) > 0) {
          throw new AppError('لا يمكن حذف الصنف نهائياً لوجود سجلات ومعاملات تجارية مرتبطة به (شحنات استيراد أو فواتير سابقة). يمكنك أرشفة الصنف بدلاً من ذلك.', 'PRODUCT_HAS_HISTORY', 409);
        }

        await trx.deleteFrom('product_units').where('product_id', '=', id).where(this.tenantPredicate(actor)).execute();
        await trx.deleteFrom('product_offers').where('product_id', '=', id).where(this.tenantPredicate(actor)).execute();
        await trx.deleteFrom('product_customer_prices').where('product_id', '=', id).where(this.tenantPredicate(actor)).execute();
        await trx.deleteFrom('products').where('id', '=', id).where(this.tenantPredicate(actor)).execute();
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err?.code === '23503' || err?.code === '23001' || String(err?.message || '').includes('foreign key constraint') || String(err?.message || '').includes('violates RESTRICT')) {
        throw new AppError('لا يمكن حذف الصنف نهائياً لوجود سجلات تجارية مرتبطة به في المنظومة. يمكنك أرشفة الصنف بدلاً من حذفه.', 'PRODUCT_HAS_HISTORY', 409);
      }
      throw err;
    }
    (await import('../../storefront/storefront.service')).StorefrontService.invalidateGlobalCatalogCache();
    await this.audit.log('حذف صنف', `تم حذف الصنف #${id} نهائياً بواسطة ${actor.username}`, actor);
    // INV-PRODUCTS-WORKSPACE-SAVE: no product to return (the row is gone)
    // and no full-catalog listProducts response (see createProduct).
    return { ok: true };
  }

  async toggleProductArchive(
    id: number,
    actor: AuthContext,
    options?: { zeroStock?: boolean; archiveEntireGroup?: boolean },
  ): Promise<Record<string, unknown>> {
    const result = await this.db.transaction().execute(async (trx) => {
      const initialProduct = await trx.selectFrom('products').selectAll()
        .where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
      if (!initialProduct) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const nextActive = !Boolean(initialProduct.is_active);

      let targetProductIds = [id];
      const isFashionGroupTarget = Boolean(options?.archiveEntireGroup && initialProduct.item_kind === 'fashion' && initialProduct.style_code);

      if (isFashionGroupTarget) {
        const siblings = await trx.selectFrom('products').select('id')
          .where('style_code', '=', initialProduct.style_code)
          .where('item_kind', '=', 'fashion')
          .where('is_active', '=', initialProduct.is_active)
          .where(this.tenantPredicate(actor))
          .execute();
        targetProductIds = siblings.map((s) => Number(s.id));
      }

      // Canonical lock order: sort product IDs ascending to prevent deadlocks
      targetProductIds.sort((a, b) => a - b);

      const targetProducts = await trx.selectFrom('products').selectAll()
        .where('id', 'in', targetProductIds)
        .where(this.tenantPredicate(actor))
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();

      if (!targetProducts.length) {
        throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      }

      if (!nextActive) {
        // Fetch active fallback warehouse once for the tenant
        let fallbackLocationId: number | null = null;
        const activeLoc = await trx.selectFrom('stock_locations').select('id')
          .where('is_active', '=', true)
          .where((eb) => eb.or([eb('location_type', 'is', null), eb('location_type', '!=', 'in_transit')]))
          .where(this.tenantPredicate(actor))
          .limit(1)
          .executeTakeFirst();
        if (activeLoc?.id) fallbackLocationId = Number(activeLoc.id);

        for (const product of targetProducts) {
          if (Number(product.reserved_qty || 0) > 0) {
            throw new AppError(
              targetProducts.length > 1
                ? `لا يمكن أرشفة الصنف (${product.name}) لوجود كميات محجوزة في طلبيات معلقة. أتمم الطلبيات أولاً.`
                : 'لا يمكن أرشفة صنف عليه كميات محجوزة في طلبيات معلقة. أتمم الطلبيات أولاً.',
              'PRODUCT_HAS_RESERVATIONS',
              409,
            );
          }

          if (options?.zeroStock && Math.abs(Number(product.stock_qty || 0)) > 0.0001) {
            if (!this.hasPermission(actor, 'canAdjustInventory')) {
              throw new AppError('Stock zeroing requires canAdjustInventory permission', 'INVENTORY_ADJUSTMENT_FORBIDDEN', 403);
            }
            const locStocks = await trx.selectFrom('product_location_stock')
              .selectAll().where('product_id', '=', product.id)
              .where('qty', '>', 0).where(this.tenantPredicate(actor)).execute();
            assertFashionRemovedStockSafe(product, locStocks, undefined, { allowMismatchForZeroing: true });
            for (const locStock of locStocks) {
              if (locStock.location_id != null) await this.inventoryScope.assertLocationScope(Number(locStock.location_id), actor, false, 'write', trx);
            }

            const unitCost = Number(product.cost_price || 0);
            const bookDigits = await this.bookDigits(trx, actor);

            if (locStocks.length > 0) {
              for (const ls of locStocks) {
                const qtyToDeduct = Number(ls.qty || 0);
                if (qtyToDeduct <= 0) continue;

                const rawLocId = ls.location_id != null && Number(ls.location_id) > 0 ? Number(ls.location_id) : null;
                const effectiveLocId = rawLocId || (product.default_location_id ? Number(product.default_location_id) : fallbackLocationId);

                await applyStockDelta(trx, {
                  productId: Number(product.id),
                  locationId: rawLocId,
                  branchId: ls.branch_id ? Number(ls.branch_id) : undefined,
                  delta: -qtyToDeduct,
                  tenantId: this.tenantId(actor),
                  accountId: actor.accountId,
                  disableAutoDrain: true,
                  allowNegative: true,
                });

                const insertedMovement = await trx.insertInto('stock_movements').values({
                  product_id: product.id,
                  movement_type: 'deduct',
                  qty: -qtyToDeduct,
                  before_qty: qtyToDeduct,
                  after_qty: 0,
                  unit_cost: unitCost,
                  total_cost: stockMovementTotal(qtyToDeduct, unitCost, bookDigits),
                  reason: 'archive_stock_zeroing',
                  note: `تسوية وتصفير رصيد الصنف (${product.name}) عند الأرشفة والتعطيل`,
                  reference_type: 'inventory_adjustment',
                  reference_id: product.id,
                  location_id: effectiveLocId || null,
                  branch_id: ls.branch_id ? Number(ls.branch_id) : undefined,
                  created_by: actor.userId,
                  ...this.tenantFields(actor),
                } as any).returning('id').executeTakeFirst();

                if (insertedMovement?.id && this.accountingPosting) {
                  await this.accountingPosting.postInventoryAdjustment(trx, Number(insertedMovement.id), actor);
                }
              }
            } else {
              const globalQty = Number(product.stock_qty || 0);
              const effectiveLocId = product.default_location_id ? Number(product.default_location_id) : fallbackLocationId;

              await applyStockDelta(trx, {
                productId: Number(product.id),
                locationId: effectiveLocId || null,
                delta: -globalQty,
                tenantId: this.tenantId(actor),
                accountId: actor.accountId,
                disableAutoDrain: true,
                allowNegative: true,
              });

              const insertedMovement = await trx.insertInto('stock_movements').values({
                product_id: product.id,
                movement_type: 'deduct',
                qty: -globalQty,
                before_qty: globalQty,
                after_qty: 0,
                unit_cost: unitCost,
                total_cost: stockMovementTotal(globalQty, unitCost, bookDigits),
                reason: 'archive_stock_zeroing',
                note: `تسوية وتصفير رصيد الصنف (${product.name}) عند الأرشفة والتعطيل`,
                reference_type: 'inventory_adjustment',
                reference_id: product.id,
                location_id: effectiveLocId || null,
                created_by: actor.userId,
                ...this.tenantFields(actor),
              } as any).returning('id').executeTakeFirst();

              if (insertedMovement?.id && this.accountingPosting) {
                await this.accountingPosting.postInventoryAdjustment(trx, Number(insertedMovement.id), actor);
              }
            }

            if (locStocks.length > 0) {
              const sumDeducted = locStocks.reduce((sum, ls) => sum + Math.max(0, Number(ls.qty || 0)), 0);
              const remainingGlobal = Number(product.stock_qty || 0) - sumDeducted;
              if (Math.abs(remainingGlobal) > 0.0001) {
                await applyStockDelta(trx, {
                  productId: Number(product.id),
                  locationId: fallbackLocationId || null,
                  delta: -remainingGlobal,
                  tenantId: this.tenantId(actor),
                  accountId: actor.accountId,
                  disableAutoDrain: true,
                  allowNegative: true,
                });
              }
            }

            await trx.updateTable('products')
              .set({ catalog_updated_at: sql`NOW()`, updated_at: sql`NOW()` })
              .where('id', '=', product.id)
              .where(this.tenantPredicate(actor))
              .execute();

            await trx.updateTable('product_location_stock')
              .set({ qty: 0, updated_at: sql`NOW()` })
              .where('product_id', '=', product.id)
              .where(this.tenantPredicate(actor))
              .execute();
          }
        }
      } else {
        // Re-activating: check collisions
        for (const product of targetProducts) {
          const taken = await trx.selectFrom('products').select('id')
            .where('id', 'not in', targetProductIds).where('is_active', '=', true)
            .where(this.tenantPredicate(actor)).where((eb) => eb.or([
              sql<boolean>`LOWER(name) = ${String(product.name || '').toLowerCase()}`,
              ...(product.barcode ? [sql<boolean>`LOWER(barcode) = ${String(product.barcode).toLowerCase()}`] : []),
              ...(product.sku ? [sql<boolean>`LOWER(sku) = ${String(product.sku).toLowerCase()}`] : []),
            ])).executeTakeFirst();
          if (taken) {
            throw new AppError(`لا يمكن إعادة تنشيط الصنف (${product.name}): الاسم أو الباركود أو SKU مستخدم بالفعل`, 'PRODUCT_IDENTITY_CONFLICT', 409);
          }

          if (product.item_kind === 'fashion' && product.style_code) {
            const duplicate = await trx.selectFrom('products').select('id')
              .where('id', 'not in', targetProductIds).where('style_code', '=', product.style_code)
              .where('item_kind', '=', 'fashion').where('is_active', '=', true)
              .where(this.tenantPredicate(actor))
              .where(sql`LOWER(COALESCE(color, ''))`, '=', String(product.color || '').toLowerCase())
              .where(sql`LOWER(COALESCE(size, ''))`, '=', String(product.size || '').toLowerCase()).executeTakeFirst();
            if (duplicate) {
              throw new AppError(`اللون والمقاس للصنف (${product.name}) موجودان بالفعل في هذا الموديل النشط`, 'VARIANT_EXISTS', 409);
            }
          }
        }
      }

      await trx.updateTable('products')
        .set({ is_active: nextActive, catalog_updated_at: sql`NOW()`, updated_at: sql`NOW()` })
        .where('id', 'in', targetProductIds)
        .where(this.tenantPredicate(actor))
        .execute();

      return {
        name: initialProduct.name,
        styleCode: initialProduct.style_code,
        nextActive,
        count: targetProducts.length,
        isFashionGroup: isFashionGroupTarget && targetProducts.length > 1,
      };
    });

    (await import('../../storefront/storefront.service')).StorefrontService.invalidateGlobalCatalogCache();
    const actionLabel = result.nextActive
      ? (result.isFashionGroup ? 'تنشيط موديل كامل' : 'تنشيط صنف')
      : (result.isFashionGroup ? 'أرشفة موديل كامل' : 'أرشفة صنف');

    const auditLabel = result.isFashionGroup
      ? `${result.nextActive ? 'تم تنشيط' : 'تم أرشفة'} كامل موديل (${result.name} - كود ${result.styleCode}) بعدد ${result.count} متغيرات بواسطة ${actor.username}`
      : `${result.nextActive ? 'تم تنشيط' : 'تم أرشفة'} الصنف ${result.name} (#${id}) بواسطة ${actor.username}`;

    await this.audit.log(actionLabel, auditLabel, actor);

    const message = result.isFashionGroup
      ? (result.nextActive
          ? `تم تنشيط الموديل بالكامل بنجاح (${result.count} صنف/متغير)`
          : `تم أرشفة وتعطيل الموديل بالكامل بنجاح (${result.count} صنف/متغير)`)
      : (result.nextActive
          ? 'تم تنشيط الصنف بنجاح وإعادته لدليل الأصناف النشطة'
          : 'تم أرشفة وتعطيل الصنف بنجاح');

    return {
      ok: true,
      id,
      isActive: result.nextActive,
      count: result.count,
      message,
    };
  }

  async getProduct(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const canViewCost = this.canViewCostPrice(actor);
    const offerCapabilities = await this.getProductOfferColumnCapabilities();

    const product = await this.db
      .selectFrom('products')
      .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'products.id').onRef('b.tenant_id', '=', 'products.tenant_id').on('b.is_active', '=', true))
      .leftJoin('stock_locations as sl', (join) => join.onRef('sl.id', '=', 'products.default_location_id').on(this.tenantPredicate(actor, 'sl')))
      .select(['products.id', 'products.name', 'products.name_en', 'products.barcode', 'products.sku', 'products.catalog_updated_at', 'products.item_type', 'products.item_kind', 'products.style_code', 'products.color', 'products.size', 'products.bin_location', 'products.track_serials', 'products.category_id', 'products.supplier_id', 'products.cost_price', 'products.retail_price', 'products.wholesale_price', 'products.credit_price', 'products.consumer_price', 'products.min_selling_price', 'products.stock_qty', 'products.min_stock_qty', 'sl.id as default_location_id', 'products.notes', 'products.metadata', 'b.id as bom_id', 'sl.name as default_location_name', 'products.is_active', 'products.calories', 'products.allergens', 'products.is_spicy', 'products.is_vegetarian', 'products.is_gluten_free'])
      .where('products.id', '=', id)
      .where(this.tenantPredicate(actor, 'products'))
      .executeTakeFirst();

    if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);

    const productIds = [Number(product.id)];
    const relations = await this.fetchListProductRelations(productIds, offerCapabilities.hasMinQty, actor);
    const scopedStockResult = await this.resolveScopedStockByProduct(productIds, [], [product], actor);

    const mapped = this.mapListProducts([product], {
      canViewCost,
      scopedLocationId: null,
      scopedStockByProduct: scopedStockResult.stock,
      activeLocationsByProduct: scopedStockResult.locations,
      unitsByProduct: relations.unitsByProduct,
      offersByProduct: relations.offersByProduct,
      pricesByProduct: relations.pricesByProduct,
    });

    return mapped[0];
  }

  async bulkUpdateIcons(updates: Array<{ id: number; icon: string }>, actor: AuthContext): Promise<{ ok: boolean; updated: number }> {
    if (!updates || !updates.length) return { ok: true, updated: 0 };
    let count = 0;
    await this.db.transaction().execute(async (trx) => {
      for (const update of updates) {
        const prod = await trx
          .selectFrom('products')
          .select(['id', 'metadata'])
          .where('id', '=', Number(update.id))
          .where(this.tenantPredicate(actor))
          .executeTakeFirst();
        if (!prod) continue;

        let meta: Record<string, any> = {};
        if (typeof prod.metadata === 'string') {
          try { meta = JSON.parse(prod.metadata); } catch {}
        } else if (prod.metadata && typeof prod.metadata === 'object') {
          meta = { ...(prod.metadata as Record<string, any>) };
        }

        if (!update.icon || !String(update.icon).trim()) {
          delete meta.icon;
        } else {
          meta.icon = String(update.icon).trim();
        }

        await trx
          .updateTable('products')
          .set({ metadata: Object.keys(meta).length ? JSON.stringify(meta) : null })
          .where('id', '=', Number(update.id))
          .where(this.tenantPredicate(actor))
          .execute();
        count++;
      }
    });

    return { ok: true, updated: count };
  }
}
