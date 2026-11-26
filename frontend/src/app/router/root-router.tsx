import { useTranslation } from 'react-i18next';
import { createBrowserRouter, createHashRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { createLazyRoute } from '@/app/router/lazy-route';
import { AppShell } from '@/shared/layout/app-shell';
import { AppErrorBoundary } from '@/shared/system/app-error-boundary';
import { Button } from '@/shared/ui/button';
import { useBootstrapAuth } from '@/features/auth/useBootstrapAuth';
import { useAuthStore } from '@/stores/auth-store';
import { appRoutes, navigationItems } from '@/app/router/registry';
import { canAccessPath, findWorkspaceFallbackRoute } from '@/app/router/access';
import { getPostLoginRoute } from '@/features/auth/lib/post-login-route';
import { AppCloseGuard } from '@/shared/layout/AppCloseGuard';
import { getStoreHostSlug } from '@/lib/store-public-url';
import { driverPortalApi } from '@/shared/api/delivery-reps.api';

const ActivationPage = lazy(() => import('@/features/activation/pages/ActivationPage').then(m => ({ default: m.ActivationPage })));
const FirstRunSetupPage = lazy(() => import('@/features/activation/pages/FirstRunSetupPage').then(m => ({ default: m.FirstRunSetupPage })));
const SaaSOnboardingPage = lazy(() => import('@/features/activation/pages/SaaSOnboardingPage').then(m => ({ default: m.SaaSOnboardingPage })));
const SupplierQuickPaymentDialog = lazy(() => import('@/features/accounts/components/SupplierQuickPaymentDialog').then(m => ({ default: m.SupplierQuickPaymentDialog })));
const QuickCashAdvanceModal = lazy(() => import('@/features/hr/components/QuickCashAdvanceModal').then(m => ({ default: m.QuickCashAdvanceModal })));
const QuickOffersModal = lazy(() => import('@/features/products/components/QuickOffersModal').then(m => ({ default: m.QuickOffersModal })));
const LazyLoginPage = createLazyRoute(() => import('@/features/auth/pages/LoginPage').then((module) => ({ default: module.LoginPage })));

const isElectron = typeof window !== 'undefined' && (
  Boolean((window as any).electronAPI) ||
  Boolean((window as any).process?.versions?.electron) ||
  window.navigator.userAgent.toLowerCase().includes('electron') ||
  import.meta.env.MODE === 'electron' ||
  import.meta.env.MODE === 'portable'
);

const createRouter = isElectron ? createHashRouter : createBrowserRouter;

/*
 * SF-10: on `<slug>.<root>` the whole host is one store, so it gets only storefront routes —
 * no ERP shell, no login redirect. The slug comes from the host (see PublicStorefrontPage).
 */
const storeHostSlug = isElectron ? null : (import.meta.env.VITE_STOREFRONT_PREVIEW === 'true' ? 'demo' : getStoreHostSlug());

function storeHostRoutes() {
  const storefront = () => createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage })));
  return [
    { path: '/', element: storefront() },
    { path: '/c/:categoryId', element: storefront() },
    { path: '/category/:categoryId', element: storefront() },
    { path: '/table/:tableNo', element: storefront() },
    { path: '/p/:productId', element: storefront() },
    { path: '/track/:orderNumber', element: storefront() },
    { path: '*', element: <Navigate to="/" replace /> },
  ];
}

function NoWorkspaceAccess() {
  const { t } = useTranslation();
  const clearSession = useAuthStore((state) => state.clearSession);
  const navigate = useNavigate();

  function handleExit() {
    clearSession();
    navigate('/login?reason=signed-out', { replace: true });
  }

  return (
    <div className="screen-center">
      <div className="loading-card stack gap-12" style={{ maxWidth: 420, textAlign: 'center' }}>
        <h2 style={{ margin: 0 }}>{t('app.router.root_router.s0', "لا توجد صلاحيات مفعّلة لهذا الحساب")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('app.router.root_router.s1', "لا يمكن فتح أي مساحة عمل حاليًا. راجع مسؤول النظام لتفعيل صلاحيات مناسبة لهذا المستخدم.")}
        </p>
        <Button type="button" variant="secondary" onClick={handleExit}>{t('app.router.root_router.s2', "تسجيل الخروج")}</Button>
      </div>
    </div>
  );
}

function AppSplashLoading() {
  return (
    <div
      id="app-preloader-root"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        direction: 'rtl',
        userSelect: 'none',
        zIndex: 99999,
      }}
    >
      <div
        className="app-preloader-card"
        style={{
          width: '60px',
          height: '60px',
          borderRadius: '16px',
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)',
          border: '1px solid #e2e8f0',
        }}
      >
        <img
          src="/logo.png"
          alt="Z-ERP"
          className="app-preloader-img"
          style={{ width: '40px', height: '40px', objectFit: 'contain', borderRadius: '10px' }}
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = 'none';
          }}
        />
      </div>
    </div>
  );
}

