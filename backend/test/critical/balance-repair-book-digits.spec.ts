/*
New file: backend/test/critical/balance-repair-book-digits.spec.ts
Style follows backend/test/critical/pdc-subledger-balance-after.spec.ts
(PGlite + Kysely, imports production code, db.destroy() teardown).

WHAT THIS PINS: the admin balance-repair actions reconcile partner
balances at tenant book digits (INV-BALANCE-REPAIR-BOOK-DIGITS).
Before this package, reconcileCustomers/reconcileSuppliers rounded
BOTH the ledger sum and the stored balance with toFixed(2) and
skipped any partner whose rounded difference was <= 0.0001, so on a
3-decimal tenant a true 100.125 ledger sum was written as 100.13
and then frozen by the skip band forever; a partner with NO ledger
rows reconciled to 0 through the LEFT JOIN + COALESCE, so the
repair could wipe a genuine opening balance to zero; and every
update ran as its own statement with no transaction, so a failure
mid-run left half the partners repaired.

The fix: the ledger sum is rounded ONCE at book digits through
minor units, the stored balance is compared EXACTLY (no band, no
second rounding), a ledger-less partner with a non-zero balance is
fail-closed (skipped and reported, never zeroed), and each
reconcile run -- including reconcileAll across both sides -- runs
in ONE transaction, with audit logging only after commit. Currency
settings are resolved on the transaction handle and fail closed on
mismatch, like every other posting path; that precondition is
pinned by the settings/rate seeds below, not by a code branch.

The spec drives the REAL service methods over PGlite with a stub
audit service. Storage is pinned by migrations 0257/0258 (partner
balance scale 3), not by this spec: the PGlite DDL below uses
unbounded numerics, so a storage regression would not fail here --
run the migrations, don't just run the spec. The settings
diagnostics helper (toFixed(2) return shaping) is deliberately
untouched and untested here. The CHECK constraint in phase 2
exists ONLY to fault-inject a mid-run failure and prove the
rollback; it is not part of the production schema.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SettingsAdminService } from '../../src/modules/settings/services/settings-admin.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'super_admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

function makeService(db: Kysely<Database>, auditCalls: unknown[][]) {
  const auditStub = { log: async (...args: unknown[]) => { auditCalls.push(args); } } as never;
  return new SettingsAdminService(db, auditStub);
}

async function seedCurrency(pg: PGlite) {
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    INSERT INTO settings VALUES ('t1', 'currency', 'KWD');
    INSERT INTO currency_exchange_rates VALUES ('t1', 'KWD', true, 1);
  `);
}

async function main() {
  // Phase 1: exact 3dp repair + fail-closed skip, per side.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    const auditCalls: unknown[][] = [];
    const service = makeService(db, auditCalls);
    try {
      await seedCurrency(pg);
      await pg.exec(`
        CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
        CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
        CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, customer_id bigint, amount numeric);
        CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, amount numeric);
        INSERT INTO customers VALUES (25, 't1', 100.13, now()), (26, 't1', 50, now()), (27, 't1', 0, now()), (28, 't1', 10.125, now());
        INSERT INTO suppliers VALUES (7, 't1', 20, now()), (8, 't1', 5, now());
        INSERT INTO customer_ledger (tenant_id, customer_id, amount) VALUES ('t1', 25, 100), ('t1', 25, 0.125), ('t1', 28, 10.125);
        INSERT INTO supplier_ledger (tenant_id, supplier_id, amount) VALUES ('t1', 7, 20), ('t1', 7, -0.125);
      `);

      const result = await service.reconcileCustomers(AUTH);
      assert.deepEqual(result, { ok: true, updated: 1, skipped: 1 });
      const customers = await pg.query<{ id: string; balance: string }>('SELECT id, balance FROM customers ORDER BY id');
      assert.deepEqual(customers.rows.map((r) => [Number(r.id), String(r.balance)]), [
        [25, '100.125'],
        [26, '50'],
        [27, '0'],
        [28, '10.125'],
      ]);

      const supplierResult = await service.reconcileSuppliers(AUTH);
      assert.deepEqual(supplierResult, { ok: true, updated: 1, skipped: 1 });
      const suppliers = await pg.query<{ id: string; balance: string }>('SELECT id, balance FROM suppliers ORDER BY id');
      assert.deepEqual(suppliers.rows.map((r) => [Number(r.id), String(r.balance)]), [
        [7, '19.875'],
        [8, '5'],
      ]);
      // One audit log per successful run, written after commit.
      assert.equal(auditCalls.length, 2);
      console.log('balance-repair-book-digits: phase 1 OK');
    } finally {
      await db.destroy();
    }
  }

  // Phase 2: reconcileAll is one transaction -- a failing supplier
  // update rolls the customer repair back too, and nothing is logged.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    const auditCalls: unknown[][] = [];
    const service = makeService(db, auditCalls);
    try {
      await seedCurrency(pg);
      await pg.exec(`
        CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
        CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, balance numeric CHECK (balance >= 0), updated_at timestamptz);
        CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, customer_id bigint, amount numeric);
        CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, amount numeric);
        INSERT INTO customers VALUES (30, 't1', 100.13, now());
        INSERT INTO suppliers VALUES (9, 't1', 5, now());
        INSERT INTO customer_ledger (tenant_id, customer_id, amount) VALUES ('t1', 30, 100.125);
        INSERT INTO supplier_ledger (tenant_id, supplier_id, amount) VALUES ('t1', 9, -10);
      `);

      await assert.rejects(() => service.reconcileAll(AUTH));
      const customer = await pg.query<{ balance: string }>('SELECT balance FROM customers WHERE id=30');
      assert.equal(String(customer.rows[0].balance), '100.13');
      const supplier = await pg.query<{ balance: string }>('SELECT balance FROM suppliers WHERE id=9');
      assert.equal(String(supplier.rows[0].balance), '5');
      assert.equal(auditCalls.length, 0);
      console.log('balance-repair-book-digits: phase 2 OK');
    } finally {
      await db.destroy();
    }
  }
  console.log('balance-repair-book-digits: OK');
}

main().catch((error) => { console.error(error); process.exit(1); });
