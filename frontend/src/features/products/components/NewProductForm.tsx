import { useTranslation } from 'react-i18next';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Category, Product, ProductUnit, Supplier } from '@/types/domain';
import { Field } from '@/shared/ui/field';
import { Button } from '@/shared/ui/button';
import { SmartphoneIcon, ArrowRightIcon, InfoIcon } from '@/shared/components/icons/AppIcons';
import { useSettingsQuery, useCategoriesQuery, useSuppliersQuery, useProductsQuery, useLocationsQuery } from '@/shared/hooks/use-catalog-queries';
import { useCreateProductMutation } from '@/features/products/hooks/useCreateProductMutation';
import { productsApi } from '@/features/products/api/products.api';
import { productFormSchema, type ProductFormInput, type ProductFormOutput } from '@/features/products/schemas/product.schema';
import { ProductUnitsEditor, normalizeProductUnits } from '@/features/products/components/ProductUnitsEditor';
import { ComboComponentsEditor } from '@/features/products/components/ComboComponentsEditor';
import { buildFashionVariantDrafts, splitFashionTokens, type FashionVariantDraft } from '@/features/products/components/fashion-variants.utils';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { useAppToolbar } from '@/stores/toolbar-store';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import { resolveProductSubmitNames } from '@/features/products/utils/product-submit.utils';
import { ComboboxSelect } from '@/shared/ui/ComboboxSelect';
import { ProductNameField } from '@/features/products/components/ProductNameField';
import { ProductIconPicker } from '@/shared/components/icons/ProductIconPicker';
import { ProductImageUploadField } from '@/features/products/components/ProductImageUploadField';
import { guessProductIcon } from '@/features/products/lib/product-smart-matcher';
import { toast } from '@/shared/components/system-alert';
import { getFriendlyApiErrorMessage } from '@/lib/errors';
import { shouldShowExpiryDateField } from '@/features/products/utils/product-visibility.utils';

const normalizeLookupText = (value: unknown) => normalizeArabicSearchKey(value);

const findCreatedCategoryId = (categories: Category[], name: string) => {
  const normalizedName = normalizeLookupText(name);
  if (!normalizedName) return '';
  const matched = [...categories].reverse().find((category) => normalizeLookupText(category.name) === normalizedName);
  return matched?.id ? String(matched.id) : '';
};

const findCreatedSupplierId = (suppliers: Supplier[], name: string, phone: string) => {
  const normalizedName = normalizeLookupText(name);
  const normalizedPhone = normalizeLookupText(phone);
  if (!normalizedName) return '';
  const matched = [...suppliers].reverse().find((supplier) => {
    if (normalizeLookupText(supplier.name) !== normalizedName) return false;
    return normalizedPhone ? normalizeLookupText(supplier.phone) === normalizedPhone : true;
  });
  return matched?.id ? String(matched.id) : '';
};

function getDefaultValues(
  itemKind: 'standard' | 'fashion' = 'standard',
  defaultMinStock = 5,
  initialName = '',
  initialBarcode = ''
): ProductFormInput {
  return {
    name: initialName,
    nameEn: '',
    barcode: initialBarcode,
    itemType: 'product',
    itemKind,
    styleCode: '',
    color: '',
    size: '',
    fashionColors: '',
    fashionSizes: '',
    variantStock: 0,
    costPrice: 0,
    retailPrice: 0,
    wholesalePrice: 0,
    creditPrice: 0,
    consumerPrice: 0,
    stock: 0,
    minStock: defaultMinStock,
    categoryId: '',
    supplierId: '',
    warehouseId: '',
    notes: '',
    icon: '',
    imageUrl: '',
    expiryDate: '',
    trackSerials: false,
    isCombo: false,
    comboComponents: []
  };
}

const LazyFashionVariantsBuilder = lazy(() => import('@/features/products/components/FashionVariantsBuilder').then((module) => ({ default: module.FashionVariantsBuilder })));

async function generateNextStyleCode() {
  const result = await productsApi.allocateStyleCode();
  return result.styleCode;
}

export interface NewProductFormProps {
  mode?: 'page' | 'modal';
  modalTitle?: string;
  submitLabel?: string;
  initialName?: string;
  initialBarcode?: string;
  onCancel?: () => void;
  onSuccess?: (product: Product) => void;
}

