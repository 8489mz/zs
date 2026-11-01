import React from 'react';
import { useStorefrontLang } from '../../../i18n';
import type { StorefrontCategory, StorefrontProduct } from '../types/storefront.types';
import { resolveProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { IconArrowUpRight } from './StorefrontIcons';

interface StorefrontShopByCategoryGridProps {
  categories: StorefrontCategory[];
  products?: StorefrontProduct[];
  categoryCounts?: Map<number | 'all', number>;
  onSelectCategory: (categoryId: number) => void;
  onOpenCategoriesModal?: () => void;
  onSelectDeals?: () => void;
}

interface VibrantTileTheme {
  id: string;
  gradient: string;
  textColor: string;
  badgeBg: string;
  badgeColor: string;
}

const TILE_THEMES: VibrantTileTheme[] = [
  {
    id: 'coral',
    gradient: 'linear-gradient(135deg, #ffa49c 0%, #ffc0b8 48%, #ffe4e6 100%)',
    textColor: '#881337',
    badgeBg: 'rgba(255, 255, 255, 0.82)',
    badgeColor: '#be123c',
  },
  {
    id: 'mint',
    gradient: 'linear-gradient(135deg, #7eedc4 0%, #a7f5d6 48%, #e1fbf2 100%)',
    textColor: '#065f46',
    badgeBg: 'rgba(255, 255, 255, 0.82)',
    badgeColor: '#047857',
  },
  {
    id: 'peach',
    gradient: 'linear-gradient(135deg, #ffb37e 0%, #ffcda5 48%, #fed7aa 100%)',
    textColor: '#7c2d12',
    badgeBg: 'rgba(255, 255, 255, 0.82)',
    badgeColor: '#c2410c',
  },
  {
    id: 'sky',
    gradient: 'linear-gradient(135deg, #7ec0ff 0%, #a4cefe 48%, #dbeafe 100%)',
    textColor: '#0c4a6e',
    badgeBg: 'rgba(255, 255, 255, 0.82)',
    badgeColor: '#0369a1',
  },
  {
    id: 'lavender',
    gradient: 'linear-gradient(135deg, #c4b5fd 0%, #ddd6fe 48%, #ede9fe 100%)',
    textColor: '#4c1d95',
    badgeBg: 'rgba(255, 255, 255, 0.82)',
    badgeColor: '#6d28d9',
  },
  {
    id: 'amber',
    gradient: 'linear-gradient(135deg, #fcd34d 0%, #fde68a 48%, #fef3c7 100%)',
    textColor: '#78350f',
    badgeBg: 'rgba(255, 255, 255, 0.82)',
    badgeColor: '#b45309',
  },
  {
    id: 'slate',
    gradient: 'linear-gradient(135deg, #cbd5e1 0%, #e2e8f0 48%, #f1f5f9 100%)',
    textColor: '#0f172a',
    badgeBg: 'rgba(255, 255, 255, 0.88)',
    badgeColor: '#334155',
  },
  {
    id: 'indigo',
    gradient: 'linear-gradient(135deg, #a5b4fc 0%, #c7d2fe 48%, #e0e7ff 100%)',
    textColor: '#1e1b4b',
    badgeBg: 'rgba(255, 255, 255, 0.82)',
    badgeColor: '#4338ca',
  },
];

export const StorefrontShopByCategoryGrid = React.memo(function StorefrontShopByCategoryGrid({
  categories = [],
  products = [],
  categoryCounts,
  onSelectCategory,
  onOpenCategoriesModal,
  onSelectDeals,
}: StorefrontShopByCategoryGridProps) {
  const { t, isEn, dir } = useStorefrontLang();

  // Curate real populated store categories only (up to 8) — no fake duplicate filler categories
  const tilesData = React.useMemo(() => {
    const validCats = categories.filter((c) => c && c.name && (categoryCounts ? (categoryCounts.get(c.id) || 0) > 0 : true));
    const sorted = [...validCats].sort((a, b) => {
      const cntA = categoryCounts?.get(a.id) || 0;
      const cntB = categoryCounts?.get(b.id) || 0;
      return cntB - cntA;
    });

    return sorted.slice(0, 8).map((cat) => {
      const count = categoryCounts?.get(cat.id);
      const catProduct = products?.find((p) => p.categoryId === cat.id || p.categoryName === cat.name);
      const photo =
        cat.imageUrl && !cat.imageUrl.startsWith('data:image/svg+xml')
          ? cat.imageUrl
          : catProduct?.imageUrl ||
            resolveProductPhoto(catProduct?.name || cat.name, cat.name)?.url ||
            generatePremiumProductSvg(cat.name, cat.name);

      return {
        id: cat.id,
        name: cat.name,
        photo,
        count,
      };
    });
  }, [categories, products, categoryCounts]);

  if (!tilesData || tilesData.length === 0) {
    return null;
  }

  const desktopCols = tilesData.length === 1 ? 1 : tilesData.length === 2 ? 2 : tilesData.length === 3 ? 3 : 4;

  return (
    <section
      className="storefront-section-card storefront-shop-by-cat-section"
      aria-label={t('storefront.shop_by_cat.title', 'تسوق حسب القسم')}
      style={{
        background: '#ffffff',
        borderRadius: '20px',
        border: '1px solid #edf1f7',
        padding: '24px 22px 22px',
        boxShadow: '0 10px 30px -6px rgba(15, 23, 42, 0.04), 0 2px 8px -2px rgba(15, 23, 42, 0.02)',
        margin: '16px 0',
        direction: dir,
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        .sf-cat-tiles-grid {
          display: grid;
          grid-template-columns: repeat(${desktopCols}, minmax(0, 1fr));
          gap: 14px;
        }

        .sf-cat-tile {
          position: relative;
          overflow: hidden;
          border-radius: 16px;
          height: 122px;
          padding: 14px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          cursor: pointer;
          user-select: none;
          box-sizing: border-box;
          border: 1px solid rgba(255, 255, 255, 0.65);
          transform: translate3d(0, 0, 0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease;
          box-shadow: 0 4px 14px -2px rgba(15, 23, 42, 0.06);
        }

        .sf-cat-tile:hover {
          transform: translate3d(0, -3px, 0);
          box-shadow: 0 12px 24px -4px rgba(15, 23, 42, 0.12);
        }

        .sf-cat-tile:active {
          transform: scale3d(0.97, 0.97, 1);
        }

        .sf-cat-tile-title {
          font-size: 14px !important;
          font-weight: 800 !important;
          line-height: 1.38 !important;
          display: -webkit-box !important;
          -webkit-line-clamp: 2 !important;
          -webkit-box-orient: vertical !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: normal !important;
        }

        .sf-cat-tile-img-wrap {
          width: 86px;
          height: 86px;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .sf-cat-tile-img {
          width: 82px;
          height: 82px;
          object-fit: contain;
          transform: translate3d(0, 0, 0);
          transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
          filter: drop-shadow(0 8px 14px rgba(15, 23, 42, 0.14));
          pointer-events: none;
        }

        .sf-cat-tile:hover .sf-cat-tile-img {
          transform: scale(1.08) rotate(-2deg);
        }

        @media (max-width: 1100px) {
          .sf-cat-tiles-grid {
            grid-template-columns: repeat(${Math.min(desktopCols, 3)}, minmax(0, 1fr));
          }
        }

        @media (max-width: 768px) {
          .sf-cat-tiles-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .sf-cat-tile {
            height: 104px;
            padding: 12px 13px;
            border-radius: 14px;
          }
          .sf-cat-tile-img-wrap {
            width: 68px !important;
            height: 68px !important;
          }
          .sf-cat-tile-img {
            width: 64px !important;
            height: 64px !important;
          }
        }

        @media (max-width: 640px) {
          .storefront-shop-by-cat-section {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            padding: 4px 0 !important;
            margin: 6px 0 !important;
          }
          .storefront-shop-by-cat-header {
            margin-bottom: 10px !important;
            padding-bottom: 0 !important;
            border-bottom: none !important;
          }
          .storefront-shop-by-cat-title {
            font-size: 13.5px !important;
            font-weight: 700 !important;
          }
          .sf-cat-tiles-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .sf-cat-tile {
            height: 96px !important;
            padding: 10px 12px !important;
            border-radius: 14px !important;
            gap: 8px !important;
          }
          .sf-cat-tile-img-wrap {
            width: 62px !important;
            height: 62px !important;
          }
          .sf-cat-tile-img {
            width: 58px !important;
            height: 58px !important;
          }
          .sf-cat-tile-title {
            font-size: 12px !important;
            font-weight: 800 !important;
            line-height: 1.35 !important;
            margin-bottom: 2px !important;
          }
          .sf-cat-tile-cta {
            font-size: 9.5px !important;
            font-weight: 700 !important;
            padding: 2.5px 7px !important;
            border-radius: 7px !important;
          }
        }
      `}</style>

      {/* Header Row: Shop By Category & View All */}
      <div
        className="storefront-shop-by-cat-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          borderBottom: '1px solid #f1f5f9',
          paddingBottom: '11px',
          gap: '12px',
          flexWrap: 'nowrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <h2
            className="storefront-shop-by-cat-title"
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 700,
              color: '#0f172a',
              letterSpacing: '-0.15px',
              lineHeight: 1.25,
            }}
          >
            {t('storefront.shop_by_cat.title', 'تسوق حسب القسم')}
          </h2>
        </div>

        <button
          type="button"
          className="storefront-view-all-btn"
          onClick={() => {
            if (onOpenCategoriesModal) {
              onOpenCategoriesModal();
            } else if (onSelectDeals) {
              onSelectDeals();
            }
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--storefront-primary-color, #2d68c4)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            padding: 0,
            margin: 0,
            minHeight: 0,
            height: 'auto',
            fontFamily: 'inherit',
            transition: 'color 0.16s ease, transform 0.16s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateX(-2px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateX(0)';
          }}
        >
          <span className="storefront-shelf-viewall-label">{t('storefront.shop_by_cat.view_all', 'عرض كل الأقسام')}</span>
          <IconArrowUpRight size={13} strokeWidth={2.2} />
        </button>
      </div>

      {/* Vibrant Colorful Category Tiles Grid */}
      <div className="sf-cat-tiles-grid">
        {tilesData.map((item, idx) => {
          const theme = TILE_THEMES[idx % TILE_THEMES.length];

          return (
            <div
              key={`${item.id}-${idx}`}
              className="sf-cat-tile"
              style={{
                background: theme.gradient,
              }}
              onClick={() => {
                onSelectCategory(item.id);
                window.scrollTo({ top: 180, behavior: 'smooth' });
              }}
            >
              {/* Text Side */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  zIndex: 2,
                  minWidth: 0,
                  flex: '1 1 auto',
                  gap: '7px',
                }}
              >
                <h3
                  className="sf-cat-tile-title"
                  style={{
                    margin: 0,
                    width: '100%',
                    color: theme.textColor,
                  }}
                  title={item.name}
                >
                  {item.name}
                </h3>

                <span
                  className="sf-cat-tile-cta"
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 700,
                    color: theme.badgeColor,
                    background: theme.badgeBg,
                    padding: '3px 9px',
                    borderRadius: '8px',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.04)',
                  }}
                >
                  <span>
                    {item.count
                      ? isEn
                        ? `${item.count} Products`
                        : `${item.count} منتج`
                      : t('storefront.shop_by_cat.explore', 'تسوق الآن')}
                  </span>
                  <span style={{ fontSize: '9.5px' }}>{isEn ? '→' : '←'}</span>
                </span>
              </div>

              {/* Studio Photo Showcase */}
              <div className="sf-cat-tile-img-wrap">
                <div
                  style={{
                    position: 'absolute',
                    inset: '2px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 70%)',
                    pointerEvents: 'none',
                  }}
                />
                <img
                  className="sf-cat-tile-img"
                  src={item.photo || generatePremiumProductSvg(item.name, item.name)}
                  alt={item.name}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    e.currentTarget.src = generatePremiumProductSvg(item.name, item.name);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});
