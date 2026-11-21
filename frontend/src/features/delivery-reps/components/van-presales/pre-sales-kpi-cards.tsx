import { useTranslation } from 'react-i18next';
import {
  CheckCircleIcon,
  XIcon,
  ClockIcon,
  DollarSignIcon,
} from '@/shared/components/icons/AppIcons';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';

export interface PreSalesKpiCardsProps {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalAmount: number;
}

export function PreSalesKpiCards({
  pendingCount,
  approvedCount,
  rejectedCount,
  totalAmount,
}: PreSalesKpiCardsProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '10px',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '12px 14px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            backgroundColor: '#fef3c7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ClockIcon size={20} color="#b45309" />
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('delivery_reps.van_pre_sales_admin_tab.s4', "بانتظار الاعتماد")}</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#b45309' }}>{pendingCount}</div>
        </div>
      </div>

      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '12px 14px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            backgroundColor: '#dcfce7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CheckCircleIcon size={20} color="#15803d" />
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('delivery_reps.van_pre_sales_admin_tab.s5', "معتمدة")}</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#15803d' }}>{approvedCount}</div>
        </div>
      </div>

      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '12px 14px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            backgroundColor: '#fee2e2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <XIcon size={20} color="#b91c1c" />
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('delivery_reps.van_pre_sales_admin_tab.s6', "مرفوضة / محررة")}</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#b91c1c' }}>{rejectedCount}</div>
        </div>
      </div>

      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '12px 14px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            backgroundColor: '#e0e7ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <DollarSignIcon size={20} color="#4338ca" />
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('delivery_reps.van_pre_sales_admin_tab.s7', "إجمالي قيمة الطلبيات")}</div>
          <div style={{ fontSize: '17px', fontWeight: 800, color: '#170e5e' }}>
            {totalAmount.toFixed(2)} <CurrencySymbol />
          </div>
        </div>
      </div>
    </div>
  );
}
