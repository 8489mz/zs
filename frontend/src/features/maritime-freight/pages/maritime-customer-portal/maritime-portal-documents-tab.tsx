import { useTranslation } from 'react-i18next';
import { FileTextIcon, FileCheckIcon, ClockIcon, DollarSignIcon, DownloadIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';

export function MaritimePortalDocumentsTab({ selectedDocShipmentId, setSelectedDocShipmentId, shipments, handlePrintDocument }: { selectedDocShipmentId: string; setSelectedDocShipmentId: Dispatch<SetStateAction<string>>; shipments: any[]; handlePrintDocument: (docType: 'hbl' | 'awb' | 'delivery_order' | 'arrival_notice' | 'invoice', job: any) => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
          {t('maritime_freight.maritime_customer_portal_page.s121', "مركز المستندات والبوالص (Digital Document Center)")}
        </h2>
        <p style={{ fontSize: '12.5px', color: '#64748b', margin: 0 }}>
          {t('maritime_freight.maritime_customer_portal_page.s122', "تحميل وطباعة المستندات الرسمية المعتمدة لشحناتكم مباشرة بصيغة PDF الرسمية مع باركود التتبع المعتمد")}
        </p>
      </div>

      {/* Shipment Selector */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
          {t('maritime_freight.maritime_customer_portal_page.s123', "اختر الشحنة لعرض مستنداتها:")}
        </label>
        <select
          value={selectedDocShipmentId}
          onChange={(e) => setSelectedDocShipmentId(e.target.value)}
          style={{ width: '100%', maxWidth: '480px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
        >
          {shipments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.job_number} — {s.pol_name} {t('maritime_freight.maritime_customer_portal_page.s124', "إلى")} {s.pod_name} ({s.shipping_line_name || t('maritime_freight.maritime_customer_portal_page.s125', "الناقل")})
            </option>
          ))}
        </select>
      </div>

      {/* Documents Tiles */}
      {(() => {
        const currentJob = shipments.find((s) => String(s.id) === String(selectedDocShipmentId)) || shipments[0];
        if (!currentJob) {
          return (
            <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '10px' }}>
              {t('maritime_freight.maritime_customer_portal_page.s126', "لا توجد شحنات متاحة لتحميل مستنداتها")}
            </div>
          );
        }

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            {/* HBL Document */}
            <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                  <FileTextIcon size={20} color="#3730a3" />
                </div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s127', "بوليصة الشحن (House Bill of Lading - HBL)")}
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                  {t('maritime_freight.maritime_customer_portal_page.s128', "بوليصة الشحن الرسمية المتوافقة مع معايير FIATA الدولية شاملة أرقام الحاويات والأختام.")}
                </div>
              </div>
              <button
                onClick={() => handlePrintDocument('hbl', currentJob)}
                style={{ marginTop: '16px', padding: '8px 12px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <DownloadIcon size={14} color="#fff" />
                <span>{t('maritime_freight.maritime_customer_portal_page.s129', "عرض وطباعة البوليصة")}</span>
              </button>
            </div>

            {/* Delivery Order Document */}
            <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                  <FileCheckIcon size={20} color="#15803d" />
                </div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s130', "إذن التسليم الملاحي (Delivery Order - D/O)")}
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                  {t('maritime_freight.maritime_customer_portal_page.s131', "إذن التسليم الجمركي المعتمد لساحات الموانئ والمستودعات لاستلام وتفريغ البضائع.")}
                </div>
              </div>
              <button
                onClick={() => handlePrintDocument('delivery_order', currentJob)}
                style={{ marginTop: '16px', padding: '8px 12px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <DownloadIcon size={14} color="#fff" />
                <span>{t('maritime_freight.maritime_customer_portal_page.s132', "عرض وطباعة إذن التسليم")}</span>
              </button>
            </div>

            {/* Arrival Notice Document */}
            <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                  <ClockIcon size={20} color="#b45309" />
                </div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s133', "إخطار وصول الشحنة (Arrival Notice - A/N)")}
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                  {t('maritime_freight.maritime_customer_portal_page.s134', "إشعار رسمي ببيانات وصول السفينة، الرصيف، وتاريخ بدء حساب فترات السماح (Free Time).")}
                </div>
              </div>
              <button
                onClick={() => handlePrintDocument('arrival_notice', currentJob)}
                style={{ marginTop: '16px', padding: '8px 12px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <DownloadIcon size={14} color="#fff" />
                <span>{t('maritime_freight.maritime_customer_portal_page.s135', "عرض وطباعة إخطار الوصول")}</span>
              </button>
            </div>

            {/* Freight Invoice Document */}
            <div style={{ padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                  <DollarSignIcon size={20} color="#0f172a" />
                </div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s136', "مطالبة ورسوم الشحن (Freight Billing / Invoice)")}
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                  {t('maritime_freight.maritime_customer_portal_page.s137', "كشف تفصيلي برسوم الشحن، عوائد الموانئ THC، والخدمات اللوجستية الإضافية.")}
                </div>
              </div>
              <button
                onClick={() => handlePrintDocument('invoice', currentJob)}
                style={{ marginTop: '16px', padding: '8px 12px', background: '#170e5e', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <DownloadIcon size={14} color="#fff" />
                <span>{t('maritime_freight.maritime_customer_portal_page.s138', "عرض وطباعة المطالبة")}</span>
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
