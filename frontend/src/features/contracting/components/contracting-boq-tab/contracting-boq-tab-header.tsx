import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { ContractingBoqItem } from '../../contracting.types';

export interface ContractingBoqTabHeaderProps {
  t: ReturnType<typeof useTranslation>['t'];
  projectName: string;
  isExporting: boolean;
  items: ContractingBoqItem[];
  handleExportExcel: () => Promise<void>;
  projectId?: string;
  setIsImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsImportMasterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onNewItem: () => void;
}

export function ContractingBoqTabHeader({ t, projectName, isExporting, items, handleExportExcel, projectId, setIsImportModalOpen, setIsImportMasterOpen, onNewItem }: ContractingBoqTabHeaderProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
      <div>
        <h2 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          {t('contracting.contracting_boq_tab.s0', "جدول الكميات وفئات البنود التعاقدية (Bill of Quantities / SOV)")}
        </h2>
        <p style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', margin: '4px 0 0' }}>
          {projectName ? `المشروع: ${projectName}` : t('contracting.contracting_boq_tab.s1', "إدارة ومتابعة فئات البنود وتكاليفها والكميات المنفذة")}
        </p>
      </div>

      {/* أزرار الإجراءات الرئيسية */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* تصدير إكسيل */}
        <button
          type="button"
          disabled={isExporting || items.length === 0}
          onClick={handleExportExcel}
          style={{
            height: '36px',
            padding: '0 14px',
            borderRadius: '8px',
            fontWeight: 600,
            background: '#ffffff',
            color: '#334155',
            border: '1px solid #cbd5e1',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            cursor: items.length > 0 ? 'pointer' : 'not-allowed',
            fontSize: 'var(--font-body)',
            opacity: items.length > 0 ? 1 : 0.6,
            transition: 'all 0.15s ease',
          }}
        >
          <AppIcons.Download size={14} />
          <span>{isExporting ? t('contracting.contracting_boq_tab.s2', "جاري التصدير...") : t('contracting.contracting_boq_tab.s3', "تصدير Excel")}</span>
        </button>

        {/* استيراد إكسيل */}
        {projectId && (
          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            style={{
              height: '36px',
              padding: '0 14px',
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
            <AppIcons.FileSpreadsheet size={15} />
            <span>{t('contracting.contracting_boq_tab.s4', "استيراد من Excel")}</span>
          </button>
        )}

        {/* سحب من بنك البنود المرجعي */}
        {projectId && (
          <button
            type="button"
            onClick={() => setIsImportMasterOpen(true)}
            style={{
              height: '36px',
              padding: '0 14px',
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
            <span>{t('contracting.contracting_boq_tab.s5', "بنك البنود المرجعي")}</span>
          </button>
        )}

        {/* إضافة بند تعاقدي جديد */}
        <button
          type="button"
          onClick={onNewItem}
          style={{
            height: '36px',
            padding: '0 16px',
            borderRadius: '8px',
            fontWeight: 700,
            background: '#170e5e',
            color: '#ffffff',
            border: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
            fontSize: 'var(--font-body)',
            boxShadow: '0 1px 3px rgba(23, 14, 94, 0.15)',
            transition: 'all 0.15s ease',
          }}
        >
          <AppIcons.Plus size={15} />
          <span>{t('contracting.contracting_boq_tab.s6', "إضافة بند تعاقدي (SOV)")}</span>
        </button>
      </div>
    </div>
  );
}
