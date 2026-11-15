// Marketplace BI & analytics tab (TAB 9) —
// pure move from SettingsMarketplacesSection.tsx (slice S11). The hook owns
// the analytics period state and the analytics query (enabled only while the
// analytics tab is active); the tab component renders the TAB 9 JSX. The
// facade calls useMarketplaceAnalytics(activeTab) once and passes hook values
// as props. TabKey is not exported by the facade and slices never import the
// facade, so the hook parameter type duplicates the union inline (S2 precedent).
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { marketplaceSyncApi } from '@/features/storefront/api/marketplace-sync.api';
import {
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';

type MarketplaceTabKey = 'onboarding' | 'calculator' | 'studio' | 'inventory' | 'inbound' | 'settlements' | 'orders' | 'analytics' | 'amazon' | 'noon' | 'jumia' | 'trendyol';

export function useMarketplaceAnalytics(activeTab: MarketplaceTabKey) {
  // Analytics State & Query
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'30d' | '7d' | 'all'>('30d');
  const analyticsQuery = useQuery({
    queryKey: ['marketplace-analytics', analyticsPeriod],
    queryFn: () => marketplaceSyncApi.getMarketplaceAnalytics(analyticsPeriod),
    enabled: activeTab === 'analytics',
  });

  return {
    analyticsPeriod,
    setAnalyticsPeriod,
    analyticsQuery,
  };
}

export interface MarketplaceAnalyticsTabProps {
  analytics: ReturnType<typeof useMarketplaceAnalytics>;
}

export const MarketplaceAnalyticsTab: React.FC<MarketplaceAnalyticsTabProps> = ({
  analytics,
}) => {
  const { t } = useTranslation();
  const {
    analyticsPeriod,
    setAnalyticsPeriod,
    analyticsQuery,
  } = analytics;
  return (
    <>
      {/* ========================================================================= */}
      {/* TAB 9: MARKETPLACE BI & ANALYTICS */}
      {/* ========================================================================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header & Period Selectors */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s420', "تحليلات ومؤشرات أداء الماركت بليس (Marketplace BI & Performance Analytics)")}
              </h4>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                {t('settings.workspace_sections.settings_marketplaces_section.s421', "لوحة ذكاء أعمال حية تقارن حجم المبيعات، العمولات، صافي التحصيلات، ونسب المرتجعات عبر كافة المنصات.")}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('7d')}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    background: analyticsPeriod === '7d' ? '#ffffff' : 'transparent',
                    color: analyticsPeriod === '7d' ? '#170e5e' : '#64748b',
                    boxShadow: analyticsPeriod === '7d' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s422', "آخر 7 أيام")}
                </button>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('30d')}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    background: analyticsPeriod === '30d' ? '#ffffff' : 'transparent',
                    color: analyticsPeriod === '30d' ? '#170e5e' : '#64748b',
                    boxShadow: analyticsPeriod === '30d' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s423', "آخر 30 يوماً")}
                </button>
                <button
                  type="button"
                  onClick={() => setAnalyticsPeriod('all')}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: 'none',
                    background: analyticsPeriod === 'all' ? '#ffffff' : 'transparent',
                    color: analyticsPeriod === 'all' ? '#170e5e' : '#64748b',
                    boxShadow: analyticsPeriod === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.workspace_sections.settings_marketplaces_section.s424', "كامل الفترة")}
                </button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => analyticsQuery.refetch()}
                disabled={analyticsQuery.isFetching}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCwIcon size={14} />
                {t('settings.workspace_sections.settings_marketplaces_section.s425', "تحديث")}
              </Button>
            </div>
          </div>

          {analyticsQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_marketplaces_section.s426', "جاري تجميع مؤشرات الأداء من قنوات البيع وقواعد البيانات...")}
            </div>
          ) : analyticsQuery.data ? (
            <>
              {/* Summary 4-KPI Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s427', "إجمالي المبيعات الإجمالية (Gross Sales)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>
                    {analyticsQuery.data.totalGrossSales.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('settings.workspace_sections.settings_marketplaces_section.s428', "ج.م")}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#10b981', marginTop: '6px', fontWeight: 600 }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s429', "عبر")} {analyticsQuery.data.totalOrders} {t('settings.workspace_sections.settings_marketplaces_section.s430', "طلباً مكتمل")}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s431', "صافي التحصيلات البنكية (Net Payout)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a' }}>
                    {analyticsQuery.data.totalNetPayout.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('settings.workspace_sections.settings_marketplaces_section.s432', "ج.م")}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s433', "المبالغ المستحقة للتحويل إلى الحسابات البنكية")}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s434', "رسوم وعمولات المنصات (Fees & Comm.)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#ea580c' }}>
                    {analyticsQuery.data.totalFees.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500 }}>{t('settings.workspace_sections.settings_marketplaces_section.s435', "ج.م")}</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s436', "تمثل")} {analyticsQuery.data.totalGrossSales > 0 ? ((analyticsQuery.data.totalFees / analyticsQuery.data.totalGrossSales) * 100).toFixed(1) : 0}{t('settings.workspace_sections.settings_marketplaces_section.s437', "% من إجمالي المبيعات")}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748b', marginBottom: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s438', "معدل المرتجعات العام (Blended RTO %)")}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: (analyticsQuery.data.marketplaceBreakdown?.[0]?.returnRatePercent ?? 0) > 15 ? '#dc2626' : '#2563eb' }}>
                    {(analyticsQuery.data.marketplaceBreakdown?.[0]?.returnRatePercent ?? 0).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s439', "متوسط نسبة الطلبات الملغاة أو المرتجعة")}
                  </div>
                </div>
              </div>

              {/* Channels Breakdown Section */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s440', "مقارنة الأداء والحصص السوقية بين المنصات (Marketplace Share & P&L)")}
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                  {analyticsQuery.data.marketplaceBreakdown.map((m: any) => {
                    const brandColor =
                      m.marketplace === 'amazon' ? '#f97316' :
                      m.marketplace === 'noon' ? '#eab308' :
                      m.marketplace === 'jumia' ? '#0d9488' : '#8b5cf6';
                    const brandBg =
                      m.marketplace === 'amazon' ? '#fff7ed' :
                      m.marketplace === 'noon' ? '#fefce8' :
                      m.marketplace === 'jumia' ? '#f0fdfa' : '#f5f3ff';
                    const brandName =
                      m.marketplace === 'amazon' ? t('settings.workspace_sections.settings_marketplaces_section.s441', "أمازون (Amazon)") :
                      m.marketplace === 'noon' ? t('settings.workspace_sections.settings_marketplaces_section.s442', "نون (Noon)") :
                      m.marketplace === 'jumia' ? t('settings.workspace_sections.settings_marketplaces_section.s443', "جوميا (Jumia)") : t('settings.workspace_sections.settings_marketplaces_section.s444', "ترينديول (Trendyol)");

                    return (
                      <div
                        key={m.marketplace}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '10px',
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                            {brandName}
                          </span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '12px',
                              background: brandBg,
                              color: brandColor,
                              border: `1px solid ${brandColor}40`,
                            }}
                          >
                            {t('settings.workspace_sections.settings_marketplaces_section.s445', "حصة")} {m.sharePercentage.toFixed(1)}%
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.min(100, m.sharePercentage)}%`,
                              height: '100%',
                              background: brandColor,
                              borderRadius: '3px',
                            }}
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', marginTop: '4px' }}>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s446', "المبيعات الإجمالية")}</span>
                            <span style={{ fontWeight: 700, color: '#0f172a' }}>{m.grossSales.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s447', "ج.م")}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s448', "صافي المستحق")}</span>
                            <span style={{ fontWeight: 700, color: '#16a34a' }}>{m.netPayout.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s449', "ج.م")}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s450', "رسوم المنصة")}</span>
                            <span style={{ fontWeight: 700, color: '#ea580c' }}>{m.marketplaceFees.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s451', "ج.م")}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>{t('settings.workspace_sections.settings_marketplaces_section.s452', "نسبة المرتجع (RTO)")}</span>
                            <span style={{ fontWeight: 700, color: m.returnRate > 15 ? '#dc2626' : '#2563eb' }}>
                              {m.returnRate.toFixed(1)}%
                            </span>
                          </div>
                        </div>

                        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', fontSize: '11.5px', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{t('settings.workspace_sections.settings_marketplaces_section.s453', "عدد الطلبات:")}</span>
                          <span style={{ fontWeight: 700, color: '#0f172a' }}>{m.ordersCount} {t('settings.workspace_sections.settings_marketplaces_section.s454', "طلب")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top Selling Products */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  {t('settings.workspace_sections.settings_marketplaces_section.s455', "الأصناف الأكثر طلباً ومبيعاً عبر المنصات (Top Velocity Products)")}
                </h4>

                {analyticsQuery.data.topSellingProducts.length > 0 ? (
                  <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                      <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <tr>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s456', "الصنف / المنتج")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s457', "كود المنصة (SKU)")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s458', "المنصة")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s459', "الوحدات المباعة")}</th>
                          <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{t('settings.workspace_sections.settings_marketplaces_section.s460', "إجمالي الإيراد")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analyticsQuery.data.topSellingProducts.map((p, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>{p.productName}</td>
                            <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#64748b' }}>{p.sku}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f1f5f9', fontWeight: 700, textTransform: 'uppercase' }}>
                                {p.marketplace}
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: '#16a34a' }}>
                              {p.unitsSold} {t('settings.workspace_sections.settings_marketplaces_section.s461', "قطعة")}
                            </td>
                            <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a' }}>
                              {p.totalRevenue.toLocaleString()} {t('settings.workspace_sections.settings_marketplaces_section.s462', "ج.م")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8', fontSize: '13px' }}>
                    {t('settings.workspace_sections.settings_marketplaces_section.s463', "لم يتم تسجيل طلبات بيع عبر المنصات خلال هذه الفترة حتى الآن.")}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
    </>
  );
};
