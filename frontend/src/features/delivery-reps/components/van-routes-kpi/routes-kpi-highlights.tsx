import { useTranslation } from 'react-i18next';
import type { SupervisorRouteKpiSummary } from '../../api/van-sales.api';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';

export interface RoutesKpiHighlightsProps {
  kpiData: SupervisorRouteKpiSummary | undefined;
}

export function RoutesKpiHighlights({
  kpiData,
}: RoutesKpiHighlightsProps) {
  const { t: __t } = useTranslation();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: '12px' }}>
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '14px 16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748b', display: 'block' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s6', __t('delivery_reps.van_routes_kpi_admin_tab.s6', "إجمالي الزيارات الميدانية"))}</span>
        <span style={{ fontSize: '22px', fontWeight: 900, color: '#0f172a', display: 'block', marginTop: '4px' }}>
          {kpiData?.totalVisits ?? 0}
        </span>
        <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '2px', fontWeight: 600 }}>
          {kpiData?.positiveVisits ?? 0} {__t('delivery_reps.van_routes_kpi_admin_tab.s7', __t('delivery_reps.van_routes_kpi_admin_tab.s7', "ناجحة •"))} {kpiData?.negativeVisits ?? 0} {__t('delivery_reps.van_routes_kpi_admin_tab.s8', __t('delivery_reps.van_routes_kpi_admin_tab.s8', "سلبية"))}
        </div>
      </div>

      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '14px 16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#16a34a', display: 'block' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s9', __t('delivery_reps.van_routes_kpi_admin_tab.s9', "نسبة الضربات الناجحة (Strike Rate)"))}</span>
        <span style={{ fontSize: '22px', fontWeight: 900, color: '#15803d', display: 'block', marginTop: '4px' }}>
          {kpiData?.strikeRate ?? 0}%
        </span>
        <span style={{ fontSize: '11px', color: '#64748b' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s10', __t('delivery_reps.van_routes_kpi_admin_tab.s10', "نسبة تحويل الزيارة إلى فاتورة بيع فعلية"))}</span>
      </div>

      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '14px 16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#4338ca', display: 'block' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s11', __t('delivery_reps.van_routes_kpi_admin_tab.s11', "الالتزام بالنطاق الجغرافي (Geofence)"))}</span>
        <span style={{ fontSize: '22px', fontWeight: 900, color: '#170e5e', display: 'block', marginTop: '4px' }}>
          {kpiData?.geofenceComplianceRate ?? 100}%
        </span>
        <span style={{ fontSize: '11px', color: '#64748b' }}>
          {__t('delivery_reps.van_routes_kpi_admin_tab.s12', __t('delivery_reps.van_routes_kpi_admin_tab.s12', "ضمن 300م:"))} {kpiData?.withinGeofenceCount ?? 0} {__t('delivery_reps.van_routes_kpi_admin_tab.s13', __t('delivery_reps.van_routes_kpi_admin_tab.s13', "• خارج النطاق:"))} {kpiData?.outOfGeofenceCount ?? 0}
        </span>
      </div>

      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '14px 16px',
          border: (kpiData?.repeatedNegativeCustomersCount ?? 0) > 0 ? '1px solid #fecaca' : '1px solid #e2e8f0',
          backgroundColor: (kpiData?.repeatedNegativeCustomersCount ?? 0) > 0 ? '#fffdfd' : '#ffffff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#dc2626', display: 'block' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s14', __t('delivery_reps.van_routes_kpi_admin_tab.s14', "محلات سلبية متكررة (3+)"))}</span>
        <span style={{ fontSize: '22px', fontWeight: 900, color: '#b91c1c', display: 'block', marginTop: '4px' }}>
          {kpiData?.repeatedNegativeCustomersCount ?? 0}
        </span>
        <span style={{ fontSize: '11px', color: '#b91c1c' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s15', __t('delivery_reps.van_routes_kpi_admin_tab.s15', "محلات تتطلب تدخل المشرف فوراً"))}</span>
      </div>

      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '14px 16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#0284c7', display: 'block' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s16', __t('delivery_reps.van_routes_kpi_admin_tab.s16', "استهلاك ومعدل وقود الأسطول"))}</span>
        <span style={{ fontSize: '22px', fontWeight: 900, color: '#0369a1', display: 'block', marginTop: '4px' }}>
          {kpiData?.totalFuelLiters ?? 0} <span style={{ fontSize: '13px', fontWeight: 600 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s17', __t('delivery_reps.van_routes_kpi_admin_tab.s17', "لتر"))}</span>
        </span>
        <span style={{ fontSize: '11px', color: '#64748b' }}>
          {__t('delivery_reps.van_routes_kpi_admin_tab.s18', __t('delivery_reps.van_routes_kpi_admin_tab.s18', "معدل الاستهلاك:"))} {kpiData?.avgConsumptionRate ?? 0} {__t('delivery_reps.van_routes_kpi_admin_tab.s19', __t('delivery_reps.van_routes_kpi_admin_tab.s19', "كم/لتر ("))}{kpiData?.totalFuelCost ?? 0} <CurrencySymbol />)
        </span>
      </div>
    </div>
  );
}
