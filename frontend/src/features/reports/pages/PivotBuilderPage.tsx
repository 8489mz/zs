import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';
import { toast } from '@/shared/components/system-alert';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  RefreshCwIcon,
  SlidersIcon,
  DownloadIcon,
  PrinterIcon,
  FileTextIcon,
  LayersIcon,
} from '@/shared/components/icons/AppIcons';
import {
  dynamicPivotApi,
  type PivotResult,
  type PivotMetric,
  type SavedPivotTemplate,
} from '../api/dynamic-pivot.api';
import { PivotGridTable } from '../components/pivot/PivotGridTable';
import { SavePivotTemplateModal } from '../components/pivot/SavePivotTemplateModal';
import { todayLocalDateKey } from '@/lib/format';

export const PivotBuilderPage: React.FC = () => {
  const { t } = useTranslation();
  // Core Configuration
  const [dataset, setDataset] = useState<'sales' | 'purchases' | 'inventory' | 'expenses'>('sales');
  const [rowDimension, setRowDimension] = useState('branch');
  const [colDimension, setColDimension] = useState('date_month');
  const [metric, setMetric] = useState<PivotMetric>('total_amount');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return todayLocalDateKey(d);
  });
  const [dateTo, setDateTo] = useState(() => todayLocalDateKey());

  // Execution State
  const [pivotResult, setPivotResult] = useState<PivotResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Saved Templates State
  const [savedTemplates, setSavedTemplates] = useState<SavedPivotTemplate[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Dataset Options
  const datasetOptions = [
    { value: 'sales', label: 'المبيعات والفواتير (Sales)' },
    { value: 'purchases', label: 'المشتريات والموردين (Purchases)' },
    { value: 'inventory', label: 'المخزون والمستودعات (Inventory)' },
    { value: 'expenses', label: 'المصروفات والخزينة (Expenses)' },
  ];

  // Dimension Options based on dataset
  const getRowDimensionOptions = () => {
    if (dataset === 'sales') {
      return [
        { value: 'branch', label: 'الفرع' },
        { value: 'customer', label: 'العميل' },
        { value: 'rep', label: 'المندوب / البائع' },
        // INV-VAN-PROFIT-REP-REPORTING: the delivery rep who owns the
        // sale (delivery_rep_id), not the login user who created it.
        { value: 'delivery_rep', label: 'مندوب التوصيل / الفان' },
        { value: 'category', label: 'تصنيف الصنف' },
        { value: 'product', label: 'المنتج' },
        { value: 'payment_type', label: 'طريقة السداد' },
        { value: 'date_month', label: 'الشهر' },
        { value: 'date_day', label: 'اليوم' },
      ];
    } else if (dataset === 'purchases') {
      return [
        { value: 'supplier', label: 'المورد' },
        { value: 'branch', label: 'الفرع' },
        { value: 'date_month', label: 'الشهر' },
        { value: 'date_day', label: 'اليوم' },
      ];
    } else if (dataset === 'inventory') {
      return [
        { value: 'category', label: 'تصنيف الصنف' },
        { value: 'branch', label: 'المستودع / الفرع' },
        { value: 'product', label: 'المنتج' },
      ];
    } else {
      return [
        { value: 'category', label: 'بند المصروف' },
        { value: 'date_month', label: 'الشهر' },
        { value: 'date_day', label: 'اليوم' },
      ];
    }
  };

  const getColDimensionOptions = () => {
    return [
      { value: 'none', label: 'بدون أعمدة إضافية (أحادي البعد)' },
      { value: 'date_month', label: 'الشهر' },
      { value: 'category', label: 'تصنيف الصنف' },
      { value: 'branch', label: 'الفرع' },
      { value: 'payment_type', label: 'طريقة السداد' },
    ];
  };

  const metricOptions = [
    { value: 'total_amount', label: 'إجمالي القيمة المالية (Sum Amount)' },
    { value: 'net_profit', label: 'صافي الربح (Net Profit)' },
    // INV-VAN-PROFIT-REP-REPORTING: ratio of sums per group
    // (SUM(net_profit) / SUM(total_amount) × 100), never an average
    // of row percents; zero total yields 0.
    { value: 'net_profit_percent', label: 'نسبة صافي الربح % (Net Profit %)' },
    { value: 'quantity', label: 'إجمالي الكميات المباعة / المتوفرة (Quantity)' },
    { value: 'count', label: 'عدد العمليات والفواتير (Transaction Count)' },
    { value: 'avg_amount', label: 'متوسط قيمة العملية (Average Ticket)' },
  ];

  const loadTemplates = useCallback(async () => {
    try {
      const res = await dynamicPivotApi.getSavedTemplates();
      setSavedTemplates(res);
    } catch {
      // Non-blocking
    }
  }, []);

  const handleExecute = useCallback(async () => {
    setLoading(true);
    try {
      const res = await dynamicPivotApi.executePivot({
        dataset,
        rowDimension,
        colDimension: colDimension === 'none' ? undefined : colDimension,
        metric,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setPivotResult(res);
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تشغيل التحليل المحوري');
    } finally {
      setLoading(false);
    }
  }, [dataset, rowDimension, colDimension, metric, dateFrom, dateTo]);

  useEffect(() => {
    loadTemplates();
    handleExecute();
  }, [dataset, loadTemplates, handleExecute]);

  const handleApplyTemplate = (tmpl: SavedPivotTemplate) => {
    setDataset(tmpl.dataset as any);
    setRowDimension(tmpl.row_dimension);
    setColDimension(tmpl.col_dimension || 'none');
    setMetric(tmpl.metric as PivotMetric);
    if (tmpl.date_from) setDateFrom(tmpl.date_from);
    if (tmpl.date_to) setDateTo(tmpl.date_to);
    toast.info(`تم تطبيق قالب: ${tmpl.name}`);
  };

  const handleDeleteTemplate = async (id: string, name: string) => {
    try {
      await dynamicPivotApi.deleteTemplate(id);
      toast.success(`تم حذف القالب «${name}».`);
      loadTemplates();
    } catch (err: any) {
      toast.error('تعذر حذف القالب');
    }
  };

  const handleExportCsv = () => {
    if (!pivotResult || !pivotResult.rowKeys.length) {
      toast.warning('لا توجد بيانات لتصديرها.');
      return;
    }

    const { rowKeys, colKeys, matrix, rowTotals, colTotals, grandTotal } = pivotResult;
    const headerCols = [getRowLabel(), ...colKeys.map((c) => `"${c.label}"`), 'الإجمالي'];
    const lines = [headerCols.join(',')];

    for (const r of rowKeys) {
      const rowCols = [
        `"${r.label}"`,
        ...colKeys.map((c) => matrix[r.key]?.[c.key]?.value || 0),
        rowTotals[r.key]?.value || 0,
      ];
      lines.push(rowCols.join(','));
    }

    const footerCols = [
      'إجمالي الأعمدة',
      ...colKeys.map((c) => colTotals[c.key]?.value || 0),
      grandTotal.value,
    ];
    lines.push(footerCols.join(','));

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pivot-report-${dataset}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('تم تصدير ملف CSV بنجاح.');
  };

  const getRowLabel = () =>
    getRowDimensionOptions().find((o) => o.value === rowDimension)?.label || rowDimension;
  const getColLabel = () =>
    colDimension !== 'none'
      ? getColDimensionOptions().find((o) => o.value === colDimension)?.label
      : undefined;
  const getMetricLabel = () =>
    metricOptions.find((o) => o.value === metric)?.label.split('(')[0].trim() || metric;

  return (
    <div
      dir="rtl"
      style={{
        width: 'min(100%, 1280px)',
        margin: '0 auto',
        padding: '20px 16px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 'var(--font-page-title, 1.15rem)',
              fontWeight: 800,
              color: '#0f172a',
              margin: '0 0 4px 0',
            }}
          >
            {t('reports.pivot_builder_page.s0', "منشئ ومحلل التقارير المحورية المرنة (Dynamic BI Pivot Builder)")}
          </h1>
          <p
            style={{
              fontSize: 'var(--font-subtitle, 0.8125rem)',
              color: '#64748b',
              margin: 0,
            }}
          >
            {t('reports.pivot_builder_page.s1', "تجميع واستقراء البيانات عبر أبعاد حرة ومتعددة المستويات، تحليل الربحية والكميات، وتصدير التقارير المخصصة.")}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowSaveModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
          >
            <SlidersIcon size={15} color="#170e5e" />
            <span>{t('reports.pivot_builder_page.s2', "حفظ كقالب مخصص")}</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={handleExportCsv}
            disabled={!pivotResult || !pivotResult.rowKeys.length}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
          >
            <DownloadIcon size={15} color="#475569" />
            <span>{t('reports.pivot_builder_page.s3', "تصدير CSV")}</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => window.print()}
            disabled={!pivotResult || !pivotResult.rowKeys.length}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
          >
            <PrinterIcon size={15} color="#475569" />
            <span>{t('reports.pivot_builder_page.s4', "طباعة")}</span>
          </Button>

          <Button
            type="button"
            disabled={loading}
            onClick={handleExecute}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              fontSize: '12.5px',
            }}
          >
            <RefreshCwIcon size={15} color="#ffffff" className={loading ? 'animate-spin' : ''} />
            <span>{loading ? t('reports.pivot_builder_page.s5', "جاري التحليل...") : t('reports.pivot_builder_page.s6', "تحديث وتحليل البيانات")}</span>
          </Button>
        </div>
      </div>

      {/* Saved Presets Ribbon */}
      {savedTemplates.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            overflowX: 'auto',
            padding: '8px 12px',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#170e5e', whiteSpace: 'nowrap' }}>
            <LayersIcon size={14} color="#170e5e" />
            <span>{t('reports.pivot_builder_page.s7', "القوالب المحفوظة:")}</span>
          </div>

          {savedTemplates.map((tmpl) => (
            <div
              key={tmpl.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '6px',
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                color: '#334155',
                whiteSpace: 'nowrap',
              }}
            >
              <button
                type="button"
                onClick={() => handleApplyTemplate(tmpl)}
                style={{
                  border: 'none',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#170e5e',
                  padding: 0,
                }}
              >
                {tmpl.name}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTemplate(tmpl.id, tmpl.name)}
                title={t('reports.pivot_builder_page.s8', "حذف القالب")}
                style={{
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '0 2px',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Configuration Control Panel Card */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '16px',
          marginBottom: '16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        {/* Dataset */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#170e5e', marginBottom: '4px' }}>
            {t('reports.pivot_builder_page.s9', "مصدر البيانات الأساسي *")}
          </label>
          <CustomSelect
            options={datasetOptions}
            value={dataset}
            onChange={(val) => setDataset(val as any)}
          />
        </div>

        {/* Row Dimension */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#170e5e', marginBottom: '4px' }}>
            {t('reports.pivot_builder_page.s10', "بُعد الصفوف (Rows) *")}
          </label>
          <CustomSelect
            options={getRowDimensionOptions()}
            value={rowDimension}
            onChange={(val) => setRowDimension(val)}
          />
        </div>

        {/* Col Dimension */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#170e5e', marginBottom: '4px' }}>
            {t('reports.pivot_builder_page.s11', "بُعد الأعمدة (Columns)")}
          </label>
          <CustomSelect
            options={getColDimensionOptions()}
            value={colDimension}
            onChange={(val) => setColDimension(val)}
          />
        </div>

        {/* Metric */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#170e5e', marginBottom: '4px' }}>
            {t('reports.pivot_builder_page.s12', "المؤشر المحسوب (Metric) *")}
          </label>
          <CustomSelect
            options={metricOptions}
            value={metric}
            onChange={(val) => setMetric(val as any)}
          />
        </div>

        {/* Date From */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
            {t('reports.pivot_builder_page.s13', "من تاريخ")}
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{
              width: '100%',
              padding: '6.5px 10px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '12.5px',
              backgroundColor: '#ffffff',
            }}
          />
        </div>

        {/* Date To */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
            {t('reports.pivot_builder_page.s14', "إلى تاريخ")}
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{
              width: '100%',
              padding: '6.5px 10px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '12.5px',
              backgroundColor: '#ffffff',
            }}
          />
        </div>
      </div>

      {/* Main Pivot Table View Card */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FileTextIcon size={16} color="#170e5e" />
            <span>
              {t('reports.pivot_builder_page.s15', "جدول التحليل المحوري:")} {getRowLabel()} {getColLabel() ? `× ${getColLabel()}` : ''} ({getMetricLabel()})
            </span>
          </div>

          {pivotResult && pivotResult.rowKeys.length > 0 && (
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              {t('reports.pivot_builder_page.s16', "إجمالي الصفوف:")} <strong>{pivotResult.rowKeys.length}</strong> {t('reports.pivot_builder_page.s17', "| إجمالي الأعمدة:")} <strong>{pivotResult.colKeys.length}</strong>
            </div>
          )}
        </div>

        <PivotGridTable
          data={pivotResult}
          loading={loading}
          rowDimensionLabel={getRowLabel()}
          colDimensionLabel={getColLabel()}
          metricLabel={getMetricLabel()}
        />
      </div>

      {/* Save Template Modal */}
      <SavePivotTemplateModal
        open={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSaved={loadTemplates}
        currentConfig={{
          dataset,
          rowDimension,
          colDimension: colDimension === 'none' ? undefined : colDimension,
          metric,
          dateFrom,
          dateTo,
        }}
      />
    </div>
  );
};
