import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import {Navigate, Link} from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/features/dashboard/api/dashboard.api';
import { cashDrawerApi } from '@/lib/api/cash-drawer';
import { formatCurrency, todayLocalDateKey } from '@/lib/format';
import { SmartphoneIcon, ShoppingCartIcon, BarChartIcon, FileTextIcon, RefreshCwIcon, AlertTriangleIcon } from '@/shared/components/icons/AppIcons';
import { useHasAnyPermission, useHasFeature } from '@/shared/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';
import { findWorkspaceFallbackRoute, isPlatformAdmin } from '@/app/router/access';
import { navigationItems } from '@/app/router/registry';

type TimeRange = 'today' | 'yesterday' | 'week' | 'month';

function getRangeDates(range: TimeRange) {
  const now = new Date();
  const to = todayLocalDateKey(now);
  let from = to;

  if (range === 'yesterday') {
    const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    from = todayLocalDateKey(y);
    return { from, to: from };
  } else if (range === 'week') {
    const w = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    from = todayLocalDateKey(w);
  } else if (range === 'month') {
    from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }

  return { from, to };
}

export function OwnerMobileDashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const isPlatformAdminUser = isPlatformAdmin(user);
  const hasReportsFeature = useHasFeature('reports') || isPlatformAdminUser;
  const canViewReports = useHasAnyPermission('reports') || isPlatformAdminUser;

  const [range, setRange] = useState<TimeRange>('today');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const { from, to } = useMemo(() => getRangeDates(range), [range]);

  const overviewQuery = useQuery({
    queryKey: ['owner-mobile-overview', from, to],
    queryFn: async () => {
      const res = await dashboardApi.overview(from, to);
      setLastRefreshedAt(new Date());
      return res;
    },
    refetchInterval: 30000, // Live auto-poll every 30s
    enabled: hasReportsFeature && canViewReports,
  });

  const shiftsQuery = useQuery({
    queryKey: ['owner-mobile-open-shifts'],
    queryFn: async () => {
      const res = await cashDrawerApi.listPage({ filter: 'open' });
      return res.rows || [];
    },
    refetchInterval: 30000,
    enabled: hasReportsFeature && canViewReports,
  });

  const overview = overviewQuery.data;
  const openShifts = shiftsQuery.data || [];

  // Calculate live cash in drawers
  const totalOpenCash = useMemo(() => {
    return openShifts.reduce((sum, shift) => {
      const expected = Number((shift as any).expectedCash || (shift as any).opening_balance || 0);
      return sum + expected;
    }, 0);
  }, [openShifts]);

  if (!hasReportsFeature || !canViewReports) {
    return <Navigate to={findWorkspaceFallbackRoute(user, navigationItems) || '/pos'} replace />;
  }

  const overviewData = overview as any;
  const netSales = Number(overviewData?.profitSummary?.netSales || overviewData?.moneyInsight?.total || 0);
  const netProfit = Number(overviewData?.profitSummary?.netProfit || 0);
  const invoiceCount = Number(overviewData?.moneyInsight?.count || 0);
  const avgBasket = Number(overviewData?.moneyInsight?.averageInvoice || (invoiceCount > 0 ? netSales / invoiceCount : 0));
  const topProducts: any[] = overviewData?.topProducts?.slice(0, 5) || [];
  const recentSales: any[] = overviewData?.recentSales?.slice(0, 6) || [];
  const lowStock: any[] = overviewData?.lowStockProducts?.slice(0, 4) || [];

  const handleManualRefresh = () => {
    void overviewQuery.refetch();
    void shiftsQuery.refetch();
  };

  return (
    <div style={{
      maxWidth: '560px',
      margin: '0 auto',
      background: '#f8fafc',
      minHeight: '100vh',
      paddingBottom: '80px',
      direction: 'rtl',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#0f172a',
    }}>
      {/* Top Mobile Bar */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: '#170e5e',
        color: '#ffffff',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <SmartphoneIcon size={20} color="#ffffff" />
          <div>
            <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 800, lineHeight: 1.2 }}>{t('dashboard.owner_mobile_dashboard_page.s0', "لوحة المالك اللحظية")}</h1>
            <span style={{ fontSize: '11px', opacity: 0.8 }}>
              {t('dashboard.owner_mobile_dashboard_page.s1', "تحديث:")} {lastRefreshedAt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={overviewQuery.isFetching}
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: 'none',
            color: '#fff',
            borderRadius: '10px',
            padding: '6px 12px',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: 600,
          }}
        >
          <RefreshCwIcon size={14} color="#ffffff" style={{ transform: overviewQuery.isFetching ? 'rotate(360deg)' : 'none', transition: 'transform 0.5s' }} />
          <span>{overviewQuery.isFetching ? '...' : t('dashboard.owner_mobile_dashboard_page.s2', "تحديث")}</span>
        </button>
      </header>

      {/* Date Filter Pills */}
      <div style={{
        display: 'flex',
        gap: '8px',
        padding: '12px 16px',
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        overflowX: 'auto',
      }}>
        <button
          type="button"
          onClick={() => setRange('today')}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            background: range === 'today' ? '#170e5e' : '#f1f5f9',
            color: range === 'today' ? '#ffffff' : '#475569',
          }}
        >
          {t('dashboard.owner_mobile_dashboard_page.s3', "اليوم")}
        </button>
        <button
          type="button"
          onClick={() => setRange('yesterday')}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            background: range === 'yesterday' ? '#170e5e' : '#f1f5f9',
            color: range === 'yesterday' ? '#ffffff' : '#475569',
          }}
        >
          {t('dashboard.owner_mobile_dashboard_page.s4', "أمس")}
        </button>
        <button
          type="button"
          onClick={() => setRange('week')}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            background: range === 'week' ? '#170e5e' : '#f1f5f9',
            color: range === 'week' ? '#ffffff' : '#475569',
          }}
        >
          {t('dashboard.owner_mobile_dashboard_page.s5', "7 أيام")}
        </button>
        <button
          type="button"
          onClick={() => setRange('month')}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            background: range === 'month' ? '#170e5e' : '#f1f5f9',
            color: range === 'month' ? '#ffffff' : '#475569',
          }}
        >
          {t('dashboard.owner_mobile_dashboard_page.s6', "هذا الشهر")}
        </button>
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Main 2x2 KPI Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {/* Sales Card */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '14px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
          }}>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '4px' }}>{t('dashboard.owner_mobile_dashboard_page.s7', "المبيعات")}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>{formatCurrency(netSales)}</div>
            <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '4px', fontWeight: 600 }}>
              {invoiceCount} {t('dashboard.owner_mobile_dashboard_page.s8', "فاتورة")}
            </div>
          </div>

          {/* Net Profit Card */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '14px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
          }}>
            <div style={{ fontSize: '12px', color: '#166534', fontWeight: 600, marginBottom: '4px' }}>{t('dashboard.owner_mobile_dashboard_page.s9', "صافي الأرباح")}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#15803d' }}>{formatCurrency(netProfit)}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              {t('dashboard.owner_mobile_dashboard_page.s10', "متوسط السلة:")} {formatCurrency(avgBasket)}
            </div>
          </div>

          {/* Cash Drawers Card */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '14px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
          }}>
            <div style={{ fontSize: '12px', color: '#b45309', fontWeight: 600, marginBottom: '4px' }}>{t('dashboard.owner_mobile_dashboard_page.s11', "نقدية الخزائن الحية")}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#d97706' }}>
              {openShifts.length > 0 ? formatCurrency(totalOpenCash) : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
              {openShifts.length} {t('dashboard.owner_mobile_dashboard_page.s12', "وردية مفتوحة")}
            </div>
          </div>

          {/* Average Invoice */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '14px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
          }}>
            <div style={{ fontSize: '12px', color: '#1e40af', fontWeight: 600, marginBottom: '4px' }}>{t('dashboard.owner_mobile_dashboard_page.s13', "عدد الفواتير")}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#1d4ed8' }}>{invoiceCount}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              {t('dashboard.owner_mobile_dashboard_page.s14', "الفترة المحددة")}
            </div>
          </div>
        </div>

        {/* Top 5 Best Sellers */}
        {topProducts.length > 0 && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '16px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#1e293b' }}>{t('dashboard.owner_mobile_dashboard_page.s15', "الأكثر مبيعاً في الفترة")}</h2>
              <span style={{ fontSize: '11px', color: '#64748b' }}>{t('dashboard.owner_mobile_dashboard_page.s16', "أعلى 5 أصناف")}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topProducts.map((p: any, idx: number) => (
                <div key={p.productId || idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: idx === 0 ? '#fef3c7' : '#e2e8f0',
                      color: idx === 0 ? '#b45309' : '#475569',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 800,
                    }}>
                      {idx + 1}
                    </span>
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>{p.name}</span>
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>{formatCurrency(p.total)}</span>
                    <span style={{ fontSize: '11px', color: '#64748b', marginRight: '6px' }}>({p.qty} {t('dashboard.owner_mobile_dashboard_page.s17', "قطعة)")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live Recent Sales Feed */}
        {recentSales.length > 0 && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '16px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#1e293b' }}>{t('dashboard.owner_mobile_dashboard_page.s18', "بث الفواتير المباشرة")}</h2>
              <span style={{ fontSize: '11px', color: '#64748b' }}>{t('dashboard.owner_mobile_dashboard_page.s19', "لحظة بلحظة")}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recentSales.map((s: any, idx: number) => {
                const isPaid = (s.paidAmount || s.paid_amount || s.total) >= s.total;
                return (
                  <div key={s.id || idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderBottom: '1px solid #f1f5f9',
                    fontSize: '13px',
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{s.docNo || s.id}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        {s.customerName || s.customer_name || t('dashboard.owner_mobile_dashboard_page.s20', "عميل نقدي")} • {s.date ? new Date(s.date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : t('dashboard.owner_mobile_dashboard_page.s21', "الآن")}
                      </div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{formatCurrency(Number(s.total || 0))}</div>
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '6px',
                        background: isPaid ? '#dcfce7' : '#fee2e2',
                        color: isPaid ? '#166534' : '#991b1b',
                        fontWeight: 700,
                      }}>
                        {isPaid ? t('dashboard.owner_mobile_dashboard_page.s22', "مدفوع") : t('dashboard.owner_mobile_dashboard_page.s23', "آجل/متبقي")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Low Stock Warning */}
        {lowStock.length > 0 && (
          <div style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '14px',
            padding: '14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#92400e', fontWeight: 700, fontSize: '13px' }}>
              <AlertTriangleIcon size={16} color="#d97706" />
              <span>{t('dashboard.owner_mobile_dashboard_page.s24', "تنبيه أصناف قاربت على النفاد")}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {lowStock.map((item: any, idx: number) => (
                <span key={item.id || idx} style={{
                  background: '#ffffff',
                  border: '1px solid #fcd34d',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  color: '#78350f',
                }}>
                  {item.name} ({item.stock || item.quantity || 0} {t('dashboard.owner_mobile_dashboard_page.s25', "متبقي)")}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Fixed Navigation Bar */}
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        maxWidth: '560px',
        margin: '0 auto',
        background: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-around',
        padding: '10px 0',
        zIndex: 50,
        boxShadow: '0 -2px 10px rgba(0,0,0,0.05)',
      }}>
        <Link to="/owner-mobile" style={{ textAlign: 'center', textDecoration: 'none', color: '#170e5e', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <SmartphoneIcon size={20} color="#170e5e" strokeWidth={2.2} />
          <span style={{ fontSize: '11px', fontWeight: 800 }}>{t('dashboard.owner_mobile_dashboard_page.s26', "المالك")}</span>
        </Link>
        <Link to="/pos" style={{ textAlign: 'center', textDecoration: 'none', color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <ShoppingCartIcon size={20} color="#64748b" strokeWidth={2} />
          <span style={{ fontSize: '11px', fontWeight: 600 }}>{t('dashboard.owner_mobile_dashboard_page.s27', "الكاشير")}</span>
        </Link>
        <Link to="/dashboard" style={{ textAlign: 'center', textDecoration: 'none', color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <BarChartIcon size={20} color="#64748b" strokeWidth={2} />
          <span style={{ fontSize: '11px', fontWeight: 600 }}>{t('dashboard.owner_mobile_dashboard_page.s28', "اللوحة الكاملة")}</span>
        </Link>
        <Link to="/reports/overview" style={{ textAlign: 'center', textDecoration: 'none', color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <FileTextIcon size={20} color="#64748b" strokeWidth={2} />
          <span style={{ fontSize: '11px', fontWeight: 600 }}>{t('dashboard.owner_mobile_dashboard_page.s29', "التقارير")}</span>
        </Link>
      </nav>
    </div>
  );
}
