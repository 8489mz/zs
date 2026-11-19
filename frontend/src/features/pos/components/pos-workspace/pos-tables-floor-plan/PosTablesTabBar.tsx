// Floor/list view tabs — the tab switcher bar under the dialog header:
// floor button, list button with the held-drafts count badge. Pure move;
// the bar keeps no state of its own: the active tab, its setter and the
// held drafts arrive as props from the dialog, and the labels come from
// this component’s own translation hook.

import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { HeldPosDraftSummary } from '@/features/pos/components/pos-cart-panel/posCartPanel.types';

export interface PosTablesTabBarProps {
  activeTab: 'floor' | 'list';
  setActiveTab: Dispatch<SetStateAction<'floor' | 'list'>>;
  heldDrafts: HeldPosDraftSummary[];
}

export function PosTablesTabBar({
  activeTab,
  setActiveTab,
  heldDrafts,
}: PosTablesTabBarProps) {
  const { t: __t } = useTranslation();
  return (
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('floor')}
            style={{
              padding: '7px 18px',
              borderRadius: '8px',
              border: activeTab === 'floor' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: activeTab === 'floor' ? '#170e5e' : '#ffffff',
              color: activeTab === 'floor' ? '#ffffff' : '#334155',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s6', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s6', "خريطة الصالة والطاولات"))}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            style={{
              padding: '7px 18px',
              borderRadius: '8px',
              border: activeTab === 'list' ? '2px solid #170e5e' : '1px solid #cbd5e1',
              background: activeTab === 'list' ? '#170e5e' : '#ffffff',
              color: activeTab === 'list' ? '#ffffff' : '#334155',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{__t('pos.pos_workspace.pos_tables_floor_plan_dialog.s7', __t('pos.pos_workspace.pos_tables_floor_plan_dialog.s7', "قائمة الطلبات المعلقة والتيك أواي"))}</span>
            <span
              style={{
                background: activeTab === 'list' ? '#ffffff' : '#f1f5f9',
                color: activeTab === 'list' ? '#170e5e' : '#475569',
                fontSize: '11px',
                padding: '1px 7px',
                borderRadius: '999px',
                fontWeight: 900,
              }}
            >
              {heldDrafts.length}
            </span>
          </button>
        </div>
  );
}
