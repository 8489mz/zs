import { PageHeader } from '@/shared/components/page-header';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { MasterBoqItem } from '../../contracting.types';

export interface ContractingMasterBoqPageHeaderProps {
  __t: ReturnType<typeof useTranslation>['t'];
  setIsExcelImportModalOpen: (val: boolean) => void;
  handleExportExcel: () => void;
  filteredItems: MasterBoqItem[];
  loadItems: () => Promise<void>;
  loadTrades: () => Promise<void>;
  loading: boolean;
}

export function ContractingMasterBoqPageHeader({ __t, setIsExcelImportModalOpen, handleExportExcel, filteredItems, loadItems, loadTrades, loading }: ContractingMasterBoqPageHeaderProps) {
  return (
    <>
    {/* هيدر الصفحة القياسي المستقل */}
    <PageHeader
      title={__t('contracting.contracting_master_boq_page.s0', "إعدادات وبنك بنود المقاولات العام")}
      description={__t('contracting.contracting_master_boq_page.s1', "دليل البنود والمقايسات القياسي لكافة التخصصات الإنشائية والكهروميكانيكية وثوابت التسعير للشركة — تسحب منها كافة المشاريع بضغطة زر.")}
      actions={
        <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setIsExcelImportModalOpen(true)}
            style={{
              height: '38px',
              padding: '0 14px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#170e5e',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: 'var(--font-body)',
            }}
          >
            <AppIcons.Upload size={14} />
            <span>{__t('contracting.contracting_master_boq_page.s2', "استيراد Excel")}</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filteredItems.length === 0}
            style={{
              height: '38px',
              padding: '0 14px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#475569',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: filteredItems.length > 0 ? 'pointer' : 'not-allowed',
              fontSize: 'var(--font-body)',
              opacity: filteredItems.length > 0 ? 1 : 0.6,
            }}
          >
            <AppIcons.Download size={14} />
            <span>{__t('contracting.contracting_master_boq_page.s3', "تصدير Excel")}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              loadItems();
              loadTrades();
            }}
            disabled={loading}
            style={{
              height: '38px',
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
            }}
          >
            <AppIcons.RefreshCw size={14} />
            <span>{__t('contracting.contracting_master_boq_page.s4', "تحديث")}</span>
          </button>
        </div>
      }
    />
    </>
  );
}
