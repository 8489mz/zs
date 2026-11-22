import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export function MaritimePortalShipmentModal({ selectedShipmentForModal, setSelectedShipmentForModal, handlePrintDocument }: { selectedShipmentForModal: any; setSelectedShipmentForModal: Dispatch<SetStateAction<any | null>>; handlePrintDocument: (docType: 'hbl' | 'awb' | 'delivery_order' | 'arrival_notice' | 'invoice', job: any) => void }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          maxWidth: '640px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 2px' }}>
              {t('maritime_freight.maritime_customer_portal_page.s157', "تفاصيل الشحنة")} {selectedShipmentForModal.job_number}
            </h3>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              {selectedShipmentForModal.pol_name} → {selectedShipmentForModal.pod_name}
            </div>
          </div>
          <button
            onClick={() => setSelectedShipmentForModal(null)}
            style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
          <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div><strong>{t('maritime_freight.maritime_customer_portal_page.s158', "الخط الملاحي:")}</strong> {selectedShipmentForModal.shipping_line_name || '—'}</div>
            <div><strong>{t('maritime_freight.maritime_customer_portal_page.s159', "اسم السفينة:")}</strong> {selectedShipmentForModal.vessel_name || '—'}</div>
            <div><strong>{t('maritime_freight.maritime_customer_portal_page.s160', "رقم الحجز:")}</strong> {selectedShipmentForModal.booking_number || '—'}</div>
            <div><strong>{t('maritime_freight.maritime_customer_portal_page.s161', "رقم ACID:")}</strong> {selectedShipmentForModal.acid_number || '—'}</div>
          </div>

          <div>
            <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>{t('maritime_freight.maritime_customer_portal_page.s162', "الحاويات المربوطة:")}</h4>
            {(selectedShipmentForModal.containers || []).map((c: any, idx: number) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f1f5f9', borderRadius: '8px', marginBottom: '6px' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.container_number}</span>
                <span style={{ color: '#64748b' }}>{c.container_type} {t('maritime_freight.maritime_customer_portal_page.s163', "| سيل:")} {c.seal_number || '—'}</span>
                <span style={{ fontWeight: 700 }}>{Number(c.gross_weight_kg || 0).toLocaleString()} {t('maritime_freight.maritime_customer_portal_page.s164', "كجم")}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
            <button
              onClick={() => handlePrintDocument('hbl', selectedShipmentForModal)}
              style={{ padding: '8px 14px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
            >
              {t('maritime_freight.maritime_customer_portal_page.s165', "طباعة بوليصة HBL")}
            </button>
            <button
              onClick={() => handlePrintDocument('delivery_order', selectedShipmentForModal)}
              style={{ padding: '8px 14px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}
            >
              {t('maritime_freight.maritime_customer_portal_page.s166', "طباعة إذن التسليم")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
