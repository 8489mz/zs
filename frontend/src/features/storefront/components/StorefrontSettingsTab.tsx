import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { buildStorePublicUrl, storePublicUrlParts } from '@/lib/store-public-url';
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storefrontApi } from '../api/storefront.api';
import { compressImage } from '@/shared/utils/image-compressor';
import { toast } from '@/shared/components/system-alert';
import { StorefrontProductStudio } from './StorefrontProductStudio';
import { StorefrontCouponsManager } from './StorefrontCouponsManager';
import { StorefrontDeliveryZonesManager } from './StorefrontDeliveryZonesManager';
import { StorefrontPaymentGatewaysManager } from './StorefrontPaymentGatewaysManager';
import { BostaSettingsCard } from './BostaSettingsCard';
import { GccShippingSettingsCard } from './GccShippingSettingsCard';
import { StorefrontIdentityCard } from './storefront-settings/StorefrontIdentityCard';
import type { StorefrontMidBanner } from '../types/storefront.types';
import {
  CheckIcon,
} from '@/shared/components/icons/AppIcons';
import { TableQrPrintDialog } from '@/shared/components/TableQrPrintDialog';
import { StorefrontPixelTrackingCard } from './storefront-settings/StorefrontPixelTrackingCard';
import { StorefrontMidBannersCard } from './storefront-settings/StorefrontMidBannersCard';
import { StorefrontOperationsCard } from './storefront-settings/StorefrontOperationsCard';
import { StorefrontThemeStudioCard } from './storefront-settings/StorefrontThemeStudioCard';
import { StorefrontContactCard } from './storefront-settings/StorefrontContactCard';
import { StorefrontSettingsHeader } from './storefront-settings/StorefrontSettingsHeader';

