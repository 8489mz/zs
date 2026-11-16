// KioskWelcomeScreen — Screen 1: welcome + dine-in/takeaway selection.
// Pure move from SelfOrderingKioskPage; the facade keeps all state and mounts
// this component when no dining mode is selected yet.

import { useTranslation } from 'react-i18next';
import { UtensilsIcon, ShoppingBagIcon } from '@/shared/components/icons/AppIcons';

export interface KioskWelcomeScreenProps {
  storeDisplayName: string;
  onSelectMode: (mode: 'dine_in' | 'takeaway') => void;
}

// ==========================================
// الشاشة 1: الترحيب واختيار نوع الطلب
// ==========================================
export function KioskWelcomeScreen({ storeDisplayName, onSelectMode }: KioskWelcomeScreenProps) {
  const { t: __t } = useTranslation();

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'inherit',
        userSelect: 'none',
      }}
    >
      <div style={{ maxWidth: '680px', width: '100%', textAlign: 'center' }}>
        {/* Logo / Badge */}
        <div
          style={{
            width: '92px',
            height: '92px',
            margin: '0 auto 24px',
            backgroundColor: '#170e5e',
            borderRadius: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 30px rgba(23, 14, 94, 0.25)',
          }}
        >
          <UtensilsIcon size={46} color="#ffffff" />
        </div>

        <h1 style={{ fontSize: '32px', fontWeight: 900, color: '#0f172a', margin: '0 0 12px' }}>
          {storeDisplayName}
        </h1>
        <p style={{ fontSize: '16px', color: '#64748b', margin: '0 0 42px', lineHeight: 1.6 }}>
          {__t('pos.self_ordering_kiosk_page.s2', __t('pos.self_ordering_kiosk_page.s2', "شاشة الخدمة الذاتية • تفضل باختيار طريقة استلام وجبتك"))}
        </p>

        {/* بطاقتي الاختيار للمس المريح */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          <button
            type="button"
            onClick={() => onSelectMode('dine_in')}
            style={{
              backgroundColor: '#ffffff',
              border: '2.5px solid #e2e8f0',
              borderRadius: '24px',
              padding: '42px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '18px',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
              textAlign: 'center',
              transition: 'all 0.2s ease',
            }}
          >
            <div
              style={{
                width: '78px',
                height: '78px',
                borderRadius: '22px',
                backgroundColor: '#eef2ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <UtensilsIcon size={40} color="#170e5e" />
            </div>
            <div>
              <div style={{ fontSize: '23px', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.self_ordering_kiosk_page.s3', __t('pos.self_ordering_kiosk_page.s3', "تناول بالصالة"))}
              </div>
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>
                {__t('pos.self_ordering_kiosk_page.s4', __t('pos.self_ordering_kiosk_page.s4', "Dine In • استمتع بوجبتك ساخنة على الطاولة"))}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectMode('takeaway')}
            style={{
              backgroundColor: '#ffffff',
              border: '2.5px solid #e2e8f0',
              borderRadius: '24px',
              padding: '42px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '18px',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
              textAlign: 'center',
              transition: 'all 0.2s ease',
            }}
          >
            <div
              style={{
                width: '78px',
                height: '78px',
                borderRadius: '22px',
                backgroundColor: '#f0fdf4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShoppingBagIcon size={40} color="#16a34a" />
            </div>
            <div>
              <div style={{ fontSize: '23px', fontWeight: 900, color: '#0f172a' }}>
                {__t('pos.self_ordering_kiosk_page.s5', __t('pos.self_ordering_kiosk_page.s5', "استلام سفري"))}
              </div>
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>
                {__t('pos.self_ordering_kiosk_page.s6', __t('pos.self_ordering_kiosk_page.s6', "Takeaway • استلم وجبتك مغلفة من الكاونتر"))}
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
