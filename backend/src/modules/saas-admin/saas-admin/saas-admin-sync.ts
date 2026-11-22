import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { SettingsService } from '../../settings/settings.service';
import { sql } from '../../../database/kysely';
import { PLAN_MANAGED_MODULES_SETTING_KEY } from '../../../common/constants/platform-settings-keys';
import { normalizeIndustryProfileKey, getIndustryProfile } from '../../../core/tenant/industry-profiles';
import { getFallbackPlanFeatures, isOmnichannelPlanId } from '../../../core/tenant/plan-tier.util';

export class SaasAdminSync {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly settingsService: SettingsService,
  ) {}

  public async syncTenantModuleSettingsForPlan(tenantId: string, planId?: string | null, extraFeatures?: string[]): Promise<void> {
    try {
      const userRow = await this.db
        .selectFrom('users')
        .select('account_id')
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const accountId = userRow?.account_id ?? 1;

      let baseFeatures: string[] = [];
      if (planId) {
        const rows = await this.db
          .selectFrom('plan_features')
          .select('feature_code')
          .where('plan_id', '=', planId as any)
          .execute();
        baseFeatures = rows.map(r => r.feature_code);
        if (baseFeatures.length === 0) {
          baseFeatures = getFallbackPlanFeatures(planId, { includeBand5MarkersOnUltimate: true });
        }
        if (isOmnichannelPlanId(planId) && !baseFeatures.includes('storefront')) {
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
        vanSales: ['vanSalesModuleEnabled'],
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
        weightedBarcode: ['weightedBarcodeEnabled'],
        combo: ['comboModuleEnabled'],
        crm: ['crmModuleEnabled'],
        posShowCartMeta: ['posShowCartMeta'],
        phoneOrders: ['phoneOrdersModuleEnabled'],
        autoParts: ['autoPartsModuleEnabled'],
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

      // Strict vertical isolation + respect explicit SaaS Admin add-ons where permitted
      if (verticalKey !== 'maritime_freight') modulesToSet['maritimeFreightModuleEnabled'] = false;
      if (verticalKey !== 'contracting') modulesToSet['contractingModuleEnabled'] = false;
      if (verticalKey !== 'import_export' && !effectiveFeatures.has('import')) modulesToSet['importModuleEnabled'] = false;
      if (verticalKey !== 'manufacturing' && !effectiveFeatures.has('manufacturing')) modulesToSet['manufacturingModuleEnabled'] = false;
      if (verticalKey !== 'restaurant' && !effectiveFeatures.has('restaurant')) modulesToSet['restaurantModuleEnabled'] = false;
      if (verticalKey !== 'pharmacy' && !effectiveFeatures.has('pharmacy')) modulesToSet['enablePharmacyModule'] = false;
      if (verticalKey !== 'maintenance' && (verticalKey as string) !== 'electronics' && !effectiveFeatures.has('maintenance')) modulesToSet['enableMobileStoreFeatures'] = false;
      // Plan-gated toggle: off for non-retail; grant when plan has 'clothing'; omit otherwise to preserve sync marker semantics.
      if (isNonRetailVertical) modulesToSet['clothingModuleEnabled'] = false;
      else if (effectiveFeatures.has('clothing')) modulesToSet['clothingModuleEnabled'] = true;
      modulesToSet['autoPartsModuleEnabled'] = verticalKey === 'auto_parts' || effectiveFeatures.has('autoParts');
      modulesToSet['servicesModuleEnabled'] = verticalKey === 'services' || effectiveFeatures.has('services');
      // Ensure foundational operational & plan-gated switches match SaaS Admin truth
      modulesToSet['purchasesModuleEnabled'] = effectiveFeatures.has('purchases');
      modulesToSet['comboModuleEnabled'] = (effectiveFeatures.has('combo') || effectiveFeatures.has('purchases')) && !excluded.has('combo');
      modulesToSet['inventoryModuleEnabled'] = effectiveFeatures.has('inventory') && !['maritime_freight', 'services'].includes(verticalKey);
      if (!effectiveFeatures.has('deliveryReps') && verticalKey !== 'wholesale_van') {
        modulesToSet['deliveryRepsModuleEnabled'] = false;
      }
      for (const gatedFeat of ['hr', 'installments', 'fixed_assets', 'storefront', 'accounting'] as const) {
        if (!effectiveFeatures.has(gatedFeat)) {
          for (const mk of FEATURE_TO_MODULE_MAP[gatedFeat] || []) modulesToSet[mk] = false;
        }
      }
      if (!effectiveFeatures.has('taxIntegration') && !effectiveFeatures.has('vat_declaration')) {
        modulesToSet['taxDeclarationModuleEnabled'] = false;
      }
      if (verticalKey === 'wholesale_van') {
        modulesToSet['vanSalesModuleEnabled'] = true;
        modulesToSet['deliveryFleetModuleEnabled'] = true;
        modulesToSet['posModuleEnabled'] = false;
        modulesToSet['enableEnterpriseFeatures'] = true;
      } else if (!effectiveFeatures.has('vanSales')) {
        modulesToSet['vanSalesModuleEnabled'] = false;
      }
      if (verticalKey === 'warehousing') {
        modulesToSet['posModuleEnabled'] = false;
        modulesToSet['inventoryModuleEnabled'] = true;
        modulesToSet['purchasesModuleEnabled'] = true;
        modulesToSet['enableEnterpriseFeatures'] = true;
      }
      for (const ex of excluded) {
        for (const mk of FEATURE_TO_MODULE_MAP[ex] || []) modulesToSet[mk] = false;
      }
      if (effectiveFeatures.has('sales')) {
        if (!isNonRetailVertical) {
          modulesToSet['posModuleEnabled'] = true;
          if (verticalKey === 'supermarket' && !excluded.has('weightedBarcode')) {
            modulesToSet['weightedBarcodeEnabled'] = true;
          }
        } else {
          modulesToSet['posModuleEnabled'] = false;
        }
      }

      // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): a super-admin POS override
      // is applied AFTER every profile/plan branch, so it wins over the
      // wholesale_van / warehousing / services force-off above — and over
      // the 'sales' branch, which would otherwise turn POS off for
      // non-retail verticals. The sync also writes requireCashierShiftForSales
      // (it never managed that key before) because create-sale reads the RAW
      // settings rows, not the getSettings safety net. Both keys land in
      // desiredKeys below, so the provenance marker tracks them and a later
      // revoke (or a removed override) restores the profile default.
      const posOverride = await this.settingsService.loadFeatureOverride(tenantId, 'pos');
      if (posOverride === true) {
        modulesToSet['posModuleEnabled'] = true;
        modulesToSet['requireCashierShiftForSales'] = true;
      } else if (posOverride === false) {
        modulesToSet['posModuleEnabled'] = false;
        modulesToSet['requireCashierShiftForSales'] = false;
      }

      const previouslyGranted = await this.readPlanManagedModuleKeys(tenantId);
      const desiredKeys = Object.entries(modulesToSet).filter(([, value]) => value === true).map(([key]) => key);
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
}
