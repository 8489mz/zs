/**
 * CatalogProductArchiveService — slice P7 of the catalog-product split.
 * Pure move of 3 methods from CatalogProductService (archive: the product
 * archive toggle, the single-product read, and the bulk icon update). No
 * behavior change: the bodies are byte-identical — all 3 methods are
 * already PUBLIC in the facade, so there is no visibility change at all
 * (the facade keeps thin public delegates with the same names/signatures).
 * Deps: db + audit + inventoryScope (required ctor deps) + accountingPosting?
 * (optional — postInventoryAdjustment x2 in toggleProductArchive is guarded
 * by `if (insertedMovement?.id && this.accountingPosting)`, the optional
 * dep itself, never required, never defaulted) + kernel tenantPredicate /
 * hasPermission / tenantId / tenantFields / canViewCostPrice (bound, HR
 * kernel pattern) + cross-slice bookDigits (P1) / getProductOfferColumnCapabilities
 * (P2) / resolveScopedStockByProduct (P4) / fetchListProductRelations +
 * mapListProducts (P5), bound from the facade's delegates at generation.
 * MERGE NOTE: at merge, repoint the cross-slice bindings to the slice
 * instances (HR H1 pattern: this.postingService.bookDigits.bind(...),
 * this.offersService.getProductOfferColumnCapabilities.bind(...),
 * this.posService.resolveScopedStockByProduct.bind(...),
 * this.listService.fetchListProductRelations.bind(...) +
 * this.listService.mapListProducts.bind(...)); the facade delegates keep
 * them working until then. P6 binds this slice's getProduct at ITS merge
 * (P7 merges before P6 precisely because createProduct/updateProduct call
 * getProduct inside their transaction callbacks).
 * No clock sites in this slice. Guard: toFixed2 = 0, inlineRound = 0.
 * No type-alias refs in the moved text; the catalog-product-types import is
 * type-only, for the Deps interface (ProductRow / ProductWriteExecutor /
 * ProductOfferColumnCapabilities) — P1 creates that module at the first merge.
 * Driving spec: catalog-product-save (getProduct, Case 6 `getProduct(` count
 * — merge-owned repoint). No spec pins toggleProductArchive /
 * bulkUpdateIcons directly. PREP NOTE: prep §6.5 lists "P7 deleteProduct" —
 * deleteProduct is L2797, a P6 (write) method, not P7; P7's driven method is
 * getProduct only.
 */

