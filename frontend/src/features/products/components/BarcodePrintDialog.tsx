import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { BarcodePrinterPicker } from '@/features/products/components/BarcodePrinterPicker';
import { BarcodeBatchItemsPanel } from '@/features/products/components/BarcodeBatchItemsPanel';
import { BarcodeFoodStatementSection, getFutureDate } from '@/features/products/components/BarcodeFoodStatementSection';
import {
  buildBarcodePreviewHtml,
  DEFAULT_BARCODE_PRINT_PRESET_ID,
  DEFAULT_THERMAL_ROTATE_DEG,
  getBarcodeCardData,
  getBarcodePrintPreset,
  getBarcodePrintPresetsByFamily,
  printBatchBarcodeLabels,
  sanitizeCustomDimensions,
  type BarcodeCurrencyFormat,
  type BarcodePrintCustomization,
  type BarcodePrintFamily,
  type BarcodePrintItem,
  type BarcodeRotationDeg,
} from '@/lib/barcode-labels';
import { useAuthStore } from '@/stores/auth-store';
import type { Product, ProductUnit } from '@/types/domain';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { shouldShowExpiryDateField } from '@/features/products/utils/product-visibility.utils';

export interface BarcodePrintDialogProps {
  open: boolean;
  product?: Product | null;
  unit?: ProductUnit | null;
  items?: BarcodePrintItem[];
  onClose: () => void;
}

const FAMILY_OPTIONS = [
  { value: 'thermal', label: 'طابعة حرارية رول (Thermal Label)' },
  { value: 'sheet', label: 'ورق لاصق A4 (Sticker Sheet)' },
];

const ROTATION_OPTIONS = [
  { value: '180', label: '180° — اتجاه الطباعة الحرارية القياسي (معتدل)' },
  { value: '0', label: '0° — بدون قلب (لبعض الطابعات / A4)' },
  { value: '90', label: '90° — تدوير عرضي' },
  { value: '270', label: '270° — تدوير عرضي عكسي' },
];

const CURRENCY_FORMAT_OPTIONS: Array<{ value: BarcodeCurrencyFormat; label: string }> = [
  { value: 'code', label: 'كود (EGP / SAR)' },
  { value: 'symbol', label: 'رمز (ج.م / ر.س)' },
  { value: 'none', label: 'بدون عملة' },
];

const BARCODE_PREFS_STORAGE_KEY = 'z_erp_barcode_print_prefs_v3';

interface StoredBarcodePrefs {
  family?: BarcodePrintFamily;
  presetId?: string;
  customWidthMm?: number;
  customHeightMm?: number;
  rotateDeg?: BarcodeRotationDeg;
  currencyFormat?: BarcodeCurrencyFormat;
  showStoreName?: boolean;
  showProductName?: boolean;
  showPrice?: boolean;
  showUnit?: boolean;
  showBarcodeText?: boolean;
  showSku?: boolean;
  showVariant?: boolean;
}

