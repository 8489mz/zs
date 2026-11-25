import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuditService } from '../../../core/audit/audit.service';
import type { AuthCacheService } from '../../../core/auth/services/auth-cache.service';
import { type Logger, NotFoundException } from '@nestjs/common';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

/** Settings key holding the bcrypt hash of the developer master password. */
export const DEVELOPER_MASTER_PASSWORD_HASH_KEY = 'developerMasterPasswordHash';

export type SaasAdminDeveloperBoundDeps = {
  syncTenantModuleSettingsForPlan(tenantId: string, planId?: string | null, extraFeatures?: string[]): Promise<void>;
  syncTenantSubscriptionPlan(tenantId: string, planId: string): Promise<void>;
};

export class SaasAdminDeveloper {
  private featurePlansCache: { data: Record<string, unknown>[]; expiresAt: number } | null = null;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
    private readonly logger: Logger,
    private readonly CACHE_TTL_MS: number,
    private readonly bound: SaasAdminDeveloperBoundDeps,
  ) {}

  private async syncTenantModuleSettingsForPlan(tenantId: string, planId?: string | null, extraFeatures?: string[]): Promise<void> {
    return this.bound.syncTenantModuleSettingsForPlan(tenantId, planId, extraFeatures);
  }

  private async syncTenantSubscriptionPlan(tenantId: string, planId: string): Promise<void> {
    return this.bound.syncTenantSubscriptionPlan(tenantId, planId);
  }

  async developerListFeaturePlans(): Promise<Record<string, unknown>[]> {
    const now = Date.now();
    if (this.featurePlansCache && this.featurePlansCache.expiresAt > now) {
      return this.featurePlansCache.data;
    }
    const plans = await this.db.selectFrom('plans').selectAll().orderBy('price', 'asc').execute();
    const planFeatures = await this.db.selectFrom('plan_features').selectAll().execute();

    const result = plans.map(p => ({
      ...p,
      features: planFeatures.filter(f => f.plan_id === p.id).map(f => f.feature_code)
    }));
    this.featurePlansCache = { data: result, expiresAt: now + this.CACHE_TTL_MS };
    return result;
  }

  async developerUpdateTenantPlan(dto: { tenantId?: string; planId?: string; extraFeatures?: string[] }) {
    // This is called by the offline developer activation panel. It bypasses normal platform auth.
    let query = this.db.selectFrom('tenants').select(['id', 'slug', 'plan_id', 'extra_features']);
    if (dto.tenantId) {
      query = query.where('id', '=', dto.tenantId);
    } else {
      query = query.orderBy('created_at', 'asc').limit(1);
    }
    let tenant = await query.executeTakeFirst();

    // Auto-create default tenant if running locally and missing
    if (!tenant && dto.tenantId === 'default') {
      const now = new Date();
      await this.db.insertInto('tenants').values({
        id: 'default',
        slug: 'default',
        business_name: 'Z-Systems',
        owner_name: 'Z-Systems',
        owner_phone: '01018017523',
        owner_email: '8489mz@gmail.com',
        status: 'active',
        trial_starts_at: now,
        trial_ends_at: new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000)
      } as any).execute();
      tenant = { id: 'default', slug: 'default', plan_id: null, extra_features: null };
    }

    if (!tenant) throw new NotFoundException('No local tenant found to update');

    const updateData: any = {};
    if (dto.planId !== undefined) {
      updateData.plan_id = dto.planId === '' ? null : dto.planId;
    }
    if (dto.extraFeatures !== undefined) updateData.extra_features = JSON.stringify(dto.extraFeatures);

    if (Object.keys(updateData).length > 0) {
      await this.db.updateTable('tenants').set(updateData).where('id', '=', tenant.id).execute();
      this.authCache.invalidateTenant(tenant.id);

      // Auto-sync the operational module switches for this tenant so newly activated features are immediately enabled!
      const effectivePlanId = dto.planId !== undefined ? (dto.planId === '' ? null : dto.planId) : tenant.plan_id;
      const effectiveExtra = dto.extraFeatures !== undefined ? dto.extraFeatures : (typeof tenant.extra_features === 'string' ? JSON.parse(tenant.extra_features || '[]') : tenant.extra_features || []);
      await this.syncTenantModuleSettingsForPlan(tenant.id, effectivePlanId, effectiveExtra);
      if (effectivePlanId) {
        await this.syncTenantSubscriptionPlan(tenant.id, effectivePlanId);
      }

      // O40: the actor used to carry no tenant/account, so requireTenantScope threw inside the audit
      // service and the catch below swallowed it — a plan change with no trace anywhere. The developer
      // panel acts on a specific tenant, so the entry is written under that tenant's scope, and a
      // failure is logged instead of disappearing.
      const accountRow = await this.db
        .selectFrom('users')
        .select('account_id')
        .where('tenant_id', '=', tenant.id)
        .executeTakeFirst()
        .catch(() => undefined);
      const developerActor = {
        id: 'developer',
        userId: null,
        username: 'developer-panel',
        role: 'super_admin',
        tenantId: tenant.id,
        accountId: accountRow?.account_id ?? tenant.id,
      } as unknown as AuthContext;
      const featuresText = Array.isArray(effectiveExtra) && effectiveExtra.length ? effectiveExtra.join(', ') : 'بدون';
      try {
        await this.audit.log(
          'تفعيل مطور',
          `تم تفعيل الباقة والميزات محلياً بواسطة لوحة المطورين | الباقة: ${effectivePlanId || 'بدون'} | ميزات إضافية: ${featuresText}`,
          developerActor,
          { targetTenantId: tenant.id },
        );
      } catch (error) {
        this.logger.error(`developer plan change for ${tenant.id} was not audited: ${(error as Error)?.message || error}`);
      }
    }

    return { ok: true };
  }

  /**
   * Developer master password (INV-DEVELOPER-MASTER-PASSWORD): the
   * bcrypt hash of the secret that guards plan/package changes, stored
   * as ONE settings row for the installation's own (first-created)
   * tenant — never plaintext, never the super_admin login password.
   * The hash belongs to the installation, not to the tenant being
   * edited, so the tenantId in an update-plan body never re-scopes it.
   */
  async getDeveloperMasterPasswordHash(): Promise<string | null> {
    const tenant = await this.db
      .selectFrom('tenants')
      .select('id')
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (!tenant) return null;
    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenant.id)
      .where('key', '=', DEVELOPER_MASTER_PASSWORD_HASH_KEY)
      .limit(1)
      .executeTakeFirst();
    const value = String((row as { value?: unknown } | undefined)?.value ?? '').trim();
    return value || null;
  }

  /**
   * Stores a super_admin-set master-password hash. The caller (the
   * guarded controller endpoint) hashes with createPasswordRecord and
   * enforces the 12-character admin floor; this method only writes the
   * hash row, scoped to the setter's own tenant scope. The generic
   * settings save path is forbidden from writing this key (see
   * SettingsService.saveSettings), so this endpoint is the ONE place
   * the secret can be set or changed.
   */
  async setDeveloperMasterPasswordHash(hash: string, auth: AuthContext): Promise<void> {
    const scope = requireTenantScope(auth);
    await this.db
      .insertInto('settings')
      .values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        key: DEVELOPER_MASTER_PASSWORD_HASH_KEY,
        value: hash,
      } as never)
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'key'] as never).doUpdateSet({
          value: hash,
          account_id: scope.accountId,
        } as never),
      )
      .execute();
  }
}
