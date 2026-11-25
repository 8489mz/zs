import { MoneyDigits, toMinorUnits, fromMinorUnits } from '../../accounting/engines/money-minor-units.engine';

/** A bonus box increases stock but never creates an imaginary supplier liability. */
export function buildDistributorPurchaseItem(
  line: {
    productName: string;
    quantity: number;
    bonusQuantity?: number;
    costPrice: number;
    batchNumber?: string;
    expiryDate?: string;
  },
  productId: number,
  locationId: number,
  digits: MoneyDigits,
  isDrug = false,
) {
  if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(locationId) || locationId <= 0) {
    throw new Error('Distributor invoice requires tenant-owned product and location');
  }
  const hasBatchOrExpiry = Boolean(line.batchNumber?.trim() || line.expiryDate?.trim());
  if (isDrug || hasBatchOrExpiry) {
    if (!line.batchNumber?.trim() || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(line.expiryDate || '')) {
      throw new Error('Distributor invoice requires batch number and valid expiry');
    }
  }
  const purchased = Number(line.quantity);
  const bonus = Number(line.bonusQuantity || 0);
  if (!Number.isFinite(purchased) || purchased <= 0 || !Number.isFinite(bonus) || bonus < 0) {
    throw new Error('Distributor invoice quantity is invalid');
  }
  const quantity = purchased + bonus;
  // The supplier gets paid only for purchased items; free units dilute WAC.
  const purchasedValue = toMinorUnits(Number(line.costPrice) * purchased, digits);
  const unitCost = Number((fromMinorUnits(purchasedValue, digits) / quantity).toFixed(6));
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('Distributor purchase unit cost invalid');
  return {
    productId,
    name: line.productName.trim(),
    qty: quantity,
    cost: unitCost,
    unitMultiplier: 1,
    locationId,
    batchNumber: line.batchNumber?.trim() || undefined,
    expiryDate: line.expiryDate || undefined,
  };
}
