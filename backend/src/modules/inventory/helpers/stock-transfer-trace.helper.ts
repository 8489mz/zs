import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';

type Scope = { tenantId: string; accountId: string };
export type TransferBatchRequest = { batchId: number; qty: number };
export type TransferItemTraceRequest = { productId: number; qty: number; serials?: string[]; batchAllocations?: TransferBatchRequest[] };
export type TransferReceiptTraceRequest = { itemId: number; receivedQty: number; receivedSerials?: string[]; batchReceipts?: Array<{ transitBatchId: number; receivedQty: number }> };
export type TransferSerialTrace = { id: number; serial: string };
export type TransferBatchTrace = { sourceBatchId: number; transitBatchId: number | null; qty: number; receivedQty?: number };

const roundQty = (value: number) => Math.round(value * 1000) / 1000;
function preciseQty(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.abs(n - roundQty(n)) > 1e-7) {
    throw new AppError('كمية تتبع التحويل غير صالحة', 'TRANSFER_TRACE_QTY_INVALID', 400);
  }
  return roundQty(n);
}
function parseTrace<T>(value: unknown): T[] {
  const decoded = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(decoded)) throw new AppError('بيانات تتبع التحويل تالفة', 'TRANSFER_TRACE_CORRUPT', 409);
  return decoded as T[];
}

/**
 * INV-TRANSFER-DISPATCH-FEFO: the sale path's FEFO rule,
 * shared verbatim. A batch may be dispatched only while it
 * is 'active' and unexpired: a 7-char expiry (YYYY-MM) must
 * not precede the current month, a full date must not
 * precede today, and a missing expiry never dispatches --
 * exactly the predicate deductPharmacyBatchesFefo applies
 * at sale time. The previous dispatch ordering (id asc,
 * no status or expiry filter) shipped the oldest-created
 * lots first, including expired ones.
 */
function isDispatchableBatch(batch: { expiry_date?: unknown; status?: unknown }, todayIso: string, currentMonthIso: string): boolean {
  if (batch.status !== 'active') return false;
  const exp = String(batch.expiry_date || '').trim().slice(0, 10);
  if (!exp) return false;
  if (exp.length === 7) return exp >= currentMonthIso;
  return exp >= todayIso;
}

