import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';

/** Reverse original traceable intake in the same transaction as the stock and GL reversal. */
export async function reversePurchaseTrackedStock(
  trx: Kysely<Database>,
  scope: { tenantId: string },
  line: {
    productId: number;
    purchaseId: number;
    purchaseItemId: number;
    branchId: number | null;
    locationId: number | null;
    quantity: number;
    batchNumber?: string | null;
  },
): Promise<void> {
  const { productId, tenantId } = { productId: line.productId, tenantId: scope.tenantId };
  const product = await trx
    .selectFrom('products')
    .select(['track_serials'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', productId)
    .executeTakeFirstOrThrow();
  const anySerial = await trx
    .selectFrom('product_serials')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('product_id', '=', productId)
    .limit(1)
    .executeTakeFirst();
  if (product.track_serials === true || anySerial) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new AppError('كمية إلغاء الفاتورة التسلسلية غير صالحة', 'PURCHASE_CANCEL_SERIAL_QTY', 409);
    }
    let query = trx
      .selectFrom('product_serials')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', productId)
      .where('purchase_id', '=', line.purchaseId)
      .where('purchase_item_id', '=', line.purchaseItemId)
      .where('status', '=', 'in_stock');
    query =
      line.locationId == null
        ? query.where('location_id', 'is', null)
        : query.where('location_id', '=', line.locationId);
    query = line.branchId == null ? query.where('branch_id', 'is', null) : query.where('branch_id', '=', line.branchId);
    const available = await query.orderBy('id', 'asc').forUpdate().execute();
    if (available.length !== line.quantity) {
      throw new AppError(
        'بعض سيريالات الفاتورة بيعت أو انتقلت أو تحتاج تسوية؛ استخدم مرتجعاً أو تصحيحاً مرتبطاً',
        'PURCHASE_CANCEL_SERIAL_RECONCILIATION_REQUIRED',
        409,
      );
    }
    await trx
      .updateTable('product_serials')
      .set({
        status: 'returned',
        branch_id: null,
        location_id: null,
        notes: `إلغاء فاتورة مشتريات ${line.purchaseId}`,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where(
        'id',
        'in',
        available.map((row) => Number(row.id)),
      )
      .execute();
  }

  const anyBatch = await trx
    .selectFrom('pharmacy_batches')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('product_id', '=', productId)
    .limit(1)
    .executeTakeFirst();
  const drug = await trx
    .selectFrom('pharmacy_drugs')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('product_id', '=', productId)
    .executeTakeFirst();
  if (anyBatch || drug) {
    const batchNo = String(line.batchNumber || '').trim();
    if (!batchNo) {
      throw new AppError(
        'رقم التشغيلة الأصلي غير محفوظ؛ يلزم مصالحة مستند الشراء القديم قبل الإلغاء',
        'PURCHASE_CANCEL_BATCH_PROVENANCE_REQUIRED',
        409,
      );
    }
    // A lot may contain receipts from different invoices. Available quantity alone
    // does not prove ownership: reversing an arbitrary shared lot silently
    // withdraws another purchase's inventory while cancelling this invoice.
    // Reject ambiguous historical/shared lots instead of guessing provenance.
    const anotherReceipt = await trx
      .selectFrom('purchase_items')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', productId)
      .where('batch_number', '=', batchNo)
      .where('id', '!=', line.purchaseItemId)
      .limit(1)
      .executeTakeFirst();
    if (anotherReceipt) {
      throw new AppError(
        'تشغيلة مشتركة بين فواتير شراء؛ لا يمكن عكسها دون مستند تسوية محدد المصدر',
        'PURCHASE_CANCEL_SHARED_BATCH_REQUIRES_RECONCILIATION',
        409,
      );
    }
    let query = trx
      .selectFrom('pharmacy_batches')
      .select(['id', 'quantity', 'notes'])
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', productId)
      .where('batch_number', '=', batchNo);
    query =
      line.locationId == null
        ? query.where('location_id', 'is', null)
        : query.where('location_id', '=', line.locationId);
    const lots = await query.orderBy('id', 'asc').forUpdate().execute();
    if (
      lots.length !== 1 ||
      String(lots[0].notes || '') !== `وارد فاتورة شراء PUR-${line.purchaseId}` ||
      Number(lots[0].quantity) + 1e-7 < line.quantity
    ) {
      throw new AppError(
        'تشغيلة الشراء غير موجودة بالمخزن الأصلي أو كميتها ناقصة؛ يلزم مصالحة',
        'PURCHASE_CANCEL_BATCH_RECONCILIATION_REQUIRED',
        409,
      );
    }
    const after = Number((Number(lots[0].quantity) - line.quantity).toFixed(3));
    await trx
      .updateTable('pharmacy_batches')
      .set({ quantity: after, updated_at: sql`NOW()` })
      .where('id', '=', Number(lots[0].id))
      .where('tenant_id', '=', tenantId)
      .execute();
  }
}
