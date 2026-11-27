import { Kysely, sql, type Transaction } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';

/*
 * INV-VAN-GENERIC-FEFO (P9): the van-side generic batch ledger —
 * pure trx-first mirrors of moveVanPharmacyBatches /
 * deductVanSalePharmacyBatches (van-sales.service.ts) over
 * inventory_batches, plus the van-return restore (mirror of
 * restoreReturnedPharmacyBatches in returns.service.ts).
 *
 * Same rules as the pharmacy twins, with the same two deliberate
 * differences as the shop mirror (deductInventoryBatchesFefo):
 * 1. PRECEDENCE: the pharmacy ledger wins — a drug-linked product, or
 *    a product whose pharmacy rows still hold stock, never touches the
 *    generic ledger.
 * 2. NULL expiry is consumed LAST (explicit NULLS LAST), never skipped,
 *    never expired.
 *
 * These are pure functions (no `this`) so VanSalesService binds them
 * through thin wrappers and the van slices receive them as deps — the
 * file-size ratchet forbids growing van-sales.service.ts by the full
 * bodies (1927 lines, at its exact baseline).
 */

type Trx = Kysely<Database> | Transaction<Database>;
type Scope = { tenantId: string; accountId: string };

async function hasPharmacyPrecedence(trx: Trx, productId: number, scope: Scope): Promise<boolean> {
  const drug = await trx
    .selectFrom('pharmacy_drugs')
    .select('id')
    .where('product_id', '=', productId)
    .where('tenant_id', '=', scope.tenantId)
    .executeTakeFirst();
  if (drug) return true;
  const activePharmacy = await trx
    .selectFrom('pharmacy_batches')
    .select('id')
    .where('product_id', '=', productId)
    .where('tenant_id', '=', scope.tenantId)
    .where('status', '=', 'active')
    .where('quantity', '>', 0)
    .executeTakeFirst();
  return Boolean(activePharmacy);
}

function isExpired(expiry: string | null | undefined, todayIso: string): boolean {
  const exp = String(expiry || '')
    .trim()
    .slice(0, 10);
  if (!exp) return false;
  return exp.length === 7 ? exp < todayIso.slice(0, 7) : exp < todayIso;
}

/**
 * Soft FEFO move between locations (load / unload / supplementary load):
 * earliest-expiry-first, merges into the destination row of the same batch
 * number, never throws on a shortfall — a legacy ledger gap can only block
 * the sale itself (see deductVanSaleInventoryBatches), never the load.
 * Returns the moved quantity. Products with no generic batch rows are
 * untouched.
 */
export async function moveVanInventoryBatches(
  trx: Kysely<Database>,
  scope: Scope,
  productId: number,
  qty: number,
  fromLocationId: number,
  toLocationId: number,
): Promise<number> {
  const trxAny = trx;
  const remaining0 = Number(Number(qty || 0).toFixed(3));
  if (remaining0 <= 0 || fromLocationId === toLocationId) return 0;
  if (await hasPharmacyPrecedence(trx, productId, scope)) return 0;
  const anyBatch = await trxAny
    .selectFrom('inventory_batches')
    .select('id')
    .where('product_id', '=', productId)
    .where('tenant_id', '=', scope.tenantId)
    .limit(1)
    .executeTakeFirst();
  if (!anyBatch) return 0;

  const todayIso = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
  const batches = await trxAny
    .selectFrom('inventory_batches')
    .selectAll()
    .where('product_id', '=', productId)
    .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
    .where('location_id', '=', fromLocationId)
    .where('status', '=', 'active')
    .where('quantity', '>', 0)
    .orderBy('expiry_date', (ob: any) => ob.asc().nullsLast())
    .orderBy('id', 'asc')
    .forUpdate()
    .execute();

  let remaining = remaining0;
  let moved = 0;
  for (const batch of batches) {
    if (remaining <= 0) break;
    if (isExpired(batch.expiry_date, todayIso)) continue;

    const batchQty = Number(batch.quantity || 0);
    const take = Math.min(batchQty, remaining);
    const newQty = Number((batchQty - take).toFixed(3));

    const destRows = await trxAny
      .selectFrom('inventory_batches')
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
    // NULL == NULL merges: both sides normalize to '' before comparing.
    const destExpiry = String(destRows[0]?.expiry_date ?? '').slice(0, 10);
    const srcExpiry = String(batch.expiry_date ?? '').slice(0, 10);
    if (destRows.length === 1 && destExpiry !== srcExpiry) {
      throw new AppError('تاريخ صلاحية التشغيلة يختلف بين المخزنين', 'VAN_BATCH_DESTINATION_EXPIRY', 409);
    }
    if (destRows.length === 1) {
      await trxAny
        .updateTable('inventory_batches')
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
        .insertInto('inventory_batches')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          product_id: productId,
          batch_number: batch.batch_number,
          expiry_date: batch.expiry_date ?? null,
          quantity: take,
          unit_cost: batch.unit_cost,
          location_id: toLocationId,
          supplier_name: batch.supplier_name,
          status: 'active',
        })
        .execute();
    }

    await trxAny
      .updateTable('inventory_batches')
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
 * A field sale deducts the van location's generic batches
 * earliest-expiry-first. Like the pharmacy twin, the sale FAILS CLOSED
 * on a shortfall (failClosed=true); the settlement shortage leg passes
 * failClosed=false and deducts whatever cover exists. Allocation rows
 * are written by the caller once the sale items exist; this helper only
 * returns them.
 */
