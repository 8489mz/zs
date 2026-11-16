// KioskCategorySidebar — the 185px categories rail + "all" button.
// Pure move from SelfOrderingKioskPage; the facade keeps all state and mounts
// this component inside the middle body. The section banner stays in the
// facade above the mount (it is a JSX comment; moving it would force a
// fragment wrapper around the return).

import { useTranslation } from 'react-i18next';

export interface KioskCategorySidebarProps {
  categories: Array<{ id: number; name: string; imageUrl?: string }>;
  selectedCategory: number | 'all';
  onSelectCategory: (category: number | 'all') => void;
  catalogTotalCount: number;
}

export function KioskCategorySidebar({
  categories,
  selectedCategory,
  onSelectCategory,
  catalogTotalCount,
}: KioskCategorySidebarProps) {
  const { t: __t } = useTranslation();

  return (
    <aside
      style={{
        width: '185px',
        minWidth: '185px',
        backgroundColor: '#ffffff',
        borderLeft: '1.5px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        padding: '14px 8px',
        gap: '6px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', padding: '0 8px 4px' }}>
        {__t('pos.self_ordering_kiosk_page.s43', __t('pos.self_ordering_kiosk_page.s43', "أقسام القائمة"))}
      </div>

      {/* كافة الأصناف */}
      <button
        type="button"
        onClick={() => onSelectCategory('all')}
        style={{
          padding: '11px 12px',
          borderRadius: '12px',
          border: selectedCategory === 'all' ? '2px solid #170e5e' : '1px solid #e2e8f0',
          backgroundColor: selectedCategory === 'all' ? '#170e5e' : '#f8fafc',
          color: selectedCategory === 'all' ? '#ffffff' : '#1e293b',
          fontSize: '12.5px',
          fontWeight: 800,
          cursor: 'pointer',
          textAlign: 'right',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          transition: 'all 0.15s ease',
        }}
      >
        <span>{__t('pos.self_ordering_kiosk_page.s44', __t('pos.self_ordering_kiosk_page.s44', "كافة الأصناف"))}</span>
        <span
          style={{
            fontSize: '10.5px',
            color: selectedCategory === 'all' ? '#cbd5e1' : '#64748b',
            fontWeight: 600,
          }}
        >
          {catalogTotalCount} {__t('pos.self_ordering_kiosk_page.s45_item', __t('pos.self_ordering_kiosk_page.s45_item', "صنف"))}
        </span>
      </button>

      {/* قائمة الأقسام */}
      {categories.map((c: any) => {
        const isCatActive = selectedCategory !== 'all' && Number(selectedCategory) === Number(c.id);

        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectCategory(Number(c.id))}
            style={{
              padding: '11px 12px',
              borderRadius: '12px',
              border: isCatActive ? '2px solid #170e5e' : '1px solid #e2e8f0',
              backgroundColor: isCatActive ? '#170e5e' : '#f8fafc',
              color: isCatActive ? '#ffffff' : '#1e293b',
              fontSize: '12.5px',
              fontWeight: 800,
              cursor: 'pointer',
              textAlign: 'right',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              transition: 'all 0.15s ease',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.name}
            </span>
          </button>
        );
      })}
    </aside>
  );
}
