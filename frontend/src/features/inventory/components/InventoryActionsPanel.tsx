import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, type SyntheticEvent } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormSection } from '@/shared/components/form-section';
import { Field } from '@/shared/ui/field';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { SubmitButton } from '@/shared/components/submit-button';
import { DraftStateNotice } from '@/shared/components/draft-state-notice';
import { useUnsavedChangesGuard } from '@/shared/hooks/use-unsaved-changes-guard';
import type { Branch, Location, Product } from '@/types/domain';
import { useDamagedStockMutation, useInventoryAdjustmentMutation } from '@/features/inventory/hooks/useInventoryMutations';
import { InventoryProductPicker } from '@/features/inventory/components/InventoryProductPicker';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { useAuthStore } from '@/stores/auth-store';
import {
  damagedStockSchema,
  inventoryAdjustmentSchema,
  type DamagedStockInput,
  type DamagedStockOutput,
  type InventoryAdjustmentInput,
  type InventoryAdjustmentOutput
} from '@/features/inventory/schemas/inventory.schema';

const ACTION_TYPE_OPTIONS = [
  { value: 'adjust', label: 'تسوية إلى كمية نهائية' },
  { value: 'add', label: 'إضافة كمية' },
  { value: 'deduct', label: 'خصم كمية' },
];

interface InventoryActionsPanelProps {
  products: Product[];
  selectedProduct?: Product | null;
  selectedProductToken?: number;
  branches: Branch[];
  locations: Location[];
  isCatalogLoading: boolean;
  isCatalogError: boolean;
  catalogError?: unknown;
  canManageInventory?: boolean;
  locationStocks?: { productId: string; locationId: string; qty: number }[];
}

function buildAdjustmentDefaults(locations: Location[], defaultLocId?: string, defaultBranchId?: string): InventoryAdjustmentInput {
  return {
    productId: '',
    actionType: 'adjust',
    qty: 0,
    reason: 'جرد مخزني',
    note: '',
    branchId: defaultBranchId ?? '',
    locationId: defaultLocId ?? (SINGLE_STORE_MODE ? (locations[0]?.id || '') : ''),
  };
}

function buildDamagedDefaults(locations: Location[]): DamagedStockInput {
  return {
    productId: '',
    qty: 1,
    reason: 'كسر أثناء النقل / تلف مخزني',
    note: 'كسر أثناء النقل / تلف مخزني',
    branchId: '',
    locationId: SINGLE_STORE_MODE ? (locations[0]?.id || '') : '',
  };
}

function hasDamagedDraft(values: DamagedStockInput, locations: Location[]): boolean {
  const defaults = buildDamagedDefaults(locations);
  return Boolean(values.productId)
    || Number(values.qty || 0) !== Number(defaults.qty)
    || String(values.reason || '') !== defaults.reason
    || Boolean(String(values.note || '').trim())
    || String(values.branchId || '') !== String(defaults.branchId || '')
    || String(values.locationId || '') !== String(defaults.locationId || '');
}

