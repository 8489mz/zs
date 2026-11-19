import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { StorefrontMidBanner } from '../../types/storefront.types';

export interface StorefrontSettingsFormState {
  enabled: boolean;
  slug: string;
  title: string;
  address: string;
  bio: string;
  logoUrl: string;
  announcement: string;
  bannerUrl: string;
  bannerUrls: string[];
  bannerFit: 'contain' | 'cover';
  bannerPosition: string;
  bannerPositions: string[];
  bannerIntervalSeconds: number;
  smartDealsEnabled: boolean;
  freeShippingEnabled: boolean;
  freeShippingMinOrder: number;
  deliveryFee: number;
  minOrder: number;
  whatsappPhone: string;
  customDomain: string;
  heroHeadline: string;
  heroSubtitle: string;
  supportEmail: string;
  contactPhone: string;
  facebookUrl: string;
  instagramUrl: string;
  twitterUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  telegramUrl: string;
  brandColor: string;
  brandSecondaryColor: string;
  brandSurfaceColor: string;
  themePreset: string;
  pickupEnabled: boolean;
  metaPixelId: string;
  ga4Id: string;
  tiktokPixelId: string;
  snapchatPixelId: string;
  allowOutOfStockOrders: boolean;
  showOutOfStockProducts: boolean;
  heroBannerFullBleed: boolean;
  midBannersEnabled: boolean;
  midBanners: StorefrontMidBanner[];
}

export interface StorefrontIdentityCardProps {
  formState: StorefrontSettingsFormState;
  setFormState: Dispatch<SetStateAction<StorefrontSettingsFormState>>;
  storeSlug: string;
  slugUrlParts: { prefix: string; suffix: string };
  onLogoFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemoveLogo: () => void;
  isCompressingLogo: boolean;
  logoCompressFeedback: string | null;
}

