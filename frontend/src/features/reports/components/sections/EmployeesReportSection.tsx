import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryCard } from '@/shared/components/query-card';
import { Button } from '@/shared/ui/button';
import { DataTable } from '@/shared/ui/data-table';
import { Field } from '@/shared/ui/field';
import { DialogShell } from '@/shared/components/dialog-shell';
import { ReportMetricCard } from '@/features/reports/components/ReportMetricCard';
import { relativePercent } from '@/features/reports/lib/reports-format';
import { formatCurrency, formatDate } from '@/lib/format';
import { getCurrencyDecimals } from '@/lib/currencies';
import type { ReportsSectionContentProps } from '@/features/reports/components/reports-section.types';
import { reportsApi } from '@/features/reports/api/reports.api';
import { formatEmployeeActivityDetails } from '@/features/audit/lib/audit-details-format';
import { userDirectoryApi } from '@/shared/api/user-directory';

const roleLabel: Record<string, string> = {
  super_admin: 'سوبر أدمن',
  admin: 'مدير',
  cashier: 'كاشير',
};

const activityLabel: Record<string, string> = {
  all: 'كل العمليات',
  sales: 'المبيعات',
  returns: 'المرتجعات',
  purchases: 'المشتريات',
  expenses: 'المصروفات',
  shifts: 'الورديات',
  audit: 'السجل',
  sale: 'بيع',
  purchase: 'شراء',
};

