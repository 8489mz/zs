/*
 * Package B (weighted-barcode / scale install for tenant admin):
 * a tenant admin toggling the Apps Store weighted-barcode or clothing
 * switches must have the toggle persist.
 *
 * ROOT CAUSE (verified at base f3db3a35c): SettingsService.saveSettings
 * deletes every key in `protectedModuleKeys` from the payload for any
 * non-super_admin actor — and that list contained
 * 'weightedBarcodeEnabled' and 'clothingModuleEnabled'. The Apps Store
 * toggle therefore never reached the settings table, while the UI
 * reported "لم يؤكد النظام التثبيت". The fix removes exactly those
 * two keys from the list; every other key stays protected, and the
 * frontend plan gate (requiredPlan plan_basic) is unchanged.
 *
 * WHAT IS DRIVEN: the REAL SettingsService.saveSettings (the path the
 * PUT /api/settings controller calls as updateSettings) on PGlite,
 * with a tenant-admin actor (role 'admin') and a super_admin actor.
 *
 * Tables mirrored from the migration set: settings (key/value/
 * tenant_id/account_id, PK (tenant_id, key) per
 * 20260527000500_tenant_scope_settings_users_constraints), tenants
 * (20260527000100_saas_trial_foundation + plan_id per
 * 2031000000000_plans_and_features), users (tenant_id/account_id per
 * 20260527000100), plan_features (2031000000000). No plan_features
 * rows are seeded: getSettings reads none, so plan features are [].
 *
 * NOTE: assertions about "still protected" read the RAW settings row,
 * not the object saveSettings returns — getSettings self-heals
 * posModuleEnabled=true for any retail profile whose defaults include
 * 'sales', so the returned object would mask a leaked write.
 *
 * Run: npx ts-node test/critical/pos-weighted-barcode-toggle-persists.spec.ts
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SettingsService } from '../../src/modules/settings/settings.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const ACCOUNT = 'a1';

function adminAuth(tenantId: string): AuthContext {
  return {
    userId: 2,
    sessionId: 'sess-spec',
    username: 'admin',
    role: 'admin',
    permissions: ['canManageSettings'],
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

function superAdminAuth(tenantId: string): AuthContext {
  return {
    userId: 1,
    sessionId: 'sess-spec',
    username: 'root',
    role: 'super_admin',
    permissions: [],
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

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
    for (const tenantId of ['t1', 't2']) {
      await anyDb
        .insertInto('tenants')
        .values({
          id: tenantId,
          slug: tenantId,
          business_name: 'Test Shop',
          owner_name: 'Owner',
          owner_phone: '01000000000',
          status: 'active',
          activity_type: 'retail_general',
          plan_id: 'plan_basic',
          created_at: new Date('2026-01-01T00:00:00Z'),
        })
        .execute();
    }

    const service = new SettingsService(db, { log: async () => undefined } as never, {} as never);

    async function rawSetting(tenantId: string, key: string): Promise<string | undefined> {
      const row = await anyDb
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', tenantId)
        .where('key', '=', key)
        .executeTakeFirst();
      return row?.value as string | undefined;
    }

    // 1. A tenant admin toggling both switches persists them.
    const returned = await service.saveSettings(
      { weightedBarcodeEnabled: true, clothingModuleEnabled: true, posModuleEnabled: true, inventoryModuleEnabled: true },
      adminAuth('t1'),
    );
    assert.equal(returned.weightedBarcodeEnabled, true, 'tenant-admin toggle of weightedBarcodeEnabled must persist');
    assert.equal(returned.clothingModuleEnabled, true, 'tenant-admin toggle of clothingModuleEnabled must persist');
    assert.equal(await rawSetting('t1', 'weightedBarcodeEnabled'), 'true', 'weightedBarcodeEnabled row must be written true');
    assert.equal(await rawSetting('t1', 'clothingModuleEnabled'), 'true', 'clothingModuleEnabled row must be written true');
    // Every other protected key stays protected for a non-super-admin.
    assert.equal(await rawSetting('t1', 'posModuleEnabled'), undefined, 'posModuleEnabled must still be deleted for a non-super-admin');
    assert.equal(await rawSetting('t1', 'inventoryModuleEnabled'), undefined, 'inventoryModuleEnabled must still be deleted for a non-super-admin');
    console.log('  tenant-admin toggles of weightedBarcodeEnabled + clothingModuleEnabled persist; pos/inventory still protected: passed');

    // 2. A super_admin toggle still works.
    const returnedSuper = await service.saveSettings(
      { weightedBarcodeEnabled: true, clothingModuleEnabled: true },
      superAdminAuth('t2'),
    );
    assert.equal(returnedSuper.weightedBarcodeEnabled, true, 'super_admin toggle of weightedBarcodeEnabled must persist');
    assert.equal(returnedSuper.clothingModuleEnabled, true, 'super_admin toggle of clothingModuleEnabled must persist');
    assert.equal(await rawSetting('t2', 'weightedBarcodeEnabled'), 'true', 'super_admin weightedBarcodeEnabled row must be written true');
    assert.equal(await rawSetting('t2', 'clothingModuleEnabled'), 'true', 'super_admin clothingModuleEnabled row must be written true');
    console.log('  super_admin toggles still work: passed');

    console.log('pos-weighted-barcode-toggle-persists.spec: ok');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
