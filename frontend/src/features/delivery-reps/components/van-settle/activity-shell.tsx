import React from 'react';
import { FileTextIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'react-i18next';
import type { VanPackagingMovement, VanStockItem } from '../../api/van-sales.api';
import type { SettleSubTab, VanSettleTabProps } from './van-settle-types';
import { SalesList } from './sales-list';
import { CollectionsList } from './collections-list';
import { ReturnsList } from './returns-list';
import { ExpensesList } from './expenses-list';
import { PackagingList } from './packaging-list';
import { InventoryList } from './inventory-list';

export interface ActivityShellProps {
  activeSubTab: SettleSubTab;
  setActiveSubTab: (v: SettleSubTab) => void;
  // Declared for the facade mount; unused inside this slice (grep: 0 uses
  // in the whole activity branch L1279-1752) — the merge may drop it.
  totalActivities?: number;
  sales: VanSettleTabProps['sales'];
  collections: VanSettleTabProps['collections'];
  returns: VanSettleTabProps['returns'];
  safeExpenses: VanSettleTabProps['expenses'];
  safePackaging: VanPackagingMovement[];
  inventory: VanStockItem[];
  formatTime: (iso?: string) => string;
  getPaymentMethodBadge: (method: string) => { label: string; bg: string; color: string };
  getReturnStatusBadge: (status: string) => { label: string; bg: string; color: string };
  t: TFunction;
}

export const ActivityShell: React.FC<ActivityShellProps> = ({
  activeSubTab,
  setActiveSubTab,
  sales,
  collections,
  returns,
  safeExpenses,
  safePackaging,
  inventory,
  formatTime,
  getPaymentMethodBadge,
  getReturnStatusBadge,
  t,
}) => {
  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
        <div style={{ width: '34px', height: '34px', backgroundColor: '#f1f5f9', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FileTextIcon size={18} color="#170e5e" strokeWidth={2} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.van_settle_tab.s61', "حركة رحلة اليوم وسجل العمليات")}
          </h3>
          <p style={{ margin: '1px 0 0', fontSize: '11px', color: '#64748b' }}>
            {t('delivery_reps.van_settle_tab.s62', "مراجعة الفواتير والتحصيلات والمرتجعات ومخزون السيارة")}
          </p>
        </div>
      </div>

      {/* Subtab Navigation Bar (2 balanced rows of 3 tabs on mobile, 6 on desktop, 100% visible) */}
      <style>{`
        .van-settle-subtabs {
          display: grid !important;
          grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
          gap: 6px !important;
        }
        @media (min-width: 640px) {
          .van-settle-subtabs {
            grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
          }
        }
      `}</style>
      <div
        className="van-settle-subtabs keep-grid-row"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          padding: '5px',
          borderRadius: '12px',
          gap: '6px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {[
          { key: 'sales', label: t('delivery_reps.van_settle_tab.s63', "فواتير"), count: sales.length },
          { key: 'collections', label: t('delivery_reps.van_settle_tab.s64', "تحصيلات"), count: collections.length },
          { key: 'returns', label: t('delivery_reps.van_settle_tab.s65', "مرتجعات"), count: returns.length },
          { key: 'expenses', label: t('delivery_reps.van_settle_tab.s66', "مصروفات"), count: safeExpenses.length },
          { key: 'packaging', label: t('delivery_reps.van_settle_tab.s67', "فوارغ"), count: safePackaging.length },
          { key: 'inventory', label: t('delivery_reps.van_settle_tab.s68', "المخزون"), count: inventory.length },
        ].map((tab) => {
          const isActive = activeSubTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveSubTab(tab.key as typeof activeSubTab)}
              style={{
                padding: '7px 4px',
                borderRadius: '8px',
                border: isActive ? '1px solid #170e5e' : '1px solid #e2e8f0',
                cursor: 'pointer',
                backgroundColor: isActive ? '#170e5e' : '#ffffff',
                color: isActive ? '#ffffff' : '#334155',
                fontWeight: 700,
                fontSize: '11px',
                whiteSpace: 'nowrap',
                textAlign: 'center',
                boxSizing: 'border-box',
                minWidth: 0,
                boxShadow: isActive ? '0 1px 3px rgba(23, 14, 94, 0.2)' : '0 1px 2px rgba(0, 0, 0, 0.02)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
              }}
            >
              <span>{tab.label}</span>
              <span
                style={{
                  backgroundColor: isActive ? 'rgba(255, 255, 255, 0.25)' : '#f1f5f9',
                  color: isActive ? '#ffffff' : '#64748b',
                  borderRadius: '10px',
                  padding: '1px 5px',
                  fontSize: '10px',
                  fontWeight: 700,
                  lineHeight: '13px',
                }}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Subtab Contents Container (Bounded with Slim Scroll) */}
      <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
        {activeSubTab === 'sales' && (
          <SalesList sales={sales} formatTime={formatTime} getPaymentMethodBadge={getPaymentMethodBadge} t={t} />
        )}

        {activeSubTab === 'collections' && (
          <CollectionsList collections={collections} formatTime={formatTime} t={t} />
        )}

        {activeSubTab === 'returns' && (
          <ReturnsList returns={returns} getReturnStatusBadge={getReturnStatusBadge} t={t} />
        )}

        {activeSubTab === 'expenses' && (
          <ExpensesList safeExpenses={safeExpenses} formatTime={formatTime} t={t} />
        )}

        {activeSubTab === 'packaging' && (
          <PackagingList safePackaging={safePackaging} formatTime={formatTime} t={t} />
        )}

        {activeSubTab === 'inventory' && (
          <InventoryList inventory={inventory} t={t} />
        )}
      </div>
    </div>
  );
};
