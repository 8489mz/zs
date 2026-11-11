import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { Branch, Location, Product } from '@/types/domain';
import { useDamagedStockMutation, useInventoryAdjustmentMutation } from '@/features/inventory/hooks/useInventoryMutations';
import { inventoryApi } from '@/features/inventory/api/inventory.api';
import { resolveAdjustmentPrefill } from '@/features/inventory/lib/adjustment-prefill';
import { SINGLE_STORE_MODE } from '@/config/product-scope';
import {
  damagedStockSchema,
  inventoryAdjustmentSchema,
  type DamagedStockInput,
  type DamagedStockOutput,
  type InventoryAdjustmentInput,
  type InventoryAdjustmentOutput,
} from '@/features/inventory/schemas/inventory.schema';

const ACTION_TYPE_OPTIONS = [
  { value: 'adjust', label: 'تسوية إلى كمية نهائية' },
  { value: 'add', label: 'إضافة كمية للرصيد' },
  { value: 'deduct', label: 'خصم كمية من الرصيد' },
];

interface QuickStockAdjustmentDialogProps {
  open: boolean;
  onClose: () => void;
  product: Product | null;
  branches: Branch[];
  locations: Location[];
  locationStocks?: { productId: string; locationId: string; qty: number }[];
  canManageInventory?: boolean;
}