export function StorefrontIdentityCard({
  formState,
  setFormState,
  storeSlug,
  slugUrlParts,
  onLogoFileChange,
  onRemoveLogo,
  isCompressingLogo,
  logoCompressFeedback,
}: StorefrontIdentityCardProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Card 1: الهوية وبيانات المتجر */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
            {t('storefront.storefront_settings_tab.s23', "الهوية وبيانات المتجر")}
          </h3>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {t('storefront.storefront_settings_tab.s24', "الاسم والشعار والوصف الظاهر لزبائنك")}
          </span>
        </div>

        {/* Store Title (Brand Name) */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.s25', "اسم المتجر (البراند التجاري):")}
          </label>
          <input
            type="text"
            value={formState.title}
            onChange={(e) => setFormState({ ...formState, title: e.target.value })}
            placeholder={t('storefront.storefront_settings_tab.s26', "مثال: المهندس")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12.5px',
              background: '#ffffff',
              fontFamily: 'inherit',
              fontWeight: 700,
            }}
          />
        </div>

        {/* كلام العنوان الرئيسي للواجهة (Hero Headline) */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.hero_headline_label', "كلام العنوان الرئيسي للواجهة (Hero Headline):")}
          </label>
          <input
            type="text"
            value={formState.heroHeadline}
            onChange={(e) => setFormState({ ...formState, heroHeadline: e.target.value })}
            placeholder={t('storefront.storefront_settings_tab.hero_headline_placeholder', "مثال: أفضل المنتجات بأحسن سعر")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12.5px',
              background: '#ffffff',
              fontFamily: 'inherit',
              fontWeight: 700,
            }}
          />
          <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '3px' }}>
            {t('storefront.storefront_settings_tab.hero_headline_help', "يظهر كعنوان رئيسي ترويجي بارز في أعلى واجهة المتجر وتطبيقات الموبايل")}
          </span>
        </div>

        {/* العنوان الفرعي أو عبارة الترحيب (Hero Subtitle) */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.hero_subtitle_label', "العنوان الفرعي أو عبارة الترحيب (Hero Subtitle):")}
          </label>
          <input
            type="text"
            value={formState.heroSubtitle}
            onChange={(e) => setFormState({ ...formState, heroSubtitle: e.target.value })}
            placeholder={t('storefront.storefront_settings_tab.hero_subtitle_placeholder', "مثال: تشكيلة مختارة بعناية بأعلى جودة وتوصيل سريع لباب بيتك")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12.5px',
              background: '#ffffff',
              fontFamily: 'inherit',
            }}
          />
          <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '3px' }}>
            {t('storefront.storefront_settings_tab.hero_subtitle_help', "سطر توضيحي أسفل العنوان الرئيسي لإبراز مزايا التسوق وضمان الجودة")}
          </span>
        </div>

        {/* Store Logo Upload Field */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
          }}
        >
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '12px',
              background: '#ffffff',
              border: '1.5px solid #cbd5e1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            {formState.logoUrl ? (
              <img
                src={formState.logoUrl}
                alt={t('storefront.storefront_settings_tab.s27', "شعار المتجر")}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  background: 'linear-gradient(135deg, var(--storefront-primary-color, #170e5e) 0%, #312e81 100%)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: '20px',
                }}
              >
                {formState.title.trim().charAt(0) || t('storefront.storefront_settings_tab.s28', "م")}
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                {t('storefront.storefront_settings_tab.s29', "شعار المتجر (اللوجو):")}
              </label>
              {formState.logoUrl && (
                <button
                  type="button"
                  onClick={onRemoveLogo}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: '0 4px',
                  }}
                >
                  {t('storefront.storefront_settings_tab.s30', "إزالة الشعار")}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  background: 'var(--storefront-primary-color, #170e5e)',
                  color: '#ffffff',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: isCompressingLogo ? 'wait' : 'pointer',
                  boxShadow: '0 1px 3px rgba(23, 14, 94, 0.2)',
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  disabled={isCompressingLogo}
                  onChange={onLogoFileChange}
                />
                <span>{isCompressingLogo ? t('storefront.storefront_settings_tab.s31', "جاري المعالجة...") : (formState.logoUrl ? t('storefront.storefront_settings_tab.s32', "تغيير الشعار") : t('storefront.storefront_settings_tab.s33', "رفع الشعار +"))}</span>
              </label>
              <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                {t('storefront.storefront_settings_tab.s34', "صورة مربعة (PNG أو WebP) بخلفية بيضاء أو شفافة")}
              </span>
            </div>
            {logoCompressFeedback && (
              <div style={{ fontSize: '10.5px', color: '#16a34a', fontWeight: 700, marginTop: '4px' }}>
                {logoCompressFeedback}
              </div>
            )}
          </div>
        </div>

        {/* Store Address / Location Subtitle */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
            <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
              {t('storefront.storefront_settings_tab.s35', "عنوان أو مقر المتجر:")}
            </label>
            <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 500 }}>{t('storefront.storefront_settings_tab.s36', "(سطر فرعي بالهيدر)")}</span>
          </div>
          <input
            type="text"
            value={formState.address}
            onChange={(e) => setFormState({ ...formState, address: e.target.value })}
            placeholder={t('storefront.storefront_settings_tab.s37', "مثال: تعاونيات الزهور - عمارة الفسطاط")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12.5px',
              background: '#ffffff',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Store Slug */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.s38', "معرّف المتجر في الرابط (Slug):")}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', direction: 'ltr', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden' }}>
            <span className="storefront-slug-prefix" style={{ padding: '6px 12px', background: '#f8fafc', color: '#170e5e', fontSize: '13px', borderRight: '1.5px solid #cbd5e1', fontWeight: 800, userSelect: 'none', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'monospace' }}>
              {slugUrlParts.prefix}
            </span>
            <input
              type="text"
              value={formState.slug}
              onChange={(e) => {
                const clean = e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                setFormState({ ...formState, slug: clean });
              }}
              placeholder="almhnds"
              style={{
                flex: 1,
                minWidth: '60px',
                padding: '6px 10px',
                border: 'none',
                outline: 'none',
                fontSize: '12.5px',
                background: 'transparent',
                fontFamily: 'monospace',
                fontWeight: 700,
                color: '#170e5e',
              }}
            />
            {slugUrlParts.suffix && (
              <span className="storefront-slug-prefix" style={{ padding: '6px 12px', background: '#f8fafc', color: '#170e5e', fontSize: '13px', borderLeft: '1.5px solid #cbd5e1', fontWeight: 800, userSelect: 'none', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'monospace' }}>
                {slugUrlParts.suffix}
              </span>
            )}
          </div>
          <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '3px' }}>
            {t('storefront.storefront_settings_tab.s39', "يُستخدم في رابط متجرك المباشر (أحرف إنجليزية وأرقام فقط)")}
          </span>
        </div>

        {/* Store Bio */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.s40', "نبذة تعريفية بالمتجر (الوصف):")}
          </label>
          <input
            type="text"
            value={formState.bio}
            onChange={(e) => setFormState({ ...formState, bio: e.target.value })}
            placeholder={t('storefront.storefront_settings_tab.s41', "مثال: أفضل منتجات العطارة والزيوت الطبيعية 100%")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12.5px',
              background: '#ffffff',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Announcement Bar */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.s42', "الشريط الإعلاني العلوي (رسالة العروض):")}
          </label>
          <input
            type="text"
            value={formState.announcement}
            onChange={(e) => setFormState({ ...formState, announcement: e.target.value })}
            placeholder={t('storefront.storefront_settings_tab.s43', "مثال: توصيل سريع • شحن مجاني للطلبات فوق 500 جنيه")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12.5px',
              background: '#ffffff',
              fontFamily: 'inherit',
            }}
          />
        </div>


        {/* Custom Domain Section */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
              {t('storefront.storefront_settings_tab.s72', "الدومين المخصص لمتجرك (Custom Domain):")}
            </label>
            <span style={{ fontSize: '10.5px', background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
              {t('storefront.storefront_settings_tab.s73', "ميزة متقدمة")}
            </span>
          </div>
          <input
            type="text"
            value={formState.customDomain}
            onChange={(e) => setFormState({ ...formState, customDomain: e.target.value })}
            placeholder={t('storefront.storefront_settings_tab.s74', "مثال: store.mybrand.com")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12.5px',
              background: '#ffffff',
              fontFamily: 'monospace',
              direction: 'ltr',
              textAlign: 'left',
              boxSizing: 'border-box',
              marginBottom: '8px',
            }}
          />
          <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.6, marginTop: '4px' }}>
            <span>{t('storefront.storefront_settings_tab.s75', "لربط دومينك الخاص (مثل store.mybrand.com)، أضف سجل")} <strong>CNAME</strong> {t('storefront.storefront_settings_tab.s76', "في لوحة تحكم نطاقك يوجه إلى:")}</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', margin: '4px 0', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '3px 8px', borderRadius: '5px' }}>
              <code style={{ color: '#170e5e', fontWeight: 800, fontFamily: 'monospace', direction: 'ltr' }}>
                {formState.slug ? `${formState.slug.trim().toLowerCase()}.zsystemai.com` : 'cname.zsystemai.com'}
              </code>
            </div>
            <div style={{ fontSize: '10.5px', color: '#16a34a', fontWeight: 600 }}>
              يعمل متجرك افتراضياً ومباشرة على السب دومين: https://{formState.slug ? formState.slug.trim().toLowerCase() : (storeSlug || 'yourstore')}.zsystemai.com
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
