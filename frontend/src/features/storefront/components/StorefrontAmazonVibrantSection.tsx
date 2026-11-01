import React, { useRef } from 'react';
import { useStorefrontLang } from '../../../i18n';
import type { StorefrontProduct, StorefrontCategory } from '../types/storefront.types';
import { resolveProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';

function getProductPhotoUrl(p?: StorefrontProduct | null): string {
  if (!p) return '';
  if (p.imageUrl) return p.imageUrl;
  const matched = resolveProductPhoto(p.name, p.categoryName);
  if (matched?.url) return matched.url;
  return generatePremiumProductSvg(p.name, p.categoryName);
}

interface StorefrontAmazonVibrantSectionProps {
  products: StorefrontProduct[];
  categories: StorefrontCategory[];
  onSelectDeals: () => void;
  onSelectCategory: (categoryId: number) => void;
  onQuickView?: (product: StorefrontProduct) => void;
}

const QUICK_TILE_ITEMS = [
  { labelAr: 'الأكثر مبيعاً', labelEn: 'Best Sellers', badgeAr: 'اختيار مميز', badgeEn: 'Top Pick', badgeBg: '#f1f5f9', badgeColor: '#334155' },
  { labelAr: 'ترشيحاتنا لك', labelEn: 'Our Picks for You', badgeAr: 'اختيار المتجر', badgeEn: 'Store Choice', badgeBg: '#eff6ff', badgeColor: '#2d68c4' },
  { labelAr: 'عرض خاص لك', labelEn: 'Special Offer', badgeAr: 'عرض لمدة محدودة', badgeEn: 'Limited Time Deal', badgeBg: '#cc0c39', badgeColor: '#ffffff' },
  { labelAr: 'أفضل العروض', labelEn: 'Best Deals', badgeAr: 'خصم حصري', badgeEn: 'Exclusive Offer', badgeBg: '#fef3c7', badgeColor: '#b45309' },
  { labelAr: 'مختارات مميزة', labelEn: 'Featured Picks', badgeAr: 'الأكثر طلباً', badgeEn: 'Most Popular', badgeBg: '#f1f5f9', badgeColor: '#334155' },
  { labelAr: 'وصل حديثاً', labelEn: 'New Arrivals', badgeAr: 'تشكيلة جديدة', badgeEn: 'New Collection', badgeBg: '#ecfdf5', badgeColor: '#047857' },
  { labelAr: 'عروض اليوم', labelEn: "Today's Deals", badgeAr: 'فرصة توفير', badgeEn: 'Super Saver', badgeBg: '#eff6ff', badgeColor: '#2d68c4' },
  { labelAr: 'اختياراتنا لك', labelEn: 'Curated for You', badgeAr: 'موصى به', badgeEn: 'Recommended', badgeBg: '#f1f5f9', badgeColor: '#334155' },
];

export const StorefrontAmazonVibrantSection = React.memo(function StorefrontAmazonVibrantSection({
  products,
  categories,
  onSelectDeals,
  onSelectCategory,
  onQuickView,
}: StorefrontAmazonVibrantSectionProps) {
  const { isEn, dir } = useStorefrontLang();
  const quickRowRef = useRef<HTMLDivElement>(null);

  const quickProducts = React.useMemo(() => {
    if (!products || products.length === 0) return [];
    const list: StorefrontProduct[] = [];
    for (let i = 0; i < Math.min(8, Math.max(6, products.length)); i++) {
      list.push(products[i % products.length]);
    }
    return list;
  }, [products]);

  const stageProdCenter = React.useMemo(
    () => products.find((p) => p.imageUrl?.includes('iphone-13-pro')) || products[0] || null,
    [products]
  );
  const stageProdRight = React.useMemo(
    () => products.find((p) => p.imageUrl?.includes('airpods-max')) || products[2] || products[0] || null,
    [products]
  );
  const stageProdLeft = React.useMemo(
    () => products.find((p) => p.imageUrl?.includes('bag-prada')) || products[5] || products[1] || products[0] || null,
    [products]
  );

  const card1Prod = products[0] || null;
  const card2Prods = React.useMemo(() => {
    if (!products || products.length === 0) return [];
    const p1 = products.find((p) => p.imageUrl?.includes('jordan-1')) || products[4] || products[1];
    const p2 = products.find((p) => p.imageUrl?.includes('apple-watch-gold')) || products[1] || products[2];
    const p3 = products.find((p) => p.imageUrl?.includes('echo-plus') || p.imageUrl?.includes('homepod')) || products[2] || products[3];
    return [p1, p2, p3].filter(Boolean) as StorefrontProduct[];
  }, [products]);
  const card3Prod = React.useMemo(
    () => products.find((p) => p.imageUrl?.includes('puma-rider')) || products[4] || products[0] || null,
    [products]
  );
  const card4Prod = React.useMemo(
    () => products.find((p) => p.imageUrl?.includes('perfume-jadore')) || products[3] || products[0] || null,
    [products]
  );

  const scrollQuickRow = (scrollDir: 'left' | 'right') => {
    if (!quickRowRef.current) return;
    const offset = scrollDir === 'left' ? -320 : 320;
    quickRowRef.current.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const handleCategoryOrDeals = (catIdx: number) => {
    if (categories && categories[catIdx]) {
      onSelectCategory(categories[catIdx].id);
    } else {
      onSelectDeals();
    }
  };

  return (
    <section
      dir={dir}
      className="sf-amz-vibrant-section"
      style={{
        width: '100%',
        margin: '6px 0 12px',
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        .sf-amz-vibrant-grid {
          display: grid;
          grid-template-columns: 345px minmax(0, 1fr);
          gap: 14px;
          align-items: stretch;
          width: 100%;
        }
        .sf-amz-left-stack {
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-width: 0;
        }
        .sf-amz-promo-cards-row {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          position: relative;
        }
        .sf-amz-promo-card {
          border-radius: 20px;
          overflow: hidden;
          position: relative;
          height: 332px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          transform: translate3d(0, 0, 0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
          user-select: none;
          box-sizing: border-box;
        }
        .sf-amz-promo-card:hover {
          transform: translate3d(0, -4px, 0);
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14);
        }
        .sf-amz-hero-orange-card {
          border-radius: 22px;
          background: linear-gradient(180deg, #ff6200 0%, #f95700 60%, #ea4c00 100%);
          color: #ffffff;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          min-height: 530px;
          box-shadow: 0 10px 26px rgba(249, 87, 0, 0.22);
          transform: translate3d(0, 0, 0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease;
          user-select: none;
          box-sizing: border-box;
        }
        .sf-amz-hero-orange-card:hover {
          transform: translate3d(0, -4px, 0);
          box-shadow: 0 16px 34px rgba(249, 87, 0, 0.28);
        }
        .sf-amz-quick-tiles-wrapper {
          position: relative;
          width: 100%;
          min-width: 0;
        }
        .sf-amz-quick-tiles-row {
          display: grid;
          grid-template-columns: repeat(6, minmax(135px, 1fr));
          gap: 12px;
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          scroll-behavior: smooth;
          padding: 2px 0;
        }
        .sf-amz-quick-tiles-row::-webkit-scrollbar {
          display: none;
        }
        .sf-amz-quick-tile {
          background: #ffffff;
          border: 1px solid #edf1f7;
          border-radius: 16px;
          padding: 12px 12px 10px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 8px;
          height: 184px;
          cursor: pointer;
          box-sizing: border-box;
          transform: translate3d(0, 0, 0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          transition: border-color 0.18s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s ease;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
        }
        .sf-amz-quick-tile:hover {
          border-color: #cbd5e1;
          transform: translate3d(0, -3px, 0);
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
        }
        .sf-amz-floating-nav-btn {
          position: absolute;
          left: 6px;
          top: 50%;
          transform: translate3d(0, -50%, 0);
          width: 34px !important;
          height: 34px !important;
          min-width: 34px !important;
          min-height: 34px !important;
          padding: 0 !important;
          margin: 0 !important;
          background: #ffffff !important;
          border: 1px solid #E0E3E7 !important;
          border-radius: 10px !important;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 10;
          color: #1f1f1f;
          transition: background-color 0.15s ease, box-shadow 0.15s ease, transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .sf-amz-floating-nav-btn:hover {
          background: #ffffff !important;
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18);
          transform: translate3d(0, -50%, 0) scale3d(1.06, 1.06, 1);
        }

        @media (max-width: 1200px) {
          .sf-amz-vibrant-grid {
            grid-template-columns: 300px minmax(0, 1fr);
          }
          .sf-amz-promo-cards-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .sf-amz-quick-tiles-row {
            grid-template-columns: repeat(4, minmax(140px, 1fr));
          }
        }

        @media (max-width: 860px) {
          .sf-amz-vibrant-grid {
            grid-template-columns: 1fr;
          }
          .sf-amz-hero-orange-card {
            min-height: 360px;
          }
          .sf-amz-promo-cards-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .sf-amz-quick-tiles-row {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .sf-amz-floating-nav-btn {
            display: none !important;
          }
        }

        @media (max-width: 640px) {
          .sf-amz-vibrant-section {
            display: none !important;
          }
        }
      `}</style>

      <div className="sf-amz-vibrant-grid">
        {/* RIGHT COLUMN: Tall Vibrant Orange Flagship Campaign Card */}
        <div className="sf-amz-hero-orange-card" onClick={onSelectDeals}>
          <div
            className="sf-amz-orange-copy"
            style={{
              padding: '26px 24px 16px',
              textAlign: isEn ? 'left' : 'right',
              position: 'relative',
              zIndex: 3,
              width: '100%',
              boxSizing: 'border-box',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '10px',
            }}
          >
            <div
              className="sf-amz-orange-kicker"
              style={{
                fontSize: '15px',
                fontWeight: 700,
                lineHeight: 1.45,
                color: '#fff7ed',
                opacity: 0.96,
              }}
            >
              {isEn ? 'Curated Store Collection' : 'تشكيلة المتجر المختارة'}
            </div>
            <h2
              className="sf-amz-orange-title"
              style={{
                margin: 0,
                fontSize: isEn ? '24px' : '27px',
                fontWeight: 800,
                lineHeight: 1.38,
                color: '#ffffff',
                letterSpacing: '-0.2px',
                width: '100%',
              }}
            >
              {isEn ? 'Top Deals & Featured Products' : 'أقوى العروض والمنتجات المميزة'}
            </h2>
            <span
              className="sf-amz-orange-pill"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: '4px',
                background: '#111827',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 700,
                lineHeight: 1.4,
                padding: '7px 18px',
                borderRadius: '10px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.22)',
              }}
            >
              {isEn ? 'Explore Deals Now' : 'استكشف العروض الآن'}
            </span>
          </div>

          {/* Bottom Arch Showcase Stage with Real Store Products */}
          <div
            className="sf-amz-orange-stage"
            style={{
              position: 'relative',
              width: '100%',
              height: '320px',
              marginTop: 'auto',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {/* Glowing Arch Frame with Warm Studio Backlight */}
            <div
              className="sf-amz-orange-arch"
              style={{
                position: 'absolute',
                bottom: 0,
                width: '88%',
                height: '304px',
                borderRadius: '999px 999px 0 0',
                borderTop: '3px solid #ffd4b8',
                borderRight: '3px solid #ffd4b8',
                borderLeft: '3px solid #ffd4b8',
                borderBottom: 'none',
                background:
                  'radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.92) 0%, rgba(255, 198, 150, 0.55) 48%, rgba(234, 76, 0, 0.85) 85%)',
                boxShadow: 'inset 0 12px 28px rgba(255, 255, 255, 0.5), 0 -4px 20px rgba(255, 212, 184, 0.35)',
                zIndex: 1,
              }}
            />

            {/* Pedestals & Curated Products Composition */}
            <div
              className="sf-amz-orange-podiums"
              style={{
                position: 'relative',
                zIndex: 2,
                width: '92%',
                height: '290px',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                gap: '8px',
                paddingBottom: '12px',
              }}
            >
              {/* Right Podium + Product */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'translate3d(0, 6px, 0)' }}>
                <img
                  className="sf-amz-podium-side-img"
                  src={getProductPhotoUrl(stageProdRight)}
                  alt={stageProdRight?.name || (isEn ? 'Featured Deal' : 'عرض مميز')}
                  decoding="async"
                  onError={(e) => {
                    if (stageProdRight) {
                      e.currentTarget.src = generatePremiumProductSvg(stageProdRight.name, stageProdRight.categoryName);
                    }
                  }}
                  style={{
                    width: '104px',
                    height: '104px',
                    objectFit: 'contain',
                    transform: 'translate3d(0, 4px, 0)',
                    position: 'relative',
                    zIndex: 2,
                    filter: 'drop-shadow(0 12px 14px rgba(120, 35, 0, 0.38))',
                  }}
                />
                <div
                  className="sf-amz-podium-side-box"
                  style={{
                    width: '78px',
                    height: '64px',
                    borderRadius: '12px 12px 4px 4px',
                    borderTop: '3px solid #ffb074',
                    background: 'linear-gradient(180deg, #ff852b 0%, #cc3d00 100%)',
                    boxShadow: '0 8px 16px rgba(0,0,0,0.22)',
                  }}
                />
              </div>

              {/* Center Tall Podium + Featured Product */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 3 }}>
                <img
                  className="sf-amz-podium-center-img"
                  src={getProductPhotoUrl(stageProdCenter)}
                  alt={stageProdCenter?.name || (isEn ? 'Featured Deal' : 'عرض مميز')}
                  decoding="async"
                  onError={(e) => {
                    if (stageProdCenter) {
                      e.currentTarget.src = generatePremiumProductSvg(stageProdCenter.name, stageProdCenter.categoryName);
                    }
                  }}
                  style={{
                    width: '132px',
                    height: '132px',
                    objectFit: 'contain',
                    transform: 'translate3d(0, 6px, 0)',
                    position: 'relative',
                    zIndex: 3,
                    filter: 'drop-shadow(0 14px 18px rgba(120, 35, 0, 0.45))',
                  }}
                />
                <div
                  className="sf-amz-podium-center-box"
                  style={{
                    width: '96px',
                    height: '92px',
                    borderRadius: '14px 14px 4px 4px',
                    borderTop: '4px solid #ffc08e',
                    background: 'linear-gradient(180deg, #ff8f3d 0%, #c93b00 100%)',
                    boxShadow: '0 10px 22px rgba(0,0,0,0.28)',
                  }}
                />
              </div>

              {/* Left Podium + Product */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'translate3d(0, 10px, 0)' }}>
                <img
                  className="sf-amz-podium-side-img"
                  src={getProductPhotoUrl(stageProdLeft)}
                  alt={stageProdLeft?.name || (isEn ? 'Featured Deal' : 'عرض مميز')}
                  decoding="async"
                  onError={(e) => {
                    if (stageProdLeft) {
                      e.currentTarget.src = generatePremiumProductSvg(stageProdLeft.name, stageProdLeft.categoryName);
                    }
                  }}
                  style={{
                    width: '104px',
                    height: '104px',
                    objectFit: 'contain',
                    transform: 'translate3d(0, 4px, 0)',
                    position: 'relative',
                    zIndex: 2,
                    filter: 'drop-shadow(0 12px 14px rgba(120, 35, 0, 0.38))',
                  }}
                />
                <div
                  className="sf-amz-podium-side-box"
                  style={{
                    width: '78px',
                    height: '56px',
                    borderRadius: '12px 12px 4px 4px',
                    borderTop: '3px solid #ffb074',
                    background: 'linear-gradient(180deg, #ff852b 0%, #cc3d00 100%)',
                    boxShadow: '0 8px 16px rgba(0,0,0,0.22)',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* LEFT COLUMN: 4 Vibrant Promotional Cards (Top) + 6 Quick Product Tiles (Bottom) */}
        <div className="sf-amz-left-stack">
          {/* TOP ROW: 4 Vibrant Colored Campaign Cards */}
          <div className="sf-amz-promo-cards-row">
            {/* Card 1: Vibrant Azure Blue */}
            <div
              className="sf-amz-promo-card"
              onClick={() => handleCategoryOrDeals(0)}
              style={{
                background: 'linear-gradient(180deg, #2d68c4 0%, #3470ce 60%, #3d7add 100%)',
                color: '#ffffff',
                padding: '20px 18px 14px',
              }}
            >
              <div style={{ textAlign: isEn ? 'left' : 'right', position: 'relative', zIndex: 2 }}>
                <div
                  className="sf-amz-promo-kicker"
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 700,
                    lineHeight: 1.45,
                    color: '#dbeafe',
                    marginBottom: '4px',
                  }}
                >
                  {categories?.[0]?.name || (isEn ? 'Store Picks' : 'اختيارات المتجر')}
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: isEn ? '17.5px' : '19px',
                    fontWeight: 800,
                    lineHeight: 1.4,
                    color: '#ffffff',
                  }}
                >
                  {isEn ? 'Most Popular & Best Selling' : 'الأكثر طلباً ومبيعاً'}
                </h3>
                <div
                  className="sf-amz-promo-sub"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    lineHeight: 1.45,
                    color: '#eff6ff',
                    marginTop: '4px',
                  }}
                >
                  {isEn ? 'Curated top-quality selection' : 'تشكيلة مختارة بأعلى جودة'}
                </div>
              </div>

              <div
                className="sf-amz-promo-stage"
                style={{
                  width: '100%',
                  height: '185px',
                  marginTop: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                {/* Luminous Studio Spotlight Behind Product */}
                <div
                  style={{
                    position: 'absolute',
                    width: '164px',
                    height: '164px',
                    borderRadius: '50%',
                    background:
                      'radial-gradient(circle, rgba(255, 255, 255, 0.92) 0%, rgba(191, 219, 254, 0.45) 48%, rgba(45, 104, 196, 0) 74%)',
                    zIndex: 1,
                  }}
                />
                <img
                  src={getProductPhotoUrl(card1Prod)}
                  alt={card1Prod?.name || (isEn ? 'Featured Product' : 'منتج مميز')}
                  decoding="async"
                  onError={(e) => {
                    if (card1Prod) {
                      e.currentTarget.src = generatePremiumProductSvg(card1Prod.name, card1Prod.categoryName);
                    }
                  }}
                  style={{
                    width: '166px',
                    height: '166px',
                    objectFit: 'contain',
                    position: 'relative',
                    zIndex: 2,
                    transform: 'translate3d(0, 0, 0)',
                    filter: 'drop-shadow(0 14px 18px rgba(15, 23, 42, 0.34))',
                  }}
                />
              </div>
            </div>

            {/* Card 2: Vibrant Sunny Yellow + Blue Diagonal */}
            <div
              className="sf-amz-promo-card"
              onClick={onSelectDeals}
              style={{
                background: 'linear-gradient(168deg, #ffd814 0%, #ffce00 66%, #2d68c4 66.5%, #2353a0 100%)',
                color: '#111827',
                padding: '18px 16px 14px',
              }}
            >
              <div
                style={{
                  textAlign: isEn ? 'left' : 'right',
                  position: 'relative',
                  zIndex: 2,
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '6px',
                }}
              >
                {/* Dark Navy Ribbon Badge */}
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#131921',
                    color: '#ffffff',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    lineHeight: 1.4,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.16)',
                  }}
                >
                  <span style={{ color: '#ffd814', fontWeight: 800 }}>★</span>
                  <span>{isEn ? 'Exclusive Deals' : 'عروض حصرية'}</span>
                </div>

                <h3
                  style={{
                    margin: '2px 0 0',
                    fontSize: isEn ? '17.5px' : '18.5px',
                    fontWeight: 800,
                    lineHeight: 1.4,
                    color: '#0f172a',
                    width: '100%',
                  }}
                >
                  {isEn ? 'Discounts & Value Bundles' : 'تخفيضات وباقات التوفير'}
                </h3>

                <div
                  className="sf-amz-promo-sub"
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    lineHeight: 1.45,
                    color: '#1e293b',
                  }}
                >
                  {isEn ? 'Shop the best prices today' : 'تسوق أفضل الأسعار اليوم'}
                </div>
              </div>

              {/* Curated Dynamic Products Bundle Box at Bottom */}
              <div
                className="sf-amz-bundle-row"
                style={{
                  position: 'relative',
                  zIndex: 2,
                  marginTop: 'auto',
                  background: 'rgba(255, 255, 255, 0.94)',
                  borderRadius: '14px',
                  padding: '8px 6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '4px',
                  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.2)',
                }}
              >
                {(card2Prods.length > 0 ? card2Prods : [products[0]].filter(Boolean)).slice(0, 3).map((prod, idx) => (
                  <img
                    key={`${prod.id}-${idx}`}
                    className="sf-amz-bundle-img"
                    src={getProductPhotoUrl(prod)}
                    alt={prod.name}
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.src = generatePremiumProductSvg(prod.name, prod.categoryName);
                    }}
                    style={{
                      width: '68px',
                      height: '78px',
                      objectFit: 'contain',
                      filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.14))',
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Card 3: Sleek Dark Slate & Navy */}
            <div
              className="sf-amz-promo-card"
              onClick={() => handleCategoryOrDeals(1)}
              style={{
                background: 'linear-gradient(180deg, #273549 0%, #1e293b 55%, #0f172a 100%)',
                color: '#ffffff',
                padding: '20px 18px 14px',
              }}
            >
              <div style={{ textAlign: isEn ? 'left' : 'right', position: 'relative', zIndex: 2 }}>
                <div
                  className="sf-amz-promo-kicker"
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 700,
                    lineHeight: 1.45,
                    color: '#94a3b8',
                    marginBottom: '4px',
                  }}
                >
                  {categories?.[1]?.name || (isEn ? 'Guaranteed Quality' : 'جودة مضمونة')}
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: isEn ? '17.5px' : '19px',
                    fontWeight: 800,
                    lineHeight: 1.4,
                    color: '#ffffff',
                  }}
                >
                  {isEn ? 'Authentic & Certified Products' : 'منتجات أصلية ومعتمدة'}
                </h3>
                <div
                  className="sf-amz-promo-sub"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    lineHeight: 1.45,
                    color: '#cbd5e1',
                    marginTop: '4px',
                  }}
                >
                  {isEn ? 'Always picking the best for you' : 'نختار لك الأفضل دائماً'}
                </div>
              </div>

              <div
                className="sf-amz-promo-stage"
                style={{
                  marginTop: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '185px',
                  position: 'relative',
                }}
              >
                {/* Luminous Studio Spotlight Behind Product */}
                <div
                  style={{
                    position: 'absolute',
                    width: '164px',
                    height: '164px',
                    borderRadius: '50%',
                    background:
                      'radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(148, 163, 184, 0.35) 50%, rgba(15, 23, 42, 0) 74%)',
                    zIndex: 1,
                  }}
                />
                <img
                  src={getProductPhotoUrl(card3Prod)}
                  alt={card3Prod?.name || (isEn ? 'Authentic Product' : 'منتج أصلي')}
                  decoding="async"
                  onError={(e) => {
                    if (card3Prod) {
                      e.currentTarget.src = generatePremiumProductSvg(card3Prod.name, card3Prod.categoryName);
                    }
                  }}
                  style={{
                    width: '166px',
                    height: '166px',
                    objectFit: 'contain',
                    position: 'relative',
                    zIndex: 2,
                    transform: 'translate3d(0, 0, 0)',
                    filter: 'drop-shadow(0 14px 18px rgba(0, 0, 0, 0.45))',
                  }}
                />
              </div>
            </div>

            {/* Card 4: Rich Warm Espresso */}
            <div
              className="sf-amz-promo-card"
              onClick={() => handleCategoryOrDeals(2)}
              style={{
                background: 'linear-gradient(180deg, #5c2d0c 0%, #3b1a06 58%, #230f03 100%)',
                color: '#ffffff',
                padding: '20px 18px 14px',
              }}
            >
              <div style={{ textAlign: isEn ? 'left' : 'right', position: 'relative', zIndex: 2 }}>
                <div
                  className="sf-amz-promo-kicker"
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 700,
                    lineHeight: 1.45,
                    color: '#fed7aa',
                    marginBottom: '4px',
                  }}
                >
                  {categories?.[2]?.name || (isEn ? 'New Arrivals' : 'وصل حديثاً')}
                </div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: isEn ? '17.5px' : '19px',
                    fontWeight: 800,
                    lineHeight: 1.4,
                    color: '#ffffff',
                  }}
                >
                  {isEn ? 'Discover the New Collection' : 'اكتشف التشكيلة الجديدة'}
                </h3>
                <div
                  className="sf-amz-promo-sub"
                  style={{
                    fontSize: '13.5px',
                    fontWeight: 700,
                    lineHeight: 1.45,
                    color: '#fde68a',
                    marginTop: '4px',
                  }}
                >
                  {isEn ? 'Latest releases all in one place' : 'أحدث الإصدارات في مكان واحد'}
                </div>
              </div>

              <div
                className="sf-amz-promo-stage"
                style={{
                  marginTop: 'auto',
                  height: '185px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                {/* Warm Golden Studio Spotlight Behind Product */}
                <div
                  style={{
                    position: 'absolute',
                    width: '164px',
                    height: '164px',
                    borderRadius: '50%',
                    background:
                      'radial-gradient(circle, rgba(255, 251, 235, 0.94) 0%, rgba(253, 230, 138, 0.42) 48%, rgba(59, 26, 6, 0) 74%)',
                    zIndex: 1,
                  }}
                />
                <img
                  src={getProductPhotoUrl(card4Prod)}
                  alt={card4Prod?.name || (isEn ? 'New Collection' : 'تشكيلة جديدة')}
                  decoding="async"
                  onError={(e) => {
                    if (card4Prod) {
                      e.currentTarget.src = generatePremiumProductSvg(card4Prod.name, card4Prod.categoryName);
                    }
                  }}
                  style={{
                    width: '166px',
                    height: '166px',
                    objectFit: 'contain',
                    position: 'relative',
                    zIndex: 2,
                    transform: 'translate3d(0, 0, 0)',
                    filter: 'drop-shadow(0 14px 18px rgba(0, 0, 0, 0.5))',
                  }}
                />
              </div>
            </div>
          </div>

          {/* BOTTOM ROW: 6 Compact White Quick-Discovery Product Tiles */}
          <div className="sf-amz-quick-tiles-wrapper">
            <div ref={quickRowRef} className="sf-amz-quick-tiles-row">
              {quickProducts.slice(0, 6).map((item, idx) => {
                const meta = QUICK_TILE_ITEMS[idx % QUICK_TILE_ITEMS.length];
                const photoUrl = item.imageUrl || resolveProductPhoto(item.name, item.categoryName).url;

                return (
                  <div
                    key={`${item.id}-${idx}`}
                    className="sf-amz-quick-tile"
                    onClick={() => (onQuickView ? onQuickView(item) : onSelectDeals())}
                  >
                    <div
                      className="sf-amz-quick-tile-title"
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#1e293b',
                        lineHeight: 1.35,
                        textAlign: isEn ? 'left' : 'right',
                        paddingInline: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {isEn ? meta.labelEn : meta.labelAr}
                    </div>

                    <div
                      className="sf-amz-quick-tile-img-box"
                      style={{
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '8px',
                        borderRadius: '14px',
                        background: '#f4f6fa',
                      }}
                    >
                      <img
                        className="sf-amz-quick-tile-img"
                        src={photoUrl}
                        alt={item.name}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          e.currentTarget.src = generatePremiumProductSvg(item.name, item.categoryName);
                        }}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '80px',
                          objectFit: 'contain',
                          transform: 'translate3d(0, 0, 0)',
                          filter: 'drop-shadow(0 6px 10px rgba(15, 23, 42, 0.1))',
                        }}
                      />
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <span
                        className="sf-amz-quick-tile-badge"
                        style={{
                          display: 'inline-block',
                          background: meta.badgeBg,
                          color: meta.badgeColor,
                          fontSize: '10px',
                          fontWeight: 600,
                          lineHeight: 1.35,
                          padding: '2.5px 9px',
                          borderRadius: '8px',
                          whiteSpace: 'nowrap',
                          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                        }}
                      >
                        {isEn ? meta.badgeEn : meta.badgeAr}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Sleek Circular Carousel Button (Desktop only) */}
            <button
              type="button"
              className="sf-amz-floating-nav-btn"
              onClick={() => scrollQuickRow('left')}
              aria-label={isEn ? 'Next' : 'التالي'}
              title={isEn ? 'Explore More' : 'استعرض المزيد'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});
