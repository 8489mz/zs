import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';
import { useState } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { DialogShell } from '@/shared/components/dialog-shell';
import { CreateOnlineOrderResponse } from '../types/storefront.types';
import { isThreeDecimalCurrency, getGlobalSystemCurrency } from '@/lib/currencies';
import {
  PackageIcon,
  ReceiptIcon,
  CopyIcon,
  CheckIcon,
  CheckShieldIcon,
} from '@/shared/components/icons/AppIcons';
import { IconShoppingCart } from './StorefrontIcons';

interface StorefrontSuccessModalProps {
  order?: CreateOnlineOrderResponse | null;
  orderData?: CreateOnlineOrderResponse | null;
  isOpen?: boolean;
  whatsappPhone?: string;
  onClose: () => void;
  onTrackOrder?: () => void;
}

export function StorefrontSuccessModal({
  order,
  orderData,
  isOpen = true,
  whatsappPhone,
  onClose,
  onTrackOrder,
}: StorefrontSuccessModalProps) {
  const { t } = useTranslation();
  const { isEn, dir } = useStorefrontLang();
  const activeOrder = order || orderData;
  const [linkCopied, setLinkCopied] = useState(false);
  const [orderNumCopied, setOrderNumCopied] = useState(false);

  const currCode = getGlobalSystemCurrency();
  const isThreeDec = isThreeDecimalCurrency(currCode);

  const formatPriceNumber = (val: number | string | undefined | null): string => {
    const num = Number(val || 0);
    if (isThreeDec) return num.toFixed(3);
    if (currCode === 'EGP') return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    return num.toFixed(2);
  };

  if (!activeOrder || !isOpen) return null;

  const trackingUrl = activeOrder.trackingUrl || '';

  const copyTrackingLink = async () => {
    if (!trackingUrl) return;
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {}
  };

  const copyOrderNumber = async () => {
    try {
      await navigator.clipboard.writeText(activeOrder.orderNumber);
      setOrderNumCopied(true);
      setTimeout(() => setOrderNumCopied(false), 2000);
    } catch {}
  };

  const resolvedWhatsappUrl =
    activeOrder.whatsappUrl ||
    (whatsappPhone
      ? `https://wa.me/${whatsappPhone.replace(/\D/g, '')}?text=${encodeURIComponent(
          isEn
            ? `Hello, I would like to inquire about my order #${activeOrder.orderNumber}`
            : `مرحباً، أود الاستفسار عن طلبي رقم #${activeOrder.orderNumber}`
        )}`
      : '');

  return (
    <DialogShell
      open={isOpen}
      onClose={onClose}
      width="min(480px, calc(100vw - 24px))"
      maxHeight="min(90vh, 760px)"
      ariaLabel={t('storefront.storefront_success_modal.s0', "تم استلام الطلب بنجاح")}
    >
      <div
        className="full-bleed"
        dir={dir}
        style={{
          padding: '16px 18px 14px',
          textAlign: 'center',
          direction: dir,
          boxSizing: 'border-box',
          background: '#ffffff',
          fontFamily: 'inherit',
        }}
      >
        {/* Compact Header: Title + Check Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            marginBottom: '6px',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '16.5px',
              fontWeight: 900,
              color: '#0f172a',
              lineHeight: 1.25,
            }}
          >
            {activeOrder.tableNumber ? t('storefront.storefront_success_modal.s1', "تم إرسال طلب الطاولة للمطبخ بنجاح") : t('storefront.storefront_success_modal.s2', "تم استلام طلبك بنجاح")}
          </h2>
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#dcfce7',
              color: '#16a34a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 2px 6px rgba(22, 163, 74, 0.18)',
            }}
          >
            <CheckIcon size={15} strokeWidth={2.8} />
          </div>
        </div>

        {/* Order Number Badge with Quick Copy */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 10px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            margin: '0 auto 10px',
            fontSize: '11.5px',
            fontWeight: 700,
            color: '#475569',
          }}
        >
          {activeOrder.tableNumber ? (
            <span>
              {t('storefront.storefront_success_modal.s3', "طاولة رقم")}{' '}
              <strong style={{ color: 'var(--storefront-primary-color, #170e5e)', fontWeight: 800 }}>
                {activeOrder.tableNumber}
              </strong>{' '}
              {t('storefront.storefront_success_modal.s4', "• رقم الطلب:")}
            </span>
          ) : (
            <span>{t('storefront.storefront_success_modal.s5', "رقم الطلب:")}</span>
          )}
          <span
            style={{
              fontFamily: 'monospace',
              fontWeight: 800,
              color: 'var(--storefront-primary-color, #170e5e)',
              fontSize: '12px',
              direction: 'ltr',
            }}
          >
            #{activeOrder.orderNumber}
          </span>
          <button
            type="button"
            onClick={copyOrderNumber}
            title={orderNumCopied ? t('storefront.storefront_success_modal.s6', "تم نسخ الرقم") : t('storefront.storefront_success_modal.s7', "نسخ رقم الطلب")}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: orderNumCopied ? '#16a34a' : '#94a3b8',
              marginInlineStart: '2px',
            }}
          >
            {orderNumCopied ? <CheckIcon size={12} strokeWidth={2.5} /> : <CopyIcon size={12} strokeWidth={2} />}
          </button>
        </div>

        {/* Order Details / Receipt Card */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '13px',
            padding: '10px 12px',
            textAlign: isEn ? 'left' : 'right',
            marginBottom: '10px',
            boxSizing: 'border-box',
          }}
        >
          {/* Receipt Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: '6px',
              borderBottom: '1px solid #e2e8f0',
              marginBottom: '6px',
            }}
          >
            <div
              style={{
                fontSize: '11.5px',
                fontWeight: 800,
                color: '#334155',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <ReceiptIcon size={13} color="#64748b" strokeWidth={2.2} />
              <span>{t('storefront.storefront_success_modal.s8', "ملخص الفاتورة")}</span>
            </div>
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                color: '#64748b',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                padding: '1px 6px',
                borderRadius: '4px',
              }}
            >
              {activeOrder.items.length} {activeOrder.items.length === 1 ? t('storefront.storefront_success_modal.s9', "صنف") : activeOrder.items.length <= 10 ? t('storefront.storefront_success_modal.s10', "أصناف") : t('storefront.storefront_success_modal.s11', "صنف")}
            </span>
          </div>

          {/* Items List (Expands dynamically to fit up to 90vh, scrolls for large orders) */}
          <div
            className="thin-scrollbar"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              maxHeight: 'min(460px, calc(90vh - 310px))',
              overflowY: 'auto',
              paddingInlineEnd: '2px',
            }}
          >
            {activeOrder.items.map((i, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '12px',
                  color: '#1e293b',
                  gap: '8px',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'start',
                  }}
                  title={i.name}
                >
                  {i.name}{' '}
                  <span style={{ color: '#64748b', fontWeight: 700, fontSize: '11px' }}>
                    (×{i.quantity})
                  </span>
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                    color: '#0f172a',
                  }}
                >
                  <span>{formatPriceNumber(i.total)}</span>
                  <CurrencySymbol />
                </span>
              </div>
            ))}
          </div>

          {/* Fulfillment & Delivery Metadata */}
          <div
            style={{
              marginTop: '6px',
              paddingTop: '6px',
              borderTop: '1px solid #edf2f7',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
              fontSize: '11px',
            }}
          >
            {activeOrder.tableNumber ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--storefront-primary-color, #170e5e)' }}>
                <span>{t('storefront.storefront_success_modal.s12', "نوع الطلب:")}</span>
                <span style={{ fontWeight: 700 }}>{t('storefront.storefront_success_modal.s13', "صالة (طاولة رقم")} {activeOrder.tableNumber})</span>
              </div>
            ) : activeOrder.orderType === 'pickup' ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--storefront-primary-color, #170e5e)' }}>
                <span>{t('storefront.storefront_success_modal.s14', "نوع الطلب:")}</span>
                <span style={{ fontWeight: 700 }}>{t('storefront.storefront_success_modal.s15', "استلام من الفرع")}</span>
              </div>
            ) : activeOrder.deliveryFee === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a' }}>
                <span>{t('storefront.storefront_success_modal.s16', "خدمة التوصيل")} {activeOrder.deliveryZoneName ? `(${activeOrder.deliveryZoneName})` : ''}:</span>
                <span style={{ fontWeight: 800 }}>{t('storefront.storefront_success_modal.s17', "مجاناً")}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                <span>{t('storefront.storefront_success_modal.s18', "خدمة التوصيل")} {activeOrder.deliveryZoneName ? `(${activeOrder.deliveryZoneName})` : ''}:</span>
                <span style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                  <span>{formatPriceNumber(activeOrder.deliveryFee)}</span>
                  <CurrencySymbol />
                </span>
              </div>
            )}

            {(activeOrder.discountAmount ?? 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a' }}>
                <span>{t('storefront.storefront_success_modal.s19', "خصم الكوبون")} {activeOrder.couponCode ? `(${activeOrder.couponCode})` : ''}:</span>
                <span style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                  <span>-{formatPriceNumber(activeOrder.discountAmount ?? 0)}</span>
                  <CurrencySymbol />
                </span>
              </div>
            )}
          </div>

          {/* Total Payable */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: '6px',
              marginTop: '5px',
              borderTop: '1.5px dashed #cbd5e1',
              fontWeight: 800,
              color: '#0f172a',
            }}
          >
            <span style={{ fontSize: '12.5px' }}>{t('storefront.storefront_success_modal.s20', "المطلوب دفعه:")}</span>
            <span
              style={{
                fontSize: '15.5px',
                fontWeight: 900,
                color: 'var(--storefront-primary-color, #170e5e)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              <span>{formatPriceNumber(activeOrder.totalAmount)}</span>
              <CurrencySymbol />
            </span>
          </div>

          {/* Paid Online Confirmation Badge */}
          {(activeOrder as any).paymentStatus === 'paid' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                padding: '5px 8px',
                background: '#ecfdf5',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                color: '#15803d',
                fontSize: '11px',
                fontWeight: 800,
                marginTop: '6px',
              }}
            >
              <CheckShieldIcon size={13} color="#16a34a" />
              <span>{t('storefront.storefront_success_modal.s21', "تم الدفع إلكترونياً بنجاح بالبطاقة البنكية")}</span>
            </div>
          )}
        </div>

        {/* Primary Action: Track in My Orders */}
        {onTrackOrder && (
          <button
            type="button"
            onClick={onTrackOrder}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              height: '38px',
              borderRadius: '11px',
              background: 'var(--storefront-primary-color, #170e5e)',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 800,
              border: 'none',
              cursor: 'pointer',
              marginBottom: '6px',
              boxShadow: '0 3px 10px rgba(23, 14, 94, 0.18)',
              transition: 'opacity 0.15s ease',
              fontFamily: 'inherit',
            }}
          >
            <PackageIcon size={15} strokeWidth={2.2} color="#ffffff" />
            <span>{t('storefront.storefront_success_modal.s22', "تتبع حالة الطلب في (طلباتي)")}</span>
          </button>
        )}

        {/* Secondary Actions: 2-Column Row (WhatsApp & Copy Link) */}
        {(Boolean(resolvedWhatsappUrl) || Boolean(trackingUrl)) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '6px',
              width: '100%',
            }}
          >
            {resolvedWhatsappUrl && (
              <a
                href={resolvedWhatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  height: '36px',
                  borderRadius: '10px',
                  background: '#25D366',
                  color: '#ffffff',
                  fontSize: '11.5px',
                  fontWeight: 800,
                  textDecoration: 'none',
                  boxShadow: '0 2px 6px rgba(37, 211, 102, 0.2)',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                <svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.181-.076.355.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.173.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.145.39-.087s1.011.477 1.184.564.289.13.332.202c.043.072.043.419-.101.824z" />
                </svg>
                <span>{t('storefront.storefront_success_modal.s23', "واتساب المتجر")}</span>
              </a>
            )}

            {trackingUrl && (
              <button
                type="button"
                onClick={copyTrackingLink}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  height: '36px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: linkCopied ? '#f0fdf4' : '#ffffff',
                  borderColor: linkCopied ? '#86efac' : '#cbd5e1',
                  color: linkCopied ? '#15803d' : '#334155',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {linkCopied ? (
                  <>
                    <CheckIcon size={14} color="#16a34a" strokeWidth={2.4} style={{ flexShrink: 0 }} />
                    <span>{t('storefront.storefront_success_modal.s24', "تم نسخ الرابط")}</span>
                  </>
                ) : (
                  <>
                    <CopyIcon size={13} color="#64748b" strokeWidth={2} style={{ flexShrink: 0 }} />
                    <span>{t('storefront.storefront_success_modal.s25', "نسخ رابط التتبع")}</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Small Helper Micro-copy */}
        {trackingUrl && (
          <div
            style={{
              fontSize: '10.5px',
              color: '#64748b',
              fontWeight: 500,
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <span>{t('storefront.storefront_success_modal.s26', "احفظ الرابط لمتابعة طلبك من أي جهاز في أي وقت")}</span>
            <span>•</span>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`رابط متابعة طلبي #${activeOrder.orderNumber}: ${trackingUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#16a34a',
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              {t('storefront.storefront_success_modal.s27', "إرسال لنفسي")}
            </a>
          </div>
        )}

        {/* Continue Shopping Button */}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            height: '35px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            color: '#475569',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            fontFamily: 'inherit',
          }}
        >
          <IconShoppingCart size={14} color="#64748b" strokeWidth={2} />
          <span>{t('storefront.storefront_success_modal.s28', "متابعة التسوق في المتجر")}</span>
        </button>
      </div>
    </DialogShell>
  );
}
