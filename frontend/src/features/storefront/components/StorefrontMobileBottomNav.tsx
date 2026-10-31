import React, { useEffect, useState } from 'react';
import { IconShoppingCart } from './StorefrontIcons';

interface StorefrontMobileBottomNavProps {
  activeTab: 'home' | 'categories' | 'deals' | 'favorites' | 'cart';
  cartCount: number;
  favoritesCount: number;
  dealsCount: number;
  onGoHome: () => void;
  onOpenCategories: () => void;
  onToggleDeals: () => void;
  onToggleFavorites: () => void;
  onOpenCart: () => void;
}

export const StorefrontMobileBottomNav = React.memo(function StorefrontMobileBottomNav({
  activeTab,
  cartCount,
  favoritesCount,
  dealsCount,
  onGoHome,
  onOpenCategories,
  onToggleDeals,
  onToggleFavorites,
  onOpenCart,
}: StorefrontMobileBottomNavProps) {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    let lastScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    let rafId = 0;

    const handleScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        const currentScrollY = Math.max(0, window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0);
        const delta = currentScrollY - lastScrollY;

        if (currentScrollY <= 40) {
          setIsHidden(false);
        } else if (delta > 8) {
          // Scrolling down -> hide bottom nav
          setIsHidden(true);
        } else if (delta < -6) {
          // Scrolling up (reverse scroll) -> show bottom nav
          setIsHidden(false);
        }

        lastScrollY = currentScrollY;
        rafId = 0;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('scroll', handleScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <nav
      className={`storefront-mobile-bottom-nav${isHidden ? ' is-hidden' : ''}`}
      aria-label="التنقل السريع للموبايل"
      dir="rtl"
    >
      {/* Curved Notched Dock Background with True Air-Gap Cutout */}
      <div className="storefront-mobile-nav-bg" aria-hidden="true" dir="ltr">
        <div className="storefront-mobile-nav-bg-wing left" />
        <div className="storefront-mobile-nav-bg-notch">
          <svg viewBox="0 0 82 50" preserveAspectRatio="none" className="storefront-mobile-nav-notch-svg">
            <path
              d="M 0,0 L 2,0 C 12,0 16,32 41,32 C 66,32 70,0 80,0 L 82,0 L 82,50 L 0,50 Z"
              fill="#ffffff"
            />
            <path
              d="M 0,0.5 L 2,0.5 C 12,0.5 16,32 41,32 C 66,32 70,0.5 80,0.5 L 82,0.5"
              fill="none"
              stroke="rgba(226, 232, 240, 0.85)"
              strokeWidth="1"
            />
          </svg>
        </div>
        <div className="storefront-mobile-nav-bg-wing right" />
      </div>

      {/* 1. Home (Rightmost in RTL) */}
      <button
        type="button"
        onClick={onGoHome}
        className={`storefront-mobile-nav-item ${activeTab === 'home' ? 'active' : ''}`}
      >
        <div className="storefront-mobile-nav-icon-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={activeTab === 'home' ? '2.2' : '1.85'} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9.5L12 3l9 6.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20V9.5z" />
            <path d="M9 21.5V13h6v8.5" />
          </svg>
        </div>
        <span>الرئيسية</span>
      </button>

      {/* 2. Categories */}
      <button
        type="button"
        onClick={onOpenCategories}
        className={`storefront-mobile-nav-item ${activeTab === 'categories' ? 'active' : ''}`}
      >
        <div className="storefront-mobile-nav-icon-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={activeTab === 'categories' ? '2.2' : '1.85'} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
            <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
            <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
            <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
          </svg>
        </div>
        <span>الأقسام</span>
      </button>

      {/* 3. Center Floating Action Button: Cart (السلة) */}
      <div className="storefront-mobile-nav-center-slot">
        <button
          type="button"
          onClick={onOpenCart}
          aria-label="سلة التسوق"
          className={`storefront-mobile-nav-center-btn ${activeTab === 'cart' ? 'active' : ''}`}
        >
          <IconShoppingCart size={19} strokeWidth={2.1} />
          {cartCount > 0 && (
            <span className="storefront-mobile-nav-center-badge">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {/* 4. Deals */}
      <button
        type="button"
        onClick={onToggleDeals}
        className={`storefront-mobile-nav-item ${activeTab === 'deals' ? 'active' : ''}`}
      >
        <div className="storefront-mobile-nav-icon-wrap" style={{ position: 'relative' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={activeTab === 'deals' ? '2.2' : '1.85'} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
          {dealsCount > 0 && (
            <span className="storefront-mobile-nav-badge deals">
              {dealsCount}
            </span>
          )}
        </div>
        <span>العروض</span>
      </button>

      {/* 5. Favorites (Leftmost in RTL) */}
      <button
        type="button"
        onClick={onToggleFavorites}
        className={`storefront-mobile-nav-item ${activeTab === 'favorites' ? 'active' : ''}`}
      >
        <div className="storefront-mobile-nav-icon-wrap" style={{ position: 'relative' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={activeTab === 'favorites' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={activeTab === 'favorites' ? '2.2' : '1.85'} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          {favoritesCount > 0 && (
            <span className="storefront-mobile-nav-badge fav">
              {favoritesCount}
            </span>
          )}
        </div>
        <span>المفضلة</span>
      </button>
    </nav>
  );
});
