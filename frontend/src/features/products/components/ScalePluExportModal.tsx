import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { DataTable } from '@/shared/ui/data-table';
import { downloadExcelFile, triggerDownload } from '@/lib/browser';
import { formatCurrency } from '@/lib/format';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { productsApi } from '@/features/products/api/products.api';
import { getWeightedBarcodeConfig, getScaleExportItemCode, buildSampleScaleBarcode } from '@/shared/lib/weighted-barcode';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { Product } from '@/types/domain';

export type ScalePreset = 'rongta' | 'cas' | 'dibal' | 'general';
export type ScaleScope = 'weighted_only' | 'all' | 'selected';

interface ScalePluExportModalProps {
  open: boolean;
  onClose: () => void;
  products?: Product[];
  selectedIds?: string[];
  categoryNames?: Record<string | number, string>;
}

const PRESET_OPTIONS = [
  { value: 'rongta', label: 'Rongta (RLS1000 / RLink) - الأكثر شيوعاً' },
  { value: 'cas', label: 'CAS (CL5000 / CL-Works)' },
  { value: 'dibal', label: 'Dibal (Series 500 / Wind)' },
  { value: 'general', label: 'ملف موازين عام (Universal Format)' },
];

function isWeightedProduct(product: Product): boolean {
  if ((product as any).is_weighted || (product as any).isWeighted) return true;
  const name = (product.name || '').toLowerCase();
  const unit = (((product as any).unit || '') + ' ' + (product.units?.map((u) => u.name).join(' ') || '')).toLowerCase();
  if (
    unit.includes('كيلو') ||
    unit.includes('كجم') ||
    unit.includes('كغ') ||
    unit.includes('kg') ||
    unit.includes('جرام') ||
    unit.includes('جم') ||
    unit.includes('وزن')
  ) {
    return true;
  }
  if (name.includes('كيلو') || name.includes('كجم') || name.includes('موزون')) {
    return true;
  }
  const barcode = String(product.barcode || '').trim();
  if (/^\d{3,5}$/.test(barcode)) {
    return true;
  }
  return false;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row
        .map((cell) => {
          const val = String(cell ?? '');
          return /[",\n\r]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
        })
        .join(',')
    ),
  ].join('\r\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

export function ScalePluExportModal({
  open,
  onClose,
  products: passedProducts,
  selectedIds = [],
  categoryNames = {},
}: ScalePluExportModalProps) {
  const { t } = useTranslation();
  const { data: settings } = useSettingsQuery();
  const scaleConfig = useMemo(() => getWeightedBarcodeConfig(settings), [settings]);

  const [preset, setPreset] = useState<ScalePreset>('rongta');
  const [scope, setScope] = useState<ScaleScope>('weighted_only');
  const [pluStart, setPluStart] = useState<number>(1);
  const [departmentId, setDepartmentId] = useState<number>(1);
  const [padItemCode, setPadItemCode] = useState<boolean>(true);

  const { data: fetchedProducts = [] } = useQuery<Product[]>({
    queryKey: ['products-for-scale-export'],
    queryFn: async () => {
      const res = await productsApi.list();
      return Array.isArray(res) ? res : [];
    },
    enabled: open && (!passedProducts || passedProducts.length === 0),
  });

  const availableProducts = useMemo(() => {
    return (passedProducts && passedProducts.length > 0) ? passedProducts : fetchedProducts;
  }, [passedProducts, fetchedProducts]);

  const scopeOptions = useMemo(() => [
    { value: 'weighted_only', label: `الأصناف الموزونة فقط (${availableProducts.filter(isWeightedProduct).length} صنف)` },
    { value: 'all', label: `جميع الأصناف النشطة (${availableProducts.length} صنف)` },
    ...(selectedIds.length > 0 ? [{ value: 'selected', label: `الأصناف المحددة حالياً (${selectedIds.length} صنف)` }] : []),
  ], [availableProducts, selectedIds]);

  // Filter products based on selected scope
  const targetProducts = useMemo(() => {
    if (scope === 'selected' && selectedIds.length > 0) {
      const set = new Set(selectedIds.map(String));
      return availableProducts.filter((p) => set.has(String(p.id)));
    }
    if (scope === 'weighted_only') {
      return availableProducts.filter(isWeightedProduct);
    }
    return availableProducts;
  }, [availableProducts, scope, selectedIds]);

  // Transform products into PLU items
  const pluRows = useMemo(() => {
    return targetProducts.map((prod, index) => {
      const plu = pluStart + index;
      const itemCode = getScaleExportItemCode(prod, scaleConfig, padItemCode);
      const price = Number((prod as any).retailPrice ?? (prod as any).price ?? (prod as any).retail_price ?? 0);
      const catName = categoryNames[String(prod.categoryId)] || (prod as any).categoryName || 'عام';
      const sampleWeightBarcode = itemCode ? buildSampleScaleBarcode(itemCode, scaleConfig) : null;

      return {
        product: prod,
        plu,
        itemCode,
        name: prod.name,
        price,
        category: catName,
        sampleWeightBarcode,
      };
    });
  }, [targetProducts, pluStart, padItemCode, scaleConfig, categoryNames]);

  const exportIssues = useMemo(() => {
    const issues: string[] = [];
    if (!pluRows.length) return issues;
    if (scaleConfig.prefix.length + scaleConfig.productCodeLength + scaleConfig.weightDigits !== 12) {
      issues.push('إعدادات الميزان لا تكوّن باركود EAN-13 صحيحًا؛ راجع طول البادئة والكود وخانات الوزن.');
    }
    const seen = new Map<string, string>();
    for (const row of pluRows) {
      if (!row.itemCode || !row.sampleWeightBarcode) {
        issues.push(`الصنف "${row.name}" ليس له كود ميزان رقمي صالح أو تنسيق EAN-13 صحيح.`);
        continue;
      }
      const normalized = row.itemCode.replace(/^0+/, '') || '0';
      const first = seen.get(normalized);
      if (first) issues.push(`كود ميزان مكرر بين "${first}" و"${row.name}" (${row.itemCode}).`);
      else seen.set(normalized, row.name);
      if (!Number.isFinite(row.price) || row.price <= 0) issues.push(`سعر غير صالح للصنف "${row.name}".`);
    }
    return issues;
  }, [pluRows, scaleConfig]);
  const canExport = pluRows.length > 0 && exportIssues.length === 0;

  const handleExportCsv = () => {
    if (!canExport) return;
    const today = new Date().toISOString().slice(0, 10);

    if (preset === 'rongta') {
      // Rongta RLS1000 / RLink import format
      const headers = ['LFCode', 'Code', 'Name', 'Price', 'Dept', 'BarType'];
      const rows = pluRows.map((r) => [r.plu, r.itemCode ?? '', r.name, r.price.toFixed(2), departmentId, 0]);
      downloadCsv(`Rongta_PLU_${today}.csv`, headers, rows);
    } else if (preset === 'cas') {
      // CAS CL5000 / CL-Works format
      const headers = ['PLU_No', 'Item_Code', 'Name', 'Price', 'Dept_No', 'Barcode_Type', 'Unit'];
      const rows = pluRows.map((r) => [r.plu, r.itemCode ?? '', r.name, r.price.toFixed(2), departmentId, 7, 'kg']);
      downloadCsv(`CAS_Scale_PLU_${today}.csv`, headers, rows);
    } else if (preset === 'dibal') {
      // Dibal Scale format
      const headers = ['Code', 'Name', 'Price', 'Section', 'DirectKey', 'Barcode'];
      const rows = pluRows.map((r) => [r.plu, r.name, r.price.toFixed(2), departmentId, r.plu <= 99 ? r.plu : '', r.itemCode ?? '']);
      downloadCsv(`Dibal_PLU_${today}.csv`, headers, rows);
    } else {
      // General Universal CSV
      const headers = ['PLU', 'كود الصنف بالميزان', 'اسم الصنف', 'السعر للكيلو', 'القسم', 'بادئة الباركود', 'باركود تجريبي للوزن'];
      const rows = pluRows.map((r) => [r.plu, r.itemCode ?? '', r.name, r.price.toFixed(2), r.category, scaleConfig.prefix, r.sampleWeightBarcode ?? '']);
      downloadCsv(`Scale_PLU_${today}.csv`, headers, rows);
    }
  };

  const handleExportExcel = async () => {
    if (!canExport) return;
    const today = new Date().toISOString().slice(0, 10);
    const headers = [
      'رقم PLU',
      'كود الصنف بالميزان (Item Code)',
      'اسم الصنف',
      'سعر الكيلو',
      'القسم',
      'بادئة الميزان بالنظام',
      'نموذج باركود (1 كجم أو 12.50 بنمط السعر)',
    ];
    const rows = pluRows.map((r) => [
      r.plu,
      r.itemCode ?? '',
      r.name,
      r.price,
      r.category,
      scaleConfig.prefix,
      r.sampleWeightBarcode ?? '',
    ]);
    await downloadExcelFile(`موازين_الباركود_PLU_${today}.xlsx`, headers, rows);
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('products.scale_plu_export_modal.s0', "تصدير ملف موازين الباركود الإلكترونية (PLU Scale Export)")}
      subtitle={t('products.scale_plu_export_modal.s1', "توليد ملفات الأصناف والأسعار المتوافقة مع برامج موازين الباركود (Rongta, CAS, Dibal)")}
      maxWidth="920px"
      footerActions={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <Button variant="secondary" onClick={handleExportExcel} disabled={!canExport} style={{ fontSize: '0.8rem' }}>
            <AppIcons.FileSpreadsheet size={15} style={{ marginInlineEnd: '6px' }} />
            {t('products.scale_plu_export_modal.s2', "تصدير ملف Excel (.xlsx)")}
          </Button>

          <StandardDialogFooter
            cancelText={t('products.scale_plu_export_modal.s3', "إغلاق")}
            onCancel={onClose}
            submitText={t('products.scale_plu_export_modal.s4', "تحميل ملف CSV للميزان")}
            onSubmit={handleExportCsv}
            submitDisabled={!canExport}
          />
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} dir="rtl">
        {/* 1. إعدادات الميزان وصيغة التصدير */}
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
            <AppIcons.Settings size={15} />
            <span>{t('products.scale_plu_export_modal.s5', "1. إعدادات الميزان وصيغة التصدير (Scale Settings & Format)")}</span>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 12px', fontSize: '0.8rem', color: '#334155', marginBottom: '10px' }}>
            <strong style={{ color: '#170e5e' }}>{t('products.scale_plu_export_modal.s6', "الربط بنقاط البيع (POS):")} </strong>
            {t('products.scale_plu_export_modal.s7', "يبدأ الباركود الموزون بـ")} <strong>{scaleConfig.prefix}</strong>{t('products.scale_plu_export_modal.s8', "، مع كود صنف بطول")} <strong>{scaleConfig.productCodeLength}</strong> {t('products.scale_plu_export_modal.s9', "أرقام، و")} <strong>{scaleConfig.weightDigits}</strong> {t('products.scale_plu_export_modal.s10', "خانات للوزن.")}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr 1fr', gap: '10px' }}>
            <Field label={t('products.scale_plu_export_modal.s11', "نوع الميزان / البرنامج")}>
              <CustomSelect
                value={preset}
                options={PRESET_OPTIONS}
                onChange={(val) => setPreset(val as ScalePreset)}
              />
            </Field>

            <Field label={t('products.scale_plu_export_modal.s12', "نطاق الأصناف المشمولة")}>
              <CustomSelect
                value={scope}
                options={scopeOptions}
                onChange={(val) => setScope(val as ScaleScope)}
              />
            </Field>

            <Field label={t('products.scale_plu_export_modal.s13', "بداية ترقيم الـ PLU")}>
              <input
                type="number"
                min={1}
                value={pluStart}
                onChange={(e) => setPluStart(Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>

            <Field label={t('products.scale_plu_export_modal.s14', "رقم القسم (Dept)")}>
              <input
                type="number"
                min={1}
                value={departmentId}
                onChange={(e) => setDepartmentId(Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>
          </div>

          <div style={{ marginTop: '8px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={padItemCode}
                onChange={(e) => setPadItemCode(e.target.checked)}
              />
              <span>{t('products.scale_plu_export_modal.s15', "تنسيق كود الصنف ليطابق طول إعدادات الباركود الموزون (")}{scaleConfig.productCodeLength} {t('products.scale_plu_export_modal.s16', "أرقام مع أصفار يسار مثل 00101)")}</span>
            </label>
          </div>
        </div>

        {exportIssues.length > 0 && (
          <div role="alert" style={{ padding: '10px 14px', color: '#9a3412', border: '1px solid #fed7aa', borderRadius: '8px', background: '#fff7ed', fontSize: '0.8rem' }}>
            <strong>تم منع التصدير لحماية الكاشير من مطابقة صنف أو وزن خاطئ.</strong>
            <ul>{exportIssues.slice(0, 5).map((issue, index) => <li key={index}>{issue}</li>)}</ul>
            {exportIssues.length > 5 && <div>ويوجد {exportIssues.length - 5} ملاحظات أخرى.</div>}
          </div>
        )}
        {/* 2. جدول معاينة الأصناف الجاهزة للتصدير */}
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#170e5e', fontWeight: 700, fontSize: '0.84rem' }}>
              <AppIcons.Layers size={15} />
              <span>{t('products.scale_plu_export_modal.s17', "2. معاينة الأصناف الجاهزة للتصدير (")}{pluRows.length} {t('products.scale_plu_export_modal.s18', "صنف)")}</span>
            </div>
            <span className="muted small">{t('products.scale_plu_export_modal.s19', "معروض أول 5 أصناف للمعاينة السريعة")}</span>
          </div>

          <div style={{ background: '#ffffff', borderRadius: '6px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <DataTable
              ariaLabel={t('products.scale_plu_export_modal.s20', "معاينة أصناف الميزان")}
              columns={[
                { key: 'plu', header: 'PLU', cell: (r) => <strong>{r.plu}</strong> },
                { key: 'itemCode', header: t('products.scale_plu_export_modal.s21', "كود الميزان"), cell: (r) => <code style={{ color: '#170e5e', fontWeight: 700 }}>{r.itemCode || '—'}</code> },
                { key: 'name', header: t('products.scale_plu_export_modal.s22', "اسم الصنف"), cell: (r) => r.name },
                { key: 'price', header: t('products.scale_plu_export_modal.s23', "السعر للكيلو"), cell: (r) => formatCurrency(r.price) },
                { key: 'category', header: t('products.scale_plu_export_modal.s24', "القسم"), cell: (r) => r.category },
                { key: 'sample', header: t('products.scale_plu_export_modal.s25', "شكل الباركود الناتج من الميزان"), cell: (r) => <span className="nav-pill" style={{ fontFamily: 'monospace' }}>{r.sampleWeightBarcode || '—'}</span> },
              ]}
              rows={pluRows.slice(0, 5)}
              empty={<div className="muted small" style={{ padding: '16px', textAlign: 'center' }}>{t('products.scale_plu_export_modal.s26', "لا توجد أصناف مطابقة للتصدير.")}</div>}
            />
          </div>
        </div>

        {/* 3. إرشادات التنزيل للميزان */}
        <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.78rem', color: '#64748b' }}>
          <AppIcons.HelpCircle size={15} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ color: '#0f172a' }}>{t('products.scale_plu_export_modal.s27', "طريقة التنزيل للميزان:")} </strong>
            {t('products.scale_plu_export_modal.s28', "قم بتحميل ملف الـ CSV ثم افتح برنامج الميزان (مثل RLS1000 Tool أو CL-Works)، اختر")} <strong>Import PLU</strong> {t('products.scale_plu_export_modal.s29', "وحدد الملف المحمل، ثم اضغط")} <strong>Download to Scale</strong> {t('products.scale_plu_export_modal.s30', "لإرسال جميع الأصناف والأسعار إلى شاشة الميزان وأزرار الاختصار السريع.")}
          </div>
        </div>
      </div>
    </StandardDialog>
  );
}
