import { LinkIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface StorefrontPaymentGatewaysWebhooksProps {
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
  tapWebhookUrl: string;
  handleCopyTapWebhook: () => Promise<void>;
  copyTapSuccess: boolean;
  stripeWebhookUrl: string;
  handleCopyStripeWebhook: () => Promise<void>;
  copyStripeSuccess: boolean;
  webhookUrl: string;
  handleCopyWebhook: () => Promise<void>;
  copySuccess: boolean;
  xpayWebhookUrl: string;
  handleCopyXPayWebhook: () => Promise<void>;
  copyXPaySuccess: boolean;
}

export function StorefrontPaymentGatewaysWebhooks(props: StorefrontPaymentGatewaysWebhooksProps) {
  const { formState, t, tapWebhookUrl, handleCopyTapWebhook, copyTapSuccess, stripeWebhookUrl, handleCopyStripeWebhook, copyStripeSuccess, webhookUrl, handleCopyWebhook, copySuccess, xpayWebhookUrl, handleCopyXPayWebhook, copyXPaySuccess } = props;
  return (
    <>
    {/* Webhook Configuration Card for Tap Payments */}
    {formState.onlinePaymentProvider === 'tap' && (
      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '12px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LinkIcon size={16} color="#15803d" />
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#15803d' }}>
            {t('storefront.storefront_payment_gateways_manager.s26', "رابط إشعار العمليات الفوري (Tap Webhook URL)")}
          </div>
        </div>
        <div style={{ fontSize: '11.5px', color: '#166534', lineHeight: '1.5' }}>
          {t('storefront.storefront_payment_gateways_manager.s27', "قم بنسخ هذا الرابط ووضعه في لوحة تحكم Tap (Developers > Webhooks):")}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '6px 12px',
          }}
        >
          <code style={{ fontSize: '11.5px', color: '#0f172a', direction: 'ltr', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tapWebhookUrl}
          </code>
          <button
            type="button"
            onClick={handleCopyTapWebhook}
            style={{
              background: copyTapSuccess ? '#16a34a' : '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {copyTapSuccess ? t('storefront.storefront_payment_gateways_manager.s28', "تم النسخ!") : t('storefront.storefront_payment_gateways_manager.s29', "نسخ الرابط")}
          </button>
        </div>
      </div>
    )}

    {/* Webhook Configuration Card for Stripe */}
    {formState.onlinePaymentProvider === 'stripe' && (
      <div
        style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '12px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LinkIcon size={16} color="#1d4ed8" />
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#1d4ed8' }}>
            {t('storefront.storefront_payment_gateways_manager.s30', "رابط إشعار العمليات الفوري (Stripe Webhook URL)")}
          </div>
        </div>
        <div style={{ fontSize: '11.5px', color: '#1e40af', lineHeight: '1.5' }}>
          {t('storefront.storefront_payment_gateways_manager.s31', "قم بنسخ هذا الرابط ووضعه في لوحة تحكم سترايب (Developers > Webhooks > Add Endpoint):")}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '6px 12px',
          }}
        >
          <code style={{ fontSize: '11.5px', color: '#0f172a', direction: 'ltr', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {stripeWebhookUrl}
          </code>
          <button
            type="button"
            onClick={handleCopyStripeWebhook}
            style={{
              background: copyStripeSuccess ? '#16a34a' : '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {copyStripeSuccess ? t('storefront.storefront_payment_gateways_manager.s32', "تم النسخ!") : t('storefront.storefront_payment_gateways_manager.s33', "نسخ الرابط")}
          </button>
        </div>
      </div>
    )}

    {/* Webhook Configuration Card for Paymob */}
    {formState.onlinePaymentProvider === 'paymob' && (
      <div
        style={{
          background: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: '12px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LinkIcon size={16} color="#0369a1" />
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#0369a1' }}>
            {t('storefront.storefront_payment_gateways_manager.s34', "رابط إشعار العمليات الفوري (Paymob Webhook URL)")}
          </div>
        </div>
        <div style={{ fontSize: '11.5px', color: '#0c4a6e', lineHeight: '1.5' }}>
          {t('storefront.storefront_payment_gateways_manager.s35', "قم بنسخ هذا الرابط ووضعه في لوحة تحكم Paymob تحت (Transaction Processed Callback):")}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '6px 12px',
          }}
        >
          <code style={{ fontSize: '11.5px', color: '#0f172a', direction: 'ltr', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {webhookUrl}
          </code>
          <button
            type="button"
            onClick={handleCopyWebhook}
            style={{
              background: copySuccess ? '#16a34a' : '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {copySuccess ? t('storefront.storefront_payment_gateways_manager.s36', "تم النسخ!") : t('storefront.storefront_payment_gateways_manager.s37', "نسخ الرابط")}
          </button>
        </div>
      </div>
    )}

    {/* Webhook Configuration Card for XPay */}
    {formState.onlinePaymentProvider === 'xpay' && (
      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '12px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LinkIcon size={16} color="#15803d" />
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#15803d' }}>
            {t('storefront.storefront_payment_gateways_manager.s38', "رابط إشعار العمليات الفوري (XPay Webhook URL)")}
          </div>
        </div>
        <div style={{ fontSize: '11.5px', color: '#166534', lineHeight: '1.5' }}>
          {t('storefront.storefront_payment_gateways_manager.s39', "قم بنسخ هذا الرابط ووضعه في لوحة تحكم إكس باي تحت (Webhooks / Payment Notification URL):")}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '6px 12px',
          }}
        >
          <code style={{ fontSize: '11.5px', color: '#0f172a', direction: 'ltr', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {xpayWebhookUrl}
          </code>
          <button
            type="button"
            onClick={handleCopyXPayWebhook}
            style={{
              background: copyXPaySuccess ? '#16a34a' : '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {copyXPaySuccess ? t('storefront.storefront_payment_gateways_manager.s40', "تم النسخ!") : t('storefront.storefront_payment_gateways_manager.s41', "نسخ الرابط")}
          </button>
        </div>
      </div>
    )}
    </>
  );
}
