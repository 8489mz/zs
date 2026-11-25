import type { Kysely, Selectable } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { type AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import type { ConfigService } from '@nestjs/config';
import { SESSION_TTL_MS, type SessionService } from '../../../core/auth/services/session.service';
import type { SettingsDemoDataService } from '../../settings/services/settings-demo-data.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createCsrfToken } from '../../../core/auth/utils/csrf-token';
import type { Response } from 'express';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

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

export interface SaasAdminSessionBoundDeps {
  assertPlatformAccess: (auth: AuthContext) => void;
  getTenantForMutation: (id: string) => Promise<Selectable<Database['tenants']>>;
  assertNotPlatformTenantTarget: (targetTenantId: string) => void;
  getOwnerUserForTenant: (tenantId: string) => Promise<OwnerUserRow>;
}

export class SaasAdminSession {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
    private readonly demoDataService: SettingsDemoDataService,
    private readonly bound: SaasAdminSessionBoundDeps,
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
  private async getOwnerUserForTenant(tenantId: string): Promise<OwnerUserRow> {
    return this.bound.getOwnerUserForTenant(tenantId);
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
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS); // 7 days — same TTL as regular sessions (S1)

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

    // Return the original session's real stored expiry (as resolved — and
    // possibly renewed — by resolveAuthContext, S2), never a freshly
    // computed 30 days: this value becomes the cookie expiry.
    const expiresAt = originalAuth.expiresAt ?? new Date(Date.now() + SESSION_TTL_MS);

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
