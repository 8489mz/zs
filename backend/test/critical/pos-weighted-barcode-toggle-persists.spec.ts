/*
 * INV-SAAS-ONLY-MODULE-CONTROL:
 * Only platform `super_admin` (or an active `sessions.impersonated_by` SaaS
 * session) may flip module toggles (`weightedBarcodeEnabled`,
 * `clothingModuleEnabled`, `posModuleEnabled`, `inventoryModuleEnabled`, etc.).
 * Regular tenant admins (`admin`) cannot modify module toggles via
 * SettingsService.saveSettings, while their operational settings (such as
 * `weightedBarcodePrefix`) still persist normally.
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
    impersonatedBy: null,
  } as unknown as AuthContext;
}

function impersonatedAdminAuth(tenantId: string): AuthContext {
  return {
    ...adminAuth(tenantId),
    impersonatedBy: 1,
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

    // 1. Regular tenant admin cannot alter any module toggle, while operational format fields still save.
    const returned = await service.saveSettings(
      {
        weightedBarcodeEnabled: true,
        clothingModuleEnabled: true,
        posModuleEnabled: true,
        inventoryModuleEnabled: true,
        weightedBarcodePrefix: '23',
      },
      adminAuth('t1'),
    );
    assert.equal(
      returned.weightedBarcodePrefix,
      '23',
      'operational barcode format field must still persist for tenant admin',
    );
    assert.equal(await rawSetting('t1', 'weightedBarcodePrefix'), '"23"');
    assert.equal(
      await rawSetting('t1', 'weightedBarcodeEnabled'),
      undefined,
      'weightedBarcodeEnabled must be protected for tenant admin',
    );
    assert.equal(
      await rawSetting('t1', 'clothingModuleEnabled'),
      undefined,
      'clothingModuleEnabled must be protected for tenant admin',
    );
    assert.equal(await rawSetting('t1', 'posModuleEnabled'), undefined, 'posModuleEnabled must remain protected');
    assert.equal(
      await rawSetting('t1', 'inventoryModuleEnabled'),
      undefined,
      'inventoryModuleEnabled must remain protected',
    );
    console.log('  tenant-admin module switches blocked while operational settings persist: passed');

    // 2. Platform impersonator (sessions.impersonated_by) can enable & disable modules cleanly.
    const returnedImpOn = await service.saveSettings(
      { weightedBarcodeEnabled: true, clothingModuleEnabled: true },
      impersonatedAdminAuth('t1'),
    );
    assert.equal(returnedImpOn.weightedBarcodeEnabled, true);
    assert.equal(await rawSetting('t1', 'weightedBarcodeEnabled'), 'true');
    const returnedImpOff = await service.saveSettings({ weightedBarcodeEnabled: false }, impersonatedAdminAuth('t1'));
    assert.equal(returnedImpOff.weightedBarcodeEnabled, false);
    assert.equal(await rawSetting('t1', 'weightedBarcodeEnabled'), 'false');
    console.log('  platform impersonation toggles persist (true & false): passed');

    // 3. Direct super_admin toggle works cleanly.
    const returnedSuper = await service.saveSettings(
      { weightedBarcodeEnabled: true, clothingModuleEnabled: true },
      superAdminAuth('t2'),
    );
    assert.equal(returnedSuper.weightedBarcodeEnabled, true);
    assert.equal(returnedSuper.clothingModuleEnabled, true);
    assert.equal(await rawSetting('t2', 'weightedBarcodeEnabled'), 'true');
    assert.equal(await rawSetting('t2', 'clothingModuleEnabled'), 'true');
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
