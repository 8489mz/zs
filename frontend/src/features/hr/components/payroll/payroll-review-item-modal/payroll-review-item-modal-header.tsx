import { FileTextIcon, XIcon } from '@/shared/components/icons/AppIcons';
import { text } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { useTranslation } from 'react-i18next';
import type { HrPayrollRunItem } from '@/types/domain';

export interface PayrollReviewItemModalHeaderProps {
  isHourly: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  item: HrPayrollRunItem;
  periodMonth?: string;
  onClose: () => void;
}

export function PayrollReviewItemModalHeader({ isHourly, t, item, periodMonth, onClose }: PayrollReviewItemModalHeaderProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '14px', marginBottom: '18px' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ width: '3px', height: '16px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <FileTextIcon size={18} color="#170e5e" />
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
            {isHourly ? 'مفردات وتفاصيل الأجر المستحق' : t('hr.payroll.payroll_review_item_modal.s0', "مفردات وتفاصيل الراتب")}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '12.5px', color: '#64748b' }}>
          <span style={{ fontWeight: 700, color: '#1e293b' }}>{text(item.employeeName)}</span>
          <span>•</span>
          <span>{t('hr.payroll.payroll_review_item_modal.s1', "كود:")} {text(item.employeeNo)}</span>
          {periodMonth && (
            <>
              <span>•</span>
              <span>شهر: <strong>{periodMonth}</strong></span>
            </>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#64748b',
          padding: '4px',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={t('common.close', "إغلاق")}
      >
        <XIcon size={18} />
      </button>
    </div>
  );
}
