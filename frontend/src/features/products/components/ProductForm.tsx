import { useTranslation } from 'react-i18next';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Category, ProductUnit, Supplier, Location } from '@/types/domain';
import { Field } from '@/shared/ui/field';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { FormResetButton } from '@/shared/components/form-reset-button';
import { Button } from '@/shared/ui/button';
import { SmartphoneIcon } from '@/shared/components/icons/AppIcons';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { useMutationFeedbackReset } from '@/shared/hooks/use-mutation-feedback-reset';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { useCreateProductMutation } from '@/features/products/hooks/useCreateProductMutation';
import { productsApi } from '@/features/products/api/products.api';
import { productFormSchema, type ProductFormInput, type ProductFormOutput } from '@/features/products/schemas/product.schema';
import { ProductUnitsEditor, normalizeProductUnits } from '@/features/products/components/ProductUnitsEditor';
import { buildFashionVariantDrafts, splitFashionTokens, type FashionVariantDraft } from '@/features/products/components/fashion-variants.utils';
import { invalidateCatalogDomain } from '@/app/query-invalidation';
import { extractCreatedEntityId } from '@/lib/api/extract-created-entity-id';
import { ProductIconPicker } from '@/shared/components/icons/ProductIconPicker';
import { guessProductIcon } from '@/features/products/lib/product-smart-matcher';
import { shouldShowExpiryDateField } from '@/features/products/utils/product-visibility.utils';

interface ProductFormProps {
  categories: Category[];
  suppliers: Supplier[];
  locations: Location[];
  onCategoryCreated?: (categoryId: string) => void;
  onSupplierCreated?: (supplierId: string) => void;
  onSuccess?: (productId: string, name: string) => void;
  initialName?: string;
}

import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';

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

function getDefaultValues(itemKind: 'standard' | 'fashion' = 'standard'): ProductFormInput {
  return {
    name: '',
    barcode: '',
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
    minStock: 5,
    expiryDate: '',
    categoryId: '',
    supplierId: '',
    warehouseId: '',
    notes: '',
    trackSerials: false,
    taxCodeType: 'GS1',
    taxCode: '',
    metadata: {
      expiryDate: '',
      oemNumber: '',
      carBrand: '',
      carModel: '',
      carYearFrom: '',
      carYearTo: '',
      origin: '',
      condition: ''
    }
  };
}

function serializeVariantRows(rows: FashionVariantDraft[]) {
  return JSON.stringify(rows.map((row) => ({ color: row.color, size: row.size, barcode: row.barcode, stock: Number(row.stock || 0), imageUrl: row.imageUrl || '' })));
}

const LazyFashionVariantsBuilder = lazy(() => import('@/features/products/components/FashionVariantsBuilder').then((module) => ({ default: module.FashionVariantsBuilder })));

async function generateNextStyleCode() {
  const result = await productsApi.allocateStyleCode();
  return result.styleCode;
}

