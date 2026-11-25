import { sql, type Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuditService } from '../../../core/audit/audit.service';
import type { AuthCacheService } from '../../../core/auth/services/auth-cache.service';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { TenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getIndustryProfile, normalizeIndustryProfileKey } from '../../../core/tenant/industry-profiles';

export class SettingsActivityProfile {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
    private readonly bound: {
      getSettings: (actor: AuthContext) => Promise<Record<string, unknown>>;
      invalidatePlanFeaturesCache: (tenantId: string | undefined) => void;
      invalidateSettingsCache: (tenantId: string | undefined) => void;
      loadFeatureOverride: (tenantId: string, featureCode: string) => Promise<boolean | null>;
      scope: (actor: AuthContext) => TenantScope;
    },
  ) {}

  private async getSettings(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.bound.getSettings(actor);
  }
  private invalidatePlanFeaturesCache(tenantId: string | undefined): void {
    return this.bound.invalidatePlanFeaturesCache(tenantId);
  }
  private invalidateSettingsCache(tenantId: string | undefined): void {
    return this.bound.invalidateSettingsCache(tenantId);
  }
  private async loadFeatureOverride(tenantId: string, featureCode: string): Promise<boolean | null> {
    return this.bound.loadFeatureOverride(tenantId, featureCode);
  }
  private scope(actor: AuthContext): TenantScope {
    return this.bound.scope(actor);
  }

  async setActivityProfile(activityType: string, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const normalizedKey = normalizeIndustryProfileKey(activityType);
    const profile = getIndustryProfile(normalizedKey);

    // 1. Update tenants table
    await this.db
      .updateTable('tenants')
      .set({ activity_type: normalizedKey })
      .where('id', '=', scope.tenantId)
      .execute();

    // 2. Also persist in settings table and reconcile mutually-exclusive module flags
    const modulePatch: Record<string, boolean> = {};
    if (profile.pillar === 'contracting') {
      modulePatch.contractingModuleEnabled = true;
      modulePatch.crmModuleEnabled = true;
      modulePatch.purchasesModuleEnabled = true;
      modulePatch.inventoryModuleEnabled = true;
      modulePatch.hrModuleEnabled = true;
      modulePatch.enableEnterpriseFeatures = true;
      modulePatch.fixedAssetsModuleEnabled = true;
      modulePatch.taxDeclarationModuleEnabled = true;
      modulePatch.maritimeFreightModuleEnabled = false;
      modulePatch.manufacturingModuleEnabled = false;
      modulePatch.servicesModuleEnabled = false;
      modulePatch.posModuleEnabled = false;
      modulePatch.enablePharmacyModule = false;
      modulePatch.restaurantModuleEnabled = false;
      modulePatch.enableMobileStoreFeatures = false;
      modulePatch.importModuleEnabled = false;
      modulePatch.autoPartsModuleEnabled = false;
      modulePatch.clothingModuleEnabled = false;
      modulePatch.requireCashierShiftForSales = false;
      modulePatch.storefrontModuleEnabled = false;
    } else if (profile.pillar === 'maritime_freight') {
      modulePatch.maritimeFreightModuleEnabled = true;
      modulePatch.crmModuleEnabled = true;
      modulePatch.purchasesModuleEnabled = true;
      modulePatch.hrModuleEnabled = true;
      modulePatch.enableEnterpriseFeatures = true;
      modulePatch.fixedAssetsModuleEnabled = true;
      modulePatch.taxDeclarationModuleEnabled = true;
      modulePatch.contractingModuleEnabled = false;
      modulePatch.manufacturingModuleEnabled = false;
      modulePatch.servicesModuleEnabled = false;
      modulePatch.inventoryModuleEnabled = false;
      modulePatch.posModuleEnabled = false;
      modulePatch.enablePharmacyModule = false;
      modulePatch.restaurantModuleEnabled = false;
      modulePatch.enableMobileStoreFeatures = false;
      modulePatch.importModuleEnabled = false;
      modulePatch.autoPartsModuleEnabled = false;
      modulePatch.clothingModuleEnabled = false;
      modulePatch.requireCashierShiftForSales = false;
      modulePatch.storefrontModuleEnabled = false;
    } else if (profile.pillar === 'manufacturing') {
      modulePatch.manufacturingModuleEnabled = true;
      modulePatch.crmModuleEnabled = true;
      modulePatch.purchasesModuleEnabled = true;
      modulePatch.inventoryModuleEnabled = true;
      modulePatch.hrModuleEnabled = true;
      modulePatch.enableEnterpriseFeatures = true;
      modulePatch.fixedAssetsModuleEnabled = true;
      modulePatch.taxDeclarationModuleEnabled = true;
      modulePatch.contractingModuleEnabled = false;
      modulePatch.maritimeFreightModuleEnabled = false;
      modulePatch.servicesModuleEnabled = false;
      modulePatch.posModuleEnabled = false;
      modulePatch.enablePharmacyModule = false;
      modulePatch.restaurantModuleEnabled = false;
      modulePatch.enableMobileStoreFeatures = false;
      modulePatch.importModuleEnabled = false;
      modulePatch.autoPartsModuleEnabled = false;
      modulePatch.clothingModuleEnabled = false;
      modulePatch.requireCashierShiftForSales = false;
      modulePatch.storefrontModuleEnabled = false;
    } else {
      // commerce pillar
      modulePatch.contractingModuleEnabled = false;
      modulePatch.maritimeFreightModuleEnabled = false;
      modulePatch.manufacturingModuleEnabled = false;
      modulePatch.servicesModuleEnabled = normalizedKey === 'services' || normalizedKey === 'maintenance';
      modulePatch.posModuleEnabled = normalizedKey !== 'services';
      modulePatch.inventoryModuleEnabled = normalizedKey !== 'services';
      modulePatch.purchasesModuleEnabled = true;
      modulePatch.crmModuleEnabled = true;
      const existingSettings = await this.getSettings(actor);
      if (existingSettings?.enableEnterpriseFeatures !== undefined) {
        modulePatch.enableEnterpriseFeatures = Boolean(existingSettings.enableEnterpriseFeatures);
      } else {
        modulePatch.enableEnterpriseFeatures = false;
      }
      modulePatch.fixedAssetsModuleEnabled = true;
      modulePatch.taxDeclarationModuleEnabled = true;
      modulePatch.enablePharmacyModule = normalizedKey === 'pharmacy';
      modulePatch.restaurantModuleEnabled = normalizedKey === 'restaurant';
      modulePatch.phoneOrdersModuleEnabled = [
        'restaurant',
        'pharmacy',
        'supermarket',
        'grocery',
        'food_beverage',
      ].includes(normalizedKey);
      modulePatch.enableMobileStoreFeatures = normalizedKey === 'maintenance';
      modulePatch.importModuleEnabled = normalizedKey === 'import_export';
      modulePatch.autoPartsModuleEnabled = normalizedKey === 'auto_parts';
      modulePatch.clothingModuleEnabled = normalizedKey === 'clothing' || normalizedKey === 'perfumes';
      modulePatch.comboModuleEnabled =
        normalizedKey === 'clothing' ||
        normalizedKey === 'perfumes' ||
        normalizedKey === 'restaurant' ||
        normalizedKey === 'retail_general';
      modulePatch.deliveryRepsModuleEnabled = !['services', 'warehousing', 'wholesale_van', 'import_export'].includes(
        normalizedKey,
      );

      if (normalizedKey === 'perfumes') {
        modulePatch.posModuleEnabled = true;
        modulePatch.inventoryModuleEnabled = true;
        modulePatch.purchasesModuleEnabled = true;
        modulePatch.comboModuleEnabled = true;
        modulePatch.clothingModuleEnabled = true;
        modulePatch.autoPartsModuleEnabled = false;
        modulePatch.enablePharmacyModule = false;
        modulePatch.restaurantModuleEnabled = false;
        modulePatch.enableMobileStoreFeatures = false;
        modulePatch.importModuleEnabled = false;
      }

      if (normalizedKey === 'wholesale_van') {
        modulePatch.posModuleEnabled = false;
        modulePatch.deliveryFleetModuleEnabled = true;
        modulePatch.requireCashierShiftForSales = false;
        modulePatch.enableEnterpriseFeatures = true;
        modulePatch.storefrontModuleEnabled = false;
      }
      if (normalizedKey === 'warehousing') {
        modulePatch.posModuleEnabled = false;
        modulePatch.requireCashierShiftForSales = false;
        modulePatch.inventoryModuleEnabled = true;
        modulePatch.purchasesModuleEnabled = true;
        modulePatch.enableEnterpriseFeatures = true;
        modulePatch.storefrontModuleEnabled = false;
      }
      if (normalizedKey === 'import_export') {
        modulePatch.posModuleEnabled = false;
        modulePatch.requireCashierShiftForSales = false;
        modulePatch.inventoryModuleEnabled = true;
        modulePatch.purchasesModuleEnabled = true;
        modulePatch.importModuleEnabled = true;
        modulePatch.enableEnterpriseFeatures = true;
        modulePatch.hrModuleEnabled = true;
        modulePatch.storefrontModuleEnabled = false;
      }
    }

    // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): a super-admin POS override
    // survives an activity change — a grant keeps POS + the cashier-shift
    // gate on even when the new profile forces them off (wholesale_van),
    // a hide keeps them off even when the new profile defaults them on.
    const posOverride = await this.loadFeatureOverride(scope.tenantId, 'pos');
    if (posOverride === true) {
      modulePatch.posModuleEnabled = true;
      modulePatch.requireCashierShiftForSales = true;
    } else if (posOverride === false) {
      modulePatch.posModuleEnabled = false;
      modulePatch.requireCashierShiftForSales = false;
    }

    const defaultProductKind = normalizedKey === 'clothing' ? 'fashion' : 'standard';
    const settingsEntries: Array<[string, any]> = [
      ['activityType', normalizedKey],
      ['businessIndustry', normalizedKey],
      ['defaultProductKind', defaultProductKind],
      ...Object.entries(modulePatch),
    ];
    for (const [key, value] of settingsEntries) {
      await sql`insert into settings (key, value, tenant_id, account_id) values (${key}, ${JSON.stringify(value)}, ${scope.tenantId}, ${scope.accountId}) on conflict (tenant_id, key) do update set value = excluded.value, account_id = excluded.account_id`.execute(
        this.db,
      );
    }

    // 3. Invalidate caches
    this.invalidateSettingsCache(scope.tenantId);
    this.invalidatePlanFeaturesCache(scope.tenantId);
    this.authCache.invalidateTenant(scope.tenantId);

    await this.audit.log(
      'تغيير نمط المنظومة',
      `تم تغيير نمط ونشاط المنظومة إلى [${profile.labelAr}] (${profile.pillar}) بواسطة ${actor.username}`,
      actor,
    );

    return {
      ok: true,
      activityType: normalizedKey,
      pillar: profile.pillar,
      profile,
      settingsPatch: modulePatch,
      message: `تم ضبط نمط المنظومة بنجاح إلى: ${profile.labelAr}`,
    };
  }
}
