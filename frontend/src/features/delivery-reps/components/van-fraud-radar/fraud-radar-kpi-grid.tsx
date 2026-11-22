import { useTranslation } from 'react-i18next';
import { formatMoney } from './van-fraud-radar-helpers';
import type { VanFraudRadarSummaryResponse } from '../../api/van-sales.api';

export interface FraudRadarKpiGridProps {
  isLoading: boolean;
  kpis: VanFraudRadarSummaryResponse['kpis'] | undefined;
}

export function FraudRadarKpiGrid({
  isLoading,
  kpis,
}: FraudRadarKpiGridProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '12px',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s4', "محاولات التلاعب المصدودة آلياً")}
        </div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: '#dc2626' }}>
          {isLoading ? '—' : kpis?.blockedTamperAttemptsCount ?? 0}
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s5', "تم إحباطها ومنع تأثيرها المالي فوراً")}
        </div>
      </div>

      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s6', "مناديب في دائرة الخطر العالي")}
        </div>
        <div
          style={{
            fontSize: '22px',
            fontWeight: 800,
            color: (kpis?.highRiskRepsCount || 0) > 0 ? '#b91c1c' : '#0f172a',
          }}
        >
          {isLoading ? '—' : kpis?.highRiskRepsCount ?? 0}
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginRight: '6px' }}>
            {t('delivery_reps.van_fraud_radar_admin_tab.s7', "من أصل")} {isLoading ? '—' : kpis?.totalRepsMonitored ?? 0} {t('delivery_reps.van_fraud_radar_admin_tab.s8', "مندوب")}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s9', "تحت المراقبة المتوسطة:")} {isLoading ? '—' : kpis?.watchRepsCount ?? 0}
        </div>
      </div>

      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s10', "وقائع عجز التصفية (نقدية / بضاعة)")}
        </div>
        <div
          style={{
            fontSize: '22px',
            fontWeight: 800,
            color: (kpis?.settlementShortageEventsCount || 0) > 0 ? '#d97706' : '#0f172a',
          }}
        >
          {isLoading ? '—' : kpis?.settlementShortageEventsCount ?? 0}
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s11', "تم قيدها محاسبياً على ذمة المناديب")}
        </div>
      </div>

      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 16px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s12', "إجمالي المبالغ محل الشبهة أو العجز")}
        </div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: '#170e5e' }}>
          {isLoading ? '—' : `${formatMoney(kpis?.totalAmountAtRisk || 0)} ج.م`}
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_fraud_radar_admin_tab.s13', "شبهات حرجة:")} {isLoading ? '—' : kpis?.criticalEventsCount ?? 0} {t('delivery_reps.van_fraud_radar_admin_tab.s14', "واقعة")}
        </div>
      </div>
    </div>
  );
}
