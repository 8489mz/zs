import { normalizeArabicInput, normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import type { Product } from '@/types/domain';

export type CommonDraft = {
  name: string;
  styleCode: string;
  itemKind: 'standard' | 'fashion';
  itemType: 'product' | 'raw_material';
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  minStock: number;
  categoryId: string;
  supplierId: string;
  notes: string;
  defaultLocationId: string;
};

export type VariantDraft = {
  id?: string;
  color: string;
  size: string;
  sku?: string;
  barcode: string;
  useCustomPricing: boolean;
  pricingEditorOpen: boolean;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  stock?: number;
  originalStock?: number;
  minStock?: number;
  /** Per-variant photo, hydrated from the product row's imageUrl. '' = no
   * stored photo (clear on save for existing rows); undefined = untouched. */
  imageUrl?: string;
};

export function resolveGroupBaselinePricing(products: Product[], fallback?: Product) {
  if (!products.length) {
    return {
      costPrice: Number(fallback?.costPrice || 0),
      retailPrice: Number(fallback?.retailPrice || 0),
      wholesalePrice: Number(fallback?.wholesalePrice || 0),
    };
  }
  const counts = new Map<string, { count: number; costPrice: number; retailPrice: number; wholesalePrice: number }>();
  for (const entry of products) {
    const costPrice = Number(entry.costPrice || 0);
    const retailPrice = Number(entry.retailPrice || 0);
    const wholesalePrice = Number(entry.wholesalePrice || 0);
    const key = `${costPrice}::${retailPrice}::${wholesalePrice}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { count: 1, costPrice, retailPrice, wholesalePrice });
    }
  }
  let best = { count: -1, costPrice: Number(products[0].costPrice || 0), retailPrice: Number(products[0].retailPrice || 0), wholesalePrice: Number(products[0].wholesalePrice || 0) };
  for (const candidate of counts.values()) {
    if (candidate.count > best.count) best = candidate;
  }
  return { costPrice: best.costPrice, retailPrice: best.retailPrice, wholesalePrice: best.wholesalePrice };
}

export function toCommonDraft(product: Product, groupProducts?: Product[]): CommonDraft {
  const baseline = groupProducts && groupProducts.length ? resolveGroupBaselinePricing(groupProducts, product) : {
    costPrice: Number(product.costPrice || 0),
    retailPrice: Number(product.retailPrice || 0),
    wholesalePrice: Number(product.wholesalePrice || 0),
  };
  return {
    name: product.name || '',
    styleCode: product.styleCode || '',
    itemKind: product.itemKind === 'fashion' ? 'fashion' : 'standard',
    itemType: product.itemType === 'raw_material' ? 'raw_material' : 'product',
    costPrice: baseline.costPrice,
    retailPrice: baseline.retailPrice,
    wholesalePrice: baseline.wholesalePrice,
    minStock: Number(product.minStock || 0),
    categoryId: product.categoryId || '',
    supplierId: product.supplierId || '',
    notes: product.notes || '',
    defaultLocationId: product.defaultLocationId || '',
  };
}

export function variantLabel(row: Pick<VariantDraft, 'color' | 'size'>) {
  const primary = normalizeArabicInput(String(row.color || ''));
  const secondary = normalizeArabicInput(String(row.size || ''));
  if (primary && secondary) return `${primary} / ${secondary}`;
  return primary || secondary;
}

export function sortVariants(rows: VariantDraft[]) {
  return [...rows].sort((a, b) => variantLabel(a).localeCompare(variantLabel(b), 'ar'));
}

export function toVariantRows(products: Product[]) {
  const baseline = resolveGroupBaselinePricing(products);
  const bc = baseline.costPrice;
  const br = baseline.retailPrice;
  const bw = baseline.wholesalePrice;
  return sortVariants(
    products.map((entry) => {
      const costPrice = Number(entry.costPrice || 0);
      const retailPrice = Number(entry.retailPrice || 0);
      const wholesalePrice = Number(entry.wholesalePrice || 0);
      const useCustomPricing = costPrice !== bc || retailPrice !== br || wholesalePrice !== bw;
      return {
        id: String(entry.id),
        color: entry.color || '',
        size: entry.size || '',
        sku: entry.sku || '',
        barcode: entry.barcode || '',
        useCustomPricing,
        pricingEditorOpen: false,
        costPrice,
        retailPrice,
        wholesalePrice,
        stock: Number(entry.stock ?? 0),
        originalStock: Number(entry.stock ?? 0),
        minStock: Number(entry.minStock ?? 0),
        imageUrl: entry.imageUrl || '',
      };
    })
  );
}

export function rowsFingerprint(rows: VariantDraft[]) {
  return JSON.stringify(
    sortVariants(rows).map((row) => ({
      id: row.id || '',
      color: row.color.trim(),
      size: row.size.trim(),
      sku: (row.sku || '').trim(),
      barcode: row.barcode.trim(),
      useCustomPricing: Boolean(row.useCustomPricing),
      costPrice: Number(row.costPrice || 0),
      retailPrice: Number(row.retailPrice || 0),
      wholesalePrice: Number(row.wholesalePrice || 0),
      stock: Number(row.stock || 0),
      minStock: Number(row.minStock ?? 0),
      imageUrl: (row.imageUrl || '').trim(),
    }))
  );
}

export function duplicateSummary(rows: VariantDraft[]) {
  const comboCounts = new Map<string, number>();
  const barcodeCounts = new Map<string, number>();
  const skuCounts = new Map<string, number>();
  let duplicateCombos = 0;
  let duplicateBarcodes = 0;
  let duplicateSkus = 0;
  for (const row of rows) {
    const combo = `${normalizeArabicSearchKey(String(row.color || ''))}::${normalizeArabicSearchKey(String(row.size || ''))}`;
    if (combo !== '::') {
      const nextCombo = Number(comboCounts.get(combo) || 0) + 1;
      comboCounts.set(combo, nextCombo);
      if (nextCombo === 2) duplicateCombos += 1;
    }
    const barcode = String(row.barcode || '').trim().toLowerCase();
    if (barcode) {
      const nextBarcode = Number(barcodeCounts.get(barcode) || 0) + 1;
      barcodeCounts.set(barcode, nextBarcode);
      if (nextBarcode === 2) duplicateBarcodes += 1;
    }
    const sku = String(row.sku || '').trim().toLowerCase();
    if (sku) {
      const nextSku = Number(skuCounts.get(sku) || 0) + 1;
      skuCounts.set(sku, nextSku);
      if (nextSku === 2) duplicateSkus += 1;
    }
  }
  return { duplicateCombos, duplicateBarcodes, duplicateSkus };
}

/**
 * Never resend unchanged stock when only editing model details: a cashier
 * may have sold units while the fashion editor was open.
 */
export function deriveFashionStockPatch(row: Pick<VariantDraft, 'id' | 'stock' | 'originalStock'>, sourceStock?: number) {
  const stock = Number(row.stock || 0);
  if (!row.id) return { stock, expectedStock: undefined };
  const expectedStock = Number(row.originalStock ?? sourceStock ?? 0);
  return { stock: stock === expectedStock ? undefined : stock, expectedStock };
}

export function pickFashionStockConsolidationTarget(rows: VariantDraft[], source: VariantDraft): VariantDraft | undefined {
  const kept = rows.filter((row) => Boolean(row.id));
  return kept.find((row) => normalizeArabicSearchKey(row.color) === normalizeArabicSearchKey(source.color));
}

/**
 * Save-row projection for the group editor's mutation. This is the ONLY
 * place the editor's draft rows become the save payload, so every field the
 * backend must receive has to be listed here. imageUrl MUST be carried:
 * dropping it silently discards a photo set (or cut) in the matrix — the
 * cell writes row state, buildPayload forwards imageUrl, and the backend
 * merges it into metadata, but none of that runs if this projection drops
 * the field (regression: photos vanished on save while the save itself
 * reported success, because the payload simply never contained them).
 */
export function buildGroupSaveRows(rows: VariantDraft[], fallbackMinStock: number): VariantDraft[] {
  return sortVariants(rows.map((row) => ({
    id: row.id,
    color: row.color.trim(),
    size: row.size.trim(),
    sku: row.sku ? row.sku.trim() : undefined,
    barcode: row.barcode.trim(),
    useCustomPricing: Boolean(row.useCustomPricing),
    pricingEditorOpen: false,
    costPrice: Number(row.costPrice || 0),
    retailPrice: Number(row.retailPrice || 0),
    wholesalePrice: Number(row.wholesalePrice || 0),
    stock: Number(row.stock || 0),
    originalStock: row.originalStock,
    minStock: Number(row.minStock ?? fallbackMinStock),
    imageUrl: row.imageUrl,
  })).filter((row) => Boolean(variantLabel(row))));
}

export function buildPayload(common: CommonDraft, row: VariantDraft, source?: Product, originalLocationId?: string) {
  const label = variantLabel(row);
  return {
    name: label ? `${common.name.trim()} - ${label}` : common.name.trim(),
    barcode: row.barcode.trim(),
    sku: row.sku ? row.sku.trim() : undefined,
    expectedCatalogUpdatedAt: source?.catalogUpdatedAt,
    itemKind: common.itemKind,
    styleCode: common.styleCode.trim(),
    color: row.color.trim(),
    size: row.size.trim(),
    // Per-variant photo: a set photo is stored; '' on an existing row clears
    // the stored photo (saveFashionGroup deletes metadata.imageUrl); a new
    // row without a photo sends nothing and inherits nothing (unlike the
    // create flow, where children inherit the parent photo).
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : source ? { imageUrl: '' } : {}),
    costPrice: Number((row.useCustomPricing ? row.costPrice : common.costPrice) || 0),
    retailPrice: Number((row.useCustomPricing ? row.retailPrice : common.retailPrice) || 0),
    wholesalePrice: Number((row.useCustomPricing ? row.wholesalePrice : common.wholesalePrice) || 0),
    minStock: Number(row.id ? (row.minStock ?? common.minStock) : common.minStock),
    categoryId: common.categoryId ? Number(common.categoryId) : undefined,
    supplierId: common.supplierId ? Number(common.supplierId) : undefined,
    warehouseId: ((source && originalLocationId === common.defaultLocationId ? source.defaultLocationId : common.defaultLocationId) || '') ? Number(source && originalLocationId === common.defaultLocationId ? source.defaultLocationId : common.defaultLocationId) : undefined,
    notes: common.notes || '',
    ...deriveFashionStockPatch(row, source?.stock == null ? undefined : Number(source.stock)),
    units: [
      {
        name: 'قطعة',
        multiplier: 1,
        barcode: row.barcode.trim(),
        isBaseUnit: true,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
    ],
    offers: (source?.offers || []).map((offer) => ({
      type: offer.type,
      value: Number(offer.value || 0),
      minQty: Math.max(1, Number(offer.minQty || 1)),
      from: offer.from || null,
      to: offer.to || null,
      bogoBuyQty: offer.bogoBuyQty ?? undefined,
      bogoGetQty: offer.bogoGetQty ?? undefined,
      bogoDiscountPercent: offer.bogoDiscountPercent ?? undefined,
      happyHourStart: offer.happyHourStart ?? undefined,
      happyHourEnd: offer.happyHourEnd ?? undefined,
      daysOfWeek: offer.daysOfWeek ?? undefined,
    })),
    customerPrices: (source?.customerPrices || [])
      .map((entry) => ({ customerId: Number(entry.customerId || 0), price: Number(entry.price || 0) }))
      .filter((entry) => entry.customerId > 0 && entry.price >= 0),
    nameEn: source?.nameEn || undefined,
    metadata: source?.metadata || undefined,
    fashionVariants: [],
  };
}

export function deriveBaseName(entry: Product) {
  const label = variantLabel({ color: entry.color || '', size: entry.size || '' });
  const rawName = String(entry.name || '').trim();
  if (!label) return rawName;
  const suffix = ` - ${label}`;
  return rawName.endsWith(suffix) ? rawName.slice(0, -suffix.length).trim() : rawName;
}
