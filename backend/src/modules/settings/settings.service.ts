import { lockAccountingPeriod } from '../accounting/accounting-period-lock';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { isPlatformTenantId, requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { formatBranchStockLocationName } from '../../common/utils/branch-stock.util';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { invalidateTenantTimezoneCache, isValidTimezone } from '../../common/utils/tenant-timezone.util';
import { getIndustryProfile, normalizeIndustryProfileKey, listSupportedIndustryProfiles, type IndustryProfile } from '../../core/tenant/industry-profiles';
import { PLAN_MANAGED_MODULES_SETTING_KEY } from '../../common/constants/platform-settings-keys';
import { SalesWriteService } from '../sales/services/sales-write.service';

@Injectable()
export class SettingsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
  ) {}

  // ── Plan features TTL cache (60 seconds) ────────────────────────────────
  private readonly _planFeaturesCache = new Map<string, { features: string[]; expiresAt: number }>();
  private readonly PLAN_FEATURES_TTL_MS = 60 * 1000;

  private async getPlanFeatures(tenantId: string, planId: string | null | undefined): Promise<string[]> {
    if (!planId) return [];
    const cacheKey = `${tenantId}:${planId}`;
    const cached = this._planFeaturesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this._planFeaturesCache.delete(cacheKey);
      this._planFeaturesCache.set(cacheKey, cached);
      return cached.features;
    }
    const rows = await this.db.selectFrom('plan_features').select('feature_code').where('plan_id', '=', planId as any).execute();
    const features = rows.map(f => f.feature_code as string);
    this._planFeaturesCache.set(cacheKey, { features, expiresAt: Date.now() + this.PLAN_FEATURES_TTL_MS });
    if (this._planFeaturesCache.size > 2_000) this._planFeaturesCache.delete(this._planFeaturesCache.keys().next().value!);
    return features;
  }

  invalidatePlanFeaturesCache(tenantId?: string) {
    if (tenantId) {
      for (const key of this._planFeaturesCache.keys()) {
        if (key.startsWith(`${tenantId}:`)) this._planFeaturesCache.delete(key);
      }
    } else {
      this._planFeaturesCache.clear();
    }
  }

  // Tenant and permission-aware caches; each entry lives at most 60 seconds.
  private readonly _settingsCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
  private readonly _branchesCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
  private readonly _locationsCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60 * 1000;
  private remember<T>(cache: Map<string, { data: T; expiresAt: number }>, key: string, data: T): void {
    cache.delete(key);
    cache.set(key, { data, expiresAt: Date.now() + this.CACHE_TTL_MS });
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
  }

  invalidateSettingsCache(tenantId?: string) {
    if (tenantId) {
      for (const key of this._settingsCache.keys()) {
        if (key.startsWith(`${tenantId}:`)) this._settingsCache.delete(key);
      }
    } else {
      this._settingsCache.clear();
    }
    SalesWriteService.invalidateSettingsCache(tenantId);
    // `settings.timezone` له كاش منفصل عمره 5 دقائق داخل `tenant-timezone.util`،
    // وهو مصدر `work_date` للحضور. بدون إبطاله هنا يظل تغيير المنطقة الزمنية بلا
    // أثر حتى تنتهي المهلة — وقرب منتصف الليل يُكتب الحضور بيوم خاطئ.
    invalidateTenantTimezoneCache(tenantId);
  }

  invalidateBranchesCache(tenantId?: string) {
    if (tenantId) {
      this._branchesCache.delete(tenantId);
    } else {
      this._branchesCache.clear();
    }
  }

  invalidateLocationsCache(tenantId?: string) {
    if (tenantId) {
      for (const key of this._locationsCache.keys()) {
        if (key.startsWith(`${tenantId}:`)) this._locationsCache.delete(key);
      }
    } else {
      this._locationsCache.clear();
    }
  }

  private scope(actor: AuthContext) { return requireTenantScope(actor); }
  private tenantPredicate(actor: AuthContext, alias?: string) {
    const { tenantId, accountId } = this.scope(actor);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId} AND ${sql.ref(`${alias}.account_id`)} = ${accountId}`
      : sql<boolean>`tenant_id = ${tenantId} AND account_id = ${accountId}`;
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
    const canManageSettings = actor.role === 'super_admin'
      || actor.permissions?.includes('canManageSettings')
      || actor.permissions?.includes('settings');

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
      try { acc[row.key] = JSON.parse(row.value); } catch { acc[row.key] = row.value; }
      return acc;
    }, {});

    if (!settings.currency) {
      settings.currency = 'EGP';
    }

    // Ensure core business details and activity profile are strictly synced with tenant
    const tenant = await this.db.selectFrom('tenants').selectAll().where('id', '=', scope.tenantId).executeTakeFirst();
    const planFeatures = await this.getPlanFeatures(scope.tenantId, tenant?.plan_id);
    const hasPosEntitlement = planFeatures.includes('pos') || planFeatures.includes('cashDrawer') || planFeatures.includes('sales');
    const isRetailCommercePlan = tenant?.plan_id === 'plan_ultimate' || tenant?.plan_id === 'plan_omnichannel' || hasPosEntitlement;
    const isAlmhnds = tenant?.slug === 'almhnds';

    if (tenant) {
      if (!settings.country && (tenant as any).country_code) settings.country = (tenant as any).country_code;
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
        const candidate = (settings.activityType || settings.businessIndustry || primaryActivity || 'retail_general') as string;
        if ((candidate === 'services' || candidate.includes('خدمات') || candidate.includes('استشار')) && isRetailCommercePlan) {
          primaryActivity = 'retail_general';
        } else {
          primaryActivity = candidate;
        }
      } else if ((primaryActivity === 'services' || primaryActivity.includes('خدمات') || primaryActivity.includes('استشار')) && isRetailCommercePlan) {
        primaryActivity = 'retail_general';
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
    } else if (settings.pillar === 'manufacturing') {
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
      const isImportVertical = profileKey === 'import_export' || (settings.industryProfile as any)?.subVertical === 'import_export';

      // POS: enabled for all retail/hospitality/specialized verticals, disabled for wholesale_van, services, warehousing, and import_export
      if (isWarehousing || isImportVertical) {
        settings.posModuleEnabled = false;
        settings.requireCashierShiftForSales = false;
      } else if (isWholesaleVan || isServiceVertical) {
        if (isAlmhnds || isRetailCommercePlan || hasPosEntitlement) {
          settings.posModuleEnabled = true;
          settings.requireCashierShiftForSales = true;
        } else {
          settings.posModuleEnabled = false;
          settings.requireCashierShiftForSales = false;
        }
      } else {
        // If the profile has 'sales' in defaultFeatures, POS must be enabled (self-heal from corrupted false)
        settings.posModuleEnabled = profileDefaults.includes('sales') ? true : (settings.posModuleEnabled !== false);
      }

      if (isAlmhnds) {
        settings.posModuleEnabled = true;
        settings.requireCashierShiftForSales = true;
        settings.inventoryModuleEnabled = true;
        settings.servicesModuleEnabled = false;
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
      if (settings.inventoryModuleEnabled === undefined || (settings.inventoryModuleEnabled === false && profileDefaults.includes('inventory'))) {
        settings.inventoryModuleEnabled = profileDefaults.includes('inventory');
      }
      if (settings.purchasesModuleEnabled === undefined || (settings.purchasesModuleEnabled === false && profileDefaults.includes('purchases'))) {
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
        settings.phoneOrdersModuleEnabled = ['restaurant', 'pharmacy', 'supermarket', 'grocery', 'food_beverage'].includes(subVertical) || settings.restaurantModuleEnabled === true;
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

      const isOmnichannelPlan = tenant?.plan_id === 'plan_omnichannel' || (tenant as any)?.plan_id === 'OMNICHANNEL';
      const isUltimatePlan = tenant?.plan_id === 'plan_ultimate' || (tenant as any)?.plan_id === 'ULTIMATE';
      const isEnterprisePlan = isOmnichannelPlan || isUltimatePlan;

      // Delivery reps (retail / standard): if profile or plan includes deliveryReps, ensure it's enabled (self-heal)
      if (profileDefaults.includes('deliveryReps') || isEnterprisePlan || planFeatures.includes('deliveryReps')) {
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
      if ((isEnterprisePlan || profileDefaults.includes('accounting') || planFeatures.includes('accounting')) && settings.enableEnterpriseFeatures !== true) {
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
      if ((isEnterprisePlan || planFeatures.includes('vat_declaration') || planFeatures.includes('taxIntegration')) && settings.taxDeclarationModuleEnabled !== true) {
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

    this.remember(this._settingsCache, cacheKey, settings);
    return { ...settings, scope };
  }

  async listBranches(actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const cached = this._branchesCache.get(scope.tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      this._branchesCache.delete(scope.tenantId);
      this._branchesCache.set(scope.tenantId, cached);
      return { ...cached.data, scope };
    }
    const rows = await this.db.selectFrom('branches').select(['id', 'name', 'code', 'default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock']).where('is_active', '=', true).where(this.tenantPredicate(actor)).orderBy('id', 'asc').execute();
    const result = { branches: rows.map((row) => ({ id: String(row.id), name: row.name || '', code: row.code || '', defaultStockLocationId: row.default_stock_location_id ? String(row.default_stock_location_id) : null, salesStockMode: row.sales_stock_mode, allowExternalSalesStock: row.allow_external_sales_stock })) };
    this.remember(this._branchesCache, scope.tenantId, result);
    return { ...result, scope };
  }

  async listLocations(actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const isStorekeeperRestricted = actor.role === 'storekeeper' && !actor.permissions?.includes('canManageBranchStock');
    const cacheKey = `${scope.tenantId}:${Boolean(isStorekeeperRestricted)}`;
    const cached = this._locationsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this._locationsCache.delete(cacheKey);
      this._locationsCache.set(cacheKey, cached);
      return { ...cached.data, scope };
    }

    let query = this.db
      .selectFrom('stock_locations as l')
      .leftJoin('branches as b', (join) => join.onRef('b.id', '=', 'l.branch_id').on(sql<boolean>`b.tenant_id = ${scope.tenantId} AND b.account_id = ${scope.accountId}`))
      .select(['l.id', 'l.name', 'l.code', 'l.branch_id', 'b.name as branch_name', 'l.is_active', 'l.location_type'])
      .where(this.tenantPredicate(actor, 'l'))
      .where('l.location_type', '!=', 'in_transit')
      .orderBy('l.id', 'asc');

    if (isStorekeeperRestricted) {
      query = query.where('l.location_type', '!=', 'branch_stock');
    }

    const rows = await query.execute();
    const result = { locations: rows.map((row) => ({ id: String(row.id), name: row.name + (!row.is_active ? ' (محذوف)' : ''), code: row.code || '', branchId: row.branch_id ? String(row.branch_id) : '', branchName: row.branch_name || '', isActive: row.is_active, locationType: row.location_type })) };
    this.remember(this._locationsCache, cacheKey, result);
    return { ...result, scope };
  }

  async saveSettings(payload: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('Settings payload must be an object', 'SETTINGS_INVALID', 400);
    const scope = this.scope(actor);
    const currentBranchIdRaw = String(payload.currentBranchId ?? '').trim();
    const currentLocationIdRaw = String(payload.currentLocationId ?? '').trim();

    const normalizedPayload = { ...payload };

    // Only process branch and location if they are provided
    if (currentBranchIdRaw) {
      const currentBranchId = Number(currentBranchIdRaw);
      let branch = null;
      if (Number.isFinite(currentBranchId) && currentBranchId > 0) {
        branch = await this.db
          .selectFrom('branches')
          .select(['id', 'default_stock_location_id'])
          .where('id', '=', currentBranchId)
          .where(this.tenantPredicate(actor))
          .executeTakeFirst();
      }

      if (!branch) {
        // Fallback to the tenant's first active branch if available
        branch = await this.db
          .selectFrom('branches')
          .select(['id', 'default_stock_location_id'])
          .where('is_active', '=', true)
          .where(this.tenantPredicate(actor))
          .orderBy('id', 'asc')
          .executeTakeFirst();
      }

      if (branch) {
        normalizedPayload.currentBranchId = String(branch.id);
        let locationId = currentLocationIdRaw ? Number(currentLocationIdRaw) : branch.default_stock_location_id;

        if (locationId && Number.isFinite(locationId) && locationId > 0) {
          const location = await this.db
            .selectFrom('stock_locations')
            .select(['id'])
            .where('id', '=', locationId)
            .where(this.tenantPredicate(actor))
            .executeTakeFirst();
            
          if (location) {
            normalizedPayload.currentLocationId = String(location.id);
          } else {
            delete normalizedPayload.currentLocationId;
          }
        }
      } else {
        delete normalizedPayload.currentBranchId;
        delete normalizedPayload.currentLocationId;
      }
    }


    if ('uiLanguage' in normalizedPayload) {
      normalizedPayload.uiLanguage = String(normalizedPayload.uiLanguage || '').trim().toLowerCase() === 'en' ? 'en' : 'ar';
    }
    if ('defaultBranchIssueMode' in normalizedPayload) {
      normalizedPayload.defaultBranchIssueMode = normalizedPayload.defaultBranchIssueMode === 'transfer_to_branch_stock' ? 'transfer_to_branch_stock' : 'final_issue';
    }
    if ('timezone' in normalizedPayload && normalizedPayload.timezone) {
      const tz = String(normalizedPayload.timezone).trim();
      if (!isValidTimezone(tz)) {
        throw new AppError('المنطقة الزمنية المحددة غير صالحة', 'INVALID_TIMEZONE', 400);
      }
      normalizedPayload.timezone = tz;
    }

    const tenantRow = await this.db
      .selectFrom('tenants')
      .select(['activity_type'])
      .where('id', '=', scope.tenantId)
      .executeTakeFirst();

    const rawRequestedActivity = String(
      normalizedPayload.activityType || normalizedPayload.businessIndustry || '',
    ).trim().toLowerCase();

    let effectiveType = tenantRow?.activity_type || rawRequestedActivity || 'retail_general';

    // Allow Super Admin to switch the tenant's activity profile via settings save
    const isSuperAdminActor = actor.role === 'super_admin';
    if (isSuperAdminActor && rawRequestedActivity && rawRequestedActivity !== tenantRow?.activity_type) {
      const normalizedKey = normalizeIndustryProfileKey(rawRequestedActivity);
      await this.db
        .updateTable('tenants')
        .set({ activity_type: normalizedKey })
        .where('id', '=', scope.tenantId)
        .execute();
      this.authCache.invalidateTenant(scope.tenantId);
      this.invalidatePlanFeaturesCache(scope.tenantId);
      effectiveType = normalizedKey;
      normalizedPayload.activityType = normalizedKey;
      normalizedPayload.businessIndustry = normalizedKey;
    }

    const profile = getIndustryProfile(effectiveType);

    if (profile.pillar === 'contracting') {
      normalizedPayload.contractingModuleEnabled = true;
      normalizedPayload.crmModuleEnabled = true;
      normalizedPayload.purchasesModuleEnabled = true;
      normalizedPayload.inventoryModuleEnabled = true;
      normalizedPayload.hrModuleEnabled = true;
      normalizedPayload.enableEnterpriseFeatures = true;
      normalizedPayload.fixedAssetsModuleEnabled = true;
      normalizedPayload.taxDeclarationModuleEnabled = true;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else if (profile.pillar === 'maritime_freight') {
      normalizedPayload.maritimeFreightModuleEnabled = true;
      normalizedPayload.crmModuleEnabled = true;
      normalizedPayload.purchasesModuleEnabled = true;
      normalizedPayload.hrModuleEnabled = true;
      normalizedPayload.enableEnterpriseFeatures = true;
      normalizedPayload.fixedAssetsModuleEnabled = true;
      normalizedPayload.taxDeclarationModuleEnabled = true;
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.manufacturingModuleEnabled = false;
      normalizedPayload.inventoryModuleEnabled = false;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else if (profile.pillar === 'manufacturing') {
      normalizedPayload.manufacturingModuleEnabled = true;
      normalizedPayload.crmModuleEnabled = true;
      normalizedPayload.purchasesModuleEnabled = true;
      normalizedPayload.inventoryModuleEnabled = true;
      normalizedPayload.hrModuleEnabled = true;
      normalizedPayload.enableEnterpriseFeatures = true;
      normalizedPayload.fixedAssetsModuleEnabled = true;
      normalizedPayload.taxDeclarationModuleEnabled = true;
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else if (profile.key === 'import_export' || profile.subVertical === 'import_export') {
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.manufacturingModuleEnabled = false;
      normalizedPayload.importModuleEnabled = true;
      normalizedPayload.inventoryModuleEnabled = true;
      normalizedPayload.purchasesModuleEnabled = true;
      normalizedPayload.enableEnterpriseFeatures = true;
      normalizedPayload.hrModuleEnabled = true;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else if (profile.key === 'warehousing' || profile.key === 'wholesale_van') {
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.posModuleEnabled = false;
      normalizedPayload.requireCashierShiftForSales = false;
    } else {
      normalizedPayload.contractingModuleEnabled = false;
      normalizedPayload.maritimeFreightModuleEnabled = false;
      normalizedPayload.posModuleEnabled = true;
    }

    // Strictly protect module switches: only Super Admin can manually toggle or disable modules
    if (!isSuperAdminActor) {
      const protectedModuleKeys = [
        'posModuleEnabled',
        'inventoryModuleEnabled',
        'purchasesModuleEnabled',
        'contractingModuleEnabled',
        'maritimeFreightModuleEnabled',
        'manufacturingModuleEnabled',
        'enablePharmacyModule',
        'enableMobileStoreFeatures',
        'clothingModuleEnabled',
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
        'weightedBarcodeEnabled',
        'posShowCartMeta',
        'phoneOrdersModuleEnabled',
        'autoPartsModuleEnabled',
      ];
      for (const key of protectedModuleKeys) {
        delete normalizedPayload[key];
      }
    }

    // Platform bookkeeping, never a tenant setting: this records which module switches the
    // last plan sync granted, and the next sync takes its revocation list from it. It is
    // returned by getSettings like any other row, so a full round-trip of the settings
    // object would otherwise write it straight back — and a crafted value would steer what
    // the next sync switches off.
    delete normalizedPayload[PLAN_MANAGED_MODULES_SETTING_KEY];

    // The developer master-password hash is set ONLY through the
    // guarded POST /api/developer/master-password endpoint, by the
    // super_admin, as a bcrypt hash. A generic settings payload must
    // never create or overwrite it — a settings manager writing a
    // chosen hash here would take over the developer panel.
    delete normalizedPayload['developerMasterPasswordHash'];

    await this.db.transaction().execute(async trx => {
      if ('currency' in normalizedPayload) {
        await lockAccountingPeriod(trx, scope.tenantId);
        const requested = String(normalizedPayload.currency || '').trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(requested)) throw new AppError('رمز العملة غير صالح', 'INVALID_CURRENCY', 400);
        const current = await tenantBaseCurrency(trx, scope.tenantId);
        if (requested !== current) {
          const posted = await trx.selectFrom('journal_entries').select('id').where('tenant_id', '=', scope.tenantId).where('status', '=', 'posted').limit(1).executeTakeFirst();
          const rate = await trx.selectFrom('currency_exchange_rates').select('id').where('tenant_id', '=', scope.tenantId).limit(1).executeTakeFirst();
          if (posted || rate) throw new AppError('تغيير عملة الأساس بعد تهيئة أسعار الصرف أو الترحيل يتطلب تحويل دفاتر معتمداً', 'BASE_CURRENCY_LOCKED', 400);
        }
        normalizedPayload.currency = requested;
      }
      for (const [key, value] of Object.entries(normalizedPayload)) {
        await sql`insert into settings (key, value, tenant_id, account_id) values (${key}, ${JSON.stringify(value)}, ${scope.tenantId}, ${scope.accountId}) on conflict (tenant_id, key) do update set value = excluded.value, account_id = excluded.account_id`.execute(trx);
      }
    });
    this.invalidateSettingsCache(scope.tenantId);
    await this.audit.log('تعديل الإعدادات', `تم تعديل الإعدادات بواسطة ${actor.username}`, actor);
    return this.getSettings(actor);
  }

  async createBranch(payload: { name?: string; code?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const name = String(payload.name || '').trim();
    const code = String(payload.code || '').trim();
    if (!name) throw new AppError('Branch name is required', 'BRANCH_NAME_REQUIRED', 400);

    const isPlatformTenant = isPlatformTenantId(scope.tenantId);
    const isPlatformAdmin = actor.role === 'super_admin' && isPlatformTenant;

    if (!isPlatformAdmin) {
      const activeBranches = await this.db.selectFrom('branches').select(['id']).where(this.tenantPredicate(actor)).where('is_active', '=', true).execute();
      const tenant = await this.db.selectFrom('tenants').select(['id', 'plan_id', 'extra_features', 'status']).where('id', '=', scope.tenantId).executeTakeFirst();
      const planFeatures = await this.getPlanFeatures(scope.tenantId, tenant?.plan_id as any);
      const extraFeatures = Array.isArray(tenant?.extra_features) ? tenant?.extra_features : typeof tenant?.extra_features === 'string' ? JSON.parse(tenant.extra_features) : [];
      const allFeatures = new Set([...planFeatures, ...extraFeatures]);
      
      const hasMultiBranch = allFeatures.has('multi_branch') || allFeatures.has('branches') || allFeatures.has('inventory');
      
      const activeSub = await this.db
        .selectFrom('tenant_subscriptions as s')
        .leftJoin('saas_plans as p', 'p.id', 's.plan_id')
        .select(['p.max_branches'])
        .where('s.tenant_id', '=', scope.tenantId)
        .where('s.status', 'in', ['active', 'past_due'])
        .orderBy('s.created_at', 'desc')
        .executeTakeFirst();

      const maxBranches = activeSub?.max_branches ?? (hasMultiBranch ? (tenant?.plan_id === 'plan_pro' ? 3 : 999) : (tenant?.status === 'trial' ? 2 : 1));
      if (activeBranches.length >= maxBranches) {
        throw new AppError(`وصلت للحد الأقصى المسموح به في باقتك (${maxBranches} فرع). يرجى ترقية الباقة لإضافة فروع جديدة.`, 'PLAN_LIMIT_REACHED', 403);
      }
    }

    const existingBranch = await this.db
      .selectFrom('branches')
      .select(['id', 'name'])
      .where(this.tenantPredicate(actor))
      .where(sql`lower(name)`, '=', name.toLowerCase())
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (existingBranch) {
      throw new AppError(`يوجد فرع نشط بهذا الاسم بالفعل ("${name}"). يرجى اختيار اسم فرع مختلف.`, 'DUPLICATE_BRANCH_NAME', 400);
    }

    let inserted;
    try {
      inserted = await this.db.transaction().execute(async (trx) => {
        // 1. Insert Branch
        const newBranch = await trx.insertInto('branches').values({ name, code, is_active: true, tenant_id: scope.tenantId, account_id: scope.accountId, sales_stock_mode: 'single_location', allow_external_sales_stock: false }).returning(['id', 'name', 'code']).executeTakeFirstOrThrow();

        // 2. Generate location name using standard helper (e.g. "رصيد فرع التعاونيات")
        const locationName = formatBranchStockLocationName(newBranch.name);

        // 3. Create default stock location
        const newLocation = await trx.insertInto('stock_locations').values({
          name: locationName,
          code: '',
          branch_id: newBranch.id,
          location_type: 'branch_stock',
          is_active: true,
          tenant_id: scope.tenantId,
          account_id: scope.accountId
        }).returning('id').executeTakeFirstOrThrow();

        // 4. Update branch with default stock location id
        await trx.updateTable('branches').set({ default_stock_location_id: newLocation.id }).where('id', '=', newBranch.id).where('tenant_id', '=', scope.tenantId).execute();

        return newBranch;
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err?.code === '23505' && (err?.constraint?.includes('branches_tenant_name_uidx') || err?.detail?.includes('already exists') || err?.message?.includes('branches_tenant_name_uidx'))) {
        throw new AppError(`يوجد فرع مسجل بهذا الاسم بالفعل ("${name}"). يرجى اختيار اسم فرع مختلف.`, 'DUPLICATE_BRANCH_NAME', 400);
      }
      throw err;
    }

    this.invalidateBranchesCache(scope.tenantId);
    this.invalidateLocationsCache(scope.tenantId);
    await this.audit.log('إضافة فرع', `تمت إضافة الفرع ${name} بواسطة ${actor.username}`, actor);
    return { ok: true, branch: { id: String(inserted.id), name: inserted.name || '', code: inserted.code || '' }, ...(await this.listBranches(actor)) };
  }

  async createLocation(payload: { name?: string; code?: string; branchId?: string | number | null; locationType?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const name = String(payload.name || '').trim();
    const code = String(payload.code || '').trim();
    const branchId = payload.branchId === '' || payload.branchId == null ? null : Number(payload.branchId);
    const locationType = String(payload.locationType || 'internal_warehouse').trim();
    if (locationType === 'in_transit') {
      throw new AppError('لا يمكن إنشاء المخزن ليكون قيد النقل يدوياً', 'INVALID_LOCATION_TYPE', 400);
    }
    const validTypes = ['internal_warehouse', 'external_warehouse', 'branch_stock', 'damaged'];
    if (!validTypes.includes(locationType)) {
      throw new AppError('نوع المخزن غير صالح', 'INVALID_LOCATION_TYPE', 400);
    }
    if (locationType === 'branch_stock' && !branchId) {
      throw new AppError('يجب ربط رصيد الفرع بفرع محدد', 'BRANCH_REQUIRED_FOR_BRANCH_STOCK', 400);
    }
    if (!name) throw new AppError('Location name is required', 'LOCATION_NAME_REQUIRED', 400);

    if (actor.role !== 'super_admin') {
      const activeLocations = await this.db.selectFrom('stock_locations').select(['id']).where(this.tenantPredicate(actor)).where('is_active', '=', true).execute();
      const tenant = await this.db.selectFrom('tenants').select(['id', 'plan_id', 'extra_features']).where('id', '=', scope.tenantId).executeTakeFirst();
      const planFeatures = await this.getPlanFeatures(scope.tenantId, tenant?.plan_id as any);
      const extraFeatures = Array.isArray(tenant?.extra_features) ? tenant?.extra_features : typeof tenant?.extra_features === 'string' ? JSON.parse(tenant.extra_features) : [];
      const allFeatures = new Set([...planFeatures, ...extraFeatures]);
      
      const hasAdvancedInventory = allFeatures.has('inventory');
      if (!hasAdvancedInventory && activeLocations.length >= 1) {
        throw new AppError('وصلت للحد الأقصى المسموح به في باقتك (مخزن واحد). يرجى ترقية الباقة لتفعيل موديول المخزون لإضافة مخازن إضافية.', 'PLAN_LIMIT_REACHED', 403);
      }
    }

    if (branchId !== null) {
      const branch = await this.db.selectFrom('branches').select(['id']).where('id', '=', branchId).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
      if (!branch) throw new AppError('Branch not found', 'BRANCH_NOT_FOUND', 404);
    }
    const inserted = await this.db.insertInto('stock_locations').values({ name, code, branch_id: branchId, location_type: locationType as any, is_active: true, tenant_id: scope.tenantId, account_id: scope.accountId }).returning(['id', 'name', 'code', 'branch_id', 'location_type']).executeTakeFirstOrThrow();
    this.invalidateLocationsCache(scope.tenantId);
    await this.audit.log('إضافة مخزن', `تمت إضافة المخزن ${name} بواسطة ${actor.username}`, actor);
    return { ok: true, location: { id: String(inserted.id), name: inserted.name || '', code: inserted.code || '', branchId: inserted.branch_id ? String(inserted.branch_id) : '', locationType: inserted.location_type }, ...(await this.listLocations(actor)) };
  }

  async updateBranch(id: number, payload: { name?: string; code?: string; defaultStockLocationId?: string | number | null; salesStockMode?: 'single_location' | 'all_operational_locations'; allowExternalSalesStock?: boolean; }, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const branch = await this.db.selectFrom('branches').select(['id', 'name', 'default_stock_location_id']).where('id', '=', id).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!branch) throw new AppError('Branch not found', 'BRANCH_NOT_FOUND', 404);
    const name = String(payload.name || '').trim();
    const code = String(payload.code || '').trim();
    if (!name) throw new AppError('Branch name is required', 'BRANCH_NAME_REQUIRED', 400);

    const duplicate = await this.db
      .selectFrom('branches')
      .select(['id'])
      .where(this.tenantPredicate(actor))
      .where(sql`lower(name)`, '=', name.toLowerCase())
      .where('id', '!=', id)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (duplicate) {
      throw new AppError(`يوجد فرع آخر مسجل بهذا الاسم بالفعل ("${name}"). يرجى اختيار اسم فرع مختلف.`, 'DUPLICATE_BRANCH_NAME', 400);
    }

    const updates: any = { name, code };
    if (payload.defaultStockLocationId !== undefined) updates.default_stock_location_id = payload.defaultStockLocationId ? Number(payload.defaultStockLocationId) : null;
    if (payload.salesStockMode !== undefined) updates.sales_stock_mode = payload.salesStockMode;
    if (payload.allowExternalSalesStock !== undefined) updates.allow_external_sales_stock = payload.allowExternalSalesStock;

    try {
      await this.db.transaction().execute(async (trx) => {
        await trx.updateTable('branches').set(updates).where('id', '=', id).where(this.tenantPredicate(actor)).execute();

        // Check if we need to auto-rename the default location
        if (branch.default_stock_location_id && name !== branch.name) {
          const defaultLocation = await trx.selectFrom('stock_locations').select(['id', 'name', 'location_type']).where('id', '=', branch.default_stock_location_id).where(this.tenantPredicate(actor)).executeTakeFirst();
          if (defaultLocation) {
            const expectedNewName = formatBranchStockLocationName(name);
            await trx.updateTable('stock_locations').set({ name: expectedNewName }).where('id', '=', defaultLocation.id).where('tenant_id', '=', scope.tenantId).execute();
          }
        }
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err?.code === '23505' && (err?.constraint?.includes('branches_tenant_name_uidx') || err?.detail?.includes('already exists') || err?.message?.includes('branches_tenant_name_uidx'))) {
        throw new AppError(`يوجد فرع آخر مسجل بهذا الاسم بالفعل ("${name}"). يرجى اختيار اسم فرع مختلف.`, 'DUPLICATE_BRANCH_NAME', 400);
      }
      throw err;
    }

    this.invalidateBranchesCache(scope.tenantId);
    this.invalidateLocationsCache(scope.tenantId);
    await this.audit.log('تعديل فرع', `تم تحديث الفرع #${id} بواسطة ${actor.username}`, actor);
    return { ok: true, branchId: String(id), ...(await this.listBranches(actor)) };
  }

  async deleteBranch(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const branch = await this.db.selectFrom('branches').select(['id']).where('id', '=', id).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!branch) throw new AppError('Branch not found', 'BRANCH_NOT_FOUND', 404);
    const linkedLocations = await this.db.selectFrom('stock_locations').select((eb) => eb.fn.countAll<number>().as('count')).where('branch_id', '=', id).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirstOrThrow();
    if (Number(linkedLocations.count || 0) > 0) throw new AppError('Branch still has active locations', 'BRANCH_HAS_LOCATIONS', 400);
    await this.db.updateTable('branches').set({ is_active: false }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
    this.invalidateBranchesCache(scope.tenantId);
    await this.audit.log('حذف فرع', `تم إلغاء تفعيل الفرع #${id} بواسطة ${actor.username}`, actor);
    return { ok: true, removedBranchId: String(id), ...(await this.listBranches(actor)) };
  }

  async updateLocation(id: number, payload: { name?: string; code?: string; branchId?: string | number | null; locationType?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const location = await this.db.selectFrom('stock_locations').select(['id', 'location_type']).where('id', '=', id).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!location) throw new AppError('Location not found', 'LOCATION_NOT_FOUND', 404);
    const name = String(payload.name || '').trim();
    const code = String(payload.code || '').trim();
    const branchId = payload.branchId === '' || payload.branchId == null ? null : Number(payload.branchId);
    const locationType = String(payload.locationType || location.location_type).trim();
    if (payload.locationType === 'in_transit' && location.location_type !== 'in_transit') {
      throw new AppError('لا يمكن إنشاء أو تعديل المخزن ليكون قيد النقل يدوياً', 'INVALID_LOCATION_TYPE', 400);
    }
    const validTypes = ['internal_warehouse', 'external_warehouse', 'branch_stock', 'damaged', 'in_transit'];
    if (!validTypes.includes(locationType)) {
      throw new AppError('نوع المخزن غير صالح', 'INVALID_LOCATION_TYPE', 400);
    }
    if (locationType === 'branch_stock' && !branchId) {
      throw new AppError('يجب ربط رصيد الفرع بفرع محدد', 'BRANCH_REQUIRED_FOR_BRANCH_STOCK', 400);
    }
    if (!name) throw new AppError('Location name is required', 'LOCATION_NAME_REQUIRED', 400);
    if (branchId !== null) {
      const branch = await this.db.selectFrom('branches').select(['id']).where('id', '=', branchId).where('is_active', '=', true).where(this.tenantPredicate(actor)).executeTakeFirst();
      if (!branch) throw new AppError('Branch not found', 'BRANCH_NOT_FOUND', 404);
    }
    await this.db.updateTable('stock_locations').set({ name, code, branch_id: branchId, location_type: locationType as any }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
    this.invalidateLocationsCache(scope.tenantId);
    await this.audit.log('تعديل مخزن', `تم تحديث المخزن #${id} بواسطة ${actor.username}`, actor);
    return { ok: true, locationId: String(id), ...(await this.listLocations(actor)) };
  }

  async deleteLocation(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(actor);
    const location = await this.db.selectFrom('stock_locations').select(['id', 'is_active']).where('id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (!location) throw new AppError('Location not found', 'LOCATION_NOT_FOUND', 404);

    const branchWithDefault = await this.db.selectFrom('branches').select('id').where('default_stock_location_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (branchWithDefault) throw new AppError('لا يمكن حذف المخزن الافتراضي لفرع. قم بتغيير المخزن الافتراضي للفرع أولاً', 'LOCATION_IS_DEFAULT_FOR_BRANCH', 400);

    const stocks = await this.db.selectFrom('product_location_stock').select((eb) => eb.fn.sum<number>('qty').as('total_qty')).where('location_id', '=', id).where(this.tenantPredicate(actor)).executeTakeFirst();
    if (Number(stocks?.total_qty || 0) > 0) throw new AppError('لا يمكن حذف المخزن طالما يوجد به رصيد. يجب تحويل الرصيد أولاً', 'LOCATION_HAS_STOCK', 400);

    // Clean up empty stock records first
    await this.db.deleteFrom('product_location_stock').where('location_id', '=', id).where('qty', '<=', 0).where(this.tenantPredicate(actor)).execute();

    try {
      // Clear movement history for this location to allow hard deletion
      await this.db.deleteFrom('stock_movements').where('location_id', '=', id).where(this.tenantPredicate(actor)).execute();

      // Try to hard delete
      await this.db.deleteFrom('stock_locations').where('id', '=', id).where(this.tenantPredicate(actor)).execute();
      this.invalidateLocationsCache(scope.tenantId);
      await this.audit.log('حذف مخزن نهائي', `تم حذف المخزن #${id} نهائياً بواسطة ${actor.username}`, actor);
    } catch (error: any) {
      // If foreign key constraint fails (e.g. stock_movements), fallback to soft delete
      if (error.code === '23503') {
        if (location.is_active) {
          await this.db.updateTable('stock_locations').set({ is_active: false }).where('id', '=', id).where(this.tenantPredicate(actor)).execute();
          this.invalidateLocationsCache(scope.tenantId);
          await this.audit.log('أرشفة مخزن', `تم أرشفة المخزن #${id} لوجود حركات سابقة بواسطة ${actor.username}`, actor);
        }
      } else {
        throw error;
      }
    }
    return { ok: true, removedLocationId: String(id), ...(await this.listLocations(actor)) };
  }

  getIndustryProfiles(): IndustryProfile[] {
    return listSupportedIndustryProfiles();
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
      modulePatch.phoneOrdersModuleEnabled = ['restaurant', 'pharmacy', 'supermarket', 'grocery', 'food_beverage'].includes(normalizedKey);
      modulePatch.enableMobileStoreFeatures = normalizedKey === 'maintenance';
      modulePatch.importModuleEnabled = normalizedKey === 'import_export';
      modulePatch.autoPartsModuleEnabled = normalizedKey === 'auto_parts';
      modulePatch.clothingModuleEnabled = normalizedKey === 'clothing' || normalizedKey === 'perfumes';
      modulePatch.comboModuleEnabled = normalizedKey === 'clothing' || normalizedKey === 'perfumes' || normalizedKey === 'restaurant' || normalizedKey === 'retail_general';

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

    const defaultProductKind = normalizedKey === 'clothing' ? 'fashion' : 'standard';
    const settingsEntries: Array<[string, any]> = [
      ['activityType', normalizedKey],
      ['businessIndustry', normalizedKey],
      ['defaultProductKind', defaultProductKind],
      ...Object.entries(modulePatch),
    ];
    for (const [key, value] of settingsEntries) {
      await sql`insert into settings (key, value, tenant_id, account_id) values (${key}, ${JSON.stringify(value)}, ${scope.tenantId}, ${scope.accountId}) on conflict (tenant_id, key) do update set value = excluded.value, account_id = excluded.account_id`.execute(this.db);
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