/** Called after the product row has been locked, and before any quantity movement. */
export async function dispatchTrackedStock(
  trx: Kysely<Database>, scope: Scope,
  input: TransferItemTraceRequest, fromLocationId: number, fromBranchId: number | null,
  transitLocationId: number | null, transferId: number,
): Promise<{ serialTracking: TransferSerialTrace[]; batchTracking: TransferBatchTrace[]; tracked: boolean }> {
  const productId = Number(input.productId);
  const qty = preciseQty(input.qty);
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

  let serialTracking: TransferSerialTrace[] = [];
  if (serialTracked) {
    if (!Number.isSafeInteger(qty)) throw new AppError('الصنف التسلسلي ينتقل بوحدات صحيحة فقط', 'TRANSFER_SERIAL_QTY', 400);
    let availableQuery = trx.selectFrom('product_serials').select(['id', 'serial_number', 'imei_2'])
      .where('tenant_id', '=', scope.tenantId).where('product_id', '=', productId)
      .where('status', '=', 'in_stock').where('location_id', '=', fromLocationId);
    availableQuery = fromBranchId == null ? availableQuery.where('branch_id', 'is', null)
      : availableQuery.where('branch_id', '=', fromBranchId);
    const available = await availableQuery.orderBy('id', 'asc').forUpdate().execute();
    const requested = (input.serials || []).map(s => String(s).trim().toLowerCase());
    if (requested.some(s => !s) || requested.length !== new Set(requested).size) {
      throw new AppError('السيريالات غير صالحة أو مكررة', 'TRANSFER_SERIAL_SELECTION_INVALID', 400);
    }
    if (!requested.length && available.length < qty) {
      throw new AppError('رصيد السيريالات المتاحة في المخزن غير كافٍ', 'TRANSFER_SERIALS_INSUFFICIENT', 409);
    }
    const selected = requested.length
      ? available.filter(s => requested.includes(s.serial_number.toLowerCase()) ||
        Boolean(s.imei_2 && requested.includes(s.imei_2.toLowerCase())))
      : available.slice(0, qty);
    if (selected.length !== qty || (requested.length > 0 && requested.length !== selected.length)) {
      throw new AppError('السيريالات لا تطابق رصيد مخزن المصدر', 'TRANSFER_SERIALS_NOT_AVAILABLE', 409);
    }
    serialTracking = selected.map(s => ({ id: Number(s.id), serial: s.serial_number }));
    await trx.updateTable('product_serials')
      .set(transitLocationId == null
        ? { status: 'scrapped', location_id: null, branch_id: null, updated_at: sql`NOW()` }
        : { status: 'in_stock', location_id: transitLocationId, branch_id: null, updated_at: sql`NOW()` })
      .where('tenant_id', '=', scope.tenantId)
      .where('id', 'in', serialTracking.map(s => s.id)).execute();
  } else if (input.serials?.length) {
    throw new AppError('الصنف غير مسجل بالسيريالات', 'TRANSFER_UNTRACKED_SERIAL_INPUT', 400);
  }

  const batchTracking: TransferBatchTrace[] = [];
  if (batchTracked) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const currentMonthIso = todayIso.slice(0, 7);
    const candidates = await trx.selectFrom('pharmacy_batches').selectAll()
      .where('tenant_id', '=', scope.tenantId).where('product_id', '=', productId)
      .where('location_id', '=', fromLocationId).where('quantity', '>', 0)
      .where('status', '=', 'active')
      .orderBy('expiry_date', 'asc').orderBy('id', 'asc').forUpdate().execute();
    let allocations = input.batchAllocations || [];
    if (!allocations.length) {
      let remaining = qty;
      allocations = [];
      for (const candidate of candidates) {
        if (remaining <= 0) break;
        if (!isDispatchableBatch(candidate, todayIso, currentMonthIso)) continue;
        const availableInBatch = Number(candidate.quantity || 0);
        if (availableInBatch > 0) {
          const take = Math.min(availableInBatch, remaining);
          allocations.push({ batchId: Number(candidate.id), qty: roundQty(take) });
          remaining = roundQty(remaining - take);
        }
      }
    }
    const ids = allocations.map(a => Number(a.batchId));
    if (!allocations.length || new Set(ids).size !== ids.length ||
      Math.abs(roundQty(allocations.reduce((sum, a) => sum + preciseQty(a.qty), 0)) - qty) > 1e-7) {
      throw new AppError('حدد توزيع الكمية على التشغيلات بدقة أو تأكد من كفاية الرصيد', 'TRANSFER_BATCH_ALLOCATION_REQUIRED', 422);
    }
    for (const allocation of [...allocations].sort((a, b) => a.batchId - b.batchId)) {
      const batch = candidates.find(candidate => Number(candidate.id) === Number(allocation.batchId));
      const amount = preciseQty(allocation.qty);
      // Explicit allocations are held to the same FEFO rule:
      // naming an expired or non-active batch must not bypass
      // it, or the guard is only a default, not a rule.
      if (!batch || amount <= 0 || Number(batch.quantity) + 1e-7 < amount || !isDispatchableBatch(batch, todayIso, currentMonthIso)) {
        throw new AppError('تشغيلة غير موجودة أو رصيدها غير كافٍ في المصدر', 'TRANSFER_BATCH_NOT_AVAILABLE', 409);
      }
      await trx.updateTable('pharmacy_batches')
        .set({ quantity: roundQty(Number(batch.quantity) - amount), updated_at: sql`NOW()` })
        .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(batch.id)).execute();
      let transitBatchId: number | null = null;
      if (transitLocationId != null) {
        const inserted = await trx.insertInto('pharmacy_batches').values({
          tenant_id: scope.tenantId, account_id: scope.accountId,
          product_id: productId, drug_id: batch.drug_id,
          batch_number: batch.batch_number, expiry_date: batch.expiry_date,
          quantity: amount, unit_cost: batch.unit_cost, location_id: transitLocationId,
          supplier_name: batch.supplier_name, status: 'in_transit',
          notes: `تحويل مخزون ${transferId} من تشغيلة ${batch.id}`,
        } as any).returning('id').executeTakeFirstOrThrow();
        transitBatchId = Number(inserted.id);
      }
      batchTracking.push({ sourceBatchId: Number(batch.id), transitBatchId, qty: amount });
    }
  } else if (input.batchAllocations?.length) {
    throw new AppError('الصنف ليس له تشغيلات', 'TRANSFER_UNTRACKED_BATCH_INPUT', 400);
  }
  return { serialTracking, batchTracking, tracked: serialTracked || batchTracked };
}

