import type { StorefrontProduct } from '../types/storefront.types';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

export interface CartLinePricingResult {
  lineTotal: number;
  unitPrice: number;
  originalLineTotal: number;
  savings: number;
  isBogoApplied: boolean;
  offerBadge?: string;
}

/* INV-FE2-FRONTEND-BOOK-DIGITS (U6 FE2): every computed cart money value
 * rounds at the store's book digits through the canonical helper.
 * The old code rounded through a factor from isThreeDecimalCurrency,
 * which only knew KWD/BHD/OMR — JOD/TND/IQD/LYD stores (3dp by the
 * backend engine) were silently cut to 2dp on every cart line, and the
 * factor itself was a second rounding implementation next to the
 * backend's. getCartRoundFactor is deleted (no dead code); the
 * signatures keep their optional currencyCode param, resolved to the
 * tenant base currency when omitted. */

/** Resolve the book digits for a cart computation: the passed store currency, else the tenant base. */
function cartDigits(currencyCode?: string | null): 2 | 3 {
  return currencyMoneyDigits(currencyCode || getGlobalSystemCurrency());
}

/**
 * Calculates exact line pricing for a storefront product accounting for
 * BOGO volume thresholds, bundles, and active discounts.
 */
export function calculateCartLinePricing(
  product: StorefrontProduct,
  quantity: number = 1,
  currencyCode?: string | null,
): CartLinePricingResult {
  const digits = cartDigits(currencyCode);
  const qty = Math.max(1, Math.trunc(Number(quantity) || 1));
  const basePrice = Number(product.originalPrice || product.price || 0);
  const originalLineTotal = roundMoneyValue(basePrice * qty, digits);

  // BOGO Offer
  if (product.offerType === 'bogo' && product.bogoBuyQty && product.bogoGetQty) {
    const buyQ = Math.max(1, Number(product.bogoBuyQty));
    const getQ = Math.max(1, Number(product.bogoGetQty));
    const discPct = Math.min(100, Math.max(0, Number(product.bogoDiscountPercent ?? 100)));
    const freeUnits = Math.floor(qty / (buyQ + getQ)) * getQ;

    if (freeUnits > 0) {
      const normalTotal = qty * basePrice;
      const savings = freeUnits * basePrice * (discPct / 100);
      const discountedTotal = roundMoneyValue(Math.max(0, normalTotal - savings), digits);
      const unitPrice = roundMoneyValue(discountedTotal / qty, digits);
      return {
        lineTotal: discountedTotal,
        unitPrice,
        originalLineTotal,
        savings: roundMoneyValue(savings, digits),
        isBogoApplied: true,
        offerBadge: discPct === 100 ? `اشتري ${buyQ} واكسب ${getQ}` : `اشتري ${buyQ} و${getQ} بخصم ${discPct}%`,
      };
    }
  }

  // Bundle / min_qty
  if (product.offerType === 'bundle' && product.minQty && product.offerValue) {
    const minQ = Math.max(1, Number(product.minQty));
    if (qty >= minQ) {
      const bundles = Math.floor(qty / minQ);
      const remainder = qty % minQ;
      const discountedTotal = roundMoneyValue((bundles * product.offerValue) + (remainder * basePrice), digits);
      const unitPrice = roundMoneyValue(discountedTotal / qty, digits);
      return {
        lineTotal: discountedTotal,
        unitPrice,
        originalLineTotal,
        savings: Math.max(0, roundMoneyValue(originalLineTotal - discountedTotal, digits)),
        isBogoApplied: false,
        offerBadge: product.offerBadge,
      };
    }
  }

  // Standard line with already discounted product.price
  const effectiveUnitPrice = Number(product.price || basePrice);
  const lineTotal = roundMoneyValue(effectiveUnitPrice * qty, digits);
  return {
    lineTotal,
    unitPrice: effectiveUnitPrice,
    originalLineTotal,
    savings: Math.max(0, roundMoneyValue(originalLineTotal - lineTotal, digits)),
    isBogoApplied: false,
    offerBadge: product.offerBadge,
  };
}

export function calculateCartSubtotal(
  items: Array<{ product: StorefrontProduct; quantity: number }>,
  currencyCode?: string | null,
): {
  subtotal: number;
  originalSubtotal: number;
  totalSavings: number;
} {
  const digits = cartDigits(currencyCode);
  let subtotal = 0;
  let originalSubtotal = 0;

  for (const item of items) {
    const pricing = calculateCartLinePricing(item.product, item.quantity, currencyCode);
    subtotal += pricing.lineTotal;
    originalSubtotal += pricing.originalLineTotal;
  }

  subtotal = roundMoneyValue(subtotal, digits);
  originalSubtotal = roundMoneyValue(originalSubtotal, digits);

  return {
    subtotal,
    originalSubtotal,
    totalSavings: Math.max(0, roundMoneyValue(originalSubtotal - subtotal, digits)),
  };
}
