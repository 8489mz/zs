import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { TenderItem } from './tender-page-types';

export interface TenderToolbarProps {
  setIsImportBoqOpen: Dispatch<SetStateAction<boolean>>;
  setIsImportMasterOpen: Dispatch<SetStateAction<boolean>>;
  setIsCadTakeoffFormOpen: Dispatch<SetStateAction<boolean>>;
  isCadTakeoffFormOpen: boolean;
  items: TenderItem[];
  projectName: string;
  handleResetDraft: () => Promise<void>;
}

export function TenderToolbar({
  setIsImportBoqOpen,
  setIsImportMasterOpen,
  setIsCadTakeoffFormOpen,
  isCadTakeoffFormOpen,
  items,
  projectName,
  handleResetDraft,
}: TenderToolbarProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* 2. Toolbar & CAD Takeoff Trigger */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setIsImportBoqOpen(true)}
            style={{
              height: '36px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#f8fafc',
              color: '#170e5e',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.FileSpreadsheet size={15} />
            <span>{t('contracting.contracting_tender_page.s30', "استيراد مقايسة Excel (BOQ)")}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsImportMasterOpen(true)}
            style={{
              height: '36px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Layers size={15} />
            <span>{t('contracting.contracting_tender_page.s31', "سحب من المقايسة المرجعية (124 بند)")}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCadTakeoffFormOpen((prev) => !prev)}
            style={{
              height: '36px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: isCadTakeoffFormOpen ? '#f1f5f9' : '#ffffff',
              color: isCadTakeoffFormOpen ? '#170e5e' : '#334155',
              border: isCadTakeoffFormOpen ? '1px solid #94a3b8' : '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Sliders size={15} />
            <span>{t('contracting.contracting_tender_page.s32', "حصر سريع من أبعاد الرسومات (CAD Takeoff)")}</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {(items.length > 0 || projectName.trim()) && (
            <button
              type="button"
              onClick={handleResetDraft}
              style={{
                height: '32px',
                padding: '0 12px',
                borderRadius: '6px',
                border: '1px solid #fecaca',
                background: '#fef2f2',
                color: '#b91c1c',
                fontSize: '12px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Trash2 size={13} />
              <span>{t('contracting.contracting_tender_page.s33', "تفريغ وبدء عطاء جديد")}</span>
            </button>
          )}

          <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#64748b' }}>
            {t('contracting.contracting_tender_page.s34', "إجمالي بنود العطاء الحالية:")} <strong style={{ color: '#0f172a' }}>{items.length} {t('contracting.contracting_tender_page.s35', "بند")}</strong>
          </div>
        </div>
      </div>
    </>
  );
}
