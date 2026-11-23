import type { useTranslation } from 'react-i18next';

export interface StorefrontPaymentGatewaysTestModeProps {
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
  t: ReturnType<typeof useTranslation>['t'];
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
}

export function StorefrontPaymentGatewaysTestMode(props: StorefrontPaymentGatewaysTestModeProps) {
  const { formState, t, setFormState } = props;
  return (
    <>
    {/* Test Mode / Sandbox Toggle */}
    {formState.onlinePaymentProvider === 'tap' && (
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>{t('storefront.storefront_payment_gateways_manager.s18', "وضع التجربة (Tap Sandbox Mode)")}</div>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
            {t('storefront.storefront_payment_gateways_manager.s19', "اختبار كامل دورة الدفع الخليجي (مدى، KNET، Apple Pay) ببيئة الاختبار")}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={formState.tapTestMode}
            onChange={(e) => setFormState({ ...formState, tapTestMode: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
        </label>
      </div>
    )}

    {formState.onlinePaymentProvider === 'stripe' && (
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>{t('storefront.storefront_payment_gateways_manager.s20', "وضع التجربة (Stripe Test Mode)")}</div>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
            {t('storefront.storefront_payment_gateways_manager.s21', "اختبار البطاقات الدولية عبر مفاتيح الاختبار بدون خصم أموال حقيقية")}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={formState.stripeTestMode}
            onChange={(e) => setFormState({ ...formState, stripeTestMode: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
        </label>
      </div>
    )}

    {formState.onlinePaymentProvider === 'paymob' && (
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>{t('storefront.storefront_payment_gateways_manager.s22', "وضع التجربة (Paymob Sandbox)")}</div>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
            {t('storefront.storefront_payment_gateways_manager.s23', "اختبار كامل دورة الدفع ببطاقات تجريبية دون سحب أموال حقيقية")}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={formState.paymobTestMode}
            onChange={(e) => setFormState({ ...formState, paymobTestMode: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
        </label>
      </div>
    )}

    {formState.onlinePaymentProvider === 'xpay' && (
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>{t('storefront.storefront_payment_gateways_manager.s24', "وضع التجربة (XPay Staging Mode)")}</div>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
            {t('storefront.storefront_payment_gateways_manager.s25', "استخدام خوادم الاختبار (staging.xpay.app) لاختبار الدفع")}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={formState.xpayTestMode}
            onChange={(e) => setFormState({ ...formState, xpayTestMode: e.target.checked })}
            style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer' }}
          />
        </label>
      </div>
    )}
    </>
  );
}
