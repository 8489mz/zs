import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { SubmitButton } from '@/shared/components/submit-button';
import { ProductUnitsEditor, normalizeProductUnits } from '@/features/products/components/ProductUnitsEditor';
import { productsApi } from '@/features/products/api/products.api';
import { productFormSchema, type ProductFormInput, type ProductFormOutput } from '@/features/products/schemas/product.schema';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import type { Category, Product, ProductCustomerPrice, ProductUnit, Supplier, Location } from '@/types/domain';
import { ProductCustomerPricesCard } from './ProductCustomerPricesCard';
import { FashionGroupEditorCard } from './FashionGroupEditorCard';
import { buildUpdatePayload, normalizeCustomerPrices, refetchAndSelectProduct, toProductFormValues } from './product-workspace.utils';
import { normalizeNumericStyleCode } from '@/features/products/lib/style-code';
import { shouldShowExpiryDateField } from '@/features/products/utils/product-visibility.utils';

type ProductFormOutputWithoutStock = Omit<ProductFormOutput, 'stock' | 'variantStock' | 'fashionColors' | 'fashionSizes'> & {
  stock?: number;
  variantStock?: number;
  fashionColors?: string;
  fashionSizes?: string;
};

function omitStock(values: ProductFormOutput): ProductFormOutput {
  const { stock: _stock, variantStock: _variantStock, fashionColors: _fashionColors, fashionSizes: _fashionSizes, ...safeValues } = values as ProductFormOutputWithoutStock;
  return safeValues as ProductFormOutput;
}

