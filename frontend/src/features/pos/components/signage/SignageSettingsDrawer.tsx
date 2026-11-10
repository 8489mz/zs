import { useTranslation } from 'react-i18next';
import React from 'react';
import { SignageTheme } from './types';
import { SettingsIcon, XIcon, PaletteIcon } from '@/shared/components/icons/AppIcons';

interface SignageSettingsDrawerProps {
  onClose: () => void;
  slideIntervalSec: number;
  onSlideIntervalChange: (sec: number) => void;
  viewFilter: 'offers' | 'all';
  onViewFilterChange: (filter: 'offers' | 'all') => void;
  customTickerText: string;
  onCustomTickerTextChange: (text: string) => void;
  /* INV-REST-SIGNAGE-VERTICAL-TRUTH (T11-E): the drawer textarea
   * holds only a merchant-typed ticker; while empty, the effective
   * (neutral / vertical-aware) default shows as its placeholder. */
  tickerPlaceholder?: string;
  theme?: SignageTheme;
  onThemeChange?: (theme: SignageTheme) => void;
}

export const SignageSettingsDrawer: React.FC<SignageSettingsDrawerProps> = ({
  onClose,
  slideIntervalSec,
  onSlideIntervalChange,
  viewFilter,
  onViewFilterChange,
  customTickerText,
  onCustomTickerTextChange,
  tickerPlaceholder,
  theme = 'dark',
  onThemeChange,
}) => {
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  return (
    <div
      dir="rtl"
      style={{
        position: 'absolute',
        top: '70px',
        left: '28px',
        backgroundColor: isDark ? '#0f172a' : '#ffffff',
        border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid #e2e8f0',
        borderRadius: '20px',
        padding: '22px',
        width: '360px',
        boxShadow: isDark
          ? '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
          : '0 20px 40px -10px rgba(15, 23, 42, 0.15)',
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: isDark ? '#ffffff' : '#0f172a',
            fontWeight: 900,
            fontSize: '15px',
          }}
        >
          <SettingsIcon size={17} color={isDark ? '#38bdf8' : '#170e5e'} />
          <span>{t('pos.signage.signage_settings_drawer.s0', 'إعدادات شاشة العروض')}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: isDark ? '#94a3b8' : '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
          }}
        >
          <XIcon size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12px' }}>
        {/* Theme Selector */}
        {onThemeChange && (
          <div>
            <label
              style={{
                display: 'block',
                fontWeight: 800,
                color: isDark ? '#cbd5e1' : '#334155',
                marginBottom: '6px',
              }}
            >
              <PaletteIcon size={14} style={{ display: 'inline', marginLeft: '4px' }} />
              {t('pos.signage.settings.theme_label', 'نمط مظهر الشاشة:')}
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => onThemeChange('dark')}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '8px',
                  border: `1px solid ${theme === 'dark' ? '#38bdf8' : isDark ? '#1e293b' : '#cbd5e1'}`,
                  backgroundColor:
                    theme === 'dark'
                      ? isDark
                        ? 'rgba(56, 189, 248, 0.2)'
                        : '#170e5e'
                      : isDark
                      ? '#1e293b'
                      : '#f8fafc',
                  color: theme === 'dark' ? (isDark ? '#38bdf8' : '#ffffff') : isDark ? '#94a3b8' : '#334155',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {t('pos.signage.settings.theme_dark', 'النمط الفاخر (سينمائي)')}
              </button>
              <button
                type="button"
                onClick={() => onThemeChange('light')}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '8px',
                  border: `1px solid ${theme === 'light' ? '#2563eb' : isDark ? '#1e293b' : '#cbd5e1'}`,
                  backgroundColor:
                    theme === 'light'
                      ? '#2563eb'
                      : isDark
                      ? '#1e293b'
                      : '#f8fafc',
                  color: theme === 'light' ? '#ffffff' : isDark ? '#94a3b8' : '#334155',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {t('pos.signage.settings.theme_light', 'النمط الفاتح (نقي)')}
              </button>
            </div>
          </div>
        )}

        {/* Slide Speed */}
        <div>
          <label
            style={{
              display: 'block',
              fontWeight: 800,
              color: isDark ? '#cbd5e1' : '#334155',
              marginBottom: '4px',
            }}
          >
            {t('pos.signage.signage_settings_drawer.s1', 'سرعة تبديل الشرائح (ثواني):')}
          </label>
          <select
            value={slideIntervalSec}
            onChange={(e) => onSlideIntervalChange(Number(e.target.value))}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '8px',
              backgroundColor: isDark ? '#1e293b' : '#f8fafc',
              color: isDark ? '#ffffff' : '#0f172a',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #cbd5e1',
              fontWeight: 700,
              outline: 'none',
            }}
          >
            <option value={5}>{t('pos.signage.signage_settings_drawer.s2', '5 ثوانٍ (سريع)')}</option>
            <option value={8}>
              {t('pos.signage.signage_settings_drawer.s3', '8 ثوانٍ (افتراضي - متزن)')}
            </option>
            <option value={12}>{t('pos.signage.signage_settings_drawer.s4', '12 ثانية (متأنٍ)')}</option>
            <option value={20}>{t('pos.signage.signage_settings_drawer.s5', '20 ثانية (بطيء)')}</option>
          </select>
        </div>

        {/* Product Source */}
        <div>
          <label
            style={{
              display: 'block',
              fontWeight: 800,
              color: isDark ? '#cbd5e1' : '#334155',
              marginBottom: '4px',
            }}
          >
            {t('pos.signage.signage_settings_drawer.s6', 'مصدر الأصناف المعروضة:')}
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => onViewFilterChange('offers')}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '8px',
                border: `1px solid ${viewFilter === 'offers' ? '#2563eb' : isDark ? '#1e293b' : '#cbd5e1'}`,
                backgroundColor:
                  viewFilter === 'offers'
                    ? '#2563eb'
                    : isDark
                    ? '#1e293b'
                    : '#f8fafc',
                color: viewFilter === 'offers' ? '#ffffff' : isDark ? '#cbd5e1' : '#334155',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t('pos.signage.signage_settings_drawer.s7', 'العروض فقط')}
            </button>
            <button
              type="button"
              onClick={() => onViewFilterChange('all')}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '8px',
                border: `1px solid ${viewFilter === 'all' ? '#2563eb' : isDark ? '#1e293b' : '#cbd5e1'}`,
                backgroundColor:
                  viewFilter === 'all'
                    ? '#2563eb'
                    : isDark
                    ? '#1e293b'
                    : '#f8fafc',
                color: viewFilter === 'all' ? '#ffffff' : isDark ? '#cbd5e1' : '#334155',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t('pos.signage.signage_settings_drawer.s8', 'كل المنتجات')}
            </button>
          </div>
        </div>

        {/* Ticker Text */}
        <div>
          <label
            style={{
              display: 'block',
              fontWeight: 800,
              color: isDark ? '#cbd5e1' : '#334155',
              marginBottom: '4px',
            }}
          >
            {t('pos.signage.signage_settings_drawer.s9', 'نص الشريط المتحرك السفلي:')}
          </label>
          <textarea
            value={customTickerText}
            onChange={(e) => onCustomTickerTextChange(e.target.value)}
            placeholder={tickerPlaceholder}
            rows={3}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '8px',
              backgroundColor: isDark ? '#1e293b' : '#f8fafc',
              color: isDark ? '#ffffff' : '#0f172a',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #cbd5e1',
              resize: 'none',
              fontSize: '11.5px',
              fontWeight: 600,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>
    </div>
  );
};
