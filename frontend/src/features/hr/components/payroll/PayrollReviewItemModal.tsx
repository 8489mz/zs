import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogShell } from '@/shared/components/dialog-shell';
import { normalize } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { HrPayrollRunItem, HrPayrollAdjustment } from '@/types/domain';
import { printPayslip } from './payroll-review-item-modal/payroll-review-item-modal-payslip';
import { printThermalReceipt } from './payroll-review-item-modal/payroll-review-item-modal-thermal-receipt';
import { PayrollReviewItemModalHeader } from './payroll-review-item-modal/payroll-review-item-modal-header';
import { PayrollReviewItemModalKpiStrip } from './payroll-review-item-modal/payroll-review-item-modal-kpi-strip';
import { PayrollReviewItemModalBreakdown } from './payroll-review-item-modal/payroll-review-item-modal-breakdown';
import { PayrollReviewItemModalNetBanner } from './payroll-review-item-modal/payroll-review-item-modal-net-banner';
import { PayrollReviewItemModalAdjustments } from './payroll-review-item-modal/payroll-review-item-modal-adjustments';
import { PayrollReviewItemModalAttendance } from './payroll-review-item-modal/payroll-review-item-modal-attendance';
import { PayrollReviewItemModalFooter } from './payroll-review-item-modal/payroll-review-item-modal-footer';

interface PayrollReviewItemModalProps {
  item: HrPayrollRunItem | null;
  onClose: () => void;
  canViewSalaryAmounts: boolean;
  runIsFinal: boolean;
  isDraft: boolean;
  periodMonth?: string;
  onAddAdjustment?: (payload: { adjustmentType: 'allowance' | 'deduction'; label: string; amount: number; notes?: string }) => Promise<void>;
  onDeleteAdjustment?: (adjustmentId: string) => Promise<void>;
  onNavigateToAttendance?: (employeeId: string) => void;
  onNavigateToEmployee?: (employeeId: string) => void;
  onPrintSummary?: (item: HrPayrollRunItem) => void;
  onPrintDetailed?: (item: HrPayrollRunItem) => void;
  onPayItem?: (item: HrPayrollRunItem) => void;
  canApprovePayroll?: boolean;
}

