import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { ReportsSectionTabs } from '@/features/reports/pages/ReportsSectionTabs';
import { ReportsSectionContent } from '@/features/reports/components/ReportsSectionContent';
import { ReportsRangeCard } from '@/features/reports/components/ReportsRangeCard';
import { useReportsWorkspaceController } from '@/features/reports/hooks/useReportsWorkspaceController';
import type { ReportsSectionKey } from '@/features/reports/pages/reports.page-config';
import { ReportPrintMenu } from '@/shared/components/ReportPrintMenu';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { referenceDataApi } from '@/services/reference-data.api';
import { userDirectoryApi } from '@/shared/api/user-directory';

export function ReportsWorkspace({ currentSection }: { currentSection: ReportsSectionKey }) {
  const { t } = useTranslation();
  const controller = useReportsWorkspaceController(currentSection);
  const locationsQuery = useQuery({ queryKey: queryKeys.locations, queryFn: referenceDataApi.locations });
  const usersQuery = useQuery({ queryKey: queryKeys.settingsUsers, queryFn: userDirectoryApi.users });

  return (
    <div className="page-stack page-shell reports-workspace reports-animated-shell reports-workspace--compact" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
      <PageHeader
        title={t('reports.reports_workspace.s0', "التقارير")}
        description={t('reports.reports_workspace.s1', "اختر القسم والفترة ثم راجع التقرير مباشرة بدون صفوف تمهيدية إضافية.")}
        badge={<span className="nav-pill">{controller.rangeDays} {t('reports.reports_workspace.s2', "يوم")}</span>}
        actions={(
          <div className="actions compact-actions">
            <Button variant="secondary" onClick={controller.exportExecutiveSummary} disabled={!controller.report}>{t('reports.reports_workspace.s3', "تصدير")}</Button>
            <ReportPrintMenu
              onPrintA4={() => controller.printExecutiveSummary('A4')}
              onPrintReceipt={() => controller.printExecutiveSummary('receipt')}
              disabled={!controller.report}
            />
            <Button variant="secondary" onClick={() => void controller.copyExecutiveSummary()} disabled={!controller.report}>{t('reports.reports_workspace.s4', "نسخ")}</Button>
          </div>
        )}
      />

      <ReportsSectionTabs currentSection={currentSection} />

      <ReportsRangeCard
        from={controller.from}
        to={controller.to}
        onFromChange={controller.setFrom}
        onToChange={controller.setTo}
        onApply={controller.applyRange}
        onPresetToday={controller.applyTodayPreset}
        onPreset7={() => controller.applyPreset(7)}
        onPreset30={() => controller.applyPreset(30)}
        onReset={controller.resetRange}
        healthRows={controller.reportHealthRows}
        locationId={controller.locationId}
        onLocationChange={controller.setLocationId}
        locations={locationsQuery.data}
        userId={controller.userId}
        onUserIdChange={controller.setUserId}
        users={usersQuery.data}
      />

      <ReportsSectionContent
        section={currentSection}
        report={controller.report}
        reportQuery={controller.reportQuery}
        accountingFinancialSummary={controller.accountingFinancialSummary}
        accountingFinancialSummaryLoading={controller.accountingFinancialSummaryLoading}
        accountingCashMovement={controller.accountingCashMovement}
        accountingCashMovementLoading={controller.accountingCashMovementLoading}
        accountingReceivablesPayables={controller.accountingReceivablesPayables}
        accountingReceivablesPayablesLoading={controller.accountingReceivablesPayablesLoading}
        accountingInventoryValue={controller.accountingInventoryValue}
        accountingInventoryValueLoading={controller.accountingInventoryValueLoading}
        inventoryQuery={controller.inventoryQuery}
        deadStockQuery={controller.deadStockQuery}
        balancesQuery={controller.balancesQuery}
        employeesQuery={controller.employeesQuery}
        executiveRows={controller.executiveRows}
        operatingSignalRows={controller.operatingSignalRows}
        topProducts={controller.topProducts}
        rangeDays={controller.rangeDays}
        salesDailyAverage={controller.salesDailyAverage}
        purchaseDailyAverage={controller.purchaseDailyAverage}
        returnRatePercent={controller.returnRatePercent}
        exportTopProducts={controller.exportTopProducts}
        printTopProducts={controller.printTopProducts}
        exportLowStock={controller.exportLowStock}
        exportCustomerBalances={controller.exportCustomerBalances}
        printInventoryValueReport={controller.printInventoryValueReport}
        printInventoryMovementsReport={controller.printInventoryMovementsReport}
        printSalesRegisterReport={controller.printSalesRegisterReport}
        printPurchasesRegisterReport={controller.printPurchasesRegisterReport}
        locationId={controller.locationId}
        printCustomerBalances={controller.printCustomerBalances}
        formatPercent={controller.formatPercent}
        inventorySearch={controller.inventorySearch}
        onInventorySearchChange={controller.onInventorySearchChange}
        inventoryFilter={controller.inventoryFilter}
        onInventoryFilterChange={controller.onInventoryFilterChange}
        deadStockDays={controller.deadStockDays}
        onDeadStockDaysChange={controller.onDeadStockDaysChange}
        onInventoryPageChange={controller.onInventoryPageChange}
        onInventoryPageSizeChange={controller.onInventoryPageSizeChange}
        onInventoryFiltersReset={controller.onInventoryFiltersReset}
        balancesSearch={controller.balancesSearch}
        onBalancesSearchChange={controller.onBalancesSearchChange}
        balancesFilter={controller.balancesFilter}
        onBalancesFilterChange={controller.onBalancesFilterChange}
        onBalancesPageChange={controller.onBalancesPageChange}
        onBalancesPageSizeChange={controller.onBalancesPageSizeChange}
        onBalancesFiltersReset={controller.onBalancesFiltersReset}
        employeeSearch={controller.employeeSearch}
        onEmployeeSearchChange={controller.onEmployeeSearchChange}
        selectedEmployeeId={controller.selectedEmployeeId}
        onSelectedEmployeeIdChange={controller.onSelectedEmployeeIdChange}
        employeeRole={controller.employeeRole}
        onEmployeeRoleChange={controller.onEmployeeRoleChange}
        employeeActivityType={controller.employeeActivityType}
        onEmployeeActivityTypeChange={controller.onEmployeeActivityTypeChange}
        onEmployeesPageChange={controller.onEmployeesPageChange}
        onEmployeesPageSizeChange={controller.onEmployeesPageSizeChange}
        onEmployeesFiltersReset={controller.onEmployeesFiltersReset}
      />
      </main>
    </div>
  );
}
