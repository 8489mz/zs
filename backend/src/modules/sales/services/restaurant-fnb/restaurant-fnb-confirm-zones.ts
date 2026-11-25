import { Database } from '../../../../database/database.types';
import { Kysely } from 'kysely';
import { AppError } from '../../../../common/errors/app-error';
import { TenantScope, SaveTableZoneDto } from './restaurant-fnb-types';

export class RestaurantFnbConfirmZonesSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly assertManagerCaller: (scope: TenantScope) => void,
  ) {}

  async confirmTipDistribution(scope: TenantScope, poolId: number) {
    // INV-REST-FNB-CLAIMS-POST: only a manager caller may confirm a pool.
    this.assertManagerCaller(scope);
    const pool = await this.db
      .selectFrom('restaurant_tip_pools')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', poolId)
      .executeTakeFirst();

    if (!pool) {
      throw new AppError('مجمع الإكراميات غير موجود', 'POOL_NOT_FOUND', 404);
    }

    // INV-REST-FNB-CLAIMS-POST: confirm is an APPROVAL, not a payout. An
    // already-distributed pool cannot be confirmed again — confirming twice
    // used to re-mark the same tips paid. And the distribution rows stay
    // unpaid (is_paid false, paid_at null) until a real payout moves the
    // money; the old code flipped them to paid with no journal, no cash
    // movement and no payroll link while the message claimed "صرف".
    if (pool.status === 'distributed') {
      throw new AppError('مجمع الإكراميات معتمَد بالفعل ولا يمكن اعتماده مرة أخرى', 'POOL_ALREADY_DISTRIBUTED', 409);
    }
    if (pool.status === 'cancelled') {
      throw new AppError('مجمع الإكراميات ملغى ولا يمكن اعتماده', 'POOL_CANCELLED', 409);
    }

    await this.db
      .updateTable('restaurant_tip_pools')
      .set({
        status: 'distributed',
        distributed_by: scope.userId || null,
        distributed_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', poolId)
      .execute();

    return {
      success: true,
      payoutPending: true,
      message: 'تم اعتماد توزيع الإكراميات على طاقم الوردية؛ الصرف معلّق حتى تنفيذ الدفع الفعلي للموظفين',
    };
  }

  // ==========================================
  // 3. MULTI-ZONE FLOOR PLAN & ZONES
  // ==========================================

  async getZones(scope: TenantScope, branchId?: number | null) {
    let query = this.db
      .selectFrom('restaurant_table_zones')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true);

    if (branchId) {
      query = query.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    }

    const zones = await query.orderBy('sort_order', 'asc').execute();

    // If tenant has no custom zones yet, provide clean initial industry presets
    if (zones.length === 0) {
      return [
        {
          id: 1,
          zone_code: 'main',
          name: 'الصالة الرئيسية',
          sort_order: 1,
          capacity_seats: 4,
          table_numbers: ['1', '2', '3', '4', '5', '6'],
        },
        {
          id: 2,
          zone_code: 'patio',
          name: 'التراس الخارجي',
          sort_order: 2,
          capacity_seats: 4,
          table_numbers: ['7', '8', '9', '10'],
        },
        {
          id: 3,
          zone_code: 'family',
          name: 'قسم العائلات',
          sort_order: 3,
          capacity_seats: 6,
          table_numbers: ['11', '12', '13', '14'],
        },
        {
          id: 4,
          zone_code: 'vip',
          name: 'جناح الـ VIP',
          sort_order: 4,
          capacity_seats: 8,
          table_numbers: ['15', '16'],
        },
      ];
    }

    return zones;
  }

  async saveZone(scope: TenantScope, dto: SaveTableZoneDto) {
    // INV-REST-FLOOR-DESIGN-GATES (B2): a zone is a design artifact like
    // the layout — design mode is manager-only (R5-D), so the same
    // assertManagerCaller gate applies. Read (getZones) stays
    // authenticated-any.
    this.assertManagerCaller(scope);
    if (!dto.name || !dto.zoneCode) {
      throw new AppError('اسم وكود المنطقة مطلوبان', 'INVALID_ZONE_DATA', 400);
    }

    if (dto.id) {
      await this.db
        .updateTable('restaurant_table_zones')
        .set({
          name: dto.name,
          zone_code: dto.zoneCode,
          sort_order: dto.sortOrder || 0,
          capacity_seats: dto.capacitySeats || 4,
          table_numbers: JSON.stringify(dto.tableNumbers || []),
          minimum_spend: dto.minimumSpend !== undefined ? dto.minimumSpend : 0,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', dto.id)
        .execute();

      return { success: true, message: 'تم تحديث منطقة الصالة بنجاح' };
    } else {
      const [inserted] = await this.db
        .insertInto('restaurant_table_zones')
        .values({
          tenant_id: scope.tenantId,
          branch_id: scope.branchId || null,
          zone_code: dto.zoneCode,
          name: dto.name,
          sort_order: dto.sortOrder || 0,
          capacity_seats: dto.capacitySeats || 4,
          table_numbers: JSON.stringify(dto.tableNumbers || []),
          minimum_spend: dto.minimumSpend || 0,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returningAll()
        .execute();

      return { success: true, zone: inserted, message: 'تم إنشاء منطقة الصالة بنجاح' };
    }
  }
}
