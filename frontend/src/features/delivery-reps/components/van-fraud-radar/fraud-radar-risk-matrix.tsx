import { useTranslation } from 'react-i18next';
import type { VanRepRiskProfile } from '../../api/van-sales.api';
import { formatMoney } from './van-fraud-radar-helpers';
import {
  UsersIcon,
} from '@/shared/components/icons/AppIcons';

export interface FraudRadarRiskMatrixProps {
  filteredProfiles: VanRepRiskProfile[];
  isLoading: boolean;
}

export function FraudRadarRiskMatrix({
  filteredProfiles,
  isLoading,
}: FraudRadarRiskMatrixProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <UsersIcon size={16} color="#170e5e" />
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.van_fraud_radar_admin_tab.s20', "مصفوفة تقييم المخاطر والانضباط لمناديب التوزيع")}
          </h4>
        </div>
        <span
          style={{
            fontSize: '11.5px',
            fontWeight: 700,
            color: '#475569',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            padding: '3px 10px',
            borderRadius: '20px',
          }}
        >
          {t('delivery_reps.van_fraud_radar_admin_tab.s21', "إجمالي المناديب:")} {filteredProfiles.length}
        </span>
      </div>

      <div
        style={{
          width: '100%',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {isLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
            {t('delivery_reps.van_fraud_radar_admin_tab.s22', "جارٍ تحليل سجلات الرقابة الميدانية...")}
          </div>
        ) : filteredProfiles.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>
            {t('delivery_reps.van_fraud_radar_admin_tab.s23', "لا توجد بيانات مطابقة لمعايير البحث.")}
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              minWidth: '980px',
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
              textAlign: 'right',
              fontSize: '12px',
            }}
          >
            <colgroup>
              <col style={{ width: '14%' }} /> {/* المندوب */}
              <col style={{ width: '12%' }} /> {/* مؤشر المخاطرة */}
              <col style={{ width: '7%' }} />  {/* إجمالي الشبهات */}
              <col style={{ width: '9%' }} />  {/* تلاعب أسعار/بونص */}
              <col style={{ width: '9%' }} />  {/* تحصيل مشترك/ائتمان */}
              <col style={{ width: '9%' }} />  {/* مرتجعات/كارت وهمي */}
              <col style={{ width: '9%' }} />  {/* مصروفات/عداد/GPS */}
              <col style={{ width: '7%' }} />  {/* عجز تصفية */}
              <col style={{ width: '10%' }} /> {/* المبلغ محل الشبهة */}
              <col style={{ width: '14%' }} /> {/* أبرز المؤشرات الرقابية */}
            </colgroup>
            <thead>
              <tr
                style={{
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  color: '#475569',
                  fontSize: '11.5px',
                  fontWeight: 700,
                }}
              >
                <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s24', "المندوب")}</th>
                <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s25', "مؤشر المخاطرة")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s26', "إجمالي الشبهات")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s27', "تلاعب أسعار/بونص")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s28', "تحصيل مشترك/ائتمان")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s29', "مرتجعات/كارت وهمي")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s30', "مصروفات/عداد/GPS")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s31', "عجز تصفية")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s32', "المبلغ محل الشبهة")}</th>
                <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s33', "أبرز المؤشرات الرقابية")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((p: VanRepRiskProfile) => {
                const isHigh = p.riskLevel === 'high_risk';
                const isWatch = p.riskLevel === 'watch';
                const badgeBg = isHigh ? '#fef2f2' : isWatch ? '#fffbeb' : '#ecfdf5';
                const badgeBorder = isHigh ? '#fecaca' : isWatch ? '#fde68a' : '#a7f3d0';
                const badgeColor = isHigh ? '#dc2626' : isWatch ? '#b45309' : '#047857';
                const badgeLabel = isHigh
                  ? `خطر مرتفع (${p.riskScore}/100)`
                  : isWatch
                  ? `تحت المراقبة (${p.riskScore}/100)`
                  : `منضبط (${p.riskScore}/100)`;

                return (
                  <tr
                    key={p.repId}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      background: isHigh ? '#fffafa' : '#ffffff',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isHigh) e.currentTarget.style.backgroundColor = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      if (!isHigh) e.currentTarget.style.backgroundColor = '#ffffff';
                    }}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '12.5px' }}>{p.repName}</div>
                      <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                        {p.phone || '—'}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          background: badgeBg,
                          border: `1px solid ${badgeBorder}`,
                          color: badgeColor,
                        }}
                      >
                        {badgeLabel}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 800, color: p.totalSuspicionEvents > 0 ? '#dc2626' : '#64748b' }}>
                      {p.totalSuspicionEvents}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>
                      {p.priceManipulationCount + p.unauthorizedBonusCount || '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>
                      {p.crossRepCollectionCount + p.creditBypassCount || '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>
                      {p.fraudulentReturnCount + p.fakeCardCount || '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>
                      {p.expenseAbuseCount + p.odometerRollbackCount + p.geofenceViolationCount + p.selfApprovalCount + p.invalidPinCount + p.unauthorizedLoadOrSettleCount || '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: p.settlementShortageCount > 0 ? '#b45309' : '#64748b' }}>
                      {p.settlementShortageCount || '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {p.totalAmountAtRisk > 0 ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'baseline',
                            gap: '3px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                          }}
                        >
                          <span style={{ fontSize: '12px', fontWeight: 800, color: '#dc2626', fontFamily: 'monospace' }}>
                            {formatMoney(p.totalAmountAtRisk)}
                          </span>
                          <span style={{ fontSize: '9px', fontWeight: 700, color: '#991b1b' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s34', "ج.م")}</span>
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontWeight: 600 }}>0.00</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {p.flags.length === 0 ? (
                        <span style={{ fontSize: '11px', color: '#059669', fontWeight: 600 }}>
                          {t('delivery_reps.van_fraud_radar_admin_tab.s35', "سجل نظيف ومطابق للحوكمة")}
                        </span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {p.flags.map((flag, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: '10.5px',
                                fontWeight: 600,
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: '#fef2f2',
                                color: '#991b1b',
                                border: '1px solid #fecaca',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {flag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
