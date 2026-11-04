import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { maritimeApi } from '../api/maritime-freight.api';
import { toast } from '@/shared/components/system-alert';

const SUPPORTED_CARRIERS = [
  { code: 'MAEU', name: 'ميرسك لاين', logo: 'MAERSK', color: '#002b49' },
  { code: 'MSCU', name: 'إم إس سي', logo: 'MSC', color: '#d97706' },
  { code: 'CMDU', name: 'سي إم إيه', logo: 'CMA CGM', color: '#dc2626' },
  { code: 'HLCU', name: 'هاباج لويد', logo: 'HAPAG-LLOYD', color: '#ea580c' },
  { code: 'COSU', name: 'كوسكو شيبنج', logo: 'COSCO', color: '#0284c7' },
  { code: 'ONEY', name: 'أوشن (ONE)', logo: 'ONE', color: '#db2777' },
  { code: 'EGLV', name: 'إيفرجرين', logo: 'EVERGREEN', color: '#16a34a' },
];

export function CarrierTrackingHubTab() {
  const { t } = useTranslation();
  const [carrierCode, setCarrierCode] = useState('MSCU');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [trackingEvents, setTrackingEvents] = useState<any[]>([]);

  const handleSyncTracking = async () => {
    if (!trackingNumber.trim()) {
      toast.error('يرجى إدخال رقم الحاوية أو بوليصة الشحن');
      return;
    }

    try {
      setIsSyncing(true);
      const res = await maritimeApi.syncCarrierTracking(carrierCode, trackingNumber.trim().toUpperCase());

      const events = await maritimeApi.listCarrierApiEvents(trackingNumber.trim().toUpperCase());
      setTrackingEvents(events);
      toast.success(`تم عرض الأحداث التقديرية المجدولة (${res.eventsCount} أحداث) — لا يوجد اتصال مباشر مع الخط الملاحي`);
    } catch (err: any) {
      toast.error(err.message || 'تعذر عرض الأحداث التقديرية');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
      {/* 1. Header Banner */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#170e5e', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AppIcons.Globe size={20} />
            <span>{t('maritime_freight.carrier_tracking_hub_tab.s0', "سجل الأحداث التقديرية المجدولة للنواقل والخطوط الملاحية (Carrier Estimated Tracking)")}</span>
          </div>
          <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '4px' }}>
            {t('maritime_freight.carrier_tracking_hub_tab.s1', "الأحداث المعروضة تقديرية ومجدولة من بيانات الشحنة، وليست قراءة مباشرة من أنظمة الخط الملاحي — لا يوجد ربط مباشر مع الناقل")}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: '#fef3c7', color: '#92400e', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700 }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#d97706', display: 'inline-block' }} />
            أحداث تقديرية — بلا ربط مباشر
          </span>
        </div>
      </div>

      {/* 2. Interactive Carrier Selector & Query Box */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#170e5e' }}>
          {t('maritime_freight.carrier_tracking_hub_tab.s2', "اختر الخط الملاحي وأدخل رقم الحاوية أو البوليصة (Container / B/L Number)")}
        </div>

        {/* Carrier Badges */}
        <style>{`
          .maritime-carrier-grid {
            display: grid;
            grid-template-columns: repeat(7, minmax(0, 1fr));
            gap: 8px;
            width: 100%;
            box-sizing: border-box;
          }
          @media (max-width: 900px) {
            .maritime-carrier-grid {
              grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
            }
          }
        `}</style>
        <div className="maritime-carrier-grid">
          {SUPPORTED_CARRIERS.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setCarrierCode(c.code)}
              style={{
                height: '64px',
                minHeight: '64px',
                boxSizing: 'border-box',
                padding: '8px 4px',
                borderRadius: '10px',
                border: carrierCode === c.code ? '2px solid #170e5e' : '1px solid #e2e8f0',
                background: carrierCode === c.code ? '#f8fafc' : '#ffffff',
                boxShadow: carrierCode === c.code ? '0 2px 6px rgba(23, 14, 94, 0.08)' : 'none',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                minWidth: 0,
                transition: 'none',
              }}
            >
              <div style={{ fontSize: '0.82rem', fontWeight: 900, color: c.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.3px' }}>{c.logo}</div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
            </button>
          ))}
        </div>

        {/* Input & Action */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          <input
            type="text"
            placeholder={t('maritime_freight.carrier_tracking_hub_tab.s3', "أدخل رقم الحاوية (مثال: MSCU9284710) أو رقم البوليصة Master B/L...")}
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleSyncTracking()}
            style={{
              flex: 1,
              height: '42px',
              padding: '0 14px',
              borderRadius: '8px',
              border: '2px solid #cbd5e1',
              fontSize: '0.92rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              letterSpacing: '0.5px',
            }}
          />

          <button
            type="button"
            onClick={handleSyncTracking}
            disabled={isSyncing}
            style={{
              height: '42px',
              padding: '0 24px',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 800,
              fontSize: '0.875rem',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 2px 4px rgba(23, 14, 94, 0.15)',
            }}
          >
            <AppIcons.RefreshCw size={16} />
            <span>{isSyncing ? t('maritime_freight.carrier_tracking_hub_tab.s4', "جاري تجهيز الأحداث التقديرية...") : t('maritime_freight.carrier_tracking_hub_tab.s5', "عرض الأحداث التقديرية")}</span>
          </button>
        </div>
      </div>

      {/* 3. Tracking Results & Timeline */}
      {trackingEvents.length > 0 && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#170e5e' }}>
                {t('maritime_freight.carrier_tracking_hub_tab.s6', "سجل الأحداث والمحطات اللوجستية للحاوية:")} <span style={{ fontFamily: 'monospace' }}>{trackingNumber}</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                {t('maritime_freight.carrier_tracking_hub_tab.s7', "الخط الملاحي الناقل:")} {SUPPORTED_CARRIERS.find((c) => c.code === carrierCode)?.name} {t('maritime_freight.carrier_tracking_hub_tab.s8', "| أحداث تقديرية مجدولة")}
              </div>
            </div>
            <span style={{ padding: '3px 8px', borderRadius: '6px', background: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: '0.75rem' }}>
              {t('maritime_freight.carrier_tracking_hub_tab.s9', "أحداث تقديرية معروضة:")} {trackingEvents.length}
            </span>
          </div>

          {/* Vertical Stepper Timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative', paddingRight: '20px' }}>
            <div style={{ position: 'absolute', top: '10px', bottom: '10px', right: '7px', width: '2px', background: '#e2e8f0' }} />

            {trackingEvents.map((evt, idx) => (
              <div key={evt.id || idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', position: 'relative' }}>
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: idx === 0 ? '#16a34a' : '#170e5e',
                    border: '3px solid #ffffff',
                    boxShadow: '0 0 0 2px #cbd5e1',
                    zIndex: 1,
                    marginTop: '3px',
                  }}
                />
                <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                      {evt.event_type === 'BOOK' ? t('maritime_freight.carrier_tracking_hub_tab.s11', "تأكيد الحجز الملاحي (Booking Confirmed)")
                        : evt.event_type === 'GTI' ? t('maritime_freight.carrier_tracking_hub_tab.s12', "دخول الحاوية محطة الميناء (Gate-in at POL)")
                        : evt.event_type === 'LOAD' ? t('maritime_freight.carrier_tracking_hub_tab.s13', "تحميل الحاوية على السفينة (Vessel Loaded)")
                        : evt.event_type === 'DEPT' ? t('maritime_freight.carrier_tracking_hub_tab.s14', "إبحار السفينة (Vessel Departed)")
                        : evt.event_type === 'ARRI' ? t('maritime_freight.carrier_tracking_hub_tab.s15', "وصول السفينة لميناء الوصول (Vessel Arrived)")
                        : evt.event_type}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>
                      {new Date(evt.event_time).toLocaleString('ar-EG')}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '4px' }}>
                    {t('maritime_freight.carrier_tracking_hub_tab.s16', "الموقع:")} <strong>{evt.event_location || 'Terminal Area'}</strong> {t('maritime_freight.carrier_tracking_hub_tab.s17', "| الناقل:")} <strong>{evt.carrier_code}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