/** Validate the exact physical identity of the units received/lost before stock is posted. */
export async function receiveTrackedStock(
  trx: Kysely<Database>, scope: Scope,
  traceRow: { serial_tracking?: unknown; batch_tracking?: unknown; product_id: number },
  receipt: TransferReceiptTraceRequest, transitLocationId: number,
  toLocationId: number, toBranchId: number | null, transferId: number,
): Promise<TransferBatchTrace[]> {
  const serials = parseTrace<TransferSerialTrace>(traceRow.serial_tracking ?? []);
  const batches = parseTrace<TransferBatchTrace>(traceRow.batch_tracking ?? []);
  const received = preciseQty(receipt.receivedQty);
  if (serials.length) {
    if (!Number.isSafeInteger(received)) throw new AppError('لا يمكن استلام جزء من قطعة ذات سيريال', 'TRANSFER_SERIAL_RECEIVED_QTY', 400);
    const ids = serials.map(s => Number(s.id));
    const current = await trx.selectFrom('product_serials').select(['id', 'serial_number', 'imei_2'])
      .where('tenant_id', '=', scope.tenantId).where('product_id', '=', Number(traceRow.product_id))
      .where('id', 'in', ids).where('status', '=', 'in_stock')
      .where('location_id', '=', transitLocationId).where('branch_id', 'is', null)
      .orderBy('id', 'asc').forUpdate().execute();
    if (current.length !== serials.length) throw new AppError('سيريالات بالطريق تغيرت؛ يلزم تسوية', 'TRANSFER_SERIAL_TRANSIT_MISMATCH', 409);
    const requested = (receipt.receivedSerials || []).map(s => String(s).trim().toLowerCase());
    if (new Set(requested).size !== requested.length || requested.some(s => !s) ||
      (!requested.length && received !== serials.length && received !== 0)) {
      throw new AppError('حدد سيريالات القطع التي وصلت فعلاً', 'TRANSFER_RECEIPT_SERIALS_REQUIRED', 422);
    }
    const selected = requested.length
      ? current.filter(s => requested.includes(s.serial_number.toLowerCase()) ||
        Boolean(s.imei_2 && requested.includes(s.imei_2.toLowerCase())))
      : received === 0 ? [] : current;
    if (selected.length !== received || (requested.length > 0 && requested.length !== received)) {
      throw new AppError('سيريالات الاستلام لا تطابق البضاعة بالطريق', 'TRANSFER_RECEIPT_SERIAL_MISMATCH', 409);
    }
    const receivedIds = selected.map(s => Number(s.id));
    const lostIds = current.filter(s => !receivedIds.includes(Number(s.id))).map(s => Number(s.id));
    if (receivedIds.length) await trx.updateTable('product_serials')
      .set({ location_id: toLocationId, branch_id: toBranchId, updated_at: sql`NOW()` })
      .where('tenant_id', '=', scope.tenantId).where('id', 'in', receivedIds).execute();
    if (lostIds.length) await trx.updateTable('product_serials')
      .set({ status: 'scrapped', location_id: null, branch_id: null,
        notes: `فاقد أثناء النقل ${transferId}`, updated_at: sql`NOW()` })
      .where('tenant_id', '=', scope.tenantId).where('id', 'in', lostIds).execute();
  } else if (receipt.receivedSerials?.length) {
    throw new AppError('التحويل لا يتضمن سيريالات', 'TRANSFER_RECEIPT_UNEXPECTED_SERIALS', 400);
  }

  if (batches.length) {
    let selections = receipt.batchReceipts || [];
    if (!selections.length && received === roundQty(batches.reduce((sum, row) => sum + row.qty, 0))) {
      selections = batches.map(row => ({ transitBatchId: Number(row.transitBatchId), receivedQty: row.qty }));
    } else if (!selections.length && received === 0) {
      // Complete loss is unambiguous even when several distinct lots were sent.
      // Write off every transit lot with the corresponding financial shrinkage leg.
      selections = batches.map(row => ({ transitBatchId: Number(row.transitBatchId), receivedQty: 0 }));
    } else if (!selections.length && batches.length === 1) {
      selections = [{ transitBatchId: Number(batches[0].transitBatchId), receivedQty: received }];
    }
    if (!selections.length || new Set(selections.map(s => s.transitBatchId)).size !== selections.length ||
      selections.length !== batches.length ||
      Math.abs(roundQty(selections.reduce((sum, a) => sum + preciseQty(a.receivedQty), 0)) - received) > 1e-7) {
      throw new AppError('حدد المستلم من كل تشغيلة ومقدار الفاقد', 'TRANSFER_RECEIPT_BATCHES_REQUIRED', 422);
    }
    for (const line of batches) {
      const selected = selections.find(s => Number(s.transitBatchId) === Number(line.transitBatchId));
      const receivedQty = selected == null ? -1 : preciseQty(selected.receivedQty);
      if (!selected || !line.transitBatchId || receivedQty < 0 || receivedQty > line.qty + 1e-7) {
        throw new AppError('استلام التشغيلة لا يطابق الكمية المرسلة', 'TRANSFER_BATCH_RECEIPT_INVALID', 400);
      }
      const transit = await trx.selectFrom('pharmacy_batches').selectAll()
        .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(line.transitBatchId))
        .where('location_id', '=', transitLocationId).forUpdate().executeTakeFirst();
      if (!transit || Number(transit.product_id) !== Number(traceRow.product_id) ||
        Math.abs(Number(transit.quantity) - line.qty) > 1e-7) {
        throw new AppError('التشغيلة بالطريق غير مطابقة للسجل', 'TRANSFER_BATCH_TRANSIT_MISMATCH', 409);
      }
      await trx.updateTable('pharmacy_batches').set({ quantity: 0, status: 'transferred', updated_at: sql`NOW()` })
        .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(transit.id)).execute();
      if (receivedQty > 0) {
        const dest = await trx.selectFrom('pharmacy_batches').selectAll()
          .where('tenant_id', '=', scope.tenantId).where('product_id', '=', Number(traceRow.product_id))
          .where('location_id', '=', toLocationId).where('batch_number', '=', transit.batch_number)
          .orderBy('id', 'asc').forUpdate().executeTakeFirst();
        if (dest) {
          if (String(dest.expiry_date).slice(0, 10) !== String(transit.expiry_date).slice(0, 10)) {
            throw new AppError('اختلاف تاريخ صلاحية تشغيلة الوجهة', 'TRANSFER_BATCH_EXPIRY_MISMATCH', 409);
          }
          await trx.updateTable('pharmacy_batches')
            .set({ quantity: roundQty(Number(dest.quantity) + receivedQty), status: 'active', updated_at: sql`NOW()` })
            .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(dest.id)).execute();
        } else {
          await trx.insertInto('pharmacy_batches').values({
            tenant_id: scope.tenantId, account_id: scope.accountId, product_id: Number(traceRow.product_id),
            drug_id: transit.drug_id, batch_number: transit.batch_number,
            expiry_date: transit.expiry_date, quantity: receivedQty,
            unit_cost: transit.unit_cost, location_id: toLocationId,
            supplier_name: transit.supplier_name, status: 'active',
            notes: `استلام من تحويل ${transferId} / تشغيلة ${line.sourceBatchId}`,
          } as any).execute();
        }
      }
      line.receivedQty = receivedQty;
    }
  } else if (receipt.batchReceipts?.length) {
    throw new AppError('التحويل لا يتضمن تشغيلات', 'TRANSFER_RECEIPT_UNEXPECTED_BATCHES', 400);
  }
  return batches;
}

