import { useTranslation } from 'react-i18next';
import type { VanFraudRadarEvent } from '../../api/van-sales.api';
import { formatMoney, formatEventDateTime, getEventCodeMeta } from './van-fraud-radar-helpers';
import {
  AlertTriangleIcon,
  CheckShieldIcon,
  ClockIcon,
  UsersIcon,
} from '@/shared/components/icons/AppIcons';

export interface FraudRadarEventsFeedProps {
  filteredEvents: VanFraudRadarEvent[];
  isLoading: boolean;
}

export function FraudRadarEventsFeed({
  filteredEvents,
  isLoading,
}: FraudRadarEventsFeedProps) {
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
          <ClockIcon size={16} color="#dc2626" />
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.van_fraud_radar_admin_tab.s36', "السجل الزمني التفصيلي للوقائع ومحاولات التلاعب المصدودة")}
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
          {t('delivery_reps.van_fraud_radar_admin_tab.s37', "عدد الوقائع المسجلة:")} {filteredEvents.length}
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
            {t('delivery_reps.van_fraud_radar_admin_tab.s38', "جارٍ تحميل السجل الزمني للشبهات...")}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: '#64748b' }}>
            <CheckShieldIcon size={32} color="#10b981" />
            <div style={{ fontWeight: 800, fontSize: '14px', color: '#0f172a', marginTop: '8px' }}>
              {t('delivery_reps.van_fraud_radar_admin_tab.s39', "لا توجد أي محاولات تلاعب أو شبهات مسجلة في هذه الفترة")}
            </div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              {t('delivery_reps.van_fraud_radar_admin_tab.s40', "جميع عمليات البيع والتحصيل والمرتجعات الميدانية تسير وفق الضوابط المعتمدة.")}
            </div>
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
              <col style={{ width: '12%' }} /> {/* 1. التوقيت */}
              <col style={{ width: '12%' }} /> {/* 2. المندوب */}
              <col style={{ width: '9%' }} />  {/* 3. الخطورة */}
              <col style={{ width: '17%' }} /> {/* 4. نوع المخالفة */}
              <col style={{ width: '29%' }} /> {/* 5. التفاصيل الكاملة */}
              <col style={{ width: '11%' }} /> {/* 6. العميل / الرحلة */}
              <col style={{ width: '10%' }} /> {/* 7. القيمة المالية */}
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
                <th style={{ padding: '8px 10px' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s41', "التوقيت")}</th>
                <th style={{ padding: '8px 10px' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s42', "المندوب")}</th>
                <th style={{ padding: '8px 6px', textAlign: 'center' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s43', "الخطورة")}</th>
                <th style={{ padding: '8px 10px' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s44', "نوع المخالفة المرصودة")}</th>
                <th style={{ padding: '8px 10px' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s45', "التفاصيل الكاملة للواقعة")}</th>
                <th style={{ padding: '8px 10px' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s46', "العميل / الرحلة")}</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s47', "القيمة المالية")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((ev: VanFraudRadarEvent) => {
                const isCrit = ev.severity === 'critical';
                const isHigh = ev.severity === 'high';
                const dt = formatEventDateTime(ev.createdAt);
                const meta = getEventCodeMeta(ev.eventCode);

                return (
                  <tr
                    key={ev.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {/* 1. التوقيت */}
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '11.5px', whiteSpace: 'nowrap' }}>
                        {dt.date}
                      </div>
                      {dt.time && (
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#64748b',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            marginTop: '2px',
                            fontFamily: 'monospace',
                            direction: 'ltr',
                          }}
                        >
                          <span>{dt.time}</span>
                          <ClockIcon size={10} color="#94a3b8" />
                        </div>
                      )}
                    </td>

                    {/* 2. المندوب */}
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle' }}>
                      <div
                        style={{
                          fontWeight: 800,
                          color: '#0f172a',
                          fontSize: '12px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={ev.repName}
                      >
                        {ev.repName}
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                        {t('delivery_reps.van_fraud_radar_admin_tab.s48', "مندوب فان #")}{ev.repId}
                      </div>
                    </td>

                    {/* 3. الخطورة */}
                    <td style={{ padding: '8px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          padding: '2px 6px',
                          borderRadius: '5px',
                          fontSize: '10.5px',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          background: isCrit ? '#fef2f2' : isHigh ? '#fff7ed' : '#fefce8',
                          color: isCrit ? '#dc2626' : isHigh ? '#c2410c' : '#a16207',
                          border: `1px solid ${isCrit ? '#fecaca' : isHigh ? '#fed7aa' : '#fef08a'}`,
                        }}
                      >
                        <AlertTriangleIcon size={11} />
                        {isCrit ? t('delivery_reps.van_fraud_radar_admin_tab.s49', "حرجة جداً") : isHigh ? t('delivery_reps.van_fraud_radar_admin_tab.s50', "خطورة عالية") : t('delivery_reps.van_fraud_radar_admin_tab.s51', "متوسطة")}
                      </span>
                    </td>

                    {/* 4. نوع المخالفة المرصودة */}
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <span
                          style={{
                            alignSelf: 'flex-start',
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: meta.bg,
                            color: meta.color,
                            border: `1px solid ${meta.border}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {meta.label}
                        </span>
                        <div
                          style={{
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: '#0f172a',
                            lineHeight: 1.35,
                            wordBreak: 'break-word',
                            whiteSpace: 'normal',
                          }}
                        >
                          {ev.titleAr}
                        </div>
                      </div>
                    </td>

                    {/* 5. التفاصيل الكاملة للواقعة */}
                    <td
                      style={{
                        padding: '8px 10px',
                        color: '#334155',
                        fontSize: '11px',
                        lineHeight: 1.5,
                        textAlign: 'justify',
                        textJustify: 'inter-word',
                        textAlignLast: 'start',
                        wordBreak: 'break-word',
                        whiteSpace: 'normal',
                        overflowWrap: 'break-word',
                        verticalAlign: 'middle',
                      }}
                    >
                      {ev.detailsAr}
                    </td>

                    {/* 6. العميل / الرحلة */}
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '100%' }}>
                        {ev.customerName ? (
                          <div
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              color: '#1e293b',
                              lineHeight: 1.25,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              overflow: 'hidden',
                            }}
                            title={ev.customerName}
                          >
                            <UsersIcon size={11} color="#64748b" style={{ flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ev.customerName}
                            </span>
                          </div>
                        ) : null}
                        {ev.tripId ? (
                          <span
                            style={{
                              alignSelf: 'flex-start',
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: '#f1f5f9',
                              color: '#475569',
                              border: '1px solid #e2e8f0',
                              fontFamily: 'monospace',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t('delivery_reps.van_fraud_radar_admin_tab.s52', "رحلة #")}{ev.tripId}
                          </span>
                        ) : null}
                        {!ev.customerName && !ev.tripId ? (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        ) : null}
                      </div>
                    </td>

                    {/* 7. القيمة المالية */}
                    <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      {ev.amountInvolved > 0 ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'baseline',
                            gap: '2px',
                            padding: '2px 7px',
                            borderRadius: '5px',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                          }}
                        >
                          <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#dc2626', fontFamily: 'monospace' }}>
                            {formatMoney(ev.amountInvolved)}
                          </span>
                          <span style={{ fontSize: '9px', fontWeight: 700, color: '#991b1b' }}>{t('delivery_reps.van_fraud_radar_admin_tab.s53', "ج.م")}</span>
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontWeight: 600 }}>—</span>
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
