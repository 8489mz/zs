import { PayrollReviewItemModal } from '../../components/payroll/PayrollReviewItemModal';
import { toast } from '@/shared/components/system-alert';
import { useTranslation } from 'react-i18next';
import type { HrPayrollRun, HrPayrollRunItem } from '@/types/domain';
import type { Dispatch, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';

export interface HrPayrollReviewItemModalSectionProps {
  selectedRun: HrPayrollRun | undefined;
  navigate: NavigateFunction;
  t: ReturnType<typeof useTranslation>['t'];
  activeReviewItem: HrPayrollRunItem | null;
  setSelectedReviewItem: Dispatch<SetStateAction<HrPayrollRunItem | null>>;
  canViewSalaryAmounts: boolean;
  runIsFinal: boolean | undefined;
  handleAddAdjustment: (payload: { adjustmentType: 'allowance' | 'deduction'; label: string; amount: number; notes?: string; }) => Promise<void>;
  handleDeleteAdjustment: (adjustmentId: string) => Promise<void>;
  handleOpenPayItemModal: (item: HrPayrollRunItem) => void;
  canApprovePayroll: boolean;
}

export function HrPayrollReviewItemModalSection({ selectedRun, navigate, t, activeReviewItem, setSelectedReviewItem, canViewSalaryAmounts, runIsFinal, handleAddAdjustment, handleDeleteAdjustment, handleOpenPayItemModal, canApprovePayroll }: HrPayrollReviewItemModalSectionProps) {
  return (
    <PayrollReviewItemModal
      item={activeReviewItem}
      onClose={() => setSelectedReviewItem(null)}
      canViewSalaryAmounts={canViewSalaryAmounts}
      runIsFinal={Boolean(runIsFinal)}
      isDraft={selectedRun?.status === 'draft'}
      periodMonth={selectedRun?.periodMonth}
      onAddAdjustment={handleAddAdjustment}
      onDeleteAdjustment={handleDeleteAdjustment}
      onNavigateToAttendance={(employeeId) => navigate(`/hr/attendance?employeeId=${employeeId}${selectedRun?.periodMonth ? `&period=${selectedRun.periodMonth}` : ''}`)}
      onNavigateToEmployee={(employeeId) => navigate(`/hr/employees/${employeeId}`)}
      onPrintSummary={(item) => toast.info(t('hr.hr_payroll_page.s25', "طباعة ملخص للموظف ") + item.employeeName)}
      onPrintDetailed={(item) => toast.info(t('hr.hr_payroll_page.s26', "طباعة تفصيلي للموظف ") + item.employeeName)}
      onPayItem={handleOpenPayItemModal}
      canApprovePayroll={canApprovePayroll}
    />
  );
}
