import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { StorefrontMidBanner } from '../../types/storefront.types';

export interface StorefrontContactCardFormState {
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

export interface StorefrontContactCardProps {
  formState: StorefrontContactCardFormState;
  setFormState: Dispatch<SetStateAction<StorefrontContactCardFormState>>;
}

export function StorefrontContactCard({ formState, setFormState }: StorefrontContactCardProps) {
  const { t } = useTranslation();

  return (
    <>
            {/* Card 2: بيانات التواصل ومنصات السوشيال ميديا */}
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
                  {t('storefront.storefront_settings_tab.contact_social_title', "التواصل ومنصات السوشيال ميديا")}
                </h3>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  {t('storefront.storefront_settings_tab.contact_social_subtitle', "البريد الإلكتروني، أرقام الدعم، وروابط حساباتك لربطها بالمتجر")}
                </span>
              </div>

              {/* Support Email */}
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('storefront.storefront_settings_tab.support_email_label', "البريد الإلكتروني لخدمة العملاء والدعم (Support Email):")}
                </label>
                <input
                  type="email"
                  value={formState.supportEmail}
                  onChange={(e) => setFormState({ ...formState, supportEmail: e.target.value.trim() })}
                  placeholder="support@mybrand.com"
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
                  }}
                />
                <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '3px' }}>
                  {t('storefront.storefront_settings_tab.support_email_help', "يظهر في الفوتر وفي نافذة (تواصل معنا) لتمكين الزبائن من مراسلتك مباشرة")}
                </span>
              </div>

              {/* WhatsApp Phone */}
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('storefront.storefront_settings_tab.s44', "رقم واتساب المخصص لاستقبال الطلبات (WhatsApp):")}
                </label>
                <input
                  type="tel"
                  value={formState.whatsappPhone}
                  onChange={(e) => setFormState({ ...formState, whatsappPhone: e.target.value })}
                  placeholder="01012345678"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '12.5px',
                    background: '#ffffff',
                    fontFamily: 'inherit',
                    direction: 'ltr',
                    textAlign: 'right',
                  }}
                />
                <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '3px' }}>
                  {t('storefront.storefront_settings_tab.whatsapp_help', "يفتح محادثة واتساب فورية مباشرة مع العميل بضغطة زر واحدة")}
                </span>
              </div>

              {/* Customer Service / Secondary Phone */}
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('storefront.storefront_settings_tab.contact_phone_label', "رقم هاتف خدمة العملاء أو الخط الساخن (Phone):")}
                </label>
                <input
                  type="tel"
                  value={formState.contactPhone}
                  onChange={(e) => setFormState({ ...formState, contactPhone: e.target.value })}
                  placeholder="0221234567"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '12.5px',
                    background: '#ffffff',
                    fontFamily: 'inherit',
                    direction: 'ltr',
                    textAlign: 'right',
                  }}
                />
                <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '3px' }}>
                  {t('storefront.storefront_settings_tab.contact_phone_help', "رقم هاتف إضافي للمكالمات والاستفسارات يظهر في الفوتر ومعلومات التواصل")}
                </span>
              </div>

              {/* Pickup / Click & Collect Toggle */}
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
                    {t('storefront.storefront_settings_tab.s70', "تفعيل استلام الطلبات من الفرع (Click & Collect)")}
                  </span>
                  <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                    {t('storefront.storefront_settings_tab.s71', "يتيح للزبائن اختيار استلام طلبهم ذاتياً من مقركم بدون مصاريف توصيل")}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={formState.pickupEnabled}
                  onChange={(e) => setFormState({ ...formState, pickupEnabled: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: '#170e5e', cursor: 'pointer', flexShrink: 0 }}
                />
              </div>

              {/* Social Media Section Container */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  marginTop: '2px',
                }}
              >
                <div>
                  <h4 style={{ margin: 0, fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                    {t('storefront.storefront_settings_tab.social_section_title', "روابط منصات التواصل الاجتماعي (Social Media)")}
                  </h4>
                  <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                    {t('storefront.storefront_settings_tab.social_section_subtitle', "أدخل روابط حساباتك الرسمية لربطها وتفعيل أيقوناتها التفاعلية في فوتر المتجر")}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {/* Facebook */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                      فيسبوك (Facebook):
                    </label>
                    <input
                      type="url"
                      value={formState.facebookUrl}
                      onChange={(e) => setFormState({ ...formState, facebookUrl: e.target.value.trim() })}
                      placeholder="https://facebook.com/..."
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: '6px',
                        border: '1.5px solid #cbd5e1',
                        fontSize: '11.5px',
                        background: '#ffffff',
                        fontFamily: 'monospace',
                        direction: 'ltr',
                        textAlign: 'left',
                      }}
                    />
                  </div>

                  {/* Instagram */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                      إنستغرام (Instagram):
                    </label>
                    <input
                      type="url"
                      value={formState.instagramUrl}
                      onChange={(e) => setFormState({ ...formState, instagramUrl: e.target.value.trim() })}
                      placeholder="https://instagram.com/..."
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: '6px',
                        border: '1.5px solid #cbd5e1',
                        fontSize: '11.5px',
                        background: '#ffffff',
                        fontFamily: 'monospace',
                        direction: 'ltr',
                        textAlign: 'left',
                      }}
                    />
                  </div>

                  {/* Twitter / X */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                      إكس / تويتر (Twitter / X):
                    </label>
                    <input
                      type="url"
                      value={formState.twitterUrl}
                      onChange={(e) => setFormState({ ...formState, twitterUrl: e.target.value.trim() })}
                      placeholder="https://x.com/..."
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: '6px',
                        border: '1.5px solid #cbd5e1',
                        fontSize: '11.5px',
                        background: '#ffffff',
                        fontFamily: 'monospace',
                        direction: 'ltr',
                        textAlign: 'left',
                      }}
                    />
                  </div>

                  {/* TikTok */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                      تيك توك (TikTok):
                    </label>
                    <input
                      type="url"
                      value={formState.tiktokUrl}
                      onChange={(e) => setFormState({ ...formState, tiktokUrl: e.target.value.trim() })}
                      placeholder="https://tiktok.com/@..."
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: '6px',
                        border: '1.5px solid #cbd5e1',
                        fontSize: '11.5px',
                        background: '#ffffff',
                        fontFamily: 'monospace',
                        direction: 'ltr',
                        textAlign: 'left',
                      }}
                    />
                  </div>

                  {/* YouTube */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                      يوتيوب (YouTube):
                    </label>
                    <input
                      type="url"
                      value={formState.youtubeUrl}
                      onChange={(e) => setFormState({ ...formState, youtubeUrl: e.target.value.trim() })}
                      placeholder="https://youtube.com/@..."
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: '6px',
                        border: '1.5px solid #cbd5e1',
                        fontSize: '11.5px',
                        background: '#ffffff',
                        fontFamily: 'monospace',
                        direction: 'ltr',
                        textAlign: 'left',
                      }}
                    />
                  </div>

                  {/* Telegram */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                      تليجرام (Telegram):
                    </label>
                    <input
                      type="url"
                      value={formState.telegramUrl}
                      onChange={(e) => setFormState({ ...formState, telegramUrl: e.target.value.trim() })}
                      placeholder="https://t.me/..."
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        borderRadius: '6px',
                        border: '1.5px solid #cbd5e1',
                        fontSize: '11.5px',
                        background: '#ffffff',
                        fontFamily: 'monospace',
                        direction: 'ltr',
                        textAlign: 'left',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
    </>
  );
}
