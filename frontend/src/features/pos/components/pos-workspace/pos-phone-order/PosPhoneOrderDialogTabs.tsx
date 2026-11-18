// Tab buttons for the phone order dialog header — desk, recent calls, and
// hardware (Caller ID), with the recent-calls count badge and the serial
// status dot. Pure move; the dialog keeps all state and mounts this
// component with the active tab and its setter.

import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ClockIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';
import type { CallerIdCallEvent } from '@/features/pos/lib/pos-caller-id-service';

export function PosPhoneOrderDialogTabs({
  activeTab,
  setActiveTab,
  recentCallsList,
  isSerialConnected,
}: {
  activeTab: 'desk' | 'recent_calls' | 'hardware';
  setActiveTab: Dispatch<SetStateAction<'desk' | 'recent_calls' | 'hardware'>>;
  recentCallsList: CallerIdCallEvent[];
  isSerialConnected: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <button
        type="button"
        onClick={() => setActiveTab('desk')}
        style={{
          background: activeTab === 'desk' ? '#170e5e' : '#f1f5f9',
          color: activeTab === 'desk' ? '#ffffff' : '#475569',
          border: 'none',
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '0.75rem',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {t('pos.pos_workspace.pos_phone_order_dialog.s2', "شاشة الطلبات")}
      </button>
      <button
        type="button"
        onClick={() => setActiveTab('recent_calls')}
        style={{
          background: activeTab === 'recent_calls' ? '#170e5e' : '#f1f5f9',
          color: activeTab === 'recent_calls' ? '#ffffff' : '#475569',
          border: 'none',
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '0.75rem',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <ClockIcon size={12} />
        {t('pos.pos_workspace.pos_phone_order_dialog.s3', "سجل المكالمات")}
        {recentCallsList.length > 0 && (
          <span
            style={{
              background: activeTab === 'recent_calls' ? '#3b82f6' : '#e2e8f0',
              color: activeTab === 'recent_calls' ? '#ffffff' : '#1e293b',
              fontSize: '0.6875rem',
              fontWeight: 800,
              padding: '1px 5px',
              borderRadius: '10px',
            }}
          >
            {recentCallsList.length}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setActiveTab('hardware')}
        style={{
          background: activeTab === 'hardware' ? '#170e5e' : '#f1f5f9',
          color: activeTab === 'hardware' ? '#ffffff' : '#475569',
          border: 'none',
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '0.75rem',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <SlidersIcon size={11} />
        {t('pos.pos_workspace.pos_phone_order_dialog.s4', "كاشف المتصل (Caller ID)")}
        {isSerialConnected && (
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
        )}
      </button>
    </div>
  );
}
