import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { MasterBoqItem } from '../../contracting.types';

export interface ContractingMasterBoqActionsSearchProps {
  __t: ReturnType<typeof useTranslation>['t'];
  search: string;
  setSearch: (val: string) => void;
  setStatusFilter: (val: 'active' | 'all' | 'inactive') => void;
  statusFilter: 'active' | 'all' | 'inactive';
  filteredItems: MasterBoqItem[];
}

export function ContractingMasterBoqActionsSearch({ __t, search, setSearch, setStatusFilter, statusFilter, filteredItems }: ContractingMasterBoqActionsSearchProps) {
  return (
    <>
    {/* شريط الإجراءات والبحث وفلتر الحالة */}
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 320px', maxWidth: '460px' }}>
        <div style={{ position: 'relative', width: '100%' }}>
          <span style={{ position: 'absolute', right: '12px', top: '10px', color: '#94a3b8' }}>
            <AppIcons.Search size={16} />
          </span>
          <input
            type="text"
            placeholder={__t('contracting.contracting_master_boq_page.s13', "ابحث بكود البند أو المسمى أو المواصفات...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              height: '38px',
              padding: '0 36px 0 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: 'var(--font-body)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* فلاتر الحالة النشطة والمستبعدة */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '8px', gap: '2px' }}>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            style={{
              height: '30px',
              padding: '0 12px',
              borderRadius: '6px',
              border: 'none',
              fontSize: 'var(--font-micro)',
              fontWeight: statusFilter === 'active' ? 700 : 500,
              background: statusFilter === 'active' ? '#ffffff' : 'transparent',
              color: statusFilter === 'active' ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              boxShadow: statusFilter === 'active' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
            }}
          >
            {__t('contracting.contracting_master_boq_page.s14', "النشطة والمعتمدة")}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            style={{
              height: '30px',
              padding: '0 12px',
              borderRadius: '6px',
              border: 'none',
              fontSize: 'var(--font-micro)',
              fontWeight: statusFilter === 'all' ? 700 : 500,
              background: statusFilter === 'all' ? '#ffffff' : 'transparent',
              color: statusFilter === 'all' ? '#0f172a' : '#64748b',
              cursor: 'pointer',
              boxShadow: statusFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
            }}
          >
            {__t('contracting.contracting_master_boq_page.s15', "كافة البنود")}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('inactive')}
            style={{
              height: '30px',
              padding: '0 12px',
              borderRadius: '6px',
              border: 'none',
              fontSize: 'var(--font-micro)',
              fontWeight: statusFilter === 'inactive' ? 700 : 500,
              background: statusFilter === 'inactive' ? '#ffffff' : 'transparent',
              color: statusFilter === 'inactive' ? '#b91c1c' : '#64748b',
              cursor: 'pointer',
              boxShadow: statusFilter === 'inactive' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
            }}
          >
            {__t('contracting.contracting_master_boq_page.s16', "المستبعدة والمخفية")}
          </button>
        </div>

        <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', marginInlineStart: '6px' }}>
          {__t('contracting.contracting_master_boq_page.s17', "معروض:")} <strong style={{ color: '#0f172a' }}>{filteredItems.length}</strong> {__t('contracting.contracting_master_boq_page.s18', "بند")}
        </div>
      </div>
    </div>
    </>
  );
}
