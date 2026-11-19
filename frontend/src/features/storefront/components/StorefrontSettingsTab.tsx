import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { buildStorePublicUrl, storePublicUrlParts } from '@/lib/store-public-url';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
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
  LightbulbIcon,
  TruckIcon,
  Trash2Icon,
  QrCodeIcon,
  PlusCircleIcon,
  LayersIcon,
  TrendingUpIcon,
  UploadIcon,
} from '@/shared/components/icons/AppIcons';
import { TableQrPrintDialog } from '@/features/pos';
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

            {/* Card 4: إعدادات التشغيل والتوصيل والخدمات */}
            <div
              style={{
                gridColumn: '1 / -1',
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
                  {t('storefront.storefront_settings_tab.s77', "إعدادات التشغيل والتوصيل والخدمات")}
                </h3>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  {t('storefront.storefront_settings_tab.s78', "إعدادات التوصيل، الشحن المجاني، وتوافر المنتجات")}
                </span>
              </div>

              {/* Enable Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  gap: '10px',
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block' }}>
                    {t('storefront.storefront_settings_tab.s79', "تفعيل استقبال الطلبات أونلاين")}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {t('storefront.storefront_settings_tab.s80', "إتاحة أو إيقاف استقبال طلبات الشراء")}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={formState.enabled}
                  onChange={(e) => setFormState({ ...formState, enabled: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: '#170e5e', cursor: 'pointer', flexShrink: 0 }}
                />
              </div>

              {/* Smart Deals Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: formState.smartDealsEnabled ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                  transition: 'all 0.15s ease',
                  gap: '10px',
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block' }}>
                    {t('storefront.storefront_settings_tab.s81', "تفعيل العروض التسويقية الذكية (Smart Deals)")}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {t('storefront.storefront_settings_tab.s82', "توليد شارات وتخفيضات شكلية على الأصناف المميزة لإعطاء مظهر تسويقي جذاب للمتجر")}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={formState.smartDealsEnabled}
                  onChange={(e) => setFormState({ ...formState, smartDealsEnabled: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer', flexShrink: 0 }}
                />
              </div>

              {/* Show Out Of Stock Products (Coming Soon) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: formState.showOutOfStockProducts ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                  transition: 'all 0.15s ease',
                  gap: '10px',
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block' }}>
                    {t('storefront.storefront_settings_tab.s83', "إظهار المنتجات المنتهية من المخزون (بوسم \"ستتوفر قريباً\")")}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {t('storefront.storefront_settings_tab.s84', "عند التفعيل: تظهر الأصناف المنتهية بشارة \"ستتوفر قريباً\" وزر غير متاح للطلب. عند التعطيل: تُخفى تلقائياً من المتجر لتسهيل تجربة الشراء (موصى به).")}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={formState.showOutOfStockProducts}
                  onChange={(e) => setFormState({ ...formState, showOutOfStockProducts: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer', flexShrink: 0 }}
                />
              </div>

              {/* Allow Out Of Stock / Unlimited Stock for Kitchen & Food */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: formState.allowOutOfStockOrders ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                  transition: 'all 0.15s ease',
                  gap: '10px',
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block' }}>
                    {t('storefront.storefront_settings_tab.s85', "السماح بالطلب دون التقيد بالرصيد المخزني (مناسب للمطاعم وتجهيز الوجبات)")}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {t('storefront.storefront_settings_tab.s86', "إظهار الوجبات والأصناف بحالة \"متوفر\" وزر \"أضف للسلة\" مفعل دائماً حتى لو كان رصيد المخزن 0")}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={formState.allowOutOfStockOrders}
                  onChange={(e) => setFormState({ ...formState, allowOutOfStockOrders: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer', flexShrink: 0 }}
                />
              </div>

              {/* Delivery Fee & Min Order */}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '10px', minWidth: 0 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('storefront.storefront_settings_tab.s87', "رسوم التوصيل (")}{getGlobalCurrencySymbol()}):
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formState.deliveryFee}
                    onChange={(e) => setFormState({ ...formState, deliveryFee: Number(e.target.value) })}
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

                <div>
                  <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('storefront.storefront_settings_tab.s88', "الحد الأدنى للطلب (")}{getGlobalCurrencySymbol()}):
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formState.minOrder}
                    onChange={(e) => setFormState({ ...formState, minOrder: Number(e.target.value) })}
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
              </div>

              {/* Delivery Zones Shortcut Tip */}
              <div
                style={{
                  background: '#f0f3ff',
                  border: '1px solid #d8e0fc',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  flexWrap: 'wrap',
                  minWidth: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: '1 1 180px' }}>
                  <LightbulbIcon size={14} color="#170e5e" />
                  <span style={{ fontSize: '11px', color: '#170e5e', fontWeight: 600 }}>
                    {t('storefront.storefront_settings_tab.s89', "هل تريد تحديد أسعار دليفري مختلفة لكل حي أو محافظة تخدمها؟")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('zones')}
                  style={{
                    background: '#170e5e',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '5px 12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {t('storefront.storefront_settings_tab.s90', "إدارة مصفوفة المناطق ↗")}
                </button>
              </div>

              {/* Automatic Free Shipping Threshold Rule */}
              <div
                style={{
                  background: formState.freeShippingEnabled ? '#f0fdf4' : '#f8fafc',
                  border: formState.freeShippingEnabled ? '1.5px solid #86efac' : '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  transition: 'all 0.15s ease',
                  minWidth: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', minWidth: 0 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                      <TruckIcon size={15} color="#170e5e" />
                      <span>{t('storefront.storefront_settings_tab.s91', "تفعيل الشحن المجاني التلقائي (Free Shipping Rule)")}</span>
                    </span>
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '1px' }}>
                      {t('storefront.storefront_settings_tab.s92', "إلغاء رسوم التوصيل تلقائياً عندما يتجاوز إجمالي مشتريات الزبون حداً معيناً")}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.freeShippingEnabled}
                    onChange={(e) => setFormState({ ...formState, freeShippingEnabled: e.target.checked })}
                    style={{ width: '18px', height: '18px', accentColor: '#170e5e', cursor: 'pointer', flexShrink: 0 }}
                  />
                </div>

                {formState.freeShippingEnabled && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                      paddingTop: '6px',
                      borderTop: '1px dashed #bbf7d0',
                      minWidth: 0,
                    }}
                  >
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#166534' }}>
                      {t('storefront.storefront_settings_tab.s93', "شحن مجاني عند الطلب بمبلغ (")}{getGlobalCurrencySymbol()}{t('storefront.storefront_settings_tab.s94', ") أو أكثر:")}
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        min="1"
                        value={formState.freeShippingMinOrder}
                        onChange={(e) =>
                          setFormState({ ...formState, freeShippingMinOrder: Math.max(1, Number(e.target.value)) })
                        }
                        style={{
                          width: '90px',
                          padding: '5px 8px',
                          borderRadius: '6px',
                          border: '1.5px solid #86efac',
                          fontSize: '12.5px',
                          fontWeight: 800,
                          color: '#166534',
                          background: '#ffffff',
                          textAlign: 'center',
                        }}
                      />
                      <span style={{ fontSize: '11px', color: '#15803d' }}>
                        {t('storefront.storefront_settings_tab.s95', "(مثال: 500 جنيه)")}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Card 2.5: بانرات التصفح الإعلانية الفاصلة بين الأقسام (Mid-Page Promos) */}
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
              <div
                style={{
                  borderBottom: '1px solid #f1f5f9',
                  paddingBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <LayersIcon size={16} color="#170e5e" />
                    <span>بانرات التصفح الإعلانية الفاصلة بين الأقسام (Mid-Page Promos)</span>
                    <span style={{ fontSize: '10.5px', fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '4px', padding: '1px 7px' }}>
                      المقاس الموصى به: 1400 × 350 بكسل (4:1)
                    </span>
                  </h3>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    فواصل إعلانية جذابة تفصل بين صفوف وأقسام المنتجات لكسر الملل وتوجيه الزبائن لأقسام وعروض محددة
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                      background: '#f8fafc',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: '1px solid #e2e8f0',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: '#0f172a',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={formState.midBannersEnabled}
                      onChange={(e) => setFormState({ ...formState, midBannersEnabled: e.target.checked })}
                      style={{ width: '15px', height: '15px', accentColor: '#170e5e', cursor: 'pointer' }}
                    />
                    <span>تفعيل البانرات الفاصلة</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddMidBanner}
                    style={{
                      background: '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '5px 12px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <PlusCircleIcon size={14} color="#ffffff" />
                    <span>إضافة بنر فاصل جديد</span>
                  </button>
                </div>
              </div>

              {/* Banners List */}
              {(!formState.midBanners || formState.midBanners.length === 0) ? (
                <div
                  style={{
                    padding: '24px 16px',
                    textAlign: 'center',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px dashed #cbd5e1',
                  }}
                >
                  <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                    لم يتم إضافة أي بنرات فاصلة حتى الآن. يمكنك إضافة بنرات شريطية جذابة تفصل بين الرفوف مثل المتاجر العالمية.
                  </p>
                  <button
                    type="button"
                    onClick={handleAddMidBanner}
                    style={{
                      background: '#ffffff',
                      color: '#170e5e',
                      border: '1px solid #170e5e',
                      borderRadius: '6px',
                      padding: '5px 14px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <PlusCircleIcon size={14} color="#170e5e" />
                    <span>إضافة أول بنر إعلاني فاصل</span>
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {formState.midBanners.map((banner, index) => (
                    <div
                      key={banner.id || `mid-${index}`}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      {/* Banner Header */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 800, background: '#170e5e', color: '#ffffff', padding: '2px 8px', borderRadius: '4px' }}>
                            بنر #{index + 1}
                          </span>
                          <span style={{ fontSize: '11.5px', color: '#0f172a', fontWeight: 700 }}>
                            {banner.title || 'بنر إعلاني فاصل (بدون عنوان)'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={banner.isEnabled !== false}
                              onChange={(e) => handleUpdateMidBanner(index, { isEnabled: e.target.checked })}
                              style={{ width: '14px', height: '14px', accentColor: '#170e5e' }}
                            />
                            <span>مفعل</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => handleRemoveMidBanner(index)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '2px 6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                          >
                            <Trash2Icon size={12} color="#ef4444" />
                            <span>حذف</span>
                          </button>
                        </div>
                      </div>

                      {/* Content Grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'start' }}>
                        {/* Image Preview & Upload */}
                        <div>
                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                            صورة البنر (نسبة 4:1 أو عريضة):
                          </label>
                          <div
                            style={{
                              width: '100%',
                              aspectRatio: '3.6 / 1',
                              borderRadius: '6px',
                              overflow: 'hidden',
                              border: '1px dashed #cbd5e1',
                              background: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              position: 'relative',
                              marginBottom: '6px',
                            }}
                          >
                            {banner.imageUrl ? (
                              <img
                                src={banner.imageUrl}
                                alt="معاينة البنر"
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>لا توجد صورة بعد</span>
                            )}
                          </div>
                          <label
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              width: '100%',
                              padding: '5px 8px',
                              borderRadius: '5px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#170e5e',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              boxSizing: 'border-box',
                            }}
                          >
                            <UploadIcon size={12} color="#170e5e" />
                            <span>
                              {compressingMidBannerIdx === index
                                ? 'جاري ضغط ومعالجة الصورة...'
                                : banner.imageUrl
                                ? 'تغيير صورة البنر'
                                : 'رفع صورة البنر (WebP)'}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              disabled={compressingMidBannerIdx === index}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleMidBannerFileChange(index, f);
                              }}
                            />
                          </label>
                        </div>

                        {/* Text Fields */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                              عنوان البنر (اختياري لو مدمج بالتصميم):
                            </label>
                            <input
                              type="text"
                              value={banner.title || ''}
                              placeholder="مثال: عروض كروت الشاشة والجيمنج"
                              onChange={(e) => handleUpdateMidBanner(index, { title: e.target.value })}
                              style={{
                                width: '100%',
                                padding: '5px 8px',
                                borderRadius: '5px',
                                border: '1px solid #cbd5e1',
                                fontSize: '11.5px',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                              نص توضيحي فرعي (اختياري):
                            </label>
                            <input
                              type="text"
                              value={banner.subtitle || ''}
                              placeholder="مثال: خصم 15% على كروت الشاشة المستعملة الأصلية بضمان معتمد"
                              onChange={(e) => handleUpdateMidBanner(index, { subtitle: e.target.value })}
                              style={{
                                width: '100%',
                                padding: '5px 8px',
                                borderRadius: '5px',
                                border: '1px solid #cbd5e1',
                                fontSize: '11.5px',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                              شارة صغيرة (Badge):
                            </label>
                            <input
                              type="text"
                              value={banner.badge || ''}
                              placeholder="مثال: عرض محدود، جديد، حصرى"
                              onChange={(e) => handleUpdateMidBanner(index, { badge: e.target.value })}
                              style={{
                                width: '100%',
                                padding: '5px 8px',
                                borderRadius: '5px',
                                border: '1px solid #cbd5e1',
                                fontSize: '11.5px',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>
                        </div>

                        {/* Slot & Link Action */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                              موضع الظهور في الصفحة:
                            </label>
                            <select
                              value={banner.slot || 'after_deals'}
                              onChange={(e) => handleUpdateMidBanner(index, { slot: e.target.value as any })}
                              style={{
                                width: '100%',
                                padding: '5px 8px',
                                borderRadius: '5px',
                                border: '1px solid #cbd5e1',
                                fontSize: '11.5px',
                                background: '#ffffff',
                                boxSizing: 'border-box',
                              }}
                            >
                              <option value="after_deals">بعد صف العروض الحصرية الأولى</option>
                              <option value="after_row_1">بعد أول قسم منتجات</option>
                              <option value="after_row_2">بعد ثاني قسم منتجات</option>
                              <option value="bottom">في نهاية الصفحة قبل الفوتر</option>
                            </select>
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                              نوع الرابط عند نقر الزبون:
                            </label>
                            <select
                              value={banner.linkType || 'category'}
                              onChange={(e) => handleUpdateMidBanner(index, { linkType: e.target.value as any })}
                              style={{
                                width: '100%',
                                padding: '5px 8px',
                                borderRadius: '5px',
                                border: '1px solid #cbd5e1',
                                fontSize: '11.5px',
                                background: '#ffffff',
                                boxSizing: 'border-box',
                              }}
                            >
                              <option value="category">الانتقال لتصنيف / قسم محدد</option>
                              <option value="deals">الانتقال للعروض والتخفيضات (Smart Deals)</option>
                              <option value="url">رابط خارجي مخصص</option>
                              <option value="none">بدون رابط (صورة للعرض فقط)</option>
                            </select>
                          </div>

                          {banner.linkType === 'category' && (
                            <div>
                              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                                اختر القسم المرتبط بالبنر:
                              </label>
                              <select
                                value={banner.categoryId || ''}
                                onChange={(e) => handleUpdateMidBanner(index, { categoryId: Number(e.target.value) || undefined })}
                                style={{
                                  width: '100%',
                                  padding: '5px 8px',
                                  borderRadius: '5px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '11.5px',
                                  background: '#ffffff',
                                  boxSizing: 'border-box',
                                }}
                              >
                                <option value="">-- اختر قسماً --</option>
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {banner.linkType === 'url' && (
                            <div>
                              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                                الرابط المخصص:
                              </label>
                              <input
                                type="text"
                                value={banner.customUrl || ''}
                                placeholder="https://..."
                                onChange={(e) => handleUpdateMidBanner(index, { customUrl: e.target.value })}
                                style={{
                                  width: '100%',
                                  padding: '5px 8px',
                                  borderRadius: '5px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '11.5px',
                                  direction: 'ltr',
                                  boxSizing: 'border-box',
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
