import { AppIcons } from '@/shared/components/icons/AppIcons';

export interface ContractingMasterBoqNotificationProps {
  notification: { type: 'success' | 'error'; text: string } | null;
  setNotification: (val: { type: 'success' | 'error'; text: string } | null) => void;
}

export function ContractingMasterBoqNotification({ notification, setNotification }: ContractingMasterBoqNotificationProps) {
  return (
    <>
    {/* التنبيهات الإرشادية */}
    {notification && (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: '8px',
          fontSize: 'var(--font-body)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          background: notification.type === 'success' ? '#f0fdf4' : '#fef2f2',
          color: notification.type === 'success' ? '#15803d' : '#b91c1c',
          border: `1px solid ${notification.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
        }}
      >
        <span>{notification.text}</span>
        <button
          type="button"
          onClick={() => setNotification(null)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
        >
          <AppIcons.X size={16} />
        </button>
      </div>
    )}
    </>
  );
}
