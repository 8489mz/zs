import { CreditCardIcon, GlobeIcon, BuildingIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface StorefrontPaymentGatewaysProviderProps {
  t: ReturnType<typeof useTranslation>['t'];
  isKuwait: boolean;
  storeCurrency: string;
  isGcc: boolean;
  isEgypt: boolean;
  showAllGateways: boolean;
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
  setShowAllGateways: React.Dispatch<React.SetStateAction<boolean>>;
}

export function StorefrontPaymentGatewaysProvider(props: StorefrontPaymentGatewaysProviderProps) {
  const { t, isKuwait, storeCurrency, isGcc, isEgypt, showAllGateways, setFormState, formState, setShowAllGateways } = props;
  return (
    <>
    <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
          {t('storefront.storefront_payment_gateways_manager.s7', "اختيار مزود الخدمة ووضع التشغيل")}
        </h4>
        {isKuwait ? (
          <span style={{ fontSize: '11px', fontWeight: 800, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '3px 8px', borderRadius: '6px' }}>
            بوابات الكويت المعتمدة (K-NET & Apple Pay) • {storeCurrency}
          </span>
        ) : isGcc ? (
          <span style={{ fontSize: '11px', fontWeight: 800, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '3px 8px', borderRadius: '6px' }}>
            بوابات الخليج المعتمدة (مدى & Apple Pay) • {storeCurrency}
          </span>
        ) : isEgypt ? (
          <span style={{ fontSize: '11px', fontWeight: 800, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '3px 8px', borderRadius: '6px' }}>
            بوابات مصر المعتمدة (Visa / MasterCard / ميزة) • {storeCurrency}
          </span>
        ) : (
          <span style={{ fontSize: '11px', fontWeight: 800, background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '6px' }}>
            بوابات الدفع الدولية • {storeCurrency}
          </span>
        )}
      </div>
      <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginTop: '4px' }}>
        {t('storefront.storefront_payment_gateways_manager.s8', "حدد بوابة الدفع المعتمدة وطور التشغيل (تجريبي أو إنتاجي مباشر)")}
      </span>
    </div>

    <div>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
        {t('storefront.storefront_payment_gateways_manager.s9', "مزود بوابة الدفع المعتمد")}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px' }}>
        {/* Tap Payments (GCC - Kuwait, Saudi, UAE, etc.) */}
        {(isGcc || showAllGateways) && (
          <div
            onClick={() => setFormState({ ...formState, onlinePaymentProvider: 'tap' })}
            style={{
              border: formState.onlinePaymentProvider === 'tap' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: formState.onlinePaymentProvider === 'tap' ? '#f0fdf4' : '#ffffff',
              borderRadius: '12px',
              padding: '12px 8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <CreditCardIcon size={22} color={formState.onlinePaymentProvider === 'tap' ? '#15803d' : '#64748b'} />
            <div>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{t('storefront.storefront_payment_gateways_manager.s10', "تاب (Tap GCC)")}</div>
              <div style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>
                {isKuwait ? 'KNET / Apple Pay' : 'مدى / Apple Pay'}
              </div>
            </div>
          </div>
        )}

        {/* Stripe (International) */}
        <div
          onClick={() => setFormState({ ...formState, onlinePaymentProvider: 'stripe' })}
          style={{
            border: formState.onlinePaymentProvider === 'stripe' ? '2px solid #170e5e' : '1px solid #cbd5e1',
            background: formState.onlinePaymentProvider === 'stripe' ? '#eff6ff' : '#ffffff',
            borderRadius: '12px',
            padding: '12px 8px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
        >
          <GlobeIcon size={22} color={formState.onlinePaymentProvider === 'stripe' ? '#2563eb' : '#64748b'} />
          <div>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{t('storefront.storefront_payment_gateways_manager.s12', "سترايب (Stripe)")}</div>
            <div style={{ fontSize: '10px', color: '#2563eb', fontWeight: 700 }}>{t('storefront.storefront_payment_gateways_manager.s13', "بطاقات عالمية & Apple")}</div>
          </div>
        </div>

        {/* Paymob (Egypt) */}
        {(isEgypt || showAllGateways) && (
          <div
            onClick={() => setFormState({ ...formState, onlinePaymentProvider: 'paymob' })}
            style={{
              border: formState.onlinePaymentProvider === 'paymob' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: formState.onlinePaymentProvider === 'paymob' ? '#f8fafc' : '#ffffff',
              borderRadius: '12px',
              padding: '12px 8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <BuildingIcon size={22} color={formState.onlinePaymentProvider === 'paymob' ? '#170e5e' : '#64748b'} />
            <div>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>Paymob</div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>{t('storefront.storefront_payment_gateways_manager.s14', "فيزا / ماستركارد / ميزة")}</div>
            </div>
          </div>
        )}

        {/* XPay (Egypt) */}
        {(isEgypt || showAllGateways) && (
          <div
            onClick={() => setFormState({ ...formState, onlinePaymentProvider: 'xpay' })}
            style={{
              border: formState.onlinePaymentProvider === 'xpay' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: formState.onlinePaymentProvider === 'xpay' ? '#f8fafc' : '#ffffff',
              borderRadius: '12px',
              padding: '12px 8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <CreditCardIcon size={22} color={formState.onlinePaymentProvider === 'xpay' ? '#170e5e' : '#64748b'} />
            <div>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{t('storefront.storefront_payment_gateways_manager.s15', "إكس باي (XPay)")}</div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>{t('storefront.storefront_payment_gateways_manager.s16', "بطاقات وفوري")}</div>
            </div>
          </div>
        )}

        {/* Mock Simulator */}
        {showAllGateways && (
          <div
            onClick={() => setFormState({ ...formState, onlinePaymentProvider: 'mock' })}
            style={{
              border: formState.onlinePaymentProvider === 'mock' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: formState.onlinePaymentProvider === 'mock' ? '#f8fafc' : '#ffffff',
              borderRadius: '12px',
              padding: '12px 8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
          >
            <CreditCardIcon size={22} color={formState.onlinePaymentProvider === 'mock' ? '#170e5e' : '#64748b'} />
            <div>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>Sandbox Mock</div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>{t('storefront.storefront_payment_gateways_manager.s17', "محاكي تجريبي")}</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => setShowAllGateways((prev) => !prev)}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            fontSize: '11.5px',
            fontWeight: 700,
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: '4px',
          }}
        >
          {showAllGateways
            ? t('storefront.storefront_payment_gateways_manager.hide_all', "إخفاء البوابات غير الإقليمية")
            : t('storefront.storefront_payment_gateways_manager.show_all', "عرض كافة بوابات الدفع الدولية الأخرى (+)")}
        </button>
      </div>
    </div>
    </>
  );
}
