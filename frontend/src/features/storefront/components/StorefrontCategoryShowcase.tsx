import { useRef, useEffect } from 'react';
import { useStorefrontLang } from '../../../i18n';
import { StorefrontCategory } from '../types/storefront.types';
import { generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { IconFolder, IconGrid, IconArrowUpRight } from './StorefrontIcons';

interface StorefrontCategoryShowcaseProps {
  categories: StorefrontCategory[];
  selectedCategoryId: number | 'all';
  onSelectCategory: (id: number | 'all') => void;
  onOpenCategoriesModal: () => void;
  categoryCounts: Map<number | 'all', number>;
}

function formatSmartCategoryName(categoryName?: string, isEn?: boolean): string {
  if (!categoryName) return isEn ? 'General' : 'عام';
  const trimmed = categoryName.trim();
  if (trimmed.includes(' - ')) {
    const parts = trimmed.split(' - ').map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 1] || trimmed;
  }
  if (trimmed.includes(' / ')) {
    const parts = trimmed.split(' / ').map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 1] || trimmed;
  }
  if (trimmed.includes(': ')) {
    const parts = trimmed.split(': ').map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 1] || trimmed;
  }
  return trimmed;
}

function formatConciseMobileCategoryName(categoryName?: string, isEn?: boolean): string {
  const base = formatSmartCategoryName(categoryName, isEn);
  if (isEn) {
    return base
      .replace('Phones & Smart Audio', 'Phones & Audio')
      .replace('Laptops & Tablets', 'Laptops')
      .replace('Luxury & Smart Watches', 'Watches')
      .replace('Perfumes & Beauty', 'Perfumes')
      .replace('Sneakers & Casual Shoes', 'Sneakers')
      .replace('Bags & Luxury Eyewear', 'Bags & Eyewear')
      .replace('Bags & Sunglasses', 'Bags & Eyewear')
      .replace("Men's Fashion & Apparel", "Men's Fashion")
      .replace("Women's Fashion & Apparel", "Women's Fashion");
  }
  return base
    .replace('العطور ومستحضرات التجميل', 'العطور والتجميل')
    .replace('الهواتف والصوتيات الذكية', 'الهواتف والصوتيات')
    .replace('الساعات الفاخرة والذكية', 'الساعات الفاخرة')
    .replace('الحقائب والنظارات الفاخرة', 'الحقائب والنظارات')
    .replace('الحقائب والنظارات الشمسية', 'الحقائب والنظارات')
    .replace('الأحذية الرياضية والكاجوال', 'الأحذية الرياضية')
    .replace('الأزياء والملابس الرجالية', 'الأزياء الرجالية')
    .replace('الأزياء والملابس النسائية', 'الأزياء النسائية');
}

