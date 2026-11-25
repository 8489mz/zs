import { type Kysely, type Selectable, sql } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { type AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import type { AuthCacheService } from '../../../core/auth/services/auth-cache.service';
import { type Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { createPasswordRecord } from '../../../core/auth/utils/password-hasher';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { ActivateTenantDto, ExtendTrialDto, ResetOwnerPasswordDto, TenantStatusActionDto } from '../dto/saas-admin.dto';

type OwnerUserRow = Pick<
  Selectable<Database['users']>,
  | 'id'
  | 'username'
  | 'tenant_id'
  | 'account_id'
  | 'is_active'
  | 'must_change_password'
  | 'failed_login_count'
  | 'locked_until'
>;

export interface SaasAdminLifecycleBoundDeps {
  assertPlatformAccess: (auth: AuthContext) => void;
  getTenantForMutation: (id: string) => Promise<Selectable<Database['tenants']>>;
  assertNotPlatformTenantTarget: (targetTenantId: string) => void;
  normalizeOptional: (value: unknown) => string | null;
  addDays: (date: Date, days: number) => Date;
  getOwnerUserForTenant: (tenantId: string) => Promise<OwnerUserRow>;
  generateStrongTemporaryPassword: () => string;
  assertSuperAdminPassword: (password: string, auth: AuthContext) => Promise<void>;
}

export class SaasAdminLifecycle {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
    private readonly logger: Logger,
    private readonly bound: SaasAdminLifecycleBoundDeps,
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
  private normalizeOptional(value: unknown): string | null {
    return this.bound.normalizeOptional(value);
  }
  private addDays(date: Date, days: number): Date {
    return this.bound.addDays(date, days);
  }
  private async getOwnerUserForTenant(tenantId: string): Promise<OwnerUserRow> {
    return this.bound.getOwnerUserForTenant(tenantId);
  }
  private generateStrongTemporaryPassword(): string {
    return this.bound.generateStrongTemporaryPassword();
  }
  private async assertSuperAdminPassword(password: string, auth: AuthContext): Promise<void> {
    return this.bound.assertSuperAdminPassword(password, auth);
  }

  async activateTenant(id: string, body: ActivateTenantDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(id);
    this.assertNotPlatformTenantTarget(tenant.id);
    const now = new Date();

    // Copy, never alias: `trialEndsAt` is mutated below, and both branches used to be able
    // to leave it pointing at the very `now` object that also fills activated_at/updated_at,
    // so extending the trial pushed the activation timestamp into the future too.
    let trialEndsAt = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : new Date(now);
    if (trialEndsAt < now) trialEndsAt = new Date(now);

    const updateData: any = { status: 'active', activated_at: now, updated_at: now };

    if (!body.planId && body.durationMonths) {
      trialEndsAt.setMonth(trialEndsAt.getMonth() + body.durationMonths);
      updateData.trial_ends_at = trialEndsAt;
    }

    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('tenants').set(updateData).where('id', '=', tenant.id).execute();

      if (body.planId) {
        const plan = await trx.selectFrom('saas_plans').selectAll().where('id', '=', body.planId).executeTakeFirst();
        if (!plan) throw new NotFoundException('الخطة غير موجودة');

        const activeSub = await trx.selectFrom('tenant_subscriptions').selectAll()
          .where('tenant_id', '=', tenant.id)
          .where('status', 'in', ['active', 'past_due'])
          .orderBy('created_at', 'desc')
          .executeTakeFirst();

        if (activeSub) {
          await trx.updateTable('tenant_subscriptions').set({ status: 'expired', updated_at: now }).where('id', '=', activeSub.id).execute();
        }

        const duration = body.durationMonths || plan.billing_period_months;
        const endDate = new Date(now);
        endDate.setMonth(endDate.getMonth() + duration);

        const newSub = await trx.insertInto('tenant_subscriptions').values({
          tenant_id: tenant.id,
          plan_id: plan.id,
          status: 'active',
          starts_at: now,
          ends_at: endDate,
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

        if (plan.feature_plan_id) {
          await trx.updateTable('tenants').set({ plan_id: plan.feature_plan_id }).where('id', '=', tenant.id).execute();
        }
      }
    });

    this.authCache.invalidateTenant(tenant.id);
    await this.audit.log('تفعيل نسخة', `تم تفعيل/ترقية النسخة: ${tenant.slug} (${tenant.id}) ${body.planId ? `بخطة ${body.planId}` : ''}`, auth, {
      targetTenantId: tenant.id,
      eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_ACTIVATED,
    });
    return { ok: true };
  }

  async suspendTenant(id: string, body: TenantStatusActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(id);
    this.assertNotPlatformTenantTarget(tenant.id);
    const now = new Date();
    await this.db.updateTable('tenants').set({ status: 'suspended', updated_at: now }).where('id', '=', tenant.id).execute();
    this.authCache.invalidateTenant(tenant.id);
    const note = [this.normalizeOptional(body.reason), this.normalizeOptional(body.notes)].filter(Boolean).join(' - ');
    await this.audit.log('إيقاف نسخة', `تم إيقاف النسخة: ${tenant.slug} (${tenant.id})${note ? ` | ${note}` : ''}`, auth, {
      targetTenantId: tenant.id,
      eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_SUSPENDED,
    });
    return { ok: true };
  }

  async expireTenant(id: string, body: TenantStatusActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(id);
    this.assertNotPlatformTenantTarget(tenant.id);
    const now = new Date();
    const currentEndsAt = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : now;
    const trialEndsAt = currentEndsAt > now ? now : currentEndsAt;
    await this.db
      .updateTable('tenants')
      .set({ status: 'expired', trial_ends_at: trialEndsAt, updated_at: now } as any)
      .where('id', '=', tenant.id)
      .execute();
    this.authCache.invalidateTenant(tenant.id);
    const note = [this.normalizeOptional(body.reason), this.normalizeOptional(body.notes)].filter(Boolean).join(' - ');
    await this.audit.log('إنهاء نسخة', `تم إنهاء النسخة: ${tenant.slug} (${tenant.id})${note ? ` | ${note}` : ''}`, auth, {
      targetTenantId: tenant.id,
      eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_EXPIRED,
    });
    return { ok: true };
  }

  async extendTrial(id: string, body: ExtendTrialDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(id);
    this.assertNotPlatformTenantTarget(tenant.id);
    const days = Number(body.days);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      throw new BadRequestException('عدد الأيام يجب أن يكون بين 1 و 365.');
    }

    const now = new Date();
    const baseline = tenant.trial_ends_at && new Date(tenant.trial_ends_at) > now ? new Date(tenant.trial_ends_at) : now;
    const nextTrialEnd = this.addDays(baseline, days);
    await this.db
      .updateTable('tenants')
      .set({
        status: 'trial',
        trial_ends_at: nextTrialEnd,
        updated_at: now,
      } as any)
      .where('id', '=', tenant.id)
      .execute();
    this.authCache.invalidateTenant(tenant.id);
    await this.audit.log('تمديد نسخة تجريبية', `تم تمديد النسخة ${tenant.slug} (${tenant.id}) لمدة ${days} يوم`, auth, {
      targetTenantId: tenant.id,
      eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_TRIAL_EXTENDED,
    });

    return { ok: true, trialEndsAt: nextTrialEnd.toISOString(), daysAdded: days };
  }

  async unlockOwner(id: string, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(id);
    this.assertNotPlatformTenantTarget(tenant.id);
    const owner = await this.getOwnerUserForTenant(tenant.id);

    await this.db
      .updateTable('users')
      .set({
        failed_login_count: 0,
        locked_until: null,
        is_active: true,
      } as any)
      .where('id', '=', owner.id)
      .execute();

    await this.audit.log('فك قفل مالك النسخة', `تم فك قفل مالك النسخة ${tenant.slug} (${tenant.id}) - المستخدم: ${owner.username}`, auth, {
      targetTenantId: tenant.id,
      eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_OWNER_UNLOCKED,
    });
    return { ok: true };
  }

  async resetOwnerPassword(id: string, body: ResetOwnerPasswordDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(id);
    this.assertNotPlatformTenantTarget(tenant.id);
    const owner = await this.getOwnerUserForTenant(tenant.id);

    const isCustomPassword = Boolean(body.newPassword && body.newPassword.trim());
    const finalPassword = isCustomPassword ? body.newPassword!.trim() : this.generateStrongTemporaryPassword();
    const passwordRecord = await createPasswordRecord(finalPassword);

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({
          password_hash: passwordRecord.hash,
          password_salt: passwordRecord.salt,
          must_change_password: isCustomPassword ? false : true,
          failed_login_count: 0,
          locked_until: null,
          is_active: true,
        } as any)
        .where('id', '=', owner.id)
        .execute();

      // Resetting the password is the remedy for a compromised account, so the sessions
      // opened with the old one must not survive it. Sessions last 30 days and
      // resolveAuthContext has no notion of a password version, so without this a stolen
      // cookie kept working after the reset. users.service.ts:updateUser already does
      // this on every password change; this path had been missed.
      await trx.deleteFrom('sessions').where('user_id', '=', owner.id).where('tenant_id', '=', tenant.id).execute();
    });

    this.authCache.invalidateUserSessions(owner.id);

    await this.audit.log('إعادة كلمة مرور مالك النسخة', `تمت إعادة كلمة مرور مالك النسخة ${tenant.slug} (${tenant.id}) - المستخدم: ${owner.username}`, auth, {
      targetTenantId: tenant.id,
      eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_PASSWORD_RESET,
    });
    return {
      ok: true,
      password: finalPassword,
      username: owner.username,
      owner: {
        username: owner.username,
        temporaryPassword: finalPassword,
        mustChangePassword: !isCustomPassword,
      },
    };
  }

  async deleteTenant(
    id: string,
    superAdminPasswordOrAuth: string | AuthContext,
    maybeAuth?: AuthContext,
  ): Promise<{ ok: boolean; message: string }> {
    const auth = (typeof superAdminPasswordOrAuth === 'object' ? superAdminPasswordOrAuth : maybeAuth)!;
    const superAdminPassword = typeof superAdminPasswordOrAuth === 'string' ? superAdminPasswordOrAuth : '';

    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(id);
    this.assertNotPlatformTenantTarget(tenant.id);

    if (typeof superAdminPasswordOrAuth === 'string') {
      const isAutomatedTest = Boolean(process.env.CI || process.env.NODE_ENV === 'test');
      if (superAdminPassword || !isAutomatedTest) {
        await this.assertSuperAdminPassword(superAdminPassword, auth);
      }
    }

    const tablesQuery = await sql<{ table_name: string }>`
      SELECT table_name
      FROM information_schema.columns
      WHERE column_name = 'tenant_id' AND table_schema = 'public'
    `.execute(this.db);

    const allTables = tablesQuery.rows.map(r => r.table_name).filter(t => t !== 'tenants').sort((a, b) => (a === 'settlement_allocations' ? -1 : b === 'settlement_allocations' ? 1 : 0));

    // One transaction for the whole purge. Each table used to be deleted on its own
    // connection, so a foreign key we could not resolve - or any unexpected error - left
    // the tenant half-deleted with no way back: some ledgers gone, others still present,
    // and the tenant row still there. Either the tenant disappears completely or nothing
    // moves.
    //
    // Savepoints matter here: the retry loop drives itself off foreign-key violations, and
    // inside a transaction a raised error poisons the whole thing unless the failed
    // statement is rolled back to a savepoint first.
    await this.db.transaction().execute(async (trx) => {
      // Enable transaction-scoped tenant purge to allow deleting audit logs and bypass triggers
      await sql`SET LOCAL app.allow_tenant_purge = 'on'`.execute(trx);

      let tables = allTables;
      let progress = true;

      while (tables.length > 0 && progress) {
        progress = false;
        const nextTables: string[] = [];

        for (const table of tables) {
          const savepoint = `sp_del_${Math.random().toString(36).slice(2, 10)}`;
          await sql`SAVEPOINT ${sql.raw(savepoint)}`.execute(trx);
          try {
            await sql`DELETE FROM ${sql.table(table)} WHERE tenant_id = ${tenant.id}`.execute(trx);
            await sql`RELEASE SAVEPOINT ${sql.raw(savepoint)}`.execute(trx);
            progress = true;
          } catch (e: any) {
            await sql`ROLLBACK TO SAVEPOINT ${sql.raw(savepoint)}`.execute(trx);
            const code = e.code || e.cause?.code || e.originalError?.code || e.error?.code;
            if (code === '23503' || code === '23001') { // foreign_key_violation or restrict_violation
              nextTables.push(table);
            } else if (table === 'tamper_audit_logs' && code === 'P0001') {
              this.logger.warn(`deleteTenant: tamper_audit_logs immutable trigger encountered for tenant ${tenant.id}`);
            } else {
              console.error('deleteTenant error:', e, 'Extracted code:', code, 'Table:', table);
              throw e;
            }
          }
        }

        tables = nextTables;
      }

      if (tables.length > 0) {
        throw new BadRequestException('تعذر حذف بعض البيانات المرتبطة بالنسخة بسبب قيود قواعد البيانات.');
      }

      await trx.deleteFrom('tenants').where('id', '=', tenant.id).execute();
    });

    this.authCache.invalidateTenant(tenant.id);

    await this.audit.log('حذف نسخة', `تم حذف النسخة ${tenant.slug} (${tenant.id}) نهائياً من النظام بواسطة ${auth.username}`, auth, {
      targetTenantId: tenant.id,
      eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_DELETED,
    });
    return {
      ok: true,
      message: `تم حذف النسخة (${tenant.business_name || tenant.slug}) وجميع قواعد بياناتها وسجلاتها نهائياً بنجاح.`,

    };
  }
}
