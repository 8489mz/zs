import { DEFAULT_STORE_NAME } from '@/config/app-defaults';
import { canAccessPath, isPlatformAdmin } from '@/app/router/access';
import type { AuthTenant, AuthUser } from '@/types/auth';

const SETUP_ENTRY_ROUTE = '/settings/core?setup=1';
const ONBOARDING_ROUTE = '/onboarding';

const ROUTE_PREFERENCES: Record<AuthUser['role'], string[]> = {
  cashier: ['/pos', '/cash-drawer', '/sales', '/customers', '/hr/attendance', '/services', '/expenses', '/'],
  admin: ['/', '/pos', '/sales', '/inventory', '/accounts', '/treasury', '/purchases', '/reports/overview', '/hr', '/hr/attendance', '/customers', '/suppliers', '/products', '/returns', '/cash-drawer', '/services', '/settings'],
  super_admin: ['/', '/pos', '/settings', '/sales', '/inventory', '/reports/overview', '/accounts', '/treasury', '/purchases', '/products', '/returns', '/cash-drawer', '/customers', '/suppliers', '/services'],
};

function normalizeValue(value: unknown) {
  return String(value || '').trim();
}

function pickOperationalLandingRoute(user: AuthUser, tenant?: AuthTenant | null) {
  // Direct Pillar Landing: Direct Contracting & Maritime tenants immediately to their domain suites
  const rawActivity = String(tenant?.activityType || tenant?.pillar || '').trim().toLowerCase();
  if (rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات') {
    if (canAccessPath(user, '/contracting')) return '/contracting';
  }
  if (rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن') {
    if (canAccessPath(user, '/maritime')) return '/maritime';
  }
  if (rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع') {
    if (canAccessPath(user, '/manufacturing/work-orders')) return '/manufacturing/work-orders';
  }
  if (rawActivity === 'warehousing' || rawActivity === 'warehouse' || rawActivity === 'مخازن' || rawActivity === 'مستودعات' || rawActivity === 'مستودع') {
    if (canAccessPath(user, '/inventory')) return '/inventory';
  }

  // Standalone POS Terminal Landing: Direct POS terminal users straight to /pos
  const isPosTerminal = typeof window !== 'undefined' && (
    Boolean((window as any).AndroidBridge?.isPosLite?.()) ||
    Boolean((window as any).SmartPos?.isPosLite?.()) ||
    Boolean((window as any).SunmiPrinter?.isPosLite?.()) ||
    window.location.search.includes('standalone=pos') ||
    window.location.search.includes('kiosk=1') ||
    window.localStorage.getItem('zsystems.pos.standalone') === 'true'
  );
  if (isPosTerminal && canAccessPath(user, '/pos')) {
    return '/pos';
  }

  // Native Mobile Device Landing: Direct native app users to mobile suite
  const isNative = typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
  if (isNative) {
    if ((user.role === 'admin' || user.role === 'super_admin') && canAccessPath(user, '/owner-mobile')) {
      return '/owner-mobile';
    }
    return '/mobile';
  }

  const preferredRoutes = ROUTE_PREFERENCES[user.role] || ROUTE_PREFERENCES.admin;
  return preferredRoutes.find((route) => canAccessPath(user, route)) || '/';
}

export interface PostLoginContext {
  tenant?: AuthTenant | null;
  deploymentMode?: 'desktop' | 'server' | string | null;
  onboardingCompleted?: boolean;
}

function isSaasOrTrialContext(context?: PostLoginContext) {
  const tenant = context?.tenant;
  return context?.deploymentMode === 'server' || tenant?.isTrial === true || tenant?.status === 'trial';
}

export function shouldStartSetupFlow(user: AuthUser | null | undefined, storeName: string | null | undefined, context?: PostLoginContext) {
  if (!user || user.role !== 'super_admin') return false;
  if (context?.onboardingCompleted === true) return false;
  if (isSaasOrTrialContext(context)) return false;
  if (user.usingDefaultAdminPassword === true) return true;
  return normalizeValue(storeName) === DEFAULT_STORE_NAME;
}

export function getPostLoginRoute(user: AuthUser | null | undefined, storeName: string | null | undefined, context?: PostLoginContext) {
  if (!user) return '/login';
  if (shouldStartSetupFlow(user, storeName, context)) return SETUP_ENTRY_ROUTE;
  if (!isPlatformAdmin(user) && (user.role === 'admin' || user.role === 'super_admin') && context?.onboardingCompleted === false) {
    return ONBOARDING_ROUTE;
  }
  return pickOperationalLandingRoute(user, context?.tenant);
}