export function ProductEditorCard({ product, categories, suppliers, customers, locations, onSaved }: { product?: Product; categories: Category[]; suppliers: Supplier[]; customers: Array<{ id: string; name: string }>; locations: Location[]; onSaved?: (product: Product) => void }) {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const clothingModuleEnabled = settingsQuery.data?.clothingModuleEnabled === true;
  const manufacturingModuleEnabled = settingsQuery.data?.manufacturingModuleEnabled === true;
  const queryClient = useQueryClient();
  const [units, setUnits] = useState<ProductUnit[]>(normalizeProductUnits(product?.units, product?.barcode || ''));
  const [customerPrices, setCustomerPrices] = useState<ProductCustomerPrice[]>(normalizeCustomerPrices(product));
  const form = useForm<ProductFormInput, undefined, ProductFormOutput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: '', barcode: '', itemKind: 'standard', styleCode: '', color: '', size: '', fashionColors: '', fashionSizes: '', variantStock: 0,
      costPrice: 0, retailPrice: 0, wholesalePrice: 0, halfWholesalePrice: 0, creditPrice: 0, consumerPrice: 0, stock: 0, minStock: 5, categoryId: '', supplierId: '', notes: ''
    }
  });

  const watchedItemKind = clothingModuleEnabled && form.watch('itemKind') === 'fashion' ? 'fashion' : 'standard';
  const showExpiryDate = shouldShowExpiryDateField({
    settings: settingsQuery.data,
    clothingModuleEnabled,
    itemKind: watchedItemKind,
  });
  const watchedStyleCode = form.watch('styleCode') || '';
  const groupedEntry = Boolean(String(product?.styleCode || '').trim());

  useEffect(() => {
    if (!product) return;
    form.reset(toProductFormValues(product));
    setUnits(normalizeProductUnits(product.units, product.barcode || ''));
    setCustomerPrices(normalizeCustomerPrices(product));
  }, [product, form]);

  useEffect(() => {
    if (!clothingModuleEnabled && form.getValues('itemKind') !== 'standard') {
      form.setValue('itemKind', 'standard', { shouldDirty: false, shouldValidate: true });
    }
  }, [clothingModuleEnabled, form]);

  const mutation = useMutation({
    mutationFn: async (values: ProductFormOutput) => {
      if (!product) throw new Error('اختر صنفًا أولًا');
      return productsApi.update(product.id, buildUpdatePayload({ ...omitStock(values), itemKind: watchedItemKind }, product, units, customerPrices));
    },
    onSuccess: async () => {
      if (!product) return;
      const refreshed = await refetchAndSelectProduct(queryClient, product.id);
      if (refreshed) onSaved?.(refreshed);
    }
  });

  const hasDraftChanges = (
    form.formState.isDirty
    || (watchedItemKind === 'fashion' ? false : JSON.stringify(units) !== JSON.stringify(normalizeProductUnits(product?.units, product?.barcode || '')))
    || JSON.stringify(customerPrices) !== JSON.stringify(normalizeCustomerPrices(product))
  );
  const canNavigateAway = useUnsavedChangesGuard(hasDraftChanges && !mutation.isPending);

  async function saveCustomerPricesOnly() {
    if (!product) return;
    const values = productFormSchema.parse(form.getValues());
    await mutation.mutateAsync({ ...omitStock(values), itemKind: watchedItemKind });
  }

  if (!product) {
    return <div className="muted">{t('products.workspace_sections.product_editor_card.s0', "اختر صنفًا من الجدول لعرض نموذج التعديل. تعديل رصيد المخزون نفسه يتم من تبويب المخزون وليس من master data.")}</div>;
  }

  if (groupedEntry) {
    return (
      <FashionGroupEditorCard
        product={product}
        categories={categories}
        suppliers={suppliers}
        locations={locations}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div className="page-stack">
      <form className="page-stack" onSubmit={form.handleSubmit((values) => mutation.mutate({ ...omitStock(values), itemKind: watchedItemKind }))}>
        <div className="form-grid">
          {manufacturingModuleEnabled ? (
            <Field label={t('products.workspace_sections.product_editor_card.s1', "تصنيف الصنف")}>
              <select {...form.register('itemType')} disabled={mutation.isPending}>
                <option value="product">{t('products.workspace_sections.product_editor_card.s2', "منتج نهائي للبيع")}</option>
                <option value="raw_material">{t('products.workspace_sections.product_editor_card.s3', "مادة خام / مكون تصنيع")}</option>
              </select>
            </Field>
          ) : null}
          {clothingModuleEnabled ? <Field label={t('products.workspace_sections.product_editor_card.s4', "طبيعة الصنف")}><select {...form.register('itemKind')} disabled={mutation.isPending}><option value="standard">{t('products.workspace_sections.product_editor_card.s5', "صنف عادي (بسيط)")}</option><option value="fashion">{t('products.workspace_sections.product_editor_card.s6', "صنف بمتغيرات / Variant")}</option></select></Field> : null}
          <Field label={t('products.workspace_sections.product_editor_card.s7', "اسم الصنف")} error={form.formState.errors.name?.message}><input {...form.register('name')} disabled={mutation.isPending} /></Field>
          <Field label={t('products.workspace_sections.product_editor_card.s8', "الباركود")}><input {...form.register('barcode')} disabled={mutation.isPending} /></Field>
          {watchedItemKind === 'fashion' ? <Field label={t('products.workspace_sections.product_editor_card.s9', "كود الموديل / الصنف الرئيسي")}><input value={watchedStyleCode} onChange={(event) => form.setValue('styleCode', normalizeNumericStyleCode(event.target.value), { shouldDirty: true, shouldValidate: true })} disabled={mutation.isPending} inputMode="numeric" placeholder={t('products.workspace_sections.product_editor_card.s10', "اختياري - أرقام فقط")} /></Field> : null}
          {watchedItemKind === 'fashion' ? <Field label={t('products.workspace_sections.product_editor_card.s11', "الخاصية 1 (اللون / الرائحة)")}><input {...form.register('color')} disabled={mutation.isPending} placeholder={t('products.workspace_sections.product_editor_card.s12', "اختياري")} /></Field> : null}
          {watchedItemKind === 'fashion' ? <Field label={t('products.workspace_sections.product_editor_card.s13', "الخاصية 2 (المقاس / الحجم)")}><input {...form.register('size')} disabled={mutation.isPending} placeholder={t('products.workspace_sections.product_editor_card.s14', "اختياري")} /></Field> : null}
          <Field label={t('products.workspace_sections.product_editor_card.s15', "سعر الشراء")}><input type="number" step="0.01" {...form.register('costPrice')} disabled={mutation.isPending} /></Field>
          <Field label={t('products.workspace_sections.product_editor_card.s16', "سعر القطاعي (الكاش)")}><input type="number" step="0.01" {...form.register('retailPrice')} disabled={mutation.isPending} /></Field>
          <Field label={t('products.workspace_sections.product_editor_card.s17', "سعر الجملة")}><input type="number" step="0.01" {...form.register('wholesalePrice')} disabled={mutation.isPending} /></Field>
          <Field label={t('products.workspace_sections.product_editor_card.s38', "سعر نصف الجملة")}><input type="number" step="0.01" {...form.register('halfWholesalePrice')} disabled={mutation.isPending} placeholder={t('products.workspace_sections.product_editor_card.s19', "اختياري")} /></Field>
          <Field label={t('products.workspace_sections.product_editor_card.s18', "سعر البيع الآجل (توزيع)")}><input type="number" step="0.01" {...form.register('creditPrice')} disabled={mutation.isPending} placeholder={t('products.workspace_sections.product_editor_card.s19', "اختياري")} /></Field>
          <Field label={t('products.workspace_sections.product_editor_card.s20', "سعر المستهلك / الجمهور (SRP)")}><input type="number" step="0.01" {...form.register('consumerPrice')} disabled={mutation.isPending} placeholder={t('products.workspace_sections.product_editor_card.s21', "سعر بيع المحل للمستهلك")} /></Field>
          <Field label={t('products.workspace_sections.product_editor_card.s22', "المخزون الحالي")}><input type="number" value={Number(product.stock || 0)} disabled readOnly /></Field>
          <Field label={t('products.workspace_sections.product_editor_card.s23', "الحد الأدنى")}><input type="number" {...form.register('minStock')} disabled={mutation.isPending} /></Field>
          {showExpiryDate ? (
            <Field label={t('products.workspace_sections.product_editor_card.s24', "تاريخ انتهاء الصلاحية")}>
            <input type="date" {...form.register('expiryDate')} disabled={mutation.isPending} />
            </Field>
          ) : null}
          <Field label={t('products.workspace_sections.product_editor_card.s25', "القسم")}>
            <select {...form.register('categoryId')} disabled={mutation.isPending}>
              <option value="">{t('products.workspace_sections.product_editor_card.s26', "بدون قسم")}</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </Field>
          <Field label={t('products.workspace_sections.product_editor_card.s27', "المورد")}>
            <select {...form.register('supplierId')} disabled={mutation.isPending}>
              <option value="">{t('products.workspace_sections.product_editor_card.s28', "بدون مورد")}</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </Field>
          <Field label={t('products.workspace_sections.product_editor_card.s29', "ملاحظات")}><textarea rows={4} {...form.register('notes')} disabled={mutation.isPending} /></Field>
        </div>
        <ProductUnitsEditor units={units} onChange={setUnits} disabled={mutation.isPending} title={t('products.workspace_sections.product_editor_card.s30', "وحدات الصنف")} />
        <DraftStateNotice visible={hasDraftChanges && !mutation.isPending} title={t('products.workspace_sections.product_editor_card.s31', "تعديلات الصنف الحالية غير محفوظة")} hint={t('products.workspace_sections.product_editor_card.s32', "احفظ الصنف أو أعد القيم الأصلية قبل الانتقال إلى سجل آخر حتى لا تفقد الوحدات أو الأسعار الخاصة.")} />
        <MutationFeedback isError={mutation.isError} isSuccess={mutation.isSuccess} error={mutation.error} errorFallback={t('products.workspace_sections.product_editor_card.s33', "تعذر تحديث الصنف")} successText={t('products.workspace_sections.product_editor_card.s34', "تم تحديث الصنف بنجاح.")} />
        <div className="actions">
          <Button type="button" variant="secondary" onClick={() => {
            if (!canNavigateAway()) return;
            form.reset(toProductFormValues(product));
            setUnits(normalizeProductUnits(product.units, product.barcode || ''));
            setCustomerPrices(normalizeCustomerPrices(product));
          }} disabled={mutation.isPending}>{t('products.workspace_sections.product_editor_card.s35', "إعادة القيم")}</Button>
          <SubmitButton type="submit" isPending={mutation.isPending} idleText={t('products.workspace_sections.product_editor_card.s36', "حفظ التعديل")} pendingText={t('products.workspace_sections.product_editor_card.s37', "جارٍ الحفظ...")} />
        </div>
      </form>
      <ProductCustomerPricesCard product={product} customers={customers} customerPrices={customerPrices} onChange={setCustomerPrices} onSave={saveCustomerPricesOnly} isSaving={mutation.isPending} />
    </div>
  );
}
