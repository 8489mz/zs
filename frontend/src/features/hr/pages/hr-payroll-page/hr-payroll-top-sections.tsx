import { HrPayrollTopSections } from '@/features/hr/pages/payroll/HrPayrollTopSections';
import type { PayrollReviewStatus } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { PayrollDraft } from '../../components/payroll/CreatePayrollRunModal';
import type { HrPayrollRunItem } from '@/types/domain';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { useHrMutations } from '@/features/hr/hooks/useHr';

export interface HrPayrollTopSectionsSectionProps {
  monthFilter: string;
  search: string;
  selectedEmployeeId: string;
  setSelectedEmployeeId: Dispatch<SetStateAction<string>>;
  employeeOptions: { value: string; label: string; hint?: string; code?: string; }[];
  departmentFilter: string;
  reviewStatusFilter: PayrollReviewStatus;
  runStatusFilter: string;
  departmentOptions: { value: string; label: string; }[];
  runStatusOptions: { value: string; label: string; }[];
  summary: { totalNet: number; totalBase: number; totalBaseSalary: number; totalAllowances: number; totalDeductions: number; totalLoanDeduction: number; flaggedCount: number; needsReview: number; itemCount: number; totalEmployees: number; };
  canViewSalaryAmounts: boolean;
  dueLoanInstallmentRows: HrPayrollRunItem[];
  draft: PayrollDraft;
  formError: string;
  canManagePayroll: boolean;
  hasCreatePayrollRun: boolean;
  mutations: ReturnType<typeof useHrMutations>;
  isEg: boolean;
  topKpiBaseSalaryLabel: string;
  topKpiNetPayLabel: string;
  setMonthFilter: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  setSearch: Dispatch<SetStateAction<string>>;
  setDepartmentFilter: Dispatch<SetStateAction<string>>;
  setReviewStatusFilter: Dispatch<SetStateAction<PayrollReviewStatus>>;
  setRunStatusFilter: Dispatch<SetStateAction<string>>;
  setDraft: Dispatch<SetStateAction<PayrollDraft>>;
  handleCreateRun: (e: FormEvent<Element>) => Promise<void>;
}

export function HrPayrollTopSectionsSection({ monthFilter, search, selectedEmployeeId, setSelectedEmployeeId, employeeOptions, departmentFilter, reviewStatusFilter, runStatusFilter, departmentOptions, runStatusOptions, summary, canViewSalaryAmounts, dueLoanInstallmentRows, draft, formError, canManagePayroll, hasCreatePayrollRun, mutations, isEg, topKpiBaseSalaryLabel, topKpiNetPayLabel, setMonthFilter, setPage, setSearch, setDepartmentFilter, setReviewStatusFilter, setRunStatusFilter, setDraft, handleCreateRun }: HrPayrollTopSectionsSectionProps) {
  return (
    <HrPayrollTopSections
      monthFilter={monthFilter}
      search={search}
      selectedEmployeeId={selectedEmployeeId}
      onSelectedEmployeeChange={setSelectedEmployeeId}
      employeeOptions={employeeOptions}
      departmentFilter={departmentFilter}
      reviewStatusFilter={reviewStatusFilter}
      runStatusFilter={runStatusFilter}
      departmentOptions={departmentOptions}
      runStatusOptions={runStatusOptions}
      summary={summary}
      canViewSalaryAmounts={canViewSalaryAmounts}
      dueLoanInstallmentRows={dueLoanInstallmentRows}
      draft={draft}
      formError={formError}
      canManagePayroll={canManagePayroll}
      hasCreatePayrollRun={hasCreatePayrollRun}
      isCreatePending={mutations.createPayrollRun.isPending}
      isEgypt={isEg}
      baseSalaryLabel={topKpiBaseSalaryLabel}
      netPayLabel={topKpiNetPayLabel}
      onMonthFilterChange={(value) => { setMonthFilter(value); setPage(1); }}
      onSearchChange={setSearch}
      onDepartmentFilterChange={setDepartmentFilter}
      onReviewStatusFilterChange={setReviewStatusFilter}
      onRunStatusFilterChange={setRunStatusFilter}
      onDraftChange={setDraft}
      onCreateRun={(event) => { void handleCreateRun(event); }}
    />
  );
}
