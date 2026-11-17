/**
 * كشف بيئة التشغيل — بدائية لا تعتمد على شيء.
 *
 * كانت `isDesktopOfflineApp` تسكن في `@/app/router/access`، فكان أي مكوّن ميزة
 * يحتاجها يخترق طبقة الـapp ويكسر حارس `frontend-import-layers`. وهي ليست منطق
 * توجيه ولا صلاحيات: مجرد سؤال «هل نحن داخل الديسكتوب؟». فمحلها الطبقة المشتركة،
 * و`access.ts` يعيد تصديرها حتى تبقى كل الاستيرادات القائمة تعمل.
 */
export function isDesktopOfflineApp(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as any).electronRuntime ||
    (window as any).electronAPI ||
    (window as any).process?.versions?.electron ||
    (window.navigator?.userAgent && window.navigator.userAgent.toLowerCase().includes('electron')) ||
    import.meta.env.MODE === 'electron' ||
    import.meta.env.MODE === 'portable'
  );
}

export function isPlatformAdmin(user: { role?: string; tenantId?: string; accountId?: string } | null | undefined): boolean {
  if (isDesktopOfflineApp()) return false;
  if (!user) return false;
  if (user.role !== 'super_admin') return false;

  const configuredPlatformTenantId = String(import.meta.env?.VITE_PLATFORM_TENANT_ID || 'zs').trim();
  const tenantId = String(user?.tenantId || '').trim();
  const accountId = String(user?.accountId || '').trim();
  const hasExplicitTenant = tenantId.length > 0;

  const isPlatformTenant = tenantId === configuredPlatformTenantId || tenantId === 'zs' || tenantId === 'default' || tenantId === 'dev-tenant';
  const canUseAccountFallback = !hasExplicitTenant && (accountId === 'zs' || accountId === 'default' || accountId === configuredPlatformTenantId);

  return Boolean(isPlatformTenant || canUseAccountFallback);
}

/**
 * تحديد ما إذا كان المستخدم يملك صلاحية تفعيل/إيقاف الموديولات والباقات
 * (سوبر أدمن المنصة أو أثناء التصفح كمالك من لوحة الساس عبر sessions.impersonated_by).
 */
export function canManagePlatformModules(
  user: { role?: string; tenantId?: string; accountId?: string; isPlatformImpersonation?: boolean } | null | undefined,
): boolean {
  if (isPlatformAdmin(user)) return true;
  if (!user || isDesktopOfflineApp()) return false;
  return Boolean(user.isPlatformImpersonation);
}

