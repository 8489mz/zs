/*
 * UsersPlanLimitService — slice S1 of the users.service.ts partial split
 * (INV-USERS-SERVICE-PARTIAL-SPLIT).
 *
 * Pure move of getPlanLimitForTenant from UsersService (1068 lines, over
 * the 1000-line file-size cap after the Item 4 invalidation line landed).
 * The method is one coherent domain: plan/subscription user-limit
 * resolution — it reads the tenant, the active subscription joined to
 * saas_plans, and the plan resolved from tenants.plan_id, auto-heals a
 * subscription stuck on a stale plan, and resolves the limit through the
 * user-plan-limit engine (resolveUserLimit). No behaviour change: the body
 * is byte-identical, the facade keeps a thin delegate with the ORIGINAL
 * signature (specs stub it on the service instance), and the internal
 * callers (listUsers, executeUserCreate) keep calling
 * this.getPlanLimitForTenant unchanged.
 *
 * Deps are db only — the method never touches tx, audit, authCache, or
 * any facade private helper. The slice declares its own Logger (the
 * facade keeps its own logger field; it becomes unused only after ALL
 * slices land — merge-owned prune decision, same as the maritime split).
 * No clock sites moved in (one `new Date()` for the auto-heal
 * updated_at stamp travels with the method) and no guard sites
 * (no toFixed / Math.round / roundMoney in the moved text).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { isPlatformTenantId } from '../../core/auth/utils/tenant-boundary';
import { resolveUserLimit } from './engines/user-plan-limit.engine';

export interface UsersPlanLimitDeps {
  db: Kysely<Database>;
}

@Injectable()
export class UsersPlanLimitService {
  private readonly logger = new Logger(UsersPlanLimitService.name);
  private readonly db: Kysely<Database>;

  constructor(deps: UsersPlanLimitDeps) {
    this.db = deps.db;
  }

  async getPlanLimitForTenant(
    tenantId: string,
    actor: AuthContext,
    activeUsersCount: number,
  ): Promise<{
    maxUsers: number | null;
    isUnlimited: boolean;
    isLimitReached: boolean;
    activeUsersCount: number;
    planName: string;
    planCode: string | null;
  }> {
    const isPlatformTenant = isPlatformTenantId(tenantId);
    const isPlatformAdmin = actor.role === 'super_admin' && isPlatformTenant;

    if (isPlatformAdmin) {
      return {
        maxUsers: null,
        isUnlimited: true,
        isLimitReached: false,
        activeUsersCount,
        planName: 'مالك المنظومة (غير مقيد)',
        planCode: 'PLATFORM',
      };
    }

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['id', 'plan_id', 'status'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    // 1. فحص الاشتراك النشط من tenant_subscriptions مربوطاً بـ saas_plans
    let activeSub: any;
    try {
      activeSub = await this.db
        .selectFrom('tenant_subscriptions as s')
        .leftJoin('saas_plans as p', 'p.id', 's.plan_id')
        .select([
          's.id as subscription_id',
          's.plan_id as sub_plan_id',
          'p.id as saas_plan_id',
          'p.max_users',
          'p.code as plan_code',
          'p.name as plan_name',
          'p.feature_plan_id',
        ])
        .where('s.tenant_id', '=', tenantId)
        .where('s.status', 'in', ['active', 'past_due'])
        .orderBy('s.created_at', 'desc')
        .executeTakeFirst();
    } catch {
      activeSub = undefined;
    }

    // 2. قراءة الباقة من saas_plans بالربط: tenants.plan_id ⇄ saas_plans.code أو feature_plan_id
    let planFromDb:
      { id: number; max_users: number | null; code: string; name: string; feature_plan_id: string | null } | undefined;
    if (tenant?.plan_id) {
      const cleanPlan = tenant.plan_id.trim();
      const codeUpper = cleanPlan.replace(/^plan_/, '').toUpperCase();
      try {
        planFromDb = await this.db
          .selectFrom('saas_plans')
          .select(['id', 'max_users', 'code', 'name', 'feature_plan_id'])
          .where((eb) =>
            eb.or([
              eb('feature_plan_id', '=', cleanPlan),
              eb('code', '=', codeUpper),
              eb(sql<string>`LOWER(code)`, '=', cleanPlan.toLowerCase()),
            ]),
          )
          .where('is_active', '=', true)
          .executeTakeFirst();
      } catch {
        planFromDb = undefined;
      }
    }

    // مزامنة علاجية تلقائية إذا كان الاشتراك معلقاً على باقة قديمة تختلف عن باقة المنشأة الحالية
    if (activeSub && planFromDb && activeSub.sub_plan_id !== planFromDb.id) {
      try {
        await this.db
          .updateTable('tenant_subscriptions')
          .set({
            plan_id: planFromDb.id,
            updated_at: new Date(),
          })
          .where('id', '=', activeSub.subscription_id)
          .execute();

        activeSub.max_users = planFromDb.max_users;
        activeSub.plan_code = planFromDb.code;
        activeSub.plan_name = planFromDb.name;
        activeSub.feature_plan_id = planFromDb.feature_plan_id;
        activeSub.sub_plan_id = planFromDb.id;
      } catch (err) {
        this.logger.warn(`Failed to auto-heal tenant subscription for ${tenantId}: ${err}`);
      }
    }

    const limit = resolveUserLimit({
      hasActiveSubscription: Boolean(activeSub),
      subscriptionMaxUsers: activeSub?.max_users,
      subscriptionPlanCode: activeSub?.plan_code,
      subscriptionFeaturePlanId: activeSub?.feature_plan_id,
      planFoundInDb: Boolean(planFromDb),
      planFromDbMaxUsers: planFromDb?.max_users,
      tenantPlanId: tenant?.plan_id,
      isTrial: tenant?.status === 'trial',
    });

    const isUnlimited = limit === null;
    const isLimitReached = !isUnlimited && activeUsersCount >= limit;
    const planName =
      planFromDb?.name || activeSub?.plan_name || (tenant?.status === 'trial' ? 'فترة تجريبية' : 'الافتراضية');
    const planCode = planFromDb?.code || activeSub?.plan_code || null;

    return {
      maxUsers: limit,
      isUnlimited,
      isLimitReached,
      activeUsersCount,
      planName,
      planCode,
    };
  }
}
