import React from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { PackageIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'i18next';
import type { VanSettleTabProps } from './van-settle-types';

export interface InventoryListProps {
  // NonNullable: S0 declares inventory optional, but the facade destructures
  // inventory = [] (always defined) and the body calls inventory.length/.map
  // unguarded; the plain indexed-access type would fail CI tsc (strict).
  // Same applied pattern as S9 (sales) / S11 (returns).
  inventory: NonNullable<VanSettleTabProps['inventory']>;
  t: TFunction;
}

export const InventoryList: React.FC<InventoryListProps> = ({ inventory = [], t }) => {
  return (
    <>
    {/* 6. REMAINING VAN INVENTORY */}
      {inventory.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
          <PackageIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s97', "السيارة فارغة حالياً (تم بيع أو تفريغ كافة البضاعة)")}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {inventory.map((item) => {
            const lineTotal = Number(item.qty || 0) * Number(item.retailPrice || 0);
            return (
              <div
                key={item.productId}
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a', display: 'block' }}>
                    {item.productName}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {t('delivery_reps.van_settle_tab.s98', "كود:")} {item.barcode || '—'} {item.unitName && `• ${item.unitName}`}
                  </span>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: 900,
                      color: '#170e5e',
                      backgroundColor: '#eef2ff',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      display: 'inline-block',
                    }}
                  >
                    {item.qty} {item.unitName || t('delivery_reps.van_settle_tab.s99', "قطعة")}
                  </span>
                  <span style={{ display: 'block', fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>
                    {t('delivery_reps.van_settle_tab.s100', "بقيمة")} {lineTotal.toFixed(2)} <CurrencySymbol />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
