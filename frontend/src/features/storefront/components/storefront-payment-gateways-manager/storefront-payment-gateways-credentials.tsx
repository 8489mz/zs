import { CreditCardIcon, GlobeIcon, LightbulbIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface StorefrontPaymentGatewaysCredentialsProps {
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

export function StorefrontPaymentGatewaysCredentials(props: StorefrontPaymentGatewaysCredentialsProps) {
  const { formState, t, setFormState } = props;
  return (
    <>
    {formState.onlinePaymentProvider === 'tap' && (
      <>
        <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <CreditCardIcon size={18} color="#170e5e" />
            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
              {t('storefront.storefront_payment_gateways_manager.s42', "مفاتيح بوابة تاب للمدفوعات (Tap Payments GCC)")}
            </h4>
          </div>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {t('storefront.storefront_payment_gateways_manager.s43', "تدعم بطاقات مدى السعودية، شبكة كي نت الكويتية، بطاقات ناباس القطرية، وبطاقات بنفت، وApple Pay بالكامل.")}
          </span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('storefront.storefront_payment_gateways_manager.s44', "المفتاح السري (Tap Secret Key)")}
          </label>
          <input
            type="password"
            value={formState.tapSecretKey}
            onChange={(e) => setFormState({ ...formState, tapSecretKey: e.target.value })}
            placeholder={t('storefront.storefront_payment_gateways_manager.s45', "sk_test_... أو sk_live_...")}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              direction: 'ltr',
            }}
          />
          <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
            {t('storefront.storefront_payment_gateways_manager.s46', "المفتاح السري لإنشاء جلسات الدفع وخصم الفواتير عبر خوادم Tap.")}
          </span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('storefront.storefront_payment_gateways_manager.s47', "المفتاح العام (Tap Publishable Key)")}
          </label>
          <input
            type="text"
            value={formState.tapPublishableKey}
            onChange={(e) => setFormState({ ...formState, tapPublishableKey: e.target.value })}
            placeholder={t('storefront.storefront_payment_gateways_manager.s48', "pk_test_... أو pk_live_...")}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              direction: 'ltr',
            }}
          />
          <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
            {t('storefront.storefront_payment_gateways_manager.s49', "المفتاح العام المخصص للواجهة الأمامية وتوثيق عمليات Apple Pay المباشرة.")}
          </span>
        </div>
      </>
    )}

    {formState.onlinePaymentProvider === 'stripe' && (
      <>
        <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <GlobeIcon size={18} color="#170e5e" />
            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
              {t('storefront.storefront_payment_gateways_manager.s50', "مفاتيح بوابة سترايب (Stripe Global Payments)")}
            </h4>
          </div>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {t('storefront.storefront_payment_gateways_manager.s51', "تدعم بطاقات فيزا، ماستركارد، أمريكان إكسبريس، وApple Pay وGoogle Pay عالمياً بكل العملات.")}
          </span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('storefront.storefront_payment_gateways_manager.s52', "المفتاح السري (Stripe Secret Key)")}
          </label>
          <input
            type="password"
            value={formState.stripeSecretKey}
            onChange={(e) => setFormState({ ...formState, stripeSecretKey: e.target.value })}
            placeholder={t('storefront.storefront_payment_gateways_manager.s53', "sk_test_... أو sk_live_...")}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              direction: 'ltr',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('storefront.storefront_payment_gateways_manager.s54', "المفتاح العام (Stripe Publishable Key)")}
          </label>
          <input
            type="text"
            value={formState.stripePublishableKey}
            onChange={(e) => setFormState({ ...formState, stripePublishableKey: e.target.value })}
            placeholder={t('storefront.storefront_payment_gateways_manager.s55', "pk_test_... أو pk_live_...")}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              direction: 'ltr',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('storefront.storefront_payment_gateways_manager.s56', "مفتاح توقيع الويب هوك (Webhook Signing Secret)")}
          </label>
          <input
            type="password"
            value={formState.stripeWebhookSecret}
            onChange={(e) => setFormState({ ...formState, stripeWebhookSecret: e.target.value })}
            placeholder="whsec_..."
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              direction: 'ltr',
            }}
          />
          <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
            {t('storefront.storefront_payment_gateways_manager.s57', "للتحقق من صحة أحداث سترايب عند استلام إشعارات الدفع التلقائية (checkout.session.completed).")}
          </span>
        </div>
      </>
    )}

    {formState.onlinePaymentProvider === 'paymob' && (
      <>
        <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
          <h4 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
            {t('storefront.storefront_payment_gateways_manager.s58', "مفاتيح الربط والاعتماد (Paymob API Keys)")}
          </h4>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {t('storefront.storefront_payment_gateways_manager.s59', "يمكنك استخراج هذه المفاتيح مباشرة من لوحة حسابك في Paymob")}
          </span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('storefront.storefront_payment_gateways_manager.s60', "مفتاح الـ API العام (API Key)")}
          </label>
          <input
            type="password"
            value={formState.paymobApiKey}
            onChange={(e) => setFormState({ ...formState, paymobApiKey: e.target.value })}
            placeholder={t('storefront.storefront_payment_gateways_manager.s61', "مثال: ZXlKaGJHY2lPaUpJVXpVe...")}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              direction: 'ltr',
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {t('storefront.storefront_payment_gateways_manager.s62', "معرف التكامل (Integration ID)")}
            </label>
            <input
              type="text"
              value={formState.paymobIntegrationId}
              onChange={(e) => setFormState({ ...formState, paymobIntegrationId: e.target.value })}
              placeholder={t('storefront.storefront_payment_gateways_manager.s63', "مثال: 456789")}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
                direction: 'ltr',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {t('storefront.storefront_payment_gateways_manager.s64', "معرف الإطار (Iframe ID)")}
            </label>
            <input
              type="text"
              value={formState.paymobIframeId}
              onChange={(e) => setFormState({ ...formState, paymobIframeId: e.target.value })}
              placeholder={t('storefront.storefront_payment_gateways_manager.s65', "مثال: 812345")}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
                direction: 'ltr',
              }}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('storefront.storefront_payment_gateways_manager.s66', "المفتاح السري للتحقق الأمني (HMAC Secret)")}
          </label>
          <input
            type="password"
            value={formState.paymobHmacSecret}
            onChange={(e) => setFormState({ ...formState, paymobHmacSecret: e.target.value })}
            placeholder={t('storefront.storefront_payment_gateways_manager.s67', "مثال: A8B4F12E99...")}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              direction: 'ltr',
            }}
          />
          <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
            {t('storefront.storefront_payment_gateways_manager.s68', "يُستخدم لتأكيد صحة التوقيع الرقمي للـ Webhook ومنع تزوير عمليات الدفع نهائياً.")}
          </span>
        </div>
      </>
    )}

    {formState.onlinePaymentProvider === 'xpay' && (
      <>
        <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
          <h4 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
            {t('storefront.storefront_payment_gateways_manager.s69', "مفاتيح الربط والاعتماد (XPay API Credentials)")}
          </h4>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {t('storefront.storefront_payment_gateways_manager.s70', "يمكنك استخراج هذه المفاتيح من لوحة حساب التاجر في منصة إكس باي (XPay Dashboard)")}
          </span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('storefront.storefront_payment_gateways_manager.s71', "مفتاح API السري (x-api-key)")}
          </label>
          <input
            type="password"
            value={formState.xpayApiKey}
            onChange={(e) => setFormState({ ...formState, xpayApiKey: e.target.value })}
            placeholder={t('storefront.storefront_payment_gateways_manager.s72', "مثال: xpay_sec_key_...")}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              direction: 'ltr',
            }}
          />
          <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
            {t('storefront.storefront_payment_gateways_manager.s73', "يُرسل في الترويسة (Header) الخاصة بالطلب للتحقق من هوية التاجر.")}
          </span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
            {t('storefront.storefront_payment_gateways_manager.s74', "معرف المجتمع في إكس باي (Community ID)")}
          </label>
          <input
            type="text"
            value={formState.xpayCommunityId}
            onChange={(e) => setFormState({ ...formState, xpayCommunityId: e.target.value })}
            placeholder={t('storefront.storefront_payment_gateways_manager.s75', "مثال: cm_987654...")}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              direction: 'ltr',
            }}
          />
          <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
            {t('storefront.storefront_payment_gateways_manager.s76', "المعرّف الخاص بمنشأتك أو متجرك في منصة إكس باي لتوجيه العمليات المالية.")}
          </span>
        </div>
      </>
    )}

    {formState.onlinePaymentProvider === 'mock' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 0' }}>
        <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <CreditCardIcon size={16} color="#64748b" />
          <span>{t('storefront.storefront_payment_gateways_manager.s77', "وضع المحاكاة التجريبي نشط")}</span>
        </div>
        <p style={{ fontSize: '12.5px', color: '#64748b', lineHeight: '1.6', margin: 0 }}>
          {t('storefront.storefront_payment_gateways_manager.s78', "هذا الوضع مخصص لتجربة ومحاكاة عمليات الدفع بالبطاقات محلياً بدون إدخال أي مفاتيح بنكية حقيقية. سيتمكن زوار المتجر من تجربة إدخال بطاقة وهمية والحصول على تأكيد السداد وإشعار الواتساب التلقائي فوراً.")}
        </p>
      </div>
    )}

    <div
      style={{
        background: '#f8fafc',
        border: '1px dashed #cbd5e1',
        borderRadius: '10px',
        padding: '12px 14px',
        fontSize: '12px',
        color: '#475569',
        lineHeight: '1.4',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
      }}
    >
      <LightbulbIcon size={16} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
      <div>
        {t('storefront.storefront_payment_gateways_manager.s79', "في حال تفعيل")} <strong>{t('storefront.storefront_payment_gateways_manager.s80', "وضع التجربة (Sandbox / Staging)")}</strong> {t('storefront.storefront_payment_gateways_manager.s81', "وعدم إدخال مفاتيح حية، سيوفر المتجر تلقائياً تجربة دفع بطاقة تجريبية متكاملة لضمان فحص دورة الشراء بالكامل.")}
      </div>
    </div>
    </>
  );
}
