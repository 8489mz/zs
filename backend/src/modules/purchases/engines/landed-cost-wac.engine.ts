import { MoneyDigits, toMinorUnits, fromMinorUnits } from '../../accounting/engines/money-minor-units.engine';

/** Track the surviving share of a receipt in a pooled weighted-average stock balance. */
const locationOnlyMovements = new Set([
  'transfer_send',
  'transfer_receive',
  'transfer_transit_in',
  'transfer_transit_out',
  'transfer_transit_cancel',
  'transfer_cancel',
  'stock_assign',
]);
const globalMovements = new Set([
  'opening_balance',
  'opening_stock',
  'purchase',
  'purchase_receipt',
  'purchase_edit_restore',
  'purchase_edit_apply',
  'purchase_cancel',
  'purchase_return',
  'goods_receipt',
  'import_receipt',
  'sale',
  'sale_edit',
  'sale_edit_reversal',
  'sale_cancel',
  'sale_return',
  'stock_count_gain',
  'stock_count_loss',
  'add',
  'deduct',
  'adjust',
  'damaged',
  'manufacturing_consumption',
  'manufacturing_production',
  'manufacturing_byproduct',
  'manufacturing_unbuild',
  'manufacturing_unbuild_recovery',
  'maintenance_consumption',
  'maintenance_return',
  'tradein_in',
  'transfer_final_issue',
  'transfer_transit_loss',
]);

export function stockMovementGlobalDelta(type: string, qty: number): number {
  if (!Number.isFinite(qty)) throw new Error('Invalid stock movement quantity');
  if (locationOnlyMovements.has(type)) return 0;
  if (!globalMovements.has(type)) throw new Error(`Unclassified stock movement: ${type}`);
  return qty;
}

export function allocateReceiptCostByStockFlow(input: {
  currentStock: number;
  minorUnits?: MoneyDigits;
  movements: Array<{ id: number; globalDelta: number }>;
  receipts: Array<{ key: number; movementId: number; receivedQty: number; allocatedCost: number }>;
}): Map<number, { inventory: number; cogs: number }> {
  const ordered = [...input.movements].sort((a, b) => a.id - b.id);
  if (
    !Number.isFinite(input.currentStock) ||
    input.currentStock < -0.0001 ||
    input.receipts.some(
      (r) =>
        !Number.isFinite(r.receivedQty) ||
        r.receivedQty <= 0 ||
        !Number.isFinite(r.allocatedCost) ||
        r.allocatedCost < 0,
    )
  ) {
    throw new Error('Invalid stock flow for landed cost');
  }
  const remaining = new Map(input.receipts.map((r) => [r.key, 0]));
  let pool = input.currentStock - ordered.reduce((sum, movement) => sum + movement.globalDelta, 0);
  if (pool < -0.0001) throw new Error('Stock flow cannot be reconciled to current balance');
  pool = Math.max(0, pool);
  const receiptsByMovement = new Map<number, typeof input.receipts>();
  for (const receipt of input.receipts) {
    const group = receiptsByMovement.get(receipt.movementId) || [];
    group.push(receipt);
    receiptsByMovement.set(receipt.movementId, group);
  }
  for (const movement of ordered) {
    if (!Number.isFinite(movement.globalDelta)) throw new Error('Invalid stock movement');
    if (movement.globalDelta < -0.0001) {
      const consumed = -movement.globalDelta;
      if (consumed > pool + 0.001) throw new Error('Stock outflow exceeds the weighted-average pool');
      const survival = pool > 0 ? Math.max(0, 1 - consumed / pool) : 0;
      for (const [key, qty] of remaining) remaining.set(key, qty * survival);
    }
    pool += movement.globalDelta;
    if (pool < -0.001) throw new Error('Weighted-average stock became negative');
    for (const receipt of receiptsByMovement.get(movement.id) || []) {
      if (movement.globalDelta <= 0 || receipt.receivedQty > movement.globalDelta + 0.001) {
        throw new Error('Receipt does not match its stock movement');
      }
      remaining.set(receipt.key, receipt.receivedQty);
    }
  }
  if ([...receiptsByMovement.keys()].some((id) => !ordered.some((movement) => movement.id === id))) {
    throw new Error('Receipt movement is missing');
  }
  const result = new Map<number, { inventory: number; cogs: number }>();
  for (const receipt of input.receipts) {
    const digits = input.minorUnits ?? 2;
    const totalMinor = toMinorUnits(receipt.allocatedCost, digits);
    const inventoryMinor = Math.min(
      totalMinor,
      Math.max(0, Math.round((totalMinor * (remaining.get(receipt.key) || 0)) / receipt.receivedQty)),
    );
    result.set(receipt.key, {
      inventory: fromMinorUnits(inventoryMinor, digits),
      cogs: fromMinorUnits(totalMinor - inventoryMinor, digits),
    });
  }
  return result;
}
