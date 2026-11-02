import { useStorefrontLang } from '@/i18n';
import { StorefrontCategory } from '../types/storefront.types';
import { IconGrid, IconTag, IconCheckCircle, IconClose } from './StorefrontIcons';

interface StorefrontSubNavProps {
  categories: StorefrontCategory[];
  selectedCategoryId?: number | 'all';
  onSelectCategory?: (id: number | 'all') => void;
  onOpenCategoriesModal: () => void;
  onlyDeals: boolean;
  onToggleDeals: () => void;
  inStockOnly: boolean;
  onToggleInStock: () => void;
  dealsCount: number;
  onlyFavorites?: boolean;
  onToggleFavorites?: () => void;
  favoritesCount?: number;
  onClearFilters?: () => void;
}

export function StorefrontSubNav({
  categories,
  selectedCategoryId = 'all',
  onOpenCategoriesModal,
  onlyDeals,
  onToggleDeals,
  inStockOnly,
  onToggleInStock,
  dealsCount,
  onlyFavorites = false,
  onToggleFavorites,
  favoritesCount = 0,
  onClearFilters,
}: StorefrontSubNavProps) {
  const { isEn, dir } = useStorefrontLang();
  return (
    <div
      className="storefront-subnav"
      dir={dir}
      style={{
        background: '#ffffff',
        border: '1px solid #edf1f7',
        borderRadius: '16px',
        boxShadow: '0 2px 10px rgba(15, 23, 42, 0.03)',
        padding: '8px 14px',
        position: 'relative',
        zIndex: 85,
        width: '100%',
        maxWidth: '100%',
        margin: '0 0 12px 0',
        boxSizing: 'border-box',
        direction: dir,
      }}
    >
      <style>{`
        @media (max-width: 640px) {
          .storefront-subnav {
            padding: 5px 8px !important;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            -ms-overflow-style: none;
            width: 100% !important;
            max-width: 100vw !important;
            box-sizing: border-box !important;
          }
          .storefront-subnav::-webkit-scrollbar {
            display: none;
          }
          .storefront-subnav-inner {
            flex-wrap: nowrap !important;
            gap: 6px !important;
            width: max-content !important;
            min-width: 100% !important;
            padding-inline-end: 10px !important;
          }
          .storefront-subnav-pills {
            flex-wrap: nowrap !important;
            gap: 5px !important;
            flex-shrink: 0 !important;
            padding-inline-end: 10px !important;
          }
          .storefront-subnav-active-cat {
            flex-shrink: 0 !important;
          }
          .storefront-subnav-pill {
            padding: 0 14px !important;
            font-size: clamp(10.5px, 2.7vw, 12px) !important;
            white-space: nowrap;
            height: 35px !important;
            min-height: 35px !important;
            border-radius: 12px !important;
          }
          .storefront-subnav-hint {
            display: none !important;
          }
        }
      `}</style>
      <div
        className="storefront-subnav-inner storefront-subnav-shell"
        style={{
          width: '100%',
          maxWidth: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        {/* Category Drawer Button + Filter Pills */}
        <div className="storefront-subnav-pills" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Main "Browse Categories" Button */}
          <button
            className="storefront-subnav-pill"
            type="button"
            onClick={onOpenCategoriesModal}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 16px',
              height: '35px',
              borderRadius: '12px',
              background: 'var(--storefront-primary-color, #170e5e)',
              color: 'var(--storefront-primary-contrast, #ffffff)',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              transition: 'all 0.15s ease',
              boxSizing: 'border-box',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.15)')}
            onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
          >
            <IconGrid size={15} strokeWidth={2.2} color="currentColor" />
            <span>{isEn ? 'Browse Categories' : 'تصفح الأقسام'}</span>
            <span
              style={{
                fontSize: '11px',
                background: 'rgba(255,255,255,0.22)',
                padding: '2px 8px',
                borderRadius: '6px',
                fontWeight: 700,
              }}
            >
              {categories.length}
            </span>
          </button>

          {/* Deals Pill */}
          {(dealsCount > 0 || onlyDeals) && (
            <button
              className="storefront-subnav-pill"
              type="button"
              onClick={onToggleDeals}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                padding: '0 16px',
                height: '35px',
                borderRadius: '12px',
                border: onlyDeals ? '1.5px solid #e11d48' : '1px solid #dadce0',
                background: onlyDeals ? '#fff1f2' : '#ffffff',
                color: onlyDeals ? '#be123c' : '#1f2937',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: onlyDeals ? '0 1px 3px rgba(225, 29, 72, 0.12)' : '0 1px 2px rgba(15, 23, 42, 0.05)',
                transition: 'all 0.15s ease',
                boxSizing: 'border-box',
              }}
            >
              <IconTag size={14} color={onlyDeals ? '#e11d48' : '#e11d48'} strokeWidth={2.2} />
              <span>{isEn ? 'Deals & Discounts' : 'عروض وتخفيضات'}</span>
              {dealsCount > 0 && (
                <span
                  style={{
                    fontSize: '11px',
                    background: onlyDeals ? '#e11d48' : '#ffe4e6',
                    color: onlyDeals ? '#ffffff' : '#be123c',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontWeight: 700,
                  }}
                >
                  {dealsCount}
                </span>
              )}
            </button>
          )}

          {/* In Stock Only Pill */}
          <button
            className="storefront-subnav-pill"
            type="button"
            onClick={onToggleInStock}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 16px',
              height: '35px',
              borderRadius: '12px',
              border: inStockOnly ? '1.5px solid #16a34a' : '1px solid #dadce0',
              background: inStockOnly ? '#f0fdf4' : '#ffffff',
              color: inStockOnly ? '#166534' : '#1f1f1f',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
              transition: 'all 0.15s ease',
              boxSizing: 'border-box',
            }}
          >
            <IconCheckCircle size={14} color={inStockOnly ? '#16a34a' : '#64748b'} strokeWidth={2} />
            <span>{isEn ? 'In Stock' : 'المتوفر بالمخزن'}</span>
          </button>

          {/* Favorites Filter Pill */}
          {onToggleFavorites && (
            <button
              className="storefront-subnav-pill"
              type="button"
              onClick={onToggleFavorites}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0 16px',
                height: '35px',
                borderRadius: '12px',
                border: onlyFavorites ? '1.5px solid #ef4444' : '1px solid #dadce0',
                background: onlyFavorites ? '#fef2f2' : '#ffffff',
                color: onlyFavorites ? '#dc2626' : '#1f1f1f',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
                transition: 'all 0.15s ease',
                boxSizing: 'border-box',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill={onlyFavorites || favoritesCount > 0 ? '#ef4444' : 'none'}
                stroke={onlyFavorites || favoritesCount > 0 ? '#ef4444' : '#94a3b8'}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              <span>{isEn ? 'Favorites' : 'المفضلة'}</span>
              {favoritesCount > 0 && (
                <span
                  style={{
                    fontSize: '10.5px',
                    background: onlyFavorites ? '#ef4444' : '#fee2e2',
                    color: onlyFavorites ? '#ffffff' : '#991b1b',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontWeight: 700,
                  }}
                >
                  {favoritesCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Clean Reset Button if any filter is active */}
        {(selectedCategoryId !== 'all' || onlyFavorites || onlyDeals || inStockOnly) && onClearFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              background: '#f8fafc',
              border: '1px solid #dadce0',
              color: '#64748b',
              fontSize: '11.5px',
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: '10px',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#fee2e2';
              e.currentTarget.style.color = '#dc2626';
              e.currentTarget.style.borderColor = '#fca5a5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.color = '#64748b';
              e.currentTarget.style.borderColor = '#dadce0';
            }}
          >
            <IconClose size={12} strokeWidth={2.5} />
            <span>{isEn ? 'Clear Filters' : 'مسح التصفية'}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
