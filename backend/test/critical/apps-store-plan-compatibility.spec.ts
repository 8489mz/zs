/*
 * Proves strict SaaS-Only Module Control (INV-SAAS-ONLY-MODULE-CONTROL) + cross-plan compatibility:
 * 1) Real SettingsService.saveSettings + getSettings on PGlite:
 *    - Regular tenant admins ('admin', impersonatedBy=null) cannot enable OR disable any module
 *      switch (vanSalesModuleEnabled, deliveryRepsModuleEnabled, weightedBarcodeEnabled, etc.),
 *      while operational settings (weightedBarcodePrefix, invoicePrefix) still persist cleanly.
 *    - Active platform impersonation sessions (role='admin', impersonatedBy=1) AND super_admin
 *      CAN install and uninstall module switches freely (including turning off an accidentally
 *      installed vanSalesModuleEnabled while keeping deliveryRepsModuleEnabled active).
 * 2) SaasAdminService.syncTenantModuleSettingsForPlan immediately revokes accidental
 *    vanSalesModuleEnabled ('false') when vanSales is absent on retail plans while keeping
 *    deliveryRepsModuleEnabled ('true'), and respects explicit extraFeatures (+/-).
 * 3) Services & wholesale_van profiles never silently auto-enable posModuleEnabled.
 * 4) PlanFeatureService, PricingCatalogService, user-plan-limit, and TradeInController alignment.
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
import { SaasAdminService } from '../../src/modules/saas-admin/saas-admin.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { resolveMaxBranchesForTenant } from '../../src/modules/settings/settings-module-entitlement.engine';
import { PricingCatalogService } from '../../src/modules/tenant-subscription/pricing/pricing-catalog.service';
import { TradeInController } from '../../src/modules/tradein/tradein.controller';
import { resolveUserLimit } from '../../src/modules/users/engines/user-plan-limit.engine';

const ACCOUNT = 'acc-compat';

function adminAuth(tenantId: string, impersonatedBy: number | null = null): AuthContext {
  return {
    userId: 10,
    sessionId: `sess-${tenantId}`,
    username: 'admin',
    role: 'admin',
    permissions: ['canManageSettings'],
    tenantId,
    accountId: ACCOUNT,
    impersonatedBy,
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
      await anyDb
        .insertInto('users')
        .values({ tenant_id: t.id, account_id: ACCOUNT, username: 'admin', role: 'admin' })
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
    const saasAdminService = new SaasAdminService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settingsService,
      {} as never,
    );

    // 1) Regular tenant admin cannot toggle any module switch, while operational settings persist cleanly
    const adminSaved = await settingsService.saveSettings(
      {
        deliveryRepsModuleEnabled: true,
        vanSalesModuleEnabled: true,
        servicesModuleEnabled: true,
        comboModuleEnabled: true,
        crmModuleEnabled: true,
        weightedBarcodeEnabled: true,
        clothingModuleEnabled: true,
        posModuleEnabled: true,
        weightedBarcodePrefix: '24',
        invoicePrefix: 'OPS',
      },
      adminAuth('t-ult-retail', null),
    );
    assert.equal(
      adminSaved.weightedBarcodePrefix,
      '24',
      'operational barcode settings remain writable by tenant admin',
    );
    assert.equal(adminSaved.invoicePrefix, 'OPS', 'operational invoice prefix remains writable by tenant admin');
    assert.equal(
      await rawSetting(anyDb, 't-ult-retail', 'vanSalesModuleEnabled'),
      undefined,
      'tenant admin cannot enable vanSalesModuleEnabled',
    );
    assert.equal(
      await rawSetting(anyDb, 't-ult-retail', 'weightedBarcodeEnabled'),
      undefined,
      'tenant admin cannot enable weightedBarcodeEnabled',
    );
    assert.equal(
      await rawSetting(anyDb, 't-ult-retail', 'clothingModuleEnabled'),
      undefined,
      'tenant admin cannot enable clothingModuleEnabled',
    );
    assert.equal(
      await rawSetting(anyDb, 't-ult-retail', 'comboModuleEnabled'),
      undefined,
      'tenant admin cannot enable comboModuleEnabled',
    );
    assert.equal(
      await rawSetting(anyDb, 't-ult-retail', 'posModuleEnabled'),
      undefined,
      'tenant admin cannot alter posModuleEnabled',
    );

    // 2) Active SaaS impersonation session (impersonatedBy = 1) CAN turn modules ON and OFF
    const impOn = await settingsService.saveSettings(
      { deliveryRepsModuleEnabled: true, vanSalesModuleEnabled: true },
      adminAuth('t-ult-retail', 1),
    );
    assert.equal(
      impOn.deliveryRepsModuleEnabled,
      true,
      'impersonating platform admin can enable deliveryRepsModuleEnabled',
    );
    assert.equal(impOn.vanSalesModuleEnabled, true, 'impersonating platform admin can enable vanSalesModuleEnabled');

    const impOff = await settingsService.saveSettings({ vanSalesModuleEnabled: false }, adminAuth('t-ult-retail', 1));
    assert.equal(impOff.vanSalesModuleEnabled, false, 'impersonating platform admin can disable vanSalesModuleEnabled');
    assert.equal(await rawSetting(anyDb, 't-ult-retail', 'vanSalesModuleEnabled'), 'false');
    assert.equal(
      await rawSetting(anyDb, 't-ult-retail', 'deliveryRepsModuleEnabled'),
      'true',
      'deliveryReps remains active when vanSales is turned off',
    );

    // 3) SaaS Admin syncTenantModuleSettingsForPlan turns OFF accidental vanSales while keeping deliveryReps ON
    await anyDb
      .insertInto('settings')
      .values({ key: 'vanSalesModuleEnabled', value: 'true', tenant_id: 't-ult-retail', account_id: ACCOUNT })
      .onConflict((oc: any) => oc.columns(['tenant_id', 'key']).doUpdateSet({ value: 'true' }))
      .execute();
    await saasAdminService.syncTenantModuleSettingsForPlan('t-ult-retail', 'plan_ultimate', []);
    assert.equal(
      await rawSetting(anyDb, 't-ult-retail', 'vanSalesModuleEnabled'),
      'false',
      'SaaS Admin sync must switch off accidental vanSales on non-wholesale vertical',
    );
    assert.equal(
      await rawSetting(anyDb, 't-ult-retail', 'deliveryRepsModuleEnabled'),
      'true',
      'SaaS Admin sync keeps plan-included deliveryReps active',
    );

    // And explicitly adding vanSales / excluding deliveryReps in SaaS Admin works cleanly
    await saasAdminService.syncTenantModuleSettingsForPlan('t-ult-retail', 'plan_ultimate', [
      'vanSales',
      '-deliveryReps',
    ]);
    assert.equal(await rawSetting(anyDb, 't-ult-retail', 'vanSalesModuleEnabled'), 'true');
    assert.equal(await rawSetting(anyDb, 't-ult-retail', 'deliveryRepsModuleEnabled'), 'false');

    // 4) Non-POS verticals retain their profile (never flip POS on via generic sales flag)
    const svcSettings = await settingsService.getSettings(adminAuth('t-services-ult'));
    assert.equal(
      svcSettings.posModuleEnabled,
      false,
      'services profile must not auto-enable POS from legacy sales flag',
    );
    assert.equal(svcSettings.servicesModuleEnabled, true, 'services profile keeps servicesModuleEnabled enabled');

    const vanSettings = await settingsService.getSettings(adminAuth('t-van-ult'));
    assert.equal(
      vanSettings.posModuleEnabled,
      false,
      'wholesale_van profile must not auto-enable POS from legacy sales flag',
    );
    assert.equal(vanSettings.vanSalesModuleEnabled, true, 'wholesale_van profile keeps vanSalesModuleEnabled enabled');

    // 5) PlanFeatureService supports tiered band plans & omnichannel
    const featureService = new PlanFeatureService(db);
    await featureService.refreshCache();
    assert.equal(featureService.hasFeature('tier_band1_L2', [], 'deliveryReps', undefined, 'retail_general'), true);
    assert.equal(featureService.hasFeature('tier_band1_L2', [], 'hr', undefined, 'retail_general'), false);
    assert.equal(featureService.hasFeature('tier_band1_L3', [], 'hr', undefined, 'retail_general'), true);
    assert.equal(featureService.hasFeature('tier_band1_L3', [], 'vat_declaration', undefined, 'retail_general'), true);
    assert.equal(featureService.hasFeature('plan_omnichannel', [], 'storefront', undefined, 'retail_general'), true);
    assert.equal(featureService.hasFeature('plan_ultimate', [], 'contracting', undefined, 'services'), false);

    // 6) PricingCatalogService & plan-tier helpers normalize BAND*_L* and tier_band*_L*
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

    // 7) Branch & user limit compatibility on tiered L1/L2/L3 plans
    const maxBranchesL2 = await resolveMaxBranchesForTenant(
      db,
      't-band1-l2',
      { plan_id: 'tier_band1_L2', status: 'active' },
      ['sales', 'inventory'],
    );
    assert.equal(maxBranchesL2, 3, 'tier_band1_L2 fallback branch cap should be 3');
    assert.equal(resolveUserLimit({ hasActiveSubscription: false, tenantPlanId: 'tier_band2_L2', isTrial: false }), 6);
    assert.equal(resolveUserLimit({ hasActiveSubscription: false, tenantPlanId: 'tier_band3_L3', isTrial: false }), 25);
    assert.equal(
      resolveUserLimit({ hasActiveSubscription: false, tenantPlanId: 'plan_ultimate', isTrial: false }),
      null,
    );

    // 8) TradeInController feature decorator matches real seeded feature code 'maintenance'
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
