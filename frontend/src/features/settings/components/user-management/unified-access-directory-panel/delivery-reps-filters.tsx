import { SearchIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';

export interface DeliveryRepsFiltersProps {
  __t: ReturnType<typeof useTranslation>['t'];
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  repsList: DeliveryRep[];
  setStatusFilter: Dispatch<SetStateAction<'all' | 'active' | 'inactive'>>;
  statusFilter: 'all' | 'active' | 'inactive';
}

export function DeliveryRepsFilters({ __t, searchTerm, setSearchTerm, repsList, setStatusFilter, statusFilter }: DeliveryRepsFiltersProps) {
  return (
    <>
    {/* Filter Bar */}
    <div
      style={{
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        flexWrap: 'wrap',
        background: '#ffffff',
        padding: '12px',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
      }}
    >
      <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
        <input
          type="text"
          placeholder={__t('settings.user_management.unified_access_directory_panel.s4', "بحث باسم المندوب أو رقم الهاتف...")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px 8px 36px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '13px',
            boxSizing: 'border-box',
          }}
        />
        <span style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }}>
          <SearchIcon size={16} />
        </span>
      </div>

      <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
        {(
          [
            { key: 'all', label: `الكل (${repsList.length})` },
            { key: 'active', label: `نشط (${repsList.filter((r) => r.is_active).length})` },
            { key: 'inactive', label: `موقوف (${repsList.filter((r) => !r.is_active).length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStatusFilter(t.key)}
            style={{
              border: 'none',
              background: statusFilter === t.key ? '#170e5e' : 'transparent',
              color: statusFilter === t.key ? '#ffffff' : '#475569',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
    </>
  );
}
