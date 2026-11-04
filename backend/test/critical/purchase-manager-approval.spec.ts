import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { authorizeManagerSecret } from '../../src/common/utils/manager-approval';
import { PurchasesWriteService } from '../../src/modules/purchases/services/purchases-write.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Purchase manager approval, actually verified
 * (INV-SPIRIT-PURCHASE-MANAGER-APPROVAL).
 *
 * THE HOLE: the purchase-edit dialog and the purchase-cancel dialog
 * both collected a manager PIN, the cancel endpoint even received it
 * over the wire — and the backend discarded it without checking
 * anything. Any caller with the edit permission could edit or cancel
 * a purchase with any string (or none) as the "approval".
 *
 * THE FIX: the one shared manager-approval check (extracted verbatim
 * from SalesAuthorizationService, which now delegates to it) runs
 * before edit/cancel, mirroring the sale-edit rule: a non-admin must
 * supply the shared manager PIN or a manager account password; an
 * admin bypasses unless a secret was supplied, in which case it is
 * verified too. The permission gate (@RequirePermissions
 * canEditInvoices) is unchanged and still applies first at the
 * controller.
 *
 * WHAT THIS PINS: the shared helper accepts the PIN (JSON-string and
 * plain settings values), an active admin password, and nothing else;
 * and both purchase methods enforce the gate BEFORE their own status
 * checks, so a missing or wrong secret is rejected even for a
 * purchase that would fail later anyway.
 */

const PIN = '2468';
const ADMIN_PASSWORD = 'admin-pass';

const cashier = { tenantId: 't1', accountId: 'a1', role: 'cashier', userId: 2, username: 'cashier-a', permissions: ['canEditInvoices'] } as unknown as AuthContext;
const admin = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'boss', permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    INSERT INTO settings VALUES ('t1','currency','EGP');
    INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, role text, is_active boolean,
      password_hash text, password_salt text);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint,
      status text, lifecycle_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, updated_at timestamptz);
  `);
  return { pg, db };
}

async function seedUsers(db: Kysely<Database>, pinValue: string | null): Promise<void> {
  if (pinValue !== null) {
    await (db as any).insertInto('settings').values({ tenant_id: 't1', key: 'managerPin', value: pinValue }).execute();
  }
  const record = await createPasswordRecord(ADMIN_PASSWORD);
  await (db as any).insertInto('users').values({
    id: 1, tenant_id: 't1', username: 'boss', role: 'admin', is_active: true,
    password_hash: record.hash, password_salt: record.salt,
  }).execute();
  await (db as any).insertInto('users').values({
    id: 2, tenant_id: 't1', username: 'cashier-a', role: 'cashier', is_active: true,
    password_hash: record.hash, password_salt: record.salt,
  }).execute();
  await (db as any).insertInto('users').values({
    id: 3, tenant_id: 't1', username: 'ex-admin', role: 'admin', is_active: false,
    password_hash: record.hash, password_salt: record.salt,
  }).execute();
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try { await promise; } catch (error) { caught = error; }
  assert.ok(caught, `expected rejection with ${code}`);
  assert.equal((caught as { code?: string }).code, code);
}

function makeWriteService(db: Kysely<Database>): PurchasesWriteService {
  return new PurchasesWriteService(
    db as never,
    new TransactionHelper(),
    { logWithExecutor: async () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

async function main(): Promise<void> {
  // Part 1: the shared helper itself.
  {
    const { pg, db } = await makeDb();
    try {
      await seedUsers(db, JSON.stringify(PIN));
      const byPin = await authorizeManagerSecret(db as never, admin, PIN);
      assert.equal(byPin.mode, 'pin');
      const byPassword = await authorizeManagerSecret(db as never, cashier, ADMIN_PASSWORD);
      assert.equal(byPassword.mode, 'account');
      assert.equal(byPassword.authorizedByName, 'boss', 'the password must belong to an admin account');
      await expectCode(authorizeManagerSecret(db as never, cashier, '0000'), 'MANAGER_AUTH_INVALID');
      await expectCode(authorizeManagerSecret(db as never, cashier, ''), 'MANAGER_AUTH_REQUIRED');
      await expectCode(authorizeManagerSecret(db as never, cashier, '  '), 'MANAGER_AUTH_REQUIRED');
    } finally {
      await db.destroy();
    }
  }

  // Part 1b: a plain (non-JSON, non-numeric) PIN value in settings is
  // accepted too. A bare NUMERIC value is not: JSON.parse('2468')
  // succeeds as a number, so the original parser returns '' — the
  // extraction keeps that behaviour verbatim; settings store the PIN
  // JSON-encoded ('"2468"').
  {
    const { pg, db } = await makeDb();
    try {
      await seedUsers(db, 'manager1');
      const byPin = await authorizeManagerSecret(db as never, admin, 'manager1');
      assert.equal(byPin.mode, 'pin');
    } finally {
      await db.destroy();
    }
  }

  // Part 2: the purchase gates run before the status checks.
  {
    const { pg, db } = await makeDb();
    try {
      await seedUsers(db, JSON.stringify(PIN));
      await (db as any).insertInto('purchases').values({ id: 1, tenant_id: 't1', account_id: 'a1', doc_no: 'P1', supplier_id: 9, status: 'posted', lifecycle_status: 'posted' }).execute();
      await (db as any).insertInto('purchases').values({ id: 2, tenant_id: 't1', account_id: 'a1', doc_no: 'P2', supplier_id: 9, status: 'cancelled', lifecycle_status: 'posted' }).execute();
      const svc = makeWriteService(db);
      const editPayload = { editReason: 'fix', items: [], supplierId: 9 } as any;

      await expectCode(svc.updatePurchase(1, editPayload, cashier), 'MANAGER_AUTH_REQUIRED');
      await expectCode(svc.updatePurchase(1, { ...editPayload, managerPin: '0000' }, cashier), 'MANAGER_AUTH_INVALID');
      await expectCode(svc.updatePurchase(1, { ...editPayload, managerPin: PIN }, cashier), 'POSTED_PURCHASE_EDIT_FORBIDDEN');
      await expectCode(svc.updatePurchase(1, { ...editPayload, managerPin: ADMIN_PASSWORD }, cashier), 'POSTED_PURCHASE_EDIT_FORBIDDEN');
      await expectCode(svc.updatePurchase(1, editPayload, admin), 'POSTED_PURCHASE_EDIT_FORBIDDEN');
      await expectCode(svc.updatePurchase(1, { ...editPayload, managerPin: '0000' }, admin), 'MANAGER_AUTH_INVALID');

      await expectCode(svc.cancelPurchase(2, 'dup', cashier), 'MANAGER_AUTH_REQUIRED');
      await expectCode(svc.cancelPurchase(2, 'dup', cashier, '0000'), 'MANAGER_AUTH_INVALID');
      await expectCode(svc.cancelPurchase(2, 'dup', cashier, PIN), 'PURCHASE_ALREADY_CANCELLED');
      await expectCode(svc.cancelPurchase(2, 'dup', admin), 'PURCHASE_ALREADY_CANCELLED');
    } finally {
      await db.destroy();
    }
  }

  console.log('purchase manager approval checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
