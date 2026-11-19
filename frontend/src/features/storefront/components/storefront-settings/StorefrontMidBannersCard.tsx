import type { Dispatch, SetStateAction } from 'react';
import type { StorefrontCategory, StorefrontMidBanner } from '../../types/storefront.types';
import {
  Trash2Icon,
  PlusCircleIcon,
  LayersIcon,
  UploadIcon,
} from '@/shared/components/icons/AppIcons';

export interface StorefrontMidBannersCardFormState {
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

export interface StorefrontMidBannersCardProps {
  formState: StorefrontMidBannersCardFormState;
  setFormState: Dispatch<SetStateAction<StorefrontMidBannersCardFormState>>;
  categories: StorefrontCategory[];
  onMidBannerFileChange: (index: number, file: File) => void;
  onAddMidBanner: () => void;
  onUpdateMidBanner: (index: number, updates: Partial<StorefrontMidBanner>) => void;
  onRemoveMidBanner: (index: number) => void;
  compressingMidBannerIdx: number | null;
}

export function StorefrontMidBannersCard({
  formState,
  setFormState,
  categories,
  onMidBannerFileChange,
  onAddMidBanner,
  onUpdateMidBanner,
  onRemoveMidBanner,
  compressingMidBannerIdx,
}: StorefrontMidBannersCardProps) {
  return (
    <>
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
                    onClick={onAddMidBanner}
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
                    onClick={onAddMidBanner}
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
                              onChange={(e) => onUpdateMidBanner(index, { isEnabled: e.target.checked })}
                              style={{ width: '14px', height: '14px', accentColor: '#170e5e' }}
                            />
                            <span>مفعل</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => onRemoveMidBanner(index)}
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
                                if (f) onMidBannerFileChange(index, f);
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
                              onChange={(e) => onUpdateMidBanner(index, { title: e.target.value })}
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
                              onChange={(e) => onUpdateMidBanner(index, { subtitle: e.target.value })}
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
                              onChange={(e) => onUpdateMidBanner(index, { badge: e.target.value })}
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
                              onChange={(e) => onUpdateMidBanner(index, { slot: e.target.value as any })}
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
                              onChange={(e) => onUpdateMidBanner(index, { linkType: e.target.value as any })}
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
                                onChange={(e) => onUpdateMidBanner(index, { categoryId: Number(e.target.value) || undefined })}
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
                                onChange={(e) => onUpdateMidBanner(index, { customUrl: e.target.value })}
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
    </>
  );
}
