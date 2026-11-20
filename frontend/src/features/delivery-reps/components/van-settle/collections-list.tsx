import React from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { ClockIcon, DollarSignIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'react-i18next';
import type { VanSettleTabProps } from './van-settle-types';

export interface CollectionsListProps {
  collections: VanSettleTabProps['collections'];
  formatTime: (iso?: string) => string;
  t: TFunction;
}

export const CollectionsList: React.FC<CollectionsListProps> = ({
  collections = [],
  formatTime,
  t,
}) => {
  return (
    <>
      {/* 2. CASH COLLECTIONS */}
      {collections.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
          <DollarSignIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s73', "لا توجد سندات قبض أو تحصيلات نقدية مسجلة")}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {collections.map((col) => (
            <div
              key={col.id}
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '10px',
                padding: '10px 12px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                  {col.customerName}
                </span>
                <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#0284c7' }}>
                  +{Number(col.amount).toFixed(2)} <CurrencySymbol />
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#64748b' }}>
                <span>{t('delivery_reps.van_settle_tab.s74', "سند قبض نقدي من مديونية عميل")}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <ClockIcon size={12} color="#94a3b8" />
                  {formatTime(col.createdAt)}
                </span>
              </div>
              {col.note && (
                <div style={{ fontSize: '10.5px', color: '#475569', backgroundColor: '#ffffff', padding: '4px 8px', borderRadius: '4px', border: '1px dashed #cbd5e1' }}>
                  {t('delivery_reps.van_settle_tab.s75', "ملاحظة:")} {col.note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
};
