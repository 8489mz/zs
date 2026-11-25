import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuditService } from '../../../core/audit/audit.service';
import { NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { CreateSaasPlanDto, UpdateSaasPlanDto } from '../dto/saas-admin.dto';

export class SaasAdminPlans {
  private plansCache: { data: Record<string, unknown>[]; expiresAt: number } | null = null;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly CACHE_TTL_MS: number,
    private readonly bound: {
      assertPlatformAccess: (auth: AuthContext) => void;
      developerListFeaturePlans: () => Promise<Record<string, unknown>[]>;
    },
  ) {}

  private assertPlatformAccess(auth: AuthContext): void {
    return this.bound.assertPlatformAccess(auth);
  }

  private developerListFeaturePlans(): Promise<Record<string, unknown>[]> {
    return this.bound.developerListFeaturePlans();
  }

  async listPlans(auth: AuthContext): Promise<Record<string, unknown>[]> {
    this.assertPlatformAccess(auth);
    const now = Date.now();
    if (this.plansCache && this.plansCache.expiresAt > now) {
      return this.plansCache.data;
    }
    const plans = await this.db.selectFrom('saas_plans').selectAll().orderBy('price', 'asc').execute();
    this.plansCache = { data: plans, expiresAt: now + this.CACHE_TTL_MS };
    return plans;
  }

  async listFeaturePlans(auth: AuthContext): Promise<Record<string, unknown>[]> {
    this.assertPlatformAccess(auth);
    return this.developerListFeaturePlans();
  }

  async createPlan(body: CreateSaasPlanDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    this.plansCache = null;
    const result = await this.db
      .insertInto('saas_plans')
      .values({
        code: body.code,
        name: body.name,
        price: body.price,
        currency: body.currency || 'EGP',
        billing_period_months: body.billingPeriodMonths,
        max_users: body.maxUsers ?? null,
        max_branches: body.maxBranches ?? null,
        feature_plan_id: body.featurePlanId || null,
        is_active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.log('إنشاء خطة اشتراك', `تم إنشاء خطة اشتراك: ${body.name}`, auth);
    return result;
  }

  async updatePlan(id: number, body: UpdateSaasPlanDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    this.plansCache = null;

    const updateData: any = {};
    if (body.code !== undefined) updateData.code = body.code;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.price !== undefined) updateData.price = body.price;
    if (body.currency !== undefined) updateData.currency = body.currency;
    if (body.billingPeriodMonths !== undefined) updateData.billing_period_months = body.billingPeriodMonths;
    if (body.maxUsers !== undefined) updateData.max_users = body.maxUsers ?? null;
    if (body.maxBranches !== undefined) updateData.max_branches = body.maxBranches ?? null;
    if (body.featurePlanId !== undefined) updateData.feature_plan_id = body.featurePlanId || null;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;

    if (Object.keys(updateData).length === 0) {
      return { ok: true };
    }

    const result = await this.db
      .updateTable('saas_plans')
      .set(updateData)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!result) {
      throw new NotFoundException('الخطة غير موجودة');
    }

    await this.audit.log('تعديل خطة اشتراك', `تم تعديل خطة اشتراك: ${result.name}`, auth);
    return result;
  }
}
