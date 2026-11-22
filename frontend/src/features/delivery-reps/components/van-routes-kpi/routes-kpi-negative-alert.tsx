import { useTranslation } from 'react-i18next';
import { NEGATIVE_REASON_LABELS } from './van-routes-kpi-consts';
import { AlertTriangleIcon } from '@/shared/components/icons/AppIcons';

export interface RoutesKpiNegativeAlertProps {
  repeatedNegativeVisits: any[];
}

export function RoutesKpiNegativeAlert({
  repeatedNegativeVisits,
}: RoutesKpiNegativeAlertProps) {
  const { t: __t } = useTranslation();
  return (
    <div
      style={{
        background: '#fff1f2',
        border: '1px solid #fecdd3',
        borderRadius: '12px',
        padding: '14px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <AlertTriangleIcon size={18} color="#e11d48" />
        <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 800, color: '#9f1239' }}>
          {__t('delivery_reps.van_routes_kpi_admin_tab.s20', __t('delivery_reps.van_routes_kpi_admin_tab.s20', "تنبيه رقابي: محلات ومتاجر تكررت زياراتها السلبية (3 مرات فأكثر) دون شراء"))}
        </h4>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#be123c', lineHeight: 1.5 }}>
        {__t('delivery_reps.van_routes_kpi_admin_tab.s21', __t('delivery_reps.van_routes_kpi_admin_tab.s21', "وفقاً لسياسة التوزيع المؤسسية، المحل الذي يتم رفض الشراء منه 3 مرات متتالية يتم إخطار المشرف لإعادة دراسة الائتمان، فحص مسار الخط، أو التفاوض مع التاجر."))}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {repeatedNegativeVisits.slice(0, 5).map((v, i) => (
          <div
            key={i}
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              padding: '8px 12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
              border: '1px solid #ffe4e6',
            }}
          >
            <div>
              <strong style={{ color: '#0f172a' }}>{v.customerName}</strong>
              <span style={{ color: '#64748b', marginRight: '8px' }}>({v.customerPhone || __t('delivery_reps.van_routes_kpi_admin_tab.s22', __t('delivery_reps.van_routes_kpi_admin_tab.s22', "بدون هاتف"))})</span>
              <span style={{ color: '#94a3b8', marginRight: '8px' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s23', __t('delivery_reps.van_routes_kpi_admin_tab.s23', "خط:"))} {v.route || __t('delivery_reps.van_routes_kpi_admin_tab.s24', __t('delivery_reps.van_routes_kpi_admin_tab.s24', "عام"))}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#e11d48', fontWeight: 700 }}>{v.consecutiveNegativeCount} {__t('delivery_reps.van_routes_kpi_admin_tab.s25', __t('delivery_reps.van_routes_kpi_admin_tab.s25', "زيارات سلبية"))}</span>
              <span style={{ background: '#fef2f2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}>
                {__t('delivery_reps.van_routes_kpi_admin_tab.s26', __t('delivery_reps.van_routes_kpi_admin_tab.s26', "آخر سبب:"))} {NEGATIVE_REASON_LABELS[v.negativeReason] || v.negativeReason || __t('delivery_reps.van_routes_kpi_admin_tab.s27', __t('delivery_reps.van_routes_kpi_admin_tab.s27', "محل مغلق"))}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
