import { useQueryClient } from '@tanstack/react-query';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { productsApi } from '@/features/products/api/products.api';
import { normalizeProductUnits } from '@/features/products/components/ProductUnitsEditor';
import type { Product, ProductCustomerPrice, ProductOffer, ProductUnit } from '@/types/domain';
import type { ProductFormOutput } from '@/features/products/schemas/product.schema';

export function toProductFormValues(product: Product): ProductFormOutput {
  return {
    name: product.name || '',
    nameEn: (product as any).nameEn || '',
    barcode: product.barcode || '',
    sku: (product as any).sku || '',
    itemType: product.itemType || 'product',
    itemKind: product.itemKind === 'fashion' ? 'fashion' : 'standard',
    styleCode: product.styleCode || '',
    color: product.color || '',
    size: product.size || '',
    fashionColors: product.color || '',
    fashionSizes: product.size || '',
    variantStock: Number(product.stock || 0),
    costPrice: Number(product.costPrice || 0),
    retailPrice: Number(product.retailPrice || 0),
    wholesalePrice: Number(product.wholesalePrice || 0),
    creditPrice: product.creditPrice != null ? Number(product.creditPrice) : 0,
    consumerPrice: product.consumerPrice != null ? Number(product.consumerPrice) : 0,
    stock: Number(product.stock || 0),
    minStock: Number(product.minStock || 0),
    categoryId: product.categoryId || '',
    supplierId: product.supplierId || '',
    warehouseId: product.defaultLocationId || '',
    binLocation: product.binLocation || '',
    notes: product.notes || '',
    icon: product.icon || '',
    imageUrl: product.imageUrl || product.metadata?.imageUrl || '',
    expiryDate: (product as any)?.expiryDate || product?.metadata?.expiryDate || '',
    trackSerials: Boolean(product.trackSerials),
    isCombo: false,
    comboComponents: [],
    calories: product.calories != null ? Number(product.calories) : null,
    allergens: Array.isArray(product.allergens) ? product.allergens : [],
    isSpicy: Boolean(product.isSpicy),
    isVegetarian: Boolean(product.isVegetarian),
    isGlutenFree: Boolean(product.isGlutenFree),
    metadata: {
      ...(product?.metadata || {}),
      imageUrl: product.imageUrl || product.metadata?.imageUrl || '',
      expiryDate: (product as any)?.expiryDate || product?.metadata?.expiryDate || ''
    }
  };
}

export function normalizeCustomerPrices(product?: Product): ProductCustomerPrice[] {
  return Array.isArray(product?.customerPrices)
    ? product!.customerPrices!.map((entry) => ({ customerId: String(entry.customerId || ''), price: Number(entry.price || 0) }))
    : [];
}

export function buildUpdatePayload(
  values: ProductFormOutput,
  existingProduct: Product,
  units: ProductUnit[],
  customerPrices: ProductCustomerPrice[],
  offers?: ProductOffer[]
) {
  const categoryId = values.categoryId ? Number(values.categoryId) : undefined;
  const supplierId = values.supplierId ? Number(values.supplierId) : undefined;
  const warehouseId = values.warehouseId ? Number(values.warehouseId) : undefined;
  const itemKind = values.itemKind === 'fashion' ? 'fashion' : 'standard';
  const expiryDate = values.expiryDate || values.metadata?.expiryDate || undefined;
  const normalizedUnits = itemKind === 'fashion'
    ? [{ name: 'قطعة', multiplier: 1, barcode: values.barcode || '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }]
    : normalizeProductUnits(units, values.barcode || '').map((unit, index) => ({
        name: unit.name,
        multiplier: Number(unit.multiplier || 1) || 1,
        barcode: unit.barcode || (index === 0 ? values.barcode || '' : ''),
        isBaseUnit: Boolean(unit.isBaseUnit),
        isSaleUnit: Boolean(unit.isSaleUnit),
        isPurchaseUnit: Boolean(unit.isPurchaseUnit)
      }));

  return {
    name: values.name,
    nameEn: (values as any).nameEn || undefined,
    barcode: values.barcode || '',
    sku: (values as any).sku || undefined,
    itemType: values.itemType || 'product',
    itemKind,
    styleCode: values.styleCode || '',
    color: values.color || '',
    size: values.size || '',
    costPrice: Number(values.costPrice || 0),
    retailPrice: Number(values.retailPrice || 0),
    wholesalePrice: Number(values.wholesalePrice || 0),
    creditPrice: values.creditPrice != null && Number(values.creditPrice) > 0 ? Number(values.creditPrice) : null,
    consumerPrice: values.consumerPrice != null && Number(values.consumerPrice) > 0 ? Number(values.consumerPrice) : null,
    minStock: Number(values.minStock || 0),
    trackSerials: Boolean(values.trackSerials),
    icon: values.icon || undefined,
    imageUrl: (values as any).imageUrl !== undefined ? ((values as any).imageUrl || '') : (values.metadata?.imageUrl || undefined),
    expiryDate: expiryDate || undefined,
    metadata: {
      ...(existingProduct.metadata || {}),
      ...(values.metadata || {}),
      ...(expiryDate ? { expiryDate } : {}),
      ...((values as any).imageUrl !== undefined ? { imageUrl: (values as any).imageUrl || '' } : {})
    },
    ...(categoryId ? { categoryId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    binLocation: values.binLocation || '',
    notes: values.notes || '',
    calories: values.calories != null ? Number(values.calories) : null,
    allergens: values.allergens || [],
    isSpicy: Boolean(values.isSpicy),
    isVegetarian: Boolean(values.isVegetarian),
    isGlutenFree: Boolean(values.isGlutenFree),
    units: normalizedUnits,
    offers: (offers ?? existingProduct.offers ?? [])
      .filter((offer) => Number(offer.value || 0) > 0 || offer.type === 'bogo')
      .map((offer) => ({
        type: offer.type || 'percent',
        value: Number(offer.value || 0),
        minQty: Math.max(1, Number(offer.minQty || 1)),
        ...(offer.from ? { from: offer.from } : {}),
        ...(offer.to ? { to: offer.to } : {}),
        ...(offer.bogoBuyQty ? { bogoBuyQty: Number(offer.bogoBuyQty) } : {}),
        ...(offer.bogoGetQty ? { bogoGetQty: Number(offer.bogoGetQty) } : {}),
        ...(offer.bogoDiscountPercent != null ? { bogoDiscountPercent: Number(offer.bogoDiscountPercent) } : {}),
        ...(offer.happyHourStart ? { happyHourStart: offer.happyHourStart } : {}),
        ...(offer.happyHourEnd ? { happyHourEnd: offer.happyHourEnd } : {}),
        ...(offer.daysOfWeek ? { daysOfWeek: offer.daysOfWeek } : {}),
      })),
    customerPrices: customerPrices
      .map((entry) => ({
        customerId: Number(entry.customerId || 0),
        price: Number(entry.price || 0)
      }))
      .filter((entry) => entry.customerId > 0 && entry.price >= 0),
    fashionVariants: []
  };
}

export async function refetchAndSelectProduct(queryClient: ReturnType<typeof useQueryClient>, productId: string) {
  await invalidateCatalogDomain(queryClient, { includeProducts: true });
  // INV-PRODUCTS-WORKSPACE-SAVE: fetch the one product by id. The old code
  // ran productsApi.list() here — listAll loops pageSize 1000 until
  // totalPages, i.e. 11 sequential GETs of the full catalog (each re-running
  // the server-side full-catalog listProducts) just to find one row.
  try {
    return await productsApi.get(productId);
  } catch {
    return null;
  }
}
