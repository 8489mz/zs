import { Inject, Injectable } from '@nestjs/common';
import { type Kysely } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { KYSELY_DB } from '../../database/database.constants';
import type { Database } from '../../database/database.types';
import type { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import type { TenantScope } from '../../core/auth/utils/tenant-boundary';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import type { IndustryProfile } from '../../core/tenant/industry-profiles';
import type { RawBuilder } from 'kysely';
import { SettingsPlanFeatures } from './settings/settings-plan-features';
import { SettingsCache } from './settings/settings-cache';
import { SettingsReads } from './settings/settings-reads';
import { SettingsLists } from './settings/settings-lists';
import { SettingsSave } from './settings/settings-save';
import { SettingsBranchesLocationsWrite } from './settings/settings-branches-locations-write';
import { SettingsLocationsAdmin } from './settings/settings-locations-admin';
import { SettingsActivityProfile } from './settings/settings-activity-profile';

@Injectable()
export class SettingsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly authCache: AuthCacheService,
  ) {
    this.s2 = new SettingsCache();
    this.s1 = new SettingsPlanFeatures(this.db);
    this.s3 = new SettingsReads(this.db, {
      getPlanFeatures: (tenantId, planId) => this.s1.getPlanFeatures(tenantId, planId),
      loadFeatureOverride: (tenantId, featureCode) => this.s1.loadFeatureOverride(tenantId, featureCode),
      remember: (cache, key, data) => this.s2.remember(cache, key, data),
      scope: (actor) => this.s2.scope(actor),
      tenantPredicate: (actor, alias) => this.s2.tenantPredicate(actor, alias),
      _settingsCache: this.s2._settingsCache,
    });
    this.s4 = new SettingsLists(this.db, {
      remember: (cache, key, data) => this.s2.remember(cache, key, data),
      scope: (actor) => this.s2.scope(actor),
      tenantPredicate: (actor, alias) => this.s2.tenantPredicate(actor, alias),
      _branchesCache: this.s2._branchesCache,
      _locationsCache: this.s2._locationsCache,
    });
    this.s5 = new SettingsSave(this.db, this.audit, this.authCache, {
      getSettings: (actor) => this.s3.getSettings(actor),
      invalidatePlanFeaturesCache: (tenantId) => this.s1.invalidatePlanFeaturesCache(tenantId),
      invalidateSettingsCache: (tenantId) => this.s2.invalidateSettingsCache(tenantId),
      loadFeatureOverride: (tenantId, featureCode) => this.s1.loadFeatureOverride(tenantId, featureCode),
      scope: (actor) => this.s2.scope(actor),
      tenantPredicate: (actor, alias) => this.s2.tenantPredicate(actor, alias),
    });
    this.s6 = new SettingsBranchesLocationsWrite(this.db, this.audit, {
      getPlanFeatures: (tenantId, planId) => this.s1.getPlanFeatures(tenantId, planId),
      invalidateBranchesCache: (tenantId) => this.s2.invalidateBranchesCache(tenantId),
      invalidateLocationsCache: (tenantId) => this.s2.invalidateLocationsCache(tenantId),
      listBranches: (actor) => this.s4.listBranches(actor),
      listLocations: (actor) => this.s4.listLocations(actor),
      scope: (actor) => this.s2.scope(actor),
      tenantPredicate: (actor, alias) => this.s2.tenantPredicate(actor, alias),
    });
    this.s7 = new SettingsLocationsAdmin(this.db, this.audit, {
      invalidateBranchesCache: (tenantId) => this.s2.invalidateBranchesCache(tenantId),
      invalidateLocationsCache: (tenantId) => this.s2.invalidateLocationsCache(tenantId),
      listBranches: (actor) => this.s4.listBranches(actor),
      listLocations: (actor) => this.s4.listLocations(actor),
      scope: (actor) => this.s2.scope(actor),
      tenantPredicate: (actor, alias) => this.s2.tenantPredicate(actor, alias),
    });
    this.s8 = new SettingsActivityProfile(this.db, this.audit, this.authCache, {
      getSettings: (actor) => this.s3.getSettings(actor),
      invalidatePlanFeaturesCache: (tenantId) => this.s1.invalidatePlanFeaturesCache(tenantId),
      invalidateSettingsCache: (tenantId) => this.s2.invalidateSettingsCache(tenantId),
      loadFeatureOverride: (tenantId, featureCode) => this.s1.loadFeatureOverride(tenantId, featureCode),
      scope: (actor) => this.s2.scope(actor),
    });
  }

  private readonly s1: SettingsPlanFeatures;
  private readonly s2: SettingsCache;
  private readonly s3: SettingsReads;
  private readonly s4: SettingsLists;
  private readonly s5: SettingsSave;
  private readonly s6: SettingsBranchesLocationsWrite;
  private readonly s7: SettingsLocationsAdmin;
  private readonly s8: SettingsActivityProfile;

  async loadFeatureOverride(tenantId: string, featureCode: string): Promise<boolean | null> {
    return this.s1.loadFeatureOverride(tenantId, featureCode);
  }
  invalidatePlanFeaturesCache(tenantId?: string) {
    return this.s1.invalidatePlanFeaturesCache(tenantId);
  }

  invalidateSettingsCache(tenantId?: string) {
    return this.s2.invalidateSettingsCache(tenantId);
  }
  invalidateBranchesCache(tenantId?: string) {
    return this.s2.invalidateBranchesCache(tenantId);
  }

  async getSettings(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.s3.getSettings(actor);
  }

  async listBranches(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.s4.listBranches(actor);
  }
  async listLocations(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.s4.listLocations(actor);
  }

  async saveSettings(payload: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.s5.saveSettings(payload, actor);
  }

  async createBranch(payload: { name?: string; code?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.s6.createBranch(payload, actor);
  }
  async createLocation(
    payload: { name?: string; code?: string; branchId?: string | number | null; locationType?: string },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.s6.createLocation(payload, actor);
  }
  async updateBranch(
    id: number,
    payload: {
      name?: string;
      code?: string;
      defaultStockLocationId?: string | number | null;
      salesStockMode?: 'single_location' | 'all_operational_locations';
      allowExternalSalesStock?: boolean;
    },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.s6.updateBranch(id, payload, actor);
  }

  async deleteBranch(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.s7.deleteBranch(id, actor);
  }
  async updateLocation(
    id: number,
    payload: { name?: string; code?: string; branchId?: string | number | null; locationType?: string },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.s7.updateLocation(id, payload, actor);
  }
  async deleteLocation(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.s7.deleteLocation(id, actor);
  }
  getIndustryProfiles(): IndustryProfile[] {
    return this.s7.getIndustryProfiles();
  }

  async setActivityProfile(activityType: string, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.s8.setActivityProfile(activityType, actor);
  }
}
