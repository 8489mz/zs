/*
 * S7 (INV-REST-MANAGER-COMP-PIN-GATE): the Manager Comp tile opens the
 * comp dialog for a non-manager cashier, and on the live build the
 * dialog's security PIN was optional with an enabled approve button —
 * a cashier could reach comp approval with no manager code at all
 * (live-proven 2026-11-12 on test10k: cashier_test opened the full
 * "ضيافة الإدارة" dialog, PIN "(اختياري)", approve "اعتماد الضيافة
 * (75.00)" enabled; the dialog was closed without approving, so no
 * comp was posted and the live trial never proved a comp could
 * actually land).
 *
 * Grounding on this tree (d363a19d): the server endpoint ALREADY
 * enforces the gate twice, and the service-level spec already pins
 * it (restaurant-fnb-claims-post.spec.ts cases (4)-(7): no PIN fails,
 * wrong PIN fails, a cashier fails even with the correct PIN, a
 * cashier with pos_manager succeeds). What was NEVER pinned is the
 * CONTROLLER wiring — the R5-D bug class (221c0c43), where the
 * controller passed the bare requireTenantScope() result and the
 * gate refused everyone, manager included. A service-level spec
 * cannot catch that: it hands the service a full scope. These
 * checks call the controller with a real req.authContext the way
 * the POS does, and pin:
 * - (1) a cashier caller fails 403 MANAGER_PERMISSION_REQUIRED even
 *   with the CORRECT shared PIN — the PIN proves a manager approved,
 *   it does not make the caller a manager (assertManagerCaller runs
 *   before authorizeManagerSecret);
 * - (2) a cashier with an empty PIN fails 403 too (the role gate
 *   fires first, not the 400);
 * - (3) a manager caller with an empty PIN fails 400
 *   MANAGER_AUTH_REQUIRED, and (4) with a wrong PIN 400
 *   MANAGER_AUTH_INVALID — nothing is recorded either way;
 * - (5) a manager caller with the correct PIN records the cart comp
 *   (no sale yet: no journal, the discount posts with the sale) and
 *   the recorded manager is the VERIFIED approver ('اعتماد المدير'),
 *   never the client free-text name;
 * - (6) a cashier holding the pos_manager permission still succeeds
 *   with the correct PIN — the permission path is the manager flow
 *   for non-admin managers, and it must keep working;
 * - (7) a PIN stored as a bcrypt hash verifies (the B1-era shape:
 *   Settings stores the hash, never plaintext);
 * - (8) an active admin's login password approves in place of the
 *   PIN (account mode), and the recorded manager is that admin's
 *   username.
 *
 * The frontend half of this package (PosManagerCompModal): the
 * approve button is disabled until a PIN is typed, so the button
 * cannot act without one; the confirm-time PIN check stays as
 * defence in depth. Pinned by
 * frontend/src/features/pos/components/pos-workspace/PosManagerCompModal.spec.tsx.
 * The tile itself still opens the dialog for a non-manager (view
 * only until a PIN is entered) — the money action, approve, is
 * gated at two independent layers (dialog + server), and a
 * tile-level prompt would duplicate the dialog's own PIN field.
 *
 * RED PROOF: the server checks pass on this tree because the gate
 * is already wired. They are proven to catch a regression by
 * mutation: with assertManagerCaller removed from recordManagerComp
 * the cashier cases (1)/(2) succeed and write comp rows; with the
 * controller forwarding removed (bare requireTenantScope() result,
 * the 221c0c43 bug) the manager cases (5)-(8) fail 403. The
 * frontend spec fails on the unfixed dialog (approve enabled with
 * an empty PIN).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  RestaurantAdvancedFnbService,
} from '../../src/modules/sales/services/restaurant-advanced-fnb.service';
import { RestaurantAdvancedFnbController } from '../../src/modules/sales/controllers/restaurant-advanced-fnb.controller';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const TENANT = 't1';
const ACCOUNT = 't1:main';
const PIN = '1234';

const DDL = `
  CREATE TABLE settings (tenant_id text, key text, value text);
  CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
  CREATE TABLE users (id bigserial PRIMARY KEY, username text, role text, password_hash text, password_salt text,
    is_active boolean DEFAULT true, tenant_id text, account_id text);
  CREATE TABLE restaurant_manager_comps (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint,
    sale_id bigint, table_number text, comp_type text, manager_name text, amount numeric,
    items_summary text, notes text, created_at timestamptz DEFAULT NOW());
`;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(DDL);
  return { pg, db };
}

async function resetDb(pg: PGlite): Promise<void> {
  await pg.exec(
    `TRUNCATE settings, currency_exchange_rates, users, restaurant_manager_comps RESTART IDENTITY`,
  );
}

async function seedBase(db: Kysely<Database>, pinValue = '"1234"'): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: pinValue }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({
    tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1,
  }).execute();
}

async function seedAdminUser(db: Kysely<Database>, password: string): Promise<void> {
  const record = await createPasswordRecord(password);
  await (db as any).insertInto('users').values({
    username: 'boss', role: 'admin', password_hash: record.hash, password_salt: record.salt,
    is_active: true, tenant_id: TENANT, account_id: ACCOUNT,
  }).execute();
}

async function expectAppError(promise: Promise<unknown>, code: string, statusCode: number): Promise<void> {
  try {
    await promise;
  } catch (error: any) {
    assert.equal(error?.code, code, `expected AppError ${code}, got ${error?.code}: ${error?.message}`);
    assert.equal(error?.statusCode, statusCode, `expected status ${statusCode}, got ${error?.statusCode}`);
    return;
  }
  assert.fail(`expected AppError ${code} but the call succeeded`);
}

async function countComps(pg: PGlite): Promise<number> {
  const rows: any = await pg.query(`SELECT COUNT(*)::int AS n FROM restaurant_manager_comps`);
  return Number(rows.rows[0].n);
}

function reqFor(role: string, permissions: string[], userId: number): any {
  return {
    authContext: {
      userId, sessionId: `s${userId}`, username: role === 'admin' ? 'admin' : 'cashier',
      role, permissions, tenantId: TENANT, accountId: ACCOUNT,
    },
  };
}

function compDto(overrides: Record<string, unknown> = {}): any {
  return {
    compType: 'vip_guest',
    managerName: 'Invented Name',
    managerPin: PIN,
    amount: 75,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    const service = new RestaurantAdvancedFnbService(db as any);

    // (1) Through the CONTROLLER, a cashier fails even with the correct
    // PIN — the PIN proves a manager approved, it does not make the
    // caller a manager. Nothing is recorded.
    {
      await resetDb(pg);
      await seedBase(db);
      const controller = new RestaurantAdvancedFnbController(service);
      await expectAppError(
        controller.recordManagerComp(reqFor('cashier', ['sales'], 2), compDto()),
        'MANAGER_PERMISSION_REQUIRED',
        403,
      );
      assert.equal(await countComps(pg), 0, 'the refused comp must write nothing');
      console.log('  (1) controller cashier with the right PIN still fails passed');
    }

    // (2) Through the CONTROLLER, a cashier with an empty PIN fails 403
    // too — the role gate fires before the PIN check.
    {
      await resetDb(pg);
      await seedBase(db);
      const controller = new RestaurantAdvancedFnbController(service);
      await expectAppError(
        controller.recordManagerComp(reqFor('cashier', ['sales'], 2), compDto({ managerPin: '' })),
        'MANAGER_PERMISSION_REQUIRED',
        403,
      );
      assert.equal(await countComps(pg), 0, 'the refused comp must write nothing');
      console.log('  (2) controller cashier with an empty PIN fails 403 passed');
    }

    // (3) Through the CONTROLLER, a manager caller with an empty PIN
    // fails 400 MANAGER_AUTH_REQUIRED; nothing is recorded.
    {
      await resetDb(pg);
      await seedBase(db);
      const controller = new RestaurantAdvancedFnbController(service);
      await expectAppError(
        controller.recordManagerComp(reqFor('admin', [], 1), compDto({ managerPin: '' })),
        'MANAGER_AUTH_REQUIRED',
        400,
      );
      assert.equal(await countComps(pg), 0, 'the refused comp must write nothing');
      console.log('  (3) controller manager with an empty PIN fails passed');
    }

    // (4) Through the CONTROLLER, a manager caller with a wrong PIN
    // fails 400 MANAGER_AUTH_INVALID; nothing is recorded.
    {
      await resetDb(pg);
      await seedBase(db);
      const controller = new RestaurantAdvancedFnbController(service);
      await expectAppError(
        controller.recordManagerComp(reqFor('admin', [], 1), compDto({ managerPin: '9999' })),
        'MANAGER_AUTH_INVALID',
        400,
      );
      assert.equal(await countComps(pg), 0, 'the refused comp must write nothing');
      console.log('  (4) controller manager with a wrong PIN fails passed');
    }

    // (5) Through the CONTROLLER, a manager caller with the correct PIN
    // records the cart comp: no journal (the discount posts with the
    // sale), and the recorded manager is the VERIFIED approver, never
    // the client free-text name.
    {
      await resetDb(pg);
      await seedBase(db);
      const controller = new RestaurantAdvancedFnbController(service);
      const res: any = await controller.recordManagerComp(reqFor('admin', [], 1), compDto());
      assert.equal(res.success, true);
      assert.equal(res.journalEntryId, null, 'a cart comp posts no journal');
      assert.equal(res.comp.manager_name, 'اعتماد المدير', 'the recorded manager is the verified approver');
      assert.equal(Number(res.comp.amount), 75);
      assert.equal(res.comp.sale_id, null, 'a cart comp names no sale');
      assert.ok(String(res.message).includes('يُرحَّل الخصم مع الفاتورة'), 'the message must say the discount posts with the sale');
      assert.equal(await countComps(pg), 1);
      console.log('  (5) controller manager with the right PIN records the cart comp passed');
    }

    // (6) Through the CONTROLLER, a cashier holding the pos_manager
    // permission still succeeds with the correct PIN — the permission
    // path is the manager flow for non-admin managers.
    {
      await resetDb(pg);
      await seedBase(db);
      const controller = new RestaurantAdvancedFnbController(service);
      const res: any = await controller.recordManagerComp(reqFor('cashier', ['pos_manager'], 3), compDto());
      assert.equal(res.success, true);
      assert.equal(res.comp.manager_name, 'اعتماد المدير');
      assert.equal(await countComps(pg), 1);
      console.log('  (6) controller cashier with pos_manager permission succeeds passed');
    }

    // (7) A PIN stored as a bcrypt hash verifies through the CONTROLLER
    // (the B1-era shape: Settings stores the hash, never plaintext).
    {
      await resetDb(pg);
      const record = await createPasswordRecord(PIN);
      await seedBase(db, JSON.stringify(record.hash));
      const controller = new RestaurantAdvancedFnbController(service);
      const res: any = await controller.recordManagerComp(reqFor('admin', [], 1), compDto());
      assert.equal(res.success, true);
      assert.equal(await countComps(pg), 1);
      console.log('  (7) controller manager with a bcrypt-stored PIN succeeds passed');
    }

    // (8) Account-mode approval through the CONTROLLER: an active
    // admin's login password approves in place of the PIN, and the
    // recorded manager is that admin's username.
    {
      await resetDb(pg);
      await seedBase(db);
      await seedAdminUser(db, 'admin-pass');
      const controller = new RestaurantAdvancedFnbController(service);
      const res: any = await controller.recordManagerComp(
        reqFor('admin', [], 1),
        compDto({ managerPin: 'admin-pass' }),
      );
      assert.equal(res.success, true);
      assert.equal(res.comp.manager_name, 'boss');
      assert.equal(await countComps(pg), 1);
      console.log('  (8) controller account-mode approval records the admin username passed');
    }

    console.log('restaurant-manager-comp-gate.spec: all checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
