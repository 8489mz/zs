import { PayPayrollRunModal, type PayPayrollTargetItem } from '../../components/payroll/PayPayrollRunModal';
import type { HrPayrollRun } from '@/types/domain';
import type { Dispatch, SetStateAction } from 'react';

export interface HrPayrollPayRunModalSectionProps {
  setPayModalTargetItem: Dispatch<SetStateAction<PayPayrollTargetItem | null>>;
  showPayRun: boolean;
  setShowPayRun: Dispatch<SetStateAction<boolean>>;
  selectedRun: HrPayrollRun | undefined;
  payModalTargetItem: PayPayrollTargetItem | null;
  canApprovePayroll: boolean;
}

export function HrPayrollPayRunModalSection({ setPayModalTargetItem, showPayRun, setShowPayRun, selectedRun, payModalTargetItem, canApprovePayroll }: HrPayrollPayRunModalSectionProps) {
  return (
    <PayPayrollRunModal
      isOpen={showPayRun}
      onClose={() => {
        setShowPayRun(false);
        setPayModalTargetItem(null);
      }}
      selectedRun={selectedRun}
      targetItem={payModalTargetItem}
      canApprovePayroll={canApprovePayroll}
      onSuccess={() => {
        setPayModalTargetItem(null);
      }}
    />
  );
}
