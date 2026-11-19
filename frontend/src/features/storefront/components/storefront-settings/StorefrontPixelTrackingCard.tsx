import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { StorefrontMidBanner } from '../../types/storefront.types';

// Mirror of the StorefrontSettingsTab formState object: all 44 fields with the
// same types the facade's useState initializer infers. The whole object is
// passed by reference; it is NOT split into per-card sub-states.
export interface StorefrontPixelTrackingFormState {
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

export interface StorefrontPixelTrackingCardProps {
  formState: StorefrontPixelTrackingFormState;
  setFormState: Dispatch<SetStateAction<StorefrontPixelTrackingFormState>>;
}

export function StorefrontPixelTrackingCard({ formState, setFormState }: StorefrontPixelTrackingCardProps) {
  const { t } = useTranslation();

  return (
    <>
    {/* Card 3: أكواد البيكسل والتتبع الإعلاني */}
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
        gridColumn: '1 / -1',
      }}
    >
      <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
            {t('storefront.storefront_settings_tab.s148', "أكواد البيكسل والتتبع الإعلاني (Marketing & Conversion Pixels)")}
          </h3>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {t('storefront.storefront_settings_tab.s149', "تتبع الزيارات وإتمام عمليات الشراء تلقائياً على المنصات الإعلانية العالمية")}
          </span>
        </div>
        <span style={{ fontSize: '10.5px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
          {t('storefront.storefront_settings_tab.s150', "تتبع تلقائي للأحداث")}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* Meta / Facebook Pixel */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.s151', "معرف بيكسل فيسبوك / ميتا (Meta Pixel ID):")}
          </label>
          <input
            type="text"
            value={formState.metaPixelId}
            onChange={(e) => setFormState({ ...formState, metaPixelId: e.target.value.trim() })}
            placeholder={t('storefront.storefront_settings_tab.s152', "مثال: 123456789012345")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12px',
              fontFamily: 'monospace',
              direction: 'ltr',
              textAlign: 'left',
            }}
          />
          <span style={{ fontSize: '10px', color: '#64748b' }}>{t('storefront.storefront_settings_tab.s153', "يتتبع أحداث ViewContent و InitiateCheckout و Purchase")}</span>
        </div>

        {/* Google Analytics 4 */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.s154', "معرف جوجل أناليتكس 4 (GA4 Measurement ID):")}
          </label>
          <input
            type="text"
            value={formState.ga4Id}
            onChange={(e) => setFormState({ ...formState, ga4Id: e.target.value.trim().toUpperCase() })}
            placeholder={t('storefront.storefront_settings_tab.s155', "مثال: G-XXXXXXXXXX")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12px',
              fontFamily: 'monospace',
              direction: 'ltr',
              textAlign: 'left',
            }}
          />
          <span style={{ fontSize: '10px', color: '#64748b' }}>{t('storefront.storefront_settings_tab.s156', "إحصائيات متقدمة لحركة الزوار والتجارة الإلكترونية")}</span>
        </div>

        {/* TikTok Pixel */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.s157', "معرف بيكسل تيك توك (TikTok Pixel ID):")}
          </label>
          <input
            type="text"
            value={formState.tiktokPixelId}
            onChange={(e) => setFormState({ ...formState, tiktokPixelId: e.target.value.trim() })}
            placeholder={t('storefront.storefront_settings_tab.s158', "مثال: C9XXXXXX123456")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12px',
              fontFamily: 'monospace',
              direction: 'ltr',
              textAlign: 'left',
            }}
          />
          <span style={{ fontSize: '10px', color: '#64748b' }}>{t('storefront.storefront_settings_tab.s159', "تتبع حملات تيك توك الإعلانية ومعدل التحويل")}</span>
        </div>

        {/* Snapchat Pixel */}
        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('storefront.storefront_settings_tab.s160', "معرف بيكسل سناب شات (Snapchat Pixel ID):")}
          </label>
          <input
            type="text"
            value={formState.snapchatPixelId}
            onChange={(e) => setFormState({ ...formState, snapchatPixelId: e.target.value.trim() })}
            placeholder={t('storefront.storefront_settings_tab.s161', "مثال: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1.5px solid #cbd5e1',
              fontSize: '12px',
              fontFamily: 'monospace',
              direction: 'ltr',
              textAlign: 'left',
            }}
          />
          <span style={{ fontSize: '10px', color: '#64748b' }}>{t('storefront.storefront_settings_tab.s162', "تتبع حملات سناب شات الإعلانية ومشتريات المتجر")}</span>
        </div>
      </div>
    </div>
    </>
  );
}