export function EmployeesReportSection({
  employeesQuery,
  employeeSearch,
  onEmployeeSearchChange,
  selectedEmployeeId,
  onSelectedEmployeeIdChange,
  employeeRole,
  onEmployeeRoleChange,
  employeeActivityType,
  onEmployeeActivityTypeChange,
  onEmployeesPageChange,
  onEmployeesPageSizeChange,
  onEmployeesFiltersReset,
}: Pick<ReportsSectionContentProps,
  'employeesQuery'
  | 'employeeSearch'
  | 'onEmployeeSearchChange'
  | 'selectedEmployeeId'
  | 'onSelectedEmployeeIdChange'
  | 'employeeRole'
  | 'onEmployeeRoleChange'
  | 'employeeActivityType'
  | 'onEmployeeActivityTypeChange'
  | 'onEmployeesPageChange'
  | 'onEmployeesPageSizeChange'
  | 'onEmployeesFiltersReset'
>) {
  const { t } = useTranslation();
  const [detailsUserId, setDetailsUserId] = useState('');
  const usersQuery = useQuery({ queryKey: ['reports', 'employee-options'], queryFn: userDirectoryApi.users, staleTime: 60_000 });
  const detailsQuery = useQuery({
    queryKey: ['reports', 'employee-details', detailsUserId, employeeActivityType],
    queryFn: () => reportsApi.employeeReportDetails(detailsUserId, { activityType: employeeActivityType, limit: 30 }),
    enabled: Boolean(detailsUserId),
  });

  const rows = employeesQuery.data?.rows || [];
  const pagination = employeesQuery.data?.pagination;
  const summary = employeesQuery.data?.summary;
  const metricsBase = [
    summary?.totalUsers || 0,
    summary?.activeUsers || 0,
    summary?.usersWithActivity || 0,
    summary?.totalSales || 0,
    summary?.totalPurchases || 0,
    summary?.totalReturns || 0,
  ];
  const userOptions = useMemo(() => (usersQuery.data || []).map((user) => ({
    id: String(user.id || ''),
    label: String(user.name || user.username || 'مستخدم'),
  })), [usersQuery.data]);
  const employeeDetails = detailsQuery.data?.employee;
  const activityRows = detailsQuery.data?.activities || [];
  const detailsSummary = detailsQuery.data?.summary;

  return (
    <>
      <QueryCard
        title={t('reports.sections.employees_report_section.s0', "تقارير الموظفين")}
        description={t('reports.sections.employees_report_section.s1', "فلترة حسب الموظف أو الدور أو نوع العملية، ثم مراجعة الملخصات وفتح تفاصيل الموظف من نفس الشاشة.")}
        actions={<span className="nav-pill">{t('reports.sections.employees_report_section.s2', "الموظفون")}</span>}
        isLoading={employeesQuery.isLoading || usersQuery.isLoading}
        isError={employeesQuery.isError || usersQuery.isError}
        error={employeesQuery.error || usersQuery.error}
        isEmpty={!summary?.totalUsers}
        loadingText={t('reports.sections.employees_report_section.s3', "جاري تحميل ملخصات الموظفين...")}
        emptyTitle={t('reports.sections.employees_report_section.s4', "لا توجد نتائج مطابقة")}
        emptyHint={t('reports.sections.employees_report_section.s5', "وسّع الفلاتر أو جرّب فترة أخرى.")}
        preserveChildrenOnEmpty
        emptyAction={<Button variant="secondary" onClick={onEmployeesFiltersReset}>{t('reports.sections.employees_report_section.s6', "إعادة الضبط")}</Button>}
      >
        <div className="reports-spotlight-grid section-spotlight-grid compact-spotlight-grid">
          <ReportMetricCard isLoading={employeesQuery.isLoading || usersQuery.isLoading} label={t('reports.sections.employees_report_section.s7', "عدد الموظفين")} value={summary?.totalUsers || 0} helper={t('reports.sections.employees_report_section.s8', "ضمن الفلاتر الحالية")} tone="primary" progress={relativePercent(summary?.totalUsers || 0, metricsBase)} />
          <ReportMetricCard isLoading={employeesQuery.isLoading || usersQuery.isLoading} label={t('reports.sections.employees_report_section.s9', "نشطون")} value={summary?.activeUsers || 0} helper={t('reports.sections.employees_report_section.s10', "حسابات مفعّلة")} tone="success" progress={relativePercent(summary?.activeUsers || 0, metricsBase)} />
          <ReportMetricCard isLoading={employeesQuery.isLoading || usersQuery.isLoading} label={t('reports.sections.employees_report_section.s11', "لديهم نشاط")} value={summary?.usersWithActivity || 0} helper={t('reports.sections.employees_report_section.s12', "داخل الفترة")} tone="warning" progress={relativePercent(summary?.usersWithActivity || 0, metricsBase)} />
          <ReportMetricCard isLoading={employeesQuery.isLoading || usersQuery.isLoading} label={t('reports.sections.employees_report_section.s13', "مبيعات الموظفين")} value={summary?.totalSales || 0} helper={t('reports.sections.employees_report_section.s14', "إجمالي البيع المنسوب")} tone="primary" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(summary?.totalSales || 0, metricsBase)} />
          <ReportMetricCard isLoading={employeesQuery.isLoading || usersQuery.isLoading} label={t('reports.sections.employees_report_section.s15', "مشتريات الموظفين")} value={summary?.totalPurchases || 0} helper={t('reports.sections.employees_report_section.s16', "الفواتير المدخلة")} tone="warning" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(summary?.totalPurchases || 0, metricsBase)} />
          <ReportMetricCard isLoading={employeesQuery.isLoading || usersQuery.isLoading} label={t('reports.sections.employees_report_section.s17', "مرتجعات الموظفين")} value={summary?.totalReturns || 0} helper={t('reports.sections.employees_report_section.s18', "إجمالي المرتجعات")} tone="danger" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(summary?.totalReturns || 0, metricsBase)} />
        </div>

        <div className="toolbar-grid compact-toolbar-grid">
          <Field label={t('reports.sections.employees_report_section.s19', "بحث")}>
            <input value={employeeSearch} onChange={(event) => onEmployeeSearchChange(event.target.value)} placeholder={t('reports.sections.employees_report_section.s20', "اسم الموظف / اسم المستخدم")} />
          </Field>
          <Field label={t('reports.sections.employees_report_section.s21', "الموظف")}>
            <select value={selectedEmployeeId} onChange={(event) => onSelectedEmployeeIdChange(event.target.value)}>
              <option value="">{t('reports.sections.employees_report_section.s22', "كل الموظفين")}</option>
              {userOptions.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}
            </select>
          </Field>
          <Field label={t('reports.sections.employees_report_section.s23', "الدور")}>
            <select value={employeeRole} onChange={(event) => onEmployeeRoleChange(event.target.value as 'all' | 'super_admin' | 'admin' | 'cashier')}>
              <option value="all">{t('reports.sections.employees_report_section.s24', "كل الأدوار")}</option>
              <option value="super_admin">{t('reports.sections.employees_report_section.s25', "سوبر أدمن")}</option>
              <option value="admin">{t('reports.sections.employees_report_section.s26', "مدير")}</option>
              <option value="cashier">{t('reports.sections.employees_report_section.s27', "كاشير")}</option>
            </select>
          </Field>
          <Field label={t('reports.sections.employees_report_section.s28', "نوع العملية")}>
            <select value={employeeActivityType} onChange={(event) => onEmployeeActivityTypeChange(event.target.value as 'all' | 'sales' | 'returns' | 'purchases' | 'expenses' | 'shifts' | 'audit')}>
              <option value="all">{t('reports.sections.employees_report_section.s29', "كل العمليات")}</option>
              <option value="sales">{t('reports.sections.employees_report_section.s30', "المبيعات")}</option>
              <option value="returns">{t('reports.sections.employees_report_section.s31', "المرتجعات")}</option>
              <option value="purchases">{t('reports.sections.employees_report_section.s32', "المشتريات")}</option>
              <option value="expenses">{t('reports.sections.employees_report_section.s33', "المصروفات")}</option>
              <option value="shifts">{t('reports.sections.employees_report_section.s34', "الورديات")}</option>
              <option value="audit">{t('reports.sections.employees_report_section.s35', "السجل")}</option>
            </select>
          </Field>
          <div className="actions compact-actions" style={{ alignItems: 'end' }}><Button variant="secondary" onClick={onEmployeesFiltersReset}>{t('reports.sections.employees_report_section.s36', "إعادة الضبط")}</Button></div>
        </div>

        <DataTable
          ariaLabel={t('reports.sections.employees_report_section.s37', "تقارير الموظفين")}
          rows={rows}
          columns={[
            {
              key: 'employee',
              header: t('reports.sections.employees_report_section.s38', "الموظف"),
              cell: (row) => (
                <div>
                  <strong>{row.name}</strong>
                  <div className="muted small">{row.username} · {roleLabel[row.role] || row.role} · {row.isActive ? t('reports.sections.employees_report_section.s39', "نشط") : t('reports.sections.employees_report_section.s40', "موقوف")}</div>
                </div>
              ),
            },
            { key: 'sales', header: t('reports.sections.employees_report_section.s41', "المبيعات"), cell: (row) => `${row.salesCount} · ${formatCurrency(row.salesTotal || 0)}` },
            { key: 'returns', header: t('reports.sections.employees_report_section.s42', "المرتجعات"), cell: (row) => `${row.returnsCount} · ${formatCurrency(row.returnsTotal || 0)}` },
            { key: 'purchases', header: t('reports.sections.employees_report_section.s43', "المشتريات"), cell: (row) => `${row.purchasesCount} · ${formatCurrency(row.purchasesTotal || 0)}` },
            { key: 'ops', header: t('reports.sections.employees_report_section.s44', "العمليات"), cell: (row) => `${row.shiftsCount} وردية · ${row.auditCount} سجل` },
            { key: 'last', header: t('reports.sections.employees_report_section.s45', "آخر نشاط"), cell: (row) => formatDate(row.lastActivityAt || '') },
            {
              key: 'actions',
              header: t('reports.sections.employees_report_section.s46', "تفاصيل"),
              cell: (row) => <Button variant="secondary" onClick={(event) => { event.stopPropagation(); setDetailsUserId(String(row.id || '')); }}>{t('reports.sections.employees_report_section.s47', "عرض")}</Button>,
            },
          ]}
          empty={<div className="muted small">{t('reports.sections.employees_report_section.s48', "لا توجد نتائج مطابقة للفلاتر الحالية.")}</div>}
          pagination={pagination ? {
            page: pagination.page,
            pageSize: pagination.pageSize,
            totalItems: pagination.totalItems,
            onPageChange: onEmployeesPageChange,
            onPageSizeChange: onEmployeesPageSizeChange,
            itemLabel: t('reports.sections.employees_report_section.s49', "موظف"),
          } : undefined}
        />
      </QueryCard>

      <DialogShell open={Boolean(detailsUserId)} onClose={() => setDetailsUserId('')} width="min(980px, 100%)" ariaLabel={t('reports.sections.employees_report_section.s50', "تفاصيل نشاط الموظف")}>
        <div className="page-stack">
          <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0 }}>{t('reports.sections.employees_report_section.s51', "تفاصيل المستخدم")}</h3>
              <div className="muted small">{employeeDetails ? `${employeeDetails.name} · ${employeeDetails.username}` : t('reports.sections.employees_report_section.s52', "جاري التحميل...")}</div>
            </div>
            <Button variant="secondary" onClick={() => setDetailsUserId('')}>{t('reports.sections.employees_report_section.s53', "إغلاق")}</Button>
          </div>

          {detailsQuery.isLoading ? <div className="muted small">{t('reports.sections.employees_report_section.s54', "جاري تحميل التفاصيل...")}</div> : null}
          {detailsQuery.isError ? <div className="warning-box">{t('reports.sections.employees_report_section.s55', "تعذر تحميل تفاصيل الموظف.")}</div> : null}

          {employeeDetails ? (
            <>
              <div className="reports-spotlight-grid section-spotlight-grid compact-spotlight-grid">
                <ReportMetricCard isLoading={detailsQuery.isLoading} label={t('reports.sections.employees_report_section.s56', "المبيعات")} value={detailsSummary?.totalSales || employeeDetails.salesTotal || 0} helper={`${employeeDetails.salesCount} فاتورة`} tone="primary" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(detailsSummary?.totalSales || employeeDetails.salesTotal || 0, [detailsSummary?.totalSales || 0, detailsSummary?.totalPurchases || 0, detailsSummary?.totalReturns || 0, detailsSummary?.totalExpenses || 0])} />
                <ReportMetricCard isLoading={detailsQuery.isLoading} label={t('reports.sections.employees_report_section.s57', "المشتريات")} value={detailsSummary?.totalPurchases || employeeDetails.purchasesTotal || 0} helper={`${employeeDetails.purchasesCount} فاتورة`} tone="warning" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(detailsSummary?.totalPurchases || employeeDetails.purchasesTotal || 0, [detailsSummary?.totalSales || 0, detailsSummary?.totalPurchases || 0, detailsSummary?.totalReturns || 0, detailsSummary?.totalExpenses || 0])} />
                <ReportMetricCard isLoading={detailsQuery.isLoading} label={t('reports.sections.employees_report_section.s58', "المرتجعات")} value={detailsSummary?.totalReturns || employeeDetails.returnsTotal || 0} helper={`${employeeDetails.returnsCount} مستند`} tone="danger" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(detailsSummary?.totalReturns || employeeDetails.returnsTotal || 0, [detailsSummary?.totalSales || 0, detailsSummary?.totalPurchases || 0, detailsSummary?.totalReturns || 0, detailsSummary?.totalExpenses || 0])} />
                <ReportMetricCard isLoading={detailsQuery.isLoading} label={t('reports.sections.employees_report_section.s59', "المصروفات")} value={detailsSummary?.totalExpenses || employeeDetails.expensesTotal || 0} helper={`${employeeDetails.expensesCount} حركة`} tone="warning" formatter={formatCurrency} decimals={getCurrencyDecimals()} progress={relativePercent(detailsSummary?.totalExpenses || employeeDetails.expensesTotal || 0, [detailsSummary?.totalSales || 0, detailsSummary?.totalPurchases || 0, detailsSummary?.totalReturns || 0, detailsSummary?.totalExpenses || 0])} />
                <ReportMetricCard isLoading={detailsQuery.isLoading} label={t('reports.sections.employees_report_section.s60', "السجل")} value={detailsSummary?.totalAuditEvents || employeeDetails.auditCount || 0} helper={t('reports.sections.employees_report_section.s61', "أحداث رقابية")} tone="success" progress={relativePercent(detailsSummary?.totalAuditEvents || employeeDetails.auditCount || 0, [detailsSummary?.totalAuditEvents || 0, detailsSummary?.totalShifts || 0, 1])} />
                <ReportMetricCard isLoading={detailsQuery.isLoading} label={t('reports.sections.employees_report_section.s62', "الورديات")} value={detailsSummary?.totalShifts || employeeDetails.shiftsCount || 0} helper={`المفتوح الآن: ${employeeDetails.openShifts || 0}`} tone="primary" progress={relativePercent(detailsSummary?.totalShifts || employeeDetails.shiftsCount || 0, [detailsSummary?.totalAuditEvents || 0, detailsSummary?.totalShifts || 0, 1])} />
              </div>

              <DataTable
                ariaLabel={t('reports.sections.employees_report_section.s63', "آخر نشاط الموظف")}
                rows={activityRows}
                columns={[
                  { key: 'type', header: t('reports.sections.employees_report_section.s64', "النوع"), cell: (row) => activityLabel[row.activityType] || row.activityType },
                  { key: 'title', header: t('reports.sections.employees_report_section.s65', "العنوان"), cell: (row) => row.title },
                  { key: 'details', header: t('reports.sections.employees_report_section.s66', "التفاصيل"), cell: (row) => row.activityType === 'audit' ? formatEmployeeActivityDetails(row) : row.details || '—' },
                  { key: 'amount', header: t('reports.sections.employees_report_section.s67', "القيمة"), cell: (row) => row.amount == null ? '—' : formatCurrency(row.amount || 0) },
                  { key: 'date', header: t('reports.sections.employees_report_section.s68', "التاريخ والوقت"), cell: (row) => formatDate(row.createdAt) },
                  { key: 'ref', header: t('reports.sections.employees_report_section.s69', "المرجع"), cell: (row) => row.referenceLabel || '—' },
                ]}
                empty={<div className="muted small">{t('reports.sections.employees_report_section.s70', "لا توجد حركات داخل النطاق الحالي.")}</div>}
              />
            </>
          ) : null}
        </div>
      </DialogShell>
    </>
  );
}
