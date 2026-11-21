import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';

export interface TenderGeneralSettingsProps {
  t: TFunction;
  projectName: string;
  setProjectName: Dispatch<SetStateAction<string>>;
  clientName: string;
  setClientName: Dispatch<SetStateAction<string>>;
  globalProfitMargin: number;
  setGlobalProfitMargin: Dispatch<SetStateAction<number>>;
  globalOverhead: number;
  setGlobalOverhead: Dispatch<SetStateAction<number>>;
  globalWaste: number;
  setGlobalWaste: Dispatch<SetStateAction<number>>;
  handleApplyGlobalMargins: () => void;
}

export function TenderGeneralSettings({
  t,
  projectName,
  setProjectName,
  clientName,
  setClientName,
  globalProfitMargin,
  setGlobalProfitMargin,
  globalOverhead,
  setGlobalOverhead,
  globalWaste,
  setGlobalWaste,
  handleApplyGlobalMargins,
}: TenderGeneralSettingsProps) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(200px, 2.2fr) minmax(170px, 1.8fr) minmax(75px, 0.75fr) minmax(75px, 0.75fr) minmax(75px, 0.75fr) auto',
        gap: '10px',
        alignItems: 'end',
      }}>
        <div>
          <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
            {t('contracting.tender_estimator_modal.s7', "اسم المشروع / العطاء المقترح")}
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            style={{ width: '100%', height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', fontWeight: 600, color: '#1e293b' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
            {t('contracting.tender_estimator_modal.s8', "العميل / جهة الإسناد المستهدفة")}
          </label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            style={{ width: '100%', height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', color: '#1e293b' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
            {t('contracting.tender_estimator_modal.s9', "هامش الربح %")}
          </label>
          <input
            type="number"
            min="0"
            max="100"
            value={globalProfitMargin}
            onChange={(e) => setGlobalProfitMargin(Number(e.target.value))}
            style={{ width: '100%', height: '32px', padding: '0 6px', textAlign: 'center', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', fontWeight: 700, color: '#15803d' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
            {t('contracting.tender_estimator_modal.s10', "المصاريف الإدارية %")}
          </label>
          <input
            type="number"
            min="0"
            max="100"
            value={globalOverhead}
            onChange={(e) => setGlobalOverhead(Number(e.target.value))}
            style={{ width: '100%', height: '32px', padding: '0 6px', textAlign: 'center', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', color: '#475569' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
            {t('contracting.tender_estimator_modal.s11', "الهالك العام %")}
          </label>
          <input
            type="number"
            min="0"
            max="100"
            value={globalWaste}
            onChange={(e) => setGlobalWaste(Number(e.target.value))}
            style={{ width: '100%', height: '32px', padding: '0 6px', textAlign: 'center', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-body)', color: '#475569' }}
          />
        </div>
        <div>
          <button
            type="button"
            onClick={handleApplyGlobalMargins}
            title={t('contracting.tender_estimator_modal.s12', "تعميم نسب الربح والمصاريف والهالك على كافة البنود")}
            style={{
              height: '32px',
              padding: '0 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#170e5e',
              fontSize: 'var(--font-micro)',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <AppIcons.Sliders size={13} />
            <span>{t('contracting.tender_estimator_modal.s13', "تعميم النسب للكل")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
