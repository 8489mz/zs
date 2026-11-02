import { useStorefrontLang } from '@/i18n';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CartItem, StorefrontInfo, StorefrontProduct } from '../types/storefront.types';
import { StorefrontLiveCartItem } from './StorefrontLiveCartItem';
import { IconShoppingCart } from './StorefrontIcons';
import { Trash2Icon, XIcon, AlertTriangleIcon } from '@/shared/components/icons/AppIcons';
import { calculateCartSubtotal } from '../lib/storefront-cart-pricing';
import { isThreeDecimalCurrency, getCurrencySymbol } from '@/lib/currencies';
import { useBodyScrollLock } from '@/shared/components/dialog-shell';

interface StorefrontLiveCartDockProps {
  cartItems: CartItem[];
  info?: StorefrontInfo;
  deliveryFee?: number;
  minOrder?: number;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onUpdateQuantity: (productId: number, qty: number) => void;
  onClearCart: () => void;
  onProceedToCheckout: () => void;
  suggestedProducts?: StorefrontProduct[];
  onAddToCart?: (product: StorefrontProduct) => void;
}

export function StorefrontLiveCartDock({
  cartItems,
  info,
  deliveryFee: deliveryFeeProp,
  minOrder: minOrderProp,
  isOpen,
  onClose,
  onUpdateQuantity,
  onClearCart,
  onProceedToCheckout,
}: StorefrontLiveCartDockProps) {
  const { t, isEn, dir } = useStorefrontLang();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const clearConfirmRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(isOpen);

  // Close clear confirmation on click outside
  useEffect(() => {
    if (!showClearConfirm) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (clearConfirmRef.current && !clearConfirmRef.current.contains(e.target as Node)) {
        setShowClearConfirm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showClearConfirm]);

  // Close live cart drawer (or clear confirmation first) on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (showClearConfirm) {
          setShowClearConfirm(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, showClearConfirm, onClose]);

  const storeCurrency = info?.currency || 'EGP';
  const isThreeDec = isThreeDecimalCurrency(storeCurrency);
  const activeCurrencySymbol = storeCurrency === 'EGP' ? (isEn ? 'EGP' : 'جنيه') : getCurrencySymbol(storeCurrency);

  const formatPriceNumber = (val: number | string | undefined | null): string => {
    const num = Number(val || 0);
    if (isThreeDec) return num.toFixed(3);
    if (storeCurrency === 'EGP') return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    return num.toFixed(2);
  };

  const cartTotals = calculateCartSubtotal(cartItems, storeCurrency);
  const subtotal = cartTotals.subtotal;
  const originalSubtotal = cartTotals.originalSubtotal;
  const totalSavings = cartTotals.totalSavings;

  const freeShippingThreshold = info?.freeShippingMinOrder || 500;
  const isFreeShippingQualified = Boolean(info?.freeShippingEnabled && subtotal >= freeShippingThreshold);

  const baseDeliveryFee = deliveryFeeProp ?? info?.deliveryFee ?? 0;
  const effectiveDeliveryFee = isFreeShippingQualified ? 0 : baseDeliveryFee;
  const minOrder = minOrderProp ?? info?.minOrder ?? 0;
  const total = subtotal + effectiveDeliveryFee;
  const isMinOrderMet = minOrder <= 0 || subtotal >= minOrder;

  if (!isOpen) return null;

  // Case 2: Expanded State -> Brand New Modern Minimalist Cart Sheet (Nike / Apple Inspired)
  const cartContent = (
    <div
      dir={dir}
      className="storefront-live-cart-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.38)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
        animation: 'sfAppleBackdropIn 0.16s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        fontFamily: 'inherit',
        pointerEvents: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <style>{`
        @keyframes liveCartSlideInRight {
          from { opacity: 0; transform: translate3d(32px, 0, 0); }
          to { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .live-cart-scroll::-webkit-scrollbar { width: 4px; }
        .live-cart-scroll::-webkit-scrollbar-track { background: transparent; }
        .live-cart-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
        @media (max-width: 640px) {
          .storefront-live-cart-fullsheet { width: 100% !important; max-width: 100% !important; }
        }
      `}</style>

      <div
        className="storefront-live-cart-fullsheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '410px',
          height: '100%',
          background: '#ffffff',
          boxShadow: '-20px 0 50px rgba(15, 23, 42, 0.16)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          willChange: 'transform, opacity',
          animation: 'liveCartSlideInRight 0.2s cubic-bezier(0.22, 1, 0.36, 1) forwards',
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}
      >
        {/* Minimalist Centered Top Bar (Soft Squircle Back/Close Button, Centered Title, Squircle Clear Button) */}
        <div
          style={{
            padding: '20px 22px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff',
            position: 'relative',
          }}
        >
          {/* Right Soft Squircle Button: Close / Back */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            title={t('storefront.storefront_live_cart_dock.s3', 'تصغير ومتابعة التسوق')}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
              transition: 'all 0.15s ease',
              padding: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#f8fafc')}
          >
            <XIcon size={16} />
          </button>

          {/* Centered Title */}
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16.5px', color: '#0f172a', fontWeight: 600, letterSpacing: '0px' }}>
              {t('storefront.storefront_live_cart_dock.s0', 'سلة المشتريات')}
            </h3>
          </div>

          {/* Left Circular Button: Clear Cart */}
          {cartItems.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowClearConfirm((prev) => !prev)}
              title={t('storefront.storefront_live_cart_dock.s1', 'تفريغ السلة بالكامل')}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: showClearConfirm ? '#fef2f2' : '#f8fafc',
                border: showClearConfirm ? '1px solid #fecaca' : '1px solid #f1f5f9',
                color: showClearConfirm ? '#ef4444' : '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                padding: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#ef4444';
                e.currentTarget.style.background = '#fef2f2';
              }}
              onMouseLeave={(e) => {
                if (!showClearConfirm) {
                  e.currentTarget.style.color = '#64748b';
                  e.currentTarget.style.background = '#f8fafc';
                }
              }}
            >
              <Trash2Icon size={15} />
            </button>
          ) : (
            <div style={{ width: '36px', height: '36px' }} />
          )}

          {/* Confirmation Popover for Clear Cart */}
          {showClearConfirm && cartItems.length > 0 && (
            <div
              ref={clearConfirmRef}
              dir="rtl"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: '22px',
                zIndex: 100,
                width: '230px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                boxShadow: '0 14px 32px rgba(15, 23, 42, 0.14)',
                padding: '14px',
                animation: 'fadeIn 0.15s ease-out',
                letterSpacing: '0px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>
                {t('storefront.storefront_live_cart_dock.s5', 'تفريغ السلة بالكامل؟')}
              </div>
              <div style={{ fontSize: '11.5px', color: '#64748b', marginBottom: '12px', lineHeight: 1.4 }}>
                {t('storefront.storefront_live_cart_dock.s6', 'هل تريد إزالة كافة المنتجات (')}{cartItems.length}{t('storefront.storefront_live_cart_dock.s7', ') من سلتك؟')}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => {
                    onClearCart();
                    setShowClearConfirm(false);
                  }}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: '8px',
                    background: '#ef4444',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {t('storefront.storefront_live_cart_dock.s8', 'تأكيد')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: '8px',
                    background: '#f1f5f9',
                    color: '#475569',
                    border: 'none',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {t('storefront.storefront_live_cart_dock.s9', 'إلغاء')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Un-boxed Scrollable Items List */}
        <div
          className="live-cart-scroll"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 22px',
            display: 'flex',
            flexDirection: 'column',
            background: '#ffffff',
          }}
        >
          {cartItems.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#94a3b8',
                textAlign: 'center',
                padding: '40px 20px',
              }}
            >
              <div
                style={{
                  width: '68px',
                  height: '68px',
                  borderRadius: '18px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '16px',
                  color: '#94a3b8',
                }}
              >
                <IconShoppingCart size={32} strokeWidth={1.5} />
              </div>
              <p style={{ margin: 0, fontSize: '15.5px', fontWeight: 600, color: '#0f172a' }}>
                {t('storefront.storefront_cart_drawer.s2', 'سلة التسوق فارغة')}
              </p>
              <p style={{ margin: '6px 0 20px', fontSize: '13px', color: '#64748b', maxWidth: '240px', fontWeight: 400, lineHeight: 1.5 }}>
                {t('storefront.storefront_cart_drawer.s3', 'تصفح المنتجات وأضف ما ترغب لطلبك الآن')}
              </p>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 24px',
                  borderRadius: '12px',
                  background: 'var(--storefront-primary-color, #2d68c4)',
                  color: '#ffffff',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(45, 104, 196, 0.25)',
                }}
              >
                {t('storefront.storefront_cart_drawer.browse_products', 'تصفح المنتجات')}
              </button>
            </div>
          ) : (
            cartItems.map((item) => (
              <StorefrontLiveCartItem
                key={item.product.id}
                item={item}
                onUpdateQuantity={onUpdateQuantity}
              />
            ))
          )}
        </div>

        {/* Clean Un-boxed Summary Footer & Standard Rounded Checkout Button */}
        {cartItems.length > 0 && (
          <div
            style={{
              padding: '16px 22px 22px',
              background: '#ffffff',
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              flexShrink: 0,
              letterSpacing: '0px',
            }}
          >
            {/* Price Calculations Card */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#475569', fontWeight: 500, fontSize: '13.5px' }}>
                  {t('storefront.storefront_live_cart_dock.subtotal_label', 'قيمة الأصناف')}
                </span>
                <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>
                  {formatPriceNumber(totalSavings > 0 ? originalSubtotal : subtotal)} {activeCurrencySymbol}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#475569', fontWeight: 500, fontSize: '13.5px' }}>
                  {t('storefront.storefront_live_cart_dock.s16', 'مصاريف التوصيل')}
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  {effectiveDeliveryFee === 0 && baseDeliveryFee > 0 && (
                    <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: '12px', fontWeight: 400 }}>
                      {formatPriceNumber(baseDeliveryFee)} {activeCurrencySymbol}
                    </span>
                  )}
                  <span style={{ fontWeight: 600, color: effectiveDeliveryFee > 0 ? '#0f172a' : '#16a34a', fontSize: '13.5px' }}>
                    {effectiveDeliveryFee > 0
                      ? `${formatPriceNumber(effectiveDeliveryFee)} ${activeCurrencySymbol}`
                      : t('storefront.storefront_live_cart_dock.s17', 'مجاني')}
                  </span>
                </div>
              </div>

              {totalSavings > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#475569', fontWeight: 500, fontSize: '13.5px' }}>
                    {t('storefront.storefront_live_cart_dock.discount_label', 'الخصم')}
                  </span>
                  <span style={{ fontWeight: 600, color: '#dc2626', fontSize: '14px' }}>
                    - {formatPriceNumber(totalSavings)} {activeCurrencySymbol}
                  </span>
                </div>
              )}

              <div style={{ height: '1px', background: '#e2e8f0', margin: '2px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                  {t('storefront.storefront_live_cart_dock.s18', 'المبلغ الإجمالي')}
                </span>
                <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--storefront-primary-color, #2d68c4)' }}>
                  {formatPriceNumber(total)} {activeCurrencySymbol}
                </span>
              </div>
            </div>

            {!isMinOrderMet && (
              <div
                style={{
                  background: '#fff7ed',
                  border: '1px solid #fed7aa',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  fontSize: '11.5px',
                  color: '#c2410c',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  letterSpacing: '0px',
                }}
              >
                <AlertTriangleIcon size={13} color="#c2410c" />
                <span>
                  {t('storefront.storefront_live_cart_dock.s19', 'الحد الأدنى للطلب هو')} {minOrder} {activeCurrencySymbol} (
                  {t('storefront.storefront_live_cart_dock.s20', 'متبقي')} {formatPriceNumber(minOrder - subtotal)} {activeCurrencySymbol})
                </span>
              </div>
            )}

            {/* Primary Checkout Button with standard site border-radius (12px) */}
            <button
              type="button"
              onClick={onProceedToCheckout}
              disabled={!isMinOrderMet}
              style={{
                width: '100%',
                height: '48px',
                borderRadius: '12px',
                background: isMinOrderMet ? 'var(--storefront-primary-color, #2d68c4)' : '#cbd5e1',
                color: '#ffffff',
                border: 'none',
                fontSize: '15px',
                fontWeight: 600,
                letterSpacing: '0px',
                cursor: isMinOrderMet ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: isMinOrderMet ? '0 4px 14px rgba(45, 104, 196, 0.25)' : 'none',
                transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => {
                if (isMinOrderMet) e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                if (isMinOrderMet) e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span>{t('storefront.storefront_live_cart_dock.s21', 'إتمام الطلب')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(cartContent, document.body);
}

