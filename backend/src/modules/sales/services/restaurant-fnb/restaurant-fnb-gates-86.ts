import { Database } from '../../../../database/database.types';
import { Kysely, type Transaction } from 'kysely';
import { AppError } from '../../../../common/errors/app-error';
import { TenantScope, Toggle86ItemDto } from './restaurant-fnb-types';

export class RestaurantFnbGates86Slice {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * INV-REST-FNB-CLAIMS-POST: the manager gate for the comp/tip endpoints.
   * The caller must BE a manager by the same definition the POS uses for
   * its manager tiles (isManager = admin role, or the pos_manager /
   * manage_restaurant permission). A PermissionsGuard decorator alone
   * cannot express this: the guard checks permission strings only, and
   * SUPER_ADMIN_PERMISSIONS does not contain pos_manager /
   * manage_restaurant, so a decorator would lock out tenant admins while
   * the UI still shows them as managers. The verified manager PIN (checked
   * separately via authorizeManagerSecret) is the approval second factor —
   * it proves a manager approved, it does not make the caller a manager.
   */
  assertManagerCaller(scope: TenantScope): void {
    const role = String(scope.role || '');
    const permissions = scope.permissions ?? [];
    const isManager =
      role === 'admin' ||
      role === 'super_admin' ||
      permissions.includes('pos_manager') ||
      permissions.includes('manage_restaurant');
    if (!isManager) {
      throw new AppError('هذا الإجراء يتطلب صلاحية مدير', 'MANAGER_PERMISSION_REQUIRED', 403);
    }
  }

  /**
   * INV-REST-FNB-CLAIMS-POST: resolve an accounting account the way
   * postSale does — the tenant's configured account when it exists and is
   * active, otherwise the canonical account code. Mirrors
   * AccountingPostingService.resolveAccountWithFallback, which is private.
   */
  async resolveCompAccount(
    queryable: Kysely<Database> | Transaction<Database>,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ): Promise<number> {
    if (configuredId && Number(configuredId) > 0) {
      const configured = await queryable
        .selectFrom('accounting_accounts')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(configuredId))
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (configured) return Number(configured.id);
    }
    const fallback = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', fallbackCode)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (fallback) return Number(fallback.id);
    throw new AppError(
      `حساب الضيافة (${fallbackCode}) غير موجود أو غير مفعّل لهذا المستأجر`,
      'COMP_ACCOUNT_NOT_FOUND',
      409,
    );
  }

  // ==========================================
  // 1. FAST 86 ENGINE (OUT-OF-STOCK TOGGLE)
  // ==========================================

  async get86Items(scope: TenantScope, branchId?: number | null) {
    let query = this.db
      .selectFrom('restaurant_86_items')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('is_86ed', '=', true);

    if (branchId) {
      query = query.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    }

    const items = await query.orderBy('updated_at', 'desc').execute();
    return items;
  }

  async toggle86Item(scope: TenantScope, dto: Toggle86ItemDto) {
    if (!dto.productId) {
      throw new AppError('معرف المنتج مطلوب لتحديث حالة الاستبعاد', 'INVALID_PRODUCT_ID', 400);
    }

    const existing = await this.db
      .selectFrom('restaurant_86_items')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('product_id', '=', dto.productId)
      .executeTakeFirst();

    const autoRestoreAt =
      dto.autoRestoreHours && dto.autoRestoreHours > 0
        ? new Date(Date.now() + dto.autoRestoreHours * 3600 * 1000)
        : null;

    if (existing) {
      await this.db
        .updateTable('restaurant_86_items')
        .set({
          is_86ed: dto.is86ed,
          reason: dto.reason || (dto.is86ed ? 'نفاد الكمية' : null),
          auto_restore_at: autoRestoreAt,
          updated_at: new Date(),
        })
        .where('id', '=', existing.id)
        .execute();

      return {
        success: true,
        productId: dto.productId,
        is86ed: dto.is86ed,
        message: dto.is86ed
          ? `تم استبعاد الصنف [${dto.productName || existing.product_name}] ووسمه بـ 86 بنجاح`
          : `تمت إعادة إتاحة الصنف [${dto.productName || existing.product_name}] للبيع بنجاح`,
      };
    } else {
      await this.db
        .insertInto('restaurant_86_items')
        .values({
          tenant_id: scope.tenantId,
          branch_id: scope.branchId || null,
          product_id: dto.productId,
          product_name: dto.productName || `صنف #${dto.productId}`,
          component_product_id: dto.componentProductId || null,
          is_86ed: dto.is86ed,
          reason: dto.reason || 'نفاد الكمية',
          auto_restore_at: autoRestoreAt,
          created_by: scope.userId || null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();

      return {
        success: true,
        productId: dto.productId,
        is86ed: dto.is86ed,
        message: `تم استبعاد الصنف ووسمه بـ 86 فورياً`,
      };
    }
  }
}