export function InventoryActionsPanel({ products, selectedProduct = null, selectedProductToken = 0, branches, locations, locationStocks = [], isCatalogLoading, isCatalogError, catalogError, canManageInventory = true }: InventoryActionsPanelProps) {
  const { t } = useTranslation();
  const settingsQuery = useSettingsQuery();
  const currentUser = useAuthStore((s) => s.user);
  const isAdminRole = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
  const requireManagerForWriteOff = Boolean(settingsQuery.data?.antiTheftRequireManagerForWriteOff && !isAdminRole);
  const adjustmentDisclosureRef = useRef<HTMLDetailsElement | null>(null);
  const damagedDisclosureRef = useRef<HTMLDetailsElement | null>(null);
  const lastPreparedAdjustmentTokenRef = useRef(0);
  const productList = useMemo(() => (Array.isArray(products) ? products : []), [products]);
  const branchList = useMemo(() => (Array.isArray(branches) ? branches : []), [branches]);
  const locationList = useMemo(() => (Array.isArray(locations) ? locations : []), [locations]);
  const productById = useMemo(() => new Map(productList.map((product) => [String(product.id), product])), [productList]);
  const locationById = useMemo(() => new Map(locationList.map((location) => [String(location.id), location.name])), [locationList]);

  const adjustmentForm = useForm<InventoryAdjustmentInput, undefined, InventoryAdjustmentOutput>({
    resolver: zodResolver(inventoryAdjustmentSchema),
    defaultValues: buildAdjustmentDefaults(locationList)
  });
  const damagedForm = useForm<DamagedStockInput, undefined, DamagedStockOutput>({
    resolver: zodResolver(damagedStockSchema),
    defaultValues: buildDamagedDefaults(locationList)
  });
  const adjustmentProductId = adjustmentForm.watch('productId');
  const selectedAdjustmentProduct = useMemo(
    () => productById.get(String(adjustmentProductId)) || null,
    [adjustmentProductId, productById],
  );

  const resetAdjustmentDefaults = useCallback(() => adjustmentForm.reset(buildAdjustmentDefaults(locationList)), [adjustmentForm, locationList]);
  const resetDamagedDefaults = useCallback(() => damagedForm.reset(buildDamagedDefaults(locationList)), [damagedForm, locationList]);

  const adjustmentMutation = useInventoryAdjustmentMutation(resetAdjustmentDefaults);
  const damagedMutation = useDamagedStockMutation(resetDamagedDefaults);

  useEffect(() => {
    if (!SINGLE_STORE_MODE) return;
    if (!damagedForm.getValues('locationId') && locationList[0]?.id) {
      damagedForm.setValue('locationId', locationList[0].id);
    }
    if (!adjustmentForm.getValues('locationId') && locationList[0]?.id) {
      adjustmentForm.setValue('locationId', locationList[0].id);
    }
  }, [damagedForm, adjustmentForm, locationList]);


  const scrollDisclosureToView = useCallback((details: HTMLDetailsElement | null) => {
    if (!details) return;
    window.requestAnimationFrame(() => {
      details.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    });
  }, []);

  useEffect(() => {
    if (!selectedProduct || !selectedProductToken) return;
    if (lastPreparedAdjustmentTokenRef.current === selectedProductToken) return;
    lastPreparedAdjustmentTokenRef.current = selectedProductToken;
    const recommendedActionType = Number(selectedProduct.stock || 0) <= Number(selectedProduct.minStock || 0) ? 'add' : 'adjust';

    let defaultLocId = '';
    let defaultBranchId = '';
    if (!SINGLE_STORE_MODE) {
      const pStocks = locationStocks.filter(s => String(s.productId) === String(selectedProduct.id) && s.qty > 0);
      const stockRec = pStocks.length > 0 ? pStocks[0] : locationStocks.find(s => String(s.productId) === String(selectedProduct.id));
      if (stockRec) {
        defaultLocId = stockRec.locationId;
        const loc = locationList.find(l => String(l.id) === String(defaultLocId));
        if (loc) {
          defaultBranchId = loc.branchId ? String(loc.branchId) : '';
        }
      }
    }

    adjustmentForm.reset({
      ...buildAdjustmentDefaults(locationList, defaultLocId, defaultBranchId),
      productId: String(selectedProduct.id || ''),
      actionType: recommendedActionType,
      qty: recommendedActionType === 'adjust' ? Number(selectedProduct.stock || 0) : 0,
      reason: 'جرد مخزني',
    });
    adjustmentMutation.reset();
    if (adjustmentDisclosureRef.current && !adjustmentDisclosureRef.current.open) adjustmentDisclosureRef.current.open = true;
    scrollDisclosureToView(adjustmentDisclosureRef.current);
  }, [selectedProduct, selectedProductToken, adjustmentForm, adjustmentMutation, scrollDisclosureToView, locationList]);
  const damagedValues = damagedForm.watch();
  const adjustmentDraft = adjustmentForm.formState.isDirty;
  const damagedDraft = hasDamagedDraft(damagedValues, locationList);
  const hasAnyDraft = (adjustmentDraft || damagedDraft) && !adjustmentMutation.isPending && !damagedMutation.isPending;
  const canDiscardDrafts = useUnsavedChangesGuard(hasAnyDraft, 'لديك تغييرات غير محفوظة داخل إجراءات المخزون. هل تريد المتابعة وفقدان هذه التغييرات؟');

  const damagedProductId = damagedForm.watch('productId');
  const damagedQty = Number(damagedForm.watch('qty') || 0);
  const selectedDamagedProduct = useMemo(() => productById.get(String(damagedProductId)), [damagedProductId, productById]);
  const selectedLocationId = damagedForm.watch('locationId');
  const selectedLocationName = useMemo(() => {
    if (SINGLE_STORE_MODE) return locationList[0]?.name || '—';
    return locationById.get(String(selectedLocationId)) || '—';
  }, [locationById, locationList, selectedLocationId]);
  const branchOptions = useMemo(
    () => [
      { value: '', label: 'بدون فرع محدد' },
      ...branchList.map((branch) => ({ value: String(branch.id), label: branch.name })),
    ],
    [branchList],
  );

  const locationOptions = useMemo(
    () => [
      { value: '', label: 'بدون مخزن محدد' },
      ...locationList.map((location) => ({ value: String(location.id), label: location.name })),
    ],
    [locationList],
  );

  const remainingAfterDamage = useMemo(
    () => Math.max(0, Number(selectedDamagedProduct?.stock || 0) - damagedQty),
    [damagedQty, selectedDamagedProduct?.stock],
  );
  const resetAdjustmentForm = useCallback(() => {
    if (adjustmentDraft && !canDiscardDrafts()) return;
    resetAdjustmentDefaults();
    adjustmentMutation.reset();
  }, [adjustmentDraft, adjustmentMutation, canDiscardDrafts, resetAdjustmentDefaults]);

  const closeAdjustmentForm = useCallback(() => {
    resetAdjustmentDefaults();
    adjustmentMutation.reset();
    if (adjustmentDisclosureRef.current) adjustmentDisclosureRef.current.open = false;
  }, [adjustmentMutation, resetAdjustmentDefaults]);

  const handleAdjustmentToggle = useCallback((event: SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open) {
      scrollDisclosureToView(adjustmentDisclosureRef.current);
      return;
    }
    resetAdjustmentDefaults();
    adjustmentMutation.reset();
  }, [adjustmentMutation, resetAdjustmentDefaults, scrollDisclosureToView]);

  const resetDamagedForm = useCallback(() => {
    if (damagedDraft && !canDiscardDrafts()) return;
    resetDamagedDefaults();
    damagedMutation.reset();
  }, [canDiscardDrafts, damagedDraft, damagedMutation, resetDamagedDefaults]);

  return (
    <QueryFeedback
      isLoading={isCatalogLoading}
      isError={isCatalogError}
      error={catalogError}
      loadingText={t('inventory.inventory_actions_panel.s0', "جاري تجهيز أدوات المخزون...")}
      errorTitle={t('inventory.inventory_actions_panel.s1', "تعذر تحميل بيانات تشغيل المخزون")}
      isEmpty={!productList.length}
      emptyTitle={t('inventory.inventory_actions_panel.s2', "لا توجد أصناف لإجراء حركة مخزون")}
      emptyHint={t('inventory.inventory_actions_panel.s3', "أضف صنفًا واحدًا على الأقل قبل استخدام أدوات الجرد أو التالف.")}
    >
      <FormSection
        title={t('inventory.inventory_actions_panel.s4', "إجراءات تشغيلية متقدمة")}
        description={t('inventory.inventory_actions_panel.s5', "استخدمها فقط عند الحاجة: تسوية رصيد، أو تسجيل تالف مباشر، بدل وضعها في مقدمة الصفحة.")}
        actions={<span className="nav-pill">{t('inventory.inventory_actions_panel.s6', "إجراءات المخزون")}</span>}
      >
        <DraftStateNotice
          visible={hasAnyDraft}
          title={t('inventory.inventory_actions_panel.s7', "يوجد إدخال غير محفوظ داخل إجراءات المخزون")}
          hint={t('inventory.inventory_actions_panel.s8', "احفظ الحركة أو أعد ضبطها قبل مغادرة الصفحة أو التنقل إلى جزء آخر حتى لا تضيع البيانات المدخلة.")}
        />
        <div className="inventory-actions-disclosure-stack">
          <details
            ref={adjustmentDisclosureRef}
            className="inventory-action-disclosure"
            onToggle={handleAdjustmentToggle}
          >
            <summary>
              <div className="inventory-action-summary-copy">
                <strong>{t('inventory.inventory_actions_panel.s9', "تسوية / تعديل مخزون")}</strong>
                <span>{t('inventory.inventory_actions_panel.s10', "تصحيح الكمية أو إضافة/خصم سريع للصنف المحدد.")}</span>
              </div>
            </summary>
            <div className="form-grid inventory-action-form" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adjustmentForm.handleSubmit((values) => adjustmentMutation.mutate(values))(); } }}>
              <Field label={t('inventory.inventory_actions_panel.s11', "الصنف")} error={adjustmentForm.formState.errors.productId?.message}>
                <InventoryProductPicker
                  products={productList}
                  value={adjustmentProductId}
                  onChange={(productId) => {
                    adjustmentForm.setValue('productId', productId, { shouldDirty: true, shouldValidate: true });
                    const pStocks = locationStocks.filter(s => String(s.productId) === String(productId) && s.qty > 0);
                    const stockRec = pStocks.length > 0 ? pStocks[0] : locationStocks.find(s => String(s.productId) === String(productId));
                    if (stockRec && !SINGLE_STORE_MODE) {
                      adjustmentForm.setValue('locationId', stockRec.locationId, { shouldDirty: true });
                      const loc = locationList.find(l => String(l.id) === String(stockRec.locationId));
                      if (loc && loc.branchId) {
                        adjustmentForm.setValue('branchId', String(loc.branchId), { shouldDirty: true });
                      }
                    }
                  }}
                  disabled={adjustmentMutation.isPending || !canManageInventory}
                  showStock
                  showPrice={false}
                />
                {selectedAdjustmentProduct ? <div className="muted small">{t('inventory.inventory_actions_panel.s12', "تم تجهيز الصنف المحدد من جدول المتابعة لعمل تسوية أو إضافة/خصم سريع مباشرة.")}</div> : null}
              </Field>
              <Field label={t('inventory.inventory_actions_panel.s13', "نوع الحركة")}>
                <Controller
                  control={adjustmentForm.control}
                  name="actionType"
                  render={({ field }) => (
                    <CustomSelect
                      value={field.value}
                      onChange={(val) => {
                        field.onChange(val);
                        if (val === 'adjust') {
                          adjustmentForm.setValue('qty', Number(selectedAdjustmentProduct?.stock || 0));
                        } else {
                          adjustmentForm.setValue('qty', 0);
                        }
                      }}
                      options={ACTION_TYPE_OPTIONS}
                      disabled={adjustmentMutation.isPending || !canManageInventory}
                      placeholder={t('inventory.inventory_actions_panel.s14', "اختر نوع الحركة")}
                    />
                  )}
                />
              </Field>
              <Field label={t('inventory.inventory_actions_panel.s15', "الكمية")} error={adjustmentForm.formState.errors.qty?.message}><input type="number" min="0" step="0.001" {...adjustmentForm.register('qty')} disabled={adjustmentMutation.isPending || !canManageInventory} /></Field>
              <Field label={t('inventory.inventory_actions_panel.s16', "السبب")} error={adjustmentForm.formState.errors.reason?.message}><input {...adjustmentForm.register('reason')} disabled={adjustmentMutation.isPending || !canManageInventory} placeholder={t('inventory.inventory_actions_panel.s17', "مثال: جرد مخزني / توريد إضافي")} /></Field>
              {!SINGLE_STORE_MODE ? (
                <Field label={t('inventory.inventory_actions_panel.s18', "الفرع")}>
                  <Controller
                    control={adjustmentForm.control}
                    name="branchId"
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || ''}
                        onChange={(val) => field.onChange(val)}
                        options={branchOptions}
                        disabled={adjustmentMutation.isPending || !canManageInventory}
                        placeholder={t('inventory.inventory_actions_panel.s19', "بدون فرع محدد")}
                      />
                    )}
                  />
                </Field>
              ) : null}
              {SINGLE_STORE_MODE ? (
                <Field label={t('inventory.inventory_actions_panel.s20', "المخزن الأساسي")}><input value={locationList[0]?.name || t('inventory.inventory_actions_panel.s21', "سيتم الربط تلقائيًا بالمخزن الأساسي")} disabled readOnly /></Field>
              ) : (
                <Field label={t('inventory.inventory_actions_panel.s22', "المخزن")}>
                  <Controller
                    control={adjustmentForm.control}
                    name="locationId"
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || ''}
                        onChange={(val) => field.onChange(val)}
                        options={locationOptions}
                        disabled={adjustmentMutation.isPending || !canManageInventory}
                        placeholder={t('inventory.inventory_actions_panel.s23', "بدون مخزن محدد")}
                      />
                    )}
                  />
                  <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                    {t('inventory.inventory_actions_panel.s24', "* هذا الحقل يحدد مكان العملية فقط ولا يقوم بنقل أرصدة من مخازن أخرى.")}
                  </small>
                </Field>
              )}
              <Field label={t('inventory.inventory_actions_panel.s25', "ملاحظات")}><textarea rows={3} {...adjustmentForm.register('note')} disabled={adjustmentMutation.isPending || !canManageInventory} /></Field>
              {requireManagerForWriteOff ? (
                <Field label="كلمة مرور المدير المعتمد (عند الخصم / التخفيض)">
                  <input type="password" autoComplete="new-password" {...adjustmentForm.register('managerPin')} disabled={adjustmentMutation.isPending || !canManageInventory} placeholder="كلمة مرور حساب مدير محدد" />
                </Field>
              ) : null}
              {!canManageInventory ? <div className="muted small">{t('inventory.inventory_actions_panel.s26', "هذا الحساب يملك صلاحية متابعة المخزون فقط. تنفيذ التسويات والتالف يتطلب canAdjustInventory.")}</div> : null}
              <MutationFeedback isError={adjustmentMutation.isError} isSuccess={adjustmentMutation.isSuccess} error={adjustmentMutation.error} errorFallback={t('inventory.inventory_actions_panel.s27', "تعذر تنفيذ حركة المخزون")} successText={t('inventory.inventory_actions_panel.s28', "تم حفظ حركة المخزون وتحديث الرصيد بنجاح.")} />
              <div className="actions">
                <SubmitButton type="button" onClick={adjustmentForm.handleSubmit((values) => adjustmentMutation.mutate(values))} isPending={adjustmentMutation.isPending} disabled={!canManageInventory} idleText={t('inventory.inventory_actions_panel.s29', "حفظ حركة المخزون")} pendingText={t('inventory.inventory_actions_panel.s30', "جارٍ الحفظ...")} />
                <Button type="button" variant="secondary" disabled={adjustmentMutation.isPending || !canManageInventory} onClick={resetAdjustmentForm}>{t('inventory.inventory_actions_panel.s31', "تفريغ")}</Button>
                <Button type="button" variant="secondary" disabled={adjustmentMutation.isPending} onClick={closeAdjustmentForm}>{t('inventory.inventory_actions_panel.s32', "إلغاء وإغلاق")}</Button>
              </div>
            </div>
          </details>

          <details
            ref={damagedDisclosureRef}
            className="inventory-action-disclosure"
            onToggle={(event) => {
              if ((event.currentTarget as HTMLDetailsElement).open) scrollDisclosureToView(damagedDisclosureRef.current);
            }}
          >
            <summary>
              <div className="inventory-action-summary-copy">
                <strong>{t('inventory.inventory_actions_panel.s33', "تسجيل تالف مباشر")}</strong>
                <span>{t('inventory.inventory_actions_panel.s34', "سجّل التالف عند الحاجة مع بقاء الصفحة الأساسية مخصصة للمتابعة والبحث.")}</span>
              </div>
            </summary>
            <div className="form-grid inventory-action-form" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); damagedForm.handleSubmit((values) => damagedMutation.mutate(values))(); } }}>
              <Field label={t('inventory.inventory_actions_panel.s35', "الصنف")} error={damagedForm.formState.errors.productId?.message}>
                <InventoryProductPicker
                  products={productList}
                  value={damagedProductId}
                  onChange={(productId) => {
                    damagedForm.setValue('productId', productId, { shouldDirty: true, shouldValidate: true });
                    const pStocks = locationStocks.filter(s => String(s.productId) === String(productId) && s.qty > 0);
                    const stockRec = pStocks.length > 0 ? pStocks[0] : locationStocks.find(s => String(s.productId) === String(productId));
                    if (stockRec && !SINGLE_STORE_MODE) {
                      damagedForm.setValue('locationId', stockRec.locationId, { shouldDirty: true });
                      const loc = locationList.find(l => String(l.id) === String(stockRec.locationId));
                      if (loc && loc.branchId) {
                        damagedForm.setValue('branchId', String(loc.branchId), { shouldDirty: true });
                      }
                    }
                  }}
                  disabled={damagedMutation.isPending || !canManageInventory}
                  showStock
                  showPrice={false}
                />
              </Field>
              <Field label={t('inventory.inventory_actions_panel.s36', "الكمية")} error={damagedForm.formState.errors.qty?.message}><input type="number" min="0.001" step="0.001" {...damagedForm.register('qty')} disabled={damagedMutation.isPending || !canManageInventory} /></Field>
              <Field label={t('inventory.inventory_actions_panel.s37', "السبب")} error={damagedForm.formState.errors.reason?.message}><input {...damagedForm.register('reason')} disabled={damagedMutation.isPending || !canManageInventory} placeholder={t('inventory.inventory_actions_panel.s38', "مثال: كسر أثناء النقل / تلف صلاحية")} /></Field>
              {!SINGLE_STORE_MODE ? (
                <Field label={t('inventory.inventory_actions_panel.s39', "الفرع")}>
                  <Controller
                    control={damagedForm.control}
                    name="branchId"
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || ''}
                        onChange={(val) => field.onChange(val)}
                        options={branchOptions}
                        disabled={damagedMutation.isPending || !canManageInventory}
                        placeholder={t('inventory.inventory_actions_panel.s40', "بدون فرع محدد")}
                      />
                    )}
                  />
                </Field>
              ) : null}
              {SINGLE_STORE_MODE ? (
                <Field label={t('inventory.inventory_actions_panel.s41', "المخزن الأساسي")}><input value={locationList[0]?.name || t('inventory.inventory_actions_panel.s42', "سيتم الربط تلقائيًا بالمخزن الأساسي")} disabled readOnly /></Field>
              ) : (
                <Field label={t('inventory.inventory_actions_panel.s43', "المخزن")}>
                  <Controller
                    control={damagedForm.control}
                    name="locationId"
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || ''}
                        onChange={(val) => field.onChange(val)}
                        options={locationOptions}
                        disabled={damagedMutation.isPending || !canManageInventory}
                        placeholder={t('inventory.inventory_actions_panel.s44', "بدون مخزن محدد")}
                      />
                    )}
                  />
                  <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                    {t('inventory.inventory_actions_panel.s45', "* هذا الحقل يحدد مكان العملية فقط ولا يقوم بنقل أرصدة من مخازن أخرى.")}
                  </small>
                </Field>
              )}
              <Field label={t('inventory.inventory_actions_panel.s46', "ملاحظات وتفاصيل التلف (8 أحرف على الأقل)")} error={damagedForm.formState.errors.note?.message}><textarea rows={3} {...damagedForm.register('note')} disabled={damagedMutation.isPending || !canManageInventory} placeholder={t('inventory.inventory_actions_panel.s47', "تفاصيل التلف أو محضر الهالك...")} /></Field>
              {requireManagerForWriteOff ? (
                <Field label="كلمة مرور المدير المعتمد (مطلوبة لاعتماد التالف)">
                  <input type="password" autoComplete="new-password" {...damagedForm.register('managerPin')} disabled={damagedMutation.isPending || !canManageInventory} placeholder="كلمة مرور حساب مدير محدد" />
                </Field>
              ) : null}
              <div className="stats-grid compact-grid workspace-stats-grid inventory-damage-mini-grid" style={{ marginTop: 12 }}>
                <div className="stat-card"><span>{t('inventory.inventory_actions_panel.s48', "المخزون الحالي")}</span><strong>{selectedDamagedProduct ? selectedDamagedProduct.stock : 0}</strong></div>
                <div className="stat-card"><span>{t('inventory.inventory_actions_panel.s49', "الكمية التالفة")}</span><strong>{damagedQty || 0}</strong></div>
                <div className="stat-card"><span>{t('inventory.inventory_actions_panel.s50', "المتبقي بعد التسجيل")}</span><strong>{selectedDamagedProduct ? remainingAfterDamage : 0}</strong></div>
                <div className="stat-card"><span>{t('inventory.inventory_actions_panel.s51', "المخزن")}</span><strong>{selectedLocationName}</strong></div>
              </div>
              <MutationFeedback isError={damagedMutation.isError} isSuccess={damagedMutation.isSuccess} error={damagedMutation.error} errorFallback={t('inventory.inventory_actions_panel.s52', "تعذر تسجيل التالف")} successText={t('inventory.inventory_actions_panel.s53', "تم تسجيل التالف وتحديث المخزون بنجاح.")} />
              <div className="actions">
                <SubmitButton type="button" variant="danger" onClick={damagedForm.handleSubmit((values) => damagedMutation.mutate(values))} isPending={damagedMutation.isPending} disabled={!canManageInventory} idleText={t('inventory.inventory_actions_panel.s54', "تسجيل التالف")} pendingText={t('inventory.inventory_actions_panel.s55', "جارٍ التسجيل...")} />
                <Button type="button" variant="secondary" disabled={damagedMutation.isPending || !canManageInventory} onClick={resetDamagedForm}>{t('inventory.inventory_actions_panel.s56', "تفريغ")}</Button>
              </div>
            </div>
          </details>
        </div>
      </FormSection>
    </QueryFeedback>
  );
}

