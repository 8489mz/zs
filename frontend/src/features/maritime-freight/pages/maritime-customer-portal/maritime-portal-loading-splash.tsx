import { useTranslation } from 'react-i18next';
import { ShipIcon } from '@/shared/components/icons/AppIcons';

export function MaritimePortalLoadingSplash() {
  const { t } = useTranslation();
  return (
    <div dir="rtl" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <div style={{ padding: '24px', background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center', minWidth: '280px' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#170e5e', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <ShipIcon size={24} color="#fff" />
        </div>
        <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '15px' }}>{t('maritime_freight.maritime_customer_portal_page.s0', "بوابة عملاء الشحن واللوجستيات")}</div>
        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{t('maritime_freight.maritime_customer_portal_page.s1', "جاري التحقق من الجلسة...")}</div>
      </div>
    </div>
  );
}
