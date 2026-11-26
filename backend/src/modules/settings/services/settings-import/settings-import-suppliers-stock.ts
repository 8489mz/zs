import { sql, type Kysely } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { setScopedStockQty } from '../../../../common/utils/location-stock-ledger';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import { recordStockMovementRow } from '../../../../common/utils/stock-movement-writer';
import {
  MAX_IMPORT_ROWS_PER_REQUEST,
  cleanString,
  toNumber,
  normalizeBarcodeText,
  type DbExecutor,
  type TenantScope,
} from './settings-import-shared';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../../../core/audit/audit.service';

export class SettingsImportSuppliersStock {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: {
      scope: (actor: AuthContext) => TenantScope;
      tenantFields: (actor: AuthContext) => Record<string, string>;
      addSupplierOpeningBalance: (
        db: DbExecutor,
        supplierId: number,
        amount: number,
        actor: AuthContext,
      ) => Promise<void>;
      ensureLocation: (
        db: DbExecutor,
        name: string,
        actor: AuthContext,
        cache?: Map<string, { locationId: number; branchId: number | null }>,
      ) => Promise<{ locationId: number; branchId: number | null } | null>;
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
  private tenantFields(actor: AuthContext): Record<string, string> {
    return this.bound.tenantFields(actor);
  }
  private async addSupplierOpeningBalance(
    db: DbExecutor,
    supplierId: number,
    amount: number,
    actor: AuthContext,
  ): Promise<void> {
    return this.bound.addSupplierOpeningBalance(db, supplierId, amount, actor);
  }
  private async ensureLocation(
    db: DbExecutor,
    name: string,
    actor: AuthContext,
    cache?: Map<string, { locationId: number; branchId: number | null }>,
  ): Promise<{ locationId: number; branchId: number | null } | null> {
    return this.bound.ensureLocation(db, name, actor, cache);
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

  async importSuppliers(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    if (!Array.isArray(rows)) throw new AppError('rows must be an array', 'IMPORT_ROWS_INVALID', 400);
    if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST)
      throw new AppError('rows exceed the 1000-row per-request limit', 'IMPORT_ROWS_TOO_MANY', 400);
    const scope = this.scope(actor);
    const result = await this.db.transaction().execute(async (trx) => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const rawRow of rows) {
        const row = rawRow as Record<string, unknown>;
        const name = cleanString(row.name);
        if (!name) {
          skipped += 1;
          continue;
        }
        const phone = cleanString(row.phone);
        const existing = phone
          ? await trx
              .selectFrom('suppliers')
              .select(['id'])
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .where('phone', '=', phone)
              .where('is_active', '=', true)
              .executeTakeFirst()
          : await trx
              .selectFrom('suppliers')
              .select(['id'])
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .where(sql`LOWER(name)`, '=', name.toLowerCase())
              .where('is_active', '=', true)
              .executeTakeFirst();
        const openingBalance = toNumber(row.openingBalance || row.balance || 0);
        const payload = { name, phone, address: cleanString(row.address), notes: cleanString(row.notes) };

        if (existing) {
          await trx
            .updateTable('suppliers')
            .set({ ...payload, updated_at: sql`NOW()` })
            .where('id', '=', Number(existing.id))
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();
          updated += 1;
        } else {
          const insertedRow = await trx
            .insertInto('suppliers')
            .values({ ...payload, balance: 0, is_active: true, ...this.tenantFields(actor) })
            .returning('id')
            .executeTakeFirstOrThrow();
          await this.addSupplierOpeningBalance(trx, Number(insertedRow.id), openingBalance, actor);
          inserted += 1;
        }
      }

      return { inserted, updated, skipped };
    });

