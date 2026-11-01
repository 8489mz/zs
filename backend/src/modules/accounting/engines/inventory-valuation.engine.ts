/**
 * Weighted-average receipt cost. Inputs and result are per base stock unit, never per carton
 * or selected sales unit.
 *
 * Negative-stock policy (INV-NEGATIVE-STOCK-WAC): beforeQty may be negative. Overselling is a
 * supported setting (allowNegativeStockSales), so a receipt that follows overselling — a sale
 * return, a manufacturing completion, a trade-in, a maintenance return, a purchase receipt — is
 * legitimate, not an error. The previous strict throw blocked exactly those receipts. Sales and
 * consumptions expense at the then-current cost_price, so the algebraic blend
 * (beforeQty * beforeCost + receivedValue) / (beforeQty + receivedQty) preserves the book value
 * exactly through negative pools, for as long as the result stays non-negative.
 *
 * Two degenerate cases cannot be represented in a single-scalar WAC, so the function falls back
 * instead of ever storing a negative unit cost (which would corrupt every downstream COGS
 * computation):
 * - the receipt exactly empties the pool (|beforeQty + receivedQty| below 0.00001, the same
 *   dust threshold the purchase paths used; quantities live at 3dp, so anything below it is
 *   float noise): keep beforeCost. The stored cost is irrelevant to future blends
 *   (0 * cost == 0) and stays the last booked cost for any immediate short-sale. The residual
 *   between booked shortfall value and replacement value is not routed to a variance account
 *   here — same loss profile as the previous clamp / fallback behavior, strictly fewer cases;
 *   see the invariant for the follow-up.
 * - the algebraic result would be negative (replacement value cannot cover the booked shortfall
 *   value on a recovered pool, or exceeds it while still short — a price collapse or spike
 *   during a deep shortfall): fall back to the incoming unit cost on a recovered pool, and to
 *   beforeCost while still short.
 */
/**
 * One WAC quantity source (INV-WAC-QUANTITY-SOURCE): recover the true prior
 * quantity from applyStockDelta's corrected globalAfter, exactly as
 * valueStockReceipt already does. The ledger reconciles globalAfter from
 * the sum of location balances, while globalBefore is the cached
 * products.stock_qty, which can lag that sum (stale counter, transit legs,
 * unassigned provisioning). A WAC blend fed the cached counter therefore
 * weighted the old pool by the wrong quantity whenever the two diverged,
 * while valueStockReceipt blended by the corrected quantity — two
 * different WACs for the same receipt. globalAfter already includes this
 * receipt, so the prior quantity is globalAfter minus the received
 * quantity, rounded to the ledger's 3dp quantity precision. Callers must
 * not use this recovery when they passed skipGlobalUpdate to
 * applyStockDelta (then globalAfter is just the cached counter again);
 * none of the purchase/goods-receipt call sites below skip the update.
 */
export function recoverWacBeforeQty(globalAfter: number, receivedQty: number): number {
  if (!Number.isFinite(globalAfter) || !Number.isFinite(receivedQty) || receivedQty <= 0) {
    throw new Error('Invalid WAC quantity recovery inputs');
  }
  return Number((globalAfter - receivedQty).toFixed(3));
}

/**
 * Pool revaluation (INV-STOCK-POOL-REVALUATION): spread an additional
 * value over the stock already on hand, without any incoming quantity.
 * This is NOT a receipt blend: there is nothing to recover a prior
 * quantity from and no negative-pool tolerance to apply. A late
 * landed cost or a late shipment expense lands on the pool that
 * exists, so the pool must exist (beforeQty > 0) and the additional
 * value must be a genuine addition (additionalValue >= 0); anything
 * else fails closed instead of writing a revaluation the books
 * cannot explain. The result is the same identity both bump sites
 * used inline: (beforeQty * beforeCost + additionalValue) / beforeQty,
 * rounded once, to the same 6dp the receipt blend uses.
 */
export function revalueStockPool(beforeQty: number, beforeCost: number, additionalValue: number): number {
  if (
    ![beforeQty, beforeCost, additionalValue].every(Number.isFinite) ||
    beforeQty <= 0 ||
    beforeCost < 0 ||
    additionalValue < 0
  ) {
    throw new Error('Invalid stock pool revaluation inputs');
  }
  const result = Number(((beforeQty * beforeCost + additionalValue) / beforeQty).toFixed(6));
  if (result < 0) {
    throw new Error('Invalid stock pool revaluation inputs');
  }
  return result;
}

export function weightedReceiptCost(beforeQty: number, beforeCost: number, receivedQty: number, receivedValue: number): number {
  if (![beforeQty, beforeCost, receivedQty, receivedValue].every(Number.isFinite) || beforeCost < 0 || receivedQty <= 0 || receivedValue < 0) {
    throw new Error('Invalid inventory valuation inputs');
  }
  const afterQty = beforeQty + receivedQty;
  if (Math.abs(afterQty) < 0.00001) {
    return Number(beforeCost.toFixed(6));
  }
  const algebraic = Number(((beforeQty * beforeCost + receivedValue) / afterQty).toFixed(6));
  if (algebraic >= 0) {
    return algebraic;
  }
  return afterQty > 0 ? Number((receivedValue / receivedQty).toFixed(6)) : Number(beforeCost.toFixed(6));
}

/**
 * Weighted-average return cost: the mirror of weightedReceiptCost for a
 * stock REMOVAL at a known value (INV-PURCHASE-RETURN-WAC-RECOMPUTE).
 * A purchase return leaves the pool at the ORIGINAL purchase cost, not
 * the current WAC (INV-PURCHASE-RETURN-ORIGINAL-COST), so the remaining
 * pool must be re-blended: (beforeQty * beforeCost - returnedValue) /
 * (beforeQty - returnedQty), rounded once to the same 6dp the receipt
 * blend uses. Without this the GL inventory leg (original cost) and the
 * physical pool (qty * cost_price) diverge by the whole WAC drift and
 * reconciliation fails. This is the same blend identity as the receipt
 * side, not a second formula: it lives in this canonical engine file
 * and shares the rounding and degenerate policy.
 *
 * Same degenerate policy as the receipt blend, because a single-scalar
 * WAC cannot represent these states either:
 * - the return exactly empties the pool (|afterQty| below 0.00001):
 *   keep beforeCost. The stored cost is irrelevant to future blends
 *   (0 * cost == 0) and stays the last booked cost.
 * - the algebraic result would be negative (the returned value exceeds
 *   the pool value — the original cost was above the drifted WAC):
 *   keep beforeCost. Never store a negative unit cost, and never
 *   reprice the remaining pool UP to the returned cost: the return
 *   must not mint unit cost the pool never held.
 */
export function weightedReturnCost(beforeQty: number, beforeCost: number, returnedQty: number, returnedValue: number): number {
  if (![beforeQty, beforeCost, returnedQty, returnedValue].every(Number.isFinite) || beforeCost < 0 || returnedQty <= 0 || returnedValue < 0) {
    throw new Error('Invalid inventory return valuation inputs');
  }
  const afterQty = beforeQty - returnedQty;
  if (Math.abs(afterQty) < 0.00001) {
    return Number(beforeCost.toFixed(6));
  }
  const algebraic = Number(((beforeQty * beforeCost - returnedValue) / afterQty).toFixed(6));
  if (algebraic >= 0) {
    return algebraic;
  }
  return Number(beforeCost.toFixed(6));
}
