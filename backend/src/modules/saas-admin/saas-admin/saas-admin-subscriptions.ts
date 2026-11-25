import type { Kysely, Selectable } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { type AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import type { AuthCacheService } from '../../../core/auth/services/auth-cache.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { checkClientBusinessDay, CLIENT_BUSINESS_DATE_PAST_DAYS } from '../../../common/utils/client-date-bounds.util';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { RecordPaymentDto, RenewTenantDto } from '../dto/saas-admin.dto';

export type SaasAdminSubscriptionsBoundDeps = {
  assertPlatformAccess(auth: AuthContext): void;
  getTenantForMutation(id: string): Promise<Selectable<Database['tenants']>>;
  assertNotPlatformTenantTarget(targetTenantId: string): void;
};

export class SaasAdminSubscriptions {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
    private readonly bound: SaasAdminSubscriptionsBoundDeps,
  ) {}

  private assertPlatformAccess(auth: AuthContext): void {
    return this.bound.assertPlatformAccess(auth);
  }

  private async getTenantForMutation(id: string): Promise<Selectable<Database['tenants']>> {
    return this.bound.getTenantForMutation(id);
  }

  private assertNotPlatformTenantTarget(targetTenantId: string): void {
    return this.bound.assertNotPlatformTenantTarget(targetTenantId);
  }

  async getSubscriptions(tenantId: string, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(tenantId);

    const subscriptions = await this.db.selectFrom('tenant_subscriptions as s')
      .leftJoin('saas_plans as p', 'p.id', 's.plan_id')
      .select([
        's.id', 's.status', 's.starts_at', 's.ends_at', 's.grace_ends_at', 's.auto_renew',
        'p.name as plan_name', 'p.code as plan_code', 'p.price as plan_price', 'p.billing_period_months'
      ])
      .where('s.tenant_id', '=', tenant.id)
      .orderBy('s.created_at', 'desc')
      .execute();

    const payments = await this.db.selectFrom('tenant_subscription_payments')
      .selectAll()
      .where('tenant_id', '=', tenant.id)
      .orderBy('paid_at', 'desc')
      .execute();

    return { subscriptions, payments };
  }

  async recordPayment(id: string, body: RecordPaymentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(id);
    this.assertNotPlatformTenantTarget(tenant.id);

    const activeSub = await this.db.selectFrom('tenant_subscriptions').selectAll()
      .where('tenant_id', '=', tenant.id)
      .where('status', 'in', ['active', 'past_due'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    if (!activeSub) throw new BadRequestException('لا يوجد اشتراك نشط لتسجيل الدفعة عليه.');

    const now = new Date();
    // P9 (RC-11): paid_at was stamped verbatim from the caller-supplied
    // `date` string — an unvalidated, unparse-checked client date (a
    // payment dated 2020 or 2030 posted as-is). A payment date is
    // past-by-nature, so it lives in the P6 window [today-7d, today]
    // in the TENANT day, like the expense channel. Without a supplied
    // date the server instant stands.
    let paidAt = now;
    if (body.date) {
      const tenantTz = await getTenantTimezone(this.db, tenant.id);
      const checked = checkClientBusinessDay(body.date, tenantTz, {
        minDayOffset: -CLIENT_BUSINESS_DATE_PAST_DAYS,
        maxDayOffset: 0,
      });
      if (!checked.ok) throw new BadRequestException('تاريخ الدفعة غير صالح أو خارج النطاق المسموح (آخر 7 أيام حتى اليوم).');
      paidAt = checked.date;
    }
    await this.db.insertInto('tenant_subscription_payments').values({
      tenant_id: tenant.id,
      subscription_id: activeSub.id,
      amount: body.amount,
      currency: body.currency,
      method: body.method || 'manual',
      reference: body.reference || null,
      paid_at: paidAt,
      created_at: now,
    } as any).execute();

    await this.audit.log('تسجيل دفعة', `تم تسجيل دفعة بقيمة ${body.amount} ${body.currency} لاشتراك النسخة: ${tenant.slug}`, auth, {
      targetTenantId: tenant.id,
      eventCode: AUDIT_EVENT_CODES.SAAS_PAYMENT_RECORDED,
    });
    return { ok: true };
  }

  async renewTenant(id: string, body: RenewTenantDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(id);
    this.assertNotPlatformTenantTarget(tenant.id);

    const plan = await this.db.selectFrom('saas_plans').selectAll().where('id', '=', body.planId).executeTakeFirst();
    if (!plan) throw new NotFoundException('خطة الاشتراك غير موجودة');

    const now = new Date();

    const activeSub = await this.db.selectFrom('tenant_subscriptions').selectAll()
      .where('tenant_id', '=', tenant.id)
      .where('status', 'in', ['active', 'past_due', 'expired'])
      .orderBy('ends_at', 'desc')
      .executeTakeFirst();

    let newStart = now;
    if (activeSub && activeSub.status !== 'expired' && activeSub.ends_at && new Date(activeSub.ends_at) > now) {
      newStart = new Date(activeSub.ends_at);
    }

    const newEnd = new Date(newStart);
    newEnd.setMonth(newEnd.getMonth() + body.durationMonths);

    await this.db.transaction().execute(async (trx) => {
      if (activeSub) {
        await trx.updateTable('tenant_subscriptions').set({ status: 'expired', updated_at: now }).where('id', '=', activeSub.id).execute();
      }

      const newSub = await trx.insertInto('tenant_subscriptions').values({
        tenant_id: tenant.id,
        plan_id: plan.id,
        status: 'active',
        starts_at: newStart,
        ends_at: newEnd,
        grace_ends_at: null,
        auto_renew: false,
        created_at: now,
        updated_at: now,
      } as any).returning('id').executeTakeFirstOrThrow();

      if (body.paymentAmount) {
        await trx.insertInto('tenant_subscription_payments').values({
          tenant_id: tenant.id,
          subscription_id: newSub.id,
          amount: body.paymentAmount,
          currency: plan.currency,
          method: body.paymentMethod || 'manual',
          reference: body.paymentReference || null,
          paid_at: now,
          created_at: now,
        } as any).execute();
      }

      const tenantUpdateData: any = { status: 'active', updated_at: now };
      if (plan.feature_plan_id) {
        tenantUpdateData.plan_id = plan.feature_plan_id;
      }

      await trx.updateTable('tenants').set(tenantUpdateData).where('id', '=', tenant.id).execute();
    });

    // Renewal flips tenants.status to 'active' and may change plan_id. Every sibling
    // mutation invalidates here; this one did not, so a customer whose expiry had already
    // been cached as 'not allowed' stayed locked out until the entry aged out.
    this.authCache.invalidateTenant(tenant.id);

    await this.audit.log('تجديد اشتراك', `تم تجديد اشتراك النسخة: ${tenant.slug} لمدة ${body.durationMonths} أشهر`, auth, {
      targetTenantId: tenant.id,
      eventCode: AUDIT_EVENT_CODES.SAAS_SUBSCRIPTION_RENEWED,
    });
    return { ok: true };
  }
}
