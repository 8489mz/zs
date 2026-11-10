import { useTranslation } from 'react-i18next';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '@/features/products/api/products.api';
import type { Product, ProductOffer } from '@/types/domain';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { useAuthStore } from '@/stores/auth-store';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import { subscribeSignageOffersUpdate } from '@/features/pos/lib/pos-customer-display-bridge';
import { SignagePromoItem, SignageTheme } from '../components/signage/types';
import { useIsolatedDisplayLanguage } from '@/features/pos/hooks/useIsolatedDisplayLanguage';
import { SignageHeader } from '../components/signage/SignageHeader';
import { SignageHeroCard } from '../components/signage/SignageHeroCard';
import { SignageSideDeck } from '../components/signage/SignageSideDeck';
import { SignageMarqueeFooter } from '../components/signage/SignageMarqueeFooter';
import { SignageSettingsDrawer } from '../components/signage/SignageSettingsDrawer';
import { SignageNavDrawer } from '../components/signage/SignageNavDrawer';
import { SignageShowroomWelcome } from '../components/signage/SignageShowroomWelcome';
import { AlertTriangleIcon } from '@/shared/components/icons/AppIcons';

/* INV-REST-SIGNAGE-TRUTH (R-B5 + signage slice of R-B6): the signage
 * screen must show only real prices. Before this fix the promo builder
 * invented a price whenever the catalog had no real offer:
 * promotionalPrice || offerPrice || (retail * 0.85) || flat 100, a
 * fabricated "was" price (promo * 1.25 when retail was 0), a discount
 * that defaulted to 15%, and a badge cycled by slide index
 * ('عرض خاص' / 'أفضل مبيعاً' / 'صفقة اليوم' / 'تخفيض محدود' /
 * 'سعر حصري'). It also treated an expired p.offers[0] as the current
 * offer, and the offers query silently fell back to the full-price
 * catalog when the offers view was empty. buildSignagePromoItems is
 * the single pure decision: a promo price exists only when a
 * merchant-configured price (promotionalPrice or a currently-active
 * offer) is really below retail; otherwise the item shows its real
 * retail price with discount 0 and no saving. In the offers view only
 * items with a real current promo are listed at all. The badge is the
 * product's own configured badge when present, the single true label
 * 'عرض خاص' for an item with a verified current offer, and empty
 * otherwise — never a superlative assigned by index. Dates compare
 * against the local calendar date (never UTC toISOString), so an
 * offer does not flip at midnight UTC. */

