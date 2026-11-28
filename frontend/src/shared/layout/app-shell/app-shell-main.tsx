import {lazy, Suspense, type Dispatch, type ReactNode, type SetStateAction} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { GlobalAppToolbar } from '@/shared/layout/GlobalAppToolbar';
import { MobileBottomNav } from '@/shared/layout/MobileBottomNav';
import { PasswordRotationGate } from '@/shared/system/password-rotation-gate';
import { PwaInstallBanner } from '@/shared/components/PwaInstallBanner';
import { QuickAttendanceShortcut } from '@/shared/layout/quick-attendance-shortcut';
import { DialogShell } from '@/shared/components/dialog-shell';
import { SidebarContextMenu } from '@/shared/layout/SidebarContextMenu';
import type { SidebarContextMenuState } from '@/shared/layout/app-shell/app-shell-sidebar';
import { ImpersonationBanner } from '@/shared/system/impersonation-banner';
import { BootstrapAdminBanner } from '@/shared/system/bootstrap-admin-banner';
import { TrialStatusBanner } from '@/shared/system/trial-status-banner';
import { SystemStatusBanner } from '@/shared/system/system-status-banner';
import { CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import { Button } from '@/shared/ui/button';
import { canAccessPath } from '@/app/router/access';
import { isStandalonePosTerminal } from '@/features/pos/lib/pos-shell';
import { openExternalWindow } from '@/shared/layout/AppBrowserTabBar';
import { useTabsStore } from '@/stores/tabs-store';
import { toast } from '@/shared/components/system-alert';
import type { AuthUser } from '@/types/auth';

const GlobalSearchModal = lazy(() => import('@/shared/components/GlobalSearchModal').then((m) => ({ default: m.GlobalSearchModal })));
const DeveloperActivationPanel = lazy(() => import('@/shared/system/DeveloperActivationPanel').then((m) => ({ default: m.DeveloperActivationPanel })));
const LiveOrderNotificationBanner = lazy(() => import('@/features/storefront/components/LiveOrderNotificationBanner').then((m) => ({ default: m.LiveOrderNotificationBanner })));
const PosGlobalOfflineSyncHost = lazy(() => import('@/features/pos/components/PosGlobalOfflineSyncHost').then((m) => ({ default: m.PosGlobalOfflineSyncHost })));

export type AppShellMainProps = {
  isPosRoute: boolean;
  isPosChromeHidden: boolean;
  isMobileScreen: boolean;
  user: AuthUser | null;
  canQueryOnlineOrders: boolean;
  isStorefrontEntitled: boolean;
  pendingOrdersCount: number;
  quickAttendanceOpen: boolean;
  setQuickAttendanceOpen: Dispatch<SetStateAction<boolean>>;
  isAboutModalOpen: boolean;
  setIsAboutModalOpen: Dispatch<SetStateAction<boolean>>;
  cleanWorkspaceName: string;
  displayName: string;
  sidebarContextMenu: SidebarContextMenuState;
  setSidebarContextMenu: Dispatch<SetStateAction<SidebarContextMenuState>>;
  children: ReactNode;
};

export function AppShellMain({
  isPosRoute,
  isPosChromeHidden,
  isMobileScreen,
  user,
  canQueryOnlineOrders,
  isStorefrontEntitled,
  pendingOrdersCount,
  quickAttendanceOpen,
  setQuickAttendanceOpen,
  isAboutModalOpen,
  setIsAboutModalOpen,
  cleanWorkspaceName,
  displayName,
  sidebarContextMenu,
  setSidebarContextMenu,
  children,
}: AppShellMainProps) {
  const { t: __t } = useTranslation();
  const navigate = useNavigate();
  const tabsStore = useTabsStore();

  return (
    <>
      <div className="main-col">
        {!isPosRoute && <GlobalAppToolbar />}
        <div className={`content-wrap ${isPosRoute ? 'content-wrap-pos' : ''} ${isPosRoute && isPosChromeHidden ? 'content-wrap-pos-focus' : ''}`.trim()}>
          {!isPosRoute && (
            <div className="stack gap-12" style={{ padding: '12px 16px 0' }}>
              <ImpersonationBanner />
              <BootstrapAdminBanner />
              <TrialStatusBanner />
              <SystemStatusBanner />
            </div>
          )}
          <main className={`page-stack ${isPosRoute ? 'page-stack-pos' : ''} ${isPosRoute && isPosChromeHidden ? 'page-stack-pos-focus' : ''}`.trim()}>{children}</main>
        </div>
      </div>
      {!isPosRoute && !isStandalonePosTerminal() && (isMobileScreen || !isPosChromeHidden) && <MobileBottomNav />}
      <PasswordRotationGate />
      <PwaInstallBanner />
      {canAccessPath(user, '/hr/attendance') && <QuickAttendanceShortcut open={quickAttendanceOpen} onClose={() => setQuickAttendanceOpen(false)} />}
      <Suspense fallback={null}>
        {user ? <PosGlobalOfflineSyncHost /> : null}
        {canQueryOnlineOrders && (isStorefrontEntitled || pendingOrdersCount > 0) ? <LiveOrderNotificationBanner /> : null}
        <GlobalSearchModal />
        <DeveloperActivationPanel />
      </Suspense>
      {isAboutModalOpen && (
        <DialogShell
          open={true}
          onClose={() => setIsAboutModalOpen(false)}
          width="460px"
        >
          <div style={{ textAlign: 'center', padding: '28px 24px 20px 24px' }}>
            <div style={{
              width: '84px',
              height: '84px',
              margin: '0 auto 14px auto',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 10px 25px rgba(15, 23, 42, 0.2)',
              padding: '10px'
            }}>
              <img 
                src="./brand/z-erp-approved-icon.png" 
                alt="Z Systems" 
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
            
            <h2 style={{ margin: '0 0 4px 0', fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
              Z Systems ERP
            </h2>
            <p style={{ margin: '0 0 14px 0', fontSize: '12.5px', color: '#64748b' }}>
              {__t('shared.layout.app_shell.s9', "منظومة إدارة المبيعات، المخازن، الحسابات، ونقاط البيع")}
            </p>

            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 14px',
              borderRadius: '20px',
              backgroundColor: '#f1f5f9',
              border: '1px solid #e2e8f0',
              fontSize: '12px',
              fontWeight: 700,
              color: '#334155',
              marginBottom: '18px'
            }}>
              <span>{__t('shared.layout.app_shell.s10', "الإصدار:")}</span>
              <span style={{ color: '#2563eb' }}>v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.14'}</span>
              <span style={{ color: '#10b981' }}>{__t('shared.layout.app_shell.s11', "● نسخة مفعلة")}</span>
            </div>

            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '14px 16px',
              textAlign: 'right',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '12.5px',
              marginBottom: '20px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>{__t('shared.layout.app_shell.s12', "المؤسسة:")}</span>
                <strong style={{ color: '#0f172a' }}>{cleanWorkspaceName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>{__t('shared.layout.app_shell.s13', "المستخدم النشط:")}</span>
                <strong style={{ color: '#0f172a' }}>{displayName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>{__t('shared.layout.app_shell.s14', "حالة الربط والبيانات:")}</span>
                <span style={{ color: '#059669', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircleIcon size={14} color="#059669" /> {__t('shared.layout.app_shell.s15', "متصل ومؤمّن")}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button 
                type="button"
                onClick={() => {
                  window.open('https://wa.me/201018017523', '_blank');
                }}
                style={{ 
                  flex: 1, 
                  padding: '10px 16px', 
                  fontSize: '13px',
                  fontWeight: 700,
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 2px 8px rgba(15, 23, 42, 0.2)',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1e1b4b')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0f172a')}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="#25D366">
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 15 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.04C9.36 7.04 9.09 7.11 8.87 7.34C8.64 7.58 8 8.18 8 9.4C8 10.62 8.89 11.8 9.01 11.96C9.14 12.12 10.76 14.62 13.23 15.69C13.82 15.94 14.28 16.09 14.64 16.21C15.23 16.4 15.77 16.37 16.2 16.31C16.68 16.24 17.68 15.7 17.89 15.12C18.09 14.54 18.09 14.04 18.03 13.94C17.97 13.84 17.81 13.78 17.56 13.66C17.31 13.53 16.09 12.93 15.86 12.85C15.63 12.77 15.47 12.73 15.3 12.97C15.13 13.22 14.65 13.78 14.51 13.94C14.36 14.11 14.22 14.13 13.97 14C13.72 13.88 12.92 13.62 11.97 12.77C11.23 12.11 10.73 11.29 10.59 11.04C10.44 10.79 10.57 10.66 10.7 10.53C10.81 10.42 10.95 10.24 11.07 10.1C11.19 9.96 11.23 9.85 11.31 9.69C11.39 9.53 11.35 9.39 11.29 9.27C11.23 9.15 10.73 7.93 10.53 7.43C10.33 6.95 10.13 7.01 9.97 7C9.83 7 9.67 7.04 9.53 7.04Z"/>
                </svg>
                {__t('shared.layout.app_shell.s16', "الدعم الفني عبر واتساب")}
              </button>
              <Button 
                variant="secondary" 
                onClick={() => setIsAboutModalOpen(false)}
                style={{ padding: '10px 20px', fontSize: '13px' }}
              >
                {__t('shared.layout.app_shell.s17', "إغلاق")}
              </Button>
            </div>
          </div>
        </DialogShell>
      )}
      <SidebarContextMenu
        isOpen={sidebarContextMenu.isOpen}
        position={sidebarContextMenu.position}
        target={sidebarContextMenu.target}
        mode="sidebar"
        onClose={() => setSidebarContextMenu({ isOpen: false, position: { x: 0, y: 0 }, target: null })}
        onOpenInNewTab={(target) => {
          const { id } = tabsStore.openTab({
            path: target.path,
            title: target.label,
            iconKey: target.iconKey,
            makeActive: true,
          });
          tabsStore.setActiveTabId(id);
          navigate(target.path);
        }}
        onOpenInNewWindow={(target) => {
          openExternalWindow(target.path);
          toast.info(__t('shared.layout.app_shell.s18', "تم فتح الصفحة في نافذة مستقلة"));
        }}
        onCopyLink={(target) => {
          try {
            const isElectron = typeof window !== 'undefined' && (Boolean((window as any).electronAPI) || window.navigator.userAgent.toLowerCase().includes('electron'));
            const fullUrl = isElectron 
              ? `${window.location.origin}${window.location.pathname}#${target.path.replace(/^#?\/?/, '/')}`
              : `${window.location.origin}${target.path}`;
            navigator.clipboard.writeText(fullUrl);
            toast.success(__t('shared.layout.app_shell.s19', "تم نسخ رابط الصفحة إلى الحافظة"));
          } catch (_) {
            toast.error(__t('shared.layout.app_shell.s20', "تعذر نسخ الرابط"));
          }
        }}
      />
    </>
  );
}
