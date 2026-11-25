/**
 * CatalogProductWriteService — slice P6 of the catalog-product split.
 * Pure move of 9 methods from CatalogProductService (write: the product
 * create/update/delete paths + their payload/identity/category/price/
 * relations helpers). No behavior change: the bodies are byte-identical
 * except 4 visibility flips — normalizeProductPayload,
 * ensureCategoryAndSupplierInTenant, ensureCustomerPricesInTenant and
 * replaceProductRelations are PUBLIC here (private in the facade delegate)
 * because P8 saveFashionGroup binds them at ITS merge; the facade keeps
 * thin private delegates with the same names/signatures, so the facade
 * public surface is unchanged. buildVariantLabel (6L, cycle-break move
 * from fashion — sole caller createProduct) and
 * ensureProductIdentityAvailable stay private with NO facade delegate
 * (slice-internal only). createProduct/updateProduct/deleteProduct are
 * already public in the facade, so there is no visibility change for them.
 * Deps: db + audit + inventoryScope (required ctor deps) + mediaService?
 * (optional — normalizeImageRef in createProduct/updateProduct, guarded by
 * `if (this.mediaService)`, the optional dep itself, never required, never
 * defaulted) + kernel tenantPredicate / hasPermission / tenantId /
 * accountId / tenantFields / normalizeUnitName (bound, HR kernel pattern)
 * + cross-slice bookDigits / ensureOpeningStockAccounts / postOpeningStock
 * (P1) / getProductOfferColumnCapabilities / ensureAdvancedOffersSupported
 * (P2) / coerceNewStyleCode / ensureStyleCodeAvailable (P3) / getProduct
 * (P7), bound from the facade's delegates at generation.
 * MERGE NOTE: at merge, repoint the cross-slice bindings to the slice
 * instances (HR H1 pattern: this.postingService.bookDigits.bind(...),
 * this.offersService.getProductOfferColumnCapabilities.bind(...) +
 * .ensureAdvancedOffersSupported.bind(...),
 * this.styleCodeService.coerceNewStyleCode.bind(...) +
 * .ensureStyleCodeAvailable.bind(...),
 * this.archiveService.getProduct.bind(...)); P7 merges BEFORE P6 precisely
 * because createProduct (L2693) + updateProduct (L2794) call getProduct
 * inside their transaction callbacks. The shared type aliases come from
 * ./catalog-product-types (ProductWriteExecutor / ProductOfferColumnCapabilities
 * / MoneyDigits) — P1 creates that module at the first merge, so P1 MUST
 * export the 9 aliases.
 * No clock sites in this slice. Guard: toFixed2 = 0, inlineRound = 0.
 * Driving specs: catalog-product-save drives createProduct end-to-end on
 * PGlite (createProduct + updateProduct + deleteProduct all driven — merge
 * RED). catalog-product-save Case 6 source pin (getProduct( count 2,
 * create+update return via getProduct) is MERGE-owned: repoint the read to
 * the P6 slice file with the updated receiver spelling.
 * PGlite note (prep §7.6, record only, do not fix): createProduct L2605
 * ensureStyleCodeAvailable + L2693 getProduct, updateProduct L2794 getProduct
 * read this.db inside the transaction callbacks — empirically benign
 * (catalog-product-save drives createProduct end-to-end on real PGlite,
 * critical chain 207/207), first suspects if the merged proof hangs.
 * PREP NOTE: prep §6.5 lists "P7 deleteProduct" as a driven method —
 * deleteProduct is L2797, a P6 (write) method, not P7 (same class of prep
 * error the P7 agent flagged for its own slice); P6's driven methods are
 * createProduct + updateProduct + deleteProduct.
 */

