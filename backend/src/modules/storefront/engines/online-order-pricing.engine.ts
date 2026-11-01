import { type MoneyDigits, roundMoney as roundBookMoney } from '../../accounting/engines/money-minor-units.engine';

// Invariant SF-4 (ARCHITECTURE_INVARIANTS.md section 4): the price of an online order line is decided
// by the server from the merchant's catalog — including the chosen variant — never taken from the
// client. The frontend mirror (features/storefront/lib/storefront-variant-pricing.ts) exists only to
// show the same number before checkout; if the two ever disagree, this one wins.
//
// Book digits are REQUIRED (INV-STOREFRONT-PRICING-DIGITS): the unit
// price this function returns is charged to the customer, so rounding
// it at an assumed 2 decimals would silently cut a 3-decimal tenant's
// prices. The old file-private 2-decimal rounder is gone; rounding
// goes through the canonical engine at the caller's digits.
//
// O54: the storefront showed and charged the customer the variant price in the cart, but the order DTO
// had no variant field and the server billed `retail_price` and dropped the variant name. The merchant
// could not tell which size was ordered, and the invoice total differed from what the customer saw.

export interface ProductVariantDef {
  name: string;
  /** Absolute price for this variant. Wins over extraPrice when set. */
  price?: number;
  /** Added to the product's base price when no absolute price is set. */
  extraPrice?: number;
  /** Display-only: photo shown when the shopper picks this variant. Never
   * priced, never read by the order engine; the catalog passes it through
   * verbatim and the storefront swaps to it with fallback to the product
   * photo. Carried by readProductVariants so the shape is honored
   * everywhere the def is used. */
  imageUrl?: string;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
}

export function readProductVariants(metadata: unknown): ProductVariantDef[] {
  const raw = parseMetadata(metadata).variants;
  if (!Array.isArray(raw)) return [];
  const variants: ProductVariantDef[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const name = String((v as Record<string, unknown>).name ?? '').trim();
    if (!name) continue;
    const price = toFiniteNumber((v as Record<string, unknown>).price);
    const extraPrice = toFiniteNumber((v as Record<string, unknown>).extraPrice);
    const imageUrl = (v as Record<string, unknown>).imageUrl;
    variants.push({
      name,
      ...(price !== null ? { price } : {}),
      ...(extraPrice !== null ? { extraPrice } : {}),
      ...(typeof imageUrl === 'string' && imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
    });
  }
  return variants;
}

export type OrderLinePriceResult =
  | { ok: true; unitPrice: number; variantName: string | null }
  | { ok: false; reason: 'UNKNOWN_VARIANT' | 'INVALID_PRICE' };

/**
 * No variant requested -> the product's base price.
 * A variant requested -> it must exist on the product (exact name after trim); its absolute price,
 * else base + extraPrice. Unknown variant names are rejected rather than silently priced at base,
 * which is exactly how the old path under-billed.
 */
export function resolveOrderLinePrice(basePrice: number, metadata: unknown, requestedVariant: string | null = null, digits: MoneyDigits): OrderLinePriceResult {
  const base = Number(basePrice || 0);
  const wanted = String(requestedVariant ?? '').trim();
  if (!wanted) {
    return base >= 0 ? { ok: true, unitPrice: roundBookMoney(base, digits), variantName: null } : { ok: false, reason: 'INVALID_PRICE' };
  }

  const variant = readProductVariants(metadata).find((v) => v.name === wanted);
  if (!variant) return { ok: false, reason: 'UNKNOWN_VARIANT' };

  const unitPrice = variant.price !== undefined ? variant.price : base + (variant.extraPrice ?? 0);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { ok: false, reason: 'INVALID_PRICE' };
  return { ok: true, unitPrice: roundBookMoney(unitPrice, digits), variantName: variant.name };
}

export function formatVariantLineName(productName: string, variantName: string | null): string {
  return variantName ? `${productName} (${variantName})` : productName;
}
