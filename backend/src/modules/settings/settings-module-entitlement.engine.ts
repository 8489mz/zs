import { resolvePlanRank } from '../../core/tenant/plan-tier.util';
import type { IndustryProfile } from '../../core/tenant/industry-profiles';
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
  'weightedBarcodeEnabled',
  'clothingModuleEnabled',
  'enableEnterpriseFeatures',
] as const;

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
 * Strict SaaS-Only Module Control (INV-SAAS-ONLY-MODULE-CONTROL):
 * Non-platform actors (regular tenant admins/cashiers) cannot install or
 * uninstall module toggles via PUT /api/settings. Only platform `super_admin`
 * (or an active `sessions.impersonated_by` platform session) and SaaS Admin plan sync
 * manage application switches; tenant admins retain operational settings.
 */
export function canTenantAdminSelfInstallModule(
  _key: string,
  _requestedValue: unknown,
  _context: Omit<ModuleToggleAuthContext, 'isSuperAdmin'>,
): boolean {
  return false;
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
