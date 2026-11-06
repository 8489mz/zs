import { useTranslation } from 'react-i18next';
import { QueryCard } from '@/shared/components/query-card';
import { ReportPrintMenu } from '@/shared/components/ReportPrintMenu';
import { ReportMetricCard } from '@/features/reports/components/ReportMetricCard';
import { relativePercent } from '@/features/reports/lib/reports-format';
import { formatCurrency } from '@/lib/format';
import { getCurrencyDecimals } from '@/lib/currencies';
import type { ReportsSectionContentProps } from '@/features/reports/components/reports-section.types';

export function PurchasesReportSection({ report, reportQuery, printPurchasesRegisterReport }: Pick<ReportsSectionContentProps, 'report' | 'reportQuery' | 'printPurchasesRegisterReport'>) {
  const { t } = useTranslation();
  const values = [
    report?.purchases.total || 0,
    report?.purchases.netPurchases || 0,
    report?.expenses.total || 0,
    report?.treasury.cashIn || 0,
    report?.treasury.net || 0,
  ];

  return (
    <div className="page-stack">
      <QueryCard
        title={t('reports.sections.purchases_report_section.s0', "مؤشرات الشراء")}
        description={t('reports.sections.purchases_report_section.s1', "فصل ملخص الشراء في تبويب مستقل يسهّل على الإدارة والمخزن مراجعة الوضع الشرائي بدون ازدحام.")}
        actions={(
          <div className="actions compact-actions">
            <ReportPrintMenu
              label={t('reports.sections.purchases_report_section.s2', "طباعة (ملخص)")}
              onPrintA4={() => void printPurchasesRegisterReport(false, 'A4')}
              onPrintReceipt={() => void printPurchasesRegisterReport(false, 'receipt')}
              disabled={!report?.purchases.count}
            />
            <ReportPrintMenu
              label={t('reports.sections.purchases_report_section.s3', "طباعة (تفصيلي)")}
              onPrintA4={() => void printPurchasesRegisterReport(true, 'A4')}
              onPrintReceipt={() => void printPurchasesRegisterReport(true, 'receipt')}
              disabled={!report?.purchases.count}
            />
            <span className="nav-pill">{t('reports.sections.purchases_report_section.s4', "المشتريات")}</span>
          </div>
        )}
        isLoading={reportQuery.isLoading}
        isError={reportQuery.isError}
        error={reportQuery.error}
        isEmpty={!report}
        loadingText={t('reports.sections.purchases_report_section.s5', "جاري تحميل بيانات الشراء...")}
        emptyTitle={t('reports.sections.purchases_report_section.s6', "لا توجد بيانات شراء للفترة الحالية")}
        emptyHint={t('reports.sections.purchases_report_section.s7', "غيّر النطاق أو راجع المشتريات المسجلة.")}
      >
        <div className="reports-spotlight-grid section-spotlight-grid">
          <ReportMetricCard isLoading={reportQuery.isLoading} label={t('reports.sections.purchases_report_section.s8', "عدد الفواتير")} value={report?.purchases.count || 0} helper={t('reports.sections.purchases_report_section.s9', "إجمالي أوامر الشراء")} tone="primary" progress={relativePercent(report?.purchases.count || 0, [report?.purchases.count || 0, 1])} />
          <ReportMetricCard isLoading={reportQuery.isLoading} label={t('reports.sections.purchases_report_section.s10', "إجمالي الشراء")} value={report?.purchases.total || 0} helper={t('reports.sections.purchases_report_section.s11', "قبل التسويات")} tone="warning" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(report?.purchases.total || 0, values)} />
          <ReportMetricCard isLoading={reportQuery.isLoading} label={t('reports.sections.purchases_report_section.s12', "صافي الشراء")} value={report?.purchases.netPurchases || 0} helper={t('reports.sections.purchases_report_section.s13', "بعد الخصومات")} tone="warning" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(report?.purchases.netPurchases || 0, values)} />
          <ReportMetricCard isLoading={reportQuery.isLoading} label={t('reports.sections.purchases_report_section.s14', "المصروفات")} value={report?.expenses.total || 0} helper={t('reports.sections.purchases_report_section.s15', "مرتبطة بالنطاق الحالي")} tone="danger" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(report?.expenses.total || 0, values)} />
          <ReportMetricCard isLoading={reportQuery.isLoading} label={t('reports.sections.purchases_report_section.s16', "داخل الخزينة")} value={report?.treasury.cashIn || 0} helper={t('reports.sections.purchases_report_section.s17', "تأثير الشراء على النقد")} tone="success" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(report?.treasury.cashIn || 0, values)} />
          <ReportMetricCard isLoading={reportQuery.isLoading} label={t('reports.sections.purchases_report_section.s18', "صافي الخزينة")} value={report?.treasury.net || 0} helper={t('reports.sections.purchases_report_section.s19', "المحصلة النهائية")} tone={(report?.treasury.net || 0) >= 0 ? 'success' : 'danger'} formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(report?.treasury.net || 0, values)} />
        </div>
      </QueryCard>
    </div>
  );
}
