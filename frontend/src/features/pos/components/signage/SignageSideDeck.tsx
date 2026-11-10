import { useTranslation } from 'react-i18next';
import React from 'react';
import { SignagePromoItem, SignageTheme } from './types';
import type { BusinessVertical } from '@/shared/verticals/vertical-scope';
import {
  TagIcon,
  AwardIcon,
  QrCodeIcon,
  CreditCardIcon,
  TruckIcon,
  ShieldCheckIcon,
} from '@/shared/components/icons/AppIcons';

interface SignageSideDeckProps {
  promoItems: SignagePromoItem[];
  currentIndex: number;
  onSelectItem: (index: number) => void;
  currencyCode: string;
  qrSvgUrl: string;
  theme?: SignageTheme;
  /* INV-REST-SIGNAGE-OFFER-BOARD-TRUTH (T12-H2): same vertical
   * prop as the header — the deck title, the empty-queue
   * placeholder and the four perk cells all carried showroom copy
   * for every tenant. */
  vertical?: BusinessVertical;
}

export const SignageSideDeck: React.FC<SignageSideDeckProps> = ({
  promoItems,
  currentIndex,
  onSelectItem,
  currencyCode,
  qrSvgUrl,
  theme = 'dark',
  vertical = 'retail_general',
}) => {
  const { t } = useTranslation();
  const isDark = theme === 'dark';
  const isRestaurant = vertical === 'restaurant';

  const upcomingItems = promoItems.filter((_, idx) => idx !== currentIndex);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '14px',
        overflow: 'hidden',
      }}
    >
      {/* 1. Upcoming Deals Queue Deck */}
      <div
        style={{
          backgroundColor: isDark
            ? 'linear-gradient(145deg, #0f172a 0%, #0b1120 100%)'
            : '#ffffff',
          background: isDark
            ? 'linear-gradient(145deg, #0f172a 0%, #0b1120 100%)'
            : '#ffffff',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
          borderRadius: '20px',
          padding: '18px 20px',
          boxShadow: isDark
            ? '0 10px 25px rgba(0, 0, 0, 0.3)'
            : '0 4px 16px rgba(15, 23, 42, 0.04)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          flex: '1 1 auto',
          minHeight: '160px',
        }}
      >
        <div
          style={{
            fontSize: '14.5px',
            fontWeight: 800,
            color: isDark ? '#ffffff' : '#0f172a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TagIcon size={17} color={isDark ? '#38bdf8' : '#170e5e'} />
            <span>
              {t(
                isRestaurant
                  ? 'pos.signage.signage_side_deck.restaurant_s0'
                  : 'pos.signage.signage_side_deck.s0',
                isRestaurant ? 'أطباق إضافية من القائمة' : 'عروض إضافية بالمعرض'
              )}
            </span>
          </div>
          <span
            style={{
              fontSize: '11.5px',
              color: isDark ? '#94a3b8' : '#64748b',
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#f1f5f9',
              padding: '2px 10px',
              borderRadius: '12px',
              fontWeight: 700,
            }}
          >
            {promoItems.length} {t('pos.signage.signage_side_deck.s1', 'عرض متوفر')}
          </span>
        </div>

        {upcomingItems.length === 0 ? (
          <div
            style={{
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid #e2e8f0',
              borderRadius: '14px',
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              flex: 1,
            }}
          >
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '12px',
                backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#eef2ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: isDark ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid #c7d2fe',
                flexShrink: 0,
              }}
            >
              <AwardIcon size={22} color={isDark ? '#38bdf8' : '#170e5e'} />
            </div>
            <div>
              <h4
                style={{
                  margin: 0,
                  fontSize: '14px',
                  fontWeight: 800,
                  color: isDark ? '#ffffff' : '#0f172a',
                }}
              >
                {t(
                  isRestaurant
                    ? 'pos.signage.signage_side_deck.restaurant_s2'
                    : 'pos.signage.signage_side_deck.s2',
                  isRestaurant ? 'عروض وأطباق قائمة اليوم' : 'صفقات وتخفيضات المعرض'
                )}
              </h4>
              <span
                style={{
                  fontSize: '11.5px',
                  color: isDark ? '#94a3b8' : '#64748b',
                  display: 'block',
                  marginTop: '3px',
                }}
              >
                {t(
                  isRestaurant
                    ? 'pos.signage.signage_side_deck.restaurant_s3'
                    : 'pos.signage.signage_side_deck.s3',
                  isRestaurant
                    ? 'تصفح أطباقنا المميزة بأسعار واضحة وطازجة على مدار اليوم'
                    : 'تصفح منتجاتنا المميزة بأسعار تنافسية وضمان معتمد على مدار اليوم'
                )}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, justifyContent: 'center' }}>
            {upcomingItems.slice(0, 2).map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  const foundIdx = promoItems.findIndex((p) => p.id === item.id);
                  if (foundIdx !== -1) onSelectItem(foundIdx);
                }}
                style={{
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : '#f8fafc',
                  border: isDark ? '1px solid rgba(255, 255, 255, 0.07)' : '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '10px',
                      backgroundColor: isDark ? '#1e293b' : '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #e2e8f0',
                      flexShrink: 0,
                    }}
                  >
                    <TagIcon size={18} color={isDark ? '#38bdf8' : '#170e5e'} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h4
                      style={{
                        margin: 0,
                        fontSize: '13.5px',
                        fontWeight: 800,
                        color: isDark ? '#f8fafc' : '#0f172a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.name}
                    </h4>
                    <span style={{ fontSize: '11px', color: isDark ? '#94a3b8' : '#64748b' }}>
                      {item.categoryName}
                    </span>
                  </div>
                </div>

                <div style={{ textAlign: 'left', flexShrink: 0, paddingRight: '10px' }}>
                  <div
                    style={{
                      fontSize: '11.5px',
                      color: isDark ? '#64748b' : '#94a3b8',
                      textDecoration: 'line-through',
                    }}
                  >
                    {item.originalPrice.toFixed(2)} {currencyCode}
                  </div>
                  <div
                    style={{
                      fontSize: '16px',
                      fontWeight: 900,
                      color: isDark ? '#38bdf8' : '#170e5e',
                    }}
                  >
                    {item.promoPrice.toFixed(2)} {currencyCode}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Showroom Perks (2x2 Balanced Grid) */}
      <div
        style={{
          backgroundColor: isDark ? 'linear-gradient(145deg, #0f172a 0%, #0b1120 100%)' : '#ffffff',
          background: isDark ? 'linear-gradient(145deg, #0f172a 0%, #0b1120 100%)' : '#ffffff',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid #e2e8f0',
          borderRadius: '20px',
          padding: '16px 18px',
          boxShadow: isDark
            ? '0 10px 25px rgba(0, 0, 0, 0.3)'
            : '0 4px 16px rgba(15, 23, 42, 0.04)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div
          style={{
            fontSize: '13.5px',
            fontWeight: 800,
            color: isDark ? '#ffffff' : '#0f172a',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AwardIcon size={16} color={isDark ? '#fbbf24' : '#170e5e'} />
          <span>
            {t(
              isRestaurant
                ? 'pos.signage.signage_side_deck.restaurant_s4'
                : 'pos.signage.signage_side_deck.s4',
              isRestaurant ? 'مزايا الطلب في مطعمنا' : 'مزايا التسوق في صالة العرض'
            )}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div
            style={{
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
              padding: '10px 12px',
              borderRadius: '12px',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : '#e0f2fe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AwardIcon size={16} color={isDark ? '#38bdf8' : '#0284c7'} />
            </div>
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: isDark ? '#f8fafc' : '#0f172a',
                }}
              >
                {t(
                  isRestaurant
                    ? 'pos.signage.signage_side_deck.restaurant_s5'
                    : 'pos.signage.signage_side_deck.s5',
                  isRestaurant ? 'طازج كل يوم' : 'فحص وتجربة فورية'
                )}
              </div>
              <div
                style={{
                  fontSize: '10.5px',
                  color: isDark ? '#94a3b8' : '#64748b',
                  marginTop: '1px',
                }}
              >
                {t(
                  isRestaurant
                    ? 'pos.signage.signage_side_deck.restaurant_s6'
                    : 'pos.signage.signage_side_deck.s6',
                  isRestaurant
                    ? 'مكونات طازجة تُحضّر يومياً في مطبخنا'
                    : 'معاينة المنتج قبل الشراء'
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
              padding: '10px 12px',
              borderRadius: '12px',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: isDark ? 'rgba(52, 211, 153, 0.15)' : '#dcfce7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CreditCardIcon size={16} color={isDark ? '#34d399' : '#16a34a'} />
            </div>
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: isDark ? '#f8fafc' : '#0f172a',
                }}
              >
                {t(
                  isRestaurant
                    ? 'pos.signage.signage_side_deck.restaurant_s7'
                    : 'pos.signage.signage_side_deck.s7',
                  isRestaurant ? 'دفع آمن بأي طريقة' : 'دفع إلكتروني آمن'
                )}
              </div>
              <div
                style={{
                  fontSize: '10.5px',
                  color: isDark ? '#94a3b8' : '#64748b',
                  marginTop: '1px',
                }}
              >
                {t('pos.signage.signage_side_deck.s8', 'InstaPay ومحافظ وفيزا')}
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
              padding: '10px 12px',
              borderRadius: '12px',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: isDark ? 'rgba(251, 191, 36, 0.15)' : '#fef3c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <TruckIcon size={16} color={isDark ? '#fbbf24' : '#d97706'} />
            </div>
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: isDark ? '#f8fafc' : '#0f172a',
                }}
              >
                {t(
                  isRestaurant
                    ? 'pos.signage.side_deck.restaurant_pickup_title'
                    : 'pos.signage.side_deck.pickup_title',
                  isRestaurant ? 'صالة وسفري وتوصيل' : 'استلام فوري'
                )}
              </div>
              <div
                style={{
                  fontSize: '10.5px',
                  color: isDark ? '#94a3b8' : '#64748b',
                  marginTop: '1px',
                }}
              >
                {t(
                  isRestaurant
                    ? 'pos.signage.side_deck.restaurant_pickup_desc'
                    : 'pos.signage.side_deck.pickup_desc',
                  isRestaurant
                    ? 'تناول طعامك معنا أو اطلبه إلى بيتك'
                    : 'تسليم مباشر بالصالة'
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
              padding: '10px 12px',
              borderRadius: '12px',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: isDark ? 'rgba(129, 140, 248, 0.15)' : '#e0e7ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <ShieldCheckIcon size={16} color={isDark ? '#818cf8' : '#4f46e5'} />
            </div>
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: isDark ? '#f8fafc' : '#0f172a',
                }}
              >
                {t(
                  isRestaurant
                    ? 'pos.signage.side_deck.restaurant_warranty_title'
                    : 'pos.signage.side_deck.warranty_title',
                  isRestaurant ? 'جودة مضمونة' : 'ضمان معتمد'
                )}
              </div>
              <div
                style={{
                  fontSize: '10.5px',
                  color: isDark ? '#94a3b8' : '#64748b',
                  marginTop: '1px',
                }}
              >
                {t(
                  isRestaurant
                    ? 'pos.signage.side_deck.restaurant_warranty_desc'
                    : 'pos.signage.side_deck.warranty_desc',
                  isRestaurant ? 'أطباق طازجة بجودة مضمونة' : 'فاتورة وضمان استبدال'
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Interactive Scan & Shop QR Hub */}
      <div
        style={{
          backgroundColor: isDark
            ? 'linear-gradient(145deg, #0f172a 0%, #0b1120 100%)'
            : '#ffffff',
          background: isDark
            ? 'linear-gradient(145deg, #0f172a 0%, #0b1120 100%)'
            : '#ffffff',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid #cbd5e1',
          borderRadius: '20px',
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '18px',
          boxShadow: isDark
            ? '0 12px 30px rgba(0, 0, 0, 0.4)'
            : '0 6px 20px rgba(15, 23, 42, 0.05)',
        }}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            padding: '6px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            border: '2px solid #e2e8f0',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          }}
        >
          <img
            src={qrSvgUrl}
            alt="Storefront QR Code"
            style={{ width: '90px', height: '90px', display: 'block' }}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '14.5px',
              fontWeight: 900,
              color: isDark ? '#38bdf8' : '#170e5e',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <QrCodeIcon size={17} color={isDark ? '#38bdf8' : '#170e5e'} />
            <span>{t('pos.signage.signage_side_deck.s9', 'اطلب فورياً من هاتفك')}</span>
          </div>
          <p
            style={{
              margin: '5px 0 0',
              fontSize: '11.5px',
              color: isDark ? '#cbd5e1' : '#64748b',
              lineHeight: 1.5,
            }}
          >
            {t(
              'pos.signage.signage_side_deck.s10',
              'وجّه كاميرا هاتفك نحو رمز الـ QR لتصفح كامل الكتالوج والطلب والتوصيل بضغطة واحدة!'
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
