import { useTranslation } from 'react-i18next';

export interface RequisitionsKpiCardsProps {
  pendingCount: number;
  dispatchedCount: number;
  rejectedCount: number;
  totalCount: number;
}

export function RequisitionsKpiCards({ pendingCount, dispatchedCount, rejectedCount, totalCount }: RequisitionsKpiCardsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#d97706', display: 'block' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s0', "طلبات قيد المراجعة والصرف")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#b45309', display: 'block', marginTop: '4px' }}>
            {pendingCount} <span style={{ fontSize: '13px', color: '#f59e0b' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s1', "طلب تحميل")}</span>
          </span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#16a34a', display: 'block' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s2', "طلبات تم صرفها وبدء رحلتها")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', display: 'block', marginTop: '4px' }}>
            {dispatchedCount} <span style={{ fontSize: '13px', color: '#86efac' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s3', "رحلة منطلقة")}</span>
          </span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#dc2626', display: 'block' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s4', "طلبات تحميل مرفوضة")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#991b1b', display: 'block', marginTop: '4px' }}>
            {rejectedCount} <span style={{ fontSize: '13px', color: '#f87171' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s5', "طلب")}</span>
          </span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca', display: 'block' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s6', "إجمالي أذونات التحميل المسجلة")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#312e81', display: 'block', marginTop: '4px' }}>
            {totalCount} <span style={{ fontSize: '13px', color: '#a5b4fc' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s7', "إذن")}</span>
          </span>
        </div>
      </div>
    </>
  );
}
