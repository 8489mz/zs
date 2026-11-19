import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import type { StorefrontDeliveryZone, ValidateCouponResponse } from '../../types/storefront.types';

export interface CheckoutSummarySectionProps {
  subtotal: number;
  formatMoney: (val: number | string | undefined | null) => string;
  storeCurrency: string;
  bogoSavings: number;
  isDineIn: boolean;
  selectedZone: StorefrontDeliveryZone | null;
  effectiveDeliveryFee: number;
  rawDeliveryFee: number;
  activeCurrencySymbol: string;
  discountAmount: number;
  appliedCoupon: ValidateCouponResponse | null;
  total: number;
  rememberDevice: boolean;
  setRememberDevice: Dispatch<SetStateAction<boolean>>;
  brandColor: string;
}

/**
 * Order-total summary + remember-details checkbox for the storefront
 * checkout modal (file #42 S10; pristine span L2233-2332). Pure
 * presentational section: all state lives in the facade; the component
 * only receives values + setters as props. `t` and `isEn` are hook-local
 * (useTranslation + useStorefrontLang); the span uses no `dir`, so no
 * direction prop is needed.
 *
 * Deviations from prep §4 (AST/grep evidence): the true span is
 * L2233-2332 (100L), not L2233-2336 (~104L) — L2333 closes the
 * Column-2 wrapper, L2334 closes the grid, L2335 closes the scroll
 * body, and L2336 is the separator blank (all stay in the facade per
 * the S8 col-wrapper precedent + the trailing-blank rule). Prep's
 * prop list is over-inclusive (brandColorContrast: 0 uses in the
 * span) and under-inclusive (missed bogoSavings, rawDeliveryFee,
 * isDineIn, selectedZone, appliedCoupon).
 */
export function CheckoutSummarySection({
  subtotal,
  formatMoney,
  storeCurrency,
  bogoSavings,
  isDineIn,
  selectedZone,
  effectiveDeliveryFee,
  rawDeliveryFee,
  activeCurrencySymbol,
  discountAmount,
  appliedCoupon,
  total,
  rememberDevice,
  setRememberDevice,
  brandColor,
}: CheckoutSummarySectionProps) {
  const { t } = useTranslation();
  const { isEn } = useStorefrontLang();

  return (
    <>
      {/* Order Total Summary */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '6px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
          <span>{t('storefront.storefront_checkout_modal.s58', "مجموع الأصناف:")}</span>
          <span style={{ fontWeight: 600, color: '#334155' }}>{formatMoney(subtotal)} <CurrencySymbol currency={storeCurrency} /></span>
        </div>

        {bogoSavings > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#059669', background: '#ecfdf5', padding: '3px 6px', borderRadius: '4px' }}>
            <span style={{ fontWeight: 700 }}>{t('storefront.storefront_checkout_modal.s59', "وفرت من عروض المتجر (BOGO):")}</span>
            <strong style={{ fontWeight: 800 }}>- {formatMoney(bogoSavings)} <CurrencySymbol currency={storeCurrency} /></strong>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
          <span>
            {isDineIn
              ? t('storefront.storefront_checkout_modal.s60', "خدمة الصالة / الطاولة:")
              : isEn
              ? `Delivery Fee ${selectedZone ? `(${selectedZone.name})` : ''}:`
              : `خدمة التوصيل ${selectedZone ? `(${selectedZone.name})` : ''}:`}
          </span>
          {isDineIn ? (
            <strong style={{ color: '#166534' }}>{t('storefront.storefront_checkout_modal.s61', "مجاناً (طلب صالة)")}</strong>
          ) : effectiveDeliveryFee === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {rawDeliveryFee > 0 && (
                <span style={{ textDecoration: 'line-through', color: '#94a3b8' }}>{formatMoney(rawDeliveryFee)} {activeCurrencySymbol}</span>
              )}
              <strong style={{ color: '#166534' }}>{t('storefront.storefront_checkout_modal.s62', "توصيل مجاني")}</strong>
            </div>
          ) : (
            <span style={{ fontWeight: 600, color: '#334155' }}>{formatMoney(effectiveDeliveryFee)} <CurrencySymbol currency={storeCurrency} /></span>
          )}
        </div>

        {discountAmount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#16a34a' }}>
            <span>{t('storefront.storefront_checkout_modal.s63', "خصم الكوبون (")}{appliedCoupon?.code}):</span>
            <strong style={{ fontWeight: 800 }}>- {formatMoney(discountAmount)} <CurrencySymbol currency={storeCurrency} /></strong>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '3px',
            marginTop: '1px',
            borderTop: '1px dashed #cbd5e1',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {t('storefront.storefront_checkout_modal.s64', "المبلغ الإجمالي للدفع:")}
          </span>
          <span style={{ fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
            {formatMoney(total)} <CurrencySymbol currency={storeCurrency} />
          </span>
        </div>
      </div>

      {/* Remember details checkbox (default checked) */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          fontSize: '11.5px',
          color: '#475569',
          userSelect: 'none',
          margin: '2px 2px', gap: '6px',
        }}
      >
        <input
          type="checkbox"
          checked={rememberDevice}
          onChange={(e) => setRememberDevice(e.target.checked)}
          style={{
            width: '14px',
            height: '14px',
            accentColor: brandColor,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
          {t('storefront.storefront_checkout_modal.s65', "تذكر بياناتي على هذا الجهاز لتسريع الطلب في المرات القادمة")}
        </span>
      </label>
    </>
  );
}
