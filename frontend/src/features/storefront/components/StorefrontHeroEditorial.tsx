import React, { useState, useMemo, useRef } from 'react';
import { useStorefrontLang } from '@/i18n';
import type { StorefrontInfo, StorefrontProduct, StorefrontCategory } from '../types/storefront.types';
import { resolveProductPhoto } from '../lib/storefront-photo-matcher';
import { StorefrontHeroMobile } from './storefront-hero-editorial/storefront-hero-mobile';
import { StorefrontHeroHeadline } from './storefront-hero-editorial/storefront-hero-headline';
import { StorefrontHeroCoverflow } from './storefront-hero-editorial/storefront-hero-coverflow';
import { StorefrontHeroCta } from './storefront-hero-editorial/storefront-hero-cta';
import { StorefrontHeroTicker } from './storefront-hero-editorial/storefront-hero-ticker';

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




export const StorefrontHeroEditorial = React.memo(function StorefrontHeroEditorial({
  info,
  featuredProducts,
  onAddToCart,
  onQuickView,
  onSelectDeals,
  onOpenCategoriesModal,
}: StorefrontHeroEditorialProps) {
  const { isEn, dir } = useStorefrontLang();
  const [justAddedId, setJustAddedId] = useState<number | null>(null);
  const [activeMobileSlide, setActiveMobileSlide] = useState<number>(0);
  const mobileCarouselRef = useRef<HTMLDivElement | null>(null);

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

  const mobileHeroSlides = useMemo(() => {
    const base = featuredProducts && featuredProducts.length > 0 ? featuredProducts.slice(0, 4) : [];
    const slideThemes = [
      {
        kicker: isEn ? 'New Arrivals' : 'وصل حديثاً',
        headline: info?.heroHeadline?.trim() || (isEn ? 'Handpicked Top-Quality Collection' : 'تشكيلة مختارة بأعلى جودة'),
        cta: isEn ? 'Shop Now' : 'تسوق الآن',
        bg: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
        border: '#e2e8f0',
        textDark: true,
        accentBg: 'var(--storefront-primary-color, #2d68c4)',
        accentText: '#ffffff',
        kickerBg: 'rgba(45, 104, 196, 0.1)',
        kickerColor: 'var(--storefront-primary-color, #2d68c4)',
      },
      {
        kicker: isEn ? 'Exclusive Deals' : 'عروض حصرية',
        headline: isEn ? 'Daily markdowns on top products' : 'خصومات يومية على أفضل الأصناف',
        cta: isEn ? 'Explore Deals' : 'اكتشف العروض',
        bg: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        border: '#1e293b',
        textDark: false,
        accentBg: '#ffffff',
        accentText: '#0f172a',
        kickerBg: 'rgba(255, 255, 255, 0.14)',
        kickerColor: '#f8fafc',
      },
      {
        kicker: isEn ? 'Best Sellers' : 'الأكثر مبيعاً',
        headline: isEn ? '100% authentic with fast delivery' : 'منتجات أصلية بتوصيل سريع',
        cta: isEn ? 'Browse Now' : 'تصفح الآن',
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
  }, [featuredProducts, info?.heroHeadline, isEn]);

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

      <StorefrontHeroMobile
        mobileCarouselRef={mobileCarouselRef}
        dir={dir}
        mobileHeroSlides={mobileHeroSlides}
        activeMobileSlide={activeMobileSlide}
        setActiveMobileSlide={setActiveMobileSlide}
        onQuickView={onQuickView}
        onSelectDeals={onSelectDeals}
        isEn={isEn}
      />

      <StorefrontHeroHeadline
        info={info}
        isEn={isEn}
      />

      <StorefrontHeroCoverflow
        orderedDeck={orderedDeck}
        isEn={isEn}
        info={info}
        dir={dir}
        setCenterIdx={setCenterIdx}
        onQuickView={onQuickView}
        handleInstantAdd={handleInstantAdd}
        justAddedId={justAddedId}
      />

      <StorefrontHeroCta
        onSelectDeals={onSelectDeals}
        isEn={isEn}
        onOpenCategoriesModal={onOpenCategoriesModal}
      />

      <StorefrontHeroTicker
        isEn={isEn}
        info={info}
        dir={dir}
      />
    </section>
  );
});
