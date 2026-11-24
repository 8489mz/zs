import { sql, type Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { TenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { RawBuilder } from 'kysely';

export class SettingsLists {
  constructor(private readonly db: Kysely<Database>, private readonly bound: { remember: <T>(cache: Map<string, { data: T; expiresAt: number }>, key: string, data: T) => void; scope: (actor: AuthContext) => TenantScope; tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>; _branchesCache: Map<string, { data: Record<string, unknown>; expiresAt: number }>; _locationsCache: Map<string, { data: Record<string, unknown>; expiresAt: number }> }) {}

  private remember<T>(cache: Map<string, { data: T; expiresAt: number }>, key: string, data: T): void {
    return this.bound.remember(cache, key, data);
  }
  private scope(actor: AuthContext): TenantScope {
    return this.bound.scope(actor);
  }
  private tenantPredicate(actor: AuthContext, alias?: string): RawBuilder<boolean> {
    return this.bound.tenantPredicate(actor, alias);
  }
  private get _branchesCache(): Map<string, { data: Record<string, unknown>; expiresAt: number }> {
    return this.bound._branchesCache;
  }
  private get _locationsCache(): Map<string, { data: Record<string, unknown>; expiresAt: number }> {
    return this.bound._locationsCache;
  }

  async listBranches(actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const cached = this._branchesCache.get(scope.tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      this._branchesCache.delete(scope.tenantId);
      this._branchesCache.set(scope.tenantId, cached);
      return { ...cached.data, scope };
    }
    const rows = await this.db.selectFrom('branches').select(['id', 'name', 'code', 'default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock']).where('is_active', '=', true).where(this.tenantPredicate(actor)).orderBy('id', 'asc').execute();
    const result = { branches: rows.map((row) => ({ id: String(row.id), name: row.name || '', code: row.code || '', defaultStockLocationId: row.default_stock_location_id ? String(row.default_stock_location_id) : null, salesStockMode: row.sales_stock_mode, allowExternalSalesStock: row.allow_external_sales_stock })) };
    this.remember(this._branchesCache, scope.tenantId, result);
    return { ...result, scope };
  }

  async listLocations(actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const isStorekeeperRestricted = actor.role === 'storekeeper' && !actor.permissions?.includes('canManageBranchStock');
    const cacheKey = `${scope.tenantId}:${Boolean(isStorekeeperRestricted)}`;
    const cached = this._locationsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this._locationsCache.delete(cacheKey);
      this._locationsCache.set(cacheKey, cached);
      return { ...cached.data, scope };
    }

    let query = this.db
      .selectFrom('stock_locations as l')
      .leftJoin('branches as b', (join) => join.onRef('b.id', '=', 'l.branch_id').on(sql<boolean>`b.tenant_id = ${scope.tenantId} AND b.account_id = ${scope.accountId}`))
      .select(['l.id', 'l.name', 'l.code', 'l.branch_id', 'b.name as branch_name', 'l.is_active', 'l.location_type'])
      .where(this.tenantPredicate(actor, 'l'))
      .where('l.location_type', '!=', 'in_transit')
      .orderBy('l.id', 'asc');

    if (isStorekeeperRestricted) {
      query = query.where('l.location_type', '!=', 'branch_stock');
    }

    const rows = await query.execute();
    const result = { locations: rows.map((row) => ({ id: String(row.id), name: row.name + (!row.is_active ? ' (محذوف)' : ''), code: row.code || '', branchId: row.branch_id ? String(row.branch_id) : '', branchName: row.branch_name || '', isActive: row.is_active, locationType: row.location_type })) };
    this.remember(this._locationsCache, cacheKey, result);
    return { ...result, scope };
  }
}
