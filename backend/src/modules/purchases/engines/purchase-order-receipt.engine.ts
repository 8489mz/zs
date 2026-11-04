import { AppError } from '../../../common/errors/app-error';

/**
 * Purchase-order receipt advance (INV-PO-RECEIVED-QUANTITY-ADVANCE).
 *
 * The single computation that reflects a physical receipt on its purchase
 * order. Both receipt paths — the GRN posting in GoodsReceiptService and
 * the legacy receipt in PurchasesWriteService.receivePurchaseGoods — call
 * this helper inside the SAME transaction as the stock write, on the same
 * handle, so a failed receipt advances nothing and a posted receipt cannot
 * be re-posted without the GRN/bill guards firing first.
 *
 * Quantity basis: PO-item quantity units. The legacy path receives in
 * purchase-item units (its received_qty cap compares against item.qty) and
 * the GRN path receives in ordered units (acceptedQty against the PO item);
 * neither advances by base stock units (qty x unit_multiplier), which is
 * the ledger quantity, not the ordered quantity.
 *
 * Status rule, at 3dp quantity precision with a 0.001 tolerance (the same
 * tolerance the receipt caps use): every PO item at or past its ordered
 * quantity means `received`; any received quantity short of that means
 * `partially_received`. A `converted_to_bill` order keeps its status — the
 * conversion marker must survive, since it is what blocks a second
 * conversion — while its items still advance, so the reorder incoming
 * figure stays truthful. Prospective only: historical orders keep their
 * stored received_quantity of 0; nothing backfills them.
 */
export const PO_RECEIPT_QUANTITY_TOLERANCE = 0.001;

export type PoReceiptAdvanceLine = {
  poItemId: number;
  quantity: number;
};

export type PoReceiptItemState = {
  id: number;
  quantity: number;
  receivedQuantity: number;
};

function roundReceiptQty(value: number): number {
  return Number(value.toFixed(3));
}

export function computePoReceiptStatus(
  items: PoReceiptItemState[],
  currentStatus: string,
): 'partially_received' | 'received' | null {
  if (currentStatus === 'converted_to_bill') return null;
  let anyReceived = false;
  let allComplete = items.length > 0;
  for (const item of items) {
    if (item.receivedQuantity > PO_RECEIPT_QUANTITY_TOLERANCE) anyReceived = true;
    if (item.receivedQuantity < item.quantity - PO_RECEIPT_QUANTITY_TOLERANCE) allComplete = false;
  }
  if (allComplete) return 'received';
  if (anyReceived) return 'partially_received';
  return null;
}

const RECEIVABLE_PO_STATUSES = ['confirmed', 'partially_received', 'received', 'converted_to_bill'];

// INV-SPIRIT-GRN-PENDING-REVIEW: a GRN may post against a draft
// (unapproved) purchase order as a pending-review receipt. The GRN path
// passes allowUnapproved, so the helper advances received_quantity but
// leaves the order status 'draft' — receiving must not approve the
// order by side effect. Every other caller (the legacy receipt path)
// keeps the strict rule: a draft order fails closed here.

export async function advancePurchaseOrderReceipt(
  trx: any,
  tenantId: string,
  orderId: number,
  received: PoReceiptAdvanceLine[],
  options?: { allowUnapproved?: boolean },
): Promise<'partially_received' | 'received' | null> {
  const aggregated = new Map<number, number>();
  for (const line of received) {
    const poItemId = Number(line.poItemId);
    const quantity = Number(line.quantity);
    if (!Number.isInteger(poItemId) || poItemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
      throw new AppError(
        'كمية الاستلام المرتبطة بأمر الشراء غير صالحة؛ تعذر تحديث الكمية المستلمة',
        'PO_RECEIPT_QUANTITY_INVALID',
        422,
      );
    }
    aggregated.set(poItemId, roundReceiptQty((aggregated.get(poItemId) || 0) + quantity));
  }
  if (aggregated.size === 0) return null;

  const order = await trx
    .selectFrom('purchase_orders')
    .select(['id', 'status'])
    .where('id', '=', Number(orderId))
    .where('tenant_id', '=', tenantId)
    .forUpdate()
    .executeTakeFirst();
  if (!order) {
    throw new AppError('أمر الشراء المرتبط بالاستلام غير موجود', 'PURCHASE_ORDER_NOT_FOUND', 404);
  }
  const currentStatus = String(order.status);
  const unapprovedReceipt = currentStatus === 'draft' && options?.allowUnapproved === true;
  if (!unapprovedReceipt && !RECEIVABLE_PO_STATUSES.includes(currentStatus)) {
    throw new AppError(
      'لا يجوز الاستلام على أمر شراء في حالته الحالية',
      'PO_RECEIPT_NOT_ALLOWED',
      409,
    );
  }

  const items = await trx
    .selectFrom('purchase_order_items')
    .select(['id', 'quantity', 'received_quantity'])
    .where('purchase_order_id', '=', Number(orderId))
    .where('tenant_id', '=', tenantId)
    .forUpdate()
    .execute();
  const byId = new Map<number, { quantity: number; receivedQuantity: number }>();
  for (const item of items) {
    byId.set(Number(item.id), {
      quantity: Number(item.quantity || 0),
      receivedQuantity: Number(item.received_quantity || 0),
    });
  }
  for (const poItemId of aggregated.keys()) {
    if (!byId.has(poItemId)) {
      throw new AppError(
        'بند أمر الشراء المرتبط بالاستلام لا يتبع أمر الشراء المحدد',
        'PO_RECEIPT_ITEM_MISMATCH',
        409,
      );
    }
  }

  const nextStates: PoReceiptItemState[] = [];
  for (const item of items) {
    const state = byId.get(Number(item.id))!;
    const added = aggregated.get(Number(item.id)) || 0;
    const nextReceived = roundReceiptQty(state.receivedQuantity + added);
    if (added > 0) {
      await trx
        .updateTable('purchase_order_items')
        .set({ received_quantity: nextReceived })
        .where('id', '=', Number(item.id))
        .where('tenant_id', '=', tenantId)
        .execute();
    }
    nextStates.push({ id: Number(item.id), quantity: state.quantity, receivedQuantity: nextReceived });
  }

  const nextStatus = unapprovedReceipt ? null : computePoReceiptStatus(nextStates, currentStatus);
  if (nextStatus && nextStatus !== currentStatus) {
    await trx
      .updateTable('purchase_orders')
      .set({ status: nextStatus, updated_at: new Date() })
      .where('id', '=', Number(orderId))
      .where('tenant_id', '=', tenantId)
      .execute();
  }
  return nextStatus;
}
