import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback, useRef } from 'react';
import { StorefrontProduct, StorefrontInfo } from '../types/storefront.types';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import {
  XIcon,
  PlusIcon,
  CheckIcon,
  ClockIcon,
  Share2Icon,
} from '@/shared/components/icons/AppIcons';
import {
  IconShoppingBag,
  IconWhatsapp,
} from './StorefrontIcons';
import { trackStorefrontEvent } from '../lib/storefront-pixel-tracker';
import { buildCartProduct, getProductVariants, resolveVariantUnitPrice } from '../lib/storefront-variant-pricing';
import { generatePremiumProductSvg, resolveProductPhoto } from '../lib/storefront-photo-matcher';
import { getContrastTextColor } from '../lib/storefront-theme-contrast';

interface TapOriginMetrics {
  dx: number;
  dy: number;
  scale: number;
  timestamp: number;
}

let lastProductTapOrigin: TapOriginMetrics | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const cardEl = target.closest(
        '.storefront-product-card, .storefront-coverflow-card, .sf-amz-quick-tile, .sf-amz-promo-card, .sf-amz-hero-orange-card, .storefront-deal-spotlight'
      ) as HTMLElement | null;

      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;

      if (cardEl) {
        const rect = cardEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const ratio = Math.min(rect.width / 490, rect.height / 500);
        lastProductTapOrigin = {
          dx: Math.round(cx - vw / 2),
          dy: Math.round(cy - vh / 2),
          scale: Number(Math.max(0.28, Math.min(0.52, ratio)).toFixed(3)),
          timestamp: performance.now(),
        };
      } else if (e.clientX && e.clientY) {
        lastProductTapOrigin = {
          dx: Math.round(e.clientX - vw / 2),
          dy: Math.round(e.clientY - vh / 2),
          scale: 0.36,
          timestamp: performance.now(),
        };
      }
    },
    { capture: true, passive: true }
  );
}

export interface StorefrontProductQuickViewModalProps {
  product: StorefrontProduct | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (product: StorefrontProduct, quantity: number) => void;
  info?: StorefrontInfo;
  tenantSlug?: string;
  slug?: string;
  cartLine?: { variantName?: string | null; quantity: number } | null;
  allProducts?: StorefrontProduct[];
  onSelectProduct?: (product: StorefrontProduct) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (productId: number) => void;
  onOpenReviewModal?: (product: StorefrontProduct) => void;
}