export async function cancelTrackedStock(
  trx: Kysely<Database>, scope: Scope,
  item: { product_id: number; serial_tracking?: unknown; batch_tracking?: unknown },
  fromLocationId: number, fromBranchId: number | null, transitLocationId: number, transferId: number,
): Promise<void> {
  const serials = parseTrace<TransferSerialTrace>(item.serial_tracking ?? []);
  const batches = parseTrace<TransferBatchTrace>(item.batch_tracking ?? []);
  if (serials.length) {
    const ids = serials.map(s => Number(s.id));
    const active = await trx.selectFrom('product_serials').select(['id']).where('tenant_id', '=', scope.tenantId)
      .where('product_id', '=', Number(item.product_id)).where('id', 'in', ids)
      .where('location_id', '=', transitLocationId).where('status', '=', 'in_stock')
      .where('branch_id', 'is', null).orderBy('id', 'asc').forUpdate().execute();
    if (active.length !== ids.length) throw new AppError('سيريالات التحويل غير مطابقة للطريق', 'TRANSFER_SERIAL_CANCEL_MISMATCH', 409);
    await trx.updateTable('product_serials')
      .set({ location_id: fromLocationId, branch_id: fromBranchId, updated_at: sql`NOW()` })
      .where('tenant_id', '=', scope.tenantId).where('id', 'in', ids).execute();
  }
  for (const line of batches) {
    if (!line.transitBatchId) throw new AppError('تفاصيل التشغيلات بالطريق غير مكتملة', 'TRANSFER_BATCH_CANCEL_MISMATCH', 409);
    const transit = await trx.selectFrom('pharmacy_batches').select(['id', 'quantity', 'product_id'])
      .where('id', '=', line.transitBatchId).where('tenant_id', '=', scope.tenantId)
      .where('location_id', '=', transitLocationId).forUpdate().executeTakeFirst();
    if (!transit || Number(transit.product_id) !== Number(item.product_id) ||
      Math.abs(Number(transit.quantity) - line.qty) > 1e-7) {
      throw new AppError('تشغيلة الطريق تغيرت؛ لا يمكن إلغاء التحويل قبل التسوية', 'TRANSFER_BATCH_CANCEL_MISMATCH', 409);
    }
    const source = await trx.selectFrom('pharmacy_batches').select(['id', 'quantity'])
      .where('id', '=', line.sourceBatchId).where('tenant_id', '=', scope.tenantId)
      .where('location_id', '=', fromLocationId).forUpdate().executeTakeFirst();
    if (!source) throw new AppError('تشغيلة المصدر لم تعد موجودة', 'TRANSFER_BATCH_SOURCE_MISSING', 409);
    await trx.updateTable('pharmacy_batches').set({ quantity: 0, status: 'transferred', updated_at: sql`NOW()` })
      .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(transit.id)).execute();
    await trx.updateTable('pharmacy_batches').set({
      quantity: roundQty(Number(source.quantity) + line.qty), updated_at: sql`NOW()`
    }).where('tenant_id', '=', scope.tenantId).where('id', '=', Number(source.id)).execute();
  }
  void transferId;
}
