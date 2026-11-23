import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { isPlatformTenantId } from '../../../../core/auth/utils/tenant-boundary';
import { executeWipeTables } from '../settings-demo-data-wipe-tables';
import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../../../core/audit/audit.service';
import type { SeedDemoDataDto, DemoCredential } from './settings-demo-data-shared';

export class SettingsDemoDataTenant {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly bound: {
      assertSuperAdminAndPassword: (password: string, actor: AuthContext) => Promise<void>;
      takeAutoBackup: (actor: AuthContext, reason: string) => Promise<void>;
      seedComprehensiveDemoData: (dtoOrPassword: string | SeedDemoDataDto, actor: AuthContext) => Promise<{ ok: boolean; message: string; activity?: string; productsCount?: number; salesCount?: number; onlineOrdersCount?: number; demoCredentials?: DemoCredential[] }>;
    },
  ) {}

  private async assertSuperAdminAndPassword(password: string, actor: AuthContext): Promise<void> {
    return this.bound.assertSuperAdminAndPassword(password, actor);
  }

  private async takeAutoBackup(actor: AuthContext, reason: string): Promise<void> {
    return this.bound.takeAutoBackup(actor, reason);
  }

  private async seedComprehensiveDemoData(dtoOrPassword: string | SeedDemoDataDto, actor: AuthContext): Promise<{ ok: boolean; message: string; activity?: string; productsCount?: number; salesCount?: number; onlineOrdersCount?: number; demoCredentials?: DemoCredential[] }> {
    return this.bound.seedComprehensiveDemoData(dtoOrPassword, actor);
  }

  async wipeTenantData(
    tenantId: string,
    password: string,
    platformActor: AuthContext,
    skipPasswordCheck = false,
  ): Promise<{ ok: boolean; message: string }> {
    if (platformActor.role !== 'super_admin') {
      throw new AppError('فقط السوبر أدمن هو المخول بتنفيذ هذه العملية', 'SUPER_ADMIN_REQUIRED', 403);
    }

    if (isPlatformTenantId(tenantId)) {
      throw new AppError('لا يمكن تصفير بيانات المنصة المركزية', 'CANNOT_WIPE_PLATFORM_TENANT', 400);
    }

    if (!skipPasswordCheck) {
      await this.assertSuperAdminAndPassword(password, platformActor);
    }

    const primaryUser = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'account_id'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .orderBy('created_at', 'asc')
      .executeTakeFirst();

    const targetAccountId = primaryUser?.account_id || `${tenantId}:main`;

    const targetActor: AuthContext = {
      ...platformActor,
      tenantId: tenantId,
      accountId: targetAccountId,
    };

    await this.takeAutoBackup(targetActor, 'before_tenant_wipe');

    const preservedUserId = primaryUser?.id || targetActor.userId;

    await this.db.transaction().execute(async (trx) => {
      await executeWipeTables(trx, tenantId, preservedUserId);
    });

    await this.audit.log(
      'تصفير بيانات مشترك',
      `تم تصفير ومسح كافة بيانات المشترك (${tenantId}) وإعادتها بيضاء بواسطة ${platformActor.username}`,
      platformActor,
      { targetTenantId: tenantId },
    ).catch(() => undefined);

    return {
      ok: true,
      message: 'تم تصفير كافة بيانات النسخة بنجاح وإعادتها فارغة وجاهزة للبدء الفعلي.',
    };
  }

  async seedTenantDemoData(
    tenantId: string,
    options: { activityType?: string; wipeExisting?: boolean; seedSales?: boolean; seedOnlineOrders?: boolean },
    platformActor: AuthContext,
  ): Promise<{ ok: boolean; message: string; activity?: string; productsCount?: number; salesCount?: number; onlineOrdersCount?: number; demoCredentials?: DemoCredential[] }> {
    if (platformActor.role !== 'super_admin') {
      throw new AppError('فقط السوبر أدمن هو المخول بتنفيذ هذه العملية', 'SUPER_ADMIN_REQUIRED', 403);
    }

    const primaryUser = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'account_id'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .orderBy('created_at', 'asc')
      .executeTakeFirst();

    const targetAccountId = primaryUser?.account_id || `${tenantId}:main`;

    const targetActor: AuthContext = {
      ...platformActor,
      tenantId: tenantId,
      accountId: targetAccountId,
      role: 'super_admin',
    };

    if (options.wipeExisting) {
      await this.wipeTenantData(tenantId, '', platformActor, true);
    }

    return this.seedComprehensiveDemoData({
      activityType: options.activityType || 'supermarket',
      wipeExisting: false,
      seedSales: options.seedSales ?? true,
      seedOnlineOrders: options.seedOnlineOrders ?? true,
    }, targetActor);
  }
}