export function StorefrontCategoryShowcase({
  categories,
  selectedCategoryId,
  onSelectCategory,
  onOpenCategoriesModal,
  categoryCounts,
}: StorefrontCategoryShowcaseProps) {
  const { t, isEn, dir } = useStorefrontLang();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedCategoryId !== 'all' && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [selectedCategoryId]);

  if (!categories || categories.length === 0) return null;

  // Filter only categories that have products, and take top 10 sorted by count
  const populatedCategories = categories
    .filter((c) => (categoryCounts.get(c.id) || 0) > 0)
    .sort((a, b) => (categoryCounts.get(b.id) || 0) - (categoryCounts.get(a.id) || 0));

  const topCategories = populatedCategories.slice(0, 10);
  const remainingCount = populatedCategories.length - topCategories.length;

  const scrollByDirection = (direction: 'right' | 'left') => {
    const el = containerRef.current;
    if (!el) return;
    const scrollAmount = 320;
    el.scrollBy({
      left: direction === 'right' ? scrollAmount : -scrollAmount,
      behavior: 'smooth',
    });
  };

  return (
    <div
      className="storefront-cat-showcase"
      style={{
        background: '#ffffff',
        borderBottom: 'none',
        borderRadius: '18px',
        border: '1px solid #edf1f7',
        boxShadow: '0 4px 18px rgba(15, 23, 42, 0.03)',
        padding: '14px 14px',
        direction: dir,
        maxWidth: 'var(--storefront-container, 1440px)',
        margin: '18px auto 12px',
        width: 'calc(100% - 32px)',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        position: 'relative',
      }}
    >
      <style>{`
        .sf-mobile-cat-header {
          display: none;
        }
        .sf-mobile-cat-pills-row {
          display: none;
        }
        .storefront-cat-scroll-viewport {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        .storefront-cat-scroll-viewport::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }
        .storefront-cat-nav-btn {
          width: 36px !important;
          height: 36px !important;
          min-width: 36px !important;
          min-height: 36px !important;
          border-radius: 10px !important;
          border: 1px solid #e2e8f0 !important;
          background: #ffffff !important;
          color: #1e293b !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: pointer !important;
          flex-shrink: 0 !important;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05) !important;
          transition: all 0.2s ease !important;
          padding: 0 !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
        .storefront-cat-nav-btn:hover {
          background: var(--storefront-primary-color, #2d68c4) !important;
          border-color: var(--storefront-primary-color, #2d68c4) !important;
          color: #ffffff !important;
          box-shadow: 0 4px 12px rgba(45, 104, 196, 0.2) !important;
        }
        .storefront-cat-nav-btn:active {
          transform: scale(0.96) !important;
        }
        @media (max-width: 920px) {
          .storefront-cat-showcase {
            margin: 14px auto 10px !important;
          }
        }
        @media (max-width: 768px) {
          .storefront-cat-showcase {
            width: 100% !important;
            margin: 6px auto 6px !important;
            border-radius: 0 !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            padding: 4px 14px 2px !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
            box-sizing: border-box !important;
          }
          .storefront-cat-nav-btn,
          .storefront-cat-scroll-viewport {
            display: none !important;
          }
          .sf-mobile-cat-header {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            width: 100% !important;
            padding: 0 2px !important;
            box-sizing: border-box !important;
          }
          .sf-mobile-cat-pills-row {
            display: flex !important;
            align-items: flex-start !important;
            gap: 10px !important;
            overflow-x: auto !important;
            scrollbar-width: none !important;
            -ms-overflow-style: none !important;
            -webkit-overflow-scrolling: touch !important;
            scroll-snap-type: x proximity !important;
            touch-action: pan-x pan-y !important;
            padding: 2px 2px 6px !important;
            margin: 0 -2px !important;
          }
          .sf-mobile-cat-pills-row::-webkit-scrollbar {
            display: none !important;
            width: 0 !important;
            height: 0 !important;
          }
          .sf-mobile-cat-circle-item,
          button.sf-mobile-cat-circle-item {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: flex-start !important;
            gap: 5px !important;
            width: 76px !important;
            min-width: 76px !important;
            max-width: 80px !important;
            min-height: 0 !important;
            height: auto !important;
            flex-shrink: 0 !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            cursor: pointer !important;
            scroll-snap-align: start !important;
            font-family: inherit !important;
            transition: transform 0.16s ease !important;
            box-sizing: border-box !important;
          }
          .sf-mobile-cat-circle-item:active {
            transform: scale(0.95) !important;
          }
          .sf-mobile-cat-circle-avatar {
            width: 62px !important;
            height: 62px !important;
            border-radius: 14px !important;
            background: #ffffff !important;
            border: 1.5px solid #e8edf4 !important;
            box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 7px !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            transition: all 0.18s cubic-bezier(0.22, 1, 0.36, 1) !important;
          }
          .sf-mobile-cat-circle-item.is-active .sf-mobile-cat-circle-avatar {
            border: 2px solid var(--storefront-primary-color, #2d68c4) !important;
            background: var(--storefront-primary-subtle, #eff6ff) !important;
            box-shadow: 0 6px 14px rgba(45, 104, 196, 0.18) !important;
          }
          .sf-mobile-cat-circle-label {
            font-size: 10.5px !important;
            font-weight: 600 !important;
            color: #0f172a !important;
            line-height: 1.32 !important;
            text-align: center !important;
            width: 100% !important;
            display: -webkit-box !important;
            -webkit-line-clamp: 2 !important;
            -webkit-box-orient: vertical !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: normal !important;
            word-break: break-word !important;
          }
          .sf-mobile-cat-circle-item.is-active .sf-mobile-cat-circle-label {
            color: var(--storefront-primary-color, #2d68c4) !important;
            font-weight: 700 !important;
          }
        }
      `}</style>

      {/* Mobile-Only Header Row ("الأقسام" + "عرض الكل") */}
      <div className="sf-mobile-cat-header">
        <span
          style={{
            fontSize: '13.5px',
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.1px',
          }}
        >
          {isEn ? 'Categories' : 'الأقسام'}
        </span>
        <button
          type="button"
          className="storefront-view-all-btn"
          onClick={onOpenCategoriesModal}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            margin: 0,
            minHeight: 0,
            height: 'auto',
            fontSize: '11.5px',
            fontWeight: 600,
            color: 'var(--storefront-primary-color, #2d68c4)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <span>{isEn ? 'View All' : 'عرض الكل'}</span>
          <IconArrowUpRight size={13} strokeWidth={2.2} />
        </button>
      </div>

      {/* Mobile-Only Horizontal Swipeable Circular Categories Strip */}
      <div className="sf-mobile-cat-pills-row">
        <button
          type="button"
          className={`sf-mobile-cat-circle-item ${selectedCategoryId === 'all' ? 'is-active' : ''}`}
          onClick={() => {
            if (selectedCategoryId !== 'all') {
              onSelectCategory('all');
            } else {
              onOpenCategoriesModal();
            }
          }}
        >
          <span
            className="sf-mobile-cat-circle-avatar"
            style={{
              background: 'var(--storefront-primary-subtle, #eff6ff)',
              color: 'var(--storefront-primary-color, #2d68c4)',
            }}
          >
            <IconGrid size={22} />
          </span>
          <span className="sf-mobile-cat-circle-label">{isEn ? 'All' : 'الكل'}</span>
        </button>

        {populatedCategories.slice(0, 14).map((cat) => {
          const isSelected = selectedCategoryId === cat.id;
          const photoUrl =
            cat.imageUrl && !cat.imageUrl.startsWith('data:image/svg+xml')
              ? cat.imageUrl
              : generatePremiumProductSvg(cat.name, cat.name);

          return (
            <button
              key={`mob-circle-${cat.id}`}
              type="button"
              className={`sf-mobile-cat-circle-item ${isSelected ? 'is-active' : ''}`}
              onClick={() => onSelectCategory(isSelected ? 'all' : cat.id)}
            >
              <span className="sf-mobile-cat-circle-avatar">
                <img
                  src={photoUrl}
                  alt={cat.name}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onError={(e) => {
                    e.currentTarget.src = generatePremiumProductSvg(cat.name, cat.name);
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    borderRadius: '10px',
                  }}
                />
              </span>
              <span className="sf-mobile-cat-circle-label">{formatConciseMobileCategoryName(cat.name, isEn)}</span>
            </button>
          );
        })}
      </div>

      {/* زر التمرير لليمين (للديسكتوب فقط) */}
      <button
        type="button"
        aria-label={isEn ? 'Scroll right' : 'التمرير لليمين'}
        className="storefront-cat-nav-btn"
        onClick={() => scrollByDirection('right')}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {/* منطقة عرض الأقسام بدون شريط تمرير سفلي */}
      <div
        ref={containerRef}
        className="storefront-cat-scroll-viewport"
        style={{
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '2px',
        }}
      >
        <div
          className="storefront-cat-showcase-inner storefront-category-showcase"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            gap: '20px',
            width: 'max-content',
            minWidth: '100%',
          }}
        >
          {/* أول زر: كل الأقسام / الرئيسية */}
          <div
            className="storefront-cat-item"
            onClick={() => {
              if (selectedCategoryId !== 'all') {
                onSelectCategory('all');
              } else {
                onOpenCategoriesModal();
              }
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-start',
              cursor: 'pointer',
              minWidth: '78px',
              maxWidth: '92px',
              flexShrink: 0,
              transition: 'transform 0.18s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-3px)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
          >
            <div
              className="storefront-cat-avatar"
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '14px',
                background: 'var(--storefront-primary-subtle, #eff6ff)',
                color: 'var(--storefront-primary-color, #2d68c4)',
                border:
                  selectedCategoryId === 'all'
                    ? '2px solid var(--storefront-primary-color, #2d68c4)'
                    : '1.5px solid rgba(45, 104, 196, 0.22)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '6px',
                boxSizing: 'border-box',
                boxShadow:
                  selectedCategoryId === 'all'
                    ? '0 6px 14px rgba(45, 104, 196, 0.18)'
                    : '0 2px 6px rgba(15, 23, 42, 0.04)',
                transition: 'all 0.2s ease',
              }}
            >
              <IconGrid size={22} />
            </div>
            <span
              className="storefront-cat-label"
              style={{
                fontSize: '12px',
                fontWeight: selectedCategoryId === 'all' ? 700 : 600,
                lineHeight: 1.3,
                color: 'var(--storefront-primary-color, #2d68c4)',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {selectedCategoryId === 'all'
                ? isEn
                  ? 'All Categories'
                  : 'كل الأقسام'
                : isEn
                ? 'Home (All)'
                : 'الرئيسية (الكل)'}
            </span>
          </div>

          {/* Top 10 Curated Category Rounded-Square Cards */}
          {topCategories.map((cat) => {
            const isSelected = selectedCategoryId === cat.id;
            const photoUrl =
              cat.imageUrl && !cat.imageUrl.startsWith('data:image/svg+xml')
                ? cat.imageUrl
                : generatePremiumProductSvg(cat.name, cat.name);

            return (
              <div
                key={cat.id}
                ref={isSelected ? selectedItemRef : undefined}
                className="storefront-cat-item"
                onClick={() => onSelectCategory(isSelected ? 'all' : cat.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  cursor: 'pointer',
                  minWidth: '80px',
                  maxWidth: '96px',
                  flexShrink: 0,
                  transition: 'transform 0.18s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-3px)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                <div
                  className="storefront-cat-avatar"
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '14px',
                    overflow: 'hidden',
                    border: isSelected ? '2px solid var(--storefront-primary-color, #2d68c4)' : '1px solid #e2e8f0',
                    marginBottom: '6px',
                    boxShadow: isSelected
                      ? '0 6px 16px var(--storefront-primary-subtle, rgba(45, 104, 196, 0.22))'
                      : '0 2px 6px rgba(15, 23, 42, 0.04)',
                    position: 'relative',
                    background: isSelected ? 'var(--storefront-primary-subtle, #eff6ff)' : '#f8fafc',
                    padding: '5px',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease',
                  }}
                >
                  <img
                    src={photoUrl}
                    alt={cat.name}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onError={(e) => {
                      e.currentTarget.src = generatePremiumProductSvg(cat.name, cat.name);
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      borderRadius: '10px',
                      pointerEvents: 'none',
                      transition: 'transform 0.3s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  />
                </div>
                <span
                  className="storefront-cat-label"
                  style={{
                    fontSize: '12px',
                    fontWeight: isSelected ? 700 : 600,
                    lineHeight: 1.3,
                    color: isSelected ? 'var(--storefront-primary-color, #2d68c4)' : '#0f172a',
                    textAlign: 'center',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    maxWidth: '94px',
                  }}
                  title={cat.name}
                >
                  {formatSmartCategoryName(cat.name, isEn)}
                </span>
              </div>
            );
          })}

          {/* "More Categories" Rounded-Square Avatar */}
          <div
            className="storefront-cat-item"
            onClick={onOpenCategoriesModal}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-start',
              cursor: 'pointer',
              minWidth: '78px',
              maxWidth: '92px',
              flexShrink: 0,
              transition: 'transform 0.18s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-3px)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
          >
            <div
              className="storefront-cat-avatar"
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '14px',
                background: '#f8fafc',
                color: '#0f172a',
                border: '1.5px dashed #cbd5e1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '6px',
                boxSizing: 'border-box',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)',
                transition: 'all 0.2s ease',
              }}
            >
              <IconFolder size={20} color="#0f172a" strokeWidth={1.8} />
            </div>
            <span
              className="storefront-cat-label"
              style={{
                fontSize: '12px',
                fontWeight: 600,
                lineHeight: 1.3,
                color: '#0f172a',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {remainingCount > 0
                ? t('storefront.storefront_category_showcase.s2', 'باقي الأقسام')
                : isEn
                ? 'Category Guide'
                : 'دليل الأقسام'}
            </span>
          </div>
        </div>
      </div>

      {/* زر التمرير لليسار (للديسكتوب فقط) */}
      <button
        type="button"
        aria-label={isEn ? 'Scroll left' : 'التمرير لليسار'}
        className="storefront-cat-nav-btn"
        onClick={() => scrollByDirection('left')}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    </div>
  );
}
