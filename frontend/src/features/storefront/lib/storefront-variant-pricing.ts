import type { StorefrontProduct, StorefrontProductVariant } from '../types/storefront.types';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';

// Display mirror of the server's pricing engine
// (backend/src/modules/storefront/engines/online-order-pricing.engine.ts, invariant SF-4).
// The server re-prices every line at checkout; this only makes the cart show the same number first.

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function getProductVariants(product: StorefrontProduct | null | undefined): StorefrontProductVariant[] {
  const raw = (product as { variants?: unknown } | null | undefined)?.variants;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v) => v && typeof v === 'object' && String((v as { name?: unknown }).name ?? '').trim())
    .map((v) => {
      const { imageUrl: rawImage, ...rest } = v as StorefrontProductVariant;
      const imageUrl = typeof rawImage === 'string' && rawImage.trim() ? rawImage.trim() : undefined;
      return { ...rest, name: String(rest.name).trim(), ...(imageUrl ? { imageUrl } : {}) };
    });
}

/* INV-FE2-FRONTEND-BOOK-DIGITS (U6 FE2): variant prices round at the
 * store's book digits. `digits` is a required trailing param (FE1
 * convention) — callers resolve it from the store currency. The old code
 * hardcoded a *100/100 round, so a 3-decimal store's variant price lost
 * a decimal before the cart line was even built. */
/** null when the variant does not exist or would price below zero (the server rejects both). */
export function resolveVariantUnitPrice(basePrice: number, variant: StorefrontProductVariant | null | undefined, digits: MoneyDigits): number | null {
  const base = Number(basePrice || 0);
  if (!variant) return base;
  const absolute = toFiniteNumber(variant.price);
  const extra = toFiniteNumber(variant.extraPrice) ?? 0;
  const price = absolute !== null ? absolute : base + extra;
  if (!Number.isFinite(price) || price < 0) return null;
  return roundMoneyValue(price, digits);
}

/**
 * The product snapshot stored on a cart line. `price` and `name` reflect the chosen variant;
 * `basePrice` keeps the catalog price so the line can be re-priced when the catalog refreshes.
 * Returns null when the variant is gone from the catalog.
 */
export function buildCartProduct(catalogProduct: StorefrontProduct, digits: MoneyDigits, variantName?: string | null): StorefrontProduct | null {
  const base = Number(catalogProduct.basePrice ?? catalogProduct.price ?? 0);
  const wanted = String(variantName ?? '').trim();
  if (!wanted) {
    return { ...catalogProduct, price: base, basePrice: base, variantName: null };
  }
  const variant = getProductVariants(catalogProduct).find((v) => v.name === wanted);
  const price = variant ? resolveVariantUnitPrice(base, variant, digits) : null;
  if (!variant || price === null) return null;
  return {
    ...catalogProduct,
    price,
    basePrice: base,
    name: `${catalogProduct.name} (${variant.name})`,
    variantName: variant.name,
    // The cart line shows the picked variant's photo (display-only); the
    // product photo stays the fallback, exactly like the QuickView swap.
    ...(variant.imageUrl ? { imageUrl: variant.imageUrl } : {}),
  };
}
