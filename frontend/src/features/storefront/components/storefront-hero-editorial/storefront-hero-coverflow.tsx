import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { resolveProductPhoto, generatePremiumProductSvg } from '../../lib/storefront-photo-matcher';
import { IconCheckCircle, IconShoppingCart } from '../StorefrontIcons';
import { getCardSlotMetrics } from './card-slot-metrics';
import { buildPerspectiveCardPath } from './perspective-card-path';
import { CARD_BADGES_AR, CARD_BADGES_EN } from './storefront-hero-badges';
import type { StorefrontInfo, StorefrontProduct } from '../../types/storefront.types';

export interface StorefrontHeroCoverflowProps {
  orderedDeck: { product: StorefrontProduct; originalIdx: number }[];
  isEn: boolean;
  info: StorefrontInfo;
  dir: 'ltr' | 'rtl';
  setCenterIdx: React.Dispatch<React.SetStateAction<number>>;
  onQuickView: (product: StorefrontProduct) => void;
  handleInstantAdd: (e: React.MouseEvent, product: StorefrontProduct) => void;
  justAddedId: number | null;
}

export function StorefrontHeroCoverflow(props: StorefrontHeroCoverflowProps) {
  const { orderedDeck, isEn, info, dir, setCenterIdx, onQuickView, handleInstantAdd, justAddedId } = props;
  return (
    <>
    {/* Centerpiece: Crisp 2D Vector Perspective Coverflow Stage (Zero bitmap blur on cards, text, or images) */}
    <div
      dir="ltr"
      className="storefront-fanned-deck"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        height: '336px',
        position: 'relative',
        padding: '10px 16px 24px',
        maxWidth: '100%',
        zIndex: 4,
        flexWrap: 'nowrap',
      }}
    >
      {orderedDeck.map((item, slotIdx) => {
        const { product, originalIdx } = item;
        const midSlot = Math.floor(orderedDeck.length / 2);
        const offset = slotIdx - midSlot;
        const metrics = getCardSlotMetrics(offset);
        const isHighlighted = metrics.isHighlighted;

        const autoPhoto = resolveProductPhoto(product.name, product.categoryName);
        const photoUrl = product.imageUrl || autoPhoto.url;
        const isOutOfStock = !product.inStock || product.stockQty <= 0;
        const hasDiscount = Boolean(
          (product.hasDiscount && product.discountPercent && product.discountPercent > 0) ||
          (product.originalPrice && Number(product.originalPrice) > Number(product.price))
        );
        const computedDiscount = product.discountPercent || (
          product.originalPrice && Number(product.originalPrice) > Number(product.price)
            ? Math.round(((Number(product.originalPrice) - Number(product.price)) / Number(product.originalPrice)) * 100)
            : 0
        );
        const realBadge =
          product.offerBadge ||
          (hasDiscount && computedDiscount > 0
            ? isEn
              ? `${computedDiscount}% OFF`
              : `خصم ${computedDiscount}%`
            : '');
        const activeBadges = isEn ? CARD_BADGES_EN : CARD_BADGES_AR;
        const fallbackBadge = info?.smartDealsEnabled
          ? activeBadges[originalIdx % activeBadges.length]
          : isHighlighted
          ? isEn
            ? 'Our Pick'
            : 'مختاراتنا'
          : '';
        const badgeText = isOutOfStock ? (isEn ? 'Out of Stock' : 'نفدت الكمية') : realBadge || fallbackBadge;

        const svgPad = 18;
        const svgW = metrics.width + svgPad * 2;
        const svgH = metrics.height + svgPad * 2;
        const cornerRadius = offset === 0 ? 22 : 19;

        const mainCardPath = buildPerspectiveCardPath(
          metrics.width,
          metrics.height,
          metrics.slantLeft,
          metrics.slantRight,
          cornerRadius,
          svgPad,
          svgPad
        );
        const shadowOuterPath = buildPerspectiveCardPath(
          metrics.width,
          metrics.height,
          metrics.slantLeft,
          metrics.slantRight,
          cornerRadius + 1,
          svgPad,
          svgPad + (isHighlighted ? 12 : 8)
        );
        const shadowMidPath = buildPerspectiveCardPath(
          metrics.width,
          metrics.height,
          metrics.slantLeft,
          metrics.slantRight,
          cornerRadius,
          svgPad,
          svgPad + (isHighlighted ? 6 : 4)
        );
        const shadowCorePath = buildPerspectiveCardPath(
          metrics.width,
          metrics.height,
          metrics.slantLeft,
          metrics.slantRight,
          cornerRadius,
          svgPad,
          svgPad + 2
        );

        // Subtle vertical alignment for top badges and bottom footer to follow the perspective curve naturally
        const rightSideSlantOffset = Math.round(metrics.slantRight * 0.55);
        const leftSideSlantOffset = Math.round(metrics.slantLeft * 0.55);

        const hasRealOffer = Boolean(
          product.hasDiscount && product.originalPrice && product.originalPrice > product.price
        );
        const oldPrice = hasRealOffer
          ? Number(product.originalPrice)
          : product.price > 0
          ? Math.round(product.price * 1.22)
          : 0;

        return (
          <div
            key={`${product.id}-${slotIdx}`}
            dir={dir}
            className={`storefront-coverflow-card ${isHighlighted ? 'is-highlighted' : ''}`}
            onClick={() => {
              if (offset !== 0 && orderedDeck.length >= 7) {
                setCenterIdx(originalIdx);
              }
              onQuickView(product);
            }}
            style={{
              width: `${metrics.width}px`,
              height: `${metrics.height}px`,
              marginTop: `${metrics.marginTop}px`,
              background: 'transparent',
              border: 'none',
              position: 'relative',
              cursor: 'pointer',
              overflow: 'visible',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: `${metrics.paddingTop}px ${metrics.paddingX}px ${metrics.paddingBottom}px`,
              boxSizing: 'border-box',
              zIndex: metrics.zIndex,
              flexShrink: 0,
            }}
          >
            {/* Analytical 2D Vector Perspective Card Frame & Multi-Layer Ambient Shadow (Zero pixelation) */}
            <svg
              className="sf-coverflow-svg"
              width={svgW}
              height={svgH}
              viewBox={`0 0 ${svgW} ${svgH}`}
              shapeRendering="geometricPrecision"
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: `-${svgPad}px`,
                left: `-${svgPad}px`,
                width: `${svgW}px`,
                height: `${svgH}px`,
                pointerEvents: 'none',
                zIndex: 0,
                overflow: 'visible',
              }}
            >
              <path
                d={shadowOuterPath}
                fill={isHighlighted ? 'rgba(15, 23, 42, 0.055)' : 'rgba(15, 23, 42, 0.032)'}
              />
              <path
                d={shadowMidPath}
                fill={isHighlighted ? 'rgba(15, 23, 42, 0.065)' : 'rgba(15, 23, 42, 0.042)'}
              />
              <path
                d={shadowCorePath}
                fill={isHighlighted ? 'rgba(15, 23, 42, 0.045)' : 'rgba(15, 23, 42, 0.028)'}
              />
              <path
                className="sf-coverflow-stroke"
                d={mainCardPath}
                fill="#ffffff"
                stroke={isHighlighted ? '#93c5fd' : '#dce3ec'}
                strokeWidth={isHighlighted ? '1.6' : '1.25'}
                strokeLinejoin="round"
              />
            </svg>

            {/* Card Header: Badge - Only render if badgeText has actual content */}
            <div
              className="sf-coverflow-header"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                position: 'relative',
                zIndex: 2,
                minHeight: '22px',
              }}
            >
              {badgeText && badgeText.trim() ? (
                <span
                  className="sf-coverflow-badge"
                  style={{
                    background: isOutOfStock
                      ? '#991b1b'
                      : isHighlighted
                      ? '#dc2626'
                      : '#ef4444',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: metrics.badgeFontSize,
                    fontWeight: 700,
                    padding: offset === 0 ? '4px 10px' : '3.5px 8px',
                    borderRadius: '8px',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.2,
                    marginTop: `${rightSideSlantOffset}px`,
                    boxShadow: isHighlighted
                      ? '0 3px 8px rgba(220, 38, 38, 0.28)'
                      : '0 2px 5px rgba(239, 68, 68, 0.18)',
                  }}
                >
                  {badgeText}
                </span>
              ) : null}
            </div>

            {/* Product Artwork Container (100% Native 1:1 Vector Rendering — Zero scale() bitmap blur) */}
            <div
              style={{
                width: '100%',
                flex: 1,
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: offset === 0 ? '6px 6px' : '4px 4px',
                boxSizing: 'border-box',
                position: 'relative',
                zIndex: 2,
              }}
            >
              <img
                src={photoUrl}
                alt={product.name}
                loading="eager"
                decoding="async"
                draggable={false}
                onError={(e) => {
                  e.currentTarget.src = generatePremiumProductSvg(product.name, product.categoryName);
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  transform: 'translate3d(0, 0, 0)',
                  backfaceVisibility: 'hidden',
                }}
              />
            </div>

            {/* Card Footer: Product Name on top, Price (before & after) opposite Cart button below */}
            <div
              className="sf-coverflow-footer"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: offset === 0 ? '6px' : '5px',
                borderTop: '1px solid #e2e8f0',
                paddingTop: offset === 0 ? '8px' : '6px',
                marginBottom: `${Math.max(rightSideSlantOffset, leftSideSlantOffset)}px`,
                position: 'relative',
                zIndex: 2,
              }}
            >
              {/* Product Title (Above) */}
              <span
                className="sf-coverflow-title"
                style={{
                  fontSize: metrics.titleFontSize,
                  fontWeight: 700,
                  color: '#0f172a',
                  lineHeight: 1.35,
                  textAlign: isEn ? 'left' : 'right',
                  width: '100%',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
                title={product.name}
              >
                {product.name}
              </span>

              {/* Bottom Row: Add to Cart Button opposite Price */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '4px',
                }}
              >
                <button
                  type="button"
                  className="sf-coverflow-cart-btn"
                  onClick={(e) => handleInstantAdd(e, product)}
                  disabled={isOutOfStock}
                  style={{
                    width: `${metrics.cartBtnSize}px`,
                    height: `${metrics.cartBtnSize}px`,
                    borderRadius: '9px',
                    background:
                      justAddedId === product.id
                        ? '#16a34a'
                        : isOutOfStock
                        ? '#f1f3f4'
                        : isHighlighted
                        ? 'var(--storefront-primary-color, #2d68c4)'
                        : '#ffffff',
                    color:
                      justAddedId === product.id || isHighlighted
                        ? '#ffffff'
                        : isOutOfStock
                        ? '#94a3b8'
                        : 'var(--storefront-primary-color, #2d68c4)',
                    border:
                      justAddedId === product.id || isHighlighted
                        ? 'none'
                        : '1px solid #E0E3E7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: isOutOfStock ? 'not-allowed' : 'pointer',
                    flexShrink: 0,
                    transition: 'background-color 0.16s ease, color 0.16s ease',
                  }}
                  title={isEn ? 'Add to Cart' : 'أضف للسلة'}
                >
                  {justAddedId === product.id ? (
                    <IconCheckCircle size={offset === 0 ? 14 : 13} />
                  ) : (
                    <IconShoppingCart size={offset === 0 ? 13 : 12} />
                  )}
                </button>

                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'baseline',
                    gap: '4px',
                    flexWrap: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {oldPrice > product.price && (
                    <span
                      className="sf-coverflow-oldprice"
                      style={{
                        fontSize: offset === 0 ? '10.5px' : '9.5px',
                        fontWeight: 500,
                        color: '#94a3b8',
                        textDecoration: 'line-through',
                        whiteSpace: 'nowrap',
                        lineHeight: 1.1,
                      }}
                    >
                      {oldPrice.toLocaleString('en-US')}
                    </span>
                  )}

                  <span
                    className="sf-coverflow-price"
                    style={{
                      fontSize: offset === 0 ? '13px' : Math.abs(offset) === 1 ? '12px' : '11px',
                      fontWeight: 600,
                      color: '#0f172a',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.1,
                    }}
                  >
                    {product.price.toLocaleString('en-US')}{' '}
                    <span style={{ fontSize: '0.85em', fontWeight: 500 }}>
                      <CurrencySymbol />
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}
