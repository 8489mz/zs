import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { createPasswordRecord, verifyPassword } from '../utils/password-hasher';
import { assertStrongPassword } from '../utils/password-policy';
import { signPortalToken, verifyPortalToken, type PortalTokenErrorSpec } from '../utils/portal-token';
import { verifyTotpCode } from '../utils/totp';
import { decryptMfaSecret, hashRecoveryCode } from '../utils/mfa-secret-cipher';
import { resolveTenantContext } from '../utils/tenant-context';
import { isPlatformTenantId, requireTenantScope } from '../utils/tenant-boundary';
import { SUPER_ADMIN_PERMISSIONS } from '../constants/super-admin-permissions';
import { generatePhoneSearchVariants } from '../../utils/phone-utils';
import { AuthCacheService } from './auth-cache.service';
import { getIndustryProfile, resolvePillarScopedFeatures } from '../../tenant/industry-profiles';

function safeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [trimmed];
    }
  }
  return [];
}

function toNonEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * التحدي الذي يُعاد بعد كلمة مرور صحيحة لحساب مفعَّل عليه العامل الثاني. موقَّع بـ`portal-token.ts`
 * (لا `createHmac` خام — §2.5) ويحمل `kind` مميَّزاً حتى لا يُقبل رمز بوابة موظف مكانه.
 * خمس دقائق: مدة كافية لفتح تطبيق المصادقة، قصيرة بما يكفي ألّا تكون بديلاً عن الجلسة.
 */
const MFA_CHALLENGE_KIND = 'mfa-challenge';
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MFA_CHALLENGE_ERRORS: PortalTokenErrorSpec = {
  missing: { message: 'انتهت جلسة التحقق. أعد تسجيل الدخول.', code: 'MFA_CHALLENGE_INVALID' },
  invalid: { message: 'انتهت جلسة التحقق. أعد تسجيل الدخول.', code: 'MFA_CHALLENGE_INVALID' },
  signature: { message: 'انتهت جلسة التحقق. أعد تسجيل الدخول.', code: 'MFA_CHALLENGE_INVALID' },
  expired: { message: 'انتهت مهلة التحقق. أعد تسجيل الدخول.', code: 'MFA_CHALLENGE_EXPIRED' },
};

export type MfaChallengeResult = { mfaRequired: true; mfaToken: string; username: string };
export type AuthenticatedSessionResult = { sessionId: string; auth: AuthContext; expiresAt: Date };
export type AuthenticateResult = AuthenticatedSessionResult | MfaChallengeResult;

/** يميّز التحدي عن الجلسة الجاهزة في نتيجة `authenticate`. */
export function isMfaChallenge(result: AuthenticateResult | null): result is MfaChallengeResult {
  return Boolean(result && (result as MfaChallengeResult).mfaRequired === true);
}

/** An enabled mandatory platform MFA policy cannot be bypassed by unenrolled accounts. */
export function requiresPlatformMfaEnrolment(
  tenantId: string, role: string, enrolled: boolean, env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.MFA_REQUIRED_FOR_PLATFORM || '').trim().toLowerCase() === 'true'
    && isPlatformTenantId(tenantId)
    && ['super_admin', 'admin'].includes(role)
    && !enrolled;
}


