import { money, type WithdrawalBalanceResponse } from './quick-cash-advance-shared';
import { AlertCircleIcon } from '@/shared/components/icons/AppIcons';
import { getErrorMessage } from '@/lib/errors';

export interface QuickCashAdvanceBalanceProps {
  isBalanceError: boolean;
  balanceData: WithdrawalBalanceResponse | undefined;
  balanceError: Error | null;
  employeeId: string;
  selectedEmployee: any;
  payFrequencyLabel: string;
  accrualSubtitle: string;
  deductionsSubtitle: string;
  hasCredit: boolean;
  netAvailable: number;
  availableSubtitle: string;
}

export function QuickCashAdvanceBalance({ isBalanceError, balanceData, balanceError, employeeId, selectedEmployee, payFrequencyLabel, accrualSubtitle, deductionsSubtitle, hasCredit, netAvailable, availableSubtitle }: QuickCashAdvanceBalanceProps) {
  return (
    <>
    {/* 3. Three-Card Executive Financial Strip */}
    <div>
      {isBalanceError && !balanceData ? (
        <div
          style={{
            padding: '10px 12px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            color: '#991b1b',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <AlertCircleIcon size={16} />
          <span>{getErrorMessage(balanceError, 'تعذر احتساب الرصيد اللحظي لهذا الموظف.')}</span>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '10px 12px 12px',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          {/* Header line for contract type & employee identification */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '2px 4px 8px',
              fontSize: '0.78rem',
              color: '#64748b',
              borderBottom: '1px dashed #e2e8f0',
              marginBottom: 10,
            }}
          >
            <span style={{ fontWeight: 700, color: employeeId ? '#0f172a' : '#94a3b8' }}>
              {employeeId
                ? (balanceData?.employee?.displayName || selectedEmployee?.displayName || selectedEmployee?.name || 'الموظف') +
                  (balanceData?.employee?.payFrequency ? ` (${payFrequencyLabel})` : selectedEmployee?.payFrequency ? ` (${selectedEmployee.payFrequency === 'daily' ? 'يومي' : 'شهري'})` : '')
                : 'بيان الوضع المالي اللحظي للموظف'}
            </span>
            <span style={{ fontWeight: 600, color: employeeId ? '#334155' : '#94a3b8' }}>
              {employeeId
                ? balanceData
                  ? balanceData.employee.compensationType === 'hourly'
                    ? `أجر الساعة: ${money(balanceData.employee.hourlyRate)} ج.م/س`
                    : `الراتب الأساسي: ${money(balanceData.employee.baseSalary)} ج.م`
                  : selectedEmployee?.hourlyRate
                    ? `أجر الساعة: ${money(selectedEmployee.hourlyRate)} ج.م/س`
                    : selectedEmployee?.compensationType === 'hourly'
                      ? 'أجر بالساعة'
                      : 'راتب تعاقدي'
                : 'اختر الموظف لعرض تفاصيل العقد'}
            </span>
          </div>

          {/* 3-Column Financial Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 10,
              boxSizing: 'border-box',
              width: '100%',
            }}
          >
            {/* Card 1: الأجر المستحق */}
            <div
              style={{
                backgroundColor: '#f0f9ff',
                border: '1.5px solid #bae6fd',
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: 74,
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 700, display: 'block' }}>
                الأجر المستحق
              </span>
              <strong
                style={{
                  fontSize: '1.05rem',
                  color: '#0284c7',
                  margin: '3px 0',
                  display: 'block',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {employeeId
                  ? balanceData
                    ? `${money(balanceData.accrual.accruedEarnings)} ج.م`
                    : '...'
                  : '0.00 ج.م'}
              </strong>
              <span
                style={{
                  fontSize: '0.68rem',
                  color: '#64748b',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
                title={accrualSubtitle}
              >
                {accrualSubtitle}
              </span>
            </div>

            {/* Card 2: المسحوبات والسلف */}
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1.5px solid #fecaca',
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: 74,
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: '0.74rem', color: '#b91c1c', fontWeight: 700, display: 'block' }}>
                المسحوبات والسلف
              </span>
              <strong
                style={{
                  fontSize: '1.05rem',
                  color: '#dc2626',
                  margin: '3px 0',
                  display: 'block',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {employeeId
                  ? balanceData
                    ? `${money(balanceData.deductions.totalDebt)} ج.م`
                    : '...'
                  : '0.00 ج.م'}
              </strong>
              <span
                style={{
                  fontSize: '0.68rem',
                  color: '#64748b',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
              >
                {deductionsSubtitle}
              </span>
            </div>

            {/* Card 3: المتاح للصرف */}
            <div
              style={{
                backgroundColor: !employeeId ? '#f8fafc' : hasCredit ? '#f0fdf4' : '#fffbeb',
                border: `1.5px solid ${!employeeId ? '#cbd5e1' : hasCredit ? '#86efac' : '#fcd34d'}`,
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: 74,
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            >
              <span
                style={{
                  fontSize: '0.74rem',
                  color: !employeeId ? '#475569' : hasCredit ? '#15803d' : '#b45309',
                  fontWeight: 700,
                  display: 'block',
                }}
              >
                المتاح للصرف
              </span>
              <strong
                style={{
                  fontSize: '1.08rem',
                  color: !employeeId ? '#475569' : hasCredit ? '#16a34a' : '#d97706',
                  margin: '3px 0',
                  display: 'block',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {employeeId
                  ? balanceData
                    ? hasCredit
                      ? `+${money(netAvailable)} ج.م`
                      : `${money(netAvailable)} ج.م`
                    : '...'
                  : '0.00 ج.م'}
              </strong>
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  color: !employeeId ? '#64748b' : hasCredit ? '#15803d' : '#b45309',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
              >
                {availableSubtitle}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
