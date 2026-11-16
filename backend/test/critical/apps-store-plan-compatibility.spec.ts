/*
 * Proves cross-plan and Apps Store self-install compatibility across:
 * 1) Real SettingsService.saveSettings + getSettings on PGlite (tenant admin self-install of
 *    entitled modules: deliveryRepsModuleEnabled on all retail plans including plan_basic per P8b,
 *    vanSalesModuleEnabled, servicesModuleEnabled, comboModuleEnabled, crmModuleEnabled,
 *    installmentsModuleEnabled on plan_ultimate & tier_band1_L2;
 *    blocking unentitled tiers like plan_basic for vanSales/crm/installments; blocking incompatible
 *    verticals like warehousing, services, contracting, maritime; keeping uninstalls &
 *    posModuleEnabled super_admin-only).
 * 2) Services & wholesale_van profiles never silently auto-enabling posModuleEnabled.
 * 3) PlanFeatureService supporting tier_band1..5_L1..L3 and commerce profiles consistently.
 * 4) PricingCatalogService.levelIdForLegacyPlanCode resolving BAND1_L1..BAND5_L3 and tier_band*.
 * 5) User plan limits resolving L1/L2/L3 tiered band plans accurately.
 * 6) TradeInController gated by real 'maintenance' feature code instead of orphan 'tradein'.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { REQUIRED_FEATURE_KEY } from '../../src/core/auth/decorators/feature.decorator';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import {
  getFallbackPlanFeatures,
  isEnterpriseOrUltimatePlan,
  isOmnichannelPlanId,
  resolveCatalogLevelId,
  resolvePlanDisplayName,
  resolvePlanRank,
} from '../../src/core/tenant/plan-tier.util';
import type { Database } from '../../src/database/database.types';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { resolveMaxBranchesForTenant } from '../../src/modules/settings/settings-module-entitlement.engine';
import { PricingCatalogService } from '../../src/modules/tenant-subscription/pricing/pricing-catalog.service';
import { TradeInController } from '../../src/modules/tradein/tradein.controller';
import { resolveUserLimit } from '../../src/modules/users/engines/user-plan-limit.engine';

const ACCOUNT = 'acc-compat';

function adminAuth(tenantId: string): AuthContext {
  return {
    userId: 10,
    sessionId: `sess-${tenantId}`,
    username: 'admin',
    role: 'admin',
    permissions: ['canManageSettings'],
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

async function rawSetting(db: any, tenantId: string, key: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('tenant_id', '=', tenantId)
    .where('key', '=', key)
    .executeTakeFirst();
  return row?.value as string | undefined;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;

  try {
    await pg.exec(`
      CREATE TABLE tenants (
        id text PRIMARY KEY,
        slug text,
        business_name text,
        owner_name text,
        owner_phone text,
        owner_email text,
        status text,
        plan_id text,
        extra_features text,
        activity_type text,
        country_code text,
        trial_starts_at timestamptz,
        trial_ends_at timestamptz,
        activated_at timestamptz,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE settings (
        key text NOT NULL,
        value text,
        tenant_id text NOT NULL,
        account_id text NOT NULL,
        PRIMARY KEY (tenant_id, key)
      );
      CREATE TABLE users (
        id bigserial PRIMARY KEY,
        tenant_id text,
        account_id text,
        username text,
        role text,
        is_active boolean DEFAULT true,
        password_hash text,
        password_salt text
      );
      CREATE TABLE plan_features (
        plan_id text NOT NULL,
        feature_code text NOT NULL,
        PRIMARY KEY (plan_id, feature_code)
      );
      CREATE TABLE saas_plans (
        id bigserial PRIMARY KEY,
        code text,
        name text,
        max_users int,
        max_branches int,
        feature_plan_id text
      );
      CREATE TABLE branches (
        id bigserial PRIMARY KEY,
        tenant_id text NOT NULL,
        account_id text NOT NULL,
        name text NOT NULL
      );
    `);

    const tenants = [
      { id: 't-ult-retail', activity: 'retail_general', plan: 'plan_ultimate' },
      { id: 't-basic-retail', activity: 'retail_general', plan: 'plan_basic' },
      { id: 't-band1-l2', activity: 'retail_general', plan: 'tier_band1_L2' },
      { id: 't-wh-ult', activity: 'warehousing', plan: 'plan_ultimate' },
      { id: 't-services-ult', activity: 'services', plan: 'plan_ultimate' },
      { id: 't-van-ult', activity: 'wholesale_van', plan: 'plan_ultimate' },
    ];

    for (const t of tenants) {
      await anyDb
        .insertInto('tenants')
        .values({
          id: t.id,
          slug: t.id,
          business_name: t.id,
          owner_name: 'Owner',
          owner_phone: '01000000000',
          status: 'active',
          activity_type: t.activity,
          plan_id: t.plan,
          created_at: new Date('2026-01-01T00:00:00Z'),
        })
        .execute();
    }

    await anyDb
      .insertInto('plan_features')
      .values([
        { plan_id: 'plan_ultimate', feature_code: 'sales' },
        { plan_id: 'plan_ultimate', feature_code: 'catalog' },
        { plan_id: 'plan_ultimate', feature_code: 'deliveryReps' },
        { plan_id: 'plan_ultimate', feature_code: 'installments' },
        { plan_id: 'plan_ultimate', feature_code: 'inventory' },
        { plan_id: 'plan_ultimate', feature_code: 'purchases' },
        { plan_id: 'tier_band1_L2', feature_code: 'sales' },
        { plan_id: 'tier_band1_L2', feature_code: 'deliveryReps' },
        { plan_id: 'tier_band1_L2', feature_code: 'installments' },
      ])
      .execute();

    const settingsService = new SettingsService(db, { log: async () => undefined } as never, {} as never);

    // 1) Ultimate retail tenant admin installs deliveryReps, vanSales, services, combo, crm
    const ultSaved = await settingsService.saveSettings(
      {
        deliveryRepsModuleEnabled: true,
        vanSalesModuleEnabled: true,
        servicesModuleEnabled: true,
        comboModuleEnabled: true,
        crmModuleEnabled: true,
        posModuleEnabled: true,
      },
      adminAuth('t-ult-retail'),
    );
    assert.equal(ultSaved.deliveryRepsModuleEnabled, true, 'Ultimate retail admin must self-install deliveryRepsModuleEnabled');
    assert.equal(ultSaved.vanSalesModuleEnabled, true, 'Ultimate retail admin must self-install vanSalesModuleEnabled');
    assert.equal(ultSaved.servicesModuleEnabled, true, 'Ultimate retail admin must self-install servicesModuleEnabled');
    assert.equal(ultSaved.comboModuleEnabled, true, 'Ultimate retail admin must self-install comboModuleEnabled');
    assert.equal(ultSaved.crmModuleEnabled, true, 'Ultimate retail admin must self-install crmModuleEnabled');
    assert.equal(await rawSetting(anyDb, 't-ult-retail', 'deliveryRepsModuleEnabled'), 'true');
    assert.equal(await rawSetting(anyDb, 't-ult-retail', 'posModuleEnabled'), undefined, 'posModuleEnabled stays super_admin-only');

    // 2) Uninstall (false) stays super_admin-only for tenant admin
    await settingsService.saveSettings({ deliveryRepsModuleEnabled: false }, adminAuth('t-ult-retail'));
    assert.equal(await rawSetting(anyDb, 't-ult-retail', 'deliveryRepsModuleEnabled'), 'true', 'tenant admin cannot self-uninstall active module');

    // 3) Basic retail admin CAN self-install deliveryReps (retail core on all plans per P8b),
    //    while Van Sales / CRM / Installments stay blocked on plan_basic
    await settingsService.saveSettings(
      {
        deliveryRepsModuleEnabled: true,
        vanSalesModuleEnabled: true,
        crmModuleEnabled: true,
        installmentsModuleEnabled: true,
      },
      adminAuth('t-basic-retail'),
    );
    assert.equal(await rawSetting(anyDb, 't-basic-retail', 'deliveryRepsModuleEnabled'), 'true', 'plan_basic retail can self-install deliveryReps (P8b)');
    assert.equal(await rawSetting(anyDb, 't-basic-retail', 'vanSalesModuleEnabled'), undefined, 'plan_basic cannot self-install vanSales');
    assert.equal(await rawSetting(anyDb, 't-basic-retail', 'crmModuleEnabled'), undefined, 'plan_basic cannot self-install crm');
    assert.equal(await rawSetting(anyDb, 't-basic-retail', 'installmentsModuleEnabled'), undefined, 'plan_basic cannot self-install installments');

    // 4) Tiered band L2 tenant admin can self-install Level-2 granted modules (deliveryReps & installments)
    const l2Saved = await settingsService.saveSettings(
      { deliveryRepsModuleEnabled: true, installmentsModuleEnabled: true, fixedAssetsModuleEnabled: true },
      adminAuth('t-band1-l2'),
    );
    assert.equal(l2Saved.deliveryRepsModuleEnabled, true, 'tier_band1_L2 admin must self-install deliveryRepsModuleEnabled');
    assert.equal(l2Saved.installmentsModuleEnabled, true, 'tier_band1_L2 admin must self-install installmentsModuleEnabled');
    assert.equal(await rawSetting(anyDb, 't-band1-l2', 'fixedAssetsModuleEnabled'), undefined, 'tier_band1_L2 cannot self-install Level-3 fixedAssets');

    // 5) Incompatible vertical guards: warehousing cannot self-install vanSales/deliveryReps; services & wholesale_van never flip POS on
    await settingsService.saveSettings({ vanSalesModuleEnabled: true, deliveryRepsModuleEnabled: true }, adminAuth('t-wh-ult'));
    assert.equal(await rawSetting(anyDb, 't-wh-ult', 'vanSalesModuleEnabled'), undefined, 'warehousing must block vanSales self-install');
    assert.equal(await rawSetting(anyDb, 't-wh-ult', 'deliveryRepsModuleEnabled'), undefined, 'warehousing must block deliveryReps self-install');

    const svcSettings = await settingsService.getSettings(adminAuth('t-services-ult'));
    assert.equal(svcSettings.posModuleEnabled, false, 'services profile must not auto-enable POS from legacy sales flag');
    assert.equal(svcSettings.servicesModuleEnabled, true, 'services profile keeps servicesModuleEnabled enabled');

    const vanSettings = await settingsService.getSettings(adminAuth('t-van-ult'));
    assert.equal(vanSettings.posModuleEnabled, false, 'wholesale_van profile must not auto-enable POS from legacy sales flag');
    assert.equal(vanSettings.vanSalesModuleEnabled, true, 'wholesale_van profile keeps vanSalesModuleEnabled enabled');

    // 6) PlanFeatureService supports tiered band plans & omnichannel
    const featureService = new PlanFeatureService(db);
    await featureService.refreshCache();
    assert.equal(featureService.hasFeature('tier_band1_L2', [], 'deliveryReps', undefined, 'retail_general'), true);
    assert.equal(featureService.hasFeature('tier_band1_L2', [], 'hr', undefined, 'retail_general'), false);
    assert.equal(featureService.hasFeature('tier_band1_L3', [], 'hr', undefined, 'retail_general'), true);
    assert.equal(featureService.hasFeature('tier_band1_L3', [], 'vat_declaration', undefined, 'retail_general'), true);
    assert.equal(featureService.hasFeature('plan_omnichannel', [], 'storefront', undefined, 'retail_general'), true);
    assert.equal(featureService.hasFeature('plan_ultimate', [], 'contracting', undefined, 'services'), false);

    // 7) PricingCatalogService & plan-tier helpers normalize BAND*_L* and tier_band*_L*
    const pricingCatalog = new PricingCatalogService();
    assert.equal(pricingCatalog.levelIdForLegacyPlanCode('BAND1_L1'), 'L1');
    assert.equal(pricingCatalog.levelIdForLegacyPlanCode('tier_band3_L2'), 'L2');
    assert.equal(pricingCatalog.levelIdForLegacyPlanCode('BAND5_L3'), 'L3');
    assert.equal(pricingCatalog.levelIdForLegacyPlanCode('OMNICHANNEL'), 'L3');
    assert.equal(resolveCatalogLevelId('basic'), 'L1');
    assert.equal(resolvePlanRank('tier_band2_L2'), 2);
    assert.equal(resolvePlanRank('BAND4_L3'), 3);
    assert.equal(isOmnichannelPlanId('plan_omnichannel'), true);
    assert.equal(isEnterpriseOrUltimatePlan('tier_band1_L3'), true);
    assert.equal(resolvePlanDisplayName('plan_basic'), 'الأساسية');
    assert.equal(resolvePlanDisplayName('tier_band1_L1'), 'تجزئة عامة — محل');
    assert.ok(getFallbackPlanFeatures('tier_band1_L3').includes('taxIntegration'));

    // 8) Branch & user limit compatibility on tiered L1/L2/L3 plans
    const maxBranchesL2 = await resolveMaxBranchesForTenant(
      db,
      't-band1-l2',
      { plan_id: 'tier_band1_L2', status: 'active' },
      ['sales', 'inventory'],
    );
    assert.equal(maxBranchesL2, 3, 'tier_band1_L2 fallback branch cap should be 3');
    assert.equal(
      resolveUserLimit({ hasActiveSubscription: false, tenantPlanId: 'tier_band2_L2', isTrial: false }),
      6,
    );
    assert.equal(
      resolveUserLimit({ hasActiveSubscription: false, tenantPlanId: 'tier_band3_L3', isTrial: false }),
      25,
    );
    assert.equal(
      resolveUserLimit({ hasActiveSubscription: false, tenantPlanId: 'plan_ultimate', isTrial: false }),
      null,
    );

    // 9) TradeInController feature decorator matches real seeded feature code 'maintenance'
    assert.equal(Reflect.getMetadata(REQUIRED_FEATURE_KEY, TradeInController), 'maintenance');

    console.log('apps-store-plan-compatibility: OK');
  } finally {
    await pg.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
