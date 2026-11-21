import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { SmartphoneIcon } from '@/shared/components/icons/AppIcons';

export interface VanCheckoutWalletCardProps {
  paymentMethod: 'cash' | 'credit' | 'card' | 'instapay' | 'vodafone_cash';
  t: TFunction;
  cartTotal: number;
  setPaymentMethod: Dispatch<SetStateAction<'cash' | 'credit' | 'card' | 'instapay' | 'vodafone_cash'>>;
  setWalletType: Dispatch<SetStateAction<'instapay' | 'vodafone_cash'>>;
  transferReference: string;
  setTransferReference: Dispatch<SetStateAction<string>>;
  setValidationError: Dispatch<SetStateAction<string>>;
}

export function VanCheckoutWalletCard({
  paymentMethod,
  t,
  cartTotal,
  setPaymentMethod,
  setWalletType,
  transferReference,
  setTransferReference,
  setValidationError,
}: VanCheckoutWalletCardProps) {
  return (
    <>
      {/* InstaPay / Mobile Wallet Details Card */}
      {(paymentMethod === 'instapay' || paymentMethod === 'vodafone_cash') && (
        <div
          style={{
            backgroundColor: '#f5f3ff',
            border: '1px solid #ddd6fe',
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#5b21b6', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <SmartphoneIcon size={14} color="#7c3aed" />
              <span>{t('delivery_reps.van_sale_checkout_modal.s28', "تحويل إلكتروني مباشر لحساب الشركة:")}</span>
            </span>
            <span style={{ fontSize: '14px', fontWeight: 900, color: '#5b21b6' }}>
              {cartTotal.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s29', "ج.م")}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <button
              type="button"
              onClick={() => {
                setPaymentMethod('instapay');
                setWalletType('instapay');
              }}
              style={{
                height: '32px',
                borderRadius: '6px',
                border: paymentMethod === 'instapay' ? '2px solid #7c3aed' : '1px solid #c4b5fd',
                backgroundColor: paymentMethod === 'instapay' ? '#ffffff' : '#f5f3ff',
                color: paymentMethod === 'instapay' ? '#6d28d9' : '#6b21a8',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t('delivery_reps.van_sale_checkout_modal.s30', "إنستاباي (InstaPay)")}
            </button>

            <button
              type="button"
              onClick={() => {
                setPaymentMethod('vodafone_cash');
                setWalletType('vodafone_cash');
              }}
              style={{
                height: '32px',
                borderRadius: '6px',
                border: paymentMethod === 'vodafone_cash' ? '2px solid #e11d48' : '1px solid #c4b5fd',
                backgroundColor: paymentMethod === 'vodafone_cash' ? '#ffffff' : '#f5f3ff',
                color: paymentMethod === 'vodafone_cash' ? '#be123c' : '#6b21a8',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t('delivery_reps.van_sale_checkout_modal.s31', "فودافون كاش / محفظة")}
            </button>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#4c1d95', display: 'block', marginBottom: '2px' }}>
              {t('delivery_reps.van_sale_checkout_modal.s32', "رقم العملية / المرجع البنكي (Reference No) *")}
            </label>
            <input
              type="text"
              value={transferReference}
              onChange={(e) => {
                setTransferReference(e.target.value);
                setValidationError('');
              }}
              placeholder={t('delivery_reps.van_sale_checkout_modal.s33', "رقم مرجع التحويل أو آخر 6 أرقام من الإشعار")}
              style={{
                width: '100%',
                height: '32px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid #c4b5fd',
                fontSize: '12px',
                backgroundColor: '#ffffff',
                boxSizing: 'border-box',
                direction: 'ltr',
                textAlign: 'right',
              }}
            />
          </div>

          <div
            style={{
              fontSize: '10.5px',
              color: '#5b21b6',
              backgroundColor: '#ede9fe',
              padding: '4px 8px',
              borderRadius: '5px',
              fontWeight: 600,
            }}
          >
            {t('delivery_reps.van_sale_checkout_modal.s34', "فصل مالي تلقائي: المبلغ محول مباشرة لحساب الشركة/المحفظة، ولا يُطالب به المندوب ككاش في تصفية اليوم.")}
          </div>
        </div>
      )}
    </>
  );
}
