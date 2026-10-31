import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import type { StorefrontProduct } from '../types/storefront.types';
import { resolveProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { IconShoppingCart, IconWhatsapp } from './StorefrontIcons';
import { EyeIcon } from '@/shared/components/icons/AppIcons';

interface StorefrontDealSpotlightProps {
  product: StorefrontProduct;
  cartQuantity: number;
  whatsappPhone?: string;
  isSmartDeal?: boolean;
  categoryBadge?: string;
  onAddToCart: (product: StorefrontProduct) => void;
  onUpdateQuantity: (productId: number, newQty: number) => void;
  onQuickView?: (product: StorefrontProduct) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (productId: number) => void;
}

function formatCategoryName(name?: string): string {
  if (!name) return 'قسم عام';
  const trimmed = name.trim();
  if (trimmed.includes(' - ')) {
    const parts = trimmed.split(' - ').map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 1] || trimmed;
  }
  return trimmed;
}

export function StorefrontDealSpotlight({
  product,
  cartQuantity,
  whatsappPhone,
  isSmartDeal,
  categoryBadge: _categoryBadge,
  onAddToCart,
  onUpdateQuantity,
  onQuickView,
  isFavorite: isFavoriteProp,
  onToggleFavorite,
}: StorefrontDealSpotlightProps) {
  const { t } = useTranslation();
  const [localFavorite, setLocalFavorite] = useState(() => {
    try {
      return localStorage.getItem(`zs_fav_${product.id}`) === 'true';
    } catch {
      return false;
    }
  });

  const isFavorite = isFavoriteProp !== undefined ? isFavoriteProp : localFavorite;

  const handleToggleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleFavorite) {
      onToggleFavorite(product.id);
    } else {
      setLocalFavorite((prev) => {
        const next = !prev;
        try {
          localStorage.setItem(`zs_fav_${product.id}`, String(next));
        } catch {}
        return next;
      });
    }
  };

  const isOutOfStock = product.inStock !== undefined ? !product.inStock : product.stockQty <= 0;
  const isZeroPrice = product.price <= 0;
  const hasRealOffer = Boolean(product.hasDiscount && product.originalPrice && product.originalPrice > product.price);
  const oldPrice = hasRealOffer
    ? Number(product.originalPrice)
    : (!isZeroPrice && isSmartDeal ? Math.round(product.price * 1.15) : 0);

  const discountPercent = oldPrice > product.price
    ? Math.round(((oldPrice - product.price) / oldPrice) * 100)
    : 0;

  // const savingsAmount = oldPrice > product.price ? oldPrice - product.price : 0;

  const autoPhoto = resolveProductPhoto(product.name, product.categoryName);
  const displayPhotoUrl = product.imageUrl || autoPhoto.url;

  const cleanPhone = (whatsappPhone || '').replace(/[^0-9]/g, '');
  const formattedPhone = cleanPhone.startsWith('01') ? `2${cleanPhone}` : cleanPhone;

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOutOfStock) return;
    onAddToCart(product);
  };

  return (
    <div
      className="storefront-deal-spotlight-card"
      style={{
        background: '#ffffff',
        border: '1px solid #edf1f7',
        borderRadius: '30px',
        padding: '24px',
        display: 'grid',
        gridTemplateColumns: 'minmax(300px, 420px) minmax(0, 1fr)',
        gap: '28px',
        alignItems: 'center',
        direction: 'rtl',
        position: 'relative',
        boxShadow: '0 4px 20px rgba(15, 23, 42, 0.04)',
      }}
    >
      <style>{`
        @media (max-width: 860px) {
          .storefront-deal-spotlight-card {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
            padding: 14px !important;
            border-radius: 20px !important;
          }
          .storefront-deal-spotlight-photo-box {
            max-height: 280px !important;
            border-radius: 18px !important;
          }
          .storefront-deal-spotlight-title {
            font-size: 17px !important;
          }
          .storefront-deal-badges-grid {
            grid-template-columns: 1fr !important;
            gap: 6px !important;
          }
        }
      `}</style>

      {/* 1. Product Photo Box (Right side in RTL) */}
      <div
        className="storefront-deal-spotlight-photo-box"
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          maxHeight: '400px',
          borderRadius: '24px',
          overflow: 'hidden',
          background: '#f4f6fa',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          boxSizing: 'border-box',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
        }}
      >
        <img
          src={displayPhotoUrl}
          alt={product.name}
          onClick={() => onQuickView?.(product)}
          onError={(e) => {
            e.currentTarget.src = generatePremiumProductSvg(product.name, product.categoryName);
          }}
          style={{
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            cursor: onQuickView ? 'pointer' : 'default',
            transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.04)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        />

        {/* Discount Badge on Top Right */}
        {discountPercent > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: '#CC0C39',
              color: '#ffffff',
              fontSize: '11.5px',
              fontWeight: 500,
              padding: '3px 8px',
              borderRadius: '6px',
              boxShadow: 'none',
              filter: 'none',
              textShadow: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              zIndex: 2,
            }}
          >
            <span>{t('storefront.storefront_deal_spotlight.s0', 'خصم')} {discountPercent}%</span>
          </span>
        )}

        {/* Favorite Heart Button on Top Left */}
        <button
          type="button"
          className="sf-deal-fav-btn"
          onClick={handleToggleFav}
          aria-label={isFavorite ? t('storefront.storefront_deal_spotlight.s1', 'إزالة من المفضلة') : t('storefront.storefront_deal_spotlight.s2', 'إضافة للمفضلة')}
          style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            width: '34px',
            height: '34px',
            borderRadius: '10px',
            padding: 0,
            margin: 0,
            background: '#ffffff',
            border: '1px solid #E0E3E7',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
            zIndex: 2,
            transition: 'transform 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill={isFavorite ? '#ef4444' : 'none'}
            stroke={isFavorite ? '#ef4444' : '#475569'}
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      </div>

      {/* 2. Product Specs, Price, Actions & Trust Guarantees (Left in RTL) */}
      <div
        className="storefront-deal-spotlight-details"
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          justifyContent: 'center',
          gap: '14px',
        }}
      >
        {/* Category */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '12px',
              color: '#64748b',
              fontWeight: 500,
            }}
          >
            {formatCategoryName(product.categoryName)}
          </span>
        </div>

        {/* Product Title */}
        <h3
          className="storefront-deal-spotlight-title"
          onClick={() => onQuickView?.(product)}
          style={{
            margin: '0',
            fontSize: 'clamp(19px, 2vw, 23px)',
            fontWeight: 600,
            color: '#0f172a',
            lineHeight: '1.35',
            cursor: onQuickView ? 'pointer' : 'default',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => onQuickView && (e.currentTarget.style.color = 'var(--storefront-primary-color, #170e5e)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#0f172a')}
        >
          {product.name}
        </h3>

        {/* Product Description */}
        <p
          className="storefront-deal-description"
          style={{
            margin: '0',
            fontSize: '13px',
            color: '#64748b',
            lineHeight: '1.6',
            textAlign: 'justify',
            textJustify: 'inter-word',
            textAlignLast: 'start',
          }}
        >
          {product.description || t('storefront.storefront_deal_spotlight.s6', 'استفد من هذا العرض الحصري المخفض مع ضمان الجودة الكامل والدفع عند الاستلام والتوصيل المباشر.')}
        </p>

        {/* Price Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            direction: 'ltr',
            justifyContent: 'flex-start',
            gap: '6px',
            margin: '2px 0 4px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#0f172a',
              }}
            >
              <CurrencySymbol />
            </span>
            <span
              className="storefront-deal-price-val"
              style={{
                fontSize: '24px',
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: '-0.3px',
                lineHeight: 1,
              }}
            >
              {Number(product.price || 0).toLocaleString()}
            </span>
          </div>
          {oldPrice > product.price && (
            <span
              style={{
                fontSize: '14px',
                color: '#94a3b8',
                textDecoration: 'line-through',
                fontWeight: 500,
                marginLeft: '4px',
              }}
            >
              {oldPrice.toLocaleString()}
            </span>
          )}
        </div>

        {/* Action Controls: Stepper vs Add to Cart + WhatsApp */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {cartQuantity > 0 ? (
            /* Strict RTL Stepper Standard: [+] first (right), quantity in middle, [-] last (left) */
            <div
              className="storefront-deal-stepper"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--storefront-primary-color, #170e5e)',
                borderRadius: '12px',
                padding: '4px',
                height: '42px',
                boxSizing: 'border-box',
                minWidth: '180px',
                flex: '1 1 180px',
                boxShadow: '0 2px 8px var(--storefront-primary-subtle, rgba(23, 14, 94, 0.2))',
              }}
            >
              {/* Increase button (+) on the RIGHT in RTL */}
              <button
                type="button"
                onClick={() => onUpdateQuantity(product.id, cartQuantity + 1)}
                aria-label={t('storefront.storefront_deal_spotlight.s19', 'زيادة الكمية')}
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.22)',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.35)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.22)')}
              >
                +
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span
                  style={{
                    fontSize: '15px',
                    fontWeight: 900,
                    color: '#ffffff',
                    lineHeight: '1.2',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {cartQuantity}
                </span>
                <span style={{ fontSize: '10.5px', color: 'rgba(255, 255, 255, 0.9)', fontWeight: 600 }}>{t('storefront.storefront_deal_spotlight.s20', 'بالسلة')}</span>
              </div>

              {/* Decrease button (-) on the LEFT in RTL */}
              <button
                type="button"
                onClick={() => onUpdateQuantity(product.id, cartQuantity - 1)}
                aria-label={t('storefront.storefront_deal_spotlight.s21', 'إنقاص الكمية')}
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.22)',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.35)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.22)')}
              >
                -
              </button>
            </div>
          ) : (
            <button
              className="storefront-deal-add-btn"
              type="button"
              onClick={handleAdd}
              disabled={isOutOfStock}
              style={{
                flex: '1 1 200px',
                height: '36px',
                borderRadius: '12px',
                background: isOutOfStock ? '#e2e8f0' : 'var(--storefront-primary-color, #170e5e)',
                color: isOutOfStock ? '#64748b' : '#ffffff',
                border: isOutOfStock ? '1px solid #cbd5e1' : '1px solid var(--storefront-primary-color, #170e5e)',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: isOutOfStock ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                transition: 'filter 0.15s ease, transform 0.15s ease',
              }}
              onMouseEnter={(e) => !isOutOfStock && (e.currentTarget.style.filter = 'brightness(1.12)')}
              onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
            >
              <span>{isOutOfStock ? 'غير متوفر' : t('storefront.storefront_deal_spotlight.s23', 'أضف للسلة الآن')}</span>
              {!isOutOfStock && <IconShoppingCart size={16} color="#ffffff" strokeWidth={2.2} />}
            </button>
          )}

          {/* WhatsApp Direct Inquiry */}
          {formattedPhone && (
            <a
              className="storefront-deal-wa-btn"
              href={`https://wa.me/${formattedPhone}?text=${encodeURIComponent(`مرحباً، أود الاستفسار عن: ${product.name}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                height: '36px',
                padding: '0 16px',
                borderRadius: '12px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                color: '#166534',
                fontSize: '12.5px',
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#dcfce7';
                e.currentTarget.style.borderColor = '#86efac';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f0fdf4';
                e.currentTarget.style.borderColor = '#bbf7d0';
              }}
            >
              <IconWhatsapp size={16} color="#25D366" />
              <span>{t('storefront.storefront_deal_spotlight.s24', 'طلب عبر واتساب')}</span>
            </a>
          )}

          {/* Quick View Link */}
          {onQuickView && (
            <button
              type="button"
              className="storefront-btn-neutral"
              onClick={() => onQuickView(product)}
              style={{
                height: '36px',
                padding: '0 16px',
                borderRadius: '12px',
                border: '1px solid #dadce0',
                background: '#ffffff',
                color: '#1f1f1f',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#cbd5e1';
                e.currentTarget.style.background = '#f0f4f9';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#dadce0';
                e.currentTarget.style.background = '#ffffff';
              }}
            >
              <EyeIcon size={14} />
              <span>{t('storefront.storefront_deal_spotlight.s25', 'المواصفات')}</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
