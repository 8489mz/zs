import { Kysely } from 'kysely';
import { Database } from '../../../../database/database.types';
import { TenantScope } from './restaurant-fnb-types';

export class RestaurantFnbTipsReadSlice {
  constructor(private readonly db: Kysely<Database>) {}

  // ==========================================
  // 2. TIP POOLING & SHIFT DISTRIBUTION ENGINE
  // ==========================================

  async getTipPools(scope: TenantScope, shiftDate?: string) {
    let query = this.db.selectFrom('restaurant_tip_pools').selectAll().where('tenant_id', '=', scope.tenantId);

    if (shiftDate) {
      query = query.where('shift_date', '=', shiftDate);
    }

    const pools = await query.orderBy('created_at', 'desc').limit(30).execute();

    const poolIds = pools.map((p) => p.id);
    let distributions: any[] = [];
    if (poolIds.length > 0) {
      distributions = await this.db
        .selectFrom('restaurant_tip_pool_distributions')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('pool_id', 'in', poolIds)
        .execute();
    }

    const distMap = new Map<number, any[]>();
    for (const d of distributions) {
      if (!distMap.has(d.pool_id)) distMap.set(d.pool_id, []);
      distMap.get(d.pool_id)!.push(d);
    }

    return pools.map((p) => ({
      ...p,
      distributions: distMap.get(p.id) || [],
    }));
  }

  /**
   * INV-REST-TIP-STAFF-REAL: the narrow staff list the tip-pool picker
   * reads. GET /api/hr/employees is NOT the source: it requires
   * hrEmployees or hrAttendance, which the manager caller who opens the
   * tip modal (admin role, or pos_manager / manage_restaurant) does not
   * necessarily hold — PermissionsGuard checks permission strings only,
   * so a tenant admin or a pos_manager cashier would 403 on exactly the
   * call the modal needs. This endpoint is tenant-scoped, returns active
   * employees only, and exposes id + displayName + branchId +
   * expectedDailyHours only — no salary, no PIN status, no HR detail —
   * so granting cashiers hrEmployees was never an option.
   */
  async getTipPoolStaff(scope: TenantScope) {
    const rows = await this.db
      .selectFrom('hr_employees')
      .select(['id', 'display_name', 'branch_id', 'expected_daily_hours', 'status'])
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'active')
      .orderBy('display_name', 'asc')
      .execute();
    return rows.map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name || ''),
      branchId: row.branch_id != null ? String(row.branch_id) : null,
      expectedDailyHours: row.expected_daily_hours != null ? Number(row.expected_daily_hours) : null,
      status: 'active' as const,
    }));
  }
}
