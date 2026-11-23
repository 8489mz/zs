import { CreditCardIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface StorefrontPaymentGatewaysHeaderProps {
  t: ReturnType<typeof useTranslation>['t'];
  isKuwait: boolean;
  isGcc: boolean;
  formState: {
    onlinePaymentEnabled: boolean;
    onlinePaymentProvider: string;
    paymobApiKey: string;
    paymobIntegrationId: string;
    paymobIframeId: string;
    paymobHmacSecret: string;
    paymobTestMode: boolean;
    xpayApiKey: string;
    xpayCommunityId: string;
    xpayTestMode: boolean;
    tapSecretKey: string;
    tapPublishableKey: string;
    tapTestMode: boolean;
    stripeSecretKey: string;
    stripePublishableKey: string;
    stripeWebhookSecret: string;
    stripeTestMode: boolean;
  };
  setFormState: React.Dispatch<React.SetStateAction<{
    onlinePaymentEnabled: boolean;
    onlinePaymentProvider: string;
    paymobApiKey: string;
    paymobIntegrationId: string;
    paymobIframeId: string;
    paymobHmacSecret: string;
    paymobTestMode: boolean;
    xpayApiKey: string;
    xpayCommunityId: string;
    xpayTestMode: boolean;
    tapSecretKey: string;
    tapPublishableKey: string;
    tapTestMode: boolean;
    stripeSecretKey: string;
    stripePublishableKey: string;
    stripeWebhookSecret: string;
    stripeTestMode: boolean;
  }>>;
  handleSave: () => void;
  updateMutation: { isPending: boolean };
}

export function StorefrontPaymentGatewaysHeader(props: StorefrontPaymentGatewaysHeaderProps) {
  const { t, isKuwait, isGcc, formState, setFormState, handleSave, updateMutation } = props;
  return (
    <>
    {/* Header Info Banner */}
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '20px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div
          style={{
            width: '46px',
            height: '46px',
            borderRadius: '12px',
            background: '#e0e7ff',
            color: '#170e5e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CreditCardIcon size={24} color="#170e5e" />
        </div>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
            {t('storefront.storefront_payment_gateways_manager.s0', "بوابات الدفع الإلكتروني التلقائية للمتجر (Payment Gateways)")}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            {isKuwait
              ? t('storefront.storefront_payment_gateways_manager.s1_kw', "ربط مباشر لخصم البطاقات البنكية والكي نت (K-NET / Apple Pay / Visa) وتأكيد سداد الفواتير تلقائياً")
              : isGcc
              ? t('storefront.storefront_payment_gateways_manager.s1_gcc', "ربط مباشر لخصم البطاقات البنكية ومدى (Mada / Apple Pay / Visa) وتأكيد سداد الفواتير تلقائياً")
              : t('storefront.storefront_payment_gateways_manager.s1', "ربط مباشر لخصم البطاقات البنكية (Visa / MasterCard / Meeza) وتأكيد سداد الفواتير تلقائياً عبر الـ Webhooks")}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            background: formState.onlinePaymentEnabled ? '#f0fdf4' : '#f8fafc',
            border: formState.onlinePaymentEnabled ? '1.5px solid #22c55e' : '1px solid #cbd5e1',
            padding: '8px 16px',
            borderRadius: '10px',
            transition: 'all 0.2s ease',
          }}
        >
          <input
            type="checkbox"
            checked={formState.onlinePaymentEnabled}
            onChange={(e) => setFormState({ ...formState, onlinePaymentEnabled: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#16a34a', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '13px', fontWeight: 700, color: formState.onlinePaymentEnabled ? '#15803d' : '#475569' }}>
            {formState.onlinePaymentEnabled ? t('storefront.storefront_payment_gateways_manager.s2', "الدفع الإلكتروني مفعّل") : t('storefront.storefront_payment_gateways_manager.s3', "الدفع الإلكتروني معطّل")}
          </span>
        </label>

        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          style={{
            background: '#170e5e',
            color: '#ffffff',
            border: 'none',
            borderRadius: '10px',
            padding: '10px 22px',
            fontSize: '13.5px',
            fontWeight: 800,
            cursor: updateMutation.isPending ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 2px 4px rgba(23, 14, 94, 0.2)',
            opacity: updateMutation.isPending ? 0.7 : 1,
          }}
        >
          {updateMutation.isPending ? t('storefront.storefront_payment_gateways_manager.s4', "جاري الحفظ...") : t('storefront.storefront_payment_gateways_manager.s5', "حفظ الإعدادات")}
        </button>
      </div>
    </div>
    </>
  );
}
