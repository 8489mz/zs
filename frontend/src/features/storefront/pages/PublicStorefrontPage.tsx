import { useStorefrontLang } from '@/i18n';
import { useState, useEffect, useMemo, useCallback } from 'react';
import '@/styles/partials/storefront.css';
import { useParams, useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { StorefrontHeader } from '../components/StorefrontHeader';
import { StorefrontSubNav } from '../components/StorefrontSubNav';
import { StorefrontCategoryShowcase } from '../components/StorefrontCategoryShowcase';
import { StorefrontHeroEditorial } from '../components/StorefrontHeroEditorial';
import { StorefrontMultiRowHome } from '../components/StorefrontMultiRowHome';
import { StorefrontFilteredGrid } from '../components/StorefrontFilteredGrid';
import { StorefrontModals } from '../components/StorefrontModals';
import { StorefrontFooter } from '../components/StorefrontFooter';
import { StorefrontSkeleton } from '../components/StorefrontSkeleton';
import { StorefrontTrustBar } from '../components/StorefrontTrustBar';
import { StorefrontMobileBottomNav } from '../components/StorefrontMobileBottomNav';
import { initStorefrontPixels, trackStorefrontEvent } from '../lib/storefront-pixel-tracker';
import type { StorefrontProduct } from '../types/storefront.types';
import { usePublicStorefront, ITEMS_PER_PAGE } from '../hooks/usePublicStorefront';
import { localizeProduct } from '../lib/storefront-translations';
import { useStorefrontSeo } from '../hooks/useStorefrontSeo';
import { IconStore } from '../components/StorefrontIcons';
import { UtensilsIcon, BellIcon, CreditCardIcon, ReceiptIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { saveCustomerOrderRef } from '../lib/customer-order-refs';
import { getStoreHostSlug } from '@/lib/store-public-url';
import { applyStorefrontThemeVariables } from '../lib/storefront-theme-contrast';
import { TableBillModal } from '../components/TableBillModal';
import { StorefrontFloatingWhatsApp } from '../components/StorefrontFloatingWhatsApp';
import { setGlobalSystemCurrency } from '@/lib/currencies';

export function PublicStorefrontPage() {
  const { t, lang, dir } = useStorefrontLang();
  const { slug, tableNo, categoryId: paramCategoryId, productId, orderNumber: trackOrderNumber } = useParams<{ slug?: string; tableNo?: string; categoryId?: string; productId?: string; orderNumber?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const tableParam = (tableNo || searchParams.get('table') || '').trim();
  const queryCat = searchParams.get('category') || searchParams.get('cat');
  const activeCategoryParam = paramCategoryId || queryCat;
  // SF-10: on `<slug>.<root>` there is no slug in the path; the host is the store.
  const hostSlug = useMemo(() => (slug ? null : (import.meta.env.VITE_STOREFRONT_PREVIEW === 'true' ? 'demo' : getStoreHostSlug())), [slug]);
  const cleanSlug = String(slug || hostSlug || (import.meta.env.VITE_STOREFRONT_PREVIEW === 'true' ? 'demo' : 'default')).trim();
  const [quickViewProduct, setQuickViewProduct] = useState<StorefrontProduct | null>(null);
  const [isTableBillOpen, setIsTableBillOpen] = useState(false);

  const storeBasePath = useMemo(() => {
    if (hostSlug) return '';
    const match = location.pathname.match(/^\/(st|store|shop)\/[^/]+/);
    return match ? match[0] : `/st/${cleanSlug}`;
  }, [location.pathname, cleanSlug, hostSlug]);
  const storeHomePath = storeBasePath || '/';

  const openProduct = useCallback(
    (product: StorefrontProduct) => {
      setQuickViewProduct(product);
      const targetUrl = `${storeBasePath}/p/${product.id}`;
      if (window.location.pathname !== targetUrl) {
        window.history.pushState({ productId: product.id }, '', targetUrl);
      }
    },
    [storeBasePath],
  );

  const closeProduct = useCallback(() => {
    setQuickViewProduct(null);
    const targetUrl = paramCategoryId ? `${storeBasePath}/c/${paramCategoryId}` : storeHomePath;
    if (window.location.pathname !== targetUrl) {
      window.history.replaceState(null, '', targetUrl);
    }
  }, [paramCategoryId, storeBasePath, storeHomePath]);

  const {
    infoQuery,
    catalogQuery,
    info,
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    inStockOnly,
    setInStockOnly,
    onlyDeals,
    setOnlyDeals,
    sortBy,
    setSortBy,
    setVisibleCount,
    isCategoriesModalOpen,
    setIsCategoriesModalOpen,
    isCartOpen,
    setIsCartOpen,
    isCheckoutOpen,
    setIsCheckoutOpen,
    isMyOrdersOpen,
    setIsMyOrdersOpen,
    editingOrderNumber,
    setEditingOrderNumber,
    confirmedOrder,
    setConfirmedOrder,
    reviewProduct,
    setReviewProduct,
    isReviewModalOpen,
    setIsReviewModalOpen,
    favoriteIds,
    onlyFavorites,
    setOnlyFavorites,
    handleToggleFavorite,
    handleToggleFavorites,
    handleOpenReviewModal,
    handleReviewSubmitted,
    cartItems,
    cartMap,
    cartCount,
    cartSubtotal,
    handleAddToCart,
    handleUpdateQuantity,
    handleClearCart,
    handleGoHome: _handleGoHome,
    handleEditOrder,
    handleReorder,
    rawProducts,
    categories,
    dealsProducts,
    smartDealProductIds,
    categoryCounts,
    filteredProducts,
    topHomepageSections,
    paginatedProducts,
    hasMore,
    isHomepageMultiRow,
    handleRequestTableService,
    isCallingService,
  } = usePublicStorefront(cleanSlug);

  const handleOpenCart = useCallback(() => setIsCartOpen(true), [setIsCartOpen]);
  const handleCloseCart = useCallback(() => setIsCartOpen(false), [setIsCartOpen]);
  const handleOpenOrders = useCallback(() => setIsMyOrdersOpen(true), [setIsMyOrdersOpen]);
  const handleCloseOrders = useCallback(() => setIsMyOrdersOpen(false), [setIsMyOrdersOpen]);
  const handleOpenCategories = useCallback(() => setIsCategoriesModalOpen(true), [setIsCategoriesModalOpen]);
  const handleCloseCategories = useCallback(() => setIsCategoriesModalOpen(false), [setIsCategoriesModalOpen]);

    const handleToggleInStock = useCallback(() => {
    setInStockOnly((prev) => !prev);
  }, [setInStockOnly]);

  const handleBannerClick = useCallback(() => {
    const target = document.querySelector('.storefront-main-content') || document.querySelector('.storefront-subnav');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleHeroSelectDeals = useCallback(() => {
    setOnlyDeals(true);
    setOnlyFavorites(false);
    setSelectedCategory('all');
    handleBannerClick();
  }, [setOnlyDeals, setOnlyFavorites, setSelectedCategory, handleBannerClick]);

  const handleSubNavToggleDeals = useCallback(() => {
    setOnlyDeals((prev) => !prev);
    setOnlyFavorites(false);
    setSelectedCategory('all');
  }, [setOnlyDeals, setOnlyFavorites, setSelectedCategory]);

  const handleSelectDealsSimple = useCallback(() => {
    setOnlyDeals(true);
    setOnlyFavorites(false);
    setSelectedCategory('all');
    setSearchTerm('');
    window.scrollTo({ top: 180, behavior: 'smooth' });
  }, [setOnlyDeals, setOnlyFavorites, setSelectedCategory, setSearchTerm]);

  const handleFooterToggleDeals = useCallback(() => {
    setOnlyDeals(true);
    setOnlyFavorites(false);
    setSelectedCategory('all');
    setSearchTerm('');
    window.scrollTo({ top: 180, behavior: 'smooth' });
  }, [setOnlyDeals, setOnlyFavorites, setSelectedCategory, setSearchTerm]);

  const handleLoadMore = useCallback(() => {
    setVisibleCount((prev) => prev + ITEMS_PER_PAGE);
  }, [setVisibleCount]);

  // Handle Category Selection with full Browser History & URL sync (Amazon-grade UX)
  const handleSelectCategory = useCallback(
    (id: number | 'all') => {
      if (id === 'all') {
        navigate(storeHomePath);
      } else {
        navigate(`${storeBasePath}/c/${id}`);
      }
      setSearchTerm('');
      setOnlyDeals(false);
      setOnlyFavorites(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [navigate, storeBasePath, storeHomePath, setSearchTerm, setOnlyDeals, setOnlyFavorites],
  );

  const handleCustomGoHome = useCallback(() => {
    navigate(storeHomePath);
    setSearchTerm('');
    setOnlyDeals(false);
    setOnlyFavorites(false);
    setInStockOnly(false);
    setSortBy('featured');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [navigate, storeHomePath, setSearchTerm, setOnlyDeals, setOnlyFavorites, setInStockOnly, setSortBy]);

  const handleMobileToggleDeals = useCallback(() => {
    setOnlyDeals((prev) => !prev);
    setOnlyFavorites(false);
    setSelectedCategory('all');
    window.scrollTo({ top: 180, behavior: 'smooth' });
  }, [setOnlyDeals, setOnlyFavorites, setSelectedCategory]);

  const handleMobileToggleFavorites = useCallback(() => {
    handleToggleFavorites();
    window.scrollTo({ top: 180, behavior: 'smooth' });
  }, [handleToggleFavorites]);

  const handleProceedToCheckout = useCallback(() => {
    setIsCartOpen(false);
    setIsCheckoutOpen(true);
  }, [setIsCartOpen, setIsCheckoutOpen]);

  const handleCloseCheckout = useCallback(() => {
    setIsCheckoutOpen(false);
    setEditingOrderNumber(undefined);
  }, [setIsCheckoutOpen, setEditingOrderNumber]);

  const handleEditSuccess = useCallback(() => {
    setIsCheckoutOpen(false);
    setEditingOrderNumber(undefined);
    handleClearCart();
    setIsMyOrdersOpen(true);
  }, [setIsCheckoutOpen, setEditingOrderNumber, handleClearCart, setIsMyOrdersOpen]);

  const handleOrderSuccess = useCallback((orderData: any) => {
    setConfirmedOrder(orderData);
    setIsCheckoutOpen(false);
    setEditingOrderNumber(undefined);
    handleClearCart();
  }, [setConfirmedOrder, setIsCheckoutOpen, setEditingOrderNumber, handleClearCart]);

  const handleCloseSuccessModal = useCallback(() => {
    setConfirmedOrder(null);
  }, [setConfirmedOrder]);

  const handleTrackOrder = useCallback(() => {
    setConfirmedOrder(null);
    setIsMyOrdersOpen(true);
  }, [setConfirmedOrder, setIsMyOrdersOpen]);

  const handleCloseReviewModal = useCallback(() => {
    setIsReviewModalOpen(false);
    setReviewProduct(null);
  }, [setIsReviewModalOpen, setReviewProduct]);

  const handleModalReorder = useCallback((order: any) => {
    const { added, skipped } = handleReorder(order);
    if (added === 0) {
      toast.warning(t('storefront.public_storefront_page.s13', "أصناف هذا الطلب غير متاحة حالياً في المتجر."));
      return;
    }
    setIsMyOrdersOpen(false);
    if (skipped.length > 0) {
      toast.info(`أضفنا ${added} صنف للسلة. غير متاح حالياً: ${skipped.join(t('storefront.public_storefront_page.s14', "، "))}`);
    }
  }, [handleReorder, setIsMyOrdersOpen, t]);

  // Sync Category from URL parameters into store state
  useEffect(() => {
    if (activeCategoryParam) {
      const parsed = Number(activeCategoryParam);
      if (!isNaN(parsed) && parsed > 0) {
        setSelectedCategory(parsed);
        setOnlyDeals(false);
        setOnlyFavorites(false);
      }
    } else {
      const isCategoryRoute = location.pathname.includes('/c/') || location.pathname.includes('/category/');
      if (!isCategoryRoute && !queryCat) {
        setSelectedCategory('all');
      }
    }
  }, [activeCategoryParam, location.pathname, queryCat, setSelectedCategory, setOnlyDeals, setOnlyFavorites]);

  const handleCallWaiter = async () => {
    if (!tableParam || isCallingService) return;
    try {
      await handleRequestTableService(tableParam, 'waiter');
      toast.success(`تم إرسال نداء استدعاء الويتر لطاولة (${tableParam}) بنجاح!`);
    } catch {
      toast.error('تعذر إرسال طلب استدعاء الويتر');
    }
  };

  const handleRequestBill = async () => {
    if (!tableParam || isCallingService) return;
    try {
      await handleRequestTableService(tableParam, 'bill');
      toast.success(`تم إرسال طلب الحساب لطاولة (${tableParam}) بنجاح!`);
    } catch {
      toast.error('تعذر إرسال طلب الحساب');
    }
  };

  /*
   * رابط التتبع: يسجّل الطلب على هذا الجهاز (فيظهر في «طلباتي» هنا أيضاً) ثم يفتح «طلباتي»،
   * ويمسح التوكن من شريط العنوان فوراً حتى لا يُنسخ أو يُشارك بالخطأ مع رابط المتجر.
   */
  useEffect(() => {
    if (!trackOrderNumber) return;
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hashParams.get('t');
    if (token) saveCustomerOrderRef(cleanSlug, trackOrderNumber, token);
    navigate(storeHomePath, { replace: true });
    setIsMyOrdersOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackOrderNumber]);

  // عنوان التبويب ووسوم المشاركة تتبع المنتج المفتوح إن وُجد
  useStorefrontSeo({ info, product: quickViewProduct });

  useEffect(() => {
    if (info) {
      if (info.currency) {
        setGlobalSystemCurrency(info.currency);
      }
      initStorefrontPixels(info);
      trackStorefrontEvent('ViewContent', {
        contentName: info.title || info.businessName || 'المتجر الإلكتروني',
      });
      applyStorefrontThemeVariables(info);
    }
  }, [info]);

  // SF-SCROLL: Unlock document body & html scrolling for customer storefront (overrides ERP overflow:hidden)
  useEffect(() => {
    document.body.classList.add('storefront-active-page');
    document.documentElement.classList.add('storefront-active-page');
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const rootEl = document.getElementById('root');
    const originalRootHeight = rootEl?.style.height;

    // html is the single document scroller
    document.documentElement.style.overflowY = 'auto';
    document.documentElement.style.overflowX = 'hidden';
    document.documentElement.style.height = 'auto';

    // body and root must be visible to allow wheel and touch to scroll html
    document.body.style.overflow = 'visible';
    document.body.style.overflowY = 'visible';
    document.body.style.overflowX = 'visible';
    document.body.style.height = 'auto';

    if (rootEl) {
      rootEl.style.height = 'auto';
      rootEl.style.minHeight = '100vh';
      rootEl.style.overflow = 'visible';
      rootEl.style.overflowY = 'visible';
    }

    return () => {
      document.body.classList.remove('storefront-active-page');
      document.documentElement.classList.remove('storefront-active-page');
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      if (rootEl) {
        if (originalRootHeight) rootEl.style.height = originalRootHeight;
        else rootEl.style.removeProperty('height');
      }
    };
  }, []);

  useEffect(() => {
    if (!catalogQuery.data?.products) return;
    const hash = window.location.hash;
    const productParam = searchParams.get('product') || (hash.startsWith('#product-') ? hash.replace('#product-', '') : null);
    if (productParam) {
      const found = (catalogQuery.data.products as StorefrontProduct[]).find((p) => String(p.id) === String(productParam));
      if (found) {
        setQuickViewProduct(found);
      }
    }
  }, [catalogQuery.data?.products, searchParams]);

  /*
   * مزامنة المودال مع الرابط: الرابط هو مصدر الحقيقة.
   * يفتح `/p/:productId` المنتج مباشرة عند الدخول من لينك مشارَك أو إعلان،
   * ويغلقه الرجوع للجذر — فيعمل زر الرجوع في المتصفح كما يتوقع المستخدم.
   * البحث في الكتالوج الكامل لا في المفلتر، وإلا لن يُفتح منتج خارج الفلتر النشط.
   */
  /*
   * مزامنة حالة زر الرجوع بالمتصفح (popstate) لإغلاق أو فتح المنتج بسلاسة دون إعادة تحميل الصفحة.
   */
  useEffect(() => {
    const handlePopState = () => {
      const match = window.location.pathname.match(/\/p\/([^/]+)/);
      if (match) {
        const pId = match[1];
        const products = catalogQuery.data?.products as StorefrontProduct[] | undefined;
        const found = products?.find((p) => String(p.id) === String(pId));
        setQuickViewProduct(found || null);
      } else {
        setQuickViewProduct(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [catalogQuery.data?.products]);

  useEffect(() => {
    if (!productId) return;
    const products = catalogQuery.data?.products as StorefrontProduct[] | undefined;
    if (!products) return;
    const found = products.find((p) => String(p.id) === String(productId));
    if (found) {
      setQuickViewProduct(found);
    }
  }, [productId, catalogQuery.data?.products]);

  if (catalogQuery.isLoading || infoQuery.isLoading) {
    // Page-shaped placeholder instead of a spinner; uses the store colour as soon as /info is in.
    return <StorefrontSkeleton brandColor={infoQuery.data?.brandColor} />;
  }

  // If storefront is explicitly disabled by merchant
  if (infoQuery.data && infoQuery.data.enabled === false) {
    return (
      <div
        dir={dir}
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
          <IconStore size={48} color="#94a3b8" />
        </div>
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
          {t('storefront.public_storefront_page.s0', "عفواً، المتجر متوقف حالياً")}
        </h2>
        <p style={{ color: '#64748b', fontSize: '14px', maxWidth: '400px' }}>
          {t('storefront.public_storefront_page.s1', "المتجر غير متاح لاستقبال الطلبات في الوقت الحالي. تواصل مع إدارة المتجر لمزيد من التفاصيل.")}
        </p>
      </div>
    );
  }

  // If offline, connection error, or invalid link
  if (catalogQuery.isError || infoQuery.isError || !infoQuery.data || !catalogQuery.data) {
    return (
      <div
        dir={dir}
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
          <IconStore size={48} color="#94a3b8" />
        </div>
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
          {t('storefront.public_storefront_page.s2', "عفواً، المتجر غير متاح حالياً")}
        </h2>
        <p style={{ color: '#64748b', fontSize: '14px', maxWidth: '400px' }}>
          {t('storefront.public_storefront_page.s3', "تأكد من اتصالك بالإنترنت وصحة الرابط، أو تواصل مع إدارة المتجر لمزيد من التفاصيل.")}
        </p>
      </div>
    );
  }

  const activeQuickViewProduct = quickViewProduct
    ? rawProducts.find((p) => Number(p.id) === Number(quickViewProduct.id)) || localizeProduct(quickViewProduct, lang)
    : null;

  return (
    <div
      dir={dir}
      className="storefront-public-root storefront-page"
      style={{
        minHeight: '100vh',
        background: info?.brandSurfaceColor && info.brandSurfaceColor !== '#f8fafc' ? info.brandSurfaceColor : '#f4f6fa',
        color: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'inherit',
        width: '100%',
        maxWidth: '100vw',
        overflow: 'visible',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <StorefrontHeader
        info={info}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        cartCount={cartCount}
        cartTotal={cartSubtotal}
        onOpenCart={handleOpenCart}
        onOpenOrders={handleOpenOrders}
        onGoHome={handleCustomGoHome}
        onSelectCategory={handleSelectCategory}
        onSelectProduct={openProduct}
        onAddToCart={handleAddToCart}
        onOpenCategories={handleOpenCategories}
      />

      {/* Dine-In QR Table Banner */}
      {tableParam && (
        <div
          style={{
            background: 'linear-gradient(90deg, #15803d, #16a34a)',
            color: '#ffffff',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
            position: 'sticky',
            top: 0,
            zIndex: 40,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <UtensilsIcon size={18} color="#ffffff" strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '13.5px' }}>
                {t('storefront.public_storefront_page.s4', "أهلاً بك! أنت تطلب الآن مباشرة من")} <strong>{t('storefront.public_storefront_page.s5', "طاولة رقم (")}{tableParam})</strong>
              </div>
              <div style={{ fontSize: '11px', opacity: 0.9 }}>
                {t('storefront.public_storefront_page.s6', "اختر وجبتك وأرسل الطلب، وسيقوم المطبخ بتحضيره وتقديمه لطاولتك فوراً")}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={isCallingService}
              onClick={handleCallWaiter}
              style={{
                background: '#ffffff',
                color: '#15803d',
                border: 'none',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                transition: 'opacity 0.2s',
                opacity: isCallingService ? 0.7 : 1,
              }}
            >
              <BellIcon size={13} color="#15803d" />
              <span>{isCallingService ? t('storefront.public_storefront_page.s7', "جارٍ الإرسال...") : t('storefront.public_storefront_page.s8', "استدعاء الويتر")}</span>
            </button>
            <button
              type="button"
              disabled={isCallingService}
              onClick={handleRequestBill}
              style={{
                background: 'rgba(255,255,255,0.2)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.4)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'opacity 0.2s',
                opacity: isCallingService ? 0.7 : 1,
              }}
            >
              <CreditCardIcon size={13} color="#ffffff" />
              <span>{isCallingService ? t('storefront.public_storefront_page.s9', "جارٍ الطلب...") : t('storefront.public_storefront_page.s10', "طلب الحساب")}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsTableBillOpen(true)}
              style={{
                background: 'var(--storefront-primary-color, #170e5e)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.4)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              }}
            >
              <ReceiptIcon size={13} color="#ffffff" />
              <span>{t('storefront.public_storefront_page.s11', "سداد الشيك إلكترونياً")}</span>
            </button>
            <div
              style={{
                background: 'rgba(255,255,255,0.2)',
                padding: '4px 10px',
                borderRadius: '20px',
                fontSize: '11.5px',
                fontWeight: 700,
              }}
            >
              {t('storefront.public_storefront_page.s12', "طلب صالة")}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Luxury Split-Screen Editorial Hero */}
      {!searchTerm && isHomepageMultiRow && (
        <StorefrontHeroEditorial
          info={info}
          featuredProducts={dealsProducts.length > 0 ? dealsProducts : filteredProducts}
          categories={categories}
          cartMap={cartMap}
          onAddToCart={handleAddToCart}
          onUpdateQuantity={handleUpdateQuantity}
          onQuickView={openProduct}
          onSelectDeals={handleHeroSelectDeals}
          onSelectCategory={handleSelectCategory}
          onOpenCategoriesModal={handleOpenCategories}
        />
      )}

      {/* Sub-Header Utility Navigation Bar — shown when searching or filtering by category/deals/favorites */}
      {!isHomepageMultiRow && (
        <StorefrontSubNav
          categories={categories}
          selectedCategoryId={selectedCategory}
          onSelectCategory={handleSelectCategory}
          onOpenCategoriesModal={handleOpenCategories}
          onlyDeals={onlyDeals}
          onToggleDeals={handleSubNavToggleDeals}
          inStockOnly={inStockOnly}
          onToggleInStock={handleToggleInStock}
          dealsCount={dealsProducts.length}
          onlyFavorites={onlyFavorites}
          onToggleFavorites={handleToggleFavorites}
          favoritesCount={favoriteIds.size}
          onClearFilters={handleCustomGoHome}
        />
      )}

      {/* Horizontal Category Showcase - Kept visible on Home AND Category views for instant 1-tap switching */}
      {!searchTerm && !onlyDeals && !onlyFavorites && (
        <StorefrontCategoryShowcase
          categories={categories}
          selectedCategoryId={selectedCategory}
          onSelectCategory={handleSelectCategory}
          onOpenCategoriesModal={handleOpenCategories}
          categoryCounts={categoryCounts}
        />
      )}

      {/* Main Content Area */}
      <main
        className="storefront-main-content"
        style={{
          flex: 1,
          maxWidth: 'var(--storefront-container, 1440px)',
          width: '100%',
          margin: '0 auto',
          padding: '20px 20px 0',
        }}
      >
        {isHomepageMultiRow ? (
          <StorefrontMultiRowHome
            dealsProducts={dealsProducts}
            topHomepageSections={topHomepageSections}
            categories={categories}
            categoryCounts={categoryCounts}
            cartMap={cartMap}
            info={info}
            favoriteIds={favoriteIds}
            onAddToCart={handleAddToCart}
            onUpdateQuantity={handleUpdateQuantity}
            onOpenReviewModal={handleOpenReviewModal}
            onToggleFavorite={handleToggleFavorite}
            onQuickView={openProduct}
            onSelectDeals={handleSelectDealsSimple}
            onSelectCategory={handleSelectCategory}
            onOpenCategoriesModal={handleOpenCategories}
          />
        ) : (
          <StorefrontFilteredGrid
            searchTerm={searchTerm}
            onlyFavorites={onlyFavorites}
            onlyDeals={onlyDeals}
            selectedCategory={selectedCategory}
            categories={categories}
            sortBy={sortBy}
            onSortChange={setSortBy}
            onGoHome={handleCustomGoHome}
            filteredProducts={filteredProducts}
            paginatedProducts={paginatedProducts}
            hasMore={hasMore}
            onLoadMore={handleLoadMore}
            cartMap={cartMap}
            info={info}
            smartDealProductIds={smartDealProductIds}
            favoriteIds={favoriteIds}
            onAddToCart={handleAddToCart}
            onUpdateQuantity={handleUpdateQuantity}
            onOpenReviewModal={handleOpenReviewModal}
            onToggleFavorite={handleToggleFavorite}
            onQuickView={openProduct}
          />
        )}

        {info && isHomepageMultiRow && <StorefrontTrustBar info={info} />}
      </main>

      {/* Corporate E-commerce Footer */}
      <StorefrontFooter
        info={info}
        onOpenCart={handleOpenCart}
        onOpenOrders={handleOpenOrders}
        onOpenCategories={handleOpenCategories}
        onGoHome={handleCustomGoHome}
        onToggleDeals={handleFooterToggleDeals}
      />

      {/* Native-Grade Mobile Bottom Navigation Bar */}
      <StorefrontMobileBottomNav
        activeTab={
          isCartOpen
            ? 'cart'
            : isCategoriesModalOpen
            ? 'categories'
            : onlyFavorites
            ? 'favorites'
            : onlyDeals
            ? 'deals'
            : 'home'
        }
        cartCount={cartCount}
        favoritesCount={favoriteIds.size}
        dealsCount={dealsProducts.length}
        onGoHome={handleCustomGoHome}
        onOpenCategories={handleOpenCategories}
        onToggleDeals={handleMobileToggleDeals}
        onToggleFavorites={handleMobileToggleFavorites}
        onOpenCart={handleOpenCart}
      />

      {/* Modals & Live Cart */}
      <StorefrontModals
        allProducts={rawProducts.length > 0 ? rawProducts : filteredProducts}
        onAddToCart={handleAddToCart}
        quickViewProduct={activeQuickViewProduct}
        onCloseQuickView={closeProduct}
        onSelectQuickViewProduct={openProduct}
        favoriteIds={favoriteIds}
        onToggleFavorite={handleToggleFavorite}
        onOpenReviewModal={handleOpenReviewModal}
        isCategoriesModalOpen={isCategoriesModalOpen}
        onCloseCategoriesModal={handleCloseCategories}
        categories={categories}
        categoryCounts={categoryCounts}
        selectedCategory={selectedCategory}
        onSelectCategory={handleSelectCategory}
        cartItems={cartItems}
        info={info}
        isCartOpen={isCartOpen}
        onOpenCart={handleOpenCart}
        onCloseCart={handleCloseCart}
        onUpdateQuantity={handleUpdateQuantity}
        onClearCart={handleClearCart}
        onProceedToCheckout={handleProceedToCheckout}
        isCheckoutOpen={isCheckoutOpen}
        onCloseCheckout={handleCloseCheckout}
        cleanSlug={cleanSlug}
        editingOrderNumber={editingOrderNumber}
        tableParam={tableParam}
        onEditSuccess={handleEditSuccess}
        onOrderSuccess={handleOrderSuccess}
        confirmedOrder={confirmedOrder}
        onCloseSuccessModal={handleCloseSuccessModal}
        onTrackOrder={handleTrackOrder}
        isMyOrdersOpen={isMyOrdersOpen}
        onCloseMyOrders={handleCloseOrders}
        onEditOrder={handleEditOrder}
        onReorder={handleModalReorder}
        isReviewModalOpen={isReviewModalOpen}
        reviewProduct={reviewProduct ? localizeProduct(reviewProduct, lang) : null}
        onCloseReviewModal={handleCloseReviewModal}
        onReviewSubmitted={handleReviewSubmitted}
      />

      {tableParam && (
        <TableBillModal
          open={isTableBillOpen}
          onClose={() => setIsTableBillOpen(false)}
          slug={cleanSlug}
          tableNumber={tableParam}
        />
      )}

      {/* Floating WhatsApp Quick Contact */}
      {info && (
        <StorefrontFloatingWhatsApp
          phone={info.whatsappPhone}
          countryCode={info.countryCode}
          currency={info.currency}
          businessName={info.businessName || info.title}
          hasFloatingCart={cartItems.length > 0}
        />
      )}
    </div>
  );
}
