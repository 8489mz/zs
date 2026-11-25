import { sql, type Kysely } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { resolveImportProductNames } from '../settings-import.utils';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import { stockMovementTotal } from '../../../catalog/engines/stock-movement-total.engine';
import {
  MAX_IMPORT_ROWS_PER_REQUEST,
  cleanString,
  normalizeBarcodeText,
  toNumber,
  normalizeNumberText,
  type DbExecutor,
  type TenantScope,
} from './settings-import-shared';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../../../core/audit/audit.service';

export class SettingsImportProducts {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: {
      scope: (actor: AuthContext) => TenantScope;
      buildRowLookup: (row: Record<string, unknown>) => Record<string, string>;
      pickCell: (lookup: Record<string, string>, aliases: string[]) => string;
      ensureCategory: (db: DbExecutor, name: string, actor: AuthContext) => Promise<number | null>;
      ensureSupplier: (db: DbExecutor, name: string, actor: AuthContext) => Promise<number | null>;
      ensureLocation: (
        db: DbExecutor,
        name: string,
        actor: AuthContext,
        cache?: Map<string, { locationId: number; branchId: number | null }>,
      ) => Promise<{ locationId: number; branchId: number | null } | null>;
      tenantFields: (actor: AuthContext) => Record<string, string>;
      postImportedOpeningStock: (
        trx: DbExecutor,
        opts: {
          productId: number;
          signedQty: number;
          unitCost: number;
          locationId: number | null;
          branchId: number | null;
          sourceType: string;
          sourceId: number;
          actor: AuthContext;
        },
      ) => Promise<void>;
    },
  ) {}

  private scope(actor: AuthContext): TenantScope {
    return this.bound.scope(actor);
  }
  private buildRowLookup(row: Record<string, unknown>): Record<string, string> {
    return this.bound.buildRowLookup(row);
  }
  private pickCell(lookup: Record<string, string>, aliases: string[]): string {
    return this.bound.pickCell(lookup, aliases);
  }
  private async ensureCategory(db: DbExecutor, name: string, actor: AuthContext): Promise<number | null> {
    return this.bound.ensureCategory(db, name, actor);
  }
  private async ensureSupplier(db: DbExecutor, name: string, actor: AuthContext): Promise<number | null> {
    return this.bound.ensureSupplier(db, name, actor);
  }
  private async ensureLocation(
    db: DbExecutor,
    name: string,
    actor: AuthContext,
    cache?: Map<string, { locationId: number; branchId: number | null }>,
  ): Promise<{ locationId: number; branchId: number | null } | null> {
    return this.bound.ensureLocation(db, name, actor, cache);
  }
  private tenantFields(actor: AuthContext): Record<string, string> {
    return this.bound.tenantFields(actor);
  }
  private async postImportedOpeningStock(
    trx: DbExecutor,
    opts: {
      productId: number;
      signedQty: number;
      unitCost: number;
      locationId: number | null;
      branchId: number | null;
      sourceType: string;
      sourceId: number;
      actor: AuthContext;
    },
  ): Promise<void> {
    return this.bound.postImportedOpeningStock(trx, opts);
  }

  async importProducts(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    if (!Array.isArray(rows)) throw new AppError('rows must be an array', 'IMPORT_ROWS_INVALID', 400);
    if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST)
      throw new AppError('rows exceed the 1000-row per-request limit', 'IMPORT_ROWS_TOO_MANY', 400);
    const scope = this.scope(actor);
    const result = await this.db.transaction().execute(async (trx) => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let stockQtyIgnoredOnUpdate = 0;
      const locationsCache = new Map<string, { locationId: number; branchId: number | null }>();

      for (const rawRow of rows) {
        const row = rawRow as Record<string, unknown>;
        const lookup = this.buildRowLookup(row);

        const arabicName =
          cleanString(row.name) ||
          this.pickCell(lookup, ['اسم الصنف (إجباري)', 'اسم الصنف', 'name', 'اسم الخدمة', 'اسم البند']);
        const englishName =
          cleanString(row.nameEn) ||
          this.pickCell(lookup, ['اسم الصنف (إنجليزي)', 'الاسم الإنجليزي', 'English name', 'nameEn', 'name_en']);
        const resolvedNames = resolveImportProductNames(arabicName, englishName);
        if (!resolvedNames) {
          skipped += 1;
          continue;
        }
        const name = resolvedNames.name;

        const categoryName =
          cleanString(row.categoryName || row.category || '') ||
          this.pickCell(lookup, ['القسم', 'التصنيف', 'category', 'categoryName']);
        const categoryId = await this.ensureCategory(trx, categoryName, actor);

        const supplierName =
          cleanString(row.supplierName || row.supplier || '') ||
          this.pickCell(lookup, ['المورد', 'اسم المورد', 'supplier', 'supplierName']);
        const supplierId = await this.ensureSupplier(trx, supplierName, actor);

        const warehouseName =
          cleanString(row.warehouseName || row.warehouse || row.store || '') ||
          this.pickCell(lookup, ['المخزن', 'warehouse', 'store', 'الميناء', 'موقع التشوين']);
        const locInfo = await this.ensureLocation(trx, warehouseName, actor, locationsCache);
        const locationId = locInfo?.locationId ?? null;
        const locationBranchId = locInfo?.branchId ?? null;

        const barcode =
          normalizeBarcodeText(row.barcode) ||
          normalizeBarcodeText(this.pickCell(lookup, ['الباركود', 'باركود', 'barcode', 'كود', 'code'])) ||
          null;

        const rawType = cleanString(
          row.itemType ||
            row.type ||
            row['النوع'] ||
            this.pickCell(lookup, ['النوع', 'تصنيف', 'type', 'itemType', 'item_type']),
        ).toLowerCase();
        const itemType = (
          rawType.includes('خام') || rawType === 'raw_material'
            ? 'raw_material'
            : rawType.includes('خدم') || rawType === 'service'
              ? 'service'
              : 'product'
        ) as 'raw_material' | 'service' | 'product';

        const costPrice = toNumber(
          (row.costPrice ??
            row.cost ??
            this.pickCell(lookup, ['سعر التكلفة', 'التكلفة', 'cost', 'costPrice', 'cost_price'])) ||
            0,
        );
        const retailPrice = toNumber(
          (row.retailPrice ??
            row.price ??
            this.pickCell(lookup, ['سعر البيع', 'السعر', 'retailPrice', 'price', 'retail_price', 'تعريفة'])) ||
            0,
        );
        const rawWholesale =
          row.wholesalePrice ?? this.pickCell(lookup, ['سعر الجملة', 'الجملة', 'wholesalePrice', 'wholesale_price']);
        const wholesalePrice =
          rawWholesale != null && String(rawWholesale).trim() !== '' ? toNumber(rawWholesale) : retailPrice || 0;
        const minStockQty = toNumber(
          (row.minStockQty ??
            row.minQty ??
            this.pickCell(lookup, ['الحد الأدنى', 'حد الطلب', 'minStockQty', 'minQty', 'min_stock'])) ||
            0,
        );
        const notes = cleanString(row.notes ?? this.pickCell(lookup, ['ملاحظات', 'الوصف', 'notes', 'description']));
        const rawImageUrl = cleanString(
          row.imageUrl ??
            row.image ??
            this.pickCell(lookup, ['رابط الصورة', 'الصورة', 'image', 'imageUrl', 'image_url']),
        );

        const existing = barcode
          ? await trx
              .selectFrom('products')
              .select(['id', 'metadata'])
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .where('barcode', '=', barcode)
              .where('is_active', '=', true)
              .executeTakeFirst()
          : await trx
              .selectFrom('products')
              .select(['id', 'metadata'])
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .where(sql`LOWER(name)`, '=', name.toLowerCase())
              .where('is_active', '=', true)
              .executeTakeFirst();

        const payload = {
          name,
          name_en: resolvedNames.nameEn,
          barcode,
          category_id: categoryId,
          supplier_id: supplierId,
          item_type: itemType,
          cost_price: costPrice,
          retail_price: retailPrice,
          wholesale_price: wholesalePrice,
          min_stock_qty: minStockQty,
          notes,
        };

        let productId: number;
        if (existing) {
          productId = Number(existing.id);
          const rawStock = row.stockQty ?? this.pickCell(lookup, ['الكمية', 'stock', 'stockQty', 'qty']);
          const requestedStockQty = toNumber(rawStock);
          if (Math.abs(requestedStockQty) > 0.0001) stockQtyIgnoredOnUpdate += 1;

          let metaObj: Record<string, any> = {};
          if (typeof existing.metadata === 'string') {
            try {
              metaObj = JSON.parse(existing.metadata);
            } catch {}
          } else if (existing.metadata && typeof existing.metadata === 'object') {
            metaObj = { ...(existing.metadata as Record<string, any>) };
          }
          if (rawImageUrl) {
            metaObj.imageUrl = rawImageUrl;
          }
          const metaPayload = rawImageUrl ? { metadata: JSON.stringify(metaObj) } : {};

          await trx
            .updateTable('products')
            .set({ ...payload, ...metaPayload, updated_at: sql`NOW()` })
            .where('id', '=', productId)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
          updated += 1;
        } else {
          const rawStock = row.stockQty ?? this.pickCell(lookup, ['الكمية', 'stock', 'stockQty', 'qty']);
          const initialStockQty = toNumber(rawStock);
          const metaInsert = rawImageUrl ? JSON.stringify({ imageUrl: rawImageUrl }) : null;
          const insertedProduct = await trx
            .insertInto('products')
            .values({
              ...payload,
              metadata: metaInsert,
              stock_qty: initialStockQty,
              is_active: true,
              ...this.tenantFields(actor),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          productId = Number(insertedProduct.id);
          if (initialStockQty > 0 && locationId != null) {
            await trx
              .insertInto('product_location_stock')
              .values({
                product_id: productId,
                branch_id: locationBranchId,
                location_id: locationId,
                qty: initialStockQty,
                ...this.tenantFields(actor),
              })
              .execute();
          }
          if (initialStockQty > 0) {
            // Opening stock must appear in the perpetual ledger, otherwise
            // the stock value and the GL inventory balance diverge from the
            // first imported row (INV-GL-INVENTORY-VALUE). Same movement +
            // journal as the single-product create path.
            const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
            const openingTotal = stockMovementTotal(initialStockQty, costPrice, bookDigits);
            await trx
              .insertInto('stock_movements')
              .values({
                product_id: productId,
                movement_type: 'opening_balance',
                qty: initialStockQty,
                before_qty: 0,
                after_qty: initialStockQty,
                unit_cost: costPrice,
                total_cost: openingTotal,
                reason: 'opening_balance',
                note: 'رصيد افتتاحي عند استيراد الصنف',
                reference_type: 'product',
                reference_id: productId,
                branch_id: locationBranchId,
                location_id: locationId,
                created_by: actor.userId,
                ...this.tenantFields(actor),
              } as any)
              .execute();
            await this.postImportedOpeningStock(trx, {
              productId,
              signedQty: initialStockQty,
              unitCost: costPrice,
              locationId,
              branchId: locationBranchId,
              sourceType: 'catalog_opening_stock',
              sourceId: productId,
              actor,
            });
          }
          inserted += 1;
        }

        await this.syncProductUnitsFromImport(trx, productId, row, lookup, barcode, Boolean(existing), actor);
      }

      return { inserted, updated, skipped, stockQtyIgnoredOnUpdate };
    });

    await this.audit.log(
      'استيراد أصناف',
      `تم استيراد/تحديث ${result.inserted + result.updated} صنف على يد ${actor.username}`,
      actor,
    );
    return {
      ok: true,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      warnings:
        result.stockQtyIgnoredOnUpdate > 0
          ? [
              `تم إهمال stockQty لعدد ${result.stockQtyIgnoredOnUpdate} من الأصناف الموجودة مسبقًا. استخدم إدخال الرصيد الأولي أو تعديل المخزون بدلًا من هذا.`,
            ]
          : [],
    };
  }

  normalizeImportUnitName(name: unknown): string {
    const text = String(name || '').trim();
    if (!text) return '';
    const lower = text.toLowerCase();
    if (
      ['piece', 'pieces', 'pcs', 'pc', 'item', 'items', 'unit', 'units', 'قطعه', 'حبة', 'حبه', 'قطعة'].includes(lower)
    )
      return 'قطعة';
    if (lower === 'kg' || lower === 'كجم' || lower === 'كيلو' || lower === 'كيلوجرام') return 'kg';
    if (lower === 'g' || lower === 'gm' || lower === 'gram' || lower === 'جرام') return 'g';
    if (['box', 'boxes', 'carton', 'cartons', 'كرتونه', 'كرتونة'].includes(lower)) return 'كرتونة';
    if (['packet', 'pack', 'packs', 'باكت'].includes(lower)) return 'باكت';
    if (['bottle', 'bottles', 'زجاجه', 'زجاجة'].includes(lower)) return 'زجاجة';
    if (['can', 'cans', 'علبه', 'علبة'].includes(lower)) return 'علبة';
    if (['liter', 'liters', 'ltr', 'l', 'لتر'].includes(lower)) return 'لتر';
    if (['meter', 'meters', 'm', 'متر'].includes(lower)) return 'متر';
    if (['service', 'services', 'خدمه', 'خدمة'].includes(lower)) return 'خدمة';
    return text;
  }

  parseMultiplier(value: unknown): number | null {
    if (value == null) return null;
    const str = normalizeNumberText(value).replace(/[^\d.]/g, '');
    if (!str) return null;
    const num = Number(str);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  async syncProductUnitsFromImport(
    trx: DbExecutor,
    productId: number,
    row: Record<string, unknown>,
    lookup: Record<string, string>,
    productBarcode: string | null,
    isExisting: boolean,
    actor: AuthContext,
  ): Promise<void> {
    const scope = this.scope(actor);

    const rawBaseUnit = cleanString(
      row.unitName ||
        this.pickCell(lookup, [
          'وحدة القياس الأساسية',
          'وحدة القياس',
          'الوحدة الأساسية',
          'الوحدة',
          'unit',
          'unitName',
          'القياس',
        ]),
    );
    const rawSaleUnit = cleanString(row.saleUnit || this.pickCell(lookup, ['وحدة البيع', 'saleUnit', 'sale_unit']));
    const rawPurchaseUnit = cleanString(
      row.purchaseUnit || this.pickCell(lookup, ['وحدة الشراء', 'purchaseUnit', 'purchase_unit']),
    );
    const rawExtraUnit = cleanString(
      row.extraUnitName ||
        this.pickCell(lookup, [
          'اسم وحدة إضافية',
          'وحدة إضافية',
          'الوحدة الكبرى',
          'اسم الوحدة الكبرى',
          'extraUnit',
          'extraUnitName',
          'extra_unit',
        ]),
    );
    const rawMultiplierStr = this.pickCell(lookup, [
      'معامل الوحدة الإضافية',
      'معامل التحويل',
      'معامل الوحدة',
      'التحويل',
      'المعامل',
      'عدد القطع في الوحدة الكبرى',
      'extraUnitMultiplier',
      'multiplier',
      'factor',
    ]);
    const rawMultiplier =
      row.extraUnitMultiplier != null && String(row.extraUnitMultiplier).trim() !== ''
        ? this.parseMultiplier(row.extraUnitMultiplier)
        : rawMultiplierStr
          ? this.parseMultiplier(rawMultiplierStr)
          : null;
    const rawExtraBarcode =
      normalizeBarcodeText(
        row.extraUnitBarcode ||
          this.pickCell(lookup, [
            'باركود الوحدة الإضافية',
            'باركود الوحدة',
            'باركود الكرتونة',
            'extraUnitBarcode',
            'extra_barcode',
          ]),
      ) || null;

    const hasAnyUnitField = Boolean(
      rawBaseUnit ||
      rawSaleUnit ||
      rawPurchaseUnit ||
      rawExtraUnit ||
      (rawMultiplier !== null && rawMultiplier > 0) ||
      rawExtraBarcode,
    );

    // If existing product and no unit columns or data provided at all in this row, preserve existing units
    if (isExisting && !hasAnyUnitField) {
      return;
    }

    const baseUnitName = this.normalizeImportUnitName(rawBaseUnit) || 'قطعة';
    let extraUnitName = this.normalizeImportUnitName(rawExtraUnit);
    const saleUnitName = this.normalizeImportUnitName(rawSaleUnit);
    const purchaseUnitName = this.normalizeImportUnitName(rawPurchaseUnit);

    // If extraUnitName was not set, but purchaseUnit differs from baseUnit and multiplier > 1, infer extraUnitName
    if (
      !extraUnitName &&
      purchaseUnitName &&
      purchaseUnitName.toLowerCase() !== baseUnitName.toLowerCase() &&
      rawMultiplier &&
      rawMultiplier > 1
    ) {
      extraUnitName = purchaseUnitName;
    }
    // Or if extraUnitName was not set, but saleUnit differs from baseUnit and multiplier > 1
    if (
      !extraUnitName &&
      saleUnitName &&
      saleUnitName.toLowerCase() !== baseUnitName.toLowerCase() &&
      rawMultiplier &&
      rawMultiplier > 1
    ) {
      extraUnitName = saleUnitName;
    }

    const hasValidExtraUnit = Boolean(
      extraUnitName && extraUnitName.toLowerCase() !== baseUnitName.toLowerCase() && rawMultiplier && rawMultiplier > 0,
    );

    const extraMultiplier = hasValidExtraUnit ? rawMultiplier || 1 : 1;

    // Determine default flags
    const isBaseSaleDefault =
      !hasValidExtraUnit || (saleUnitName ? saleUnitName.toLowerCase() !== extraUnitName.toLowerCase() : true);
    const isExtraSaleDefault = hasValidExtraUnit && !isBaseSaleDefault;

    // For purchase default: if purchaseUnitName matches extraUnitName, or if purchaseUnitName was not specified but extraUnit is created and purchase default wasn't explicitly set to base
    let isBasePurchaseDefault = true;
    let isExtraPurchaseDefault = false;
    if (hasValidExtraUnit) {
      if (purchaseUnitName) {
        isExtraPurchaseDefault = purchaseUnitName.toLowerCase() === extraUnitName.toLowerCase();
        isBasePurchaseDefault = !isExtraPurchaseDefault;
      } else {
        isExtraPurchaseDefault = true;
        isBasePurchaseDefault = false;
      }
    }

    // Prepare units to persist
    const unitsToInsert: Array<{
      name: string;
      multiplier: number;
      barcode: string | null;
      is_base_unit: boolean;
      is_sale_unit_default: boolean;
      is_purchase_unit_default: boolean;
    }> = [];

    // Base unit
    unitsToInsert.push({
      name: baseUnitName,
      multiplier: 1,
      barcode: productBarcode || null,
      is_base_unit: true,
      is_sale_unit_default: isBaseSaleDefault,
      is_purchase_unit_default: isBasePurchaseDefault,
    });

    // Extra unit
    if (hasValidExtraUnit) {
      let extraBarcode = rawExtraBarcode;
      // Prevent duplicate barcode on same product
      if (extraBarcode && productBarcode && extraBarcode.toLowerCase() === productBarcode.toLowerCase()) {
        extraBarcode = null;
      }
      unitsToInsert.push({
        name: extraUnitName,
        multiplier: extraMultiplier,
        barcode: extraBarcode || null,
        is_base_unit: false,
        is_sale_unit_default: isExtraSaleDefault,
        is_purchase_unit_default: isExtraPurchaseDefault,
      });
    }

    // Delete existing units for this product
    await trx
      .deleteFrom('product_units')
      .where('product_id', '=', productId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    // Insert new units
    for (const unit of unitsToInsert) {
      // Barcode collision safety: if barcode is already claimed by another product in this tenant, null it out
      let safeBarcode = unit.barcode;
      if (safeBarcode) {
        const existingBarcode = await trx
          .selectFrom('product_units')
          .select(['id', 'product_id'])
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where(sql`LOWER(barcode)`, '=', safeBarcode.toLowerCase())
          .where('product_id', '!=', productId)
          .executeTakeFirst();
        if (existingBarcode) {
          safeBarcode = null;
        }
      }

      await trx
        .insertInto('product_units')
        .values({
          product_id: productId,
          name: unit.name,
          multiplier: unit.multiplier,
          barcode: safeBarcode,
          is_base_unit: unit.is_base_unit,
          is_sale_unit_default: unit.is_sale_unit_default,
          is_purchase_unit_default: unit.is_purchase_unit_default,
          ...this.tenantFields(actor),
        })
        .execute();
    }
  }
}