function loadStoredBarcodePrefs(): StoredBarcodePrefs {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(BARCODE_PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredBarcodePrefs(prefs: StoredBarcodePrefs) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BARCODE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function BarcodePrintDialog({ open, product, unit, items, onClose }: BarcodePrintDialogProps) {
  const { t } = useTranslation();
  const currentStoreName = useAuthStore((state) => state.storeName || state.tenant?.businessName || 'متجرنا');
  const settingsQuery = useSettingsQuery();
  const showFoodStatementCard = shouldShowExpiryDateField({ settings: settingsQuery.data });

  const [family, setFamily] = useState<BarcodePrintFamily>('thermal');
  const [presetId, setPresetId] = useState(DEFAULT_BARCODE_PRINT_PRESET_ID);
  const [customWidthMm, setCustomWidthMm] = useState(40);
  const [customHeightMm, setCustomHeightMm] = useState(30);
  const [rotateDeg, setRotateDeg] = useState<BarcodeRotationDeg>(DEFAULT_THERMAL_ROTATE_DEG);
  const [copies, setCopies] = useState(8);
  const [labelsPerPage, setLabelsPerPage] = useState(24);
  const [startOffset, setStartOffset] = useState(1);
  const [previewMode, setPreviewMode] = useState<'single' | 'sheet'>('single');
  const previewRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  // Multi-item batch state
  const [batchItems, setBatchItems] = useState<BarcodePrintItem[]>([]);
  const [activeItemIndex, setActiveItemIndex] = useState(0);

  // Sticker customization options
  const [showStoreName, setShowStoreName] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [showProductName, setShowProductName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [currencyFormat, setCurrencyFormat] = useState<BarcodeCurrencyFormat>('code');
  const [showUnit, setShowUnit] = useState(true);
  const [showBarcodeText, setShowBarcodeText] = useState(true);
  const [showSku, setShowSku] = useState(false);
  const [showVariant, setShowVariant] = useState(true);

  // متطلبات التموين وحماية المستهلك (بطاقة بيان السلع الغذائية والمعبأة)
  const [showFoodStatement, setShowFoodStatement] = useState(false);
  const [showProductionDate, setShowProductionDate] = useState(false);
  const [productionDate, setProductionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [packagingDate, setPackagingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiryType, setExpiryType] = useState<'period' | 'date'>('period');
  const [expiryPeriodMonths, setExpiryPeriodMonths] = useState(6);
  const [expiryDate, setExpiryDate] = useState(() => getFutureDate(6));
  const [showNetWeight, setShowNetWeight] = useState(false);
  const [netWeightText, setNetWeightText] = useState('');
  const [foodStatementNote, setFoodStatementNote] = useState('');

  // Initialize state when modal opens (restoring saved label prefs)
  useEffect(() => {
    if (!open) return;
    const saved = loadStoredBarcodePrefs();
    const initialFamily: BarcodePrintFamily = saved.family === 'sheet' ? 'sheet' : 'thermal';
    const familyPresets = getBarcodePrintPresetsByFamily(initialFamily);
    const resolvedPresetId = saved.presetId && familyPresets.some((p) => p.id === saved.presetId)
      ? saved.presetId
      : (initialFamily === 'thermal' ? DEFAULT_BARCODE_PRINT_PRESET_ID : familyPresets[0]?.id || DEFAULT_BARCODE_PRINT_PRESET_ID);
    const sanitizedDims = sanitizeCustomDimensions({ widthMm: saved.customWidthMm, heightMm: saved.customHeightMm });
    const initialPreset = getBarcodePrintPreset(resolvedPresetId, sanitizedDims);
    const initialRot: BarcodeRotationDeg = saved.rotateDeg === 0 || saved.rotateDeg === 90 || saved.rotateDeg === 180 || saved.rotateDeg === 270 ? saved.rotateDeg : DEFAULT_THERMAL_ROTATE_DEG;
    const initialCurrency: BarcodeCurrencyFormat = saved.currencyFormat === 'symbol' || saved.currencyFormat === 'none' ? saved.currencyFormat : 'code';

    setFamily(initialFamily);
    setPresetId(resolvedPresetId);
    setCustomWidthMm(sanitizedDims.widthMm);
    setCustomHeightMm(sanitizedDims.heightMm);
    setRotateDeg(initialRot);
    setLabelsPerPage(initialPreset.maxLabelsPerPage);
    const defaultProductCopies = product && Number(product.stock) > 0 ? Number(product.stock) : 8;
    setCopies(initialFamily === 'thermal' ? defaultProductCopies : Math.min(24, initialPreset.maxLabelsPerPage));
    setStartOffset(1);
    setPreviewMode(initialFamily === 'thermal' && !(items && items.length > 1) ? 'single' : 'sheet');
    setStoreName(currentStoreName || '');
    setShowStoreName(saved.showStoreName ?? true);
    setShowProductName(saved.showProductName ?? true);
    setShowPrice(saved.showPrice ?? true);
    setCurrencyFormat(initialCurrency);
    setShowUnit(saved.showUnit ?? true);
    setShowBarcodeText(saved.showBarcodeText ?? true);
    setShowSku(saved.showSku ?? Boolean(product?.sku || product?.styleCode || items?.some((it) => it.product?.sku || it.product?.styleCode)));
    setShowVariant(saved.showVariant ?? true);

    // Reset Food Statement defaults
    setShowFoodStatement(false);
    setShowProductionDate(false);
    setProductionDate(new Date().toISOString().slice(0, 10));
    setPackagingDate(new Date().toISOString().slice(0, 10));
    setExpiryType('period');
    setExpiryPeriodMonths(6);
    setExpiryDate(getFutureDate(6));
    setShowNetWeight(false);
    setNetWeightText(unit?.name || '1 كجم');
    setFoodStatementNote('يحفظ في مكان جاف وبارد');

    if (items && items.length > 0) {
      setBatchItems(items.map((it) => ({ ...it, copies: Math.max(0, Number(it.copies ?? 1)) })));
      setActiveItemIndex(0);
    } else if (product) {
      setBatchItems([{ product, unit, copies: defaultProductCopies }]);
      setActiveItemIndex(0);
    } else {
      setBatchItems([]);
      setActiveItemIndex(0);
    }
  }, [open, product?.id, unit?.id, currentStoreName, product?.styleCode, items]);

  const isBatchMode = batchItems.length > 1 || (Boolean(items && items.length > 1) && batchItems.length > 0);
  const activeItem = batchItems[activeItemIndex] || batchItems[0] || (product ? { product, unit, copies } : null);
  const activeProduct = activeItem?.product || product;
  const activeUnit = activeItem?.unit || unit;
  const zeroStockBatchCount = useMemo(
    () => batchItems.filter((it) => Number(it.product?.stock ?? 0) <= 0).length,
    [batchItems]
  );
  const canPruneZeroStock = zeroStockBatchCount > 0 && zeroStockBatchCount < batchItems.length;
  const hasVariantInfo = useMemo(
    () => Boolean(activeProduct?.color || activeProduct?.size || batchItems.some((it) => Boolean(it.product?.color || it.product?.size))),
    [activeProduct?.color, activeProduct?.size, batchItems]
  );

  const totalCopies = useMemo(() => {
    if (isBatchMode) {
      return batchItems.reduce((acc, it) => acc + Math.max(0, Number(it.copies ?? 0)), 0);
    }
    return copies;
  }, [isBatchMode, batchItems, copies]);

  const customDimensions = useMemo(
    () => sanitizeCustomDimensions({ widthMm: customWidthMm, heightMm: customHeightMm }),
    [customWidthMm, customHeightMm]
  );

  // Persist user preferences when changed while dialog is open
  useEffect(() => {
    if (!open) return;
    saveStoredBarcodePrefs({
      family,
      presetId,
      customWidthMm: customDimensions.widthMm,
      customHeightMm: customDimensions.heightMm,
      rotateDeg,
      currencyFormat,
      showStoreName,
      showProductName,
      showPrice,
      showUnit,
      showBarcodeText,
      showSku,
      showVariant,
    });
  }, [
    open,
    family,
    presetId,
    customDimensions.widthMm,
    customDimensions.heightMm,
    rotateDeg,
    currencyFormat,
    showStoreName,
    showProductName,
    showPrice,
    showUnit,
    showBarcodeText,
    showSku,
    showVariant,
  ]);

  const presetOptions = useMemo(() => getBarcodePrintPresetsByFamily(family), [family]);
  const preset = useMemo(() => getBarcodePrintPreset(presetId, customDimensions), [presetId, customDimensions]);
  const card = useMemo(() => (activeProduct ? getBarcodeCardData(activeProduct, activeUnit, currencyFormat) : null), [activeProduct, activeUnit, currencyFormat]);

  const customization: BarcodePrintCustomization = useMemo(
    () => ({
      showStoreName,
      storeName: (storeName || currentStoreName || '').trim(),
      showProductName,
      showPrice,
      currencyFormat,
      showUnit,
      showBarcodeText,
      showSku,
      showVariant,
      showFoodStatement,
      showProductionDate,
      productionDate,
      packagingDate,
      expiryType,
      expiryPeriodMonths,
      expiryDate,
      showNetWeight,
      netWeightText: (netWeightText || '').trim(),
      foodStatementNote: (foodStatementNote || '').trim(),
    }),
    [
      showStoreName,
      storeName,
      currentStoreName,
      showProductName,
      showPrice,
      currencyFormat,
      showUnit,
      showBarcodeText,
      showSku,
      showVariant,
      showFoodStatement,
      showProductionDate,
      productionDate,
      packagingDate,
      expiryType,
      expiryPeriodMonths,
      expiryDate,
      showNetWeight,
      netWeightText,
      foodStatementNote,
    ]
  );

  const previewHtml = useMemo(
    () =>
      activeProduct
        ? buildBarcodePreviewHtml({
            product: activeProduct,
            unit: activeUnit,
            presetId,
            labelsPerPage,
            startOffset,
            previewMode,
            customization,
            items: isBatchMode ? batchItems : undefined,
            customDimensions,
            rotateDeg,
          })
        : '',
    [activeProduct, activeUnit, presetId, labelsPerPage, startOffset, previewMode, customization, isBatchMode, batchItems, customDimensions, rotateDeg]
  );

  const presetSelectOptions = useMemo(
    () => presetOptions.map((option) => ({ value: option.id, label: option.label })),
    [presetOptions]
  );

  const selectedBatchCount = useMemo(
    () => batchItems.filter((it) => Number(it.copies ?? 0) > 0).length,
    [batchItems]
  );

  useEffect(() => {
    const firstPreset = presetOptions[0];
    if (!firstPreset) return;
    if (!presetOptions.some((entry) => entry.id === presetId)) {
      const fallback = family === 'thermal' ? getBarcodePrintPreset(DEFAULT_BARCODE_PRINT_PRESET_ID, customDimensions) : firstPreset;
      setPresetId(fallback.id);
      setLabelsPerPage(fallback.maxLabelsPerPage);
      setCopies(family === 'thermal' ? 8 : Math.min(24, fallback.maxLabelsPerPage));
    }
  }, [presetId, presetOptions, family, customDimensions]);

  if (!activeProduct || !card) return null;

  const handlePrint = () => {
    const effectiveItems: BarcodePrintItem[] = isBatchMode
      ? batchItems
      : [{ product: activeProduct, unit: activeUnit, copies }];

    printBatchBarcodeLabels(
      effectiveItems,
      { presetId, copies: totalCopies, labelsPerPage, startOffset, customDimensions, rotateDeg },
      customization,
      { settings: settingsQuery.data }
    );
  };

  const handleReset = () => {
    setPresetId(DEFAULT_BARCODE_PRINT_PRESET_ID);
    const defaultPreset = getBarcodePrintPreset(DEFAULT_BARCODE_PRINT_PRESET_ID);
    setFamily(defaultPreset.family);
    setCustomWidthMm(40);
    setCustomHeightMm(30);
    setRotateDeg(DEFAULT_THERMAL_ROTATE_DEG);
    setCopies(defaultPreset.family === 'thermal' ? 8 : Math.min(24, defaultPreset.maxLabelsPerPage));
    setLabelsPerPage(defaultPreset.maxLabelsPerPage);
    setStartOffset(1);
    setPreviewMode('single');
    setStoreName(currentStoreName || '');
    setShowStoreName(true);
    setShowProductName(true);
    setShowPrice(true);
    setCurrencyFormat('code');
    setShowUnit(true);
    setShowBarcodeText(true);
    setShowSku(Boolean(activeProduct?.sku));
    setShowVariant(true);
    setShowFoodStatement(false);
    setShowProductionDate(false);
    setProductionDate(new Date().toISOString().slice(0, 10));
    setPackagingDate(new Date().toISOString().slice(0, 10));
    setExpiryType('period');
    setExpiryPeriodMonths(6);
    setExpiryDate(getFutureDate(6));
    setShowNetWeight(false);
    setNetWeightText(activeUnit?.name || '1 كجم');
    setFoodStatementNote('يحفظ في مكان جاف وبارد');
  };

  // Quick batch adjustments
  const setAllCopies = (qty: number) => {
    const safeQty = Math.max(0, Math.round(Number(qty || 0)));
    setBatchItems((current) => current.map((it) => ({ ...it, copies: safeQty })));
  };

  const setAllCopiesByStock = () => {
    setBatchItems((current) =>
      current.map((it) => ({ ...it, copies: Math.max(0, Number(it.product?.stock ?? 0)) }))
    );
  };

  const adjustAllCopies = (delta: number) => {
    setBatchItems((current) =>
      current.map((it) => ({ ...it, copies: Math.max(0, Number(it.copies ?? 0) + delta) }))
    );
  };

  const toggleItemIncluded = (index: number) => {
    setBatchItems((current) =>
      current.map((it, idx) => {
        if (idx !== index) return it;
        const currentQty = Math.max(0, Number(it.copies ?? 0));
        if (currentQty > 0) return { ...it, copies: 0 };
        const fallbackStock = Math.max(1, Number(it.product?.stock || 1));
        return { ...it, copies: fallbackStock };
      })
    );
  };

  const selectOnlyItem = (index: number) => {
    setBatchItems((current) =>
      current.map((it, idx) => {
        if (idx !== index) return { ...it, copies: 0 };
        const existingQty = Math.max(0, Number(it.copies ?? 0));
        return { ...it, copies: existingQty > 0 ? existingQty : 1 };
      })
    );
    setActiveItemIndex(index);
  };

  const removeZeroStockItems = () => {
    const remaining = batchItems.filter((it) => Number(it.product?.stock ?? 0) > 0);
    if (remaining.length === 0 || remaining.length === batchItems.length) return;
    setBatchItems(remaining);
    setActiveItemIndex(0);
    if (remaining.length === 1) {
      setCopies(Math.max(1, Number(remaining[0].copies || 1)));
    }
  };

  const updateItemCopies = (index: number, newCopies: number) => {
    const safeCopies = Math.max(0, Math.round(Number(newCopies || 0)));
    setBatchItems((current) =>
      current.map((it, idx) => (idx === index ? { ...it, copies: safeCopies } : it))
    );
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('products.barcode_print_dialog.s0', "توليد وطباعة ملصقات الباركود والرف (Barcode & Shelf Labeling)")}
      subtitle={
        isBatchMode
          ? `طباعة مجمعة: ${selectedBatchCount} من ${batchItems.length} صنف · إجمالي ${totalCopies} ملصق`
          : `${activeProduct.name || activeProduct.nameEn || '-'} · ${card.unit?.name || t('products.barcode_print_dialog.s1', "قطعة")} · باركود: ${card.barcode || t('products.barcode_print_dialog.s2', "بدون باركود")}`
      }
      width={isBatchMode ? 'min(1260px, 96vw)' : 'min(1160px, 96vw)'}
      height="min(650px, 92vh)"
      compact
      bodyStyle={{ overflow: 'hidden', padding: '12px 16px' }}
      footerActions={
        <StandardDialogFooter
          cancelText={t('products.barcode_print_dialog.s3', "إغلاق")}
          onCancel={onClose}
          submitText={`طباعة الآن (${totalCopies} ${family === 'thermal' ? t('products.barcode_print_dialog.s4', "ملصق") : t('products.barcode_print_dialog.s5', "نسخة")})`}
          onSubmit={handlePrint}
          submitDisabled={isBatchMode ? totalCopies <= 0 : !card.barcode}
        />
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isBatchMode ? '1.05fr 0.95fr 0.95fr' : '1.05fr 1fr',
          gap: '14px',
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
        }}
        dir="rtl"
      >
        {/* العمود الأيمن: إعدادات الطابعة والورق وتخصيص الملصق */}
        <div
          ref={settingsRef}
          onWheel={(e) => {
            const settingsEl = settingsRef.current;
            if (settingsEl && settingsEl.scrollHeight > settingsEl.clientHeight) {
              settingsEl.scrollTop += e.deltaY;
            }
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            height: '100%',
            minHeight: 0,
            overflowY: 'auto',
            paddingInlineEnd: '4px',
          }}
          className="thin-scrollbar"
        >
          {/* 1. إعدادات الطابعة والمقاس */}
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
                <AppIcons.Printer size={15} />
                <span>{t('products.barcode_print_dialog.s6', "1. إعدادات الطابعة والمقاس")}</span>
              </div>
              <span className="nav-pill" style={{ fontSize: '0.72rem' }}>{preset.pageLabel}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <Field label={t('products.barcode_print_dialog.s7', "نوع الطباعة")}>
                <CustomSelect
                  value={family}
                  options={FAMILY_OPTIONS}
                  onChange={(val) => {
                    const nextFamily = val === 'sheet' ? 'sheet' : 'thermal';
                    setFamily(nextFamily);
                    setPreviewMode(nextFamily === 'thermal' && !isBatchMode ? 'single' : 'sheet');
                    const nextPreset = nextFamily === 'thermal'
                      ? getBarcodePrintPreset(DEFAULT_BARCODE_PRINT_PRESET_ID, customDimensions)
                      : getBarcodePrintPresetsByFamily(nextFamily)[0];
                    if (nextPreset) {
                      setPresetId(nextPreset.id);
                      setLabelsPerPage(nextPreset.maxLabelsPerPage);
                      setCopies(nextFamily === 'thermal' ? 8 : Math.max(1, Math.min(24, nextPreset.maxLabelsPerPage)));
                    }
                  }}
                />
              </Field>

              <Field label={t('products.barcode_print_dialog.s8', "Preset المقاس المعتمد")}>
                <CustomSelect
                  value={presetId}
                  options={presetSelectOptions}
                  onChange={(val) => {
                    const nextPreset = getBarcodePrintPreset(val, customDimensions);
                    setPresetId(nextPreset.id);
                    setLabelsPerPage(nextPreset.maxLabelsPerPage);
                    if (family === 'sheet') {
                      setCopies(Math.max(1, Math.min(copies, nextPreset.maxLabelsPerPage)));
                    }
                  }}
                />
              </Field>

              {family === 'thermal' && presetId === 'thermal-custom' && (
                <>
                  <Field label="عرض الملصق (مم)">
                    <input
                      type="number"
                      min="20"
                      max="120"
                      step="0.5"
                      value={customWidthMm}
                      onChange={(e) => setCustomWidthMm(Number(e.target.value || 40))}
                      style={{ height: '32px', fontSize: '0.82rem' }}
                    />
                  </Field>
                  <Field label="ارتفاع الملصق (مم)">
                    <input
                      type="number"
                      min="15"
                      max="150"
                      step="0.5"
                      value={customHeightMm}
                      onChange={(e) => setCustomHeightMm(Number(e.target.value || 30))}
                      style={{ height: '32px', fontSize: '0.82rem' }}
                    />
                  </Field>
                </>
              )}

              {!isBatchMode && (
                <Field label={family === 'thermal' ? t('products.barcode_print_dialog.s9', "عدد الملصقات المطلوب طباعتها") : t('products.barcode_print_dialog.s10', "إجمالي عدد النسخ")}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={copies}
                      onChange={(event) => setCopies(Math.max(1, Number(event.target.value || 1)))}
                      style={{ height: '32px', fontSize: '0.82rem', flex: 1 }}
                    />
                    {activeProduct && (
                      <button
                        type="button"
                        onClick={() => {
                          const stockVal = Number(activeProduct.stock ?? 0);
                          setCopies(stockVal > 0 ? stockVal : 1);
                        }}
                        style={{
                          height: '32px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '0 8px',
                          whiteSpace: 'nowrap',
                          border: '1px solid #170e5e',
                          borderRadius: '4px',
                          background: '#eff6ff',
                          color: '#170e5e',
                          cursor: 'pointer'
                        }}
                        title={`ضبط الكمية لتطابق رصيد المخزن الحالي (${activeProduct.stock ?? 0} قطعة)`}
                      >
                        حسب رصيد المخزن ({activeProduct.stock ?? 0})
                      </button>
                    )}
                  </div>
                </Field>
              )}

              {family === 'sheet' ? (
                <Field label={t('products.barcode_print_dialog.s11', "البدء من الملصق رقم")}>
                  <input
                    type="number"
                    min="1"
                    max={preset.maxLabelsPerPage}
                    value={startOffset}
                    onChange={(event) =>
                      setStartOffset(Math.max(1, Math.min(preset.maxLabelsPerPage, Number(event.target.value || 1))))
                    }
                    title={t('products.barcode_print_dialog.s12', "لتفادي إهدار ورق A4 عند استهلاك بعض الملصقات من الورقة سابقاً")}
                    style={{ height: '32px', fontSize: '0.82rem' }}
                  />
                </Field>
              ) : (
                <Field label="اتجاه الطباعة / التدوير">
                  <CustomSelect
                    value={String(rotateDeg)}
                    options={ROTATION_OPTIONS}
                    onChange={(val) => {
                      const n = Number(val);
                      setRotateDeg(n === 90 || n === 180 || n === 270 ? n : 0);
                    }}
                  />
                </Field>
              )}

              {family === 'sheet' && (
                <Field label={t('products.barcode_print_dialog.s15', "عدد الملصقات بالصفحة")}>
                  <input
                    type="number"
                    min="1"
                    max={preset.maxLabelsPerPage}
                    value={labelsPerPage}
                    onChange={(event) =>
                      setLabelsPerPage(Math.max(1, Math.min(preset.maxLabelsPerPage, Number(event.target.value || 1))))
                    }
                    style={{ height: '32px', fontSize: '0.82rem' }}
                  />
                </Field>
              )}

              {family === 'sheet' && (
                <Field label={t('products.barcode_print_dialog.s16', "نوع التغذية والورق")}>
                  <input
                    value={`ورق A4 لاصق (${preset.columns} أعمدة)`}
                    readOnly
                    disabled
                    style={{ height: '32px', fontSize: '0.82rem', background: '#f1f5f9' }}
                  />
                </Field>
              )}
            </div>

            <div
              style={{
                marginTop: '6px',
                padding: '4px 8px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                fontSize: '0.72rem',
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>
                {t('products.barcode_print_dialog.s27', "المقاس:")} <strong>{preset.labelWidthMm} × {preset.labelHeightMm} {t('products.barcode_print_dialog.s28', "مم")}</strong>
              </span>
              <span>
                {family === 'thermal'
                  ? `رول حراري · ${totalCopies} ملصق${rotateDeg ? ` · تدوير ${rotateDeg}°` : ''}`
                  : `الصفحات: ${Math.ceil((totalCopies + (startOffset - 1)) / labelsPerPage)} ورقة A4`}
              </span>
            </div>

            <BarcodePrinterPicker open={open} settings={settingsQuery.data} />

            {family === 'thermal' && (
              <div
                style={{
                  marginTop: '6px',
                  padding: '6px 9px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '6px',
                  fontSize: '0.71rem',
                  color: '#1e3a8a',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '6px',
                  lineHeight: 1.45,
                }}
              >
                <AppIcons.Info size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  للطباعة الحرارية السليمة: من نافذة الطباعة اجعل <strong>Margins: None</strong> وألغِ <strong>Headers and footers</strong>، وطابق مقاس الورق الفعلي للرول في تعريف الطابعة مع (<strong>{preset.labelWidthMm}×{preset.labelHeightMm} مم</strong>) (أشهر رول صغير <strong>38×25 مم</strong>). لو خرج الملصق مقلوباً بدّل بين <strong>180°</strong> و <strong>0°</strong>.
                </span>
              </div>
            )}
          </div>

          {/* 2. تخصيص محتويات الملصق */}
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem', marginBottom: '8px' }}>
              <AppIcons.Sliders size={15} />
              <span>{t('products.barcode_print_dialog.s29', "2. تخصيص محتويات وبيانات الملصق")}</span>
            </div>

            {/* سطر اسم المنشأة */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
                background: '#ffffff',
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#1e293b',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <input
                  type="checkbox"
                  checked={showStoreName}
                  onChange={(e) => setShowStoreName(e.target.checked)}
                  style={{ accentColor: '#170e5e', width: '15px', height: '15px', cursor: 'pointer' }}
                />
                <span>{t('products.barcode_print_dialog.s30', "اسم المنشأة:")}</span>
              </label>
              {showStoreName && (
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder={t('products.barcode_print_dialog.s31', "اسم المتجر أو الشركة المطبوع أعلى الملصق")}
                  style={{ flex: 1, height: '28px', fontSize: '0.76rem', padding: '2px 8px' }}
                />
              )}
            </div>

            {/* شبكة خيارات العناصر */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                background: '#ffffff',
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#1e293b', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showProductName}
                  onChange={(e) => setShowProductName(e.target.checked)}
                  style={{ accentColor: '#170e5e', width: '15px', height: '15px', cursor: 'pointer' }}
                />
                <span>{t('products.barcode_print_dialog.s32', "اسم المنتج")}</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#1e293b', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showPrice}
                  onChange={(e) => setShowPrice(e.target.checked)}
                  style={{ accentColor: '#170e5e', width: '15px', height: '15px', cursor: 'pointer' }}
                />
                <span>{t('products.barcode_print_dialog.s33', "السعر المالي والعملة")}</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#1e293b', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showUnit}
                  onChange={(e) => setShowUnit(e.target.checked)}
                  style={{ accentColor: '#170e5e', width: '15px', height: '15px', cursor: 'pointer' }}
                />
                <span>{t('products.barcode_print_dialog.s34', "اسم الوحدة (")}{card.unit?.name || t('products.barcode_print_dialog.s35', "قطعة")})</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#1e293b', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showBarcodeText}
                  onChange={(e) => setShowBarcodeText(e.target.checked)}
                  style={{ accentColor: '#170e5e', width: '15px', height: '15px', cursor: 'pointer' }}
                />
                <span>{t('products.barcode_print_dialog.s36', "رقم الباركود أسفل الخطوط")}</span>
              </label>

              {(activeProduct.sku || activeProduct.styleCode) && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#1e293b', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showSku}
                    onChange={(e) => setShowSku(e.target.checked)}
                    style={{ accentColor: '#170e5e', width: '15px', height: '15px', cursor: 'pointer' }}
                  />
                  <span>{t('products.barcode_print_dialog.s37', "كود الصنف (")}{activeProduct.sku || activeProduct.styleCode})</span>
                </label>
              )}

              {hasVariantInfo && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#1e293b', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showVariant}
                    onChange={(e) => setShowVariant(e.target.checked)}
                    style={{ accentColor: '#170e5e', width: '15px', height: '15px', cursor: 'pointer' }}
                  />
                  <span>
                    اللون والمقاس
                    {(activeProduct.color || activeProduct.size) ? ` (${[activeProduct.color, activeProduct.size].filter(Boolean).join(' / ')})` : ''}
                  </span>
                </label>
              )}
            </div>

            {showPrice && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginTop: '8px',
                  background: '#ffffff',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                  صيغة العملة على الملصق:
                </span>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {CURRENCY_FORMAT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setCurrencyFormat(opt.value)}
                      style={{
                        border: `1px solid ${currencyFormat === opt.value ? '#170e5e' : '#cbd5e1'}`,
                        background: currencyFormat === opt.value ? '#170e5e' : '#f8fafc',
                        color: currencyFormat === opt.value ? '#ffffff' : '#475569',
                        fontWeight: 600,
                        fontSize: '0.71rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. بطاقة بيان السلع الغذائية والمعبأة (الاشتراطات التموينية وحماية المستهلك - القرار 330/2017) */}
            {showFoodStatementCard && (
              <BarcodeFoodStatementSection
                preset={preset}
                activeUnitName={activeUnit?.name}
                showFoodStatement={showFoodStatement}
                setShowFoodStatement={setShowFoodStatement}
                showProductionDate={showProductionDate}
                setShowProductionDate={setShowProductionDate}
                productionDate={productionDate}
                setProductionDate={setProductionDate}
                packagingDate={packagingDate}
                setPackagingDate={setPackagingDate}
                expiryType={expiryType}
                setExpiryType={setExpiryType}
                expiryPeriodMonths={expiryPeriodMonths}
                setExpiryPeriodMonths={setExpiryPeriodMonths}
                expiryDate={expiryDate}
                setExpiryDate={setExpiryDate}
                showNetWeight={showNetWeight}
                setShowNetWeight={setShowNetWeight}
                netWeightText={netWeightText}
                setNetWeightText={setNetWeightText}
                foodStatementNote={foodStatementNote}
                setFoodStatementNote={setFoodStatementNote}
              />
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-start', marginTop: '10px' }}>
              <Button type="button" variant="secondary" onClick={handleReset} style={{ fontSize: '0.76rem', padding: '4px 10px' }}>
                {t('products.barcode_print_dialog.s56', "إعادة الضبط الافتراضي")}
              </Button>
            </div>

            {!card.barcode && !isBatchMode && (
              <div className="error-box" style={{ marginTop: '10px', padding: '8px 12px', fontSize: '0.78rem' }}>
                {t('products.barcode_print_dialog.s57', "الصنف أو الوحدة الحالية لا تحتوي على باركود صالح للطباعة.")}
              </div>
            )}
          </div>
        </div>

        {isBatchMode && (
          <BarcodeBatchItemsPanel
            items={batchItems}
            activeIndex={activeItemIndex}
            totalCopies={totalCopies}
            zeroStockCount={zeroStockBatchCount}
            canPruneZeroStock={canPruneZeroStock}
            onSelectActive={setActiveItemIndex}
            onUpdateCopies={updateItemCopies}
            onToggleItem={toggleItemIncluded}
            onSelectOnly={selectOnlyItem}
            onSetAllCopies={setAllCopies}
            onSetAllByStock={setAllCopiesByStock}
            onAdjustAllCopies={adjustAllCopies}
            onRemoveZeroStock={removeZeroStockItems}
          />
        )}

        {/* العمود الأيسر: المعاينة المباشرة للملصق */}
        <div
          onWheel={(e) => {
            const previewEl = previewRef.current;
            if (previewEl && previewEl.scrollHeight > previewEl.clientHeight) {
              previewEl.scrollTop += e.deltaY;
            }
          }}
          style={{
            background: '#f8fafc',
            padding: '12px 14px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
              <AppIcons.Layers size={15} />
              <span>{t('products.barcode_print_dialog.s58', "معاينة الملصق (Label Preview)")}</span>
            </div>

            {family === 'thermal' && (
              <div style={{ display: 'flex', gap: '4px', background: '#e2e8f0', padding: '2px', borderRadius: '6px' }}>
                <button
                  type="button"
                  onClick={() => setPreviewMode('sheet')}
                  style={{
                    border: 'none',
                    background: previewMode === 'sheet' ? '#ffffff' : 'transparent',
                    color: previewMode === 'sheet' ? '#170e5e' : '#64748b',
                    fontWeight: 600,
                    fontSize: '0.72rem',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  {t('products.barcode_print_dialog.s59', "شريط الرول")}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('single')}
                  style={{
                    border: 'none',
                    background: previewMode === 'single' ? '#ffffff' : 'transparent',
                    color: previewMode === 'single' ? '#170e5e' : '#64748b',
                    fontWeight: 600,
                    fontSize: '0.72rem',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  {t('products.barcode_print_dialog.s60', "ملصق مكبر 1:1")}
                </button>
              </div>
            )}
          </div>

          <p style={{ fontSize: '0.73rem', color: '#64748b', margin: '0 0 8px 0' }}>
            {preset.isShelfLabel
              ? t('products.barcode_print_dialog.s61', "معاينة حية لاستيكر الرف التمويني بأسعار بارزة وخطوط عريضة وفق القرار 330.")
              : family === 'thermal' && previewMode === 'single'
              ? t('products.barcode_print_dialog.s62', "معاينة حية للملصق الفعلي بنسب متوازنة بالمليمتر كما سيخرج من الطابعة.")
              : t('products.barcode_print_dialog.s63', "معاينة تحاكي توزيع الملصقات ومواضع التخطي على الورقة قبل الإرسال.")}
          </p>

          <div
            ref={previewRef}
            className="barcode-label-preview-shell thin-scrollbar"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              background: '#ffffff',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
              padding: '12px 10px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-start',
            }}
          >
            <div
              dangerouslySetInnerHTML={{ __html: previewHtml }}
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-start',
              }}
            />
          </div>
        </div>
      </div>
    </StandardDialog>
  );
}


