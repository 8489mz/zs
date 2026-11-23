import { XIcon } from '@/shared/components/icons/AppIcons';

export interface SettingsDemoDataWizardNotificationProps {
  notification: { kind: 'success' | 'error'; message: string } | null;
  setNotification: React.Dispatch<React.SetStateAction<{ kind: 'success' | 'error'; message: string } | null>>;
}

export function SettingsDemoDataWizardNotification(props: SettingsDemoDataWizardNotificationProps) {
  const { notification, setNotification } = props;
  return (
    <>
    {notification && (
      <div
        style={{
          padding: '12px 18px',
          borderRadius: '12px',
          fontSize: '0.88rem',
          fontWeight: 700,
          background: notification.kind === 'success' ? '#ecfdf5' : '#fff1f2',
          color: notification.kind === 'success' ? '#047857' : '#be123c',
          border: notification.kind === 'success' ? '1px solid #a7f3d0' : '1px solid #fecdd3',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{notification.message}</span>
        <button
          onClick={() => setNotification(null)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'inherit' }}
        >
          <XIcon size={16} />
        </button>
      </div>
    )}
    </>
  );
}
