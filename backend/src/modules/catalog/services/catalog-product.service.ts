import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { NormalizedUpsertProduct, UpsertProductDto, SaveFashionGroupDto } from '../dto/upsert-product.dto';
import { InventoryScopeService } from '../../inventory/services/inventory-scope.service';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { stockMovementTotal } from '../engines/stock-movement-total.engine';
import { MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { StorefrontMediaService } from '../../storefront/storefront-media.service';
import { CatalogProductListService } from './catalog-product-list.service';
import { CatalogProductArchiveService } from './catalog-product-archive.service';
import { CatalogProductWriteService } from './catalog-product-write.service';
import { CatalogProductFashionService } from './catalog-product-fashion.service';
import { CatalogProductPostingService } from './catalog-product-posting.service';
import { CatalogProductOffersService } from './catalog-product-offers.service';
import { CatalogProductStyleCodeService } from './catalog-product-style-code.service';
import { CatalogProductPosService } from './catalog-product-pos.service';
import {
  CustomerPriceReadRow,
  PosProductLookupRow,
  ProductCountRow,
  ProductOfferColumnCapabilities,
  ProductOfferReadRow,
  ProductRow,
  ProductUnitReadRow,
  ProductUnitSearchRow,
  ProductWriteExecutor,
} from './catalog-product-types';

@Injectable()
export class CatalogProductService {
  private readonly offersService: CatalogProductOffersService;
  private readonly postingService: CatalogProductPostingService;
  private readonly styleCodeService: CatalogProductStyleCodeService;
  private readonly posService: CatalogProductPosService;
  private readonly listService: CatalogProductListService;
  private readonly archiveService: CatalogProductArchiveService;
  private readonly writeService: CatalogProductWriteService;
  private readonly fashionService: CatalogProductFashionService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly inventoryScope: InventoryScopeService,
    @Optional() private readonly accountingPosting?: AccountingPostingService,
    @Optional() private readonly accountingFoundation?: AccountingTenantFoundationService,
    @Optional() private readonly mediaService?: StorefrontMediaService,
  ) {
    this.postingService = new CatalogProductPostingService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      accountingFoundation: this.accountingFoundation,
      tenantId: this.tenantId.bind(this),
      accountId: this.accountId.bind(this),
    });
    this.offersService = new CatalogProductOffersService({
      db: this.db,
    });
    this.styleCodeService = new CatalogProductStyleCodeService({
      db: this.db,
      tenantPredicate: this.tenantPredicate.bind(this),
    });
    this.posService = new CatalogProductPosService({
      db: this.db,
      inventoryScope: this.inventoryScope,
      bookDigits: this.postingService.bookDigits.bind(this.postingService),
      getProductOfferColumnCapabilities: this.offersService.getProductOfferColumnCapabilities.bind(this.offersService),
      productIdAny: this.productIdAny.bind(this),
      normalizeUnitName: this.normalizeUnitName.bind(this),
      getListProductStock: this.getListProductStock.bind(this),
      tenantId: this.tenantId.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
    });
    this.listService = new CatalogProductListService({
      db: this.db,
      inventoryScope: this.inventoryScope,
      tenantPredicate: this.tenantPredicate.bind(this),
      tenantId: this.tenantId.bind(this),
      canViewCostPrice: this.canViewCostPrice.bind(this),
      productIdAny: this.productIdAny.bind(this),
      normalizeUnitName: this.normalizeUnitName.bind(this),
      getListProductStock: this.getListProductStock.bind(this),
      resolveScopedStockByProduct: this.posService.resolveScopedStockByProduct.bind(this.posService),
      mapOffersByProduct: this.posService.mapOffersByProduct.bind(this.posService),
      getProductOfferColumnCapabilities: this.offersService.getProductOfferColumnCapabilities.bind(this.offersService),
    });
    this.archiveService = new CatalogProductArchiveService({
      db: this.db,
      audit: this.audit,
      inventoryScope: this.inventoryScope,
      accountingPosting: this.accountingPosting,
      tenantPredicate: this.tenantPredicate.bind(this),
      hasPermission: this.hasPermission.bind(this),
      tenantId: this.tenantId.bind(this),
      tenantFields: this.tenantFields.bind(this),
      canViewCostPrice: this.canViewCostPrice.bind(this),
      bookDigits: this.postingService.bookDigits.bind(this.postingService),
      getProductOfferColumnCapabilities: this.offersService.getProductOfferColumnCapabilities.bind(this.offersService),
      resolveScopedStockByProduct: this.posService.resolveScopedStockByProduct.bind(this.posService),
      fetchListProductRelations: this.listService.fetchListProductRelations.bind(this.listService),
      mapListProducts: this.listService.mapListProducts.bind(this.listService),
    });
    this.writeService = new CatalogProductWriteService({
      db: this.db,
      audit: this.audit,
      inventoryScope: this.inventoryScope,
      mediaService: this.mediaService,
      tenantPredicate: this.tenantPredicate.bind(this),
      hasPermission: this.hasPermission.bind(this),
      tenantId: this.tenantId.bind(this),
      accountId: this.accountId.bind(this),
      tenantFields: this.tenantFields.bind(this),
      normalizeUnitName: this.normalizeUnitName.bind(this),
      bookDigits: this.postingService.bookDigits.bind(this.postingService),
      ensureOpeningStockAccounts: this.postingService.ensureOpeningStockAccounts.bind(this.postingService),
      postOpeningStock: this.postingService.postOpeningStock.bind(this.postingService),
      getProductOfferColumnCapabilities: this.offersService.getProductOfferColumnCapabilities.bind(this.offersService),
      ensureAdvancedOffersSupported: this.offersService.ensureAdvancedOffersSupported.bind(this.offersService),
      coerceNewStyleCode: this.styleCodeService.coerceNewStyleCode.bind(this.styleCodeService),
      ensureStyleCodeAvailable: this.styleCodeService.ensureStyleCodeAvailable.bind(this.styleCodeService),
      getProduct: this.archiveService.getProduct.bind(this.archiveService),
    });
    this.fashionService = new CatalogProductFashionService({
      db: this.db,
      audit: this.audit,
      inventoryScope: this.inventoryScope,
      accountingPosting: this.accountingPosting,
      mediaService: this.mediaService,
      tenantPredicate: this.tenantPredicate.bind(this),
      hasPermission: this.hasPermission.bind(this),
      tenantId: this.tenantId.bind(this),
      tenantFields: this.tenantFields.bind(this),
      bookDigits: this.postingService.bookDigits.bind(this.postingService),
      postOpeningStock: this.postingService.postOpeningStock.bind(this.postingService),
      ensureOpeningStockAccounts: this.postingService.ensureOpeningStockAccounts.bind(this.postingService),
      getProductOfferColumnCapabilities: this.offersService.getProductOfferColumnCapabilities.bind(this.offersService),
      ensureAdvancedOffersSupported: this.offersService.ensureAdvancedOffersSupported.bind(this.offersService),
      coerceNewStyleCode: this.styleCodeService.coerceNewStyleCode.bind(this.styleCodeService),
      normalizeProductPayload: this.writeService.normalizeProductPayload.bind(this.writeService),
      replaceProductRelations: this.writeService.replaceProductRelations.bind(this.writeService),
      ensureCategoryAndSupplierInTenant: this.writeService.ensureCategoryAndSupplierInTenant.bind(this.writeService),
      ensureCustomerPricesInTenant: this.writeService.ensureCustomerPricesInTenant.bind(this.writeService),
    });
  }

  private async ensureOpeningStockAccounts(actor: AuthContext): Promise<void> {
    return this.postingService.ensureOpeningStockAccounts(actor);
  }

  private async bookDigits(executor: ProductWriteExecutor, actor: AuthContext): Promise<MoneyDigits> {
    return this.postingService.bookDigits(executor, actor);
  }

  private async postOpeningStock(
    trx: ProductWriteExecutor,
    productId: number,
    qty: number,
    unitCost: number,
    locationId: number | null,
    actor: AuthContext,
  ): Promise<void> {
    return this.postingService.postOpeningStock(trx, productId, qty, unitCost, locationId, actor);
  }

  private scope(actor: AuthContext) {
    return requireTenantScope(actor);
  }

  private canViewCostPrice(actor: AuthContext): boolean {
    if (actor.role === 'super_admin' || actor.role === 'admin') return true;
    const perms = actor.permissions || [];
    return (
      perms.includes('canViewProfit') ||
      perms.includes('purchases') ||
      perms.includes('inventory') ||
      perms.includes('canViewCost')
    );
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

  private async getProductOfferColumnCapabilities(): Promise<ProductOfferColumnCapabilities> {
    return this.offersService.getProductOfferColumnCapabilities();
  }

  private ensureAdvancedOffersSupported(
    payload: NormalizedUpsertProduct,
    capabilities: ProductOfferColumnCapabilities,
  ): void {
    this.offersService.ensureAdvancedOffersSupported(payload, capabilities);
  }

  async getNextStyleCode(actor: AuthContext): Promise<{ styleCode: string }> {
    return this.styleCodeService.getNextStyleCode(actor);
  }

  async allocateStyleCode(actor: AuthContext): Promise<{ styleCode: string }> {
    return this.styleCodeService.allocateStyleCode(actor);
  }

  private coerceNewStyleCode(rawValue: string): string {
    return this.styleCodeService.coerceNewStyleCode(rawValue);
  }

  private async ensureStyleCodeAvailable(
    styleCode: string | null | undefined,
    itemKind: 'standard' | 'fashion' | null | undefined,
    actor: AuthContext,
    excludeProductIds: number[] = [],
    drafts: Pick<NormalizedUpsertProduct, 'color' | 'size'>[] = [],
  ): Promise<void> {
    return this.styleCodeService.ensureStyleCodeAvailable(styleCode, itemKind, actor, excludeProductIds, drafts);
  }

  async listProducts(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.listService.listProducts(query, actor);
  }

  async getPosCatalogVersion(
    actor: AuthContext,
  ): Promise<{ version: string; totalCount: number; lastUpdatedAt: string }> {
    return this.posService.getPosCatalogVersion(actor);
  }

  async listPosProducts(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.posService.listPosProducts(query, actor);
  }

  private normalizeUnitName(name: unknown): string {
    const text = String(name || '').trim();
    if (!text) return 'قطعة';
    const lower = text.toLowerCase();
    if (['piece', 'pieces', 'pcs', 'pc', 'item', 'items', 'unit', 'units', 'قطعه', 'حبة', 'حبه'].includes(lower))
      return 'قطعة';
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

  private mapOffersByProduct(offers: ProductOfferReadRow[]): Map<string, Record<string, unknown>[]> {
    return this.posService.mapOffersByProduct(offers);
  }

  private async resolveScopedStockByProduct(
    productIds: number[],
    eligibleLocationIds: number[],
    products: Array<Pick<ProductRow, 'id' | 'stock_qty'>>,
    actor: AuthContext,
    isFullCatalog = false,
  ): Promise<{ stock: Map<string, number>; locations: Map<string, number[]> }> {
    return this.posService.resolveScopedStockByProduct(productIds, eligibleLocationIds, products, actor, isFullCatalog);
  }

  private async fetchListProductRelations(pagedIds: number[], hasMinQty: boolean, actor: AuthContext) {
    return this.listService.fetchListProductRelations(pagedIds, hasMinQty, actor);
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
    return this.listService.mapListProducts(pagedBaseRows, context);
  }

  private getListProductStock(
    product: Pick<ProductRow, 'id' | 'stock_qty'>,
    scopedLocationId: number | null,
    scopedStockByProduct: Map<string, number>,
  ) {
    if (!scopedLocationId) return Number(product.stock_qty || 0);
    return Number(scopedStockByProduct.get(String(product.id)) || 0);
  }
  private normalizeProductPayload(payload: UpsertProductDto): NormalizedUpsertProduct {
    return this.writeService.normalizeProductPayload(payload);
  }

  private async ensureCategoryAndSupplierInTenant(payload: NormalizedUpsertProduct, actor: AuthContext): Promise<void> {
    return this.writeService.ensureCategoryAndSupplierInTenant(payload, actor);
  }

  private async ensureCustomerPricesInTenant(payload: NormalizedUpsertProduct, actor: AuthContext): Promise<void> {
    return this.writeService.ensureCustomerPricesInTenant(payload, actor);
  }

  private async replaceProductRelations(
    db: ProductWriteExecutor,
    productId: number,
    payload: NormalizedUpsertProduct,
    actor: AuthContext,
  ): Promise<void> {
    return this.writeService.replaceProductRelations(db, productId, payload, actor);
  }

  async saveFashionGroup(
    oldStyleCode: string,
    payload: SaveFashionGroupDto,
    actor: AuthContext,
  ): Promise<{ ok: boolean; updated: number; created: number; archived: number }> {
    return this.fashionService.saveFashionGroup(oldStyleCode, payload, actor);
  }

  async createProduct(payload: UpsertProductDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.writeService.createProduct(payload, actor);
  }

  async updateProduct(id: number, payload: UpsertProductDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.writeService.updateProduct(id, payload, actor);
  }

  async deleteProduct(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.writeService.deleteProduct(id, actor);
  }

  async toggleProductArchive(
    id: number,
    actor: AuthContext,
    options?: { zeroStock?: boolean; archiveEntireGroup?: boolean },
  ): Promise<Record<string, unknown>> {
    return this.archiveService.toggleProductArchive(id, actor, options);
  }

  async getProduct(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.archiveService.getProduct(id, actor);
  }

  async bulkUpdateIcons(
    updates: Array<{ id: number; icon: string }>,
    actor: AuthContext,
  ): Promise<{ ok: boolean; updated: number }> {
    return this.archiveService.bulkUpdateIcons(updates, actor);
  }
}
