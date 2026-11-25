import { sql } from '../../../database/kysely';
import { SalesWriteService } from '../../sales/services/sales-write.service';
import { requireTenantScope, type TenantScope } from '../../../core/auth/utils/tenant-boundary';
import { invalidateTenantTimezoneCache } from '../../../common/utils/tenant-timezone.util';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { RawBuilder } from 'kysely';

export class SettingsCache {
  constructor() {}

  // Tenant and permission-aware caches; each entry lives at most 60 seconds.
  public readonly _settingsCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
  public readonly _branchesCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
  public readonly _locationsCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60 * 1000;
  public remember<T>(cache: Map<string, { data: T; expiresAt: number }>, key: string, data: T): void {
    cache.delete(key);
    cache.set(key, { data, expiresAt: Date.now() + this.CACHE_TTL_MS });
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
  }

  invalidateSettingsCache(tenantId?: string) {
    if (tenantId) {
      for (const key of this._settingsCache.keys()) {
        if (key.startsWith(`${tenantId}:`)) this._settingsCache.delete(key);
      }
    } else {
      this._settingsCache.clear();
    }
    SalesWriteService.invalidateSettingsCache(tenantId);
    // `settings.timezone` له كاش منفصل عمره 5 دقائق داخل `tenant-timezone.util`،
    // وهو مصدر `work_date` للحضور. بدون إبطاله هنا يظل تغيير المنطقة الزمنية بلا
    // أثر حتى تنتهي المهلة — وقرب منتصف الليل يُكتب الحضور بيوم خاطئ.
    invalidateTenantTimezoneCache(tenantId);
  }

  invalidateBranchesCache(tenantId?: string) {
    if (tenantId) {
      this._branchesCache.delete(tenantId);
    } else {
      this._branchesCache.clear();
    }
  }

  invalidateLocationsCache(tenantId?: string) {
    if (tenantId) {
      for (const key of this._locationsCache.keys()) {
        if (key.startsWith(`${tenantId}:`)) this._locationsCache.delete(key);
      }
    } else {
      this._locationsCache.clear();
    }
  }

  public scope(actor: AuthContext) {
    return requireTenantScope(actor);
  }
  public tenantPredicate(actor: AuthContext, alias?: string) {
    const { tenantId, accountId } = this.scope(actor);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId} AND ${sql.ref(`${alias}.account_id`)} = ${accountId}`
      : sql<boolean>`tenant_id = ${tenantId} AND account_id = ${accountId}`;
  }
}
