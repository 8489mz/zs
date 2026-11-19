import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { LightbulbIcon, TruckIcon } from '@/shared/components/icons/AppIcons';
import type { StorefrontMidBanner } from '../../types/storefront.types';

export type StorefrontSettingsTabId =
  | 'settings'
  | 'coupons'
  | 'zones'
  | 'payments'
  | 'images'
  | 'bosta'
  | 'gcc-shipping';

export interface StorefrontOperationsFormState {
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

export interface StorefrontOperationsCardProps {
  formState: StorefrontOperationsFormState;
  setFormState: Dispatch<SetStateAction<StorefrontOperationsFormState>>;
  setActiveTab: Dispatch<SetStateAction<StorefrontSettingsTabId>>;
}

export function StorefrontOperationsCard({
  formState,
  setFormState,
  setActiveTab,
}: StorefrontOperationsCardProps) {
  const { t } = useTranslation();

  return (
    <>
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
    </>
  );
}
