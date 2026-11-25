import { getPlatformTenantIds } from '../auth/utils/tenant-boundary';
import { isDesktopRuntimeMode } from '../../config/app-mode';

/** Never overwrite the Cloud platform tenant through a tenant-controlled import. */
export function isProtectedTenantDataTarget(
  tenantId: string,
  appMode: unknown = process.env.APP_MODE,
  platformId: unknown = process.env.PLATFORM_TENANT_ID,
): boolean {
  const id = String(tenantId || '')
    .trim()
    .toLowerCase();
  if (!id || id === 'zs') return true;
  if (isDesktopRuntimeMode(appMode)) return false;
  return getPlatformTenantIds(appMode, platformId).includes(id);
}
