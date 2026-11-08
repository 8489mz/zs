import type { Product } from '@/types/domain';
import type { PosPriceType } from '@/features/pos/types/pos.types';
import { getProductPrice } from '@/features/pos/lib/pos.domain';
import type { MoneyDigits } from '@/shared/utils/money';

export interface PosProductGroup {
  key: string;
  title: string;
  stem: string;
  products: Product[];
  hasVariants: boolean;
  minPrice: number;
  maxPrice: number;
  colors: string[];
  sizes: string[];
  itemKind?: Product['itemKind'];
  imageUrl?: string | null;
  totalStock: number;
}

export type PosGroupShelf = 'all' | 'choices' | 'direct' | 'favorites' | 'recent';

function normalizeText(value: string) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getNameStem(name: string) {
  const normalized = normalizeText(name);
  const slashIndex = normalized.indexOf('/');
  const withoutSlash = slashIndex >= 0 ? normalized.slice(0, slashIndex).trim() : normalized;
  const hyphenIndex = withoutSlash.indexOf(' - ');
  return normalizeText(hyphenIndex >= 0 ? withoutSlash.slice(0, hyphenIndex) : withoutSlash);
}

function getGroupKey(product: Product, repeatedStems: Set<string>) {
  if (product.styleCode) return `style:${String(product.styleCode).trim()}`;
  const stem = getNameStem(product.name);
  const hasVariantSignal = Boolean(product.color || product.size || product.itemKind === 'fashion');
  if (hasVariantSignal || repeatedStems.has(stem)) return `stem:${stem}`;
  return `product:${product.id}`;
}

const arCollator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

export function buildPosProductGroups(products: Product[], priceType: PosPriceType, digits: MoneyDigits) {
  const stemCounts = new Map<string, number>();
  products.forEach((product) => {
    const stem = getNameStem(product.name);
    stemCounts.set(stem, (stemCounts.get(stem) || 0) + 1);
  });
  const repeatedStems = new Set(
    Array.from(stemCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([stem]) => stem),
  );

  const groupsMap = new Map<string, Product[]>();
  products.forEach((product) => {
    const key = getGroupKey(product, repeatedStems);
    const current = groupsMap.get(key) || [];
    current.push(product);
    groupsMap.set(key, current);
  });

  return Array.from(groupsMap.entries())
    .map(([key, groupProducts]) => {
      const orderedProducts = [...groupProducts].sort((a, b) => {
        const aColor = String(a.color || '');
        const bColor = String(b.color || '');
        if (aColor !== bColor) return arCollator.compare(aColor, bColor);
        const aSize = String(a.size || '');
        const bSize = String(b.size || '');
        return arCollator.compare(aSize, bSize);
      });
      const first = orderedProducts[0];
      const prices = orderedProducts.map((product) => getProductPrice(product, priceType, 1, 1, digits));
      const colors = Array.from(
        new Set(orderedProducts.map((product) => String(product.color || '').trim()).filter(Boolean)),
      );
      const sizes = Array.from(
        new Set(orderedProducts.map((product) => String(product.size || '').trim()).filter(Boolean)),
      );
      const title = key.startsWith('product:') ? first.name : getNameStem(first.name) || first.name;
      const targetWithImg = orderedProducts.find((p) => p.imageUrl || (p as any).metadata?.imageUrl);
      const imageUrl = targetWithImg?.imageUrl 
        || (targetWithImg as any)?.metadata?.imageUrl 
        || (first as any)?.metadata?.imageUrl 
        || first.imageUrl 
        || null;
      const totalStock = orderedProducts.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
      return {
        key,
        title,
        stem: getNameStem(first.name),
        products: orderedProducts,
        hasVariants: orderedProducts.length > 1,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        colors,
        sizes,
        itemKind: first.itemKind,
        imageUrl,
        totalStock,
      } satisfies PosProductGroup;
    })
    .sort((a, b) => arCollator.compare(a.title, b.title));
}

export function getGroupShelfGroups(params: {
  groups: PosProductGroup[];
  shelf: PosGroupShelf;
  favoriteKeys: Set<string>;
  recentKeys: string[];
}) {
  if (params.shelf === 'favorites') return params.groups.filter((group) => params.favoriteKeys.has(group.key));
  if (params.shelf === 'recent') {
    return params.recentKeys
      .map((key) => params.groups.find((group) => group.key === key))
      .filter(Boolean) as PosProductGroup[];
  }
  if (params.shelf === 'choices') return params.groups.filter((group) => group.hasVariants);
  if (params.shelf === 'direct') return params.groups.filter((group) => !group.hasVariants);
  return params.groups;
}

export function buildRecentGroupKeys(recentProducts: Product[], groups: PosProductGroup[]) {
  const productToGroup = new Map<string, string>();
  groups.forEach((group) => {
    group.products.forEach((product) => {
      productToGroup.set(String(product.id), group.key);
    });
  });
  const keys: string[] = [];
  recentProducts.forEach((product) => {
    const key = productToGroup.get(String(product.id));
    if (key && !keys.includes(key)) keys.push(key);
  });
  return keys;
}
