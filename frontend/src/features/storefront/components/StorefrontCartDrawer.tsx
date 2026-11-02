import { useStorefrontLang } from '@/i18n';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getCurrencySymbol, isThreeDecimalCurrency } from '@/lib/currencies';
import { XIcon, Trash2Icon } from '@/shared/components/icons/AppIcons';
import { CartItem, StorefrontInfo } from '../types/storefront.types';
import { ProductIcon } from '@/shared/components/icons/product-svg-catalog';
import { IconShoppingCart } from './StorefrontIcons';
import { calculateCartSubtotal, calculateCartLinePricing } from '../lib/storefront-cart-pricing';
import { resolveProductPhoto } from '../lib/storefront-photo-matcher';
import { useBodyScrollLock } from '@/shared/components/dialog-shell';

interface StorefrontCartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  info?: StorefrontInfo;
  deliveryFee?: number;
  minOrder?: number;
  onUpdateQuantity: (productId: number, qty: number) => void;
  onClearCart: () => void;
  onProceedToCheckout: () => void;
}

export function StorefrontCartDrawer({
  isOpen,
  onClose,
  cartItems,
  info,
  deliveryFee: deliveryFeeProp,
  minOrder: minOrderProp,
  onUpdateQuantity,
  onClearCart,
  onProceedToCheckout,
}: StorefrontCartDrawerProps) {
  const { t, isEn, dir } = useStorefrontLang();

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, onClose]);

  const storeCurrency = info?.currency || 'EGP';
  const isThreeDec = isThreeDecimalCurrency(storeCurrency);
  const activeCurrencySymbol = isEn ? storeCurrency : storeCurrency === 'EGP' ? 'جنيه' : getCurrencySymbol(storeCurrency);

  const formatPriceNumber = (val: number | string | undefined | null): string => {
    const num = Number(val || 0);
    if (isThreeDec) {
      return num.toFixed(3);
    }
    if (storeCurrency === 'EGP') {
      return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    }
    return num.toFixed(2);
  };

  if (!isOpen) return null;

  const cartTotals = calculateCartSubtotal(cartItems, storeCurrency);
  const subtotal = cartTotals.subtotal;
  const originalSubtotal = cartTotals.originalSubtotal;
  const totalSavings = cartTotals.totalSavings;
  const freeShippingThreshold = info?.freeShippingMinOrder || 500;
  const isFreeShippingQualified = Boolean(info?.freeShippingEnabled && subtotal >= freeShippingThreshold);
  const baseDeliveryFee = deliveryFeeProp ?? info?.deliveryFee ?? 0;
  const deliveryFee = isFreeShippingQualified ? 0 : baseDeliveryFee;
  const minOrder = minOrderProp ?? info?.minOrder ?? 0;
  const total = subtotal + deliveryFee;
  const isMinOrderMet = minOrder <= 0 || subtotal >= minOrder;

  if (!isOpen) return null;

  const drawerContent = (
    <div
      className="storefront-cart-drawer-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'flex-start',
        background: 'rgba(15, 23, 42, 0.38)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation: 'sfAppleBackdropIn 0.16s cubic-bezier(0.22, 1, 0.36, 1) forwards',
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
      <div
        dir={dir}
        className="storefront-cart-drawer-shell"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '410px',
          height: '100%',
          background: '#ffffff',
          pointerEvents: 'auto',
          boxShadow: '-20px 0 50px rgba(15, 23, 42, 0.16)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          cursor: 'default',
          animation: 'sfAppleSlideInRight 0.2s cubic-bezier(0.22, 1, 0.36, 1) forwards',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          textRendering: 'optimizeLegibility',
        }}
      >
        {/* Minimalist Centered Top Bar */}
        <div
          style={{
            padding: '20px 22px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            title={isEn ? 'Close' : 'إغلاق'}
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#0f172a',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
              transition: 'all 0.16s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#f8fafc')}
          >
            <XIcon size={16} />
          </button>

          <h2 style={{ margin: 0, fontSize: '16.5px', fontWeight: 600, color: '#0f172a', letterSpacing: '0px' }}>
            {isEn ? 'Shopping Cart' : 'سلة المشتريات'}
          </h2>

          {cartItems.length > 0 ? (
            <button
              type="button"
              onClick={onClearCart}
              title={isEn ? 'Clear all' : 'مسح الكل'}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: '#f8fafc',
                border: '1px solid #f1f5f9',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#ef4444';
                e.currentTarget.style.background = '#fef2f2';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#64748b';
                e.currentTarget.style.background = '#f8fafc';
              }}
            >
              <Trash2Icon size={15} />
            </button>
          ) : (
            <div style={{ width: '36px', height: '36px' }} />
          )}
        </div>

        {/* Drawer Body: Un-boxed Minimalist Items List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 22px',
            display: 'flex',
            flexDirection: 'column',
            letterSpacing: '0px',
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
              <p style={{ margin: '6px 0 20px', fontSize: '13px', color: '#64748b', maxWidth: '240px', fontWeight: 400 }}>
                {t('storefront.storefront_cart_drawer.s3', 'تصفح المنتجات وأضف ما ترغب لطلبك الآن')}
              </p>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 24px',
                  borderRadius: '12px',
                  background: 'var(--storefront-primary-color, #588cb3)',
                  color: '#ffffff',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(88, 140, 179, 0.25)',
                }}
              >
                {t('storefront.storefront_cart_drawer.browse_products', 'تصفح المنتجات')}
              </button>
            </div>
          ) : (
            cartItems.map((item) => {
              const photo = item.product.imageUrl || resolveProductPhoto(item.product.name, item.product.categoryName)?.url;
              const linePricing = calculateCartLinePricing(item.product, item.quantity, storeCurrency);

              return (
                <div
                  key={item.product.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 2px',
                    borderBottom: '1px solid #f1f5f9',
                    position: 'relative',
                    letterSpacing: '0px',
                  }}
                >
                  {/* Product Image */}
                  <div
                    style={{
                      width: '62px',
                      height: '62px',
                      borderRadius: '14px',
                      background: '#f8fafc',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      flexShrink: 0,
                      padding: '5px',
                      boxSizing: 'border-box',
                    }}
                  >
                    {photo ? (
                      <img
                        src={photo}
                        alt={item.product.name}
                        style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '10px' }}
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                    ) : (
                      <ProductIcon name={item.product.icon || 'box-package'} size={24} color="#0f172a" />
                    )}
                  </div>

                  {/* Middle Details: Full width title on top, Price + Stepper on bottom row */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <h4
                      style={{
                        margin: 0,
                        fontSize: '13.5px',
                        fontWeight: 500,
                        color: '#0f172a',
                        lineHeight: 1.35,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        letterSpacing: '0px',
                      }}
                    >
                      {item.product.name}
                    </h4>

                    <div style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 400, letterSpacing: '0px' }}>
                      {item.product.categoryName || 'منتج أصلي'}
                    </div>

                    {/* Bottom Row: Circular Stepper on Right + Price on Left */}
                    <div
                      style={{
                        marginTop: '4px',
                        display: 'flex',
                        flexDirection: 'row-reverse',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', textAlign: 'left', gap: '6px', flexWrap: 'wrap', letterSpacing: '0px' }}>
                        {linePricing.savings > 0 && (
                          <span style={{ textDecoration: 'line-through', color: '#cbd5e1', fontSize: '11.5px', fontWeight: 400, letterSpacing: '0px' }}>
                            {formatPriceNumber(linePricing.originalLineTotal)} {activeCurrencySymbol}
                          </span>
                        )}
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', letterSpacing: '0px' }}>
                          {formatPriceNumber(linePricing.lineTotal)} {activeCurrencySymbol}
                        </span>
                        {linePricing.isBogoApplied && (
                          <span
                            style={{
                              fontSize: '10px',
                              background: '#dcfce7',
                              color: '#166534',
                              padding: '1px 6px',
                              borderRadius: '6px',
                              fontWeight: 500,
                              letterSpacing: '0px',
                            }}
                          >
                            {linePricing.offerBadge}
                          </span>
                        )}
                      </div>

                      {/* Circular Quantity Stepper Controls (Left in RTL) */}
                      {/* CRITICAL: Follow RULE[AGENTS_md] Section 5 for RTL: [+] on Right, Quantity in Center, [-] on Left */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '7px',
                          flexShrink: 0,
                        }}
                      >
                        {/* [+] Filled Dark Squircle on RIGHT in RTL */}
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}
                          title={t('storefront.storefront_cart_drawer.s4', 'زيادة الكمية')}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            border: 'none',
                            background: '#0f172a',
                            color: '#ffffff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '14px',
                            fontWeight: 600,
                            padding: 0,
                            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)',
                          }}
                        >
                          +
                        </button>

                        {/* Quantity in CENTER */}
                        <span
                          style={{
                            minWidth: '18px',
                            textAlign: 'center',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#0f172a',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {item.quantity}
                        </span>

                        {/* [-] Outlined Squircle on LEFT in RTL */}
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
                          title={t('storefront.storefront_cart_drawer.s5', 'تقليل الكمية')}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            border: item.quantity === 1 ? '1px solid #fecaca' : '1px solid #cbd5e1',
                            background: item.quantity === 1 ? '#fef2f2' : '#ffffff',
                            color: item.quantity === 1 ? '#ef4444' : '#0f172a',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '14px',
                            fontWeight: 600,
                            padding: 0,
                            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                          }}
                        >
                          {item.quantity === 1 ? <Trash2Icon size={12.5} /> : '−'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Clean Un-boxed Footer Breakdown & Standard Rounded CTA */}
        {cartItems.length > 0 && (
          <div
            style={{
              padding: '16px 22px 22px',
              borderTop: '1px solid #f1f5f9',
              background: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
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
                  {t('storefront.storefront_cart_drawer.subtotal_label', 'قيمة الأصناف')}
                </span>
                <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>
                  {formatPriceNumber(totalSavings > 0 ? originalSubtotal : subtotal)} {activeCurrencySymbol}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#475569', fontWeight: 500, fontSize: '13.5px' }}>
                  {t('storefront.storefront_cart_drawer.delivery_fee_label', 'مصاريف التوصيل')}
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  {deliveryFee === 0 && (deliveryFeeProp ?? info?.deliveryFee ?? 0) > 0 && (
                    <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: '12px', fontWeight: 400 }}>
                      {formatPriceNumber(deliveryFeeProp ?? info?.deliveryFee ?? 0)} {activeCurrencySymbol}
                    </span>
                  )}
                  <span style={{ fontWeight: 600, color: deliveryFee > 0 ? '#0f172a' : '#16a34a', fontSize: '13.5px' }}>
                    {deliveryFee > 0 ? `${formatPriceNumber(deliveryFee)} ${activeCurrencySymbol}` : 'مجاني'}
                  </span>
                </div>
              </div>

              {totalSavings > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#475569', fontWeight: 500, fontSize: '13.5px' }}>
                    {t('storefront.storefront_cart_drawer.discount_label', 'الخصم')}
                  </span>
                  <span style={{ fontWeight: 600, color: '#dc2626', fontSize: '14px' }}>
                    - {formatPriceNumber(totalSavings)} {activeCurrencySymbol}
                  </span>
                </div>
              )}

              <div style={{ height: '1px', background: '#e2e8f0', margin: '2px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                  {t('storefront.storefront_cart_drawer.s12', 'المبلغ الإجمالي')}
                </span>
                <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--storefront-primary-color, #2d68c4)' }}>
                  {formatPriceNumber(total)} {activeCurrencySymbol}
                </span>
              </div>
            </div>

            {!isMinOrderMet && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  fontSize: '11.5px',
                  color: '#991b1b',
                  textAlign: 'center',
                  fontWeight: 500,
                  letterSpacing: '0px',
                }}
              >
                {t('storefront.storefront_cart_drawer.s6', 'الحد الأدنى للطلب هو')} {minOrder} {activeCurrencySymbol} (
                {t('storefront.storefront_cart_drawer.s7', 'متبقي')} {formatPriceNumber(minOrder - subtotal)} {activeCurrencySymbol})
              </div>
            )}

            {/* Primary Checkout CTA Button with standard site border-radius (12px) */}
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
                fontSize: '15px',
                fontWeight: 600,
                letterSpacing: '0px',
                border: 'none',
                cursor: isMinOrderMet ? 'pointer' : 'not-allowed',
                boxShadow: isMinOrderMet ? '0 4px 14px rgba(45, 104, 196, 0.25)' : 'none',
                transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <span>{t('storefront.storefront_cart_drawer.checkout_now', 'إتمام الطلب')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(drawerContent, document.body);
}


