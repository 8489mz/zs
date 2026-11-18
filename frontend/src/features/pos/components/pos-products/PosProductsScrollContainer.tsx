// Product grid — the scrollable product list with scanner-ready, empty and
// grid states. Pure move; the panel keeps all state and mounts this
// component with the visible groups and its callbacks.

import type { ComponentType, Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import type { PosProductGroup } from '@/features/pos/lib/pos-product-groups';
import { isInvoiceBarcodeQuery } from '@/features/pos/lib/pos-barcode-normalizer';
import type { useProductIconSettings } from '@/shared/components/icons/product-icon-theme';
import type { PosUiCustomization } from '@/features/pos/hooks/usePosUiCustomization';
import type { PosCardDensity, PosProductGroupCardProps } from '@/features/pos/components/PosProductsPanel';

function groupMetaLabel(group: PosProductGroup) {
  if (!group.hasVariants) {
    const directProduct = group.products[0];
    return directProduct?.barcode ? `باركود: ${directProduct.barcode}` : 'إضافة مباشرة';
  }
  const parts: string[] = [];
  if (group.colors.length) {
    const sample = group.colors.slice(0, 3).join('، ');
    const more = group.colors.length > 3 ? '...' : '';
    parts.push(`${group.colors.length} ألوان: ${sample}${more}`);
  }
  if (group.sizes.length) {
    const sample = group.sizes.slice(0, 3).join('، ');
    const more = group.sizes.length > 3 ? '...' : '';
    parts.push(`${group.sizes.length} مقاسات: ${sample}${more}`);
  }
  if (!parts.length) {
    parts.push(`${group.products.length} خيارات`);
  }
  return parts.join(' • ');
}

export function PosProductsScrollContainer({
  lastProductsScrollTopRef,
  isMobile,
  canShowScannerResults,
  visibleRecentGroups,
  visibleFavoriteGroups,
  displayedGroups,
  visibleGroups,
  activateGroup,
  search,
  onSearchSubmitFirstResult,
  onOpenNewProduct,
  cardDensity,
  customization,
  isKeyboardNavigatingRef,
  selectedIndex,
  favoriteKeySet,
  isOutOfStockGroup,
  iconSettings,
  groupRefs,
  activateGroupByKey,
  toggleFavorite,
  hasMoreTouchGroups,
  sentinelRef,
  setTouchVisibleCount,
  touchStep,
  CardComponent,
}: {
  lastProductsScrollTopRef: RefObject<number>;
  isMobile: boolean;
  canShowScannerResults: boolean;
  visibleRecentGroups: PosProductGroup[];
  visibleFavoriteGroups: PosProductGroup[];
  displayedGroups: PosProductGroup[];
  visibleGroups: PosProductGroup[];
  activateGroup: (group: PosProductGroup | null) => boolean;
  search: string;
  onSearchSubmitFirstResult: (rawQuery?: string) => boolean;
  onOpenNewProduct?: (params: { name?: string; barcode?: string }) => void;
  cardDensity: PosCardDensity;
  customization: PosUiCustomization;
  isKeyboardNavigatingRef: RefObject<boolean>;
  selectedIndex: number;
  favoriteKeySet: Set<string>;
  isOutOfStockGroup: (group: PosProductGroup) => boolean;
  iconSettings: ReturnType<typeof useProductIconSettings>;
  groupRefs: RefObject<Array<HTMLElement | null>>;
  activateGroupByKey: (groupKey: string) => boolean;
  toggleFavorite: (groupKey: string) => void;
  hasMoreTouchGroups: boolean;
  sentinelRef: RefObject<HTMLDivElement | null>;
  setTouchVisibleCount: Dispatch<SetStateAction<number>>;
  touchStep: number;
  CardComponent: ComponentType<PosProductGroupCardProps>;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="pos-products-scroll"
      onScroll={(e) => {
        if (typeof document === 'undefined') return;
        const currentTop = e.currentTarget.scrollTop;
        const diff = currentTop - lastProductsScrollTopRef.current;

        if (currentTop <= 25) {
          document.body.classList.remove('pos-scroll-hides-nav');
          document.body.classList.remove('mobile-nav-hidden');
        } else if (diff > 10) {
          // Scrolling down: hide bottom nav & dock floating cart
          document.body.classList.add('pos-scroll-hides-nav');
          document.body.classList.add('mobile-nav-hidden');
        } else if (diff < -6) {
          // Scrolling up slightly: reveal bottom nav immediately
          document.body.classList.remove('pos-scroll-hides-nav');
          document.body.classList.remove('mobile-nav-hidden');
        }

        lastProductsScrollTopRef.current = currentTop;
      }}
      style={{
        flex: '1 1 0%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'none',
        paddingBottom: isMobile ? 'calc(140px + env(safe-area-inset-bottom, 0px))' : '24px',
        msOverflowStyle: 'none',
      }}
    >
    {!canShowScannerResults ? (
      <div className="pos-scanner-ready-panel">
        <div className="pos-scanner-ready-copy">
          <strong>{t('pos.pos_products_panel.s17', "اضرب الباركود أو اكتب أول حرفين للبحث")}</strong>
          <span>{t('pos.pos_products_panel.s18', "تبقى الفاتورة والسلة أمامك، والنتائج ستظهر هنا فقط بعد البحث.")}</span>
        </div>

        {visibleRecentGroups.length ? (
          <div className="pos-scanner-ready-section">
            <span className="muted small">{t('pos.pos_products_panel.s19', "آخر ما تمت إضافته")}</span>
            <div className="pos-scanner-ready-buttons">
              {visibleRecentGroups.map((group) => (
                <Button key={group.key} type="button" variant="secondary" onClick={() => activateGroup(group)}>{group.title}</Button>
              ))}
            </div>
          </div>
        ) : null}

        {visibleFavoriteGroups.length ? (
          <div className="pos-scanner-ready-section">
            <span className="muted small">{t('pos.pos_products_panel.s20', "المفضلة")}</span>
            <div className="pos-scanner-ready-buttons">
              {visibleFavoriteGroups.map((group) => (
                <Button key={group.key} type="button" variant="secondary" onClick={() => activateGroup(group)}>{group.title}</Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    ) : null}

    {canShowScannerResults && !displayedGroups.length ? (
      <div
        className="surface-note pos-compact-empty"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '24px 16px',
          textAlign: 'center',
          background: '#f8fafc',
          border: '1px dashed #cbd5e1',
          borderRadius: '10px',
          margin: '12px 0',
        }}
      >
        <div style={{ fontSize: '0.92rem', color: '#64748b' }}>
          {t('pos.pos_products_panel.s21', "لم يتم العثور على أي صنف مطابق لـ")} <strong style={{ color: '#0f172a' }}>"{search}"</strong>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {isInvoiceBarcodeQuery(search.trim()) ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onSearchSubmitFirstResult(search.trim())}
              style={{
                fontWeight: 700,
                padding: '8px 18px',
                background: '#f0f9ff',
                borderColor: '#0284c7',
                color: '#0369a1',
              }}
            >
              {t('pos.pos_products_panel.s22', "استعراض / إعادة طباعة الفاتورة \"")}{search}"
            </Button>
          ) : null}

          {onOpenNewProduct ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                const query = search.trim();
                const isBarcode = /^\d{4,}$/.test(query);
                onOpenNewProduct(isBarcode ? { barcode: query } : { name: query });
              }}
              style={{
                fontWeight: 700,
                padding: '8px 18px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
            >
              {t('pos.pos_products_panel.s23', "+ إضافة صنف جديد باسم / باركود \"")}{search}"
            </Button>
          ) : null}
        </div>
      </div>
    ) : null}

    {canShowScannerResults ? (
      <>
        <div
          className={`product-pick-grid pos-product-group-grid ${cardDensity === 'compact' ? 'pos-product-group-grid-density-compact' : ''} ${cardDensity === 'gallery' ? 'pos-product-group-grid-gallery' : ''} ${isMobile && customization.mobileGridColumns === '3' ? 'is-cols-3' : ''}`}
          data-mobile-cols={isMobile ? customization.mobileGridColumns : undefined}
          style={cardDensity === 'gallery' ? {
            display: 'grid',
            gridTemplateColumns: isMobile
              ? (customization.mobileGridColumns === '3' ? 'repeat(3, minmax(0, 1fr))' : customization.mobileGridColumns === '2' ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(130px, 1fr))')
              : 'repeat(auto-fill, minmax(155px, 185px))',
            gap: isMobile ? (customization.mobileGridColumns === '3' ? '6px' : '8px') : '12px',
            alignItems: 'stretch',
            paddingBottom: isMobile ? 'calc(140px + env(safe-area-inset-bottom, 0px))' : '24px',
          } : cardDensity === 'compact' ? {
            display: 'grid',
            gridTemplateColumns: isMobile
              ? (customization.mobileGridColumns === '3' ? 'repeat(3, minmax(0, 1fr))' : customization.mobileGridColumns === '2' ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(130px, 1fr))')
              : 'repeat(auto-fill, minmax(155px, 185px))',
            gridAutoRows: isMobile ? (customization.mobileGridColumns === '3' ? '106px' : '112px') : '114px',
            gap: isMobile ? (customization.mobileGridColumns === '3' ? '6px' : '8px') : '12px',
            alignItems: 'stretch',
            paddingBottom: isMobile ? 'calc(140px + env(safe-area-inset-bottom, 0px))' : '24px',
          } : (isMobile && customization.mobileGridColumns === '3' ? {
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '6px',
          } : undefined)}
        >
          {displayedGroups.map((group, index) => (
            <CardComponent
              key={group.key}
              groupKey={group.key}
              index={index}
              title={group.title}
              hasVariants={group.hasVariants}
              variantCount={group.products.length}
              minPrice={group.minPrice}
              maxPrice={group.maxPrice}
              totalStock={group.totalStock}
              itemKind={group.itemKind}
              imageUrl={group.imageUrl}
              iconName={group.products[0]?.icon}
              metaLabel={groupMetaLabel(group)}
              isSelected={isKeyboardNavigatingRef.current && index === selectedIndex}
              isFavorite={favoriteKeySet.has(group.key)}
              isOutOfStock={isOutOfStockGroup(group)}
              cardDensity={cardDensity}
              isMobile={isMobile}
              mobileGridColumns={customization.mobileGridColumns}
              showCardIcon={iconSettings.showIcons}
              cardRefs={groupRefs}
              onActivate={activateGroupByKey}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>

        {hasMoreTouchGroups ? (
          <div className="pos-touch-show-more-row" ref={sentinelRef}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTouchVisibleCount((current) => current + touchStep)}
            >
              {t('pos.pos_products_panel.s34', "عرض المزيد")}
            </Button>
            <span className="muted small">{t('pos.pos_products_panel.s35', "المعروض")} {displayedGroups.length} {t('pos.pos_products_panel.s36', "من")} {visibleGroups.length}</span>
          </div>
        ) : null}
      </>
    ) : null}
    </div>
  );
}
