import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorefrontLang } from '@/i18n';
import type { StorefrontInfo } from '../../types/storefront.types';

/**
 * Checkout payment section (file #42 S8) — pure move of the payment-method
 * selector from StorefrontCheckoutModal.tsx (pristine L1854–2050).
 * Props restore the pristine typing exactly (file #39 lesson): no `any[]`.
 * `t` / `isEn` are hook-local via useTranslation() + useStorefrontLang()
 * (the #40 S1/S2 pattern), not props. No icons are used in this span
 * (prep §3's "S8: CheckIcon" is wrong — 0 icon uses, grep/AST-verified),
 * and `brandColorContrast` has 0 uses here, so it is NOT a prop
 * (prep §4 over-inclusive — refused on AST evidence, #41 S1 precedent).
 * Prep §4 also missed `isKuwait` (6 uses), `isDineIn` (1 use) and `info`
 * (2 uses: info?.onlinePaymentEnabled, info?.whatsappPhone) — all added
 * as props on AST evidence.
 * The span is a section comment + one <div>, i.e. two top-level nodes, so it
 * is wrapped in <>...</> (the S4 fragment pattern); the span itself is
 * untouched, zero re-indentation.
 */
export interface CheckoutPaymentSectionProps {
  paymentMethod: 'cod' | 'instapay_wallet' | 'credit_card';
  setPaymentMethod: Dispatch<SetStateAction<'cod' | 'instapay_wallet' | 'credit_card'>>;
  total: number;
  formatMoney: (val: number | string | undefined | null) => string;
  brandColor: string;
  activeCurrencySymbol: string;
  isKuwait: boolean;
  isDineIn: boolean;
  info?: StorefrontInfo;
}

