import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { StorefrontMidBanner } from '../../types/storefront.types';

export interface StorefrontThemeStudioCardFormState {
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

export interface StorefrontThemeStudioCardProps {
  formState: StorefrontThemeStudioCardFormState;
  setFormState: Dispatch<SetStateAction<StorefrontThemeStudioCardFormState>>;
}

export function StorefrontThemeStudioCard({ formState, setFormState }: StorefrontThemeStudioCardProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Card 3: استوديو تخصيص هوية وألوان المتجر البريميوم */}
      {/* 3-Color Premium Theme Customization Studio */}
        <div
          style={{
            gridColumn: '1 / -1',
            background: '#f8fafc',
            border: '1.5px solid #e2e8f0',
            borderRadius: '14px',
            padding: '16px 18px',
            marginTop: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                {t('storefront.storefront_settings_tab.s46', "تخصيص هوية وألوان المتجر البريميوم (3-Color Luxury Identity)")}
              </h3>
              <p style={{ fontSize: '11.5px', color: '#64748b', margin: '3px 0 0 0' }}>
                {t('storefront.storefront_settings_tab.s47', "اختر لوحة ألوان متناسقة جاهزة بنقرة واحدة، أو خصص الألوان الثلاثة (الأساسي، العروض، الأسطح) لتعكس هويتك التجارية بدقة وفخامة.")}
              </p>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                color: formState.brandColor,
                background: '#ffffff',
                border: `1px solid #cbd5e1`,
                padding: '3px 10px',
                borderRadius: '20px',
              }}
            >
              {t('storefront.storefront_settings_tab.s48', "النمط المختار:")} {formState.themePreset || 'custom'}
            </span>
          </div>

