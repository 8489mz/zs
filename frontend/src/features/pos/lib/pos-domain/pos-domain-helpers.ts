import type { Product, ProductOffer, ProductUnit } from '@/types/domain';
import { todayLocalDateKey } from '@/lib/format';

export function safeUnits(product: Product) {
  return product.units?.length ? product.units : [{
    id: '',
    name: 'قطعة',
    multiplier: 1,
    barcode: product.barcode,
    isBaseUnit: true,
    isSaleUnit: true,
    isPurchaseUnit: true,
  }];
}

export function normalizeDateOnly(value: unknown) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value).trim();
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : todayLocalDateKey(parsed);
}

export function roundQuantity(value: number) {
  return Number(Number(value || 0).toFixed(3));
}

export function getMinimumSaleQuantity(isWeighted?: boolean) {
  return isWeighted ? 0.001 : 1;
}

export function normalizeSaleQuantity(value: number, isWeighted?: boolean) {
  const numericValue = Number(value || 0);
  if (isWeighted) {
    return roundQuantity(Math.max(getMinimumSaleQuantity(true), numericValue));
  }
  return Math.max(1, Math.round(numericValue || 1));
}

export function getResolvedStockLimit(product: Product, unit: ProductUnit, allowDecimal: boolean) {
  const candidate = Number(unit.multiplier);
  const multiplier = Number.isFinite(candidate) && candidate > 0 ? candidate : 1;
  const rawLimit = Number(product.stock || 0) / multiplier;
  return allowDecimal ? roundQuantity(rawLimit) : Math.floor(rawLimit);
}

export function todayLocalIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getOfferType(offer: ProductOffer): 'percent' | 'fixed' | 'price' | 'bundle' | 'bogo' {
  if (offer.type === 'bogo' || (offer as any).offer_type === 'bogo') return 'bogo';
  if (offer.type === 'bundle' || (offer as any).offer_type === 'bundle') return 'bundle';
  if (offer.type === 'price' || (offer as any).offer_type === 'price') return 'price';
  if (offer.type === 'fixed' || (offer as any).offer_type === 'fixed') return 'fixed';
  return 'percent';
}
