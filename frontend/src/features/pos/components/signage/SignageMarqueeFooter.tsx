import { useTranslation } from 'react-i18next';
import React from 'react';
import { SignageTheme } from './types';

interface SignageMarqueeFooterProps {
  customTickerText: string;
  isPaused: boolean;
  onTogglePause: () => void;
  currentIndex: number;
  totalItems: number;
  theme?: SignageTheme;
  /* INV-REST-SIGNAGE-DYNAMIC (T13-H2): the scrolling ticker text
   * arrives derived from the page (merchant text, else live offer
   * names + percents, else a neutral store-name + QR line). The
   * label describes what is on the board — no business identity. */
}

export const SignageMarqueeFooter: React.FC<SignageMarqueeFooterProps> = ({
  customTickerText,
  isPaused,
  onTogglePause,
  currentIndex,
  totalItems,
  theme = 'dark',
}) => {
  const { t } = useTranslation();
  const isDark = theme === 'dark';
  const MarqueeTag = 'marquee' as any;

  return (
    <footer
      style={{
        backgroundColor: isDark ? '#0b0f19' : '#ffffff',
        borderTop: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
        padding: '10px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        boxShadow: isDark
          ? '0 -4px 20px rgba(0, 0, 0, 0.4)'
          : '0 -2px 10px rgba(15, 23, 42, 0.03)',
        zIndex: 20,
        transition: 'background 0.2s ease',
      }}
    >
      <div
        style={{
          backgroundColor: isDark ? '#2563eb' : '#170e5e',
          color: '#ffffff',
          fontSize: '12.5px',
          fontWeight: 900,
          padding: '5px 14px',
          borderRadius: '8px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: isDark ? '0 2px 10px rgba(37, 99, 235, 0.4)' : 'none',
        }}
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            display: 'inline-block',
          }}
        />
        <span>
          {t('pos.signage.signage_marquee_footer.today_offers', 'عروض اليوم')}
        </span>
      </div>

      {/* Marquee text */}
      <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <MarqueeTag
          behavior="scroll"
          direction="right"
          scrollamount="6"
          style={{
            fontSize: '15px',
            fontWeight: 700,
            color: isDark ? '#e2e8f0' : '#1e293b',
          }}
        >
          {customTickerText}
        </MarqueeTag>
      </div>

      {/* Slide Counter & Pause */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <button
          type="button"
          onClick={onTogglePause}
          style={{
            backgroundColor: isPaused
              ? isDark
                ? 'rgba(239, 68, 68, 0.2)'
                : '#fee2e2'
              : isDark
              ? 'rgba(255, 255, 255, 0.08)'
              : '#f1f5f9',
            color: isPaused
              ? isDark
                ? '#f87171'
                : '#dc2626'
              : isDark
              ? '#cbd5e1'
              : '#334155',
            border: isPaused
              ? isDark
                ? '1px solid rgba(239, 68, 68, 0.4)'
                : '1px solid #fecaca'
              : isDark
              ? '1px solid rgba(255, 255, 255, 0.12)'
              : '1px solid #cbd5e1',
            padding: '5px 14px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 800,
            transition: 'all 0.15s ease',
          }}
        >
          {isPaused
            ? t('pos.signage.signage_marquee_footer.s1', 'استئناف')
            : t('pos.signage.signage_marquee_footer.s2', 'إيقاف مؤقت')}
        </button>

        <span
          style={{
            fontSize: '12.5px',
            color: isDark ? '#94a3b8' : '#64748b',
            fontWeight: 800,
            fontFamily: 'monospace',
          }}
        >
          {totalItems > 0 ? `${currentIndex + 1} / ${totalItems}` : '0/0'}
        </span>
      </div>
    </footer>
  );
};
