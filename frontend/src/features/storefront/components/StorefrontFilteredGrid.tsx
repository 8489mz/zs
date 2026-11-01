import { useStorefrontLang } from '../../../i18n';
import { useState, useRef, useEffect } from 'react';
import type { StorefrontProduct, StorefrontCategory, StorefrontInfo } from '../types/storefront.types';
import { StorefrontProductCard } from './StorefrontProductCard';
import { IconSearch } from './StorefrontIcons';

interface StorefrontFilteredGridProps {
  searchTerm: string;
  onlyFavorites: boolean;
  onlyDeals: boolean;
  selectedCategory: number | 'all';
  categories: StorefrontCategory[];
  sortBy: 'featured' | 'price-asc' | 'price-desc' | 'name';
  onSortChange: (val: any) => void;
  onGoHome: () => void;
  filteredProducts: StorefrontProduct[];
  paginatedProducts: StorefrontProduct[];
  hasMore: boolean;
  onLoadMore: () => void;
  cartMap: Map<number, number>;
  info: StorefrontInfo;
  smartDealProductIds: Set<number>;
  favoriteIds: Set<number>;
  onAddToCart: (product: StorefrontProduct) => void;
  onUpdateQuantity: (productId: number, qty: number) => void;
  onOpenReviewModal: (product: StorefrontProduct) => void;
  onToggleFavorite: (productId: number) => void;
  onQuickView?: (product: StorefrontProduct) => void;
}

const SORT_OPTIONS: { id: 'featured' | 'price-asc' | 'price-desc' | 'name'; labelAr: string; labelEn: string }[] = [
  { id: 'featured', labelAr: 'المتوفر أولاً (افتراضي)', labelEn: 'In Stock First (Default)' },
  { id: 'price-asc', labelAr: 'السعر: من الأقل للأعلى', labelEn: 'Price: Low to High' },
  { id: 'price-desc', labelAr: 'السعر: من الأعلى للأقل', labelEn: 'Price: High to Low' },
  { id: 'name', labelAr: 'أبجدياً (أ - ي)', labelEn: 'Alphabetical (A - Z)' },
];

