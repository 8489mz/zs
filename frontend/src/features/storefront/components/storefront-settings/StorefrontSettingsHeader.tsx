import { useTranslation } from 'react-i18next';
import { CheckIcon, QrCodeIcon, TrendingUpIcon } from '@/shared/components/icons/AppIcons';

export type StorefrontSettingsTabValue =
  | 'settings'
  | 'coupons'
  | 'zones'
  | 'payments'
  | 'images'
  | 'bosta'
  | 'gcc-shipping';

export interface StorefrontSettingsHeaderProps {
  storeUrl: string;
  storeSlug: string;
  copySuccess: boolean;
  pendingOrders: number | undefined;
  activeTab: StorefrontSettingsTabValue;
  setActiveTab: (tab: StorefrontSettingsTabValue) => void;
  savedSuccess: boolean;
  onCopy: () => void;
  onOpenQr: () => void;
  onGoToOrders: () => void;
}

export function StorefrontSettingsHeader({
  storeUrl,
  storeSlug,
  copySuccess,
  pendingOrders,
  activeTab,
  setActiveTab,
  savedSuccess,
  onCopy,
  onOpenQr,
  onGoToOrders,
}: StorefrontSettingsHeaderProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Top Store URL Card - Compact ERP Style */}
      <div
        className="storefront-link-banner"
        style={{
          background: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          padding: '10px 16px',
          marginBottom: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
              {t('storefront.storefront_settings_tab.s1', "رابط المتجر الإلكتروني الخاص بنشاطك:")}
            </span>
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                background: '#f0f3ff',
                color: '#170e5e',
                padding: '1px 8px',
                borderRadius: '999px',
                border: '1px solid #d8e0fc',
              }}
            >
              {t('storefront.storefront_settings_tab.s2', "مباشر ومفعل")}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                background: '#f8fafc',
                color: '#334155',
                padding: '1px 8px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
              }}
            >
              {t('storefront.storefront_settings_tab.s3', "معرّف النسخة (Slug):")} <strong style={{ color: '#170e5e', fontFamily: 'monospace' }}>{storeSlug}</strong>
            </span>
          </div>
          <div className="storefront-link-url" style={{ fontSize: '13px', fontFamily: 'monospace', direction: 'ltr', color: '#170e5e', fontWeight: 700, wordBreak: 'break-all' }}>
            {storeUrl}
          </div>
        </div>

        <div className="storefront-link-actions" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => onOpenQr()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              background: '#170e5e',
              border: '1px solid #170e5e',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            title={t('storefront.storefront_settings_tab.s4', "طباعة وتجهيز ستيكرات وستاندات كروت الـ QR لطاولات الصالة")}
          >
            <QrCodeIcon size={13} color="#ffffff" />
            <span>{t('storefront.storefront_settings_tab.s5', "طباعة QR للطاولات")}</span>
          </button>
          <button
            type="button"
            onClick={onCopy}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#0f172a',
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
          >
            {copySuccess ? t('storefront.storefront_settings_tab.s6', "تم النسخ") : t('storefront.storefront_settings_tab.s7', "نسخ الرابط")}
          </button>
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '5px 12px',
              borderRadius: '6px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              color: '#0f172a',
              fontSize: '12px',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            <span>{t('storefront.storefront_settings_tab.s8', "معاينة المتجر ↗")}</span>
          </a>
        </div>
      </div>

      {/* Executive E-Commerce Operations & Hub Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #170e5e 0%, #2e1065 100%)',
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          color: '#ffffff',
          boxShadow: '0 2px 8px rgba(23, 14, 94, 0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <TrendingUpIcon size={20} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span>مركز عمليات وطلبات المتجر الإلكتروني (E-Commerce Operations)</span>
              <span style={{ fontSize: '10.5px', fontWeight: 700, background: '#10b981', color: '#ffffff', padding: '1px 7px', borderRadius: '4px' }}>
                مباشر ومربوط بالمخزن
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.82)', marginTop: '2px' }}>
              متابعة وتجهيز الطلبات، بوالص بوسطة وسمسا، رادار السلات المتروكة، ومؤشرات الأداء اللحظية
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {(pendingOrders ?? 0) > 0 && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                background: '#ef4444',
                color: '#ffffff',
                padding: '3px 8px',
                borderRadius: '6px',
              }}
            >
              {pendingOrders} طلبات جديدة بحاجة للمراجعة
            </span>
          )}

          <button
            type="button"
            onClick={() => onGoToOrders()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: '#ffffff',
              color: '#170e5e',
              border: 'none',
              borderRadius: '6px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <span>فتح لوحة القيادة ومتابعة الطلبات</span>
            <span style={{ fontSize: '13px' }}>←</span>
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs - Compact */}
      <div
        className="filter-chip-row storefront-sub-tabs"
        style={{
          display: 'flex',
          gap: '6px',
          marginBottom: '14px',
          overflowX: 'auto',
          maxWidth: '100%',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          paddingBottom: '4px',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            border: activeTab === 'settings' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: activeTab === 'settings' ? '#170e5e' : '#ffffff',
            color: activeTab === 'settings' ? '#ffffff' : '#475569',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            userSelect: 'none',
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          <span className="sf-tab-full">{t('storefront.storefront_settings_tab.s9', "بيانات المتجر والبنر")}</span>
          <span className="sf-tab-short">{t('storefront.storefront_settings_tab.s10', "البيانات والبنر")}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('coupons')}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            border: activeTab === 'coupons' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: activeTab === 'coupons' ? '#170e5e' : '#ffffff',
            color: activeTab === 'coupons' ? '#ffffff' : '#475569',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            userSelect: 'none',
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          <span className="sf-tab-full">{t('storefront.storefront_settings_tab.s11', "كوبونات الخصم والعروض")}</span>
          <span className="sf-tab-short">{t('storefront.storefront_settings_tab.s12', "الكوبونات والعروض")}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('zones')}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            border: activeTab === 'zones' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: activeTab === 'zones' ? '#170e5e' : '#ffffff',
            color: activeTab === 'zones' ? '#ffffff' : '#475569',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            userSelect: 'none',
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          <span className="sf-tab-full">{t('storefront.storefront_settings_tab.s13', "مناطق وأسعار التوصيل")}</span>
          <span className="sf-tab-short">{t('storefront.storefront_settings_tab.s14', "مناطق التوصيل")}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('payments')}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            border: activeTab === 'payments' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: activeTab === 'payments' ? '#170e5e' : '#ffffff',
            color: activeTab === 'payments' ? '#ffffff' : '#475569',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            userSelect: 'none',
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          <span className="sf-tab-full">{t('storefront.storefront_settings_tab.s15', "بوابات الدفع الإلكتروني")}</span>
          <span className="sf-tab-short">{t('storefront.storefront_settings_tab.s16', "بوابات الدفع")}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('images')}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            border: activeTab === 'images' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: activeTab === 'images' ? '#170e5e' : '#ffffff',
            color: activeTab === 'images' ? '#ffffff' : '#475569',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            userSelect: 'none',
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          <span className="sf-tab-full">{t('storefront.storefront_settings_tab.s17', "استوديو صور الأصناف")}</span>
          <span className="sf-tab-short">{t('storefront.storefront_settings_tab.s18', "صور المنتجات")}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('bosta')}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            border: activeTab === 'bosta' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: activeTab === 'bosta' ? '#170e5e' : '#ffffff',
            color: activeTab === 'bosta' ? '#ffffff' : '#475569',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            userSelect: 'none',
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          {t('storefront.storefront_settings_tab.s19', "شحن بوسطة")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('gcc-shipping')}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            border: activeTab === 'gcc-shipping' ? '1px solid #170e5e' : '1px solid #e2e8f0',
            background: activeTab === 'gcc-shipping' ? '#170e5e' : '#ffffff',
            color: activeTab === 'gcc-shipping' ? '#ffffff' : '#475569',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            userSelect: 'none',
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          <span className="sf-tab-full">{t('storefront.storefront_settings_tab.s20', "شحن خليجي (أرامكس / سمسا)")}</span>
          <span className="sf-tab-short">{t('storefront.storefront_settings_tab.s21', "شحن خليجي")}</span>
        </button>
      </div>

      {savedSuccess && (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            padding: '8px 14px',
            color: '#166534',
            fontSize: '12.5px',
            fontWeight: 700,
            marginBottom: '14px',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <CheckIcon size={16} />
          <span>{t('storefront.storefront_settings_tab.s22', "تم حفظ وتحديث إعدادات المتجر الإلكتروني بنجاح!")}</span>
        </div>
      )}
    </>
  );
}
