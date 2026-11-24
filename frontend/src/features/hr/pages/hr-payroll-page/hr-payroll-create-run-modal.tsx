import { CreatePayrollRunModal, type PayrollDraft } from '../../components/payroll/CreatePayrollRunModal';
import type { HrEmployee } from '@/types/domain';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { useHrMutations, useHrWorkspace } from '@/features/hr/hooks/useHr';

export interface HrPayrollCreateRunModalSectionProps {
  workspace: ReturnType<typeof useHrWorkspace>;
  showCreateRun: boolean;
  setShowCreateRun: Dispatch<SetStateAction<boolean>>;
  draft: PayrollDraft;
  setDraft: Dispatch<SetStateAction<PayrollDraft>>;
  handleCreateRun: (e: FormEvent<Element>) => Promise<void>;
  mutations: ReturnType<typeof useHrMutations>;
  canManagePayroll: boolean;
  hasCreatePayrollRun: boolean;
  formError: string;
  employees: HrEmployee[];
  isEg: boolean;
}

export function HrPayrollCreateRunModalSection({ workspace, showCreateRun, setShowCreateRun, draft, setDraft, handleCreateRun, mutations, canManagePayroll, hasCreatePayrollRun, formError, employees, isEg }: HrPayrollCreateRunModalSectionProps) {
  return (
    <CreatePayrollRunModal
      isOpen={showCreateRun}
      onClose={() => setShowCreateRun(false)}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={handleCreateRun}
      isPending={mutations.createPayrollRun.isPending}
      canManagePayroll={canManagePayroll}
      hasCreatePayrollRun={hasCreatePayrollRun}
      formError={formError}
      employees={employees}
      isEgypt={isEg}
      serverTime={workspace.payrollRuns.data?.serverTime}
      serverTimezone={workspace.payrollRuns.data?.serverTimezone}
    />
  );
}
