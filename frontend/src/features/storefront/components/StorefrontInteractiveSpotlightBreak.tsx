import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';
import type { StorefrontProduct } from '../types/storefront.types';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { ShoppingCartIcon, CheckCircleIcon, EyeIcon } from '@/shared/components/icons/AppIcons';
import { resolveProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { IconWhatsapp } from './StorefrontIcons';

interface StorefrontInteractiveSpotlightBreakProps {
  product: StorefrontProduct;
  dealProducts?: StorefrontProduct[];
  cartQuantity: number;
  cartMap?: Map<number, number>;
  whatsappPhone?: string;
  onAddToCart: (product: StorefrontProduct) => void;
  onUpdateQuantity: (productId: number, qty: number) => void;
  onQuickView?: (product: StorefrontProduct) => void;
}

export const StorefrontInteractiveSpotlightBreak = React.memo(function StorefrontInteractiveSpotlightBreak({
  product: initialProduct,
  dealProducts = [],
  cartQuantity: initialCartQty,
  cartMap,
  whatsappPhone,
  onAddToCart,
  onUpdateQuantity,
  onQuickView,
}: StorefrontInteractiveSpotlightBreakProps) {
  const { t } = useTranslation();
  const { isEn, dir } = useStorefrontLang();
  const pool = dealProducts.length > 0 ? dealProducts.slice(0, 4) : (initialProduct ? [initialProduct] : []);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const product = pool[selectedIndex] || initialProduct;

  const cartQuantity = cartMap ? (cartMap.get(product?.id) || 0) : initialCartQty;
  const [localQty, setLocalQty] = useState(cartQuantity > 0 ? cartQuantity : 1);

  if (!product) return null;

  const autoPhoto = resolveProductPhoto(product.name, product.categoryName);
  const displayPhotoUrl = product.imageUrl || autoPhoto.url;

  const oldPrice = Number(product.originalPrice || Math.round(product.price * 1.25));
  const savings = Math.max(0, oldPrice - product.price);
  const discountPercent = oldPrice > product.price
    ? Math.round(((oldPrice - product.price) / oldPrice) * 100)
    : 20;

  const stockRemaining = Math.max(3, Math.min(25, product.stockQty || 12));
  const claimedPercent = Math.min(92, Math.max(64, 100 - stockRemaining * 2));

  const handleIncrement = () => {
    const current = cartQuantity > 0 ? cartQuantity : localQty;
    const next = current + 1;
    setLocalQty(next);
    if (cartQuantity > 0) onUpdateQuantity(product.id, next);
  };

  const handleDecrement = () => {
    const current = cartQuantity > 0 ? cartQuantity : localQty;
    if (current <= 1) {
      if (cartQuantity > 0) onUpdateQuantity(product.id, 0);
      setLocalQty(1);
      return;
    }
    const next = current - 1;
    setLocalQty(next);
    if (cartQuantity > 0) onUpdateQuantity(product.id, next);
  };

  const handleAddToCartClick = () => {
    onAddToCart(product);
    if (localQty > 1) {
      onUpdateQuantity(product.id, localQty);
    }
  };

  const cleanPhone = (whatsappPhone || '').replace(/[^0-9]/g, '');
  const whatsappUrl = cleanPhone
    ? `https://wa.me/${cleanPhone.startsWith('01') ? `2${cleanPhone}` : cleanPhone}?text=${encodeURIComponent(
        isEn
          ? `Hello, I would like to inquire and order today's deal: ${product.name} for ${product.price}`
          : `مرحباً، أود الاستفسار وطلب صفقة اليوم: ${product.name} بسعر ${product.price}`
      )}`
    : undefined;

  return (
    <section
      dir={dir}
      className="storefront-spotlight-breakaway"
      style={{
        margin: '16px 0',
        background: 'linear-gradient(135deg, #0b0f19 0%, var(--storefront-primary-color, #170e5e) 55%, var(--storefront-primary-hover, #120b4c) 100%)',
        borderRadius: '26px',
        padding: '28px',
        color: '#ffffff',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 16px 36px -8px rgba(15, 23, 42, 0.22)',
      }}
    >
      {/* Top Bar: Deal of the Day Title + Product Switcher Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          paddingBottom: '18px',
          marginBottom: '22px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span
            style={{
              background: '#e11d48',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 900,
              padding: '4px 12px',
              borderRadius: '8px',
              whiteSpace: 'nowrap',
            }}
          >
            {isEn ? 'Deal of the Day' : 'صفقة اليوم'}
          </span>
          <span style={{ fontSize: '13px', color: '#cbd5e1', fontWeight: 600 }}>
            {isEn ? "Save more with today's limited discounts" : 'وفر أكثر مع خصومات اليوم المحدودة'}
          </span>
        </div>

        {pool.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {pool.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedIndex(idx);
                  setLocalQty(1);
                }}
                style={{
                  background: idx === selectedIndex ? '#fbbf24' : 'rgba(255, 255, 255, 0.08)',
                  color: idx === selectedIndex ? '#0f172a' : '#e2e8f0',
                  border: idx === selectedIndex ? 'none' : '1px solid rgba(255, 255, 255, 0.16)',
                  borderRadius: '12px',
                  padding: '0 14px',
                  height: '35px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                  transition: 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease',
                  boxSizing: 'border-box',
                }}
              >
                {isEn ? `Deal #${idx + 1}` : `عرض #${idx + 1}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          alignItems: 'center',
          gap: '28px',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Right Column: Studio Product Stage */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            onClick={() => onQuickView?.(product)}
            style={{
              width: '100%',
              maxWidth: '250px',
              aspectRatio: '1 / 1',
              borderRadius: '20px',
              background: '#ffffff',
              border: 'none',
              padding: '12px',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 16px 32px rgba(0,0,0,0.3)',
              position: 'relative',
              cursor: onQuickView ? 'pointer' : 'default',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                background: '#0f172a',
                color: '#ffffff',
                fontSize: '11.5px',
                fontWeight: 900,
                padding: '4px 10px',
                borderRadius: '8px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {(!product.inStock || product.stockQty <= 0)
                ? (isEn ? 'Out of Stock' : 'نفدت الكمية')
                : t('storefront.spotlight.badge', 'خصم {{percent}}%', { percent: discountPercent })}
            </div>

            <img
              src={displayPhotoUrl}
              alt={product.name}
              onError={(e) => {
                e.currentTarget.src = generatePremiumProductSvg(product.name, product.categoryName);
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
              loading="lazy"
            />
          </div>
        </div>

        {/* Left Column: Details, Stock Progress & Instant Stepper */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Unboxed Metadata Line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#cbd5e1', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: '#fbbf24' }}>{product.categoryName || (isEn ? 'Best Deals' : 'أفضل العروض')}</span>
          </div>

          <h3
            style={{
              margin: 0,
              fontSize: 'clamp(1.25rem, 2.2vw, 1.65rem)',
              fontWeight: 900,
              color: '#ffffff',
              lineHeight: 1.3,
            }}
          >
            {product.name}
          </h3>

          {product.description && (
            <p
              style={{
                margin: 0,
                fontSize: '13.5px',
                color: '#cbd5e1',
                lineHeight: 1.6,
              }}
            >
              {product.description}
            </p>
          )}

          {/* Pricing Row */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: '12px', flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
            {oldPrice > product.price && (
              <span
                style={{
                  fontSize: '15px',
                  color: '#94a3b8',
                  textDecoration: 'line-through',
                  fontWeight: 600,
                }}
              >
                {oldPrice.toLocaleString('en-US')} <CurrencySymbol />
              </span>
            )}

            <div
              style={{
                fontSize: '28px',
                fontWeight: 900,
                color: '#ffffff',
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: '4px',
              }}
            >
              <span>{product.price.toLocaleString('en-US')}</span>
              <span style={{ fontSize: '14px' }}><CurrencySymbol /></span>
            </div>

            {savings > 0 && (
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 800,
                  color: '#4ade80',
                }}
              >
                · {isEn ? 'Save' : 'وفرت'} {savings.toLocaleString('en-US')} <CurrencySymbol />
              </span>
            )}
          </div>

          {/* Interactive Stock Demand Indicator */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              borderRadius: '12px',
              padding: '10px 14px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', fontWeight: 700, marginBottom: '6px' }}>
              <span style={{ color: '#fbbf24' }}>
                {isEn ? `${claimedPercent}% of available stock sold` : `تم بيع ${claimedPercent}% من الكمية المتوفرة`}
              </span>
              <span style={{ color: '#e2e8f0' }}>
                {isEn ? `Only ${stockRemaining} left in stock` : `متبقي ${stockRemaining} فقط بالمخزون`}
              </span>
            </div>
            <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.14)', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${claimedPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
                  borderRadius: '4px',
                }}
              />
            </div>
          </div>

          {/* Stepper + Add to Cart Action Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
            <div
              dir="rtl"
              className="storefront-stepper-control"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: '#ffffff',
                borderRadius: '12px',
                border: '1px solid #E0E3E7',
                padding: '3px',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <button
                type="button"
                onClick={handleIncrement}
                aria-label="زيادة الكمية"
                style={{
                  width: '32px',
                  height: '32px',
                  background: '#f1f5f9',
                  border: '1px solid #E0E3E7',
                  borderRadius: '10px',
                  fontWeight: 800,
                  fontSize: '16px',
                  color: '#0f172a',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                +
              </button>
              <span
                style={{
                  minWidth: '34px',
                  textAlign: 'center',
                  fontWeight: 900,
                  fontSize: '14px',
                  color: '#0f172a',
                  padding: '0 6px',
                }}
              >
                {cartQuantity > 0 ? cartQuantity : localQty}
              </span>
              <button
                type="button"
                onClick={handleDecrement}
                aria-label="إنقاص الكمية"
                style={{
                  width: '32px',
                  height: '32px',
                  background: '#f1f5f9',
                  border: '1px solid #E0E3E7',
                  borderRadius: '10px',
                  fontWeight: 800,
                  fontSize: '16px',
                  color: '#0f172a',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                -
              </button>
            </div>

            <button
              type="button"
              onClick={handleAddToCartClick}
              className="storefront-gpu-btn"
              style={{
                background: cartQuantity > 0 ? '#16a34a' : '#f59e0b',
                color: cartQuantity > 0 ? '#ffffff' : '#0f172a',
                border: 'none',
                borderRadius: '12px',
                padding: '0 14px',
                height: '35px',
                fontSize: '13px',
                fontWeight: 900,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
                boxSizing: 'border-box',
              }}
            >
              {cartQuantity > 0 ? (
                <>
                  <span>{t('storefront.spotlight.in_cart', 'في السلة ({{qty}})', { qty: cartQuantity })}</span>
                  <CheckCircleIcon size={16} color="#ffffff" />
                </>
              ) : (
                <>
                  <span>{t('storefront.spotlight.add_to_cart', 'أضف إلى السلة')}</span>
                  <ShoppingCartIcon size={16} color="#0f172a" />
                </>
              )}
            </button>

            {onQuickView && (
              <button
                type="button"
                onClick={() => onQuickView(product)}
                aria-label="معاينة التفاصيل"
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  color: '#ffffff',
                  border: '1px solid rgba(255,255,255,0.22)',
                  borderRadius: '12px',
                  padding: '0 14px',
                  height: '35px',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  boxSizing: 'border-box',
                }}
              >
                <EyeIcon size={14} color="#ffffff" />
                <span>{t('storefront.spotlight.quick_view', 'التفاصيل')}</span>
              </button>
            )}

            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: 'rgba(37, 211, 102, 0.14)',
                  color: '#4ade80',
                  border: '1px solid rgba(37, 211, 102, 0.3)',
                  borderRadius: '12px',
                  padding: '0 14px',
                  height: '35px',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  boxSizing: 'border-box',
                }}
              >
                <IconWhatsapp size={15} color="#4ade80" />
                <span>{t('storefront.spotlight.whatsapp_order', 'طلب واتساب')}</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
});
