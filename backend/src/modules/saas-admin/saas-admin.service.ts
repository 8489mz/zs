import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { isReservedStoreSlug } from '../storefront/engines/store-public-url.engine';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { KYSELY_DB } from '../../database/database.constants';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { AuditService, AUDIT_EVENT_CODES } from '../../core/audit/audit.service';
import { SessionService } from '../../core/auth/services/session.service';
import { createCsrfToken } from '../../core/auth/utils/csrf-token';
import { ActivateTenantDto, CreateTrialTenantDto, ExtendTrialDto, ListSaasTenantsQueryDto, ResetOwnerPasswordDto, TenantStatusActionDto, RenewTenantDto, CreateSaasPlanDto, RecordPaymentDto, UpdateSaasPlanDto } from './dto/saas-admin.dto';
import { TrialTenantProvisioningService } from './trial-tenant-provisioning.service';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { SettingsDemoDataService } from '../settings/services/settings-demo-data.service';
import { SettingsService } from '../settings/settings.service';
import { PLAN_MANAGED_MODULES_SETTING_KEY } from '../../common/constants/platform-settings-keys';
import { normalizeIndustryProfileKey, getIndustryProfile } from '../../core/tenant/industry-profiles';
import { isPlatformTenantId, requireTenantScope } from '../../core/auth/utils/tenant-boundary';

/** Settings key holding the bcrypt hash of the developer master password. */
export const DEVELOPER_MASTER_PASSWORD_HASH_KEY = 'developerMasterPasswordHash';

type TenantStatus = 'trial' | 'active' | 'expired' | 'suspended';