export function ProductForm({ categories, suppliers, locations, onCategoryCreated, onSupplierCreated, onSuccess, initialName }: ProductFormProps) {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const clothingModuleEnabled = settingsQuery.data?.clothingModuleEnabled === true;
  const manufacturingModuleEnabled = settingsQuery.data?.manufacturingModuleEnabled === true;
  const autoPartsModuleEnabled = settingsQuery.data?.autoPartsModuleEnabled === true || settingsQuery.data?.activityType === 'auto_parts' || settingsQuery.data?.businessIndustry === 'auto_parts';
  const defaultItemKind: 'standard' | 'fashion' = clothingModuleEnabled && settingsQuery.data?.defaultProductKind === 'fashion' ? 'fashion' : 'standard';
  const defaultGroupedMode = defaultItemKind === 'fashion';
  const [units, setUnits] = useState<ProductUnit[]>(normalizeProductUnits(undefined, ''));
  const [fashionVariantRows, setFashionVariantRows] = useState<FashionVariantDraft[]>([]);
  const [variantBarcodePrefix, setVariantBarcodePrefix] = useState('');
  const [groupedEntryEnabled, setGroupedEntryEnabled] = useState(defaultGroupedMode);
  const [inlineCategoryName, setInlineCategoryName] = useState('');
  const [inlineSupplierName, setInlineSupplierName] = useState('');
  const [inlineSupplierPhone, setInlineSupplierPhone] = useState('');
  const [isGeneratingStyleCode, setIsGeneratingStyleCode] = useState(false);
  const form = useForm<ProductFormInput, undefined, ProductFormOutput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      ...getDefaultValues(defaultItemKind),
      name: initialName || ''
    }
  });

  const queryClient = useQueryClient();
  const mutation = useCreateProductMutation((productId, name) => {
    form.reset({
      ...getDefaultValues(defaultItemKind),
      name: initialName || ''
    });
    setUnits(normalizeProductUnits(undefined, ''));
    setFashionVariantRows([]);
    setVariantBarcodePrefix('');
    setGroupedEntryEnabled(defaultGroupedMode);
    setInlineCategoryName('');
    setInlineSupplierName('');
    setInlineSupplierPhone('');
    onSuccess?.(productId, name);
  });

  useWatch({ control: form.control });
  const watchedBarcode = form.watch('barcode');
  const watchedItemKind = clothingModuleEnabled && form.watch('itemKind') === 'fashion' ? 'fashion' : 'standard';
  const watchedName = form.watch('name');
  const watchedStyleCode = form.watch('styleCode');
  const watchedFashionColors = form.watch('fashionColors');
  const watchedFashionSizes = form.watch('fashionSizes');
  const watchedVariantStock = Number(form.watch('variantStock') || 0);
  const usesVariantBuilder = watchedItemKind === 'fashion' || groupedEntryEnabled;
  const showExpiryDate = shouldShowExpiryDateField({
    settings: settingsQuery.data,
    clothingModuleEnabled,
    itemKind: watchedItemKind,
  });

  useEffect(() => {
    if (watchedItemKind === 'fashion' && !groupedEntryEnabled) setGroupedEntryEnabled(true);
  }, [watchedItemKind, groupedEntryEnabled]);

  useEffect(() => {
    if (locations.length === 1) {
      const singleLocId = String(locations[0].id);
      if (form.getValues('warehouseId') !== singleLocId) {
        form.setValue('warehouseId', singleLocId, { shouldDirty: true, shouldValidate: true });
      }
    }
  }, [locations, form]);


  const colorTokens = useMemo(() => splitFashionTokens(watchedFashionColors), [watchedFashionColors]);
  const sizeTokens = useMemo(() => splitFashionTokens(watchedFashionSizes), [watchedFashionSizes]);
  const syncedDefaultFashionRows = useMemo(
    () => buildFashionVariantDrafts(colorTokens, sizeTokens, [], watchedVariantStock),
    [colorTokens, sizeTokens, watchedVariantStock],
  );
  const hasUnitsDraftChanges = useMemo(
    () => usesVariantBuilder ? false : JSON.stringify(units) !== JSON.stringify(normalizeProductUnits(undefined, (watchedBarcode || '').trim())),
    [units, watchedBarcode, usesVariantBuilder],
  );
  const hasFashionDraftChanges = useMemo(
    () => usesVariantBuilder && (serializeVariantRows(fashionVariantRows) !== serializeVariantRows(syncedDefaultFashionRows) || Boolean(variantBarcodePrefix.trim())),
    [fashionVariantRows, syncedDefaultFashionRows, variantBarcodePrefix, usesVariantBuilder],
  );
  const duplicateFashionBarcodes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of fashionVariantRows) {
      const barcode = String(row.barcode || '').trim().toLowerCase();
      if (!barcode) continue;
      counts.set(barcode, Number(counts.get(barcode) || 0) + 1);
    }
    return Array.from(counts.values()).filter((count) => count > 1).length;
  }, [fashionVariantRows]);
  const hasDraftChanges = form.formState.isDirty || hasUnitsDraftChanges || hasFashionDraftChanges || Boolean(inlineCategoryName.trim()) || Boolean(inlineSupplierName.trim()) || Boolean(inlineSupplierPhone.trim()) || groupedEntryEnabled !== defaultGroupedMode;

  useEffect(() => {
    if (!usesVariantBuilder) {
      if (fashionVariantRows.length) setFashionVariantRows([]);
      if (variantBarcodePrefix) setVariantBarcodePrefix('');
      if (form.getValues('fashionColors')) form.setValue('fashionColors', '', { shouldDirty: false, shouldValidate: false });
      if (form.getValues('fashionSizes')) form.setValue('fashionSizes', '', { shouldDirty: false, shouldValidate: false });
      if (Number(form.getValues('variantStock') || 0) !== 0) form.setValue('variantStock', 0, { shouldDirty: false, shouldValidate: false });
      return;
    }
    setFashionVariantRows((current) => buildFashionVariantDrafts(colorTokens, sizeTokens, current, watchedVariantStock));
  }, [usesVariantBuilder, colorTokens, sizeTokens, watchedVariantStock]);

  const categoryMutation = useMutation<{ id?: string | number; category?: { id?: string | number }; data?: { id?: string | number } }, Error, void>({
    mutationFn: async () => {
      const name = inlineCategoryName.trim();
      if (!name) throw new Error('اكتب اسم القسم');
      return productsApi.createCategory({ name }) as Promise<{ id?: string | number; category?: { id?: string | number }; data?: { id?: string | number } }>;
    },
    onSuccess: async (created) => {
      const createdName = inlineCategoryName.trim();
      let nextId = extractCreatedEntityId(created);
      setInlineCategoryName('');
      await invalidateCatalogDomain(queryClient, { includeCategories: true });
      if (!nextId) {
        nextId = findCreatedCategoryId(await productsApi.categories(), createdName);
      }
      if (nextId) {
        form.setValue('categoryId', nextId, { shouldDirty: true, shouldValidate: true });
        onCategoryCreated?.(nextId);
      }
    }
  });

  const supplierMutation = useMutation<{ id?: string | number; supplier?: { id?: string | number }; data?: { id?: string | number } }, Error, void>({
    mutationFn: async () => {
      const name = inlineSupplierName.trim();
      if (!name) throw new Error('اكتب اسم المورد');
      return productsApi.createSupplier({ name, phone: inlineSupplierPhone.trim(), address: '', balance: 0, notes: '' }) as Promise<{ id?: string | number; supplier?: { id?: string | number }; data?: { id?: string | number } }>;
    },
    onSuccess: async (created) => {
      const createdName = inlineSupplierName.trim();
      const createdPhone = inlineSupplierPhone.trim();
      let nextId = extractCreatedEntityId(created);
      setInlineSupplierName('');
      setInlineSupplierPhone('');
      await invalidateCatalogDomain(queryClient, { includeSuppliers: true });
      if (!nextId) {
        nextId = findCreatedSupplierId(await productsApi.suppliers(), createdName, createdPhone);
      }
      if (nextId) {
        form.setValue('supplierId', nextId, { shouldDirty: true, shouldValidate: true });
        onSupplierCreated?.(nextId);
      }
    }
  });

  useMutationFeedbackReset(categoryMutation.isSuccess || categoryMutation.isError, categoryMutation.reset, inlineCategoryName.trim());
  useMutationFeedbackReset(supplierMutation.isSuccess || supplierMutation.isError, supplierMutation.reset, JSON.stringify([inlineSupplierName.trim(), inlineSupplierPhone.trim()]));

  const canNavigateAway = useUnsavedChangesGuard(hasDraftChanges && !mutation.isPending && !categoryMutation.isPending && !supplierMutation.isPending);

  function handleUnitsChange(nextUnits: ProductUnit[]) {
    const baseBarcode = (watchedBarcode || '').trim();
    const mapped = nextUnits.map((unit, index) => ({ ...unit, barcode: unit.barcode || (index === 0 ? baseBarcode : unit.barcode) }));
    setUnits(mapped);
  }

  function handleReset() {
    if (!hasDraftChanges) return;
    if (!canNavigateAway()) return;
    mutation.reset();
    categoryMutation.reset();
    supplierMutation.reset();
    form.reset(getDefaultValues(defaultItemKind));
    setUnits(normalizeProductUnits(undefined, ''));
    setFashionVariantRows([]);
    setVariantBarcodePrefix('');
    setGroupedEntryEnabled(defaultGroupedMode);
    setInlineCategoryName('');
    setInlineSupplierName('');
    setInlineSupplierPhone('');
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

  const submitText = usesVariantBuilder
    ? 'حفظ الصنف بجميع المتغيرات'
    : 'حفظ الصنف';

  return (
    <form className="page-stack" onSubmit={form.handleSubmit((values) => mutation.mutate({ ...values, itemKind: watchedItemKind, units, fashionVariantRows, groupedEntryEnabled: usesVariantBuilder }))}>
      <DraftStateNotice visible={hasDraftChanges && !mutation.isPending} title={t('products.product_form.s0', "بيانات الصنف الحالي لم تُحفظ بعد")} hint={t('products.product_form.s1', "يشمل ذلك الوحدات الجديدة أو الإضافة السريعة للقسم والمورد من نفس النموذج، ومعها تجهيز الأصناف الفرعية قبل الإنشاء.")} />

      {clothingModuleEnabled && (
        <div className="surface-note" style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 800 }}>{t('products.product_form.s2', "نمط الصنف:")}</span>
            <div className="actions compact-actions" style={{ margin: 0 }}>
              <Button
                type="button"
                variant={!usesVariantBuilder ? 'primary' : 'secondary'}
                onClick={() => {
                  form.setValue('itemKind', 'standard');
                  setGroupedEntryEnabled(false);
                }}
                disabled={mutation.isPending}
              >
                {t('products.product_form.s3', "صنف عادي (بسيط)")}
              </Button>
              <Button
                type="button"
                variant={usesVariantBuilder ? 'primary' : 'secondary'}
                onClick={() => {
                  form.setValue('itemKind', 'fashion');
                  setGroupedEntryEnabled(true);
                }}
                disabled={mutation.isPending}
              >
                {t('products.product_form.s4', "صنف بمتغيرات (أحجام / روائح / مقاسات)")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="form-grid">
        {manufacturingModuleEnabled ? (
          <Field label={t('products.product_form.s5', "تصنيف الصنف")}>
            <select {...form.register('itemType')} disabled={mutation.isPending}>
              <option value="product">{t('products.product_form.s6', "منتج نهائي للبيع")}</option>
              <option value="raw_material">{t('products.product_form.s7', "مادة خام / مكون تصنيع")}</option>
            </select>
          </Field>
        ) : null}
        <div className="field">
          <label>{usesVariantBuilder ? t('products.product_form.s8', "اسم الصنف الأساسي") : t('products.product_form.s9', "اسم الصنف")}</label>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <ProductIconPicker
              value={form.watch('icon')}
              onChange={(iconId) => form.setValue('icon', iconId, { shouldDirty: true })}
              industry={settingsQuery.data?.businessIndustry}
              disabled={mutation.isPending}
            />
            <input
              style={{ flex: 1 }}
              {...form.register('name')}
              onChange={(e) => {
                form.setValue('name', e.target.value, { shouldDirty: true, shouldValidate: true });
                const guessed = guessProductIcon(e.target.value, undefined, settingsQuery.data?.businessIndustry);
                if (guessed) {
                  form.setValue('icon', guessed, { shouldDirty: true });
                }
              }}
              disabled={mutation.isPending}
              placeholder={usesVariantBuilder ? t('products.product_form.s10', "مثال: مزيل عرق Nivea / تيشيرت Polo / شامبو L’Oréal") : undefined}
            />
          </div>
          {form.formState.errors.name && <small className="field-error">{form.formState.errors.name.message}</small>}
        </div>

        {usesVariantBuilder ? (
          <Field label={t('products.product_form.s11', "كود الصنف الأساسي / الموديل")}>
            <div className="inline-create-row">
              <input {...form.register('styleCode')} disabled={mutation.isPending || isGeneratingStyleCode} inputMode="numeric" placeholder="1001" />
              <button type="button" className="btn btn-secondary" onClick={() => { void handleGenerateStyleCode(); }} disabled={mutation.isPending || isGeneratingStyleCode}>{isGeneratingStyleCode ? t('products.product_form.s12', "جارٍ التوليد...") : t('products.product_form.s13', "توليد كود")}</button>
            </div>
          </Field>
        ) : (
          <Field label={t('products.product_form.s14', "الباركود")}><input {...form.register('barcode')} disabled={mutation.isPending} /></Field>
        )}
        
        <Field label={t('products.product_form.s15', "نوع الكود الضريبي")}>
          <select {...form.register('taxCodeType')} disabled={mutation.isPending}>
            <option value="GS1">{t('products.product_form.s16', "GS1 (عالمي)")}</option>
            <option value="EGS">{t('products.product_form.s17', "EGS (مصري)")}</option>
          </select>
        </Field>
        
        <Field label={t('products.product_form.s18', "الكود الضريبي (EGS/GS1)")}>
          <input {...form.register('taxCode')} disabled={mutation.isPending} placeholder={t('products.product_form.s19', "مثال: 10003923...")} />
        </Field>

        <Field label={t('products.product_form.s20', "سعر الشراء")}><input type="number" step="0.01" {...form.register('costPrice')} disabled={mutation.isPending} /></Field>
        <Field label={t('products.product_form.s21', "سعر القطاعي (الكاش)")}><input type="number" step="0.01" {...form.register('retailPrice')} disabled={mutation.isPending} /></Field>
        <Field label={t('products.product_form.s22', "سعر الجملة")}><input type="number" step="0.01" {...form.register('wholesalePrice')} disabled={mutation.isPending} /></Field>
        <Field label={t('products.product_form.s23', "سعر البيع الآجل (توزيع)")}><input type="number" step="0.01" {...form.register('creditPrice')} disabled={mutation.isPending} placeholder={t('products.product_form.s24', "اختياري - افتراضياً نفس الكاش")} /></Field>
        <Field label={t('products.product_form.s25', "سعر المستهلك / الجمهور (SRP)")}><input type="number" step="0.01" {...form.register('consumerPrice')} disabled={mutation.isPending} placeholder={t('products.product_form.s26', "سعر بيع المحل للجمهور")} /></Field>
        {!usesVariantBuilder ? <Field label={t('products.product_form.s27', "المخزون الافتتاحي")}><input type="number" {...form.register('stock')} disabled={mutation.isPending} /></Field> : null}
        <Field label={t('products.product_form.s28', "الحد الأدنى")}><input type="number" {...form.register('minStock')} disabled={mutation.isPending} /></Field>

        {showExpiryDate && (
          <Field label={t('products.product_form.s29', "تاريخ انتهاء الصلاحية")}>
          <input type="date" {...form.register('expiryDate')} disabled={mutation.isPending} />
          </Field>
        )}

        <div className="field">
          <label>{t('products.product_form.s30', "القسم")}</label>
          <select {...form.register('categoryId')} disabled={mutation.isPending || categoryMutation.isPending}>
            <option value="">{t('products.product_form.s31', "بدون قسم")}</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <div className="inline-create-row">
            <input value={inlineCategoryName} onChange={(event) => setInlineCategoryName(event.target.value)} placeholder={t('products.product_form.s32', "إضافة قسم جديد من نفس النموذج")} disabled={mutation.isPending || categoryMutation.isPending} />
            <button type="button" className="btn btn-secondary" onClick={() => categoryMutation.mutate()} disabled={mutation.isPending || categoryMutation.isPending || !inlineCategoryName.trim()}>{t('products.product_form.s33', "إضافة قسم")}</button>
          </div>
          {form.formState.errors.categoryId && <small className="field-error">{form.formState.errors.categoryId.message}</small>}
        </div>

        <div className="field">
          <label>{t('products.product_form.s34', "المورد")}</label>
          <select {...form.register('supplierId')} disabled={mutation.isPending || supplierMutation.isPending}>
            <option value="">{t('products.product_form.s35', "بدون مورد")}</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
          <div className="inline-create-row">
            <input value={inlineSupplierName} onChange={(event) => setInlineSupplierName(event.target.value)} placeholder={t('products.product_form.s36', "إضافة مورد جديد")} disabled={mutation.isPending || supplierMutation.isPending} />
            <input value={inlineSupplierPhone} onChange={(event) => setInlineSupplierPhone(event.target.value)} placeholder={t('products.product_form.s37', "الهاتف")} disabled={mutation.isPending || supplierMutation.isPending} />
            <button type="button" className="btn btn-secondary" onClick={() => supplierMutation.mutate()} disabled={mutation.isPending || supplierMutation.isPending || !inlineSupplierName.trim()}>{t('products.product_form.s38', "إضافة مورد")}</button>
          </div>
          {form.formState.errors.supplierId && <small className="field-error">{form.formState.errors.supplierId.message}</small>}
        </div>

        <div className="field">
          <label>{t('products.product_form.s39', "المخزن (موقع التخزين)")}</label>
          <select {...form.register('warehouseId')} disabled={mutation.isPending || locations.length === 1}>
            {locations.length !== 1 && <option value="">{t('products.product_form.s40', "اختر المخزن...")}</option>}
            {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
          {form.formState.errors.warehouseId && <small className="field-error">{form.formState.errors.warehouseId.message}</small>}
          <small className="muted" style={{ display: 'block', marginTop: 4 }}>
            {t('products.product_form.s41', "* إجباري: يحدد المخزن الذي سيتم إضافة الرصيد الافتتاحي إليه، وسيكون المخزن الافتراضي للعمليات القادمة.")}
          </small>
        </div>

        <Field label={t('products.product_form.s42', "مكان التخزين (Bin Location)")}><input {...form.register('binLocation')} disabled={mutation.isPending} placeholder={t('products.product_form.s43', "مثال: مخزن رئيسي، رف 5، شقة 2")} /></Field>
        
        {autoPartsModuleEnabled ? (
          <div className="surface-note form-grid" style={{ padding: 12, gridColumn: '1 / -1', background: 'var(--blue-50)', border: '1px solid var(--blue-200)', marginTop: 8 }}>
            <h4 style={{ gridColumn: '1 / -1', margin: '0 0 12px 0', color: 'var(--blue-900)' }}>{t('products.product_form.s44', "بيانات قطعة الغيار (Auto Parts)")}</h4>
            <Field label={t('products.product_form.s45', "رقم القطعة (OEM)")}><input {...form.register('metadata.oemNumber')} disabled={mutation.isPending} placeholder={t('products.product_form.s46', "مثال: 1J0907530")} /></Field>
            <Field label={t('products.product_form.s47', "الماركة (Brand)")}><input {...form.register('metadata.carBrand')} disabled={mutation.isPending} placeholder={t('products.product_form.s48', "مثال: Toyota, Audi")} /></Field>
            <Field label={t('products.product_form.s49', "الموديل (Model)")}><input {...form.register('metadata.carModel')} disabled={mutation.isPending} placeholder={t('products.product_form.s50', "مثال: Corolla")} /></Field>
            <Field label={t('products.product_form.s51', "سنة الصنع (من)")}><input type="number" {...form.register('metadata.carYearFrom')} disabled={mutation.isPending} placeholder={t('products.product_form.s52', "مثال: 2015")} /></Field>
            <Field label={t('products.product_form.s53', "سنة الصنع (إلى)")}><input type="number" {...form.register('metadata.carYearTo')} disabled={mutation.isPending} placeholder={t('products.product_form.s54', "مثال: 2020")} /></Field>
            <Field label={t('products.product_form.s55', "بلد المنشأ")}><input {...form.register('metadata.origin')} disabled={mutation.isPending} placeholder={t('products.product_form.s56', "مثال: China, Japan")} /></Field>
            <Field label={t('products.product_form.s57', "الحالة")}>
              <select {...form.register('metadata.condition')} disabled={mutation.isPending}>
                <option value="">{t('products.product_form.s58', "غير محدد")}</option>
                <option value="new">{t('products.product_form.s59', "جديد (New)")}</option>
                <option value="used">{t('products.product_form.s60', "استيراد/مستعمل (Used)")}</option>
              </select>
            </Field>
          </div>
        ) : null}

        {settingsQuery.data?.enableMobileStoreFeatures === true && (
          <div className="field span-full" style={{ padding: '12px 16px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', marginTop: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 600, color: '#166534', margin: 0 }}>
              <input type="checkbox" {...form.register('trackSerials')} disabled={mutation.isPending} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <SmartphoneIcon size={16} color="#166534" /> {t('products.product_form.s61', "تتبع أرقام السيريال / الـ IMEI لهذا الصنف (للهواتف، الأجهزة، وقطع الإلكترونيات)")}
              </span>
            </label>
            <div style={{ fontSize: '0.8rem', color: '#15803d', marginTop: '4px', marginInlineStart: '28px' }}>
              {t('products.product_form.s62', "يتيح تتبع كل جهاز برقم السيريال/IMEI المنفرد، تسجيل السيريالات عند الشراء، وخصمها بالمسح المباشر في الكاشير ومتابعة الضمان.")}
            </div>
          </div>
        )}

        <Field label={t('products.product_form.s63', "ملاحظات")} className="span-full"><textarea {...form.register('notes')} rows={4} disabled={mutation.isPending} style={{ width: '100%' }} /></Field>
      </div>

      {usesVariantBuilder ? (
        <Suspense fallback={<div className="loading-card">{t('products.product_form.s64', "جاري تجهيز أدوات الأصناف الفرعية...")}</div>}>
          <LazyFashionVariantsBuilder
            mode={builderMode}
            name={watchedName || ''}
            styleCode={watchedStyleCode || ''}
            colorsValue={watchedFashionColors || ''}
            sizesValue={watchedFashionSizes || ''}
            defaultStock={watchedVariantStock}
            barcodePrefix={variantBarcodePrefix}
            parentCostPrice={Number(form.watch('costPrice') || 0)}
            parentRetailPrice={Number(form.watch('retailPrice') || 0)}
            parentWholesalePrice={Number(form.watch('wholesalePrice') || 0)}
            rows={fashionVariantRows}
            disabled={mutation.isPending}
            onColorsChange={(value) => form.setValue('fashionColors', value, { shouldDirty: true, shouldValidate: true })}
            onSizesChange={(value) => form.setValue('fashionSizes', value, { shouldDirty: true, shouldValidate: true })}
            onDefaultStockChange={(value) => form.setValue('variantStock', value, { shouldDirty: true, shouldValidate: true })}
            onBarcodePrefixChange={setVariantBarcodePrefix}
            onRowsChange={setFashionVariantRows}
          />
        </Suspense>
      ) : (
        <ProductUnitsEditor units={units} onChange={handleUnitsChange} disabled={mutation.isPending} title={t('products.product_form.s65', "وحدات الصنف")} />
      )}

      <MutationFeedback isError={mutation.isError} isSuccess={mutation.isSuccess} error={mutation.error} errorFallback={t('products.product_form.s66', "تعذر حفظ الصنف")} successText={usesVariantBuilder ? t('products.product_form.s67', "تم حفظ الصنف الأساسي مع أصنافه الفرعية بنجاح.") : t('products.product_form.s68', "تم حفظ الصنف بنجاح.")} />
      {usesVariantBuilder && duplicateFashionBarcodes ? <div className="muted small" style={{ color: '#b91c1c' }}>{t('products.product_form.s69', "يوجد باركودات مكررة داخل نفس المجموعة. صححها قبل الحفظ.")}</div> : null}
      <div className="actions">
        <FormResetButton onReset={handleReset} disabled={!hasDraftChanges || mutation.isPending}>{t('products.product_form.s70', "إعادة القيم")}</FormResetButton>
        <SubmitButton type="submit" isPending={mutation.isPending} disabled={(usesVariantBuilder && (!fashionVariantRows.length || duplicateFashionBarcodes > 0 || !String(watchedStyleCode || '').trim()))} idleText={submitText} pendingText={t('products.product_form.s71', "جارٍ الحفظ...")} />
      </div>
    </form>
  );
}
