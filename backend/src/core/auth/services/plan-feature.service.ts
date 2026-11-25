import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';

import { getIndustryProfile } from '../../tenant/industry-profiles';
import { getFallbackPlanFeatures, isOmnichannelPlanId } from '../../tenant/plan-tier.util';

@Injectable()
export class PlanFeatureService implements OnModuleInit {
  private planFeatures = new Map<string, Set<string>>();

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  async refreshCache() {
    try {
      const rows = await this.db.selectFrom('plan_features').select(['plan_id', 'feature_code']).execute();
      const newCache = new Map<string, Set<string>>();

      for (const row of rows) {
        if (!newCache.has(row.plan_id)) {
          newCache.set(row.plan_id, new Set());
        }
        newCache.get(row.plan_id)!.add(row.feature_code);
      }

      this.planFeatures = newCache;
    } catch (error: any) {
      // Table might not exist yet if migrations haven't run
      this.planFeatures = new Map<string, Set<string>>();
      console.warn(`[PlanFeatureService] Could not refresh cache (possibly missing table): ${error.message}`);
    }
  }

  hasFeature(
    planId: string | undefined,
    extraFeatures: string[] | undefined,
    requiredFeature: string,
    pillar?: string,
    activityType?: string,
    featureOverrides?: Record<string, boolean>,
  ): boolean {
    // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): a super-admin per-tenant
    // override beats every other source — plan exclusion, extra_features
    // grant/exclusion, and the profile/subVertical blocks below. A grant
    // turns the feature on even where the mode default is off (POS on
    // wholesale_van); a hide turns it off even where the plan grants it.
    if (featureOverrides && requiredFeature in featureOverrides) {
      return featureOverrides[requiredFeature];
    }
    if (extraFeatures && extraFeatures.includes(`-${requiredFeature}`)) {
      return false;
    }
    if (extraFeatures && extraFeatures.includes(requiredFeature)) {
      return true;
    }

    // 1. Full Vertical Suite Invariant: Contracting & Maritime Freight get their full operational suite automatically
    if (pillar === 'contracting' || activityType === 'contracting') {
      const profile = getIndustryProfile('contracting');
      if (profile.defaultFeatures.includes(requiredFeature)) {
        return true;
      }
      if (['pharmacy', 'restaurant', 'maritime_freight', 'storefront', 'kds'].includes(requiredFeature)) {
        return false;
      }
    }

    if (pillar === 'maritime_freight' || activityType === 'maritime_freight') {
      const profile = getIndustryProfile('maritime_freight');
      if (profile.defaultFeatures.includes(requiredFeature)) {
        return true;
      }
      if (
        ['pharmacy', 'restaurant', 'contracting', 'manufacturing', 'storefront', 'pos', 'kds'].includes(requiredFeature)
      ) {
        return false;
      }
    }

    // Manufacturing is a normal band-4 commerce product, not an isolated
    // pillar; it falls through to the commerce branch below, and its
    // sector flag ('manufacturing') is granted via defaultFeatures.
    // 'pos' is NOT granted to it (INV-POS-RETAIL-FEATURE-GATE): the
    // sidebar hides 'pos' for the manufacturing vertical, the route
    // suite has no 'pos' for it, and the settings layer forces
    // posModuleEnabled=false, so a factory-outlet counter is a separate
    // product decision. (An older comment here claimed it "has POS, like
    // wholesale/import" — wholesale_van and import_export never had POS
    // either, so the analogy was wrong.) It can also be installed as an add-on
    // module on top of ANY other activity (a restaurant making chocolate, a pharmacy compounding)
    // via the literal extraFeatures check above.

    const isDedicatedPillar =
      pillar === 'contracting' ||
      pillar === 'maritime_freight' ||
      activityType === 'contracting' ||
      activityType === 'maritime_freight';

    if (!isDedicatedPillar) {
      const profile = getIndustryProfile(activityType);
      if (
        profile.subVertical === 'warehousing' &&
        ['pos', 'cashDrawer', 'storefront', 'kds', 'displays', 'signage', 'deliveryReps'].includes(requiredFeature)
      ) {
        return false;
      }
      if (
        profile.subVertical === 'services' &&
        ['pos', 'cashDrawer', 'inventory', 'storefront', 'kds', 'displays', 'signage', 'deliveryReps'].includes(
          requiredFeature,
        )
      ) {
        return false;
      }
      if (
        profile.subVertical === 'wholesale_van' &&
        ['pos', 'cashDrawer', 'kds', 'displays', 'signage'].includes(requiredFeature)
      ) {
        return false;
      }
      if (profile.defaultFeatures.includes(requiredFeature)) {
        return true;
      }
      if (['contracting', 'maritime_freight'].includes(requiredFeature)) {
        return false;
      }
    }

    if (!planId) {
      return true; // If no plan is assigned, assume backward compatibility
    }

    // Explicit tier checks for commerce pillar
    if (isOmnichannelPlanId(planId)) return true;
    if (planId === 'plan_ultimate' && requiredFeature === 'storefront') return false;

    const planFeatures = this.planFeatures.get(planId);
    if (!planFeatures) {
      if (planId === 'plan_ultimate') return true;
      const fallback = getFallbackPlanFeatures(planId);
      return fallback.includes(requiredFeature);
    }

    return planFeatures.has(requiredFeature);
  }
}