export function StorefrontSettingsTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'settings' | 'coupons' | 'zones' | 'payments' | 'images' | 'bosta' | 'gcc-shipping'>('settings');
  const [copySuccess, setCopySuccess] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isQrPrintOpen, setIsQrPrintOpen] = useState(false);

  const analyticsQuery = useQuery({
    queryKey: ['storefront-admin-analytics'],
    queryFn: storefrontApi.getAnalytics,
    refetchInterval: 30 * 1000,
  });



  const settingsQuery = useQuery({
    queryKey: ['storefront-admin-settings'],
    queryFn: storefrontApi.getSettings,
  });

  const [formState, setFormState] = useState({
    enabled: true,
    slug: '',
    title: '',
    address: '',
    bio: '',
    logoUrl: '',
    announcement: '',
    bannerUrl: '',
    bannerUrls: [] as string[],
    bannerFit: 'contain' as 'contain' | 'cover',
    bannerPosition: 'center' as string,
    bannerPositions: [] as string[],
    bannerIntervalSeconds: 4,
    smartDealsEnabled: false,
    freeShippingEnabled: false,
    freeShippingMinOrder: 500,
    deliveryFee: 0,
    minOrder: 0,
    whatsappPhone: '',
    customDomain: '',
    heroHeadline: '',
    heroSubtitle: '',
    supportEmail: '',
    contactPhone: '',
    facebookUrl: '',
    instagramUrl: '',
    twitterUrl: '',
    tiktokUrl: '',
    youtubeUrl: '',
    telegramUrl: '',
    brandColor: '#170e5e',
    brandSecondaryColor: '#f59e0b',
    brandSurfaceColor: '#f8fafc',
    themePreset: 'royal_navy',
    pickupEnabled: true,
    metaPixelId: '',
    ga4Id: '',
    tiktokPixelId: '',
    snapchatPixelId: '',
    allowOutOfStockOrders: true,
    showOutOfStockProducts: true,
    heroBannerFullBleed: true,
    midBannersEnabled: true,
    midBanners: [] as StorefrontMidBanner[],
  });



  useEffect(() => {
    if (settingsQuery.data) {
      const urls = settingsQuery.data.bannerUrls && settingsQuery.data.bannerUrls.length > 0
        ? settingsQuery.data.bannerUrls
        : (settingsQuery.data.bannerUrl ? [settingsQuery.data.bannerUrl] : []);

      let initialTitle = settingsQuery.data.title || '';
      let initialAddress = settingsQuery.data.address || '';
      const bName = (settingsQuery.data as any).businessName || '';
      if (!initialAddress && bName && initialTitle.startsWith(bName) && initialTitle.length > bName.length) {
        initialAddress = initialTitle.slice(bName.length).trim().replace(/^[-–—:]\s*/, '');
        initialTitle = bName;
      }

      setFormState({
        enabled: settingsQuery.data.enabled,
        slug: settingsQuery.data.slug || '',
        title: initialTitle,
        address: initialAddress,
        bio: settingsQuery.data.bio || '',
        logoUrl: (settingsQuery.data as any)?.logoUrl || (settingsQuery.data as any)?.logo_url || '',
        announcement: settingsQuery.data.announcement || '',
        bannerUrl: urls[0] || settingsQuery.data.bannerUrl || '',
        bannerUrls: urls,
        bannerFit: (settingsQuery.data.bannerFit || 'contain') as 'contain' | 'cover',
        bannerPosition: settingsQuery.data.bannerPosition || 'center',
        bannerPositions: settingsQuery.data.bannerPositions || [],
        bannerIntervalSeconds: settingsQuery.data.bannerIntervalSeconds || 4,
        smartDealsEnabled: Boolean(settingsQuery.data.smartDealsEnabled),
        freeShippingEnabled: Boolean(settingsQuery.data.freeShippingEnabled),
        freeShippingMinOrder: settingsQuery.data.freeShippingMinOrder !== undefined && settingsQuery.data.freeShippingMinOrder !== null ? Number(settingsQuery.data.freeShippingMinOrder) : 500,
        deliveryFee: settingsQuery.data.deliveryFee || 0,
        minOrder: settingsQuery.data.minOrder || 0,
        whatsappPhone: settingsQuery.data.whatsappPhone || '',
        customDomain: (settingsQuery.data as any).customDomain || '',
        heroHeadline: (settingsQuery.data as any)?.heroHeadline || '',
        heroSubtitle: (settingsQuery.data as any)?.heroSubtitle || '',
        supportEmail: (settingsQuery.data as any)?.supportEmail || '',
        contactPhone: (settingsQuery.data as any)?.contactPhone || '',
        facebookUrl: (settingsQuery.data as any)?.facebookUrl || '',
        instagramUrl: (settingsQuery.data as any)?.instagramUrl || '',
        twitterUrl: (settingsQuery.data as any)?.twitterUrl || '',
        tiktokUrl: (settingsQuery.data as any)?.tiktokUrl || '',
        youtubeUrl: (settingsQuery.data as any)?.youtubeUrl || '',
        telegramUrl: (settingsQuery.data as any)?.telegramUrl || '',
        brandColor: settingsQuery.data.brandColor || '#170e5e',
        brandSecondaryColor: (settingsQuery.data as any).brandSecondaryColor || '#f59e0b',
        brandSurfaceColor: (settingsQuery.data as any).brandSurfaceColor || '#f8fafc',
        themePreset: (settingsQuery.data as any).themePreset || 'royal_navy',
        pickupEnabled: settingsQuery.data.pickupEnabled !== false,
        metaPixelId: settingsQuery.data.metaPixelId || '',
        ga4Id: settingsQuery.data.ga4Id || '',
        tiktokPixelId: settingsQuery.data.tiktokPixelId || '',
        snapchatPixelId: settingsQuery.data.snapchatPixelId || '',
        allowOutOfStockOrders: (settingsQuery.data as any).allowOutOfStockOrders !== false,
        showOutOfStockProducts: (settingsQuery.data as any).showOutOfStockProducts !== false,
        heroBannerFullBleed: (settingsQuery.data as any).heroBannerFullBleed !== false,
        midBannersEnabled: (settingsQuery.data as any).midBannersEnabled !== false,
        midBanners: (settingsQuery.data as any).midBanners || [],
      });
    }
  }, [settingsQuery.data]);



  const updateMutation = useMutation({
    mutationFn: storefrontApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-settings'] });
      setSavedSuccess(true);
      toast.success(t('storefront.storefront_settings_tab.save_success', 'تم حفظ وتطبيق كافة إعدادات المتجر بنجاح!'));
      setTimeout(() => setSavedSuccess(false), 3500);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر حفظ إعدادات المتجر، يرجى المحاولة مرة أخرى.');
    },
  });

  const storeSlug = settingsQuery.data?.slug || 'default';
  const storeUrl = buildStorePublicUrl(storeSlug);
  const slugUrlParts = storePublicUrlParts();

  const handleCopy = () => {
    navigator.clipboard.writeText(storeUrl);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };



  const [isCompressingLogo, setIsCompressingLogo] = useState(false);
  const [logoCompressFeedback, setLogoCompressFeedback] = useState<string | null>(null);

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsCompressingLogo(true);
      setLogoCompressFeedback('جاري ضغط ومعالجة الشعار...');

      const res = await compressImage(file, {
        maxWidth: 360,
        maxHeight: 360,
        initialQuality: 0.88,
        maxSizeKb: 40,
      });

      setFormState((prev) => ({
        ...prev,
        logoUrl: res.dataUrl,
      }));

      setLogoCompressFeedback(`تم تجهيز الشعار بنجاح (${res.compressedSizeKb}KB)`);
      setIsCompressingLogo(false);
      e.target.value = '';
    } catch (err: any) {
      setLogoCompressFeedback(`فشل ضغط الشعار: ${err.message || 'خطأ غير متوقع'}`);
      setIsCompressingLogo(false);
    }
  };

  const handleRemoveLogo = () => {
    setFormState((prev) => ({
      ...prev,
      logoUrl: '',
    }));
    setLogoCompressFeedback(null);
  };



  const catalogQuery = useQuery({
    queryKey: ['storefront-catalog', formState.slug || storeSlug],
    queryFn: () => storefrontApi.getCatalog(formState.slug || storeSlug),
    enabled: Boolean(formState.slug || storeSlug),
    staleTime: 60 * 1000,
  });
  const categories = catalogQuery.data?.categories || [];

  const [compressingMidBannerIdx, setCompressingMidBannerIdx] = useState<number | null>(null);

  const handleMidBannerFileChange = async (index: number, file: File) => {
    try {
      setCompressingMidBannerIdx(index);
      const res = await compressImage(file, {
        maxWidth: 1600,
        maxHeight: 480,
        initialQuality: 0.85,
        maxSizeKb: 75,
      });

      setFormState((prev) => {
        const next = [...(prev.midBanners || [])];
        if (next[index]) {
          next[index] = { ...next[index], imageUrl: res.dataUrl };
        }
        return { ...prev, midBanners: next };
      });
      setCompressingMidBannerIdx(null);
    } catch (err: any) {
      toast.error(`فشل ضغط البنر: ${err.message || 'خطأ غير متوقع'}`);
      setCompressingMidBannerIdx(null);
    }
  };

  const handleAddMidBanner = () => {
    setFormState((prev) => {
      const current = prev.midBanners || [];
      const newBanner: StorefrontMidBanner = {
        id: `mid-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        imageUrl: '',
        title: '',
        subtitle: '',
        badge: '',
        linkType: 'category',
        categoryId: categories[0]?.id ? Number(categories[0].id) : undefined,
        customUrl: '',
        slot: current.length === 0 ? 'after_deals' : current.length === 1 ? 'after_row_1' : current.length === 2 ? 'after_row_2' : 'bottom',
        isEnabled: true,
      };
      return {
        ...prev,
        midBanners: [...current, newBanner],
      };
    });
  };

  const handleUpdateMidBanner = (index: number, updates: Partial<StorefrontMidBanner>) => {
    setFormState((prev) => {
      const next = [...(prev.midBanners || [])];
      if (next[index]) {
        next[index] = { ...next[index], ...updates };
      }
      return { ...prev, midBanners: next };
    });
  };

  const handleRemoveMidBanner = (index: number) => {
    setFormState((prev) => {
      const next = (prev.midBanners || []).filter((_, idx) => idx !== index);
      return { ...prev, midBanners: next };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formState);
  };

  if (settingsQuery.isLoading) {
    return <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>{t('storefront.storefront_settings_tab.s0', "جاري تحميل إعدادات المتجر...")}</div>;
  }

  return (
    <div className="storefront-tab-root" style={{ width: '100%', direction: 'rtl' }}>
      <StorefrontSettingsHeader
        storeUrl={storeUrl}
        storeSlug={storeSlug}
        copySuccess={copySuccess}
        pendingOrders={analyticsQuery.data?.pendingOrders}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        savedSuccess={savedSuccess}
        onCopy={handleCopy}
        onOpenQr={() => setIsQrPrintOpen(true)}
        onGoToOrders={() => navigate('/online-orders')}
      />

      {/* Tab 1: Symmetrical 2-Column Cards - Compact & Proportional to Image 1 */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <div
            className="storefront-settings-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '14px',
              marginBottom: '14px',
            }}
          >
            <StorefrontIdentityCard
              formState={formState}
              setFormState={setFormState}
              storeSlug={storeSlug}
              slugUrlParts={slugUrlParts}
              onLogoFileChange={handleLogoFileChange}
              onRemoveLogo={handleRemoveLogo}
              isCompressingLogo={isCompressingLogo}
              logoCompressFeedback={logoCompressFeedback}
            />

            <StorefrontContactCard formState={formState} setFormState={setFormState} />

            <StorefrontThemeStudioCard
              formState={formState}
              setFormState={setFormState}
            />

            <StorefrontOperationsCard formState={formState} setFormState={setFormState} setActiveTab={setActiveTab} />

            <StorefrontMidBannersCard
              formState={formState}
              setFormState={setFormState}
              categories={categories}
              onMidBannerFileChange={handleMidBannerFileChange}
              onAddMidBanner={handleAddMidBanner}
              onUpdateMidBanner={handleUpdateMidBanner}
              onRemoveMidBanner={handleRemoveMidBanner}
              compressingMidBannerIdx={compressingMidBannerIdx}
            />

            <StorefrontPixelTrackingCard formState={formState} setFormState={setFormState} />
          </div>

          {/* Save Action Button with Direct Visual Feedback & Animations */}
          <div style={{ width: '100%', marginTop: '8px' }}>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              style={{
                width: '100%',
                padding: '11px 16px',
                borderRadius: '8px',
                background: savedSuccess ? '#16a34a' : updateMutation.isPending ? '#334155' : '#170e5e',
                color: '#ffffff',
                fontSize: '13.5px',
                fontWeight: 800,
                border: 'none',
                cursor: updateMutation.isPending ? 'wait' : 'pointer',
                boxShadow: savedSuccess
                  ? '0 2px 10px rgba(22, 163, 74, 0.35)'
                  : '0 2px 6px rgba(23, 14, 94, 0.25)',
                transition: 'all 0.25s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transform: savedSuccess ? 'scale(1.008)' : 'none',
              }}
              onMouseEnter={(e) => {
                if (!savedSuccess && !updateMutation.isPending) e.currentTarget.style.background = '#110a47';
              }}
              onMouseLeave={(e) => {
                if (!savedSuccess && !updateMutation.isPending) e.currentTarget.style.background = '#170e5e';
              }}
            >
              {updateMutation.isPending ? (
                <span>{t('storefront.storefront_settings_tab.s163', "جاري الحفظ والمعالجة...")}</span>
              ) : savedSuccess ? (
                <>
                  <CheckIcon size={18} color="#ffffff" />
                  <span>تم حفظ وتطبيق كافة إعدادات المتجر بنجاح!</span>
                </>
              ) : (
                <span>{t('storefront.storefront_settings_tab.s164', "حفظ إعدادات المتجر")}</span>
              )}
            </button>

            {savedSuccess && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  background: '#f0fdf4',
                  border: '1.5px solid #86efac',
                  borderRadius: '8px',
                  color: '#15803d',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  marginTop: '8px',
                  boxShadow: '0 1px 4px rgba(22, 163, 74, 0.12)',
                }}
              >
                <CheckIcon size={16} color="#16a34a" />
                <span>تم تحديث وحفظ بيانات وهوية المتجر بنجاح! التغييرات مفعلة مباشرة الآن.</span>
              </div>
            )}
          </div>
        </form>
      )}

      {/* Tab 2: Coupons Manager */}
      {activeTab === 'coupons' && <StorefrontCouponsManager />}

      {/* Tab 3: Delivery Zones Matrix */}
      {activeTab === 'zones' && <StorefrontDeliveryZonesManager />}

      {/* Tab 4: Online Payment Gateways */}
      {activeTab === 'payments' && <StorefrontPaymentGatewaysManager />}

      {/* Tab 5: Product Studio in Full Width Grid */}
      {activeTab === 'images' && <StorefrontProductStudio slug={storeSlug} />}

      {/* Tab 6: Bosta Shipping Gateway */}
      {activeTab === 'bosta' && <BostaSettingsCard />}

      {/* Tab 7: GCC Shipping Gateways (Aramex & SMSA Express) */}
      {activeTab === 'gcc-shipping' && <GccShippingSettingsCard />}

      <TableQrPrintDialog
        open={isQrPrintOpen}
        onClose={() => setIsQrPrintOpen(false)}
        slug={storeSlug}
      />
    </div>
  );
}
