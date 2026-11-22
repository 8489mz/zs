import { useTranslation } from 'react-i18next';
import { ShipIcon, FileTextIcon, DollarSignIcon, PlusCircleIcon } from '@/shared/components/icons/AppIcons';
import type { FreightPortalCustomer, FreightPortalDashboard } from '../../hooks/use-maritime-customer-portal';
import type { Dispatch, SetStateAction } from 'react';
import type { ActiveTab } from './maritime-portal-types';

export function MaritimePortalKpiBanner({ dashboard, customer, setActiveTab }: { dashboard: FreightPortalDashboard | null; customer: FreightPortalCustomer; setActiveTab: Dispatch<SetStateAction<ActiveTab>> }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '20px' }}>
      {/* Active Shipments KPI */}
      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s19', "الشحنات الجارية والتتبع")}</span>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShipIcon size={18} color="#2563eb" />
          </div>
        </div>
        <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
          {dashboard?.kpis.activeShipmentsCount ?? '—'}
        </div>
        <div style={{ fontSize: '11px', color: '#10b981', fontWeight: 600, marginTop: '2px' }}>
          {dashboard?.kpis.deliveredShipmentsCount ? `${dashboard.kpis.deliveredShipmentsCount} شحنة مسلّمة في الأرشيف` : t('maritime_freight.maritime_customer_portal_page.s20', "محدث لحظياً")}
        </div>
      </div>

      {/* Pending Quotes KPI */}
      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s21', "عروض أسعار قيد المراجعة")}</span>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileTextIcon size={18} color="#d97706" />
          </div>
        </div>
        <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
          {dashboard?.kpis.pendingQuotesCount ?? '—'}
        </div>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
          {dashboard?.kpis.approvedQuotesCount ? `${dashboard.kpis.approvedQuotesCount} عرض معتمد ومؤكد` : t('maritime_freight.maritime_customer_portal_page.s22', "عروض تنتظر موافقتكم")}
        </div>
      </div>

      {/* Account Balance KPI */}
      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s23', "الرصيد المستحق (المديونية)")}</span>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <DollarSignIcon size={18} color="#0f172a" />
          </div>
        </div>
        <div style={{ fontSize: '24px', fontWeight: 800, color: (customer.balance || 0) > 0 ? '#b91c1c' : '#0f172a' }}>
          {Number(customer.balance || 0).toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600 }}>{t('maritime_freight.maritime_customer_portal_page.s24', "ج.م")}</span>
        </div>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
          {t('maritime_freight.maritime_customer_portal_page.s25', "الحد الائتماني:")} {Number(customer.creditLimit || 0).toLocaleString()} {t('maritime_freight.maritime_customer_portal_page.s26', "ج.م")}
        </div>
      </div>

      {/* Quick Action Tile */}
      <div
        onClick={() => setActiveTab('request_quote')}
        style={{
          background: '#170e5e',
          borderRadius: '14px',
          padding: '16px',
          color: '#ffffff',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxShadow: '0 4px 14px rgba(23, 14, 94, 0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>{t('maritime_freight.maritime_customer_portal_page.s27', "طلب تسعير شحنة جديدة")}</span>
          <PlusCircleIcon size={20} color="#ffffff" />
        </div>
        <div style={{ fontSize: '11.5px', color: '#cbd5e1', lineHeight: 1.4 }}>
          {t('maritime_freight.maritime_customer_portal_page.s28', "احصل على أفضل أسعار النولون البحري والجوي والبري مع تفريغ الحاويات في دقائق")}
        </div>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#93c5fd', marginTop: '8px' }}>
          {t('maritime_freight.maritime_customer_portal_page.s29', "ابدأ الطلب الآن ←")}
        </div>
      </div>
    </div>
  );
}
