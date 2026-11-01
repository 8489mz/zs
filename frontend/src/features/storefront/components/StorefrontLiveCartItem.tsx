import { useStorefrontLang } from '@/i18n';
import { useState } from 'react';
import { Trash2Icon } from '@/shared/components/icons/AppIcons';
import { CartItem } from '../types/storefront.types';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';
import { calculateCartLinePricing } from '../lib/storefront-cart-pricing';
import { resolveProductPhoto } from '../lib/storefront-photo-matcher';
import { isThreeDecimalCurrency, getGlobalSystemCurrency, getGlobalCurrencySymbol } from '@/lib/currencies';

interface StorefrontLiveCartItemProps {
  item: CartItem;
  onUpdateQuantity: (productId: number, qty: number) => void;
}

export function StorefrontLiveCartItem({ item, onUpdateQuantity }: StorefrontLiveCartItemProps) {
  const { t, isEn } = useStorefrontLang();
  const currCode = getGlobalSystemCurrency();
  const isThreeDec = isThreeDecimalCurrency(currCode);
  const activeSymbol = currCode === 'EGP' ? (isEn ? 'EGP' : 'جنيه') : getGlobalCurrencySymbol();

  const formatPriceNumber = (val: number | string | undefined | null): string => {
    const num = Number(val || 0);
    if (isThreeDec) return num.toFixed(3);
    if (currCode === 'EGP') return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    return num.toFixed(2);
  };

  const linePricing = calculateCartLinePricing(item.product, item.quantity, currCode);
  const lineTotal = linePricing.lineTotal;
  const [imageError, setImageError] = useState(false);

  const photo = item.product.imageUrl || resolveProductPhoto(item.product.name, item.product.categoryName)?.url;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 2px',
        borderBottom: '1px solid #f1f5f9',
        background: '#ffffff',
        position: 'relative',
        letterSpacing: '0px',
      }}
    >
      {/* Soft-Rounded Product Thumbnail (Right in RTL) */}
      <div
        style={{
          width: '62px',
          height: '62px',
          borderRadius: '14px',
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
          padding: '5px',
          boxSizing: 'border-box',
        }}
      >
        {photo && !imageError ? (
          <img
            src={photo}
            alt={item.product.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '10px' }}
            onError={() => setImageError(true)}
          />
        ) : (
          <ProductIcon name={item.product.icon || 'box-package'} size={24} color="#0f172a" />
        )}
      </div>

      {/* Product Info Column: Full width for Title on top, Price + Stepper on bottom row */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {/* Full-Width Single-Line Product Name (Not Bold) */}
        <div
          style={{
            fontSize: '13.5px',
            fontWeight: 500,
            color: '#0f172a',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.35,
            letterSpacing: '0px',
          }}
          title={item.product.name}
        >
          {item.product.name}
        </div>

        {/* Subtle Category Label */}
        <div style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 400, letterSpacing: '0px' }}>
          {item.product.categoryName || (isEn ? 'Authentic Product' : t('storefront.storefront_live_cart_item.default_cat', 'منتج أصلي'))}
        </div>

        {/* Bottom Row: Price on Right + Circular Stepper on Left */}
        <div
          style={{
            marginTop: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          {/* Price & Savings */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', letterSpacing: '0px' }}>
            {linePricing.savings > 0 && (
              <span style={{ textDecoration: 'line-through', color: '#cbd5e1', fontSize: '11.5px', fontWeight: 400, letterSpacing: '0px' }}>
                {formatPriceNumber(linePricing.originalLineTotal)} {activeSymbol}
              </span>
            )}
            <span style={{ fontSize: '14px', color: '#0f172a', fontWeight: 600, letterSpacing: '0px' }}>
              {formatPriceNumber(lineTotal)} {activeSymbol}
            </span>
            {linePricing.isBogoApplied && (
              <span
                style={{
                  fontSize: '10px',
                  background: '#dcfce7',
                  color: '#166534',
                  padding: '1px 6px',
                  borderRadius: '6px',
                  fontWeight: 500,
                  letterSpacing: '0px',
                }}
              >
                {linePricing.offerBadge}
              </span>
            )}
          </div>

          {/* Modern Circular Stepper Controls (Left in RTL) */}
          {/* CRITICAL: Follow RULE[AGENTS_md] Section 5 for RTL: [+] on Right, Quantity in Center, [-] on Left */}
          <div
            dir="rtl"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              flexShrink: 0,
            }}
          >
            {/* [+] Filled Dark Squircle on the RIGHT in RTL */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdateQuantity(Number(item.product.id), item.quantity + 1);
              }}
              title={t('storefront.storefront_live_cart_item.s1', 'زيادة الكمية')}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                border: 'none',
                background: '#0f172a',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 600,
                padding: 0,
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)',
                transition: 'transform 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              +
            </button>

            {/* Quantity in CENTER */}
            <span
              style={{
                minWidth: '18px',
                textAlign: 'center',
                fontSize: '13px',
                fontWeight: 600,
                color: '#0f172a',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {item.quantity}
            </span>

            {/* [-] Outlined Squircle on the LEFT in RTL */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdateQuantity(Number(item.product.id), item.quantity - 1);
              }}
              title={
                item.quantity === 1
                  ? t('storefront.storefront_live_cart_item.s2', 'حذف من السلة')
                  : t('storefront.storefront_live_cart_item.s3', 'تقليل الكمية')
              }
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                border: item.quantity === 1 ? '1px solid #fecaca' : '1px solid #cbd5e1',
                background: item.quantity === 1 ? '#fef2f2' : '#ffffff',
                color: item.quantity === 1 ? '#ef4444' : '#0f172a',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 600,
                padding: 0,
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = item.quantity === 1 ? '#f87171' : '#0f172a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = item.quantity === 1 ? '#fecaca' : '#cbd5e1';
              }}
            >
              {item.quantity === 1 ? <Trash2Icon size={12.5} /> : '−'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


