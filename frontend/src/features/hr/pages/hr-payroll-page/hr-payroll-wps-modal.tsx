import { PayrollWpsExportModal } from '@/features/hr/components/payroll/PayrollWpsExportModal';
import type { HrPayrollRun } from '@/types/domain';
import type { Dispatch, SetStateAction } from 'react';

export interface HrPayrollWpsExportSectionProps {
  selectedRun: HrPayrollRun | undefined;
  showWpsModal: boolean;
  isEg: boolean;
  setShowWpsModal: Dispatch<SetStateAction<boolean>>;
}

export function HrPayrollWpsExportSection({ selectedRun, showWpsModal, isEg, setShowWpsModal }: HrPayrollWpsExportSectionProps) {
  return (
    <>
    {showWpsModal && selectedRun && (
      <PayrollWpsExportModal
        runId={String(selectedRun.id)}
        runMonth={String(selectedRun.periodMonth || '')}
        runName={String((selectedRun as any).name || `${isEg ? 'كشف' : 'مسير'} شهر ${selectedRun.periodMonth || ''}`)}
        onClose={() => setShowWpsModal(false)}
      />
    )}
    </>
  );
}
