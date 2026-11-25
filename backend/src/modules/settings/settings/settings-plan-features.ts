import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';

export class SettingsPlanFeatures {
  constructor(private readonly db: Kysely<Database>) {}

  // ── Plan features TTL cache (60 seconds) ────────────────────────────────
  private readonly _planFeaturesCache = new Map<string, { features: string[]; expiresAt: number }>();
  private readonly PLAN_FEATURES_TTL_MS = 60 * 1000;

  public async getPlanFeatures(tenantId: string, planId: string | null | undefined): Promise<string[]> {
    if (!planId) return [];
    const cacheKey = `${tenantId}:${planId}`;
    const cached = this._planFeaturesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this._planFeaturesCache.delete(cacheKey);
      this._planFeaturesCache.set(cacheKey, cached);
      return cached.features;
    }
    const rows = await this.db
      .selectFrom('plan_features')
      .select('feature_code')
      .where('plan_id', '=', planId as any)
      .execute();
    const features = rows.map((f) => f.feature_code as string);
    this._planFeaturesCache.set(cacheKey, { features, expiresAt: Date.now() + this.PLAN_FEATURES_TTL_MS });
    if (this._planFeaturesCache.size > 2_000)
      this._planFeaturesCache.delete(this._planFeaturesCache.keys().next().value!);
    return features;
  }

  /**
   * P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): reads one super-admin
   * per-tenant feature override. Returns true (granted), false (hidden),
   * or null (no override — the profile/plan default applies). Returns null
   * when the table does not exist yet (migrations not run).
   */
  async loadFeatureOverride(tenantId: string, featureCode: string): Promise<boolean | null> {
    try {
      const row = await this.db
        .selectFrom('tenant_feature_overrides')
        .select('granted')
        .where('tenant_id', '=', tenantId)
        .where('feature_code', '=', featureCode)
        .executeTakeFirst();
      return row ? Boolean(row.granted) : null;
    } catch {
      return null;
    }
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
}
