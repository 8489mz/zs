import { useTranslation } from 'react-i18next';
import { translateUiText } from '@/lib/auto-translator';
import { Link } from 'react-router-dom';
import { LockIcon, CheckIcon } from '@/shared/components/icons/AppIcons';
import { PLAN_TIERS } from '@/features/settings/components/modular-configurator/modular-presets';
import type { AppItemDefinition } from '../types/apps-store.types';

interface AppCardProps {
  app: AppItemDefinition;
  isActive: boolean;
  isAllowedByPlan: boolean;
  isPending: boolean;
  isCoreSuiteApp?: boolean;
  isSuperAdmin?: boolean;
  onToggle: (app: AppItemDefinition, currentStatus: boolean) => void;
  onOpenUpgradeModal: (app: AppItemDefinition) => void;
}

function ArrowUpLeftIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

export function AppCard({
  app,
  isActive,
  isAllowedByPlan,
  isPending,
  isCoreSuiteApp = false,
  isSuperAdmin = false,
  onToggle,
  onOpenUpgradeModal,
}: AppCardProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const planInfo = PLAN_TIERS[app.requiredPlan] || PLAN_TIERS.plan_ultimate;
  const AppIcon = app.icon;
  const displayTitle = isEn ? (translateUiText(app.title) || app.title) : app.title;
  const displayDesc = isEn ? (translateUiText(app.shortDesc) || app.shortDesc) : app.shortDesc;
  const displayCat = isEn ? (translateUiText(app.categoryLabel) || app.categoryLabel) : app.categoryLabel;
  const displayPlanName = isEn ? (translateUiText(planInfo.name) || planInfo.name) : planInfo.name;

  return (
    <div
      style={{
        background: '#ffffff',
        border: isActive ? '1.5px solid #10b981' : '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'all 0.2s ease',
        boxShadow: isActive ? '0 4px 14px rgba(16, 185, 129, 0.07)' : '0 1px 3px rgba(0,0,0,0.02)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top Bar: Icon + Category + Status Badge */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <AppIcon size={24} color="#170e5e" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            {isActive ? (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: '#ecfdf5',
                  color: '#047857',
                  border: '1px solid #a7f3d0',
                  padding: '3px 9px',
                  borderRadius: '6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <CheckIcon size={12} color="#047857" />
                <span>{isSuperAdmin ? t('apps_store.app_card.s0', "مُثبت ونشط") : t('apps_store.app_card.s1', "مُفعّل ضمن باقتك")}</span>
              </span>
            ) : isAllowedByPlan ? (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: '#f8fafc',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                  padding: '3px 9px',
                  borderRadius: '6px',
                }}
              >
                {t('apps_store.app_card.s2', "متاح للتثبيت")}
              </span>
            ) : (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: '#f8fafc',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                  padding: '3px 9px',
                  borderRadius: '6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <LockIcon size={11} color="#64748b" />
                <span>{displayPlanName}</span>
              </span>
            )}

            <span style={{ fontSize: '0.6875rem', color: '#94a3b8', fontWeight: 600 }}>
              {displayCat}
            </span>
          </div>
        </div>

        {/* Title */}
        <h3
          style={{
            fontSize: '0.98rem',
            fontWeight: 800,
            color: '#0f172a',
            margin: '0 0 6px 0',
            lineHeight: 1.3,
          }}
        >
          {displayTitle}
        </h3>

        {/* Short Description */}
        <p
          style={{
            fontSize: '0.8125rem',
            color: '#64748b',
            lineHeight: 1.5,
            margin: '0 0 14px 0',
            minHeight: '38px',
            textAlign: 'justify',
            textJustify: 'inter-word',
            textAlignLast: 'start',
          }}
        >
          {displayDesc}
        </p>

        {/* Feature Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' }}>
          {app.features.map((feat, idx) => (
            <span
              key={idx}
              style={{
                fontSize: '0.6875rem',
                background: '#f8fafc',
                color: '#334155',
                border: '1px solid #e2e8f0',
                padding: '2px 8px',
                borderRadius: '6px',
                fontWeight: 600,
              }}
            >
              {isEn ? (translateUiText(feat) || feat) : feat}
            </span>
          ))}
        </div>
      </div>

      {/* Footer Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: '14px',
          borderTop: '1px solid #f1f5f9',
          gap: '8px',
        }}
      >
        {/* Module workspace direct link (if active & routePath exists) */}
        {isActive && app.routePath ? (
          <Link
            to={app.routePath}
            style={{
              fontSize: '0.78rem',
              color: '#170e5e',
              fontWeight: 700,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '8px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#eef2ff';
              e.currentTarget.style.borderColor = '#c7d2fe';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <span>{t('apps_store.app_card.s3', "فتح التطبيق")}</span>
            <ArrowUpLeftIcon size={13} />
          </Link>
        ) : (
          <div />
        )}

        {/* Main Action Buttons */}
        <div>
          {isCoreSuiteApp ? (
            <span
              style={{
                fontSize: '0.74rem',
                color: '#047857',
                fontWeight: 700,
                background: '#ecfdf5',
                padding: '5px 12px',
                borderRadius: '8px',
                border: '1px solid #a7f3d0',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <CheckIcon size={12} color="#047857" />
              <span>{t('apps_store.app_card.s4', "أساسي في الباقة الشاملة")}</span>
            </span>
          ) : isActive ? (
            isSuperAdmin ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => onToggle(app, true)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#64748b',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#dc2626';
                  e.currentTarget.style.borderColor = '#fca5a5';
                  e.currentTarget.style.background = '#fef2f2';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#64748b';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                  e.currentTarget.style.background = '#ffffff';
                }}
              >
                {t('apps_store.app_card.s5', "إلغاء التثبيت")}
              </button>
            ) : (
              <span
                style={{
                  fontSize: '0.74rem',
                  color: '#047857',
                  fontWeight: 700,
                  background: '#ecfdf5',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  border: '1px solid #a7f3d0',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <CheckIcon size={12} color="#047857" />
                <span>{t('apps_store.app_card.s6', "مُدرج بالاشتراك")}</span>
              </span>
            )
          ) : isAllowedByPlan ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onToggle(app, false)}
              style={{
                padding: '7px 18px',
                borderRadius: '8px',
                border: 'none',
                background: '#170e5e',
                color: '#ffffff',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(23, 14, 94, 0.18)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#110a47';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#170e5e';
              }}
            >
              {t('apps_store.app_card.s7', "تثبيت وتفعيل")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenUpgradeModal(app)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#170e5e',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#eef2ff';
                e.currentTarget.style.borderColor = '#c7d2fe';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#ffffff';
                e.currentTarget.style.borderColor = '#cbd5e1';
              }}
            >
              <LockIcon size={12} color="#170e5e" />
              <span>{t('apps_store.app_card.s8', "طلب التفعيل والترقية")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
