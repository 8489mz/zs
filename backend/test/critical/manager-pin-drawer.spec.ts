/*
 * R-I8 (INV-REST-MANAGER-PIN-HASHED), drawer half: the cash drawer kept
 * its OWN plaintext copy of the manager-PIN check (getManagerPin +
 * assertManagerPin in cash-drawer.service.ts, `normalizedPin === expected`)
 * and never called the shared authorizeManagerSecret. Once the PIN is
 * stored as a bcrypt hash, that copy would fail every cashier cash-out /
 * safe-drop relying on the shared PIN — only an admin login password
 * would still work — breaking R1-E's safe transfers on the daily POS
 * path. The merge migrates the drawer to the shared check, keeping the
 * drawer's own observable errors (MANAGER_PIN_INVALID + the drawer
 * messages), so callers see no change.
 *
 * HOW THIS IS DRIVEN: the real CashDrawerService (constructed with stub
 * tx/posting deps — assertManagerPin only touches this.db and the shared
 * check) over PGlite, one fresh database per case. The private
 * assertManagerPin is reached via bracket access; it is the exact method
 * recordCashMovement -> assertCashDrawerApproval calls for cash_out /
 * safe_drop by a non-admin/manager role.
 *
 * RED PROOF: on the unfixed tree case (a) fails — the drawer's plaintext
 * compare can never match a bcrypt hash, so the right PIN is rejected.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { compare } from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { hashManagerPin } from '../../src/common/utils/manager-approval';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 't1:main';

// A cashier: the live role that needs the shared PIN for cash_out / safe_drop.
const cashier = {
  userId: 7,
  sessionId: 's1',
  username: 'cashier1',
  role: 'cashier',
  permissions: [],
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

async function seedPin(db: Kysely<Database>, storedValue: string): Promise<void> {
  await (db as any).insertInto('settings').values({
    key: 'managerPin', value: JSON.stringify(storedValue), tenant_id: TENANT, account_id: ACCOUNT,
  }).execute();
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

function buildService(db: Kysely<Database>): CashDrawerService {
  return new CashDrawerService(db as any, {} as any, {} as any);
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
  // (a) A hashed stored PIN authorizes a cashier; a wrong PIN fails closed
  // with the drawer's own error code (not the shared check's code).
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      await seedPin(db, await hashManagerPin('1234'));
      const service = buildService(db);
      await (service as any).assertManagerPin('1234', cashier);
      await expectCode((service as any).assertManagerPin('9999', cashier), 'MANAGER_PIN_INVALID');
    } finally {
      await db.destroy();
    }
    console.log('  drawer accepts a hashed PIN, rejects a wrong one passed');
  }

  // (b) A legacy plaintext stored PIN authorizes once and is then hashed
  // in place — the drawer path migrates it, exactly like the shared check.
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      await seedPin(db, '1234');
      const service = buildService(db);
      await (service as any).assertManagerPin('1234', cashier);
      const afterFirst = JSON.parse((await readPinRow(db)) as string) as string;
      assert.notEqual(afterFirst, '1234', 'the legacy value must be hashed in place after the first success');
      assert.ok(afterFirst.startsWith('$2b$'), 'the migrated value must be a bcrypt hash');
      assert.equal(await compare('1234', afterFirst), true, 'the migrated hash must verify against the PIN');
      await (service as any).assertManagerPin('1234', cashier);
    } finally {
      await db.destroy();
    }
    console.log('  drawer migrates a legacy plaintext PIN in place passed');
  }

  // (c) An empty PIN fails closed with the drawer's own empty message code.
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      await seedPin(db, await hashManagerPin('1234'));
      const service = buildService(db);
      await expectCode((service as any).assertManagerPin('', cashier), 'MANAGER_PIN_INVALID');
    } finally {
      await db.destroy();
    }
    console.log('  drawer empty PIN fails closed passed');
  }

  // (d) With no PIN stored, an admin login password still authorizes
  // through the drawer wrapper (the shared check's account fallback).
  {
    const { pg, db } = await makeDb();
    try {
      await seedTenant(db);
      const record = await createPasswordRecord('adminpass');
      await (db as any).insertInto('users').values({
        username: 'manager', role: 'admin', password_hash: record.hash,
        password_salt: record.salt, is_active: true, tenant_id: TENANT,
      }).execute();
      const service = buildService(db);
      await (service as any).assertManagerPin('adminpass', cashier);
      await expectCode((service as any).assertManagerPin('wrongpass', cashier), 'MANAGER_PIN_INVALID');
    } finally {
      await db.destroy();
    }
    console.log('  drawer admin-password fallback passed');
  }

  console.log('manager-pin-drawer.spec: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