          {/* 1. Curated Luxury Palettes (One-Click) */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
              {t('storefront.storefront_settings_tab.s49', "لوحات ألوان بريميوم جاهزة ومعتمدة:")}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
              {[
                {
                  id: 'royal_navy',
                  name: t('storefront.storefront_settings_tab.s50', "الكحلي الملكي"),
                  primary: '#170e5e',
                  secondary: '#f59e0b',
                  surface: '#f8fafc',
                },
                {
                  id: 'imperial_emerald',
                  name: t('storefront.storefront_settings_tab.s51', "الزمردي الإمبراطوري"),
                  primary: '#065f46',
                  secondary: '#d97706',
                  surface: '#f0fdf4',
                },
                {
                  id: 'velvet_boutique',
                  name: t('storefront.storefront_settings_tab.s52', "البوتيك المخملي"),
                  primary: '#881337',
                  secondary: '#e11d48',
                  surface: '#fff1f2',
                },
                {
                  id: 'italian_roast',
                  name: t('storefront.storefront_settings_tab.s53', "القهوة الإيطالية"),
                  primary: '#451a03',
                  secondary: '#d97706',
                  surface: '#faf8f5',
                },
                {
                  id: 'modern_obsidian',
                  name: t('storefront.storefront_settings_tab.s54', "الفحمي العصري"),
                  primary: '#0f172a',
                  secondary: '#2563eb',
                  surface: '#f1f5f9',
                },
                {
                  id: 'royal_amethyst',
                  name: t('storefront.storefront_settings_tab.s55', "الأرجواني الفاخر"),
                  primary: '#581c87',
                  secondary: '#06b6d4',
                  surface: '#faf5ff',
                },
              ].map((palette) => {
                const isSelected = formState.themePreset === palette.id ||
                  (formState.brandColor === palette.primary && formState.brandSecondaryColor === palette.secondary);
                return (
                  <button
                    key={palette.id}
                    type="button"
                    onClick={() => {
                      setFormState({
                        ...formState,
                        brandColor: palette.primary,
                        brandSecondaryColor: palette.secondary,
                        brandSurfaceColor: palette.surface,
                        themePreset: palette.id,
                      });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: '10px',
                      background: isSelected ? '#ffffff' : '#f1f5f9',
                      border: isSelected ? `2px solid ${palette.primary}` : '1px solid #e2e8f0',
                      boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      textAlign: 'right',
                    }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#1e293b' }}>
                      {palette.name}
                    </span>
                    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                      <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: palette.primary, border: '1px solid rgba(0,0,0,0.1)' }} />
                      <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: palette.secondary, border: '1px solid rgba(0,0,0,0.1)' }} />
                      <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: palette.surface, border: '1px solid rgba(0,0,0,0.15)' }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Three Granular Color Controls & Interactive Live Mockup */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', alignItems: 'center' }}>
            {/* Left: The 3 Color Pickers */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Primary Color */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div>
                  <span style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a' }}>
                    {t('storefront.storefront_settings_tab.s56', "1. اللون الأساسي (Primary Color):")}
                  </span>
                  <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                    {t('storefront.storefront_settings_tab.s57', "للهيدر، أزرار الشراء وسلة التسوق")}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="color"
                    value={formState.brandColor || '#170e5e'}
                    onChange={(e) => setFormState({ ...formState, brandColor: e.target.value, themePreset: 'custom' })}
                    style={{ width: '32px', height: '28px', padding: 0, border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', background: 'none' }}
                  />
                  <input
                    type="text"
                    value={formState.brandColor || '#170e5e'}
                    onChange={(e) => setFormState({ ...formState, brandColor: e.target.value, themePreset: 'custom' })}
                    style={{ width: '74px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', direction: 'ltr', textAlign: 'center' }}
                  />
                </div>
              </div>

              {/* Secondary / Deals Color */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div>
                  <span style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a' }}>
                    {t('storefront.storefront_settings_tab.s58', "2. لون التمييز والعروض (Accent / Deals):")}
                  </span>
                  <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                    {t('storefront.storefront_settings_tab.s59', "شارات الخصومات وأشرطة التوفير")}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="color"
                    value={formState.brandSecondaryColor || '#f59e0b'}
                    onChange={(e) => setFormState({ ...formState, brandSecondaryColor: e.target.value, themePreset: 'custom' })}
                    style={{ width: '32px', height: '28px', padding: 0, border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', background: 'none' }}
                  />
                  <input
                    type="text"
                    value={formState.brandSecondaryColor || '#f59e0b'}
                    onChange={(e) => setFormState({ ...formState, brandSecondaryColor: e.target.value, themePreset: 'custom' })}
                    style={{ width: '74px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', direction: 'ltr', textAlign: 'center' }}
                  />
                </div>
              </div>

              {/* Surface / Background Color */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div>
                  <span style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#0f172a' }}>
                    {t('storefront.storefront_settings_tab.s60', "3. لون الأسطح والخلفيات (Surface Tint):")}
                  </span>
                  <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                    {t('storefront.storefront_settings_tab.s61', "خلفيات المتجر وبطاقات التصنيفات")}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="color"
                    value={formState.brandSurfaceColor || '#f8fafc'}
                    onChange={(e) => setFormState({ ...formState, brandSurfaceColor: e.target.value, themePreset: 'custom' })}
                    style={{ width: '32px', height: '28px', padding: 0, border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', background: 'none' }}
                  />
                  <input
                    type="text"
                    value={formState.brandSurfaceColor || '#f8fafc'}
                    onChange={(e) => setFormState({ ...formState, brandSurfaceColor: e.target.value, themePreset: 'custom' })}
                    style={{ width: '74px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', direction: 'ltr', textAlign: 'center' }}
                  />
                </div>
              </div>
            </div>

            {/* Right: Live Interactive Storefront Preview Card */}
            <div
              style={{
                background: formState.brandSurfaceColor || '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '9px',
                boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{t('storefront.storefront_settings_tab.s62', "معاينة المتجر الحية (Live Preview)")}</span>
                  <span style={{ fontSize: '9.5px', background: '#ecfdf5', color: '#059669', padding: '1px 6px', borderRadius: '4px', border: '1px solid #a7f3d0' }}>
                    مطابق للمتجر الحقيقي
                  </span>
                </span>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 2px rgba(34, 197, 94, 0.2)' }} />
              </div>

              {/* Mini Modern Header Mockup */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.95)',
                  border: '1px solid #e2e8f0',
                  borderRadius: '9px',
                  padding: '6px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  {formState.logoUrl ? (
                    <img
                      src={formState.logoUrl}
                      alt="Logo"
                      style={{ width: '20px', height: '20px', borderRadius: '5px', objectFit: 'contain' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '5px',
                        background: formState.brandColor || '#170e5e',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10.5px',
                        fontWeight: 900,
                        flexShrink: 0,
                      }}
                    >
                      {(formState.title || 'M').charAt(0)}
                    </div>
                  )}
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {formState.title || t('storefront.storefront_settings_tab.s63', "متجري الإلكتروني")}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '9.5px',
                      fontWeight: 700,
                      color: '#475569',
                      background: '#f8fafc',
                      padding: '2px 6px',
                      borderRadius: '5px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    طلباتي
                  </span>
                  <span
                    style={{
                      fontSize: '9.5px',
                      fontWeight: 800,
                      background: formState.brandColor || '#170e5e',
                      color: '#ffffff',
                      padding: '2px 8px',
                      borderRadius: '5px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    }}
                  >
                    السلة (2)
                  </span>
                </div>
              </div>

              {/* Mini Hero Editorial Mockup */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(241,245,249,0.9))',
                  border: '1px solid #e2e8f0',
                  borderRadius: '9px',
                  padding: '8px 10px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#0f172a',
                    lineHeight: '1.3',
                  }}
                >
                  {formState.heroHeadline?.trim() || 'أفضل المنتجات بأحسن سعر'}
                </div>
                {formState.heroSubtitle?.trim() && (
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 500,
                      color: '#64748b',
                      marginTop: '2px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {formState.heroSubtitle.trim()}
                  </div>
                )}
              </div>

              {/* Mini Product Card Mockup */}
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '9px',
                  border: '1px solid #e2e8f0',
                  padding: '7px 9px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#0f172a' }}>
                      {t('storefront.storefront_settings_tab.s65', "منتج تجريبي")}
                    </span>
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 800,
                        background: formState.brandSecondaryColor || '#f59e0b',
                        color: '#ffffff',
                        padding: '1px 5px',
                        borderRadius: '4px',
                      }}
                    >
                      {t('storefront.storefront_settings_tab.s66', "خصم 20%")}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', marginTop: '2px' }}>
                    <strong style={{ color: formState.brandColor || '#170e5e', fontWeight: 900 }}>
                      {t('storefront.storefront_settings_tab.s67', "160 ج")}
                    </strong>{' '}
                    <span style={{ fontSize: '9.5px', color: '#94a3b8', textDecoration: 'line-through' }}>
                      {t('storefront.storefront_settings_tab.s68', "200 ج")}
                    </span>
                  </div>
                </div>
                <span
                  style={{
                    background: formState.brandColor || '#170e5e',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '4px 10px',
                    borderRadius: '5px',
                  }}
                >
                  {t('storefront.storefront_settings_tab.s69', "أضف للسلة")}
                </span>
              </div>

              {/* Color Spectrum Chips */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px', borderTop: '1px dashed #cbd5e1' }}>
                <span style={{ fontSize: '9.5px', color: '#64748b', fontWeight: 600 }}>القيم النشطة:</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontFamily: 'monospace', fontSize: '9px', direction: 'ltr' }}>
                  <span style={{ color: formState.brandColor || '#170e5e', fontWeight: 700 }}>P: {formState.brandColor || '#170e5e'}</span>
                  <span style={{ color: '#cbd5e1' }}>|</span>
                  <span style={{ color: formState.brandSecondaryColor || '#f59e0b', fontWeight: 700 }}>A: {formState.brandSecondaryColor || '#f59e0b'}</span>
                  <span style={{ color: '#cbd5e1' }}>|</span>
                  <span style={{ color: '#475569', fontWeight: 700 }}>S: {formState.brandSurfaceColor || '#f8fafc'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
    </>
  );
}
