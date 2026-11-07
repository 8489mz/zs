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
 */

/** Named rejection for a new order from a tenant without storefront entitlement. */
export const STOREFRONT_NOT_ENTITLED_MESSAGE =
  'المتجر الإلكتروني غير مفعّل لهذه المنشأة أو غير مشمول في باقتها، ولا يمكن استقبال طلبات جديدة';

/** The tenant row fields the entitlement decision reads (never client input). */
export interface StorefrontTenantEntitlementRow {
  plan_id: string | null;
  extra_features: unknown;
  activity_type: string | null;
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
 */
export function isStorefrontEntitledForOrders(
  tenant: StorefrontTenantEntitlementRow,
  featureChecker: StorefrontFeatureChecker,
): boolean {
  const profile = getIndustryProfile(tenant.activity_type);
  return featureChecker.hasFeature(
    tenant.plan_id ?? undefined,
    parseTenantExtraFeatures(tenant.extra_features),
    'storefront',
    profile.pillar,
    profile.key,
  );
}
