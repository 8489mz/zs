import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { TenderItem } from './tender-estimator.types';

export interface TenderItemsToolbarProps {
  t: TFunction;
  items: TenderItem[];
  setIsImportBoqOpen: Dispatch<SetStateAction<boolean>>;
  setIsImportMasterOpen: Dispatch<SetStateAction<boolean>>;
  setIsCadTakeoffFormOpen: Dispatch<SetStateAction<boolean>>;
  isCadTakeoffFormOpen: boolean;
}

export function TenderItemsToolbar({
  t,
  items,
  setIsImportBoqOpen,
  setIsImportMasterOpen,
  setIsCadTakeoffFormOpen,
  isCadTakeoffFormOpen,
}: TenderItemsToolbarProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: 'var(--font-section-title)', fontWeight: 800, color: '#1e293b' }}>
          {t('contracting.tender_estimator_modal.s14', "بنود العطاء ومقايسة المشروع (")}{items.length} {t('contracting.tender_estimator_modal.s15', "بند)")}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setIsImportBoqOpen(true)}
          style={{
            height: '32px',
            padding: '0 12px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            background: '#f8fafc',
            color: '#170e5e',
            fontSize: 'var(--font-subtitle)',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
          }}
        >
          <AppIcons.FileSpreadsheet size={14} />
          <span>{t('contracting.tender_estimator_modal.s16', "استيراد مقايسة Excel (BOQ)")}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsImportMasterOpen(true)}
          style={{
            height: '32px',
            padding: '0 12px',
            borderRadius: '6px',
            border: '1px solid #170e5e',
            background: '#eef2ff',
            color: '#170e5e',
            fontSize: 'var(--font-subtitle)',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
          }}
        >
          <AppIcons.Layers size={14} />
          <span>{t('contracting.tender_estimator_modal.s17', "سحب من المقايسة المرجعية (124 بند)")}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsCadTakeoffFormOpen(!isCadTakeoffFormOpen)}
          style={{
            height: '32px',
            padding: '0 12px',
            borderRadius: '6px',
            border: '1px solid #0284c7',
            background: '#f0f9ff',
            color: '#0369a1',
            fontSize: 'var(--font-subtitle)',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
          }}
        >
          <AppIcons.PlusCircle size={14} />
          <span>{t('contracting.tender_estimator_modal.s18', "حصر سريع من أبعاد الرسومات (CAD Takeoff)")}</span>
        </button>
      </div>
    </div>
  );
}
