// VIEW 2 top header for the waiter station active order: change-table
// button (systemConfirm guard) + title + connectivity badge + guest-count
// stepper. Pure move; the page keeps all state and mounts this component.

import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightIcon } from '@/shared/components/icons/AppIcons';
import { systemConfirm } from '@/shared/components/system-alert';
import type { WaiterCartItem } from '@/features/pos/hooks/useWaiterStation';

export interface WaiterStationOrderHeaderProps {
  isMobile: boolean;
  cart: WaiterCartItem[];
  setSelectedTable: Dispatch<SetStateAction<string | null>>;
  setCart: Dispatch<SetStateAction<WaiterCartItem[]>>;
  selectedTable: string | null;
  isOnline: boolean;
  offlineQueueCount: number;
  syncOfflineQueue: () => Promise<void>;
  isSyncingQueue: boolean;
  setGuestCount: Dispatch<SetStateAction<number>>;
  guestCount: number;
}

export function WaiterStationOrderHeader({
  isMobile,
  cart,
  setSelectedTable,
  setCart,
  selectedTable,
  isOnline,
  offlineQueueCount,
  syncOfflineQueue,
  isSyncingQueue,
  setGuestCount,
  guestCount,
}: WaiterStationOrderHeaderProps) {
  const { t } = useTranslation();
  return (
    <header
      style={{
        background: '#ffffff',
        color: '#0f172a',
        borderBottom: '1px solid #e2e8f0',
        padding: isMobile ? '10px 14px' : '12px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <button
          type="button"
          onClick={async () => {
            if (cart.length > 0) {
              const ok = await systemConfirm(t('pos.waiter_station_page.s20', "هل تريد إلغاء الطلب الحالي والعودة لشبكة الطاولات؟"));
              if (ok) {
                setSelectedTable(null);
                setCart([]);
              }
            } else {
              setSelectedTable(null);
            }
          }}
          style={{
            background: '#eef2ff',
            border: '1px solid #c7d2fe',
            borderRadius: '8px',
            padding: '6px 14px',
            color: '#170e5e',
            fontSize: '12px',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <ArrowRightIcon size={14} color="#170e5e" strokeWidth={2.5} />
          <span>{t('pos.waiter_station_page.s21', "تغيير الطاولة")}</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '3px', height: '18px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
            {t('pos.waiter_station_page.s22', "تسجيل طلب: طاولة")} {selectedTable}
          </h1>
        </div>
      </div>

      {/* Right Header Section: Connectivity & Covers RTL Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Connectivity Badge */}
        {isOnline && offlineQueueCount === 0 ? (
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              background: '#f8fafc',
              color: '#0f172a',
              border: '1px solid #e2e8f0',
              padding: '3px 10px',
              borderRadius: '20px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            <span>{t('pos.waiter_station_page.s23', "متصل")}</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void syncOfflineQueue()}
            disabled={isSyncingQueue}
            style={{
              fontSize: '11px',
              fontWeight: 800,
              background: '#fef3c7',
              color: '#92400e',
              border: '1px solid #fde68a',
              padding: '3px 10px',
              borderRadius: '20px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title={t('pos.waiter_station_page.s24', "انقر لمزامنة الطلبات المحفوظة محلياً مع السيرفر")}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#d97706', display: 'inline-block' }} />
            <span>{isOnline ? `مزامنة (${offlineQueueCount})` : `أوفلاين (${offlineQueueCount})`}</span>
          </button>
        )}

        {/* Covers RTL Stepper: [+] first, label, [-] last */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('pos.waiter_station_page.s25', "الضيوف:")}</span>
          <div style={{ display: 'inline-flex', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', height: '32px' }}>
            <button
              type="button"
              onClick={() => setGuestCount((c) => c + 1)}
              style={{ width: '32px', height: '100%', border: 'none', background: 'transparent', fontSize: '15px', fontWeight: 900, color: '#170e5e', cursor: 'pointer' }}
            >
              +
            </button>
            <span style={{ minWidth: '32px', textAlign: 'center', fontSize: '13px', fontWeight: 900, color: '#0f172a' }}>
              {guestCount}
            </span>
            <button
              type="button"
              onClick={() => setGuestCount((c) => Math.max(1, c - 1))}
              style={{ width: '32px', height: '100%', border: 'none', background: 'transparent', fontSize: '15px', fontWeight: 900, color: '#64748b', cursor: 'pointer' }}
            >
              -
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
