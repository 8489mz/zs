import React from 'react';
import { useStorefrontLang } from '@/i18n';
import type { StorefrontProduct, StorefrontCategory, StorefrontInfo } from '../types/storefront.types';
import { StorefrontShelfSection } from './StorefrontShelfSection';
import { StorefrontMidBannerCard } from './StorefrontMidBannerCard';
import { StorefrontAmazonVibrantSection } from './StorefrontAmazonVibrantSection';
import { StorefrontShopByCategoryGrid } from './StorefrontShopByCategoryGrid';
import { StorefrontFlashSaleCountdown } from './StorefrontFlashSaleCountdown';

interface TopHomepageSection {
  categoryId: number;
  categoryName: string;
  products: StorefrontProduct[];
  totalCount: number;
}

interface StorefrontMultiRowHomeProps {
  dealsProducts: StorefrontProduct[];
  topHomepageSections: TopHomepageSection[];
  categories: StorefrontCategory[];
  categoryCounts?: Map<number | 'all', number>;
  cartMap: Map<number, number>;
  info: StorefrontInfo;
  favoriteIds: Set<number>;
  onAddToCart: (product: StorefrontProduct) => void;
  onUpdateQuantity: (productId: number, qty: number) => void;
  onOpenReviewModal: (product: StorefrontProduct) => void;
  onToggleFavorite: (productId: number) => void;
  onQuickView?: (product: StorefrontProduct) => void;
  onSelectDeals: () => void;
  onSelectCategory: (categoryId: number) => void;
  onOpenCategoriesModal: () => void;
}

