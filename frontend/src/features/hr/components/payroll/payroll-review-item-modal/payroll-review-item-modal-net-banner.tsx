import { Button } from '@/shared/ui/button';
import { money, normalize } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { HrPayrollRunItem } from '@/types/domain';

export interface PayrollReviewItemModalNetBannerProps {
  isHourly: boolean;
  canViewSalaryAmounts: boolean;
  netPay: number;
  item: HrPayrollRunItem;
  onPayItem?: (item: HrPayrollRunItem) => void;
  canApprovePayroll: boolean;
}

export function PayrollReviewItemModalNetBanner({ isHourly, canViewSalaryAmounts, netPay, item, onPayItem, canApprovePayroll }: PayrollReviewItemModalNetBannerProps) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #170e5e 0%, #1e1b4b 100%)',
      color: '#ffffff',
      borderRadius: '10px',
      padding: '12px 20px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '16px',
      boxShadow: '0 2px 4px rgba(23, 14, 94, 0.12)',
      flexWrap: 'wrap',
      gap: '12px',
    }}>
      <div>
        <div style={{ fontSize: '13px', fontWeight: 700, opacity: 0.9 }}>
          {isHourly ? 'صافي الأجر المستحق للصرف:' : 'صافي الراتب المستحق للصرف:'}
        </div>
        <div style={{ fontSize: '11px', opacity: 0.75 }}>بعد احتساب الاستحقاقات وكافة الجزاءات والاستقطاعات</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px' }}>
          {canViewSalaryAmounts ? money(netPay) : '—'}
        </div>
        {normalize(item.status) === 'paid' ? (
          <span
            style={{
              background: 'rgba(34, 197, 94, 0.25)',
              border: '1px solid #4ade80',
              color: '#bbf7d0',
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
            تم الصرف (مدفوع)
          </span>
        ) : normalize(item.status) === 'approved' && onPayItem && canApprovePayroll ? (
          <Button
            variant="primary"
            onClick={() => onPayItem(item)}
            style={{
              background: '#16a34a',
              borderColor: '#15803d',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '12.5px',
              padding: '6px 14px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
              whiteSpace: 'nowrap',
            }}
          >
            صرف الراتب الآن
          </Button>
        ) : null}
      </div>
    </div>
  );
}
