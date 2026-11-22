import { useTranslation } from 'react-i18next';
import { ShipIcon, FileCheckIcon } from '@/shared/components/icons/AppIcons';
import type { FreightPortalCustomer } from '../../hooks/use-maritime-customer-portal';

export function MaritimePortalHeader({ customer, handleCopyMagicLink, handleLogout }: { customer: FreightPortalCustomer; handleCopyMagicLink: () => void; handleLogout: () => void }) {
  const { t } = useTranslation();
  return (
    <header style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: '1280px', width: 'min(100%, 1280px)', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        {/* Brand & Portal Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#170e5e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
            <ShipIcon size={22} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontSize: '14.5px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
              {customer.tenantName || t('maritime_freight.maritime_customer_portal_page.s14', "منظومة الشحن الملاحي")}
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s15', "بوابة الخدمة الذاتية للعملاء (B2B Freight Portal)")}</div>
          </div>
        </div>

        {/* Customer Profile & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ padding: '6px 12px', background: '#f1f5f9', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
            <span style={{ fontWeight: 700, color: '#0f172a' }}>{customer.name}</span>
            {customer.companyName && <span style={{ color: '#64748b', marginRight: '6px' }}>({customer.companyName})</span>}
          </div>

          <button
            onClick={handleCopyMagicLink}
            title={t('maritime_freight.maritime_customer_portal_page.s16', "نسخ رابط الوصول المباشر لحسابك")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '11.5px',
              fontWeight: 600,
              color: '#1e293b',
              cursor: 'pointer',
            }}
          >
            <FileCheckIcon size={14} color="#170e5e" />
            <span>{t('maritime_freight.maritime_customer_portal_page.s17', "نسخ رابط الحساب")}</span>
          </button>

          <button
            onClick={handleLogout}
            style={{
              padding: '6px 12px',
              background: '#fee2e2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              fontSize: '11.5px',
              fontWeight: 700,
              color: '#991b1b',
              cursor: 'pointer',
            }}
          >
            {t('maritime_freight.maritime_customer_portal_page.s18', "خروج")}
          </button>
        </div>
      </div>
    </header>
  );
}