@Injectable()
export class SessionService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService = new AuthCacheService(),
  ) {}

  private get lockoutConfig() {
    return {
      maxAttempts: this.configService.get<number>('LOGIN_MAX_ATTEMPTS') ?? 5,
      lockoutMinutes: this.configService.get<number>('LOGIN_LOCKOUT_MINUTES') ?? 15,
    };
  }

  private scope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private resolveUserTenantContext(user: { tenant_id?: string | null; account_id?: string | null }): { tenantId: string; accountId: string } {
    const tenantId = toNonEmpty(user.tenant_id);
    const accountId = toNonEmpty(user.account_id);
    if (tenantId || accountId) return resolveTenantContext(this.configService, { tenantId, accountId });
    return resolveTenantContext(this.configService);
  }

  private async assertTenantLoginAllowed(tenantId: string): Promise<void> {
    const normalizedTenantId = toNonEmpty(tenantId);
    if (!normalizedTenantId) return;

    const isPlatformTenant = isPlatformTenantId(normalizedTenantId);
    if (isPlatformTenant) {
      this.authCache.setTenantAllowed(normalizedTenantId, true);
      return;
    }

    // 1. Fast Cache Check: If tenant was recently verified as allowed, skip all DB queries!
    const cachedAllowed = this.authCache.isTenantAllowed(normalizedTenantId);
    if (cachedAllowed === true) return;
    if (cachedAllowed === false) throw new UnauthorizedException('تم إيقاف أو انتهاء اشتراك هذه النسخة.');

    const tenant = await this.db.selectFrom('tenants').select(['id', 'slug', 'status', 'trial_ends_at']).where('id', '=', normalizedTenantId).executeTakeFirst();
    if (!tenant) {
      this.authCache.setTenantAllowed(normalizedTenantId, true);
      return;
    }
    if (tenant.status === 'suspended') {
      this.authCache.setTenantAllowed(normalizedTenantId, false);
      throw new UnauthorizedException('تم إيقاف هذه النسخة. تواصل مع الدعم لتفعيلها.');
    }
    if (tenant.status === 'expired') {
      this.authCache.setTenantAllowed(normalizedTenantId, false);
      throw new UnauthorizedException('انتهى اشتراك هذه النسخة. تواصل معنا لتفعيل الاشتراك.');
    }
    
    const now = new Date();
    if (tenant.status === 'trial' && tenant.trial_ends_at <= now) {
      await this.db.updateTable('tenants').set({ status: 'expired', updated_at: now.toISOString() }).where('id', '=', tenant.id).execute();
      this.authCache.setTenantAllowed(normalizedTenantId, false);
      throw new UnauthorizedException('انتهت الفترة التجريبية لهذه النسخة. تواصل معنا لتفعيل الاشتراك.');
    }

    if (tenant.status === 'active') {
      const subscription = await this.db
        .selectFrom('tenant_subscriptions')
        .selectAll()
        .where('tenant_id', '=', tenant.id)
        .where('status', 'in', ['active', 'past_due'])
        .orderBy('created_at', 'desc')
        .executeTakeFirst();

      if (!subscription) {
        await this.db.updateTable('tenants').set({ status: 'expired', updated_at: now.toISOString() }).where('id', '=', tenant.id).execute();
        this.authCache.setTenantAllowed(normalizedTenantId, false);
        throw new UnauthorizedException('لا يوجد اشتراك فعال لهذه النسخة. تواصل معنا لتفعيل الاشتراك.');
      }

      if (subscription.ends_at <= now) {
        const graceEndsAt = subscription.grace_ends_at ? new Date(subscription.grace_ends_at) : subscription.ends_at;
        if (graceEndsAt <= now) {
          await this.db.transaction().execute(async (trx) => {
            await trx.updateTable('tenant_subscriptions').set({ status: 'expired', updated_at: now.toISOString() }).where('id', '=', subscription.id).where('tenant_id', '=', tenant.id).execute();
            await trx.updateTable('tenants').set({ status: 'expired', updated_at: now.toISOString() }).where('id', '=', tenant.id).execute();
          });
          this.authCache.setTenantAllowed(normalizedTenantId, false);
          throw new UnauthorizedException('انتهى اشتراك هذه النسخة وانتهت فترة السماح. تواصل معنا لتفعيل الاشتراك.');
        } else if (subscription.status === 'active') {
          await this.db.updateTable('tenant_subscriptions').set({ status: 'past_due', updated_at: now.toISOString() }).where('id', '=', subscription.id).where('tenant_id', '=', tenant.id).execute();
        }
      }
    }

    // Cache success: tenant is verified and active!
    this.authCache.setTenantAllowed(normalizedTenantId, true);
  }

  private async getTenantPayload(auth: AuthContext): Promise<Record<string, unknown> | null> {
    const { tenantId, accountId } = this.scope(auth);

    // Fast Cache Check
    const cached = this.authCache.getTenantPayload(tenantId);
    if (cached) return cached;

    const tenant = await this.db
      .selectFrom('tenants')
      .select(['id', 'slug', 'business_name', 'status', 'trial_ends_at', 'created_at', 'plan_id', 'extra_features', 'activity_type'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    if (!tenant) {
      const fallback = { id: tenantId, accountId, slug: tenantId, businessName: '', status: 'active', isTrial: false, trialEndsAt: null, trialDaysRemaining: null, features: [] };
      this.authCache.setTenantPayload(tenantId, fallback);
      return fallback;
    }

    const trialEndsAt = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
    const now = Date.now();
    const trialDaysRemaining = tenant.status === 'trial' && trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000)))
      : null;

    const FALLBACK_PLAN_FEATURES: Record<string, string[]> = {
      plan_basic: ['sales', 'catalog', 'sessions', 'cashDrawer'],
      plan_pro: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'services'],
      plan_ultimate: [
        'sales', 'catalog', 'sessions', 'cashDrawer',
        'purchases', 'inventory', 'reports', 'services',
        'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
        'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
        'manufacturing', 'import', 'pharmacy', 'maritime_freight', 'contracting',
      ],
      plan_omnichannel: [
        'sales', 'catalog', 'sessions', 'cashDrawer',
        'purchases', 'inventory', 'reports', 'services',
        'hr', 'deliveryReps', 'loyalty', 'maintenance', 'clothing', 'restaurant',
        'accounting', 'fixed_assets', 'installments', 'taxIntegration', 'vat_declaration',
        'manufacturing', 'import', 'pharmacy', 'maritime_freight', 'contracting',
        'storefront',
      ],
    };

    let planFeatures: string[] = [];
    let effectivePlanId = tenant.plan_id;
    if (!effectivePlanId) {
      try {
        const activeSub = await this.db
          .selectFrom('tenant_subscriptions as s')
          .leftJoin('saas_plans as p', 'p.id', 's.plan_id')
          .select(['p.feature_plan_id'])
          .where('s.tenant_id', '=', tenant.id)
          .where('s.status', 'in', ['active', 'past_due'])
          .orderBy('s.created_at', 'desc')
          .executeTakeFirst();
        if (activeSub?.feature_plan_id) {
          effectivePlanId = activeSub.feature_plan_id;
        } else {
          effectivePlanId = 'plan_basic';
        }
      } catch {
        effectivePlanId = 'plan_basic';
      }
    }

    try {
      const pFeatures = await this.db.selectFrom('plan_features').select('feature_code').where('plan_id', '=', effectivePlanId).execute();
      planFeatures = pFeatures.map(f => f.feature_code);
    } catch {
      planFeatures = [];
    }

    if (planFeatures.length === 0 && FALLBACK_PLAN_FEATURES[effectivePlanId]) {
      planFeatures = FALLBACK_PLAN_FEATURES[effectivePlanId];
    }
    
    const extraFeatures = Array.isArray(tenant.extra_features) ? tenant.extra_features : typeof tenant.extra_features === 'string' ? JSON.parse(tenant.extra_features) : [];
    const profile = getIndustryProfile(tenant.activity_type);
    const activeFeatures = resolvePillarScopedFeatures(
      tenant.activity_type,
      planFeatures,
      extraFeatures,
    );

    const payload = {
      id: tenant.id,
      accountId,
      slug: tenant.slug || tenant.id,
      businessName: tenant.business_name || '',
      activityType: profile.key,
      pillar: profile.pillar,
      status: tenant.status || 'active',
      isTrial: tenant.status === 'trial',
      trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
      trialDaysRemaining,
      features: activeFeatures,
      planId: effectivePlanId ? String(effectivePlanId) : null,
      extraFeatures: extraFeatures,
      createdAt: tenant.created_at || null,
    };

    this.authCache.setTenantPayload(tenantId, payload);
    return payload;
  }

  async resolveAuthContext(sessionId: string): Promise<AuthContext | null> {
    if (!sessionId) return null;

    // Fast Cache Check: If session is valid in memory cache, return immediately without hitting DB!
    const cachedAuth = this.authCache.getSession(sessionId);
    if (cachedAuth) {
      return cachedAuth;
    }

    const row = await this.db
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .leftJoin('tenants as t', 't.id', 's.tenant_id')
      .select(['s.id as session_id', 's.user_id as session_user_id', 's.tenant_id as session_tenant_id', 's.account_id as session_account_id', 's.expires_at', 's.impersonated_by as session_impersonated_by', 'u.id as user_id', 'u.username', 'u.role', 'u.permissions_json', 'u.is_active', 'u.locked_until', 'u.tenant_id', 'u.account_id', 't.plan_id', 't.extra_features', 't.activity_type'])
      .where('s.id', '=', sessionId)
      .executeTakeFirst();
    if (!row) return null;
    if (Number(row.session_user_id || 0) !== Number(row.user_id || 0)) return null;
    if (toNonEmpty(row.session_tenant_id) !== toNonEmpty(row.tenant_id)) return null;
    if (toNonEmpty(row.session_account_id) !== toNonEmpty(row.account_id)) return null;
    if (!row.is_active) return null;
    if (row.expires_at <= new Date()) return null;
    if (row.locked_until && row.locked_until > new Date()) return null;
    const tenantContext = this.resolveUserTenantContext(row);
    try { await this.assertTenantLoginAllowed(tenantContext.tenantId); } catch { return null; }
    const isPlatformTenant = isPlatformTenantId(tenantContext.tenantId);
    const effectiveRole = (row.role === 'super_admin' && !isPlatformTenant) ? 'admin' : row.role;
    const permissions = effectiveRole === 'super_admin' ? Array.from(new Set([...SUPER_ADMIN_PERMISSIONS, ...safeJsonArray(row.permissions_json)])) : safeJsonArray(row.permissions_json);
    const profile = getIndustryProfile(row.activity_type);
    const auth: AuthContext = {
      userId: row.user_id,
      sessionId: row.session_id,
      username: row.username,
      role: effectiveRole,
      permissions,
      planId: row.plan_id || undefined,
      extraFeatures: safeJsonArray(row.extra_features),
      activityType: profile.key,
      pillar: profile.pillar,
      // Comes from the session row, never from the request: this is what makes an action
      // taken during impersonation attributable to the platform admin (O34).
      impersonatedBy: row.session_impersonated_by ?? null,
      ...tenantContext,
    };

    // Cache the resolved auth context!
    // A cached authorization must never outlive the underlying session row.
    this.authCache.setSession(sessionId, auth, Math.min(60, (row.expires_at.getTime() - Date.now()) / 1000));
    return auth;

  }

  async authenticate(
    identifier: string,
    password: string,
    meta?: { ipAddress?: string; userAgent?: string; companyCode?: string },
  ): Promise<AuthenticateResult | null> {
    const normalized = identifier.trim();
    const rawCompanyCode = meta?.companyCode?.trim();
    let resolvedTenantId = rawCompanyCode;

    const appMode = this.configService.get<string>('APP_MODE') || process.env.APP_MODE || 'CLOUD_SAAS';
    const isDesktop = (appMode === 'SELF_CONTAINED' || process.env.PORTABLE_MODE === 'true' || process.env.IS_ELECTRON === 'true') && appMode !== 'CLOUD_SAAS';

    if (rawCompanyCode) {
      try {
        const tenantMatch = await this.db
          .selectFrom('tenants')
          .select(['id', 'slug'])
          .where((eb) => eb.or([eb('id', '=', rawCompanyCode), eb('slug', '=', rawCompanyCode)]))
          .executeTakeFirst();
        if (tenantMatch?.id) {
          resolvedTenantId = tenantMatch.id;
        }
      } catch {
        // fallback to rawCompanyCode
      }
    } else if (isDesktop) {
      // In offline/desktop mode with single-tenant store, resolve to local tenant only if no explicit companyCode is provided
      try {
        const configuredDesktopTenant = (this.configService.get<string>('TENANT_ID') || process.env.TENANT_ID || '').trim();
        if (configuredDesktopTenant) {
          resolvedTenantId = configuredDesktopTenant;
        } else {
          const localTenant = await this.db
            .selectFrom('tenants')
            .select(['id', 'slug'])
            .where('id', '!=', 'zs')
            .orderBy('created_at', 'asc')
            .executeTakeFirst();
          resolvedTenantId = localTenant?.id || 'default';
        }
      } catch {
        resolvedTenantId = (this.configService.get<string>('TENANT_ID') || process.env.TENANT_ID || 'default').trim();
      }
    }

    let user: {
      id: number;
      username: string;
      phone?: string | null;
      password_hash: string;
      password_salt: string;
      role: 'super_admin' | 'admin' | 'cashier';
      permissions_json: string;
      is_active: boolean;
      locked_until: Date | null;
      failed_login_count: number;
      tenant_id: string;
      account_id: string;
    } | undefined;

    if (normalized.includes('@')) {
      let query = this.db
        .selectFrom('users as u')
        .innerJoin('tenants as t', 't.id', 'u.tenant_id')
        .select([
          'u.id',
          'u.username',
          'u.phone',
          'u.password_hash',
          'u.password_salt',
          'u.role',
          'u.permissions_json',
          'u.is_active',
          'u.locked_until',
          'u.failed_login_count',
          'u.tenant_id',
          'u.account_id',
        ])
        .where(sql<string>`LOWER(COALESCE(t.owner_email, ''))`, '=', normalized.toLowerCase())
        .where('u.is_active', '=', true)
        .where('u.role', 'in', ['admin', 'super_admin']);

      if (resolvedTenantId) {
        query = query.where('u.tenant_id', '=', resolvedTenantId);
      }

      const matchedByEmail = await query.orderBy('u.id', 'asc').execute();

      if (matchedByEmail.length > 1) {
        throw new UnauthorizedException('تم العثور على أكثر من حساب بهذا البريد. يرجى تسجيل الدخول برقم الهاتف أو اسم المستخدم.');
      }
      user = matchedByEmail[0];
    } else {
      const cleanDigits = normalized.replace(/\D/g, '');
      const isPotentialPhone = cleanDigits.length >= 7 && /^[\d\s\-+]+$/.test(normalized);

      let candidates: Array<any> = [];

      if (isPotentialPhone) {
        const variants = generatePhoneSearchVariants(normalized);

        let phoneQuery = this.db
          .selectFrom('users')
          .select([
            'id',
            'username',
            'phone',
            'password_hash',
            'password_salt',
            'role',
            'permissions_json',
            'is_active',
            'locked_until',
            'failed_login_count',
            'tenant_id',
            'account_id',
          ])
          .where('is_active', '=', true)
          .where('phone', 'in', variants);

        if (resolvedTenantId) {
          phoneQuery = phoneQuery.where('tenant_id', '=', resolvedTenantId);
        }

        candidates = await phoneQuery.execute();

        if (candidates.length === 0 && isDesktop && resolvedTenantId) {
          candidates = await this.db
            .selectFrom('users')
            .select([
              'id',
              'username',
              'phone',
              'password_hash',
              'password_salt',
              'role',
              'permissions_json',
              'is_active',
              'locked_until',
              'failed_login_count',
              'tenant_id',
              'account_id',
            ])
            .where('is_active', '=', true)
            .where('phone', 'in', variants)
            .where('tenant_id', '!=', 'zs')
            .execute();
        }
      }

      // If no candidate found by phone (or identifier was a username), search by username
      if (candidates.length === 0) {
        let userQuery = this.db
          .selectFrom('users')
          .select([
            'id',
            'username',
            'phone',
            'password_hash',
            'password_salt',
            'role',
            'permissions_json',
            'is_active',
            'locked_until',
            'failed_login_count',
            'tenant_id',
            'account_id',
          ])
          .where(sql<boolean>`LOWER(username) = LOWER(${normalized})`)
          .where('is_active', '=', true);

        if (resolvedTenantId) {
          userQuery = userQuery.where('tenant_id', '=', resolvedTenantId);
        }

        candidates = await userQuery.execute();

        if (candidates.length === 0 && isDesktop && resolvedTenantId) {
          candidates = await this.db
            .selectFrom('users')
            .select([
              'id',
              'username',
              'phone',
              'password_hash',
              'password_salt',
              'role',
              'permissions_json',
              'is_active',
              'locked_until',
              'failed_login_count',
              'tenant_id',
              'account_id',
            ])
            .where(sql<boolean>`LOWER(username) = LOWER(${normalized})`)
            .where('is_active', '=', true)
            .where('tenant_id', '!=', 'zs')
            .execute();
        }
      }

      if (candidates.length === 1) {
        user = candidates[0];
      } else if (candidates.length > 1) {
        // Multi-candidate check: check password across candidates concurrently for high performance
        const verificationResults = await Promise.all(
          candidates.map(async (candidate) => {
            const check = await verifyPassword(password, candidate.password_hash, candidate.password_salt);
            return check.valid ? candidate : null;
          }),
        );
        const validCandidates = verificationResults.filter((c): c is NonNullable<typeof c> => c !== null);

        if (validCandidates.length === 1) {
          user = validCandidates[0];
        } else if (validCandidates.length > 1) {
          const candidateTenantIds = Array.from(
            new Set(validCandidates.map((c) => String(c.tenant_id || '').trim())),
          ).filter(Boolean);

          if (isDesktop) {
            user = validCandidates.find((c) => c.tenant_id !== 'zs') || validCandidates[0];
          } else if (candidateTenantIds.length > 1) {
            // Truly multiple tenants: fetch tenant details for the Tenant Switcher
            let tenantRows: any[] = [];
            try {
              tenantRows = await this.db
                .selectFrom('tenants')
                .select(['id', 'slug', 'business_name'])
                .where('id', 'in', candidateTenantIds)
                .execute();
            } catch {
              tenantRows = [];
            }

            const tenantMap = new Map((tenantRows || []).map((t: any) => [t.id, t]));
            const tenantOptions = candidateTenantIds.map((tId) => {
              const t = tenantMap.get(tId);
              return {
                id: tId,
                name: t?.business_name || t?.slug || tId,
                slug: t?.slug || tId,
              };
            });

            // Zero-Trust Disambiguation: NEVER pick candidates[0] when multiple tenants match!
            throw new UnauthorizedException({
              message: 'بيانات الدخول مسجلة لدى أكثر من منشأة بنفس كلمة المرور. يرجى اختيار المنشأة أو تحديد كود المنشأة لمنع تداخل الحسابات.',
              code: 'MULTIPLE_TENANTS',
              tenants: tenantOptions,
            });
          } else {
            // Multiple accounts inside the SAME tenant sharing the same phone & password!
            const candidateUsernames = validCandidates.map((c) => c.username).filter(Boolean);
            const exampleUsernames = candidateUsernames.slice(0, 3).join(' أو ');
            throw new UnauthorizedException(
              `رقم الهاتف مرتبط بأكثر من حساب داخل هذه المنشأة (${exampleUsernames}). يرجى تسجيل الدخول باسم المستخدم الخاص بك لتحديد حسابك بدقة.`
            );
          }
        } else {
          // None matched the password, pick first to trigger audit failed login below
          user = candidates[0];
        }
      }
    }

    if (!user) return null;
    if (user.locked_until && user.locked_until > new Date()) {
      const remainingMinutes = Math.max(1, Math.ceil((user.locked_until.getTime() - Date.now()) / 60000));
      throw new UnauthorizedException(`تم قفل هذا الحساب مؤقتاً بسبب تكرار المحاولات الخاطئة. يرجى المحاولة بعد ${remainingMinutes} دقيقة.`);
    }
    const passwordCheck = await verifyPassword(password, user.password_hash, user.password_salt);
    if (!passwordCheck.valid) {
      const { maxAttempts, lockoutMinutes } = this.lockoutConfig;
      const tenantContext = this.resolveUserTenantContext(user);
      // Do not increment using the account snapshot read BEFORE bcrypt:
      // concurrent wrong passwords can otherwise all overwrite the counter
      // with the same value and bypass the database-backed lockout policy.
      await this.db.transaction().execute(async (trx) => {
        const latest = await trx.selectFrom('users')
          .select(['id', 'failed_login_count', 'locked_until'])
          .where('id', '=', user.id)
          .where('tenant_id', '=', tenantContext.tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!latest) return;
        const now = new Date();
        if (latest.locked_until && new Date(latest.locked_until) > now) return;
        const nextFailedLoginCount = Number(latest.failed_login_count ?? 0) + 1;
        const shouldLock = nextFailedLoginCount >= maxAttempts;
        await trx.updateTable('users')
          .set({
            failed_login_count: shouldLock ? 0 : nextFailedLoginCount,
            locked_until: shouldLock ? new Date(now.getTime() + lockoutMinutes * 60 * 1000) : null,
          })
          .where('id', '=', user.id)
          .where('tenant_id', '=', tenantContext.tenantId)
          .execute();
      });
      await this.audit.log('تسجيل دخول فاشل', `محاولة دخول فاشلة للمستخدم ${user.username}`, { userId: user.id, tenantId: tenantContext.tenantId, accountId: tenantContext.accountId }, { targetTenantId: tenantContext.tenantId });
      return null;
    }
    const tenantContext = this.resolveUserTenantContext(user);
    await this.assertTenantLoginAllowed(tenantContext.tenantId);

    // MFA-1: كلمة المرور الصحيحة لم تعد كافية وحدها لمن فعّل المصادقة الثنائية. **لا تُنشأ جلسة
    // هنا إطلاقاً** — يُعاد تحدٍّ موقَّع قصير العمر، والجلسة تُنشأ في `completeMfaLogin` بعد
    // التحقق من الرمز. أي مسار يُنشئ جلسة قبل العامل الثاني يُلغي الميزة كلها.
    const mfaEnabled = await this.hasConfirmedMfa(user.id, tenantContext.tenantId);
    if (requiresPlatformMfaEnrolment(tenantContext.tenantId, String(user.role || ''), mfaEnabled)) {
      // Fail closed: an operator must enrol the owner *before* enabling MFA_REQUIRED_FOR_PLATFORM.
      // Never issue a password-only session while an explicit mandatory MFA policy is active.
      throw new UnauthorizedException('MFA_ENROLLMENT_REQUIRED: المصادقة الثنائية مطلوبة لهذا الحساب ولم تُفعّل بعد. تواصل مع إدارة المنصة لتفعيلها بشكل آمن.');
    }
    if (mfaEnabled) {
      await this.db
        .updateTable('users')
        .set({ failed_login_count: 0, locked_until: null })
        .where('id', '=', user.id)
        .where(sql<boolean>`tenant_id = ${tenantContext.tenantId}`)
        .execute();

      return {
        mfaRequired: true,
        mfaToken: signPortalToken(
          {
            kind: MFA_CHALLENGE_KIND, userId: user.id,
            tenantId: tenantContext.tenantId, accountId: tenantContext.accountId,
            // Bind the pending 2FA challenge to the password that was verified.
            // An admin password reset must invalidate an in-flight challenge.
            passwordVerifier: createHash('sha256').update(user.password_hash).digest('hex'),
          },
          MFA_CHALLENGE_TTL_MS,
        ),
        username: user.username,
      };
    }

    return this.createAuthenticatedSession(user, meta, { rehashPassword: passwordCheck.needsRehash ? password : null, expectedPasswordHash: user.password_hash });
  }

  /** هل لهذا المستخدم مصادقة ثنائية **مؤكَّدة**؟ الإعداد غير المؤكَّد لا يحجب الدخول. */
  private async hasConfirmedMfa(userId: number, tenantId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('user_mfa')
      .select(['user_id'])
      .where('user_id', '=', userId)
      .where('tenant_id', '=', tenantId)
      .where('confirmed_at', 'is not', null)
      .executeTakeFirst();
    return Boolean(row);
  }

  /**
   * النصف الثاني من تسجيل الدخول: إنشاء الجلسة وبناء سياق الهوية. مشترك بين الدخول العادي
   * والدخول بعد العامل الثاني حتى لا يوجد مساران مختلفان لإنشاء الجلسة.
   */
  private async createAuthenticatedSession(
    user: {
      id: number;
      username: string;
      role: 'super_admin' | 'admin' | 'cashier';
      permissions_json: string;
      tenant_id: string;
      account_id: string;
    },
    meta?: { ipAddress?: string; userAgent?: string },
    options?: { rehashPassword?: string | null; expectedPasswordHash?: string },
  ): Promise<{ sessionId: string; auth: AuthContext; expiresAt: Date }> {
    const tenantContext = this.resolveUserTenantContext(user);
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // The authenticated user's state and new session must commit together.
    // Re-lock and re-check the user: an admin may have disabled the account
    // while password verification / MFA was in progress.
    const userSecurityUpdates: Record<string, unknown> = { failed_login_count: 0, last_login_at: now, locked_until: null };
    if (options?.rehashPassword) {
      const upgradedPassword = await createPasswordRecord(options.rehashPassword);
      userSecurityUpdates.password_hash = upgradedPassword.hash;
      userSecurityUpdates.password_salt = upgradedPassword.salt;
    }
    await this.db.transaction().execute(async (trx) => {
      const currentUser = await trx.selectFrom('users')
        .select(['is_active', 'locked_until', 'password_hash'])
        .where('id', '=', user.id)
        .where('tenant_id', '=', tenantContext.tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!currentUser?.is_active || (currentUser.locked_until && new Date(currentUser.locked_until) > now)) {
        throw new UnauthorizedException('User account is no longer eligible for login');
      }
      if (options?.expectedPasswordHash && currentUser.password_hash !== options.expectedPasswordHash) {
        throw new UnauthorizedException('Password was changed during login; please authenticate again');
      }

      await trx.updateTable('users').set(userSecurityUpdates)
        .where('id', '=', user.id)
        .where('tenant_id', '=', tenantContext.tenantId)
        .execute();
      await trx.insertInto('sessions').values({
        id: sessionId, user_id: user.id,
        tenant_id: tenantContext.tenantId, account_id: tenantContext.accountId,
        expires_at: expiresAt, last_seen_at: now,
        ip_address: meta?.ipAddress?.slice(0, 255) || '',
        user_agent: meta?.userAgent?.slice(0, 500) || '',
      }).execute();
    });

    const isPlatformTenant = isPlatformTenantId(tenantContext.tenantId);
    const effectiveRole = (user.role === 'super_admin' && !isPlatformTenant) ? 'admin' : user.role;
    const userPermissions = effectiveRole === 'super_admin' ? Array.from(new Set([...SUPER_ADMIN_PERMISSIONS, ...safeJsonArray(user.permissions_json)])) : safeJsonArray(user.permissions_json);
    return { sessionId, expiresAt, auth: { userId: user.id, sessionId, username: user.username, role: effectiveRole, permissions: userPermissions, ...tenantContext } };
  }

  /**
   * يُكمل تسجيل الدخول بعد رمز المصادقة الثنائية (أو رمز استرداد).
   *
   * التحدي موقَّع بـ`portal-token.ts` (فشل آمن على السر، مقارنة ثابتة الزمن، عمر موحَّد) ويحمل
   * `kind` مميَّزاً حتى لا يُقبل رمز بوابة موظف مكانه. وهو لا يُعفي من أي فحص: حالة المستخدم
   * وحالة المستأجر تُعاد قراءتهما من القاعدة، لأن دقائق مرّت منذ التحقق من كلمة المرور.
   */
  async completeMfaLogin(
    mfaToken: string,
    code: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ sessionId: string; auth: AuthContext; expiresAt: Date }> {
    const payload = verifyPortalToken<{ kind?: string; userId?: number; tenantId?: string; passwordVerifier?: string }>(
      `Bearer ${String(mfaToken || '')}`,
      MFA_CHALLENGE_ERRORS,
    );
    if (payload.kind !== MFA_CHALLENGE_KIND) {
      throw new AppError('انتهت جلسة التحقق. أعد تسجيل الدخول.', 'MFA_CHALLENGE_INVALID', 401);
    }

    const userId = Number(payload.userId || 0);
    const tenantId = String(payload.tenantId || '').trim();
    if (!userId || !tenantId) {
      throw new AppError('انتهت جلسة التحقق. أعد تسجيل الدخول.', 'MFA_CHALLENGE_INVALID', 401);
    }

    const user = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'role', 'permissions_json', 'tenant_id', 'account_id', 'is_active', 'locked_until', 'password_hash'])
      .where('id', '=', userId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    if (!user || !user.is_active || (user.locked_until && user.locked_until > new Date())) {
      throw new AppError('انتهت جلسة التحقق. أعد تسجيل الدخول.', 'MFA_CHALLENGE_INVALID', 401);
    }

    // The user may have reset their password since this token was signed.
    // Do not consume an MFA recovery code for an already invalid challenge.
    const currentVerifier = createHash('sha256').update(user.password_hash).digest('hex');
    if (!payload.passwordVerifier || payload.passwordVerifier !== currentVerifier) {
      throw new AppError('انتهت جلسة التحقق. أعد تسجيل الدخول.', 'MFA_CHALLENGE_INVALID', 401);
    }
    const tenantContext = this.resolveUserTenantContext(user);
    await this.assertTenantLoginAllowed(tenantContext.tenantId);

    const accepted = await this.consumeMfaCode(userId, tenantContext.tenantId, code);
    if (!accepted) {
      await this.audit.log(
        'رمز مصادقة ثنائية خاطئ',
        `محاولة فاشلة بالعامل الثاني للمستخدم ${user.username}`,
        { userId, tenantId: tenantContext.tenantId, accountId: tenantContext.accountId },
        { targetTenantId: tenantContext.tenantId },
      );
      throw new AppError('رمز التحقق غير صحيح.', 'MFA_CODE_INVALID', 401);
    }

    return this.createAuthenticatedSession(user as never, meta, { expectedPasswordHash: user.password_hash });
  }

  /**
   * يتحقق من رمز TOTP أو رمز استرداد **ويستهلكه**.
   *
   * الاستهلاك هو جوهر الأمان هنا: بدون `last_used_step` يمكن إعادة استعمال رمز ملتقط داخل
   * نافذته، وبدون حذف رمز الاسترداد المستعمَل يبقى صالحاً للأبد. كل ذلك داخل معاملة واحدة مع
   * `FOR UPDATE` حتى لا يمرّ طلبان متزامنان بنفس الرمز.
   */
  private async consumeMfaCode(userId: number, tenantId: string, code: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('user_mfa')
        .select(['user_id', 'secret_encrypted', 'last_used_step', 'recovery_codes', 'confirmed_at'])
        .where('user_id', '=', userId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!row || !row.confirmed_at) return false;

      const step = verifyTotpCode(decryptMfaSecret(row.secret_encrypted), code);
      if (step !== null) {
        if (step <= Number(row.last_used_step || 0)) return false; // نفس الرمز مرة ثانية
        await trx
          .updateTable('user_mfa')
          .set({ last_used_step: step, updated_at: new Date() })
          .where('user_id', '=', userId)
          .where('tenant_id', '=', tenantId)
          .execute();
        return true;
      }

      const stored = Array.isArray(row.recovery_codes) ? row.recovery_codes : [];
      const providedHash = hashRecoveryCode(code);
      const remaining = stored.filter((entry) => String(entry) !== providedHash);
      if (remaining.length === stored.length) return false;

      await trx
        .updateTable('user_mfa')
        .set({ recovery_codes: JSON.stringify(remaining), updated_at: new Date() })
        .where('user_id', '=', userId)
        .where('tenant_id', '=', tenantId)
        .execute();
      return true;
    });
  }

  async logout(sessionId: string, auth?: AuthContext): Promise<void> {
    this.authCache.invalidateSession(sessionId);
    let query = this.db.deleteFrom('sessions').where('id', '=', sessionId);
    if (auth) {
      const { tenantId } = this.scope(auth);
      query = query.where(sql<boolean>`tenant_id = ${tenantId}`);
      await this.audit.log('تسجيل الخروج', `تم تسجيل الخروج للمستخدم ${auth.username}`, auth, { targetTenantId: auth.tenantId });
    }
    await query.execute();
  }

  async listSessions(auth: AuthContext, userId: number = auth.userId): Promise<Array<Record<string, unknown>>> {
    const { tenantId } = this.scope(auth);
    return this.db.selectFrom('sessions').select(['id', 'created_at', 'expires_at', 'last_seen_at', 'ip_address', 'user_agent']).where('user_id', '=', userId).where(sql<boolean>`tenant_id = ${tenantId}`).orderBy('created_at', 'desc').execute();
  }

  async revokeSessionForUser(sessionId: string, auth: AuthContext, userId: number = auth.userId): Promise<number> {
    this.authCache.invalidateSession(sessionId);
    const { tenantId } = this.scope(auth);
    const result = await this.db.deleteFrom('sessions').where('id', '=', sessionId).where('user_id', '=', userId).where(sql<boolean>`tenant_id = ${tenantId}`).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }

  async revokeOtherSessions(auth: AuthContext, keepSessionId: string, userId: number = auth.userId): Promise<number> {
    this.authCache.invalidateUserSessions(userId);
    const { tenantId } = this.scope(auth);
    const result = await this.db.deleteFrom('sessions').where('user_id', '=', userId).where('id', '!=', keepSessionId).where(sql<boolean>`tenant_id = ${tenantId}`).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }

  async revokeAllSessionsForUser(auth: AuthContext, userId: number = auth.userId): Promise<number> {
    this.authCache.invalidateUserSessions(userId);
    const { tenantId } = this.scope(auth);
    const result = await this.db.deleteFrom('sessions').where('user_id', '=', userId).where(sql<boolean>`tenant_id = ${tenantId}`).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }

  private async getSessionUserProfile(auth: AuthContext): Promise<{ id: number; username: string; role: string; permissions: string[]; displayName: string; branchIds: string[]; defaultBranchId: string; tenantId: string; accountId: string; mustChangePassword: boolean; passwordHash: string; passwordSalt: string }> {
    const { tenantId } = this.scope(auth);
    const user = await this.db.selectFrom('users').select(['id', 'username', 'role', 'permissions_json', 'display_name', 'default_branch_id', 'must_change_password', 'password_hash', 'password_salt', 'tenant_id', 'account_id']).where('id', '=', auth.userId).where(sql<boolean>`tenant_id = ${tenantId}`).executeTakeFirst();
    if (!user) throw new Error('User not found');
    const branchRows = await this.db.selectFrom('user_branches').select(['branch_id']).where('user_id', '=', auth.userId).where(sql<boolean>`tenant_id = ${tenantId}`).execute();
    const branchIds = branchRows.map((row) => String(row.branch_id || '').trim()).filter(Boolean);
    const defaultBranchId = user.default_branch_id ? String(user.default_branch_id) : '';
    if (defaultBranchId && !branchIds.includes(defaultBranchId)) branchIds.push(defaultBranchId);
    const userTenantContext = this.resolveUserTenantContext(user);
    const isPlatformTenant = isPlatformTenantId(userTenantContext.tenantId);
    const effectiveRole = (user.role === 'super_admin' && !isPlatformTenant) ? 'admin' : String(user.role || auth.role);
    const effectivePermissions = effectiveRole === 'super_admin' ? Array.from(new Set([...SUPER_ADMIN_PERMISSIONS, ...safeJsonArray(user.permissions_json)])) : (safeJsonArray(user.permissions_json) || auth.permissions);
    return { id: Number(user.id), username: String(user.username || auth.username), role: effectiveRole, permissions: effectivePermissions, displayName: String(user.display_name || user.username || auth.username), branchIds, defaultBranchId, ...userTenantContext, mustChangePassword: Boolean(user.must_change_password), passwordHash: String(user.password_hash || ''), passwordSalt: String(user.password_salt || '') };
  }

  async buildLoginPayload(auth: AuthContext): Promise<Record<string, unknown>> {
    const [profile, tenant] = await Promise.all([
      this.getSessionUserProfile(auth),
      this.getTenantPayload(auth),
    ]);
    return { user: { id: profile.id, username: profile.username, role: profile.role, permissions: profile.permissions, displayName: profile.displayName, branchIds: profile.branchIds, defaultBranchId: profile.defaultBranchId, tenantId: profile.tenantId, accountId: profile.accountId }, tenant, mustChangePassword: profile.mustChangePassword };
  }

  async changePassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
    const { tenantId } = this.scope(auth);
    const user = await this.db.selectFrom('users').select(['id', 'password_hash', 'password_salt']).where('id', '=', auth.userId).where(sql<boolean>`tenant_id = ${tenantId}`).executeTakeFirst();
    if (!user) throw new Error('User not found');
    const currentPasswordCheck = await verifyPassword(currentPassword, user.password_hash, user.password_salt);
    if (!currentPasswordCheck.valid) throw new Error('Current password is incorrect');
    assertStrongPassword(newPassword, { role: auth.role });
    const nextPassword = await createPasswordRecord(newPassword);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ password_hash: nextPassword.hash, password_salt: nextPassword.salt, must_change_password: false, failed_login_count: 0, locked_until: null }).where('id', '=', auth.userId).where(sql<boolean>`tenant_id = ${tenantId}`).execute();
      let sessionCleanup = trx.deleteFrom('sessions').where('user_id', '=', auth.userId).where(sql<boolean>`tenant_id = ${tenantId}`);
      if (auth.sessionId) {
        sessionCleanup = sessionCleanup.where('id', '!=', auth.sessionId);
      }
      await sessionCleanup.execute();
    });
    this.authCache.invalidateUserSessions(auth.userId);
  }

  async dismissPasswordChange(auth: AuthContext): Promise<void> {
    const { tenantId } = this.scope(auth);
    await this.db.updateTable('users').set({ must_change_password: false }).where('id', '=', auth.userId).where(sql<boolean>`tenant_id = ${tenantId}`).execute();
  }

  async buildMePayload(auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = this.scope(auth);
    const profile = await this.getSessionUserProfile(auth);
    const tenant = await this.getTenantPayload(auth);
    const settingsRows = await this.db.selectFrom('settings').select(['key', 'value']).where(sql<boolean>`tenant_id = ${tenantId}`).execute();
    const settingsMap = new Map(settingsRows.map((row) => [String(row.key || ''), String(row.value || '')]));
    const defaultUsername = (this.configService.get<string>('DEFAULT_ADMIN_USERNAME') || 'admin').trim();
    const defaultPassword = this.configService.get<string>('DEFAULT_ADMIN_PASSWORD') || '';
    const defaultPasswordCheck = defaultPassword
      ? await verifyPassword(defaultPassword, profile.passwordHash, profile.passwordSalt)
      : { valid: false };
    const usingDefaultAdminPassword = Boolean(defaultPassword)
      && ['super_admin', 'admin'].includes(profile.role)
      && profile.username.toLowerCase() === defaultUsername.toLowerCase()
      && defaultPasswordCheck.valid;
    
    const taxSettings = await this.db.selectFrom('tenant_tax_settings').select(['is_active']).where('tenant_id', '=', tenantId).where('provider', '=', 'ETA_EGYPT').executeTakeFirst();
    const isEtaActive = taxSettings ? Boolean(taxSettings.is_active) : false;

    const tenantBusinessName = typeof tenant?.businessName === 'string' ? tenant.businessName : undefined;
    let storeName: string = tenantBusinessName || 'Z Systems';
    const rawStoreName = settingsMap.get('storeName');
    if (rawStoreName) {
      try {
        const parsed = JSON.parse(rawStoreName);
        if (parsed && typeof parsed === 'string' && parsed.trim()) storeName = parsed.trim();
      } catch {
        if (rawStoreName.trim()) storeName = rawStoreName.trim();
      }
    }

    let theme = 'light';
    const rawTheme = settingsMap.get('theme');
    if (rawTheme) {
      try {
        const parsed = JSON.parse(rawTheme);
        if (parsed && typeof parsed === 'string') theme = parsed;
      } catch {
        theme = rawTheme;
      }
    }

    let onboardingCompleted = false;
    const rawOnboarding = settingsMap.get('onboardingCompleted');
    if (rawOnboarding) {
      try {
        const parsed = JSON.parse(rawOnboarding);
        onboardingCompleted = parsed === true || parsed === 'true';
      } catch {
        onboardingCompleted = rawOnboarding === 'true';
      }
    }

    return {
      user: {
        id: profile.id,
        username: profile.username,
        role: profile.role,
        permissions: profile.permissions,
        displayName: profile.displayName,
        branchIds: profile.branchIds,
        defaultBranchId: profile.defaultBranchId,
        tenantId: profile.tenantId,
        accountId: profile.accountId,
      },
      tenant,
      settings: {
        storeName,
        theme,
        isEtaActive,
        onboardingCompleted,
      },
      security: {
        mustChangePassword: profile.mustChangePassword,
        usingDefaultAdminPassword,
      },
    };
  }
}
