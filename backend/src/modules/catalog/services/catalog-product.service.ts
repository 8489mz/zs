import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { NormalizedFashionVariant, NormalizedProductOffer, NormalizedUpsertProduct, UpsertProductDto, SaveFashionGroupDto } from '../dto/upsert-product.dto';
import { InventoryScopeService } from '../../inventory/services/inventory-scope.service';
import { normalizeArabicInput, normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../accounting/accounting-tenant-foundation.service';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { assertFashionExpectedStock, assertFashionRemovedStockSafe, fashionLocationAccessMode } from '../engines/fashion-stock-safety.engine';
import { stockMovementTotal } from '../engines/stock-movement-total.engine';
import { MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { StorefrontMediaService } from '../../storefront/storefront-media.service';
import { CatalogProductListService } from './catalog-product-list.service';
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

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>, private readonly audit: AuditService,
    private readonly inventoryScope: InventoryScopeService,
    @Optional() private readonly accountingPosting?: AccountingPostingService,
    @Optional() private readonly accountingFoundation?: AccountingTenantFoundationService,
    @Optional() private readonly mediaService?: StorefrontMediaService) {
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
      bookDigits: this.postingService.bookDigits.bind(this),
      getProductOfferColumnCapabilities: this.offersService.getProductOfferColumnCapabilities.bind(this),
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
  }

  private async ensureOpeningStockAccounts(actor: AuthContext): Promise<void> {
    return this.postingService.ensureOpeningStockAccounts(actor);
  }

  private async bookDigits(executor: ProductWriteExecutor, actor: AuthContext): Promise<MoneyDigits> {
    return this.postingService.bookDigits(executor, actor);
  }

  private async postOpeningStock(trx: ProductWriteExecutor, productId: number, qty: number, unitCost: number,
    locationId: number | null, actor: AuthContext): Promise<void> {
    return this.postingService.postOpeningStock(trx, productId, qty, unitCost, locationId, actor);
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

  private async getProductOfferColumnCapabilities(): Promise<ProductOfferColumnCapabilities> {
    return this.offersService.getProductOfferColumnCapabilities();
  }

  private ensureAdvancedOffersSupported(payload: NormalizedUpsertProduct, capabilities: ProductOfferColumnCapabilities): void {
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

  async getPosCatalogVersion(actor: AuthContext): Promise<{ version: string; totalCount: number; lastUpdatedAt: string }> {
    return this.posService.getPosCatalogVersion(actor);
  }


  async listPosProducts(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.posService.listPosProducts(query, actor);
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

  private mapOffersByProduct(offers: ProductOfferReadRow[]): Map<string, Record<string, unknown>[]> {
    return this.posService.mapOffersByProduct(offers);
  }

  private async resolveScopedStockByProduct(productIds: number[], eligibleLocationIds: number[], products: Array<Pick<ProductRow, 'id' | 'stock_qty'>>, actor: AuthContext, isFullCatalog = false): Promise<{ stock: Map<string, number>, locations: Map<string, number[]> }> {
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
