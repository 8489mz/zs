import { useTranslation } from 'react-i18next';
import React from 'react';
import { SignagePromoItem, SignageTheme } from './types';
import { TagIcon, PackageIcon } from '@/shared/components/icons/AppIcons';

interface SignageHeroCardProps {
  activeItem: SignagePromoItem;
  currentIndex: number;
  totalItems: number;
  currencyCode: string;
  theme?: SignageTheme;
  /* INV-REST-SIGNAGE-DYNAMIC (T13-H2): the card shows the real
   * product (name / prices / discount / merchant badge / image)
   * plus an availability line derived from the product's real
   * category. No invented quality, freshness, delivery or
   * inspection claims — there is no data source for them. */
}

export const SignageHeroCard: React.FC<SignageHeroCardProps> = ({
  activeItem,
  currentIndex,
  totalItems,
  currencyCode,
  theme = 'dark',
}) => {
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        borderRadius: '24px',
        padding: '30px 36px',
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
          ? '0 25px 50px -12px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
          : '0 20px 40px -12px rgba(15, 23, 42, 0.08)',
      }}
    >
      {/* Background Radial Glow */}
      {isDark && (
        <div
          style={{
            position: 'absolute',
            top: '-15%',
            right: '-10%',
            width: '450px',
            height: '450px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(37, 99, 235, 0.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Top Header: Badges & Slide Number */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          {/* Badges Left/Right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                backgroundColor: isDark ? '#2563eb' : '#170e5e',
                color: '#ffffff',
                fontSize: '13.5px',
                fontWeight: 800,
                padding: '6px 16px',
                borderRadius: '20px',
                boxShadow: isDark
                  ? '0 4px 14px rgba(37, 99, 235, 0.4)'
                  : '0 4px 14px rgba(23, 14, 94, 0.25)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <TagIcon size={15} color="#ffffff" />
              <span>{activeItem.badge}</span>
            </span>

            <span
              style={{
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#f1f5f9',
                color: isDark ? '#cbd5e1' : '#475569',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #e2e8f0',
                fontSize: '13.5px',
                fontWeight: 700,
                padding: '6px 16px',
                borderRadius: '20px',
              }}
            >
              {activeItem.categoryName}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {activeItem.discountPercent > 0 && (
              <div
                style={{
                  backgroundColor: isDark ? 'rgba(239, 68, 68, 0.2)' : '#fee2e2',
                  color: isDark ? '#f87171' : '#dc2626',
                  border: isDark ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid #fecaca',
                  fontSize: '15px',
                  fontWeight: 900,
                  padding: '6px 16px',
                  borderRadius: '14px',
                  letterSpacing: '0.3px',
                }}
              >
                {t('pos.signage.signage_hero_card.s0', 'خصم')} {activeItem.discountPercent}%
              </div>
            )}

            <div
              style={{
                backgroundColor: isDark ? 'rgba(15, 23, 42, 0.8)' : '#f8fafc',
                border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #e2e8f0',
                padding: '5px 12px',
                borderRadius: '12px',
                fontSize: '13px',
                color: isDark ? '#94a3b8' : '#64748b',
                fontWeight: 800,
              }}
            >
              {currentIndex + 1} {t('pos.signage.signage_hero_card.s1', 'من')} {totalItems}
            </div>
          </div>
        </div>

        {/* Center Showcase Deck */}
        <div
          style={{
            marginTop: '22px',
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.65)' : '#f8fafc',
            border: isDark ? '1px solid rgba(255, 255, 255, 0.07)' : '1px solid #e2e8f0',
            borderRadius: '20px',
            padding: '28px',
            display: 'flex',
            alignItems: 'center',
            gap: '28px',
            boxShadow: isDark
              ? 'inset 0 1px 0 rgba(255, 255, 255, 0.03)'
              : 'inset 0 1px 2px rgba(15, 23, 42, 0.02)',
          }}
        >
          {/* Product Image / Visual Showcase */}
          <div
            style={{
              width: '150px',
              height: '150px',
              borderRadius: '20px',
              background: isDark
                ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
                : 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              overflow: 'hidden',
              boxShadow: isDark
                ? '0 10px 25px rgba(0, 0, 0, 0.4)'
                : '0 8px 20px rgba(15, 23, 42, 0.06)',
            }}
          >
            {activeItem.imageUrl ? (
              <img
                src={activeItem.imageUrl}
                alt={activeItem.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  padding: '10px',
                }}
              />
            ) : (
              <TagIcon
                size={64}
                color={isDark ? '#38bdf8' : '#170e5e'}
                strokeWidth={1.8}
              />
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: '36px',
                fontWeight: 900,
                lineHeight: 1.3,
                color: isDark ? '#ffffff' : '#0f172a',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                letterSpacing: '-0.3px',
              }}
              title={activeItem.name}
            >
              {activeItem.name}
            </h2>

            {activeItem.barcode && (
              <div
                style={{
                  fontSize: '13px',
                  color: isDark ? '#94a3b8' : '#64748b',
                  marginTop: '8px',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#ffffff',
                  display: 'inline-block',
                  padding: '4px 12px',
                  borderRadius: '8px',
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
                }}
              >
                {t('pos.signage.signage_hero_card.s2', 'كود الصنف:')} {activeItem.barcode}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Bottom Mega Price Showcase */}
      <div
        style={{
          backgroundColor: isDark ? 'rgba(11, 15, 25, 0.9)' : '#ffffff',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '2px solid #e2e8f0',
          borderRadius: '20px',
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: isDark
            ? '0 10px 30px rgba(0, 0, 0, 0.4)'
            : '0 8px 24px rgba(15, 23, 42, 0.04)',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div>
          <span
            style={{
              fontSize: '13px',
              color: isDark ? '#94a3b8' : '#64748b',
              fontWeight: 700,
            }}
          >
            {t('pos.signage.signage_hero_card.s5', 'السعر السابق')}
          </span>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: isDark ? '#64748b' : '#94a3b8',
              textDecoration: 'line-through',
              marginTop: '4px',
            }}
          >
            {activeItem.originalPrice.toFixed(2)} {currencyCode}
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          {activeItem.savingAmount > 0 && (
            <span
              style={{
                fontSize: '13.5px',
                fontWeight: 900,
                color: isDark ? '#34d399' : '#170e5e',
                backgroundColor: isDark ? 'rgba(52, 211, 153, 0.15)' : '#eef2ff',
                border: isDark ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid #c7d2fe',
                padding: '4px 16px',
                borderRadius: '20px',
                display: 'inline-block',
              }}
            >
              {t('pos.signage.signage_hero_card.s6', 'وفر')} {activeItem.savingAmount.toFixed(2)}{' '}
              {currencyCode}
            </span>
          )}
          <div
            style={{
              fontSize: '56px',
              fontWeight: 900,
              color: isDark ? '#38bdf8' : '#170e5e',
              letterSpacing: '-1.5px',
              lineHeight: 1.1,
              marginTop: '4px',
            }}
          >
            {activeItem.promoPrice.toFixed(2)}{' '}
            <span style={{ fontSize: '22px', fontWeight: 800 }}>{currencyCode}</span>
          </div>
        </div>

        {/* Availability — the product's real category, omitted when
          * the product has none (T13-H2: no invented copy). */}
        <div>
          {activeItem.categoryName ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: isDark ? '#2563eb' : '#170e5e',
                color: '#ffffff',
                fontSize: '14.5px',
                fontWeight: 800,
                padding: '12px 22px',
                borderRadius: '12px',
                boxShadow: isDark
                  ? '0 6px 18px rgba(37, 99, 235, 0.4)'
                  : '0 4px 14px rgba(23, 14, 94, 0.25)',
              }}
            >
              <PackageIcon size={18} color="#ffffff" />
              <span>{`من قسم ${activeItem.categoryName}`}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
