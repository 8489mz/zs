import { BadRequestException } from '@nestjs/common';
import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export type PurchaseOrderLineInput = {
  quantity: number;
  unitCost: number;
  taxRate?: number | null;
};

/**
 * Trusted value for purchasing approvals and downstream GRN/bill conversion.
 * Client-supplied subtotal, tax and grand total are NEVER approval inputs.
 *
 * Digits are the tenant's book digits and are REQUIRED: the engine never
 * silently defaults to 2, so a 3-decimal book keeps its third decimal in
 * every stored total. All rounding goes through roundMoney at book digits;
 * the minor-unit helper below is only the integer guard for validation.
 */
export function calculatePurchaseOrderTotals(
  items: PurchaseOrderLineInput[],
  discountAmount: number | null | undefined,
  digits: MoneyDigits,
): { subtotal: number; taxAmount: number; discountAmount: number; totalAmount: number; lineTotals: number[] } {
  const factor = 10 ** digits;
  const minor = (value: number) => Math.round(value * factor);
  const toMoney = (value: number) => roundMoney(value, digits);
  if (!Array.isArray(items) || !items.length) throw new BadRequestException('أمر الشراء يحتاج بنداً واحداً على الأقل.');
  const lineTotals = items.map((item) => {
    const qty = Number(item.quantity);
    const price = Number(item.unitCost);
    const tax = Number(item.taxRate || 0);
    if (!Number.isFinite(qty) || qty <= 0 ||
        !Number.isFinite(price) || price < 0 ||
        !Number.isFinite(tax) || tax < 0 || tax > 100 ||
        !Number.isSafeInteger(minor(qty * price)) ||
        !Number.isSafeInteger(minor(qty * price * tax / 100))) {
      throw new BadRequestException('كمية أو سعر أو نسبة ضريبة غير صالحة في أمر الشراء.');
    }
    return toMoney(qty * price);
  });
  const subtotal = toMoney(lineTotals.reduce((sum, amount) => sum + amount, 0));
  const discount = Number(discountAmount ?? 0);
  if (!Number.isFinite(discount) || discount < 0 || minor(discount) > minor(subtotal) ||
      Math.abs(discount * factor - minor(discount)) > 0.000001) {
    throw new BadRequestException('خصم أمر الشراء غير صالح أو يتجاوز قيمة البنود.');
  }
  const normalizedDiscount = toMoney(discount);
  const effectiveSubtotal = Math.max(0, subtotal - normalizedDiscount);
  const unDiscountedTax = items.reduce((sum, item, index) =>
    sum + lineTotals[index] * Number(item.taxRate || 0) / 100, 0);
  const taxAmount = toMoney(subtotal > 0 ? unDiscountedTax * effectiveSubtotal / subtotal : 0);
  const totalAmount = toMoney(effectiveSubtotal + taxAmount);
  return { subtotal, taxAmount, discountAmount: normalizedDiscount, totalAmount, lineTotals };
}
