import { PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import { http } from '@/lib/http';
import { authApi } from '@/shared/api/auth';
import { resetAuthenticatedClient } from '@/lib/query-client-session';
import { DEFAULT_STORE_NAME, useAuthStore } from '@/stores/auth-store';
import { canAccessPath, matchesNavigationSearch, isPlatformAdmin } from '@/app/router/access';
import { userHasAnyPermission } from '@/shared/hooks/use-permission';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { useOfflineUpdateCheck } from '@/features/updates/hooks/useOfflineUpdateCheck';
import {
  POS_SHELL_VISIBILITY_KEY,
  POS_TOGGLE_CHROME_EVENT,
  POS_TOGGLE_FULLSCREEN_EVENT,
  readPosShellPreference,
  isStandalonePosTerminal,
} from '@/features/pos/lib/pos-shell';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import { useToolbarStore } from '@/stores/toolbar-store';
import { resolveAutoBreadcrumbs } from '@/shared/layout/breadcrumbs.helper';
import { useVisibleNavigationItems } from '@/shared/layout/app-shell/use-visible-navigation-items';

import { AppShellSidebar } from '@/shared/layout/app-shell/app-shell-sidebar';
import { AppShellMain } from '@/shared/layout/app-shell/app-shell-main';

import type { ContextMenuTarget } from '@/shared/layout/SidebarContextMenu';

import { translateUiText } from '@/lib/auto-translator';
import { useSidebarGroups } from '@/shared/layout/app-shell/use-sidebar-groups';
import { systemConfirm } from '@/shared/components/system-alert';

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
  const { i18n } = useTranslation();
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
      const { getOfflineSalesQueue } = await import('@/features/pos/lib/pos-offline-sync');
      const pendingOfflineCount = getOfflineSalesQueue().filter((s) => s.status !== 'committed').length;
      if (pendingOfflineCount > 0) {
        const confirmed = await systemConfirm({
          title: 'تنبيه: فواتير أوفلاين بانتظار المزامنة',
          message: `يوجد ${pendingOfflineCount} فاتورة مبيعات محفوظة أوفلاين على هذا الجهاز لم يكتمل ترحيلها للسيرفر بعد. ستظل الفواتير محفوظة بأمان ولن تُحذف، وسيُستأنف ترحيلها فور إعادة تسجيل الدخول بنفس المنشأة. هل تريد المتابعة لتسجيل الخروج؟`,
          confirmText: 'تسجيل الخروج مع الاحتفاظ بالفواتير',
          cancelText: 'البقاء لحين اكتمال المزامنة',
        });
        if (!confirmed) return;
      }
    } catch {
      // Proceed safely
    }
    try {
      await authApi.logout();
    } catch {
      // Allow offline sign-out without uncaught network error
    } finally {
      await resetAuthenticatedClient(queryClient, clearSession);
      navigate('/login?reason=signed-out', { replace: true });
    }
  }

  const cleanWorkspaceName = workspaceName.replace(/^\s*["'”“]+|["'”“]+\s*$/g, '').trim() || workspaceName;

  return (
    <div 
      dir={isEn ? 'ltr' : 'rtl'}
      className={`app-layout ${effectiveSidebarCollapsed ? 'sidebar-collapsed' : ''} ${isPosRoute ? 'app-layout-pos' : ''} ${isPosRoute && isPosChromeHidden ? 'app-layout-pos-focus' : ''}`.trim()}
    >
      <AppShellSidebar
        isPosRoute={isPosRoute}
        isPosChromeHidden={isPosChromeHidden}
        isMobileScreen={isMobileScreen}
        isStandalonePosTerminal={isStandalonePosTerminal}
        sidebarRef={sidebarRef}
        sidebarSearchWrapperRef={sidebarSearchWrapperRef}
        sidebarSearchInputRef={sidebarSearchInputRef}
        isMobileSidebarOpen={isMobileSidebarOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
        navigate={navigate}
        isEn={isEn}
        cleanWorkspaceName={cleanWorkspaceName}
        formatWorkspaceName={formatWorkspaceName}
        setIsAboutModalOpen={setIsAboutModalOpen}
        isSidebarSearchOpen={isSidebarSearchOpen}
        handleOpenSidebarSearch={handleOpenSidebarSearch}
        handleCloseSidebarSearch={handleCloseSidebarSearch}
        effectiveSidebarCollapsed={effectiveSidebarCollapsed}
        sidebarSearchQuery={sidebarSearchQuery}
        setSidebarSearchQuery={setSidebarSearchQuery}
        filteredPrimaryNavigationItems={filteredPrimaryNavigationItems}
        filteredSidebarGroups={filteredSidebarGroups}
        visibleNavigationItems={visibleNavigationItems}
        pendingOrdersCount={pendingOrdersCount}
        toggleSidebar={toggleSidebar}
        isSearchingSidebar={isSearchingSidebar}
        totalMatchingItemsCount={totalMatchingItemsCount}
        displayName={displayName}
        updateInfo={updateInfo}
        handleLogout={handleLogout}
        setSidebarContextMenu={setSidebarContextMenu}
      />
      {/* BootstrapAdminBanner renders globally via AppShellMain (S4 slice) */}
      <AppShellMain
        isPosRoute={isPosRoute}
        isPosChromeHidden={isPosChromeHidden}
        isMobileScreen={isMobileScreen}
        user={user}
        canQueryOnlineOrders={canQueryOnlineOrders}
        isStorefrontEntitled={isStorefrontEntitled}
        pendingOrdersCount={pendingOrdersCount}
        quickAttendanceOpen={quickAttendanceOpen}
        setQuickAttendanceOpen={setQuickAttendanceOpen}
        isAboutModalOpen={isAboutModalOpen}
        setIsAboutModalOpen={setIsAboutModalOpen}
        cleanWorkspaceName={cleanWorkspaceName}
        displayName={displayName}
        sidebarContextMenu={sidebarContextMenu}
        setSidebarContextMenu={setSidebarContextMenu}
      >
        {children}
      </AppShellMain>
    </div>
  );
}
