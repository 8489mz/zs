import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { MasterBoqItem } from '../../contracting.types';

export interface ContractingMasterBoqTableActionBarProps {
  __t: ReturnType<typeof useTranslation>['t'];
  setEditingItem: (val: MasterBoqItem | null) => void;
  setIsCreateModalOpen: (val: boolean) => void;
}

export function ContractingMasterBoqTableActionBar({ __t, setEditingItem, setIsCreateModalOpen }: ContractingMasterBoqTableActionBarProps) {
  return (
    <>
    {/* شريط الإجراء المباشر أعلى الجدول */}
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
      }}
    >
      <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#1e293b' }}>
        {__t('contracting.contracting_master_boq_page.s22', "قائمة البنود القياسية والمواصفات الفنية")}
      </div>

      <button
        type="button"
        onClick={() => {
          setEditingItem(null);
          setIsCreateModalOpen(true);
        }}
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
          boxShadow: '0 1px 3px rgba(23, 14, 94, 0.2)',
        }}
      >
        <AppIcons.Plus size={15} />
        <span>{__t('contracting.contracting_master_boq_page.s23', "إضافة بند مرجعي مخصص")}</span>
      </button>
    </div>
    </>
  );
}
