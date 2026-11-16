import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth-store';
import { canAccessPath } from '@/app/router/access';
import { mobileBridge } from '@/shared/native/mobile-bridge';
import {
  SmartphoneIcon,
  TruckIcon,
  ShoppingCartIcon,
  PackageIcon,
  ClockIcon,
  MapPinIcon,
  BuildingIcon,
  UserIcon,
} from '@/shared/components/icons/AppIcons';

interface MobileModuleTile {
  id: string;
  title: string;
  subtitle: string;
  path: string;
  badgeBg: string;
  iconColor: string;
  IconComponent: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  requiresRole?: string[];
}

export function MobileHubPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const clearSession = useAuthStore((s) => s.clearSession);

  const [isOnline, setIsOnline] = useState(true);
  const [platform, setPlatform] = useState<'android' | 'ios' | 'web'>('web');
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(mobileBridge.isNative());
    setPlatform(mobileBridge.getPlatform());
    mobileBridge.isOnline().then(setIsOnline);

    const cleanup = mobileBridge.onNetworkStatusChange((online) => {
      setIsOnline(online);
    });
    return cleanup;
  }, []);

  const handleTileClick = () => {
    mobileBridge.vibrate('light');
  };

  const modules: MobileModuleTile[] = [
    {
      id: 'owner-dashboard',
      title: 'لوحة تحكم المالك',
      subtitle: 'الأرباح والخزائن لحظة بلحظة',
      path: '/owner-mobile',
      badgeBg: '#f3e8ff',
      iconColor: '#7e22ce',
      IconComponent: SmartphoneIcon,
    },
    {
      id: 'van-sales',
      title: 'البيع الميداني (الفان)',
      subtitle: 'فواتير التوزيع والتحصيل والجرد',
      path: '/van-sales/mobile',
      badgeBg: '#eef2ff',
      iconColor: '#4338ca',
      IconComponent: TruckIcon,
    },
    {
      id: 'delivery-driver',
      title: 'سائقي التوصيل',
      subtitle: 'خطوط السير وإثبات التسليم',
      path: '/driver-mobile',
      badgeBg: '#fef3c7',
      iconColor: '#b45309',
      IconComponent: MapPinIcon,
    },
    {
      id: 'mobile-punch',
      title: 'بصمة الحضور الذاتية',
      subtitle: 'تسجيل الحضور بالكاميرا والـ GPS',
      path: '/mobile/punch',
      badgeBg: '#dcfce7',
      iconColor: '#15803d',
      IconComponent: UserIcon,
    },
    {
      id: 'pos-cashier',
      title: 'نقطة البيع (POS)',
      subtitle: 'الكاشير وإصدار الفواتير السريعة',
      path: '/pos',
      badgeBg: '#e0f2fe',
      iconColor: '#0369a1',
      IconComponent: ShoppingCartIcon,
    },
    {
      id: 'inventory-check',
      title: 'المخزون والجرد',
      subtitle: 'فحص الأرصدة والباركود المحمول',
      path: '/inventory',
      badgeBg: '#fee2e2',
      iconColor: '#be123c',
      IconComponent: PackageIcon,
    },
  ];

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        fontFamily: 'inherit',
        maxWidth: '560px',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Header Bar */}
      <header
        style={{
          backgroundColor: '#170e5e',
          color: '#ffffff',
          padding: '16px 18px',
          borderBottomLeftRadius: '20px',
          borderBottomRightRadius: '20px',
          boxShadow: '0 4px 12px rgba(23, 14, 94, 0.15)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  letterSpacing: '0.5px',
                }}
              >
                {isNative ? (platform === 'ios' ? 'iOS Store Native' : 'Android Store Native') : 'Enterprise Mobile'}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  color: isOnline ? '#86efac' : '#fca5a5',
                }}
              >
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: isOnline ? '#22c55e' : '#ef4444',
                    display: 'inline-block',
                  }}
                />
                {isOnline ? t('dashboard.mobile_hub_page.s0', "متصل") : t('dashboard.mobile_hub_page.s1', "أوفلاين")}
              </span>
            </div>
            <h1 style={{ fontSize: '18px', fontWeight: 800, margin: '8px 0 2px', color: '#ffffff' }}>
              {tenant?.businessName || t('dashboard.mobile_hub_page.s2', "منظومة Z-Systems ERP")}
            </h1>
            <p style={{ fontSize: '11.5px', margin: 0, opacity: 0.85 }}>
              {t('dashboard.mobile_hub_page.s3', "مرحباً،")} {user?.displayName || user?.username || t('dashboard.mobile_hub_page.s4', "المستخدم")} • {user?.role === 'admin' || user?.role === 'super_admin' ? t('dashboard.mobile_hub_page.s5', "مدير المنشأة") : t('dashboard.mobile_hub_page.s6', "مستخدم مصرح")}
            </p>
          </div>

          <button
            onClick={() => {
              clearSession();
              window.location.href = '/login';
            }}
            title={t('dashboard.mobile_hub_page.s7', "تسجيل الخروج")}
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              borderRadius: '10px',
              width: '38px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ padding: '16px 14px' }}>
        {/* Section Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <h2 style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
            {t('dashboard.mobile_hub_page.s8', "تطبيقات ومساحات العمل الميدانية")}
          </h2>
        </div>

        {/* 2-Column Action Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px',
            marginBottom: '16px',
          }}
        >
          {modules
            .filter((m) => m.path === '/mobile/punch' || canAccessPath(user, m.path))
            .map((m) => {
            const Icon = m.IconComponent;
            return (
              <Link
                key={m.id}
                to={m.path}
                onClick={handleTileClick}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '16px 10px',
                  textDecoration: 'none',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  transition: 'transform 0.1s ease',
                }}
              >
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: m.badgeBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '8px',
                  }}
                >
                  <Icon size={22} color={m.iconColor} strokeWidth={2.2} />
                </div>
                <div style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a', marginBottom: '2px' }}>
                  {m.title}
                </div>
                <div style={{ fontSize: '10.5px', fontWeight: 500, color: '#64748b', lineHeight: 1.3 }}>
                  {m.subtitle}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Device & Sync Status Card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', marginTop: '16px' }}>
          <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
            {t('dashboard.mobile_hub_page.s9', "جاهزية الجهاز والاتصال")}
          </h3>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '12px 14px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>{t('dashboard.mobile_hub_page.s10', "إصدار المنظومة:")}</span>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#0f172a' }}>v1.1.31 (Release Store Build)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>{t('dashboard.mobile_hub_page.s11', "بيئة التشغيل:")}</span>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#170e5e' }}>
              {isNative ? `${platform.toUpperCase()} Native App` : 'Web Client'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>{t('dashboard.mobile_hub_page.s12', "قاعدة البيانات المحلية:")}</span>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#16a34a' }}>{t('dashboard.mobile_hub_page.s13', "IndexedDB Offline Cache جاهزة")}</span>
          </div>
        </div>
      </main>

      {/* Bottom Sticky Navigation */}
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          maxWidth: '560px',
          margin: '0 auto',
          backgroundColor: '#ffffff',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-around',
          padding: '10px 0 calc(10px + env(safe-area-inset-bottom, 0px))',
          zIndex: 50,
          boxShadow: '0 -2px 10px rgba(0,0,0,0.05)',
        }}
      >
        <Link
          to="/mobile"
          style={{
            textAlign: 'center',
            textDecoration: 'none',
            color: '#170e5e',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          <SmartphoneIcon size={20} color="#170e5e" strokeWidth={2.4} />
          <span style={{ fontSize: '11px', fontWeight: 800 }}>{t('dashboard.mobile_hub_page.s14', "الرئيسية")}</span>
        </Link>
        {canAccessPath(user, '/owner-mobile') && (
        <Link
          to="/owner-mobile"
          style={{
            textAlign: 'center',
            textDecoration: 'none',
            color: '#64748b',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          <BuildingIcon size={20} color="#64748b" strokeWidth={2} />
          <span style={{ fontSize: '11px', fontWeight: 600 }}>{t('dashboard.mobile_hub_page.s15', "المالك")}</span>
        </Link>
        )}
        <Link
          to="/van-sales/mobile"
          style={{
            textAlign: 'center',
            textDecoration: 'none',
            color: '#64748b',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          <TruckIcon size={20} color="#64748b" strokeWidth={2} />
          <span style={{ fontSize: '11px', fontWeight: 600 }}>{t('dashboard.mobile_hub_page.s16', "الفان سيلز")}</span>
        </Link>
        <Link
          to="/mobile/punch"
          style={{
            textAlign: 'center',
            textDecoration: 'none',
            color: '#64748b',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          <ClockIcon size={20} color="#64748b" strokeWidth={2} />
          <span style={{ fontSize: '11px', fontWeight: 600 }}>{t('dashboard.mobile_hub_page.s17', "البصمة")}</span>
        </Link>
      </nav>
    </div>
  );
}
