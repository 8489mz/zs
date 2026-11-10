import { useTranslation } from 'react-i18next';
import React from 'react';
import { DisplayLanguageToggle } from '@/shared/components/DisplayLanguageToggle';
import { SignageTheme } from './types';
import type { BusinessVertical } from '@/shared/verticals/vertical-scope';
import {
  ShoppingCartIcon,
  Maximize2Icon,
  SettingsIcon,
  ArrowRightIcon,
  MenuIcon,
  PaletteIcon,
} from '@/shared/components/icons/AppIcons';

interface SignageHeaderProps {
  storeName: string;
  currentTime: string;
  currentDate: string;
  progressPercent: number;
  onToggleFullscreen: () => void;
  onToggleSettings: () => void;
  onBack: () => void;
  onToggleNavMenu: () => void;
  currentLang?: string;
  onToggleLanguage?: () => void;
  theme?: SignageTheme;
  onToggleTheme?: () => void;
  /* INV-REST-SIGNAGE-OFFER-BOARD-TRUTH (T12-H2): the board header
   * carried showroom copy ('بث مباشر بصالة العرض') for every tenant.
   * The vertical arrives from the page (same resolveCurrentVertical
   * source as the T11-E empty-state board); a restaurant tenant sees
   * the restaurant header, every other vertical keeps the showroom
   * header byte-for-byte. */
  vertical?: BusinessVertical;
}

