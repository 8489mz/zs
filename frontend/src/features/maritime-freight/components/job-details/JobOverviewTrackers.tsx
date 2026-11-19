import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { MaritimeJob } from '../../api/maritime-freight.api';
import { JobEgyptianAciCard } from './JobEgyptianAciCard';
import { JobExportCutoffsCard } from './JobExportCutoffsCard';
import { JobRoeForexCard } from './JobRoeForexCard';

interface Props {
  job: MaritimeJob;
  fetchJob: () => void;
  onUpdated: () => void;
}

export function JobOverviewTrackers({ job, fetchJob, onUpdated }: Props) {
  const { t } = useTranslation();

  return (
    <>
      {/* 5. رادار التتبع الحي (طيران أو سفن بحسب النمط) */}
      {job.transport_mode === 'air' ? (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 800, color: '#0369a1' }}>
              <AppIcons.Plane size={17} />
              <span>{t('maritime_freight.job_details_modal.s68', "رادار تتبع حركة الطيران والشحن الجوي الحي (Live Flight Tracker)")}</span>
            </div>
            {job.flight_number && (
              <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                {t('maritime_freight.job_details_modal.s69', "رحلة مسجلة")}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' }}>
                {job.flight_number ? `رحلة رقم: ${job.flight_number}` : t('maritime_freight.job_details_modal.s70', "لم يتم تسجيل رقم الرحلة بعد")}
              </div>
              <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
                {t('maritime_freight.job_details_modal.s71', "المسار الجوي:")} <strong>{job.pol_name} ({job.pol_code})</strong> ← <strong>{job.pod_name} ({job.pod_code})</strong> {t('maritime_freight.job_details_modal.s72', "| الناقل:")} {job.shipping_line_name}
              </div>
            </div>

            {job.flight_number ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={`https://www.flightradar24.com/data/flights/${encodeURIComponent(job.flight_number.replace(/\s+/g, ''))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '6px 12px',
                    background: '#0284c7',
                    color: '#ffffff',
                    borderRadius: '6px',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>Flightradar24</span>
                  <AppIcons.Globe size={13} />
                </a>
                <a
                  href={`https://flightaware.com/live/flight/${encodeURIComponent(job.flight_number.replace(/\s+/g, ''))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '6px 12px',
                    background: '#0369a1',
                    color: '#ffffff',
                    borderRadius: '6px',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>FlightAware</span>
                  <AppIcons.Globe size={13} />
                </a>
              </div>
            ) : (
              <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                {t('maritime_freight.job_details_modal.s73', "قم بإدخال رقم الرحلة لتفعيل رادار التتبع الجوي")}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 800, color: '#170e5e' }}>
              <AppIcons.Ship size={17} />
              <span>{t('maritime_freight.job_details_modal.s74', "رادار القمر الصناعي لتتبع حركة السفينة الحية (Live Satellite AIS Tracker)")}</span>
            </div>
            {job.vessel_name && (
              <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                {t('maritime_freight.job_details_modal.s75', "متصل AIS")}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a' }}>
                {job.vessel_name || t('maritime_freight.job_details_modal.s76', "لم يتم تسجيل اسم السفينة بعد")}
              </div>
              <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
                {t('maritime_freight.job_details_modal.s77', "المسار البحري:")} <strong>{job.pol_name}</strong> ← <strong>{job.pod_name}</strong> {job.voyage_number ? `| رحلة رقم: ${job.voyage_number}` : ''}
              </div>
            </div>

            {job.vessel_name ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={`https://www.marinetraffic.com/en/ais/details/ships/shipid:0/vessel:${encodeURIComponent(job.vessel_name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '6px 12px',
                    background: '#1d4ed8',
                    color: '#ffffff',
                    borderRadius: '6px',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>MarineTraffic AIS</span>
                  <AppIcons.Globe size={13} />
                </a>
                <a
                  href={`https://www.vesselfinder.com/vessels?name=${encodeURIComponent(job.vessel_name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '6px 12px',
                    background: '#047857',
                    color: '#ffffff',
                    borderRadius: '6px',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>VesselFinder AIS</span>
                  <AppIcons.Globe size={13} />
                </a>
              </div>
            ) : (
              <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                {t('maritime_freight.job_details_modal.s78', "قم بإدخال اسم السفينة لتفعيل رادار التتبع")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. بطاقات الامتثال والمواعيد والعملات المتعددة */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <JobEgyptianAciCard
          job={job}
          onUpdated={() => {
            fetchJob();
            onUpdated();
          }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px' }}>
          <JobExportCutoffsCard
            job={job}
            onUpdated={() => {
              fetchJob();
              onUpdated();
            }}
          />
          <JobRoeForexCard
            job={job}
            onUpdated={() => {
              fetchJob();
              onUpdated();
            }}
          />
        </div>
      </div>
    </>
  );
}
