import { CustomSelect } from '@/shared/ui/custom-select';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface QuickCashAdvanceEmployeeProps {
  t: ReturnType<typeof useTranslation>['t'];
  employeeId: string;
  setEmployeeId: Dispatch<SetStateAction<string>>;
  setAmount: Dispatch<SetStateAction<string>>;
  setManagerPassword: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  employeeOptions: any[];
}

export function QuickCashAdvanceEmployee({ t, employeeId, setEmployeeId, setAmount, setManagerPassword, setFormError, employeeOptions }: QuickCashAdvanceEmployeeProps) {
  return (
    <>
    {/* 2. Employee Selection */}
    <div>
      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: 4, display: 'block' }}>
        {t('hr.quick_cash_advance_modal.employee_select', 'الموظف *')}
      </span>
      <CustomSelect
        value={employeeId}
        onChange={(val) => {
          setEmployeeId(val);
          setAmount('');
          setManagerPassword('');
          setFormError('');
        }}
        options={employeeOptions}
        openOnFocus
      />
    </div>
    </>
  );
}
