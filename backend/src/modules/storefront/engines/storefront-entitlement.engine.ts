import { getIndustryProfile } from '../../../core/tenant/industry-profiles';

/*
 * INV-STOREFRONT-ORDERS: a public storefront order is accepted only when the
 * tenant is entitled to the storefront app. The tenant settings toggle
 * (`storefront_enabled`) is tenant-controlled and never proved entitlement, so
 * a tenant whose plan/activity excludes the storefront (warehousing, services,
 * contracting, maritime, manufacturing, or a plan without the feature) still
 * took orders. The canonical entitlement resolver is PlanFeatureService
 * (`hasFeature(..., 'storefront', ...)`), the same check PermissionsGuard
 * applies behind `@RequireFeature('storefront')`. Already-recorded orders are
 * untouched by this gate: the merchant list is permission-gated, not
 * feature-gated, so an admin can still see them in /online-orders.
 * Prospective only.
 *
 * INV-STOREFRONT-ORDER-PRICE (trial evaluation window): an ACTIVE trial is the
 * evaluation window, so it entitles a commerce tenant to take storefront
 * orders even when its plan row does not grant the storefront — the live case
 * is test10k (Ultimate plan, retail, trial to 2026-11-07 + 97 days): the plan
 * resolver refuses Ultimate (`hasFeature` hard-codes plan_ultimate +
 * storefront to false, before the seeded plan_features row is consulted), the
 * order POST was refused, and the frontend demo fallback fabricated the
 * fake order ORD-180027 (item price 0, delivery 35, never persisted).
 * The exemption is narrow and fail-closed: it applies only while the trial is
 * active (status 'trial' AND a trial_ends_at in the future — a missing or
 * past expiry grants nothing), only inside the commerce pillar, never for
 * the structurally excluded sub-verticals (warehousing, services) or the
 * isolated pillars (contracting, maritime), and an explicit '-storefront'
 * opt-out still wins over the trial. Once the trial lapses, the plan
 * decision governs again and unpaid tenants are refused as before.
 */

/** Named rejection for a new order from a tenant without storefront entitlement. */
export const STOREFRONT_NOT_ENTITLED_MESSAGE =
  'المتجر الإلكتروني غير مفعّل لهذه المنشأة أو غير مشمول في باقتها، ولا يمكن استقبال طلبات جديدة';

/** The tenant row fields the entitlement decision reads (never client input). */
export interface StorefrontTenantEntitlementRow {
  plan_id: string | null;
  extra_features: unknown;
  activity_type: string | null;
  /** Trial state, read from the tenant row the caller already fetched. */
  status?: string | null;
  trial_ends_at?: string | Date | null;
}

/** Commerce sub-verticals whose activity structurally excludes the storefront. */
const STOREFRONT_EXCLUDED_SUB_VERTICALS = ['warehousing', 'services'];

/**
 * Whether this tenant is inside an ACTIVE trial evaluation window: status
 * 'trial' with a trial_ends_at in the future. A missing, malformed or past
 * expiry grants nothing (fail-closed); the caller supplies `now` so specs
 * can pin the boundary without touching the clock.
 */
export function isStorefrontTrialActive(
  tenant: StorefrontTenantEntitlementRow,
  now: Date = new Date(),
): boolean {
  if (String(tenant.status || '').trim().toLowerCase() !== 'trial') return false;
  if (tenant.trial_ends_at == null) return false;
  const endsAt = tenant.trial_ends_at instanceof Date ? tenant.trial_ends_at : new Date(tenant.trial_ends_at);
  if (Number.isNaN(endsAt.getTime())) return false;
  return now.getTime() < endsAt.getTime();
}

/** Structural shape of the plan resolver — the real PlanFeatureService satisfies it. */
export interface StorefrontFeatureChecker {
  hasFeature(
    planId: string | undefined,
    extraFeatures: string[] | undefined,
    requiredFeature: string,
    pillar?: string,
    activityType?: string,
  ): boolean;
}

/**
 * Parses the tenant's stored extra features the same way the session builder
 * does (array as-is, JSON string parsed, anything else empty). A malformed
 * value grants nothing — it fails closed to "no extras".
 */
export function parseTenantExtraFeatures(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === 'string')
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Whether this tenant may take NEW online orders: the canonical plan/activity
 * resolver must grant the `storefront` feature for the tenant's pillar and
 * activity. The settings toggle is checked separately by the caller and is not
 * part of this decision.
 *
 * Trial window (INV-STOREFRONT-ORDER-PRICE): when the resolver refuses, an
 * ACTIVE trial still entitles a commerce tenant whose activity does not
 * structurally exclude the storefront — the trial is the evaluation window.
 * An explicit '-storefront' opt-out always wins over the trial, and the
 * structurally excluded activities (warehousing, services) and the isolated
 * pillars (contracting, maritime) are never re-granted by a trial.
 */
export function isStorefrontEntitledForOrders(
  tenant: StorefrontTenantEntitlementRow,
  featureChecker: StorefrontFeatureChecker,
  now: Date = new Date(),
): boolean {
  const profile = getIndustryProfile(tenant.activity_type);
  if (
    featureChecker.hasFeature(
      tenant.plan_id ?? undefined,
      parseTenantExtraFeatures(tenant.extra_features),
      'storefront',
      profile.pillar,
      profile.key,
    )
  ) {
    return true;
  }
  const extras = parseTenantExtraFeatures(tenant.extra_features);
  if (extras.includes('-storefront')) return false;
  if (profile.pillar !== 'commerce') return false;
  if (profile.subVertical && STOREFRONT_EXCLUDED_SUB_VERTICALS.includes(profile.subVertical)) return false;
  return isStorefrontTrialActive(tenant, now);
}
