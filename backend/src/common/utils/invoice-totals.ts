export function computeInvoiceTotals(
  subtotal: number,
  discount: number,
  taxRate: number,
  pricesIncludeTax: boolean,
  deliveryFee: number = 0,
  serviceCharge: number = 0,
  tipAmount: number = 0,
): { taxAmount: number; total: number } {
  const safeSubtotal = Number(subtotal.toFixed(3));
  const safeDiscount = Number(Math.max(0, discount).toFixed(3));
  const safeDeliveryFee = Number(Math.max(0, deliveryFee).toFixed(3));
  const safeServiceCharge = Number(Math.max(0, serviceCharge).toFixed(3));
  const safeTipAmount = Number(Math.max(0, tipAmount).toFixed(3));
  const netFood = Math.max(0, safeSubtotal - safeDiscount);
  const taxableBase = Number((netFood + safeServiceCharge).toFixed(3));
  const rate = Math.max(0, Number(taxRate || 0));

  if (pricesIncludeTax) {
    const total = Number((taxableBase + safeDeliveryFee + safeTipAmount).toFixed(3));
    const taxAmount = Number((taxableBase - taxableBase / (1 + rate / 100)).toFixed(3));
    return { taxAmount, total };
  }

  const taxAmount = Number((taxableBase * (rate / 100)).toFixed(3));
  return { taxAmount, total: Number((taxableBase + taxAmount + safeDeliveryFee + safeTipAmount).toFixed(3)) };
}
