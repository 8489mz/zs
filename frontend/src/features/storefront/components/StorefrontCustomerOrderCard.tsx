import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { useStorefrontLang } from '@/i18n';
import { useMemo } from 'react';
import { isThreeDecimalCurrency, getGlobalSystemCurrency } from '@/lib/currencies';
import { OnlineOrderRecord, StorefrontInfo, StorefrontProduct } from '../types/storefront.types';
import { CheckIcon, PackageIcon } from '@/shared/components/icons/AppIcons';
import { resolveProductPhoto, generatePremiumProductSvg } from '../lib/storefront-photo-matcher';
import { translateKnownPhrase } from '../lib/storefront-translations';

interface StorefrontCustomerOrderCardProps {
  order: OnlineOrderRecord;
  info: StorefrontInfo;
  onEditOrder: (order: OnlineOrderRecord) => void;
  onReorder?: (order: OnlineOrderRecord) => void;
  onCancelOrder: (order: OnlineOrderRecord) => void;
  isCancelling?: boolean;
  allProducts?: StorefrontProduct[];
  defaultExpanded?: boolean;
}

const TRACKING_STEPS = [
  { id: 'pending', labelAr: 'تم الطلب', labelEn: 'Order Placed' },
  { id: 'processing', labelAr: 'تم التجهيز', labelEn: 'Prepared' },
  { id: 'shipped', labelAr: 'في الطريق', labelEn: 'On the Way' },
  { id: 'delivered', labelAr: 'تم التسليم', labelEn: 'Delivered' },
];

function getStepIndex(status: string): number {
  switch (status) {
    case 'pending':
      return 0;
    case 'confirmed':
    case 'processing':
      return 1;
    case 'shipped':
      return 2;
    case 'delivered':
      return 3;
    default:
      return 0;
  }
}

function getStatusBadge(status: string, isEn = false) {
  switch (status) {
    case 'pending':
      return { label: isEn ? 'New Order' : 'طلب جديد', bg: '#ecfdf5', text: '#059669' };
    case 'confirmed':
    case 'processing':
      return { label: isEn ? 'Processing' : 'قيد التجهيز', bg: '#eff6ff', text: '#2563eb' };
    case 'shipped':
      return { label: isEn ? 'Order In Transit' : 'جاري التوصيل', bg: '#ecfdf5', text: '#059669' };
    case 'delivered':
      return { label: isEn ? 'Delivered' : 'تم التسليم', bg: '#ecfdf5', text: '#059669' };
    case 'cancelled':
      return { label: isEn ? 'Cancelled' : 'ملغي', bg: '#fef2f2', text: '#ef4444' };
    default:
      return { label: status, bg: '#f1f5f9', text: '#64748b' };
  }
}

