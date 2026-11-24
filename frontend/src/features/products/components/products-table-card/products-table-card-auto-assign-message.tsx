import { XIcon } from '@/shared/components/icons/AppIcons';

export interface ProductsTableCardAutoAssignMessageProps {
  autoAssignMsg: { type: 'success' | 'info' | 'error'; text: string } | null;
  setAutoAssignMsg: (val: { type: 'success' | 'info' | 'error'; text: string } | null) => void;
}

export function ProductsTableCardAutoAssignMessage({ autoAssignMsg, setAutoAssignMsg }: ProductsTableCardAutoAssignMessageProps) {
  return (
    <>
    {autoAssignMsg && (
      <div
        style={{
          padding: '10px 14px',
          borderRadius: '8px',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '13px',
          fontWeight: 600,
          background: autoAssignMsg.type === 'success' ? '#f0fdf4' : autoAssignMsg.type === 'info' ? '#eff6ff' : '#fef2f2',
          color: autoAssignMsg.type === 'success' ? '#15803d' : autoAssignMsg.type === 'info' ? '#1d4ed8' : '#b91c1c',
          border: `1px solid ${autoAssignMsg.type === 'success' ? '#bbf7d0' : autoAssignMsg.type === 'info' ? '#bfdbfe' : '#fecaca'}`,
        }}
      >
        <span>{autoAssignMsg.text}</span>
        <button
          type="button"
          onClick={() => setAutoAssignMsg(null)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            padding: '0 4px',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <XIcon size={14} />
        </button>
      </div>
    )}
    </>
  );
}