export function NewProductForm({
  mode = 'page',
  modalTitle,
  submitLabel,
  initialName = '',
  initialBarcode = '',
  onCancel,
  onSuccess,
}: NewProductFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settingsQuery = useSettingsQuery();
  const categoriesQuery = useCategoriesQuery();
  const suppliersQuery = useSuppliersQuery();
  const productsQuery = useProductsQuery();
  const locationsQuery = useLocationsQuery();

  const defaultMinStock = Number(settingsQuery.data?.lowStockThreshold ?? 5);
  const allProducts = productsQuery.data || [];

  const rawCategories = categoriesQuery.data || [];
  const rawSuppliers = suppliersQuery.data || [];
  const rawLocations = locationsQuery.data || [];

  // Sort alphabetically
  const categories = useMemo(
    () => [...rawCategories].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar')),
    [rawCategories]
  );
  const suppliers = useMemo(
    () => [...rawSuppliers].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar')),
    [rawSuppliers]
  );

  const categoryOptions = useMemo(() => categories.map((c) => ({ id: String(c.id), label: c.name })), [categories]);
  const supplierOptions = useMemo(() => suppliers.map((s) => ({ id: String(s.id), label: s.name })), [suppliers]);
  const locationOptions = useMemo(() => rawLocations.map((l: any) => ({ id: String(l.id), label: l.name })), [rawLocations]);

  const clothingModuleEnabled = settingsQuery.data?.clothingModuleEnabled === true;
  const manufacturingModuleEnabled = settingsQuery.data?.manufacturingModuleEnabled === true;
  const autoPartsModuleEnabled = settingsQuery.data?.autoPartsModuleEnabled === true || settingsQuery.data?.activityType === 'auto_parts' || settingsQuery.data?.businessIndustry === 'auto_parts';
  const comboModuleEnabled = settingsQuery.data?.comboModuleEnabled === true || manufacturingModuleEnabled;
  const isFoodOrRestaurant = settingsQuery.data?.restaurantModuleEnabled === true ||
    ['restaurant', 'cafe', 'مطعم', 'كافيه'].includes(String(settingsQuery.data?.activityType || '').toLowerCase()) ||
    ['restaurant', 'cafe', 'مطعم', 'كافيه'].includes(String(settingsQuery.data?.businessIndustry || '').toLowerCase());
  const isPerfumes =
    ['perfumes', 'cosmetics', 'عطور', 'تجميل'].includes(String(settingsQuery.data?.activityType || '').toLowerCase()) ||
    ['perfumes', 'cosmetics', 'عطور', 'تجميل'].includes(String(settingsQuery.data?.businessIndustry || '').toLowerCase());

  const comboCardTitle = isFoodOrRestaurant
    ? t('products.combo_card.title_food', 'العروض المجمعة والوجبات (Combo)')
    : isPerfumes
    ? t('products.combo_card.title_perfumes', 'تركيبات العطور ومجموعات الهدايا (BOM & Sets)')
    : t('products.combo_card.title_retail', 'الأطقم والعروض المجمعة (Bundles / Combo)');

  const comboCheckboxLabel = isFoodOrRestaurant
    ? t('products.combo_card.label_food', 'هذا الصنف عبارة عن عرض مجمع / وجبة')
    : isPerfumes
    ? t('products.combo_card.label_perfumes', 'هذا الصنف عبارة عن تركيبة عطر / طقم هدايا (BOM / Set)')
    : t('products.combo_card.label_retail', 'هذا الصنف عبارة عن طقم / باقة مجمعة (Bundle)');

  const comboSubtitle = isFoodOrRestaurant
    ? t('products.combo_card.desc_food', 'تحديد مكونات الوجبة أو العرض ليتم استقطاعها من المخزون عند الطلب.')
    : isPerfumes
    ? t('products.combo_card.desc_perfumes', 'تحديد مكونات العطر (مثل: زيت خام + كحول + زجاجة) أو طقم الهدايا ليتم خصمها من المخزون تلقائياً عند بيع هذا الصنف.')
    : t('products.combo_card.desc_retail', 'تحديد مكونات الطقم أو الباقة (مثل: قميص + بنطلون + حذاء) ليتم خصمها من المخزون تلقائياً عند بيع هذا الطقم.');

  const comboVariantNotice = isPerfumes
    ? t('products.new_product_form.combo_perfumes_notice', 'تركيبات العطور ومجموعات الهدايا تُنشأ كـ "صنف عادي" من زر التبديل بالأعلى؛ لأن الموديل المتغير مخصص لتوليد روائح وأحجام وسعات لنفس الصنف.')
    : t('products.new_product_form.combo_variant_notice', 'الأطقم والعروض المجمعة (مثل: قميص + بنطلون + حذاء) تُنشأ كـ "صنف عادي" من زر التبديل بالأعلى؛ لأن الموديل المتغير مخصص لتوليد مقاسات وألوان لصنف واحد.');

  const defaultItemKind: 'standard' | 'fashion' = clothingModuleEnabled && settingsQuery.data?.defaultProductKind === 'fashion' ? 'fashion' : 'standard';
  const defaultGroupedMode = defaultItemKind === 'fashion';

  const [units, setUnits] = useState<ProductUnit[]>(normalizeProductUnits(undefined, initialBarcode.trim()));
  const [fashionVariantRows, setFashionVariantRows] = useState<FashionVariantDraft[]>([]);
  const [variantBarcodePrefix, setVariantBarcodePrefix] = useState('');
  const [groupedEntryEnabled, setGroupedEntryEnabled] = useState(defaultGroupedMode);
  const [isGeneratingStyleCode, setIsGeneratingStyleCode] = useState(false);
  const [isMarginActive, setIsMarginActive] = useState(() => localStorage.getItem('auto_margin_active') === 'true');
  const [retailMargin, setRetailMargin] = useState(() => localStorage.getItem('auto_margin_retail') || '');
  const [wholesaleMargin, setWholesaleMargin] = useState(() => localStorage.getItem('auto_margin_wholesale') || '');

  useEffect(() => {
    localStorage.setItem('auto_margin_active', String(isMarginActive));
    localStorage.setItem('auto_margin_retail', retailMargin);
    localStorage.setItem('auto_margin_wholesale', wholesaleMargin);
  }, [isMarginActive, retailMargin, wholesaleMargin]);

  const form = useForm<ProductFormInput, undefined, ProductFormOutput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: getDefaultValues(defaultItemKind, defaultMinStock, initialName, initialBarcode)
  });

  // Update form if initial props change
  useEffect(() => {
    if (initialName && !form.formState.isDirty) {
      form.setValue('name', initialName);
    }
    if (initialBarcode && !form.formState.isDirty) {
      form.setValue('barcode', initialBarcode);
      setUnits(normalizeProductUnits(undefined, initialBarcode.trim()));
    }
  }, [initialName, initialBarcode, form]);

  // Update minStock when settings load (only if user hasn't touched it)
  useEffect(() => {
    if (settingsQuery.data?.lowStockThreshold !== undefined && !form.formState.isDirty) {
      form.setValue('minStock', Number(settingsQuery.data.lowStockThreshold));
    }
  }, [settingsQuery.data?.lowStockThreshold, form]);

  const queryClient = useQueryClient();
  const mutation = useCreateProductMutation(async (productId, name) => {
    if (mode === 'modal' && onSuccess && productId) {
      try {
        const fullProduct = await productsApi.get(productId);
        onSuccess(fullProduct);
      } catch {
        onSuccess({
          id: productId,
          name,
          retailPrice: Number(form.getValues('retailPrice') || 0),
          barcode: form.getValues('barcode') || '',
          units,
        } as any);
      }
    } else {
      navigate('/products');
    }
  });

  useWatch({ control: form.control });
  const watchedBarcode = form.watch('barcode');
  const watchedItemKind = clothingModuleEnabled && form.watch('itemKind') === 'fashion' ? 'fashion' : 'standard';
  const watchedName = form.watch('name');
  const watchedStyleCode = form.watch('styleCode');
  const watchedFashionColors = form.watch('fashionColors');
  const watchedFashionSizes = form.watch('fashionSizes');
  const watchedVariantStock = Number(form.watch('variantStock') || 0);
  const watchedCategoryId = useWatch({ control: form.control, name: 'categoryId' });
  const watchedSupplierId = useWatch({ control: form.control, name: 'supplierId' });
  const watchedWarehouseId = useWatch({ control: form.control, name: 'warehouseId' });
  const watchedIsCombo = useWatch({ control: form.control, name: 'isCombo' });
  const watchedCostPrice = form.watch('costPrice');
  const watchedRetailPrice = form.watch('retailPrice');
  const watchedWholesalePrice = form.watch('wholesalePrice');
  const usesVariantBuilder = watchedItemKind === 'fashion' || groupedEntryEnabled;
  const showExpiryDate = shouldShowExpiryDateField({
    settings: settingsQuery.data,
    clothingModuleEnabled,
    itemKind: watchedItemKind,
  });

  const colorTokens = useMemo(() => splitFashionTokens(watchedFashionColors), [watchedFashionColors]);
  const sizeTokens = useMemo(() => splitFashionTokens(watchedFashionSizes), [watchedFashionSizes]);

  useEffect(() => {
    if (watchedItemKind === 'fashion' && !groupedEntryEnabled) setGroupedEntryEnabled(true);
  }, [watchedItemKind, groupedEntryEnabled]);

  useEffect(() => {
    if (!usesVariantBuilder) {
      if (fashionVariantRows.length) setFashionVariantRows([]);
      if (variantBarcodePrefix) setVariantBarcodePrefix('');
      return;
    }
    setFashionVariantRows((current) => buildFashionVariantDrafts(colorTokens, sizeTokens, current, watchedVariantStock));
  }, [usesVariantBuilder, colorTokens, sizeTokens, watchedVariantStock]);

  useEffect(() => {
    if (isMarginActive && watchedCostPrice !== undefined) {
      const cost = Number(watchedCostPrice) || 0;
      if (retailMargin) {
        const rMargin = Number(retailMargin);
        const newRetail = cost + (cost * rMargin / 100);
        form.setValue('retailPrice', Number(newRetail.toFixed(2)), { shouldValidate: true, shouldDirty: true });
      }
      if (wholesaleMargin) {
        const wMargin = Number(wholesaleMargin);
        const newWholesale = cost + (cost * wMargin / 100);
        form.setValue('wholesalePrice', Number(newWholesale.toFixed(2)), { shouldValidate: true, shouldDirty: true });
      }
    }
  }, [watchedCostPrice, isMarginActive, retailMargin, wholesaleMargin, form]);

  const duplicateFashionBarcodes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of fashionVariantRows) {
      const barcode = String(row.barcode || '').trim().toLowerCase();
      if (!barcode) continue;
      counts.set(barcode, Number(counts.get(barcode) || 0) + 1);
    }
    return Array.from(counts.values()).filter((count) => count > 1).length;
  }, [fashionVariantRows]);

  // Set default warehouse when locations load (only if exactly 1 location exists)
  useEffect(() => {
    if (rawLocations.length === 1 && !watchedWarehouseId) {
      form.setValue('warehouseId', String(rawLocations[0].id));
    }
  }, [rawLocations, watchedWarehouseId, form]);

  // Fast Category Creation Mutation
  const categoryMutation = useMutation({
    mutationFn: (name: string) => productsApi.createCategory({ name }),
    onSuccess: async (_, name) => {
      await invalidateCatalogDomain(queryClient, { includeCategories: true });
      const nextId = findCreatedCategoryId(await productsApi.categories(), name);
      if (nextId) {
        form.setValue('categoryId', nextId, { shouldDirty: true, shouldValidate: true });
      }
    }
  });

  // Fast Supplier Creation Mutation
  const supplierMutation = useMutation({
    mutationFn: (name: string) => productsApi.createSupplier({ name }),
    onSuccess: async (createdSupplier, name) => {
      await invalidateCatalogDomain(queryClient, { includeSuppliers: true });
      let nextId = typeof createdSupplier === 'object' && createdSupplier !== null && 'id' in createdSupplier
        ? String((createdSupplier as any).id)
        : '';
      if (!nextId) {
        nextId = findCreatedSupplierId(await productsApi.suppliers(), name, '');
      }
      if (nextId) {
        form.setValue('supplierId', nextId, { shouldDirty: true, shouldValidate: true });
      }
    }
  });

  function handleUnitsChange(nextUnits: ProductUnit[]) {
    const baseBarcode = (watchedBarcode || '').trim();
    const mapped = nextUnits.map((unit, index) => ({ ...unit, barcode: unit.barcode || (index === 0 ? baseBarcode : unit.barcode) }));
    setUnits(mapped);
  }

  async function handleGenerateStyleCode() {
    if (isGeneratingStyleCode) return;
    setIsGeneratingStyleCode(true);
    try {
      const nextCode = await generateNextStyleCode();
      form.setValue('styleCode', nextCode, { shouldDirty: true, shouldValidate: true });
    } finally {
      setIsGeneratingStyleCode(false);
    }
  }

  const builderMode = watchedItemKind === 'fashion' ? 'fashion' : 'standard';
  const submitText = submitLabel
    ? submitLabel
    : (usesVariantBuilder
      ? (mode === 'modal' ? 'حفظ الصنف والمتغيرات وإضافة للسلة' : 'حفظ الصنف بجميع المتغيرات')
      : (mode === 'modal' ? 'حفظ وإضافة للسلة' : 'حفظ الصنف'));

  const onSubmit = form.handleSubmit((values) => {
    const invalidMultiplierUnit = units.find((u) => !u.isBaseUnit && Number(u.multiplier || 0) <= 1);
    if (invalidMultiplierUnit) {
      toast.error(`مضاعف الوحدة "${invalidMultiplierUnit.name || 'الإضافية'}" يجب أن يكون أكبر من 1 مقارنة بالوحدة الأساسية`);
      return;
    }
    const { name, nameEn } = resolveProductSubmitNames(values);
    mutation.mutate({
      ...values,
      name,
      nameEn,
      itemKind: watchedItemKind,
      units,
      fashionVariantRows,
      groupedEntryEnabled: usesVariantBuilder,
    });
  });

  const isFormDisabled = mutation.isPending || settingsQuery.isLoading || categoriesQuery.isLoading || suppliersQuery.isLoading || locationsQuery.isLoading;

  useAppToolbar(
    mode === 'page'
      ? [
          { label: 'الرئيسية', to: '/' },
          { label: 'الأصناف', to: '/products' },
          { label: 'إضافة صنف جديد' }
        ]
      : []
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const canSubmit = !isFormDisabled && (!usesVariantBuilder || (fashionVariantRows.length > 0 && duplicateFashionBarcodes === 0 && String(watchedStyleCode || '').trim()));
        if (canSubmit) {
          onSubmit();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFormDisabled, usesVariantBuilder, fashionVariantRows.length, duplicateFashionBarcodes, watchedStyleCode, onSubmit]);

  function handleCancelAction() {
    if (onCancel) {
      onCancel();
    } else {
      navigate('/products');
    }
  }

  return (
    <div className={`new-product-form-root ${mode === 'modal' ? 'new-product-form-root--modal' : 'page-shell document-prototype-shell purchase-new-prototype'}`}>
      <div className={mode === 'modal' ? 'modal-sticky-header' : 'purchase-prototype-sticky-stack'}>
        <div className={mode === 'modal' ? 'modal-header-surface' : 'purchase-prototype-document-surface'}>
          <div className="document-prototype-topbar">
            <div className="document-prototype-topbar-right">
              {mode === 'page' ? (
                <button type="button" className="document-prototype-back-link" onClick={handleCancelAction} aria-label={t('products.new_product_form.s0', "الرجوع")} title={t('products.new_product_form.s1', "الرجوع")}>
                  <ArrowRightIcon size={20} strokeWidth={2.8} />
                </button>
              ) : null}
              <h1 style={{ fontSize: mode === 'modal' ? '1.25rem' : '1.5rem', margin: 0 }}>
                {modalTitle || (mode === 'modal' ? t('products.new_product_form.s2', "إضافة صنف جديد سريعاً إلى السلة") : t('products.new_product_form.s3', "إضافة صنف جديد"))}
              </h1>
            </div>

            <div className="document-prototype-topbar-actions">
              <Button variant="secondary" onClick={handleCancelAction} disabled={isFormDisabled}>
                {t('products.new_product_form.s4', "إلغاء")}
              </Button>
              <Button
                variant="primary"
                onClick={onSubmit}
                disabled={isFormDisabled || (usesVariantBuilder && (!fashionVariantRows.length || duplicateFashionBarcodes > 0 || !String(watchedStyleCode || '').trim()))}
              >
                {mutation.isPending ? t('products.new_product_form.s5', "جارٍ الحفظ...") : submitText}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <main className="product-form-container" style={{ padding: mode === 'modal' ? '14px 16px 24px' : undefined }}>
        {mutation.isError && (
          <div className="document-prototype-alert error" style={{ marginBottom: '12px' }}>
            <div style={{ color: '#b91c1c' }}>
              {getFriendlyApiErrorMessage(mutation.error, t('products.new_product_form.s6', "تعذر حفظ الصنف. برجاء التحقق من البيانات والمحاولة مرة أخرى."))}
            </div>
          </div>
        )}

        {usesVariantBuilder && duplicateFashionBarcodes > 0 && (
          <div className="document-prototype-section" style={{ backgroundColor: '#fee2e2', borderColor: '#ef4444', marginBottom: '12px' }}>
            <div style={{ color: '#b91c1c' }}>{t('products.new_product_form.s8', "يوجد باركودات مكررة داخل نفس المجموعة. صححها قبل الحفظ.")}</div>
          </div>
        )}

        {/* 1. Core Info & Pricing */}
        <div className="product-compact-card">
          <div className="product-compact-card-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <h3 className="product-compact-card-title">{t('products.new_product_form.s9', "بيانات الصنف والأسعار")}</h3>
              {clothingModuleEnabled && (
                <div style={{
                  display: 'flex',
                  gap: '2px',
                  background: '#f1f5f9',
                  padding: '2px',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                  boxSizing: 'border-box',
                }}>
                  <button
                    type="button"
                    onClick={() => {
                      form.setValue('itemKind', 'standard', { shouldDirty: true });
                      setGroupedEntryEnabled(false);
                    }}
                    disabled={isFormDisabled}
                    style={{
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 10px',
                      fontSize: '0.72rem',
                      fontWeight: !usesVariantBuilder ? 800 : 600,
                      background: !usesVariantBuilder ? 'var(--primary, #1e1b4b)' : 'transparent',
                      color: !usesVariantBuilder ? '#ffffff' : '#64748b',
                      cursor: 'pointer',
                      boxShadow: !usesVariantBuilder ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('products.new_product_form.s10', "صنف عادي")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      form.setValue('itemKind', 'fashion', { shouldDirty: true });
                      setGroupedEntryEnabled(true);
                    }}
                    disabled={isFormDisabled}
                    style={{
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 10px',
                      fontSize: '0.72rem',
                      fontWeight: usesVariantBuilder ? 800 : 600,
                      background: usesVariantBuilder ? 'var(--primary, #1e1b4b)' : 'transparent',
                      color: usesVariantBuilder ? '#ffffff' : '#64748b',
                      cursor: 'pointer',
                      boxShadow: usesVariantBuilder ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('products.new_product_form.s11', "صنف بمتغيرات")}
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#4b5563', fontWeight: 600 }}>{t('products.new_product_form.s12', "حساب تلقائي للأسعار")}</span>
              <button
                type="button"
                onClick={() => setIsMarginActive(!isMarginActive)}
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  width: '38px',
                  height: '20px',
                  background: isMarginActive ? '#10b981' : '#e5e7eb',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  padding: 0
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: '14px',
                    height: '14px',
                    background: '#fff',
                    borderRadius: '50%',
                    transition: 'transform 0.2s',
                    transform: isMarginActive ? 'translateX(-20px)' : 'translateX(-3px)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                  }}
                />
              </button>
            </div>
          </div>

          {/* Row 1: Product Names (Arabic & English side-by-side) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)', gap: '12px', marginBottom: '0.85rem' }}>
            <ProductNameField
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span>{usesVariantBuilder ? t('products.new_product_form.s13', "اسم الصنف الأساسي (بالعربية)") : t('products.new_product_form.s14', "اسم الصنف (بالعربية)")}</span>
                  <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 500 }}>{t('products.new_product_form.either_name', "(يكفي إدخال أحدهما)")}</span>
                </span>
              }
              value={watchedName || ''}
              onChange={(v) => {
                form.setValue('name', v, { shouldDirty: true, shouldValidate: true });
                const guessed = guessProductIcon(v, undefined, settingsQuery.data?.businessIndustry);
                if (guessed) {
                  form.setValue('icon', guessed, { shouldDirty: true });
                }
              }}
              allProducts={allProducts}
              disabled={isFormDisabled}
              placeholder={usesVariantBuilder ? t('products.new_product_form.s15', "مثال: مزيل عرق نيفيا / تيشيرت بولو") : t('products.new_product_form.s16', "اكتب اسم الصنف بالعربية")}
              error={form.formState.errors.name?.message}
              iconPicker={
                <ProductIconPicker
                  value={form.watch('icon')}
                  onChange={(iconId) => form.setValue('icon', iconId, { shouldDirty: true })}
                  industry={settingsQuery.data?.businessIndustry}
                  disabled={isFormDisabled}
                />
              }
            />

            <div className="field">
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('products.new_product_form.s17', "اسم الصنف بالإنجليزي (Item Name)")}</span>
                <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 500 }}>{t('products.new_product_form.s18_smart', "للفواتير أو كاسم أساسي")}</span>
              </label>
              <input
                className="purchase-prototype-field-input"
                style={{ width: '100%', direction: 'ltr', textAlign: 'left' }}
                {...form.register('nameEn')}
                onChange={(e) => {
                  form.setValue('nameEn', e.target.value, { shouldDirty: true, shouldValidate: true });
                  if (!form.getValues('name')?.trim()) {
                    const guessed = guessProductIcon(e.target.value, undefined, settingsQuery.data?.businessIndustry);
                    if (guessed) {
                      form.setValue('icon', guessed, { shouldDirty: true });
                    }
                  }
                }}
                disabled={isFormDisabled}
                placeholder="e.g. Almarai Milk 1L / Nivea Deo"
              />
            </div>
          </div>

          {/* Product Image Uploader (Shared across POS & Storefront) */}
          <div style={{ marginBottom: '0.85rem' }}>
            <Controller
              control={form.control}
              name="imageUrl"
              render={({ field }) => (
                <ProductImageUploadField
                  value={field.value || ''}
                  onChange={(url) => field.onChange(url)}
                  disabled={isFormDisabled}
                />
              )}
            />
          </div>

          {/* Row 2: Item Type & Barcode/Model */}
          <div className="product-form-grid-2" style={{ marginBottom: '0.85rem' }}>
            <Field label={t('products.new_product_form.s19', "نوع الصنف")}>
              <select className="purchase-prototype-field-input" {...form.register('itemType')} disabled={isFormDisabled}>
                <option value="product">{t('products.new_product_form.s20', "منتج تام للبيع (مخزني)")}</option>
                <option value="service">{t('products.new_product_form.s21', "خدمة / مصنعية (بدون مخزون)")}</option>
                {manufacturingModuleEnabled ? (
                  <option value="raw_material">{t('products.new_product_form.s22', "مادة خام / مكون تصنيع")}</option>
                ) : null}
              </select>
            </Field>

            {usesVariantBuilder ? (
              <div className="field">
                <label>{t('products.new_product_form.s23', "كود الصنف الأساسي / الموديل")}</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input className="purchase-prototype-field-input" {...form.register('styleCode', { onChange: (event) => { const cleaned = String(event.target.value || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D+/g, ''); if (event.target.value !== cleaned) form.setValue('styleCode', cleaned, { shouldDirty: true, shouldValidate: true }); } })} disabled={isFormDisabled || isGeneratingStyleCode} inputMode="numeric" placeholder="1001" style={{ flex: 1 }} />
                  <Button type="button" variant="secondary" onClick={() => void handleGenerateStyleCode()} disabled={isFormDisabled || isGeneratingStyleCode}>{isGeneratingStyleCode ? '...' : t('products.new_product_form.s24', "توليد كود")}</Button>
                </div>
              </div>
            ) : (
              <Field label={t('products.new_product_form.s25', "الباركود")}>
                <input className="purchase-prototype-field-input" {...form.register('barcode')} disabled={isFormDisabled} placeholder={t('products.new_product_form.s26', "اختياري أو امسحه بالماسح")} />
              </Field>
            )}
          </div>

          {isMarginActive && (
            <div className="product-form-grid-2" style={{ marginBottom: '0.85rem', padding: '0.75rem 1rem', backgroundColor: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
              <Field label={t('products.new_product_form.s27', "هامش ربح القطاعي (%)")}>
                <input className="purchase-prototype-field-input" type="number" step="0.01" value={retailMargin} onChange={(e) => setRetailMargin(e.target.value)} placeholder={t('products.new_product_form.s28', "مثال: 20")} disabled={isFormDisabled} />
              </Field>
              <Field label={t('products.new_product_form.s29', "هامش ربح الجملة (%)")}>
                <input className="purchase-prototype-field-input" type="number" step="0.01" value={wholesaleMargin} onChange={(e) => setWholesaleMargin(e.target.value)} placeholder={t('products.new_product_form.s30', "مثال: 10")} disabled={isFormDisabled} />
              </Field>
            </div>
          )}

          <div style={{ paddingTop: '0.65rem', borderTop: '1px solid #f1f5f9' }}>
            <div className="product-form-grid-3">
              <div className="field">
                <label>{t('products.new_product_form.s31', "سعر الشراء (التكلفة)")}</label>
                <input className="purchase-prototype-field-input" type="number" step="0.01" {...form.register('costPrice')} disabled={isFormDisabled} />
              </div>
              <div className="field product-retail-price-field">
                <label style={{ color: '#1e3a8a', fontWeight: 700 }}>{t('products.new_product_form.s32', "سعر البيع (قطاعي)")}</label>
                <input className="purchase-prototype-field-input" type="number" step="0.01" {...form.register('retailPrice')} disabled={isFormDisabled} />
              </div>
              <Field label={t('products.new_product_form.s33', "سعر الجملة")}>
                <input className="purchase-prototype-field-input" type="number" step="0.01" {...form.register('wholesalePrice')} disabled={isFormDisabled} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.65rem' }}>
              <Field label={t('products.new_product_form.s34', "سعر البيع الآجل (التوزيع والجملة)")}>
                <input className="purchase-prototype-field-input" type="number" step="0.01" {...form.register('creditPrice')} disabled={isFormDisabled} placeholder={t('products.new_product_form.s35', "اختياري - افتراضياً نفس الكاش")} />
              </Field>
              <Field label={t('products.new_product_form.s36', "سعر المستهلك / الجمهور (SRP)")}>
                <input className="purchase-prototype-field-input" type="number" step="0.01" {...form.register('consumerPrice')} disabled={isFormDisabled} placeholder={t('products.new_product_form.s37', "سعر بيع المحل للجمهور لطباعته بالفاتورة")} />
              </Field>
            </div>
          </div>
        </div>

        {/* 2. Categorization & Inventory Location */}
        <div className="product-compact-card">
          <div className="product-compact-card-header">
            <h3 className="product-compact-card-title">{t('products.new_product_form.s38', "التصنيف والتخزين والمخزون")}</h3>
          </div>
          {usesVariantBuilder ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
              <div className="field">
                <label>{t('products.new_product_form.s39', "القسم")}</label>
                <ComboboxSelect
                  value={watchedCategoryId || ''}
                  onChange={(v) => form.setValue('categoryId', v, { shouldDirty: true })}
                  options={categoryOptions}
                  emptyLabel={t('products.new_product_form.s40', "بدون قسم")}
                  placeholder={t('products.new_product_form.s41', "ابحث...")}
                  disabled={isFormDisabled || categoryMutation.isPending}
                  onCreateNew={(name) => categoryMutation.mutate(name)}
                  createLabel={t('products.new_product_form.s42', "إضافة قسم")}
                  isPending={categoryMutation.isPending}
                />
                {form.formState.errors.categoryId && <small className="field-error">{form.formState.errors.categoryId.message}</small>}
              </div>

              <div className="field">
                <label>{t('products.new_product_form.s43', "المورد")}</label>
                <ComboboxSelect
                  value={watchedSupplierId || ''}
                  onChange={(v) => form.setValue('supplierId', v, { shouldDirty: true })}
                  options={supplierOptions}
                  emptyLabel={t('products.new_product_form.s44', "بدون مورد")}
                  placeholder={t('products.new_product_form.s45', "ابحث...")}
                  disabled={isFormDisabled || supplierMutation.isPending}
                  onCreateNew={(name) => supplierMutation.mutate(name)}
                  createLabel={t('products.new_product_form.s46', "إضافة مورد")}
                  isPending={supplierMutation.isPending}
                />
                {form.formState.errors.supplierId && <small className="field-error">{form.formState.errors.supplierId.message}</small>}
              </div>

              <div className="field">
                <label>{t('products.new_product_form.s61', "المخزن")}</label>
                <ComboboxSelect
                  value={watchedWarehouseId || ''}
                  onChange={(v) => form.setValue('warehouseId', v, { shouldDirty: true, shouldValidate: true })}
                  options={locationOptions}
                  emptyLabel={locationOptions.length === 1 ? '' : t('products.new_product_form.s62', "اختر المخزن...")}
                  placeholder={t('products.new_product_form.s63', "ابحث...")}
                  disabled={isFormDisabled || locationOptions.length === 1}
                />
                {form.formState.errors.warehouseId && <small className="field-error">{form.formState.errors.warehouseId.message}</small>}
              </div>

              <Field label={t('products.new_product_form.s47', "مكان الرف (Bin)")}>
                <input className="purchase-prototype-field-input" {...form.register('binLocation')} disabled={isFormDisabled} placeholder={t('products.new_product_form.s48', "مثال: رف 5")} />
              </Field>

              <Field label={t('products.new_product_form.s49', "الحد الأدنى للتنبيه (نواقص)")}>
                <input className="purchase-prototype-field-input" type="number" {...form.register('minStock')} disabled={isFormDisabled} />
              </Field>

              {showExpiryDate && (
                <Field label={t('products.new_product_form.s50', "تاريخ الصلاحية")}>
                <input className="purchase-prototype-field-input" type="date" {...form.register('expiryDate')} disabled={isFormDisabled} />
                </Field>
              )}

              <Field label={t('products.new_product_form.s51', "ملاحظات")}>
                <input className="purchase-prototype-field-input" {...form.register('notes')} disabled={isFormDisabled} placeholder={t('products.new_product_form.s52', "ملاحظات الصنف...")} />
              </Field>
            </div>
          ) : (
            <>
              <div className="product-form-grid-4" style={{ marginBottom: '0.85rem' }}>
                <div className="field">
                  <label>{t('products.new_product_form.s53', "القسم")}</label>
                  <ComboboxSelect
                    value={watchedCategoryId || ''}
                    onChange={(v) => form.setValue('categoryId', v, { shouldDirty: true })}
                    options={categoryOptions}
                    emptyLabel={t('products.new_product_form.s54', "بدون قسم")}
                    placeholder={t('products.new_product_form.s55', "ابحث...")}
                    disabled={isFormDisabled || categoryMutation.isPending}
                    onCreateNew={(name) => categoryMutation.mutate(name)}
                    createLabel={t('products.new_product_form.s56', "إضافة قسم")}
                    isPending={categoryMutation.isPending}
                  />
                  {form.formState.errors.categoryId && <small className="field-error">{form.formState.errors.categoryId.message}</small>}
                </div>

                <div className="field">
                  <label>{t('products.new_product_form.s57', "المورد")}</label>
                  <ComboboxSelect
                    value={watchedSupplierId || ''}
                    onChange={(v) => form.setValue('supplierId', v, { shouldDirty: true })}
                    options={supplierOptions}
                    emptyLabel={t('products.new_product_form.s58', "بدون مورد")}
                    placeholder={t('products.new_product_form.s59', "ابحث...")}
                    disabled={isFormDisabled || supplierMutation.isPending}
                    onCreateNew={(name) => supplierMutation.mutate(name)}
                    createLabel={t('products.new_product_form.s60', "إضافة مورد")}
                    isPending={supplierMutation.isPending}
                  />
                  {form.formState.errors.supplierId && <small className="field-error">{form.formState.errors.supplierId.message}</small>}
                </div>

                <div className="field">
                  <label>{t('products.new_product_form.s61', "المخزن")}</label>
                  <ComboboxSelect
                    value={watchedWarehouseId || ''}
                    onChange={(v) => form.setValue('warehouseId', v, { shouldDirty: true, shouldValidate: true })}
                    options={locationOptions}
                    emptyLabel={locationOptions.length === 1 ? '' : t('products.new_product_form.s62', "اختر المخزن...")}
                    placeholder={t('products.new_product_form.s63', "ابحث...")}
                    disabled={isFormDisabled || locationOptions.length === 1}
                  />
                  {form.formState.errors.warehouseId && <small className="field-error">{form.formState.errors.warehouseId.message}</small>}
                </div>

                <Field label={t('products.new_product_form.s64', "مكان الرف (Bin)")}>
                  <input className="purchase-prototype-field-input" {...form.register('binLocation')} disabled={isFormDisabled} placeholder={t('products.new_product_form.s65', "مثال: رف 5")} />
                </Field>
              </div>

              <div style={{ paddingTop: '0.65rem', borderTop: '1px solid #f1f5f9' }}>
                <div className="product-form-grid-4">
                  <Field label={t('products.new_product_form.s66', "الرصيد الافتتاحي (أول المدة)")}>
                    <input className="purchase-prototype-field-input" type="number" {...form.register('stock')} disabled={isFormDisabled} />
                  </Field>
                  <Field label={t('products.new_product_form.s67', "الحد الأدنى للتنبيه (نواقص)")}>
                    <input className="purchase-prototype-field-input" type="number" {...form.register('minStock')} disabled={isFormDisabled} />
                  </Field>
                  {showExpiryDate && (
                    <Field label={t('products.new_product_form.s68', "تاريخ الصلاحية")}>
                    <input className="purchase-prototype-field-input" type="date" {...form.register('expiryDate')} disabled={isFormDisabled} />
                    </Field>
                  )}
                  <Field label={t('products.new_product_form.s69', "ملاحظات")}>
                    <input className="purchase-prototype-field-input" {...form.register('notes')} disabled={isFormDisabled} placeholder={t('products.new_product_form.s70', "ملاحظات حول الصنف (اختياري)...")} />
                  </Field>
                </div>
              </div>
            </>
          )}

          {settingsQuery.data?.enableMobileStoreFeatures === true && (
            <div style={{ marginTop: '0.85rem', paddingTop: '0.65rem', borderTop: '1px solid #f1f5f9' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: '#166534' }}>
                <input type="checkbox" {...form.register('trackSerials')} disabled={isFormDisabled} style={{ width: 18, height: 18 }} />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <SmartphoneIcon size={16} color="#166534" /> {t('products.new_product_form.s71', "تتبع أرقام IMEI / السيريال المنفرد لهذا الصنف (للهواتف والأجهزة الإلكترونية)")}
                </span>
              </label>
            </div>
          )}
        </div>

        {/* SFDA Food & Beverage Nutrition / Allergens Card */}
        {(settingsQuery.data?.restaurantModuleEnabled === true || settingsQuery.data?.businessIndustry === 'restaurant' || settingsQuery.data?.businessIndustry === 'cafe') && (
          <div className="product-compact-card">
            <div className="product-compact-card-header">
              <h3 className="product-compact-card-title">{t('products.new_product_form.s72', "بيانات القيمة الغذائية ومسببات الحساسية (SFDA Compliance)")}</h3>
            </div>
            <div className="product-form-grid-3" style={{ marginBottom: '0.85rem' }}>
              <Field label={t('products.new_product_form.s73', "السعرات الحرارية (Calories / Kcal)")}>
                <input
                  className="purchase-prototype-field-input"
                  type="number"
                  placeholder={t('products.new_product_form.s74', "مثال: 450")}
                  {...form.register('calories', { valueAsNumber: true })}
                  disabled={isFormDisabled}
                />
              </Field>
              <Field label={t('products.new_product_form.s75', "مسببات الحساسية (مفصولة بفواصل)")}>
                <input
                  className="purchase-prototype-field-input"
                  type="text"
                  placeholder={t('products.new_product_form.s76', "مثال: جلوتين، ألبان، مكسرات، بيض")}
                  value={Array.isArray(form.watch('allergens')) ? (form.watch('allergens') as string[]).join(t('products.new_product_form.s77', "، ")) : ''}
                  onChange={(e) => {
                    const val = e.target.value.split(/[،,]/).map((s) => s.trim()).filter(Boolean);
                    form.setValue('allergens', val, { shouldDirty: true });
                  }}
                  disabled={isFormDisabled}
                />
              </Field>
              <Field label={t('products.new_product_form.s78', "الخصائص الغذائية")}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', height: '36px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                    <input type="checkbox" {...form.register('isSpicy')} disabled={isFormDisabled} />
                    <span>{t('products.new_product_form.s79', "حار (Spicy)")}</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                    <input type="checkbox" {...form.register('isVegetarian')} disabled={isFormDisabled} />
                    <span>{t('products.new_product_form.s80', "نباتي (Veg)")}</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                    <input type="checkbox" {...form.register('isGlutenFree')} disabled={isFormDisabled} />
                    <span>{t('products.new_product_form.s81', "خالٍ من الجلوتين")}</span>
                  </label>
                </div>
              </Field>
            </div>
          </div>
        )}

        {/* 3. Units or Fashion Variants */}
        {usesVariantBuilder ? (
          <div style={{ marginTop: '0.5rem' }}>
            <Suspense fallback={<div className="loading-card">{t('products.new_product_form.s82', "جاري تجهيز أدوات الأصناف الفرعية...")}</div>}>
              <LazyFashionVariantsBuilder
                mode={builderMode}
                initialTemplate={isPerfumes ? 'scents' : undefined}
                name={watchedName || ''}
                styleCode={watchedStyleCode || ''}
                colorsValue={watchedFashionColors || ''}
                sizesValue={watchedFashionSizes || ''}
                defaultStock={watchedVariantStock}
                barcodePrefix={variantBarcodePrefix}
                parentCostPrice={Number(watchedCostPrice || 0)}
                parentRetailPrice={Number(watchedRetailPrice || 0)}
                parentWholesalePrice={Number(watchedWholesalePrice || 0)}
                rows={fashionVariantRows}
                disabled={isFormDisabled}
                onColorsChange={(value) => form.setValue('fashionColors', value, { shouldDirty: true, shouldValidate: true })}
                onSizesChange={(value) => form.setValue('fashionSizes', value, { shouldDirty: true, shouldValidate: true })}
                onDefaultStockChange={(value) => form.setValue('variantStock', value, { shouldDirty: true, shouldValidate: true })}
                onBarcodePrefixChange={setVariantBarcodePrefix}
                onRowsChange={setFashionVariantRows}
              />
            </Suspense>
          </div>
        ) : (
          <div className="product-compact-card">
            <div className="product-compact-card-header">
              <h3 className="product-compact-card-title">{t('products.new_product_form.s83', "وحدات الصنف (Units)")}</h3>
            </div>
            <ProductUnitsEditor units={units} onChange={handleUnitsChange} disabled={isFormDisabled} />
          </div>
        )}

        {/* 4. Combo / BOM */}
        {comboModuleEnabled && (
          <div className="product-compact-card">
            <div className="product-compact-card-header" style={{ flexWrap: 'wrap', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h3 className="product-compact-card-title">{comboCardTitle}</h3>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{comboSubtitle}</span>
              </div>
            </div>
            {usesVariantBuilder ? (
              <div style={{
                padding: '12px 14px',
                background: '#f8fafc',
                border: '1px dashed #cbd5e1',
                borderRadius: '8px',
                fontSize: '0.82rem',
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <InfoIcon size={18} style={{ color: '#0284c7', flexShrink: 0 }} />
                <span>{comboVariantNotice}</span>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" {...form.register('isCombo')} disabled={isFormDisabled} style={{ width: 18, height: 18 }} />
                    {comboCheckboxLabel}
                  </label>
                </div>
                {watchedIsCombo && (
                  <Controller
                    control={form.control}
                    name="comboComponents"
                    render={({ field }) => (
                      <ComboComponentsEditor
                        value={field.value || []}
                        onChange={field.onChange}
                        products={allProducts}
                        disabled={isFormDisabled}
                      />
                    )}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* 5. Auto Parts */}
        {autoPartsModuleEnabled && (
          <div className="product-compact-card">
            <div className="product-compact-card-header">
              <h3 className="product-compact-card-title">{t('products.new_product_form.s86', "بيانات قطعة الغيار (Auto Parts)")}</h3>
            </div>
            <div className="product-form-grid-2">
              <Field label={t('products.new_product_form.s87', "رقم القطعة (OEM)")}><input className="purchase-prototype-field-input" {...form.register('metadata.oemNumber')} disabled={isFormDisabled} placeholder="1J0907530" /></Field>
              <Field label={t('products.new_product_form.s88', "الماركة")}><input className="purchase-prototype-field-input" {...form.register('metadata.carBrand')} disabled={isFormDisabled} placeholder="Toyota" /></Field>
              <Field label={t('products.new_product_form.s89', "الموديل")}><input className="purchase-prototype-field-input" {...form.register('metadata.carModel')} disabled={isFormDisabled} placeholder="Corolla" /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <Field label={t('products.new_product_form.s90', "من سنة")}><input className="purchase-prototype-field-input" type="number" {...form.register('metadata.carYearFrom')} disabled={isFormDisabled} placeholder="2015" /></Field>
                <Field label={t('products.new_product_form.s91', "إلى سنة")}><input className="purchase-prototype-field-input" type="number" {...form.register('metadata.carYearTo')} disabled={isFormDisabled} placeholder="2020" /></Field>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
