import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { isDesktopOfflineApp } from '@/shared/system/runtime-environment';
import { LockIcon } from '@/shared/components/icons/AppIcons';

interface AppsKpiHeaderProps {
  totalApps: number;
  activeAppsCount: number;
  availableToInstallCount: number;
  currentPlanName: string;
  isSuperAdmin: boolean;
}

// Institutional Metric Icons (0 Emojis, 0 Sparkles)
function LayersIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function CheckShieldIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function PlusCircleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function CrownIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14v2H5v-2z" />
    </svg>
  );
}

export function AppsKpiHeader({
  totalApps,
  activeAppsCount,
  availableToInstallCount,
  currentPlanName,
  isSuperAdmin,
}: AppsKpiHeaderProps) {
  const { t } = useTranslation();
  // Balanced plan name display (prevents awkward line wrapping)
  const planDisplay = useMemo(() => {
    if (isSuperAdmin) {
      return { title: 'إدارة مركزية', tier: 'Super Admin', note: 'كامل التطبيقات مفتوحة' };
    }
    if (currentPlanName.includes('المقاولات')) {
      return { title: 'باقة المقاولات', tier: 'All-Inclusive', note: 'الموديولات الهندسية مدمجة' };
    }
    if (currentPlanName.includes('الشحن')) {
      return { title: 'باقة الشحن الدولي', tier: 'All-Inclusive', note: 'موديولات الملاحة مدمجة' };
    }
    if (currentPlanName.includes('Ultimate') || currentPlanName.includes('المتكاملة')) {
      return { title: 'الباقة المتكاملة', tier: 'Ultimate ERP', note: 'تشمل كافة الوحدات المتقدمة عدا المتجر الإلكتروني' };
    }
    if (currentPlanName.includes('Pro') || currentPlanName.includes('المتقدمة')) {
      return { title: 'الباقة المتقدمة', tier: 'Pro ERP', note: 'إدارة الأعمال الشاملة' };
    }
    return { title: currentPlanName, tier: 'الاشتراك النشط', note: 'يمكنك الترقية لفتح المزيد' };
  }, [currentPlanName, isSuperAdmin]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '16px',
        marginBottom: '22px',
      }}
      dir="rtl"
    >
      {/* 1. إجمالي التطبيقات المتاحة */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '118px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 700 }}>{t('apps_store.apps_kpi_header.s0', "إجمالي التطبيقات")}</span>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#170e5e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <LayersIcon size={19} />
          </div>
        </div>

        <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.2, margin: '2px 0 6px 0' }}>
          {totalApps} <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>{t('apps_store.apps_kpi_header.s1', "تطبيقاً")}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t('apps_store.apps_kpi_header.s2', "كتالوج المنظومة الشامل")}</span>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: '#475569',
              background: '#f8fafc',
              padding: '2px 7px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}
          >
            {t('apps_store.apps_kpi_header.s3', "الكتالوج العام")}
          </span>
        </div>
      </div>

      {/* 2. التطبيقات المفعلة والنشطة (الأخضر البريميوم الحصري) */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #a7f3d0',
          borderRadius: '14px',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '118px',
          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.76rem', color: '#065f46', fontWeight: 700 }}>{t('apps_store.apps_kpi_header.s4', "المثبتة والنشطة")}</span>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#059669',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CheckShieldIcon size={19} />
          </div>
        </div>

        <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#059669', lineHeight: 1.2, margin: '2px 0 6px 0' }}>
          {activeAppsCount} <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#047857' }}>{t('apps_store.apps_kpi_header.s5', "نشط")}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <span style={{ fontSize: '0.7rem', color: '#059669' }}>{t('apps_store.apps_kpi_header.s6', "تظهر في القائمة والشاشات")}</span>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: '#047857',
              background: '#ecfdf5',
              padding: '2px 7px',
              borderRadius: '6px',
              border: '1px solid #a7f3d0',
            }}
          >
            {t('apps_store.apps_kpi_header.s7', "جاهز للعمل")}
          </span>
        </div>
      </div>

      {/* 3. متاح للتفعيل الفوري (بدون أيقونة الذكاء الاصطناعي/الشرارة) */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '118px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 700 }}>
            {isSuperAdmin ? t('apps_store.apps_kpi_header.s8', "متاح للتثبيت الفوري") : t('apps_store.apps_kpi_header.s9', "موديولات إضافية للترقية")}
          </span>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#170e5e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <PlusCircleIcon size={19} />
          </div>
        </div>

        <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.2, margin: '2px 0 6px 0' }}>
          {isSuperAdmin ? availableToInstallCount : Math.max(0, totalApps - activeAppsCount)}{' '}
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>{t('apps_store.apps_kpi_header.s10', "موديول")}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
            {isSuperAdmin ? t('apps_store.apps_kpi_header.s11', "ضمن باقتك الحالية مباشرة") : t('apps_store.apps_kpi_header.s12', "تتطلب ترقية أو تفعيل من الإدارة")}
          </span>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: isSuperAdmin ? '#475569' : '#1e40af',
              background: isSuperAdmin ? '#f8fafc' : '#eff6ff',
              padding: '2px 7px',
              borderRadius: '6px',
              border: isSuperAdmin ? '1px solid #e2e8f0' : '1px solid #bfdbfe',
            }}
          >
            {isSuperAdmin ? t('apps_store.apps_kpi_header.s13', "تثبيت فوري") : t('apps_store.apps_kpi_header.s14', "تواصل مع الإدارة")}
          </span>
        </div>
      </div>

      {/* 4. الباقة الحالية والاشتراك */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '118px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 700 }}>
            {isSuperAdmin ? t('apps_store.apps_kpi_header.s15', "رتبة الحساب") : t('apps_store.apps_kpi_header.s16', "باقتك الحالية")}
          </span>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#170e5e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {isSuperAdmin ? <CrownIcon size={19} /> : <LockIcon size={17} />}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '2px 0 6px 0' }}>
          <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
            {planDisplay.title}
          </span>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: '#170e5e',
              background: '#f1f5f9',
              padding: '2px 7px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
              whiteSpace: 'nowrap',
            }}
          >
            {planDisplay.tier}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{planDisplay.note}</span>
          {!isSuperAdmin && !isDesktopOfflineApp() && (
            <Link
              to="/settings/subscription"
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#170e5e',
                background: '#f8fafc',
                padding: '3px 10px',
                borderRadius: '6px',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                border: '1px solid #cbd5e1',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#eef2ff';
                e.currentTarget.style.borderColor = '#c7d2fe';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f8fafc';
                e.currentTarget.style.borderColor = '#cbd5e1';
              }}
            >
              {t('apps_store.apps_kpi_header.s17', "ترقية الباقة")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