export async function deductVanSaleInventoryBatches(
  trx: Kysely<Database>,
  productId: number,
  qty: number,
  scope: Scope,
  vanLocationId: number,
  failClosed = true,
): Promise<Array<{ inventoryBatchId: number; quantity: number }>> {
  const trxAny = trx;
  if (await hasPharmacyPrecedence(trx, productId, scope)) return [];
  const linkedBatch = await trxAny
    .selectFrom('inventory_batches')
    .select('id')
    .where('product_id', '=', productId)
    .where('tenant_id', '=', scope.tenantId)
    .executeTakeFirst();
  if (!linkedBatch) return [];

  const todayIso = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
  let remaining = Number(Number(qty || 0).toFixed(3));
  const allocations: Array<{ inventoryBatchId: number; quantity: number }> = [];
  const batches = await trxAny
    .selectFrom('inventory_batches')
    .selectAll()
    .where('product_id', '=', productId)
    .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
    .where('status', '=', 'active')
    .where('quantity', '>', 0)
    .where((eb: any) => eb.or([eb('location_id', '=', vanLocationId), eb('location_id', 'is', null)]))
    .orderBy('expiry_date', (ob: any) => ob.asc().nullsLast())
    .orderBy('id', 'asc')
    .forUpdate()
    .execute();
  for (const batch of batches) {
    if (remaining <= 0) break;
    if (isExpired(batch.expiry_date, todayIso)) continue;

    const batchQty = Number(batch.quantity || 0);
    const alloc = Math.min(batchQty, remaining);
    const newQty = Number((batchQty - alloc).toFixed(3));
    const nextStatus = newQty <= 0 ? 'depleted' : 'active';

    await trxAny
      .updateTable('inventory_batches')
      .set({ quantity: newQty, status: nextStatus, updated_at: sql`NOW()` })
      .where('id', '=', Number(batch.id))
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();
    allocations.push({ inventoryBatchId: Number(batch.id), quantity: alloc });

    remaining = Number((remaining - alloc).toFixed(3));
  }
  if (remaining > 0 && failClosed) {
    throw new AppError(
      'لا توجد كمية كافية من تشغيلة سارية الصلاحية في سيارة التوزيع',
      'INVENTORY_FEFO_STOCK_UNAVAILABLE',
      422,
    );
  }
  return allocations;
}

/**
 * Van-return restore (mirror of restoreReturnedPharmacyBatches): restores
 * to the ORIGINAL batch, newest allocation first, skipping quantities
 * already restored by earlier approved returns. A NULL-expiry batch is
 * never expired — it restores to 'active'. Fail-closed: a sale with
 * generic batch rows but no allocations needs reconciliation, and a
 * return beyond the allocated quantity is refused.
 */
export async function restoreReturnedInventoryBatches(
  trx: Kysely<Database>,
  saleId: number,
  saleItemId: number,
  productId: number,
  previousReturnedBaseQty: number,
  returnBaseQty: number,
  scope: Scope,
): Promise<void> {
  const trxAny = trx;
  const allocations = await trxAny
    .selectFrom('sale_inventory_batch_allocations')
    .selectAll()
    .where('tenant_id', '=', scope.tenantId)
    .where('sale_id', '=', saleId)
    .where('sale_item_id', '=', saleItemId)
    .where('product_id', '=', productId)
    .orderBy('id', 'desc')
    .forUpdate()
    .execute();
  if (!allocations.length) {
    const anyBatch = await trxAny
      .selectFrom('inventory_batches')
      .select('id')
      .where('tenant_id', '=', scope.tenantId)
      .where('product_id', '=', productId)
      .limit(1)
      .executeTakeFirst();
    if (anyBatch) {
      throw new AppError(
        'الفاتورة بلا تخصيص تشغيلة رغم وجود سجل تشغيلات للصنف؛ يلزم مصالحة قبل المرتجع',
        'INVENTORY_BATCH_RECONCILIATION_REQUIRED',
        422,
      );
    }
    return;
  }
  let skip = Number(previousReturnedBaseQty.toFixed(3));
  let remaining = Number(returnBaseQty.toFixed(3));
  const today = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
  for (const allocation of allocations) {
    const sold = Number(allocation.quantity);
    const previouslyRestored = Math.min(sold, skip);
    skip = Number((skip - previouslyRestored).toFixed(3));
    const restore = Math.min(Number((sold - previouslyRestored).toFixed(3)), remaining);
    if (restore <= 0) continue;
    const batch = await trxAny
      .selectFrom('inventory_batches')
      .select(['id', 'quantity', 'expiry_date'])
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', Number(allocation.inventory_batch_id))
      .forUpdate()
      .executeTakeFirstOrThrow();
    const expired = isExpired(batch.expiry_date, today);
    await trxAny
      .updateTable('inventory_batches')
      .set({
        quantity: Number((Number(batch.quantity) + restore).toFixed(3)),
        status: expired ? 'expired' : 'active',
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', Number(batch.id))
      .execute();
    remaining = Number((remaining - restore).toFixed(3));
    if (remaining <= 0) break;
  }
  if (remaining > 0) throw new AppError('كمية المرتجع تتجاوز التشغيلة المباعة', 'INVENTORY_BATCH_RETURN_EXCEEDED', 422);
}
