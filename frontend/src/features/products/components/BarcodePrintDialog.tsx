import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import {
  buildBarcodePreviewHtml,
  DEFAULT_BARCODE_PRINT_PRESET_ID,
  getBarcodeCardData,
  getBarcodePrintPreset,
  getBarcodePrintPresetsByFamily,
  printBatchBarcodeLabels,
  type BarcodePrintCustomization,
  type BarcodePrintFamily,
  type BarcodePrintItem,
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

const EXPIRY_PERIOD_OPTIONS = [
  { value: '1', label: 'شهر واحد' },
  { value: '2', label: 'شهران' },
  { value: '3', label: '3 أشهر (عطارة وبقوليات)' },
  { value: '6', label: '6 أشهر (نصف سنة)' },
  { value: '9', label: '9 أشهر' },
  { value: '12', label: 'سنة واحدة (12 شهر)' },
  { value: '24', label: 'سنتان (24 شهر)' },
  { value: '36', label: '3 سنوات' },
];

const STORAGE_NOTE_PRESETS = [
  'يحفظ في مكان جاف وبارد',
  'يحفظ مبرداً من 1 إلى 4 م°',
  'يحفظ مجمداً عند -18 م°',
  'يحفظ بعيداً عن أشعة الشمس والحرارة',
];

const NET_WEIGHT_PRESETS = ['1 كجم', '500 جم', '250 جم', '5 كجم', '10 كجم'];

function getFutureDate(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function BarcodePrintDialog({ open, product, unit, items, onClose }: BarcodePrintDialogProps) {
  const { t } = useTranslation();
  const currentStoreName = useAuthStore((state) => state.storeName || state.tenant?.businessName || 'متجرنا');
  const settingsQuery = useSettingsQuery();
  const showFoodStatementCard = shouldShowExpiryDateField({ settings: settingsQuery.data });

  const [family, setFamily] = useState<BarcodePrintFamily>('thermal');
  const [presetId, setPresetId] = useState(DEFAULT_BARCODE_PRINT_PRESET_ID);
  const [copies, setCopies] = useState(8);
  const [labelsPerPage, setLabelsPerPage] = useState(24);
  const [startOffset, setStartOffset] = useState(1);
  const [previewMode, setPreviewMode] = useState<'single' | 'sheet'>('sheet');
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
  const [showUnit, setShowUnit] = useState(true);
  const [showBarcodeText, setShowBarcodeText] = useState(true);
  const [showSku, setShowSku] = useState(false);

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

  // Initialize state when modal opens
  useEffect(() => {
    if (!open) return;
    setFamily('thermal');
    setPresetId(DEFAULT_BARCODE_PRINT_PRESET_ID);
    const defaultProductCopies = product && Number(product.stock) > 0 ? Number(product.stock) : 8;
    setCopies(defaultProductCopies);
    setStartOffset(1);
    setPreviewMode('sheet');
    setStoreName(currentStoreName || '');
    setShowStoreName(true);
    setShowProductName(true);
    setShowPrice(true);
    setShowUnit(true);
    setShowBarcodeText(true);
    setShowSku(Boolean(product?.sku || product?.styleCode || items?.some((it) => it.product?.sku || it.product?.styleCode)));

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
      setBatchItems(items.map((it) => ({ ...it, copies: Math.max(1, Number(it.copies || 1)) })));
      setActiveItemIndex(0);
    } else if (product) {
      setBatchItems([{ product, unit, copies: defaultProductCopies }]);
      setActiveItemIndex(0);
    } else {
      setBatchItems([]);
      setActiveItemIndex(0);
    }
  }, [open, product?.id, unit?.id, currentStoreName, product?.styleCode, items]);

  const isBatchMode = batchItems.length > 1;
  const activeItem = batchItems[activeItemIndex] || batchItems[0] || (product ? { product, unit, copies } : null);
  const activeProduct = activeItem?.product || product;
  const activeUnit = activeItem?.unit || unit;

  const totalCopies = useMemo(() => {
    if (isBatchMode) {
      return batchItems.reduce((acc, it) => acc + Math.max(1, Number(it.copies || 1)), 0);
    }
    return copies;
  }, [isBatchMode, batchItems, copies]);

  const presetOptions = useMemo(() => getBarcodePrintPresetsByFamily(family), [family]);
  const preset = useMemo(() => getBarcodePrintPreset(presetId), [presetId]);
  const card = useMemo(() => (activeProduct ? getBarcodeCardData(activeProduct, activeUnit) : null), [activeProduct, activeUnit]);

  const customization: BarcodePrintCustomization = useMemo(
    () => ({
      showStoreName,
      storeName: (storeName || currentStoreName || '').trim(),
      showProductName,
      showPrice,
      showUnit,
      showBarcodeText,
      showSku,
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
      showUnit,
      showBarcodeText,
      showSku,
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
          })
        : '',
    [activeProduct, activeUnit, presetId, labelsPerPage, startOffset, previewMode, customization, isBatchMode, batchItems]
  );

  const presetSelectOptions = useMemo(
    () => presetOptions.map((option) => ({ value: option.id, label: option.label })),
    [presetOptions]
  );

  useEffect(() => {
    const firstPreset = presetOptions[0];
    if (!firstPreset) return;
    if (!presetOptions.some((entry) => entry.id === presetId)) {
      setPresetId(firstPreset.id);
      setLabelsPerPage(firstPreset.maxLabelsPerPage);
      setCopies(family === 'thermal' ? 8 : Math.min(24, firstPreset.maxLabelsPerPage));
    }
  }, [presetId, presetOptions, family]);

  if (!activeProduct || !card) return null;

  const handlePrint = () => {
    const effectiveItems: BarcodePrintItem[] = isBatchMode
      ? batchItems
      : [{ product: activeProduct, unit: activeUnit, copies }];

    printBatchBarcodeLabels(effectiveItems, { presetId, copies: totalCopies, labelsPerPage, startOffset }, customization, { settings: settingsQuery.data });
  };

  const handleReset = () => {
    setPresetId(DEFAULT_BARCODE_PRINT_PRESET_ID);
    const defaultPreset = getBarcodePrintPreset(DEFAULT_BARCODE_PRINT_PRESET_ID);
    setFamily(defaultPreset.family);
    setCopies(defaultPreset.family === 'thermal' ? 8 : Math.min(24, defaultPreset.maxLabelsPerPage));
    setLabelsPerPage(defaultPreset.maxLabelsPerPage);
    setStartOffset(1);
    setPreviewMode('sheet');
    setStoreName(currentStoreName || '');
    setShowStoreName(true);
    setShowProductName(true);
    setShowPrice(true);
    setShowUnit(true);
    setShowBarcodeText(true);
    setShowSku(Boolean(activeProduct?.sku));
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
    setBatchItems((current) => current.map((it) => ({ ...it, copies: Math.max(1, qty) })));
  };

  const setAllCopiesByStock = () => {
    setBatchItems((current) =>
      current.map((it) => ({ ...it, copies: Math.max(1, Number(it.product?.stock || 1)) }))
    );
  };

  const adjustAllCopies = (delta: number) => {
    setBatchItems((current) =>
      current.map((it) => ({ ...it, copies: Math.max(1, (it.copies || 1) + delta) }))
    );
  };

  const updateItemCopies = (index: number, newCopies: number) => {
    setBatchItems((current) =>
      current.map((it, idx) => (idx === index ? { ...it, copies: Math.max(1, newCopies) } : it))
    );
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('products.barcode_print_dialog.s0', "توليد وطباعة ملصقات الباركود والرف (Barcode & Shelf Labeling)")}
      subtitle={
        isBatchMode
          ? `طباعة مجمعة: ${batchItems.length} صنف · إجمالي ${totalCopies} ملصق`
          : `${activeProduct.name} · ${card.unit?.name || t('products.barcode_print_dialog.s1', "قطعة")} · باركود: ${card.barcode || t('products.barcode_print_dialog.s2', "بدون باركود")}`
      }
      width="min(1160px, 96vw)"
      height="min(650px, 92vh)"
      compact
      bodyStyle={{ overflow: 'hidden', padding: '12px 16px' }}
      footerActions={
        <StandardDialogFooter
          cancelText={t('products.barcode_print_dialog.s3', "إغلاق")}
          onCancel={onClose}
          submitText={`طباعة الآن (${totalCopies} ${family === 'thermal' ? t('products.barcode_print_dialog.s4', "ملصق") : t('products.barcode_print_dialog.s5', "نسخة")})`}
          onSubmit={handlePrint}
          submitDisabled={!card.barcode && !isBatchMode}
        />
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.05fr 1fr',
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
                    setPreviewMode(nextFamily === 'thermal' ? 'single' : 'sheet');
                    const nextPreset = getBarcodePrintPresetsByFamily(nextFamily)[0];
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
                    const nextPreset = getBarcodePrintPreset(val);
                    setPresetId(nextPreset.id);
                    setLabelsPerPage(nextPreset.maxLabelsPerPage);
                    if (family === 'sheet') {
                      setCopies(Math.max(1, Math.min(copies, nextPreset.maxLabelsPerPage)));
                    }
                  }}
                />
              </Field>

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
                <Field label={t('products.barcode_print_dialog.s13', "أبعاد الملصق الفعلي")}>
                  <input
                    value={`${preset.labelWidthMm} × ${preset.labelHeightMm} مم ${preset.isShelfLabel ? t('products.barcode_print_dialog.s14', "(استيكر رف)") : ''}`}
                    readOnly
                    disabled
                    style={{ height: '32px', fontSize: '0.82rem', background: '#f1f5f9', fontWeight: 600, color: '#170e5e' }}
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

            {/* شريط معلومات الطباعة المجمعة للأصناف إذا كانت دفعة */}
            {isBatchMode && (
              <div style={{ marginTop: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#170e5e' }}>
                    {t('products.barcode_print_dialog.s17', "الأصناف المحددة (")}{batchItems.length}{t('products.barcode_print_dialog.s18', ") · إجمالي الملصقات:")} <strong>{totalCopies}</strong>
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={setAllCopiesByStock}
                      style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', border: '1px solid #170e5e', borderRadius: '4px', background: '#eff6ff', color: '#170e5e', cursor: 'pointer' }}
                      title="ضبط عدد الملصقات لكل صنف ليطابق رصيده الفعلي في المخزن"
                    >
                      حسب رصيد المخزن
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllCopies(1)}
                      style={{ fontSize: '0.7rem', padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc', cursor: 'pointer' }}
                      title={t('products.barcode_print_dialog.s19', "نسخة واحدة لكل صنف (ملصقات الرف)")}
                    >
                      {t('products.barcode_print_dialog.s20', "1 لكل صنف (رف)")}
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustAllCopies(1)}
                      style={{ fontSize: '0.7rem', padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc', cursor: 'pointer' }}
                      title={t('products.barcode_print_dialog.s21', "زيادة نسخة لكل الأصناف")}
                    >
                      {t('products.barcode_print_dialog.s22', "+1 للكل")}
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustAllCopies(-1)}
                      style={{ fontSize: '0.7rem', padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc', cursor: 'pointer' }}
                      title={t('products.barcode_print_dialog.s23', "إنقاص نسخة لكل الأصناف")}
                    >
                      {t('products.barcode_print_dialog.s24', "-1 للكل")}
                    </button>
                  </div>
                </div>

                {/* قائمة مصغرة سريعة للأصناف والكميات */}
                <div style={{ maxHeight: '110px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }} className="thin-scrollbar">
                  {batchItems.map((item, idx) => (
                    <div
                      key={item.product.id || idx}
                      onClick={() => setActiveItemIndex(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 6px',
                        borderRadius: '4px',
                        background: activeItemIndex === idx ? '#eff6ff' : '#f8fafc',
                        border: `1px solid ${activeItemIndex === idx ? '#3b82f6' : '#e2e8f0'}`,
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                        <span style={{ fontWeight: activeItemIndex === idx ? 800 : 600, color: '#0f172a', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                          {item.product.name}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: '#64748b' }}>({item.unit?.name || t('products.barcode_print_dialog.s25', "قطعة")})</span>
                        {item.product.stock != null && (
                          <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: '#e2e8f0', color: '#1e293b', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            رصيد: {item.product.stock}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{t('products.barcode_print_dialog.s26', "الكمية:")}</span>
                        <input
                          type="number"
                          min="1"
                          max="500"
                          value={item.copies || 1}
                          onChange={(e) => updateItemCopies(idx, Number(e.target.value || 1))}
                          style={{ width: '48px', height: '24px', fontSize: '0.75rem', textAlign: 'center', padding: '0 2px' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  ? `رول حراري مستمر · ${totalCopies} ملصق`
                  : `الصفحات: ${Math.ceil((totalCopies + (startOffset - 1)) / labelsPerPage)} ورقة A4`}
              </span>
            </div>
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
            </div>

            {/* 3. بطاقة بيان السلع الغذائية والمعبأة (الاشتراطات التموينية وحماية المستهلك - القرار 330/2017) */}
            {showFoodStatementCard && (
            <div
              style={{
                marginTop: '10px',
                background: showFoodStatement ? '#f0fdf4' : '#ffffff',
                border: `1px solid ${showFoodStatement ? '#86efac' : '#e2e8f0'}`,
                borderRadius: '6px',
                padding: '8px 10px',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: showFoodStatement ? '#166534' : '#1e293b',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showFoodStatement}
                    onChange={(e) => setShowFoodStatement(e.target.checked)}
                    style={{ accentColor: '#166534', width: '15px', height: '15px', cursor: 'pointer' }}
                  />
                  <span>{t('products.barcode_print_dialog.s38', "بطاقة بيان السلع المعبأة (تواريخ التعبئة والصلاحية والوزن)")}</span>
                </label>
                <span style={{ fontSize: '0.68rem', color: '#15803d', fontWeight: 600 }}>{t('products.barcode_print_dialog.s39', "مطابقة للتموين")}</span>
              </div>

              {showFoodStatement && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* أ) تواريخ الإنتاج والتعبئة والصلاحية */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>{t('products.barcode_print_dialog.s40', "التواريخ وفترة الصلاحية:")}</span>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.72rem', color: '#334155' }}>
                        <input
                          type="checkbox"
                          checked={showProductionDate}
                          onChange={(e) => setShowProductionDate(e.target.checked)}
                          style={{ accentColor: '#166534', width: '13px', height: '13px' }}
                        />
                        <span>{t('products.barcode_print_dialog.s41', "إضافة تاريخ الإنتاج (إنتاج: ...)")}</span>
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: showProductionDate ? '1fr 1fr 1fr' : '1fr 1fr', gap: '6px' }}>
                      {showProductionDate && (
                        <Field label={t('products.barcode_print_dialog.s42', "تاريخ الإنتاج")}>
                          <input
                            type="date"
                            value={productionDate}
                            onChange={(e) => setProductionDate(e.target.value)}
                            style={{ height: '28px', fontSize: '0.74rem', padding: '2px 6px' }}
                          />
                        </Field>
                      )}

                      <Field label={t('products.barcode_print_dialog.s43', "تاريخ التعبئة")}>
                        <input
                          type="date"
                          value={packagingDate}
                          onChange={(e) => setPackagingDate(e.target.value)}
                          style={{ height: '28px', fontSize: '0.74rem', padding: '2px 6px' }}
                        />
                      </Field>

                      {expiryType === 'period' ? (
                        <Field label={t('products.barcode_print_dialog.s44', "فترة الصلاحية")}>
                          <CustomSelect
                            value={String(expiryPeriodMonths)}
                            options={EXPIRY_PERIOD_OPTIONS}
                            onChange={(val) => {
                              const m = Number(val || 6);
                              setExpiryPeriodMonths(m);
                              setExpiryDate(getFutureDate(m));
                            }}
                          />
                        </Field>
                      ) : (
                        <Field label={t('products.barcode_print_dialog.s45', "تاريخ الانتهاء")}>
                          <input
                            type="date"
                            value={expiryDate}
                            onChange={(e) => setExpiryDate(e.target.value)}
                            style={{ height: '28px', fontSize: '0.74rem', padding: '2px 6px' }}
                          />
                        </Field>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.72rem', color: '#334155', marginTop: '6px' }}>
                      <span>{t('products.barcode_print_dialog.s46', "صيغة الصلاحية:")}</span>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="expiryType"
                          checked={expiryType === 'period'}
                          onChange={() => setExpiryType('period')}
                          style={{ accentColor: '#166534' }}
                        />
                        <span>{t('products.barcode_print_dialog.s47', "مدة بالشهور (مثال: صالحة 6 أشهر)")}</span>
                      </label>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="expiryType"
                          checked={expiryType === 'date'}
                          onChange={() => setExpiryType('date')}
                          style={{ accentColor: '#166534' }}
                        />
                        <span>{t('products.barcode_print_dialog.s48', "تاريخ انتهاء صريح")}</span>
                      </label>
                    </div>
                  </div>

                  {/* ب) بيان الوزن الصافي المعتمد (المواصفة 2613 لسنة 2008) */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>
                        <input
                          type="checkbox"
                          checked={showNetWeight}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setShowNetWeight(checked);
                            if (checked && !netWeightText) {
                              setNetWeightText(activeUnit?.name || t('products.barcode_print_dialog.s49', "1 كجم"));
                            }
                          }}
                          style={{ accentColor: '#166534', width: '14px', height: '14px' }}
                        />
                        <span>{t('products.barcode_print_dialog.s50', "بيان الوزن الصافي المعتمد (صافي: ...)")}</span>
                      </label>
                      <span style={{ fontSize: '0.68rem', color: '#64748b' }}>{t('products.barcode_print_dialog.s51', "مواصفة م.ق.م 2613")}</span>
                    </div>

                    {showNetWeight && (
                      <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="text"
                            value={netWeightText}
                            onChange={(e) => setNetWeightText(e.target.value)}
                            placeholder={t('products.barcode_print_dialog.s52', "مثال: 1 كجم أو 500 جم أو 250 جم")}
                            style={{ flex: 1, height: '28px', fontSize: '0.75rem', padding: '2px 8px' }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {NET_WEIGHT_PRESETS.map((presetWeight) => (
                            <button
                              key={presetWeight}
                              type="button"
                              onClick={() => setNetWeightText(presetWeight)}
                              style={{
                                fontSize: '0.68rem',
                                padding: '2px 6px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                background: netWeightText === presetWeight ? '#dcfce7' : '#f8fafc',
                                color: netWeightText === presetWeight ? '#15803d' : '#334155',
                                fontWeight: netWeightText === presetWeight ? 700 : 500,
                                cursor: 'pointer',
                              }}
                            >
                              {presetWeight}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ج) تعليمات وشروط التخزين والحفظ (القرار 330/2017) */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>{t('products.barcode_print_dialog.s53', "تعليمات وشروط الحفظ والتخزين:")}</span>
                      {foodStatementNote && (
                        <button
                          type="button"
                          onClick={() => setFoodStatementNote('')}
                          style={{ border: 'none', background: 'transparent', color: '#b91c1c', fontSize: '0.68rem', cursor: 'pointer', padding: 0 }}
                        >
                          {t('products.barcode_print_dialog.s54', "مسح الملاحظة")}
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={foodStatementNote}
                      onChange={(e) => setFoodStatementNote(e.target.value)}
                      placeholder={t('products.barcode_print_dialog.s55', "مثال: يحفظ في مكان جاف وبارد بعيداً عن الرطوبة")}
                      style={{ width: '100%', height: '28px', fontSize: '0.75rem', padding: '2px 8px', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                      {STORAGE_NOTE_PRESETS.map((note) => (
                        <button
                          key={note}
                          type="button"
                          onClick={() => setFoodStatementNote(note)}
                          style={{
                            fontSize: '0.68rem',
                            padding: '2px 6px',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            background: foodStatementNote === note ? '#dcfce7' : '#f8fafc',
                            color: foodStatementNote === note ? '#15803d' : '#334155',
                            fontWeight: foodStatementNote === note ? 700 : 500,
                            cursor: 'pointer',
                          }}
                        >
                          {note}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
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
                    fontWeight: previewMode === 'sheet' ? 700 : 500,
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
                    fontWeight: previewMode === 'single' ? 700 : 500,
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


