import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { TenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { RawBuilder } from 'kysely';
import { getIndustryProfile, normalizeIndustryProfileKey } from '../../../core/tenant/industry-profiles';
import { isEnterpriseOrUltimatePlan, isOmnichannelPlanId } from '../../../core/tenant/plan-tier.util';

export class SettingsReads {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: {
      getPlanFeatures: (tenantId: string, planId: string | null | undefined) => Promise<string[]>;
      loadFeatureOverride: (tenantId: string, featureCode: string) => Promise<boolean | null>;
      remember: <T>(cache: Map<string, { data: T; expiresAt: number }>, key: string, data: T) => void;
      scope: (actor: AuthContext) => TenantScope;
      tenantPredicate: (actor: AuthContext, alias?: string) => RawBuilder<boolean>;
      _settingsCache: Map<string, { data: Record<string, unknown>; expiresAt: number }>;
    },
  ) {}

  private async getPlanFeatures(tenantId: string, planId: string | null | undefined): Promise<string[]> {
    return this.bound.getPlanFeatures(tenantId, planId);
  }
  private async loadFeatureOverride(tenantId: string, featureCode: string): Promise<boolean | null> {
    return this.bound.loadFeatureOverride(tenantId, featureCode);
  }
  private remember<T>(cache: Map<string, { data: T; expiresAt: number }>, key: string, data: T): void {
    return this.bound.remember(cache, key, data);
  }
  private scope(actor: AuthContext): TenantScope {
    return this.bound.scope(actor);
  }
  private tenantPredicate(actor: AuthContext, alias?: string): RawBuilder<boolean> {
    return this.bound.tenantPredicate(actor, alias);
  }
  private get _settingsCache(): Map<string, { data: Record<string, unknown>; expiresAt: number }> {
    return this.bound._settingsCache;
  }

  private readonly sensitiveSettingKeys = new Set([
    'managerPin',
    'managerApprovalPin',
    'manager_pin',
    'electronicInvoiceSecret',
    'electronicInvoiceClientId',
    'taxToken',
    'tax_api_token',
    'smtpPassword',
    'smtp_password',
    'backupEncryptionKey',
    'cloudBackupSecret',
    'developerMasterPassword',
    // Bcrypt hash of the developer master password: readable only by
    // settings managers, writable ONLY via the guarded developer
    // endpoint (INV-DEVELOPER-MASTER-PASSWORD). Never written back
    // through the generic settings save path.
    'developerMasterPasswordHash',
  ]);

  async getSettings(actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const canManageSettings =
      actor.role === 'super_admin' ||
      actor.permissions?.includes('canManageSettings') ||
      actor.permissions?.includes('settings');

    const cacheKey = `${scope.tenantId}:${Boolean(canManageSettings)}`;
    const cached = this._settingsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this._settingsCache.delete(cacheKey);
      this._settingsCache.set(cacheKey, cached);
      return { ...cached.data, scope };
    }

    const rows = await this.db.selectFrom('settings').selectAll().where(this.tenantPredicate(actor)).execute();
    const settings = rows.reduce<Record<string, unknown>>((acc, row) => {
      if (!canManageSettings && this.sensitiveSettingKeys.has(row.key)) {
        return acc;
      }
      try {
        acc[row.key] = JSON.parse(row.value);
      } catch {
        acc[row.key] = row.value;
      }
      return acc;
    }, {});

    if (!settings.currency) {
      settings.currency = 'EGP';
    }

    // Ensure core business details and activity profile are strictly synced with tenant
    const tenant = await this.db.selectFrom('tenants').selectAll().where('id', '=', scope.tenantId).executeTakeFirst();
    const planFeatures = await this.getPlanFeatures(scope.tenantId, tenant?.plan_id);
    const hasPosEntitlement = planFeatures.includes('pos') || planFeatures.includes('cashDrawer');
    const isAlmhnds = tenant?.slug === 'almhnds';

    if (tenant) {
      if (!settings.country && tenant.country_code) settings.country = tenant.country_code;
      if (!settings.country && settings.currency === 'KWD') settings.country = 'KW';
      if (!settings.country && settings.currency === 'SAR') settings.country = 'SA';
      if (!settings.country && settings.currency === 'AED') settings.country = 'AE';
      if (!settings.country && settings.currency === 'QAR') settings.country = 'QA';
      if (!settings.country && settings.currency === 'BHD') settings.country = 'BH';
      if (!settings.country && settings.currency === 'OMR') settings.country = 'OM';
      if (!settings.country) settings.country = 'EG';
      if (!settings.storeName && tenant.business_name) settings.storeName = tenant.business_name;
      if (!settings.companyName && tenant.business_name) settings.companyName = tenant.business_name;
      if (!settings.phone && tenant.owner_phone) settings.phone = tenant.owner_phone;
      if (!settings.ownerName && tenant.owner_name) settings.ownerName = tenant.owner_name;
      if (!settings.email && tenant.owner_email) settings.email = tenant.owner_email;

      let primaryActivity = tenant.activity_type;
      if (isAlmhnds) {
        primaryActivity = 'retail_general';
      } else if (settings.maritimeFreightModuleEnabled === true || settings.maritimeFreightModuleEnabled === 'true') {
        primaryActivity = 'maritime_freight';
      } else if (settings.contractingModuleEnabled === true || settings.contractingModuleEnabled === 'true') {
        primaryActivity = 'contracting';
      } else if (!primaryActivity || primaryActivity === 'retail_general' || primaryActivity === 'general') {
        // INV-POS-RETAIL-FEATURE-GATE: no services→retail_general rewrite — it showed POS while the backend gate refused the sale (cashDrawer is in every plan).
        // A services tenant stays services; only a super-admin 'pos' override opens POS for it.
        primaryActivity = (settings.activityType ||
          settings.businessIndustry ||
          primaryActivity ||
          'retail_general') as string;
      }
      const effectiveType = normalizeIndustryProfileKey(primaryActivity as string);
      const profile = getIndustryProfile(effectiveType);
      settings.activityType = profile.key;
      settings.pillar = profile.pillar;
      settings.industryProfile = profile;
    } else {
      let primaryActivity = settings.businessIndustry || settings.activityType || 'retail_general';
      if (settings.maritimeFreightModuleEnabled === true || settings.maritimeFreightModuleEnabled === 'true') {
        primaryActivity = 'maritime_freight';
      } else if (settings.contractingModuleEnabled === true || settings.contractingModuleEnabled === 'true') {
        primaryActivity = 'contracting';
      }
      const effectiveType = normalizeIndustryProfileKey(primaryActivity as string);
      const profile = getIndustryProfile(effectiveType);
      settings.activityType = profile.key;
      settings.pillar = profile.pillar;
      settings.industryProfile = profile;
    }

    if (settings.pillar === 'contracting') {
      settings.contractingModuleEnabled = true;
      settings.purchasesModuleEnabled = true;
      settings.inventoryModuleEnabled = true;
      settings.hrModuleEnabled = true;
      settings.enableEnterpriseFeatures = true;
      settings.fixedAssetsModuleEnabled = true;
      settings.taxDeclarationModuleEnabled = true;
      settings.maritimeFreightModuleEnabled = false;
      settings.posModuleEnabled = false;
      settings.requireCashierShiftForSales = false;
    } else if (settings.pillar === 'maritime_freight') {
      settings.maritimeFreightModuleEnabled = true;
      settings.purchasesModuleEnabled = true;
      settings.hrModuleEnabled = true;
      settings.enableEnterpriseFeatures = true;
      settings.fixedAssetsModuleEnabled = true;
      settings.taxDeclarationModuleEnabled = true;
      settings.contractingModuleEnabled = false;
      settings.manufacturingModuleEnabled = false;
      settings.inventoryModuleEnabled = false;
      settings.posModuleEnabled = false;
      settings.requireCashierShiftForSales = false;
    } else if (
      settings.pillar === 'manufacturing' ||
      (settings.industryProfile as any)?.subVertical === 'manufacturing'
    ) {
      // INV-POS-RETAIL-FEATURE-GATE: the pillar half was DEAD (manufacturing profile pillar is 'commerce', never 'manufacturing'), so this branch never fired and the page showed POS while the gate refused it.
      // The subVertical half restores the branch's intent: POS stays OFF for manufacturing.
      settings.manufacturingModuleEnabled = true;
      settings.purchasesModuleEnabled = true;
      settings.inventoryModuleEnabled = true;
      settings.hrModuleEnabled = true;
      settings.enableEnterpriseFeatures = true;
      settings.fixedAssetsModuleEnabled = true;
      settings.taxDeclarationModuleEnabled = true;
      settings.contractingModuleEnabled = false;
      settings.maritimeFreightModuleEnabled = false;
      settings.posModuleEnabled = false;
      settings.requireCashierShiftForSales = false;
    } else {
      settings.contractingModuleEnabled = false;
      settings.maritimeFreightModuleEnabled = false;

      // Determine which core modules this vertical's industry profile mandates.
      // The industry profile's defaultFeatures are the authoritative source of truth for
      // "what must always be enabled for this activity type", regardless of what the DB says.
      // This self-heals corrupted settings left behind by the old syncTenantModuleSettingsForPlan
      // bug that would revoke ALL module settings for Level 1 tier plans.
      const profileKey = (settings.industryProfile as any)?.key;
      const profileDefaults: string[] = (settings.industryProfile as any)?.defaultFeatures || [];
      const isWholesaleVan = profileKey === 'wholesale_van';
      const isServiceVertical = profileKey === 'services';
      const isWarehousing = profileKey === 'warehousing';
      const isImportVertical =
        profileKey === 'import_export' || (settings.industryProfile as any)?.subVertical === 'import_export';

      // POS: enabled for all retail/hospitality/specialized verticals, disabled for wholesale_van, services, warehousing, and import_export
      if (isWarehousing || isImportVertical || isWholesaleVan) {
        settings.posModuleEnabled = false;
        settings.requireCashierShiftForSales = false;
      } else if (isServiceVertical) {
        if (isAlmhnds || hasPosEntitlement) {
          settings.posModuleEnabled = true;
          settings.requireCashierShiftForSales = true;
        } else {
          settings.posModuleEnabled = false;
          settings.requireCashierShiftForSales = false;
        }
      } else {
        // If the profile has 'sales' in defaultFeatures, POS must be enabled (self-heal from corrupted false)
        settings.posModuleEnabled = profileDefaults.includes('sales') ? true : settings.posModuleEnabled !== false;
      }

      if (isAlmhnds) {
        settings.posModuleEnabled = true;
        settings.requireCashierShiftForSales = true;
        settings.inventoryModuleEnabled = true;
        settings.servicesModuleEnabled = false;
      } else if (isServiceVertical && settings.servicesModuleEnabled === undefined) {
        settings.servicesModuleEnabled = true;
      }

      // Wholesale van: force van sales, delivery fleet (compat), and enterprise features
      if (isWholesaleVan) {
        settings.deliveryFleetModuleEnabled = true;
        settings.vanSalesModuleEnabled = true;
        settings.enableEnterpriseFeatures = true;
      }

      if (isWarehousing) {
        settings.inventoryModuleEnabled = true;
        settings.purchasesModuleEnabled = true;
        settings.enableEnterpriseFeatures = true;
      }

      if (isImportVertical) {
        settings.importModuleEnabled = true;
        settings.inventoryModuleEnabled = true;
        settings.purchasesModuleEnabled = true;
        settings.enableEnterpriseFeatures = true;
        settings.hrModuleEnabled = true;
      }

      // Inventory & Purchases: respect DB if explicitly set, but default to true for profiles that need them
      if (
        settings.inventoryModuleEnabled === undefined ||
        (settings.inventoryModuleEnabled === false && profileDefaults.includes('inventory'))
      ) {
        settings.inventoryModuleEnabled = profileDefaults.includes('inventory');
      }
      if (
        settings.purchasesModuleEnabled === undefined ||
        (settings.purchasesModuleEnabled === false && profileDefaults.includes('purchases'))
      ) {
        settings.purchasesModuleEnabled = profileDefaults.includes('purchases');
      }

      if (settings.crmModuleEnabled === undefined) settings.crmModuleEnabled = true;
      if (settings.restaurantModuleEnabled === undefined) {
        settings.restaurantModuleEnabled = (settings.industryProfile as any)?.subVertical === 'restaurant';
      }
      if (settings.restaurantTablesCount === undefined) {
        settings.restaurantTablesCount = 12;
      }
      if (settings.phoneOrdersModuleEnabled === undefined) {
        const subVertical = (settings.industryProfile as any)?.subVertical;
        settings.phoneOrdersModuleEnabled =
          ['restaurant', 'pharmacy', 'supermarket', 'grocery', 'food_beverage'].includes(subVertical) ||
          settings.restaurantModuleEnabled === true;
      }
      if (settings.enablePharmacyModule === undefined) {
        settings.enablePharmacyModule = (settings.industryProfile as any)?.subVertical === 'pharmacy';
      }
      if (settings.enableMobileStoreFeatures === undefined) {
        settings.enableMobileStoreFeatures = (settings.industryProfile as any)?.subVertical === 'maintenance';
      }
      // Import module: always enabled on dedicated import_export vertical; otherwise respect explicit toggle in DB
      if (isImportVertical) {
        settings.importModuleEnabled = true;
      } else {
        settings.importModuleEnabled = settings.importModuleEnabled === true || settings.importModuleEnabled === 'true';
      }
      if (settings.autoPartsModuleEnabled === undefined) {
        settings.autoPartsModuleEnabled = (settings.industryProfile as any)?.subVertical === 'auto_parts';
      }
      if (settings.clothingModuleEnabled === undefined) {
        settings.clothingModuleEnabled = (settings.industryProfile as any)?.subVertical === 'clothing';
      }

      const isOmnichannelPlan = isOmnichannelPlanId(tenant?.plan_id);
      const isUltimatePlan = isEnterpriseOrUltimatePlan(tenant?.plan_id) && !isOmnichannelPlan;
      const isEnterprisePlan = isOmnichannelPlan || isUltimatePlan;

      // Delivery reps (retail / standard): if profile or plan includes deliveryReps, ensure it's enabled (self-heal)
      if (
        !isWarehousing &&
        !isServiceVertical &&
        !isImportVertical &&
        (profileDefaults.includes('deliveryReps') || isEnterprisePlan || planFeatures.includes('deliveryReps'))
      ) {
        if (settings.deliveryRepsModuleEnabled === undefined) {
          settings.deliveryRepsModuleEnabled = true;
        }
        if (settings.deliveryFleetModuleEnabled !== true) {
          settings.deliveryFleetModuleEnabled = true;
        }
      }

      // Backward compatibility normalization between legacy deliveryFleetModuleEnabled and split flags
      if (settings.deliveryFleetModuleEnabled === true) {
        if (settings.vanSalesModuleEnabled === undefined && isWholesaleVan) {
          settings.vanSalesModuleEnabled = true;
        }
        if (settings.deliveryRepsModuleEnabled === undefined && !isWholesaleVan) {
          settings.deliveryRepsModuleEnabled = true;
        }
      }

      // Enterprise features & accounting: if the profile or plan includes accounting, ensure enterprise mode (self-heal)
      if (
        (isEnterprisePlan || profileDefaults.includes('accounting') || planFeatures.includes('accounting')) &&
        settings.enableEnterpriseFeatures !== true
      ) {
        settings.enableEnterpriseFeatures = true;
      }
      if ((isEnterprisePlan || planFeatures.includes('fixed_assets')) && settings.fixedAssetsModuleEnabled !== true) {
        settings.fixedAssetsModuleEnabled = true;
      }

      // Installments: if plan includes installments or is an enterprise tier
      if ((isEnterprisePlan || planFeatures.includes('installments')) && settings.installmentsModuleEnabled !== true) {
        settings.installmentsModuleEnabled = true;
      }

      // Tax declaration & integration: if plan includes vat_declaration or taxIntegration
      if (
        (isEnterprisePlan || planFeatures.includes('vat_declaration') || planFeatures.includes('taxIntegration')) &&
        settings.taxDeclarationModuleEnabled !== true
      ) {
        settings.taxDeclarationModuleEnabled = true;
      }

      // HR & Payroll: if plan includes hr
      if ((isEnterprisePlan || planFeatures.includes('hr')) && settings.hrModuleEnabled !== true) {
        settings.hrModuleEnabled = true;
      }

      // Omnichannel storefront feature: if the plan includes storefront or is plan_omnichannel, ensure storefront is active (self-heal)
      if ((isOmnichannelPlan || planFeatures.includes('storefront')) && settings.storefrontModuleEnabled !== true) {
        settings.storefrontModuleEnabled = true;
      }
    }

    // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): a super-admin POS grant
    // re-enables the module + the cashier-shift gate on profiles that
    // force them off (wholesale_van / warehousing / import_export); a hide
    // turns POS off on profiles that default it on. Read-path safety net
    // for rows written before the override existed; the plan sync is the
    // primary writer of these two keys. Applied last so it wins over every
    // profile branch above.
    const posOverride = await this.loadFeatureOverride(scope.tenantId, 'pos');
    settings.posGrantedByOverride = posOverride === true;
    if (posOverride === true) {
      settings.posModuleEnabled = true;
      settings.requireCashierShiftForSales = true;
    } else if (posOverride === false) {
      settings.posModuleEnabled = false;
      settings.requireCashierShiftForSales = false;
    }

    this.remember(this._settingsCache, cacheKey, settings);
    return { ...settings, scope };
  }
}