function AppGateGuard({ expected, children }: { expected: 'activation' | 'setup' | 'login'; children: ReactNode }) {
  const { initialized, appGate, user } = useAuthStore();
  const location = useLocation();
  useBootstrapAuth();

  const isPreview = new URLSearchParams(location.search).get('preview') === '1';
  if (isPreview) {
    return <>{children}</>;
  }

  if (!initialized || appGate === 'loading') {
    return <AppSplashLoading />;
  }

  if (appGate === expected) {
    return <>{children}</>;
  }

  if (appGate === 'activation') return <Navigate to="/activate" replace />;
  if (appGate === 'setup') return <Navigate to="/setup" replace />;
  if (user) {
    const state = useAuthStore.getState();
    return <Navigate to={getPostLoginRoute(user, state.storeName, { tenant: state.tenant, deploymentMode: state.activationStatus?.deploymentMode })} replace />;
  }
  return <Navigate to="/login" replace />;
}

function ProtectedLayout() {
  const { initialized, user, appGate } = useAuthStore();
  const location = useLocation();
  useBootstrapAuth();

  if (!initialized || appGate === 'loading') {
    return <AppSplashLoading />;
  }

  if (appGate === 'activation') return <Navigate to="/activate" replace />;
  if (appGate === 'setup') return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;

  const isPosTerminal = typeof window !== 'undefined' && (
    Boolean((window as any).AndroidBridge?.isPosLite?.()) ||
    Boolean((window as any).SmartPos?.isPosLite?.()) ||
    Boolean((window as any).SunmiPrinter?.isPosLite?.()) ||
    window.location.search.includes('standalone=pos') ||
    window.location.search.includes('kiosk=1') ||
    window.localStorage.getItem('zsystems.pos.standalone') === 'true'
  );

  if (isPosTerminal && !location.pathname.startsWith('/pos') && !location.pathname.startsWith('/cash-drawer')) {
    return <Navigate to="/pos" replace />;
  }

  const fallbackRoute = findWorkspaceFallbackRoute(user, navigationItems);

  if (!canAccessPath(user, location.pathname)) {
    if (!fallbackRoute) return <NoWorkspaceAccess />;
    return <Navigate to={fallbackRoute} replace />;
  }

  return (
    <AppShell>
      <Outlet />
      <Suspense fallback={null}>
        <SupplierQuickPaymentDialog />
        <QuickCashAdvanceModal />
        <QuickOffersModal />
      </Suspense>
    </AppShell>
  );
}

function LoginRoute() {
  const { initialized, user, appGate } = useAuthStore();

  if (!initialized || appGate === 'loading') {
    return <AppSplashLoading />;
  }

  if (appGate === 'activation') return <Navigate to="/activate" replace />;
  if (appGate === 'setup') return <Navigate to="/setup" replace />;
  if (user) {
    const state = useAuthStore.getState();
    return <Navigate to={getPostLoginRoute(user, state.storeName, { tenant: state.tenant, deploymentMode: state.activationStatus?.deploymentMode })} replace />;
  }

  // Smart Role Routing: If device is logged in as a driver / van rep, auto-redirect to their workspace
  if (typeof localStorage !== 'undefined') {
    const isForcedAdmin = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('portal') === 'admin';
    if (!isForcedAdmin) {
      const driverSession = driverPortalApi.getStoredSession();
      if (driverSession?.rep) {
        if (driverSession.rep.isVanRep) {
          return <Navigate to="/van-sales" replace />;
        }
        return <Navigate to="/driver" replace />;
      }
    }
  }

  return <>{LazyLoginPage}</>;
}

