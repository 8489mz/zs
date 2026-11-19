import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { StorefrontInfo } from '../../types/storefront.types';
import { CheckIcon, PackageIcon, TruckIcon } from '@/shared/components/icons/AppIcons';

export interface CheckoutFulfillmentSectionProps {
  fulfillmentType: 'delivery' | 'pickup';
  setFulfillmentType: Dispatch<SetStateAction<'delivery' | 'pickup'>>;
  isDineIn: boolean;
  isPickup: boolean;
  info: StorefrontInfo | undefined;
  brandColor: string;
  canExpress: boolean;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  setExpressMode: Dispatch<SetStateAction<boolean>>;
}

/**
 * Fulfillment toggle (delivery vs pickup) + the express-mode saved-details
 * summary card for the storefront checkout modal. Pure presentational
 * section: all state lives in the facade; the component only receives
 * values + setters as props. `t` is hook-local (useTranslation); the span
 * uses neither `isEn` nor `dir`, so no useStorefrontLang call is needed.
 */
export function CheckoutFulfillmentSection({
  fulfillmentType,
  setFulfillmentType,
  isDineIn,
  isPickup,
  info,
  brandColor,
  canExpress,
  customerName,
  customerPhone,
  customerAddress,
  setExpressMode,
}: CheckoutFulfillmentSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Fulfillment Type Toggle (Delivery vs Pickup) - Hidden for Dine-in */}
      {!isDineIn && info?.pickupEnabled !== false && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '6px',
            width: '100%',
          }}
        >
          <button
            type="button"
            onClick={() => setFulfillmentType('delivery')}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '0 8px',
              height: '36px',
              borderRadius: '8px',
              border: fulfillmentType === 'delivery' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
              background: fulfillmentType === 'delivery' ? 'rgba(23, 14, 94, 0.05)' : '#ffffff',
              color: fulfillmentType === 'delivery' ? brandColor : '#475569',
              fontWeight: 700,
              fontSize: '12.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
              transition: 'all 0.15s ease',
            }}
          >
            <TruckIcon size={14} color={fulfillmentType === 'delivery' ? brandColor : '#64748b'} />
            <span style={{ whiteSpace: 'nowrap' }}>{t('storefront.storefront_checkout_modal.s4', "توصيل للمنزل")}</span>
          </button>
          <button
            type="button"
            onClick={() => setFulfillmentType('pickup')}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '0 8px',
              height: '36px',
              borderRadius: '8px',
              border: fulfillmentType === 'pickup' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
              background: fulfillmentType === 'pickup' ? 'rgba(23, 14, 94, 0.05)' : '#ffffff',
              color: fulfillmentType === 'pickup' ? brandColor : '#475569',
              fontWeight: 700,
              fontSize: '12.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
              transition: 'all 0.15s ease',
            }}
          >
            <PackageIcon size={14} color={fulfillmentType === 'pickup' ? brandColor : '#64748b'} />
            <span style={{ whiteSpace: 'nowrap' }}>{t('storefront.storefront_checkout_modal.s5', "استلام من الفرع")}</span>
            <span style={{ fontSize: '10.5px', fontWeight: 800, background: '#dcfce7', color: '#166534', padding: '1px 3px', borderRadius: '4px', flexShrink: 0 }}>{t('storefront.storefront_checkout_modal.s6', "مجاني")}</span>
          </button>
        </div>
      )}

      {canExpress && (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '10px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>
                {isDineIn ? t('storefront.storefront_checkout_modal.s7', "الطلب باسم") : isPickup ? t('storefront.storefront_checkout_modal.s8', "الاستلام باسم") : t('storefront.storefront_checkout_modal.s9', "بيانات التوصيل")}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  background: '#dcfce7',
                  color: '#15803d',
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '8px',
                }}
              >
                <CheckIcon size={10} color="#15803d" strokeWidth={3} />
                {t('storefront.storefront_checkout_modal.s10', "بيانات محفوظة")}
              </span>
            </div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>{customerName}</div>
            <div style={{ fontSize: '11.5px', color: '#334155', direction: 'ltr', textAlign: 'right', marginTop: '1px', fontWeight: 600 }}>
              {customerPhone}
            </div>
            {!isDineIn && !isPickup && (
              <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '2px', lineHeight: 1.4, wordBreak: 'break-word' }}>
                {customerAddress}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpressMode(false)}
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              color: brandColor,
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
              padding: '4px 8px',
            }}
          >
            {t('storefront.storefront_checkout_modal.s11', "تعديل")}
          </button>
        </div>
      )}
    </>
  );
}
