import { CSSProperties, PropsWithChildren, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import { http } from '@/lib/http';
import { Button } from '@/shared/ui/button';
import { authApi } from '@/shared/api/auth';
import { resetAuthenticatedClient } from '@/lib/query-client-session';
import { DEFAULT_STORE_NAME, useAuthStore } from '@/stores/auth-store';
import { navigationItems } from '@/app/router/registry';
import { canAccessNavigationItem, canAccessPath, getHrHomePath, matchesNavigationSearch, isDesktopOfflineApp, isPlatformAdmin, tenantHasFeature } from '@/app/router/access';
import { userHasAnyPermission } from '@/shared/hooks/use-permission';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { PasswordRotationGate } from '@/shared/system/password-rotation-gate';
import { SystemStatusBanner } from '@/shared/system/system-status-banner';
import { BootstrapAdminBanner } from '@/shared/system/bootstrap-admin-banner';
import { TrialStatusBanner } from '@/shared/system/trial-status-banner';
import { ImpersonationBanner } from '@/shared/system/impersonation-banner';
import { PwaInstallBanner } from '@/shared/components/PwaInstallBanner';
import { useOfflineUpdateCheck } from '@/features/updates/hooks/useOfflineUpdateCheck';
import {
  POS_SHELL_VISIBILITY_KEY,
  POS_TOGGLE_CHROME_EVENT,
  POS_TOGGLE_FULLSCREEN_EVENT,
  readPosShellPreference,
  isStandalonePosTerminal,
} from '@/features/pos/lib/pos-shell';
import { QuickAttendanceShortcut } from '@/shared/layout/quick-attendance-shortcut';
import { GlobalAppToolbar } from '@/shared/layout/GlobalAppToolbar';
import { MobileBottomNav } from '@/shared/layout/MobileBottomNav';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import { useToolbarStore } from '@/stores/toolbar-store';
import { DialogShell } from '@/shared/components/dialog-shell';
import { SearchIcon, CheckCircleIcon , XIcon } from '@/shared/components/icons/AppIcons';
import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';
import { prefetchRouteData } from '@/app/router/route-prefetch';
import { resolveAutoBreadcrumbs } from '@/shared/layout/breadcrumbs.helper';
import { useVisibleNavigationItems } from '@/shared/layout/app-shell/use-visible-navigation-items';
import { manufacturingOrder, importOrder, servicesOrder, standardOrder } from '@/shared/layout/app-shell/app-shell-navigation-orders-b';

const GlobalSearchModal = lazy(() => import('@/shared/components/GlobalSearchModal').then((m) => ({ default: m.GlobalSearchModal })));
const DeveloperActivationPanel = lazy(() => import('@/shared/system/DeveloperActivationPanel').then((m) => ({ default: m.DeveloperActivationPanel })));
const LiveOrderNotificationBanner = lazy(() => import('@/features/storefront/components/LiveOrderNotificationBanner').then((m) => ({ default: m.LiveOrderNotificationBanner })));


import { defaultIconTone, activeIconTone, type SidebarGroupDefinition } from './app-shell/app-shell-types';


import { AppNavIcon } from '@/shared/layout/nav-icons';
import { openExternalWindow } from '@/shared/layout/AppBrowserTabBar';
import { SidebarContextMenu, type ContextMenuTarget } from '@/shared/layout/SidebarContextMenu';
import { useTabsStore } from '@/stores/tabs-store';
import { toast } from '@/shared/components/system-alert';

import { translateUiText } from '@/lib/auto-translator';
import { useSidebarGroups } from '@/shared/layout/app-shell/use-sidebar-groups';
import { warehousingOrder, wholesaleVanOrder, contractingOrder, maritimeOrder } from './app-shell/app-shell-navigation-orders-a';

function formatWorkspaceName(name: string, isEn = false) {
  if (isEn) {
    const translated = translateUiText(name);
    return translated || name;
  }
  const match = name.match(/^(.*?) (ل\S+.*)$/);
  if (match) {
    return (
      <>
        {match[1]}<br />{match[2]}
      </>
    );
  }
  return name;
}

export function AppShell({ children }: PropsWithChildren) {
  const { t: __t } = useTranslation();
  const { t, i18n } = useTranslation();
  const isEn = Boolean(i18n.language && i18n.language.startsWith('en'));

  useEffect(() => {
    const targetDir = isEn ? 'ltr' : 'rtl';
    const targetLang = isEn ? 'en' : 'ar';
    if (document.documentElement.dir !== targetDir) {
      document.documentElement.dir = targetDir;
    }
    if (document.documentElement.lang !== targetLang) {
      document.documentElement.lang = targetLang;
    }
  }, [isEn]);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const tenant = useAuthStore((state) => state.tenant);
  const { data: settings } = useSettingsQuery();
  const storeName = useAuthStore((state) => state.storeName);
  const isEtaActive = useAuthStore((state) => state.isEtaActive);
  const clearSession = useAuthStore((state) => state.clearSession);
  const deploymentMode = useAuthStore((state) => state.activationStatus?.deploymentMode);
  const { data: updateInfo } = useOfflineUpdateCheck(deploymentMode);

  const canQueryOnlineOrders = Boolean(user) && userHasAnyPermission(user, ['storefront', 'sales']);
  const isStorefrontEntitled = isPlatformAdmin(user) || Boolean(tenant?.features?.includes('storefront'));

  const pendingOrdersCountQuery = useQuery({
    queryKey: ['storefront-admin-orders-count'],
    queryFn: async () => {
      try {
        const res = await http<{ counts: Record<string, number> }>('/api/storefront/admin/orders/counts');
        return {
          pending: Number(res.counts?.pending || 0),
          total: Number(res.counts?.all ?? res.counts?.active ?? res.counts?.pending ?? 0),
        };
      } catch {
        return { pending: 0, total: 0 };
      }
    },
    enabled: canQueryOnlineOrders,
    refetchInterval: isStorefrontEntitled ? 20 * 1000 : false,
    staleTime: isStorefrontEntitled ? 15 * 1000 : 60 * 1000,
  });
  const pendingOrdersCount = pendingOrdersCountQuery.data?.pending || 0;
  const totalOnlineOrdersCount = pendingOrdersCountQuery.data?.total || 0;

  const displayName = user?.displayName || user?.username || 'المستخدم';
  const workspaceName = storeName || DEFAULT_STORE_NAME;
  const isPosRoute = location.pathname.startsWith('/pos');
  const [isPosChromeHidden, setIsPosChromeHidden] = useState(false);
  const [quickAttendanceOpen, setQuickAttendanceOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') return window.localStorage.getItem('zsystems_sidebar_collapsed') === 'true';
    return false;
  });

  const tabsStore = useTabsStore();
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    target: ContextMenuTarget | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    target: null,
  });

  const isPlatformUser = isPlatformAdmin(user);
  const isTenantAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const previewOnboarding = new URLSearchParams(location.search).get('onboarding') === '1';
  const hasEstablishedStoreData = Boolean(
    (settings?.storeName && settings.storeName !== 'Z Systems' && settings.storeName !== 'المتجر الافتراضي' && settings.storeName.trim().length > 0) ||
    settings?.phone ||
    settings?.address ||
    settings?.logoData ||
    settings?.taxNumber
  );
  const shouldRedirectToOnboarding = previewOnboarding || (!isPlatformUser && isTenantAdmin && settings && (settings as any).onboardingCompleted !== true && (settings as any).onboardingCompleted !== 'true' && !hasEstablishedStoreData);

  useEffect(() => {
    if (shouldRedirectToOnboarding && location.pathname !== '/onboarding') {
      navigate('/onboarding', { replace: true });
    }
  }, [shouldRedirectToOnboarding, location.pathname, navigate]);

  const [isMobileScreen, setIsMobileScreen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth <= 900;
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth <= 900);
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const effectiveSidebarCollapsed = isMobileScreen ? false : isSidebarCollapsed;
  
  const { isMobileSidebarOpen, setMobileSidebarOpen } = useToolbarStore();

  useEffect(() => {
    // Close mobile sidebar on route change
    setMobileSidebarOpen(false);
  }, [location.pathname, setMobileSidebarOpen]);

  const [isSidebarSearchOpen, setIsSidebarSearchOpen] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarSearchInputRef = useRef<HTMLInputElement>(null);
  const sidebarSearchWrapperRef = useRef<HTMLDivElement>(null);

  const handleOpenSidebarSearch = () => {
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      window.localStorage.setItem('zsystems_sidebar_collapsed', 'false');
    }
    setIsSidebarSearchOpen(true);
    setTimeout(() => {
      sidebarSearchInputRef.current?.focus();
    }, 60);
  };

  const handleCloseSidebarSearch = () => {
    setIsSidebarSearchOpen(false);
    setSidebarSearchQuery('');
  };

  // Close search on route changes
  useEffect(() => {
    if (isSidebarSearchOpen) {
      setIsSidebarSearchOpen(false);
      setSidebarSearchQuery('');
    }
  }, [location.pathname]);

  // Close search when clicking outside the sidebar
  useEffect(() => {
    if (!isSidebarSearchOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        handleCloseSidebarSearch();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSidebarSearchOpen]);

  // Close search when collapsed
  useEffect(() => {
    if (isSidebarCollapsed && isSidebarSearchOpen) {
      handleCloseSidebarSearch();
    }
  }, [isSidebarCollapsed, isSidebarSearchOpen]);

  const toggleSidebar = () => {
    if (isSidebarSearchOpen) {
      handleCloseSidebarSearch();
    }
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('zsystems_sidebar_collapsed', String(next));
      return next;
    });
  };

  const visibleNavigationItems = useVisibleNavigationItems({
    user,
    tenant,
    settings,
    isEtaActive,
    totalOnlineOrdersCount,
  });


  const navigationMap = useMemo(() => new Map(visibleNavigationItems.map((item) => [item.key, item])), [visibleNavigationItems]);
  const primaryNavigationKeys = useMemo(() => {
    const isPlatformAdminUser = isPlatformAdmin(user);
    const hasReports = isPlatformAdminUser || Boolean(tenant?.features?.includes('reports'));
    const dashKeys = hasReports ? ['dashboard'] : [];

    const currentVertical = resolveCurrentVertical(tenant, settings);
    const isWholesaleVanVertical = currentVertical === 'wholesale_van';

    // INV-STOREFRONT-ORDERS: 'online-orders' is the tenant's own recorded-orders
    // list, not a storefront feature — it is a primary shortcut in every vertical
    // (and unconditional below), so an admin can always reach orders recorded
    // while the storefront was on. The 'sales' permission still gates it in the
    // sidebar filter, and the route itself is permission-gated too.
    if (currentVertical === 'contracting') {
      return [...dashKeys, 'online-orders', 'contracting-projects', 'contracting-boq'];
    }

    if (currentVertical === 'maritime') {
      return [...dashKeys, 'online-orders'];
    }

    if (currentVertical === 'manufacturing') {
      return [...dashKeys, 'online-orders', 'manufacturing-work-orders', 'manufacturing-boms'];
    }

    if (currentVertical === 'import_export') {
      const hasPos = settings?.posModuleEnabled !== false;
      return [...dashKeys, 'online-orders', ...(hasPos ? ['pos', 'cash-drawer'] : [])];
    }

    if (isWholesaleVanVertical) {
      // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): an overridden tenant gets
      // the POS + drawer shortcuts too (same pattern as the services branch).
      const posOverridden = Boolean(tenant?.features?.includes('pos'));
      return [...dashKeys, 'online-orders', 'van-sales-admin', ...(posOverridden ? ['pos', 'cash-drawer'] : [])];
    }

    if (currentVertical === 'warehousing') {
      return [...dashKeys, 'online-orders', 'inventory', 'inventory-warehouses', 'purchases'];
    }

    if (currentVertical === 'services') {
      const hasPos = Boolean(tenant?.features?.includes('pos'));
      return [...dashKeys, 'online-orders', 'services', ...(hasPos ? ['pos', 'cash-drawer'] : [])];
    }

    if (settings?.posModuleEnabled === false) {
      return [
        ...dashKeys,
        'online-orders',
        ...(settings?.purchasesModuleEnabled ? ['purchases'] : []),
      ];
    }
    return [...dashKeys, 'pos', 'online-orders', 'cash-drawer'];
  }, [settings?.businessIndustry, settings?.activityType, settings?.contractingModuleEnabled, settings?.maritimeFreightModuleEnabled, settings?.importModuleEnabled, settings?.posModuleEnabled, settings?.purchasesModuleEnabled, settings?.storefrontModuleEnabled, settings?.deliveryRepsModuleEnabled, settings?.vanSalesModuleEnabled, settings?.deliveryFleetModuleEnabled, tenant?.features, tenant?.activityType, tenant?.pillar, tenant?.businessName, user]);

  const sidebarGroups = useSidebarGroups({ user, tenant, settings });

  const visiblePrimaryNavigationItems = useMemo(() => primaryNavigationKeys.map((key) => navigationMap.get(key)).filter((item): item is NonNullable<typeof item> => Boolean(item)), [navigationMap, primaryNavigationKeys]);

  // Constitutional Zero-Duplication Invariant (دستور منع التكرار الصارم في القوائم الجانبية):
  // 1. Any item already displayed in primary navigation (top shortcuts) is strictly excluded from all collapsible sidebar groups.
  // 2. Each item key can appear at most once across the entire sidebar (inter-group deduplication).
  // 3. Groups with 0 items remaining after deduplication are cleanly omitted.
  const deduplicatedSidebarGroups = useMemo(() => {
    const claimedKeys = new Set<string>(visiblePrimaryNavigationItems.map((item) => item.key));
    return sidebarGroups
      .map((group) => {
        const uniqueItemKeys = group.itemKeys.filter((key) => {
          if (claimedKeys.has(key)) return false;
          claimedKeys.add(key);
          return true;
        });
        return {
          ...group,
          itemKeys: uniqueItemKeys,
        };
      })
      .filter((group) => group.itemKeys.length > 0);
  }, [sidebarGroups, visiblePrimaryNavigationItems]);

  const activeSidebarGroupKey = useMemo(() => deduplicatedSidebarGroups.find((group) => group.itemKeys.some((itemKey) => {
    const navItem = navigationMap.get(itemKey);
    if (!navItem) return false;
    if (navItem.activePaths?.includes(location.pathname)) return true;
    const navBasePath = navItem.to.split('?')[0];
    if (navItem.end) return location.pathname === navBasePath;
    return location.pathname === navBasePath || location.pathname.startsWith(`${navBasePath}/`);
  }))?.key ?? null, [deduplicatedSidebarGroups, location.pathname, navigationMap]);

  const normalizedSidebarQuery = useMemo(() => normalizeArabicSearchKey(sidebarSearchQuery), [sidebarSearchQuery]);
  const isSearchingSidebar = normalizedSidebarQuery.length > 0;

  const filteredPrimaryNavigationItems = useMemo(() => {
    if (!isSearchingSidebar) return visiblePrimaryNavigationItems;
    return visiblePrimaryNavigationItems.filter((item) =>
      matchesNavigationSearch(item, normalizedSidebarQuery)
    );
  }, [isSearchingSidebar, normalizedSidebarQuery, visiblePrimaryNavigationItems]);

  const filteredSidebarGroups = useMemo(() => {
    return deduplicatedSidebarGroups.map((group) => {
      const groupItems = group.itemKeys.map((key) => navigationMap.get(key)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (!groupItems.length) return null;

      if (!isSearchingSidebar) {
        return {
          group,
          groupItems,
          isActive: activeSidebarGroupKey === group.key,
          isOpen: !effectiveSidebarCollapsed,
        };
      }

      const matchingItems = groupItems.filter((item) =>
        matchesNavigationSearch(item, normalizedSidebarQuery) ||
        normalizeArabicSearchKey(group.label).includes(normalizedSidebarQuery)
      );

      if (matchingItems.length === 0) return null;

      return {
        group,
        groupItems: matchingItems,
        isActive: true,
        isOpen: true,
      };
    }).filter((g): g is NonNullable<typeof g> => Boolean(g));
  }, [activeSidebarGroupKey, deduplicatedSidebarGroups, effectiveSidebarCollapsed, isSearchingSidebar, navigationMap, normalizedSidebarQuery]);

  const totalMatchingItemsCount = filteredPrimaryNavigationItems.length + filteredSidebarGroups.reduce((acc, g) => acc + g.groupItems.length, 0);

  useEffect(() => {
    if (!isPosRoute) {
      setIsPosChromeHidden(false);
      return;
    }
    setIsPosChromeHidden(readPosShellPreference());
  }, [isPosRoute]);

  useEffect(() => {
    if (!isPosRoute || typeof window === 'undefined') return;
    window.localStorage.setItem(POS_SHELL_VISIBILITY_KEY, isPosChromeHidden ? 'hidden' : 'shown');
  }, [isPosChromeHidden, isPosRoute]);

  useEffect(() => {
    if (!isPosRoute || typeof window === 'undefined') return undefined;
    const toggleChrome = () => setIsPosChromeHidden((current) => !current);
    const toggleFullscreen = async () => {
      try {
        const electronRuntime = (window as any).electronRuntime;
        if (electronRuntime && typeof electronRuntime.toggleFullScreen === 'function') {
          const isFS = await electronRuntime.toggleFullScreen();
          setIsPosChromeHidden(Boolean(isFS));
          return;
        }
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen?.();
          if ('keyboard' in navigator && typeof (navigator as any).keyboard?.lock === 'function') {
            try {
              await (navigator as any).keyboard.lock(['Escape']);
            } catch {
              // ignore
            }
          }
          setIsPosChromeHidden(true);
          return;
        }
        if ('keyboard' in navigator && typeof (navigator as any).keyboard?.unlock === 'function') {
          try {
            (navigator as any).keyboard.unlock();
          } catch {
            // ignore
          }
        }
        await document.exitFullscreen?.();
        setIsPosChromeHidden(false);
      } catch {
        // ignore fullscreen errors triggered by browser policies
      }
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'F10') {
        event.preventDefault();
        toggleChrome();
        return;
      }
      if (event.key === 'F11') {
        // In Electron, F11 is already handled by main process, but for browser fallback:
        const electronRuntime = (window as any).electronRuntime;
        if (!electronRuntime) {
          event.preventDefault();
          void toggleFullscreen();
        }
      }
    };
    const handleFullscreenChange = async () => {
      if (document.fullscreenElement) {
        if ('keyboard' in navigator && typeof (navigator as any).keyboard?.lock === 'function') {
          try {
            await (navigator as any).keyboard.lock(['Escape']);
          } catch {
            // ignore
          }
        }
        setIsPosChromeHidden(true);
        return;
      }
      if ('keyboard' in navigator && typeof (navigator as any).keyboard?.unlock === 'function') {
        try {
          (navigator as any).keyboard.unlock();
        } catch {
          // ignore
        }
      }
      setIsPosChromeHidden(readPosShellPreference());
    };
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener(POS_TOGGLE_CHROME_EVENT, toggleChrome);
    window.addEventListener(POS_TOGGLE_FULLSCREEN_EVENT, toggleFullscreen);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const electronRuntime = (window as any).electronRuntime;
    let unsubscribeElectronFs: (() => void) | undefined;
    if (electronRuntime && typeof electronRuntime.onFullScreenChange === 'function') {
      unsubscribeElectronFs = electronRuntime.onFullScreenChange((isFS: boolean) => {
        setIsPosChromeHidden(Boolean(isFS));
      });
    }

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener(POS_TOGGLE_CHROME_EVENT, toggleChrome);
      window.removeEventListener(POS_TOGGLE_FULLSCREEN_EVENT, toggleFullscreen);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (unsubscribeElectronFs) unsubscribeElectronFs();
    };
  }, [isPosRoute]);

  useEffect(() => {
    const contentWrap = document.querySelector('.content-wrap') as HTMLElement | null;
    if (contentWrap && contentWrap.scrollTop > 0) {
      contentWrap.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, [location.pathname]);

  // Dynamic Browser Tab Title based on active page/tab (Lightweight Native DOM property)
  const toolbarBreadcrumbs = useToolbarStore((state) => state.breadcrumbs);
  useEffect(() => {
    let activeLabel = '';

    // 1. Check custom toolbar breadcrumbs set by the active page (most accurate)
    if (toolbarBreadcrumbs && toolbarBreadcrumbs.length > 0) {
      const lastCrumb = toolbarBreadcrumbs[toolbarBreadcrumbs.length - 1];
      if (lastCrumb?.label && lastCrumb.label !== 'الرئيسية') {
        activeLabel = lastCrumb.label;
      }
    }

    // 2. Check visible sidebar navigation items matching current route (exact match first, then longest prefix)
    if (!activeLabel) {
      const exactMatch = visibleNavigationItems.find((item) => item.to === location.pathname || item.activePaths?.includes(location.pathname));
      const prefixMatch = exactMatch || visibleNavigationItems
        .filter((item) => item.to && item.to !== '/' && item.to !== '/dashboard' && !item.end && location.pathname.startsWith(`${item.to}/`))
        .sort((a, b) => b.to.length - a.to.length)[0];
      if (prefixMatch?.label) {
        activeLabel = prefixMatch.label;
      }
    }

    // 3. Fallback to route breadcrumb rules
    if (!activeLabel) {
      const autoCrumbs = resolveAutoBreadcrumbs(location.pathname, []);
      if (autoCrumbs.length > 0) {
        const candidate = autoCrumbs[autoCrumbs.length - 1];
        if (candidate?.label && candidate.label !== 'الرئيسية') {
          activeLabel = candidate.label;
        }
      }
    }

    // Update document title natively and smoothly
    if (activeLabel) {
      document.title = `Z-ERP | ${activeLabel}`;
    } else {
      document.title = 'Z-ERP';
    }
  }, [location.pathname, toolbarBreadcrumbs, visibleNavigationItems]);

  useEffect(() => {
    try {
      const currentVer = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.21';
      localStorage.setItem('zs.app_display_version', currentVer);
    } catch {}
  }, []);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'));
    };
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      
      // Quick Attendance: Alt + Shift + F9
      if (event.altKey && event.shiftKey && event.key === 'F9' && canAccessPath(user, '/hr/attendance')) {
        event.preventDefault();
        setQuickAttendanceOpen(true);
        return;
      }

      // Global Navigation Back: Alt + Backspace | Alt + LeftArrow | Alt + RightArrow
      if (
        (event.altKey && event.key === 'Backspace') ||
        (event.altKey && event.key === 'ArrowLeft') ||
        (event.altKey && event.key === 'ArrowRight')
      ) {
        event.preventDefault();
        if (window.history.length > 1 && window.history.state?.idx > 0) {
          navigate(-1);
        } else {
          navigate('/dashboard');
        }
      }
    };
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, [navigate]);

  async function handleLogout() {
    try {
      await authApi.logout();
    } finally {
      await resetAuthenticatedClient(queryClient, clearSession);
      navigate('/login?reason=signed-out', { replace: true });
    }
  }

  const cleanWorkspaceName = workspaceName.replace(/^\s*["'”“]+|["'”“]+\s*$/g, '').trim() || workspaceName;

  function renderNavItem(item: NonNullable<(typeof visibleNavigationItems)[number]>, keyPrefix: string) {
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
          setSidebarContextMenu({
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

  return (
    <div 
      dir={isEn ? 'ltr' : 'rtl'}
      className={`app-layout ${effectiveSidebarCollapsed ? 'sidebar-collapsed' : ''} ${isPosRoute ? 'app-layout-pos' : ''} ${isPosRoute && isPosChromeHidden ? 'app-layout-pos-focus' : ''}`.trim()}
    >
      {(!isPosRoute || (!isPosChromeHidden && !isMobileScreen && !isStandalonePosTerminal())) ? (
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
            {filteredPrimaryNavigationItems.map((item) => renderNavItem(item, 'primary'))}
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
                  {isOpen ? <div className="sidebar-group-items">{groupItems.map((item) => renderNavItem(item, 'group'))}</div> : null}
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
      ) : null}
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
    </div>
  );
}