export function StorefrontProductQuickViewModal({
  product: propProduct,
  isOpen,
  onClose,
  onAddToCart,
  info,
  tenantSlug,
  slug,
  isFavorite: isFavoriteProp,
  onToggleFavorite,
}: StorefrontProductQuickViewModalProps) {
  const { t } = useTranslation();
  const [mountedProduct, setMountedProduct] = useState<StorefrontProduct | null>(propProduct);
  const [isClosing, setIsClosing] = useState(false);
  const [originMetrics, setOriginMetrics] = useState<TapOriginMetrics>({ dx: 0, dy: 48, scale: 0.38, timestamp: 0 });
  const closeTimerRef = useRef<number | null>(null);

  const [qty, setQty] = useState(1);
  const [addedAnimation, setAddedAnimation] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState<number | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [localFavorite, setLocalFavorite] = useState(false);

  useEffect(() => {
    if (isOpen && propProduct) {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      const now = performance.now();
      if (lastProductTapOrigin && now - lastProductTapOrigin.timestamp < 1500) {
        setOriginMetrics(lastProductTapOrigin);
      } else {
        setOriginMetrics({ dx: 0, dy: 64, scale: 0.42, timestamp: now });
      }
      setMountedProduct(propProduct);
      setIsClosing(false);
    } else if (!isOpen && mountedProduct) {
      setIsClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setMountedProduct(null);
        setIsClosing(false);
        closeTimerRef.current = null;
      }, 150);
    }
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, [isOpen, propProduct]);

  const handleAnimatedClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setMountedProduct(null);
      setIsClosing(false);
      closeTimerRef.current = null;
      onClose();
    }, 145);
  }, [isClosing, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleAnimatedClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleAnimatedClose]);

  const product = propProduct || mountedProduct;

  useEffect(() => {
    if (propProduct) {
      setQty(1);
      setAddedAnimation(false);
      setCopiedLink(false);
      setActivePhotoIndex(0);
      const variants = (propProduct as any).variants || [];
      setSelectedVariantIndex(variants.length > 0 ? 0 : null);
      try {
        setLocalFavorite(localStorage.getItem(`zs_fav_${propProduct.id}`) === 'true');
      } catch {
        setLocalFavorite(false);
      }
    }
  }, [propProduct]);

  if (!product || (!isOpen && !mountedProduct)) return null;

  const isFavorite = isFavoriteProp !== undefined ? isFavoriteProp : localFavorite;

  const handleFavoriteClick = () => {
    if (onToggleFavorite) {
      onToggleFavorite(product.id);
    } else {
      setLocalFavorite((prev) => {
        const next = !prev;
        try {
          localStorage.setItem(`zs_fav_${product.id}`, String(next));
        } catch {}
        return next;
      });
    }
  };

  const getProductDirectUrl = () => {
    if (typeof window === 'undefined') return '';
    const origin = window.location.origin;
    const activeSlug = tenantSlug || slug || info?.slug || 'demo';
    const pathMatch = window.location.pathname.match(/^\/(st|store|shop)\/[^/]+/);
    const basePath = pathMatch ? pathMatch[0] : `/st/${activeSlug}`;
    return `${origin}${basePath}/p/${product.id}`;
  };

  const handleShareClick = async () => {
    const shareUrl = getProductDirectUrl();
    try {
      if (navigator.share) {
        await navigator.share({
          title: product.name,
          text: `${product.name} - ${product.price.toLocaleString()} ${info?.currency || 'ج.م'}`,
          url: shareUrl,
        });
        return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {}
  };

  const variants = getProductVariants(product);
  const selectedVariant = selectedVariantIndex !== null ? variants[selectedVariantIndex] || null : null;

  const autoPhoto = resolveProductPhoto(product.name, product.categoryName);
  // The picked variant's photo wins; otherwise the product photo, then the
  // auto photo — exactly the fallback the cart line uses (buildCartProduct).
  const variantPhoto = selectedVariant?.imageUrl || '';
  const displayPrimaryPhoto = variantPhoto || product.imageUrl || autoPhoto.url || '';

  const brandColor = info?.brandColor || 'var(--storefront-primary-color, #2563eb)';
  const brandColorContrast = getContrastTextColor(info?.brandColor);
  const inStock = product.inStock !== false;

  const gallery: string[] =
    variantPhoto
      ? [variantPhoto]
      : (product as any).gallery && (product as any).gallery.length > 0
        ? (product as any).gallery
        : displayPrimaryPhoto
          ? [displayPrimaryPhoto]
          : [];

  const activePhotoUrl =
    gallery[activePhotoIndex] || displayPrimaryPhoto || generatePremiumProductSvg(product.name, product.categoryName);

  const basePrice = resolveVariantUnitPrice(product.price, selectedVariant) ?? product.price;
  const isZeroPrice = Number(basePrice || 0) <= 0;

  const hasOriginalDiscount = Boolean(product.hasDiscount && product.originalPrice && product.originalPrice > basePrice);
  const discountPercentage =
    product.discountPercent ||
    (hasOriginalDiscount && product.originalPrice
      ? Math.round(((product.originalPrice - basePrice) / product.originalPrice) * 100)
      : 0);

  const cleanWhatsappPhone = ((info?.whatsappPhone || (info as any)?.whatsapp) || '').replace(/[^0-9]/g, '');
  const whatsappInquiryUrl = cleanWhatsappPhone
    ? `https://wa.me/${cleanWhatsappPhone}?text=${encodeURIComponent(
        `مرحباً، أود الاستفسار عن صنف: ${product.name}${selectedVariant ? ` (${selectedVariant.name})` : ''} - بسعر ${basePrice.toLocaleString()} ${info?.currency || 'ج.م'}`
      )}`
    : null;

  const handleAdd = () => {
    if (!inStock || isZeroPrice) return;
    const finalProduct = buildCartProduct(product, selectedVariant?.name);
    if (!finalProduct) return;

    onAddToCart(finalProduct, qty);
    setAddedAnimation(true);
    trackStorefrontEvent('AddToCart', {
      contentName: finalProduct.name,
      contentId: product.id,
      value: basePrice * qty,
      currency: info?.currency || 'EGP',
    });
    setTimeout(() => {
      setAddedAnimation(false);
      handleAnimatedClose();
    }, 300);
  };

  return (
    <div
      dir="rtl"
      className={`sf-quickview-backdrop ${isClosing ? 'is-closing' : 'is-opening'}`}
      style={
        {
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          '--ios-origin-x': `${originMetrics.dx}px`,
          '--ios-origin-y': `${originMetrics.dy}px`,
          '--ios-init-scale': `${originMetrics.scale}`,
        } as React.CSSProperties
      }
      onClick={handleAnimatedClose}
    >
      <style>{`
        @keyframes sfIosBackdropIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes sfIosBackdropOut {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes sfIosAppLaunchOpen {
          0% {
            opacity: 0;
            transform: translate3d(var(--ios-origin-x, 0px), var(--ios-origin-y, 48px), 0) scale3d(var(--ios-init-scale, 0.36), var(--ios-init-scale, 0.36), 1);
          }
          66% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale3d(1.012, 1.012, 1);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale3d(1, 1, 1);
          }
        }
        @keyframes sfIosAppLaunchClose {
          0% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale3d(1, 1, 1);
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--ios-origin-x, 0px), var(--ios-origin-y, 48px), 0) scale3d(var(--ios-init-scale, 0.34), var(--ios-init-scale, 0.34), 1);
          }
        }
        .sf-quickview-backdrop {
          background-color: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .sf-quickview-backdrop.is-opening {
          animation: sfIosBackdropIn 0.15s ease forwards;
        }
        .sf-quickview-backdrop.is-closing {
          animation: sfIosBackdropOut 0.14s ease forwards;
          pointer-events: none;
        }
        .sf-quickview-shell {
          will-change: transform, opacity;
          transform-origin: center center;
        }
        .sf-quickview-backdrop.is-opening .sf-quickview-shell {
          animation: sfIosAppLaunchOpen 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .sf-quickview-backdrop.is-closing .sf-quickview-shell {
          animation: sfIosAppLaunchClose 0.14s cubic-bezier(0.32, 0.72, 0, 1) forwards;
        }
        .sf-quickview-ai-btn:active {
          transform: scale(0.96);
        }
        @media (max-width: 640px) {
          .sf-quickview-backdrop {
            padding: 10px !important;
            align-items: flex-end !important;
          }
          .sf-quickview-shell {
            max-width: 100% !important;
            width: 100% !important;
            border-radius: 20px !important;
            padding: 16px 16px 18px !important;
            gap: 12px !important;
            max-height: 88vh !important;
          }
        }
      `}</style>

      <div
        className="sf-quickview-shell"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '22px',
          border: '1px solid #edf1f7',
          maxWidth: '490px',
          width: '100%',
          maxHeight: '90vh',
          boxShadow: '0 24px 48px -12px rgba(15, 23, 42, 0.18)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '18px 22px 20px',
          gap: '14px',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Minimal Top Bar with Storefront Border-Radius (10px) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={handleAnimatedClose}
            className="sf-quickview-ai-btn"
            aria-label="إغلاق"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#334155',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
              transition: 'all 0.15s ease',
            }}
          >
            <XIcon size={15} strokeWidth={2} />
          </button>

          <span
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: '#0f172a',
            }}
          >
            تفاصيل المنتج
          </span>

          <button
            type="button"
            onClick={handleShareClick}
            className="sf-quickview-ai-btn"
            title={copiedLink ? 'تم نسخ الرابط' : 'مشاركة المنتج'}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: copiedLink ? '#ecfdf5' : '#ffffff',
              border: `1px solid ${copiedLink ? '#a7f3d0' : '#e2e8f0'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: copiedLink ? '#059669' : '#334155',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
              transition: 'all 0.15s ease',
            }}
          >
            {copiedLink ? <CheckIcon size={15} color="#059669" /> : <Share2Icon size={15} color="#334155" strokeWidth={1.9} />}
          </button>
        </div>

        {/* Scrollable Content */}
        <div
          className="thin-scrollbar"
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {/* 2. Product Image Box with Storefront Radius (14px) + Pagination Dots */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '100%',
                height: '245px',
                borderRadius: '14px',
                backgroundColor: '#f8fafc',
                border: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                padding: '22px',
                boxSizing: 'border-box',
              }}
            >
              <img
                src={activePhotoUrl}
                alt={product.name}
                decoding="async"
                onError={(e) => {
                  e.currentTarget.src = generatePremiumProductSvg(product.name, product.categoryName);
                }}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  mixBlendMode: 'multiply',
                }}
              />

              {discountPercentage > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    background: '#e11d48',
                    color: '#ffffff',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: '8px',
                  }}
                >
                  خصم {discountPercentage}%
                </span>
              )}
            </div>

            {/* Minimal Dot Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
              {gallery.length > 1 ? (
                gallery.map((_, idx) => {
                  const isCurrent = idx === activePhotoIndex;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActivePhotoIndex(idx)}
                      style={{
                        width: isCurrent ? '20px' : '6px',
                        height: '6px',
                        borderRadius: '6px',
                        background: isCurrent ? '#0f172a' : '#cbd5e1',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    />
                  );
                })
              ) : (
                <>
                  <span style={{ width: '5px', height: '5px', borderRadius: '5px', background: '#e2e8f0' }} />
                  <span style={{ width: '20px', height: '5px', borderRadius: '5px', background: '#0f172a' }} />
                  <span style={{ width: '5px', height: '5px', borderRadius: '5px', background: '#e2e8f0' }} />
                </>
              )}
            </div>
          </div>

          {/* 3. Category Label + Title + Favorite Button (No Star Ratings) */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              {product.categoryName && (
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 400,
                    color: '#94a3b8',
                    marginBottom: '4px',
                  }}
                >
                  {product.categoryName}
                </div>
              )}

              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: '#0f172a',
                  margin: 0,
                  lineHeight: 1.4,
                }}
              >
                {product.name}
              </h2>
            </div>

            {/* Favorite Button with Storefront Border-Radius (11px) */}
            <button
              type="button"
              onClick={handleFavoriteClick}
              className="sf-quickview-ai-btn"
              aria-label="المفضلة"
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '11px',
                background: isFavorite ? '#fff1f2' : '#ffffff',
                border: `1px solid ${isFavorite ? '#fecdd3' : '#e2e8f0'}`,
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                marginTop: '2px',
                transition: 'all 0.15s ease',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill={isFavorite ? '#e11d48' : 'none'}
                stroke={isFavorite ? '#e11d48' : '#64748b'}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
          </div>

          {/* 4. Options / Status & Quantity Stepper Row (Storefront 10px-12px Radius) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            {/* Right side: Variants (or Stock status if no variants) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '150px' }}>
              <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>
                {variants.length > 0 ? 'اختر الخيار' : 'الحالة'}
              </span>

              {variants.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {variants.map((v, idx) => {
                    const isSelected = selectedVariantIndex === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => { setSelectedVariantIndex(idx); setActivePhotoIndex(0); }}
                        style={{
                          height: '36px',
                          padding: '0 14px',
                          borderRadius: '10px',
                          border: isSelected ? `1px solid ${brandColor}` : '1px solid #e2e8f0',
                          background: isSelected ? brandColor : '#ffffff',
                          color: isSelected ? '#ffffff' : '#334155',
                          fontSize: '12.5px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {v.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      height: '36px',
                      padding: '0 13px',
                      borderRadius: '10px',
                      background: inStock ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${inStock ? '#dcfce7' : '#fee2e2'}`,
                      color: inStock ? '#15803d' : '#dc2626',
                      fontSize: '12.5px',
                      fontWeight: 500,
                    }}
                  >
                    {inStock ? 'متوفر وجاهز للشحن' : 'نفدت الكمية حالياً'}
                  </span>
                </div>
              )}
            </div>

            {/* Left side: QTY Stepper [ + ] 1 [ - ] (RTL Standard with 10px Radius) */}
            {!isZeroPrice && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px', flexShrink: 0 }}>
                <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>
                  الكمية
                </span>

                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: '36px',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    padding: '0 3px',
                    gap: '2px',
                  }}
                >
                  <button
                    type="button"
                    disabled={!inStock || (product.stockQty > 0 && product.stockQty < 999 && qty >= product.stockQty)}
                    onClick={() => setQty((prev) => prev + 1)}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      background: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: '#1e293b',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
                    }}
                  >
                    <PlusIcon size={13} color="#1e293b" />
                  </button>

                  <span
                    style={{
                      minWidth: '28px',
                      textAlign: 'center',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      color: '#0f172a',
                    }}
                  >
                    {qty}
                  </span>

                  <button
                    type="button"
                    disabled={qty <= 1 || !inStock}
                    onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      background: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: qty <= 1 ? 'not-allowed' : 'pointer',
                      opacity: qty <= 1 ? 0.4 : 1,
                      color: '#1e293b',
                      fontSize: '15px',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
                    }}
                  >
                    −
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 5. Clean Description */}
          {product.description && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '2px' }}>
              <span style={{ fontSize: '12px', fontWeight: 400, color: '#94a3b8' }}>
                الوصف
              </span>
              <p
                style={{
                  margin: 0,
                  fontSize: '13.5px',
                  lineHeight: 1.6,
                  color: '#475569',
                  fontWeight: 400,
                }}
              >
                {product.description}
              </p>
            </div>
          )}
        </div>

        {/* 6. Bottom Bar with Storefront Border-Radius (14px container, 12px button) */}
        <div
          style={{
            flexShrink: 0,
            background: '#f8fafc',
            border: '1px solid #f1f5f9',
            borderRadius: '14px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '14px',
          }}
        >
          {isZeroPrice ? (
            <a
              href={whatsappInquiryUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                width: '100%',
                height: '42px',
                borderRadius: '12px',
                backgroundColor: '#25d366',
                color: '#ffffff',
                fontSize: '13.5px',
                fontWeight: 600,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <IconWhatsapp size={17} color="#ffffff" />
              <span>{t('storefront.storefront_product_quick_view_modal.s23', 'استفسر عن السعر عبر واتساب')}</span>
            </a>
          ) : (
            <>
              {/* Storefront-styled Add to Cart Button (Right side in RTL) */}
              <button
                type="button"
                className="sf-quickview-ai-btn"
                disabled={!inStock}
                onClick={handleAdd}
                style={{
                  height: '42px',
                  padding: '0 24px',
                  borderRadius: '12px',
                  backgroundColor: inStock ? brandColor : '#e2e8f0',
                  color: inStock ? brandColorContrast || '#ffffff' : '#64748b',
                  border: 'none',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: inStock ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontFamily: 'inherit',
                  boxShadow: inStock ? '0 3px 10px rgba(37, 99, 235, 0.18)' : 'none',
                  transition: 'all 0.16s ease',
                  flexShrink: 0,
                }}
              >
                {addedAnimation ? (
                  <>
                    <CheckIcon size={16} color="#ffffff" />
                    <span>تمت الإضافة</span>
                  </>
                ) : inStock ? (
                  <>
                    <IconShoppingBag size={16} color="#ffffff" strokeWidth={2} />
                    <span>إضافة إلى السلة</span>
                  </>
                ) : (
                  <>
                    <ClockIcon size={15} color="#64748b" />
                    <span>غير متوفر</span>
                  </>
                )}
              </button>

              {/* Total Price Column (Left side in RTL) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'left', minWidth: 0 }}>
                <span style={{ fontSize: '11.5px', fontWeight: 400, color: '#94a3b8' }}>
                  السعر الإجمالي
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: '6px', marginTop: '2px' }}>
                  <span
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: '#0f172a',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <span>{(basePrice * qty).toLocaleString()}</span>
                    <span style={{ fontSize: '13px', fontWeight: 500 }}>
                      <CurrencySymbol />
                    </span>
                  </span>

                  {hasOriginalDiscount && product.originalPrice && (
                    <span
                      style={{
                        fontSize: '12.5px',
                        color: '#94a3b8',
                        textDecoration: 'line-through',
                        fontWeight: 400,
                      }}
                    >
                      {(product.originalPrice * qty).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
