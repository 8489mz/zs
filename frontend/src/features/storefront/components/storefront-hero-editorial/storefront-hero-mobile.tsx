import { generatePremiumProductSvg } from '../../lib/storefront-photo-matcher';
import type { StorefrontProduct } from '../../types/storefront.types';

export interface StorefrontHeroMobileProps {
  mobileCarouselRef: React.RefObject<HTMLDivElement | null>;
  dir: 'ltr' | 'rtl';
  mobileHeroSlides: { kicker: string; headline: string; cta: string; bg: string; border: string; textDark: boolean; accentBg: string; accentText: string; kickerBg: string; kickerColor: string; product: StorefrontProduct | null; photoUrl: string }[];
  activeMobileSlide: number;
  setActiveMobileSlide: React.Dispatch<React.SetStateAction<number>>;
  onQuickView: (product: StorefrontProduct) => void;
  onSelectDeals: () => void;
  isEn: boolean;
}

export function StorefrontHeroMobile(props: StorefrontHeroMobileProps) {
  const { mobileCarouselRef, dir, mobileHeroSlides, activeMobileSlide, setActiveMobileSlide, onQuickView, onSelectDeals, isEn } = props;
  return (
    <>
    {/* Mobile-Only Full-Width Swipeable Hero Promo Cards */}
    <div
      ref={mobileCarouselRef}
      className="sf-mobile-editorial-carousel"
      dir={dir}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (!el.clientWidth) return;
        const idx = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
        const clamped = Math.max(0, Math.min(mobileHeroSlides.length - 1, idx));
        if (clamped !== activeMobileSlide) {
          setActiveMobileSlide(clamped);
        }
      }}
    >
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
          {/* Copy Column */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              height: '100%',
              flex: '1 1 auto',
              minWidth: 0,
              textAlign: isEn ? 'left' : 'right',
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
              <span style={{ fontSize: '11px', lineHeight: 1 }}>{isEn ? '→' : '←'}</span>
            </span>
          </div>

          {/* Product Studio Image */}
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
      {mobileHeroSlides.map((_, idx) => {
        const isActive = idx === activeMobileSlide;
        return (
          <button
            key={idx}
            type="button"
            onClick={() => {
              setActiveMobileSlide(idx);
              const el = mobileCarouselRef.current;
              if (el) {
                const slideEls = el.querySelectorAll<HTMLElement>('.sf-mobile-editorial-slide');
                slideEls[idx]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
              }
            }}
            style={{
              width: isActive ? '18px' : '6px',
              height: '5px',
              borderRadius: '3px',
              background: isActive ? 'var(--storefront-primary-color, #2d68c4)' : '#cbd5e1',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              transition: 'width 0.2s ease, background-color 0.2s ease',
            }}
          />
        );
      })}
    </div>
    </>
  );
}