import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { type RawBuilder } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../../common/errors/app-error';
import { InventoryScopeService } from '../../inventory/services/inventory-scope.service';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import { assertFashionRemovedStockSafe } from '../engines/fashion-stock-safety.engine';
import { stockMovementTotal } from '../engines/stock-movement-total.engine';
import { MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { ProductRow, ProductWriteExecutor, ProductOfferColumnCapabilities } from './catalog-product-types';

export interface CatalogProductArchiveDeps {
  db: Kysely<Database>;
  audit: AuditService;
  inventoryScope: InventoryScopeService;
  accountingPosting?: AccountingPostingService;
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  hasPermission: (actor: AuthContext, permission: string) => boolean;
  tenantId: (actor: AuthContext) => string;
  tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  canViewCostPrice: (actor: AuthContext) => boolean;
  bookDigits: (executor: ProductWriteExecutor, actor: AuthContext) => Promise<MoneyDigits>;
  getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;
  resolveScopedStockByProduct: (
    productIds: number[],
    eligibleLocationIds: number[],
    products: Array<Pick<ProductRow, 'id' | 'stock_qty'>>,
    actor: AuthContext,
    isFullCatalog?: boolean,
  ) => Promise<{ stock: Map<string, number>; locations: Map<string, number[]> }>;
  fetchListProductRelations: (
    pagedIds: number[],
    hasMinQty: boolean,
    actor: AuthContext,
  ) => Promise<{
    unitsByProduct: Map<string, Record<string, unknown>[]>;
    offersByProduct: Map<string, Record<string, unknown>[]>;
    pricesByProduct: Map<string, Record<string, unknown>[]>;
  }>;
  mapListProducts: (
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
  ) => Record<string, unknown>[];
}

@Injectable()
export class CatalogProductArchiveService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly inventoryScope: InventoryScopeService;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly hasPermission: (actor: AuthContext, permission: string) => boolean;
  private readonly tenantId: (actor: AuthContext) => string;
  private readonly tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  private readonly canViewCostPrice: (actor: AuthContext) => boolean;
  private readonly bookDigits: (executor: ProductWriteExecutor, actor: AuthContext) => Promise<MoneyDigits>;
  private readonly getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;
  private readonly resolveScopedStockByProduct: (
    productIds: number[],
    eligibleLocationIds: number[],
    products: Array<Pick<ProductRow, 'id' | 'stock_qty'>>,
    actor: AuthContext,
    isFullCatalog?: boolean,
  ) => Promise<{ stock: Map<string, number>; locations: Map<string, number[]> }>;
  private readonly fetchListProductRelations: (
    pagedIds: number[],
    hasMinQty: boolean,
    actor: AuthContext,
  ) => Promise<{
    unitsByProduct: Map<string, Record<string, unknown>[]>;
    offersByProduct: Map<string, Record<string, unknown>[]>;
    pricesByProduct: Map<string, Record<string, unknown>[]>;
  }>;
  private readonly mapListProducts: (
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
  ) => Record<string, unknown>[];

  constructor(deps: CatalogProductArchiveDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.inventoryScope = deps.inventoryScope;
    this.accountingPosting = deps.accountingPosting;
    this.tenantPredicate = deps.tenantPredicate;
    this.hasPermission = deps.hasPermission;
    this.tenantId = deps.tenantId;
    this.tenantFields = deps.tenantFields;
    this.canViewCostPrice = deps.canViewCostPrice;
    this.bookDigits = deps.bookDigits;
    this.getProductOfferColumnCapabilities = deps.getProductOfferColumnCapabilities;
    this.resolveScopedStockByProduct = deps.resolveScopedStockByProduct;
    this.fetchListProductRelations = deps.fetchListProductRelations;
    this.mapListProducts = deps.mapListProducts;
  }

  async toggleProductArchive(
    id: number,
    actor: AuthContext,
    options?: { zeroStock?: boolean; archiveEntireGroup?: boolean },
  ): Promise<Record<string, unknown>> {
    const result = await this.db.transaction().execute(async (trx) => {
      const initialProduct = await trx
        .selectFrom('products')
        .selectAll()
        .where('id', '=', id)
        .where(this.tenantPredicate(actor))
        .executeTakeFirst();
      if (!initialProduct) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      const nextActive = !initialProduct.is_active;

      let targetProductIds = [id];
      const isFashionGroupTarget = Boolean(
        options?.archiveEntireGroup && initialProduct.item_kind === 'fashion' && initialProduct.style_code,
      );

      if (isFashionGroupTarget) {
        const siblings = await trx
          .selectFrom('products')
          .select('id')
          .where('style_code', '=', initialProduct.style_code)
          .where('item_kind', '=', 'fashion')
          .where('is_active', '=', initialProduct.is_active)
          .where(this.tenantPredicate(actor))
          .execute();
        targetProductIds = siblings.map((s) => Number(s.id));
      }

      // Canonical lock order: sort product IDs ascending to prevent deadlocks
      targetProductIds.sort((a, b) => a - b);

      const targetProducts = await trx
        .selectFrom('products')
        .selectAll()
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
        const activeLoc = await trx
          .selectFrom('stock_locations')
          .select('id')
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
              throw new AppError(
                'Stock zeroing requires canAdjustInventory permission',
                'INVENTORY_ADJUSTMENT_FORBIDDEN',
                403,
              );
            }
            const locStocks = await trx
              .selectFrom('product_location_stock')
              .selectAll()
              .where('product_id', '=', product.id)
              .where('qty', '>', 0)
              .where(this.tenantPredicate(actor))
              .execute();
            assertFashionRemovedStockSafe(product, locStocks, undefined, { allowMismatchForZeroing: true });
            for (const locStock of locStocks) {
              if (locStock.location_id != null)
                await this.inventoryScope.assertLocationScope(Number(locStock.location_id), actor, false, 'write', trx);
            }

            const unitCost = Number(product.cost_price || 0);
            const bookDigits = await this.bookDigits(trx, actor);

            if (locStocks.length > 0) {
              for (const ls of locStocks) {
                const qtyToDeduct = Number(ls.qty || 0);
                if (qtyToDeduct <= 0) continue;

                const rawLocId = ls.location_id != null && Number(ls.location_id) > 0 ? Number(ls.location_id) : null;
                const effectiveLocId =
                  rawLocId || (product.default_location_id ? Number(product.default_location_id) : fallbackLocationId);

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

                const insertedMovement = await trx
                  .insertInto('stock_movements')
                  .values({
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
                  } as any)
                  .returning('id')
                  .executeTakeFirst();

                if (insertedMovement?.id && this.accountingPosting) {
                  await this.accountingPosting.postInventoryAdjustment(trx, Number(insertedMovement.id), actor);
                }
              }
            } else {
              const globalQty = Number(product.stock_qty || 0);
              const effectiveLocId = product.default_location_id
                ? Number(product.default_location_id)
                : fallbackLocationId;

              await applyStockDelta(trx, {
                productId: Number(product.id),
                locationId: effectiveLocId || null,
                delta: -globalQty,
                tenantId: this.tenantId(actor),
                accountId: actor.accountId,
                disableAutoDrain: true,
                allowNegative: true,
              });

              const insertedMovement = await trx
                .insertInto('stock_movements')
                .values({
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
                } as any)
                .returning('id')
                .executeTakeFirst();

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

                // INV-STOCK-MOVEMENTS-ARCHIVE-ROW: the residual deduct
                // moves a real balance, so it writes its own row,
                // mirroring the sibling deduct rows above (same type,
                // reason, reference, cost and posting call). Before
                // this row the balance moved with no audit trail.
                const insertedMovement = await trx
                  .insertInto('stock_movements')
                  .values({
                    product_id: product.id,
                    movement_type: 'deduct',
                    qty: -remainingGlobal,
                    before_qty: remainingGlobal,
                    after_qty: 0,
                    unit_cost: unitCost,
                    total_cost: stockMovementTotal(remainingGlobal, unitCost, bookDigits),
                    reason: 'archive_stock_zeroing',
                    note: `تسوية وتصفير رصيد الصنف (${product.name}) عند الأرشفة والتعطيل`,
                    reference_type: 'inventory_adjustment',
                    reference_id: product.id,
                    location_id: fallbackLocationId || null,
                    created_by: actor.userId,
                    ...this.tenantFields(actor),
                  } as any)
                  .returning('id')
                  .executeTakeFirst();

                if (insertedMovement?.id && this.accountingPosting) {
                  await this.accountingPosting.postInventoryAdjustment(trx, Number(insertedMovement.id), actor);
                }
              }
            }

            await trx
              .updateTable('products')
              .set({ catalog_updated_at: sql`NOW()`, updated_at: sql`NOW()` })
              .where('id', '=', product.id)
              .where(this.tenantPredicate(actor))
              .execute();

            await trx
              .updateTable('product_location_stock')
              .set({ qty: 0, updated_at: sql`NOW()` })
              .where('product_id', '=', product.id)
              .where(this.tenantPredicate(actor))
              .execute();
          }
        }
      } else {
        // Re-activating: check collisions
        for (const product of targetProducts) {
          const taken = await trx
            .selectFrom('products')
            .select('id')
            .where('id', 'not in', targetProductIds)
            .where('is_active', '=', true)
            .where(this.tenantPredicate(actor))
            .where((eb) =>
              eb.or([
                sql<boolean>`LOWER(name) = ${String(product.name || '').toLowerCase()}`,
                ...(product.barcode ? [sql<boolean>`LOWER(barcode) = ${String(product.barcode).toLowerCase()}`] : []),
                ...(product.sku ? [sql<boolean>`LOWER(sku) = ${String(product.sku).toLowerCase()}`] : []),
              ]),
            )
            .executeTakeFirst();
          if (taken) {
            throw new AppError(
              `لا يمكن إعادة تنشيط الصنف (${product.name}): الاسم أو الباركود أو SKU مستخدم بالفعل`,
              'PRODUCT_IDENTITY_CONFLICT',
              409,
            );
          }

          if (product.item_kind === 'fashion' && product.style_code) {
            const duplicate = await trx
              .selectFrom('products')
              .select('id')
              .where('id', 'not in', targetProductIds)
              .where('style_code', '=', product.style_code)
              .where('item_kind', '=', 'fashion')
              .where('is_active', '=', true)
              .where(this.tenantPredicate(actor))
              .where(sql`LOWER(COALESCE(color, ''))`, '=', String(product.color || '').toLowerCase())
              .where(sql`LOWER(COALESCE(size, ''))`, '=', String(product.size || '').toLowerCase())
              .executeTakeFirst();
            if (duplicate) {
              throw new AppError(
                `اللون والمقاس للصنف (${product.name}) موجودان بالفعل في هذا الموديل النشط`,
                'VARIANT_EXISTS',
                409,
              );
            }
          }
        }
      }

      await trx
        .updateTable('products')
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
      ? result.isFashionGroup
        ? 'تنشيط موديل كامل'
        : 'تنشيط صنف'
      : result.isFashionGroup
        ? 'أرشفة موديل كامل'
        : 'أرشفة صنف';

    const auditLabel = result.isFashionGroup
      ? `${result.nextActive ? 'تم تنشيط' : 'تم أرشفة'} كامل موديل (${result.name} - كود ${result.styleCode}) بعدد ${result.count} متغيرات بواسطة ${actor.username}`
      : `${result.nextActive ? 'تم تنشيط' : 'تم أرشفة'} الصنف ${result.name} (#${id}) بواسطة ${actor.username}`;

    await this.audit.log(actionLabel, auditLabel, actor);

    const message = result.isFashionGroup
      ? result.nextActive
        ? `تم تنشيط الموديل بالكامل بنجاح (${result.count} صنف/متغير)`
        : `تم أرشفة وتعطيل الموديل بالكامل بنجاح (${result.count} صنف/متغير)`
      : result.nextActive
        ? 'تم تنشيط الصنف بنجاح وإعادته لدليل الأصناف النشطة'
        : 'تم أرشفة وتعطيل الصنف بنجاح';

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

  async bulkUpdateIcons(
    updates: Array<{ id: number; icon: string }>,
    actor: AuthContext,
  ): Promise<{ ok: boolean; updated: number }> {
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
          try {
            meta = JSON.parse(prod.metadata);
          } catch {}
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
