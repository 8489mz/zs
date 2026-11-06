import { useTranslation } from 'react-i18next';
import { QueryCard } from '@/shared/components/query-card';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
import { ReportPrintMenu } from '@/shared/components/ReportPrintMenu';
import { DataTable } from '@/shared/ui/data-table';
import { ReportMetricCard } from '@/features/reports/components/ReportMetricCard';
import { relativePercent } from '@/features/reports/lib/reports-format';
import { formatCurrency } from '@/lib/format';
import { getCurrencyDecimals } from '@/lib/currencies';
import type { ReportsSectionContentProps } from '@/features/reports/components/reports-section.types';

export function SalesReportSection({
  report,
  reportQuery,
  accountingFinancialSummary,
  salesDailyAverage,
  purchaseDailyAverage,
  returnRatePercent,
  rangeDays,
  topProducts,
  exportTopProducts,
  printTopProducts,
  printSalesRegisterReport,
  formatPercent
}: Pick<ReportsSectionContentProps, 'report' | 'reportQuery' | 'accountingFinancialSummary' | 'salesDailyAverage' | 'purchaseDailyAverage' | 'returnRatePercent' | 'rangeDays' | 'topProducts' | 'exportTopProducts' | 'printTopProducts' | 'printSalesRegisterReport' | 'formatPercent'>) {
  const { t } = useTranslation();
  const financial = accountingFinancialSummary?.cards;
  const salesTotal = report?.sales.total ?? financial?.grossSales ?? 0;
  const netSales = report?.sales.netSales ?? financial?.netSales ?? 0;
  const returnsAndDiscounts = report?.returns.total ?? (financial ? financial.salesReturns + financial.salesDiscounts : 0);
  const cogs = report?.commercial.cogs ?? financial?.cogs ?? 0;
  const grossProfit = report?.commercial.grossProfit ?? financial?.grossProfit ?? 0;
  const netProfit = report?.commercial.netOperatingProfit ?? financial?.netProfit ?? 0;
  const values = [salesTotal, netSales, returnsAndDiscounts, cogs, grossProfit, netProfit];

  return (
    <div className="page-stack">
      <QueryCard
        title={t('reports.sections.sales_report_section.s0', "مؤشرات البيع")}
        description={t('reports.sections.sales_report_section.s1', "تركيز مباشر على أرقام المبيعات ضمن النطاق الحالي مع الاحتفاظ بتفاصيل التشغيل مثل عدد الفواتير وأعلى الأصناف.")}
        actions={(
          <div className="actions compact-actions">
            <ReportPrintMenu
              label={t('reports.sections.sales_report_section.s2', "طباعة (ملخص)")}
              onPrintA4={() => void printSalesRegisterReport(false, 'A4')}
              onPrintReceipt={() => void printSalesRegisterReport(false, 'receipt')}
              disabled={!report?.sales.count}
            />
            <ReportPrintMenu
              label={t('reports.sections.sales_report_section.s3', "طباعة (تفصيلي)")}
              onPrintA4={() => void printSalesRegisterReport(true, 'A4')}
              onPrintReceipt={() => void printSalesRegisterReport(true, 'receipt')}
              disabled={!report?.sales.count}
            />
            <span className="nav-pill">{t('reports.sections.sales_report_section.s4', "المبيعات")}</span>
          </div>
        )}
        isLoading={reportQuery.isLoading}
        isError={reportQuery.isError}
        error={reportQuery.error}
        isEmpty={!report}
        loadingText={t('reports.sections.sales_report_section.s5', "جاري تحميل بيانات البيع...")}
        emptyTitle={t('reports.sections.sales_report_section.s6', "لا توجد بيانات بيع للفترة الحالية")}
        emptyHint={t('reports.sections.sales_report_section.s7', "غيّر النطاق أو أضف مبيعات جديدة.")}
      >
        <div className="reports-spotlight-grid section-spotlight-grid">
          <ReportMetricCard label={t('reports.sections.sales_report_section.s8', "عدد الفواتير")} value={report?.sales.count || 0} helper={t('reports.sections.sales_report_section.s9', "إجمالي البيع المسجل")} tone="primary" progress={relativePercent(report?.sales.count || 0, [report?.sales.count || 0, 1])} />
          <ReportMetricCard label={t('reports.sections.sales_report_section.s10', "إجمالي البيع")} value={salesTotal} helper={t('reports.sections.sales_report_section.s11', "قبل المرتجعات والخصومات")} tone="primary" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(salesTotal, values)} />
          <ReportMetricCard label={t('reports.sections.sales_report_section.s12', "صافي البيع")} value={netSales} helper={t('reports.sections.sales_report_section.s13', "أفضل رقم للمتابعة اليومية")} tone="success" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(netSales, values)} />
          <ReportMetricCard label={t('reports.sections.sales_report_section.s14', "مردودات وخصومات")} value={returnsAndDiscounts} helper={t('reports.sections.sales_report_section.s15', "الأثر على البيع")} tone="danger" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(returnsAndDiscounts, values)} />
          <ReportMetricCard label={t('reports.sections.sales_report_section.s16', "تكلفة البضاعة")} value={cogs} helper={t('reports.sections.sales_report_section.s17', "تكلفة البضاعة المباعة")} tone="warning" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(cogs, values)} />
          <ReportMetricCard label={t('reports.sections.sales_report_section.s18', "مجمل الربح")} value={grossProfit} helper={t('reports.sections.sales_report_section.s19', "بعد تكلفة البضاعة")} tone="success" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(grossProfit, values)} />
        </div>
        <div className="two-column-grid" style={{ marginTop: 16 }}>
          <FormSection title={t('reports.sections.sales_report_section.s20', "قراءة يومية سريعة")} description={t('reports.sections.sales_report_section.s21', "أرقام مختصرة لصاحب النشاط بدون فتح جداول إضافية.")}>
            <div className="detail-grid">
              <div className="detail-item"><div className="detail-label">{t('reports.sections.sales_report_section.s22', "متوسط البيع اليومي")}</div><div className="detail-value">{formatCurrency(salesDailyAverage)}</div></div>
              <div className="detail-item"><div className="detail-label">{t('reports.sections.sales_report_section.s23', "متوسط الشراء اليومي")}</div><div className="detail-value">{formatCurrency(purchaseDailyAverage)}</div></div>
              <div className="detail-item"><div className="detail-label">{t('reports.sections.sales_report_section.s24', "معدل المرتجعات")}</div><div className="detail-value">{formatPercent(returnRatePercent)}</div></div>
              <div className="detail-item"><div className="detail-label">{t('reports.sections.sales_report_section.s25', "الأيام المغطاة")}</div><div className="detail-value">{rangeDays} {t('reports.sections.sales_report_section.s26', "يوم")}</div></div>
              <div className="detail-item"><div className="detail-label">{t('reports.sections.sales_report_section.s27', "صافي الربح")}</div><div className="detail-value">{formatCurrency(netProfit)}</div></div>
            </div>
          </FormSection>
          <FormSection
            title={t('reports.sections.sales_report_section.s28', "أعلى الأصناف")}
            description={t('reports.sections.sales_report_section.s29', "أفضل الأصناف مبيعًا داخل النطاق الحالي مع طباعة وتصدير مباشر.")}
            actions={(
              <div className="actions compact-actions">
                <Button variant="secondary" onClick={() => void exportTopProducts()} disabled={!topProducts.length}>{t('reports.sections.sales_report_section.s30', "تصدير Excel")}</Button>
                <ReportPrintMenu
                  onPrintA4={() => void printTopProducts('A4')}
                  onPrintReceipt={() => void printTopProducts('receipt')}
                  disabled={!topProducts.length}
                />
              </div>
            )}
          >
            <DataTable
              ariaLabel={t('reports.sections.sales_report_section.s31', "أعلى الأصناف")}
              columns={[
                { key: 'name', header: t('reports.sections.sales_report_section.s32', "الصنف"), cell: (row) => row.name },
                { key: 'qty', header: t('reports.sections.sales_report_section.s33', "الكمية"), cell: (row) => row.qty },
                { key: 'revenue', header: t('reports.sections.sales_report_section.s34', "الإيراد"), cell: (row) => formatCurrency(row.revenue || 0) },
              ]}
              rows={topProducts.slice(0, 8)}
              empty={<div className="muted small">{t('reports.sections.sales_report_section.s35', "لا توجد أصناف مباعة في هذا النطاق.")}</div>}
            />
          </FormSection>
        </div>

        <div style={{ marginTop: 16 }}>
          <FormSection
            title={t('reports.sections.sales_report_section.s36', "إحصائيات وتفصيل رسوم التوصيل والمناديب")}
            description={t('reports.sections.sales_report_section.s37', "فصل دقيق بين مستحقات المناديب الحرة (طياري) وإيرادات أسطول المتجر ونسبة الطيارين وصافي أرباح المحل.")}
          >
            <div className="reports-spotlight-grid delivery-spotlight-grid">
              <ReportMetricCard
                label={t('reports.sections.sales_report_section.s38', "إجمالي رسوم التوصيل")}
                value={report?.delivery?.total || 0}
                helper={`${report?.delivery?.count || 0} رحلة توصيل إجمالية`}
                tone="primary"
                formatter={formatCurrency} decimals={getCurrencyDecimals()}
              />
              <ReportMetricCard
                label={t('reports.sections.sales_report_section.s39', "مناديب حرة (طياري)")}
                value={report?.delivery?.freelanceTotal || 0}
                helper={`${report?.delivery?.freelanceCount || 0} رحلة (مستحقات للمناديب لا تدخل الخزينة)`}
                tone="warning"
                formatter={formatCurrency} decimals={getCurrencyDecimals()}
              />
              <ReportMetricCard
                label={t('reports.sections.sales_report_section.s40', "أسطول المتجر (إجمالي محصل)")}
                value={report?.delivery?.storeFleetTotal || 0}
                helper={`${report?.delivery?.storeFleetCount || 0} رحلة توصيل داخلي`}
                tone="primary"
                formatter={formatCurrency} decimals={getCurrencyDecimals()}
              />
              {Number(report?.delivery?.commissionRate || 0) > 0 ? (
                <ReportMetricCard
                  label={`عمولة طياري الأسطول (${report?.delivery?.commissionRate || 0}%)`}
                  value={report?.delivery?.storeFleetCourierShare || 0}
                  helper={t('reports.sections.sales_report_section.s41', "مستحقات للطيارين من التوصيل الداخلي")}
                  tone="warning"
                  formatter={formatCurrency} decimals={getCurrencyDecimals()}
                />
              ) : null}
              <ReportMetricCard
                label={t('reports.sections.sales_report_section.s42', "صافي ربح المحل من التوصيل")}
                value={report?.delivery?.storeProfit || 0}
                helper={Number(report?.delivery?.commissionRate || 0) > 0 ? `بعد خصم ${report?.delivery?.commissionRate}% نسبة الطيارين` : t('reports.sections.sales_report_section.s43', "الأرباح المضافة لدخل النشاط")}
                tone={Number(report?.delivery?.storeProfit || 0) > 0 ? 'success' : undefined}
                formatter={formatCurrency} decimals={getCurrencyDecimals()}
              />
            </div>
          </FormSection>
        </div>
      </QueryCard>
    </div>
  );
}
