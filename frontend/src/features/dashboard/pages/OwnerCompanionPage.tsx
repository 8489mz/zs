import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/dashboard.api';
import { cashierFraudRadarApi } from '@/shared/api/loss-prevention.api';
import { toast } from '@/shared/components/system-alert';
import { useAuthStore } from '@/stores/auth-store';
import { useHasAnyPermission, useHasFeature } from '@/shared/hooks/use-permission';
import { findWorkspaceFallbackRoute, isPlatformAdmin } from '@/app/router/access';
import { navigationItems } from '@/app/router/registry';
import { Button } from '@/shared/ui/button';
import { SmartphoneIcon, BellIcon, ShieldCheckIcon, TruckIcon, AlertTriangleIcon, CreditCardIcon } from '@/shared/components/icons/AppIcons';
import type { DashboardTopItem } from '../api/dashboard.types';
import { todayLocalDateKey } from '@/lib/format';

export function OwnerCompanionPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const isPlatformAdminUser = isPlatformAdmin(user);
  const hasReportsFeature = useHasFeature('reports') || isPlatformAdminUser;
  const canViewReports = useHasAnyPermission('reports') || isPlatformAdminUser;

  const tenant = useAuthStore((state) => state.tenant);
  const navigate = useNavigate();
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toLocaleTimeString('ar-EG'));
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPwa = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      toast.info('لتثبيت التطبيق: من قائمة المتصفح اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية".');
    }
  };

  const todayStr = todayLocalDateKey();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['owner-companion-overview', todayStr],
    queryFn: () => dashboardApi.overview(todayStr, todayStr),
    refetchInterval: 30000, // auto-refresh every 30s
    enabled: hasReportsFeature && canViewReports,
  });

  const lossPreventionQuery = useQuery({
    queryKey: ['owner-companion-loss-prevention'],
    queryFn: () => cashierFraudRadarApi.getCommandCenter('today'),
    refetchInterval: 60000,
    retry: 0,
    enabled: hasReportsFeature && canViewReports,
  });

  if (!hasReportsFeature || !canViewReports) {
    return <Navigate to={findWorkspaceFallbackRoute(user, navigationItems) || '/pos'} replace />;
  }

  const handleManualRefresh = () => {
    void refetch();
    void lossPreventionQuery.refetch();
    setLastUpdated(new Date().toLocaleTimeString('ar-EG'));
  };

  const businessName = tenant?.businessName || 'المنشأة';
  const stats = data?.stats;
  const topToday: DashboardTopItem[] = data?.topToday || [];

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px 14px', width: '100%', boxSizing: 'border-box' }} dir="rtl">
      {/* PWA Install Banner */}
      {deferredPrompt && (
        <div
          style={{
            background: '#e0e7ff',
            border: '1px solid #c7d2fe',
            borderRadius: '12px',
            padding: '12px 14px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <SmartphoneIcon size={20} color="#4338ca" />
            <div>
              <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#1e1b4b' }}>{t('dashboard.owner_companion_page.s0', "تثبيت شاشة المتابعة على الهاتف")}</div>
              <div style={{ fontSize: '11px', color: '#4338ca' }}>{t('dashboard.owner_companion_page.s1', "وصول فوري وشاشة كاملة كأي تطبيق أندرويد/آيفون")}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleInstallPwa}
            style={{
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '11.5px',
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t('dashboard.owner_companion_page.s2', "تثبيت الآن")}
          </button>
        </div>
      )}

      {/* WhatsApp Live Alerts Notification Pill */}
      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '12px',
          padding: '10px 14px',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '11.5px',
          color: '#166534',
        }}
      >
        <BellIcon size={18} color="#166534" />
        <div>
          <strong>{t('dashboard.owner_companion_page.s3', "تنبيهات الواتساب الحية مفعلة:")}</strong> {t('dashboard.owner_companion_page.s4', "ستصلك إشعارات إغلاق الورديات والعجز/الزيادة وطلبات المتجر فورياً على هاتفك.")}
        </div>
      </div>

      {/* Top Header Card */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          padding: '16px',
          marginBottom: '14px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#10b981' }}>{t('dashboard.owner_companion_page.s5', "متابعة حية للمالك")}</span>
          </div>
          <h2 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 900, color: '#0f172a' }}>{businessName}</h2>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {t('dashboard.owner_companion_page.s6', "اليوم:")} {new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>

        <Button
          variant="secondary"
          onClick={handleManualRefresh}
          disabled={isFetching}
          style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 700, borderRadius: '8px' }}
        >
          {isFetching ? '...' : t('dashboard.owner_companion_page.s7', "تحديث")}
        </Button>
      </div>

      {/* Primary KPI Grid (2x2) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '14px' }}>
        {/* Sales Today */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>{t('dashboard.owner_companion_page.s8', "مبيعات اليوم")}</div>
          <div style={{ fontSize: '20px', fontWeight: 900, color: '#170e5e' }}>
            {isLoading ? '...' : `${Number(stats?.todaySalesAmount || 0).toLocaleString('ar-EG')} ${getGlobalCurrencySymbol()}`}
          </div>
          <div style={{ fontSize: '11px', color: '#059669', fontWeight: 600, marginTop: '2px' }}>
            {stats?.todaySalesCount || 0} {t('dashboard.owner_companion_page.s9', "فاتورة بيع")}
          </div>
        </div>

        {/* Purchases Today */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>{t('dashboard.owner_companion_page.s10', "مشتريات وتوريد اليوم")}</div>
          <div style={{ fontSize: '20px', fontWeight: 900, color: '#c2410c' }}>
            {isLoading ? '...' : `${Number(stats?.todayPurchasesAmount || 0).toLocaleString('ar-EG')} ${getGlobalCurrencySymbol()}`}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {stats?.todayPurchasesCount || 0} {t('dashboard.owner_companion_page.s11', "حركة شراء")}
          </div>
        </div>

        {/* Customer Debt */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>{t('dashboard.owner_companion_page.s12', "ديون العملاء الإجمالية")}</div>
          <div style={{ fontSize: '20px', fontWeight: 900, color: '#b91c1c' }}>
            {isLoading ? '...' : `${Number(stats?.customerDebt || 0).toLocaleString('ar-EG')} ${getGlobalCurrencySymbol()}`}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {t('dashboard.owner_companion_page.s13', "مستحقات آجلة لدى العملاء")}
          </div>
        </div>

        {/* Inventory Value */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>{t('dashboard.owner_companion_page.s14', "قيمة المخزون الحالي")}</div>
          <div style={{ fontSize: '20px', fontWeight: 900, color: '#2563eb' }}>
            {isLoading ? '...' : `${Number(stats?.inventoryCost || 0).toLocaleString('ar-EG')} ${getGlobalCurrencySymbol()}`}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            {t('dashboard.owner_companion_page.s15', "بسعر تكلفة البضاعة")}
          </div>
        </div>
      </div>

      {/* Loss Prevention & Anti-Theft Live Summary (Mobile Visual Constitution) */}
      {lossPreventionQuery.data && (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '14px',
            marginBottom: '14px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
              <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>درع منع الخسائر اليومي</span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/audit')}
              style={{
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#170e5e',
                borderRadius: '8px',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              فتح غرفة العمليات
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: '#fee2e2', color: '#b91c1c', margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangleIcon size={18} />
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                {lossPreventionQuery.data.posRadar.summary.totalSuspiciousEvents}
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 500, color: '#64748b' }}>أحداث كاشير مرصودة</div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: '#fef3c7', color: '#b45309', margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <TruckIcon size={18} />
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                {lossPreventionQuery.data.inTransitCustody.openCount} ({lossPreventionQuery.data.inTransitCustody.overdueCount} متأخر)
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 500, color: '#64748b' }}>تحويلات بالطريق</div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: '#eef2ff', color: '#170e5e', margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldCheckIcon size={18} />
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                {Number(lossPreventionQuery.data.shrinkage.totalLossCost || 0).toLocaleString('ar-EG')} <CurrencySymbol />
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 500, color: '#64748b' }}>فاقد وتالف اليوم</div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: '#dcfce7', color: '#15803d', margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CreditCardIcon size={18} />
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                {lossPreventionQuery.data.shiftsAndDelivery.overdueDeliveryOrdersCount}
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 500, color: '#64748b' }}>أوردرات مناديب متأخرة</div>
            </div>
          </div>
        </div>
      )}

      {/* Top Products Sold Today */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', marginBottom: '14px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>{t('dashboard.owner_companion_page.s16', "الأكثر مبيعاً اليوم")}</h4>
          <span style={{ fontSize: '11px', color: '#64748b' }}>{t('dashboard.owner_companion_page.s17', "أعلى الأصناف حركة")}</span>
        </div>

        {topToday.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '12.5px' }}>
            {t('dashboard.owner_companion_page.s18', "لا توجد مبيعات مسجلة لليوم بعد.")}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {topToday.slice(0, 5).map((p: DashboardTopItem, idx: number) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>
                    {idx + 1}
                  </span>
                  <span style={{ fontWeight: 700, color: '#0f172a' }}>{p.name}</span>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <span style={{ fontWeight: 800, color: '#170e5e' }}>{Number(p.total).toLocaleString('ar-EG')} <CurrencySymbol /></span>
                  <span style={{ fontSize: '11px', color: '#64748b', marginInlineStart: '4px' }}>({p.qty} {t('dashboard.owner_companion_page.s19', "قطعة)")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div style={{ textAlign: 'center', fontSize: '11px', color: '#94a3b8', marginTop: '16px' }}>
        {t('dashboard.owner_companion_page.s20', "آخر تحديث:")} {lastUpdated} {t('dashboard.owner_companion_page.s21', "· تحديث تلقائي كل 30 ثانية")}
      </div>
    </div>
  );
}
