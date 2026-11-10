import React from 'react';
import { useTranslation } from 'react-i18next';
import { SignageTheme } from './types';
import {
  QrCodeIcon,
  ShoppingCartIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';

interface SignageShowroomWelcomeProps {
  storeName: string;
  qrSvgUrl: string;
  theme: SignageTheme;
  hasFilterOffers?: boolean;
  onSwitchToAllProducts?: () => void;
}

/* INV-REST-SIGNAGE-DYNAMIC (T13-H2): the truly-empty board — no
 * offers AND an empty catalog. When the catalog has items the page
 * shows the assorted sample instead and this board never renders.
 * Store name + a neutral no-offers line + the real QR hub + the
 * switch to the full catalog. No invented perks, payment or quality
 * claims — a datum with no source is omitted, not invented. The
 * file and export keep their old name so the page import and the
 * spec import do not churn; no user-visible copy in here names a
 * business identity of any kind. */

export const SignageShowroomWelcome: React.FC<SignageShowroomWelcomeProps> = ({
  storeName,
  qrSvgUrl,
  theme,
  hasFilterOffers,
  onSwitchToAllProducts,
}) => {
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        borderRadius: '24px',
        padding: '36px 44px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        background: isDark
          ? 'linear-gradient(145deg, #0f172a 0%, #0b1120 100%)'
          : 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)',
        border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
        boxShadow: isDark
          ? '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
          : '0 20px 40px -15px rgba(15, 23, 42, 0.07)',
      }}
    >
      {/* Background Ambient Glow for Dark Mode */}
      {isDark && (
        <div
          style={{
            position: 'absolute',
            top: '-20%',
            right: '-10%',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(37, 99, 235, 0.15) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Top Banner / Store Hero */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '18px',
              background: isDark
                ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)'
                : 'linear-gradient(135deg, #170e5e 0%, #2563eb 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isDark
                ? '0 8px 24px rgba(37, 99, 235, 0.35)'
                : '0 8px 24px rgba(23, 14, 94, 0.25)',
              flexShrink: 0,
            }}
          >
            <ShoppingCartIcon size={32} color="#ffffff" />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  padding: '3px 12px',
                  borderRadius: '20px',
                  backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#eef2ff',
                  color: isDark ? '#38bdf8' : '#170e5e',
                  border: isDark ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid #c7d2fe',
                }}
              >
                {t('pos.signage.welcome.board_label', 'لوحة العروض')}
              </span>
            </div>

            <h1
              style={{
                margin: '6px 0 0',
                fontSize: '34px',
                fontWeight: 900,
                color: isDark ? '#ffffff' : '#0f172a',
                letterSpacing: '-0.5px',
              }}
            >
              {storeName}
            </h1>
          </div>
        </div>

        <p
          style={{
            margin: '16px 0 0',
            fontSize: '15px',
            lineHeight: 1.6,
            color: isDark ? '#cbd5e1' : '#475569',
            maxWidth: '650px',
          }}
        >
          {t('pos.signage.welcome.no_offers', 'لا توجد عروض حالياً')}
        </p>
      </div>

      {/* Bottom Action & QR Hub */}
      <div
        style={{
          backgroundColor: isDark ? 'rgba(11, 15, 25, 0.8)' : '#f1f5f9',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #cbd5e1',
          borderRadius: '20px',
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              backgroundColor: '#ffffff',
              padding: '6px',
              borderRadius: '12px',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.15)',
              flexShrink: 0,
            }}
          >
            <img
              src={qrSvgUrl}
              alt="Store QR Code"
              style={{ width: '84px', height: '84px', display: 'block' }}
            />
          </div>

          <div>
            <div
              style={{
                fontSize: '15px',
                fontWeight: 900,
                color: isDark ? '#ffffff' : '#0f172a',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <QrCodeIcon size={18} color={isDark ? '#38bdf8' : '#170e5e'} />
              <span>
                {t('pos.signage.welcome.qr_title', 'تصفح الكتالوج واطلب من هاتفك')}
              </span>
            </div>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: '12px',
                color: isDark ? '#94a3b8' : '#64748b',
                lineHeight: 1.5,
                maxWidth: '440px',
              }}
            >
              {t(
                'pos.signage.welcome.qr_desc',
                'وجّه كاميرا هاتفك نحو رمز الـ QR لتصفح الكتالوج والطلب من هاتفك.'
              )}
            </p>
          </div>
        </div>

        {hasFilterOffers && onSwitchToAllProducts && (
          <button
            type="button"
            onClick={onSwitchToAllProducts}
            style={{
              padding: '12px 22px',
              borderRadius: '12px',
              backgroundColor: isDark ? '#2563eb' : '#170e5e',
              color: '#ffffff',
              border: 'none',
              fontWeight: 800,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: isDark
                ? '0 4px 16px rgba(37, 99, 235, 0.4)'
                : '0 4px 16px rgba(23, 14, 94, 0.25)',
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
          >
            <RefreshCwIcon size={16} color="#ffffff" />
            <span>{t('pos.signage.welcome.show_all_products', 'عرض كل المنتجات')}</span>
          </button>
        )}
      </div>
    </div>
  );
};
