import { sql, type Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuditService } from '../../../core/audit/audit.service';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { isPlatformTenantId, type TenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { RawBuilder } from 'kysely';
import { AppError } from '../../../common/errors/app-error';
import { formatBranchStockLocationName } from '../../../common/utils/branch-stock.util';
import { resolveMaxBranchesForTenant } from '../settings-module-entitlement.engine';

export class SettingsBranchesLocationsWrite {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: {
      getPlanFeatures: (tenantId: string, planId: string | null | undefined) => Promise<string[]>;
      invalidateBranchesCache: (tenantId: string | undefined) => void;
      invalidateLocationsCache: (tenantId: string | undefined) => void;
      listBranches: (actor: AuthContext) => Promise<Record<string, unknown>>;
      listLocations: (actor: AuthContext) => Promise<Record<string, unknown>>;
      scope: (actor: AuthContext) => TenantScope;
      tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
    },
  ) {}

  private async getPlanFeatures(tenantId: string, planId: string | null | undefined): Promise<string[]> {
    return this.bound.getPlanFeatures(tenantId, planId);
  }
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

  async createBranch(payload: { name?: string; code?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const name = String(payload.name || '').trim();
    const code = String(payload.code || '').trim();
    if (!name) throw new AppError('Branch name is required', 'BRANCH_NAME_REQUIRED', 400);

    const isPlatformTenant = isPlatformTenantId(scope.tenantId);
    const isPlatformAdmin = actor.role === 'super_admin' && isPlatformTenant;

    if (!isPlatformAdmin) {
      const activeBranches = await this.db
        .selectFrom('branches')
        .select(['id'])
        .where(this.tenantPredicate(actor))
        .where('is_active', '=', true)
        .execute();
      const tenant = await this.db
        .selectFrom('tenants')
        .select(['id', 'plan_id', 'extra_features', 'status'])
        .where('id', '=', scope.tenantId)
        .executeTakeFirst();
      const planFeatures = await this.getPlanFeatures(scope.tenantId, tenant?.plan_id);
      const maxBranches = await resolveMaxBranchesForTenant(this.db, scope.tenantId, tenant, planFeatures);
      if (activeBranches.length >= maxBranches) {
        throw new AppError(
          `وصلت للحد الأقصى المسموح به في باقتك (${maxBranches} فرع). يرجى ترقية الباقة لإضافة فروع جديدة.`,
          'PLAN_LIMIT_REACHED',
          403,
        );
      }
    }

    const existingBranch = await this.db
      .selectFrom('branches')
      .select(['id', 'name'])
      .where(this.tenantPredicate(actor))
      .where(sql`lower(name)`, '=', name.toLowerCase())
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (existingBranch) {
      throw new AppError(
        `يوجد فرع نشط بهذا الاسم بالفعل ("${name}"). يرجى اختيار اسم فرع مختلف.`,
        'DUPLICATE_BRANCH_NAME',
        400,
      );
    }

    let inserted;
    try {
      inserted = await this.db.transaction().execute(async (trx) => {
        // 1. Insert Branch
        const newBranch = await trx
          .insertInto('branches')
          .values({
            name,
            code,
            is_active: true,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            sales_stock_mode: 'single_location',
            allow_external_sales_stock: false,
          })
          .returning(['id', 'name', 'code'])
          .executeTakeFirstOrThrow();

        // 2. Generate location name using standard helper (e.g. "رصيد فرع التعاونيات")
        const locationName = formatBranchStockLocationName(newBranch.name);

        // 3. Create default stock location
        const newLocation = await trx
          .insertInto('stock_locations')
          .values({
            name: locationName,
            code: '',
            branch_id: newBranch.id,
            location_type: 'branch_stock',
            is_active: true,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        // 4. Update branch with default stock location id
        await trx
          .updateTable('branches')
          .set({ default_stock_location_id: newLocation.id })
          .where('id', '=', newBranch.id)
          .where('tenant_id', '=', scope.tenantId)
          .execute();

        return newBranch;
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (
        err?.code === '23505' &&
        (err?.constraint?.includes('branches_tenant_name_uidx') ||
          err?.detail?.includes('already exists') ||
          err?.message?.includes('branches_tenant_name_uidx'))
      ) {
        throw new AppError(
          `يوجد فرع مسجل بهذا الاسم بالفعل ("${name}"). يرجى اختيار اسم فرع مختلف.`,
          'DUPLICATE_BRANCH_NAME',
          400,
        );
      }
      throw err;
    }

    this.invalidateBranchesCache(scope.tenantId);
    this.invalidateLocationsCache(scope.tenantId);
    await this.audit.log('إضافة فرع', `تمت إضافة الفرع ${name} بواسطة ${actor.username}`, actor);
    return {
      ok: true,
      branch: { id: String(inserted.id), name: inserted.name || '', code: inserted.code || '' },
      ...(await this.listBranches(actor)),
    };
  }

  async createLocation(
    payload: { name?: string; code?: string; branchId?: string | number | null; locationType?: string },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const name = String(payload.name || '').trim();
    const code = String(payload.code || '').trim();
    const branchId = payload.branchId === '' || payload.branchId == null ? null : Number(payload.branchId);
    const locationType = String(payload.locationType || 'internal_warehouse').trim();
    if (locationType === 'in_transit') {
      throw new AppError('لا يمكن إنشاء المخزن ليكون قيد النقل يدوياً', 'INVALID_LOCATION_TYPE', 400);
    }
    const validTypes = ['internal_warehouse', 'external_warehouse', 'branch_stock', 'damaged', 'quarantine'];
    if (!validTypes.includes(locationType)) {
      throw new AppError('نوع المخزن غير صالح', 'INVALID_LOCATION_TYPE', 400);
    }
    if (locationType === 'branch_stock' && !branchId) {
      throw new AppError('يجب ربط رصيد الفرع بفرع محدد', 'BRANCH_REQUIRED_FOR_BRANCH_STOCK', 400);
    }
    if (!name) throw new AppError('Location name is required', 'LOCATION_NAME_REQUIRED', 400);

    if (actor.role !== 'super_admin') {
      const activeLocations = await this.db
        .selectFrom('stock_locations')
        .select(['id'])
        .where(this.tenantPredicate(actor))
        .where('is_active', '=', true)
        .execute();
      const tenant = await this.db
        .selectFrom('tenants')
        .select(['id', 'plan_id', 'extra_features'])
        .where('id', '=', scope.tenantId)
        .executeTakeFirst();
      const planFeatures = await this.getPlanFeatures(scope.tenantId, tenant?.plan_id);
      const extraFeatures = Array.isArray(tenant?.extra_features)
        ? tenant?.extra_features
        : typeof tenant?.extra_features === 'string'
          ? JSON.parse(tenant.extra_features)
          : [];
      const allFeatures = new Set([...planFeatures, ...extraFeatures]);

      const hasAdvancedInventory = allFeatures.has('inventory');
      if (!hasAdvancedInventory && activeLocations.length >= 1) {
        throw new AppError(
          'وصلت للحد الأقصى المسموح به في باقتك (مخزن واحد). يرجى ترقية الباقة لتفعيل موديول المخزون لإضافة مخازن إضافية.',
          'PLAN_LIMIT_REACHED',
          403,
        );
      }
    }

    if (branchId !== null) {
      const branch = await this.db
        .selectFrom('branches')
        .select(['id'])
        .where('id', '=', branchId)
        .where('is_active', '=', true)
        .where(this.tenantPredicate(actor))
        .executeTakeFirst();
      if (!branch) throw new AppError('Branch not found', 'BRANCH_NOT_FOUND', 404);
    }
    const inserted = await this.db
      .insertInto('stock_locations')
      .values({
        name,
        code,
        branch_id: branchId,
        location_type: locationType as any,
        is_active: true,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      })
      .returning(['id', 'name', 'code', 'branch_id', 'location_type'])
      .executeTakeFirstOrThrow();
    this.invalidateLocationsCache(scope.tenantId);
    await this.audit.log('إضافة مخزن', `تمت إضافة المخزن ${name} بواسطة ${actor.username}`, actor);
    return {
      ok: true,
      location: {
        id: String(inserted.id),
        name: inserted.name || '',
        code: inserted.code || '',
        branchId: inserted.branch_id ? String(inserted.branch_id) : '',
        locationType: inserted.location_type,
      },
      ...(await this.listLocations(actor)),
    };
  }

  async updateBranch(
    id: number,
    payload: {
      name?: string;
      code?: string;
      defaultStockLocationId?: string | number | null;
      salesStockMode?: 'single_location' | 'all_operational_locations';
      allowExternalSalesStock?: boolean;
    },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const branch = await this.db
      .selectFrom('branches')
      .select(['id', 'name', 'default_stock_location_id'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!branch) throw new AppError('Branch not found', 'BRANCH_NOT_FOUND', 404);
    const name = String(payload.name || '').trim();
    const code = String(payload.code || '').trim();
    if (!name) throw new AppError('Branch name is required', 'BRANCH_NAME_REQUIRED', 400);

    const duplicate = await this.db
      .selectFrom('branches')
      .select(['id'])
      .where(this.tenantPredicate(actor))
      .where(sql`lower(name)`, '=', name.toLowerCase())
      .where('id', '!=', id)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (duplicate) {
      throw new AppError(
        `يوجد فرع آخر مسجل بهذا الاسم بالفعل ("${name}"). يرجى اختيار اسم فرع مختلف.`,
        'DUPLICATE_BRANCH_NAME',
        400,
      );
    }

    const updates: any = { name, code };
    if (payload.defaultStockLocationId !== undefined)
      updates.default_stock_location_id = payload.defaultStockLocationId
        ? Number(payload.defaultStockLocationId)
        : null;
    if (payload.salesStockMode !== undefined) updates.sales_stock_mode = payload.salesStockMode;
    if (payload.allowExternalSalesStock !== undefined)
      updates.allow_external_sales_stock = payload.allowExternalSalesStock;

    try {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('branches')
          .set(updates)
          .where('id', '=', id)
          .where(this.tenantPredicate(actor))
          .execute();

        // Check if we need to auto-rename the default location
        if (branch.default_stock_location_id && name !== branch.name) {
          const defaultLocation = await trx
            .selectFrom('stock_locations')
            .select(['id', 'name', 'location_type'])
            .where('id', '=', branch.default_stock_location_id)
            .where(this.tenantPredicate(actor))
            .executeTakeFirst();
          if (defaultLocation) {
            const expectedNewName = formatBranchStockLocationName(name);
            await trx
              .updateTable('stock_locations')
              .set({ name: expectedNewName })
              .where('id', '=', defaultLocation.id)
              .where('tenant_id', '=', scope.tenantId)
              .execute();
          }
        }
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (
        err?.code === '23505' &&
        (err?.constraint?.includes('branches_tenant_name_uidx') ||
          err?.detail?.includes('already exists') ||
          err?.message?.includes('branches_tenant_name_uidx'))
      ) {
        throw new AppError(
          `يوجد فرع آخر مسجل بهذا الاسم بالفعل ("${name}"). يرجى اختيار اسم فرع مختلف.`,
          'DUPLICATE_BRANCH_NAME',
          400,
        );
      }
      throw err;
    }

    this.invalidateBranchesCache(scope.tenantId);
    this.invalidateLocationsCache(scope.tenantId);
    await this.audit.log('تعديل فرع', `تم تحديث الفرع #${id} بواسطة ${actor.username}`, actor);
    return { ok: true, branchId: String(id), ...(await this.listBranches(actor)) };
  }
}
