import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';

export type TrackedIncreaseBatchAllocation = {
  batchId?: number;
  batchNumber?: string;
  expiryDate?: string;
  qty: number;
};

const roundQty = (value: number) => Math.round(value * 1000) / 1000;
function preciseQty(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.abs(n - roundQty(n)) > 1e-7) {
    throw new AppError('كمية التتبع غير صالحة', 'ADJUSTMENT_TRACE_QTY_INVALID', 400);
  }
  return roundQty(n);
}

/**
 * INV-TRANSFER-DISPATCH-FEFO, applied to increases: a batch is
 * increaseable only while it is 'active' and unexpired — a 7-char
 * expiry (YYYY-MM) must not precede the current month, a full date
 * must not precede today, and a missing expiry never qualifies.
 *
 * DATE columns arrive as JS Date objects from the driver, so the
 * expiry is normalized to ISO first: String(date).slice(0, 10) yields
 * 'Wed Jan 01', which compares greater than every YYYY-MM-DD string
 * and would let an expired batch gain quantity.
 */
function expiryIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').trim().slice(0, 10);
}

function isIncreaseableBatch(batch: { expiry_date?: unknown; status?: unknown }, todayIso: string, currentMonthIso: string): boolean {
  if (batch.status !== 'active') return false;
  const exp = expiryIso(batch.expiry_date);
  if (!exp) return false;
  if (exp.length === 7) return exp >= currentMonthIso;
  return exp >= todayIso;
}

/**
 * INV-SPIRIT-TRACKED-INCREASE: a tracked-stock increase recorded as a
 * documented adjustment. The caller names the specific serials and/or
 * batches being added; no full tracked count is required. Serial and
 * batch uniqueness and duplicate guards stay exactly as the count
 * path enforces them: a serial already registered anywhere in the
 * tenant is rejected, a batch number already registered at the
 * location must be named by its internal id, and an expired or
 * non-active batch can never gain quantity. Called after the product
 * row has been locked and before any quantity movement, inside the
 * same transaction as the stock write, so a failed adjustment records
 * no trace rows.
 */
