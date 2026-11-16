import { getIndustryProfile, resolvePillarScopedFeatures, type IndustryProfile } from '../../core/tenant/industry-profiles';
import { getFallbackPlanFeatures, resolvePlanRank, type PlanRank } from '../../core/tenant/plan-tier.util';
import { sql, type Kysely } from '../../database/kysely';
import type { Database } from '../../database/database.types';

export const PROTECTED_MODULE_KEYS = [
  'posModuleEnabled',
  'inventoryModuleEnabled',
  'purchasesModuleEnabled',
  'contractingModuleEnabled',
  'maritimeFreightModuleEnabled',
  'manufacturingModuleEnabled',
  'enablePharmacyModule',
  'enableMobileStoreFeatures',
  'comboModuleEnabled',
  'importModuleEnabled',
  'storefrontModuleEnabled',
  'crmModuleEnabled',
  'restaurantModuleEnabled',
  'servicesModuleEnabled',
  'installmentsModuleEnabled',
  'fixedAssetsModuleEnabled',
  'taxDeclarationModuleEnabled',
  'deliveryFleetModuleEnabled',
  'deliveryRepsModuleEnabled',
  'vanSalesModuleEnabled',
  'posShowCartMeta',
  'phoneOrdersModuleEnabled',
  'autoPartsModuleEnabled',
] as const;

const ALWAYS_PROTECTED_SWITCHES = new Set<string>([
  'posModuleEnabled',
  'contractingModuleEnabled',
  'maritimeFreightModuleEnabled',
]);

interface SelfInstallRule {
  requiredRank: PlanRank;
  featureCode?: string;
  altFeatureCode?: string;
  blockedProfiles?: string[];
  allowedProfiles?: string[];
  requiresPos?: boolean;
  /**
   * When true (vanSales/deliveryFleet), retail defaultFeatures['deliveryReps'] must NOT
   * unlock the module on starter (plan_basic / tier_band*_L1); require plan rank >= requiredRank
   * and plan-table/extra grant (or wholesale_van profile).
   */
  requirePlanOrExtraForFeature?: boolean;
}

const POS_BLOCKED_PROFILES = [
  'contracting',
  'maritime_freight',
  'warehousing',
  'wholesale_van',
  'services',
  'import_export',
  'manufacturing',
];

const DELIVERY_BLOCKED_PROFILES = [
  'contracting',
  'maritime_freight',
  'warehousing',
  'services',
  'manufacturing',
];

export const SELF_INSTALLABLE_MODULE_RULES: Record<string, SelfInstallRule> = {
  comboModuleEnabled: {
    requiredRank: 2,
    blockedProfiles: ['contracting', 'maritime_freight', 'warehousing', 'services'],
  },
  crmModuleEnabled: {
    requiredRank: 2,
  },
  servicesModuleEnabled: {
    requiredRank: 2,
    blockedProfiles: ['contracting', 'maritime_freight'],
  },
  purchasesModuleEnabled: {
    requiredRank: 2,
    featureCode: 'purchases',
  },
  inventoryModuleEnabled: {
    requiredRank: 2,
    featureCode: 'inventory',
    blockedProfiles: ['maritime_freight', 'services'],
  },
  posShowCartMeta: {
    requiredRank: 3,
    requiresPos: true,
    blockedProfiles: POS_BLOCKED_PROFILES,
  },
  restaurantModuleEnabled: {
    requiredRank: 3,
    featureCode: 'restaurant',
    requiresPos: true,
  },
  enablePharmacyModule: {
    requiredRank: 3,
    featureCode: 'pharmacy',
  },
  enableMobileStoreFeatures: {
    requiredRank: 3,
    featureCode: 'maintenance',
  },
  manufacturingModuleEnabled: {
    requiredRank: 3,
    featureCode: 'manufacturing',
  },
  importModuleEnabled: {
    requiredRank: 3,
    featureCode: 'import',
  },
  hrModuleEnabled: {
    requiredRank: 3,
    featureCode: 'hr',
  },
  enableEnterpriseFeatures: {
    requiredRank: 3,
    featureCode: 'accounting',
  },
  installmentsModuleEnabled: {
    requiredRank: 2,
    featureCode: 'installments',
    blockedProfiles: ['maritime_freight'],
  },
  fixedAssetsModuleEnabled: {
    requiredRank: 3,
    featureCode: 'fixed_assets',
  },
  taxDeclarationModuleEnabled: {
    requiredRank: 3,
    featureCode: 'vat_declaration',
    altFeatureCode: 'taxIntegration',
  },
  deliveryRepsModuleEnabled: {
    requiredRank: 1,
    featureCode: 'deliveryReps',
    blockedProfiles: DELIVERY_BLOCKED_PROFILES,
  },
  deliveryFleetModuleEnabled: {
    requiredRank: 2,
    featureCode: 'deliveryReps',
    altFeatureCode: 'vanSales',
    blockedProfiles: DELIVERY_BLOCKED_PROFILES,
    requirePlanOrExtraForFeature: true,
  },
  vanSalesModuleEnabled: {
    requiredRank: 2,
    featureCode: 'deliveryReps',
    altFeatureCode: 'vanSales',
    blockedProfiles: DELIVERY_BLOCKED_PROFILES,
    requirePlanOrExtraForFeature: true,
  },
  storefrontModuleEnabled: {
    requiredRank: 4,
    featureCode: 'storefront',
    blockedProfiles: ['contracting', 'maritime_freight', 'warehousing', 'services'],
  },
  phoneOrdersModuleEnabled: {
    requiredRank: 2,
    requiresPos: true,
    blockedProfiles: POS_BLOCKED_PROFILES,
  },
  autoPartsModuleEnabled: {
    requiredRank: 1,
    allowedProfiles: ['auto_parts'],
  },
};

