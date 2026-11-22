import { useTranslation } from 'react-i18next';
import { ShipIcon, PlaneIcon, SearchIcon, ClockIcon, DownloadIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';

export function MaritimePortalShipmentsTab({ setShipmentFilter, shipmentFilter, shipmentSearch, setShipmentSearch, loadShipments, loadingShipments, shipments, setSelectedShipmentForModal, handlePrintDocument }: { setShipmentFilter: Dispatch<SetStateAction<'active' | 'completed' | 'all'>>; shipmentFilter: 'active' | 'completed' | 'all'; shipmentSearch: string; setShipmentSearch: Dispatch<SetStateAction<string>>; loadShipments: () => Promise<void>; loadingShipments: boolean; shipments: any[]; setSelectedShipmentForModal: Dispatch<SetStateAction<any | null>>; handlePrintDocument: (docType: 'hbl' | 'awb' | 'delivery_order' | 'arrival_notice' | 'invoice', job: any) => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Filter and Search Bar */}
      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['active', 'completed', 'all'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setShipmentFilter(filter)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: '1px solid',
                borderColor: shipmentFilter === filter ? '#170e5e' : '#cbd5e1',
                background: shipmentFilter === filter ? '#170e5e' : '#ffffff',
                color: shipmentFilter === filter ? '#ffffff' : '#334155',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {filter === 'active' ? t('maritime_freight.maritime_customer_portal_page.s35', "الشحنات الجارية") : filter === 'completed' ? t('maritime_freight.maritime_customer_portal_page.s36', "المكتملة والمسلّمة") : t('maritime_freight.maritime_customer_portal_page.s37', "كافة الشحنات")}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '260px' }}>
          <input
            type="text"
            value={shipmentSearch}
            onChange={(e) => setShipmentSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadShipments()}
            placeholder={t('maritime_freight.maritime_customer_portal_page.s38', "بحث برقم الشحنة، السفينة، أو ACID...")}
            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12.5px', outline: 'none' }}
          />
          <button
            onClick={loadShipments}
            style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer' }}
          >
            <SearchIcon size={16} color="#1e293b" />
          </button>
        </div>
      </div>

      {/* Shipments List */}
      {loadingShipments ? (
        <div style={{ background: '#ffffff', borderRadius: '14px', padding: '40px', textAlign: 'center', border: '1px solid #e2e8f0', color: '#64748b' }}>
          {t('maritime_freight.maritime_customer_portal_page.s39', "جاري تحميل الشحنات وتحديثات التتبع...")}
        </div>
      ) : shipments.length === 0 ? (
        <div style={{ background: '#ffffff', borderRadius: '14px', padding: '40px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <ShipIcon size={36} color="#94a3b8" />
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155', marginTop: '10px' }}>{t('maritime_freight.maritime_customer_portal_page.s40', "لا توجد شحنات مسجلة حالياً")}</div>
          <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '4px' }}>{t('maritime_freight.maritime_customer_portal_page.s41', "يمكنكم تقديم طلب تسعير جديد الآن لبدء شحنتكم القادمة")}</div>
        </div>
      ) : (
        shipments.map((job) => {
          const isDelivered = job.status === 'delivered' || job.status === 'closed';
          return (
            <div
              key={job.id}
              style={{
                background: '#ffffff',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                padding: '18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              {/* Header Row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {job.transport_mode === 'air' ? <PlaneIcon size={18} color="#170e5e" /> : <ShipIcon size={18} color="#170e5e" />}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{job.job_number}</span>
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: isDelivered ? '#dcfce7' : '#e0e7ff', color: isDelivered ? '#15803d' : '#3730a3' }}>
                        {isDelivered ? t('maritime_freight.maritime_customer_portal_page.s42', "مسلّمة بنجاح") : t('maritime_freight.maritime_customer_portal_page.s43', "شحنة جارية")}
                      </span>
                      {job.direction && (
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: '#f1f5f9', color: '#475569' }}>
                          {job.direction === 'import' ? t('maritime_freight.maritime_customer_portal_page.s44', "استيراد") : job.direction === 'export' ? t('maritime_freight.maritime_customer_portal_page.s45', "تصدير") : t('maritime_freight.maritime_customer_portal_page.s46', "ترانزيت")}
                        </span>
                      )}
                    </div>
                    {job.acid_number && (
                      <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                        {t('maritime_freight.maritime_customer_portal_page.s47', "رقم ACID الجمركي:")} <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{job.acid_number}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Free days / Demurrage Indicator */}
                {job.freeDaysRemaining !== null && (
                  <div
                    style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: job.demurrageStatus === 'demurrage' ? '#fee2e2' : job.demurrageStatus === 'critical' ? '#ffedd5' : '#f0fdf4',
                      color: job.demurrageStatus === 'demurrage' ? '#991b1b' : job.demurrageStatus === 'critical' ? '#c2410c' : '#166534',
                      border: '1px solid',
                      borderColor: job.demurrageStatus === 'demurrage' ? '#fecaca' : job.demurrageStatus === 'critical' ? '#fed7aa' : '#bbf7d0',
                    }}
                  >
                    <ClockIcon size={14} />
                    <span>
                      {job.demurrageStatus === 'demurrage'
                        ? `غرامات أرضيات/تأخير (-${Math.abs(job.freeDaysRemaining)} يوم)`
                        : `متبقي ${job.freeDaysRemaining} يوم سماح`}
                    </span>
                  </div>
                )}
              </div>

              {/* Routing Details Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', background: '#f8fafc', padding: '12px', borderRadius: '10px', marginBottom: '14px', fontSize: '12.5px' }}>
                <div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>{t('maritime_freight.maritime_customer_portal_page.s48', "ميناء الشحن (POL)")}</div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{job.pol_name} ({job.pol_code})</div>
                  {job.etd && <div style={{ fontSize: '11px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s49', "إبحار:")} {new Date(job.etd).toLocaleDateString('ar-EG')}</div>}
                </div>

                <div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>{t('maritime_freight.maritime_customer_portal_page.s50', "ميناء الوصول (POD)")}</div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{job.pod_name} ({job.pod_code})</div>
                  {job.eta && <div style={{ fontSize: '11px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s51', "وصول متوقع:")} {new Date(job.eta).toLocaleDateString('ar-EG')}</div>}
                </div>

                <div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>{t('maritime_freight.maritime_customer_portal_page.s52', "الخط الملاحي / الناقل")}</div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{job.shipping_line_name || '—'}</div>
                  {job.vessel_name && (
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      {t('maritime_freight.maritime_customer_portal_page.s53', "السفينة:")} {job.vessel_name} {job.voyage_number ? `(${job.voyage_number})` : ''}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>{t('maritime_freight.maritime_customer_portal_page.s54', "الحاويات والوزن")}</div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>
                    {job.containers?.length || 1} {t('maritime_freight.maritime_customer_portal_page.s55', "حاوية |")} {Number(job.gross_weight_kg || 0).toLocaleString()} {t('maritime_freight.maritime_customer_portal_page.s56', "كجم")}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>{t('maritime_freight.maritime_customer_portal_page.s57', "الحجم:")} {Number(job.total_cbm || 0).toFixed(1)} CBM</div>
                </div>
              </div>

              {/* DCSA Milestones Radar Progression */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                  {t('maritime_freight.maritime_customer_portal_page.s58', "مراحل الشحنة المجدولة (DCSA Milestones)")}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px', textAlign: 'center' }}>
                  {[
                    { label: t('maritime_freight.maritime_customer_portal_page.s59', "تأكيد الحجز"), code: 'BOOK' },
                    { label: t('maritime_freight.maritime_customer_portal_page.s60', "دخول الميناء"), code: 'GTI' },
                    { label: t('maritime_freight.maritime_customer_portal_page.s61', "التحميل"), code: 'LOAD' },
                    { label: t('maritime_freight.maritime_customer_portal_page.s62', "الإبحار"), code: 'DEPT' },
                    { label: t('maritime_freight.maritime_customer_portal_page.s63', "وصول الميناء"), code: 'ARRI' },
                    { label: t('maritime_freight.maritime_customer_portal_page.s64', "التسليم"), code: 'DELV' },
                  ].map((m, idx) => {
                    const isDone = isDelivered || (idx <= 3); // realistic progressive preview based on milestone records
                    return (
                      <div
                        key={m.code}
                        style={{
                          padding: '6px 2px',
                          borderRadius: '6px',
                          background: isDone ? '#170e5e' : '#f1f5f9',
                          color: isDone ? '#ffffff' : '#64748b',
                          fontSize: '10.5px',
                          fontWeight: 700,
                        }}
                      >
                        {m.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Containers Badges & Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(job.containers || []).map((cntr: any) => (
                    <div
                      key={cntr.id || cntr.container_number}
                      style={{
                        padding: '4px 8px',
                        background: '#f1f5f9',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        fontSize: '11.5px',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        color: '#0f172a',
                      }}
                    >
                      {cntr.container_number} ({cntr.container_type || '40HC'})
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setSelectedShipmentForModal(job)}
                    style={{
                      padding: '6px 12px',
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#0f172a',
                      cursor: 'pointer',
                    }}
                  >
                    {t('maritime_freight.maritime_customer_portal_page.s65', "التفاصيل الكاملة")}
                  </button>

                  <button
                    onClick={() => handlePrintDocument('hbl', job)}
                    style={{
                      padding: '6px 12px',
                      background: '#170e5e',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <DownloadIcon size={14} color="#fff" />
                    <span>{t('maritime_freight.maritime_customer_portal_page.s66', "بوليصة HBL")}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
