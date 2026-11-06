/* Raw-date display (INV-RAW-DATE-DISPLAY): the settlement preview
 * renders the hire date with the shared formatter, never raw ISO text —
 * a hire date of 2026-11-05T00:00:00.000Z shows as 2026/11/05.
 * Renders the REAL CreateSettlementModal.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CreateSettlementModal } from './CreateSettlementModal';
import type { SettlementPreview } from '../../api/end-of-service.api';

const preview: SettlementPreview = {
  employee: {
    id: 1,
    employeeNo: 'EMP-1',
    name: 'اختبار موظف',
    hireDate: '2026-11-05T00:00:00.000Z',
    departmentId: null,
    currentStatus: 'active',
  },
  servicePeriod: { years: 0, months: 0, days: 1, totalYearsDecimal: 0, totalDays: 1 },
  salaries: { basicSalary: 5000, totalSalary: 5000, dailyWage: 166.67 },
  gratuity: { lawType: 'saudi', reason: '', baseGratuity: 0, gratuityPercentage: 0, gratuityAmount: 0 },
  leaveEncashment: { remainingLeaveDays: 21, leaveEncashmentAmount: 0 },
  pendingSalaryAmount: 0,
  noticePeriodAmount: 0,
  customEntitlements: 0,
  unpaidLoansDeduction: 0,
  assetsDeduction: 0,
  otherDeductions: 0,
  totalEntitlements: 0,
  totalDeductions: 0,
  netSettlementAmount: 0,
  unreturnedAssets: [],
};

const renderModal = (previewValue: SettlementPreview | null) =>
  render(
    <CreateSettlementModal
      isOpen
      onClose={vi.fn()}
      employeesList={[{ id: 1, name: 'اختبار موظف', employeeNo: 'EMP-1' }]}
      selectedEmployeeId={1}
      onEmployeeChange={vi.fn()}
      terminationDate="2026-11-05"
      onTerminationDateChange={vi.fn()}
      terminationReason="resignation"
      onTerminationReasonChange={vi.fn()}
      lawType="saudi"
      onLawTypeChange={vi.fn()}
      customDaysPerYear={0}
      onCustomDaysChange={vi.fn()}
      pendingSalaryAmount={0}
      onPendingSalaryChange={vi.fn()}
      noticePeriodAmount={0}
      onNoticePeriodChange={vi.fn()}
      customEntitlements={0}
      onCustomEntitlementsChange={vi.fn()}
      assetsDeduction={0}
      onAssetsDeductionChange={vi.fn()}
      otherDeductions={0}
      onOtherDeductionsChange={vi.fn()}
      custodyCleared={false}
      onCustodyClearedChange={vi.fn()}
      confirmTermination={false}
      onConfirmTerminationChange={vi.fn()}
      preview={previewValue}
      calculating={false}
      saving={false}
      feedback={null}
      onCalculate={vi.fn()}
      onSave={vi.fn()}
    />,
  );

describe('Settlement preview hire date', () => {
  it('shows the hire date formatted, never raw ISO', async () => {
    renderModal(preview);

    expect(await screen.findByText('تاريخ التعيين')).toBeTruthy();
    expect(await screen.findByText('2026/11/05')).toBeTruthy();
    expect(screen.queryByText('2026-11-05T00:00:00.000Z')).toBeNull();
    expect(document.body.textContent).not.toContain('T00:00:00');
  });

  it('keeps the not-recorded fallback when no hire date exists', async () => {
    renderModal({ ...preview, employee: { ...preview.employee, hireDate: '' } });

    expect(await screen.findByText('غير مسجل')).toBeTruthy();
  });
});
