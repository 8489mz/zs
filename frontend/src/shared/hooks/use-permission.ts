import { useMemo } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { tenantHasFeature } from '@/app/router/access';

function normalizePermissions(input: Array<string | null | undefined>) {
  return input.map((value) => String(value || '').trim()).filter(Boolean);
}

export function userHasAnyPermission(
  user: { role?: string | null; permissions?: string[] | null } | null | undefined,
  required: string | string[],
) {
  const needed = normalizePermissions(Array.isArray(required) ? required : [required]);
  if (!needed.length) return true;
  if (String(user?.role || '').trim() === 'super_admin' || String(user?.role || '').trim() === 'platform_admin') return true;
  const permissions = new Set(normalizePermissions(Array.isArray(user?.permissions) ? user.permissions : []));
  if (permissions.has('*')) return true;
  return needed.some((permission) => permissions.has(permission));
}

export function useHasAnyPermission(required: string | string[]) {
  const user = useAuthStore((state) => state.user);
  return useMemo(() => userHasAnyPermission(user, required), [user, required]);
}

export function useHasFeature(feature: string) {
  const user = useAuthStore((state) => state.user);
  const tenant = useAuthStore((state) => state.tenant);
  return useMemo(() => tenantHasFeature(feature, tenant, user), [user, tenant, feature]);
}

