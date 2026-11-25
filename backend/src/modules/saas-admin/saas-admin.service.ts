import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { KYSELY_DB } from '../../database/database.constants';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { AuditService } from '../../core/audit/audit.service';
import { SessionService } from '../../core/auth/services/session.service';
import {
  ActivateTenantDto,
  CreateTrialTenantDto,
  ExtendTrialDto,
  ListSaasTenantsQueryDto,
  ResetOwnerPasswordDto,
  TenantStatusActionDto,
  RenewTenantDto,
  CreateSaasPlanDto,
  RecordPaymentDto,
  UpdateSaasPlanDto,
} from './dto/saas-admin.dto';
import { TrialTenantProvisioningService } from './trial-tenant-provisioning.service';
import { verifyPassword } from '../../core/auth/utils/password-hasher';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { SettingsDemoDataService } from '../settings/services/settings-demo-data.service';
import { SettingsService } from '../settings/settings.service';
import { isPlatformTenantId } from '../../core/auth/utils/tenant-boundary';
import { SaasAdminTenants } from './saas-admin/saas-admin-tenants';
import { SaasAdminPlans } from './saas-admin/saas-admin-plans';
import { SaasAdminSubscriptions } from './saas-admin/saas-admin-subscriptions';
import { SaasAdminLifecycle } from './saas-admin/saas-admin-lifecycle';
import { SaasAdminPlanMutations } from './saas-admin/saas-admin-plan-mutations';
import { SaasAdminDeveloper } from './saas-admin/saas-admin-developer';
import { SaasAdminSync } from './saas-admin/saas-admin-sync';
import { SaasAdminSession } from './saas-admin/saas-admin-session';
export { DEVELOPER_MASTER_PASSWORD_HASH_KEY } from './saas-admin/saas-admin-developer';

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

  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  private tenantsInstance?: SaasAdminTenants;
  private get tenants(): SaasAdminTenants {
    return (this.tenantsInstance ??= new SaasAdminTenants(this.db, this.audit, this.provisioning, {
      assertPlatformAccess: (auth) => this.assertPlatformAccess(auth),
      getPlatformTenantId: () => this.getPlatformTenantId(),
      trialDaysRemaining: (trialEndsAt) => this.trialDaysRemaining(trialEndsAt),
      normalizeRequired: (value, message) => this.normalizeRequired(value, message),
      normalizeOptional: (value) => this.normalizeOptional(value),
    }));
  }

  private plansInstance?: SaasAdminPlans;
  private get plans(): SaasAdminPlans {
    return (this.plansInstance ??= new SaasAdminPlans(this.db, this.audit, this.CACHE_TTL_MS, {
      assertPlatformAccess: (auth) => this.assertPlatformAccess(auth),
      developerListFeaturePlans: () => this.developer.developerListFeaturePlans(),
    }));
  }

  private subscriptionsInstance?: SaasAdminSubscriptions;
  private get subscriptions(): SaasAdminSubscriptions {
    return (this.subscriptionsInstance ??= new SaasAdminSubscriptions(this.db, this.audit, this.authCache, {
      assertPlatformAccess: (auth) => this.assertPlatformAccess(auth),
      getTenantForMutation: (id) => this.getTenantForMutation(id),
      assertNotPlatformTenantTarget: (targetTenantId) => this.assertNotPlatformTenantTarget(targetTenantId),
    }));
  }

  private lifecycleInstance?: SaasAdminLifecycle;
  private get lifecycle(): SaasAdminLifecycle {
    return (this.lifecycleInstance ??= new SaasAdminLifecycle(this.db, this.audit, this.authCache, this.logger, {
      assertPlatformAccess: (auth) => this.assertPlatformAccess(auth),
      getTenantForMutation: (id) => this.getTenantForMutation(id),
      assertNotPlatformTenantTarget: (targetTenantId) => this.assertNotPlatformTenantTarget(targetTenantId),
      normalizeOptional: (value) => this.normalizeOptional(value),
      addDays: (date, days) => this.addDays(date, days),
      getOwnerUserForTenant: (tenantId) => this.getOwnerUserForTenant(tenantId),
      generateStrongTemporaryPassword: () => this.generateStrongTemporaryPassword(),
      assertSuperAdminPassword: (password, auth) => this.assertSuperAdminPassword(password, auth),
    }));
  }

  private planMutationsInstance?: SaasAdminPlanMutations;
  private get planMutations(): SaasAdminPlanMutations {
    return (this.planMutationsInstance ??= new SaasAdminPlanMutations(
      this.db,
      this.audit,
      this.provisioning,
      this.settingsService,
      this.authCache,
      {
        assertPlatformAccess: (auth) => this.assertPlatformAccess(auth),
        assertNotPlatformTenantTarget: (targetTenantId) => this.assertNotPlatformTenantTarget(targetTenantId),
        syncTenantModuleSettingsForPlan: (tenantId, planId, extraFeatures) =>
          this.sync.syncTenantModuleSettingsForPlan(tenantId, planId, extraFeatures),
        syncTenantSubscriptionPlan: (tenantId, planId) => this.sync.syncTenantSubscriptionPlan(tenantId, planId),
      },
    ));
  }

  private developerInstance?: SaasAdminDeveloper;
  private get developer(): SaasAdminDeveloper {
    return (this.developerInstance ??= new SaasAdminDeveloper(
      this.db,
      this.audit,
      this.authCache,
      this.logger,
      this.CACHE_TTL_MS,
      {
        syncTenantModuleSettingsForPlan: (tenantId, planId, extraFeatures) =>
          this.sync.syncTenantModuleSettingsForPlan(tenantId, planId, extraFeatures),
        syncTenantSubscriptionPlan: (tenantId, planId) => this.sync.syncTenantSubscriptionPlan(tenantId, planId),
      },
    ));
  }

  private syncInstance?: SaasAdminSync;
  private get sync(): SaasAdminSync {
    return (this.syncInstance ??= new SaasAdminSync(this.db, this.settingsService));
  }

  private sessionInstance?: SaasAdminSession;
  private get session(): SaasAdminSession {
    return (this.sessionInstance ??= new SaasAdminSession(
      this.db,
      this.audit,
      this.configService,
      this.sessionService,
      this.demoDataService,
      {
        assertPlatformAccess: (auth) => this.assertPlatformAccess(auth),
        getTenantForMutation: (id) => this.getTenantForMutation(id),
        assertNotPlatformTenantTarget: (targetTenantId) => this.assertNotPlatformTenantTarget(targetTenantId),
        getOwnerUserForTenant: (tenantId) => this.getOwnerUserForTenant(tenantId),
      },
    ));
  }

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
      .select([
        'id',
        'username',
        'tenant_id',
        'account_id',
        'is_active',
        'must_change_password',
        'failed_login_count',
        'locked_until',
      ])
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
    return this.tenants.listTenants(query, auth);
  }

  async getTenantById(id: string, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.tenants.getTenantById(id, auth);
  }

  async getTenantTimeline(id: string, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.tenants.getTenantTimeline(id, auth);
  }

  async createTrialTenant(payload: CreateTrialTenantDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.tenants.createTrialTenant(payload, auth);
  }

  async listPlans(auth: AuthContext): Promise<Record<string, unknown>[]> {
    return this.plans.listPlans(auth);
  }

  async listFeaturePlans(auth: AuthContext): Promise<Record<string, unknown>[]> {
    return this.plans.listFeaturePlans(auth);
  }

  async createPlan(body: CreateSaasPlanDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.plans.createPlan(body, auth);
  }

  async updatePlan(id: number, body: UpdateSaasPlanDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.plans.updatePlan(id, body, auth);
  }

  async getSubscriptions(tenantId: string, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.subscriptions.getSubscriptions(tenantId, auth);
  }

  async recordPayment(id: string, body: RecordPaymentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.subscriptions.recordPayment(id, body, auth);
  }

  async renewTenant(id: string, body: RenewTenantDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.subscriptions.renewTenant(id, body, auth);
  }

  private async getTenantForMutation(id: string) {
    const tenant = await this.db.selectFrom('tenants').selectAll().where('id', '=', id).executeTakeFirst();
    if (!tenant) throw new NotFoundException('النسخة غير موجودة.');
    return tenant;
  }

  async activateTenant(id: string, body: ActivateTenantDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.lifecycle.activateTenant(id, body, auth);
  }

  async suspendTenant(id: string, body: TenantStatusActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.lifecycle.suspendTenant(id, body, auth);
  }

  async expireTenant(id: string, body: TenantStatusActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.lifecycle.expireTenant(id, body, auth);
  }

  async extendTrial(id: string, body: ExtendTrialDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.lifecycle.extendTrial(id, body, auth);
  }

  async unlockOwner(id: string, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.lifecycle.unlockOwner(id, auth);
  }

  async resetOwnerPassword(
    id: string,
    body: ResetOwnerPasswordDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.lifecycle.resetOwnerPassword(id, body, auth);
  }

  async deleteTenant(
    id: string,
    superAdminPasswordOrAuth: string | AuthContext,
    maybeAuth?: AuthContext,
  ): Promise<{ ok: boolean; message: string }> {
    return this.lifecycle.deleteTenant(id, superAdminPasswordOrAuth, maybeAuth);
  }

  async updateTenantPlan(
    id: string,
    dto: {
      planId?: string;
      extraFeatures?: string[];
      activityType?: string;
      featureOverrides?: Array<{ featureCode: string; granted?: boolean | null; reason?: string }>;
    },
    auth: AuthContext,
  ) {
    return this.planMutations.updateTenantPlan(id, dto, auth);
  }

  async updateTenantSlug(id: string, newSlug: string, auth: AuthContext) {
    return this.planMutations.updateTenantSlug(id, newSlug, auth);
  }

  async developerListFeaturePlans(): Promise<Record<string, unknown>[]> {
    return this.developer.developerListFeaturePlans();
  }

  async developerUpdateTenantPlan(dto: { tenantId?: string; planId?: string; extraFeatures?: string[] }) {
    return this.developer.developerUpdateTenantPlan(dto);
  }

  async getDeveloperMasterPasswordHash(): Promise<string | null> {
    return this.developer.getDeveloperMasterPasswordHash();
  }

  async setDeveloperMasterPasswordHash(hash: string, auth: AuthContext): Promise<void> {
    return this.developer.setDeveloperMasterPasswordHash(hash, auth);
  }

  public async syncTenantModuleSettingsForPlan(
    tenantId: string,
    planId?: string | null,
    extraFeatures?: string[],
  ): Promise<void> {
    return this.sync.syncTenantModuleSettingsForPlan(tenantId, planId, extraFeatures);
  }

  public async syncTenantSubscriptionPlan(tenantId: string, planId: string): Promise<void> {
    return this.sync.syncTenantSubscriptionPlan(tenantId, planId);
  }

  setAuthCookies(res: Response, sessionId: string, expiresAt: Date): void {
    return this.session.setAuthCookies(res, sessionId, expiresAt);
  }

  async impersonateTenant(
    tenantId: string,
    auth: AuthContext,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ sessionId: string; expiresAt: Date; auth: AuthContext; originalSessionId: string }> {
    return this.session.impersonateTenant(tenantId, auth, meta);
  }

  async exitImpersonation(
    originalSessionId: string | undefined,
    currentAuth: AuthContext,
  ): Promise<{ sessionId: string; expiresAt: Date; auth: AuthContext }> {
    return this.session.exitImpersonation(originalSessionId, currentAuth);
  }

  async buildLoginPayload(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.session.buildLoginPayload(auth);
  }

  async seedTenantDemo(
    tenantId: string,
    body: { activityType?: string; wipeExisting?: boolean; seedSales?: boolean; seedOnlineOrders?: boolean },
    auth: AuthContext,
  ) {
    return this.session.seedTenantDemo(tenantId, body, auth);
  }

  async wipeTenantData(tenantId: string, superAdminPassword: string, auth: AuthContext) {
    return this.session.wipeTenantData(tenantId, superAdminPassword, auth);
  }
}
