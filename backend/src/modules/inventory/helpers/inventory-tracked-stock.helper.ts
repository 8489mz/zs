import { Kysely } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';

/**
 * Quantity-only stock mutations must not silently diverge from the serial
 * register or pharmacy batch register. Both need identifiable units/batches
 * and a separate, explicitly reconciled workflow before changing balances.
 * Call this after locking the product row, inside the stock transaction.
 */
export async function assertUntrackedStockMutation(
  trx: Kysely<Database>,
  scope: { tenantId: string },
  productId: number,
): Promise<void> {
  const product = await trx
    .selectFrom('products')
    .select('track_serials')
    .where('tenant_id', '=', scope.tenantId)
    .where('id', '=', productId)
    .executeTakeFirst();
  if (!product) throw new AppError('Product not found', 'PRODUCT_NOT_FOUND', 404);

  const serial = await trx
    .selectFrom('product_serials')
    .select('id')
    .where('tenant_id', '=', scope.tenantId)
    .where('product_id', '=', productId)
    .limit(1)
    .executeTakeFirst();
  if (product.track_serials || serial) {
    throw new AppError(
      'الصنف مرتبط بسيريالات؛ يجب تحديد الأرقام المنقولة أو المتلفة وتسويتها قبل تعديل رصيد المخزن',
      'SERIAL_TRACKED_STOCK_REQUIRES_RECONCILIATION',
      409,
    );
  }

  const batch = await trx
    .selectFrom('pharmacy_batches')
    .select('id')
    .where('tenant_id', '=', scope.tenantId)
    .where('product_id', '=', productId)
    .limit(1)
    .executeTakeFirst();
  if (batch) {
    throw new AppError(
      'الصنف مرتبط بتشغيلات وتواريخ صلاحية؛ استخدم تسوية التشغيلات قبل تعديل الكمية',
      'BATCH_TRACKED_STOCK_REQUIRES_RECONCILIATION',
      409,
    );
  }
}
