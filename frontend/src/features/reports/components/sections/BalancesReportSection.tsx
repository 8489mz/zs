import { useTranslation } from 'react-i18next';
import { QueryCard } from '@/shared/components/query-card';
import { Button } from '@/shared/ui/button';
import { ReportPrintMenu } from '@/shared/components/ReportPrintMenu';
import { DataTable } from '@/shared/ui/data-table';
import { Field } from '@/shared/ui/field';
import { FormSection } from '@/shared/components/form-section';
import { ReportMetricCard } from '@/features/reports/components/ReportMetricCard';
import { relativePercent } from '@/features/reports/lib/reports-format';
import { formatCurrency } from '@/lib/format';
import { getCurrencyDecimals } from '@/lib/currencies';
import type { ReportsSectionContentProps } from '@/features/reports/components/reports-section.types';

export function BalancesReportSection({
  balancesQuery,
  accountingReceivablesPayables,
  exportCustomerBalances,
  printCustomerBalances,
  balancesSearch,
  onBalancesSearchChange,
  balancesFilter,
  onBalancesFilterChange,
  onBalancesPageChange,
  onBalancesPageSizeChange,
  onBalancesFiltersReset,
  accountingReceivablesPayablesLoading,
}: Pick<ReportsSectionContentProps, 'balancesQuery' | 'accountingReceivablesPayables' | 'accountingReceivablesPayablesLoading' | 'exportCustomerBalances' | 'printCustomerBalances' | 'balancesSearch' | 'onBalancesSearchChange' | 'balancesFilter' | 'onBalancesFilterChange' | 'onBalancesPageChange' | 'onBalancesPageSizeChange' | 'onBalancesFiltersReset'>) {
  const { t } = useTranslation();
  const rows = balancesQuery.data?.rows || [];
  const pagination = balancesQuery.data?.pagination;
  const summary = balancesQuery.data?.summary;
  const totals = accountingReceivablesPayables?.totals;
  const suppliers = accountingReceivablesPayables?.suppliers || [];
  const netPosition = totals?.netPosition ?? 0;
  const netPositionLabel = netPosition >= 0 ? 'صافي لصالحك' : 'صافي التزامات عليك';
  /* INV-REPORTS-PARTIAL-TOTALS: the money cards read the receivables /
  payables source AND the balances summary through `??` fallbacks, so
  they are ready only when both have loaded; the count card reads the
  balances summary only. */
  const cardsLoading = balancesQuery.isLoading || accountingReceivablesPayablesLoading;
  const values = [
    summary?.totalItems || 0,
    totals?.customerReceivables ?? summary?.totalBalance ?? 0,
    totals?.supplierPayables || 0,
    Math.abs(netPosition),
    summary?.overLimit || 0,
  ];

  return (
    <div className="page-stack">
      <QueryCard
        title={t('reports.sections.balances_report_section.s0', "العملاء والموردون الأعلى رصيدًا")}
        description={t('reports.sections.balances_report_section.s1', "تبويب مخصص للذمم مع بحث وترقيم صفحات من الخادم، ويعرض مستحقات العملاء والموردين في قراءة واحدة.")}
        actions={(
          <div className="actions compact-actions">
            <Button variant="secondary" onClick={() => void exportCustomerBalances()} disabled={!summary?.totalItems}>{t('reports.sections.balances_report_section.s2', "تصدير Excel")}</Button>
            <ReportPrintMenu
              onPrintA4={() => void printCustomerBalances('A4')}
              onPrintReceipt={() => void printCustomerBalances('receipt')}
              disabled={!summary?.totalItems}
            />
            <span className="nav-pill">{t('reports.sections.balances_report_section.s3', "الذمم")}</span>
          </div>
        )}
        className="reports-focus-card"
        isLoading={balancesQuery.isLoading}
        isError={balancesQuery.isError}
        error={balancesQuery.error}
        isEmpty={!summary?.totalItems && !suppliers.length}
        loadingText={t('reports.sections.balances_report_section.s4', "جاري تحميل الذمم...")}
        emptyTitle={t('reports.sections.balances_report_section.s5', "لا توجد ذمم حالية")}
        emptyHint={t('reports.sections.balances_report_section.s6', "سيظهر هنا العملاء والموردون الأعلى رصيدًا بمجرد وجود حركة مالية.")}
        preserveChildrenOnEmpty
        emptyAction={<Button variant="secondary" onClick={onBalancesFiltersReset}>{t('reports.sections.balances_report_section.s7', "إعادة الضبط")}</Button>}
      >
        <div className="reports-spotlight-grid section-spotlight-grid compact-spotlight-grid balances-spotlight-grid">
          <ReportMetricCard isLoading={cardsLoading} label={t('reports.sections.balances_report_section.s8', "مستحق من العملاء")} value={totals?.customerReceivables ?? summary?.totalBalance ?? 0} helper={t('reports.sections.balances_report_section.s9', "مبالغ لم تحصل بعد")} tone="warning" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(totals?.customerReceivables ?? summary?.totalBalance ?? 0, values)} />
          <ReportMetricCard isLoading={cardsLoading} label={t('reports.sections.balances_report_section.s10', "مستحق للموردين")} value={totals?.supplierPayables || 0} helper={t('reports.sections.balances_report_section.s11', "التزامات على المنشأة")} tone="danger" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(totals?.supplierPayables || 0, values)} />
          <ReportMetricCard isLoading={cardsLoading} label={netPositionLabel} value={Math.abs(netPosition)} helper={t('reports.sections.balances_report_section.s12', "الفرق بين مستحقات العملاء والموردين")} tone={netPosition >= 0 ? 'success' : 'danger'} formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(Math.abs(netPosition), values)} />
          <ReportMetricCard isLoading={balancesQuery.isLoading} label={t('reports.sections.balances_report_section.s13', "عدد العملاء")} value={summary?.totalItems || 0} helper={t('reports.sections.balances_report_section.s14', "ضمن النطاق الحالي")} tone="primary" progress={relativePercent(summary?.totalItems || 0, values)} />
        </div>
        <div className="toolbar-grid compact-toolbar-grid">
          <Field label={t('reports.sections.balances_report_section.s15', "بحث")}><input value={balancesSearch} onChange={(event) => onBalancesSearchChange(event.target.value)} placeholder={t('reports.sections.balances_report_section.s16', "اسم العميل / الهاتف")} /></Field>
          <Field label={t('reports.sections.balances_report_section.s17', "الفلتر")}><select value={balancesFilter} onChange={(event) => onBalancesFilterChange(event.target.value as 'all' | 'high-balance' | 'over-limit')}><option value="all">{t('reports.sections.balances_report_section.s18', "الكل")}</option><option value="high-balance">{t('reports.sections.balances_report_section.s19', "رصيد مرتفع")}</option><option value="over-limit">{t('reports.sections.balances_report_section.s20', "فوق الحد الائتماني")}</option></select></Field>
          <div className="actions compact-actions" style={{ alignItems: 'end' }}><Button variant="secondary" onClick={onBalancesFiltersReset}>{t('reports.sections.balances_report_section.s21', "إعادة الضبط")}</Button></div>
        </div>
        <DataTable
          ariaLabel={t('reports.sections.balances_report_section.s22', "ذمم العملاء")}
          columns={[
            { key: 'name', header: t('reports.sections.balances_report_section.s23', "العميل"), cell: (row) => row.name },
            { key: 'phone', header: t('reports.sections.balances_report_section.s24', "الهاتف"), cell: (row) => row.phone || '—' },
            { key: 'balance', header: t('reports.sections.balances_report_section.s25', "الرصيد"), cell: (row) => formatCurrency(row.balance || 0) },
            { key: 'creditLimit', header: t('reports.sections.balances_report_section.s26', "الحد الائتماني"), cell: (row) => formatCurrency(row.creditLimit || 0) },
          ]}
          rows={rows}
          empty={<div className="muted small">{t('reports.sections.balances_report_section.s27', "لا توجد نتائج مطابقة.")}</div>}
          pagination={pagination ? { page: pagination.page, pageSize: pagination.pageSize, totalItems: pagination.totalItems, onPageChange: onBalancesPageChange, onPageSizeChange: onBalancesPageSizeChange, itemLabel: t('reports.sections.balances_report_section.s28', "عميل") } : undefined}
        />
      </QueryCard>

      <FormSection title={t('reports.sections.balances_report_section.s29', "الموردون لهم مستحقات")} description={t('reports.sections.balances_report_section.s30', "قسم مختصر بنفس نمط التبويب الحالي لإظهار الالتزامات المفتوحة للموردين.")}>
        <DataTable
          ariaLabel={t('reports.sections.balances_report_section.s31', "مستحقات الموردين")}
          rows={suppliers.slice(0, 10)}
          columns={[
            { key: 'supplierName', header: t('reports.sections.balances_report_section.s32', "المورد"), cell: (row) => row.supplierName || '—' },
            { key: 'phone', header: t('reports.sections.balances_report_section.s33', "الهاتف"), cell: (row) => row.phone || '—' },
            { key: 'balance', header: t('reports.sections.balances_report_section.s34', "المبلغ المستحق"), cell: (row) => formatCurrency(row.balance || 0) },
            { key: 'lastMovementDate', header: t('reports.sections.balances_report_section.s35', "آخر حركة"), cell: (row) => row.lastMovementDate ? String(row.lastMovementDate).slice(0, 10) : '—' },
          ]}
          empty={<div className="muted small">{t('reports.sections.balances_report_section.s36', "لا توجد مستحقات موردين في النطاق الحالي.")}</div>}
        />
      </FormSection>
    </div>
  );
}
