// Urgent service-calls banner for the waiter station table list.
// Pure move; the page keeps all state and mounts this component.

import { useTranslation } from 'react-i18next';
import { BellIcon } from '@/shared/components/icons/AppIcons';
import type { TableServiceCall } from '@/shared/api/table-calls.api';

export interface WaiterStationServiceCallsBannerProps {
  pendingCalls: TableServiceCall[];
  handleResolveCall: (e: React.MouseEvent, callId: number) => Promise<void>;
}

export function WaiterStationServiceCallsBanner({
  pendingCalls,
  handleResolveCall,
}: WaiterStationServiceCallsBannerProps) {
  const { t } = useTranslation();
  return (
    <>
        {pendingCalls.length > 0 && (
          <div
            style={{
              background: '#fffbeb',
              borderBottom: '2px solid #f59e0b',
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              overflowX: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, color: '#92400e', fontSize: '12.5px', whiteSpace: 'nowrap' }}>
              <BellIcon size={16} color="#d97706" />
              <span>{t('pos.waiter_station_page.s9', "نداءات الزبائن العاجلة (")}{pendingCalls.length}):</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap' }}>
              {pendingCalls.map((call) => (
                <div
                  key={call.id}
                  style={{
                    background: call.call_type === 'bill' ? '#fee2e2' : '#ffffff',
                    border: `1px solid ${call.call_type === 'bill' ? '#fca5a5' : '#fde68a'}`,
                    borderRadius: '8px',
                    padding: '4px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  }}
                >
                  <strong style={{ fontSize: '12px', color: '#0f172a' }}>{t('pos.waiter_station_page.s10', "طاولة")} {call.table_number}</strong>
                  <span style={{ fontSize: '11px', color: call.call_type === 'bill' ? '#991b1b' : '#92400e', fontWeight: 700 }}>
                    {call.call_type === 'bill' ? t('pos.waiter_station_page.s11', "طلب الحساب") : t('pos.waiter_station_page.s12', "استدعاء ويتر")}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => void handleResolveCall(e, call.id)}
                    style={{
                      background: call.call_type === 'bill' ? '#dc2626' : '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {t('pos.waiter_station_page.s13', "تم الحضور")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
    </>
  );
}
