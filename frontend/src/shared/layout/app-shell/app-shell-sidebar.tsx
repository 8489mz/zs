import type { CSSProperties, Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { NavigateFunction } from 'react-router-dom';
import { translateUiText } from '@/lib/auto-translator';
import { Button } from '@/shared/ui/button';
import { SearchIcon, XIcon } from '@/shared/components/icons/AppIcons';
import { AppNavIcon } from '@/shared/layout/nav-icons';
import type { ContextMenuTarget } from '@/shared/layout/SidebarContextMenu';
import type { NavigationItemDefinition } from '@/app/router/types';
import {activeIconTone, defaultIconTone, type SidebarGroupDefinition} from '@/shared/layout/app-shell/app-shell-types';
import { AppShellNavItem } from '@/shared/layout/app-shell/app-shell-nav-item';

export type SidebarContextMenuState = {
  isOpen: boolean;
  position: { x: number; y: number };
  target: ContextMenuTarget | null;
};

export type AppShellSidebarGroup = {
  group: SidebarGroupDefinition;
  groupItems: NavigationItemDefinition[];
  isActive: boolean;
  isOpen: boolean;
};

export type AppShellSidebarProps = {
  isPosRoute: boolean;
  isPosChromeHidden: boolean;
  isMobileScreen: boolean;
  isStandalonePosTerminal: () => boolean;
  sidebarRef: RefObject<HTMLElement | null>;
  sidebarSearchWrapperRef: RefObject<HTMLDivElement | null>;
  sidebarSearchInputRef: RefObject<HTMLInputElement | null>;
  isMobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  navigate: NavigateFunction;
  isEn: boolean;
  cleanWorkspaceName: string;
  formatWorkspaceName: (name: string, isEn?: boolean) => ReactNode;
  setIsAboutModalOpen: Dispatch<SetStateAction<boolean>>;
  isSidebarSearchOpen: boolean;
  handleOpenSidebarSearch: () => void;
  handleCloseSidebarSearch: () => void;
  effectiveSidebarCollapsed: boolean;
  sidebarSearchQuery: string;
  setSidebarSearchQuery: Dispatch<SetStateAction<string>>;
  filteredPrimaryNavigationItems: NavigationItemDefinition[];
  filteredSidebarGroups: AppShellSidebarGroup[];
  visibleNavigationItems: NavigationItemDefinition[];
  pendingOrdersCount: number;
  toggleSidebar: () => void;
  isSearchingSidebar: boolean;
  totalMatchingItemsCount: number;
  displayName: string;
  updateInfo: { updateAvailable?: boolean } | undefined;
  handleLogout: () => void;
  setSidebarContextMenu: Dispatch<SetStateAction<SidebarContextMenuState>>;
};

export function AppShellSidebar({
  isPosRoute,
  isPosChromeHidden,
  isMobileScreen,
  isStandalonePosTerminal,
  sidebarRef,
  sidebarSearchWrapperRef,
  sidebarSearchInputRef,
  isMobileSidebarOpen,
  setMobileSidebarOpen,
  navigate,
  isEn,
  cleanWorkspaceName,
  formatWorkspaceName,
  setIsAboutModalOpen,
  isSidebarSearchOpen,
  handleOpenSidebarSearch,
  handleCloseSidebarSearch,
  effectiveSidebarCollapsed,
  sidebarSearchQuery,
  setSidebarSearchQuery,
  filteredPrimaryNavigationItems,
  filteredSidebarGroups,
  visibleNavigationItems,
  pendingOrdersCount,
  toggleSidebar,
  isSearchingSidebar,
  totalMatchingItemsCount,
  displayName,
  updateInfo,
  handleLogout,
  setSidebarContextMenu,
}: AppShellSidebarProps) {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  return (!isPosRoute || (!isPosChromeHidden && !isMobileScreen && !isStandalonePosTerminal())) ? (
    <>
      <aside ref={sidebarRef} className={`sidebar-fixed ${isMobileSidebarOpen ? 'is-mobile-open' : ''}`.trim()}>
        <div className="brand">
          <div 
            className="brand-logo" 
            onClick={() => navigate('/')} 
            style={{ cursor: 'pointer' }}
          >
            <img 
              src="./brand/z-erp-approved-icon.png" 
              alt="Z-ERP" 
              className="brand-logo-img"
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.dataset.failed) {
                  img.dataset.failed = '1';
                  img.src = '/brand/z-erp-approved-icon.png';
                }
              }}
            />
          </div>
          <div className="brand-copy" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', flex: '1 1 auto', minWidth: 0 }}>
            <div className="brand-title" style={{ textAlign: 'center', width: '100%' }} title={isEn ? (translateUiText(cleanWorkspaceName) || cleanWorkspaceName) : cleanWorkspaceName}>{formatWorkspaceName(cleanWorkspaceName, isEn)}</div>
            <div 
              className="brand-sub-interactive" 
              onClick={() => setIsAboutModalOpen(true)}
              title="About Z-Systems & Tech Support"
              style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', margin: '0 auto' }}
            >
              <span className="brand-powered-label" style={{ textAlign: 'center', width: '100%', display: 'block' }}>Powered by</span>
              <span className="brand-powered-name" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', textAlign: 'center' }}>
                Z-Systems
              </span>
            </div>
          </div>
          <div className="brand-logo-spacer" aria-hidden="true" />
        </div>

      {/* Centered Expandable Search Micro-Interaction */}
      <div ref={sidebarSearchWrapperRef} className="sidebar-search-wrapper">
        <div 
          className={`sidebar-search-pill ${isSidebarSearchOpen ? 'is-expanded' : ''}`}
          onClick={() => {
            if (!isSidebarSearchOpen) handleOpenSidebarSearch();
          }}
        >
          <button 
            type="button" 
            className="sidebar-search-icon-btn" 
            data-tooltip={effectiveSidebarCollapsed ? (isEn ? "Quick search (Ctrl + K)" : __t('shared.layout.app_shell.s0', "البحث السريع (Ctrl + K)")) : undefined}
            title={isSidebarSearchOpen ? (isEn ? 'Search' : __t('shared.layout.app_shell.s1', "بحث")) : (effectiveSidebarCollapsed ? undefined : (isEn ? 'Quick search in menus & tabs' : __t('shared.layout.app_shell.s2', "بحث سريع في القوائم والتابات")))}
            onClick={(e) => {
              if (!isSidebarSearchOpen) {
                e.stopPropagation();
                handleOpenSidebarSearch();
              }
            }}
          >
            <SearchIcon size={16} color="#2563eb" strokeWidth={2.4} />
          </button>
          {isSidebarSearchOpen ? (
            <>
              <input
                ref={sidebarSearchInputRef}
                type="text"
                className="sidebar-search-input"
                placeholder={isEn ? "Search in tabs & menus..." : __t('shared.layout.app_shell.s3', "ابحث في التابات والقوائم...")}
                value={sidebarSearchQuery}
                onChange={(e) => setSidebarSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCloseSidebarSearch();
                  }
                }}
              />
              <button
                type="button"
                className="sidebar-search-close-btn"
                title={isEn ? "Close search" : __t('shared.layout.app_shell.s4', "إغلاق البحث")}
                onClick={(e) => {
                  e.stopPropagation();
                  if (sidebarSearchQuery) {
                    setSidebarSearchQuery('');
                    sidebarSearchInputRef.current?.focus();
                  } else {
                    handleCloseSidebarSearch();
                  }
                }}
              ><XIcon size={15} /></button>
            </>
          ) : (
            !effectiveSidebarCollapsed && (
              <span className="sidebar-search-placeholder-text">
                {isEn ? "Quick search in menus..." : __t('shared.layout.app_shell.s5', "بحث سريع في القوائم...")}
              </span>
            )
          )}
        </div>
      </div>

      <nav className="sidebar-nav">
        {filteredPrimaryNavigationItems.map((item) => <AppShellNavItem key={`primary-${item.key}`} item={item} keyPrefix="primary" onContextMenu={setSidebarContextMenu} visibleNavigationItems={visibleNavigationItems} effectiveSidebarCollapsed={effectiveSidebarCollapsed} pendingOrdersCount={pendingOrdersCount} isSidebarSearchOpen={isSidebarSearchOpen} handleCloseSidebarSearch={handleCloseSidebarSearch} />)}
        {filteredSidebarGroups.map(({ group, groupItems, isActive, isOpen }) => {
          const groupIconItemKey = group.iconKey || groupItems[0]?.key || 'settings';
          const tone = (isActive || isOpen) ? activeIconTone : defaultIconTone;
          const toneStyle = { '--icon-bg': tone.bg, '--icon-border': tone.border, '--icon-fg': tone.fg, '--icon-glow': tone.glow } as CSSProperties;
          const groupTitle = t(`sidebar.${group.key}`, group.label);
          return (
            <div key={group.key} className={`sidebar-group ${isActive ? 'is-active' : ''} ${isOpen ? 'is-open' : ''}`.trim()}>
              <div 
                className="sidebar-group-trigger" 
                style={toneStyle}
                data-tooltip={effectiveSidebarCollapsed ? groupTitle : undefined}
                onClick={() => {
                  if (effectiveSidebarCollapsed) toggleSidebar();
                }}
                role={effectiveSidebarCollapsed ? 'button' : undefined}
                tabIndex={effectiveSidebarCollapsed ? 0 : undefined}
              >
                <span className="sidebar-group-icon" aria-hidden="true"><AppNavIcon itemKey={groupIconItemKey} /></span>
                <span className="sidebar-label">{groupTitle}</span>
              </div>
              {isOpen ? <div className="sidebar-group-items">{groupItems.map((item) => <AppShellNavItem key={`group-${item.key}`} item={item} keyPrefix="group" onContextMenu={setSidebarContextMenu} visibleNavigationItems={visibleNavigationItems} effectiveSidebarCollapsed={effectiveSidebarCollapsed} pendingOrdersCount={pendingOrdersCount} isSidebarSearchOpen={isSidebarSearchOpen} handleCloseSidebarSearch={handleCloseSidebarSearch} />)}</div> : null}
            </div>
          );
        })}
        {isSearchingSidebar && totalMatchingItemsCount === 0 ? (
          <div className="sidebar-search-empty-state">
            <span className="sidebar-search-empty-state-icon"><SearchIcon size={24} color="#94a3b8" /></span>
            <p className="sidebar-search-empty-state-text">{__t('shared.layout.app_shell.s6', "لا توجد قوائم تطابق \"")}{sidebarSearchQuery}"</p>
          </div>
        ) : null}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-footer-info" style={{ marginBottom: 5 }}>
          <div className="muted small" style={{ lineHeight: 1.2 }}>{t("sidebar.welcome_msg")} {displayName}</div>
          <div className="muted small" style={{ opacity: 0.85, marginTop: 2, fontSize: '0.72rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span>{__t('shared.layout.app_shell.s7', "الإصدار:")} {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'}</span>
            {updateInfo?.updateAvailable && (
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--color-warning)', flexShrink: 0 }} title={__t('shared.layout.app_shell.s8', "تحديث جديد متاح")} />
            )}
          </div>
        </div>
        <div className="sidebar-footer-actions">
          <Button variant="danger" onClick={handleLogout} className="sidebar-logout-btn" data-tooltip={effectiveSidebarCollapsed ? t("sidebar.logout") : undefined}>
            <span className="btn-label">{t("sidebar.logout")}</span>
            <span className="btn-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            </span>
          </Button>
          {!isMobileScreen && (
            <button type="button" onClick={toggleSidebar} className="sidebar-toggle-btn" data-tooltip={effectiveSidebarCollapsed ? t("sidebar.expand_menu") : undefined}>
              {effectiveSidebarCollapsed ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
              )}
            </button>
          )}
        </div>
      </div>
    </aside>
    <div 
      className={`sidebar-mobile-overlay ${isMobileSidebarOpen ? 'is-active' : ''}`.trim()} 
      onClick={() => setMobileSidebarOpen(false)}
      aria-hidden="true"
    />
    </>
  ) : null;
}
