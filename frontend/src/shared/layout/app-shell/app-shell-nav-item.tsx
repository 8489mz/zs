import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AppNavIcon } from '@/shared/layout/nav-icons';
import { useTabsStore } from '@/stores/tabs-store';
import { prefetchRouteData } from '@/app/router/route-prefetch';
import type { NavigationItemDefinition } from '@/app/router/types';
import { activeIconTone, defaultIconTone } from '@/shared/layout/app-shell/app-shell-types';
import type { SidebarContextMenuState } from '@/shared/layout/app-shell/app-shell-sidebar';

export interface AppShellNavItemProps {
  item: NavigationItemDefinition;
  keyPrefix: string;
  onContextMenu: Dispatch<SetStateAction<SidebarContextMenuState>>;
  visibleNavigationItems: NavigationItemDefinition[];
  effectiveSidebarCollapsed: boolean;
  pendingOrdersCount: number;
  isSidebarSearchOpen: boolean;
  handleCloseSidebarSearch: () => void;
}

export function AppShellNavItem({
  item,
  keyPrefix,
  onContextMenu,
  visibleNavigationItems,
  effectiveSidebarCollapsed,
  pendingOrdersCount,
  isSidebarSearchOpen,
  handleCloseSidebarSearch,
}: AppShellNavItemProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const tabsStore = useTabsStore();
  const computeActive = (isActive: boolean) => {
    if (item.to.includes('?')) {
      const [itemBasePath, itemQuery] = item.to.split('?');
      if (location.pathname !== itemBasePath) return false;
      const itemParams = new URLSearchParams(itemQuery);
      const currentParams = new URLSearchParams(location.search);
      const targetTab = itemParams.get('tab');
      const defaultTab = location.pathname.includes('contracting') ? 'projects' : 'rfqs';
      const currentTab = currentParams.get('tab') || defaultTab;
      return currentTab === targetTab;
    }
    if (item.activePaths?.includes(location.pathname)) return true;
    if (isActive && item.to !== location.pathname) {
      const hasMoreSpecificItem = visibleNavigationItems.some(
        (other) => other.key !== item.key && (other.to === location.pathname || other.activePaths?.includes(location.pathname))
      );
      if (hasMoreSpecificItem) return false;
    }
    return isActive;
  };

  return (
    <NavLink 
      key={`${keyPrefix}-${item.key}`} 
      to={item.to} 
      end={item.end ?? (item.key === 'hr' || item.key === 'dashboard')} 
      data-key={item.key} 
      data-tooltip={effectiveSidebarCollapsed ? item.label : undefined}
      style={({ isActive }) => {
        const isPathActive = computeActive(isActive);
        const tone = isPathActive ? activeIconTone : defaultIconTone;
        return { '--icon-bg': tone.bg, '--icon-border': tone.border, '--icon-fg': tone.fg, '--icon-glow': tone.glow } as CSSProperties;
      }} 
      onMouseEnter={() => prefetchRouteData(item.to)}
      onFocus={() => prefetchRouteData(item.to)}
      onTouchStart={() => prefetchRouteData(item.to)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu({
          isOpen: true,
          position: { x: e.clientX, y: e.clientY },
          target: {
            path: item.to,
            label: item.label,
            iconKey: item.key,
          },
        });
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          const { id } = tabsStore.openTab({
            path: item.to,
            title: item.label,
            iconKey: item.key,
            makeActive: true,
          });
          tabsStore.setActiveTabId(id);
          navigate(item.to);
        }
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }} 
      onClick={() => {
        tabsStore.syncCurrentRoute(item.to, item.label, item.key);
        if (isSidebarSearchOpen) {
          setTimeout(() => {
            handleCloseSidebarSearch();
          }, 0);
        }
      }}
      className={({ isActive }) => {
        const isPathActive = computeActive(isActive);
        return `sidebar-link ${keyPrefix === 'group' ? 'sidebar-link-sub ' : ''}${isPathActive ? 'active' : ''}`.trim();
      }}
    >
      <span className="sidebar-icon"><AppNavIcon itemKey={item.key} /></span>
      <span className="sidebar-label">{item.label}</span>
      {item.key === 'online-orders' && pendingOrdersCount > 0 && (
        <span
          style={{
            background: '#ef4444',
            color: '#ffffff',
            borderRadius: '999px',
            padding: '1px 7px',
            fontSize: '11px',
            fontWeight: 800,
            marginInlineStart: 'auto',
            boxShadow: '0 1px 4px rgba(239, 68, 68, 0.4)',
          }}
        >
          {pendingOrdersCount}
        </span>
      )}
      <span className="sidebar-link-chevron-spacer" aria-hidden="true" />
    </NavLink>
  );
}
