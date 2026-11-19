import { useTranslation } from 'react-i18next';
import { BellIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import type { TableServiceCall } from '@/shared/api/table-calls.api';

export interface WaiterStationTablesGridProps {
  isMobile: boolean;
  tablesCount: number;
  occupiedTablesMap: Map<string, any>;
  pendingCallsByTable: Map<string, TableServiceCall[]>;
  handleSelectTable: (tableNum: string) => void;
}

export function WaiterStationTablesGrid({
  isMobile,
  tablesCount,
  occupiedTablesMap,
  pendingCallsByTable,
  handleSelectTable,
}: WaiterStationTablesGridProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        flex: 1,
        padding: isMobile ? '12px' : '24px',
        overflowY: 'auto',
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(135px, 1fr))' : 'repeat(auto-fill, minmax(185px, 1fr))',
        gap: isMobile ? '10px' : '16px',
        alignContent: 'start',
      }}
    >
      {Array.from({ length: tablesCount }, (_, i) => String(i + 1)).map((tNum) => {
        const occupied = occupiedTablesMap.get(tNum);
        const isOccupied = Boolean(occupied);
        const tableCalls = pendingCallsByTable.get(tNum) || [];
        const hasCall = tableCalls.length > 0;
        const isBillPaid = tableCalls.some((c) => c.call_type === 'bill_paid');
        const isBill = tableCalls.some((c) => c.call_type === 'bill');
        const total = (occupied?.cart || []).reduce(
          (sum: number, it: any) => sum + (it.qty || 1) * Number(it.price || 0),
          0
        );

        return (
          <button
            key={tNum}
            type="button"
            onClick={() => handleSelectTable(tNum)}
            style={{
              background: hasCall ? (isBillPaid ? '#f0fdf4' : isBill ? '#fef2f2' : '#fffbeb') : isOccupied ? '#fff5f5' : '#ffffff',
              border: hasCall ? (isBillPaid ? '2px solid #22c55e' : isBill ? '2px solid #ef4444' : '2px solid #f59e0b') : isOccupied ? '1.5px solid #fca5a5' : '1px solid #e2e8f0',
              borderRadius: '14px',
              padding: isMobile ? '14px 10px' : '20px 14px',
              minHeight: isMobile ? '115px' : '135px',
              minWidth: 0,
              width: '100%',
              boxSizing: 'border-box',
              overflow: 'hidden',
              textAlign: 'center',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.borderColor = '#170e5e';
              e.currentTarget.style.boxShadow = '0 6px 18px rgba(15, 23, 42, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.borderColor = hasCall ? (isBillPaid ? '#22c55e' : isBill ? '#ef4444' : '#f59e0b') : isOccupied ? '#fca5a5' : '#e2e8f0';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.04)';
            }}
          >
            <div style={{ fontSize: '18px', fontWeight: 900, color: isOccupied ? '#991b1b' : '#0f172a' }}>
              {t('pos.waiter_station_page.s14', "طاولة")} {tNum}
            </div>
            {hasCall && (
              <span
                style={{
                  fontSize: '10px',
                  background: isBillPaid ? '#16a34a' : isBill ? '#dc2626' : '#d97706',
                  color: '#ffffff',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <BellIcon size={11} color="#ffffff" />
                <span>{isBillPaid ? t('pos.waiter_station_page.s15', "مسدد إلكترونياً!") : isBill ? t('pos.waiter_station_page.s16', "طلب حساب!") : t('pos.waiter_station_page.s17', "استدعاء!")}</span>
              </span>
            )}
            {isOccupied ? (
              <>
                <div style={{ fontSize: '14px', fontWeight: 900, color: '#dc2626' }}>
                  {formatCurrency(total)}
                </div>
                <span style={{ fontSize: '10.5px', background: '#fee2e2', color: '#b91c1c', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                  {t('pos.waiter_station_page.s18', "مشغولة (")}{occupied.cart?.length || 0})
                </span>
              </>
            ) : (
              <span style={{ fontSize: '11.5px', color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '2px 10px', borderRadius: '20px', fontWeight: 700 }}>
                {t('pos.waiter_station_page.s19', "شاغرة ومتاحة")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
