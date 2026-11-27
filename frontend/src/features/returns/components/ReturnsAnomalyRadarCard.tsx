import {
  type SuspectFlag,
  detectReturnsAnomalies,
  type AnalyzedReturnRecord,
  type CashierRiskMetric,
} from '@/features/returns/lib/returns-anomaly-detector';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { StatsGrid } from '@/shared/components/stats-grid';
import { DataTable } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { SearchToolbar } from '@/shared/components/search-toolbar';
import {
  FileSpreadsheetIcon,
  PrinterIcon,
} from '@/shared/components/icons/AppIcons';
import { formatCurrency, formatDate } from '@/lib/format';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import {
  exportAnomalyReportExcel,
  printAnomalyReport,
} from '@/features/returns/lib/returns-workspace.helpers';
import type { ReturnRecord, Sale } from '@/types/domain';

interface ReturnsAnomalyRadarCardProps {
  returns: ReturnRecord[];
  sales: Sale[];
  onSelectReturn?: (returnId: string) => void;
}

export function ReturnsAnomalyRadarCard({
  returns,
  sales,
  onSelectReturn,
}: ReturnsAnomalyRadarCardProps) {
  const { t } = useTranslation();
  const [subView, setSubView] = useState<'suspects' | 'cashiers'>('suspects');
  const [selectedCashier, setSelectedCashier] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<'all' | 'high' | 'rapid' | 'medium'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const summary = useMemo(() => {
    return detectReturnsAnomalies(returns, sales);
  }, [returns, sales]);

  const filteredRecords = useMemo(() => {
    let list = summary.analyzedRecords;

    if (selectedCashier !== 'all') {
      list = list.filter((r) => r.cashierName.toLowerCase() === selectedCashier.toLowerCase());
    }

    if (riskFilter === 'high') {
      list = list.filter((r) => r.riskLevel === 'high');
    } else if (riskFilter === 'rapid') {
      list = list.filter((r) => r.timeGapMinutes !== null && r.timeGapMinutes <= 15);
    } else if (riskFilter === 'medium') {
      list = list.filter((r) => r.riskLevel === 'medium');
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((r) =>
        r.returnDocNo.toLowerCase().includes(query) ||
        r.invoiceDocNo.toLowerCase().includes(query) ||
        r.cashierName.toLowerCase().includes(query) ||
        String(r.record.productName || '').toLowerCase().includes(query)
      );
    }

    return list;
  }, [summary.analyzedRecords, selectedCashier, riskFilter, searchQuery]);

  const handleCopyCctvTime = (record: AnalyzedReturnRecord) => {
    const text = `${t('returns.cctv_check', 'فحص كاميرا المراقبة')}:\n${t('returns.col_cashier', 'الكاشير')}: ${record.cashierName}\n${t('returns.cctv_sale_date', 'تاريخ الفاتورة')}: ${record.saleDate ? formatDate(record.saleDate) : '—'}\n${t('returns.cctv_return_date', 'تاريخ المرتجع')}: ${record.returnDate ? formatDate(record.returnDate) : '—'}\n${t('returns.cctv_time_gap', 'الفارق الزمني')}: ${record.timeGapMinutes !== null ? `${record.timeGapMinutes} ${t('returns.unit_minute', 'دقيقة')}` : t('returns.undefined', 'غير محدد')}\n${t('returns.col_product', 'الصنف')}: ${record.record.productName}\n${t('returns.amount', 'المبلغ')}: ${record.record.total} ${getGlobalCurrencySymbol()}`;
    navigator.clipboard.writeText(text);
    setCopiedId(record.record.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const getFlagLabel = (flag: SuspectFlag, row: AnalyzedReturnRecord) => {
    if (flag.id === 'rapid_return') {
      return t('returns.flag_rapid', 'مرتجع فوري سريع (بعد {{minutes}} دقيقة فقط من البيع)', { minutes: row.timeGapMinutes });
    }
    if (flag.id === 'high_value') {
      return t('returns.flag_high_value', 'قيمة مرتجع عالية ({{amount}} {{symbol}})', { amount: Number(row.record.total || 0).toLocaleString(), symbol: getGlobalCurrencySymbol() });
    }
    if (flag.id === 'anonymous_cash') {
      return t('returns.flag_anonymous_cash', 'مرتجع نقدي لعميل غير مسجل');
    }
    if (flag.id === 'unmatched_sale') {
      return t('returns.flag_unmatched_sale', 'فاتورة غير مسجلة مباشرة');
    }
    return flag.label;
  };

  const stats = [
    { key: 'suspect', label: t('returns.stats_suspect', 'حركات مشبوهة مرصودة'), value: summary.totalSuspectReturnsCount },
    { key: 'rapid', label: t('returns.stats_rapid', 'مرتجعات سريعة (أقل من 15 دقيقة)'), value: summary.totalRapidReturnsCount },
    { key: 'cashiers', label: t('returns.stats_cashiers', 'كاشيرات تحت الملاحظة'), value: summary.highRiskCashiersCount },
    { key: 'rate', label: t('returns.stats_rate', 'معدل المرتجعات العام'), value: `${summary.overallReturnRatePercent}%` },
  ] as const;

  return (
    <div className="section-stack" style={{ gap: '12px' }}>
      {/* 1. Native Standard Stats Grid */}
      <StatsGrid items={stats} className="stats-grid compact-grid grid-cols-4" />

      {/* 2. Main Radar Form Section */}
      <FormSection
        title={t('returns.radar_title', 'رقابة وتدقيق شبهات المرتجعات')}
        description={t('returns.radar_desc', 'تحليل ذكي يكشف عمليات إرجاع الفواتير المتروكة ونسب الشبهات لكل كاشير.')}
        actions={
          <div className="actions compact-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => printAnomalyReport(summary)}
              disabled={!summary.analyzedRecords.length}
            >
              <PrinterIcon size={14} />
              <span>{t('returns.print_radar_report', 'طباعة تقرير الرقابة')}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => exportAnomalyReportExcel(summary)}
              disabled={!summary.analyzedRecords.length}
            >
              <FileSpreadsheetIcon size={14} />
              <span>{t('returns.export_excel', 'تصدير Excel')}</span>
            </Button>
          </div>
        }
        className="workspace-panel returns-register-card"
      >
        {/* Search Toolbar with Subview Switcher */}
        <SearchToolbar
          search={searchQuery}
          onSearchChange={(val) => { setSearchQuery(val); setPage(1); }}
          searchPlaceholder={t('returns.radar_search_placeholder', 'ابحث برقم المستند أو الفاتورة الأصلية أو الصنف أو الكاشير...')}
        >
          <Button
            variant={subView === 'suspects' ? 'primary' : 'secondary'}
            onClick={() => { setSubView('suspects'); setPage(1); }}
          >
            {t('returns.subview_suspects', 'سجل تدقيق الحركات')} ({filteredRecords.length})
          </Button>
          <Button
            variant={subView === 'cashiers' ? 'primary' : 'secondary'}
            onClick={() => { setSubView('cashiers'); setPage(1); }}
          >
            {t('returns.subview_cashiers', 'مخاطر الكاشيرات')} ({summary.cashierMetrics.length})
          </Button>
        </SearchToolbar>

        {/* Filter Chip Row */}
        {subView === 'suspects' && (
          <div className="filter-chip-row">
            <input
              value={selectedCashier === 'all' ? '' : selectedCashier}
              onChange={(e) => { setSelectedCashier(e.target.value || 'all'); setPage(1); }}
              placeholder={t('returns.filter_cashier_placeholder', 'فلترة باسم الكاشير')}
              style={{ minWidth: 200 }}
            />
            <Button variant={riskFilter === 'all' ? 'primary' : 'secondary'} onClick={() => { setRiskFilter('all'); setPage(1); }}>
              {t('returns.all_movements', 'كافة الحركات')}
            </Button>
            <Button variant={riskFilter === 'high' ? 'primary' : 'secondary'} onClick={() => { setRiskFilter('high'); setPage(1); }}>
              {t('returns.high_suspect', 'شبهة مرتفعة')} ({summary.totalSuspectReturnsCount})
            </Button>
            <Button variant={riskFilter === 'rapid' ? 'primary' : 'secondary'} onClick={() => { setRiskFilter('rapid'); setPage(1); }}>
              {t('returns.rapid_returns', 'مرتجعات سريعة')} ({summary.totalRapidReturnsCount})
            </Button>
            <Button variant={riskFilter === 'medium' ? 'primary' : 'secondary'} onClick={() => { setRiskFilter('medium'); setPage(1); }}>
              {t('returns.medium_suspect', 'متابعة وتدقيق')}
            </Button>
          </div>
        )}

        {/* View 1: Suspect Events Standard DataTable */}
        {subView === 'suspects' ? (
          <div style={{ overflowX: 'auto', width: '100%' }}>
            {filteredRecords.length ? (
              <DataTable<AnalyzedReturnRecord>
                rows={filteredRecords.slice((page - 1) * pageSize, page * pageSize)}
                rowKey={(row) => row.record.id}
                onRowClick={(row) => onSelectReturn?.(row.record.id)}
                rowTitle={() => t('returns.row_click_hint', 'انقر لعرض تفاصيل المرتجع')}
                pagination={{
                  page,
                  pageSize,
                  totalItems: filteredRecords.length,
                  onPageChange: setPage,
                  onPageSizeChange: (nextPageSize) => { setPageSize(nextPageSize); setPage(1); },
                  itemLabel: t('returns.item_suspect', 'حركة مشبوهة'),
                }}
                columns={[
                  {
                    key: 'docNo',
                    header: t('returns.col_doc_no', 'رقم المستند'),
                    cell: (row) => (
                      <div>
                        <strong>{row.returnDocNo}</strong>
                        {row.invoiceDocNo ? (
                          <div className="muted small" style={{ fontSize: '0.78rem' }}>
                            {t('returns.original_doc', 'أصل')}: {row.invoiceDocNo}
                          </div>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    key: 'product',
                    header: t('returns.col_product', 'الصنف'),
                    cell: (row) => (
                      <div>
                        <strong>{row.record.productName || '—'}</strong>
                        <div className="muted small" style={{ fontSize: '0.78rem' }}>{t('returns.col_qty', 'الكمية')}: {row.record.qty}</div>
                      </div>
                    ),
                  },
                  {
                    key: 'total',
                    header: t('returns.refund_amount', 'المبلغ المسترد'),
                    cell: (row) => <strong>{formatCurrency(Number(row.record.total || 0))}</strong>,
                  },
                  {
                    key: 'cashier',
                    header: t('returns.col_cashier', 'الكاشير'),
                    cell: (row) => row.cashierName,
                  },
                  {
                    key: 'timeGap',
                    header: t('returns.col_time_gap', 'الفارق الزمني'),
                    cell: (row) => (
                      row.timeGapMinutes !== null ? (
                        <span className={row.timeGapMinutes <= 15 ? 'badge badge-danger' : 'badge'}>
                          {row.timeGapMinutes <= 0 ? t('returns.same_minute', 'في نفس الدقيقة') : t('returns.after_minutes', 'بعد {{minutes}} دقيقة', { minutes: row.timeGapMinutes })}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )
                    ),
                  },
                  {
                    key: 'flags',
                    header: t('returns.col_flags', 'مؤشرات الشبهة'),
                    cell: (row) => (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {row.flags.map((flag) => (
                          <span
                            key={flag.id}
                            className={flag.severity === 'danger' ? 'badge badge-danger' : 'badge badge-warning'}
                            style={{ fontSize: '0.75rem' }}
                          >
                            {getFlagLabel(flag, row)}
                          </span>
                        ))}
                      </div>
                    ),
                  },
                  {
                    key: 'date',
                    header: t('returns.col_date', 'التاريخ'),
                    cell: (row) => formatDate(row.returnDate),
                  },
                  {
                    key: 'actions',
                    header: t('common.actions', 'إجراءات'),
                    cell: (row) => (
                      <div className="actions compact-actions" style={{ flexWrap: 'nowrap' }}>
                        <Button
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyCctvTime(row);
                          }}
                          title={t('returns.copy_cctv_hint', 'نسخ توقيت البيع والمرتجع لمطابقة الكاميرات')}
                        >
                          {copiedId === row.record.id ? t('returns.copied', 'تم النسخ') : t('returns.copy_cctv', 'نسخ للكاميرا')}
                        </Button>
                        {onSelectReturn && (
                          <Button
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectReturn(row.record.id);
                            }}
                          >
                            {t('common.view', 'عرض')}
                          </Button>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            ) : (
              <div className="empty-state-card">{t('returns.empty_suspects', 'لا توجد حركات مشبوهة مطابقة لمعايير البحث')}</div>
            )}
          </div>
        ) : (
          /* View 2: Cashier Risk Scoreboard Standard DataTable */
          <div style={{ overflowX: 'auto', width: '100%' }}>
            {summary.cashierMetrics.length ? (
              <DataTable<CashierRiskMetric>
                rows={summary.cashierMetrics}
                rowKey={(c) => c.cashierKey}
                columns={[
                  { key: 'name', header: t('returns.col_cashier_employee', 'الكاشير / الموظف'), cell: (c) => <strong>{c.cashierName}</strong> },
                  { key: 'salesCount', header: t('returns.col_sales_count', 'فواتير البيع'), cell: (c) => c.salesCount },
                  { key: 'salesTotal', header: t('returns.col_sales_total', 'إجمالي المبيعات'), cell: (c) => formatCurrency(c.salesTotal) },
                  { key: 'returnsCount', header: t('returns.col_returns_count', 'عدد المرتجعات'), cell: (c) => <strong>{c.returnsCount}</strong> },
                  { key: 'returnsTotal', header: t('returns.col_returns_total', 'إجمالي المرتجعات'), cell: (c) => <strong>{formatCurrency(c.returnsTotal)}</strong> },
                  {
                    key: 'rate',
                    header: t('returns.col_return_rate', 'نسبة المرتجع %'),
                    cell: (c) => (
                      <span className={c.returnRatePercent > 5 ? 'badge badge-danger' : c.returnRatePercent > 2.5 ? 'badge badge-warning' : 'badge'}>
                        {c.returnRatePercent}%
                      </span>
                    ),
                  },
                  {
                    key: 'rapid',
                    header: t('returns.col_rapid_returns_col', 'مرتجعات سريعة (< 15د)'),
                    cell: (c) => (
                      <span className={c.rapidReturnsCount > 0 ? 'badge badge-danger' : 'badge'}>
                        {c.rapidReturnsCount}
                      </span>
                    ),
                  },
                  {
                    key: 'risk',
                    header: t('returns.col_audit_evaluation', 'التقييم الرقابي'),
                    cell: (c) => (
                      <span className={c.riskLevel === 'high' ? 'badge badge-danger' : c.riskLevel === 'medium' ? 'badge badge-warning' : 'badge badge-success'}>
                        {c.riskLevel === 'high' ? t('returns.high_suspect', 'شبهة مرتفعة') : c.riskLevel === 'medium' ? t('returns.medium_suspect', 'متابعة وتدقيق') : t('returns.risk_normal', 'طبيعي')}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <div className="empty-state-card">{t('returns.empty_cashiers', 'لا توجد بيانات كافية لتقييم الكاشيرات')}</div>
            )}
          </div>
        )}
      </FormSection>
    </div>
  );
}