export function StorefrontCustomerOrderCard({
  order,
  info,
  onEditOrder,
  onReorder,
  onCancelOrder,
  isCancelling = false,
  allProducts = [],
}: StorefrontCustomerOrderCardProps) {
  const { isEn, lang } = useStorefrontLang();

  const badge = getStatusBadge(order.status, isEn);
  const isPending = order.status === 'pending' && !order.saleId;
  const currentStepIndex = getStepIndex(order.status);
  const brandColor = info?.brandColor || '#2563eb';

  const currCode = order.currency || info.currency || getGlobalSystemCurrency();
  const isThreeDec = isThreeDecimalCurrency(currCode);
  const formatPriceNumber = (val: number | string | undefined | null): string => {
    const num = Number(val || 0);
    if (isThreeDec) return num.toFixed(3);
    if (currCode === 'EGP') return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    return num.toFixed(2);
  };

  const createdDate = useMemo(() => {
    const d = new Date(order.createdAt);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [order.createdAt]);

  const formattedOrderDate = createdDate.toLocaleDateString(isEn ? 'en-US' : 'ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const formattedOrderTime = createdDate.toLocaleTimeString(isEn ? 'en-US' : 'ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const stepTimestamps = useMemo(() => {
    const baseMs = createdDate.getTime();
    return [0, 15, 45, 120].map((offsetMinutes, idx) => {
      if (idx > currentStepIndex) return isEn ? 'Pending...' : 'قيد الانتظار...';
      const stepDate = new Date(baseMs + offsetMinutes * 60 * 1000);
      return stepDate.toLocaleTimeString(isEn ? 'en-US' : 'ar-EG', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    });
  }, [createdDate, currentStepIndex, isEn]);

  const productLookup = useMemo(() => {
    const byId = new Map<number, StorefrontProduct>();
    const byName = new Map<string, StorefrontProduct>();
    for (const p of allProducts) {
      if (p?.id) byId.set(Number(p.id), p);
      if (p?.name) byName.set(p.name.trim().toLowerCase(), p);
    }
    return { byId, byName };
  }, [allProducts]);

  const getProductImageForItem = (productId: number, name: string): string => {
    const byIdMatch = productLookup.byId.get(Number(productId));
    if (byIdMatch?.imageUrl) return byIdMatch.imageUrl;
    const byNameMatch = productLookup.byName.get((name || '').trim().toLowerCase());
    if (byNameMatch?.imageUrl) return byNameMatch.imageUrl;
    const categoryHint = byIdMatch?.categoryName || byNameMatch?.categoryName || '';
    const autoPhoto = resolveProductPhoto(name || '', categoryHint);
    return autoPhoto.url || generatePremiumProductSvg(name || (isEn ? 'Product' : 'منتج'), categoryHint);
  };

  const getLocalizedItemName = (productId: number, fallbackName: string): string => {
    const byIdMatch = productLookup.byId.get(Number(productId));
    if (byIdMatch?.name) return byIdMatch.name;
    return isEn ? translateKnownPhrase(fallbackName, lang) : fallbackName;
  };

  const isPaid = order.paymentStatus === 'paid';
  const paymentMethodLabel =
    order.paymentMethod === 'online' || order.paymentMethod === 'card'
      ? (isEn ? 'Bank Card' : 'بطاقة بنكية')
      : (isEn ? 'Cash on Delivery' : 'عند الاستلام');

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '16px',
        padding: '18px',
        border: '1px solid #f1f5f9',
        boxShadow: '0 2px 10px rgba(15, 23, 42, 0.025)',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
      }}
    >
      {/* 1. Balanced Order Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0 }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '11px',
              background: '#f8fafc',
              border: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <PackageIcon size={19} color="#0d9488" strokeWidth={1.8} />
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              dir="ltr"
              style={{
                fontSize: '15px',
                fontWeight: 600,
                color: '#0f172a',
                textAlign: isEn ? 'left' : 'right',
                lineHeight: 1.25,
              }}
            >
              Order #{order.orderNumber}
            </div>

            <div
              style={{
                fontSize: '12px',
                fontWeight: 400,
                color: '#94a3b8',
                marginTop: '3px',
                whiteSpace: 'nowrap',
              }}
            >
              {formattedOrderDate} • {formattedOrderTime}
            </div>
          </div>
        </div>

        {/* Status Badge & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: '8px',
              background: badge.bg,
              color: badge.text,
              border: `1px solid ${badge.text}25`,
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
            }}
          >
            {badge.label}
          </span>

          {isPending && (
            <>
              <button
                type="button"
                onClick={() => onEditOrder(order)}
                style={{
                  height: '28px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  color: '#334155',
                  fontSize: '11.5px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {isEn ? 'Edit' : 'تعديل'}
              </button>
              <button
                type="button"
                onClick={() => onCancelOrder(order)}
                disabled={isCancelling}
                style={{
                  height: '28px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  background: '#fef2f2',
                  border: 'none',
                  color: '#ef4444',
                  fontSize: '11.5px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {isEn ? 'Cancel' : 'إلغاء'}
              </button>
            </>
          )}

          {!isPending && onReorder && (
            <button
              type="button"
              onClick={() => onReorder(order)}
              style={{
                height: '28px',
                padding: '0 10px',
                borderRadius: '8px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                color: '#0f172a',
                fontSize: '11.5px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {isEn ? 'Reorder' : 'إعادة الطلب'}
            </button>
          )}
        </div>
      </div>

      {/* 2. Clean Horizontal 4-Step Progress Bar */}
      {order.status !== 'cancelled' && (
        <div
          style={{
            background: '#f9fafb',
            borderRadius: '12px',
            padding: '16px 10px 14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              position: 'relative',
            }}
          >
            {/* Thin Connecting Line precisely between first and last circle centers */}
            <div
              style={{
                position: 'absolute',
                top: '10px',
                left: '12.5%',
                right: '12.5%',
                height: '1.5px',
                background: '#e2e8f0',
                zIndex: 1,
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: '#10b981',
                  width: `${(currentStepIndex / (TRACKING_STEPS.length - 1)) * 100}%`,
                  transition: 'width 0.35s ease',
                }}
              />
            </div>

            {TRACKING_STEPS.map((step, idx) => {
              const isCompleted = idx <= currentStepIndex;
              return (
                <div
                  key={step.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    flex: 1,
                    position: 'relative',
                    zIndex: 2,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: isCompleted ? '#10b981' : '#ffffff',
                      border: isCompleted ? '1.5px solid #10b981' : '1.5px solid #cbd5e1',
                      boxShadow: '0 0 0 4px #f9fafb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '8px',
                    }}
                  >
                    {isCompleted && <CheckIcon size={11} strokeWidth={2.5} color="#ffffff" />}
                  </div>

                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: isCompleted ? 500 : 400,
                      color: isCompleted ? '#1e293b' : '#94a3b8',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isEn ? step.labelEn : step.labelAr}
                  </span>

                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 400,
                      color: '#94a3b8',
                      marginTop: '2px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {stepTimestamps[idx]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Properly Proportioned 3-Column Info Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr',
          gap: '20px',
          padding: '2px 2px 14px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 400, marginBottom: '4px', whiteSpace: 'nowrap' }}>
            {isEn ? 'Order Date' : 'تاريخ الطلب'}
          </div>
          <div style={{ fontSize: '12.5px', color: '#1e293b', fontWeight: 500, whiteSpace: 'nowrap' }}>
            {formattedOrderDate}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 400, marginBottom: '4px', whiteSpace: 'nowrap' }}>
            {isEn ? 'Courier / Zone' : 'شركة الشحن'}
          </div>
          <div
            style={{
              fontSize: '12.5px',
              color: '#1e293b',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {order.deliveryZoneName
              ? (isEn ? translateKnownPhrase(order.deliveryZoneName, lang) : order.deliveryZoneName)
              : (isEn ? 'Express Delivery' : 'توصيل سريع')}
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 400, marginBottom: '4px', whiteSpace: 'nowrap' }}>
            {isEn ? 'Address' : 'العنوان'}
          </div>
          <div
            title={order.customerAddress || (isEn ? 'Store Pickup' : 'استلام من الفرع')}
            style={{
              fontSize: '12.5px',
              color: '#1e293b',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {order.customerAddress || (isEn ? 'Store Pickup' : 'استلام من الفرع')}
          </div>
        </div>
      </div>

      {/* 4. Clean Borderless Product Items List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {order.items.map((it, idx) => {
          const thumbUrl = getProductImageForItem(it.productId, it.name);
          const displayName = getLocalizedItemName(it.productId, it.name);
          return (
            <div
              key={`${it.productId}-${idx}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '12px',
                  background: '#f8fafc',
                  border: '1px solid #f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flexShrink: 0,
                  padding: '6px',
                  boxSizing: 'border-box',
                }}
              >
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt={displayName}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.src = generatePremiumProductSvg(displayName || (isEn ? 'Product' : 'منتج'), '');
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      mixBlendMode: 'multiply',
                    }}
                  />
                ) : (
                  <PackageIcon size={20} color="#94a3b8" />
                )}
              </div>

              <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div
                  style={{
                    fontSize: '13.5px',
                    fontWeight: 500,
                    color: '#1e293b',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.3,
                  }}
                >
                  {displayName}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13.5px',
                      fontWeight: 600,
                      color: brandColor,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <span>{formatPriceNumber(it.total)}</span>
                    <CurrencySymbol currency={currCode} />
                  </div>

                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 400,
                      color: '#94a3b8',
                      flexShrink: 0,
                    }}
                  >
                    {isEn ? `Qty: ${it.quantity}` : `الكمية : ${it.quantity}`}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 5. Soft Order Summary Card */}
      <div
        style={{
          background: '#f9fafb',
          borderRadius: '12px',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            color: '#64748b',
            fontWeight: 400,
          }}
        >
          <span>{isEn ? 'Subtotal' : 'المجموع الفرعي'}</span>
          <span style={{ color: '#1e293b', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <span>{formatPriceNumber(order.subtotal)}</span>
            <CurrencySymbol currency={currCode} />
          </span>
        </div>

        {(order.discountAmount ?? 0) > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '13px',
              color: '#64748b',
              fontWeight: 400,
            }}
          >
            <span>{isEn ? 'Discount' : 'الخصم'}</span>
            <span style={{ color: '#10b981', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <span>-{formatPriceNumber(order.discountAmount)}</span>
              <CurrencySymbol currency={currCode} />
            </span>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            color: '#64748b',
            fontWeight: 400,
          }}
        >
          <span>{isEn ? 'Shipping' : 'الشحن'}</span>
          <span style={{ color: '#1e293b', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            {order.deliveryFee === 0 ? (
              <span>{isEn ? 'Free' : 'مجاناً'}</span>
            ) : (
              <>
                <span>{formatPriceNumber(order.deliveryFee)}</span>
                <CurrencySymbol currency={currCode} />
              </>
            )}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            color: '#64748b',
            fontWeight: 400,
          }}
        >
          <span>{isEn ? 'Payment Method' : 'طريقة الدفع'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#1e293b', fontWeight: 500 }}>{paymentMethodLabel}</span>
            {isPaid && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: '#22c55e',
                  color: '#ffffff',
                  boxShadow: '0 1px 2px rgba(34, 197, 94, 0.25)',
                }}
              >
                {isEn ? 'Paid' : 'مدفوع'}
              </span>
            )}
          </div>
        </div>

        <div style={{ height: '1px', background: '#e2e8f0', margin: '2px 0' }} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '14px',
            color: '#64748b',
            fontWeight: 500,
          }}
        >
          <span>{isEn ? 'Total' : 'الإجمالي'}</span>
          <span
            style={{
              fontSize: '15.5px',
              fontWeight: 600,
              color: '#0f172a',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <span>{formatPriceNumber(order.totalAmount)}</span>
            <CurrencySymbol currency={currCode} />
          </span>
        </div>
      </div>
    </div>
  );
}

