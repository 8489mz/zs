import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { CheckIcon, TagIcon, TruckIcon } from '@/shared/components/icons/AppIcons';
import type { StorefrontInfo, ValidateCouponResponse } from '../../types/storefront.types';

/**
 * Checkout shipping + promo section (file #42 S9) — pure move of the
 * free-shipping callout (pristine L2052-2109) + the promo box
 * (pristine L2111-2231) from StorefrontCheckoutModal.tsx.
 * Props restore the pristine typing exactly (file #39 lesson): no `any[]`.
 * `t` is hook-local via useTranslation(); the span uses 0x `isEn`/`dir`,
 * so no useStorefrontLang call is needed (same as S3/S6/S7).
 * Prep §4's S9 span label L2052-2232 is off by one: the true span ends at
 * L2231 (`)}` closing the promo box); L2232 is a blank line that stays in
 * the facade per the trailing-blank rule, and L2233 is S10's Order Total
 * Summary comment opener. Prep §4's prop list is over-inclusive
 * (setShowCouponInput has 0 uses in the span — refused, #41 S1 precedent)
 * and under-inclusive: it missed `info` (info?.freeShippingEnabled),
 * `isAutoFreeShipping`, `storeCurrency`, `discountAmount`,
 * `activeCurrencySymbol` and `setCouponError` — all added on AST evidence.
 * The span is two sibling JSX expression blocks (comment + expression,
 * comment + expression), so it is wrapped in <>...</> (the S4/S8 fragment
 * pattern); the span itself is untouched, uniformly dedented -10
 * (min pristine indent 16 -> 6 inside the fragment).
 */
export interface CheckoutShippingPromoSectionProps {
  isDineIn: boolean;
  info?: StorefrontInfo;
  isAutoFreeShipping: boolean;
  formatMoney: (val: number | string | undefined | null) => string;
  freeShippingThreshold: number;
  storeCurrency: string;
  rawDeliveryFee: number;
  freeShippingRemaining: number;
  showCouponInput: boolean;
  appliedCoupon: ValidateCouponResponse | null;
  discountAmount: number;
  activeCurrencySymbol: string;
  handleRemoveCoupon: () => void;
  couponCodeInput: string;
  setCouponCodeInput: Dispatch<SetStateAction<string>>;
  setCouponError: Dispatch<SetStateAction<string>>;
  handleApplyCoupon: () => Promise<void>;
  couponError: string;
  couponLoading: boolean;
  brandColor: string;
  brandColorContrast: string;
}

export function CheckoutShippingPromoSection({
  isDineIn,
  info,
  isAutoFreeShipping,
  formatMoney,
  freeShippingThreshold,
  storeCurrency,
  rawDeliveryFee,
  freeShippingRemaining,
  showCouponInput,
  appliedCoupon,
  discountAmount,
  activeCurrencySymbol,
  handleRemoveCoupon,
  couponCodeInput,
  setCouponCodeInput,
  setCouponError,
  handleApplyCoupon,
  couponError,
  couponLoading,
  brandColor,
  brandColorContrast,
}: CheckoutShippingPromoSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Automatic Free Shipping Callout (Hidden for Dine-In) */}
      {!isDineIn && info?.freeShippingEnabled && (
        <div>
          {isAutoFreeShipping ? (
            <div
              style={{
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: '6px',
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#065f46',
                fontSize: '11.5px',
                fontWeight: 700,
              }}
            >
              <span>
                {t('storefront.storefront_checkout_modal.s45', "مبروك! مشترياتك تجاوزت")} {formatMoney(freeShippingThreshold)} <CurrencySymbol currency={storeCurrency} /> {t('storefront.storefront_checkout_modal.s46', "وحصلت على شحن مجاني")}{rawDeliveryFee > 0 ? <> {t('storefront.storefront_checkout_modal.s47', "(توفير")} {formatMoney(rawDeliveryFee)} <CurrencySymbol currency={storeCurrency} />)</> : ''}.
              </span>
            </div>
          ) : freeShippingRemaining > 0 ? (
            <div
              style={{
                background: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '6px',
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: '#0369a1',
                fontSize: '10.5px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <TruckIcon size={12} color="#0284c7" />
                <span>
                  {t('storefront.storefront_checkout_modal.s48', "أضف بـ")} <strong style={{ color: '#0284c7' }}>{formatMoney(freeShippingRemaining)} <CurrencySymbol currency={storeCurrency} /></strong> {t('storefront.storefront_checkout_modal.s49', "لشحن مجاني!")}
                </span>
              </div>
              <span
                style={{
                  fontSize: '9.5px',
                  background: '#e0f2fe',
                  color: '#0369a1',
                  padding: '1px 5px',
                  borderRadius: '4px',
                  fontWeight: 700,
                }}
              >
                {t('storefront.storefront_checkout_modal.s50', "عرض الشحن")}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {/* Promo Code Input Box (Visible when toggled or applied) */}
      {(showCouponInput || appliedCoupon?.ok) && (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '6px 8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#334155' }}>
              {t('storefront.storefront_checkout_modal.s51', "كود الخصم أو الكوبون:")}
            </label>
            {appliedCoupon?.ok && (
              <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckIcon size={11} color="#16a34a" strokeWidth={2.5} />
                <span>{t('storefront.storefront_checkout_modal.s52', "تم التطبيق")}</span>
              </span>
            )}
          </div>

          {appliedCoupon?.ok ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#ecfdf5',
                border: '1px solid #86efac',
                borderRadius: '6px',
                padding: '4px 8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <TagIcon size={12} color="#166534" strokeWidth={2} />
                <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#166534', fontSize: '11.5px' }}>
                  {appliedCoupon.code}
                </span>
                <span style={{ fontSize: '10px', color: '#15803d', marginRight: '4px' }}>
                  {appliedCoupon.isFreeShipping ? t('storefront.storefront_checkout_modal.s53', "(شحن مجاني)") : `(خصم ${formatMoney(discountAmount)} ${activeCurrencySymbol})`}
                </span>
              </div>
              <button
                type="button"
                onClick={handleRemoveCoupon}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#dc2626',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '1px 3px',
                }}
              >
                {t('storefront.storefront_checkout_modal.s54', "إلغاء")}
              </button>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={couponCodeInput}
                  onChange={(e) => {
                    setCouponCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''));
                    setCouponError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleApplyCoupon();
                    }
                  }}
                  placeholder={t('storefront.storefront_checkout_modal.s55', "أدخل كود الكوبون هنا...")}
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    height: '30px',
                    boxSizing: 'border-box',
                    borderRadius: '6px',
                    border: couponError ? '1.5px solid #f87171' : '1px solid #cbd5e1',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    direction: 'ltr',
                    textAlign: 'right',
                    background: '#ffffff',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  disabled={couponLoading || !couponCodeInput.trim()}
                  style={{
                    padding: '4px 10px',
                    height: '30px',
                    borderRadius: '6px',
                    background: brandColor,
                    color: brandColorContrast || 'var(--storefront-primary-contrast, #ffffff)',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    border: 'none',
                    cursor: couponLoading || !couponCodeInput.trim() ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {couponLoading ? t('storefront.storefront_checkout_modal.s56', "جاري...") : t('storefront.storefront_checkout_modal.s57', "تطبيق")}
                </button>
              </div>
              {couponError && (
                <span style={{ display: 'block', fontSize: '10px', color: '#dc2626', marginTop: '2px', fontWeight: 600 }}>
                  {couponError}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
