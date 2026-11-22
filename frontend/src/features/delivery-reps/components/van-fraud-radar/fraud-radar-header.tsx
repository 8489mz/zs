import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import {
  CheckShieldIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';

export interface FraudRadarHeaderProps {
  isFetching: boolean;
  refetch: () => void;
}

export function FraudRadarHeader({
  isFetching,
  refetch,
}: FraudRadarHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <CheckShieldIcon size={22} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '3px',
                height: '14px',
                backgroundColor: '#170e5e',
                borderRadius: '2px',
                display: 'inline-block',
              }}
            />
            <h3 style={{ margin: 0, fontSize: '15.6px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.van_fraud_radar_admin_tab.s0', "رادار الشبهات ومكافحة التلاعب الميداني (Van Anti-Theft & Fraud Radar)")}
            </h3>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
            {t('delivery_reps.van_fraud_radar_admin_tab.s1', "رصد لحظي لكافة محاولات التلاعب المصدودة (الأسعار، البونص، التحصيل المتقاطع، المرتجعات الوهمية، العداد، والـ GPS) مع إشعار فوري لصاحب المنشأة والمشرف.")}
          </p>
        </div>
      </div>

      <Button
        variant="secondary"
        disabled={isFetching}
        onClick={() => refetch()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '12.5px',
          fontWeight: 700,
          padding: '7px 14px',
        }}
      >
        <RefreshCwIcon size={14} />
        {isFetching ? t('delivery_reps.van_fraud_radar_admin_tab.s2', "جارٍ الفحص...") : t('delivery_reps.van_fraud_radar_admin_tab.s3', "تحديث الرادار الآن")}
      </Button>
    </div>
  );
}
