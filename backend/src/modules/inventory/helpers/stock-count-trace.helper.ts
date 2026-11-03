import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';

export type StockCountBatchCount = {
  batchId?: number; batchNumber?: string; expiryDate?: string; countedQty: number;
};

function parseArray<T>(value: unknown): T[] {
  let decoded: unknown;
  try { decoded = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw new AppError('بيانات جرد الأصناف المتتبعة غير صالحة', 'COUNT_TRACE_INVALID', 409); }
  if (!Array.isArray(decoded)) throw new AppError('بيانات الجرد غير صالحة', 'COUNT_TRACE_INVALID', 409);
  return decoded as T[];
}
const precise = (v: unknown) => Number.isFinite(Number(v)) &&
  Number(v) >= 0 && Math.abs(Number(v) * 1000 - Math.round(Number(v) * 1000)) < 1e-7;

/** Reconcile physical serial identities and batch quantities before updating stock counters. */
export async function reconcileStockCountTrace(
  trx: Kysely<Database>,
  scope: { tenantId: string; accountId: string },
  input: {
    itemId: number; sessionId: number; productId: number;
    locationId: number; branchId: number | null;
    expectedQty: number; countedQty: number; unitCost: number;
    countedSerials: unknown; batchCounts: unknown;
  },
): Promise<void> {
  const serialNumbers = parseArray<string>(input.countedSerials ?? []);
  const batchCounts = parseArray<StockCountBatchCount>(input.batchCounts ?? []);
  const product = await trx.selectFrom('products').select(['track_serials']).where('id', '=', input.productId)
    .where('tenant_id', '=', scope.tenantId).executeTakeFirstOrThrow();
  const anySerial = await trx.selectFrom('product_serials').select('id').where('tenant_id', '=', scope.tenantId)
    .where('product_id', '=', input.productId).limit(1).executeTakeFirst();
  const anyBatch = await trx.selectFrom('pharmacy_batches').select('id').where('tenant_id', '=', scope.tenantId)
    .where('product_id', '=', input.productId).limit(1).executeTakeFirst();
  const drug = await trx.selectFrom('pharmacy_drugs').select('id').where('tenant_id', '=', scope.tenantId)
    .where('product_id', '=', input.productId).executeTakeFirst();
  const needsSerials = product.track_serials === true || Boolean(anySerial);
  const needsBatches = Boolean(anyBatch || drug);

  // The counted quantity is the physical on-hand quantity, reservations
  // included (INV-STOCK-COUNT-ACTUAL-DELTA). The registered serial/batch
  // ledger is gross too, so it reconciles against the GROSS scoped
  // quantity at the counted location -- never against the
  // available-basis expectedQty snapshot, which differs by exactly the
  // reserved quantity whenever a reservation exists and made every
  // tracked count with a reservation unpostable. The scoped row is
  // read locked: the caller already holds the product locks, and the
  // stale check ran against the same scope moments earlier in this
  // transaction. A missing balance row reads as zero (fail-closed).
  // Reserved quantities are never touched here: the stock write
  // (setScopedStockQty) still refuses a counted quantity below the
  // reserved quantity, and this helper writes no reserved_qty.
  let grossScopedQty: number | null = null;
  async function readGrossScopedQty(): Promise<number> {
    if (grossScopedQty == null) {
      let query = trx.selectFrom('product_location_stock').select('qty')
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .where('product_id', '=', input.productId)
        .where('location_id', '=', input.locationId);
      query = input.branchId == null ? query.where('branch_id', 'is', null) : query.where('branch_id', '=', input.branchId);
      const row = await query.forUpdate().executeTakeFirst();
      grossScopedQty = row ? Number(row.qty || 0) : 0;
    }
    return grossScopedQty;
  }

  if (needsSerials) {
    if (!Number.isSafeInteger(input.expectedQty) || !Number.isSafeInteger(input.countedQty) ||
      serialNumbers.length !== input.countedQty || new Set(serialNumbers.map(s => String(s).trim().toLowerCase())).size !== serialNumbers.length ||
      serialNumbers.some(s => !String(s).trim())) {
      throw new AppError('حدد جميع السيريالات الموجودة فعلاً بعد الجرد', 'COUNT_SERIALS_REQUIRED', 422);
    }
    let query = trx.selectFrom('product_serials').select(['id', 'serial_number']).where('tenant_id', '=', scope.tenantId)
      .where('product_id', '=', input.productId).where('status', '=', 'in_stock')
      .where('location_id', '=', input.locationId);
    query = input.branchId == null ? query.where('branch_id', 'is', null) : query.where('branch_id', '=', input.branchId);
    const current = await query.orderBy('id', 'asc').forUpdate().execute();
    const ledgerQty = await readGrossScopedQty();
    if (current.length !== ledgerQty) {
      throw new AppError('الرصيد المسجل للسيريالات لا يساوي المخزون؛ يلزم مصالحة قبل الجرد',
        'COUNT_SERIAL_LEDGER_MISMATCH', 409);
    }
    const found = new Set(serialNumbers.map(s => String(s).trim().toLowerCase()));
    const missing = current.filter(s => !found.has(s.serial_number.toLowerCase()));
    const existing = new Set(current.map(s => s.serial_number.toLowerCase()));
    const newSerials = serialNumbers.map(s => String(s).trim()).filter(s => !existing.has(s.toLowerCase()));
    for (const serial of newSerials) {
      const occupied = await trx.selectFrom('product_serials').select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where(sql<boolean>`lower(serial_number) = lower(${serial})`).limit(1).executeTakeFirst();
      if (occupied) throw new AppError('السيريال موجود في سجل سابق؛ يلزم تسوية مكانه قبل إضافته',
        'COUNT_SERIAL_DUPLICATE', 409);
    }
    if (missing.length) await trx.updateTable('product_serials')
      .set({ status: 'scrapped', branch_id: null, location_id: null,
        notes: `عجز جرد جلسة ${input.sessionId} بند ${input.itemId}`, updated_at: sql`NOW()` })
      .where('tenant_id', '=', scope.tenantId)
      .where('id', 'in', missing.map(row => Number(row.id))).execute();
    if (newSerials.length) {
      await trx.insertInto('product_serials').values(newSerials.map(serial => ({
        tenant_id: scope.tenantId, account_id: scope.accountId,
        product_id: input.productId, serial_number: serial, imei_2: null,
        status: 'in_stock' as const, branch_id: input.branchId,
        location_id: input.locationId, cost_price: input.unitCost,
        purchase_id: null, purchase_item_id: null, sale_id: null, sale_item_id: null,
        warranty_end_date: null,
        notes: `زيادة جرد جلسة ${input.sessionId} بند ${input.itemId}`,
      } as any))).execute();
    }
  } else if (serialNumbers.length) {
    throw new AppError('لا يمكن إضافة سيريالات لصنف غير متتبع', 'COUNT_SERIAL_UNEXPECTED', 400);
  }

  if (needsBatches) {
    if ((!batchCounts.length && input.countedQty !== 0) || batchCounts.some(row => !precise(row.countedQty)) ||
      Math.abs(batchCounts.reduce((sum, row) => sum + Number(row.countedQty), 0) - input.countedQty) > 1e-7) {
      throw new AppError('يجب إدخال الرصيد الفعلي لكل تشغيلة بحيث يساوي الكمية المعدودة', 'COUNT_BATCH_COUNTS_REQUIRED', 422);
    }
    const ids = batchCounts.filter(row => row.batchId != null).map(row => Number(row.batchId));
    const newNames = batchCounts.filter(row => row.batchId == null).map(row => String(row.batchNumber || '').trim().toLowerCase());
    if (new Set(ids).size !== ids.length || new Set(newNames).size !== newNames.length) {
      throw new AppError('التشغيلة مكررة في الجرد', 'COUNT_BATCH_DUPLICATE', 400);
    }
    const stored = await trx.selectFrom('pharmacy_batches').selectAll()
      .where('tenant_id', '=', scope.tenantId).where('product_id', '=', input.productId)
      .where('location_id', '=', input.locationId).orderBy('id', 'asc').forUpdate().execute();
    const registeredQty = stored.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const ledgerQty = await readGrossScopedQty();
    if (Math.abs(registeredQty - ledgerQty) > 1e-7) {
      throw new AppError('سجل التشغيلات لا يطابق المخزون قبل الجرد', 'COUNT_BATCH_LEDGER_MISMATCH', 409);
    }
    const normalized = new Map<number, number>();
    for (const row of batchCounts) {
      if (row.batchId == null) continue;
      const original = stored.find(lot => Number(lot.id) === Number(row.batchId));
      if (!original || !precise(row.countedQty)) {
        throw new AppError('رقم تشغيلة الجرد لا يخص المخزن', 'COUNT_BATCH_NOT_AVAILABLE', 409);
      }
      normalized.set(Number(row.batchId), Number(row.countedQty));
    }
    for (const row of stored) {
      const newQty = normalized.get(Number(row.id)) || 0;
      if (Math.abs(Number(row.quantity || 0) - newQty) > 1e-7) {
        await trx.updateTable('pharmacy_batches').set({
          quantity: newQty, status: newQty > 0 ? 'active' : 'depleted',
          updated_at: sql`NOW()`,
        }).where('id', '=', Number(row.id)).where('tenant_id', '=', scope.tenantId).execute();
      }
    }
    for (const row of batchCounts.filter(row => row.batchId == null)) {
      if (!row.batchNumber?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.expiryDate || '')) ||
        Number(row.countedQty) <= 0) {
        throw new AppError('زيادة تشغيلة جديدة تحتاج رقمها وتاريخ صلاحيتها وكمية صحيحة',
          'COUNT_BATCH_NEW_INVALID', 422);
      }
      const existingLot = stored.find(old => old.batch_number === row.batchNumber?.trim());
      if (existingLot) throw new AppError('تشغيلة موجودة؛ استخدم رقمها الداخلي', 'COUNT_BATCH_EXISTING_LOT', 409);
      await trx.insertInto('pharmacy_batches').values({
        tenant_id: scope.tenantId, account_id: scope.accountId, product_id: input.productId,
        drug_id: drug?.id || null, batch_number: row.batchNumber.trim(),
        expiry_date: String(row.expiryDate), quantity: Number(row.countedQty),
        unit_cost: input.unitCost, location_id: input.locationId,
        supplier_name: null, status: 'active',
        notes: `زيادة جرد جلسة ${input.sessionId} بند ${input.itemId}`,
      } as any).execute();
    }
  } else if (batchCounts.length) {
    throw new AppError('الصنف غير مرتبط بتشغيلات', 'COUNT_BATCH_UNEXPECTED', 400);
  }
  if (!needsSerials && !needsBatches) return;
}
