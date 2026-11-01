import { useStorefrontLang } from '@/i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { StorefrontProduct } from '../types/storefront.types';
import { StorefrontProductCard } from './StorefrontProductCard';
import { StorefrontDealSpotlight } from './StorefrontDealSpotlight';
import { IconArrowUpRight } from './StorefrontIcons';

type Props = {
  sectionId?: string;
  badge: string;
  subtitle?: string;
  viewAllLabel: string;
  products: StorefrontProduct[];
  cartMap: Map<number, number>;
  whatsappPhone?: string;
  favoriteIds?: Set<number>;
  isSmartDeal?: boolean;
  onAddToCart: (product: StorefrontProduct) => void;
  onUpdateQuantity: (productId: number, newQty: number) => void;
  onViewAll: () => void;
  onOpenReviewModal?: (product: StorefrontProduct) => void;
  onToggleFavorite?: (productId: number) => void;
  onQuickView?: (product: StorefrontProduct) => void;
};

export const StorefrontShelfSection = React.memo(function StorefrontShelfSection({
  sectionId,
  badge,
  subtitle,
  viewAllLabel = 'عرض كل أصناف القسم',
  products,
  cartMap,
  whatsappPhone,
  favoriteIds,
  isSmartDeal,
  onAddToCart,
  onUpdateQuantity,
  onViewAll,
  onOpenReviewModal,
  onToggleFavorite,
  onQuickView,
}: Props) {
  const { isEn, dir } = useStorefrontLang();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canScroll, setCanScroll] = useState(false);

  const syncScrollability = useCallback(() => {
    if (products.length < 4) {
      setCanScroll(false);
      return;
    }
    const el = trackRef.current;
    if (!el) return;
    const scrollable = el.scrollWidth - el.clientWidth > 8;
    setCanScroll((prev) => (prev !== scrollable ? scrollable : prev));
  }, [products.length]);

  useEffect(() => {
    syncScrollability();
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncScrollability);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncScrollability, products.length]);

  const scrollBy = (direction: 'prev' | 'next') => {
    const el = trackRef.current;
    if (!el) return;
    const firstItem = el.querySelector<HTMLElement>('.storefront-shelf-item');
    const step = firstItem ? firstItem.offsetWidth + 16 : 226;
    const delta = isEn
      ? direction === 'next'
        ? step
        : -step
      : direction === 'next'
        ? -step
        : step;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const arrowStyle: React.CSSProperties = {
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    border: '1px solid #dadce0',
    background: '#ffffff',
    color: '#1f1f1f',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
    flexShrink: 0,
  };

  if (!products || products.length === 0) {
    return null;
  }

  return (
    <div
      id={sectionId}
      dir={dir}
      className="storefront-section-card"
      style={{
        background: '#ffffff',
        borderRadius: '20px',
        border: '1px solid #edf1f7',
        padding: '24px 22px 20px',
        boxShadow: '0 10px 30px -6px rgba(15, 23, 42, 0.04), 0 2px 8px -2px rgba(15, 23, 42, 0.02)',
        scrollMarginTop: '96px',
        direction: dir,
      }}
    >
      {/* Shelf Header */}
      <div
        className="storefront-cat-shelf-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          borderBottom: '1px solid #f1f5f9',
          paddingBottom: '12px',
          gap: '12px',
          flexWrap: 'nowrap',
        }}
      >
        {/* Title & Subtitle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: '1 1 auto' }}>
          <h2
            className="storefront-shelf-title"
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 700,
              color: '#0f172a',
              display: 'inline-flex',
              alignItems: 'center',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              lineHeight: 1.25,
              letterSpacing: '-0.15px',
            }}
          >
            {badge}
          </h2>
          {subtitle && (
            <span
              className="storefront-shelf-subtitle"
              style={{
                fontSize: '11.5px',
                color: '#64748b',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </span>
          )}
        </div>

        {/* Navigation & View All Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {products.length >= 4 && canScroll && (
            <div className="storefront-shelf-arrows" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={() => scrollBy('prev')}
                title={isEn ? 'Previous' : 'السابق'}
                aria-label={isEn ? 'Previous' : 'السابق'}
                style={arrowStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    d={isEn ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'}
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => scrollBy('next')}
                title={isEn ? 'Next' : 'التالي'}
                aria-label={isEn ? 'Next' : 'التالي'}
                style={arrowStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    d={isEn ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'}
                  />
                </svg>
              </button>
            </div>
          )}

          <button
            type="button"
            className="storefront-view-all-btn"
            onClick={onViewAll}
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
            }}
          >
            <span className="storefront-shelf-viewall-label">
              {viewAllLabel === 'عرض كل أصناف القسم' && isEn ? 'View All' : viewAllLabel}
            </span>
            <IconArrowUpRight size={13} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {products.length === 1 ? (
        <StorefrontDealSpotlight
          product={products[0]}
          cartQuantity={cartMap.get(products[0].id) || 0}
          whatsappPhone={whatsappPhone}
          isSmartDeal={isSmartDeal}
          categoryBadge={badge}
          onAddToCart={onAddToCart}
          onUpdateQuantity={onUpdateQuantity}
          onQuickView={onQuickView}
          isFavorite={favoriteIds?.has(products[0].id)}
          onToggleFavorite={onToggleFavorite}
        />
      ) : products.length === 2 ? (
        <div className="storefront-shelf-dual-grid">
          {products.map((product) => (
            <StorefrontProductCard
              key={product.id}
              product={product}
              cartQuantity={cartMap.get(product.id) || 0}
              whatsappPhone={whatsappPhone}
              isSmartDeal={isSmartDeal}
              variant="wide"
              onAddToCart={onAddToCart}
              onUpdateQuantity={onUpdateQuantity}
              onOpenReviewModal={onOpenReviewModal}
              isFavorite={favoriteIds?.has(product.id)}
              onToggleFavorite={onToggleFavorite}
              onQuickView={onQuickView}
            />
          ))}
        </div>
      ) : products.length === 3 ? (
        <div className="storefront-shelf-tri-grid">
          {products.map((product) => (
            <StorefrontProductCard
              key={product.id}
              product={product}
              cartQuantity={cartMap.get(product.id) || 0}
              whatsappPhone={whatsappPhone}
              isSmartDeal={isSmartDeal}
              variant="standard"
              onAddToCart={onAddToCart}
              onUpdateQuantity={onUpdateQuantity}
              onOpenReviewModal={onOpenReviewModal}
              isFavorite={favoriteIds?.has(product.id)}
              onToggleFavorite={onToggleFavorite}
              onQuickView={onQuickView}
            />
          ))}
        </div>
      ) : (
        <div className="storefront-shelf-wrapper">
          {canScroll && (
            <button
              type="button"
              className="storefront-shelf-floating-arrow storefront-shelf-arrow-prev"
              onClick={() => scrollBy('prev')}
              aria-label={isEn ? 'Previous' : 'السابق'}
              title={isEn ? 'Previous' : 'السابق'}
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.8" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          <div className="storefront-shelf" ref={trackRef}>
            {products.map((product) => (
              <div className="storefront-shelf-item" key={product.id}>
                <StorefrontProductCard
                  product={product}
                  cartQuantity={cartMap.get(product.id) || 0}
                  whatsappPhone={whatsappPhone}
                  isSmartDeal={isSmartDeal}
                  variant="standard"
                  onAddToCart={onAddToCart}
                  onUpdateQuantity={onUpdateQuantity}
                  onOpenReviewModal={onOpenReviewModal}
                  isFavorite={favoriteIds?.has(product.id)}
                  onToggleFavorite={onToggleFavorite}
                  onQuickView={onQuickView}
                />
              </div>
            ))}
          </div>

          {canScroll && (
            <button
              type="button"
              className="storefront-shelf-floating-arrow storefront-shelf-arrow-next"
              onClick={() => scrollBy('next')}
              aria-label={isEn ? 'التالي' : 'التالي'}
              title={isEn ? 'Next' : 'التالي'}
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.8" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
