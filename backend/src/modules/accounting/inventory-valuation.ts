import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { recoverWacBeforeQty, revalueStockPool, weightedReceiptCost, weightedReturnCost } from './engines/inventory-valuation.engine';

/** Called after applyStockDelta, while its product row lock is still held. */
export async function valueStockReceipt(db: Kysely<Database>, tenantId: string, productId: number, afterQty: number, qty: number, value: number): Promise<void> {
  const product = await db.selectFrom('products').select('cost_price').where('tenant_id', '=', tenantId).where('id', '=', productId).executeTakeFirstOrThrow();
  // applyStockDelta can reconcile a stale cached total. Its corrected globalAfter
  // is authoritative; subtract this receipt to recover the true prior quantity.
  const beforeQty = recoverWacBeforeQty(afterQty, qty);
  const cost = weightedReceiptCost(beforeQty, Number(product.cost_price), qty, value);
  await db.updateTable('products').set({ cost_price: cost }).where('tenant_id', '=', tenantId).where('id', '=', productId).execute();
}

/**
 * Re-blend the WAC after a purchase return removes stock at the ORIGINAL
 * purchase cost (INV-PURCHASE-RETURN-WAC-RECOMPUTE). Called after
 * applyStockDelta, while its product row lock is still held — the same
 * placement as valueStockReceipt for receipts. globalAfter is
 * applyStockDelta's corrected global quantity, which already includes
 * this return's deduction, so the prior quantity is recovered exactly
 * as valueStockReceipt does (INV-WAC-QUANTITY-SOURCE): beforeQty is
 * globalAfter + returnedQty, rounded to the ledger's 3dp quantity
 * precision. returnedValue is the line's GL inventory credit at book
 * digits (sold qty x original per-sold-unit cost), so cost_price x
 * afterQty reconciles with the 1140 leg exactly. Deliberately NOT
 * called from postPurchaseReturn: recovery re-posts journals for
 * already-created documents and must never reprice stock a second time.
 */
export async function revalueStockReturn(db: Kysely<Database>, tenantId: string, productId: number, globalAfter: number, returnedQty: number, returnedValue: number): Promise<void> {
  const product = await db.selectFrom('products').select('cost_price').where('tenant_id', '=', tenantId).where('id', '=', productId).executeTakeFirstOrThrow();
  const beforeQty = Number((globalAfter + returnedQty).toFixed(3));
  const cost = weightedReturnCost(beforeQty, Number(product.cost_price), returnedQty, returnedValue);
  await db.updateTable('products').set({ cost_price: cost }).where('tenant_id', '=', tenantId).where('id', '=', productId).execute();
}

/**
 * Revalue the stock already on hand by spreading an additional value
 * over it (INV-STOCK-POOL-REVALUATION). Called while the product row
 * lock is still held. Unlike valueStockReceipt this writer stamps
 * updated_at: both revaluation callers stamped it before, and the
 * revaluation is a deliberate repricing event, not a receipt.
 * beforeQty is caller-supplied — each caller keeps its own quantity
 * policy (cached counter for landed costs, company-wide on-hand for
 * late shipment expenses) — and must be positive.
 */
export async function revalueStockCost(db: Kysely<Database>, tenantId: string, productId: number, beforeQty: number, additionalValue: number): Promise<void> {
  const product = await db.selectFrom('products').select('cost_price').where('tenant_id', '=', tenantId).where('id', '=', productId).executeTakeFirstOrThrow();
  const cost = revalueStockPool(beforeQty, Number(product.cost_price), additionalValue);
  await db.updateTable('products').set({ cost_price: cost, updated_at: new Date() }).where('tenant_id', '=', tenantId).where('id', '=', productId).execute();
}