function localTodayStr(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isOfferActiveNow(offer: ProductOffer, todayStr: string): boolean {
  return (!offer.from || offer.from <= todayStr) && (!offer.to || offer.to >= todayStr);
}

function calcOfferPrice(retail: number, offer: ProductOffer): number | null {
  const value = Number(offer.value) || 0;
  if (value <= 0) return null;
  if (offer.type === 'percent') return Math.max(0, retail * (1 - value / 100));
  if (offer.type === 'fixed') return Math.max(0, retail - value);
  if (offer.type === 'price') return Math.max(0, value);
  if (offer.type === 'bundle') {
    const bundleQty = Math.max(1, Number(offer.minQty || 1));
    return Math.max(0, value / bundleQty);
  }
  if (offer.type === 'bogo') {
    const buyQ = Math.max(1, Number(offer.bogoBuyQty || 1));
    const getQ = Math.max(1, Number(offer.bogoGetQty || 1));
    const discPct = Math.min(100, Math.max(0, Number(offer.bogoDiscountPercent ?? 100)));
    const cycleTotalQty = buyQ + getQ;
    const origTotal = retail * cycleTotalQty;
    const savings = getQ * retail * (discPct / 100);
    return cycleTotalQty > 0 ? Math.max(0, (origTotal - savings) / cycleTotalQty) : retail;
  }
  return null;
}

export function buildSignagePromoItems(
  products: Product[],
  view: 'offers' | 'all',
  todayStr: string = localTodayStr(),
): SignagePromoItem[] {
  const items: SignagePromoItem[] = [];
  for (const p of products) {
    const retail = Number(p.retailPrice) || 0;
    const rawPromo = (p as unknown as { promotionalPrice?: unknown }).promotionalPrice;
    const promotionalPrice = rawPromo != null && rawPromo !== '' ? Number(rawPromo) : null;
    const activeOffers = (p.offers || []).filter((o) => isOfferActiveNow(o, todayStr));
    const firstOffer = activeOffers.length > 0 ? activeOffers[0] : null;
    const offerPrice = firstOffer ? calcOfferPrice(retail, firstOffer) : null;

    let promoPrice: number | null = null;
    if (
      promotionalPrice != null &&
      Number.isFinite(promotionalPrice) &&
      promotionalPrice >= 0 &&
      promotionalPrice < retail
    ) {
      promoPrice = promotionalPrice;
    } else if (offerPrice != null && offerPrice >= 0 && offerPrice < retail) {
      promoPrice = offerPrice;
    }
    const hasRealPromo = promoPrice != null;

    // The offers view lists current offers only: a product whose offers
    // are all expired (or not yet started) is not an offer.
    if (view === 'offers' && !hasRealPromo) continue;

    const displayPrice = promoPrice != null ? promoPrice : retail;
    const savingAmount = Math.max(0, retail - displayPrice);
    const discountPercent =
      retail > 0 && savingAmount > 0 ? Math.round((savingAmount / retail) * 100) : 0;
    const rawBadge = (p as unknown as { badge?: unknown }).badge;
    const configuredBadge = typeof rawBadge === 'string' ? rawBadge.trim() : '';
    const badge = configuredBadge || (hasRealPromo ? 'عرض خاص' : '');

    items.push({
      id: p.id,
      name: p.name,
      categoryName:
        (p as unknown as { category?: { name?: string | null } }).category?.name ||
        p.categoryName ||
        'القسم الرئيسي',
      originalPrice: retail,
      promoPrice: displayPrice,
      discountPercent,
      savingAmount,
      badge,
      barcode: p.barcode || p.sku || '',
      imageUrl: p.imageUrl || '',
    });
  }
  return items;
}

export function DigitalSignagePage() {
  const { currentLang, toggleLanguage } = useIsolatedDisplayLanguage('signage_ui_lang');
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settingsQuery = useSettingsQuery();
  const settings = settingsQuery.data;
  /* INV-REST-SIGNAGE-VERTICAL-TRUTH (T11-E, F7): the tenant vertical
   * comes from the same source the rest of the app uses — tenant
   * activityType / settings via resolveCurrentVertical (the AuditPage
   * pattern: auth-store tenant + settings). No new data source. */
  const tenant = useAuthStore((state) => state.tenant);
  const vertical = resolveCurrentVertical(tenant, settings);
  const isRestaurant = vertical === 'restaurant';

  const navigate = useNavigate();
  const [theme, setTheme] = useState<SignageTheme>(() => {
    return (localStorage.getItem('signage_theme') as SignageTheme) || 'dark';
  });

  const handleToggleTheme = () => {
    setTheme((prev) => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('signage_theme', nextTheme);
      return nextTheme;
    });
  };

  const handleThemeChange = (newTheme: SignageTheme) => {
    setTheme(newTheme);
    localStorage.setItem('signage_theme', newTheme);
  };

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [slideIntervalSec, setSlideIntervalSec] = useState<number>(8);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState<boolean>(false);
  const [showNavDrawer, setShowNavDrawer] = useState<boolean>(false);
  /* INV-REST-SIGNAGE-VERTICAL-TRUTH (T11-E, F7): the ticker default
   * was hardcoded showroom copy ('أهلاً بكم في صالة العرض • عروض
   * وتخفيضات كبرى …') for every tenant. The default is now neutral
   * for retail and restaurant-aware for a restaurant tenant; it
   * applies only while the merchant has not typed a custom ticker
   * (customTickerText stays empty until they do, and the drawer
   * shows the effective default as its placeholder). A custom ticker
   * always wins over either default. */
  const [customTickerText, setCustomTickerText] = useState<string>('');
  const effectiveTickerText = customTickerText.trim()
    ? customTickerText
    : t(
        isRestaurant
          ? 'pos.signage.ticker_default_restaurant'
          : 'pos.signage.ticker_default',
        isRestaurant
          ? 'أهلاً بكم في مطعمنا • تصفح قائمة اليوم واطلب من هاتفك عبر رمز الـ QR • طازج يومياً'
          : 'أهلاً بكم • امسح رمز الـ QR للتصفح والطلب من هاتفك • عروض جديدة كل يوم',
      );
  const [viewFilter, setViewFilter] = useState<'offers' | 'all'>('offers');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');

  const handleGoBack = () => {
    navigate('/displays');
  };

  // Keyboard navigation & Esc listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' ||
        (e.altKey && e.key === 'Backspace') ||
        (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
      ) {
        if (showNavDrawer) {
          setShowNavDrawer(false);
        } else if (showSettingsDrawer) {
          setShowSettingsDrawer(false);
        } else if (!document.fullscreenElement) {
          handleGoBack();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showNavDrawer, showSettingsDrawer]);

  // Clock ticker
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
      setCurrentDate(
        now.toLocaleDateString('ar-EG', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch products (background polling every 25s for standalone TV screens).
  // INV-REST-SIGNAGE-TRUTH: no silent fallback — when the offers view is
  // empty there are no current offers, and the screen says so instead of
  // showing full-price products as if they were offers.
  const productsQuery = useQuery({
    queryKey: ['signage-products', viewFilter],
    queryFn: async () => {
      const res = await productsApi.listPage({
        page: 1,
        pageSize: 40,
        view: viewFilter === 'offers' ? 'offers' : 'all',
      });
      return res.products || [];
    },
    refetchInterval: 25000,
  });

  // Real-time 0ms broadcast synchronization across tabs, windows, and monitors
  useEffect(() => {
    const unsubscribe = subscribeSignageOffersUpdate(() => {
      queryClient.invalidateQueries({ queryKey: ['signage-products'] });
    });
    return unsubscribe;
  }, [queryClient]);

  const rawProducts = productsQuery.data || [];

  // Promo items come only from real prices — see buildSignagePromoItems.
  const promoItems: SignagePromoItem[] = useMemo(
    () => buildSignagePromoItems(rawProducts, viewFilter),
    [rawProducts, viewFilter],
  );

  // Safeguard index if item list shrinks
  useEffect(() => {
    if (currentIndex >= promoItems.length && promoItems.length > 0) {
      setCurrentIndex(0);
    }
  }, [promoItems.length, currentIndex]);

  // Automatic Carousel Ticker
  useEffect(() => {
    if (!promoItems.length || isPaused) return;

    const tickIntervalMs = 100;
    const totalTicks = (slideIntervalSec * 1000) / tickIntervalMs;
    let tickCount = 0;

    const timer = setInterval(() => {
      tickCount += 1;
      const percent = Math.min(100, (tickCount / totalTicks) * 100);
      setProgressPercent(percent);

      if (tickCount >= totalTicks) {
        tickCount = 0;
        setCurrentIndex((prev) => (prev + 1) % promoItems.length);
        setProgressPercent(0);
      }
    }, tickIntervalMs);

    return () => clearInterval(timer);
  }, [isPaused, promoItems.length, slideIntervalSec, currentIndex]);

  const activeItem = promoItems[currentIndex] || null;

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const storeName = settings?.storeName || 'مؤسستنا التجارية';
  const currencyCode = settings?.currency || getGlobalSystemCurrency();
  const storefrontUrl = typeof window !== 'undefined' ? `${window.location.origin}/storefront` : '';

  const isDark = theme === 'dark';

  const qrSvgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
    storefrontUrl
  )}&bgcolor=ffffff&color=${isDark ? '0f172a' : '170e5e'}&margin=2`;

  return (
    <div
      dir="rtl"
      style={{
        width: '100vw',
        height: '100vh',
        backgroundColor: isDark ? '#080c16' : '#f8fafc',
        backgroundImage: isDark
          ? 'radial-gradient(ellipse at 80% 10%, rgba(37, 99, 235, 0.12) 0%, transparent 60%), radial-gradient(ellipse at 20% 90%, rgba(99, 102, 241, 0.08) 0%, transparent 60%)'
          : 'none',
        color: isDark ? '#f8fafc' : '#0f172a',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        transition: 'background-color 0.2s ease',
      }}
    >
      {/* Top Header Bar */}
      {/* INV-REST-SIGNAGE-OFFER-BOARD-TRUTH (T12-H2): the page
        * already resolved the vertical for the loading text and the
        * empty state, but the four offer-board components never
        * received it and rendered showroom copy unconditionally.
        * The same vertical is now passed to all four. */}
      <SignageHeader
        currentLang={currentLang}
        onToggleLanguage={toggleLanguage}
        storeName={storeName}
        currentTime={currentTime}
        currentDate={currentDate}
        progressPercent={progressPercent}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleSettings={() => setShowSettingsDrawer((prev) => !prev)}
        onBack={handleGoBack}
        onToggleNavMenu={() => setShowNavDrawer((prev) => !prev)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        vertical={vertical}
      />

      {/* INV-REST-SIGNAGE-REFETCH-INDICATOR (R8-D): a background refetch
        * that fails while last-known offers are on screen must say so
        * loudly. TanStack keeps the last good data, so the hero keeps
        * cycling stale offers and the full error screen below (which only
        * renders when there is no data at all) is never reached.
        * isRefetchError is exactly that state (isError with previous
        * data). The banner shows only while stale offers are actually on
        * screen (promoItems.length > 0) — when the last good data was an
        * empty list there is nothing stale to label and the full error
        * screen already speaks, so no second indicator is stacked on it.
        * It clears on the next successful refetch (isError goes false);
        * the retry button is the same productsQuery.refetch() as the full
        * error screen. Shape mirrors the KDS stale banner precedent
        * (KdsDisconnectedState variant="banner"): solid red strip, white
        * text, retry button — as a local banner in this page's own
        * styling, not the KDS component. */}
      {productsQuery.isRefetchError && promoItems.length > 0 && (
        <div
          role="alert"
          style={{
            margin: '12px 28px 0',
            backgroundColor: '#dc2626',
            color: '#ffffff',
            borderRadius: '12px',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            boxShadow: '0 3px 8px rgba(220, 38, 38, 0.25)',
            zIndex: 10,
          }}
        >
          <AlertTriangleIcon size={22} color="#ffffff" />
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '14px', fontWeight: 900 }}>
              {t('pos.digital_signage_page.stale_banner_title', 'تعذّر تحديث العروض')}
            </div>
            <div style={{ fontSize: '12px', color: '#fecaca', marginTop: '2px' }}>
              {t(
                'pos.digital_signage_page.stale_banner_desc',
                'تُعرض آخر أسعار معروفة وقد تكون قديمة — تحقق من شبكة الشاشة.'
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void productsQuery.refetch()}
            style={{
              background: '#ffffff',
              color: '#dc2626',
              border: 'none',
              borderRadius: '10px',
              padding: '10px 18px',
              fontWeight: 800,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {t('pos.digital_signage_page.retry', 'إعادة المحاولة')}
          </button>
        </div>
      )}

      {/* Main Promo Stage */}
      <main
        style={{
          flex: 1,
          padding: '20px 28px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)',
          gap: '24px',
          alignItems: 'stretch',
          overflow: 'hidden',
          zIndex: 10,
        }}
      >
        {activeItem ? (
          <SignageHeroCard
            activeItem={activeItem}
            currentIndex={currentIndex}
            totalItems={promoItems.length}
            currencyCode={currencyCode}
            theme={theme}
            vertical={vertical}
          />
        ) : productsQuery.isLoading ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              fontSize: '18px',
              fontWeight: 800,
              color: isDark ? '#38bdf8' : '#170e5e',
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.6)' : '#ffffff',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
              borderRadius: '24px',
              gap: '14px',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                border: `3px solid ${isDark ? 'rgba(56, 189, 248, 0.2)' : 'rgba(23, 14, 94, 0.15)'}`,
                borderTopColor: isDark ? '#38bdf8' : '#170e5e',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            <span>
              {t(
                isRestaurant
                  ? 'pos.digital_signage_page.loading_restaurant'
                  : 'pos.digital_signage_page.loading',
                isRestaurant ? 'جاري تجهيز قائمة اليوم...' : 'جاري تجهيز وبث عروض صالة العرض...'
              )}
            </span>
          </div>
        ) : productsQuery.isError ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              fontSize: '18px',
              fontWeight: 800,
              color: isDark ? '#f87171' : '#dc2626',
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.6)' : '#ffffff',
              border: isDark ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid #fecaca',
              borderRadius: '24px',
              gap: '14px',
              padding: '24px',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: '22px', fontWeight: 900 }}>
              {t('pos.digital_signage_page.load_error_title', 'تعذّر تحميل العروض')}
            </span>
            <span
              style={{
                fontSize: '15px',
                fontWeight: 600,
                color: isDark ? '#cbd5e1' : '#475569',
                maxWidth: '520px',
                lineHeight: 1.6,
              }}
            >
              {t(
                'pos.digital_signage_page.load_error_desc',
                'انقطع الاتصال بالخادم — تحقق من شبكة الشاشة ثم أعد المحاولة.'
              )}
            </span>
            <button
              type="button"
              onClick={() => void productsQuery.refetch()}
              style={{
                padding: '12px 26px',
                borderRadius: '12px',
                backgroundColor: isDark ? '#2563eb' : '#170e5e',
                color: '#ffffff',
                border: 'none',
                fontWeight: 800,
                fontSize: '15px',
                cursor: 'pointer',
              }}
            >
              {t('pos.digital_signage_page.retry', 'إعادة المحاولة')}
            </button>
          </div>
        ) : (
          <SignageShowroomWelcome
            storeName={storeName}
            qrSvgUrl={qrSvgUrl}
            theme={theme}
            vertical={vertical}
            hasFilterOffers={viewFilter === 'offers'}
            onSwitchToAllProducts={() => setViewFilter('all')}
          />
        )}

        <SignageSideDeck
          promoItems={promoItems}
          currentIndex={currentIndex}
          onSelectItem={(idx) => setCurrentIndex(idx)}
          currencyCode={currencyCode}
          qrSvgUrl={qrSvgUrl}
          theme={theme}
          vertical={vertical}
        />
      </main>

      {/* Bottom Live Marquee Ticker Bar */}
      <SignageMarqueeFooter
        customTickerText={effectiveTickerText}
        isPaused={isPaused}
        onTogglePause={() => setIsPaused((prev) => !prev)}
        currentIndex={currentIndex}
        totalItems={promoItems.length}
        theme={theme}
        vertical={vertical}
      />

      {/* Settings Modal Drawer */}
      {showSettingsDrawer && (
        <SignageSettingsDrawer
          onClose={() => setShowSettingsDrawer(false)}
          slideIntervalSec={slideIntervalSec}
          onSlideIntervalChange={setSlideIntervalSec}
          viewFilter={viewFilter}
          onViewFilterChange={setViewFilter}
          customTickerText={customTickerText}
          onCustomTickerTextChange={setCustomTickerText}
          tickerPlaceholder={effectiveTickerText}
          theme={theme}
          onThemeChange={handleThemeChange}
        />
      )}

      {/* Quick Navigation Drawer */}
      <SignageNavDrawer
        isOpen={showNavDrawer}
        onClose={() => setShowNavDrawer(false)}
        onBack={handleGoBack}
        storeName={storeName}
      />
    </div>
  );
}

export default DigitalSignagePage;
