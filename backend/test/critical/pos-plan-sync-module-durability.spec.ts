/*
 * Package B (weighted-barcode / scale install for tenant admin):
 * the plan sync must not silently revert a tenant admin's hand
 * toggles of weightedBarcodeEnabled / clothingModuleEnabled.
 *
 * ROOT CAUSE (verified at base f3db3a35c): in
 * SaasAdminService.syncTenantModuleSettingsForPlan the sales branch
 * wrote modulesToSet['weightedBarcodeEnabled'] = (verticalKey ===
 * 'supermarket') — false for every retail tenant that is not a
 * supermarket — and the vertical-isolation block forced
 * modulesToSet['clothingModuleEnabled'] = false for every vertical
 * except clothing/fashion, overwriting even the plan-feature grant
 * from FEATURE_TO_MODULE_MAP. Both writes landed in the same
 * modulesToSet the hand toggle had just written, so the next plan
 * sync reverted the Apps Store install.
 *
 * THE FIX: weightedBarcode is granted true ONLY for the supermarket
 * vertical and otherwise omitted from modulesToSet entirely, so a
 * hand toggle survives; clothing is granted true when the effective
 * plan features include 'clothing' AND the vertical is retail,
 * forced false ONLY for non-retail verticals, and otherwise omitted.
 * The previouslyGranted marker / toRevoke path is untouched: it
 * still takes back exactly what a previous sync granted itself.
 *
 * WHAT IS DRIVEN: the REAL SaasAdminService
 * .syncTenantModuleSettingsForPlan on PGlite, with a REAL
 * SettingsService as its settingsService dependency (the sync ends
 * by invalidating the settings + plan-features caches). The other
 * constructor dependencies are stubs — the sync touches none of
 * them (it reads users / plan_features / tenants / settings only).
 *
 * Tables mirrored from the migration set: settings (key/value/
 * tenant_id/account_id, PK (tenant_id, key) per
 * 20260527000500_tenant_scope_settings_users_constraints), tenants
 * (20260527000100_saas_trial_foundation + plan_id per
 * 2031000000000_plans_and_features), users (tenant_id/account_id
 * per 20260527000100), plan_features (2031000000000). No
 * plan_features rows are seeded: with none, the sync falls back to
 * its FALLBACK_PLAN_FEATURES table (plan_basic / plan_pro /
 * plan_ultimate), which is the path under test.
 *
 * "Hand toggle" means: the settings rows are seeded directly and
 * the __planManagedModules marker row is ABSENT, so the sync has
 * no provenance claim on them. Revocation is proven separately
 * (cases D + E), where the marker DOES list the key because a
 * previous sync granted it.
 *
 * Run: npx ts-node test/critical/pos-plan-sync-module-durability.spec.ts
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SaasAdminService } from '../../src/modules/saas-admin/saas-admin.service';
import { PLAN_MANAGED_MODULES_SETTING_KEY } from '../../src/common/constants/platform-settings-keys';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, slug text, business_name text, owner_name text, owner_phone text, owner_email text, status text, plan_id text, extra_features text, activity_type text, country_code text, trial_starts_at timestamptz, trial_ends_at timestamptz, activated_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
      CREATE TABLE users (id bigserial PRIMARY KEY, tenant_id text, account_id text, username text, role text, is_active boolean DEFAULT true, password_hash text, password_salt text);
      CREATE TABLE plan_features (plan_id text NOT NULL, feature_code text NOT NULL, PRIMARY KEY (plan_id, feature_code));
    `);

    const settingsService = new SettingsService(db, { log: async () => undefined } as never, {} as never);
    const service = new SaasAdminService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settingsService,
      {} as never,
    );

    async function seedTenant(id: string, activityType: string, planId: string): Promise<void> {
      await anyDb
        .insertInto('tenants')
        .values({
          id,
          slug: id,
          business_name: 'Test Shop',
          owner_name: 'Owner',
          owner_phone: '01000000000',
          status: 'active',
          activity_type: activityType,
          plan_id: planId,
          created_at: new Date('2026-01-01T00:00:00Z'),
        })
        .execute();
      await anyDb
        .insertInto('users')
        .values({ tenant_id: id, account_id: 'a1', username: 'admin', role: 'admin' })
        .execute();
    }

    async function seedHandToggle(tenantId: string, key: string): Promise<void> {
      await anyDb
        .insertInto('settings')
        .values({ key, value: 'true', tenant_id: tenantId, account_id: 'a1' })
        .execute();
    }

    async function readSetting(tenantId: string, key: string): Promise<string | undefined> {
      const row = await anyDb
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', tenantId)
        .where('key', '=', key)
        .executeTakeFirst();
      return row?.value as string | undefined;
    }

    async function readMarker(tenantId: string): Promise<string[]> {
      const raw = await readSetting(tenantId, PLAN_MANAGED_MODULES_SETTING_KEY);
      if (!raw) return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as string[]) : [];
      } catch {
        return [];
      }
    }

    // A. Retail non-supermarket tenant on Ultimate (clothing is a plan
    // feature): hand toggles of BOTH keys survive the sync.
    await seedTenant('tu', 'retail_general', 'plan_ultimate');
    await seedHandToggle('tu', 'weightedBarcodeEnabled');
    await seedHandToggle('tu', 'clothingModuleEnabled');
    assert.deepEqual(await readMarker('tu'), [], 'no sync marker exists before the first sync');
    await service.syncTenantModuleSettingsForPlan('tu', 'plan_ultimate');
    assert.equal(
      await readSetting('tu', 'weightedBarcodeEnabled'),
      'true',
      'hand-toggled weightedBarcodeEnabled must survive the Ultimate sync on a retail tenant',
    );
    assert.equal(
      await readSetting('tu', 'clothingModuleEnabled'),
      'true',
      'hand-toggled clothingModuleEnabled must survive the Ultimate sync on a retail tenant',
    );
    assert.ok(
      (await readMarker('tu')).includes('clothingModuleEnabled'),
      'the Ultimate sync grants clothingModuleEnabled, so the marker must list it',
    );
    console.log('  A. retail + Ultimate: hand toggles survive: passed');

    // B. Retail non-supermarket tenant on Pro (clothing is NOT a plan
    // feature): hand toggles of BOTH keys survive the sync.
    await seedTenant('tp', 'retail_general', 'plan_pro');
    await seedHandToggle('tp', 'weightedBarcodeEnabled');
    await seedHandToggle('tp', 'clothingModuleEnabled');
    await service.syncTenantModuleSettingsForPlan('tp', 'plan_pro');
    assert.equal(
      await readSetting('tp', 'weightedBarcodeEnabled'),
      'true',
      'hand-toggled weightedBarcodeEnabled must survive the Pro sync on a retail tenant',
    );
    assert.equal(
      await readSetting('tp', 'clothingModuleEnabled'),
      'true',
      'hand-toggled clothingModuleEnabled must survive the Pro sync on a retail tenant',
    );
    console.log('  B. retail + Pro: hand toggles survive: passed');

    // C. A supermarket tenant still gets weightedBarcode=true from the sync.
    await seedTenant('ts', 'supermarket', 'plan_basic');
    await service.syncTenantModuleSettingsForPlan('ts', 'plan_basic');
    assert.equal(
      await readSetting('ts', 'weightedBarcodeEnabled'),
      'true',
      'the sync must grant weightedBarcodeEnabled to a supermarket tenant',
    );
    assert.ok(
      (await readMarker('ts')).includes('weightedBarcodeEnabled'),
      'the supermarket sync grants weightedBarcodeEnabled, so the marker must list it',
    );
    console.log('  C. supermarket still granted weightedBarcode=true: passed');

    // D. toRevoke still works: the same tenant stops being a
    // supermarket, and the previously-sync-granted weightedBarcode
    // key IS switched off (it was the sync's own grant, not a hand
    // toggle — the marker proves provenance).
    await anyDb.updateTable('tenants').set({ activity_type: 'retail_general' }).where('id', '=', 'ts').execute();
    await service.syncTenantModuleSettingsForPlan('ts', 'plan_basic');
    assert.equal(
      await readSetting('ts', 'weightedBarcodeEnabled'),
      'false',
      'a previously-sync-granted weightedBarcodeEnabled must be revoked once the tenant is no longer a supermarket',
    );
    assert.ok(
      !(await readMarker('ts')).includes('weightedBarcodeEnabled'),
      'the marker must drop weightedBarcodeEnabled after revocation',
    );
    console.log('  D. previously-sync-granted weightedBarcode revoked on vertical change: passed');

    // E. toRevoke still works on plan downgrade: the Ultimate tenant
    // from (A) drops to Pro, and the sync-granted clothing key IS
    // switched off — while the hand-toggled weightedBarcode key from
    // (A), which no sync ever granted, still survives.
    await service.syncTenantModuleSettingsForPlan('tu', 'plan_pro');
    assert.equal(
      await readSetting('tu', 'clothingModuleEnabled'),
      'false',
      'a previously-sync-granted clothingModuleEnabled must be revoked once the plan no longer grants clothing',
    );
    assert.equal(
      await readSetting('tu', 'weightedBarcodeEnabled'),
      'true',
      'the hand-toggled weightedBarcodeEnabled must still survive a later sync (no sync ever granted it)',
    );
    console.log('  E. previously-sync-granted clothing revoked on downgrade; hand toggle still survives: passed');

    console.log('pos-plan-sync-module-durability.spec: ok');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
