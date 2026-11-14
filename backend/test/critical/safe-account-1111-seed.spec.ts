/*
 * Safe/cash-box account 1111 seed (INV-DRAWER-DISBURSE-CASHIER-PASSWORD).
 * Migration 0324 seeds one 1111 row — "الخزينة الآمنة" / "Safe / Cash
 * Box", asset, parent 1100, group 'cash_bank', is_cash_bank TRUE —
 * for every tenant that already has a chart.
 *
 * Grounding, read from the live code before this spec was written:
 * - Trial T31: a safe transfer (safe_drop, 300, counterpart 1110 —
 *   الخزينة) fails with DRAWER_COUNTERPART_SAME_AS_CASH because the
 *   drawer cash account IS 1110 and the code states "There is no
 *   safe/cash-box account in the chart". With counterpart 1120 the
 *   same call succeeds. So "transfer to the safe" had no account to
 *   land in: 1110 is the drawer itself, 1120 is the bank.
 * - The transfer counterpart validation (recordCashMovement pre-check
 *   and postCashDrawerMovement) requires an active is_cash_bank
 *   asset with a debit normal balance, different from the drawer
 *   cash account — so the seeded row MUST be is_cash_bank true, or
 *   the transfer still fail-closes. That is the one shape difference
 *   from the 1181 precedent (migration 0305), whose row is NOT
 *   cash/bank.
 * - The old seed list DEFAULT_SEED_ACCOUNTS is NOT the vehicle for
 *   existing tenants: it already ran on every live database, so
 *   editing it alone would change nothing for any existing tenant.
 *   The migration is the vehicle (precedent: 0106 GRNI/PPV, 0305
 *   1181); the same row is ALSO added to DEFAULT_SEED_ACCOUNTS so a
 *   brand-new tenant's chart contains it from the start.
 * - 1111 is free: no 1111 code exists anywhere in the COA seed or
 *   in any migration (verified by grep before this package).
 *
 * Drives the REAL migration up()/down() on PGlite:
 * - Case 0: the base state — a seeded chart has no 1111 row.
 * - Case 1: up() inserts exactly one 1111 for the charted tenant,
 *   with the transfer-eligible shape and parent 1100.
 * - Case 2: up() twice is a no-op (idempotent).
 * - Case 3: a tenant-created 1111 (manual, is_system false) is
 *   never overwritten by up().
 * - Case 4: a tenant with no chart gets no row.
 * - Case 5: down() removes only the row it added, never the
 *   tenant-created one.
 * - Case 6: down() never removes a 1111 any journal line
 *   references.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { migration } from '../../src/database/migrations/2040000000324_safe_account_1111';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id TEXT PRIMARY KEY);
    CREATE TABLE accounting_accounts (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT, account_type TEXT, account_group TEXT, parent_id BIGINT, normal_balance TEXT NOT NULL DEFAULT 'debit', is_active BOOLEAN NOT NULL DEFAULT true, is_system BOOLEAN NOT NULL DEFAULT false, allow_manual_entries BOOLEAN NOT NULL DEFAULT true, is_control_account BOOLEAN NOT NULL DEFAULT false, is_cash_bank BOOLEAN NOT NULL DEFAULT false, is_receivable BOOLEAN NOT NULL DEFAULT false, is_payable BOOLEAN NOT NULL DEFAULT false, is_inventory BOOLEAN NOT NULL DEFAULT false, is_tax BOOLEAN NOT NULL DEFAULT false, description_ar TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id, code));
    CREATE TABLE journal_entry_lines (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id BIGINT);
    INSERT INTO tenants VALUES ('t1'), ('t2'), ('t3');
    INSERT INTO accounting_accounts (tenant_id, account_id, code, name_ar, name_en, account_type, account_group, parent_id, normal_balance, is_active, is_system, sort_order) VALUES
      ('t1', 't1', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', NULL, 'debit', true, true, 1100),
      ('t1', 't1', '1110', 'الخزينة', 'Cash', 'asset', 'cash_bank', 1, 'debit', true, true, 1110),
      ('t1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', 1, 'debit', true, true, 1120),
      ('t1', 't1', '1130', 'العملاء', 'Customers', 'asset', 'receivable', 1, 'debit', true, true, 1130),
      ('t2', 't2', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', NULL, 'debit', true, true, 1100),
      ('t2', 't2', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', 9, 'debit', true, true, 1120),
      ('t2', 't2', '1111', 'خزينة يدوية', 'Manual safe', 'asset', 'cash_bank', 9, 'debit', true, false, 1111);
  `);
  return db;
}

async function rowsFor(db: Kysely<Database>, tenantId: string, code: string): Promise<any[]> {
  return (db as any)
    .selectFrom('accounting_accounts')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('code', '=', code)
    .execute();
}

async function main(): Promise<void> {
  const db = await makeDb();
  try {
    // Case 0: the base state — the seeded chart has no 1111 row.
    assert.equal((await rowsFor(db, 't1', '1111')).length, 0, 'Base chart has no 1111 row');

    // Case 1: up() inserts exactly one 1111 for the charted tenant,
    // with the transfer-eligible shape and parent 1100.
    await migration.up(db as never);
    const seeded = await rowsFor(db, 't1', '1111');
    assert.equal(seeded.length, 1, 'up() inserts exactly one 1111 for t1');
    const row = seeded[0];
    assert.equal(row.name_ar, 'الخزينة الآمنة', '1111 carries the safe Arabic name');
    assert.equal(row.name_en, 'Safe / Cash Box', '1111 carries the safe English name');
    assert.equal(row.account_type, 'asset', '1111 is an asset, not a receivable/control account');
    assert.equal(row.normal_balance, 'debit', '1111 is debit-normal');
    assert.equal(row.account_group, 'cash_bank', '1111 sits in cash/bank like 1110');
    assert.equal(Number(row.parent_id), 1, '1111 hangs under 1100 Current Assets');
    assert.equal(row.is_active, true, '1111 is active');
    assert.equal(row.is_system, true, '1111 is seeded as a system row');
    assert.equal(row.allow_manual_entries, true, '1111 allows manual entries');
    assert.equal(row.is_control_account, false, '1111 is not a control account');
    assert.equal(row.is_cash_bank, true, '1111 IS cash/bank — otherwise no safe transfer could name it');
    assert.equal(row.is_receivable, false, '1111 is not a receivable');
    assert.equal(row.is_payable, false, '1111 is not a payable');
    assert.equal(row.is_inventory, false, '1111 is not inventory');
    assert.equal(row.is_tax, false, '1111 is not a tax account');

    // Case 2: up() twice is a no-op (idempotent).
    await migration.up(db as never);
    assert.equal((await rowsFor(db, 't1', '1111')).length, 1, 'Second up() still leaves exactly one 1111 for t1');

    // Case 3: a tenant-created 1111 is never overwritten by up().
    const manual = await rowsFor(db, 't2', '1111');
    assert.equal(manual.length, 1, 't2 keeps exactly one 1111');
    assert.equal(manual[0].name_ar, 'خزينة يدوية', 'up() never overwrites the tenant-created 1111 name');
    assert.equal(manual[0].is_system, false, 'up() never flips the tenant-created 1111 to a system row');

    // Case 4: a tenant with no chart gets no row.
    assert.equal((await rowsFor(db, 't3', '1111')).length, 0, 'A tenant with no chart gets no 1111 row');

    // Case 5: down() removes only the row it added, never the
    // tenant-created one.
    await migration.down!(db as never);
    assert.equal((await rowsFor(db, 't1', '1111')).length, 0, 'down() removes the seeded 1111 for t1');
    const manualAfterDown = await rowsFor(db, 't2', '1111');
    assert.equal(manualAfterDown.length, 1, 'down() never removes the tenant-created 1111');
    assert.equal(manualAfterDown[0].name_ar, 'خزينة يدوية', 'down() leaves the tenant-created row untouched');

    // Case 6: down() never removes a 1111 any journal line
    // references.
    await migration.up(db as never);
    const reseeded = await rowsFor(db, 't1', '1111');
    assert.equal(reseeded.length, 1, 'up() re-seeds 1111 for t1 after down()');
    await sql`INSERT INTO journal_entry_lines (account_id) VALUES (${Number(reseeded[0].id)})`.execute(db);
    await migration.down!(db as never);
    assert.equal((await rowsFor(db, 't1', '1111')).length, 1, 'down() keeps a 1111 that posted journals reference');

    console.log('Safe account 1111 seed tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