export interface ModuleToggleAuthContext {
  isSuperAdmin: boolean;
  planId?: string | null;
  extraFeatures?: unknown;
  dbPlanFeatures?: string[];
  profile: IndustryProfile;
  posModuleEnabled?: boolean;
}

export function parseTenantExtraFeaturesList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Determines whether a non-super-admin tenant settings manager may apply a
 * module toggle (`true` only — uninstalling `false` stays super-admin-only)
 * based on the tenant's actual plan, extra features, and business vertical.
 */
export function canTenantAdminSelfInstallModule(
  key: string,
  requestedValue: unknown,
  context: Omit<ModuleToggleAuthContext, 'isSuperAdmin'>,
): boolean {
  if (requestedValue !== true) return false;
  if (ALWAYS_PROTECTED_SWITCHES.has(key)) return false;

  const rule = SELF_INSTALLABLE_MODULE_RULES[key];
  if (!rule) return false;

  const profile = context.profile || getIndustryProfile(null);
  if (rule.allowedProfiles && !rule.allowedProfiles.includes(profile.key)) {
    return false;
  }

  const extraList = parseTenantExtraFeaturesList(context.extraFeatures);
  const extraSet = new Set(extraList);

  const featureCodes = [rule.featureCode, rule.altFeatureCode].filter((c): c is string => Boolean(c));
  if (featureCodes.some((c) => extraSet.has(`-${c}`))) {
    return false;
  }

  const explicitlyGranted = featureCodes.some((c) => extraSet.has(c) || extraSet.has(`+${c}`));
  if (explicitlyGranted) {
    return true;
  }

  if (rule.blockedProfiles?.includes(profile.key)) {
    return false;
  }

  if (rule.requiresPos) {
    const posDisabledByProfile = POS_BLOCKED_PROFILES.includes(profile.key);
    if (posDisabledByProfile || context.posModuleEnabled === false) {
      return false;
    }
  }

  const baseFeatures =
    context.dbPlanFeatures && context.dbPlanFeatures.length > 0
      ? context.dbPlanFeatures
      : getFallbackPlanFeatures(context.planId);

  const effectiveFeatures = new Set(resolvePillarScopedFeatures(profile.key, baseFeatures, extraList));
  const rank = resolvePlanRank(context.planId) ?? 1;

  if (rule.requirePlanOrExtraForFeature && profile.key !== 'wholesale_van') {
    if (rank < rule.requiredRank) {
      return false;
    }
    const planFeatureSet = new Set(baseFeatures);
    return featureCodes.some((code) => planFeatureSet.has(code));
  }

  if (featureCodes.length > 0) {
    return featureCodes.some((code) => effectiveFeatures.has(code));
  }

  return rank >= rule.requiredRank;
}

export function filterProtectedModuleKeysForActor(
  payload: Record<string, unknown>,
  context: ModuleToggleAuthContext,
): void {
  if (context.isSuperAdmin) return;

  for (const key of PROTECTED_MODULE_KEYS) {
    if (!(key in payload)) continue;
    if (!canTenantAdminSelfInstallModule(key, payload[key], context)) {
      delete payload[key];
    }
  }
}

export async function resolveMaxBranchesForTenant(
  db: Kysely<Database>,
  tenantId: string,
  tenant: { plan_id?: string | null; extra_features?: unknown; status?: string | null } | undefined,
  planFeatures: string[],
): Promise<number> {
  const extraFeatures = parseTenantExtraFeaturesList(tenant?.extra_features);
  const allFeatures = new Set([...planFeatures, ...extraFeatures]);
  const hasMultiBranch = allFeatures.has('multi_branch') || allFeatures.has('branches') || allFeatures.has('inventory');

  const activeSub = await db
    .selectFrom('tenant_subscriptions as s')
    .leftJoin('saas_plans as p', 'p.id', 's.plan_id')
    .select(['p.max_branches'])
    .where('s.tenant_id', '=', tenantId)
    .where('s.status', 'in', ['active', 'past_due'])
    .orderBy('s.created_at', 'desc')
    .executeTakeFirst()
    .catch(() => undefined);

  let planMaxBranches = activeSub?.max_branches;
  if (planMaxBranches === undefined && tenant?.plan_id) {
    const cleanPlan = tenant.plan_id.trim();
    const codeUpper = cleanPlan.replace(/^plan_/, '').toUpperCase();
    const planRow = await db
      .selectFrom('saas_plans')
      .select(['max_branches'])
      .where((eb) =>
        eb.or([
          eb('feature_plan_id', '=', cleanPlan),
          eb('code', '=', codeUpper),
          eb(sql<string>`LOWER(code)`, '=', cleanPlan.toLowerCase()),
        ]),
      )
      .where('is_active', '=', true)
      .executeTakeFirst()
      .catch(() => undefined);
    if (planRow) planMaxBranches = planRow.max_branches;
  }

  if (planMaxBranches === null) return 999;
  if (typeof planMaxBranches === 'number') return planMaxBranches;
  if (hasMultiBranch) return resolvePlanRank(tenant?.plan_id) === 2 ? 3 : 999;
  return tenant?.status === 'trial' ? 2 : 1;
}