export const SignageHeader: React.FC<SignageHeaderProps> = ({
  storeName,
  currentTime,
  currentDate,
  progressPercent,
  onToggleFullscreen,
  onToggleSettings,
  onBack,
  onToggleNavMenu,
  currentLang,
  onToggleLanguage,
  theme = 'dark',
  onToggleTheme,
  vertical = 'retail_general',
}) => {
  const { t } = useTranslation();
  const isDark = theme === 'dark';
  const isRestaurant = vertical === 'restaurant';

  return (
    <>
      <header
        style={{
          padding: '12px 28px',
          borderBottom: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isDark
            ? 'linear-gradient(180deg, #0f172a 0%, #0b0f19 100%)'
            : '#ffffff',
          boxShadow: isDark
            ? '0 4px 20px rgba(0, 0, 0, 0.4)'
            : '0 2px 10px rgba(15, 23, 42, 0.04)',
          zIndex: 20,
          transition: 'background 0.2s ease',
        }}
      >
        {/* Store Brand & Live Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '14px',
              background: isDark
                ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)'
                : 'linear-gradient(135deg, #170e5e 0%, #2563eb 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isDark
                ? '0 6px 18px rgba(37, 99, 235, 0.35)'
                : '0 4px 12px rgba(23, 14, 94, 0.25)',
              flexShrink: 0,
            }}
          >
            <ShoppingCartIcon size={24} color="#ffffff" />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: 900,
                  letterSpacing: '-0.3px',
                  color: isDark ? '#ffffff' : '#0f172a',
                }}
              >
                {storeName}
              </h1>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#f8fafc',
                  color: isDark ? '#34d399' : '#0f172a',
                  border: isDark ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid #e2e8f0',
                  padding: '2px 8px',
                  borderRadius: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: '#10b981',
                    display: 'inline-block',
                    boxShadow: '0 0 8px #10b981',
                  }}
                />
                <span>
                  {t(
                    isRestaurant
                      ? 'pos.signage.signage_header.restaurant_s0'
                      : 'pos.signage.signage_header.s0',
                    isRestaurant ? 'بث مباشر من المطعم' : 'بث مباشر بصالة العرض'
                  )}
                </span>
              </span>
            </div>
            <p
              style={{
                margin: '2px 0 0',
                fontSize: '12px',
                color: isDark ? '#94a3b8' : '#64748b',
                fontWeight: 600,
              }}
            >
              {t(
                isRestaurant
                  ? 'pos.signage.signage_header.restaurant_s1'
                  : 'pos.signage.signage_header.s1',
                isRestaurant
                  ? 'شاشة قائمة اليوم وأطباق المطعم • Restaurant Menu Board'
                  : 'شاشة العروض الترويجية والصفقات الحصرية • Digital Showroom Board'
              )}
            </p>
          </div>
        </div>

        {/* Live Clock & Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
          {/* Live Clock */}
          <div style={{ textAlign: 'left', direction: 'ltr' }}>
            <div
              style={{
                fontSize: '26px',
                fontWeight: 900,
                fontFamily: 'monospace',
                color: isDark ? '#38bdf8' : '#170e5e',
                letterSpacing: '1px',
                lineHeight: 1.1,
              }}
            >
              {currentTime}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: isDark ? '#94a3b8' : '#64748b',
                fontWeight: 600,
                direction: 'rtl',
                marginTop: '2px',
              }}
            >
              {currentDate}
            </div>
          </div>

          {/* Action Buttons Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Theme Toggle (Dark Luxury / Clean Light) */}
            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                style={{
                  background: isDark ? 'rgba(255, 255, 255, 0.08)' : '#ffffff',
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid #cbd5e1',
                  color: isDark ? '#38bdf8' : '#170e5e',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 800,
                  fontSize: '12px',
                  transition: 'all 0.15s ease',
                }}
                title={
                  isDark
                    ? t('pos.signage.header.switch_to_light', 'التبديل إلى النمط الفاتح')
                    : t('pos.signage.header.switch_to_dark', 'التبديل إلى النمط السينمائي الداكن')
                }
              >
                <PaletteIcon size={16} color={isDark ? '#38bdf8' : '#170e5e'} />
                <span>{isDark ? 'النمط الفاخر' : 'النمط النقي'}</span>
              </button>
            )}

            {/* Back to System Button */}
            <button
              type="button"
              onClick={onBack}
              style={{
                background: isDark ? '#2563eb' : '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                padding: '8px 14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 800,
                fontSize: '12.5px',
                boxShadow: isDark
                  ? '0 2px 8px rgba(37, 99, 235, 0.35)'
                  : '0 2px 6px rgba(23, 14, 94, 0.25)',
                transition: 'all 0.15s ease',
              }}
              title={t('pos.signage.signage_header.s2', 'العودة للنظام أو لوحة التحكم (Esc)')}
            >
              <ArrowRightIcon size={16} color="#ffffff" strokeWidth={2.5} />
              <span>{t('pos.signage.signage_header.s3', 'العودة للنظام')}</span>
            </button>

            {/* Quick Menu / Sidebar Drawer Button */}
            <button
              type="button"
              onClick={onToggleNavMenu}
              style={{
                background: isDark ? 'rgba(255, 255, 255, 0.06)' : '#f8fafc',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid #cbd5e1',
                color: isDark ? '#f8fafc' : '#1e293b',
                borderRadius: '10px',
                padding: '8px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 700,
                fontSize: '12.5px',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
                transition: 'all 0.15s ease',
              }}
              title={t(
                'pos.signage.signage_header.s4',
                'فتح القائمة الرئيسية والتنقل السريع بين الأقسام'
              )}
            >
              <MenuIcon size={17} color={isDark ? '#38bdf8' : '#170e5e'} strokeWidth={2.2} />
              <span>{t('pos.signage.signage_header.s5', 'القائمة السريعة')}</span>
            </button>

            {onToggleLanguage && (
              <DisplayLanguageToggle
                currentLang={currentLang || 'ar'}
                onToggle={onToggleLanguage}
              />
            )}

            <button
              type="button"
              onClick={onToggleFullscreen}
              style={{
                background: isDark ? 'rgba(255, 255, 255, 0.06)' : '#ffffff',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid #cbd5e1',
                color: isDark ? '#cbd5e1' : '#334155',
                borderRadius: '10px',
                width: '38px',
                height: '38px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
                transition: 'all 0.15s ease',
              }}
              title={t('pos.signage.signage_header.s6', 'ملء الشاشة')}
            >
              <Maximize2Icon size={18} color={isDark ? '#cbd5e1' : '#334155'} />
            </button>

            <button
              type="button"
              onClick={onToggleSettings}
              style={{
                background: isDark ? 'rgba(255, 255, 255, 0.06)' : '#ffffff',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid #cbd5e1',
                color: isDark ? '#38bdf8' : '#170e5e',
                borderRadius: '10px',
                width: '38px',
                height: '38px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
                transition: 'all 0.15s ease',
              }}
              title={t('pos.signage.signage_header.s7', 'إعدادات الشاشة وسرعة العرض')}
            >
              <SettingsIcon size={18} color={isDark ? '#38bdf8' : '#170e5e'} />
            </button>
          </div>
        </div>
      </header>

      {/* Progress Bar for Current Slide */}
      <div
        style={{
          width: '100%',
          height: '4px',
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#e2e8f0',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: isDark
              ? 'linear-gradient(90deg, #38bdf8 0%, #2563eb 50%, #818cf8 100%)'
              : 'linear-gradient(90deg, #170e5e 0%, #2563eb 100%)',
            transition: 'width 0.1s linear',
            boxShadow: isDark ? '0 0 10px rgba(56, 189, 248, 0.5)' : 'none',
          }}
        />
      </div>
    </>
  );
};
