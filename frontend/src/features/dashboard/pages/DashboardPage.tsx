import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { FormSection } from '@/shared/components/form-section';
import { ErrorState } from '@/shared/ui/error-state';
import { FirstRunSetupChecklist } from '@/shared/system/first-run-setup-checklist';
import { TenantQuickStartChecklist } from '@/shared/system/TenantQuickStartChecklist';
import { SmartDemoOnboardingBanner } from '@/shared/system/SmartDemoOnboardingBanner';
import { useDashboardManagerOverview } from '@/features/dashboard/hooks/useDashboardManagerOverview';
import { useDashboardOverview, clearDashboardCache } from '@/features/dashboard/hooks/useDashboardOverview';
import { useManagerActions } from '@/features/dashboard/hooks/useManagerActions';
import { RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import { DashboardExecutiveHero } from '@/features/dashboard/components/DashboardExecutiveHero';
import { ExecutiveBiGrid } from '@/features/dashboard/components/ExecutiveBiGrid';
import { DashboardDailyBrief } from '@/features/dashboard/components/DashboardDailyBrief';
import { DashboardDailyDecisionGrid } from '@/features/dashboard/components/DashboardDailyDecisionGrid';
import { formatCurrency } from '@/lib/format';
import { useHasFeature, useHasAnyPermission } from '@/shared/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';
import { isPlatformAdmin } from '@/app/router/access';
import {
  buildDashboardAlerts,
  exportDashboardSnapshot,
  printDashboardSnapshot,
} from '@/features/dashboard/lib/dashboard-page.utils';

function DashboardSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="page-stack page-shell dashboard-premium-shell">
      <main className="document-prototype-column" style={{ width: '100%', paddingBottom: '100px' }}>
        <PageHeader
          title={t('dashboard.title', 'لوحة التحكم اليومية')}
          description={t('dashboard.description', 'مؤشرات الأداء المباشرة، القرارات المطلوبة، وحركة المبيعات والخزينة اليومية.')}
          badge={<span className="nav-pill">{t('dashboard.today_summary', 'ملخص اليوم')}</span>}
        />
        {/* Skeleton Executive Hero */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginBottom: '16px',
          }}
        >
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                height: '110px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ height: '14px', width: '45%', background: '#e2e8f0', borderRadius: '4px', opacity: 0.8 }} />
              <div style={{ height: '26px', width: '65%', background: '#f1f5f9', borderRadius: '6px' }} />
              <div style={{ height: '12px', width: '35%', background: '#f8fafc', borderRadius: '4px' }} />
            </div>
          ))}
        </div>
        {/* Skeleton BI Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '16px',
            marginBottom: '16px',
          }}
        >
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: '240px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ height: '16px', width: '30%', background: '#e2e8f0', borderRadius: '4px' }} />
              <div style={{ flex: 1, background: '#f8fafc', borderRadius: '8px' }} />
            </div>
          ))}
        </div>
        {/* Skeleton Decisions & Top products */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '16px',
          }}
        >
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: '220px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ height: '16px', width: '40%', background: '#e2e8f0', borderRadius: '4px' }} />
              <div style={{ flex: 1, background: '#f8fafc', borderRadius: '8px' }} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const isPlatformAdminUser = isPlatformAdmin(user);

  const hasReportsFeature = useHasFeature('reports') || isPlatformAdminUser;
  // F12 (trial problem 15): the decision center and the manager
  // alerts are supervisor surfaces — a rep/cashier holds 'dashboard'
  // but not 'reports', and the cashier default deliberately excludes
  // 'reports'. Without it the secondary queries never fire and the
  // decision grid is not rendered at all (no misleading empty state).
  const canSeeManagerReports = useHasAnyPermission('reports');
  // No dashboard fetch for users who are redirected away below
  // (contracting / maritime pillars, or no reports feature).
  const canLoadDashboard =
    tenant?.activityType !== 'contracting' && tenant?.pillar !== 'contracting' &&
    tenant?.activityType !== 'maritime_freight' && tenant?.pillar !== 'maritime_freight' &&
    hasReportsFeature;
  const overview = useDashboardOverview(canLoadDashboard);
  // Let the first dashboard response render before running secondary report queries.
  const showSecondaryReports = Boolean(overview.data) && canSeeManagerReports;
  const managerActions = useManagerActions(30, showSecondaryReports);
  const managerOverview = useDashboardManagerOverview(showSecondaryReports);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      clearDashboardCache();
      await Promise.allSettled([
        overview.refetch(),
        managerOverview.refetch(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [overview, managerOverview]);

  // Smart Pillar Redirects: Direct Contracting & Maritime tenants to their domain dashboards
  if (tenant?.activityType === 'contracting' || tenant?.pillar === 'contracting') {
    return <Navigate to="/contracting" replace />;
  }

  if (tenant?.activityType === 'maritime_freight' || tenant?.pillar === 'maritime_freight') {
    return <Navigate to="/maritime" replace />;
  }

  if (!hasReportsFeature) {
    return <Navigate to="/pos" replace />;
  }

  if (overview.isLoading && !overview.data) {
    return <DashboardSkeleton />;
  }

  if (overview.isError && !overview.data) {
    return (
      <div className="page-stack page-shell">
        <ErrorState
          title={t('feedback.error_title', 'تعذر تحميل ملخص اليوم')}
          error={overview.error}
          hint={t('common.check_connection', 'تحقق من اتصال النظام ثم أعد المحاولة.')}
          action={(
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleManualRefresh}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
            >
              <RefreshCwIcon size={14} className={isRefreshing ? 'spin-animation' : ''} />
              <span>{t('common.retry', 'إعادة المحاولة')}</span>
            </button>
          )}
          className="status-surface-block"
        />
      </div>
    );
  }

  if (!overview.data || typeof overview.data !== 'object' || !('summary' in overview.data)) {
    return <DashboardSkeleton />;
  }

  const { summary, stats, topToday } = overview.data;
  const smartAlerts = buildDashboardAlerts(overview.data);
  const totalStockAlerts = Number(overview.data.summary.lowStockCount || 0) + Number(overview.data.summary.outOfStockCount || 0);

  return (
    <div className="page-stack page-shell dashboard-premium-shell">
      <main className="document-prototype-column" style={{ width: '100%', paddingBottom: '100px' }}>
        <PageHeader
          title={t('dashboard.title', 'لوحة التحكم اليومية')}
          description={t('dashboard.description', 'مؤشرات الأداء المباشرة، القرارات المطلوبة، وحركة المبيعات والخزينة اليومية.')}
          badge={<span className="nav-pill">{t('dashboard.today_summary', 'ملخص اليوم')}</span>}
          actions={(
            <div className="actions compact-actions dashboard-header-actions" aria-label={t('dashboard.quick_actions', 'إجراءات سريعة')}>
              <button
                type="button"
                className="button button-secondary"
                onClick={handleManualRefresh}
                disabled={isRefreshing || overview.isFetching}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                title={t('common.refresh', 'تحديث')}
              >
                <RefreshCwIcon size={14} className={isRefreshing || overview.isFetching ? 'spin-animation' : ''} />
                <span>{t('common.refresh', 'تحديث')}</span>
              </button>
              <button className="button button-secondary" onClick={() => exportDashboardSnapshot(overview.data)}>{t('common.export', 'تصدير Excel')}</button>
              <button className="button button-secondary" onClick={() => printDashboardSnapshot(overview.data, smartAlerts)}>{t('dashboard.print_summary', 'طباعة الملخص')}</button>
            </div>
          )}
        />

        <FirstRunSetupChecklist />
        <TenantQuickStartChecklist />
        <SmartDemoOnboardingBanner />

        {/* 1. البانر التنفيذي والترحيب الذكي */}
        <DashboardExecutiveHero
          salesTrend={overview.data.trends?.sales}
          purchasesTrend={overview.data.trends?.purchases}
          todaySalesAmount={Number(stats.todaySalesAmount || 0)}
          todaySalesCount={Number(stats.todaySalesCount || 0)}
          treasuryNet={Number(summary.treasury.net || 0)}
          totalStockAlerts={totalStockAlerts}
        />

        {/* 2. لوحات ذكاء الأعمال والرسوم البيانية المتقدمة (Executive BI Charts) */}
        <ExecutiveBiGrid
          overviewData={overview.data}
          managerData={managerOverview.data}
          isLoading={managerOverview.isLoading}
        />

        {/* 3. الهيكل الثنائي المتوازن للداشبورد */}
        <div className="dashboard-balanced-grid">
          
          {/* العمود الرئيسي (الأيمن) */}
          <div className="page-stack" style={{ gap: '16px' }}>
            {/* مركز اتخاذ القرارات التفاعلي — للمشرف فقط (F12) */}
            {canSeeManagerReports && (
              <DashboardDailyDecisionGrid
                data={managerOverview.data}
                topSuppliers={overview.data.topSuppliers}
                totalSupplierDebt={Number(stats.supplierDebt || 0)}
                isLoading={managerOverview.isLoading}
                isError={managerOverview.isError}
                error={managerOverview.error}
              />
            )}

            {/* أعلى الأصناف مبيعاً اليوم */}
            <FormSection title={t('dashboard.top_selling_today', 'أعلى أصناف اليوم مبيعاً')} description={t('dashboard.top_selling_subtitle', 'الأصناف الأكثر طلباً وحركة خلال فواتير اليوم.')} actions={<span className="nav-pill">{t('dashboard.today', 'اليوم')}</span>} className="dashboard-premium-card">
              {topToday.length ? (
                <div
                  className="top-selling-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '8px',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  {topToday.slice(0, 4).map((row, index) => (
                    <div
                      className="list-row top-selling-item"
                      key={row.productId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: '#f8fafc',
                        borderRadius: '8px',
                        border: '1px solid #f1f5f9',
                        minWidth: 0,
                        boxSizing: 'border-box',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '22px',
                            height: '22px',
                            borderRadius: '6px',
                            background: index === 0 ? '#170e5e' : '#e2e8f0',
                            color: index === 0 ? '#ffffff' : '#475569',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {index + 1}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <strong
                            title={row.name}
                            style={{
                              fontSize: '0.82rem',
                              color: '#0f172a',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              lineHeight: 1.35,
                            }}
                          >
                            {row.name}
                          </strong>
                          <div className="muted small" style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            {t('dashboard.sold_today', 'مباع اليوم: {{qty}}', { qty: row.qty })}
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: 'left', flexShrink: 0 }}>
                        <strong style={{ color: '#170e5e', fontSize: '0.88rem', fontWeight: 800, whiteSpace: 'nowrap', display: 'block' }}>
                          {formatCurrency(row.total)}
                        </strong>
                        <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}><CurrencySymbol /></span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '8px', fontSize: '0.84rem' }}>
                  {t('dashboard.no_sales_today', 'لا توجد مبيعات مسجلة اليوم بعد')}
                </div>
              )}
            </FormSection>
          </div>

          {/* العمود الجانبي (الأيسر) */}
          <div className="page-stack" style={{ gap: '16px' }}>
            {/* الموجز التنفيذي والتنبيهات العاجلة */}
            <DashboardDailyBrief
              insights={managerActions.data?.insights || []}
              isLoading={managerActions.isLoading}
            />

            {/* الحسابات المستحقة والمخزون - شبكة ثنائية 2x2 */}
            <FormSection title={t('dashboard.accounts_and_inventory', 'الحسابات والمخزون')} description={t('dashboard.accounts_and_inventory_desc', 'مؤشرات مديونيات العملاء والموردين وقيمة المخزون.')} className="dashboard-premium-card">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
                {/* الصف الأول */}
                <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
                  <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9', boxSizing: 'border-box' }}>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('dashboard.inventory_sale_value', 'قيمة المخزون (بيع)')}</span>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {formatCurrency(Number(stats.inventorySaleValue || 0))}
                    </strong>
                  </div>
                  <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9', boxSizing: 'border-box' }}>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('dashboard.total_products', 'إجمالي الأصناف')}</span>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap' }}>
                      {stats.productsCount || 0} {t('dashboard.items_unit', 'صنف')}
                    </strong>
                  </div>
                </div>

                {/* الصف الثاني */}
                <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
                  <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9', boxSizing: 'border-box' }}>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('dashboard.customer_receivables', 'مستحقات العملاء')}</span>
                    <strong style={{ fontSize: '0.88rem', color: '#b91c1c', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {formatCurrency(Number(stats.customerDebt || 0))}
                    </strong>
                  </div>
                  <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9', boxSizing: 'border-box' }}>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('dashboard.supplier_payables', 'مستحقات الموردين')}</span>
                    <strong style={{ fontSize: '0.88rem', color: '#b91c1c', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {formatCurrency(Number(stats.supplierDebt || 0))}
                    </strong>
                  </div>
                </div>
              </div>
            </FormSection>

            {/* حركة العمليات اليومية - 3 في سطر واحد دائماً */}
            <FormSection title={t('dashboard.financial_movement_today', 'حركة اليوم المالية')} description={t('dashboard.financial_movement_desc', 'المصروفات والمشتريات والمرتجعات المسجلة.')} className="dashboard-premium-card">
              <div
                className="daily-movement-strip keep-grid-row"
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'stretch',
                  gap: '6px',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 4px', background: '#f8fafc', borderRadius: '8px', textAlign: 'center', border: '1px solid #f1f5f9', boxSizing: 'border-box' }}>
                  <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('dashboard.purchase_bills', 'فواتير الشراء')}</span>
                  <strong style={{ fontSize: '0.98rem', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap' }}>{stats.todayPurchasesCount || 0}</strong>
                </div>
                <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 4px', background: '#f8fafc', borderRadius: '8px', textAlign: 'center', border: '1px solid #f1f5f9', boxSizing: 'border-box' }}>
                  <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('dashboard.today_expenses', 'مصروفات اليوم')}</span>
                  <strong style={{ fontSize: '0.98rem', color: '#d97706', fontWeight: 800, whiteSpace: 'nowrap' }}>{formatCurrency(Number(summary.expenses.total || 0))}</strong>
                </div>
                <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 4px', background: '#f8fafc', borderRadius: '8px', textAlign: 'center', border: '1px solid #f1f5f9', boxSizing: 'border-box' }}>
                  <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('dashboard.returns', 'المرتجعات')}</span>
                  <strong style={{ fontSize: '0.98rem', color: '#0f172a', fontWeight: 800, whiteSpace: 'nowrap' }}>{formatCurrency(Number(summary.returns.total || 0))}</strong>
                </div>
              </div>
            </FormSection>
          </div>
        </div>
      </main>
    </div>
  );
}
