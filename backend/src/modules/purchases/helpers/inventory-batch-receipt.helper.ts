import { Kysely, sql, type Transaction } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';

/**
 * INV-VAN-GENERIC-FEFO: the generic-ledger intake upsert shared by the
 * GRN and purchase-bill batch blocks (the pharmacy blocks keep their own
 * inline code — this helper is new code for the new ledger only).
 *
 * Expiry is OPTIONAL: validated (format `YYYY-MM(-DD)` + not-past
 * against the tenant business day) only when present; an absent expiry
 * stores NULL and is never "expired". Same batch+location merges
 * quantity but requires identical expiry (NULL == NULL merges) else
 * 422 INVENTORY_BATCH_EXPIRY_MISMATCH; an expired expiry is 422
 * INVENTORY_BATCH_EXPIRED. Drug-linked products never reach this helper
 * — both call sites route them to pharmacy_batches first.
 */
export async function upsertInventoryBatchFromReceipt(
  trx: Kysely<Database> | Transaction<Database>,
  params: {
    tenantId: string;
    accountId: string;
    productId: number;
    batchNumber: string;
    expiryDate: string; // '' = no expiry -> NULL
    qty: number;
    unitCost: number;
    locationId: number | null;
    supplierName: string | null;
    notes: string;
  },
): Promise<void> {
  const { tenantId, accountId, productId, batchNumber, expiryDate } = params;
  const today = await resolveBusinessDateKey(trx, tenantId, new Date());
  if (
    expiryDate &&
    (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(expiryDate) ||
      (expiryDate.length === 7 ? expiryDate < today.slice(0, 7) : expiryDate < today))
  ) {
    throw new AppError('تاريخ صلاحية التشغيلة غير صالح أو منتهٍ', 'INVENTORY_BATCH_EXPIRED', 422);
  }
  let existingQuery = trx
    .selectFrom('inventory_batches')
    .select(['id', 'quantity', 'expiry_date'])
    .where('tenant_id', '=', tenantId)
    .where('product_id', '=', productId)
    .where('batch_number', '=', batchNumber);
  existingQuery =
    params.locationId == null
      ? existingQuery.where('location_id', 'is', null)
      : existingQuery.where('location_id', '=', params.locationId);
  const existing = await existingQuery.forUpdate().executeTakeFirst();
  if (existing) {
    // NULL == NULL merges: both sides normalize to ''.
    if (String(existing.expiry_date ?? '').slice(0, 10) !== expiryDate) {
      throw new AppError(
        'تاريخ صلاحية التشغيلة المسجلة لا يطابق محضر الاستلام',
        'INVENTORY_BATCH_EXPIRY_MISMATCH',
        422,
      );
    }
    await trx
      .updateTable('inventory_batches')
      .set({
        quantity: Number((Number(existing.quantity) + params.qty).toFixed(3)),
        expiry_date: expiryDate || null,
        unit_cost: params.unitCost,
        status: 'active',
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', Number(existing.id))
      .execute();
  } else {
    await trx
      .insertInto('inventory_batches')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        product_id: productId,
        batch_number: batchNumber,
        expiry_date: expiryDate || null,
        quantity: params.qty,
        unit_cost: params.unitCost,
        location_id: params.locationId,
        supplier_name: params.supplierName,
        status: 'active',
        notes: params.notes,
      })
      .execute();
  }
}
