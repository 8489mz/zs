import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthCacheService } from '../../../core/auth/services/auth-cache.service';
import { XPayGatewayService } from './xpay.gateway';
import { PaymobGatewayService } from './paymob.gateway';
import { StripeGatewayService } from './stripe.gateway';
import { PaymentInitiateInput, PaymentInitiateResult, WebhookValidationResult } from './payment-gateway.interface';
import { decideSubscriptionGrant } from './subscription-grant.engine';
import { assertSubscriptionSandboxAllowed } from './subscription-sandbox-policy';

@Injectable()
export class PaymentManagerService {
  private readonly logger = new Logger(PaymentManagerService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
    private readonly xpay: XPayGatewayService,
    private readonly paymob: PaymobGatewayService,
    private readonly stripe: StripeGatewayService,
  ) {}

  getGateway(gatewayName?: string) {
    const name = String(gatewayName || 'xpay').toLowerCase();
    if (name === 'paymob') return this.paymob;
    if (name === 'stripe') return this.stripe;
    return this.xpay;
  }

  async initiatePayment(gatewayName: string, input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
    const gateway = this.getGateway(gatewayName);
    return gateway.initiatePayment(input);
  }

  async processWebhook(
    gatewayName: string,
    headers: Record<string, any>,
    body: any,
    rawBody?: Buffer,
  ): Promise<Record<string, unknown>> {
    const gateway = this.getGateway(gatewayName);
    const result: WebhookValidationResult = await gateway.verifyAndParseWebhook(headers, body, rawBody);

    if (!result.isValid) {
      this.logger.warn(`Invalid webhook signature from ${gatewayName}`);
      return { ok: false, message: 'Invalid signature' };
    }

    if (!result.isSuccessful) {
      this.logger.log(
        `Webhook received from ${gatewayName} with non-successful status: ${result.transactionReference}`,
      );
      return { ok: true, status: 'ignored_unsuccessful' };
    }

    if (!result.tenantId) {
      this.logger.warn(`Webhook from ${gatewayName} missing tenantId (reference: ${result.transactionReference})`);
      return { ok: true, status: 'missing_tenant' };
    }

    // A successful payment we cannot name cannot be de-duplicated, and every gateway
    // retries. Granting billing period for an unnamed payment is how a single captured
    // webhook turns into unlimited subscription time (F4) — refuse instead.
    if (!String(result.transactionReference || '').trim()) {
      this.logger.error(
        `Webhook from ${gatewayName} reported a successful payment with no transaction reference; refusing to grant a subscription period.`,
      );
      return { ok: false, message: 'Missing transaction reference' };
    }

    const tenant = await this.db.selectFrom('tenants').selectAll().where('id', '=', result.tenantId).executeTakeFirst();
    if (!tenant) {
      this.logger.warn(`Tenant not found for webhook: ${result.tenantId}`);
      return { ok: false, message: 'Tenant not found' };
    }

    // Resolve plan
    let plan = result.planId
      ? await this.db.selectFrom('saas_plans').selectAll().where('id', '=', result.planId).executeTakeFirst()
      : null;

    if (!plan) {
      plan = await this.db
        .selectFrom('saas_plans')
        .selectAll()
        .where('is_active', '=', true)
        .orderBy('price', 'asc')
        .executeTakeFirst();
    }

    if (!plan) {
      this.logger.error(`No SaaS plan found to assign for tenant ${tenant.slug}`);
      return { ok: false, message: 'No active plan' };
    }

    const durationMonths = result.durationMonths || plan.billing_period_months || 12;
    return this.applySubscriptionPayment(
      tenant,
      plan,
      durationMonths,
      result.amount || plan.price,
      result.currency || plan.currency,
      gatewayName,
      result.transactionReference,
    );
  }

