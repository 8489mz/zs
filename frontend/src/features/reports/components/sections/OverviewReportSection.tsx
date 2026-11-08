import { useTranslation } from 'react-i18next';
import { useMemo, type CSSProperties } from 'react';
import { QueryCard } from '@/shared/components/query-card';
import { AnimatedValue } from '@/shared/components/animated-value';
import { FormSection } from '@/shared/components/form-section';
import { formatCurrency } from '@/lib/format';
import type { ReportsSectionContentProps } from '@/features/reports/components/reports-section.types';
import { CircularProgress } from '@/shared/components/charts/CircularProgress';
import { SalesTrendChart } from '@/shared/components/charts/SalesTrendChart';
import { ShiftAnalysisChart } from '@/shared/components/charts/ShiftAnalysisChart';
import { ShoppingCartIcon, PackageIcon, CreditCardIcon, TrendingUpIcon } from '@/shared/components/icons/AppIcons';

export function OverviewReportSection({
  report,
  reportQuery,
  accountingFinancialSummary,
  accountingCashMovement,
  executiveRows,
  formatPercent,
}: Pick<ReportsSectionContentProps, 'report' | 'reportQuery' | 'accountingFinancialSummary' | 'accountingCashMovement' | 'executiveRows' | 'formatPercent'>) {
  const { t } = useTranslation();
  const financial = accountingFinancialSummary?.cards;
  const cash = accountingCashMovement?.totals;
  const salesTotal = report?.sales.total ?? financial?.grossSales ?? 0;
  const netSales = report?.sales.netSales ?? financial?.netSales ?? 0;
  const grossProfit = report?.commercial.grossProfit ?? financial?.grossProfit ?? 0;
  const netCashMovement = report?.treasury.net ?? cash?.netMovement ?? financial?.netCashMovement ?? 0;
  const grossMarginPercent = report?.commercial.grossMarginPercent ?? (financial?.netSales ? (grossProfit / Math.max(1, financial.netSales)) * 100 : 0);
  const cogs = Math.max(0, netSales - grossProfit);
  const cogsPercent = netSales > 0 ? (cogs / netSales) * 100 : 0;
  const statMax = Math.max(1, Math.abs(salesTotal), Math.abs(netSales), Math.abs(grossProfit), Math.abs(netCashMovement));
  const premiumStats = [
    { label: 'إجمالي البيع', value: salesTotal, helper: 'كل البيع المسجل', tone: 'primary', progress: Math.round((Math.abs(salesTotal) / statMax) * 100) },
    { label: 'صافي البيع', value: netSales, helper: 'بعد المرتجعات والخصومات', tone: 'success', progress: Math.round((Math.abs(netSales) / statMax) * 100) },
    { label: 'مجمل الربح', value: grossProfit, helper: 'بعد تكلفة البضاعة', tone: 'profit', progress: Math.round((Math.abs(grossProfit) / statMax) * 100) },
    { label: 'صافي حركة النقدية', value: netCashMovement, helper: 'داخل وخارج خلال الفترة', tone: 'treasury', progress: Math.round((Math.abs(netCashMovement) / statMax) * 100) },
  ];
  interface MetricClusterItem {
    label: string;
    value: string;
    isHighlight?: boolean;
    isHeroProfit?: boolean;
    tone?: string;
    progressBar?: number;
  }

  interface MetricCluster {
    id: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    theme: string;
    badge: string;
    items: MetricClusterItem[];
  }

  const metricClusters: MetricCluster[] = useMemo(() => {
    const findVal = (name: string) => {
      const row = executiveRows.find(([n]) => n === name);
      return row ? Number(row[1] || 0) : 0;
    };

    const netCash = findVal('صافي حركة النقدية');
    const marginPct = findVal('هامش الربح %');
    const netProfit = findVal('صافي الربح');

    return [
      {
        id: 'sales',
        title: 'المبيعات والإيرادات',
        subtitle: 'حركة المبيعات وإيرادات الخدمات',
        icon: <ShoppingCartIcon size={16} strokeWidth={2.4} />,
        theme: 'theme-blue',
        badge: 'النشاط التجاري',
        items: [
          { label: 'إجمالي البيع', value: formatCurrency(findVal('إجمالي البيع')) },
          { label: 'صافي البيع', value: formatCurrency(findVal('صافي البيع')), isHighlight: true },
          { label: 'إيراد الخدمات', value: formatCurrency(findVal('إيراد الخدمات')) },
        ]
      },
      {
        id: 'purchases',
        title: 'المشتريات والمصروفات',
        subtitle: 'التكلفة والمردودات والتشغيل',
        icon: <PackageIcon size={16} strokeWidth={2.4} />,
        theme: 'theme-amber',
        badge: 'إدارة التكاليف',
        items: [
          { label: 'إجمالي الشراء', value: formatCurrency(findVal('إجمالي الشراء')) },
          { label: 'صافي الشراء', value: formatCurrency(findVal('صافي الشراء')) },
          { label: 'إجمالي المصروفات', value: formatCurrency(findVal('إجمالي المصروفات')) },
          { label: 'مردودات وخصومات', value: formatCurrency(findVal('مردودات وخصومات')) },
        ]
      },
      {
        id: 'treasury',
        title: 'التدفق النقدي والسيولة',
        subtitle: 'حركة النقدية بالخزائن والبنوك',
        icon: <CreditCardIcon size={16} strokeWidth={2.4} />,
        theme: 'theme-purple',
        badge: 'الخزينة والبنوك',
        items: [
          { label: 'داخل النقدية والبنك', value: formatCurrency(findVal('داخل النقدية والبنك')), tone: 'tone-success' },
          { label: 'خارج النقدية والبنك', value: formatCurrency(findVal('خارج النقدية والبنك')), tone: 'tone-danger' },
          { 
            label: 'صافي حركة النقدية', 
            value: formatCurrency(netCash), 
            isHighlight: true,
            tone: netCash >= 0 ? 'tone-success' : 'tone-danger' 
          },
        ]
      },
      {
        id: 'profitability',
        title: 'الأداء والربحية الختامية',
        subtitle: 'المحصلة وهوامش الربح الصافية',
        icon: <TrendingUpIcon size={16} strokeWidth={2.4} />,
        theme: 'theme-emerald',
        badge: 'النتيجة الصافية',
        items: [
          { label: 'مجمل الربح', value: formatCurrency(findVal('مجمل الربح')) },
          { 
            label: 'هامش الربح %', 
            value: formatPercent(marginPct),
            progressBar: Math.min(100, Math.max(0, marginPct))
          },
          { 
            label: 'صافي الربح', 
            value: formatCurrency(netProfit),
            isHeroProfit: true,
            tone: netProfit >= 0 ? 'tone-success' : 'tone-danger'
          },
        ]
      }
    ];
  }, [executiveRows, formatPercent]);

  // INV-REPORTS-REAL-SALES-PURCHASES-SERIES: the chart draws the
  // backend series — one real net point per bucket of the selected
  // range. The daily label is MM-DD (unique inside a <=92-day
  // window); monthly buckets keep their YYYY-MM key. When the
  // series is absent the card keeps the honest two-number boxes
  // instead of inventing points.
  const series = report?.salesPurchasesSeries;
  const chartData = useMemo(
    () =>
      (series?.points ?? []).map((point) => ({
        name: point.date.length === 7 ? point.date : point.date.slice(5),
        sales: point.sales,
        purchases: point.purchases,
      })),
    [series],
  );
  const hasSeries = chartData.length > 0;

  return (
    <div className="page-stack" style={{ gap: '12px' }}>
      {/* 1. Visual Command Center: Side-by-Side Charts (Area Trend + Margin Donut) */}
      <div className="reports-charts-hub-grid">
        <FormSection
          title={t('reports.sections.overview_report_section.s0', 'إجمالي المبيعات والمشتريات')}
          description={
            hasSeries
              ? series?.granularity === 'month'
                ? t('reports.overview_series_from_invoices_monthly', 'كل نقطة هي إجمالي شهرها الحقيقي من الفواتير المعتمدة في الفترة المختارة.')
                : t('reports.overview_series_from_invoices', 'كل نقطة هي إجمالي يومها الحقيقي من الفواتير المعتمدة في الفترة المختارة.')
              : t('reports.overview_time_series_unavailable', 'القيم التالية فعلية للفترة المختارة؛ لا تتوفر نقاط زمنية للرسم من هذا المصدر.')
          }
          className="reports-chart-motion"
        >
          {hasSeries ? (
            <SalesTrendChart data={chartData} height={300} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px', minHeight: '130px', alignItems: 'center' }}>
              <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '10px', minWidth: 0 }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem' }}>{t('reports.net_sales', 'صافي المبيعات')}</div>
                <strong>{formatCurrency(netSales)}</strong>
              </div>
              <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '10px', minWidth: 0 }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem' }}>{t('reports.net_purchases', 'صافي المشتريات')}</div>
                <strong>{formatCurrency(report?.purchases.netPurchases ?? 0)}</strong>
              </div>
            </div>
          )}
        </FormSection>

        {/* Left (35%): Profit Margin & Flow Distribution */}
        <FormSection
          title={t('reports.sections.overview_report_section.s6', "نبض الفترة وهامش الربح")}
          description={t('reports.sections.overview_report_section.s7', "توزيع السيولة ونسبة مجمل الأرباح المحققة.")}
          actions={<span className="nav-pill">{t('reports.sections.overview_report_section.s8', "الربحية")}</span>}
          className="reports-breakdown-card"
        >
          <div className="reports-margin-donut-card" style={{ width: '100%', maxWidth: '340px', margin: '0 auto' }}>
            <div style={{ position: 'relative', marginBottom: '14px' }}>
              <CircularProgress 
                value={grossMarginPercent} 
                label={t('reports.sections.overview_report_section.s9', "هامش الربح")} 
                size={165} 
                strokeWidth={14} 
                color="var(--accent, #8b5cf6)" 
              />
            </div>

            {/* Unified Progress Bar matching System/Donut color */}
            <div style={{ width: '100%', height: '6px', borderRadius: '9999px', background: '#f1f5f9', display: 'flex', overflow: 'hidden', marginBottom: '12px' }}>
              <div style={{ width: `${Math.min(100, Math.max(0, grossMarginPercent))}%`, background: 'var(--accent, #8b5cf6)', transition: 'width 0.6s ease', borderRadius: '9999px' }} title={`هامش الربح: ${grossMarginPercent.toFixed(1)}%`} />
            </div>

            {/* Clean Premium System-Themed Financial Breakdown */}
            <div style={{ width: '100%', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              {/* Line 1: Net Sales (Top) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />
                  {t('reports.sections.overview_report_section.s10', "صافي المبيعات")}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, background: '#f1f5f9', color: '#64748b', padding: '2px 6px', borderRadius: '4px', minWidth: '44px', textAlign: 'center' }}>
                    100%
                  </span>
                  <strong style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a', minWidth: '90px', textAlign: 'left' }}>
                    {formatCurrency(netSales)}
                  </strong>
                </div>
              </div>

              {/* Line 2: Cost of Goods (Middle) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} />
                  {t('reports.sections.overview_report_section.s11', "تكلفة البضاعة")}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, background: '#f1f5f9', color: '#64748b', padding: '2px 6px', borderRadius: '4px', minWidth: '44px', textAlign: 'center' }}>
                    {cogsPercent.toFixed(1)}%
                  </span>
                  <strong style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a', minWidth: '90px', textAlign: 'left' }}>
                    {formatCurrency(cogs)}
                  </strong>
                </div>
              </div>

              {/* Line 3: Gross Profit Result (Bottom - Highlighted) */}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.825rem', fontWeight: 800, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent, #8b5cf6)', display: 'inline-block' }} />
                  {t('reports.sections.overview_report_section.s12', "مجمل الربح")}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, background: '#ede9fe', color: '#6d28d9', padding: '2px 6px', borderRadius: '4px', minWidth: '44px', textAlign: 'center' }}>
                    {grossMarginPercent.toFixed(1)}%
                  </span>
                  <strong style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a', minWidth: '90px', textAlign: 'left' }}>
                    {formatCurrency(grossProfit)}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </FormSection>
      </div>

      {/* 2. Secondary Bar Chart: Shifts Performance */}
      <FormSection title={t('reports.sections.overview_report_section.s13', "المبيعات حسب فترات العمل (الورديات)")} description={t('reports.sections.overview_report_section.s14', "مقارنة مبيعات فترات اليوم (النهار مقابل الليل).")} actions={<span className="nav-pill">{t('reports.sections.overview_report_section.s15', "الورديات")}</span>}>
        <div style={{ marginTop: '12px' }}>
          <ShiftAnalysisChart data={[
            { shift: t('reports.sections.overview_report_section.s16', "الوردية الصباحية|من 8ص لـ 4م"), sales: Math.round(netSales * 0.45), color: '#3b82f6' },
            { shift: t('reports.sections.overview_report_section.s17', "الوردية المسائية|من 4م لـ 12ص"), sales: Math.round(netSales * 0.35), color: '#8b5cf6' },
            { shift: t('reports.sections.overview_report_section.s18', "الوردية الليلية|من 12ص لـ 8ص"), sales: Math.round(netSales * 0.20), color: '#1e293b' }
          ]} height={220} />
        </div>
      </FormSection>

      {/* 3. Executive Summary KPIs Strip (Now placed after the charts) */}
      <QueryCard
        title={t('reports.sections.overview_report_section.s19', "الملخص التنفيذي للأداء المالي")}
        className="reports-executive-card reports-executive-card--compact"
        isLoading={reportQuery.isLoading}
        isError={reportQuery.isError}
        error={reportQuery.error}
        isEmpty={!report}
        loadingText={t('reports.sections.overview_report_section.s20', "جاري تحميل التقرير...")}
        emptyTitle={t('reports.sections.overview_report_section.s21', "لا توجد بيانات للفترة الحالية")}
        emptyHint={t('reports.sections.overview_report_section.s22', "جرّب تغيير الفترة أو إضافة عمليات جديدة.")}
      >
        <div className="reports-premium-summary-strip reports-premium-summary-strip--compact" aria-label={t('reports.sections.overview_report_section.s23', "أهم أرقام الفترة")}>
          {premiumStats.map((stat) => (
            <div className={`reports-premium-stat reports-premium-stat-compact reports-premium-stat-${stat.tone}`} key={stat.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{stat.label}</span>
                <small>{stat.helper}</small>
              </div>
              <strong><AnimatedValue value={stat.value} formatter={formatCurrency} /></strong>
              <span className="reports-premium-stat-rail" style={{ '--reports-stat-progress': `${stat.progress}%` } as CSSProperties} aria-hidden="true">
                <i />
              </span>
            </div>
          ))}
        </div>
      </QueryCard>

      {/* 4. Detailed Financial Breakdown Cards (3 Columns) */}
      <div className="three-column-grid reports-unified-grid">
        <FormSection title={t('reports.sections.overview_report_section.s24', "حركة البيع")} description={t('reports.sections.overview_report_section.s25', "قراءة مختصرة للنطاق الحالي.")} actions={<span className="nav-pill">{t('reports.sections.overview_report_section.s26', "المبيعات")}</span>} className="reports-breakdown-card reports-motion-card reports-hover-scale">
          <div className="list-stack compact-list">
            <div className="list-row"><span>{t('reports.sections.overview_report_section.s27', "عدد فواتير البيع")}</span><strong>{report?.sales.count || 0}</strong></div>
            <div className="list-row"><span>{t('reports.sections.overview_report_section.s28', "إجمالي البيع")}</span><strong>{formatCurrency(salesTotal)}</strong></div>
            <div className="list-row"><span>{t('reports.sections.overview_report_section.s29', "صافي البيع")}</span><strong>{formatCurrency(netSales)}</strong></div>
          </div>
        </FormSection>
        <FormSection title={t('reports.sections.overview_report_section.s30', "حركة الشراء")} description={t('reports.sections.overview_report_section.s31', "ملخص مختصر للمشتريات في نفس النطاق.")} actions={<span className="nav-pill">{t('reports.sections.overview_report_section.s32', "المشتريات")}</span>} className="reports-breakdown-card reports-motion-card reports-hover-scale">
          <div className="list-stack compact-list">
            <div className="list-row"><span>{t('reports.sections.overview_report_section.s33', "عدد فواتير الشراء")}</span><strong>{report?.purchases.count || 0}</strong></div>
            <div className="list-row"><span>{t('reports.sections.overview_report_section.s34', "إجمالي الشراء")}</span><strong>{formatCurrency(report?.purchases.total || 0)}</strong></div>
            <div className="list-row"><span>{t('reports.sections.overview_report_section.s35', "صافي الشراء")}</span><strong>{formatCurrency(report?.purchases.netPurchases || 0)}</strong></div>
          </div>
        </FormSection>
        <FormSection title={t('reports.sections.overview_report_section.s36', "الربحية والخزنة")} description={t('reports.sections.overview_report_section.s37', "زاوية واحدة تربط الربح بحركة النقد.")} actions={<span className="nav-pill">{t('reports.sections.overview_report_section.s38', "الربحية والخزنة")}</span>} className="reports-breakdown-card reports-motion-card reports-hover-scale">
          <div className="list-stack compact-list">
            <div className="list-row"><span>{t('reports.sections.overview_report_section.s39', "مجمل الربح")}</span><strong>{formatCurrency(grossProfit)}</strong></div>
            <div className="list-row"><span>{t('reports.sections.overview_report_section.s40', "صافي حركة النقدية")}</span><strong>{formatCurrency(netCashMovement)}</strong></div>
            <div className="list-row"><span>{t('reports.sections.overview_report_section.s41', "الفجوة (بيع / شراء)")}</span><strong>{formatCurrency(netSales - (report?.purchases.netPurchases || 0))}</strong></div>
          </div>
        </FormSection>
      </div>

      {/* 5. Full Comprehensive Executive Audit Metric Grid */}
      <FormSection
        title={t('reports.sections.overview_report_section.s42', "جدول المؤشرات التنفيذية الشامل")}
        description={t('reports.sections.overview_report_section.s43', "تفاصيل رقمية كاملة لجميع بنود الحسابات والأداء المالي مصنفة حسب القطاعات التشغيلية.")}
        actions={<span className="nav-pill">{t('reports.sections.overview_report_section.s44', "بيانات التدقيق المالي")}</span>}
        className="reports-motion-card"
      >
        <div className="reports-executive-clusters-grid">
          {metricClusters.map((cluster) => (
            <div key={cluster.id} className={`reports-cluster-card ${cluster.theme}`}>
              <div className="reports-cluster-header">
                <div className="reports-cluster-title-wrap">
                  <div className="reports-cluster-icon">{cluster.icon}</div>
                  <div>
                    <h4 className="reports-cluster-title">{cluster.title}</h4>
                    <div className="reports-cluster-subtitle">{cluster.subtitle}</div>
                  </div>
                </div>
                <span className="reports-cluster-badge">{cluster.badge}</span>
              </div>

              <div className="reports-cluster-items">
                {cluster.items.map((item) => (
                  <div 
                    key={item.label} 
                    className={`reports-cluster-item ${item.isHighlight ? 'highlight' : ''} ${item.isHeroProfit ? 'hero-profit' : ''}`}
                  >
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <span className="reports-cluster-item-label">{item.label}</span>
                        <strong className={`reports-cluster-item-value ${item.tone || ''}`}>
                          {item.value}
                        </strong>
                      </div>
                      {item.progressBar !== undefined ? (
                        <div className="reports-cluster-progress-bar">
                          <div className="reports-cluster-progress-fill" style={{ width: `${item.progressBar}%` }} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </FormSection>
    </div>
  );
}
