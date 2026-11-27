import {
  deductVanSaleInventoryBatches as deductVanSaleInventoryBatchesHelper,
  moveVanInventoryBatches as moveVanInventoryBatchesHelper,
} from '../services/van-inventory-batches.helper';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import {
  generateDailySequenceNumber,
  getOrCreateVanLocation,
  moveVanStock,
  sortItemsByProductId,
} from '../services/van-common.util';
import type { MoveVanStockParams } from './van-sales-types';

export class StockBatchHelpersService {
  constructor(private readonly db: Kysely<Database>) {}

  sortItemsByProductId<T extends { productId: number }>(items: T[]): T[] {
    return sortItemsByProductId(items);
  }

  async moveVanStock(
    trx: Kysely<Database>,
    params: MoveVanStockParams,
  ): Promise<{ scopeBefore: number; scopeAfter: number }> {
    return moveVanStock(trx, params);
  }

  /**
   * INV-VAN-FEFO-BATCHES: the pharmacy batch ledger moves with the pooled
   * van stock. Loading a van carries the earliest-expiry batches from the
   * source location onto the van location (merging into the destination
   * row of the same batch number, exactly like the direct tracked-stock
   * move); unloading carries them back. The move is deliberately soft:
   * it carries whatever batch cover exists at the source location and
   * never throws on a shortfall, so a legacy ledger gap can only block
   * the sale itself (see deductVanSalePharmacyBatches), never the load,
   * the unload, or the settlement. Products with no drug link and no
   * batch rows are untouched.
   */
  async moveVanPharmacyBatches(
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    productId: number,
    qty: number,
    fromLocationId: number,
    toLocationId: number,
  ): Promise<number> {
    const trxAny = trx;
    const remaining0 = Number(Number(qty || 0).toFixed(3));
    if (remaining0 <= 0 || fromLocationId === toLocationId) return 0;

    const drug = await trxAny
      .selectFrom('pharmacy_drugs')
      .select('id')
      .where('product_id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const anyBatch = await trxAny
      .selectFrom('pharmacy_batches')
      .select('id')
      .where('product_id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .limit(1)
      .executeTakeFirst();
    if (!drug && !anyBatch) return 0;

    const todayIso = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
    const currentMonthIso = todayIso.slice(0, 7);
    const batches = await trxAny
      .selectFrom('pharmacy_batches')
      .selectAll()
      .where((eb: any) =>
        eb.or([
          eb('product_id', '=', productId),
          eb(
            'drug_id',
            'in',
            trxAny
              .selectFrom('pharmacy_drugs')
              .select('id')
              .where('product_id', '=', productId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`),
          ),
        ]),
      )
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('location_id', '=', fromLocationId)
      .where('status', '=', 'active')
      .where('quantity', '>', 0)
      .orderBy('expiry_date', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .execute();

    let remaining = remaining0;
    let moved = 0;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const exp = String(batch.expiry_date || '')
        .trim()
        .slice(0, 10);
      if (!exp || (exp.length === 7 ? exp < currentMonthIso : exp < todayIso)) continue;

      const batchQty = Number(batch.quantity || 0);
      const take = Math.min(batchQty, remaining);
      const newQty = Number((batchQty - take).toFixed(3));

      const destRows = await trxAny
        .selectFrom('pharmacy_batches')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', productId)
        .where('location_id', '=', toLocationId)
        .where('batch_number', '=', batch.batch_number)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      if (destRows.length > 1) {
        throw new AppError(
          'تشغيلة وجهة مكررة تحتاج مصالحة قبل نقلها لسيارة التوزيع',
          'VAN_BATCH_DESTINATION_DUPLICATE',
          409,
        );
      }
      if (
        destRows.length === 1 &&
        String(destRows[0].expiry_date).slice(0, 10) !== String(batch.expiry_date).slice(0, 10)
      ) {
        throw new AppError('تاريخ صلاحية التشغيلة يختلف بين المخزنين', 'VAN_BATCH_DESTINATION_EXPIRY', 409);
      }
      if (destRows.length === 1) {
        await trxAny
          .updateTable('pharmacy_batches')
          .set({
            quantity: Number((Number(destRows[0].quantity) + take).toFixed(3)),
            status: 'active',
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', Number(destRows[0].id))
          .execute();
      } else {
        await trxAny
          .insertInto('pharmacy_batches')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            product_id: productId,
            drug_id: batch.drug_id,
            batch_number: batch.batch_number,
            expiry_date: batch.expiry_date,
            quantity: take,
            unit_cost: batch.unit_cost,
            location_id: toLocationId,
            supplier_name: batch.supplier_name,
            status: 'active',
          })
          .execute();
      }

      await trxAny
        .updateTable('pharmacy_batches')
        .set({
          quantity: newQty,
          status: newQty <= 0 ? 'depleted' : 'active',
          updated_at: sql`NOW()`,
        })
        .where('id', '=', Number(batch.id))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      remaining = Number((remaining - take).toFixed(3));
      moved = Number((moved + take).toFixed(3));
    }
    return moved;
  }

  /**
   * INV-VAN-FEFO-BATCHES: a field sale deducts the van location's batches
   * earliest-expiry-first, with the same gate, expiry-skip rules, and
   * shortfall error as the shop FEFO deduction. Unlike the load/unload
   * move, the sale FAILS CLOSED on a shortfall: expired stock must never
   * reach a customer through the pooled quantity alone. Callers that
   * must never block (the settlement shortage leg) pass failClosed=false
   * and deduct whatever cover exists. Allocation rows are written by the
   * caller once the sale items exist; this helper only returns them.
   */
  async deductVanSalePharmacyBatches(
    trx: Kysely<Database>,
    productId: number,
    qty: number,
    scope: { tenantId: string; accountId: string },
    vanLocationId: number,
    failClosed = true,
  ): Promise<Array<{ pharmacyBatchId: number; quantity: number }>> {
    const trxAny = trx;
    const drug = await trxAny
      .selectFrom('pharmacy_drugs')
      .select('id')
      .where('product_id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const linkedBatch = await trxAny
      .selectFrom('pharmacy_batches')
      .select('id')
      .where('product_id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!drug && !linkedBatch) return [];

    const todayIso = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
    const currentMonthIso = todayIso.slice(0, 7);
    let remaining = Number(Number(qty || 0).toFixed(3));
    const allocations: Array<{ pharmacyBatchId: number; quantity: number }> = [];
    const batches = await trxAny
      .selectFrom('pharmacy_batches')
      .selectAll()
      .where((eb: any) =>
        eb.or([
          eb('product_id', '=', productId),
          eb(
            'drug_id',
            'in',
            trxAny
              .selectFrom('pharmacy_drugs')
              .select('id')
              .where('product_id', '=', productId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`),
          ),
        ]),
      )
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('status', '=', 'active')
      .where('quantity', '>', 0)
      .where((eb: any) => eb.or([eb('location_id', '=', vanLocationId), eb('location_id', 'is', null)]))
      .orderBy('expiry_date', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .execute();
    for (const batch of batches) {
      if (remaining <= 0) break;
      const exp = String(batch.expiry_date || '')
        .trim()
        .slice(0, 10);
      if (!exp || (exp.length === 7 ? exp < currentMonthIso : exp < todayIso)) continue;

      const batchQty = Number(batch.quantity || 0);
      const alloc = Math.min(batchQty, remaining);
      const newQty = Number((batchQty - alloc).toFixed(3));
      const nextStatus = newQty <= 0 ? 'depleted' : 'active';

      await trxAny
        .updateTable('pharmacy_batches')
        .set({ quantity: newQty, status: nextStatus, updated_at: sql`NOW()` })
        .where('id', '=', Number(batch.id))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      allocations.push({ pharmacyBatchId: Number(batch.id), quantity: alloc });

      remaining = Number((remaining - alloc).toFixed(3));
    }
    if (remaining > 0 && failClosed) {
      throw new AppError(
        'لا توجد كمية كافية من تشغيلة دوائية سارية الصلاحية في سيارة التوزيع',
        'PHARMACY_FEFO_STOCK_UNAVAILABLE',
        422,
      );
    }
    return allocations;
  }

  // INV-VAN-GENERIC-FEFO: thin wrappers over the pure generic helpers
  // (van-inventory-batches.helper.ts) — the bodies live there so this
  // file (1927 lines, at its exact ratchet baseline) grows by wrappers
  // only. Signatures mirror the pharmacy twins above.
  async moveVanInventoryBatches(
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    productId: number,
    qty: number,
    fromLocationId: number,
    toLocationId: number,
  ): Promise<number> {
    return moveVanInventoryBatchesHelper(trx, scope, productId, qty, fromLocationId, toLocationId);
  }

  async deductVanSaleInventoryBatches(
    trx: Kysely<Database>,
    productId: number,
    qty: number,
    scope: { tenantId: string; accountId: string },
    vanLocationId: number,
    failClosed = true,
  ): Promise<Array<{ inventoryBatchId: number; quantity: number }>> {
    return deductVanSaleInventoryBatchesHelper(trx, productId, qty, scope, vanLocationId, failClosed);
  }

  async getOrCreateVanLocation(
    repId: number,
    tenantId: string,
    accountId: string,
  ): Promise<{ id: number; name: string }> {
    return getOrCreateVanLocation(this.db, repId, tenantId, accountId);
  }

  async generateDailySequenceNumber(
    trxOrDb: any,
    tableName: string,
    columnName: string,
    prefix: string,
    tenantId: string,
    date = new Date(),
  ): Promise<string> {
    return generateDailySequenceNumber(trxOrDb, this.db, tableName, columnName, prefix, tenantId, date);
  }
}
