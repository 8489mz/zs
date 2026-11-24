import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuditService } from '../../../core/audit/audit.service';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { TenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { RawBuilder } from 'kysely';
import { AppError } from '../../../common/errors/app-error';
import { listSupportedIndustryProfiles, type IndustryProfile } from '../../../core/tenant/industry-profiles';

export class SettingsLocationsAdmin {
  constructor(private readonly db: Kysely<Database>, private readonly audit: AuditService, private readonly bound: { invalidateBranchesCache: (tenantId: string | undefined) => void; invalidateLocationsCache: (tenantId: string | undefined) => void; listBranches: (actor: AuthContext) => Promise<Record<string, unknown>>; listLocations: (actor: AuthContext) => Promise<Record<string, unknown>>; scope: (actor: AuthContext) => TenantScope; tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean> }) {}

  private invalidateBranchesCache(tenantId: string | undefined): void {
    return this.bound.invalidateBranchesCache(tenantId);
  }
  private invalidateLocationsCache(tenantId: string | undefined): void {
    return this.bound.invalidateLocationsCache(tenantId);
  }
  private async listBranches(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.bound.listBranches(actor);
  }
  private async listLocations(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.bound.listLocations(actor);
  }
  private scope(actor: AuthContext): TenantScope {
    return this.bound.scope(actor);
  }
  private tenantPredicate(actor: AuthContext, alias?: string): RawBuilder<boolean> {
    return this.bound.tenantPredicate(actor, alias);
  }

  async deleteBranch(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const branch = await this.db.selectFrom('branches').select(['id']).where('id', '=', id).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!branch) throw new AppError('Branch not found', 'BRANCH_NOT_FOUND', 404);
    const linkedLocations = await this.db.selectFrom('stock_locations').select((eb) => eb.fn.countAll<number>().as('count')).where('branch_id', '=', id).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow();
    if (Number(linkedLocations.count || 0) > 0) throw new AppError('Branch still has active locations', 'BRANCH_HAS_LOCATIONS', 400);
    await this.db.updateTable('branches').set({ is_active: false }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
    this.invalidateBranchesCache(scope.tenantId);
    await this.audit.log('حذف فرع', `تم إلغاء تفعيل الفرع #${id} بواسطة ${actor.username}`, actor);
    return { ok: true, removedBranchId: String(id), ...(await this.listBranches(actor)) };
  }

  async updateLocation(id: number, payload: { name?: string; code?: string; branchId?: string | number | null; locationType?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const location = await this.db.selectFrom('stock_locations').select(['id', 'location_type']).where('id', '=', id).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!location) throw new AppError('Location not found', 'LOCATION_NOT_FOUND', 404);
    const name = String(payload.name || '').trim();
    const code = String(payload.code || '').trim();
    const branchId = payload.branchId === '' || payload.branchId == null ? null : Number(payload.branchId);
    const locationType = String(payload.locationType || location.location_type).trim();
    if (payload.locationType === 'in_transit' && location.location_type !== 'in_transit') {
      throw new AppError('لا يمكن إنشاء أو تعديل المخزن ليكون قيد النقل يدوياً', 'INVALID_LOCATION_TYPE', 400);
    }
    const validTypes = ['internal_warehouse', 'external_warehouse', 'branch_stock', 'damaged', 'in_transit', 'quarantine'];
    if (!validTypes.includes(locationType)) {
      throw new AppError('نوع المخزن غير صالح', 'INVALID_LOCATION_TYPE', 400);
    }
    if (locationType === 'branch_stock' && !branchId) {
      throw new AppError('يجب ربط رصيد الفرع بفرع محدد', 'BRANCH_REQUIRED_FOR_BRANCH_STOCK', 400);
    }
    if (!name) throw new AppError('Location name is required', 'LOCATION_NAME_REQUIRED', 400);
    if (branchId !== null) {
      const branch = await this.db.selectFrom('branches').select(['id']).where('id', '=', branchId).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
      if (!branch) throw new AppError('Branch not found', 'BRANCH_NOT_FOUND', 404);
    }
    await this.db.updateTable('stock_locations').set({ name, code, branch_id: branchId, location_type: locationType as any }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
    this.invalidateLocationsCache(scope.tenantId);
    await this.audit.log('تعديل مخزن', `تم تحديث المخزن #${id} بواسطة ${actor.username}`, actor);
    return { ok: true, locationId: String(id), ...(await this.listLocations(actor)) };
  }

  async deleteLocation(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const location = await this.db.selectFrom('stock_locations').select(['id', 'is_active']).where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!location) throw new AppError('Location not found', 'LOCATION_NOT_FOUND', 404);

    const branchWithDefault = await this.db.selectFrom('branches').select('id').where('default_stock_location_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (branchWithDefault) throw new AppError('لا يمكن حذف المخزن الافتراضي لفرع. قم بتغيير المخزن الافتراضي للفرع أولاً', 'LOCATION_IS_DEFAULT_FOR_BRANCH', 400);

    const stocks = await this.db.selectFrom('product_location_stock').select((eb) => eb.fn.sum<number>('qty').as('total_qty')).where('location_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (Number(stocks?.total_qty || 0) > 0) throw new AppError('لا يمكن حذف المخزن طالما يوجد به رصيد. يجب تحويل الرصيد أولاً', 'LOCATION_HAS_STOCK', 400);

    // Clean up empty stock records first
    await this.db.deleteFrom('product_location_stock').where('location_id', '=', id).where('qty', '<=', 0).where(this.tenantPredicate(actor)).execute();

    try {
      // Clear movement history for this location to allow hard deletion
      await this.db.deleteFrom('stock_movements').where('location_id', '=', id).where(this.tenantPredicate(actor)).execute();

      // Try to hard delete
      await this.db.deleteFrom('stock_locations').where('id', '=', id).where(this.tenantPredicate(actor)).execute();
      this.invalidateLocationsCache(scope.tenantId);
      await this.audit.log('حذف مخزن نهائي', `تم حذف المخزن #${id} نهائياً بواسطة ${actor.username}`, actor);
    } catch (error: any) {
      // If foreign key constraint fails (e.g. stock_movements), fallback to soft delete
      if (error.code === '23503') {
        if (location.is_active) {
          await this.db.updateTable('stock_locations').set({ is_active: false }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
          this.invalidateLocationsCache(scope.tenantId);
          await this.audit.log('أرشفة مخزن', `تم أرشفة المخزن #${id} لوجود حركات سابقة بواسطة ${actor.username}`, actor);
        }
      } else {
        throw error;
      }
    }
    return { ok: true, removedLocationId: String(id), ...(await this.listLocations(actor)) };
  }

  getIndustryProfiles(): IndustryProfile[] {
    return listSupportedIndustryProfiles();
  }
}
