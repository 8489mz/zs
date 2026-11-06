import { useTranslation } from 'react-i18next';
import { QueryCard } from '@/shared/components/query-card';
import { ReportMetricCard } from '@/features/reports/components/ReportMetricCard';
import { formatCurrency } from '@/lib/format';
import { getCurrencyDecimals } from '@/lib/currencies';
import type { ReportsSectionContentProps } from '@/features/reports/components/reports-section.types';
import { relativePercent } from '@/features/reports/lib/reports-format';

export function TreasuryReportSection({
  report,
  reportQuery,
  accountingFinancialSummary,
  accountingFinancialSummaryLoading,
  accountingCashMovement,
  accountingCashMovementLoading,
  operatingSignalRows,
  formatPercent
}: Pick<ReportsSectionContentProps, 'report' | 'reportQuery' | 'accountingFinancialSummary' | 'accountingFinancialSummaryLoading' | 'accountingCashMovement' | 'accountingCashMovementLoading' | 'operatingSignalRows' | 'formatPercent'>) {
  const { t } = useTranslation();
  const financial = accountingFinancialSummary?.cards;
  const cash = accountingCashMovement?.totals;
  /* INV-REPORTS-PARTIAL-TOTALS: every card below reads from the report
  summary AND the accounting sources (cash movement / financial summary)
  through `??` fallback chains, so a card is ready only when all three
  have loaded. Showing the first source's number while the others are
  still loading displayed partial totals as if final (live: "إجمالي
  الداخل" swept 266.00 … 508.00 before settling on 851.00). */
  const cardsLoading = reportQuery.isLoading || accountingCashMovementLoading || accountingFinancialSummaryLoading;
  const cashIn = report?.treasury.cashIn ?? cash?.totalIn ?? 0;
  const cashOut = report?.treasury.cashOut ?? cash?.totalOut ?? 0;
  const netCash = report?.treasury.net ?? cash?.netMovement ?? financial?.netCashMovement ?? 0;
  const grossProfit = report?.commercial.grossProfit ?? financial?.grossProfit ?? 0;
  const expenses = report?.expenses.total ?? financial?.operatingExpenses ?? 0;
  const netProfit = report?.commercial.netOperatingProfit ?? financial?.netProfit ?? 0;
  const grossMarginPercent = report?.commercial.grossMarginPercent ?? (financial?.netSales ? (grossProfit / Math.max(1, financial.netSales)) * 100 : 0);
  const values = [cashIn, cashOut, netCash, grossProfit, expenses, netProfit];

  return (
    <QueryCard
      title={t('reports.sections.treasury_report_section.s0', "الخزنة والربحية")}
      description={t('reports.sections.treasury_report_section.s1', "قراءة مركزة لحركة النقدية والبنك وصافي الربح في تبويب مستقل.")}
      actions={<span className="nav-pill">{t('reports.sections.treasury_report_section.s2', "الخزنة والربحية")}</span>}
      isLoading={reportQuery.isLoading}
      isError={reportQuery.isError}
      error={reportQuery.error}
      isEmpty={!report}
      loadingText={t('reports.sections.treasury_report_section.s3', "جاري تحميل مؤشرات الربحية والخزنة...")}
      emptyTitle={t('reports.sections.treasury_report_section.s4', "لا توجد بيانات كافية لهذا التبويب")}
      emptyHint={t('reports.sections.treasury_report_section.s5', "راجع الفترة أو أضف حركات نقدية وبيع وشراء.")}
    >
      <div className="reports-spotlight-grid section-spotlight-grid compact-spotlight-grid">
        <ReportMetricCard isLoading={cardsLoading} label={t('reports.sections.treasury_report_section.s6', "إجمالي الداخل")} value={cashIn} helper={t('reports.sections.treasury_report_section.s7', "داخل النقدية والبنك")} tone="success" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(cashIn, values)} />
        <ReportMetricCard isLoading={cardsLoading} label={t('reports.sections.treasury_report_section.s8', "إجمالي الخارج")} value={cashOut} helper={t('reports.sections.treasury_report_section.s9', "خارج النقدية والبنك")} tone="danger" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(cashOut, values)} />
        <ReportMetricCard isLoading={cardsLoading} label={t('reports.sections.treasury_report_section.s10', "صافي حركة النقدية")} value={netCash} helper={t('reports.sections.treasury_report_section.s11', "خلال الفترة وليس رصيدًا نهائيًا")} tone={netCash >= 0 ? 'success' : 'danger'} formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(netCash, values)} />
        <ReportMetricCard isLoading={cardsLoading} label={t('reports.sections.treasury_report_section.s12', "مجمل الربح")} value={grossProfit} helper={t('reports.sections.treasury_report_section.s13', "بعد تكلفة البضاعة")} tone="success" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(grossProfit, values)} />
        <ReportMetricCard isLoading={cardsLoading} label={t('reports.sections.treasury_report_section.s14', "المصروفات")} value={expenses} helper={t('reports.sections.treasury_report_section.s15', "مصروفات تشغيلية")} tone="warning" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(expenses, values)} />
        <ReportMetricCard isLoading={cardsLoading} label={t('reports.sections.treasury_report_section.s16', "صافي الربح")} value={netProfit} helper={`هامش الربح: ${formatPercent(grossMarginPercent)}`} tone={netProfit >= 0 ? 'success' : 'danger'} formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(netProfit, values)} />
      </div>
      <div className="metric-list reports-metric-list">
        {report?.delivery ? (
          <div className="metric-row" key="delivery-fees">
            <span>{t('reports.sections.treasury_report_section.s17', "رسوم التوصيل (")}{report.delivery.mode === 'store_fleet' ? t('reports.sections.treasury_report_section.s18', "أسطول المتجر - إيراد") : t('reports.sections.treasury_report_section.s19', "مناديب حرة - مستحق للمندوب")})</span>
            <strong>{formatCurrency(report.delivery.total)} ({report.delivery.count} {t('reports.sections.treasury_report_section.s20', "طلب)")}</strong>
          </div>
        ) : null}
        {operatingSignalRows.map((row) => (
          <div className="metric-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </QueryCard>
  );
}
