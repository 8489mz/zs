import { AppError } from '../../../common/errors/app-error';

/** Saved unit_cost is after discount, per purchase unit, and may include VAT. */
export function purchaseReceiptBaseUnitCost(
  unitCost: number,
  unitMultiplier: number,
  taxRate: number,
  pricesIncludeTax: boolean,
): number {
  if (
    !Number.isFinite(unitCost) ||
    unitCost < 0 ||
    !Number.isFinite(unitMultiplier) ||
    unitMultiplier <= 0 ||
    !Number.isFinite(taxRate) ||
    taxRate < 0
  ) {
    throw new AppError('Invalid purchase receipt cost, multiplier or tax rate', 'PURCHASE_RECEIPT_COST_INVALID', 400);
  }
  return unitCost / unitMultiplier / (pricesIncludeTax ? 1 + taxRate / 100 : 1);
}
