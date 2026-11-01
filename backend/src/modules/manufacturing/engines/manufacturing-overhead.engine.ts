import { roundMoney, MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

/**
 * Scaled BOM overhead: the single computation of the BOM overhead
 * expanded by produced quantity over BOM quantity, rounded once at
 * tenant book digits.
 *
 * INV-MANUFACTURING-OVERHEAD-UNIFICATION: this is the ONLY place the
 * formula lives. Work-order completion, the work-order poster, and
 * the restaurant auto-produce path all call it; no inline copy of
 * the formula remains at any call site.
 *
 * The bomQuantity `|| 1` fallback lives here, preserving the
 * completion/poster behavior for a missing BOM quantity. Callers
 * keep their own quantity coercions: the poster passes
 * quantity_to_produce || 0, completion passes the work order's
 * quantity_to_produce as read, and the auto-produce path passes its
 * shortfall after its fail-closed BOM-quantity guard (so the
 * fallback can never fire there). Digits are REQUIRED: the
 * function never silently defaults to two decimals. The sign of
 * the overhead is preserved (no clamping); negative-component
 * guards stay at the callers that own them.
 */
export function scaledBomOverhead(
  overheadCost: number,
  qtyToProduce: number,
  bomQuantity: number,
  digits: MoneyDigits,
): number {
  const bomQty = Number(bomQuantity || 1);
  return roundMoney(Number(overheadCost || 0) * (qtyToProduce / bomQty), digits);
}
