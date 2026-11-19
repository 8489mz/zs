import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { ZErpIcon } from '@/shared/components/z-erp-brand';
import type { OfflinePosSale } from '@/features/pos/lib/pos-offline-sync';

// PageHeader badge value of the POS workspace header: brand mark,
// offline-queue alert and offline-queue button. Pure move from
// PosWorkspaceHeader; the header keeps all state and hooks.

export interface PosWorkspaceHeaderBadgeProps {
  queueError: string | null;
  offlineQueue: OfflinePosSale[];
  hasFailedSales: boolean;
  isSyncing: boolean;
  setIsOfflineQueueModalOpen: Dispatch<SetStateAction<boolean>>;
}

export function PosWorkspaceHeaderBadge({
  queueError,
  offlineQueue,
  hasFailedSales,
  isSyncing,
  setIsOfflineQueueModalOpen,
}: PosWorkspaceHeaderBadgeProps) {
  const { t } = useTranslation();
  return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', direction: 'ltr', color: '#0f172a' }} aria-label="Z ERP">
          <span className="pos-header-brand-mark" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <ZErpIcon size={26} />
            <strong style={{ fontSize: '13px', fontWeight: 900, letterSpacing: '0.02em', lineHeight: 1 }}>ERP</strong>
          </span>
          {queueError ? (
            <span role="alert" style={{ color: '#991b1b', border: '1px solid #fca5a5', background: '#fee2e2', padding: '3px 8px', marginRight: 8, fontSize: 12, borderRadius: 6 }}>
              {queueError}
            </span>
          ) : null}
          {offlineQueue.length > 0 && (
            <button
              type="button"
              onClick={() => setIsOfflineQueueModalOpen(true)}
              title={t('pos.pos_workspace.pos_workspace_header.s1', "انقر لعرض وإدارة الفواتير المعلقة بدون إنترنت")}
              style={{
                background: hasFailedSales ? '#fee2e2' : '#ffedd5',
                color: hasFailedSales ? '#991b1b' : '#9a3412',
                border: hasFailedSales ? '1px solid #fca5a5' : '1px solid #fed7aa',
                padding: '3px 10px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: 700,
                marginRight: '8px',
                direction: 'rtl',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'transform 0.1s ease',
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: hasFailedSales ? '#dc2626' : '#d97706', display: 'inline-block' }} />
              <span>{isSyncing ? t('pos.pos_workspace.pos_workspace_header.s2', "جاري المزامنة...") : `${offlineQueue.length} فواتير معلقة`}</span>
            </button>
          )}
        </span>
  );
}
