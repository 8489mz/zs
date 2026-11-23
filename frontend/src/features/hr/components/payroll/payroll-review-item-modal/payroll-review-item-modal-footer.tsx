import { Button } from '@/shared/ui/button';
import { money, normalize } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import { PrinterIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { HrPayrollRunItem } from '@/types/domain';

export interface PayrollReviewItemModalFooterProps {
  onClose: () => void;
  t: ReturnType<typeof useTranslation>['t'];
  item: HrPayrollRunItem;
  onPayItem?: (item: HrPayrollRunItem) => void;
  canApprovePayroll: boolean;
  canViewSalaryAmounts: boolean;
  netPay: number;
  onPrintThermalReceipt: () => void;
  onPrintPayslip: () => void;
  isHourly: boolean;
}

export function PayrollReviewItemModalFooter({ onClose, t, item, onPayItem, canApprovePayroll, canViewSalaryAmounts, netPay, onPrintThermalReceipt, onPrintPayslip, isHourly }: PayrollReviewItemModalFooterProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '14px', flexWrap: 'wrap', gap: '8px' }}>
      <Button variant="secondary" onClick={onClose} style={{ minWidth: '90px' }}>
        {t('common.close', "إغلاق")}
      </Button>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {normalize(item.status) === 'approved' && onPayItem && canApprovePayroll && (
          <Button
            variant="primary"
            onClick={() => onPayItem(item)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#170e5e',
              borderColor: '#170e5e',
              color: '#ffffff',
              fontWeight: 700,
              padding: '6px 16px',
            }}
          >
            <span>صرف الراتب ({canViewSalaryAmounts ? money(netPay) : ''})</span>
          </Button>
        )}

        <Button
          variant="secondary"
          onClick={onPrintThermalReceipt}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: 600,
            padding: '6px 14px',
            borderColor: '#cbd5e1',
            background: '#f8fafc',
            color: '#0f172a',
          }}
        >
          <PrinterIcon size={16} />
          <span>طباعة إيصال حراري (80mm)</span>
        </Button>

        <Button
          variant="secondary"
          onClick={onPrintPayslip}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: 600,
            padding: '6px 16px',
            borderColor: '#cbd5e1',
            background: '#f8fafc',
            color: '#0f172a',
          }}
        >
          <PrinterIcon size={16} />
          <span>{isHourly ? 'طباعة قسيمة الأجر (A4)' : 'طباعة قسيمة الراتب (A4)'}</span>
        </Button>
      </div>
    </div>
  );
}