export function QuickStockAdjustmentDialog({
  open,
  onClose,
  product,
  branches = [],
  locations = [],
  locationStocks = [],
  canManageInventory = true,
}: QuickStockAdjustmentDialogProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'adjust' | 'damage'>('adjust');

  const adjustQtyInputRef = useRef<HTMLInputElement | null>(null);
  const damagedQtyInputRef = useRef<HTMLInputElement | null>(null);

  const unitName = useMemo(() => {
    if (!product?.units?.length) return 'قطعة';
    const baseUnit = product.units.find((u) => u.isBaseUnit) || product.units[0];
    return baseUnit?.name || 'قطعة';
  }, [product?.units]);

  const branchList = useMemo(() => (Array.isArray(branches) ? branches : []), [branches]);
  const locationList = useMemo(() => (Array.isArray(locations) ? locations : []), [locations]);

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

  // Forms
  const adjustmentForm = useForm<InventoryAdjustmentInput, undefined, InventoryAdjustmentOutput>({
    resolver: zodResolver(inventoryAdjustmentSchema),
    defaultValues: {
      productId: '',
      actionType: 'adjust',
      qty: 0,
      reason: 'جرد مخزني',
      note: '',
      branchId: '',
      locationId: SINGLE_STORE_MODE ? (locationList[0]?.id || '') : '',
    },
  });

  const damagedForm = useForm<DamagedStockInput, undefined, DamagedStockOutput>({
    resolver: zodResolver(damagedStockSchema),
    defaultValues: {
      productId: '',
      qty: 1,
      reason: 'كسر أثناء النقل / تلف مخزني',
      note: 'كسر أثناء النقل / تلف مخزني',
      branchId: '',
      locationId: SINGLE_STORE_MODE ? (locationList[0]?.id || '') : '',
    },
  });

  // Mutations with toast & auto-close
  const handleAdjustmentSuccess = useCallback(() => {
    toast.success('تم حفظ حركة المخزون وتحديث الرصيد بنجاح.');
    onClose();
  }, [onClose]);

  const handleDamagedSuccess = useCallback(() => {
    toast.success('تم تسجيل التالف وتحديث المخزون بنجاح.');
    onClose();
  }, [onClose]);

  const adjustmentMutation = useInventoryAdjustmentMutation(handleAdjustmentSuccess);
  const damagedMutation = useDamagedStockMutation(handleDamagedSuccess);

  // INV-ADJUST-SINGLE-QTY-BASIS: the `adjust` target is an AVAILABLE
  // quantity, so the dialog must prefill from the selected location's
  // available qty -- never from the global raw product.stock. The
  // live figure comes from the inventory availability read; while it
  // is pending (or failed) the selected location's raw qty is the
  // fallback, and only then the global stock. prefillQtyRef tracks
  // the last prefill so a late availability read only overwrites a
  // qty the user has not edited yet.
  const [locationAvailable, setLocationAvailable] = useState<number | null>(null);
  const prefillQtyRef = useRef<number>(0);
  const selectedLocationId = adjustmentForm.watch('locationId');
  const selectedLocationQty = useMemo(() => {
    if (!product || !selectedLocationId) return null;
    const row = locationStocks.find(
      (s) => String(s.productId) === String(product.id) && String(s.locationId) === String(selectedLocationId),
    );
    return row ? Number(row.qty || 0) : null;
  }, [product, selectedLocationId, locationStocks]);
  const currentStock = resolveAdjustmentPrefill({
    availableQty: locationAvailable,
    locationQty: selectedLocationQty,
    globalStock: product?.stock,
  });

  useEffect(() => {
    if (!open || !product) return;
    const productId = Number(product.id);
    if (!Number.isFinite(productId)) return;
    const locId = selectedLocationId ? Number(selectedLocationId) : null;
    let cancelled = false;
    inventoryApi
      .productAvailability(productId, locId != null && Number.isFinite(locId) ? locId : null)
      .then((availability) => {
        if (!cancelled) setLocationAvailable(Number(availability.availableAtLocation || 0));
      })
      .catch(() => {
        if (!cancelled) setLocationAvailable(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, product, selectedLocationId]);

  // When the live availability lands, adopt it as the prefill -- but
  // only if the user has not typed a qty of their own yet.
  useEffect(() => {
    if (!open || locationAvailable == null) return;
    if (adjustmentForm.getValues('actionType') !== 'adjust') return;
    if (Number(adjustmentForm.getValues('qty') || 0) !== prefillQtyRef.current) return;
    adjustmentForm.setValue('qty', locationAvailable);
    prefillQtyRef.current = locationAvailable;
  }, [open, locationAvailable, adjustmentForm]);

  // Initialize form when product changes or dialog opens
  useEffect(() => {
    if (!open || !product) return;

    setActiveTab('adjust');
    setLocationAvailable(null);

    let defaultLocId = '';
    let defaultBranchId = '';

    if (!SINGLE_STORE_MODE) {
      const pStocks = locationStocks.filter((s) => String(s.productId) === String(product.id) && s.qty > 0);
      const stockRec = pStocks.length > 0 ? pStocks[0] : locationStocks.find((s) => String(s.productId) === String(product.id));
      if (stockRec) {
        defaultLocId = stockRec.locationId;
        const loc = locationList.find((l) => String(l.id) === String(defaultLocId));
        if (loc?.branchId) defaultBranchId = String(loc.branchId);
      } else if (product.defaultLocationId) {
        defaultLocId = product.defaultLocationId;
        const loc = locationList.find((l) => String(l.id) === String(defaultLocId));
        if (loc?.branchId) defaultBranchId = String(loc.branchId);
      } else if (locationList.length > 0) {
        defaultLocId = String(locationList[0].id);
        if (locationList[0].branchId) defaultBranchId = String(locationList[0].branchId);
      }
    } else {
      defaultLocId = locationList[0]?.id ? String(locationList[0].id) : '';
      if (locationList[0]?.branchId) defaultBranchId = String(locationList[0].branchId);
    }

    // Opening prefill: the default location's raw qty until the live
    // availability read lands (the effect above then adopts it when
    // the qty is still untouched).
    const openingRow = defaultLocId
      ? locationStocks.find((s) => String(s.productId) === String(product.id) && String(s.locationId) === String(defaultLocId))
      : undefined;
    const openingStock = resolveAdjustmentPrefill({
      availableQty: null,
      locationQty: openingRow ? Number(openingRow.qty || 0) : null,
      globalStock: product.stock,
    });
    prefillQtyRef.current = openingStock;

    adjustmentForm.reset({
      productId: String(product.id),
      actionType: 'adjust',
      qty: openingStock,
      reason: 'جرد مخزني',
      note: '',
      branchId: defaultBranchId,
      locationId: defaultLocId,
    });

    damagedForm.reset({
      productId: String(product.id),
      qty: 1,
      reason: 'كسر أثناء النقل / تلف مخزني',
      note: 'كسر أثناء النقل / تلف مخزني',
      branchId: defaultBranchId,
      locationId: defaultLocId,
    });

    adjustmentMutation.reset();
    damagedMutation.reset();
  }, [open, product, locationStocks, locationList, adjustmentForm, damagedForm]);

  // AutoFocus & Select all text on Quantity input whenever modal opens or tab switches
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (activeTab === 'adjust') {
        adjustQtyInputRef.current?.focus();
        adjustQtyInputRef.current?.select();
      } else {
        damagedQtyInputRef.current?.focus();
        damagedQtyInputRef.current?.select();
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [open, activeTab]);

  // Live preview calculations (currentStock is the location's
  // available qty, derived above -- never the global raw stock)
  const adjustmentActionType = adjustmentForm.watch('actionType');
  const adjustmentQty = Number(adjustmentForm.watch('qty') || 0);

  const newStockAfterAdjustment = useMemo(() => {
    if (adjustmentActionType === 'adjust') return adjustmentQty;
    if (adjustmentActionType === 'add') return Number((currentStock + adjustmentQty).toFixed(3));
    if (adjustmentActionType === 'deduct') return Number(Math.max(0, currentStock - adjustmentQty).toFixed(3));
    return currentStock;
  }, [adjustmentActionType, adjustmentQty, currentStock]);

  const damagedQty = Number(damagedForm.watch('qty') || 0);
  const remainingAfterDamage = useMemo(
    () => Number(Math.max(0, currentStock - damagedQty).toFixed(3)),
    [currentStock, damagedQty],
  );

  const isSubmitting = adjustmentMutation.isPending || damagedMutation.isPending;

  const handleSubmit = () => {
    if (!canManageInventory) return;
    if (activeTab === 'adjust') {
      adjustmentForm.handleSubmit((values) => adjustmentMutation.mutate(values))();
    } else {
      damagedForm.handleSubmit((values) => damagedMutation.mutate(values))();
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('inventory.quick_stock_adjustment_dialog.s0', "تسوية وتعديل رصيد المخزون")}
      subtitle={product ? `الصنف: ${product.name} (الرصيد الحالي: ${currentStock})` : t('inventory.quick_stock_adjustment_dialog.s1', "إجراء حركة تسوية أو تسجيل تالف سريع للمخزون")}
      width="min(760px, 95vw)"
      minHeight="auto"
      footerActions={
        <StandardDialogFooter
          onCancel={onClose}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          submitText={activeTab === 'adjust' ? t('inventory.quick_stock_adjustment_dialog.s2', "حفظ حركة المخزون") : t('inventory.quick_stock_adjustment_dialog.s3', "تسجيل التالف")}
          cancelText={t('inventory.quick_stock_adjustment_dialog.s4', "إلغاء")}
          disabled={!canManageInventory}
        />
      }
    >
      <style>{`
        .quick-stock-modal .field {
          margin-bottom: 0 !important;
          gap: 3px !important;
        }
        .quick-stock-modal .field span {
          font-size: 0.74rem !important;
          font-weight: 600 !important;
          color: #334155 !important;
          white-space: nowrap !important;
        }
        .quick-stock-modal input,
        .quick-stock-modal textarea {
          height: 33px !important;
          font-size: 0.8125rem !important;
          border-radius: 6px !important;
          padding: 0 10px !important;
          border: 1px solid #cbd5e1 !important;
          background: #ffffff !important;
          box-sizing: border-box !important;
          outline: none !important;
          width: 100% !important;
        }
        .quick-stock-modal textarea {
          height: auto !important;
          min-height: 52px !important;
          padding: 6px 10px !important;
          resize: vertical !important;
        }
        .quick-stock-modal input:focus,
        .quick-stock-modal textarea:focus {
          border-color: #170e5e !important;
          box-shadow: 0 0 0 2px rgba(23, 14, 94, 0.1) !important;
        }
        .quick-stock-tab-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          transition: none;
          box-sizing: border-box;
        }
        .quick-stock-tab-active {
          background: #170e5e !important;
          color: #ffffff !important;
          border-color: #170e5e !important;
        }
        .quick-stock-tab-inactive {
          background: #f8fafc !important;
          color: #475569 !important;
          border-color: #e2e8f0 !important;
        }
        .quick-stock-tab-inactive:hover {
          background: #f1f5f9 !important;
          color: #0f172a !important;
        }
      `}</style>

      <div
        className="quick-stock-modal"
        style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
        dir="rtl"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const target = e.target as HTMLElement;
            if (target && target.tagName.toLowerCase() === 'textarea') return;
            e.preventDefault();
            handleSubmit();
          }
        }}
      >
        {/* 1. بطاقة ملخص الصنف */}
        {product && (
          <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#170e5e' }}>{product.name}</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                {t('inventory.quick_stock_adjustment_dialog.s5', "كود / باركود:")} <strong style={{ color: '#334155' }}>{product.barcode || product.styleCode || '—'}</strong>
                {product.categoryName ? <> {t('inventory.quick_stock_adjustment_dialog.s6', "• القسم:")} <strong style={{ color: '#334155' }}>{product.categoryName}</strong></> : null}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ textAlign: 'center', background: '#ffffff', padding: '4px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>{t('inventory.quick_stock_adjustment_dialog.s7', "الرصيد الحالي")}</div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: Number(currentStock || 0) <= 0 ? '#ef4444' : '#059669' }}>
                  {currentStock} <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>{unitName}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center', background: '#ffffff', padding: '4px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>{t('inventory.quick_stock_adjustment_dialog.s8', "الحد الأدنى")}</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#334155' }}>
                  {product.minStock || 0} <span style={{ fontSize: '0.72rem', fontWeight: 500, color: '#64748b' }}>{unitName}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. محدد نوع العملية (تبويبات 0ms بدون اهتزاز) */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`quick-stock-tab-btn ${activeTab === 'adjust' ? 'quick-stock-tab-active' : 'quick-stock-tab-inactive'}`}
            onClick={() => setActiveTab('adjust')}
          >
            <AppIcons.Sliders size={15} />
            {t('inventory.quick_stock_adjustment_dialog.s9', "تسوية وتعديل رصيد")}
          </button>
          <button
            type="button"
            className={`quick-stock-tab-btn ${activeTab === 'damage' ? 'quick-stock-tab-active' : 'quick-stock-tab-inactive'}`}
            onClick={() => setActiveTab('damage')}
          >
            <AppIcons.AlertCircle size={15} />
            {t('inventory.quick_stock_adjustment_dialog.s10', "تسجيل تالف مباشر")}
          </button>
        </div>

        {/* 3. محتوى التبويب: تسوية وتعديل رصيد */}
        {activeTab === 'adjust' ? (
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              <Field label={t('inventory.quick_stock_adjustment_dialog.s11', "نوع الحركة")}>
                <Controller
                  control={adjustmentForm.control}
                  name="actionType"
                  render={({ field }) => (
                    <CustomSelect
                      value={field.value}
                      onChange={(val) => {
                        field.onChange(val);
                        if (val === 'adjust') {
                          adjustmentForm.setValue('qty', currentStock);
                          prefillQtyRef.current = currentStock;
                        } else {
                          adjustmentForm.setValue('qty', 0);
                        }
                      }}
                      options={ACTION_TYPE_OPTIONS}
                      placeholder={t('inventory.quick_stock_adjustment_dialog.s12', "اختر نوع الحركة")}
                      disabled={isSubmitting || !canManageInventory}
                    />
                  )}
                />
              </Field>

              <Field label={`الكمية (${unitName})`} error={adjustmentForm.formState.errors.qty?.message}>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  {...adjustmentForm.register('qty')}
                  ref={(el) => {
                    adjustmentForm.register('qty').ref(el);
                    adjustQtyInputRef.current = el;
                  }}
                  disabled={isSubmitting || !canManageInventory}
                />
              </Field>

              <Field label={t('inventory.quick_stock_adjustment_dialog.s13', "السبب")} error={adjustmentForm.formState.errors.reason?.message}>
                <input
                  {...adjustmentForm.register('reason')}
                  placeholder={t('inventory.quick_stock_adjustment_dialog.s14', "مثال: جرد مخزني / تصحيح رصيد")}
                  disabled={isSubmitting || !canManageInventory}
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              {!SINGLE_STORE_MODE && (
                <Field label={t('inventory.quick_stock_adjustment_dialog.s15', "الفرع")}>
                  <Controller
                    control={adjustmentForm.control}
                    name="branchId"
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || ''}
                        onChange={(val) => field.onChange(val)}
                        options={branchOptions}
                        placeholder={t('inventory.quick_stock_adjustment_dialog.s16', "بدون فرع محدد")}
                        disabled={isSubmitting || !canManageInventory}
                      />
                    )}
                  />
                </Field>
              )}

              {SINGLE_STORE_MODE ? (
                <Field label={t('inventory.quick_stock_adjustment_dialog.s17', "المخزن")}>
                  <input value={locationList[0]?.name || t('inventory.quick_stock_adjustment_dialog.s18', "المخزن الرئيسي")} disabled readOnly />
                </Field>
              ) : (
                <Field label={t('inventory.quick_stock_adjustment_dialog.s19', "المخزن")}>
                  <Controller
                    control={adjustmentForm.control}
                    name="locationId"
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || ''}
                        onChange={(val) => {
                          field.onChange(val);
                          const loc = locationList.find((l) => String(l.id) === String(val));
                          if (loc?.branchId) adjustmentForm.setValue('branchId', String(loc.branchId));
                        }}
                        options={locationOptions}
                        placeholder={t('inventory.quick_stock_adjustment_dialog.s20', "بدون مخزن محدد")}
                        disabled={isSubmitting || !canManageInventory}
                      />
                    )}
                  />
                </Field>
              )}
            </div>

            <Field label={t('inventory.quick_stock_adjustment_dialog.s21', "ملاحظات (اختياري)")}>
              <textarea
                rows={2}
                {...adjustmentForm.register('note')}
                placeholder={t('inventory.quick_stock_adjustment_dialog.s22', "أي ملاحظات توثيقية إضافية حول سبب التسوية...")}
                disabled={isSubmitting || !canManageInventory}
              />
            </Field>

            {/* شريط معاينة الرصيد الجديد */}
            <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>{t('inventory.quick_stock_adjustment_dialog.s23', "الرصيد المتوقع بعد حفظ الحركة:")}</span>
              <strong style={{ fontSize: '0.95rem', color: newStockAfterAdjustment <= 0 ? '#ef4444' : '#170e5e' }}>
                {newStockAfterAdjustment} {unitName}
              </strong>
            </div>
          </div>
        ) : (
          /* 4. محتوى التبويب: تسجيل تالف مباشر */
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              <Field label={`الكمية التالفة (${unitName})`} error={damagedForm.formState.errors.qty?.message}>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  {...damagedForm.register('qty')}
                  ref={(el) => {
                    damagedForm.register('qty').ref(el);
                    damagedQtyInputRef.current = el;
                  }}
                  disabled={isSubmitting || !canManageInventory}
                />
              </Field>

              <Field label={t('inventory.quick_stock_adjustment_dialog.s24', "سبب التلف")} error={damagedForm.formState.errors.reason?.message}>
                <input
                  {...damagedForm.register('reason')}
                  placeholder={t('inventory.quick_stock_adjustment_dialog.s25', "مثال: كسر أثناء النقل / انتهاء صلاحية")}
                  disabled={isSubmitting || !canManageInventory}
                />
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              {!SINGLE_STORE_MODE && (
                <Field label={t('inventory.quick_stock_adjustment_dialog.s26', "الفرع")}>
                  <Controller
                    control={damagedForm.control}
                    name="branchId"
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || ''}
                        onChange={(val) => field.onChange(val)}
                        options={branchOptions}
                        placeholder={t('inventory.quick_stock_adjustment_dialog.s27', "بدون فرع محدد")}
                        disabled={isSubmitting || !canManageInventory}
                      />
                    )}
                  />
                </Field>
              )}

              {SINGLE_STORE_MODE ? (
                <Field label={t('inventory.quick_stock_adjustment_dialog.s28', "المخزن")}>
                  <input value={locationList[0]?.name || t('inventory.quick_stock_adjustment_dialog.s29', "المخزن الرئيسي")} disabled readOnly />
                </Field>
              ) : (
                <Field label={t('inventory.quick_stock_adjustment_dialog.s30', "المخزن")}>
                  <Controller
                    control={damagedForm.control}
                    name="locationId"
                    render={({ field }) => (
                      <CustomSelect
                        value={field.value || ''}
                        onChange={(val) => {
                          field.onChange(val);
                          const loc = locationList.find((l) => String(l.id) === String(val));
                          if (loc?.branchId) damagedForm.setValue('branchId', String(loc.branchId));
                        }}
                        options={locationOptions}
                        placeholder={t('inventory.quick_stock_adjustment_dialog.s31', "بدون مخزن محدد")}
                        disabled={isSubmitting || !canManageInventory}
                      />
                    )}
                  />
                </Field>
              )}
            </div>

            <Field label={t('inventory.quick_stock_adjustment_dialog.s32', "ملاحظات وتفاصيل التلف (8 أحرف على الأقل)")} error={damagedForm.formState.errors.note?.message}>
              <textarea
                rows={2}
                {...damagedForm.register('note')}
                placeholder={t('inventory.quick_stock_adjustment_dialog.s33', "تفاصيل التلف أو محضر الهالك...")}
                disabled={isSubmitting || !canManageInventory}
              />
            </Field>

            {/* شبكة إحصائيات التالف الفورية */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '2px' }}>
              <div style={{ background: '#ffffff', padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{t('inventory.quick_stock_adjustment_dialog.s34', "الرصيد الحالي")}</div>
                <strong style={{ fontSize: '0.88rem', color: '#334155' }}>{currentStock} {unitName}</strong>
              </div>
              <div style={{ background: '#ffffff', padding: '6px 10px', borderRadius: '6px', border: '1px solid #fee2e2', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#dc2626' }}>{t('inventory.quick_stock_adjustment_dialog.s35', "الكمية التالفة")}</div>
                <strong style={{ fontSize: '0.88rem', color: '#dc2626' }}>{damagedQty || 0} {unitName}</strong>
              </div>
              <div style={{ background: '#ffffff', padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#059669' }}>{t('inventory.quick_stock_adjustment_dialog.s36', "المتبقي بعد التسجيل")}</div>
                <strong style={{ fontSize: '0.88rem', color: remainingAfterDamage <= 0 ? '#ef4444' : '#059669' }}>
                  {remainingAfterDamage} {unitName}
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </StandardDialog>
  );
}
