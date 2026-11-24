import { displayProductName } from '../../utils/product-submit.utils';
import type { Product } from '@/types/domain';

export type ProductGroup = {
  key: string;
  representative: Product;
  children: Product[];
  grouped: boolean;
};

export function variantLabel(product: Product) {
  const primary = String(product.color || '').trim();
  const secondary = String(product.size || '').trim();
  if (primary && secondary) return `${primary} / ${secondary}`;
  return primary || secondary || '—';
}

export function deriveBaseName(product: Product) {
  // Display fallback only: an English-only product shows its English name
  // here, but the stored Arabic name stays empty (no write-time copy).
  const raw = displayProductName(product);
  const label = variantLabel(product);
  if (!label || label === '—') return raw;
  const suffix = ` - ${label}`;
  return raw.endsWith(suffix) ? raw.slice(0, -suffix.length).trim() : raw;
}

export function groupProducts(products: Product[]): ProductGroup[] {
  const byKey = new Map<string, Product[]>();
  for (const product of products) {
    const styleCode = String(product.styleCode || '').trim();
    const key = styleCode ? `group:${styleCode}` : `single:${product.id}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(product);
  }
  return Array.from(byKey.entries()).map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => variantLabel(a).localeCompare(variantLabel(b), 'ar'));
    const representative = sorted[0];
    return { key, representative, children: sorted, grouped: key.startsWith('group:') && sorted.length > 1 };
  });
}