export async function recordTrackedStockIncrease(
  trx: Kysely<Database>,
  scope: { tenantId: string; accountId: string },
  input: {
    productId: number; qty: number; unitCost: number;
    serials?: string[]; batchAllocations?: TrackedIncreaseBatchAllocation[];
    reason: string;
  },
  locationId: number,
  branchId: number | null,
): Promise<void> {
  const productId = Number(input.productId);
  const qty = preciseQty(input.qty);
  if (qty <= 0) throw new AppError('كمية الزيادة يجب أن تكون موجبة', 'ADJUSTMENT_TRACE_QTY_INVALID', 400);

  const product = await trx.selectFrom('products').select(['track_serials']).where('tenant_id', '=', scope.tenantId)
    .where('id', '=', productId).executeTakeFirstOrThrow();
  const anySerial = await trx.selectFrom('product_serials').select('id')
    .where('tenant_id', '=', scope.tenantId).where('product_id', '=', productId).limit(1).executeTakeFirst();
  const anyBatch = await trx.selectFrom('pharmacy_batches').select('id')
    .where('tenant_id', '=', scope.tenantId).where('product_id', '=', productId).limit(1).executeTakeFirst();
  const drug = await trx.selectFrom('pharmacy_drugs').select('id')
    .where('tenant_id', '=', scope.tenantId).where('product_id', '=', productId).executeTakeFirst();
  const serialTracked = Boolean(product.track_serials || anySerial);
  const batchTracked = Boolean(anyBatch || drug);

  const serials = (input.serials || []).map((s) => String(s).trim());
  if (serialTracked) {
    if (!Number.isSafeInteger(qty)) {
      throw new AppError('الصنف التسلسلي يزيد بوحدات صحيحة فقط', 'ADJUSTMENT_SERIAL_QTY', 400);
    }
    if (serials.length !== qty || serials.some((s) => !s) ||
      new Set(serials.map((s) => s.toLowerCase())).size !== serials.length) {
      throw new AppError('سمِّ كل سيريال مضاف بحيث يساوي عددها كمية الزيادة دون تكرار',
        'ADJUSTMENT_TRACKED_INCREASE_UNDOCUMENTED', 422);
    }
    for (const serial of serials) {
      const occupied = await trx.selectFrom('product_serials').select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where(sql<boolean>`lower(serial_number) = lower(${serial})`).limit(1).executeTakeFirst();
      if (occupied) {
        throw new AppError('السيريال موجود في سجل سابق؛ يلزم تسوية مكانه قبل إضافته',
          'ADJUSTMENT_SERIAL_DUPLICATE', 409);
      }
    }
    await trx.insertInto('product_serials').values(serials.map((serial) => ({
      tenant_id: scope.tenantId, account_id: scope.accountId,
      product_id: productId, serial_number: serial, imei_2: null,
      status: 'in_stock' as const, branch_id: branchId,
      location_id: locationId, cost_price: input.unitCost,
      purchase_id: null, purchase_item_id: null, sale_id: null, sale_item_id: null,
      warranty_end_date: null,
      notes: `زيادة تسوية موثقة: ${input.reason}`,
    } as any))).execute();
  } else if (serials.length) {
    throw new AppError('الصنف غير مسجل بالسيريالات', 'ADJUSTMENT_UNEXPECTED_SERIAL_INPUT', 400);
  }

  const allocations = input.batchAllocations || [];
  if (batchTracked) {
    if (!allocations.length ||
      Math.abs(roundQty(allocations.reduce((sum, a) => sum + preciseQty(a.qty), 0)) - qty) > 1e-7 ||
      allocations.some((a) => preciseQty(a.qty) <= 0)) {
      throw new AppError('حدد توزيع كمية الزيادة على التشغيلات بدقة بحيث يساوي مجموعها كمية الزيادة',
        'ADJUSTMENT_TRACKED_INCREASE_UNDOCUMENTED', 422);
    }
    const ids = allocations.filter((a) => a.batchId != null).map((a) => Number(a.batchId));
    const newNames = allocations.filter((a) => a.batchId == null).map((a) => String(a.batchNumber || '').trim().toLowerCase());
    if (new Set(ids).size !== ids.length || new Set(newNames).size !== newNames.length) {
      throw new AppError('التشغيلة مكررة في التسوية', 'ADJUSTMENT_BATCH_DUPLICATE', 400);
    }
    const todayIso = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
    const currentMonthIso = todayIso.slice(0, 7);
    const stored = await trx.selectFrom('pharmacy_batches').selectAll()
      .where('tenant_id', '=', scope.tenantId).where('product_id', '=', productId)
      .where('location_id', '=', locationId).orderBy('id', 'asc').forUpdate().execute();
    for (const allocation of allocations) {
      const amount = preciseQty(allocation.qty);
      if (allocation.batchId != null) {
        const batch = stored.find((lot) => Number(lot.id) === Number(allocation.batchId));
        const suppliedExpiry = String(allocation.expiryDate || '').trim().slice(0, 10);
        if (!batch || !isIncreaseableBatch(batch, todayIso, currentMonthIso) ||
          (suppliedExpiry && expiryIso(batch.expiry_date) !== suppliedExpiry)) {
          throw new AppError('تشغيلة غير موجودة أو منتهية أو غير نشطة في المخزن؛ لا يجوز زيادتها',
            'ADJUSTMENT_BATCH_NOT_AVAILABLE', 409);
        }
        await trx.updateTable('pharmacy_batches')
          .set({
            quantity: roundQty(Number(batch.quantity || 0) + amount),
            unit_cost: input.unitCost, status: 'active', updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(batch.id)).execute();
      } else {
        const batchNumber = String(allocation.batchNumber || '').trim();
        const expiryDate = String(allocation.expiryDate || '').trim();
        if (!batchNumber || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || expiryDate < todayIso) {
          throw new AppError('زيادة تشغيلة جديدة تحتاج رقمها وتاريخ صلاحية سارياً وكمية صحيحة',
            'ADJUSTMENT_BATCH_NEW_INVALID', 422);
        }
        if (stored.some((lot) => String(lot.batch_number || '').trim() === batchNumber)) {
          throw new AppError('تشغيلة موجودة؛ استخدم رقمها الداخلي', 'ADJUSTMENT_BATCH_EXISTING_LOT', 409);
        }
        await trx.insertInto('pharmacy_batches').values({
          tenant_id: scope.tenantId, account_id: scope.accountId, product_id: productId,
          drug_id: drug?.id || null, batch_number: batchNumber,
          expiry_date: expiryDate, quantity: amount,
          unit_cost: input.unitCost, location_id: locationId,
          supplier_name: null, status: 'active',
          notes: `زيادة تسوية موثقة: ${input.reason}`,
        } as any).execute();
      }
    }
  } else if (allocations.length) {
    throw new AppError('الصنف غير مرتبط بتشغيلات', 'ADJUSTMENT_UNEXPECTED_BATCH_INPUT', 400);
  }
}
