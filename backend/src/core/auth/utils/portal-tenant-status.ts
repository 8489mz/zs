import type { Kysely } from 'kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuthCacheService } from '../services/auth-cache.service';
import { isPlatformTenantId } from './tenant-boundary';

/**
 * INV-PORTAL-TENANT-STATUS-ENFORCED: the single tenant-status rule for
 * every portal surface (driver, employee, mobile attendance, freight
 * customer), shared by all four verifiers and all portal login paths.
 *
 * The decision mirrors SessionService.assertTenantLoginAllowed
 * (suspended / expired / expired-trial / active-without-a-live
 * subscription, with the same Arabic messages and the same 60s
 * tenant-allowed cache pattern) but is strictly READ-ONLY: it never
 * flips a tenant or subscription row to 'expired'. Those writes stay
 * with the main-session path, which owns them. A portal check must
 * never mutate billing state as a side effect of a token check.
 *
 * Unknown tenants and platform tenants are allowed, exactly like the
 * main-session check. A cached denial reports the generic
 * TENANT_NOT_ALLOWED code because the cache no longer knows which
 * status produced it; a fresh read reports the specific code.
 */
export type PortalTenantDecision = {
  blocked: boolean;
  code: string | null;
  message: string | null;
};

const ALLOWED: PortalTenantDecision = { blocked: false, code: null, message: null };

function blocked(code: string, message: string): PortalTenantDecision {
  return { blocked: true, code, message };
}

async function decidePortalTenantStatus(db: Kysely<any>, tenantId: string): Promise<PortalTenantDecision> {
  const tenant = await db
    .selectFrom('tenants')
    .select(['id', 'status', 'trial_ends_at'])
    .where('id', '=', tenantId)
    .executeTakeFirst();
  if (!tenant) return ALLOWED;

  const status = String((tenant as any).status || '');
  if (status === 'suspended') {
    return blocked('TENANT_SUSPENDED', 'تم إيقاف هذه النسخة. تواصل مع الدعم لتفعيلها.');
  }
  if (status === 'expired') {
    return blocked('TENANT_EXPIRED', 'انتهى اشتراك هذه النسخة. تواصل معنا لتفعيل الاشتراك.');
  }

  const now = new Date();
  if (status === 'trial' && new Date((tenant as any).trial_ends_at) <= now) {
    return blocked('TENANT_TRIAL_EXPIRED', 'انتهت الفترة التجريبية لهذه النسخة. تواصل معنا لتفعيل الاشتراك.');
  }

  if (status === 'active') {
    const subscription = await db
      .selectFrom('tenant_subscriptions')
      .selectAll()
      .where('tenant_id', '=', (tenant as any).id)
      .where('status', 'in', ['active', 'past_due'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!subscription) {
      return blocked('TENANT_EXPIRED', 'لا يوجد اشتراك فعال لهذه النسخة. تواصل معنا لتفعيل الاشتراك.');
    }
    if (new Date((subscription as any).ends_at) <= now) {
      const graceEndsAt = (subscription as any).grace_ends_at
        ? new Date((subscription as any).grace_ends_at)
        : new Date((subscription as any).ends_at);
      if (graceEndsAt <= now) {
        return blocked('TENANT_EXPIRED', 'انتهى اشتراك هذه النسخة وانتهت فترة السماح. تواصل معنا لتفعيل الاشتراك.');
      }
    }
  }

  return ALLOWED;
}

export async function checkPortalTenantStatus(
  db: Kysely<any>,
  authCache: AuthCacheService | undefined,
  tenantId: string,
): Promise<PortalTenantDecision> {
  const normalized = String(tenantId ?? '').trim();
  if (!normalized) return ALLOWED;

  if (isPlatformTenantId(normalized)) {
    authCache?.setTenantAllowed(normalized, true);
    return ALLOWED;
  }

  const cached = authCache?.isTenantAllowed(normalized);
  if (cached === true) return ALLOWED;
  if (cached === false) {
    return blocked('TENANT_NOT_ALLOWED', 'تم إيقاف أو انتهاء اشتراك هذه النسخة.');
  }

  const decision = await decidePortalTenantStatus(db, normalized);
  authCache?.setTenantAllowed(normalized, !decision.blocked);
  return decision;
}

/** Throw when the tenant may not use the portals (login + token paths). */
export async function assertPortalTenantAllowed(
  db: Kysely<any>,
  authCache: AuthCacheService | undefined,
  tenantId: string,
): Promise<void> {
  const decision = await checkPortalTenantStatus(db, authCache, tenantId);
  if (decision.blocked) {
    throw new AppError(decision.message || 'تم إيقاف أو انتهاء اشتراك هذه النسخة.', decision.code || 'TENANT_NOT_ALLOWED', 401);
  }
}

/** Boolean form for the finish-and-settle path, which must not throw. */
export async function isPortalTenantBlocked(
  db: Kysely<any>,
  authCache: AuthCacheService | undefined,
  tenantId: string,
): Promise<boolean> {
  return (await checkPortalTenantStatus(db, authCache, tenantId)).blocked;
}