const router = storeHostSlug ? createRouter(storeHostRoutes()) : createRouter([
  { path: '/activate', element: <AppGateGuard expected="activation"><Suspense fallback={<AppSplashLoading />}><ActivationPage /></Suspense></AppGateGuard> },
  { path: '/setup', element: <AppGateGuard expected="setup"><Suspense fallback={<AppSplashLoading />}><FirstRunSetupPage /></Suspense></AppGateGuard> },
  { path: '/onboarding', element: <Suspense fallback={<AppSplashLoading />}><SaaSOnboardingPage /></Suspense> },
  {
    path: '/trial',
    element: createLazyRoute(() => import('@/features/public-trial/pages/TrialSignupPage').then((module) => ({ default: module.TrialSignupPage }))),
  },
  {
    path: '/download',
    element: createLazyRoute(() => import('@/features/activation/pages/PublicDownloadsPage').then((module) => ({ default: module.PublicDownloadsPage }))),
  },
  { path: '/downloads', element: <Navigate to="/download" replace /> },
  // استعادة كلمة المرور: عامة بلا `AppGateGuard` عمداً — من نسي كلمته لا يملك جلسة، ولا يصح
  // أن تحوّله بوابة التفعيل/التهيئة بعيداً عن الرابط الذي وصله في البريد.
  {
    path: '/forgot-password',
    element: createLazyRoute(() => import('@/features/auth/pages/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage }))),
  },
  {
    path: '/reset-password',
    element: createLazyRoute(() => import('@/features/auth/pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage }))),
  },
  {
    path: '/public/track/:token',
    element: createLazyRoute(() => import('@/features/maritime-freight/pages/PublicShipmentTrackingPage').then((module) => ({ default: module.PublicShipmentTrackingPage }))),
  },
  {
    path: '/track/:token',
    element: createLazyRoute(() => import('@/features/maritime-freight/pages/PublicShipmentTrackingPage').then((module) => ({ default: module.PublicShipmentTrackingPage }))),
  },
  {
    path: '/track',
    element: createLazyRoute(() => import('@/features/maritime-freight/pages/PublicShipmentTrackingPage').then((module) => ({ default: module.PublicShipmentTrackingPage }))),
  },
  {
    path: '/portal/carrier-quote/:rfqId',
    element: createLazyRoute(() => import('@/features/maritime-freight/pages/PublicCarrierQuotePage').then((module) => ({ default: module.PublicCarrierQuotePage }))),
  },
  {
    path: '/carrier-quote/:rfqId',
    element: createLazyRoute(() => import('@/features/maritime-freight/pages/PublicCarrierQuotePage').then((module) => ({ default: module.PublicCarrierQuotePage }))),
  },
  {
    path: '/public/carrier-quote/:rfqId',
    element: createLazyRoute(() => import('@/features/maritime-freight/pages/PublicCarrierQuotePage').then((module) => ({ default: module.PublicCarrierQuotePage }))),
  },
  {
    path: '/freight-portal',
    element: createLazyRoute(() => import('@/features/maritime-freight/pages/MaritimeCustomerPortalPage').then((module) => ({ default: module.MaritimeCustomerPortalPage }))),
  },
  {
    path: '/maritime-portal',
    element: createLazyRoute(() => import('@/features/maritime-freight/pages/MaritimeCustomerPortalPage').then((module) => ({ default: module.MaritimeCustomerPortalPage }))),
  },
  {
    path: '/portal/freight',
    element: createLazyRoute(() => import('@/features/maritime-freight/pages/MaritimeCustomerPortalPage').then((module) => ({ default: module.MaritimeCustomerPortalPage }))),
  },
  {
    path: '/st/:slug',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/st/:slug/table/:tableNo',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/store/:slug',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/store/:slug/table/:tableNo',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/shop/:slug',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  /*
   * صفحات المنتج: كل منتج له رابط حقيقي قابل للمشاركة والفهرسة.
   * قبلها كان المنتج يُفتح في مودال بلا URL، فلا يمكن إرساله في واتساب ولا
   * استهدافه بإعلان ولا فهرسته في جوجل، وزر الرجوع كان يخرج من المتجر كله.
   */
  /*
   * رابط تتبع الطلب المرسل للعميل على واتساب: `/store/:slug/track/:orderNumber#t=<token>`.
   * التوكن في الـ fragment فلا يصل للسيرفر ولا لسجلات الوصول (SF-1).
   */
  {
    path: '/st/:slug/track/:orderNumber',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/store/:slug/track/:orderNumber',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/shop/:slug/track/:orderNumber',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/st/:slug/c/:categoryId',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/st/:slug/category/:categoryId',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/store/:slug/c/:categoryId',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/store/:slug/category/:categoryId',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/shop/:slug/c/:categoryId',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/shop/:slug/category/:categoryId',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/st/:slug/p/:productId',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/store/:slug/p/:productId',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/shop/:slug/p/:productId',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/table/:tableNo',
    element: createLazyRoute(() => import('@/features/storefront/pages/PublicStorefrontPage').then((module) => ({ default: module.PublicStorefrontPage }))),
  },
  {
    path: '/driver',
    element: createLazyRoute(() => import('@/features/delivery-reps/pages/DriverPortalPage').then((module) => ({ default: module.DriverPortalPage }))),
  },
  {
    path: '/driver-portal',
    element: <Navigate to="/driver" replace />,
  },
  {
    path: '/van-sales',
    element: createLazyRoute(() => import('@/features/delivery-reps/pages/VanSalesMobilePage')),
  },
  {
    path: '/van-sales/load-requisition',
    element: createLazyRoute(() =>
      import('@/features/delivery-reps/pages/DriverNewLoadRequisitionPage').then((module) => ({
        default: () => (
          <module.DriverNewLoadRequisitionPage
            onBack={() => {
              window.location.href = '/van-sales';
            }}
            onRequisitionSubmitted={() => {
              window.location.href = '/van-sales';
            }}
          />
        ),
      }))
    ),
  },
  {
    path: '/van',
    element: <Navigate to="/van-sales" replace />,
  },
  {
    path: '/pos/customer-display',
    element: createLazyRoute(() => import('@/features/pos/pages/CustomerFacingDisplayPage').then((module) => ({ default: module.CustomerFacingDisplayPage }))),
  },
  {
    path: '/customer-display',
    element: <Navigate to="/pos/customer-display" replace />,
  },
  {
    path: '/kds',
    element: createLazyRoute(() => import('@/features/pos/pages/KitchenDisplayPage').then((module) => ({ default: module.KitchenDisplayPage }))),
  },
  {
    path: '/kitchen',
    element: <Navigate to="/kds" replace />,
  },
  {
    path: '/signage',
    element: createLazyRoute(() => import('@/features/pos/pages/DigitalSignagePage').then((module) => ({ default: module.DigitalSignagePage }))),
  },
  {
    path: '/promo-board',
    element: <Navigate to="/signage" replace />,
  },
  {
    path: '/pos/order-status',
    element: createLazyRoute(() => import('@/features/pos/pages/OrderStatusBoardPage').then((module) => ({ default: module.OrderStatusBoardPage }))),
  },
  {
    path: '/order-status',
    element: <Navigate to="/pos/order-status" replace />,
  },
  {
    path: '/pickup-board',
    element: <Navigate to="/pos/order-status" replace />,
  },
  {
    path: '/pos/waiter',
    element: createLazyRoute(() => import('@/features/pos/pages/WaiterStationPage').then((module) => ({ default: module.WaiterStationPage }))),
  },
  {
    path: '/waiter',
    element: <Navigate to="/pos/waiter" replace />,
  },
  {
    path: '/pos/kiosk',
    element: createLazyRoute(() => import('@/features/pos/pages/SelfOrderingKioskPage').then((module) => ({ default: module.SelfOrderingKioskPage }))),
  },
  {
    path: '/pos/kiosk/:slug',
    element: createLazyRoute(() => import('@/features/pos/pages/SelfOrderingKioskPage').then((module) => ({ default: module.SelfOrderingKioskPage }))),
  },
  {
    path: '/kiosk',
    element: <Navigate to="/pos/kiosk" replace />,
  },
  {
    path: '/kiosk/:slug',
    element: createLazyRoute(() => import('@/features/pos/pages/SelfOrderingKioskPage').then((module) => ({ default: module.SelfOrderingKioskPage }))),
  },
  {
    path: '/punch',
    element: createLazyRoute(() => import('@/features/hr/pages/MobilePunchPage')),
  },
  {
    path: '/attendance/punch',
    element: <Navigate to="/punch" replace />,
  },
  {
    path: '/portal',
    element: createLazyRoute(() => import('@/features/hr/pages/EmployeePortalPage')),
  },
  {
    path: '/employee-portal',
    element: <Navigate to="/portal" replace />,
  },
  {
    path: '/ess',
    element: <Navigate to="/portal" replace />,
  },
  {
    path: '/hub',
    element: createLazyRoute(() => import('@/features/portals-hub/pages/PortalsHubPage')),
  },
  {
    path: '/portals',
    element: <Navigate to="/hub" replace />,
  },
  {
    path: '/launchpad',
    element: <Navigate to="/hub" replace />,
  },
  {
    path: '/owner',
    element: <Navigate to="/owner-companion" replace />,
  },
  { path: '/login', element: <AppGateGuard expected="login"><LoginRoute /></AppGateGuard> },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      ...appRoutes.map((route) => ({ index: route.index, path: route.path, element: route.element })),
      {
        path: 'profile',
        element: createLazyRoute(() => import('@/features/auth/pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))
      },
      {
        path: '*',
        element: createLazyRoute(() => import('@/features/not-found/pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })))
      }
    ]
  }
]);

export function AppRouter() {
  return (
    <AppErrorBoundary>
      <RouterProvider router={router} />
      <AppCloseGuard />
    </AppErrorBoundary>
  );
}
