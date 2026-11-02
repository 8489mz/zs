import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

/**
 * INV-CATALOG-STOCK-TOTALS-BOOK-DIGITS: the single computation for a
 * stock movement's money total (qty x unit cost) at the tenant's book
 * digits. Every catalog site that stores a stock_movements.total_cost
 * row — opening stock, opening-balance inserts, zero-deduct, fashion
 * matrix adjustment, archive zeroing — and the opening-stock journal
 * that posts from the same movement must use this helper with the
 * same inputs, so the stored total and the posted journal leg can
 * never diverge by rounding. The journal boundary re-rounds lines
 * at book digits and postInventoryAdjustment reads the stored total
 * verbatim (re-rounded at book digits), so a two-decimal pre-round
 * here used to bake a 0.005 error into both the row and the journal
 * for three-decimal tenants (e.g. 3 x 33.375 = 100.125 stored and
 * posted as 100.13). Sub-minor products round leniently at book
 * digits (derived values, like every other P0 package); non-finite
 * inputs and invalid digits fail closed.
 */
export function stockMovementTotal(qty: number, unitCost: number, digits: MoneyDigits): number {
  if (digits !== 2 && digits !== 3) throw new Error('Invalid book digits for stock movement total');
  if (!Number.isFinite(qty) || !Number.isFinite(unitCost)) {
    throw new Error('Non-finite stock movement total inputs');
  }
  return roundMoney(qty * unitCost, digits);
}
