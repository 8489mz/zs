import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storefrontApi } from '../api/storefront.api';
import { CheckCircleIcon, AlertCircleIcon } from '@/shared/components/icons/AppIcons';
import { StorefrontPaymentGatewaysHeader } from './storefront-payment-gateways-manager/storefront-payment-gateways-header';
import { StorefrontPaymentGatewaysProvider } from './storefront-payment-gateways-manager/storefront-payment-gateways-provider';
import { StorefrontPaymentGatewaysTestMode } from './storefront-payment-gateways-manager/storefront-payment-gateways-test-mode';
import { StorefrontPaymentGatewaysWebhooks } from './storefront-payment-gateways-manager/storefront-payment-gateways-webhooks';
import { StorefrontPaymentGatewaysCredentials } from './storefront-payment-gateways-manager/storefront-payment-gateways-credentials';

export function StorefrontPaymentGatewaysManager() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyXPaySuccess, setCopyXPaySuccess] = useState(false);
  const [copyTapSuccess, setCopyTapSuccess] = useState(false);
  const [copyStripeSuccess, setCopyStripeSuccess] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [showAllGateways, setShowAllGateways] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['storefront-admin-settings'],
    queryFn: storefrontApi.getSettings,
  });

  const storeCurrency = (settingsQuery.data?.currency || 'EGP').toUpperCase();
  const storeCountryCode = (settingsQuery.data?.countryCode || (
    storeCurrency === 'KWD' ? 'KW' :
    storeCurrency === 'SAR' ? 'SA' :
    storeCurrency === 'AED' ? 'AE' :
    storeCurrency === 'QAR' ? 'QA' :
    storeCurrency === 'BHD' ? 'BH' :
    storeCurrency === 'OMR' ? 'OM' :
    storeCurrency === 'EGP' ? 'EG' : 'OTHER'
  )).toUpperCase();

  const isKuwait = storeCountryCode === 'KW' || storeCurrency === 'KWD';
  const isGcc = ['KW', 'SA', 'AE', 'QA', 'BH', 'OM'].includes(storeCountryCode) ||
    ['KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR'].includes(storeCurrency);
  const isEgypt = storeCountryCode === 'EG' || storeCurrency === 'EGP';

  const [formState, setFormState] = useState({
    onlinePaymentEnabled: false,
    onlinePaymentProvider: 'tap',
    paymobApiKey: '',
    paymobIntegrationId: '',
    paymobIframeId: '',
    paymobHmacSecret: '',
    paymobTestMode: true,
    xpayApiKey: '',
    xpayCommunityId: '',
    xpayTestMode: true,
    tapSecretKey: '',
    tapPublishableKey: '',
    tapTestMode: true,
    stripeSecretKey: '',
    stripePublishableKey: '',
    stripeWebhookSecret: '',
    stripeTestMode: true,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      const data = settingsQuery.data as any;
      let activeProvider = data.onlinePaymentProvider;
      if (!activeProvider) {
        activeProvider = isGcc ? 'tap' : 'paymob';
      } else if (isGcc && (activeProvider === 'paymob' || activeProvider === 'xpay')) {
        // Auto-heal legacy unisolated default for Kuwait / GCC
        activeProvider = 'tap';
      }

      setFormState({
        onlinePaymentEnabled: Boolean(data.onlinePaymentEnabled),
        onlinePaymentProvider: activeProvider,
        paymobApiKey: data.paymobApiKey || '',
        paymobIntegrationId: data.paymobIntegrationId || '',
        paymobIframeId: data.paymobIframeId || '',
        paymobHmacSecret: data.paymobHmacSecret || '',
        paymobTestMode: data.paymobTestMode !== false,
        xpayApiKey: data.xpayApiKey || '',
        xpayCommunityId: data.xpayCommunityId || '',
        xpayTestMode: data.xpayTestMode !== false,
        tapSecretKey: data.tapSecretKey || '',
        tapPublishableKey: data.tapPublishableKey || '',
        tapTestMode: data.tapTestMode !== false,
        stripeSecretKey: data.stripeSecretKey || '',
        stripePublishableKey: data.stripePublishableKey || '',
        stripeWebhookSecret: data.stripeWebhookSecret || '',
        stripeTestMode: data.stripeTestMode !== false,
      });
    }
  }, [settingsQuery.data, isGcc]);

  const updateMutation = useMutation({
    mutationFn: storefrontApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-settings'] });
      setSaveSuccess(true);
      setSaveError('');
      setTimeout(() => setSaveSuccess(false), 3500);
    },
    onError: (err: any) => {
      setSaveError(err.message || 'حدث خطأ أثناء حفظ الإعدادات');
      setSaveSuccess(false);
    },
  });

  const handleSave = () => {
    setSaveError('');
    updateMutation.mutate(formState);
  };

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/storefront/webhooks/paymob`
    : '/api/storefront/webhooks/paymob';

  const xpayWebhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/storefront/webhooks/xpay`
    : '/api/storefront/webhooks/xpay';

  const tapWebhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/storefront/webhooks/tap`
    : '/api/storefront/webhooks/tap';

  const stripeWebhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/storefront/webhooks/stripe`
    : '/api/storefront/webhooks/stripe';

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    } catch {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    }
  };

  const handleCopyXPayWebhook = async () => {
    try {
      await navigator.clipboard.writeText(xpayWebhookUrl);
      setCopyXPaySuccess(true);
      setTimeout(() => setCopyXPaySuccess(false), 2500);
    } catch {
      setCopyXPaySuccess(true);
      setTimeout(() => setCopyXPaySuccess(false), 2500);
    }
  };

  const handleCopyTapWebhook = async () => {
    try {
      await navigator.clipboard.writeText(tapWebhookUrl);
      setCopyTapSuccess(true);
      setTimeout(() => setCopyTapSuccess(false), 2500);
    } catch {
      setCopyTapSuccess(true);
      setTimeout(() => setCopyTapSuccess(false), 2500);
    }
  };

  const handleCopyStripeWebhook = async () => {
    try {
      await navigator.clipboard.writeText(stripeWebhookUrl);
      setCopyStripeSuccess(true);
      setTimeout(() => setCopyStripeSuccess(false), 2500);
    } catch {
      setCopyStripeSuccess(true);
      setTimeout(() => setCopyStripeSuccess(false), 2500);
    }
  };

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      <StorefrontPaymentGatewaysHeader
        t={t}
        isKuwait={isKuwait}
        isGcc={isGcc}
        formState={formState}
        setFormState={setFormState}
        handleSave={handleSave}
        updateMutation={updateMutation}
      />

      {saveSuccess && (
        <div
          style={{
            background: '#dcfce7',
            border: '1px solid #86efac',
            color: '#15803d',
            padding: '12px 18px',
            borderRadius: '12px',
            fontSize: '13.5px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircleIcon size={18} color="#15803d" />
          <span>{t('storefront.storefront_payment_gateways_manager.s6', "تم حفظ إعدادات بوابة الدفع الإلكتروني بنجاح!")}</span>
        </div>
      )}

      {saveError && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            padding: '12px 18px',
            borderRadius: '12px',
            fontSize: '13.5px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircleIcon size={18} color="#991b1b" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Main Grid: 2 Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px' }}>
        {/* Left Column: Gateway Provider & Mode */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}
        >
          <StorefrontPaymentGatewaysProvider
            t={t}
            isKuwait={isKuwait}
            storeCurrency={storeCurrency}
            isGcc={isGcc}
            isEgypt={isEgypt}
            showAllGateways={showAllGateways}
            setFormState={setFormState}
            formState={formState}
            setShowAllGateways={setShowAllGateways}
          />

          <StorefrontPaymentGatewaysTestMode
            formState={formState}
            t={t}
            setFormState={setFormState}
          />

          <StorefrontPaymentGatewaysWebhooks
            formState={formState}
            t={t}
            tapWebhookUrl={tapWebhookUrl}
            handleCopyTapWebhook={handleCopyTapWebhook}
            copyTapSuccess={copyTapSuccess}
            stripeWebhookUrl={stripeWebhookUrl}
            handleCopyStripeWebhook={handleCopyStripeWebhook}
            copyStripeSuccess={copyStripeSuccess}
            webhookUrl={webhookUrl}
            handleCopyWebhook={handleCopyWebhook}
            copySuccess={copySuccess}
            xpayWebhookUrl={xpayWebhookUrl}
            handleCopyXPayWebhook={handleCopyXPayWebhook}
            copyXPaySuccess={copyXPaySuccess}
          />
        </div>

        {/* Right Column: API Credentials based on selected provider */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}
        >
          <StorefrontPaymentGatewaysCredentials
            formState={formState}
            t={t}
            setFormState={setFormState}
          />
        </div>
      </div>
    </div>
  );
}
