/**
 * CatalogProductFashionService — slice P8 of the catalog-product split.
 * Pure move of 1 method from CatalogProductService (saveFashionGroup, the
 * all-or-nothing fashion group replacement, 538L — the largest single method
 * in the file). No behavior change: the body is byte-identical — the method
 * is already PUBLIC in the facade, so there is no visibility change at all
 * (the facade keeps a thin public delegate with the same name/signature).
 * Deps: db + audit + inventoryScope (required ctor deps) + accountingPosting?
 * + mediaService? (optional — postInventoryAdjustment x2 in saveFashionGroup
 * is guarded by `if (insertedMovement?.id && this.accountingPosting)`, and
 * normalizeImageRef is guarded by `if (!raw || !this.mediaService)`; the
 * optionals are never required, never defaulted) + kernel tenantPredicate /
 * hasPermission / tenantId / tenantFields (bound, HR kernel pattern) +
 * cross-slice bookDigits + postOpeningStock + ensureOpeningStockAccounts (P1)
 * / getProductOfferColumnCapabilities + ensureAdvancedOffersSupported (P2) /
 * coerceNewStyleCode (P3) / normalizeProductPayload + replaceProductRelations
 * + ensureCategoryAndSupplierInTenant + ensureCustomerPricesInTenant (P6),
 * bound from the facade's delegates at generation.
 * MERGE NOTE: at merge, repoint the cross-slice bindings to the slice
 * instances (HR H1 pattern: this.postingService.bookDigits.bind(...),
 * this.postingService.postOpeningStock.bind(...),
 * this.postingService.ensureOpeningStockAccounts.bind(...),
 * this.offersService.getProductOfferColumnCapabilities.bind(...),
 * this.offersService.ensureAdvancedOffersSupported.bind(...),
 * this.styleCodeService.coerceNewStyleCode.bind(...),
 * this.writeService.normalizeProductPayload.bind(...),
 * this.writeService.replaceProductRelations.bind(...),
 * this.writeService.ensureCategoryAndSupplierInTenant.bind(...),
 * this.writeService.ensureCustomerPricesInTenant.bind(...)); the facade
 * delegates keep them working until then. P8 is LAST in merge order
 * (P1→P2→P3→P4→P5→P7→P6→P8). The catalog-product-types import is type-only,
 * for the Deps interface (ProductOfferColumnCapabilities /
 * ProductWriteExecutor) — P1 creates that module at the first merge, so P1
 * MUST export the 9 aliases (same dependency as P2/P7).
 * Clock: 0 clock reads. The 2 `new Date(x)` sites at L2086 are parses in
 * the optimistic-concurrency compare (expectedCatalogUpdatedAt vs the DB
 * catalog_updated_at, ±1ms) — NOT clock sites. Guard: toFixed2 = 0,
 * inlineRound = 0 (toFixed(3) x4, informational only).
 * No driving spec pins saveFashionGroup directly (prep §7: the largest
 * single method in the file and completely unpinned); the merged proof +
 * critical chain carry it.
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
import { StorefrontMediaService } from '../../storefront/storefront-media.service';
import { applyStockDelta } from '../../../common/utils/location-stock-ledger';
import {
  assertFashionExpectedStock,
  assertFashionRemovedStockSafe,
  fashionLocationAccessMode,
} from '../engines/fashion-stock-safety.engine';
import { stockMovementTotal } from '../engines/stock-movement-total.engine';
import { normalizeArabicSearch } from '../../../common/utils/arabic-search.util';
import { MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { NormalizedUpsertProduct, SaveFashionGroupDto, UpsertProductDto } from '../dto/upsert-product.dto';
import { ProductOfferColumnCapabilities, ProductWriteExecutor } from './catalog-product-types';

export interface CatalogProductFashionDeps {
  db: Kysely<Database>;
  audit: AuditService;
  inventoryScope: InventoryScopeService;
  accountingPosting?: AccountingPostingService;
  mediaService?: StorefrontMediaService;
  tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  hasPermission: (actor: AuthContext, permission: string) => boolean;
  tenantId: (actor: AuthContext) => string;
  tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  bookDigits: (executor: ProductWriteExecutor, actor: AuthContext) => Promise<MoneyDigits>;
  postOpeningStock: (
    trx: ProductWriteExecutor,
    productId: number,
    qty: number,
    unitCost: number,
    locationId: number | null,
    actor: AuthContext,
  ) => Promise<void>;
  ensureOpeningStockAccounts: (actor: AuthContext) => Promise<void>;
  getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;
  ensureAdvancedOffersSupported: (
    payload: NormalizedUpsertProduct,
    capabilities: ProductOfferColumnCapabilities,
  ) => void;
  coerceNewStyleCode: (rawValue: string) => string;
  normalizeProductPayload: (payload: UpsertProductDto) => NormalizedUpsertProduct;
  replaceProductRelations: (
    db: ProductWriteExecutor,
    productId: number,
    payload: NormalizedUpsertProduct,
    actor: AuthContext,
  ) => Promise<void>;
  ensureCategoryAndSupplierInTenant: (payload: NormalizedUpsertProduct, actor: AuthContext) => Promise<void>;
  ensureCustomerPricesInTenant: (payload: NormalizedUpsertProduct, actor: AuthContext) => Promise<void>;
}

@Injectable()
export class CatalogProductFashionService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly inventoryScope: InventoryScopeService;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly mediaService?: StorefrontMediaService;
  private readonly tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly hasPermission: (actor: AuthContext, permission: string) => boolean;
  private readonly tenantId: (actor: AuthContext) => string;
  private readonly tenantFields: (actor: AuthContext) => { tenant_id: string; account_id: string };
  private readonly bookDigits: (executor: ProductWriteExecutor, actor: AuthContext) => Promise<MoneyDigits>;
  private readonly postOpeningStock: (
    trx: ProductWriteExecutor,
    productId: number,
    qty: number,
    unitCost: number,
    locationId: number | null,
    actor: AuthContext,
  ) => Promise<void>;
  private readonly ensureOpeningStockAccounts: (actor: AuthContext) => Promise<void>;
  private readonly getProductOfferColumnCapabilities: () => Promise<ProductOfferColumnCapabilities>;
  private readonly ensureAdvancedOffersSupported: (
    payload: NormalizedUpsertProduct,
    capabilities: ProductOfferColumnCapabilities,
  ) => void;
  private readonly coerceNewStyleCode: (rawValue: string) => string;
  private readonly normalizeProductPayload: (payload: UpsertProductDto) => NormalizedUpsertProduct;
  private readonly replaceProductRelations: (
    db: ProductWriteExecutor,
    productId: number,
    payload: NormalizedUpsertProduct,
    actor: AuthContext,
  ) => Promise<void>;
  private readonly ensureCategoryAndSupplierInTenant: (
    payload: NormalizedUpsertProduct,
    actor: AuthContext,
  ) => Promise<void>;
  private readonly ensureCustomerPricesInTenant: (
    payload: NormalizedUpsertProduct,
    actor: AuthContext,
  ) => Promise<void>;

  constructor(deps: CatalogProductFashionDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.inventoryScope = deps.inventoryScope;
    this.accountingPosting = deps.accountingPosting;
    this.mediaService = deps.mediaService;
    this.tenantPredicate = deps.tenantPredicate;
    this.hasPermission = deps.hasPermission;
    this.tenantId = deps.tenantId;
    this.tenantFields = deps.tenantFields;
    this.bookDigits = deps.bookDigits;
    this.postOpeningStock = deps.postOpeningStock;
    this.ensureOpeningStockAccounts = deps.ensureOpeningStockAccounts;
    this.getProductOfferColumnCapabilities = deps.getProductOfferColumnCapabilities;
    this.ensureAdvancedOffersSupported = deps.ensureAdvancedOffersSupported;
    this.coerceNewStyleCode = deps.coerceNewStyleCode;
    this.normalizeProductPayload = deps.normalizeProductPayload;
    this.replaceProductRelations = deps.replaceProductRelations;
    this.ensureCategoryAndSupplierInTenant = deps.ensureCategoryAndSupplierInTenant;
    this.ensureCustomerPricesInTenant = deps.ensureCustomerPricesInTenant;
  }

  /**
   * All-or-nothing fashion group replacement. Existing rows retain unit IDs,
   * promotions, customer prices, metadata and their full stock ledgers.
   * Removed variants are archived rather than deleted.
   */
  async saveFashionGroup(
    oldStyleCode: string,
    payload: SaveFashionGroupDto,
    actor: AuthContext,
  ): Promise<{ ok: boolean; updated: number; created: number; archived: number }> {
    const originalStyle = this.coerceNewStyleCode(oldStyleCode);
    const rows = payload?.rows || [];
    if (!originalStyle || !Array.isArray(rows) || rows.length < 1 || rows.length > 400) {
      throw new AppError('Fashion group must contain between 1 and 400 variants', 'FASHION_GROUP_INVALID', 400);
    }
    const drafts = rows.map((row) => ({
      id: Number(row.id || 0),
      input: row,
      value: this.normalizeProductPayload(row),
    }));
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
    if (groupKind !== 'fashion')
      throw new AppError('Only fashion variants can be saved as a fashion group', 'FASHION_GROUP_INVALID', 400);
    if (!newStyle) throw new AppError('Style code is required', 'STYLE_CODE_INVALID', 400);
    const seenCombinations = new Set<string>();
    const seenNames = new Set<string>();
    const seenBarcodes = new Set<string>();
    const seenSkus = new Set<string>();
    const seenIds = new Set<number>();
    let fallbackWarehouseId: number | null = null;
    if (drafts.some((d) => !d.id && Number(d.value.stock || 0) > 0 && !d.value.warehouseId)) {
      const existingGroupRow = await this.db
        .selectFrom('products')
        .select('default_location_id')
        .where('style_code', '=', originalStyle)
        .where('item_kind', '=', groupKind)
        .where('is_active', '=', true)
        .where('default_location_id', 'is not', null)
        .where(this.tenantPredicate(actor))
        .executeTakeFirst();
      if (existingGroupRow?.default_location_id) {
        fallbackWarehouseId = Number(existingGroupRow.default_location_id);
      } else {
        const settingsRaw = await this.db
          .selectFrom('settings')
          .selectAll()
          .where(this.tenantPredicate(actor))
          .execute();
        const settings = settingsRaw.reduce<Record<string, unknown>>((acc, row) => {
          try {
            acc[row.key] = JSON.parse(row.value);
          } catch {
            acc[row.key] = row.value;
          }
          return acc;
        }, {});
        if (settings.currentLocationId) {
          fallbackWarehouseId = Number(settings.currentLocationId);
        } else {
          const activeLocs = await this.db
            .selectFrom('stock_locations')
            .select('id')
            .where('is_active', '=', true)
            .where((eb) => eb.or([eb('location_type', 'is', null), eb('location_type', '!=', 'in_transit')]))
            .where(this.tenantPredicate(actor))
            .execute();
          if (activeLocs.length >= 1) fallbackWarehouseId = Number(activeLocs[0].id);
        }
      }
    }

    for (const { id, value } of drafts) {
      if (
        value.itemKind !== groupKind ||
        this.coerceNewStyleCode(value.styleCode) !== newStyle ||
        !value.name ||
        !(value.color || value.size)
      ) {
        throw new AppError('Invalid fashion variant or mixed style codes', 'FASHION_GROUP_INVALID', 400);
      }
      const combination = `${normalizeArabicSearch(value.color)}::${normalizeArabicSearch(value.size)}`;
      const name = normalizeArabicSearch(value.name);
      const barcode = value.barcode.toLowerCase();
      const sku = value.sku.toLowerCase();
      if (
        seenCombinations.has(combination) ||
        seenNames.has(name) ||
        (barcode && seenBarcodes.has(barcode)) ||
        (sku && seenSkus.has(sku)) ||
        (id && seenIds.has(id))
      ) {
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
        if (value.stock && !value.warehouseId)
          throw new AppError('حدد مخزنًا للرصيد الافتتاحي', 'LOCATION_REQUIRED', 400);
        await this.ensureCustomerPricesInTenant(value, actor);
        this.ensureAdvancedOffersSupported(value, await this.getProductOfferColumnCapabilities());
      }
      if (value.warehouseId) {
        await this.inventoryScope.assertLocationScope(
          value.warehouseId,
          actor,
          false,
          fashionLocationAccessMode(
            !id,
            value.stock !== undefined,
            Boolean(payload.consolidateStock || payload.zeroRemovedStock),
          ),
        );
      }
    }

    if (drafts.some((draft) => !draft.id && Number(draft.value.stock || 0) > 0)) {
      if (!this.hasPermission(actor, 'canAdjustInventory')) {
        throw new AppError(
          'Opening stock requires canAdjustInventory permission',
          'INVENTORY_ADJUSTMENT_FORBIDDEN',
          403,
        );
      }
      await this.ensureOpeningStockAccounts(actor);
    }

    const result = await this.db.transaction().execute(async (trx) => {
      // Both styles are locked in a stable order to avoid a style-renaming deadlock.
      for (const style of [...new Set([originalStyle, newStyle])].sort()) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${this.tenantId(actor)}), hashtext(${style}))`.execute(trx);
      }
      const existing = await trx
        .selectFrom('products')
        .selectAll()
        .where('style_code', '=', originalStyle)
        .where('item_kind', '=', groupKind)
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .forUpdate()
        .execute();
      if (!existing.length) throw new AppError('Fashion group no longer exists', 'FASHION_GROUP_NOT_FOUND', 404);
      const byId = new Map(existing.map((p) => [Number(p.id), p]));
      const authorizedStockLocationIds = new Set<number>();
      const assertStockLocationWriteScope = async (locationId: number | null) => {
        if (locationId === null || authorizedStockLocationIds.has(locationId)) return;
        await this.inventoryScope.assertLocationScope(locationId, actor, false, 'write', trx);
        authorizedStockLocationIds.add(locationId);
      };
      for (const draft of drafts)
        if (draft.id && !byId.has(draft.id)) {
          throw new AppError('Variant does not belong to this group', 'FASHION_VARIANT_SCOPE', 403);
        }
      // Reject stale browser tabs before the first SQL write. Stock-only changes
      // do not advance catalog_updated_at and therefore do not create false conflicts.
      for (const draft of drafts) {
        const expected = draft.input.expectedCatalogUpdatedAt;
        if (!draft.id || !expected) continue;
        const current = byId.get(draft.id)!.catalog_updated_at;
        if (
          !current ||
          !Number.isFinite(Date.parse(expected)) ||
          Math.abs(new Date(current).getTime() - new Date(expected).getTime()) > 1
        ) {
          throw new AppError(
            'تم تعديل هذا الموديل من جهاز آخر. حدّث الشاشة قبل حفظ التعديلات',
            'FASHION_GROUP_STALE',
            409,
          );
        }
      }
      if (newStyle !== originalStyle) {
        const taken = await trx
          .selectFrom('products')
          .select('id')
          .where('style_code', '=', newStyle)
          .where('is_active', '=', true)
          .where(this.tenantPredicate(actor))
          .executeTakeFirst();
        if (taken) throw new AppError('Style code already belongs to another group', 'STYLE_CODE_EXISTS', 400);
      }

      const oldIds = existing.map((p) => Number(p.id));
      const removedWithStock = existing.filter(
        (p) =>
          !seenIds.has(Number(p.id)) &&
          (Math.abs(Number(p.stock_qty || 0)) > 0.0001 || Number(p.reserved_qty || 0) > 0),
      );
      // Stock moves do not update catalog_updated_at. Explicit adjustments must
      // compare the original browser snapshot under the locked product rows.
      const stockEdits = drafts.filter((d) =>
        d.id
          ? d.value.stock !== undefined &&
            Math.abs(Number(d.value.stock) - Number(byId.get(d.id)!.stock_qty || 0)) > 0.0001
          : Number(d.value.stock || 0) > 0,
      );
      for (const draft of drafts) {
        if (draft.id && draft.value.stock !== undefined) {
          assertFashionExpectedStock(draft.input.expectedStock, Number(byId.get(draft.id)!.stock_qty || 0));
        }
      }
      const performsStockOperation =
        stockEdits.length > 0 ||
        (removedWithStock.length > 0 && (payload.consolidateStock || payload.zeroRemovedStock));
      if (performsStockOperation && !this.hasPermission(actor, 'canAdjustInventory')) {
        throw new AppError(
          'Inventory adjustments require canAdjustInventory permission',
          'INVENTORY_ADJUSTMENT_FORBIDDEN',
          403,
        );
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
            const target = drafts.find(
              (d) => d.id && normalizeArabicSearch(d.value.color) === normalizeArabicSearch(removedProduct.color || ''),
            );
            const targetId = Number(target?.id);
            // If no matching color target exists among remaining variants, it CANNOT be consolidated into a different color!
            if (!target || !targetId || targetId === removedId) {
              stillUnresolvedWithStock.push(removedProduct);
              continue;
            }

            const locStocks = await trx
              .selectFrom('product_location_stock')
              .selectAll()
              .where('product_id', '=', removedId)
              .where('qty', '>', 0)
              .where(this.tenantPredicate(actor))
              .execute();
            assertFashionRemovedStockSafe(removedProduct, locStocks, Number(target?.value.costPrice ?? 0));
            for (const locStock of locStocks) await assertStockLocationWriteScope(locStock.location_id);

            for (const ls of locStocks) {
              const qtyToMove = Number(ls.qty || 0);
              if (qtyToMove <= 0) continue;

              const rawLocId = ls.location_id != null && Number(ls.location_id) > 0 ? Number(ls.location_id) : null;
              const effectiveLocId =
                rawLocId ||
                (removedProduct.default_location_id ? Number(removedProduct.default_location_id) : fallbackWarehouseId);

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

              await trx
                .insertInto('stock_movements')
                .values({
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
                } as any)
                .execute();

              await trx
                .insertInto('stock_movements')
                .values({
                  product_id: removedId,
                  movement_type: 'transfer',
                  qty: -qtyToMove,
                  before_qty: prevRemovedStock,
                  after_qty: Math.max(0, prevRemovedStock - qtyToMove),
                  unit_cost: Number(removedProduct.cost_price || 0),
                  total_cost: stockMovementTotal(
                    qtyToMove,
                    Number(removedProduct.cost_price || 0),
                    consolidationDigits,
                  ),
                  reason: 'variant_consolidation',
                  note: `تحويل ودمج رصيد المقاس الملغي إلى نفس اللون (${target.value.color || target.value.name})`,
                  reference_type: 'product',
                  reference_id: targetId,
                  location_id: effectiveLocId || null,
                  branch_id: ls.branch_id ? Number(ls.branch_id) : undefined,
                  created_by: actor.userId,
                  ...this.tenantFields(actor),
                } as any)
                .execute();
            }
          }
        } else {
          stillUnresolvedWithStock.push(...removedWithStock);
        }

        if (stillUnresolvedWithStock.length) {
          if (payload.zeroRemovedStock) {
            for (const removedProduct of stillUnresolvedWithStock) {
              const removedId = Number(removedProduct.id);
              const locStocks = await trx
                .selectFrom('product_location_stock')
                .selectAll()
                .where('product_id', '=', removedId)
                .where('qty', '>', 0)
                .where(this.tenantPredicate(actor))
                .execute();

              assertFashionRemovedStockSafe(removedProduct, locStocks, undefined, { allowMismatchForZeroing: true });
              for (const locStock of locStocks) await assertStockLocationWriteScope(locStock.location_id);

              const bookDigits = await this.bookDigits(trx, actor);
              for (const ls of locStocks) {
                const qtyToDeduct = Number(ls.qty || 0);
                if (qtyToDeduct <= 0) continue;

                const rawLocId = ls.location_id != null && Number(ls.location_id) > 0 ? Number(ls.location_id) : null;
                const effectiveLocId =
                  rawLocId ||
                  (removedProduct.default_location_id
                    ? Number(removedProduct.default_location_id)
                    : fallbackWarehouseId);

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

                removedProduct.stock_qty = Number(
                  Math.max(0, Number(removedProduct.stock_qty || 0) - qtyToDeduct).toFixed(3),
                ) as any;

                const unitCost = Number(removedProduct.cost_price || 0);
                const insertedMovement = await trx
                  .insertInto('stock_movements')
                  .values({
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
                  } as any)
                  .returning('id')
                  .executeTakeFirst();

                if (insertedMovement?.id && this.accountingPosting) {
                  await this.accountingPosting.postInventoryAdjustment(trx, Number(insertedMovement.id), actor);
                }
              }
            }
          } else {
            const names = stillUnresolvedWithStock
              .map((p) => `${p.name || p.color || p.size || p.id} (رصيد: ${p.stock_qty})`)
              .join('، ');
            throw new AppError(
              `لا يمكن إخفاء المقاسات التالية لأن لها رصيد مخزني: ${names}. يرجى تسوية رصيدها أولاً، حيث يُمنع منعاً باتاً دمج رصيد صنف في لون مختلف`,
              'FASHION_VARIANT_HAS_STOCK',
              409,
            );
          }
        }
      }
      const outsiderProducts = await trx
        .selectFrom('products')
        .select(['id', 'name', 'barcode', 'sku'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .where('id', 'not in', oldIds)
        .execute();
      for (const other of outsiderProducts) {
        if (
          seenNames.has(normalizeArabicSearch(other.name || '')) ||
          (other.barcode && seenBarcodes.has(String(other.barcode).toLowerCase())) ||
          (other.sku && seenSkus.has(String(other.sku).toLowerCase()))
        ) {
          throw new AppError('Variant name, barcode or SKU is already in use', 'FASHION_VARIANT_EXISTS', 400);
        }
      }
      if (seenBarcodes.size) {
        const otherUnitBarcodes = await trx
          .selectFrom('product_units')
          .select(['product_id', 'barcode'])
          .where(sql`LOWER(barcode)`, 'in', [...seenBarcodes])
          .where('product_id', 'not in', oldIds)
          .where(this.tenantPredicate(actor))
          .execute();
        if (otherUnitBarcodes.length)
          throw new AppError('Barcode is used by another product unit', 'BARCODE_EXISTS', 400);
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
        await trx
          .updateTable('products')
          .set({ barcode: null })
          .where('id', 'in', releaseBarcodeIds)
          .where(this.tenantPredicate(actor))
          .execute();
        await trx
          .updateTable('product_units')
          .set({ barcode: null })
          .where('product_id', 'in', releaseBarcodeIds)
          .where('is_base_unit', '=', true)
          .where(this.tenantPredicate(actor))
          .execute();
      }
      if (releaseSkuIds.length) {
        await trx
          .updateTable('products')
          .set({ sku: null })
          .where('id', 'in', releaseSkuIds)
          .where(this.tenantPredicate(actor))
          .execute();
      }

      const template = existing[0];
      let created = 0;
      let updated = 0;
      for (const { id, value } of drafts) {
        if (id) {
          const prior = byId.get(id)!;
          const priceChanged =
            Number(prior.cost_price) !== value.costPrice ||
            Number(prior.retail_price) !== value.retailPrice ||
            Number(prior.wholesale_price) !== value.wholesalePrice;
          if (priceChanged && !this.hasPermission(actor, 'canEditPrice')) {
            throw new AppError('Price changes require canEditPrice permission', 'PRICE_CHANGE_FORBIDDEN', 403);
          }

          if (value.stock !== undefined && value.stock !== null) {
            const targetStock = Math.max(0, Number(value.stock));
            const currentStock = Number(prior.stock_qty || 0);
            const stockDelta = Number((targetStock - currentStock).toFixed(3));

            if (Math.abs(stockDelta) > 0.0001) {
              const locStock = await trx
                .selectFrom('product_location_stock')
                .selectAll()
                .where('product_id', '=', id)
                .where(this.tenantPredicate(actor))
                .orderBy('qty', 'desc')
                .limit(1)
                .executeTakeFirst();
              const rawLocId =
                locStock?.location_id != null && Number(locStock.location_id) > 0 ? Number(locStock.location_id) : null;
              const effectiveLocationId =
                rawLocId ||
                (value.warehouseId && Number(value.warehouseId) > 0 ? Number(value.warehouseId) : null) ||
                (prior.default_location_id ? Number(prior.default_location_id) : null) ||
                fallbackWarehouseId ||
                null;

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
              const insertedMovement = await trx
                .insertInto('stock_movements')
                .values({
                  product_id: id,
                  movement_type: stockDelta > 0 ? 'add' : 'deduct',
                  qty: stockDelta,
                  before_qty: currentStock,
                  after_qty: targetStock,
                  unit_cost: unitCost,
                  total_cost: stockMovementTotal(absDelta, unitCost, bookDigits),
                  reason: 'fashion_matrix_adjustment',
                  note:
                    stockDelta > 0
                      ? `تسوية زيادة رصيد المقاس (${value.color || ''} / ${value.size || ''}) من شاشة الموديل`
                      : `تسوية خفض/تصفير رصيد المقاس (${value.color || ''} / ${value.size || ''}) من شاشة الموديل`,
                  reference_type: 'inventory_adjustment',
                  reference_id: id,
                  location_id: effectiveLocationId,
                  branch_id: locStock?.branch_id ? Number(locStock.branch_id) : undefined,
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

          // Per-variant photo change: merge into the stored metadata (the
          // update below otherwise never touches metadata, so a photo set
          // in the group matrix would silently vanish). Only when the row
          // carried an image decision; rows without one keep their photo.
          let metadataUpdate: string | undefined;
          if (value.imageUrl !== undefined) {
            const priorMetaRaw = (prior as { metadata?: unknown }).metadata;
            let nextMeta: Record<string, unknown> = {};
            if (priorMetaRaw && typeof priorMetaRaw === 'object')
              nextMeta = { ...(priorMetaRaw as Record<string, unknown>) };
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

          await trx
            .updateTable('products')
            .set({
              name: value.name,
              barcode: value.barcode || null,
              sku: value.sku || null,
              item_type: value.itemType,
              item_kind: groupKind,
              style_code: newStyle,
              color: value.color || null,
              size: value.size || null,
              category_id: value.categoryId,
              supplier_id: value.supplierId,
              cost_price: value.costPrice,
              retail_price: value.retailPrice,
              wholesale_price: value.wholesalePrice,
              min_stock_qty: value.minStock,
              notes: value.notes,
              default_location_id: value.warehouseId || prior.default_location_id,
              ...(metadataUpdate !== undefined ? { metadata: metadataUpdate } : {}),
              catalog_updated_at: sql`NOW()`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', id)
            .where(this.tenantPredicate(actor))
            .execute();
          await trx
            .updateTable('product_units')
            .set({ barcode: value.barcode || null })
            .where('product_id', '=', id)
            .where('is_base_unit', '=', true)
            .where(this.tenantPredicate(actor))
            .execute();
          updated++;
        } else {
          const stock = Number(value.stock || 0);
          const resolvedWarehouseId =
            (value.warehouseId && Number(value.warehouseId) > 0 ? Number(value.warehouseId) : null) ||
            (template?.default_location_id ? Number(template.default_location_id) : null) ||
            fallbackWarehouseId ||
            null;
          const inserted = await trx
            .insertInto('products')
            .values({
              name: value.name,
              name_en: value.nameEn || template?.name_en || null,
              barcode: value.barcode || null,
              sku: value.sku || null,
              item_type: value.itemType,
              item_kind: groupKind,
              style_code: newStyle,
              color: value.color || null,
              size: value.size || null,
              bin_location: value.binLocation || template?.bin_location || null,
              category_id: value.categoryId,
              supplier_id: value.supplierId,
              cost_price: value.costPrice,
              retail_price: value.retailPrice,
              wholesale_price: value.wholesalePrice,
              credit_price:
                value.creditPrice ?? (template?.credit_price != null ? Number(template.credit_price) : null),
              consumer_price:
                value.consumerPrice ?? (template?.consumer_price != null ? Number(template.consumer_price) : null),
              min_selling_price:
                value.minSellingPrice ??
                (template?.min_selling_price != null ? Number(template.min_selling_price) : null),
              min_stock_qty: value.minStock,
              stock_qty: stock,
              default_location_id: resolvedWarehouseId,
              notes: value.notes,
              is_active: true,
              track_serials: false,
              metadata: value.metadata
                ? JSON.stringify(value.metadata)
                : template?.metadata
                  ? typeof template.metadata === 'string'
                    ? template.metadata
                    : JSON.stringify(template.metadata)
                  : null,
              catalog_updated_at: sql`NOW()`,
              ...this.tenantFields(actor),
            } as any)
            .returning('id')
            .executeTakeFirstOrThrow();
          const productId = Number(inserted.id);
          const newValue = {
            ...value,
            units: value.units.map((u) => (u.isBaseUnit ? { ...u, barcode: value.barcode } : u)),
          };
          await this.replaceProductRelations(trx, productId, newValue, actor);
          if (stock > 0) {
            const bookDigits = await this.bookDigits(trx, actor);
            const openingTotal = stockMovementTotal(stock, value.costPrice, bookDigits);
            await trx
              .insertInto('product_location_stock')
              .values({
                product_id: productId,
                branch_id: null,
                location_id: resolvedWarehouseId!,
                qty: stock,
                ...this.tenantFields(actor),
              })
              .execute();
            await trx
              .insertInto('stock_movements')
              .values({
                product_id: productId,
                movement_type: 'opening_balance',
                qty: stock,
                before_qty: 0,
                after_qty: stock,
                unit_cost: value.costPrice,
                total_cost: openingTotal,
                reason: 'opening_balance',
                note: 'رصيد افتتاحي لمقاس جديد',
                reference_type: 'product',
                reference_id: productId,
                location_id: resolvedWarehouseId!,
                created_by: actor.userId,
                ...this.tenantFields(actor),
              } as any)
              .execute();
            await this.postOpeningStock(trx, productId, stock, value.costPrice, resolvedWarehouseId, actor);
          }
          created++;
        }
      }
      const kept = new Set(drafts.filter((row) => row.id).map((row) => row.id));
      const removed = existing.filter((p) => !kept.has(Number(p.id)));
      if (removed.length) {
        await trx
          .updateTable('products')
          .set({ is_active: false, catalog_updated_at: sql`NOW()`, updated_at: sql`NOW()` })
          .where(
            'id',
            'in',
            removed.map((p) => Number(p.id)),
          )
          .where(this.tenantPredicate(actor))
          .execute();
      }
      return { ok: true, updated, created, archived: removed.length };
    });
    (await import('../../storefront/storefront.service')).StorefrontService.invalidateGlobalCatalogCache();
    await this.audit.log(
      'تعديل مجموعة ملابس',
      `تم حفظ الموديل ${originalStyle} بواسطة ${actor.username}: ${result.updated} تعديل، ${result.created} إضافة، ${result.archived} أرشفة`,
      actor,
    );
    return result;
  }
}
