import { useTranslation } from 'react-i18next';
import type { TableServiceCall } from '@/shared/api/table-calls.api';

export interface WaiterStationTableKpisProps {
  isMobile: boolean;
  tablesCount: number;
  occupiedTablesMap: Map<string, any>;
  pendingCalls: TableServiceCall[];
}

export function WaiterStationTableKpis({
  isMobile,
  tablesCount,
  occupiedTablesMap,
  pendingCalls,
}: WaiterStationTableKpisProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: isMobile ? '8px 12px' : '10px 24px',
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(auto-fit, minmax(130px, 1fr))' : 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: isMobile ? '8px' : '12px',
      }}
    >
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>{t('pos.waiter_station_page.s5', "إجمالي طاولات الصالة:")}</span>
        <span style={{ fontSize: '17px', fontWeight: 900, color: '#170e5e' }}>{tablesCount}</span>
      </div>
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>{t('pos.waiter_station_page.s6', "شاغرة ومتاحة:")}</span>
        </div>
        <span style={{ fontSize: '17px', fontWeight: 900, color: '#15803d' }}>{tablesCount - occupiedTablesMap.size}</span>
      </div>
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: occupiedTablesMap.size > 0 ? '#ef4444' : '#94a3b8', display: 'inline-block' }} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>{t('pos.waiter_station_page.s7', "مشغولة حالياً:")}</span>
        </div>
        <span style={{ fontSize: '17px', fontWeight: 900, color: occupiedTablesMap.size > 0 ? '#b91c1c' : '#64748b' }}>{occupiedTablesMap.size}</span>
      </div>
      {pendingCalls.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#92400e' }}>{t('pos.waiter_station_page.s8', "نداءات الزبائن:")}</span>
          </div>
          <span style={{ fontSize: '17px', fontWeight: 900, color: '#b45309' }}>{pendingCalls.length}</span>
        </div>
      )}
    </div>
  );
}
