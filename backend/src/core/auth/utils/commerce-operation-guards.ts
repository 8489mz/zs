import { ForbiddenException } from '@nestjs/common';
import type { AuthContext } from '../interfaces/auth-context.interface';
import { requireTenantScope } from './tenant-boundary';

/** API-independent checks: downstream services are callable outside controllers. */
export function assertCommerceCapability(auth: AuthContext, grantedByAny: readonly string[], operation: string): void {
  requireTenantScope(auth);
  if (auth.role === 'admin' || auth.role === 'super_admin') return;
  if (grantedByAny.some((permission) => auth.permissions?.includes(permission))) return;
  throw new ForbiddenException(`Missing permission to ${operation}`);
}

export const canManageShippingConfig = (auth: AuthContext): void =>
  assertCommerceCapability(auth, ['settings', 'canManageSettings'], 'manage shipping configuration');

export const canManagePriceLists = (auth: AuthContext): void =>
  assertCommerceCapability(auth, ['pricingCenterManage', 'canEditPrice', 'canManageSettings'], 'manage price lists');

export const canWriteQuotations = (auth: AuthContext): void =>
  assertCommerceCapability(auth, ['sales'], 'write quotations');

export const canOperateShipping = (auth: AuthContext): void =>
  assertCommerceCapability(auth, ['sales', 'deliveryReps', 'canManageSettings'], 'operate shipments');
