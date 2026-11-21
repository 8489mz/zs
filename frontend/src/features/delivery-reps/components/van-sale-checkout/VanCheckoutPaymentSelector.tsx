import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { SmartphoneIcon } from '@/shared/components/icons/AppIcons';

export interface VanCheckoutPaymentSelectorProps {
  setPaymentMethod: Dispatch<SetStateAction<'cash' | 'credit' | 'card' | 'instapay' | 'vodafone_cash'>>;
  setCashInput: Dispatch<SetStateAction<string>>;
  cartTotal: number;
  setValidationError: Dispatch<SetStateAction<string>>;
  paymentMethod: 'cash' | 'credit' | 'card' | 'instapay' | 'vodafone_cash';
  t: TFunction;
  walletType: 'instapay' | 'vodafone_cash';
}

export function VanCheckoutPaymentSelector({
  setPaymentMethod,
  setCashInput,
  cartTotal,
  setValidationError,
  paymentMethod,
  t,
  walletType,
}: VanCheckoutPaymentSelectorProps) {
  return (
    <>
      {/* Payment Method Selector: 3 Main Tabs (نقدي - إنستاباي - آجل) */}
      <div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', width: '100%' }}>
          <button
            type="button"
            onClick={() => {
              setPaymentMethod('cash');
              setCashInput(cartTotal.toFixed(2));
              setValidationError('');
            }}
            style={{
              flex: '1 1 0%',
              minWidth: 0,
              height: '40px',
              borderRadius: '8px',
              border: paymentMethod === 'cash' ? '2px solid #059669' : '1px solid #cbd5e1',
              backgroundColor: paymentMethod === 'cash' ? '#ecfdf5' : '#ffffff',
              color: paymentMethod === 'cash' ? '#065f46' : '#334155',
              fontWeight: 800,
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: paymentMethod === 'cash' ? '0 1px 3px rgba(5, 150, 105, 0.15)' : 'none',
            }}
          >
            <span>{t('delivery_reps.van_sale_checkout_modal.s23', "نقدي (كاش)")}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPaymentMethod(walletType);
              setValidationError('');
            }}
            style={{
              flex: '1 1 0%',
              minWidth: 0,
              height: '40px',
              borderRadius: '8px',
              border: (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '2px solid #7c3aed' : '1px solid #cbd5e1',
              backgroundColor: (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '#f5f3ff' : '#ffffff',
              color: (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '#6d28d9' : '#334155',
              fontWeight: 800,
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              boxShadow: (paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '0 1px 3px rgba(124, 58, 237, 0.15)' : 'none',
            }}
          >
            <SmartphoneIcon size={13} color={(paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') ? '#6d28d9' : '#64748b'} />
            <span>{t('delivery_reps.van_sale_checkout_modal.s24', "إنستاباي / محفظة")}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPaymentMethod('credit');
              setValidationError('');
            }}
            style={{
              flex: '1 1 0%',
              minWidth: 0,
              height: '40px',
              borderRadius: '8px',
              border: paymentMethod === 'credit' ? '2px solid #d97706' : '1px solid #cbd5e1',
              backgroundColor: paymentMethod === 'credit' ? '#fffbeb' : '#ffffff',
              color: paymentMethod === 'credit' ? '#92400e' : '#334155',
              fontWeight: 800,
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: paymentMethod === 'credit' ? '0 1px 3px rgba(217, 119, 6, 0.15)' : 'none',
            }}
          >
            <span>{t('delivery_reps.van_sale_checkout_modal.s25', "آجل (بالكامل)")}</span>
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '3px' }}>
          {paymentMethod === 'card' ? (
            <button
              type="button"
              onClick={() => {
                setPaymentMethod('cash');
                setCashInput(cartTotal.toFixed(2));
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#dc2626',
                fontSize: '10.5px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('delivery_reps.van_sale_checkout_modal.s26', "إلغاء الشبكة والعودة للنقدي")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPaymentMethod('card');
                setValidationError('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '10.5px',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {t('delivery_reps.van_sale_checkout_modal.s27', "سداد عبر بطاقة بنكية / شبكة POS")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
