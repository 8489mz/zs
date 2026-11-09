/*
 * R-I8 (INV-REST-MANAGER-PIN-HASHED): the shared manager PIN used to be
 * stored in plaintext in settings and compared with `===` in
 * authorizeManagerSecret, while developerMasterPasswordHash in the same
 * file was bcrypt-hashed by design. The fix hashes the PIN on save
 * (settings.service.ts) and compares via bcrypt in authorizeManagerSecret
 * (manager-approval.ts) — never stored, logged or compared in plaintext.
 *
 * NO-LOCKOUT CONSTRAINT: a tenant's existing plaintext stored PIN must
 * keep working. A legacy plaintext value verifies once and is hashed in
 * place on that first success, so nobody is asked to re-enter a PIN they
 * may not remember; a wrong PIN still fails closed.
 *
 * HOW THIS IS DRIVEN: the real SettingsService.saveSettings and the real
 * authorizeManagerSecret over PGlite, one fresh database per case. The
 * spec imports only symbols that already existed at base (SettingsService,
 * authorizeManagerSecret, createPasswordRecord, bcryptjs compare), so the
 * base run below is a genuine behavioural red, not a vacuous import
 * failure.
 *
 * RED PROOF: on the unfixed tree case (a) fails — the stored value is the
 * plaintext '1234', not a bcrypt hash — and case (d) fails — the legacy
 * value still verifies but is never hashed in place.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { compare } from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { authorizeManagerSecret } from '../../src/common/utils/manager-approval';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 't1:main';

const actor = {
  userId: 1,
  sessionId: 's1',
  username: 'admin',
  role: 'super_admin',
  permissions: ['canManageSettings'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY, slug text, activity_type text, plan_id text, extra_features jsonb, business_name text, owner_phone text, owner_name text, owner_email text, country_code text, status text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE settings (key text, value text, tenant_id text, account_id text, PRIMARY KEY (tenant_id, key));
    CREATE TABLE users (id bigserial PRIMARY KEY, username text, role text, password_hash text, password_salt text, is_active boolean DEFAULT true, tenant_id text);
  `);
  return { pg, db };
}

async function seedTenant(db: Kysely<Database>): Promise<void> {
  await (db as any).insertInto('tenants').values({
    id: TENANT, slug: 'test-shop', activity_type: 'restaurant', plan_id: null,
    extra_features: '[]', business_name: 'متجر الاختبار', owner_phone: null,
    owner_name: null, owner_email: null, country_code: 'EG', status: 'active',
  }).execute();
}

function buildService(db: Kysely<Database>): SettingsService {
  const auditStub = { log: async () => undefined };
  const authCacheStub = { invalidateTenant: () => undefined };
  return new SettingsService(db as any, auditStub as any, authCacheStub as any);
}

async function readPinRow(db: Kysely<Database>): Promise<string | null> {
  const row = await (db as any)
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('tenant_id', '=', TENANT)
    .where('key', '=', 'managerPin')
    .executeTakeFirst();
  return row ? String(row.value) : null;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.equal((error as any)?.code, code, `expected error code ${code}, got ${(error as any)?.code}`);
    return;
  }
  assert.fail(`expected an error with code ${code}, but the call succeeded`);
}

async function main(): Promise<void> {
  // (a) Save stores a bcrypt hash, not the PIN.
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      const service = buildService(db);
      const returned = await service.saveSettings({ managerPin: '1234' }, actor);
      const rawStored = await readPinRow(db);
      assert.ok(rawStored, 'the PIN row must exist after save');
      const stored = JSON.parse(rawStored as string) as string;
      assert.notEqual(stored, '1234', 'the stored value must not be the PIN in plaintext');
      assert.ok(stored.startsWith('$2b$'), `the stored value must be a bcrypt hash, got ${stored.slice(0, 12)}`);
      assert.equal(await compare('1234', stored), true, 'the stored hash must verify against the PIN');
      assert.equal(await compare('9999', stored), false, 'the stored hash must not verify against a wrong PIN');
      assert.equal(returned.managerPin, stored, 'getSettings returns the stored hash, never the PIN');
    } finally {
      await db.destroy();
    }
    console.log('  save stores a bcrypt hash passed');
  }

  // (b) A settings round-trip does not double-hash the stored value.
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      const service = buildService(db);
      await service.saveSettings({ managerPin: '1234' }, actor);
      const firstStored = JSON.parse((await readPinRow(db)) as string) as string;
      await service.saveSettings({ managerPin: firstStored }, actor);
      const secondStored = JSON.parse((await readPinRow(db)) as string) as string;
      assert.equal(secondStored, firstStored, 'saving the hash back must leave it unchanged, not hash the hash');
      assert.equal(await compare('1234', secondStored), true, 'the PIN must still verify after the round-trip');
    } finally {
      await db.destroy();
    }
    console.log('  round-trip does not double-hash passed');
  }

  // (c) Verify accepts the right PIN and rejects a wrong one (hashed store).
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      const service = buildService(db);
      await service.saveSettings({ managerPin: '1234' }, actor);
      const ok = await authorizeManagerSecret(db, actor, '1234');
      assert.equal(ok.mode, 'pin', 'the right PIN authorizes in pin mode');
      await expectCode(authorizeManagerSecret(db, actor, '9999'), 'MANAGER_AUTH_INVALID');
    } finally {
      await db.destroy();
    }
    console.log('  verify accepts right PIN, rejects wrong PIN passed');
  }

  // (d) A legacy plaintext stored value verifies once and is then hashed.
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      await (db as any).insertInto('settings').values({
        key: 'managerPin', value: JSON.stringify('1234'), tenant_id: TENANT, account_id: ACCOUNT,
      }).execute();
      const ok = await authorizeManagerSecret(db, actor, '1234');
      assert.equal(ok.mode, 'pin', 'the legacy plaintext PIN must still authorize');
      const afterFirst = JSON.parse((await readPinRow(db)) as string) as string;
      assert.notEqual(afterFirst, '1234', 'the legacy value must be hashed in place after the first success');
      assert.ok(afterFirst.startsWith('$2b$'), 'the migrated value must be a bcrypt hash');
      assert.equal(await compare('1234', afterFirst), true, 'the migrated hash must verify against the PIN');
      const again = await authorizeManagerSecret(db, actor, '1234');
      assert.equal(again.mode, 'pin', 'the PIN must still authorize after migration, via bcrypt');
      await expectCode(authorizeManagerSecret(db, actor, '9999'), 'MANAGER_AUTH_INVALID');
    } finally {
      await db.destroy();
    }
    console.log('  legacy plaintext verifies once, then hashed passed');
  }

  // (e) Empty secret fails closed; no PIN at all rejects any secret.
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      await expectCode(authorizeManagerSecret(db, actor, ''), 'MANAGER_AUTH_REQUIRED');
      await expectCode(authorizeManagerSecret(db, actor, '   '), 'MANAGER_AUTH_REQUIRED');
      await expectCode(authorizeManagerSecret(db, actor, '1234'), 'MANAGER_AUTH_INVALID');
    } finally {
      await db.destroy();
    }
    console.log('  empty secret fails closed passed');
  }

  // (f) The admin-account fallback still works (the otherwise-sound logic).
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      const record = await createPasswordRecord('adminpass');
      await (db as any).insertInto('users').values({
        username: 'manager', role: 'admin', password_hash: record.hash,
        password_salt: record.salt, is_active: true, tenant_id: TENANT,
      }).execute();
      const ok = await authorizeManagerSecret(db, actor, 'adminpass');
      assert.equal(ok.mode, 'account', 'an admin login password authorizes in account mode');
      assert.equal(ok.authorizedByName, 'manager', 'the account mode names the admin user');
      await expectCode(authorizeManagerSecret(db, actor, 'wrongpass'), 'MANAGER_AUTH_INVALID');
    } finally {
      await db.destroy();
    }
    console.log('  admin-account fallback passed');
  }

  console.log('manager-pin-hashed.spec: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
