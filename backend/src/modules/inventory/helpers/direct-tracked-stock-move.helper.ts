import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';

/** Immediate internal/category movement; physically reassign details before the stock counters change. */
export async function moveDirectTrackedStock(
  trx: Kysely<Database>,
  scope: { tenantId: string; accountId: string },
  productId: number,
  qty: number,
  from: { id: number; branchId: number | null },
  to: { id: number; branchId: number | null },
  transferId: number,
): Promise<{
  serialTracking: Array<{ id: number; serial: string }>;
  batchTracking: Array<{ sourceBatchId: number; transitBatchId: null; qty: number; receivedQty: number }>;
}> {
  const serialTracking: Array<{ id: number; serial: string }> = [];
  const batchTracking: Array<{ sourceBatchId: number; transitBatchId: null; qty: number; receivedQty: number }> = [];
  const product = await trx
    .selectFrom('products')
    .select('track_serials')
    .where('tenant_id', '=', scope.tenantId)
    .where('id', '=', productId)
    .executeTakeFirstOrThrow();
  const anySerial = await trx
    .selectFrom('product_serials')
    .select('id')
    .where('tenant_id', '=', scope.tenantId)
    .where('product_id', '=', productId)
    .limit(1)
    .executeTakeFirst();
  if (product.track_serials || anySerial) {
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw new AppError('أصناف السيريال تنتقل بالوحدة الصحيحة فقط', 'DIRECT_TRANSFER_SERIAL_QTY', 400);
    }
    let query = trx
      .selectFrom('product_serials')
      .select(['id', 'serial_number'])
      .where('tenant_id', '=', scope.tenantId)
      .where('product_id', '=', productId)
      .where('location_id', '=', from.id)
      .where('status', '=', 'in_stock');
    query = from.branchId == null ? query.where('branch_id', 'is', null) : query.where('branch_id', '=', from.branchId);
    const serials = await query.orderBy('id', 'asc').forUpdate().execute();
    // The quick/category flow has no per-serial request: move only when all
    // physically registered source units are included. For partial moves use
    // the dedicated tracked transfer screen to select the desired IMEIs.
    if (serials.length !== qty)
      throw new AppError(
        'النقل الجزئي لسيريالات الصنف يتطلب اختيار الأرقام من إذن التحويل التفصيلي',
        'DIRECT_TRANSFER_SERIAL_SELECTION_REQUIRED',
        422,
      );
    serialTracking.push(...serials.map((row) => ({ id: Number(row.id), serial: row.serial_number })));
    await trx
      .updateTable('product_serials')
      .set({
        location_id: to.id,
        branch_id: to.branchId,
        notes: `نقل فوري TR-${transferId}`,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', scope.tenantId)
      .where(
        'id',
        'in',
        serials.map((s) => Number(s.id)),
      )
      .execute();
  }

  const drug = await trx
    .selectFrom('pharmacy_drugs')
    .select('id')
    .where('tenant_id', '=', scope.tenantId)
    .where('product_id', '=', productId)
    .executeTakeFirst();
  const anyBatch = await trx
    .selectFrom('pharmacy_batches')
    .select('id')
    .where('tenant_id', '=', scope.tenantId)
    .where('product_id', '=', productId)
    .limit(1)
    .executeTakeFirst();
  if (drug || anyBatch) {
    const batches = await trx
      .selectFrom('pharmacy_batches')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('product_id', '=', productId)
      .where('location_id', '=', from.id)
      .where('quantity', '>', 0)
      .orderBy('id', 'asc')
      .forUpdate()
      .execute();
    const sum = batches.reduce((total, lot) => total + Number(lot.quantity || 0), 0);
    if (Math.abs(sum - qty) > 1e-7)
      throw new AppError(
        'النقل السريع للتشغيلات يتطلب نقل كامل الرصيد؛ استخدم إذن التحويل للتوزيع الجزئي',
        'DIRECT_TRANSFER_BATCH_SELECTION_REQUIRED',
        422,
      );
    for (const batch of batches) {
      const destRows = await trx
        .selectFrom('pharmacy_batches')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', productId)
        .where('location_id', '=', to.id)
        .where('batch_number', '=', batch.batch_number)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      if (destRows.length > 1)
        throw new AppError('تشغيلة وجهة مكررة تحتاج مصالحة', 'DIRECT_TRANSFER_BATCH_DUPLICATE', 409);
      if (
        destRows.length === 1 &&
        String(destRows[0].expiry_date).slice(0, 10) !== String(batch.expiry_date).slice(0, 10)
      ) {
        throw new AppError('تاريخ صلاحية التشغيلة يختلف بين المخزنين', 'DIRECT_TRANSFER_BATCH_EXPIRY', 409);
      }
      if (destRows.length) {
        await trx
          .updateTable('pharmacy_batches')
          .set({
            quantity: Number((Number(destRows[0].quantity) + Number(batch.quantity)).toFixed(3)),
            status: 'active',
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', Number(destRows[0].id))
          .execute();
      } else {
        await trx
          .insertInto('pharmacy_batches')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            product_id: productId,
            drug_id: batch.drug_id,
            batch_number: batch.batch_number,
            expiry_date: batch.expiry_date,
            quantity: batch.quantity,
            unit_cost: batch.unit_cost,
            location_id: to.id,
            supplier_name: batch.supplier_name,
            status: 'active',
            notes: `نقل مخزون فوري TR-${transferId}`,
          })
          .execute();
      }
      batchTracking.push({
        sourceBatchId: Number(batch.id),
        transitBatchId: null,
        qty: Number(batch.quantity),
        receivedQty: Number(batch.quantity),
      });
      await trx
        .updateTable('pharmacy_batches')
        .set({
          quantity: 0,
          status: 'transferred',
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(batch.id))
        .execute();
    }
  }

  // INV-VAN-GENERIC-FEFO: the same full-balance move for the generic
  // ledger. Runs only when the pharmacy ledger does not own the product
  // (no drug link, no pharmacy rows at all): one product's batches live
  // in exactly one ledger. NULL == NULL merges (both sides normalize
  // to ''). The batchTracking trace is display-only JSON on the transfer
  // row (never looked up against a table), so a generic sourceBatchId
  // is safe there.
  const anyGenericBatch = await trx
    .selectFrom('inventory_batches')
    .select('id')
    .where('tenant_id', '=', scope.tenantId)
    .where('product_id', '=', productId)
    .limit(1)
    .executeTakeFirst();
  if (!drug && !anyBatch && anyGenericBatch) {
    const batches = await trx
      .selectFrom('inventory_batches')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('product_id', '=', productId)
      .where('location_id', '=', from.id)
      .where('quantity', '>', 0)
      .orderBy('expiry_date', (ob) => ob.asc().nullsLast())
      .orderBy('id', 'asc')
      .forUpdate()
      .execute();
    const sum = batches.reduce((total, lot) => total + Number(lot.quantity || 0), 0);
    if (Math.abs(sum - qty) > 1e-7)
      throw new AppError(
        'النقل السريع للتشغيلات يتطلب نقل كامل الرصيد؛ استخدم إذن التحويل للتوزيع الجزئي',
        'DIRECT_TRANSFER_BATCH_SELECTION_REQUIRED',
        422,
      );
    for (const batch of batches) {
      const destRows = await trx
        .selectFrom('inventory_batches')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', productId)
        .where('location_id', '=', to.id)
        .where('batch_number', '=', batch.batch_number)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      if (destRows.length > 1)
        throw new AppError('تشغيلة وجهة مكررة تحتاج مصالحة', 'DIRECT_TRANSFER_BATCH_DUPLICATE', 409);
      if (
        destRows.length === 1 &&
        String(destRows[0].expiry_date ?? '').slice(0, 10) !== String(batch.expiry_date ?? '').slice(0, 10)
      ) {
        throw new AppError('تاريخ صلاحية التشغيلة يختلف بين المخزنين', 'DIRECT_TRANSFER_BATCH_EXPIRY', 409);
      }
      if (destRows.length) {
        await trx
          .updateTable('inventory_batches')
          .set({
            quantity: Number((Number(destRows[0].quantity) + Number(batch.quantity)).toFixed(3)),
            status: 'active',
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', Number(destRows[0].id))
          .execute();
      } else {
        await trx
          .insertInto('inventory_batches')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            product_id: productId,
            batch_number: batch.batch_number,
            expiry_date: batch.expiry_date ?? null,
            quantity: batch.quantity,
            unit_cost: batch.unit_cost,
            location_id: to.id,
            supplier_name: batch.supplier_name,
            status: 'active',
            notes: `نقل مخزون فوري TR-${transferId}`,
          })
          .execute();
      }
      batchTracking.push({
        sourceBatchId: Number(batch.id),
        transitBatchId: null,
        qty: Number(batch.quantity),
        receivedQty: Number(batch.quantity),
      });
      await trx
        .updateTable('inventory_batches')
        .set({
          quantity: 0,
          status: 'transferred',
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', Number(batch.id))
        .execute();
    }
  }
  return { serialTracking, batchTracking };
}
