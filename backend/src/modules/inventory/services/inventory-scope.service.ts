import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { applyStockDelta, lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';

@Injectable()
export class InventoryScopeService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private tenantId(auth: AuthContext): string {
    return requireTenantScope(auth).tenantId;
  }

  private canAccessEveryBranch(auth: AuthContext): boolean {
    return ['owner', 'admin', 'super_admin'].includes(auth.role);
  }

  async branchScope(auth: AuthContext, executor: Kysely<Database> = this.db): Promise<number[]> {
    const tenantId = this.tenantId(auth);
    if (this.canAccessEveryBranch(auth)) return [];
    const user = await executor
      .selectFrom('users')
      .select(['default_branch_id'])
      .where('id', '=', auth.userId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    if (!user) return [];
    const rows = await executor
      .selectFrom('user_branches')
      .select(['branch_id'])
      .where('user_id', '=', auth.userId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .execute();
    const ids = rows.map((entry) => Number(entry.branch_id)).filter((entry) => Number.isInteger(entry) && entry > 0);
    if (user.default_branch_id && !ids.includes(user.default_branch_id)) {
      // Validate that default_branch_id belongs to the actor's tenant before trusting it (CORE-007)
      const branchBelongsToTenant = await executor
        .selectFrom('branches')
        .select('id')
        .where('id', '=', user.default_branch_id)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .executeTakeFirst();
      if (branchBelongsToTenant) {
        ids.push(user.default_branch_id);
      }
    }
    return Array.from(new Set(ids));
  }

  async assertLocationScope(locationId: number, auth: AuthContext, allowInactive = false, action: 'read' | 'write' = 'read', executor: Kysely<Database> = this.db): Promise<{ id: number; name: string; branchId: number | null }> {
    const tenantId = this.tenantId(auth);
    const location = await executor
      .selectFrom('stock_locations')
      .select(['id', 'name', 'branch_id', 'location_type'])
      .where('id', '=', locationId)
      .where((eb) => allowInactive ? eb.val(true) : eb('is_active', '=', true))
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    if (!location) {
      throw new AppError('Location not found', 'LOCATION_NOT_FOUND', 404);
    }

    // In-transit is a system-owned clearing location. Letting a cashier adjust
    // it directly strands transfer document serial/batch snapshots and hides
    // shrinkage; only the transfer transaction may move these balances.
    if (action === 'write' && location.location_type === 'in_transit') {
      throw new AppError('مخزن البضاعة بالطريق مخصص لتسوية التحويلات آلياً فقط', 'IN_TRANSIT_LOCATION_RESTRICTED', 409);
    }

    if (location.location_type === 'branch_stock') {
      const isSuper = ['owner', 'admin', 'super_admin'].includes(auth.role);
      const hasPerm = auth.permissions?.includes('canManageBranchStock');
      
      if (action === 'write' && !isSuper && !hasPerm) {
        throw new AppError('You do not have permission to modify branch stock', 'LOCATION_SCOPE_FORBIDDEN', 403);
      }
      
      if (action === 'read' && auth.role === 'storekeeper' && !hasPerm) {
        throw new AppError('Location not found', 'LOCATION_NOT_FOUND', 404);
      }
    }

    const scope = await this.branchScope(auth, executor);
    if (!this.canAccessEveryBranch(auth) &&
        (scope.length === 0 || (location.branch_id != null && !scope.includes(Number(location.branch_id))))) {
      throw new AppError('Location is outside assigned branches', 'LOCATION_SCOPE_FORBIDDEN', 403);
    }

    return { id: location.id, name: location.name || '', branchId: location.branch_id || null };
  }

  async filterByScope<T extends { branchId?: string; fromBranchId?: string; toBranchId?: string }>(rows: T[], auth: AuthContext, executor: Kysely<Database> = this.db): Promise<T[]> {
    const scope = await this.branchScope(auth, executor);
    if (this.canAccessEveryBranch(auth)) return rows;
    if (!scope.length) return [];
    return rows.filter((row) => {
      const ids = [Number(row.branchId || 0), Number(row.fromBranchId || 0), Number(row.toBranchId || 0)].filter((id) => id > 0);
      if (!ids.length) return true;
      return ids.every((id) => scope.includes(id));
    });
  }

  async listLocations(auth: AuthContext, includeInactive?: boolean): Promise<Record<string, unknown>> {
    const tenantId = this.tenantId(auth);
    const scope = await this.branchScope(auth);
    if (!this.canAccessEveryBranch(auth) && !scope.length) return { locations: [] };
    let query = this.db
      .selectFrom('stock_locations as l')
      .leftJoin('branches as b', (join) => join.onRef('b.id', '=', 'l.branch_id').on(sql<boolean>`b.tenant_id = ${tenantId}`))
      .select(['l.id', 'l.name', 'l.code', 'l.branch_id', 'b.name as branch_name', 'l.is_active', 'l.location_type'])
      .where(sql<boolean>`l.tenant_id = ${tenantId}`)
      .orderBy('l.id', 'asc');
      
    if (auth.role === 'storekeeper' && !auth.permissions?.includes('canManageBranchStock')) {
      query = query.where('l.location_type', '!=', 'branch_stock');
    }
      
    if (!includeInactive) {
      query = query.where((eb) => eb.or([
        eb('l.is_active', '=', true),
        eb.exists(
          eb.selectFrom('product_location_stock as s')
            .select('s.id')
            .whereRef('s.location_id', '=', 'l.id')
            .where('s.qty', '>', 0)
        )
      ]));
    }
    if (!this.canAccessEveryBranch(auth)) {
      query = query.where((eb) => eb.or([eb('l.branch_id', 'in', scope), eb('l.branch_id', 'is', null)]));
    }
    const rows = await query.execute();
    return {
      locations: rows.map((row) => ({ id: String(row.id), name: row.name + (!row.is_active ? ' (محذوف)' : ''), code: row.code || '', branchId: row.branch_id ? String(row.branch_id) : '', branchName: row.branch_name || '', locationType: row.location_type })),
    };
  }
  async getAllLocationStocks(auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId, accountId } = requireTenantScope(auth);
    const scope = await this.branchScope(auth);
    if (!this.canAccessEveryBranch(auth) && !scope.length) return { stocks: [] };
    let query = this.db
      .selectFrom('product_location_stock as s')
      .leftJoin('products as p', 'p.id', 's.product_id')
      .innerJoin('stock_locations as l', 'l.id', 's.location_id')
      .select(['s.product_id', 's.location_id', 's.qty'])
      .where('p.is_active', '=', true)
      .where((eb) => eb.or([
        eb('l.is_active', '=', true),
        eb('s.qty', '>', 0)
      ]))
      .where('s.tenant_id', '=', tenantId)
      .where('s.account_id', '=', accountId);

    if (auth.role === 'storekeeper' && !auth.permissions?.includes('canManageBranchStock')) {
      query = query.where('l.location_type', '!=', 'branch_stock');
    }

    if (!this.canAccessEveryBranch(auth)) {
      query = query.where((eb) => eb.or([
        eb('s.branch_id', 'in', scope),
        eb('s.branch_id', 'is', null)
      ]));
    }
    
    const rows = await query.execute();
    return {
      stocks: rows.map(r => ({
        productId: String(r.product_id),
        locationId: r.location_id ? String(r.location_id) : '',
        qty: Number(r.qty || 0)
      }))
    };
  }

  async getLocationCategories(locationId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertLocationScope(locationId, auth);
    const { tenantId, accountId } = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('product_categories as c')
      .leftJoin('products as p', 'p.category_id', 'c.id')
      .leftJoin('product_location_stock as s', join => join.onRef('s.product_id', '=', 'p.id').on('s.location_id', '=', locationId))
      .select([
        'c.id', 
        'c.name',
        sql<number>`COUNT(s.product_id)`.as('assignedProductCount'),
        sql<number>`SUM(CASE WHEN s.qty > 0 THEN 1 ELSE 0 END)`.as('positiveStockProductCount')
      ])
      .where('c.is_active', '=', true)
      .where('c.tenant_id', '=', tenantId)
      .where('c.account_id', '=', accountId)
      .groupBy(['c.id', 'c.name'])
      .orderBy('c.name')
      .execute();
      
    return {
      categories: rows.map(r => ({ 
        id: String(r.id), 
        name: r.name || '',
        assignedProductCount: Number(r.assignedProductCount) || 0,
        positiveStockProductCount: Number(r.positiveStockProductCount) || 0
      }))
    };
  }

  async getLocationCategoryProducts(locationId: number, categoryId: number | 'all', auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertLocationScope(locationId, auth);
    const { tenantId, accountId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('products as p')
      .innerJoin('product_location_stock as s', 's.product_id', 'p.id')
      .select(['p.id', 'p.name', 'p.barcode', 's.qty', 'p.stock_qty'])
      .where('s.location_id', '=', locationId)
      .where('p.is_active', '=', true)
      .where('p.tenant_id', '=', tenantId)
      .where('p.account_id', '=', accountId);
      
    if (categoryId !== 'all') {
      query = query.where('p.category_id', '=', categoryId);
    }
    
    const rows = await query.orderBy('p.name').execute();
    return {
      products: rows.map(r => ({
        id: String(r.id),
        name: r.name || '',
        barcode: r.barcode || '',
        stockQty: Number(r.qty || 0),
        globalStockQty: Number(r.stock_qty || 0)
      }))
    };
  }

  async getAdvancedOverview(auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId, accountId } = requireTenantScope(auth);
    const branchScope = await this.branchScope(auth);
    if (!this.canAccessEveryBranch(auth) && !branchScope.length) return { locations: [], totalGlobalValue: 0 };
    
    const locationsRaw = await this.db.selectFrom('stock_locations as l')
      .select(['l.id', 'l.name', 'l.is_active', 'l.branch_id'])
      .where((eb) => eb.or([
        eb('l.is_active', '=', true),
        eb.exists(
          eb.selectFrom('product_location_stock as s')
            .select('s.id')
            .whereRef('s.location_id', '=', 'l.id')
            .where('s.qty', '>', 0)
        )
      ]))
      .where('l.tenant_id', '=', tenantId)
      .where('l.account_id', '=', accountId)
      .execute();
      
    const allowedLocationIds = locationsRaw
      .filter((l) => this.canAccessEveryBranch(auth) || l.branch_id == null || branchScope.includes(Number(l.branch_id)))
      .map((l) => Number(l.id));
    if (allowedLocationIds.length === 0) return { locations: [], totalGlobalValue: 0 };
    const locations = locationsRaw.filter((l) => allowedLocationIds.includes(Number(l.id))).map(l => ({
      id: l.id,
      name: l.name + (!l.is_active ? ' (محذوف)' : '')
    }));
      
    const categories = await this.db.selectFrom('product_categories')
      .select(['id', 'name'])
      .where('tenant_id', '=', tenantId)
      .where('account_id', '=', accountId)
      .execute();
      
    const stockCounts = await this.db.selectFrom('product_location_stock as pls')
      .innerJoin('products as p', 'p.id', 'pls.product_id')
      .select([
        'pls.location_id',
        'p.category_id',
        sql<number>`count(distinct p.id)`.as('productCount'),
        sql<number>`sum(pls.qty * p.cost_price)`.as('inventoryValue')
      ])
      .where('pls.qty', '>', 0)
      .where('pls.location_id', 'in', allowedLocationIds)
      .where('pls.tenant_id', '=', tenantId)
      .where('p.tenant_id', '=', tenantId)
      .where('p.account_id', '=', accountId)
      .groupBy(['pls.location_id', 'p.category_id'])
      .execute();

    const categoryNameById = new Map(categories.map((category) => [Number(category.id), category.name]));
    const stockByLocation = new Map<number, typeof stockCounts>();
    for (const stock of stockCounts) {
      const locationId = Number(stock.location_id);
      const rows = stockByLocation.get(locationId) || [];
      rows.push(stock);
      stockByLocation.set(locationId, rows);
    }

    let totalGlobalValue = 0;

    const overview = locations.map(loc => {
      const locStocks = stockByLocation.get(Number(loc.id)) || [];
      let locationTotalValue = 0;
      
      const locCategories = locStocks.map(s => {
        const categoryName = categoryNameById.get(Number(s.category_id));
        const value = Number(s.inventoryValue) || 0;
        locationTotalValue += value;
        return {
          id: String(s.category_id),
          name: categoryName || 'بدون قسم',
          productCount: Number(s.productCount) || 0,
          inventoryValue: value
        };
      }).filter(c => c.productCount > 0);
      
      totalGlobalValue += locationTotalValue;

      return {
        id: String(loc.id),
        name: loc.name,
        totalValue: locationTotalValue,
        categories: locCategories
      };
    });
    
    return { locations: overview, totalGlobalValue };
  }
  async assignProductsToLocation(locationId: number, productIds: number[], auth: AuthContext): Promise<{ success: boolean }> {
    await this.assertLocationScope(locationId, auth, false, 'write');
    if (!productIds || productIds.length === 0) return { success: true };

    await this.db.transaction().execute(async trx => {
      const { tenantId, accountId } = requireTenantScope(auth);
      const location = await trx.selectFrom('stock_locations').select('branch_id').where('id', '=', locationId).where('tenant_id', '=', tenantId).where('account_id', '=', accountId).executeTakeFirst();
      if (!location) throw new AppError('Location not found', 'NOT_FOUND', 404);

      await lockStockProducts(trx, { tenantId, accountId, productIds });
      for (const pid of [...new Set(productIds.map(Number))].sort((a, b) => a - b)) {
        // Zero delta provisions the location through the same locked ledger path.
        // INV-LOCATION-ASSIGN-NO-DRAIN: disableAutoDrain, so provisioning
        // never re-homes the floating (unassigned) pool into the new
        // location -- assigning a product must only make it visible
        // there, at quantity zero, with no movement, journal or audit
        // trace for stock that was never physically moved.
        await applyStockDelta(trx, {
          tenantId, accountId, productId: pid, branchId: location.branch_id,
          locationId, delta: 0, skipGlobalUpdate: true, disableAutoDrain: true,
        });
      }
    });

    return { success: true };
  }

  async removeProductFromLocation(locationId: number, productId: number, auth: AuthContext): Promise<{ success: boolean }> {
    await this.assertLocationScope(locationId, auth, false, 'write');
    await this.db.transaction().execute(async trx => {
      const { tenantId, accountId } = requireTenantScope(auth);
      await lockStockProducts(trx, { tenantId, accountId, productIds: [productId] });
      // Find the stock
      const stock = await trx.selectFrom('product_location_stock')
        .select(['qty', 'reserved_qty'])
        .where('location_id', '=', locationId)
        .where('product_id', '=', productId)
        .where('tenant_id', '=', tenantId)
        .where('account_id', '=', accountId)
        .forUpdate()
        .executeTakeFirst();
      
      if (!stock) throw new AppError('Stock not found in this location', 'NOT_FOUND', 404);
      if (Number(stock.qty) > 0 || Number(stock.reserved_qty || 0) > 0) throw new AppError('لا يمكن حذف المخزن طالما يوجد به رصيد. يجب تحويل الرصيد أولاً', 'BAD_REQUEST', 400);

      await trx.deleteFrom('product_location_stock')
        .where('location_id', '=', locationId)
        .where('product_id', '=', productId)
        .where('tenant_id', '=', tenantId)
        .where('account_id', '=', accountId)
        .execute();
    });

    return { success: true };
  }
}
