import { useTranslation } from 'react-i18next';
import type { useNavigate } from 'react-router-dom';
import { DisplayLanguageToggle } from '@/shared/components/DisplayLanguageToggle';
import { ArrowRightIcon } from '@/shared/components/icons/AppIcons';

export interface WaiterStationTableHeaderProps {
  navigate: ReturnType<typeof useNavigate>;
  isOnline: boolean;
  offlineQueueCount: number;
  syncOfflineQueue: () => Promise<void>;
  isSyncingQueue: boolean;
  waiterPin: string;
  currentLang: string;
  toggleLanguage: () => void;
}

export function WaiterStationTableHeader({
  navigate,
  isOnline,
  offlineQueueCount,
  syncOfflineQueue,
  isSyncingQueue,
  waiterPin,
  currentLang,
  toggleLanguage,
}: WaiterStationTableHeaderProps) {
  const { t } = useTranslation();
  return (
    <header
      style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <button
          type="button"
          onClick={() => navigate('/pos')}
          style={{
            background: '#eef2ff',
            border: '1px solid #c7d2fe',
            borderRadius: '8px',
            padding: '7px 14px',
            color: '#170e5e',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            fontWeight: 800,
            transition: 'all 0.15s ease',
          }}
        >
          <ArrowRightIcon size={14} color="#170e5e" strokeWidth={2.5} />
          <span>{t('pos.waiter_station_page.s0', "العودة للكاشير")}</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '3px', height: '18px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
          <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
            {t('pos.waiter_station_page.s1', "محطة الويتر وكابتن الصالة (Captain Station)")}
          </h1>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Connectivity Badge */}
        {isOnline && offlineQueueCount === 0 ? (
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              background: '#f8fafc',
              color: '#0f172a',
              border: '1px solid #e2e8f0',
              padding: '4px 10px',
              borderRadius: '20px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            <span>{t('pos.waiter_station_page.s2', "متصل بالشبكة")}</span>
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
              padding: '4px 10px',
              borderRadius: '20px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title={t('pos.waiter_station_page.s3', "انقر لمزامنة الطلبات المحفوظة محلياً مع السيرفر")}
          >
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#d97706', display: 'inline-block' }} />
            <span>{isOnline ? `مزامنة (${offlineQueueCount} معلق)` : `أوفلاين (${offlineQueueCount} معلق)`}</span>
          </button>
        )}

        <span style={{ fontSize: '12px', background: '#eef2ff', color: '#170e5e', border: '1px solid #c7d2fe', padding: '4px 12px', borderRadius: '8px', fontWeight: 800 }}>
          {t('pos.waiter_station_page.s4', "كابتن #")}{waiterPin}
        </span>

        <DisplayLanguageToggle currentLang={currentLang} onToggle={toggleLanguage} />
      </div>
    </header>
  );
}
