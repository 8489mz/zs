import { sql } from '../../../database/kysely';
import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { resolvePlanDisplayName } from '../../../core/tenant/plan-tier.util';
import { NotFoundException } from '@nestjs/common';
import { AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import type { AuditService } from '../../../core/audit/audit.service';
import type { TrialTenantProvisioningService } from '../trial-tenant-provisioning.service';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { ListSaasTenantsQueryDto, CreateTrialTenantDto } from '../dto/saas-admin.dto';

type TenantStatus = 'trial' | 'active' | 'expired' | 'suspended';

export interface SaasAdminTenantsBoundDeps {
  assertPlatformAccess: (auth: AuthContext) => void;
  getPlatformTenantId: () => string;
  trialDaysRemaining: (trialEndsAt: Date | null) => number | null;
  normalizeRequired: (value: unknown, message: string) => string;
  normalizeOptional: (value: unknown) => string | null;
}

export class SaasAdminTenants {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly provisioning: TrialTenantProvisioningService,
    private readonly bound: SaasAdminTenantsBoundDeps,
  ) {}

  private assertPlatformAccess(auth: AuthContext): void {
    return this.bound.assertPlatformAccess(auth);
  }

  private getPlatformTenantId(): string {
    return this.bound.getPlatformTenantId();
  }

  private trialDaysRemaining(trialEndsAt: Date | null): number | null {
    return this.bound.trialDaysRemaining(trialEndsAt);
  }

  private normalizeRequired(value: unknown, message: string): string {
    return this.bound.normalizeRequired(value, message);
  }

  private normalizeOptional(value: unknown): string | null {
    return this.bound.normalizeOptional(value);
  }

  async listTenants(query: ListSaasTenantsQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const status = String(query.status || '').trim();
    const search = String(query.search || '').trim().toLowerCase();

    let listQuery = this.db
      .selectFrom('tenants as t')
      .leftJoin('users as u', 'u.tenant_id', 't.id')
      .select((eb) => [
        't.id',
        't.slug',
        't.business_name',
        't.owner_name',
        't.owner_phone',
        't.owner_email',
        't.activity_type',
        't.status',
        't.trial_starts_at',
        't.trial_ends_at',
        't.activated_at',
        't.created_at',
        't.updated_at',
        't.plan_id',
        't.extra_features',
        eb.fn.count<number>('u.id').as('users_count'),
        eb.fn.sum<number>(eb.case().when('u.is_active', '=', true).then(1).else(0).end()).as('active_users_count'),
      ])
      .groupBy([
        't.id',
        't.slug',
        't.business_name',
        't.owner_name',
        't.owner_phone',
        't.owner_email',
        't.activity_type',
        't.status',
        't.trial_starts_at',
        't.trial_ends_at',
        't.activated_at',
        't.created_at',
        't.updated_at',
        't.plan_id',
        't.extra_features',
      ])
      .orderBy('t.created_at', 'desc');

    if (status) {
      listQuery = listQuery.where('t.status', '=', status as TenantStatus);
    }

    if (search) {
      listQuery = listQuery.where((eb) => eb.or([
        eb(sql<string>`LOWER(t.slug)`, 'like', `%${search}%`),
        eb(sql<string>`LOWER(t.business_name)`, 'like', `%${search}%`),
        eb(sql<string>`LOWER(t.owner_name)`, 'like', `%${search}%`),
        eb(sql<string>`LOWER(t.owner_phone)`, 'like', `%${search}%`),
        eb(sql<string>`LOWER(COALESCE(t.owner_email, ''))`, 'like', `%${search}%`),
      ]));
    }

    const rows = await listQuery.execute();
    const tenantIds = rows.map((row) => row.id);
    const ownerRows = tenantIds.length
      ? await this.db
          .selectFrom('users')
          .select(['tenant_id', 'username', 'is_active', 'failed_login_count', 'locked_until'])
          .where('tenant_id', 'in', tenantIds)
          .where('role', 'in', ['super_admin', 'admin'])
          .orderBy('created_at', 'asc')
          .orderBy('id', 'asc')
          .execute()
      : [];

    const ownerByTenant = new Map<string, { username: string; isActive: boolean; locked: boolean }>();
    for (const owner of ownerRows) {
      const key = String(owner.tenant_id || '');
      if (ownerByTenant.has(key)) continue;
      const lockedUntilMs = owner.locked_until ? new Date(owner.locked_until).getTime() : 0;
      const isLocked = Number(owner.failed_login_count || 0) > 0 || lockedUntilMs > Date.now();
      ownerByTenant.set(key, {
        username: String(owner.username || ''),
        isActive: Boolean(owner.is_active),
        locked: isLocked,
      });
    }

    const subscriptions = tenantIds.length
      ? await this.db
          .selectFrom('tenant_subscriptions as s')
          .leftJoin('saas_plans as p', 'p.id', 's.plan_id')
          .select([
            's.tenant_id',
            's.status as sub_status',
            's.ends_at',
            's.grace_ends_at',
            'p.name as plan_name',
          ])
          .where('s.tenant_id', 'in', tenantIds)
          .orderBy('s.created_at', 'desc')
          .execute()
      : [];

    const subByTenant = new Map<string, any>();
    for (const sub of subscriptions) {
      const key = String(sub.tenant_id);
      if (!subByTenant.has(key)) {
        subByTenant.set(key, sub);
      }
    }

    const tenants = rows.map((row) => {
      const owner = ownerByTenant.get(String(row.id || ''));
      const sub = subByTenant.get(String(row.id || ''));
      const isPlatform =
        String(row.id || '') === 'zs' ||
        String(row.id || '') === this.getPlatformTenantId() ||
        String(row.slug || '').toLowerCase() === 'zs';
      const cleanSlug = row.slug;
      return {
        id: row.id,
        slug: cleanSlug,
        businessName: isPlatform && (!row.business_name || row.business_name === 'النظام الأساسي') ? 'Z-Systems' : row.business_name,
        ownerName: isPlatform && (!row.owner_name || row.owner_name === 'المسؤول') ? 'Z-Systems' : row.owner_name,
        ownerPhone: isPlatform && (!row.owner_phone || row.owner_phone === '0000000000' || row.owner_phone === '01000000000') ? '01018017523' : row.owner_phone,
        ownerEmail: isPlatform && !row.owner_email ? '8489mz@gmail.com' : (row.owner_email || ''),
        activityType: row.activity_type || '',
        status: isPlatform ? 'active' : row.status,
        trialStartsAt: isPlatform ? null : (row.trial_starts_at ? new Date(row.trial_starts_at).toISOString() : null),
        trialEndsAt: isPlatform ? null : (row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null),
        activatedAt: row.activated_at ? new Date(row.activated_at).toISOString() : null,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        trialDaysRemaining: isPlatform ? null : this.trialDaysRemaining(row.trial_ends_at ? new Date(row.trial_ends_at) : null),
        usersCount: Number(row.users_count || 0),
        activeUsersCount: Number(row.active_users_count || 0),
        ownerLocked: Boolean(owner?.locked),
        ownerIsActive: owner ? Boolean(owner.isActive) : false,
        ownerUsername: owner?.username || '',
        planName: isPlatform ? 'مالك المنظومة (غير مقيد)' : (sub?.plan_name || resolvePlanDisplayName(row.plan_id)),
        planId: row.plan_id || null,
        extraFeatures: Array.isArray(row.extra_features) ? row.extra_features : typeof row.extra_features === 'string' ? JSON.parse(row.extra_features) : [],
        subscriptionStatus: isPlatform ? 'active' : (sub?.sub_status || null),
        subscriptionEndDate: isPlatform ? null : (sub?.ends_at ? new Date(sub.ends_at).toISOString() : null),
        graceEndDate: isPlatform ? null : (sub?.grace_ends_at ? new Date(sub.grace_ends_at).toISOString() : null),
        isPlatform,
      };
    });

    return { tenants };
  }

  async getTenantById(id: string, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenantId = String(id || '').trim();
    const tenant = await this.db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', tenantId)
      .executeTakeFirst();
    if (!tenant) throw new NotFoundException('النسخة غير موجودة.');

    const usersSummary = await this.db
      .selectFrom('users')
      .select((eb) => [
        eb.fn.countAll<number>().as('users_count'),
        eb.fn.sum<number>(eb.case().when('is_active', '=', true).then(1).else(0).end()).as('active_users_count'),
      ])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const owner = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'last_login_at'])
      .where('tenant_id', '=', tenantId)
      .where('role', 'in', ['admin', 'super_admin'])
      .orderBy('created_at', 'asc')
      .executeTakeFirst();

    let lastSeenAt: string | null = null;
    if (owner) {
      const session = await this.db
        .selectFrom('sessions')
        .select(['last_seen_at'])
        .where('user_id', '=', owner.id)
        .orderBy('last_seen_at', 'desc')
        .executeTakeFirst();
      if (session?.last_seen_at) {
        lastSeenAt = new Date(session.last_seen_at).toISOString();
      }
    }

    const isPlatform =
      String(tenant.id || '') === 'zs' ||
      String(tenant.id || '') === this.getPlatformTenantId() ||
      String(tenant.slug || '').toLowerCase() === 'zs';

    // P10: current super-admin feature overrides, so the plan modal can
    // show them (grant / hide / default). Empty when the table is absent.
    let featureOverrides: Array<{ featureCode: string; granted: boolean; reason: string | null }> = [];
    try {
      const overrideRows = await this.db
        .selectFrom('tenant_feature_overrides')
        .select(['feature_code', 'granted', 'reason'])
        .where('tenant_id', '=', tenantId)
        .orderBy('feature_code', 'asc')
        .execute();
      featureOverrides = overrideRows.map((r) => ({ featureCode: String(r.feature_code), granted: Boolean(r.granted), reason: r.reason ?? null }));
    } catch {
      featureOverrides = [];
    }

    const cleanSlug = tenant.slug;

    return {
      tenant: {
        id: tenant.id,
        slug: cleanSlug,
        businessName: isPlatform && (!tenant.business_name || tenant.business_name === 'النظام الأساسي') ? 'Z-Systems' : tenant.business_name,
        ownerName: isPlatform && (!tenant.owner_name || tenant.owner_name === 'المسؤول') ? 'Z-Systems' : tenant.owner_name,
        ownerPhone: isPlatform && (!tenant.owner_phone || tenant.owner_phone === '0000000000' || tenant.owner_phone === '01000000000') ? '01018017523' : tenant.owner_phone,
        ownerEmail: isPlatform && !tenant.owner_email ? '8489mz@gmail.com' : (tenant.owner_email || ''),
        activityType: tenant.activity_type || '',
        status: isPlatform ? 'active' : tenant.status,
        trialStartsAt: isPlatform ? null : (tenant.trial_starts_at ? new Date(tenant.trial_starts_at).toISOString() : null),
        trialEndsAt: isPlatform ? null : (tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toISOString() : null),
        activatedAt: tenant.activated_at ? new Date(tenant.activated_at).toISOString() : null,
        createdAt: tenant.created_at ? new Date(tenant.created_at).toISOString() : null,
        updatedAt: tenant.updated_at ? new Date(tenant.updated_at).toISOString() : null,
        trialDaysRemaining: isPlatform ? null : this.trialDaysRemaining(tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null),
        usersCount: Number(usersSummary?.users_count || 0),
        activeUsersCount: Number(usersSummary?.active_users_count || 0),
        lastLoginAt: owner?.last_login_at ? new Date(owner.last_login_at).toISOString() : null,
        ownerUsername: owner?.username || '',
        planId: tenant.plan_id || null,
        planName: isPlatform ? 'مالك المنظومة (كامل الصلاحيات والأنظمة)' : resolvePlanDisplayName(tenant.plan_id),
        isPlatform,
        extraFeatures: Array.isArray(tenant.extra_features) ? tenant.extra_features : typeof tenant.extra_features === 'string' ? JSON.parse(tenant.extra_features) : [],
        featureOverrides,
      },
    };
  }

  async getTenantTimeline(id: string, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);
    const tenantId = String(id || '').trim();

    const events = await this.db
      .selectFrom('audit_logs as a')
      .leftJoin('users as u', 'u.id', 'a.created_by')
      // The impersonator is a platform user, so it is a second, separate join — not the
      // same row as the acting identity.
      .leftJoin('users as imp', 'imp.id', 'a.impersonated_by')
      .select([
        'a.id',
        'a.action',
        'a.details',
        'a.created_at',
        'u.username as actor_name',
        'imp.username as impersonator_name'
      ])
      .where((eb) => eb.or([
        eb('a.tenant_id', '=', tenantId),
        eb('a.target_tenant_id', '=', tenantId)
      ]))
      .orderBy('a.created_at', 'desc')
      .limit(100)
      .execute();

    return {
      events: events.map(e => ({
        id: e.id,
        action: e.action,
        details: e.details,
        actorName: e.actor_name || 'System',
        // Present only when a platform admin took this action while impersonating the
        // tenant's owner. Null on everything the tenant did themselves.
        impersonatedBy: e.impersonator_name || null,
        createdAt: new Date(e.created_at).toISOString()
      }))
    };
  }

  async createTrialTenant(payload: CreateTrialTenantDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertPlatformAccess(auth);

    const result = await this.provisioning.createTrialTenant(
      {
        slug: this.normalizeRequired(payload.slug, 'اسم النسخة مطلوب.'),
        businessName: this.normalizeRequired(payload.businessName, 'اسم النشاط مطلوب.'),
        branchName: this.normalizeOptional(payload.branchName),
        ownerName: this.normalizeRequired(payload.ownerName, 'اسم المالك مطلوب.'),
        ownerPhone: this.normalizeRequired(payload.ownerPhone, 'رقم الهاتف مطلوب.'),
        ownerEmail: this.normalizeOptional(payload.ownerEmail),
        activityType: this.normalizeOptional(payload.activityType),
        username: this.normalizeRequired(payload.username, 'اسم المستخدم مطلوب.'),
        password: this.normalizeOptional(payload.password),
        days: payload.days,
        source: this.normalizeOptional(payload.source),
        campaign: this.normalizeOptional(payload.campaign),
        notes: this.normalizeOptional(payload.notes),
        featurePlanId: this.normalizeOptional(payload.featurePlanId),
        saasPlanId: payload.saasPlanId,
      },
      {
        enforceStrongProvidedPassword: true,
        strictProvidedSlug: true,
        strictProvidedUsername: true,
      },
    );

    await this.audit.log('إنشاء نسخة تجريبية', `تم إنشاء نسخة تجريبية: ${result.tenant.slug} (${result.tenant.id})`, auth, {
      targetTenantId: String(result.tenant.id),
      eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_TRIAL_CREATED,
    });
    return result;
  }
}
