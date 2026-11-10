import { useTranslation } from 'react-i18next';
import React from 'react';
import { RestaurantOperationsDialog } from './RestaurantOperationsDialog';
import {
  MonitorIcon,
  LaptopIcon,
  UtensilsIcon,
  CheckCircleIcon,
  UsersIcon,
  SlidersIcon,
  Maximize2Icon,
} from '@/shared/components/icons/AppIcons';
import {
  openCustomerDisplayWindow,
  openKitchenDisplayWindow,
  openDigitalSignageWindow,
} from '@/features/pos/lib/pos-customer-display-bridge';
import { toast } from '@/shared/components/system-alert';

interface PosDisplaysModalProps {
  open: boolean;
  onClose: () => void;
  isRestaurantActive: boolean;
}

interface DisplayTile {
  key: string;
  title: string;
  tag: string;
  renderIcon: (size: number, color?: string) => React.ReactNode;
  description: string;
  hint: string;
  features: string[];
  actionLabel?: string;
  onLaunch: () => void;
  isRestaurantOnly?: boolean;
}

interface DisplayCardProps {
  tile: DisplayTile;
  isHeroMode: boolean;
}

function DisplayCard({ tile, isHeroMode }: DisplayCardProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = React.useState(false);

  if (isHeroMode) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={tile.onLaunch}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            tile.onLaunch();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: '#ffffff',
          border: `1.5px solid ${hovered ? '#170e5e' : '#e2e8f0'}`,
          borderRadius: '16px',
          padding: '22px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          cursor: 'pointer',
          boxSizing: 'border-box',
          minWidth: 0,
          height: '100%',
          boxShadow: hovered
            ? '0 12px 28px -6px rgba(23, 14, 94, 0.14), 0 4px 12px rgba(15, 23, 42, 0.05)'
            : '0 2px 6px rgba(15, 23, 42, 0.04)',
          transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
          transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
          userSelect: 'none',
        }}
      >
        {/* Top Header: Icon + Tag */}
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
                width: '54px',
                height: '54px',
                borderRadius: '14px',
                background: hovered ? '#eef2ff' : '#f8fafc',
                border: `1px solid ${hovered ? '#c7d2fe' : '#e2e8f0'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.18s ease',
              }}
            >
              {tile.renderIcon(26, hovered ? '#170e5e' : '#1e293b')}
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                color: hovered ? '#170e5e' : '#475569',
                background: hovered ? '#eef2ff' : '#f1f5f9',
                border: `1px solid ${hovered ? '#c7d2fe' : '#e2e8f0'}`,
                padding: '4px 11px',
                borderRadius: '8px',
                flexShrink: 0,
                transition: 'all 0.18s ease',
              }}
            >
              {tile.tag}
            </span>
          </div>

          {/* Title */}
          <h4
            style={{
              margin: '0 0 8px',
              fontSize: '15.5px',
              fontWeight: 900,
              color: '#0f172a',
              lineHeight: 1.35,
            }}
          >
            {tile.title}
          </h4>

          {/* Description */}
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              color: '#64748b',
              lineHeight: 1.6,
              textAlign: 'justify',
              textJustify: 'inter-word',
              textAlignLast: 'start',
            }}
          >
            {tile.description}
          </p>

          {/* Feature Highlights */}
          {tile.features && tile.features.length > 0 && (
            <div
              style={{
                marginTop: '14px',
                padding: '10px 12px',
                background: '#f8fafc',
                border: '1px solid #f1f5f9',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '7px',
              }}
            >
              {tile.features.map((feat, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '11.5px',
                    color: '#334155',
                    fontWeight: 600,
                  }}
                >
                  <CheckCircleIcon size={14} color="#059669" />
                  <span style={{ lineHeight: 1.3 }}>{feat}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Section: Hint + Action Button */}
        <div style={{ marginTop: '14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
              paddingTop: '8px',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
              {tile.hint}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '10.5px',
                color: '#059669',
                fontWeight: 700,
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#059669',
                  display: 'inline-block',
                }}
              />
              {t('pos.pos_workspace.pos_displays_modal.ready', 'متصل وجاهز')}
            </span>
          </div>

          <div
            style={{
              width: '100%',
              height: '40px',
              borderRadius: '9px',
              background: hovered ? '#170e5e' : '#eef2ff',
              color: hovered ? '#ffffff' : '#170e5e',
              border: `1px solid ${hovered ? '#170e5e' : '#c7d2fe'}`,
              fontSize: '12.5px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '7px',
              transition: 'all 0.15s ease',
              boxShadow: hovered ? '0 4px 12px rgba(23, 14, 94, 0.2)' : 'none',
              boxSizing: 'border-box',
            }}
          >
            <Maximize2Icon size={15} color={hovered ? '#ffffff' : '#170e5e'} />
            <span>{tile.actionLabel || t('pos.pos_workspace.pos_displays_modal.s0', 'تشغيل الشاشة')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={tile.onLaunch}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          tile.onLaunch();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? '#f8fafc' : '#ffffff',
        border: `1px solid ${hovered ? '#170e5e' : '#e2e8f0'}`,
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '8px',
        cursor: 'pointer',
        boxSizing: 'border-box',
        minWidth: 0,
        height: '100%',
        minHeight: '185px',
        boxShadow: hovered ? '0 6px 18px rgba(15, 23, 42, 0.06)' : '0 1px 3px rgba(0, 0, 0, 0.02)',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'all 0.15s ease',
        userSelect: 'none',
      }}
    >
      {/* Top section: Icon + Content */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 }}>
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: hovered ? '#eef2ff' : '#f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background 0.15s ease',
          }}
        >
          {tile.renderIcon(22, '#170e5e')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
            <h4
              style={{
                margin: 0,
                fontSize: '14px',
                fontWeight: 800,
                color: '#0f172a',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {tile.title}
            </h4>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                color: '#475569',
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
                padding: '2px 8px',
                borderRadius: '6px',
                flexShrink: 0,
              }}
            >
              {tile.tag}
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: '11.5px',
              color: '#64748b',
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textAlign: 'justify',
              textJustify: 'inter-word',
              textAlignLast: 'start',
            }}
          >
            {tile.description}
          </p>
        </div>
      </div>

      {/* Bottom action bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid #f1f5f9',
          paddingTop: '8px',
          marginTop: 'auto',
        }}
      >
        <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
          {tile.hint}
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 12px',
            borderRadius: '7px',
            background: hovered ? '#170e5e' : '#eef2ff',
            color: hovered ? '#ffffff' : '#170e5e',
            border: `1px solid ${hovered ? '#170e5e' : '#c7d2fe'}`,
            fontSize: '11px',
            fontWeight: 800,
            transition: 'all 0.15s ease',
          }}
        >
          <Maximize2Icon size={13} color={hovered ? '#ffffff' : '#170e5e'} />
          <span>{tile.actionLabel || t('pos.pos_workspace.pos_displays_modal.s0', 'تشغيل الشاشة')}</span>
        </span>
      </div>
    </div>
  );
}

export function PosDisplaysModal({ open, onClose, isRestaurantActive }: PosDisplaysModalProps) {
  const { t: __t } = useTranslation();
  const handleLaunch = (name: string, fn: () => void) => {
    fn();
    toast.success(`تم فتح ${name} بنجاح`);
    onClose();
  };

  const tiles: DisplayTile[] = [
    {
      key: 'customer-display',
      title: 'شاشة العميل (Customer Display)',
      tag: 'مواجهة للزبون',
      renderIcon: (size: number, color = '#170e5e') => <MonitorIcon size={size} color={color} />,
      description: 'شاشة تفاعلية مواجهة للزبون تعرض الأصناف الممسوحة والأسعار والإجمالي ورمز الدفع الإلكتروني لحظياً.',
      hint: 'شاشة مزدوجة · Dual Screen',
      features: [
        'بث فوري للأصناف والأسعار أثناء المسح',
        'عرض ملخص الفاتورة والضريبة والخصم',
        'إظهار رمز QR للدفع الإلكتروني السريع',
      ],
      actionLabel: 'تشغيل شاشة العميل',
      onLaunch: () => handleLaunch('شاشة العميل', () => openCustomerDisplayWindow()),
    },
    {
      key: 'signage',
      title: 'شاشة العروض والأسعار (Signage)',
      tag: 'تلفزيون الصالة',
      renderIcon: (size: number, color = '#170e5e') => <LaptopIcon size={size} color={color} />,
      description: 'بث ترويجي حي على شاشات التلفزيون لعرض المنتجات والتخفيضات الكبرى وقوائم الأسعار دورياً مع رمز QR.',
      hint: 'تلفزيون · TV Signage',
      features: [
        'بث ترويجي دوري للمنتجات والتخفيضات',
        'تحديث حي وتلقائي لقوائم الأسعار والكتالوج',
        'رمز QR لتصفح المتجر والطلب الذاتي',
      ],
      actionLabel: 'تشغيل شاشة التلفزيون',
      onLaunch: () => handleLaunch('شاشة العروض والأسعار', () => openDigitalSignageWindow()),
    },
    {
      key: 'kds',
      title: 'شاشة المطبخ (Kitchen Display - KDS)',
      tag: 'المطبخ والشيف',
      renderIcon: (size: number, color = '#170e5e') => <UtensilsIcon size={size} color={color} />,
      description: 'شاشة تفاعلية لطاقم المطبخ تستقبل طلبات الكاشير والصالة والتوصيل لحظياً مع تنبيهات صوتية وتنظيم المحطات.',
      hint: 'محطة التحضير · KDS Station',
      features: [
        'استقبال أوامر الكاشير والصالة لحظياً',
        'تنبيهات صوتية فورية وإدارة وقت التحضير',
        'تنظيم الطلبات حسب محطات الطهي والأقسام',
      ],
      actionLabel: 'تشغيل شاشة المطبخ KDS',
      isRestaurantOnly: true,
      onLaunch: () => handleLaunch('شاشة المطبخ KDS', () => openKitchenDisplayWindow()),
    },
    {
      key: 'order-status',
      title: 'شاشة جاهزية الطلبات (Pickup Board)',
      tag: 'صالة الانتظار',
      renderIcon: (size: number, color = '#170e5e') => <CheckCircleIcon size={size} color={color} />,
      description: 'شاشة صالة الانتظار والاستلام، تعرض الطلبات الجاهزة وقيد التحضير للعملاء وسائقي التوصيل مع نداء صوتي.',
      hint: 'لوحة الاستلام · Pickup Board',
      features: [
        'عرض الطلبات الجاهزة وقيد التحضير',
        'نداء رقمي للزبائن ومندوبي التوصيل',
        'تزامن مباشر مع KDS ومحطات الكاشير',
      ],
      actionLabel: 'تشغيل شاشة الاستلام',
      isRestaurantOnly: true,
      onLaunch: () =>
        handleLaunch('شاشة جاهزية الطلبات', () => {
          window.open('/pos/order-status', 'OrderStatusBoardWindow', 'menubar=no,toolbar=no,location=no,status=no,resizable=yes');
        }),
    },
    {
      key: 'waiter',
      title: 'محطة الويتر وكابتن الصالة (Captain Station)',
      tag: 'أجهزة لوحية',
      renderIcon: (size: number, color = '#170e5e') => <UsersIcon size={size} color={color} />,
      description: 'واجهة لمسية سريعة وخفيفة للأجهزة المحمولة باليد لطاقم الخدمة لأخذ طلبات الطاولات وفتح الشيكات الميدانية.',
      hint: 'أجهزة محمولة · Handheld Waiter',
      features: [
        'واجهة لمسية سريعة للأجهزة اللوحية والهواتف',
        'فتح وتعديل طلبات الطاولات والشيكات',
        'إرسال فوري لأوامر التحضير لمطبخ المطعم',
      ],
      actionLabel: 'تشغيل محطة الويتر',
      isRestaurantOnly: true,
      onLaunch: () =>
        handleLaunch('محطة الويتر وكابتن الصالة', () => {
          window.open('/pos/waiter', 'WaiterStationWindow', 'menubar=no,toolbar=no,location=no,status=no,resizable=yes');
        }),
    },
    {
      key: 'displays-portal',
      title: 'بوابة وإعدادات شاشات العرض',
      tag: 'إدارة متقدمة',
      renderIcon: (size: number, color = '#170e5e') => <SlidersIcon size={size} color={color} />,
      description: 'مركز تخصيص وإعدادات شاشات العرض، وتحديد البانرات وقوائم الأسعار المعروضة وتنسيقات البث المباشر.',
      hint: 'لوحة التحكم · Displays Portal',
      features: [
        'تخصيص الهوية البصرية والثيمات والألوان',
        'إدارة الشاشات وربط الأجهزة المتعددة',
        'جدولة العروض والبانرات وقوالب الأسعار',
      ],
      actionLabel: 'فتح بوابة الإعدادات',
      onLaunch: () =>
        handleLaunch('بوابة شاشات العرض', () => {
          window.open('/displays', 'DisplaysPortalWindow', 'menubar=no,toolbar=no,location=no,status=no,resizable=yes');
        }),
    },
  ];

  const visibleTiles = tiles.filter((t) => !t.isRestaurantOnly || isRestaurantActive);
  const isHeroMode = visibleTiles.length <= 3;

  return (
    <RestaurantOperationsDialog
      open={open}
      onClose={onClose}
      title={__t('pos.pos_workspace.pos_displays_modal.s1', __t('pos.pos_workspace.pos_displays_modal.s0', "مركز شاشات العرض ومحطات العمل التفاعلية"))}
      subtitle={__t('pos.pos_workspace.pos_displays_modal.s2', __t('pos.pos_workspace.pos_displays_modal.s1', "إطلاق وتشغيل شاشات العرض الخارجية للعملاء، التلفزيون، المطبخ KDS، ومحطات الخدمة المحمولة"))}
      icon={<MonitorIcon size={18} color="#170e5e" />}
      footerNote={__t('pos.pos_workspace.pos_displays_modal.s3', __t('pos.pos_workspace.pos_displays_modal.s2', "تعمل الشاشات في نوافذ مستقلة متعددة وتتزامن لحظياً مع نقطة البيع والصالة عبر مسبح أحداث Z-Systems"))}
      scrollableBody={false}
      bodyStyle={{
        padding: '18px 22px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: isHeroMode ? '16px' : '12px',
          width: '100%',
          flex: 1,
          height: '100%',
          alignItems: 'stretch',
          boxSizing: 'border-box',
        }}
      >
        {visibleTiles.map((tile) => (
          <DisplayCard key={tile.key} tile={tile} isHeroMode={isHeroMode} />
        ))}
      </div>
    </RestaurantOperationsDialog>
  );
}
