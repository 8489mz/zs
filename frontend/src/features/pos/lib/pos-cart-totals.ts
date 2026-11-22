/* R5-A (INV-REST-TOTALS-TRUTH-2) + INV-POS-LINE-DISCOUNT: the ONE pure
 * POS cart totals computation. It used to live inline in
 * usePosWorkspaceDerived, untestable without rendering the hook; the
 * hook now calls this helper and the spec pins the money math here.
 *
 * ORDER OF OPERATIONS (the backend's, sales-write.service.ts):
 * gross cart total -> minus the per-line discounts -> net subtotal ->
 * minus the header discount (manual + loyalty) -> service charge ->
 * tax -> total. The returned subTotal stays the GROSS cart total (the
 * figure the cashier reads as "المجموع الفرعي" and the checkout
 * percent input divides by); the line discounts appear as their own
 * lineDiscountTotal row, so the visible rows still sum to the total.
 * The loyalty cap and the discount-threshold base use the NET
 * subtotal — the backend caps loyalty at subtotal x maxPct where its
 * subtotal is already net of line discounts, and the discount gate
 * divides by the same net subtotal. With no line discounts the net
 * and gross subtotals are identical, so every existing total is
 * unchanged. */

import { currencyMoneyDigits, roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { calcCartLineDiscount, calcCartLineTotal, clampDiscountPercent } from '@/features/pos/lib/pos-modifier-totals';
import type { PosItem } from '@/features/pos/types/pos.types';

export interface PosCartTotalsSettings {
  loyaltyPointRedeemValue?: number | string;
  loyaltyMaxDiscountPercentage?: number | string;
  restaurantServiceChargeEnabled?: boolean;
  restaurantServiceChargePercent?: number | string;
  taxRate?: number | string;
  taxMode?: string;
}

export interface PosCartTotalsInput {
  cart: PosItem[];
  discount: number;
  loyaltyPointsRedeemed?: number;
  deliveryFee: number;
  tipAmount?: number;
  settings?: PosCartTotalsSettings | null;
  orderType: string;
  /** Book digits; defaults to the global system currency's digits. */
  bookDigits?: MoneyDigits;
}

export interface PosCartTotals {
  /** Gross cart total (qty x (price + modifiers)), before any discount. */
  subTotal: number;
  /** Sum of the per-line discounts, at book digits. */
  lineDiscountTotal: number;
  /** Gross minus line discounts — the backend's stored subtotal. */
  netSubTotal: number;
  discountValue: number;
  manualDiscount: number;
  loyaltyDiscount: number;
  serviceCharge: number;
  serviceChargePercent: number;
  deliveryFee: number;
  tipAmount: number;
  taxRate: number;
  pricesIncludeTax: boolean;
  taxAmount: number;
  total: number;
}

export function computePosCartTotals(input: PosCartTotalsInput): PosCartTotals {  const digits = input.bookDigits ?? currencyMoneyDigits(getGlobalSystemCurrency());
  const grossSubTotal = input.cart.reduce((sum, item) => sum + calcCartLineTotal(item), 0);
  const lineDiscountTotal = roundMoneyValue(
    input.cart.reduce((sum, item) => sum + calcCartLineDiscount(item), 0),
    digits,
  );
  const netSubTotal = Math.max(0, roundMoneyValue(grossSubTotal - lineDiscountTotal, digits));
  const manualDiscount = Math.max(0, Number(input.discount || 0));
  const pointRedeemValue = Number(input.settings?.loyaltyPointRedeemValue ?? 0.1);
  /* R5-A (INV-REST-TOTALS-TRUTH-2, R-I53/R-I10): the loyalty discount
   * used to be uncapped here while the backend caps it at
   * subtotal * maxDiscountPercentage/100 (default 100) and the
   * redeem-all button capped at 50 by default — three different
   * totals for one sale. The backend default (100) is the authority:
   * it is the only one that already posts. The cap divides the NET
   * subtotal, matching the backend exactly. */
  const maxDiscountPercentage = Number(input.settings?.loyaltyMaxDiscountPercentage ?? 100);
  const loyaltyDiscountCap = roundMoneyValue((netSubTotal * maxDiscountPercentage) / 100, digits);
  const loyaltyDiscount = Math.min(
    Math.max(0, roundMoneyValue(Number(input.loyaltyPointsRedeemed || 0) * pointRedeemValue, digits)),
    loyaltyDiscountCap,
  );
  const discountValue = manualDiscount + loyaltyDiscount;
  const deliveryFee = Math.max(0, Number(input.deliveryFee || 0));
  const tipAmount = Math.max(0, Number(input.tipAmount || 0));

  // Restaurant Dine-in Service Charge
  const isServiceChargeActive = Boolean(
    input.settings?.restaurantServiceChargeEnabled && input.orderType === 'dine_in',
  );
  const serviceChargePercent = isServiceChargeActive
    ? Math.max(0, Number(input.settings?.restaurantServiceChargePercent ?? 0))
    : 0;
  const discounted = Math.max(0, netSubTotal - discountValue);
  const serviceCharge = serviceChargePercent > 0
    ? roundMoneyValue((discounted * serviceChargePercent) / 100, digits)
    : 0;

  const baseBeforeTax = roundMoneyValue(discounted + serviceCharge, digits);
  const taxRate = Number(input.settings?.taxRate || 0);
  const pricesIncludeTax = String(input.settings?.taxMode || 'exclusive') === 'inclusive';
  let taxAmount = 0;
  let total = 0;
  if (taxRate > 0) {
    if (pricesIncludeTax) {
      total = roundMoneyValue(baseBeforeTax + deliveryFee + tipAmount, digits);
      taxAmount = roundMoneyValue(baseBeforeTax - (baseBeforeTax / (1 + taxRate / 100)), digits);
    } else {
      taxAmount = roundMoneyValue(baseBeforeTax * (taxRate / 100), digits);
      total = roundMoneyValue(baseBeforeTax + taxAmount + deliveryFee + tipAmount, digits);
    }
  } else {
    total = roundMoneyValue(baseBeforeTax + deliveryFee + tipAmount, digits);
  }
  return {
    subTotal: roundMoneyValue(grossSubTotal, digits),
    lineDiscountTotal,
    netSubTotal,
    discountValue: roundMoneyValue(discountValue, digits),
    manualDiscount: roundMoneyValue(manualDiscount, digits),
    loyaltyDiscount: roundMoneyValue(loyaltyDiscount, digits),
    serviceCharge,
    serviceChargePercent,
    deliveryFee: roundMoneyValue(deliveryFee, digits),
    tipAmount,
    taxRate,
    pricesIncludeTax,
    taxAmount,
    total,
  };
}

/* F1b (van trial problem 20): the invoice "%" input is a percent of
 * the NET subtotal (gross minus line discounts), never of the gross.
 * Trial pin: gross 100.00 with a 4.00 line discount nets to 96.00, so
 * 4% is 3.84 — the old gross base gave 4.00. The backend takes a flat
 * amount (allocateInvoiceDiscount distributes an amount); this helper
 * produces that amount, rounded at book digits. */
export function calcInvoiceDiscountAmountFromPercent(percent: unknown, netSubTotal: number, digits: MoneyDigits): number {
  const base = Math.max(0, Number(netSubTotal || 0));
  return roundMoneyValue((clampDiscountPercent(percent) / 100) * base, digits);
}

/** The stored invoice discount expressed as a percent of the net
 * subtotal (0 when there is no discount or no net base) — the value
 * the "%" input displays. Unrounded; callers format it. */
export function calcInvoiceDiscountPercent(discount: number, netSubTotal: number): number {
  const base = Number(netSubTotal || 0);
  const amount = Number(discount || 0);
  if (base <= 0 || amount <= 0) return 0;
  return (amount / base) * 100;
}
