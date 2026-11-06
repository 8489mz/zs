import { useTranslation } from 'react-i18next';
import { QueryCard } from '@/shared/components/query-card';
import { Button } from '@/shared/ui/button';
import { ReportPrintMenu } from '@/shared/components/ReportPrintMenu';
import { DataTable } from '@/shared/ui/data-table';
import { Field } from '@/shared/ui/field';
import { ReportMetricCard } from '@/features/reports/components/ReportMetricCard';
import { relativePercent } from '@/features/reports/lib/reports-format';
import { formatCurrency } from '@/lib/format';
import { getCurrencyDecimals } from '@/lib/currencies';
import type { ReportsSectionContentProps } from '@/features/reports/components/reports-section.types';

export function InventoryReportSection({
  inventoryQuery,
  accountingInventoryValue,
  exportLowStock,
  printInventoryValueReport,
  printInventoryMovementsReport,
  locationId,
  inventorySearch,
  onInventorySearchChange,
  inventoryFilter,
  onInventoryFilterChange,
  deadStockDays = 60,
  onDeadStockDaysChange,
  onInventoryPageChange,
  onInventoryPageSizeChange,
  onInventoryFiltersReset
}: Pick<ReportsSectionContentProps, 'inventoryQuery' | 'accountingInventoryValue' | 'exportLowStock' | 'printInventoryValueReport' | 'printInventoryMovementsReport' | 'locationId' | 'inventorySearch' | 'onInventorySearchChange' | 'inventoryFilter' | 'onInventoryFilterChange' | 'deadStockDays' | 'onDeadStockDaysChange' | 'onInventoryPageChange' | 'onInventoryPageSizeChange' | 'onInventoryFiltersReset'>) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const rows = inventoryQuery.data?.rows || [];
  const pagination = inventoryQuery.data?.pagination;
  const summary = inventoryQuery.data?.summary;
  const inventoryTotals = accountingInventoryValue?.totals;
  const isDeadStock = inventoryFilter === 'dead';

  const tiedCapital = rows.reduce((sum, r) => sum + (r.stock * (r.costPrice || 0)), 0);
  const deadStockUnits = rows.reduce((sum, r) => sum + (r.stock || 0), 0);

  const values = [
    summary?.totalItems || 0,
    summary?.outOfStock || 0,
    summary?.lowStock || 0,
    summary?.healthy || 0,
    inventoryTotals?.totalInventoryValue || 0,
    inventoryTotals?.totalRetailPotentialValue || 0,
  ];
  const locationHighlights = summary?.locationHighlights || [];

  const sectionTitle = isDeadStock
    ? (isEn ? 'Dead Stock & Tied Capital Analysis' : 'تحليل المخزون الراكد ورأس المال المجمد')
    : inventoryFilter === 'all'
      ? (isEn ? 'Inventory Balances & Valuation' : 'أرصدة وتقييم المخزون')
      : inventoryFilter === 'low'
        ? (isEn ? 'Low Stock Items' : 'أصناف قاربت على النفاد')
        : inventoryFilter === 'out'
          ? (isEn ? 'Out of Stock Items' : 'أصناف نافدة المخزون')
          : (isEn ? 'Items Needing Attention' : 'أصناف تحتاج متابعة');

  const sectionDescription = isDeadStock
    ? (isEn ? `Identify available store items with zero sales movements in the last ${deadStockDays} days and calculate tied capital.` : `رصد الأصناف المتوفرة بالمخازن والتي لم تسجل أي حركة بيع خلال آخر ${deadStockDays} يوم، مع حساب رأس المال المعطل فيها.`)
    : inventoryFilter === 'all'
      ? (isEn ? 'Review item balances and financial valuation in stores with search, filtering, printing, and exporting.' : 'استعراض ومراجعة أرصدة الأصناف وقيمتها المالية في المخازن مع البحث والفلترة والطباعة والتصدير.')
      : (isEn ? 'Review critical items highlighting shortages and current inventory valuation.' : 'مراجعة الأصناف الحرجة مع إبراز النواقص وقيمة المخزون الحالية.');

  return (
    <QueryCard
      title={sectionTitle}
      description={sectionDescription}
      actions={
        <div className="actions compact-actions" style={{ flexWrap: 'nowrap', gap: '6px' }}>
          <Button
            variant={isDeadStock ? 'primary' : 'secondary'}
            onClick={() => onInventoryFilterChange(isDeadStock ? 'attention' : 'dead')}
            style={isDeadStock ? { background: '#170e5e', color: '#fff', fontSize: '0.8rem', padding: '5px 10px' } : { fontSize: '0.8rem', padding: '5px 10px' }}
          >
            {isDeadStock ? t('reports.sections.inventory_report_section.s0', "العودة للمخزون الحرج") : t('reports.sections.inventory_report_section.s1', "تحليل المخزون الراكد")}
          </Button>
          <Button variant="secondary" onClick={() => void exportLowStock()} disabled={!summary?.totalItems} style={{ fontSize: '0.8rem', padding: '5px 10px' }}>
            {t('reports.sections.inventory_report_section.s2', "تصدير Excel")}
          </Button>
          <ReportPrintMenu
            label={t('reports.sections.inventory_report_section.s3', "طباعة الجرد والقيمة")}
            onPrintA4={() => void printInventoryValueReport('A4')}
            onPrintReceipt={() => void printInventoryValueReport('receipt')}
            disabled={!summary?.totalItems}
          />
          <ReportPrintMenu
            label={t('reports.sections.inventory_report_section.s4', "طباعة الحركات")}
            onPrintA4={() => void printInventoryMovementsReport(locationId, true, 'A4')}
            onPrintReceipt={() => void printInventoryMovementsReport(locationId, true, 'receipt')}
          />
        </div>
      }
      className="reports-focus-card"
      isLoading={inventoryQuery.isLoading}
      isError={inventoryQuery.isError}
      error={inventoryQuery.error}
      isEmpty={!summary?.totalItems}
      loadingText={isDeadStock ? t('reports.sections.inventory_report_section.s5', "جاري فحص المخزون الراكد...") : t('reports.sections.inventory_report_section.s6', "جاري تحميل الأصناف الحرجة...")}
      emptyTitle={isDeadStock ? t('reports.sections.inventory_report_section.s7', "ممتاز! لا يوجد مخزون راكد") : t('reports.sections.inventory_report_section.s8', "لا توجد أصناف حرجة حاليًا")}
      emptyHint={isDeadStock ? `جميع الأصناف المتوفرة تم بيعها أو تحركت خلال آخر ${deadStockDays} يوم.` : t('reports.sections.inventory_report_section.s9', "المخزون الحالي في وضع جيد لهذه الفترة.")}
      preserveChildrenOnEmpty
      emptyAction={<Button variant="secondary" onClick={onInventoryFiltersReset}>{t('reports.sections.inventory_report_section.s10', "إعادة الضبط")}</Button>}
    >
      {isDeadStock ? (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '12px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85em', color: '#64748b', marginBottom: '4px' }}>{t('reports.sections.inventory_report_section.s11', "أصناف راكدة (الصفحة الحالية)")}</div>
              <div style={{ fontSize: '1.4em', fontWeight: 'bold', color: '#dc2626' }}>{summary?.totalItems || rows.length} {isEn ? 'Items' : t('reports.sections.inventory_report_section.s12', "صنف")}</div>
            </div>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85em', color: '#64748b', marginBottom: '4px' }}>{t('reports.sections.inventory_report_section.s13', "إجمالي الوحدات المعطلة")}</div>
              <div style={{ fontSize: '1.4em', fontWeight: 'bold', color: '#d97706' }}>{deadStockUnits} {isEn ? 'Units' : t('reports.sections.inventory_report_section.s14', "وحدة")}</div>
            </div>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85em', color: '#64748b', marginBottom: '4px' }}>{t('reports.sections.inventory_report_section.s15', "رأس المال المجمد التقديري")}</div>
              <div style={{ fontSize: '1.4em', fontWeight: 'bold', color: '#170e5e' }}>{formatCurrency(tiedCapital)}</div>
            </div>
          </div>
          <div style={{ fontSize: '0.85em', color: '#475569', lineHeight: 1.6 }}>
            <strong>{t('reports.sections.inventory_report_section.s16', "توصية تشغيلية:")}</strong> {t('reports.sections.inventory_report_section.s17', "تم تصفية الأصناف التي تمتلك أرصدة موجبة ولم تسجل أي حركة بيع معتمدة منذ")} <strong>{deadStockDays}</strong> {t('reports.sections.inventory_report_section.s18', "يوم فأكثر. يُنصح بعمل عروض مجمعة (Bundles) أو خصومات تصفية لتسييل رأس المال وإعادة تدويره.")}
          </div>
        </div>
      ) : (
        <>
          <div className="reports-spotlight-grid section-spotlight-grid compact-spotlight-grid">
            <ReportMetricCard label={t('reports.sections.inventory_report_section.s19', "إجمالي النتائج")} value={summary?.totalItems || 0} helper={t('reports.sections.inventory_report_section.s20', "ضمن الفلتر الحالي")} tone="primary" progress={relativePercent(summary?.totalItems || 0, values)} />
            <ReportMetricCard label={t('reports.sections.inventory_report_section.s21', "نافد")} value={summary?.outOfStock || 0} helper={t('reports.sections.inventory_report_section.s22', "يحتاج شراء فورًا")} tone="danger" progress={relativePercent(summary?.outOfStock || 0, values)} />
            <ReportMetricCard label={t('reports.sections.inventory_report_section.s23', "منخفض")} value={summary?.lowStock || 0} helper={t('reports.sections.inventory_report_section.s24', "قريب من الحد الأدنى")} tone="warning" progress={relativePercent(summary?.lowStock || 0, values)} />
            <ReportMetricCard label={t('reports.sections.inventory_report_section.s25', "سليم")} value={summary?.healthy || 0} helper={isEn ? `Tracked Locations: ${summary?.trackedLocations || 0}` : `مواقع مرصودة: ${summary?.trackedLocations || 0}`} tone="success" progress={relativePercent(summary?.healthy || 0, values)} />
            <ReportMetricCard label={t('reports.sections.inventory_report_section.s26', "قيمة المخزون")} value={inventoryTotals?.totalInventoryValue || 0} helper={t('reports.sections.inventory_report_section.s27', "حسب تكلفة الشراء الحالية")} tone="primary" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(inventoryTotals?.totalInventoryValue || 0, values)} />
            <ReportMetricCard label={t('reports.sections.inventory_report_section.s28', "قيمة البيع التقديرية")} value={inventoryTotals?.totalRetailPotentialValue || 0} helper={t('reports.sections.inventory_report_section.s29', "ليست ربحًا محققًا")} tone="success" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(inventoryTotals?.totalRetailPotentialValue || 0, values)} />
          </div>
          {inventoryTotals ? (
            <div className="metric-list reports-metric-list">
              <div className="metric-row"><span>{t('reports.sections.inventory_report_section.s30', "الهامش التقديري")}</span><strong>{formatCurrency(inventoryTotals.totalPotentialGrossMargin || 0)}</strong></div>
              <div className="metric-row"><span>{t('reports.sections.inventory_report_section.s31', "أصناف منتهية")}</span><strong>{inventoryTotals.zeroStockCount || 0}</strong></div>
              <div className="metric-row"><span>{t('reports.sections.inventory_report_section.s32', "أصناف قليلة المخزون")}</span><strong>{inventoryTotals.lowStockCount || 0}</strong></div>
            </div>
          ) : null}
        </>
      )}

      {!isDeadStock && locationHighlights.length ? (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginTop: '16px' }} aria-label={t('reports.sections.inventory_report_section.s33', "المخازن الأكثر احتياجًا للمتابعة")}>
          <div style={{ fontWeight: 'bold', marginBottom: '12px', color: '#1e293b' }}>{t('reports.sections.inventory_report_section.s34', "أكثر المخازن احتياجًا للمتابعة")}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {locationHighlights.slice(0, 3).map((location) => (
              <div key={location.locationId} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                <div style={{ fontWeight: 'bold', fontSize: '1.05em', color: '#0f172a' }}>{location.locationName}</div>
                <div className="muted small" style={{ marginBottom: '8px' }}>{location.branchName || t('reports.sections.inventory_report_section.s35', "بدون فرع محدد")}</div>
                <div style={{ fontSize: '0.9em', color: '#334155' }}>{t('reports.sections.inventory_report_section.s36', "أصناف تحتاج متابعة:")} <strong>{location.attentionItems}</strong></div>
                <div className="muted small" style={{ marginTop: '6px', fontSize: '0.8em' }}>{t('reports.sections.inventory_report_section.s37', "إجمالي الكمية:")} {location.totalQty} {t('reports.sections.inventory_report_section.s38', "· أصناف مرصودة:")} {location.trackedProducts}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="toolbar-grid compact-toolbar-grid" style={{ marginTop: '16px' }}>
        <Field label={t('reports.sections.inventory_report_section.s39', "بحث")}><input value={inventorySearch} onChange={(event) => onInventorySearchChange(event.target.value)} placeholder={t('reports.sections.inventory_report_section.s40', "اسم الصنف / القسم / المورد")} /></Field>
        <Field label={t('reports.sections.inventory_report_section.s41', "الحالة")}>
          <select value={inventoryFilter} onChange={(event) => onInventoryFilterChange(event.target.value as 'all' | 'attention' | 'low' | 'out' | 'dead')}>
            <option value="attention">{t('reports.sections.inventory_report_section.s42', "يحتاج متابعة")}</option>
            <option value="all">{t('reports.sections.inventory_report_section.s43', "الكل")}</option>
            <option value="low">{t('reports.sections.inventory_report_section.s44', "منخفض")}</option>
            <option value="out">{t('reports.sections.inventory_report_section.s45', "نافد")}</option>
            <option value="dead">{t('reports.sections.inventory_report_section.s46', "مخزون راكد (بدون مبيعات)")}</option>
          </select>
        </Field>
        {isDeadStock ? (
          <Field label={t('reports.sections.inventory_report_section.s47', "فترة الركود")}>
            <select value={deadStockDays} onChange={(e) => onDeadStockDaysChange?.(Number(e.target.value))}>
              <option value={30}>{t('reports.sections.inventory_report_section.s48', "30 يوم فأكثر")}</option>
              <option value={60}>{t('reports.sections.inventory_report_section.s49', "60 يوم فأكثر (افتراضي)")}</option>
              <option value={90}>{t('reports.sections.inventory_report_section.s50', "90 يوم فأكثر")}</option>
              <option value={180}>{t('reports.sections.inventory_report_section.s51', "180 يوم فأكثر (نصف سنوي)")}</option>
            </select>
          </Field>
        ) : null}
        <div className="actions compact-actions" style={{ alignItems: 'end' }}><Button variant="secondary" onClick={onInventoryFiltersReset}>{t('reports.sections.inventory_report_section.s52', "إعادة الضبط")}</Button></div>
      </div>

      <DataTable
        ariaLabel={isDeadStock ? t('reports.sections.inventory_report_section.s53', "تحليل المخزون الراكد") : t('reports.sections.inventory_report_section.s54', "أصناف تحتاج متابعة")}
        columns={
          isDeadStock
            ? [
                { key: 'name', header: t('reports.sections.inventory_report_section.s55', "الصنف"), cell: (row) => row.name },
                { key: 'category', header: t('reports.sections.inventory_report_section.s56', "القسم"), cell: (row) => row.category || '—' },
                { key: 'supplier', header: t('reports.sections.inventory_report_section.s57', "المورد"), cell: (row) => row.supplier || '—' },
                { key: 'stock', header: t('reports.sections.inventory_report_section.s58', "الرصيد الراكد"), cell: (row) => <strong>{row.stock}</strong> },
                { key: 'costPrice', header: t('reports.sections.inventory_report_section.s59', "التكلفة الفردية"), cell: (row) => formatCurrency(row.costPrice || 0) },
                { key: 'tiedCapital', header: t('reports.sections.inventory_report_section.s60', "رأس المال المجمد"), cell: (row) => <span style={{ color: '#b91c1c', fontWeight: 'bold' }}>{formatCurrency(row.stock * (row.costPrice || 0))}</span> },
                { key: 'retailPrice', header: t('reports.sections.inventory_report_section.s61', "سعر البيع"), cell: (row) => formatCurrency(row.retailPrice || 0) },
                { key: 'topLocation', header: t('reports.sections.inventory_report_section.s62', "أكبر مخزن"), cell: (row) => row.topLocationName ? `${row.topLocationName}${row.topLocationQty ? ` (${row.topLocationQty})` : ''}` : '—' },
                { key: 'status', header: t('reports.sections.inventory_report_section.s63', "الحالة"), cell: () => <span className="nav-pill" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>{t('reports.sections.inventory_report_section.s64', "راكد (")}{deadStockDays} {t('reports.sections.inventory_report_section.s65', "يوم+)")}</span> },
              ]
            : [
                { key: 'name', header: t('reports.sections.inventory_report_section.s66', "الصنف"), cell: (row) => row.name },
                { key: 'category', header: t('reports.sections.inventory_report_section.s67', "القسم"), cell: (row) => row.category || '—' },
                { key: 'supplier', header: t('reports.sections.inventory_report_section.s68', "المورد"), cell: (row) => row.supplier || '—' },
                { key: 'stock', header: t('reports.sections.inventory_report_section.s69', "المخزون"), cell: (row) => row.stock },
                { key: 'minStock', header: t('reports.sections.inventory_report_section.s70', "الحد الأدنى"), cell: (row) => row.minStock },
                { key: 'topLocation', header: t('reports.sections.inventory_report_section.s71', "أكبر مخزن"), cell: (row) => row.topLocationName ? `${row.topLocationName}${row.topLocationQty ? ` (${row.topLocationQty})` : ''}` : '—' },
                { key: 'warehouses', header: t('reports.sections.inventory_report_section.s72', "توزيع المخازن"), cell: (row) => row.stockLocationExcessQty && row.stockLocationExcessQty > 0.001
                  ? <span role="alert" style={{ color: '#b91c1c', fontWeight: 700 }}>{row.locationsLabel}</span>
                  : row.locationsLabel || '—' },
                { key: 'status', header: t('reports.sections.inventory_report_section.s73', "الحالة"), cell: (row) => row.status || 'ok' },
              ]
        }
        rows={rows}
        empty={<div className="muted small">{isDeadStock ? t('reports.sections.inventory_report_section.s74', "لا يوجد مخزون راكد يطابق البحث والفترة المحددة.") : t('reports.sections.inventory_report_section.s75', "لا توجد نتائج مطابقة.")}</div>}
        pagination={pagination ? { page: pagination.page, pageSize: pagination.pageSize, totalItems: pagination.totalItems, onPageChange: onInventoryPageChange, onPageSizeChange: onInventoryPageSizeChange, itemLabel: t('reports.sections.inventory_report_section.s76', "صنف") } : undefined}
      />
    </QueryCard>
  );
}
