// Compact window controls — chrome toggle and fullscreen for the POS header.
// Pure move; the header keeps all state and mounts this component.

import { useTranslation } from 'react-i18next';
import { MenuIcon, MaximizeIcon } from '@/shared/components/icons/AppIcons';
import { dispatchPosChromeToggle, dispatchPosFullscreenToggle } from '@/features/pos/lib/pos-shell';

export function PosWorkspaceHeaderWindowControls() {
  const { t } = useTranslation();
  return (
    <>
          {/* 8. Compact Window Controls */}
          <div className="desktop-only-toolbar-item pos-window-controls" style={{ display: 'flex', alignItems: 'center', gap: '4px', marginInlineStart: 'auto' }}>
            <button
              type="button"
              onClick={() => dispatchPosChromeToggle()}
              title={t('pos.pos_workspace.pos_workspace_header.s51', "إظهار / إخفاء القائمة الجانبية (F10)")}
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#475569',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#0f172a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.color = '#475569'; }}
            >
              <MenuIcon size={16} />
            </button>
            <button
              type="button"
              onClick={() => dispatchPosFullscreenToggle()}
              title={t('pos.pos_workspace.pos_workspace_header.s52', "ملء الشاشة الكاملة (F11)")}
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#475569',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#0f172a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.color = '#475569'; }}
            >
              <MaximizeIcon size={15} />
            </button>
          </div>
    </>
  );
}