@Injectable()
export class SaasAdminService {
  private readonly logger = new Logger(SaasAdminService.name);
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly provisioning: TrialTenantProvisioningService,
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
    private readonly demoDataService: SettingsDemoDataService,
    private readonly settingsService: SettingsService,
    // O39: no default instance. A second, private cache would answer with stale roles and
    // permissions after an invalidation, and the trap only springs when injection changes.
    private readonly authCache: AuthCacheService,
  ) {}

  private plansCache: { data: Record<string, unknown>[]; expiresAt: number } | null = null;
  private featurePlansCache: { data: Record<string, unknown>[]; expiresAt: number } | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  private assertPlatformAccess(auth: AuthContext): void {
    if (auth.role !== 'super_admin') {
      throw new ForbiddenException('غير مسموح: هذه الشاشة مخصصة لمسؤول المنصة فقط.');
    }
    const tenantId = String(auth.tenantId || '').trim();

    const isAllowedTenant = isPlatformTenantId(tenantId);
    if (!tenantId || !isAllowedTenant) {
      throw new ForbiddenException('غير مسموح: هذه الشاشة مخصصة لمسؤول المنصة فقط.');
    }
  }

  private getPlatformTenantId(): string {
    return String(process.env.PLATFORM_TENANT_ID || 'zs').trim() || 'zs';
  }

  private assertNotPlatformTenantTarget(targetTenantId: string): void {
    const tid = String(targetTenantId || '').trim();
    if (isPlatformTenantId(tid)) {
      throw new ForbiddenException('لا يمكن تعديل حالة نسخة المنصة من هذه الصفحة.');
    }
  }

  private async assertSuperAdminPassword(password: string, auth: AuthContext): Promise<void> {
    if (auth.role !== 'super_admin') {
      throw new ForbiddenException('غير مسموح: هذه العملية مخصصة للسوبر أدمن فقط.');
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      throw new BadRequestException('يرجى إدخال كلمة مرور السوبر أدمن لتأكيد الحذف النهائي.');
    }

    const platformTenant = auth.tenantId || this.getPlatformTenantId();
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'password_hash', 'password_salt'])
      .where('id', '=', auth.userId)
      .where(sql<boolean>`tenant_id = ${platformTenant}`)
      .executeTakeFirst();

    if (!user || !user.password_hash) {
      throw new NotFoundException('تعذر التحقق من حساب السوبر أدمن.');
    }

    const check = await verifyPassword(password.trim(), String(user.password_hash), String(user.password_salt || ''));
    if (!check.valid) {
      throw new UnauthorizedException('كلمة مرور السوبر أدمن غير صحيحة.');
    }
  }

  private normalizeRequired(value: unknown, message: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) throw new BadRequestException(message);
    return normalized;
  }

  private normalizeOptional(value: unknown): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private trialDaysRemaining(trialEndsAt: Date | null): number | null {
    if (!trialEndsAt) return null;
    const diffMs = trialEndsAt.getTime() - Date.now();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  }

  private generateStrongTemporaryPassword(): string {
    return `Owner-${randomBytes(10).toString('base64url')}@Zs1`;
  }

  private async getOwnerUserForTenant(tenantId: string) {
    const owner = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'tenant_id', 'account_id', 'is_active', 'must_change_password', 'failed_login_count', 'locked_until'])
      .where('tenant_id', '=', tenantId)
      .where('role', 'in', ['super_admin', 'admin'])
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .executeTakeFirst();

    if (!owner) {
      throw new NotFoundException('مستخدم مالك النسخة غير موجود.');
    }

    return owner;
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
        planName: isPlatform ? 'مالك المنظومة (غير مقيد)' : (sub?.plan_name || (row.plan_id === 'plan_omnichannel' ? 'التجارة الشاملة' : row.plan_id === 'plan_ultimate' ? 'المتكاملة' : row.plan_id === 'plan_pro' ? 'المتقدمة' : row.plan_id === 'plan_starter' ? 'الأساسية' : 'المتكاملة')),
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
        planName: isPlatform ? 'مالك المنظومة (كامل الصلاحيات والأنظمة)' : (tenant.plan_id === 'plan_omnichannel' ? 'التجارة الشاملة' : tenant.plan_id === 'plan_ultimate' ? 'المتكاملة' : tenant.plan_id === 'plan_pro' ? 'المتقدمة' : tenant.plan_id === 'plan_starter' ? 'الأساسية' : 'المتكاملة'),
        isPlatform,
        extraFeatures: Array.isArray(tenant.extra_features) ? tenant.extra_features : typeof tenant.extra_features === 'string' ? JSON.parse(tenant.extra_features) : [],
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
    const result = await this.db.insertInto('saas_plans').values({
      code: body.code,
      name: body.name,
      price: body.price,
      currency: body.currency || 'EGP',
      billing_period_months: body.billingPeriodMonths,
      max_users: body.maxUsers ?? null,
      max_branches: body.maxBranches ?? null,
      feature_plan_id: body.featurePlanId || null,
      is_active: true,
    }).returningAll().executeTakeFirstOrThrow();
    
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

    const result = await this.db.updateTable('saas_plans')
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
    await this.db.insertInto('tenant_subscription_payments').values({
      tenant_id: tenant.id,
      subscription_id: activeSub.id,
      amount: body.amount,
      currency: body.currency,
      method: body.method || 'manual',
      reference: body.reference || null,
      paid_at: body.date ? new Date(body.date) : now,
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

  private async getTenantForMutation(id: string) {
    const tenant = await this.db.selectFrom('tenants').selectAll().where('id', '=', id).executeTakeFirst();
    if (!tenant) throw new NotFoundException('النسخة غير موجودة.');
    return tenant;
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

    const allTables = tablesQuery.rows.map(r => r.table_name).filter(t => t !== 'tenants');

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

  async updateTenantPlan(id: string, dto: { planId?: string; extraFeatures?: string[]; activityType?: string }, auth: AuthContext) {
    this.assertPlatformAccess(auth);
    this.assertNotPlatformTenantTarget(id);

    const tenant = await this.db.selectFrom('tenants').select(['id', 'slug', 'plan_id', 'extra_features']).where('id', '=', id).executeTakeFirst();
    if (!tenant) throw new NotFoundException('Tenant not found');

    const updateData: any = {};
    if (dto.planId !== undefined) updateData.plan_id = dto.planId;
    if (dto.extraFeatures !== undefined) updateData.extra_features = JSON.stringify(dto.extraFeatures);
    if (dto.activityType !== undefined && String(dto.activityType).trim().length > 0) {
      const normalized = normalizeIndustryProfileKey(dto.activityType);
      updateData.activity_type = normalized;
      const patch = this.provisioning.getIndustrySettingsPatch(normalized);
      const targetPlan = dto.planId !== undefined ? dto.planId : (tenant as any).plan_id;
      const targetExtra = dto.extraFeatures !== undefined ? dto.extraFeatures : (tenant as any).extra_features;
      const isOmni = targetPlan === 'plan_omnichannel' || targetPlan === 'omnichannel' || (Array.isArray(targetExtra) && targetExtra.includes('storefront'));
      const isEnterprise = isOmni || targetPlan === 'plan_ultimate' || targetPlan === 'ultimate' || (Array.isArray(targetExtra) && targetExtra.includes('accounting'));
      if (isOmni) {
        delete patch.storefrontModuleEnabled;
      }
      if (isEnterprise) {
        delete patch.enableEnterpriseFeatures;
        delete patch.installmentsModuleEnabled;
        delete patch.taxDeclarationModuleEnabled;
        delete patch.fixedAssetsModuleEnabled;
        delete patch.deliveryRepsModuleEnabled;
        delete patch.hrModuleEnabled;
      }
      const userRow = await this.db
        .selectFrom('users')
        .select('account_id')
        .where('tenant_id', '=', id)
        .executeTakeFirst();
      const accountId = userRow?.account_id ?? 1;

      for (const [k, v] of Object.entries(patch)) {
        await sql`
          INSERT INTO settings (tenant_id, account_id, key, value)
          VALUES (${id}, ${accountId}, ${k}, ${JSON.stringify(v)})
          ON CONFLICT (tenant_id, key)
          DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id;
        `.execute(this.db);
      }
    }

    if (Object.keys(updateData).length > 0) {
      await this.db.updateTable('tenants').set(updateData).where('id', '=', id).execute();
      
      const effectivePlanId = dto.planId !== undefined ? dto.planId : (tenant as any).plan_id;
      const effectiveExtra = dto.extraFeatures !== undefined ? dto.extraFeatures : (tenant as any).extra_features;
      await this.syncTenantModuleSettingsForPlan(id, effectivePlanId, effectiveExtra);
      if (effectivePlanId) {
        await this.syncTenantSubscriptionPlan(id, effectivePlanId);
      }

      this.authCache.invalidateTenant(id);
      this.settingsService.invalidateSettingsCache(id);
      this.settingsService.invalidatePlanFeaturesCache(id);
      await this.audit.log('تحديث الباقة والنشاط', `تم تحديث باقة ونشاط النسخة ${tenant.slug}`, auth, {
        targetTenantId: tenant.id,
        eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_PLAN_UPDATED,
      });
    }

    return { ok: true };
  }

  async updateTenantSlug(id: string, newSlug: string, auth: AuthContext) {
    this.assertPlatformAccess(auth);
    this.assertNotPlatformTenantTarget(id);

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['id', 'slug', 'business_name'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!tenant) throw new NotFoundException('النسخة غير موجودة');

    const cleanSlug = String(newSlug || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-');

    if (!cleanSlug || cleanSlug.length < 3) {
      throw new BadRequestException('معرّف النسخة يجب أن يتكون من 3 أحرف إنجليزية أو أرقام على الأقل');
    }

    if (isReservedStoreSlug(cleanSlug)) {
      throw new BadRequestException('هذا المعرّف محجوز للنظام ولا يمكن استخدامه');
    }

    // Check uniqueness across other tenants
    const existing = await this.db
      .selectFrom('tenants')
      .select('id')
      .where('slug', '=', cleanSlug)
      .where('id', '!=', id)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException(`معرّف النسخة "${cleanSlug}" مستخدم بالفعل من قبل عميل آخر`);
    }

    const oldSlug = tenant.slug;
    await this.db
      .updateTable('tenants')
      .set({
        slug: cleanSlug,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    this.authCache.invalidateTenant(id);

    await this.audit.log(
      'تعديل معرّف النسخة',
      `تم تغيير معرّف النسخة من "${oldSlug}" إلى "${cleanSlug}" لنشاط (${tenant.business_name})`,
      auth,
      {
        targetTenantId: tenant.id,
        eventCode: AUDIT_EVENT_CODES.SAAS_TENANT_SLUG_UPDATED,
      },
    );

    return {
      success: true,
      oldSlug,
      newSlug: cleanSlug,
      message: `تم تحديث معرّف النسخة بنجاح إلى "${cleanSlug}"`,
    };
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

  public async syncTenantModuleSettingsForPlan(tenantId: string, planId?: string | null, extraFeatures?: string[]): Promise<void> {
    try {
      const userRow = await this.db
        .selectFrom('users')
        .select('account_id')
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const accountId = userRow?.account_id ?? 1;

      const FALLBACK_PLAN_FEATURES: Record<string, string[]> = {
        plan_basic: ['sales', 'catalog', 'sessions', 'cashDrawer'],
        basic: ['sales', 'catalog', 'sessions', 'cashDrawer'],
        BASIC: ['sales', 'catalog', 'sessions', 'cashDrawer'],
        '1': ['sales', 'catalog', 'sessions', 'cashDrawer'],

        plan_pro: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports'],
        pro: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports'],
        PRO: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports'],
        '2': ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports'],

        plan_ultimate: [
          'sales', 'catalog', 'sessions', 'cashDrawer',
          'purchases', 'inventory', 'reports',
          'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
          'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
          'manufacturing', 'import', 'pharmacy', 'maritime_freight', 'contracting',
        ],
        ultimate: [
          'sales', 'catalog', 'sessions', 'cashDrawer',
          'purchases', 'inventory', 'reports',
          'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
          'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
          'manufacturing', 'import', 'pharmacy', 'maritime_freight', 'contracting',
        ],
        ULTIMATE: [
          'sales', 'catalog', 'sessions', 'cashDrawer',
          'purchases', 'inventory', 'reports',
          'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
          'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
          'manufacturing', 'import', 'pharmacy', 'maritime_freight', 'contracting',
        ],
        '3': [
          'sales', 'catalog', 'sessions', 'cashDrawer',
          'purchases', 'inventory', 'reports',
          'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
          'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
          'manufacturing', 'import', 'pharmacy', 'maritime_freight', 'contracting',
        ],

        plan_omnichannel: [
          'sales', 'catalog', 'sessions', 'cashDrawer',
          'purchases', 'inventory', 'reports',
          'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
          'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
          'manufacturing', 'import', 'pharmacy',
          'storefront',
        ],
        omnichannel: [
          'sales', 'catalog', 'sessions', 'cashDrawer',
          'purchases', 'inventory', 'reports',
          'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
          'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
          'manufacturing', 'import', 'pharmacy',
          'storefront',
        ],
        OMNICHANNEL: [
          'sales', 'catalog', 'sessions', 'cashDrawer',
          'purchases', 'inventory', 'reports',
          'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
          'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
          'manufacturing', 'import', 'pharmacy',
          'storefront',
        ],
        '4': [
          'sales', 'catalog', 'sessions', 'cashDrawer',
          'purchases', 'inventory', 'reports',
          'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
          'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
          'manufacturing', 'import', 'pharmacy',
          'storefront',
        ],

        // Tier band plans: Level 1 has zero rows in plan_features by design (core POS comes
        // from industry profile defaultFeatures). Level 2 adds operations, Level 3 adds full ERP.
        // These fallbacks ensure syncTenantModuleSettingsForPlan never thinks the plan is empty.
        tier_band1_L1: ['sales', 'catalog', 'sessions', 'cashDrawer'],
        tier_band1_L2: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
        tier_band1_L3: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments', 'accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'],

        tier_band2_L1: ['sales', 'catalog', 'sessions', 'cashDrawer'],
        tier_band2_L2: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
        tier_band2_L3: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments', 'accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'],

        tier_band3_L1: ['sales', 'catalog', 'sessions', 'cashDrawer'],
        tier_band3_L2: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
        tier_band3_L3: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments', 'accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'],

        tier_band4_L1: ['sales', 'catalog', 'sessions', 'cashDrawer'],
        tier_band4_L2: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'],
        tier_band4_L3: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments', 'accounting', 'fixed_assets', 'hr', 'taxIntegration', 'vat_declaration'],
      };

      let baseFeatures: string[] = [];
      if (planId) {
        const rows = await this.db
          .selectFrom('plan_features')
          .select('feature_code')
          .where('plan_id', '=', planId as any)
          .execute();
        baseFeatures = rows.map(r => r.feature_code);
        if (baseFeatures.length === 0 && FALLBACK_PLAN_FEATURES[planId]) {
          baseFeatures = FALLBACK_PLAN_FEATURES[planId];
        }
        if (['plan_omnichannel', 'omnichannel', 'OMNICHANNEL', '4'].includes(String(planId)) && !baseFeatures.includes('storefront')) {
          baseFeatures.push('storefront');
        }
      }

      // Check tenant vertical to determine industry default features and module isolation
      const tenantRow = await this.db
        .selectFrom('tenants')
        .select(['activity_type'])
        .where('id', '=', tenantId)
        .executeTakeFirst();
      const verticalKey = normalizeIndustryProfileKey(tenantRow?.activity_type);
      const industryProfile = getIndustryProfile(verticalKey);

      const extra = Array.isArray(extraFeatures) ? extraFeatures : [];
      const excluded = new Set(extra.filter(f => f.startsWith('-')).map(f => f.slice(1)));
      const added = extra.filter(f => !f.startsWith('-'));
      // Always include the industry profile's defaultFeatures as a base — these are the
      // sector-identity features that are always granted regardless of the plan level.
      // Without this, Level 1 tier plans (which have zero plan_features rows by design)
      // would cause the sync to revoke ALL module settings, hiding POS, delivery fleet, etc.
      const effectiveFeatures = new Set([
        ...industryProfile.defaultFeatures.filter(f => !excluded.has(f)),
        ...baseFeatures.filter(f => !excluded.has(f)),
        ...added,
      ]);

      const FEATURE_TO_MODULE_MAP: Record<string, string[]> = {
        sales: ['posModuleEnabled'],
        pos: ['posModuleEnabled'],
        purchases: ['purchasesModuleEnabled'],
        inventory: ['inventoryModuleEnabled'],
        hr: ['hrModuleEnabled'],
        deliveryReps: ['deliveryRepsModuleEnabled', 'deliveryFleetModuleEnabled'],
        maintenance: ['enableMobileStoreFeatures'],
        services: ['servicesModuleEnabled'],
        clothing: ['clothingModuleEnabled'],
        restaurant: ['restaurantModuleEnabled', 'posShowCartMeta'],
        accounting: ['enableEnterpriseFeatures'],
        fixed_assets: ['fixedAssetsModuleEnabled'],
        installments: ['installmentsModuleEnabled'],
        taxIntegration: ['taxDeclarationModuleEnabled'],
        vat_declaration: ['taxDeclarationModuleEnabled'],
        manufacturing: ['manufacturingModuleEnabled'],
        import: ['importModuleEnabled'],
        maritime_freight: ['maritimeFreightModuleEnabled'],
        contracting: ['contractingModuleEnabled'],
        pharmacy: ['enablePharmacyModule'],
        storefront: ['storefrontModuleEnabled'],
      };

      const modulesToSet: Record<string, boolean> = {};

      for (const feat of effectiveFeatures) {
        const modKeys = FEATURE_TO_MODULE_MAP[feat] || [];
        for (const k of modKeys) {
          modulesToSet[k] = true;
        }
      }

      // Check tenant vertical to prevent retail POS or weighing scale leakage into contracting/maritime/services
      // (tenantRow and verticalKey already fetched above when building effectiveFeatures)
      const isNonRetailVertical = ['maritime_freight', 'contracting', 'wholesale_van', 'services', 'warehousing'].includes(verticalKey);

      // Strict vertical module isolation: do not let fallback plan features or previous settings leak across boundaries
      if (verticalKey !== 'maritime_freight') {
        modulesToSet['maritimeFreightModuleEnabled'] = false;
      }
      if (verticalKey !== 'contracting') {
        modulesToSet['contractingModuleEnabled'] = false;
      }
      if (verticalKey !== 'import_export') {
        modulesToSet['importModuleEnabled'] = false;
      }
      if (verticalKey !== 'manufacturing') {
        modulesToSet['manufacturingModuleEnabled'] = false;
      }
      if (verticalKey !== 'restaurant') {
        modulesToSet['restaurantModuleEnabled'] = false;
      }
      if (verticalKey !== 'pharmacy') {
        modulesToSet['enablePharmacyModule'] = false;
      }
      if (verticalKey !== 'maintenance' && (verticalKey as string) !== 'electronics') {
        modulesToSet['enableMobileStoreFeatures'] = false;
      }
      if (verticalKey !== 'clothing' && (verticalKey as string) !== 'fashion') {
        modulesToSet['clothingModuleEnabled'] = false;
      } else {
        modulesToSet['clothingModuleEnabled'] = true;
      }
      if (verticalKey !== 'auto_parts') {
        modulesToSet['autoPartsModuleEnabled'] = false;
      } else {
        modulesToSet['autoPartsModuleEnabled'] = true;
      }
      if (verticalKey !== 'services') {
        modulesToSet['servicesModuleEnabled'] = false;
      } else {
        modulesToSet['servicesModuleEnabled'] = true;
      }
      if (verticalKey === 'wholesale_van') {
        modulesToSet['vanSalesModuleEnabled'] = true;
        modulesToSet['deliveryFleetModuleEnabled'] = true;
        modulesToSet['posModuleEnabled'] = false;
        modulesToSet['enableEnterpriseFeatures'] = true;
      }
      if (verticalKey === 'warehousing') {
        modulesToSet['posModuleEnabled'] = false;
        modulesToSet['inventoryModuleEnabled'] = true;
        modulesToSet['purchasesModuleEnabled'] = true;
        modulesToSet['enableEnterpriseFeatures'] = true;
      }

      // Ensure foundational operational defaults
      if (effectiveFeatures.has('purchases')) {
        modulesToSet['purchasesModuleEnabled'] = true;
        modulesToSet['comboModuleEnabled'] = true;
      }
      if (effectiveFeatures.has('inventory')) {
        // In maritime freight and pure consulting services, physical inventory is disabled
        modulesToSet['inventoryModuleEnabled'] = !['maritime_freight', 'services'].includes(verticalKey);
      }
      if (effectiveFeatures.has('sales')) {
        if (!isNonRetailVertical) {
          modulesToSet['posModuleEnabled'] = true;
          modulesToSet['weightedBarcodeEnabled'] = (verticalKey === 'supermarket');
        } else {
          // For non-retail verticals (maritime, contracting, wholesale van, services),
          // 'sales' represents client invoicing / contracts / IPCs, NEVER retail POS or barcode scales!
          modulesToSet['posModuleEnabled'] = false;
          modulesToSet['weightedBarcodeEnabled'] = false;
        }
      }

      // --- Revoke what this sync itself granted, and nothing else.
      //
      // These `*ModuleEnabled` keys are the TENANT's own operational switches (the apps
      // store screen), not the entitlement gate — paid access is enforced by
      // PermissionsGuard + @RequireFeature against tenants.plan_id, which a downgrade
      // already revokes. So this sync must not behave like an authority over them: it may
      // only take back a switch that it turned on itself for a plan that no longer grants
      // it, and must leave anything the tenant toggled by hand alone.
      //
      // Provenance lives in a marker key holding exactly what the last sync set.
      const previouslyGranted = await this.readPlanManagedModuleKeys(tenantId);
      const desiredKeys = Object.keys(modulesToSet);
      const desiredSet = new Set(desiredKeys);
      const toRevoke = previouslyGranted.filter((key) => !desiredSet.has(key));

      for (const key of toRevoke) {
        modulesToSet[key] = false;
      }

      for (const [key, value] of Object.entries(modulesToSet)) {
        await sql`
          INSERT INTO settings (key, value, tenant_id, account_id)
          VALUES (${key}, ${JSON.stringify(value)}, ${tenantId}, ${accountId})
          ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id
        `.execute(this.db);
      }

      // Record what this run granted, so the next one knows what is its to take back.
      await sql`
        INSERT INTO settings (key, value, tenant_id, account_id)
        VALUES (${PLAN_MANAGED_MODULES_SETTING_KEY}, ${JSON.stringify(desiredKeys.sort())}, ${tenantId}, ${accountId})
        ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id
      `.execute(this.db);

      this.settingsService.invalidateSettingsCache(tenantId);
      this.settingsService.invalidatePlanFeaturesCache(tenantId);
    } catch (err) {
      // Not fatal — a failed switch sync must not roll back the plan change itself, which
      // is what actually governs access. But it is not silent either: swallowing this
      // whole is forbidden pattern F7, and it used to hide the plan change appearing to
      // succeed while the tenant's module switches never moved.
      console.error(
        `[syncTenantModuleSettingsForPlan] failed for tenant ${tenantId} (plan ${planId ?? 'none'}); ` +
        `module switches may be out of step with the plan.`,
        err,
      );
    }
  }

  public async syncTenantSubscriptionPlan(tenantId: string, planId: string): Promise<void> {
    try {
      const cleanPlan = planId.trim();
      const codeUpper = cleanPlan.replace(/^plan_/, '').toUpperCase();
      const targetPlan = await this.db
        .selectFrom('saas_plans')
        .select(['id', 'max_users', 'code'])
        .where((eb) =>
          eb.or([
            eb('feature_plan_id', '=', cleanPlan),
            eb('code', '=', codeUpper),
            eb(sql<string>`LOWER(code)`, '=', cleanPlan.toLowerCase()),
          ]),
        )
        .where('is_active', '=', true)
        .executeTakeFirst();

      if (targetPlan) {
        await this.db
          .updateTable('tenant_subscriptions')
          .set({
            plan_id: targetPlan.id,
            updated_at: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('status', 'in', ['active', 'past_due'])
          .execute();
      }
    } catch (err) {
      console.error(`[syncTenantSubscriptionPlan] failed for tenant ${tenantId} (plan ${planId}):`, err);
    }
  }

  /**
   * The module keys the last plan sync turned on for this tenant. Anything outside this
   * list was switched on by the tenant, and is not this sync's to switch off.
   */
  private async readPlanManagedModuleKeys(tenantId: string): Promise<string[]> {
    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', PLAN_MANAGED_MODULES_SETTING_KEY)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!row?.value) return [];

    try {
      const parsed = JSON.parse(String(row.value));
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      // A corrupt marker must not cause a revocation sweep — treat it as "nothing is mine".
      return [];
    }
  }

  private sharedCookieDomain(): string | undefined {
    const domain = this.configService.get<string>('SESSION_COOKIE_DOMAIN')?.trim();
    return domain || undefined;
  }

  private cookieOptions(expiresAt?: Date) {
    return {
      httpOnly: true,
      sameSite: this.configService.get<'lax' | 'strict' | 'none'>('SESSION_COOKIE_SAME_SITE') ?? 'lax',
      secure: this.configService.get<boolean>('SESSION_COOKIE_SECURE') === true,
      expires: expiresAt,
      path: '/',
      ...(this.sharedCookieDomain() ? { domain: this.sharedCookieDomain() } : {}),
    };
  }

  private csrfCookieOptions(expiresAt?: Date) {
    return {
      httpOnly: false,
      sameSite: this.configService.get<'lax' | 'strict' | 'none'>('SESSION_COOKIE_SAME_SITE') ?? 'lax',
      secure: this.configService.get<boolean>('SESSION_COOKIE_SECURE') === true,
      expires: expiresAt,
      path: '/',
      ...(this.sharedCookieDomain() ? { domain: this.sharedCookieDomain() } : {}),
    };
  }

  private getSessionCookieName(): string {
    return this.configService.get<string>('SESSION_COOKIE_NAME')?.trim() || 'session_id';
  }

  private getCsrfCookieName(): string {
    return this.configService.get<string>('SESSION_CSRF_COOKIE_NAME')?.trim() || 'csrf_token';
  }

  setAuthCookies(res: Response, sessionId: string, expiresAt: Date): void {
    const csrfSecret = this.configService.get<string>('SESSION_CSRF_SECRET') || '';
    const csrfToken = createCsrfToken(sessionId, csrfSecret);
    res.cookie(this.getSessionCookieName(), sessionId, this.cookieOptions(expiresAt));
    res.cookie(this.getCsrfCookieName(), csrfToken, this.csrfCookieOptions(expiresAt));
  }

  async impersonateTenant(
    tenantId: string,
    auth: AuthContext,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ sessionId: string; expiresAt: Date; auth: AuthContext; originalSessionId: string }> {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(tenantId);
    this.assertNotPlatformTenantTarget(tenant.id);

    if (tenant.status === 'suspended') {
      throw new BadRequestException('لا يمكن الدخول لنسخة موقوفة. قم بتفعيل النسخة أولاً.');
    }

    const owner = await this.getOwnerUserForTenant(tenant.id);
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    await this.db
      .insertInto('sessions')
      .values({
        id: sessionId,
        user_id: owner.id,
        tenant_id: tenant.id,
        account_id: owner.account_id || `${tenant.id}:main`,
        expires_at: expiresAt,
        last_seen_at: now,
        ip_address: meta?.ipAddress?.slice(0, 255) || '',
        user_agent: meta?.userAgent?.slice(0, 500) || '',
        // Stamps the session as borrowed. resolveAuthContext carries this onto every
        // request's AuthContext, and AuditService writes it onto every row — so what this
        // platform admin does inside the customer's books stays attributable to them (O34).
        impersonated_by: auth.userId,
      })
      .execute();

    await this.audit.log(
      'تصفح نسخة كمالك',
      `قام مسؤول المنصة (${auth.username}) ببدء جلسة تصفح كمالك للنسخة: ${tenant.slug} (${tenant.id})`,
      auth,
      {
        targetTenantId: tenant.id,
        eventCode: AUDIT_EVENT_CODES.SAAS_IMPERSONATION_STARTED,
      },
    );

    const impersonatedAuth = await this.sessionService.resolveAuthContext(sessionId);
    if (!impersonatedAuth) {
      throw new BadRequestException('تعذر إنشاء جلسة التصفح للنسخة.');
    }

    return {
      sessionId,
      expiresAt,
      auth: impersonatedAuth,
      originalSessionId: auth.sessionId,
    };
  }

  async exitImpersonation(
    originalSessionId: string | undefined,
    currentAuth: AuthContext,
  ): Promise<{ sessionId: string; expiresAt: Date; auth: AuthContext }> {
    if (!originalSessionId || !originalSessionId.trim()) {
      throw new BadRequestException('معرف الجلسة الأصلية غير متوفر.');
    }

    const normalizedOriginalSessionId = originalSessionId.trim();
    const originalAuth = await this.sessionService.resolveAuthContext(normalizedOriginalSessionId);
    if (!originalAuth) {
      throw new ForbiddenException('جلسة مسؤول المنصة الأصلية غير صالحة أو منتهية. يرجى تسجيل الدخول مجدداً.');
    }

    this.assertPlatformAccess(originalAuth);

    // Clean up current temporary impersonation session if distinct
    if (currentAuth.sessionId && currentAuth.sessionId !== normalizedOriginalSessionId) {
      await this.db.deleteFrom('sessions').where('id', '=', currentAuth.sessionId).execute();
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.audit.log(
      'إنهاء تصفح نسخة',
      `تم إنهاء جلسة تصفح النسخة والعودة للوحة تحكم المنصة بواسطة (${originalAuth.username})`,
      originalAuth,
      {
        targetTenantId: originalAuth.tenantId,
        eventCode: AUDIT_EVENT_CODES.SAAS_IMPERSONATION_ENDED,
      },
    );

    return {
      sessionId: normalizedOriginalSessionId,
      expiresAt,
      auth: originalAuth,
    };
  }

  async buildLoginPayload(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.sessionService.buildLoginPayload(auth);
  }

  async seedTenantDemo(
    tenantId: string,
    body: { activityType?: string; wipeExisting?: boolean; seedSales?: boolean; seedOnlineOrders?: boolean },
    auth: AuthContext,
  ) {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(tenantId);
    this.assertNotPlatformTenantTarget(tenant.id);
    return this.demoDataService.seedTenantDemoData(tenant.id, body, auth);
  }

  async wipeTenantData(tenantId: string, superAdminPassword: string, auth: AuthContext) {
    this.assertPlatformAccess(auth);
    const tenant = await this.getTenantForMutation(tenantId);
    this.assertNotPlatformTenantTarget(tenant.id);
    return this.demoDataService.wipeTenantData(tenant.id, superAdminPassword, auth);
  }
}
