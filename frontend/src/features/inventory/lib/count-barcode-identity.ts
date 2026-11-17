import type { Product } from '@/types/domain';
import { getBarcodeLookupCandidates } from '@/lib/barcode';
export type CountBarcodeResolution =
  | { status: 'matched'; product: Product; baseQty: number }
  | { status: 'ambiguous' | 'style_code' | 'missing' };

function classifySingleCandidate(value: string, products: Product[]): CountBarcodeResolution {
  const lower = value.toLowerCase();
  const matches = new Map<string, { product: Product; baseQty: number }>();
  for (const product of products) {
    if (product.isActive === false || product.is_active === false) continue;
    const matchingUnits = (product.units || []).filter((row) => String(row.barcode || '').trim().toLowerCase() === lower);
    const matchesBase = String(product.barcode || '').trim().toLowerCase() === lower;
    if (!matchingUnits.length && !matchesBase) continue;
    const unitMultipliers = matchingUnits.map((unit) => Number(unit.multiplier));
    if (matchesBase) unitMultipliers.push(1);
    if (unitMultipliers.some((multiplier) => !Number.isFinite(multiplier) || multiplier <= 0) ||
      new Set(unitMultipliers).size !== 1) return { status: 'ambiguous' };
    matches.set(String(product.id), { product, baseQty: unitMultipliers[0] });
  }
  if (matches.size > 1) return { status: 'ambiguous' };
  if (matches.size === 1) {
    const only = matches.values().next().value!;
    return { status: 'matched', ...only };
  }
  if (products.some((product) => String(product.styleCode || '').trim().toLowerCase() === lower)) return { status: 'style_code' };
  return { status: 'missing' };
}

/** Model code labels a group, not a physical size/color; unit barcode counts in base pieces. */
export function classifyStockCountBarcodeScan(barcode: string, products: Product[]): CountBarcodeResolution {
  const candidates = getBarcodeLookupCandidates(barcode);
  if (!candidates.length) return { status: 'missing' };
  for (const candidate of candidates) {
    const res = classifySingleCandidate(candidate, products);
    if (res.status !== 'missing') return res;
  }
  return { status: 'missing' };
}