export function CheckoutPaymentSection({
  paymentMethod,
  setPaymentMethod,
  total,
  formatMoney,
  brandColor,
  activeCurrencySymbol,
  isKuwait,
  isDineIn,
  info,
}: CheckoutPaymentSectionProps) {
  const { t } = useTranslation();
  const { isEn } = useStorefrontLang();
  return (
    <>
    {/* Payment Method Selector */}
    <div>
      <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#1e293b', marginBottom: '3px' }}>
        {t('storefront.storefront_checkout_modal.s32', "طريقة الدفع")}
      </label>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: '6px',
          width: '100%',
        }}
      >
        {/* COD Option */}
        <div
          onClick={() => setPaymentMethod('cod')}
          style={{
            flex: 1,
            minWidth: 0,
            border: paymentMethod === 'cod' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
            background: paymentMethod === 'cod' ? 'rgba(23, 14, 94, 0.04)' : '#ffffff',
            borderRadius: '8px',
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            height: '36px',
            boxSizing: 'border-box',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              border: paymentMethod === 'cod' ? `3.5px solid ${brandColor}` : '1.5px solid #94a3b8',
              background: '#ffffff',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: '11.5px',
              fontWeight: 700,
              color: paymentMethod === 'cod' ? brandColor : '#0f172a',
              whiteSpace: 'nowrap',
            }}
          >
            {isDineIn ? t('storefront.storefront_checkout_modal.s33', "في الصالة") : isEn ? "Cash on Delivery" : "عند الاستلام"}
          </span>
        </div>

        {/* Pre-payment Option */}
        <div
          onClick={() => setPaymentMethod('instapay_wallet')}
          style={{
            flex: 1,
            minWidth: 0,
            border: paymentMethod === 'instapay_wallet' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
            background: paymentMethod === 'instapay_wallet' ? 'rgba(23, 14, 94, 0.04)' : '#ffffff',
            borderRadius: '8px',
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            height: '36px',
            boxSizing: 'border-box',
            transition: 'all 0.15s ease',
          }}
        >
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              border: paymentMethod === 'instapay_wallet' ? `3.5px solid ${brandColor}` : '1.5px solid #94a3b8',
              background: '#ffffff',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: '11.5px',
              fontWeight: 700,
              color: paymentMethod === 'instapay_wallet' ? brandColor : '#0f172a',
              whiteSpace: 'nowrap',
            }}
          >
            {isKuwait ? (isEn ? "Bank Transfer" : "تحويل بنكي") : t('storefront.storefront_checkout_modal.s37', "إنستاباي / محفظة")}
          </span>
        </div>

        {/* Credit Card Online Payment Option */}
        {info?.onlinePaymentEnabled && (
          <div
            onClick={() => setPaymentMethod('credit_card')}
            style={{
              flex: 1,
              minWidth: 0,
              border: paymentMethod === 'credit_card' ? `2px solid ${brandColor}` : '1.5px solid #cbd5e1',
              background: paymentMethod === 'credit_card' ? 'rgba(23, 14, 94, 0.04)' : '#ffffff',
              borderRadius: '8px',
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              height: '36px',
              boxSizing: 'border-box',
              transition: 'all 0.15s ease',
            }}
          >
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                border: paymentMethod === 'credit_card' ? `3.5px solid ${brandColor}` : '1.5px solid #94a3b8',
                background: '#ffffff',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: '11.5px',
                fontWeight: 700,
                color: paymentMethod === 'credit_card' ? brandColor : '#0f172a',
                whiteSpace: 'nowrap',
              }}
            >
              {isKuwait ? (isEn ? "K-NET / Card" : "كي نت / بطاقة") : t('storefront.storefront_checkout_modal.s39', "بطاقة بنكية")}
            </span>
          </div>
        )}
      </div>

      {/* Notice if credit_card is selected */}
      {paymentMethod === 'credit_card' && (
        <div
          style={{
            marginTop: '6px',
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: '6px',
            padding: '6px 10px',
            fontSize: '11.5px',
            color: '#0369a1',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          <div style={{ fontWeight: 800 }}>
            {isKuwait ? t('storefront.storefront_checkout_modal.s40', "دفع إلكتروني فوري وآمن (كي نت / بطاقات بنكية):") : t('storefront.storefront_checkout_modal.s41', "دفع إلكتروني فوري وآمن:")}
          </div>
          <div style={{ color: '#0c4a6e', fontSize: '11px', lineHeight: '1.4' }}>
            {isKuwait
              ? `سيتم فتح بوابة الدفع الآمنة لسداد مبلغ الطلب (${formatMoney(total)} ${activeCurrencySymbol}) فور الضغط على إرسال الطلب.`
              : `سيتم فتح بوابة الدفع الآمنة لسداد مبلغ الطلب (${formatMoney(total)} ${activeCurrencySymbol}) ببطاقتك البنكية فور الضغط على إرسال الطلب.`}
          </div>
        </div>
      )}

      {/* Notice if instapay/wallet is selected */}
      {paymentMethod === 'instapay_wallet' && (
        <div
          style={{
            marginTop: '6px',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '6px',
            padding: '6px 10px',
            fontSize: '11.5px',
            color: '#166534',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          <div style={{ fontWeight: 800 }}>
            {isKuwait ? t('storefront.storefront_checkout_modal.s42', "بيانات التحويل البنكي / الرابط:") : t('storefront.storefront_checkout_modal.s43', "رقم التحويل (إنستاباي / كاش):")}{' '}
            <span style={{ direction: 'ltr', display: 'inline-block', color: brandColor, fontWeight: 900 }}>
              {info?.whatsappPhone || t('storefront.storefront_checkout_modal.s44', "يرجى التواصل عبر الواتساب")}
            </span>
          </div>
          <div style={{ color: '#15803d', fontSize: '11px', lineHeight: '1.4' }}>
            {isKuwait
              ? `يرجى تحويل مبلغ الطلب (${formatMoney(total)} ${activeCurrencySymbol}) وإرسال إشعار التحويل عبر الواتساب لتأكيد الطلب فوراً.`
              : `يرجى تحويل مبلغ الطلب (${formatMoney(total)} ${activeCurrencySymbol}) وإرسال إشعار التحويل عبر الواتساب لتأكيد الشحن فوراً.`}
          </div>
        </div>
      )}
    </div>
    </>
  );
}
