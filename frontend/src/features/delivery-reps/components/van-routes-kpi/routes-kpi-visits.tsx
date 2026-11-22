import { useTranslation } from 'react-i18next';
import { NEGATIVE_REASON_LABELS } from './van-routes-kpi-consts';
import type { SupervisorRouteKpiSummary } from '../../api/van-sales.api';

export interface RoutesKpiVisitsProps {
  fieldVisits: any[];
  isVisitsLoading: boolean;
  kpiData: SupervisorRouteKpiSummary | undefined;
}

export function RoutesKpiVisits({
  fieldVisits,
  isVisitsLoading,
  kpiData,
}: RoutesKpiVisitsProps) {
  const { t: __t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Negative Reasons Breakdown Cards */}
      {kpiData?.negativeReasonsBreakdown && (
        <div
          style={{
            background: '#ffffff',
            borderRadius: '12px',
            padding: '14px 18px',
            border: '1px solid #e2e8f0',
          }}
        >
          <h4 style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s50', __t('delivery_reps.van_routes_kpi_admin_tab.s50', "تحليل أسباب عدم الشراء (أسباب الزيارات السلبية):"))}
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
            {Object.entries(kpiData.negativeReasonsBreakdown).map(([reason, count]) => (
              <div
                key={reason}
                style={{
                  background: '#f8fafc',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>
                  {NEGATIVE_REASON_LABELS[reason] || reason}
                </span>
                <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', display: 'block', marginTop: '2px' }}>
                  {count} <span style={{ fontSize: '11px', color: '#94a3b8' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s51', __t('delivery_reps.van_routes_kpi_admin_tab.s51', "زيارة"))}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visits Table */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        {isVisitsLoading ? (
          <div style={{ padding: '50px', textAlign: 'center', color: '#94a3b8' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s52', __t('delivery_reps.van_routes_kpi_admin_tab.s52', "جاري تحميل الزيارات..."))}</div>
        ) : fieldVisits.length === 0 ? (
          <div style={{ padding: '50px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
            {__t('delivery_reps.van_routes_kpi_admin_tab.s53', __t('delivery_reps.van_routes_kpi_admin_tab.s53', "لا توجد زيارات ميدانية مسجلة خلال الفترة المحددة."))}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s54', __t('delivery_reps.van_routes_kpi_admin_tab.s54', "المحل / العميل"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s55', __t('delivery_reps.van_routes_kpi_admin_tab.s55', "خط السير"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s56', __t('delivery_reps.van_routes_kpi_admin_tab.s56', "المندوب"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s57', __t('delivery_reps.van_routes_kpi_admin_tab.s57', "النتيجة"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s58', __t('delivery_reps.van_routes_kpi_admin_tab.s58', "السبب / الفاتورة"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s59', __t('delivery_reps.van_routes_kpi_admin_tab.s59', "النطاق الجغرافي (Geofence)"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s60', __t('delivery_reps.van_routes_kpi_admin_tab.s60', "تاريخ التأجيل"))}</th>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s61', __t('delivery_reps.van_routes_kpi_admin_tab.s61', "توقيت الزيارة"))}</th>
              </tr>
            </thead>
            <tbody>
              {fieldVisits.map((v) => (
                <tr key={v.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{v.customerName}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{v.customerPhone || __t('delivery_reps.van_routes_kpi_admin_tab.s62', __t('delivery_reps.van_routes_kpi_admin_tab.s62', "بدون هاتف"))}</div>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#334155' }}>
                    {v.route || __t('delivery_reps.van_routes_kpi_admin_tab.s63', __t('delivery_reps.van_routes_kpi_admin_tab.s63', "عام"))}
                  </td>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                    {v.repName}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '10px',
                        background: v.visitType === 'positive' ? '#dcfce7' : '#fee2e2',
                        color: v.visitType === 'positive' ? '#15803d' : '#b91c1c',
                      }}
                    >
                      {v.visitType === 'positive' ? __t('delivery_reps.van_routes_kpi_admin_tab.s64', __t('delivery_reps.van_routes_kpi_admin_tab.s64', "إيجابية (تم البيع)")) : __t('delivery_reps.van_routes_kpi_admin_tab.s65', __t('delivery_reps.van_routes_kpi_admin_tab.s65', "سلبية (لم يشترِ)"))}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {v.visitType === 'positive' ? (
                      <span style={{ color: '#15803d', fontWeight: 700 }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s66', __t('delivery_reps.van_routes_kpi_admin_tab.s66', "فاتورة #"))}{v.saleDocNo || __t('delivery_reps.van_routes_kpi_admin_tab.s67', __t('delivery_reps.van_routes_kpi_admin_tab.s67', "مكتملة"))}</span>
                    ) : (
                      <span style={{ color: '#b91c1c' }}>
                        {NEGATIVE_REASON_LABELS[v.negativeReason] || v.negativeReason || __t('delivery_reps.van_routes_kpi_admin_tab.s68', __t('delivery_reps.van_routes_kpi_admin_tab.s68', "بدون سبب"))}
                      </span>
                    )}
                    {v.notes && <div style={{ fontSize: '11px', color: '#64748b' }}>{v.notes}</div>}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '3px', alignItems: 'center' }}>
                      {v.geofenceStatus === 'within_range' ? (
                        <span
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '6px',
                            backgroundColor: '#dcfce7',
                            color: '#15803d',
                            border: '1px solid #bbf7d0',
                          }}
                        >
                          {__t('delivery_reps.van_routes_kpi_admin_tab.s69', __t('delivery_reps.van_routes_kpi_admin_tab.s69', "ضمن النطاق ("))}{v.distanceMeters}{__t('delivery_reps.van_routes_kpi_admin_tab.s70', __t('delivery_reps.van_routes_kpi_admin_tab.s70', "م)"))}
                        </span>
                      ) : v.geofenceStatus === 'out_of_range' ? (
                        <span
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '6px',
                            backgroundColor: '#fee2e2',
                            color: '#b91c1c',
                            border: '1px solid #fecaca',
                          }}
                        >
                          {__t('delivery_reps.van_routes_kpi_admin_tab.s71', __t('delivery_reps.van_routes_kpi_admin_tab.s71', "خارج النطاق ("))}{v.distanceMeters}{__t('delivery_reps.van_routes_kpi_admin_tab.s72', __t('delivery_reps.van_routes_kpi_admin_tab.s72', "م)"))}
                        </span>
                      ) : v.gpsLat && v.gpsLng ? (
                        <span style={{ fontSize: '10px', color: '#64748b' }}>{__t('delivery_reps.van_routes_kpi_admin_tab.s73', __t('delivery_reps.van_routes_kpi_admin_tab.s73', "مسجل GPS (بدون إحداثيات محل)"))}</span>
                      ) : (
                        <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>—</span>
                      )}
                      {v.gpsLat && v.gpsLng && (
                        <a
                          href={`https://www.google.com/maps?q=${v.gpsLat},${v.gpsLng}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: '10.5px', color: '#2563eb', fontWeight: 700, textDecoration: 'none' }}
                        >
                          {__t('delivery_reps.van_routes_kpi_admin_tab.s74', __t('delivery_reps.van_routes_kpi_admin_tab.s74', "فتح موقع المندوب"))}
                        </a>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '11.5px', color: '#475569' }}>
                    {v.postponedToDate ? v.postponedToDate : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '11px', color: '#64748b' }}>
                    {new Date(v.visitedAt).toLocaleDateString('ar-EG', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
