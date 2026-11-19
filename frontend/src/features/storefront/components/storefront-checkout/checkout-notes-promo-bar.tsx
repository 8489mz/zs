import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { TagIcon } from '@/shared/components/icons/AppIcons';
import type { ValidateCouponResponse } from '../../types/storefront.types';

export interface CheckoutNotesPromoBarProps {
  showNotes: boolean;
  setShowNotes: Dispatch<SetStateAction<boolean>>;
  customerNotes: string;
  setCustomerNotes: Dispatch<SetStateAction<string>>;
  showCouponInput: boolean;
  setShowCouponInput: Dispatch<SetStateAction<boolean>>;
  appliedCoupon: ValidateCouponResponse | null;
  brandColor: string;
}

/**
 * Optional-notes link bar + collapsed notes field for the storefront
 * checkout modal. Pure presentational section: all state lives in the
 * facade; the component only receives values + setters as props. `t` is
 * hook-local (useTranslation); the span uses neither `isEn` nor `dir`,
 * so no useStorefrontLang call is needed.
 */
export function CheckoutNotesPromoBar({
  showNotes,
  setShowNotes,
  customerNotes,
  setCustomerNotes,
  showCouponInput,
  setShowCouponInput,
  appliedCoupon,
  brandColor,
}: CheckoutNotesPromoBarProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Optional Notes & Promo Link Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '1px 2px' }}>
        {!showNotes && !customerNotes.trim() ? (
          <button
            type="button"
            onClick={() => setShowNotes(true)}
            style={{
              background: 'none',
              border: 'none',
              color: brandColor,
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              padding: '2px 0',
              fontFamily: 'inherit',
            }}
          >
            {t('storefront.storefront_checkout_modal.s28', "+ إضافة ملاحظات للطلب (اختياري)")}
          </button>
        ) : (
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('storefront.storefront_checkout_modal.s29', "ملاحظات الطلب")}</span>
        )}

        {!showCouponInput && !appliedCoupon?.ok ? (
          <button
            type="button"
            onClick={() => setShowCouponInput(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#b45309',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              padding: '2px 0',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <TagIcon size={13} color="#b45309" />
            <span>{t('storefront.storefront_checkout_modal.s30', "لديك كوبون خصم؟")}</span>
          </button>
        ) : null}
      </div>

      {/* Collapsed Notes Field (visible when clicked or has content) */}
      {(showNotes || customerNotes.trim()) && (
        <div>
          <textarea
            rows={1}
            autoFocus={showNotes && !customerNotes}
            value={customerNotes}
            onChange={(e) => setCustomerNotes(e.target.value)}
            placeholder={t('storefront.storefront_checkout_modal.s31', "اكتب أي تعليمات لتحضير طلبك أو للتوصيل (اختياري)...")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1.5px solid #cbd5e1',
              outline: 'none',
              background: '#f8fafc',
              fontFamily: 'inherit',
              resize: 'none',
              minHeight: '40px',
              height: '40px',
              boxSizing: 'border-box',
              lineHeight: '1.45',
              fontSize: '12.5px',
            }}
          />
        </div>
      )}
    </>
  );
}
