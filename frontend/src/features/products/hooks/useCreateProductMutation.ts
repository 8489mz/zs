import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { productsApi } from '@/features/products/api/products.api';
import { bomsApi } from '@/shared/api/boms.api';
import { extractCreatedEntityId } from '@/lib/api/extract-created-entity-id';
import { getFriendlyApiErrorMessage } from '@/lib/errors';
import { toast } from '@/shared/components/system-alert';
import { normalizeArabicInput, normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import type { ProductUnit } from '@/types/domain';
import type { ProductFormOutput } from '@/features/products/schemas/product.schema';
import { normalizeProductUnits } from '@/features/products/components/ProductUnitsEditor';
import { normalizeNumericStyleCode } from '@/features/products/lib/style-code';
import { splitFashionTokens, type FashionVariantDraft } from '@/features/products/components/fashion-variants.utils';

export type ProductFormValues = ProductFormOutput & {
  units?: ProductUnit[];
  fashionVariantRows?: FashionVariantDraft[];
  groupedEntryEnabled?: boolean;
};

function buildFashionVariants(values: ProductFormValues) {
  const seededRows = Array.isArray(values.fashionVariantRows)
    ? values.fashionVariantRows
        .map((row) => ({
          color: normalizeArabicInput(row.color),
          size: normalizeArabicInput(row.size),
          barcode: String(row.barcode || '').trim(),
          stock: Math.max(0, Number(row.stock || 0)),
          costPrice: row.costPrice !== undefined && row.costPrice !== null && !isNaN(Number(row.costPrice)) && Number(row.costPrice) >= 0 ? Number(row.costPrice) : undefined,
          retailPrice: row.retailPrice !== undefined && row.retailPrice !== null && !isNaN(Number(row.retailPrice)) && Number(row.retailPrice) >= 0 ? Number(row.retailPrice) : undefined,
          wholesalePrice: row.wholesalePrice !== undefined && row.wholesalePrice !== null && !isNaN(Number(row.wholesalePrice)) && Number(row.wholesalePrice) >= 0 ? Number(row.wholesalePrice) : undefined,
          minStock: row.minStock !== undefined && row.minStock !== null && !isNaN(Number(row.minStock)) && Number(row.minStock) >= 0 ? Number(row.minStock) : undefined,
          sku: row.sku ? String(row.sku).trim() : undefined,
          imageUrl: row.imageUrl ? String(row.imageUrl).trim() : undefined,
        }))
        .filter((row) => row.color || row.size)
    : [];
  if (seededRows.length) {
    const seen = new Set<string>();
    for (const row of seededRows) {
      const key = `${normalizeArabicSearchKey(row.color)}::${normalizeArabicSearchKey(row.size)}`;
      if (seen.has(key)) throw new Error('يوجد لون ومقاس مكرر؛ صحح الصفوف قبل الحفظ');
      seen.add(key);
    }
    return seededRows;
  }
  const colors = splitFashionTokens(values.fashionColors);
  const sizes = splitFashionTokens(values.fashionSizes);
  const defaultStock = Number(values.variantStock || 0);
  const normalizedColors = colors.length ? colors : [''];
  const normalizedSizes = sizes.length ? sizes : [''];
  return normalizedColors.flatMap((color) => normalizedSizes.map((size) => ({ color, size, barcode: '', stock: defaultStock }))).filter((row) => row.color || row.size);
}

function buildProductPayload(values: ProductFormValues) {
  const itemKind = values.itemKind === 'fashion' ? 'fashion' : 'standard';
  const groupedEntryEnabled = Boolean(values.groupedEntryEnabled || itemKind === 'fashion');
  const units = groupedEntryEnabled
    ? [{ name: 'قطعة', multiplier: 1, barcode: '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }]
    : normalizeProductUnits(values.units, values.barcode || '').map((unit, index) => ({
        name: unit.name || (index === 0 ? 'قطعة' : ''),
        multiplier: Number(unit.multiplier || 1) || 1,
        barcode: unit.barcode || (index === 0 ? values.barcode || '' : ''),
        isBaseUnit: Boolean(unit.isBaseUnit),
        isSaleUnit: Boolean(unit.isSaleUnit),
        isPurchaseUnit: Boolean(unit.isPurchaseUnit)
      }));

  const fashionVariants = groupedEntryEnabled ? buildFashionVariants(values) : [];

  return {
    name: normalizeArabicInput(values.name),
    barcode: groupedEntryEnabled ? '' : (values.barcode || ''),
    itemType: values.itemType || 'product',
    itemKind,
    styleCode: groupedEntryEnabled ? normalizeNumericStyleCode(values.styleCode || '') : (values.styleCode || ''),
    color: groupedEntryEnabled ? '' : normalizeArabicInput(values.color || ''),
    size: groupedEntryEnabled ? '' : normalizeArabicInput(values.size || ''),
    costPrice: Number(values.costPrice || 0),
    retailPrice: Number(values.retailPrice || 0),
    wholesalePrice: Number(values.wholesalePrice || 0),
    creditPrice: values.creditPrice != null && Number(values.creditPrice) > 0 ? Number(values.creditPrice) : undefined,
    consumerPrice: values.consumerPrice != null && Number(values.consumerPrice) > 0 ? Number(values.consumerPrice) : undefined,
    stock: groupedEntryEnabled ? 0 : Number(values.stock || 0),
    minStock: Number(values.minStock || 0),
    categoryId: values.categoryId ? Number(values.categoryId) : undefined,
    supplierId: values.supplierId ? Number(values.supplierId) : undefined,
    warehouseId: values.warehouseId ? Number(values.warehouseId) : undefined,
    binLocation: normalizeArabicInput(values.binLocation || ''),
    notes: normalizeArabicInput(values.notes || ''),
    icon: values.icon || undefined,
    expiryDate: values.expiryDate || values.metadata?.expiryDate || undefined,
    metadata: values.expiryDate ? { ...(values.metadata || {}), expiryDate: values.expiryDate } : values.metadata,
    units,
    customerPrices: [],
    fashionVariants,
  };
}

export function useCreateProductMutation(onSuccess?: (productId: string, name: string) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const result = await productsApi.create(buildProductPayload(values));
      const productId = extractCreatedEntityId(result);

      if (values.isCombo && values.comboComponents && values.comboComponents.length > 0 && productId) {
        await bomsApi.create({
          productId: Number(productId),
          quantity: 1,
          overheadCost: 0,
          lines: values.comboComponents.map(comp => ({
            componentProductId: comp.productId,
            quantity: comp.quantity,
            unitName: 'قطعة',
            expectedCost: 0,
            unitMultiplier: 1,
            wastePercentage: 0
          }))
        });
      }

      return result;
    },
    onSuccess: async (result, variables) => {
      await invalidateCatalogDomain(queryClient, { includeProducts: true, includeCategories: true });
      await queryClient.invalidateQueries({ queryKey: ['storefront-catalog'], refetchType: 'all' });
      await queryClient.invalidateQueries({ queryKey: ['storefront-info'], refetchType: 'all' });
      await queryClient.invalidateQueries({ queryKey: ['products'], refetchType: 'all' });
      await queryClient.invalidateQueries({ queryKey: ['products', 'pos'], refetchType: 'all' });
      const productId = extractCreatedEntityId(result);
      if (productId) {
        onSuccess?.(productId, variables.name);
      } else {
        onSuccess?.('', variables.name);
      }
    },
    onError: (error) => {
      const msg = getFriendlyApiErrorMessage(error, 'تعذر حفظ الصنف. برجاء التحقق من صحة البيانات والمحاولة مرة أخرى.');
      toast.error(msg);
    }
  });
}