export function StorefrontFilteredGrid({
  searchTerm,
  onlyFavorites,
  onlyDeals,
  selectedCategory,
  categories,
  sortBy,
  onSortChange,
  onGoHome,
  filteredProducts,
  paginatedProducts,
  hasMore,
  onLoadMore,
  cartMap,
  info,
  smartDealProductIds,
  favoriteIds,
  onAddToCart,
  onUpdateQuantity,
  onOpenReviewModal,
  onToggleFavorite,
  onQuickView,
}: StorefrontFilteredGridProps) {
  const { t, isEn, dir } = useStorefrontLang();
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSortOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setIsSortOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSortOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSortOpen]);

  const currentCategory = categories.find((c) => c.id === selectedCategory);
  const title = searchTerm
    ? isEn
      ? `Search: "${searchTerm}"`
      : `بحث: "${searchTerm}"`
    : onlyFavorites
    ? isEn
      ? 'Favorite Products'
      : 'المنتجات المفضلة'
    : onlyDeals
    ? isEn
      ? 'Deals & Discounts'
      : 'العروض والتخفيضات'
    : `${currentCategory?.name || (isEn ? 'Selected Category' : 'القسم المختار')}`;

  return (
    <div id="storefront-products-section" dir={dir} style={{ minHeight: '48vh', paddingBottom: '20px', direction: dir }}>
      {/* Filter & Sorting Controls Bar */}
      <div
        className="storefront-filter-header"
        style={{
          background: '#ffffff',
          border: '1px solid #edf1f7',
          borderRadius: '14px',
          padding: '10px 16px',
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          marginBottom: '16px',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
        }}
      >
        {/* Breadcrumb Navigation: Home > Category */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
          }}
        >
          {/* Home Return Button */}
          <button
            type="button"
            onClick={onGoHome}
            title={isEn ? 'Back to Home' : 'العودة للصفحة الرئيسية'}
            aria-label={isEn ? 'Back to Home' : 'العودة للصفحة الرئيسية'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '34px',
              height: '34px',
              minWidth: '34px',
              minHeight: '34px',
              borderRadius: '10px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: 'var(--storefront-primary-color, #2d68c4)',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'all 0.15s ease',
              padding: 0,
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#eff6ff';
              e.currentTarget.style.borderColor = '#bfdbfe';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>

          {/* Breadcrumb text */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            <span
              className="sf-filter-breadcrumb-home"
              onClick={onGoHome}
              style={{
                fontSize: '12.5px',
                color: '#64748b',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--storefront-primary-color, #2d68c4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#64748b';
              }}
            >
              {isEn ? 'Home' : 'الرئيسية'}
            </span>
            <span className="sf-filter-breadcrumb-home" style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 600 }}>/</span>
            <h2
              style={{
                margin: 0,
                fontSize: '14px',
                fontWeight: 700,
                color: '#0f172a',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={title}
            >
              {title}
            </h2>
          </div>

          {/* Count Badge */}
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              background: onlyFavorites ? '#fef2f2' : 'var(--storefront-primary-subtle, rgba(45, 104, 196, 0.12))',
              color: onlyFavorites ? '#dc2626' : 'var(--storefront-primary-color, #2d68c4)',
              border: onlyFavorites ? '1px solid #fecaca' : 'none',
              padding: '2.5px 8px',
              borderRadius: '7px',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {filteredProducts.length} {isEn ? (filteredProducts.length === 1 ? 'item' : 'items') : 'صنف'}
          </span>
        </div>

        {/* Luxury Custom Sort Popover */}
        <div
          ref={sortRef}
          style={{ position: 'relative', display: 'inline-flex' }}
        >
          <button
            type="button"
            onClick={() => setIsSortOpen((prev) => !prev)}
            title={isEn ? 'Sort Products' : 'ترتيب المنتجات'}
            aria-label={isEn ? 'Sort Products' : 'ترتيب المنتجات'}
            aria-expanded={isSortOpen}
            aria-haspopup="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              height: '32px',
              minHeight: '32px',
              padding: sortBy !== 'featured' ? '0 10px' : '0 8px',
              borderRadius: '8px',
              background: isSortOpen || sortBy !== 'featured' ? '#eff6ff' : '#f8fafc',
              border: `1px solid ${isSortOpen || sortBy !== 'featured' ? '#bfdbfe' : '#cbd5e1'}`,
              color: isSortOpen || sortBy !== 'featured' ? '#1d4ed8' : '#1e293b',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'all 0.15s ease',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="21" y1="6" x2="3" y2="6" />
              <line x1="17" y1="12" x2="7" y2="12" />
              <line x1="13" y1="18" x2="11" y2="18" />
            </svg>
            {sortBy !== 'featured' && (
              <span style={{ fontSize: '11px', fontWeight: 700 }}>
                {(() => {
                  const found = SORT_OPTIONS.find((o) => o.id === sortBy);
                  const lbl = found ? (isEn ? found.labelEn : found.labelAr) : '';
                  return lbl.split(':')[0] || (isEn ? 'Sort' : 'ترتيب');
                })()}
              </span>
            )}
          </button>

          {isSortOpen && (
            <div
              dir={dir}
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                insetInlineEnd: 0,
                zIndex: 100,
                minWidth: '210px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
                padding: '6px',
              }}
            >
              <div
                style={{
                  fontSize: '10.5px',
                  fontWeight: 700,
                  color: '#94a3b8',
                  padding: '4px 8px 6px',
                  borderBottom: '1px solid #f1f5f9',
                  marginBottom: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>{isEn ? 'Sort by' : 'ترتيب حسب'}</span>
                {sortBy !== 'featured' && (
                  <button
                    type="button"
                    onClick={() => {
                      onSortChange('featured');
                      setIsSortOpen(false);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      fontSize: '10px',
                      cursor: 'pointer',
                      padding: 0,
                      minHeight: 0,
                      height: 'auto',
                      textDecoration: 'underline',
                    }}
                  >
                    {isEn ? 'Reset default' : 'استعادة الافتراضي'}
                  </button>
                )}
              </div>

              {SORT_OPTIONS.map((opt) => {
                const isSelected = sortBy === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onSortChange(opt.id);
                      setIsSortOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      minHeight: 0,
                      height: 'auto',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: 'none',
                      background: isSelected ? '#eff6ff' : 'transparent',
                      color: isSelected ? '#1d4ed8' : '#334155',
                      fontSize: '12px',
                      fontWeight: isSelected ? 800 : 500,
                      cursor: 'pointer',
                      textAlign: isEn ? 'left' : 'right',
                      transition: 'background 0.12s ease',
                      marginBottom: '2px',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span>{isEn ? opt.labelEn : opt.labelAr}</span>
                    {isSelected && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Product Cards Grid */}
      {filteredProducts.length === 0 ? (
        <div
          style={{
            background: '#ffffff',
            borderRadius: '14px',
            border: '1px dashed #cbd5e1',
            padding: '50px 20px',
            textAlign: 'center',
            color: '#64748b',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
            {onlyFavorites ? (
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f43f5e"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            ) : (
              <IconSearch size={36} color="#94a3b8" />
            )}
          </div>
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 800, color: '#1e293b' }}>
            {onlyFavorites
              ? isEn
                ? 'Your favorites list is currently empty'
                : 'قائمتك المفضلة فارغة حالياً'
              : isEn
                ? 'No matching products found'
                : 'لا توجد منتجات مطابقة'}
          </h3>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#94a3b8' }}>
            {onlyFavorites
              ? isEn
                ? 'Tap the heart icon on any product to save it to your favorites for quick access anytime.'
                : 'اضغط على رمز القلب في أي منتج لإضافته إلى قائمتك المفضلة والوصول إليه بسرعة في أي وقت.'
              : isEn
                ? 'Try searching for another product name or browse other store categories.'
                : 'جرب البحث باسم صنف آخر أو تصفح الأقسام الأخرى.'}
          </p>
          <button
            type="button"
            onClick={onGoHome}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              background: 'var(--storefront-primary-color, #2d68c4)',
              color: '#ffffff',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {onlyFavorites
              ? isEn
                ? 'Browse All Products'
                : 'تصفح جميع المنتجات'
              : isEn
                ? 'Back to Home'
                : 'العودة للصفحة الرئيسية'}
          </button>
        </div>
      ) : (
        <>
          <div className={`storefront-products-grid ${paginatedProducts.length === 1 ? 'is-single-product' : ''}`}>
            {paginatedProducts.map((product) => (
              <StorefrontProductCard
                key={product.id}
                product={product}
                cartQuantity={cartMap.get(product.id) || 0}
                whatsappPhone={info.whatsappPhone}
                onAddToCart={onAddToCart}
                onUpdateQuantity={onUpdateQuantity}
                isSmartDeal={smartDealProductIds.has(product.id)}
                onOpenReviewModal={onOpenReviewModal}
                isFavorite={favoriteIds.has(product.id)}
                onToggleFavorite={onToggleFavorite}
                onQuickView={onQuickView}
              />
            ))}
          </div>

          {/* Load More Button */}
          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: '28px' }}>
              <button
                type="button"
                onClick={onLoadMore}
                style={{
                  padding: '10px 24px',
                  borderRadius: '10px',
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  color: '#0f172a',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                }}
              >
                {isEn
                  ? `Show More Products (${filteredProducts.length - paginatedProducts.length} remaining) ↓`
                  : `عرض المزيد من المنتجات (${filteredProducts.length - paginatedProducts.length} متبقي) ↓`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
