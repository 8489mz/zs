import React, { useState, useMemo } from 'react';
import type { StorefrontInfo, StorefrontProduct, StorefrontCategory } from '../types/storefront.types';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { resolveProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { IconShoppingCart, IconCheckCircle, IconArrowUpRight } from './StorefrontIcons';

interface StorefrontHeroEditorialProps {
  info: StorefrontInfo;
  featuredProducts: StorefrontProduct[];
  categories: StorefrontCategory[];
  cartMap: Map<number, number>;
  onAddToCart: (product: StorefrontProduct) => void;
  onUpdateQuantity: (productId: number, qty: number) => void;
  onQuickView: (product: StorefrontProduct) => void;
  onSelectDeals: () => void;
  onSelectCategory: (categoryId: number) => void;
  onOpenCategoriesModal: () => void;
}

// Preset badges for the 3D coverflow product deck
const CARD_BADGES = [
  'عرض محدود',
  'وصل حديثاً',
  'خصم خاص',
  'عرض حصري',
  'تخفيضات اليوم',
  'الأكثر مبيعاً',
  'مختاراتنا',
];

interface CardSlotMetrics {
  width: number;
  height: number;
  slantLeft: number;
  slantRight: number;
  marginTop: number;
  zIndex: number;
  isHighlighted: boolean;
  titleFontSize: string;
  badgeFontSize: string;
  priceFontSize: string;
  cartBtnSize: number;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
}

/**
 * Pure 2D Integer-Pixel Perspective Geometry (Zero CSS rotateY / Zero CSS scale)
 * Uses pure GPU translate3d for hover lift so moving the pointer across the 7-card deck
 * triggers zero React re-renders and zero layout reflows (locked 120Hz ProMotion).
 */
function getCardSlotMetrics(offset: number): CardSlotMetrics {
  if (offset === 0) {
    return {
      width: 208,
      height: 302,
      slantLeft: 0,
      slantRight: 0,
      marginTop: 0,
      zIndex: 30,
      isHighlighted: true,
      titleFontSize: '11px',
      badgeFontSize: '10.5px',
      priceFontSize: '11px',
      cartBtnSize: 28,
      paddingX: 12,
      paddingTop: 14,
      paddingBottom: 14,
    };
  }

  const abs = Math.abs(offset);
  const isLeft = offset < 0;

  if (abs === 1) {
    const slant = 6;
    return {
      width: 186,
      height: 276,
      slantLeft: isLeft ? slant : 0,
      slantRight: isLeft ? 0 : slant,
      marginTop: 10,
      zIndex: 20,
      isHighlighted: false,
      titleFontSize: '10px',
      badgeFontSize: '10px',
      priceFontSize: '10.5px',
      cartBtnSize: 26,
      paddingX: 10,
      paddingTop: 13,
      paddingBottom: 13,
    };
  }

  if (abs === 2) {
    const slant = 7.5;
    return {
      width: 172,
      height: 256,
      slantLeft: isLeft ? slant : 0,
      slantRight: isLeft ? 0 : slant,
      marginTop: 18,
      zIndex: 12,
      isHighlighted: false,
      titleFontSize: '9.5px',
      badgeFontSize: '9.5px',
      priceFontSize: '10px',
      cartBtnSize: 24,
      paddingX: 9,
      paddingTop: 12,
      paddingBottom: 12,
    };
  }

  // abs >= 3
  const slant = 9;
  return {
    width: 160,
    height: 238,
    slantLeft: isLeft ? slant : 0,
    slantRight: isLeft ? 0 : slant,
    marginTop: 26,
    zIndex: 6,
    isHighlighted: false,
    titleFontSize: '9px',
    badgeFontSize: '9px',
    priceFontSize: '9.5px',
    cartBtnSize: 23,
    paddingX: 8,
    paddingTop: 12,
    paddingBottom: 12,
  };
}

/**
 * Generates a tangent-continuous rounded-trapezoid SVG path for the perspective card body.
 * Rendered via native 2D vector anti-aliasing (geometricPrecision) for 0% jagged edges.
 */
function buildPerspectiveCardPath(
  w: number,
  h: number,
  slantLeft: number,
  slantRight: number,
  radius: number,
  offsetX = 0,
  offsetY = 0
): string {
  const x0 = offsetX;
  const x1 = offsetX + w;
  const tlY = offsetY + slantLeft;
  const trY = offsetY + slantRight;
  const brY = offsetY + h - slantRight;
  const blY = offsetY + h - slantLeft;

  const dx = x1 - x0;
  const dyTop = trY - tlY;
  const lenTop = Math.hypot(dx, dyTop) || 1;
  const uxTop = dx / lenTop;
  const uyTop = dyTop / lenTop;

  const dyBot = blY - brY;
  const lenBot = Math.hypot(-dx, dyBot) || 1;
  const uxBot = -dx / lenBot;
  const uyBot = dyBot / lenBot;

  const r = Math.min(radius, w * 0.22, h * 0.22);
  const f = (n: number) => Number(n.toFixed(2));

  return [
    `M ${f(x0)} ${f(tlY + r)}`,
    `Q ${f(x0)} ${f(tlY)} ${f(x0 + r * uxTop)} ${f(tlY + r * uyTop)}`,
    `L ${f(x1 - r * uxTop)} ${f(trY - r * uyTop)}`,
    `Q ${f(x1)} ${f(trY)} ${f(x1)} ${f(trY + r)}`,
    `L ${f(x1)} ${f(brY - r)}`,
    `Q ${f(x1)} ${f(brY)} ${f(x1 + r * uxBot)} ${f(brY + r * uyBot)}`,
    `L ${f(x0 - r * uxBot)} ${f(blY - r * uyBot)}`,
    `Q ${f(x0)} ${f(blY)} ${f(x0)} ${f(blY - r)}`,
    'Z',
  ].join(' ');
}

export const StorefrontHeroEditorial = React.memo(function StorefrontHeroEditorial({
  info,
  featuredProducts,
  onAddToCart,
  onQuickView,
  onSelectDeals,
  onOpenCategoriesModal,
}: StorefrontHeroEditorialProps) {
  const [justAddedId, setJustAddedId] = useState<number | null>(null);

  // Build a 7-card deck for the symmetrical 3D Coverflow (3 Left + 1 Center + 3 Right)
  const deckProducts = useMemo(() => {
    if (!featuredProducts || featuredProducts.length === 0) return [];
    if (featuredProducts.length >= 7) return featuredProducts.slice(0, 7);
    const list: StorefrontProduct[] = [];
    const targetLen = Math.min(7, featuredProducts.length >= 5 ? 7 : featuredProducts.length);
    for (let i = 0; i < targetLen; i++) {
      list.push(featuredProducts[i % featuredProducts.length]);
    }
    return list;
  }, [featuredProducts]);

  const [centerIdx, setCenterIdx] = useState<number>(3);
  const effectiveCenterIdx = deckProducts.length > 0
    ? Math.min(centerIdx, deckProducts.length - 1)
    : 0;

  // Arrange products so the selected center product sits in the middle slot (slot 3)
  const orderedDeck = useMemo(() => {
    if (deckProducts.length < 7) {
      return deckProducts.map((product, originalIdx) => ({ product, originalIdx }));
    }
    const midSlot = 3;
    const result: Array<{ product: StorefrontProduct; originalIdx: number }> = [];
    for (let slot = 0; slot < 7; slot++) {
      const idx = (effectiveCenterIdx + (slot - midSlot) + deckProducts.length) % deckProducts.length;
      result.push({ product: deckProducts[idx], originalIdx: idx });
    }
    return result;
  }, [deckProducts, effectiveCenterIdx]);

  const handleInstantAdd = (e: React.MouseEvent, product: StorefrontProduct) => {
    e.stopPropagation();
    if (!product.inStock || product.stockQty <= 0) return;
    onAddToCart(product);
    setJustAddedId(product.id);
    window.setTimeout(() => {
      setJustAddedId((curr) => (curr === product.id ? null : curr));
    }, 1200);
  };

  // Build 4 curated mobile promo slides (only rendered on <= 640px)
  const mobileHeroSlides = useMemo(() => {
    const base = featuredProducts && featuredProducts.length > 0 ? featuredProducts.slice(0, 4) : [];
    const slideThemes = [
      {
        kicker: 'وصل حديثاً',
        headline: info?.heroHeadline?.trim() || 'تشكيلة مختارة بأعلى جودة',
        cta: 'تسوق الآن',
        bg: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
        border: '#e2e8f0',
        textDark: true,
        accentBg: 'var(--storefront-primary-color, #2d68c4)',
        accentText: '#ffffff',
        kickerBg: 'rgba(45, 104, 196, 0.1)',
        kickerColor: 'var(--storefront-primary-color, #2d68c4)',
      },
      {
        kicker: 'عروض حصرية',
        headline: 'خصومات يومية على أفضل الأصناف',
        cta: 'اكتشف العروض',
        bg: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        border: '#1e293b',
        textDark: false,
        accentBg: '#ffffff',
        accentText: '#0f172a',
        kickerBg: 'rgba(255, 255, 255, 0.14)',
        kickerColor: '#f8fafc',
      },
      {
        kicker: 'الأكثر مبيعاً',
        headline: 'منتجات أصلية بتوصيل سريع',
        cta: 'تصفح الآن',
        bg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
        border: '#bfdbfe',
        textDark: true,
        accentBg: '#0f172a',
        accentText: '#ffffff',
        kickerBg: '#ffffff',
        kickerColor: '#1d4ed8',
      },
    ];

    return slideThemes.map((theme, idx) => {
      const prod = base[idx % Math.max(1, base.length)] || null;
      const photoUrl = prod
        ? prod.imageUrl || resolveProductPhoto(prod.name, prod.categoryName).url
        : '';
      return {
        ...theme,
        product: prod,
        photoUrl,
      };
    });
  }, [featuredProducts]);

  return (
    <section
      className="storefront-pallet-hero"
      style={{
        position: 'relative',
        background: 'radial-gradient(ellipse 100% 85% at 50% 0%, #ffffff 0%, #f8fafc 48%, #eff4fa 100%)',
        color: '#0f172a',
        marginTop: '-76px',
        padding: '92px 16px 18px',
        overflow: 'hidden',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        userSelect: 'none',
        contain: 'layout style paint',
      }}
    >
      <style>{`
        .sf-mobile-editorial-carousel,
        .sf-mobile-editorial-dots {
          display: none;
        }
        .storefront-coverflow-card {
          transform: translate3d(0, 0, 0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        @media (min-width: 641px) {
          .storefront-coverflow-card:hover {
            transform: translate3d(0, -8px, 0);
            z-index: 45 !important;
          }
          .storefront-coverflow-card:hover .sf-coverflow-stroke {
            stroke: #93c5fd;
            stroke-width: 1.6;
          }
          .storefront-coverflow-card:active {
            transform: translate3d(0, -2px, 0) scale3d(0.97, 0.97, 1);
            transition: transform 0.1s cubic-bezier(0.32, 0.72, 0, 1);
          }
        }

        @keyframes sfHeroTickerMove {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(-50%, 0, 0);
          }
        }

        .sf-hero-ticker-viewport {
          width: 100%;
          max-width: 1280px;
          margin-top: 26px;
          padding-top: 14px;
          padding-bottom: 8px;
          border-top: 1px solid rgba(203, 213, 225, 0.55);
          overflow: hidden;
          position: relative;
          z-index: 5;
          contain: layout paint;
          mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
        }

        .sf-hero-ticker-track {
          display: flex;
          align-items: center;
          width: max-content;
          will-change: transform;
          backface-visibility: hidden;
          animation: sfHeroTickerMove 34s linear infinite;
        }

        .sf-hero-ticker-viewport:hover .sf-hero-ticker-track {
          animation-play-state: paused;
        }

        /* Responsive Mobile Scroll Track */
        @media (max-width: 920px) {
          .storefront-pallet-hero {
            margin-top: -76px !important;
            padding: 92px 12px 18px !important;
          }
        }
        @media (max-width: 768px) {
          .storefront-pallet-hero {
            margin-top: 0 !important;
            padding: 14px 12px 12px !important;
          }
        }
        @media (max-width: 640px) {
          .storefront-pallet-hero {
            margin-top: 0 !important;
            padding: 10px 0 4px !important;
            background: transparent !important;
            border-bottom: none !important;
          }
          .sf-hero-headline-wrap,
          .storefront-fanned-deck,
          .sf-hero-cta-row,
          .sf-hero-ticker-viewport {
            display: none !important;
          }
          .sf-mobile-editorial-carousel {
            display: flex !important;
            direction: rtl !important;
            width: 100% !important;
            overflow-x: auto !important;
            gap: 12px !important;
            padding: 2px 14px 6px !important;
            box-sizing: border-box !important;
            scroll-snap-type: x mandatory !important;
            scrollbar-width: none !important;
            -webkit-overflow-scrolling: touch !important;
          }
          .sf-mobile-editorial-carousel::-webkit-scrollbar {
            display: none !important;
          }
          .sf-mobile-editorial-slide {
            flex: 0 0 100% !important;
            max-width: 100% !important;
            height: 154px !important;
            border-radius: 16px !important;
            padding: 15px 16px !important;
            box-sizing: border-box !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 14px !important;
            scroll-snap-align: center !important;
            position: relative !important;
            overflow: hidden !important;
            box-shadow: 0 6px 20px -4px rgba(15, 23, 42, 0.06) !important;
            cursor: pointer !important;
          }
          .sf-mobile-editorial-dots {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            margin-top: 4px !important;
            padding-bottom: 2px !important;
          }
        }
      `}</style>

      {/* Mobile-Only Full-Width Swipeable Hero Promo Cards */}
      <div className="sf-mobile-editorial-carousel" dir="rtl">
        {mobileHeroSlides.map((slide, idx) => (
          <div
            key={idx}
            className="sf-mobile-editorial-slide"
            onClick={() => {
              if (slide.product) {
                onQuickView(slide.product);
              } else {
                onSelectDeals();
              }
            }}
            style={{
              background: slide.bg,
              border: `1px solid ${slide.border}`,
            }}
          >
            {/* Right Copy Column in RTL */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                height: '100%',
                flex: '1 1 auto',
                minWidth: 0,
                textAlign: 'right',
                zIndex: 2,
              }}
            >
              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 600,
                  padding: '3.5px 9px',
                  borderRadius: '7px',
                  background: slide.kickerBg,
                  color: slide.kickerColor,
                  lineHeight: 1.2,
                }}
              >
                {slide.kicker}
              </span>

              <div style={{ margin: '4px 0', width: '100%' }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: slide.textDark ? '#0f172a' : '#ffffff',
                    lineHeight: 1.32,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {slide.product ? slide.product.name : slide.headline}
                </div>
                <div
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 500,
                    color: slide.textDark ? '#64748b' : '#cbd5e1',
                    marginTop: '3px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {slide.headline}
                </div>
              </div>

              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  height: '32px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  padding: '0 14px',
                  borderRadius: '10px',
                  background: slide.accentBg,
                  color: slide.accentText,
                  boxShadow: '0 2px 6px rgba(15, 23, 42, 0.08)',
                }}
              >
                <span>{slide.cta}</span>
                <span style={{ fontSize: '11px', lineHeight: 1 }}>←</span>
              </span>
            </div>

            {/* Left Product Studio Image in RTL */}
            {slide.photoUrl && (
              <div
                style={{
                  width: '108px',
                  height: '120px',
                  flexShrink: 0,
                  borderRadius: '12px',
                  background: slide.textDark ? '#ffffff' : 'rgba(255, 255, 255, 0.96)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px',
                  boxSizing: 'border-box',
                  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.06)',
                }}
              >
                <img
                  src={slide.photoUrl}
                  alt={slide.product?.name || slide.headline}
                  loading="eager"
                  decoding="async"
                  draggable={false}
                  onError={(e) => {
                    if (slide.product) {
                      e.currentTarget.src = generatePremiumProductSvg(slide.product.name, slide.product.categoryName);
                    }
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Subtle Soft Squircle Indicator Bars for Mobile Hero Carousel */}
      <div className="sf-mobile-editorial-dots" aria-hidden="true">
        {mobileHeroSlides.map((_, idx) => (
          <span
            key={idx}
            style={{
              width: idx === 0 ? '18px' : '6px',
              height: '5px',
              borderRadius: '3px',
              background: idx === 0 ? 'var(--storefront-primary-color, #2d68c4)' : '#cbd5e1',
              transition: 'width 0.2s ease, background-color 0.2s ease',
            }}
          />
        ))}
      </div>

      {/* Top Main Headline */}
      <div className="sf-hero-headline-wrap" style={{ maxWidth: '100%', marginBottom: '12px', position: 'relative', zIndex: 5 }}>
        <style>{`
          @keyframes sfHeadlineGlassSweep {
            0% {
              background-position: 100% 50%;
            }
            100% {
              background-position: 0% 50%;
            }
          }
          .sf-hero-glass-headline {
            margin: 0;
            padding: 2px 6px;
            display: inline-block;
            font-size: 20px;
            font-weight: 700;
            line-height: 1.35;
            letter-spacing: -0.01em;
            white-space: nowrap;
            font-family: 'Alexandria', 'Inter', 'Tajawal', 'Cairo', sans-serif;
            color: #132032;
            background-image: linear-gradient(
              112deg,
              #132032 0%,
              #132032 41%,
              color-mix(in srgb, #132032 75%, #ffffff 25%) 46%,
              color-mix(in srgb, #132032 52%, #ffffff 48%) 50%,
              color-mix(in srgb, #132032 75%, #ffffff 25%) 54%,
              #132032 59%,
              #132032 100%
            );
            background-size: 240% 100%;
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            animation: sfHeadlineGlassSweep 3.4s ease-in-out infinite alternate;
            will-change: background-position;
          }
        `}</style>
        <h1 className="sf-hero-glass-headline" style={{ color: '#132032' }}>
          {info?.heroHeadline?.trim() || 'أفضل المنتجات بأحسن سعر'}
        </h1>
        {info?.heroSubtitle?.trim() && (
          <p
            style={{
              margin: '6px auto 0',
              fontSize: '13px',
              fontWeight: 500,
              color: '#64748b',
              lineHeight: 1.5,
              maxWidth: '650px',
            }}
          >
            {info.heroSubtitle.trim()}
          </p>
        )}
      </div>

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
          const realBadge = product.offerBadge || (product.hasDiscount && product.discountPercent ? `خصم ${product.discountPercent}%` : '');
          const fallbackBadge = info?.smartDealsEnabled
            ? CARD_BADGES[originalIdx % CARD_BADGES.length]
            : (isHighlighted ? 'مختاراتنا' : '');
          const badgeText = isOutOfStock ? 'نفدت الكمية' : (realBadge || fallbackBadge);

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
              dir="rtl"
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

              {/* Card Header: Badge (Right in RTL) */}
              <div
                className="sf-coverflow-header"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  position: 'relative',
                  zIndex: 2,
                }}
              >
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
                    textAlign: 'right',
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

                {/* Bottom Row: Add to Cart Button (Right) opposite Price (Left) */}
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
                    title="أضف للسلة"
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
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom CTA Buttons */}
      <div
        className="sf-hero-cta-row"
        style={{
          maxWidth: '640px',
          marginTop: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          position: 'relative',
          zIndex: 5,
        }}
      >
          <button
            type="button"
            className="sf-hero-btn-primary"
            onClick={onSelectDeals}
            style={{
              height: '36px',
              padding: '0 16px',
              borderRadius: '12px',
              background: 'var(--storefront-primary-color, #2d68c4)',
              color: '#ffffff',
              border: '1px solid var(--storefront-primary-color, #2d68c4)',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              transition: 'all 0.16s ease',
            }}
          >
            <span>تصفح عروض اليوم</span>
            <span style={{ fontSize: '13px', lineHeight: 1 }}>←</span>
          </button>

          <button
            type="button"
            className="sf-hero-btn-secondary"
            onClick={onOpenCategoriesModal}
            style={{
              height: '36px',
              padding: '0 16px',
              borderRadius: '12px',
              background: '#ffffff',
              color: '#1f1f1f',
              border: '1px solid #dadce0',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              transition: 'all 0.16s ease',
            }}
          >
            <span>تصفح كل الأقسام</span>
            <IconArrowUpRight size={14} />
          </button>
        </div>

      {/* Bottom Hero Continuous Moving Trust & Value Marquee Strip */}
      <div className="sf-hero-ticker-viewport" dir="ltr" aria-label="مميزات المتجر">
        <div className="sf-hero-ticker-track">
          {[0, 1].map((copyIdx) => {
            const rawCurr = (info.currency || '').trim().toUpperCase();
            const currLabel =
              !rawCurr || rawCurr === 'EGP' || rawCurr === 'ج.م'
                ? 'جنيه'
                : info.currency;

            const freeShipPhrase =
              info.freeShippingEnabled && info.freeShippingMinOrder
                ? { start: 'شحن مجاني للطلبات فوق', bold: `${info.freeShippingMinOrder} ${currLabel}` }
                : { bold: 'توصيل سريع', end: 'لباب البيت' };

            const tickerPhrases: Array<{ start?: string; bold: string; end?: string }> = [
              { start: 'جودة أصلية مضمونة', bold: '100%' },
              freeShipPhrase,
              { bold: 'دفع آمن', end: 'عند الاستلام أو بالبطاقات والمحافظ' },
              { start: 'خدمة عملاء فورية عبر واتساب', bold: '24/7' },
              { bold: '+10,000', end: 'عميل سعيد يثق بنا' },
              { start: 'استبدال واسترجاع مرن خلال', bold: '14 يوم' },
              { bold: 'تغليف محكم', end: 'وعناية فائقة بكل طلب حتى يصلك' },
              { bold: 'أفضل سعر', end: 'وعروض وخصومات يومية حصرية' },
              { bold: 'توصيل سريع', end: 'شحن مباشر لجميع المحافظات' },
            ];

            return (
              <div
                key={copyIdx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                {tickerPhrases.map((phrase, idx) => (
                  <React.Fragment key={`${copyIdx}-${idx}`}>
                    <div
                      dir="rtl"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '0 20px',
                        whiteSpace: 'nowrap',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#475569',
                      }}
                    >
                      {phrase.start && <span>{phrase.start}</span>}
                      <span
                        style={{
                          fontWeight: 800,
                          color: 'var(--storefront-primary-color, #2d68c4)',
                          fontSize: '13.5px',
                        }}
                      >
                        {phrase.bold}
                      </span>
                      {phrase.end && <span>{phrase.end}</span>}
                    </div>
                    <span
                      aria-hidden="true"
                      style={{
                        color: '#cbd5e1',
                        fontSize: '14px',
                        fontWeight: 300,
                        userSelect: 'none',
                      }}
                    >
                      |
                    </span>
                  </React.Fragment>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
});