    await this.audit.log(
      'استيراد موردين',
      `تم استيراد/تحديث ${result.inserted + result.updated} مورد على يد ${actor.username}`,
      actor,
    );
    return { ok: true, inserted: result.inserted, updated: result.updated, skipped: result.skipped };
  }

  async importOpeningStock(rows: unknown[], actor: AuthContext): Promise<Record<string, unknown>> {
    if (!Array.isArray(rows)) throw new AppError('rows must be an array', 'IMPORT_ROWS_INVALID', 400);
    if (rows.length > MAX_IMPORT_ROWS_PER_REQUEST)
      throw new AppError('rows exceed the 1000-row per-request limit', 'IMPORT_ROWS_TOO_MANY', 400);
    const scope = this.scope(actor);
    const result = await this.db.transaction().execute(async (trx) => {
      let updated = 0;
      const locationsCache = new Map<string, { locationId: number; branchId: number | null }>();

      for (const rawRow of rows) {
        const row = rawRow as Record<string, unknown>;
        const productId = toNumber(row.productId || 0);
        const productName = cleanString(row.productName || row.name);
        const qty = toNumber(row.qty || row.quantity || 0);
        if (qty < 0) continue;

        const barcode = normalizeBarcodeText(row.barcode);

        let productQuery = trx
          .selectFrom('products')
          .select(['id', 'name', 'stock_qty', 'cost_price'])
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true);

        if (productId > 0) {
          productQuery = productQuery.where('id', '=', productId);
        } else if (barcode) {
          productQuery = productQuery.where('barcode', '=', barcode);
        } else {
          productQuery = productQuery.where(sql`LOWER(name)`, '=', productName.toLowerCase());
        }

        const product = await productQuery.executeTakeFirst();
        if (!product) continue;

        const locInfo = await this.ensureLocation(
          trx,
          cleanString(row.warehouseName || row.warehouse || row.store || ''),
          actor,
          locationsCache,
        );
        const branchId = toNumber(row.branchId || row.branch || 0) || locInfo?.branchId || null;
        const locationId = locInfo?.locationId || toNumber(row.locationId || row.location || 0) || null;

        const stockChange = await setScopedStockQty(trx, {
          productId: Number(product.id),
          nextQty: qty,
          branchId,
          locationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
        });

        const actualDelta = stockChange.scopeAfter - stockChange.scopeBefore;
        if (actualDelta === 0) continue;

        // The movement carries the SIGNED delta at the product's cost, so
        // the stored total and the posted journal leg agree, and the WAC
        // pool (stockMovementGlobalDelta) moves in the right direction:
        // the old Math.abs(delta) inflated the pool on a decrease.
        // INV-GL-INVENTORY-VALUE: the opening-stock re-set posts the same
        // Dr 1140 / Cr 3100 journal (mirrored on a decrease) as a new
        // product's opening stock, so GL inventory tracks the stock value.
        // Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the row goes through
        // the row-writer in row-only mode with signedTotal — the set mode
        // cannot express this site because the zero-skip above (no row
        // when actualDelta === 0) is decided AFTER the setter, while the
        // set mode always writes a row. The writer's signed total is
        // roundMoney(actualDelta * unitCost, moneyDigits), the same
        // SIGNED stockMovementTotal expression the old row used.
        const openingDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
        const openingUnitCost = Number(product.cost_price || 0);
        const movementId = await recordStockMovementRow(trx, {
          productId: Number(product.id),
          branchId,
          locationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          movementType: 'opening_stock',
          delta: actualDelta,
          beforeQty: stockChange.scopeBefore,
          afterQty: stockChange.scopeAfter,
          referenceType: 'product',
          referenceId: product.id,
          reason: 'inventory_adjustment',
          note: 'تسوية مخزون',
          unitCost: openingUnitCost,
          moneyDigits: openingDigits,
          signedTotal: true,
          createdBy: actor.userId,
        });
        await this.postImportedOpeningStock(trx, {
          productId: Number(product.id),
          signedQty: actualDelta,
          unitCost: openingUnitCost,
          locationId,
          branchId,
          sourceType: 'import_opening_stock',
          sourceId: movementId,
          actor,
        });
        updated += 1;
      }

      return { updated };
    });

    await this.audit.log(
      'استيراد مخزون افتتاحي',
      `تم تحديث ${result.updated} سجل مخزون على يد ${actor.username}`,
      actor,
    );
    return { ok: true, updated: result.updated };
  }
}
