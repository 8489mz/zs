import { useState, useEffect, useMemo, Fragment } from 'react';
import { useStorefrontLang } from '../../../i18n';
import type { StorefrontProduct } from '../types/storefront.types';
import { resolveProductPhoto } from '../lib/storefront-photo-matcher';
import {
  LAPTOP_PHOTO,
  IPHONE_PHOTO,
  SMARTWATCH_PHOTO,
  HEADPHONES_PHOTO,
  WATCH_CLASSIC_PHOTO,
} from '../lib/product-photos-registry';

interface StorefrontFlashSaleCountdownProps {
  products: StorefrontProduct[];
  cartMap: Map<number, number>;
  whatsappPhone?: string;
  favoriteIds?: Set<number>;
  onAddToCart: (product: StorefrontProduct) => void;
  onUpdateQuantity: (productId: number, qty: number) => void;
  onQuickView?: (product: StorefrontProduct) => void;
  onToggleFavorite?: (productId: number) => void;
  onSelectDeals?: () => void;
}

export function StorefrontFlashSaleCountdown({
  products,
  onQuickView,
  onSelectDeals,
}: StorefrontFlashSaleCountdownProps) {
  const { isEn, dir } = useStorefrontLang();

  // Live Countdown Timer: Days, Hours, Minutes, Seconds
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  }>({
    days: 3,
    hours: 23,
    minutes: 19,
    seconds: 45,
  });

  useEffect(() => {
    // Target: 3 days + remaining time today for an authentic live countdown matching the reference
    const calculateTimeRemaining = () => {
      const now = new Date();
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      const diff = Math.max(0, endOfDay.getTime() - now.getTime());

      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);

      return { days: 3, hours, minutes, seconds };
    };

    setTimeLeft(calculateTimeRemaining());

    const timer = setInterval(() => {
      setTimeLeft(calculateTimeRemaining());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Resolve up to 5 showcase products or fallback to crisp cutout product images
  const showcaseItems = useMemo(() => {
    const defaults = [
      { img: LAPTOP_PHOTO, product: products[0] },
      { img: IPHONE_PHOTO, product: products[1] || products[0] },
      { img: SMARTWATCH_PHOTO, product: products[2] || products[0] },
      { img: HEADPHONES_PHOTO, product: products[3] || products[0] },
      { img: WATCH_CLASSIC_PHOTO, product: products[4] || products[0] },
    ];

    if (!products || products.length === 0) return defaults;

    return defaults.map((def, idx) => {
      const p = products[idx];
      if (!p) return def;
      const resolved = resolveProductPhoto(p.name, p.categoryName);
      const url = p.imageUrl || resolved.url || def.img;
      return {
        img: url,
        product: p,
      };
    });
  }, [products]);

  const padZero = (n: number) => String(n).padStart(2, '0');

  const handleBannerClick = () => {
    if (onSelectDeals) {
      onSelectDeals();
      window.scrollTo({ top: 180, behavior: 'smooth' });
    }
  };

  return (
    <section
      className="storefront-deals-of-the-day-section"
      dir={dir}
      style={{
        margin: '32px 0',
        padding: '0 4px',
        userSelect: 'none',
      }}
    >
      {/* Top Centered Section Heading: Deals Of the Day */}
      <h2
        style={{
          textAlign: 'center',
          fontSize: 'clamp(16px, 1.8vw, 20px)',
          fontWeight: 700,
          color: '#111827',
          margin: '0 0 14px 0',
          letterSpacing: '-0.2px',
        }}
      >
        {isEn ? 'Deals & Discounts of the Day' : 'عروض وتخفيضات اليوم'}
      </h2>

      {/* Main Pastel Mesh Gradient Banner Card */}
      <div
        onClick={handleBannerClick}
        className="storefront-flash-banner-card"
        style={{
          position: 'relative',
          borderRadius: '18px',
          overflow: 'hidden',
          background:
            'radial-gradient(circle at 85% 20%, #dbeafe 0%, transparent 45%), radial-gradient(circle at 48% 15%, #ffedd5 0%, transparent 45%), radial-gradient(circle at 15% 25%, #fef9c3 0%, transparent 40%), radial-gradient(circle at 25% 85%, #d1fae5 0%, transparent 50%), linear-gradient(125deg, #e0ecff 0%, #f4f7fb 48%, #e6f9f6 100%)',
          boxShadow: '0 10px 30px -5px rgba(15, 23, 42, 0.06), 0 2px 8px -2px rgba(15, 23, 42, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.85)',
          minHeight: '320px',
          display: 'grid',
          gridTemplateColumns: '1.05fr 1.25fr',
          alignItems: 'center',
          padding: '32px 42px',
          gap: '24px',
          cursor: onSelectDeals ? 'pointer' : 'default',
        }}
      >
        {/* Decorative Flowing 3D Ribbon Wave SVG in Background */}
        <svg
          viewBox="0 0 1200 360"
          fill="none"
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          <defs>
            <linearGradient id="flashRibbonGrad1" x1="0%" y1="50%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.85" />
              <stop offset="45%" stopColor="#34d399" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#a7f3d0" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="flashRibbonGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6ee7b7" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.25" />
            </linearGradient>
          </defs>
          {/* Sweeping Ribbon Wave */}
          <path
            d="M-60 260 C 120 330, 290 290, 410 230 C 490 190, 440 130, 380 165 C 320 200, 390 310, 560 310 C 750 310, 920 240, 1260 290"
            stroke="url(#flashRibbonGrad1)"
            strokeWidth="26"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M80 350 C 260 310, 430 220, 620 275 C 810 330, 990 220, 1250 250"
            stroke="url(#flashRibbonGrad2)"
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
          />
        </svg>

        {/* Right Side: Title + 4 Countdown Boxes */}
        <div
          style={{
            position: 'relative',
            zIndex: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'translateY(-14px)',
          }}
        >
          {/* Hurry! Limited Deals Heading + 4 Calm Light Countdown Boxes */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <h3
              style={{
                fontSize: 'clamp(15px, 1.6vw, 18px)',
                fontWeight: 700,
                color: '#0f172a',
                margin: '0 0 10px 0',
                letterSpacing: '-0.2px',
                lineHeight: 1.3,
                textAlign: 'center',
                width: '100%',
              }}
            >
              {isEn ? 'Hurry! Limited Time Deals' : 'سارع الآن! عروض محدودة'}
            </h3>

            {/* 4 Calm & Uniform Light Countdown Cards */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                direction: dir,
              }}
            >
              {[
                { label: isEn ? 'Days' : 'يوم', value: padZero(timeLeft.days) },
                { label: isEn ? 'Hours' : 'ساعة', value: padZero(timeLeft.hours) },
                { label: isEn ? 'Mins' : 'دقيقة', value: padZero(timeLeft.minutes) },
                { label: isEn ? 'Secs' : 'ثانية', value: padZero(timeLeft.seconds) },
              ].map((box, index, arr) => (
                <Fragment key={index}>
                  <div
                    style={{
                      position: 'relative',
                      width: '58px',
                      height: '62px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.88)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255, 255, 255, 0.95)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '3px',
                      boxShadow: '0 4px 12px rgba(15, 23, 42, 0.04), inset 0 1px 0 #ffffff',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Number Value */}
                    <span
                      style={{
                        fontSize: '19px',
                        fontWeight: 800,
                        color: '#1e293b',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1.05,
                        letterSpacing: '-0.3px',
                      }}
                    >
                      {box.value}
                    </span>

                    {/* Unit Label */}
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 600,
                        color: '#64748b',
                        lineHeight: 1.15,
                      }}
                    >
                      {box.label}
                    </span>
                  </div>

                  {/* Subtle Separator Colon Dots between cards */}
                  {index < arr.length - 1 && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 1px',
                        opacity: 0.28,
                      }}
                    >
                      <span
                        style={{
                          width: '3.5px',
                          height: '3.5px',
                          borderRadius: '50%',
                          background: '#334155',
                        }}
                      />
                      <span
                        style={{
                          width: '3.5px',
                          height: '3.5px',
                          borderRadius: '50%',
                          background: '#334155',
                        }}
                      />
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* Left Side (in RTL): Floating 3D-Style Product Collage */}
        <div
          className="storefront-flash-collage"
          style={{
            position: 'relative',
            zIndex: 2,
            height: '270px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Floating Item 4: Far Right/Back Watch */}
          {showcaseItems[2] && (
            <div
              className="sf-flash-collage-item sf-flash-item-right-outer"
              onClick={(e) => {
                if (showcaseItems[2].product && onQuickView) {
                  e.stopPropagation();
                  onQuickView(showcaseItems[2].product);
                }
              }}
              style={{
                position: 'absolute',
                right: '4%',
                bottom: '12%',
                width: '95px',
                height: '95px',
                transform: 'rotate(14deg)',
                transition: 'transform 0.3s ease',
                cursor: 'pointer',
                zIndex: 3,
                filter: 'drop-shadow(0 12px 18px rgba(15, 23, 42, 0.16))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'rotate(8deg) scale(1.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'rotate(14deg) scale(1)';
              }}
            >
              <img
                src={showcaseItems[2].img}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
          )}

          {/* Floating Item 2: Fanned Smartphone / Secondary Item */}
          {showcaseItems[1] && (
            <div
              className="sf-flash-collage-item sf-flash-item-right-inner"
              onClick={(e) => {
                if (showcaseItems[1].product && onQuickView) {
                  e.stopPropagation();
                  onQuickView(showcaseItems[1].product);
                }
              }}
              style={{
                position: 'absolute',
                right: '20%',
                top: '14%',
                width: '135px',
                height: '155px',
                transform: 'rotate(-16deg)',
                transition: 'transform 0.3s ease',
                cursor: 'pointer',
                zIndex: 2,
                filter: 'drop-shadow(0 14px 22px rgba(15, 23, 42, 0.18))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'rotate(-10deg) scale(1.07)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'rotate(-16deg) scale(1)';
              }}
            >
              <img
                src={showcaseItems[1].img}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
          )}

          {/* Main Centerpiece Hero Product (Laptop / Main Deal) */}
          {showcaseItems[0] && (
            <div
              className="sf-flash-collage-item sf-flash-item-center"
              onClick={(e) => {
                if (showcaseItems[0].product && onQuickView) {
                  e.stopPropagation();
                  onQuickView(showcaseItems[0].product);
                }
              }}
              style={{
                position: 'relative',
                width: '250px',
                height: '240px',
                transform: 'rotate(-4deg)',
                transition: 'transform 0.35s ease',
                cursor: 'pointer',
                zIndex: 5,
                filter: 'drop-shadow(0 20px 28px rgba(15, 23, 42, 0.22))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'rotate(0deg) scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'rotate(-4deg) scale(1)';
              }}
            >
              <img
                src={showcaseItems[0].img}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
          )}

          {/* Floating Top-Left Earbuds / Headphones */}
          {showcaseItems[3] && (
            <div
              className="sf-flash-collage-item sf-flash-item-left-inner"
              onClick={(e) => {
                if (showcaseItems[3].product && onQuickView) {
                  e.stopPropagation();
                  onQuickView(showcaseItems[3].product);
                }
              }}
              style={{
                position: 'absolute',
                left: '14%',
                top: '4%',
                width: '90px',
                height: '90px',
                transform: 'rotate(12deg)',
                transition: 'transform 0.3s ease',
                cursor: 'pointer',
                zIndex: 3,
                filter: 'drop-shadow(0 10px 16px rgba(15, 23, 42, 0.14))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'rotate(4deg) scale(1.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'rotate(12deg) scale(1)';
              }}
            >
              <img
                src={showcaseItems[3].img}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
          )}

          {/* Floating Bottom-Left Secondary Device / Classic Watch */}
          {showcaseItems[4] && (
            <div
              className="sf-flash-collage-item sf-flash-item-left-outer"
              onClick={(e) => {
                if (showcaseItems[4].product && onQuickView) {
                  e.stopPropagation();
                  onQuickView(showcaseItems[4].product);
                }
              }}
              style={{
                position: 'absolute',
                left: '2%',
                bottom: '8%',
                width: '130px',
                height: '130px',
                transform: 'rotate(-12deg)',
                transition: 'transform 0.3s ease',
                cursor: 'pointer',
                zIndex: 4,
                filter: 'drop-shadow(0 16px 22px rgba(15, 23, 42, 0.2))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'rotate(-6deg) scale(1.07)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'rotate(-12deg) scale(1)';
              }}
            >
              <img
                src={showcaseItems[4].img}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .storefront-flash-banner-card {
            grid-template-columns: 1fr !important;
            padding: 20px 16px !important;
            text-align: right;
            min-height: auto !important;
            gap: 14px !important;
          }
          .storefront-flash-banner-card > div:first-of-type {
            transform: none !important;
          }
          .storefront-flash-collage {
            width: 100% !important;
            height: 200px !important;
            margin-top: 0 !important;
          }
          .storefront-flash-collage .sf-flash-item-center {
            width: 175px !important;
            height: 168px !important;
            z-index: 5 !important;
          }
          .storefront-flash-collage .sf-flash-item-right-inner {
            width: 90px !important;
            height: 102px !important;
            right: 17% !important;
            top: 6% !important;
          }
          .storefront-flash-collage .sf-flash-item-right-outer {
            width: 74px !important;
            height: 74px !important;
            right: 2% !important;
            bottom: 12% !important;
          }
          .storefront-flash-collage .sf-flash-item-left-inner {
            width: 72px !important;
            height: 72px !important;
            left: 17% !important;
            top: 6% !important;
          }
          .storefront-flash-collage .sf-flash-item-left-outer {
            width: 84px !important;
            height: 84px !important;
            left: 2% !important;
            bottom: 10% !important;
          }
        }
        @media (max-width: 640px) {
          .storefront-deals-of-the-day-section {
            margin: 12px 0 !important;
            padding: 0 !important;
          }
          .storefront-deals-of-the-day-section > h2 {
            font-size: 14px !important;
            font-weight: 700 !important;
            margin: 0 0 8px 0 !important;
          }
          .storefront-flash-banner-card {
            border-radius: 16px !important;
            padding: 15px 12px 12px !important;
            gap: 6px !important;
          }
          .storefront-flash-banner-card h3 {
            font-size: 14px !important;
            font-weight: 700 !important;
            margin: 0 0 8px 0 !important;
          }
          .storefront-flash-collage {
            width: 100% !important;
            max-width: 340px !important;
            height: 146px !important;
            margin: 2px auto 0 !important;
            transform: none !important;
          }
          .storefront-flash-collage .sf-flash-item-center {
            width: 118px !important;
            height: 112px !important;
            margin-top: 14px !important;
            z-index: 5 !important;
          }
          .storefront-flash-collage .sf-flash-item-right-inner {
            width: 56px !important;
            height: 64px !important;
            right: 17% !important;
            top: 4% !important;
            z-index: 3 !important;
          }
          .storefront-flash-collage .sf-flash-item-right-outer {
            width: 54px !important;
            height: 54px !important;
            right: 1% !important;
            bottom: 12% !important;
            z-index: 4 !important;
          }
          .storefront-flash-collage .sf-flash-item-left-inner {
            width: 52px !important;
            height: 52px !important;
            left: 17% !important;
            top: 4% !important;
            z-index: 3 !important;
          }
          .storefront-flash-collage .sf-flash-item-left-outer {
            width: 58px !important;
            height: 58px !important;
            left: 1% !important;
            bottom: 10% !important;
            z-index: 4 !important;
          }
        }
      `}</style>
    </section>
  );
}
