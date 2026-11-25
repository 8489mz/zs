import { AppError } from '../../../common/errors/app-error';
import { isDesktopRuntimeMode } from '../../../config/app-mode';

/**
 * Canonical zs and the configured platform identity are shared by guards and
 * bootstrap role cleanup. Local aliases are valid only in supported desktop modes.
 */
export function getPlatformTenantIds(
  appMode: unknown = process.env.APP_MODE,
  platformTenantId: unknown = process.env.PLATFORM_TENANT_ID,
): string[] {
  const configured = String(platformTenantId || 'zs')
    .trim()
    .toLowerCase();
  const ids = isDesktopRuntimeMode(appMode) ? [configured, 'zs', 'default', 'dev-tenant'] : [configured, 'zs'];
  return [...new Set(ids.filter(Boolean))];
}

export function isPlatformTenantId(value: unknown): boolean {
  const tenantId = String(value ?? '')
    .trim()
    .toLowerCase();
  return Boolean(tenantId) && getPlatformTenantIds().includes(tenantId);
}
import type { AuthContext } from '../interfaces/auth-context.interface';

export type TenantScope = {
  tenantId: string;
  accountId: string;
};

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function requireTenantScope(auth: Pick<AuthContext, 'tenantId' | 'accountId'> | null | undefined): TenantScope {
  const tenantId = normalize(auth?.tenantId);
  const accountId = normalize(auth?.accountId);

  if (!tenantId || !accountId) {
    throw new AppError('Tenant/account scope is required', 'TENANT_SCOPE_REQUIRED', 403);
  }

  return { tenantId, accountId };
}