export function PayrollReviewItemModal({
  item,
  onClose,
  canViewSalaryAmounts,
  runIsFinal,
  isDraft,
  periodMonth,
  onAddAdjustment,
  onDeleteAdjustment,
  onNavigateToAttendance,
  onNavigateToEmployee,
  onPayItem,
  canApprovePayroll = true,
}: PayrollReviewItemModalProps) {
  const { t } = useTranslation();

  // Adjustment form states
  const [showAddAdjustment, setShowAddAdjustment] = useState(false);
  const [adjType, setAdjType] = useState<'allowance' | 'deduction'>('allowance');
  const [adjLabel, setAdjLabel] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNotes, setAdjNotes] = useState('');
  const [isSubmittingAdj, setIsSubmittingAdj] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!item) return null;

  const baseSalary = Number(item.baseSalary || 0);
  const allowanceAmount = Number(item.allowanceAmount || 0);
  const deductionAmount = Number(item.deductionAmount || 0);
  const loanDeduction = Number(item.loanDeductionAmount || 0);
  const insuranceDeduction = Number((item as any).employeeSocialInsurance || 0);
  const taxDeduction = Number((item as any).incomeTax || 0);
  const grossPay = Number(item.grossPay || (baseSalary + allowanceAmount));
  const totalDeductions = deductionAmount + loanDeduction + insuranceDeduction + taxDeduction;
  const netPay = Number(item.netPay || (grossPay - totalDeductions));
  const adjustments = (item.adjustments || []) as HrPayrollAdjustment[];

  const isHourly = normalize(item.compensationType) === 'hourly' || (Number(item.hourlyRate || 0) > 0 && normalize(item.compensationType) !== 'monthly');
  const hourlyRate = Number(item.hourlyRate || 0);
  const calculatedHours = hourlyRate > 0 ? Number((baseSalary / hourlyRate).toFixed(2)) : 0;

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddAdjustment) return;
    const num = Number(adjAmount);
    if (!adjLabel.trim() || isNaN(num) || num <= 0) return;

    try {
      setIsSubmittingAdj(true);
      await onAddAdjustment({
        adjustmentType: adjType,
        label: adjLabel.trim(),
        amount: num,
        notes: adjNotes.trim() || undefined,
      });
      setAdjLabel('');
      setAdjAmount('');
      setAdjNotes('');
      setShowAddAdjustment(false);
    } finally {
      setIsSubmittingAdj(false);
    }
  };

  const handleDeleteAdj = async (id: string) => {
    if (!onDeleteAdjustment) return;
    try {
      setDeletingId(id);
      await onDeleteAdjustment(id);
    } finally {
      setDeletingId(null);
    }
  };

  const printArgs: PrintPayslipArgs = {
    item,
    periodMonth,
    isHourly,
    canViewSalaryAmounts,
    hourlyRate,
    calculatedHours,
    runIsFinal,
    baseSalary,
    allowanceAmount,
    grossPay,
    deductionAmount,
    loanDeduction,
    insuranceDeduction,
    taxDeduction,
    totalDeductions,
    netPay,
  };

  return (
    <DialogShell open={true} onClose={onClose} width="760px">
      <div style={{ padding: '20px 24px', maxHeight: '85vh', overflowY: 'auto' }}>
        {/* Header */}
        <PayrollReviewItemModalHeader isHourly={isHourly} t={t} item={item} periodMonth={periodMonth} onClose={onClose} />
        {/* Quick KPI Strip */}
        <PayrollReviewItemModalKpiStrip isHourly={isHourly} canViewSalaryAmounts={canViewSalaryAmounts} baseSalary={baseSalary} calculatedHours={calculatedHours} hourlyRate={hourlyRate} allowanceAmount={allowanceAmount} totalDeductions={totalDeductions} netPay={netPay} />
        {/* Dual-Column Financial Breakdown */}
        <PayrollReviewItemModalBreakdown isHourly={isHourly} canViewSalaryAmounts={canViewSalaryAmounts} baseSalary={baseSalary} hourlyRate={hourlyRate} calculatedHours={calculatedHours} allowanceAmount={allowanceAmount} grossPay={grossPay} deductionAmount={deductionAmount} loanDeduction={loanDeduction} insuranceDeduction={insuranceDeduction} taxDeduction={taxDeduction} totalDeductions={totalDeductions} />
        {/* Hero Net Payable Banner */}
        <PayrollReviewItemModalNetBanner isHourly={isHourly} canViewSalaryAmounts={canViewSalaryAmounts} netPay={netPay} item={item} onPayItem={onPayItem} canApprovePayroll={canApprovePayroll} />
        {/* Manual Adjustments Section (Edit & Modify Salary) */}
        <PayrollReviewItemModalAdjustments
          adjustments={adjustments}
          showAddAdjustment={showAddAdjustment}
          isHourly={isHourly}
          isDraft={isDraft}
          onAddAdjustment={onAddAdjustment}
          setShowAddAdjustment={setShowAddAdjustment}
          onDeleteAdjustment={onDeleteAdjustment}
          handleDeleteAdj={handleDeleteAdj}
          deletingId={deletingId}
          handleSaveAdjustment={handleSaveAdjustment}
          periodMonth={periodMonth}
          adjType={adjType}
          setAdjType={setAdjType}
          adjLabel={adjLabel}
          setAdjLabel={setAdjLabel}
          adjAmount={adjAmount}
          setAdjAmount={setAdjAmount}
          adjNotes={adjNotes}
          setAdjNotes={setAdjNotes}
          isSubmittingAdj={isSubmittingAdj}
        />
        {/* Attendance & Root Navigation Section */}
        <PayrollReviewItemModalAttendance onNavigateToAttendance={onNavigateToAttendance} item={item} onNavigateToEmployee={onNavigateToEmployee} isHourly={isHourly} calculatedHours={calculatedHours} deductionAmount={deductionAmount} />
        {/* Footer Actions */}
        <PayrollReviewItemModalFooter
          onClose={onClose}
          t={t}
          item={item}
          onPayItem={onPayItem}
          canApprovePayroll={canApprovePayroll}
          canViewSalaryAmounts={canViewSalaryAmounts}
          netPay={netPay}
          onPrintThermalReceipt={() => printThermalReceipt(printArgs)}
          onPrintPayslip={() => printPayslip(printArgs)}
          isHourly={isHourly}
        />
      </div>
    </DialogShell>
  );
}
