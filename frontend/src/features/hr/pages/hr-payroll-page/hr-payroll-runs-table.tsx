import { PayrollRunsTable, type PayrollRunTab, type PayrollRunTabCounts } from '../../components/payroll/PayrollRunsTable';
import type { HrPayrollRun } from '@/types/domain';
import type { Dispatch, SetStateAction } from 'react';
import type { useHrWorkspace } from '@/features/hr/hooks/useHr';
import type { PayPayrollTargetItem } from '../../components/payroll/PayPayrollRunModal';

export interface HrPayrollRunsTableSectionProps {
  workspace: ReturnType<typeof useHrWorkspace>;
  filteredRuns: HrPayrollRun[];
  setPage: Dispatch<SetStateAction<number>>;
  setSelectedRunId: Dispatch<SetStateAction<string>>;
  canManagePayroll: boolean;
  handleRunActionClick: (runId: string, type: 'review' | 'approve') => void;
  payrollChecklist: { key: string; title: string; status: string; ok: boolean; action?: string; onClick?: (() => void) | undefined; }[];
  page: number;
  pageSize: number;
  setPageSize: Dispatch<SetStateAction<number>>;
  selectedRunId: string;
  activeRunTab: PayrollRunTab;
  handleTabChange: (nextTab: PayrollRunTab) => void;
  tabCounts: PayrollRunTabCounts;
  hasCreatePayrollRun: boolean;
  openCreateModal: () => void;
  canViewSalaryAmounts: boolean;
  canApprovePayroll: boolean;
  handleRecalculateRun: (runId: string) => Promise<void>;
  setPayModalTargetItem: Dispatch<SetStateAction<PayPayrollTargetItem | null>>;
  setShowPayRun: Dispatch<SetStateAction<boolean>>;
  handleCancelRun: (runId: string) => Promise<void>;
  isEg: boolean;
}

export function HrPayrollRunsTableSection({ workspace, filteredRuns, setPage, setSelectedRunId, canManagePayroll, handleRunActionClick, payrollChecklist, page, pageSize, setPageSize, selectedRunId, activeRunTab, handleTabChange, tabCounts, hasCreatePayrollRun, openCreateModal, canViewSalaryAmounts, canApprovePayroll, handleRecalculateRun, setPayModalTargetItem, setShowPayRun, handleCancelRun, isEg }: HrPayrollRunsTableSectionProps) {
  return (
    <PayrollRunsTable
      payrollChecklist={payrollChecklist}
      runs={filteredRuns}
      isLoading={workspace.payrollRuns.isLoading}
      isError={workspace.payrollRuns.isError}
      error={workspace.payrollRuns.error}
      page={page}
      pageSize={pageSize}
      totalItems={filteredRuns.length}
      onPageChange={setPage}
      onPageSizeChange={(next) => { setPageSize(next); setPage(1); }}
      onSelectRun={(id) => setSelectedRunId(id)}
      selectedRunId={selectedRunId}
      activeTab={activeRunTab}
      onTabChange={handleTabChange}
      tabCounts={tabCounts}
      onCreateRun={hasCreatePayrollRun && canManagePayroll ? openCreateModal : undefined}
      canViewSalaryAmounts={canViewSalaryAmounts}
      canManagePayroll={canManagePayroll}
      canApprovePayroll={canApprovePayroll}
      onRecalculate={(id) => void handleRecalculateRun(id)}
      onReviewClick={(id) => handleRunActionClick(id, 'review')}
      onApproveClick={(id) => handleRunActionClick(id, 'approve')}
      onPayClick={(id) => { setSelectedRunId(id); setPayModalTargetItem(null); setShowPayRun(true); }}
      onCancel={(id) => void handleCancelRun(id)}
      isEgypt={isEg}
    />
  );
}
