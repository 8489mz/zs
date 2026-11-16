import { useTranslation } from 'react-i18next';
import { translateUiText } from '@/lib/auto-translator';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isDesktopOfflineApp, tenantHasFeature } from '@/app/router/access';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/shared/ui/button';

export function useFeatureGate(featureCode: string): boolean {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);

  return tenantHasFeature(featureCode, tenant, user);
}

interface FeatureGateProps {
  feature: string;
  featureName: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function FeatureGate({
  feature,
  featureName,
  children,
  fallback,
}: FeatureGateProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const resolvedFeatureName = isEn ? (translateUiText(featureName) || featureName) : featureName;
  const isEnabled = useFeatureGate(feature);

  if (isEnabled) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div
      style={{
        padding: '48px 24px',
        maxWidth: '720px',
        margin: '40px auto',
        textAlign: 'center',
        background: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
      }}
      dir={isEn ? "ltr" : "rtl"}
    >
      <div
        style={{
          width: '64px',
          height: '64px',
          margin: '0 auto 16px',
          borderRadius: '50%',
          background: '#fef3c7',
          color: '#d97706',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>
        {isEn
    ? (isDesktopOfflineApp() ? `Module "${resolvedFeatureName}" is not included in your license` : `Module "${resolvedFeatureName}" requires a plan upgrade`)
    : (isDesktopOfflineApp() ? `موديول ${featureName} غير مضمّن في ترخيصك` : `موديول ${featureName} يتطلب ترقية الباقة`)}
      </h2>

      <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.6, maxWidth: '520px', margin: '0 auto 24px' }}>
        {isDesktopOfflineApp()
          ? `هذا الموديول متاح في مستوى أعلى من ترخيصك الحالي. تواصل معنا لترقية الترخيص والاستفادة الفورية من كافة أدوات ${featureName} مع الحفاظ على جميع بياناتك.`
          : `هذه الميزة المتقدمة متاحة في المستويات الأعلى من باقتك. يمكنك ترقية باقتك للاستفادة الفورية من كافة أدوات ${featureName} مع الحفاظ على جميع بياناتك.`}
      </p>

      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
        {!isDesktopOfflineApp() && (
        <Link to="/settings/subscription">
          <Button
            type="button"
            variant="primary"
            style={{
              background: '#170e5e',
              color: '#ffffff',
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: 700,
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {isEn ? 'Upgrade Plan Now' : t('shared.feature_gate.s0', "ترقية الباقة الآن")}
          </Button>
        </Link>
        )}
        <Link to="/dashboard">
          <Button
            type="button"
            variant="secondary"
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              borderRadius: '8px',
            }}
          >
            {isEn ? 'Back to Dashboard' : t('shared.feature_gate.s1', "العودة للرئيسية")}
          </Button>
        </Link>
      </div>
    </div>
  );
}
