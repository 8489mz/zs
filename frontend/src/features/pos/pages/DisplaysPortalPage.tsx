import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { useAppToolbar } from '@/stores/toolbar-store';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { FeatureGate } from '@/shared/components/feature-gate';
import {
  MonitorIcon,
  LaptopIcon,
  UtensilsIcon,
  CheckCircleIcon,
  UsersIcon,
  Maximize2Icon,
  ArrowRightIcon,
  CheckShieldIcon,
  SlidersIcon,
} from '@/shared/components/icons/AppIcons';

interface DisplayCard {
  key: string;
  title: string;
  description: string;
  badge: string;
  path: string;
  windowName: string;
  icon: React.ReactNode;
}

export function DisplaysPortalPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: settings } = useSettingsQuery();

  const isRestaurant = settings?.restaurantModuleEnabled === true;

  const breadcrumbs = useMemo(
    () => [
      {
        label: isRestaurant ? 'المطاعم والكافيهات' : 'المبيعات',
        to: isRestaurant ? undefined : '/sales',
      },
      { label: 'شاشات العرض والتفاعل' },
    ],
    [isRestaurant]
  );

  useAppToolbar(breadcrumbs);

  const cards: DisplayCard[] = [
    {
      key: 'signage',
      title: 'شاشة العروض والأسعار (Digital Signage)',
      description: 'بث ترويجي حي على شاشات التلفزيون، يعرض المنتجات والتخفيضات الكبرى دورياً مع رمز QR للتصفح والطلب من الهاتف.',
      badge: 'شاشات التلفزيون',
      path: '/signage',
      windowName: 'DigitalSignageWindow',
      icon: <LaptopIcon size={26} color="#170e5e" />,
    },
    {
      key: 'customer-display',
      title: 'شاشة العميل (Customer Facing Display)',
      description: 'شاشة تفاعلية مواجهة للعميل عند نقطة البيع (POS)، تعرض الأصناف أثناء المسح والأسعار والإجمالي ورمز الدفع الإلكتروني.',
      badge: 'نقطة البيع والكاشير',
      path: '/pos/customer-display',
      windowName: 'CustomerDisplayWindow',
      icon: <MonitorIcon size={26} color="#170e5e" />,
    },
    {
      key: 'kds',
      title: 'شاشة المطبخ (Kitchen Display - KDS)',
      description: 'شاشة مخصصة لطاقم المطبخ ومحطات التحضير، تستقبل طلبات الكاشير والصالة والتوصيل لحظياً مع تنبيهات صوتية وتنظيم المحطات.',
      badge: 'المطبخ ومحطات التحضير',
      path: '/kds',
      windowName: 'KitchenDisplayWindow',
      icon: <UtensilsIcon size={26} color="#170e5e" />,
    },
    {
      key: 'order-status-board',
      title: 'شاشة إعلان جاهزية الطلبات (Pickup Board)',
      description: 'شاشة صالة الانتظار والاستلام، تعرض الطلبات قيد التحضير والطلبات الجاهزة للاستلام للعملاء وسائقي التوصيل مع نداء صوتي.',
      badge: 'صالة الانتظار والتوصيل',
      path: '/pos/order-status',
      windowName: 'OrderStatusBoardWindow',
      icon: <CheckCircleIcon size={26} color="#170e5e" />,
    },
    {
      key: 'waiter',
      title: 'محطة الويتر وكابتن الصالة (Captain Station)',
      description: 'واجهة سريعة وخفيفة مخصصة لهواتف وأجهزة التابلت المحمولة باليد لطاقم الخدمة لأخذ الطلبات من الطاولات وإرسالها فورياً للمطبخ.',
      badge: 'طاقم الصالة والخدمة',
      path: '/pos/waiter',
      windowName: 'WaiterStationWindow',
      icon: <UsersIcon size={26} color="#170e5e" />,
    },
  ];

  const handleOpenNewWindow = (path: string, windowName: string) => {
    window.open(path, windowName, 'menubar=no,toolbar=no,location=no,status=no,resizable=yes');
  };

  return (
    <FeatureGate feature="restaurant" featureName={t('pos.displays_portal_page.s0', "شاشات العرض والتفاعل")}>
      <div className="page-stack page-shell displays-portal-page" dir="rtl">
        <main
          className="document-prototype-column"
          style={{
            paddingBottom: '80px',
            maxWidth: '1280px',
            margin: '0 auto',
            width: '100%',
          }}
        >
          <PageHeader
            title={t('pos.displays_portal_page.s1', "شاشات العرض والتفاعل")}
            description={t('pos.displays_portal_page.s2', "مركز تشغيل شاشات العرض المباشرة التفاعلية لنقاط البيع ومحطات التحضير والمطبخ")}
            badge={<span className="nav-pill">{cards.length} {t('pos.displays_portal_page.s3', "شاشات مفعلة")}</span>}
          />

          {/* KPI & Live Infrastructure Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
              marginTop: '16px',
            }}
          >
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.02)',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('pos.displays_portal_page.s4', "إجمالي محطات العرض")}</div>
                <div style={{ fontSize: '16px', fontWeight: 900, color: '#170e5e', marginTop: '2px' }}>
                  {cards.length} {t('pos.displays_portal_page.s5', "شاشات تفاعلية")}
                </div>
              </div>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MonitorIcon size={18} color="#170e5e" />
              </div>
            </div>

            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.02)',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('pos.displays_portal_page.s6', "نمط التشغيل المدعوم")}</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                  {t('pos.displays_portal_page.s7', "Dual-Screen / HDMI / تابلت")}
                </div>
              </div>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SlidersIcon size={18} color="#475569" />
              </div>
            </div>

            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.02)',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('pos.displays_portal_page.s8', "زمن المزامنة اللحظية")}</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#047857', marginTop: '2px' }}>
                  {t('pos.displays_portal_page.s9', "0ms لحظي (Local Channel)")}
                </div>
              </div>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckShieldIcon size={18} color="#047857" />
              </div>
            </div>

            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.02)',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('pos.displays_portal_page.s10', "جاهزية المنظومة")}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                  <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>{t('pos.displays_portal_page.s11', "متصل وجاهز للبث")}</span>
                </div>
              </div>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircleIcon size={18} color="#10b981" />
              </div>
            </div>
          </div>

          {/* Cards Grid Centered */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: '20px',
              marginTop: '20px',
            }}
          >
            {cards.map((card) => (
              <div
                key={card.key}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '16px',
                  padding: '24px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '16px',
                  boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(23, 14, 94, 0.07)';
                  e.currentTarget.style.borderColor = '#170e5e';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 2px 6px rgba(15, 23, 42, 0.03)';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                }}
              >
                {/* Top Meta: Icon + Badge */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '14px',
                    }}
                  >
                    <div
                      style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '12px',
                        background: '#eef2ff',
                        border: '1px solid #c7d2fe',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {card.icon}
                    </div>

                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor: '#f8fafc',
                        color: '#475569',
                        border: '1px solid #e2e8f0',
                        padding: '3px 10px',
                        borderRadius: '20px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: '#10b981',
                          display: 'inline-block',
                        }}
                      />
                      <span>{card.badge}</span>
                    </span>
                  </div>

                  {/* Title */}
                  <h3
                    style={{
                      margin: '0 0 8px',
                      fontSize: '15px',
                      fontWeight: 800,
                      color: '#0f172a',
                      letterSpacing: '-0.2px',
                    }}
                  >
                    {card.title}
                  </h3>

                  {/* Description */}
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12.5px',
                      color: '#64748b',
                      lineHeight: 1.6,
                    }}
                  >
                    {card.description}
                  </p>
                </div>

                {/* Action Buttons */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    paddingTop: '14px',
                    borderTop: '1px solid #f1f5f9',
                  }}
                >
                  {/* Primary Button: Open Fullscreen / In-app */}
                  <button
                    type="button"
                    onClick={() => navigate(card.path)}
                    style={{
                      width: '100%',
                      background: '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 16px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      fontWeight: 800,
                      fontSize: '12.5px',
                      boxShadow: '0 2px 6px rgba(23, 14, 94, 0.2)',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#10003b';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#170e5e';
                    }}
                  >
                    <Maximize2Icon size={14} color="#ffffff" />
                    <span>{t('pos.displays_portal_page.s12', "تشغيل الشاشة (ملء الشاشة)")}</span>
                    <ArrowRightIcon size={14} color="#ffffff" />
                  </button>

                  {/* Secondary Button: Open in separate window (Dual monitor / HDMI) */}
                  <button
                    type="button"
                    onClick={() => handleOpenNewWindow(card.path, card.windowName)}
                    style={{
                      width: '100%',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      color: '#334155',
                      borderRadius: '8px',
                      padding: '9px 14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      fontWeight: 700,
                      fontSize: '12px',
                      transition: 'background 0.15s ease, border-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f8fafc';
                      e.currentTarget.style.borderColor = '#170e5e';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                    }}
                    title={t('pos.displays_portal_page.s13', "فتح الشاشة في نافذة منفصلة لعرضها على شاشة ثانية HDMI")}
                  >
                    <span>{t('pos.displays_portal_page.s14', "فتح في نافذة مستقلة (شاشة ثانية)")}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </FeatureGate>
  );
}
export default DisplaysPortalPage;