import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { type RawBuilder } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { InventoryScopeService } from '../../inventory/services/inventory-scope.service';
import { StorefrontMediaService } from '../../storefront/storefront-media.service';
import { NormalizedFashionVariant, NormalizedProductOffer, NormalizedUpsertProduct, UpsertProductDto } from '../dto/upsert-product.dto';
import { normalizeArabicInput, normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { recordStockMovement } from '../../../common/utils/stock-movement-writer';
import { MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { ProductOfferColumnCapabilities, ProductWriteExecutor } from './catalog-product-types';

export interface CatalogProductWriteDeps {
  db: Kysely<Database>;
  audit: AuditService;
  inventoryScope: InventoryScopeService;
  mediaService?: StorefrontMediaService;
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  hasPermission: (actor: AuthContext, permission: string) => boolean;
  tenantId: (actor: AuthContext) => string;
  accountId: (actor: AuthContext) => string;
  tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  normalizeUnitName: (name: unknown) => string;
  bookDigits: (executor: ProductWriteExecutor, actor: AuthContext) => Promise<MoneyDigits>;
  ensureOpeningStockAccounts: (actor: AuthContext) => Promise<void>;
  postOpeningStock: (
    trx: ProductWriteExecutor,
    productId: number,
    qty: number,
    unitCost: number,
    locationId: number | null,
    actor: AuthContext,
  ) => Promise<void>;
  getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;
  ensureAdvancedOffersSupported: (payload: NormalizedUpsertProduct, capabilities: ProductOfferColumnCapabilities) => void;
  coerceNewStyleCode: (rawValue: string) => string;
  ensureStyleCodeAvailable: (
    styleCode: string | null | undefined,
    itemKind: 'standard' | 'fashion' | null | undefined,
    actor: AuthContext,
    excludeProductIds?: number[],
    drafts?: Pick<NormalizedUpsertProduct, 'color' | 'size'>[],
  ) => Promise<void>;
  getProduct: (id: number, actor: AuthContext) => Promise<Record<string, unknown>>;
}

@Injectable()
export class CatalogProductWriteService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly inventoryScope: InventoryScopeService;
  private readonly mediaService?: StorefrontMediaService;
  private readonly tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly hasPermission: (actor: AuthContext, permission: string) => boolean;
  private readonly tenantId: (actor: AuthContext) => string;
  private readonly accountId: (actor: AuthContext) => string;
  private readonly tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  private readonly normalizeUnitName: (name: unknown) => string;
  private readonly bookDigits: (executor: ProductWriteExecutor, actor: AuthContext) => Promise<MoneyDigits>;
  private readonly ensureOpeningStockAccounts: (actor: AuthContext) => Promise<void>;
  private readonly postOpeningStock: (
    trx: ProductWriteExecutor,
    productId: number,
    qty: number,
    unitCost: number,
    locationId: number | null,
    actor: AuthContext,
  ) => Promise<void>;
  private readonly getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;
  private readonly ensureAdvancedOffersSupported: (payload: NormalizedUpsertProduct, capabilities: ProductOfferColumnCapabilities) => void;
  private readonly coerceNewStyleCode: (rawValue: string) => string;
  private readonly ensureStyleCodeAvailable: (
    styleCode: string | null | undefined,
    itemKind: 'standard' | 'fashion' | null | undefined,
    actor: AuthContext,
    excludeProductIds?: number[],
    drafts?: Pick<NormalizedUpsertProduct, 'color' | 'size'>[],
  ) => Promise<void>;
  private readonly getProduct: (id: number, actor: AuthContext) => Promise<Record<string, unknown>>;

  constructor(deps: CatalogProductWriteDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.inventoryScope = deps.inventoryScope;
    this.mediaService = deps.mediaService;
    this.tenantPredicate = deps.tenantPredicate;
    this.hasPermission = deps.hasPermission;
    this.tenantId = deps.tenantId;
    this.accountId = deps.accountId;
    this.tenantFields = deps.tenantFields;
    this.normalizeUnitName = deps.normalizeUnitName;
    this.bookDigits = deps.bookDigits;
    this.ensureOpeningStockAccounts = deps.ensureOpeningStockAccounts;
    this.postOpeningStock = deps.postOpeningStock;
    this.getProductOfferColumnCapabilities = deps.getProductOfferColumnCapabilities;
    this.ensureAdvancedOffersSupported = deps.ensureAdvancedOffersSupported;
    this.coerceNewStyleCode = deps.coerceNewStyleCode;
    this.ensureStyleCodeAvailable = deps.ensureStyleCodeAvailable;
    this.getProduct = deps.getProduct;
  }

  normalizeProductPayload(payload: UpsertProductDto): NormalizedUpsertProduct {
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
      halfWholesalePrice: payload.halfWholesalePrice === undefined ? undefined : payload.halfWholesalePrice === null ? null : Number(payload.halfWholesalePrice),
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

  async ensureCategoryAndSupplierInTenant(payload: NormalizedUpsertProduct, actor: AuthContext): Promise<void> {
    const tenantId = this.tenantId(actor);
    if (payload.itemType === 'service' && !payload.categoryId) {
      const existingCategory = await this.db
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

  async ensureCustomerPricesInTenant(payload: NormalizedUpsertProduct, actor: AuthContext): Promise<void> {
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

  async replaceProductRelations(db: ProductWriteExecutor, productId: number, payload: NormalizedUpsertProduct, actor: AuthContext): Promise<void> {
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
            half_wholesale_price: draft.halfWholesalePrice ?? null,
            credit_price: draft.creditPrice ?? null,
            consumer_price: draft.consumerPrice ?? null,
            min_selling_price: draft.minSellingPrice ?? null,
            // Phase 1 A4: seeded 0 — the opening-balance writer below sets
            // the global through the ledger (a preset would double it).
            stock_qty: 0,
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
          // Phase 1 A4 (INV-PHASE1-A4-OPENING-BALANCES-LEDGER): the opening
          // balance goes through the row-writer — the ledger sets the
          // location balance AND the reconciled global, and writes the one
          // row from the returned scopeBefore/scopeAfter. The product above
          // is inserted with stock_qty 0: presetting it would make the
          // ledger mint the preset into the unassigned pool and double the
          // stock (see the A4 spec's note). The GL posting below stays
          // unchanged.
          await recordStockMovement(trx, {
            productId,
            locationId: resolvedLocationId,
            delta: initialStockQty,
            tenantId: this.tenantId(actor),
            accountId: this.accountId(actor),
            movementType: 'opening_balance',
            referenceType: 'product',
            referenceId: productId,
            reason: 'opening_balance',
            note: 'رصيد افتتاحي عند إنشاء الصنف',
            unitCost: Number(draft.costPrice || 0),
            moneyDigits: bookDigits,
            createdBy: actor.userId,
          });
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
        half_wholesale_price: normalized.halfWholesalePrice === undefined ? (existing as any).half_wholesale_price : (normalized.halfWholesalePrice ?? null),
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
}