export function StorefrontMultiRowHome({
  dealsProducts,
  topHomepageSections,
  categories,
  categoryCounts,
  cartMap,
  info,
  favoriteIds,
  onAddToCart,
  onUpdateQuantity,
  onOpenReviewModal,
  onToggleFavorite,
  onQuickView,
  onSelectDeals,
  onSelectCategory,
  onOpenCategoriesModal,
}: StorefrontMultiRowHomeProps) {
  const { isEn } = useStorefrontLang();

  const allProducts = React.useMemo(() => {
    const list: StorefrontProduct[] = [];
    const seen = new Set<number>();
    for (const p of dealsProducts) {
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        list.push(p);
      }
    }
    for (const sec of topHomepageSections) {
      if (sec && Array.isArray(sec.products)) {
        for (const p of sec.products) {
          if (p && !seen.has(p.id)) {
            seen.add(p.id);
            list.push(p);
          }
        }
      }
    }
    return list;
  }, [dealsProducts, topHomepageSections]);

  const isMidBannersActive = info.midBannersEnabled !== false;
  const validMidBanners = isMidBannersActive && Array.isArray(info.midBanners)
    ? info.midBanners.filter((b) => b && b.imageUrl && b.isEnabled !== false)
    : [];

  const getBannersForSlot = (slot: string, fallbackIdx?: number) => {
    const matched = validMidBanners.filter((b) => b.slot === slot);
    if (matched.length > 0) return matched;
    if (fallbackIdx !== undefined && validMidBanners[fallbackIdx] && !validMidBanners[fallbackIdx].slot) {
      return [validMidBanners[fallbackIdx]];
    }
    return [];
  };

  const afterDealsBanners = getBannersForSlot('after_deals', 0);
  const bottomBanners = getBannersForSlot('bottom', validMidBanners.length > 3 ? 3 : undefined);

  return (
    <div className="storefront-homepage-sections">
      {/* Row 0: Vibrant Amazon-Style Campaign Cards & Quick Deal Tiles */}
      <StorefrontAmazonVibrantSection
        products={allProducts}
        categories={categories}
        onSelectDeals={onSelectDeals}
        onSelectCategory={onSelectCategory}
        onQuickView={onQuickView}
      />

      {/* Row 1: Deals Spotlight Shelf */}
      {dealsProducts.length > 0 && (
        <StorefrontShelfSection
          sectionId="storefront-deals-shelf"
          badge={isEn ? "Today's Deals & Discounts" : 'تخفيضات وعروض اليوم'}
          viewAllLabel={isEn ? `View All Deals (${dealsProducts.length})` : `عرض كل التخفيضات (${dealsProducts.length})`}
          products={dealsProducts.slice(0, 12)}
          cartMap={cartMap}
          whatsappPhone={info.whatsappPhone}
          favoriteIds={favoriteIds}
          isSmartDeal
          onAddToCart={onAddToCart}
          onUpdateQuantity={onUpdateQuantity}
          onOpenReviewModal={onOpenReviewModal}
          onToggleFavorite={onToggleFavorite}
          onQuickView={onQuickView}
          onViewAll={onSelectDeals}
        />
      )}

      {/* Row 2: Vibrant "Shop By Category" 8-Tiles Grid (تسوق حسب القسم) */}
      <StorefrontShopByCategoryGrid
        categories={categories}
        products={allProducts}
        categoryCounts={categoryCounts}
        onSelectCategory={onSelectCategory}
        onOpenCategoriesModal={onOpenCategoriesModal}
        onSelectDeals={onSelectDeals}
      />

      {/* Mid Banner Slot: After Deals */}
      {afterDealsBanners.map((banner) => (
        <StorefrontMidBannerCard
          key={banner.id}
          banner={banner}
          categories={categories}
          onSelectCategory={onSelectCategory}
          onSelectDeals={onSelectDeals}
        />
      ))}

      {/* Wide Horizontal Category Shelves */}
      {topHomepageSections.map((section, idx) => {
        const slotKey = idx === 0 ? 'after_row_1' : idx === 1 ? 'after_row_2' : `after_row_${idx + 1}`;
        const slotFallbackIdx = idx === 0 ? 1 : idx === 1 ? 2 : undefined;
        const bannersAfterThis = getBannersForSlot(slotKey, slotFallbackIdx);

        return (
          <React.Fragment key={section.categoryId}>
            <StorefrontShelfSection
              sectionId={`storefront-category-shelf-${section.categoryId}`}
              badge={section.categoryName}
              viewAllLabel={isEn ? `View All (${section.totalCount})` : `عرض كل أصناف القسم (${section.totalCount})`}
              products={section.products.slice(0, 12)}
              cartMap={cartMap}
              whatsappPhone={info.whatsappPhone}
              favoriteIds={favoriteIds}
              onAddToCart={onAddToCart}
              onUpdateQuantity={onUpdateQuantity}
              onOpenReviewModal={onOpenReviewModal}
              onToggleFavorite={onToggleFavorite}
              onQuickView={onQuickView}
              onViewAll={() => {
                onSelectCategory(section.categoryId);
                window.scrollTo({ top: 180, behavior: 'smooth' });
              }}
            />

            {bannersAfterThis.map((banner) => (
              <StorefrontMidBannerCard
                key={banner.id}
                banner={banner}
                categories={categories}
                onSelectCategory={onSelectCategory}
                onSelectDeals={onSelectDeals}
              />
            ))}

            {/* Flash Sale Countdown Banner: breaks repetitive shelf stacking */}
            {(idx === 1 || (topHomepageSections.length === 1 && idx === 0)) && (
              <StorefrontFlashSaleCountdown
                products={dealsProducts.length > 0 ? dealsProducts : allProducts}
                cartMap={cartMap}
                whatsappPhone={info.whatsappPhone}
                favoriteIds={favoriteIds}
                onAddToCart={onAddToCart}
                onUpdateQuantity={onUpdateQuantity}
                onQuickView={onQuickView}
                onToggleFavorite={onToggleFavorite}
                onSelectDeals={onSelectDeals}
              />
            )}
          </React.Fragment>
        );
      })}

      {topHomepageSections.length === 0 && (
        <StorefrontFlashSaleCountdown
          products={dealsProducts.length > 0 ? dealsProducts : allProducts}
          cartMap={cartMap}
          whatsappPhone={info.whatsappPhone}
          favoriteIds={favoriteIds}
          onAddToCart={onAddToCart}
          onUpdateQuantity={onUpdateQuantity}
          onQuickView={onQuickView}
          onToggleFavorite={onToggleFavorite}
          onSelectDeals={onSelectDeals}
        />
      )}


      {/* Mid Banner Slot: Bottom */}
      {bottomBanners.map((banner) => (
        <StorefrontMidBannerCard
          key={banner.id}
          banner={banner}
          categories={categories}
          onSelectCategory={onSelectCategory}
          onSelectDeals={onSelectDeals}
        />
      ))}
    </div>
  );
}