  private async applySubscriptionPayment(
    tenant: any,
    plan: any,
    durationMonths: number,
    amount: number,
    currency: string,
    gatewayName: string,
    transactionReference: string,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const reference = String(transactionReference || '').trim();
    if (!reference) {
      throw new BadRequestException('لا يمكن ترحيل دفعة اشتراك بلا مرجع معاملة.');
    }

    let alreadyApplied = false;
    let newEnd = now;

    await this.db.transaction().execute(async (trx) => {
      // Serialise concurrent grants for this tenant. The period to add is derived from the
      // current subscription, so reading it outside the transaction (as this used to) lets
      // two gateway retries read the same base and each extend from it (F1/F2).
      await trx.selectFrom('tenants').select('id').where('id', '=', tenant.id).forUpdate().executeTakeFirst();

      // Idempotency gate. Every gateway retries, and XPay/Paymob signatures are a plain
      // HMAC over the body with no nonce, so a captured payload stays valid forever:
      // without this check each replay granted another billing period.
      const existingPayment = await trx
        .selectFrom('tenant_subscription_payments')
        .select('id')
        .where('tenant_id', '=', tenant.id)
        .where('reference', '=', reference)
        .executeTakeFirst();

      if (existingPayment) {
        alreadyApplied = true;
        return;
      }

      const activeSub = await trx
        .selectFrom('tenant_subscriptions')
        .selectAll()
        .where('tenant_id', '=', tenant.id)
        .where('status', 'in', ['active', 'past_due', 'expired'])
        .orderBy('ends_at', 'desc')
        .executeTakeFirst();

      const decision = decideSubscriptionGrant({
        transactionReference: reference,
        alreadyRecorded: false,
        currentPeriodEndsAt: activeSub?.ends_at ?? null,
        currentPeriodIsLive: Boolean(activeSub && activeSub.status !== 'expired'),
        durationMonths,
        now,
      });

      // `reference` and `alreadyRecorded` were settled above, so only 'grant' can reach here.
      if (decision.action !== 'grant') return;

      const newStart = decision.startsAt;
      newEnd = decision.endsAt;

      if (activeSub) {
        await trx
          .updateTable('tenant_subscriptions')
          .set({ status: 'expired', updated_at: now })
          .where('id', '=', activeSub.id)
          .where('tenant_id', '=', tenant.id)
          .execute();
      }

      const newSub = await trx
        .insertInto('tenant_subscriptions')
        .values({
          tenant_id: tenant.id,
          plan_id: plan.id,
          status: 'active',
          starts_at: newStart,
          ends_at: newEnd,
          grace_ends_at: null,
          auto_renew: true,
          created_at: now,
          updated_at: now,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('tenant_subscription_payments')
        .values({
          tenant_id: tenant.id,
          subscription_id: newSub.id,
          amount,
          currency,
          method: `${gatewayName}_online`,
          reference,
          paid_at: now,
          created_at: now,
        } as any)
        .execute();

      const tenantUpdateData: any = { status: 'active', updated_at: now };
      if (plan.feature_plan_id) {
        tenantUpdateData.plan_id = plan.feature_plan_id;
      }

      await trx.updateTable('tenants').set(tenantUpdateData).where('id', '=', tenant.id).execute();
    });

    // The grant just flipped tenants.status to 'active' and may have changed plan_id.
    // assertTenantLoginAllowed caches the previous 'not allowed' verdict, so without this
    // the customer who just paid keeps being refused until the cache entry ages out.
    this.authCache.invalidateTenant(tenant.id);

    if (alreadyApplied) {
      this.logger.log(
        `Duplicate ${gatewayName} webhook for reference ${reference} (tenant ${tenant.slug}) ignored; subscription already granted.`,
      );
      return {
        ok: true,
        renewed: false,
        duplicate: true,
        tenant: tenant.slug,
        transactionReference: reference,
      };
    }

    // `created_by` is BIGINT REFERENCES users(id): there is no user behind a gateway
    // callback, so it must be null. It used to carry the string 'system-gateway', which
    // made this insert throw AFTER the subscription had been committed — the handler
    // returned 500, the gateway retried, and the retry granted another period.
    const systemActor: any = {
      userId: null,
      username: `${gatewayName}-checkout`,
      role: 'super_admin',
      tenantId: tenant.id,
      accountId: `${tenant.id}:main`,
      permissions: ['*'],
    };

    await this.audit.log(
      'تجديد آلي للباقة (بوابة دفع)',
      `تم تجديد وتفعيل باقة (${plan.name}) للنسخة ${tenant.slug} تلقائياً عبر بوابة ${gatewayName.toUpperCase()} بقيمة ${amount} ${currency} (مرجع: ${reference})`,
      systemActor,
      { targetTenantId: tenant.id },
    );

    this.logger.log(`Tenant ${tenant.slug} successfully auto-renewed via ${gatewayName}!`);

    return {
      ok: true,
      renewed: true,
      tenant: tenant.slug,
      plan: plan.name,
      endsAt: newEnd.toISOString(),
      transactionReference: reference,
    };
  }

  async processDirectPayment(params: {
    gatewayName: string;
    tenantId: string;
    planId?: number;
    durationMonths?: number;
    amount: number;
    currency: string;
    transactionReference: string;
  }): Promise<Record<string, unknown>> {
    // Defense-in-depth: never rely only on the HTTP controller for billing grants.
    assertSubscriptionSandboxAllowed();
    const tenant = await this.db.selectFrom('tenants').selectAll().where('id', '=', params.tenantId).executeTakeFirst();
    if (!tenant) throw new NotFoundException('المنشأة غير موجودة.');

    let plan = params.planId
      ? await this.db.selectFrom('saas_plans').selectAll().where('id', '=', params.planId).executeTakeFirst()
      : null;

    if (!plan) {
      plan = await this.db
        .selectFrom('saas_plans')
        .selectAll()
        .where('is_active', '=', true)
        .orderBy('price', 'asc')
        .executeTakeFirst();
    }

    if (!plan) throw new NotFoundException('لا توجد خطة مفعلة.');

    const durationMonths = params.durationMonths || plan.billing_period_months || 12;
    const amount = params.amount || plan.price;
    const currency = params.currency || plan.currency || 'EGP';

    return this.applySubscriptionPayment(
      tenant,
      plan,
      durationMonths,
      amount,
      currency,
      params.gatewayName,
      params.transactionReference,
    );
  }
}
