/*
 * Broker-advance account 1181 seed (INV-IMPORT-BROKER-ADVANCE-ACCOUNT
 * follow-up, I6-D). Migration 0305 seeds one 1181 row — "عهد المخلصين
 * الجمركيين" / "Customs Broker Advances", asset, parent 1100, group
 * 'current_assets', no role flag — for every tenant that already has
 * a chart. Grounding, read from the live code before this spec was
 * written:
 * - resolveTenantAccount('broker_advance') looks for 1181 FIRST,
 *   before 1230, and rejects any receivable/cash-bank/inventory/
 *   payable account and codes 1110/1120/1130/1140/1100 — so the
 *   seeded row must be a plain asset with all flags false, or the
 *   resolver still fail-closes. The D9 spec already proves a
 *   disburse posts Dr 1181 / Cr 1120 once the row exists; this spec
 *   proves the migration puts the row there.
 * - The old seed file 20260529000300 is NOT the vehicle: it already
 *   ran on every live database and its INSERT carries no tenant_id,
 *   so editing it would change nothing for any existing tenant.
 *   The migration is the vehicle (precedent: 0106 seeded GRNI/PPV
 *   per tenant the same way).
 * - 1230 is NOT seeded: no name or definition for it exists
 *   anywhere in the repo — only the second fallback candidate in
 *   the resolver. Seeding it would invent a COA account.
 *
 * Drives the REAL migration up()/down() on PGlite:
 * - Case 0: the base state — a seeded chart has no 1181/1230 row.
 * - Case 1: up() inserts exactly one 1181 for the charted tenant,
 *   with the resolver-eligible shape and parent 1100.
 * - Case 2: up() twice is a no-op (idempotent).
 * - Case 3: a tenant-created 1181 (manual, is_system false) is
 *   never overwritten by up().
 * - Case 4: a tenant with no chart gets no row, and no 1230 row
 *   is invented for anyone.
 * - Case 5: down() removes only the row it added, never the
 *   tenant-created one.
 * - Case 6: down() never removes a 1181 any journal line
 *   references.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { migration } from '../../src/database/migrations/2040000000305_import_broker_advance_account_1181';

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
      ('t1', 't1', '1140', 'المخزون', 'Inventory', 'asset', 'inventory', 1, 'debit', true, true, 1140),
      ('t1', 't1', '1150', 'ضريبة مشتريات قابلة للخصم', 'Purchase VAT Receivable', 'asset', 'tax', 1, 'debit', true, true, 1150),
      ('t1', 't1', '1160', 'عهد وسلف موظفين', 'Employee Advances', 'asset', 'current_assets', 1, 'debit', true, true, 1160),
      ('t1', 't1', '1170', 'مصروفات مدفوعة مقدمًا', 'Prepaid Expenses', 'asset', 'current_assets', 1, 'debit', true, true, 1170),
      ('t2', 't2', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', NULL, 'debit', true, true, 1100),
      ('t2', 't2', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', 9, 'debit', true, true, 1120),
      ('t2', 't2', '1181', 'عهدة مخلص يدوي', 'Manual broker advance', 'asset', 'current_assets', 9, 'debit', true, false, 1181);
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
    // Case 0: the base state — the seeded chart has no 1181/1230.
    assert.equal((await rowsFor(db, 't1', '1181')).length, 0, 'Base chart has no 1181 row');
    assert.equal((await rowsFor(db, 't1', '1230')).length, 0, 'Base chart has no 1230 row');

    // Case 1: up() inserts exactly one 1181 for the charted tenant,
    // with the resolver-eligible shape and parent 1100.
    await migration.up(db as never);
    const seeded = await rowsFor(db, 't1', '1181');
    assert.equal(seeded.length, 1, 'up() inserts exactly one 1181 for t1');
    const row = seeded[0];
    assert.equal(row.name_ar, 'عهد المخلصين الجمركيين', '1181 carries the broker-advance Arabic name');
    assert.equal(row.name_en, 'Customs Broker Advances', '1181 carries the broker-advance English name');
    assert.equal(row.account_type, 'asset', '1181 is an asset, not a receivable/control account');
    assert.equal(row.normal_balance, 'debit', '1181 is debit-normal');
    assert.equal(row.account_group, 'current_assets', '1181 sits in current assets like 1160');
    assert.equal(Number(row.parent_id), 1, '1181 hangs under 1100 Current Assets');
    assert.equal(row.is_active, true, '1181 is active');
    assert.equal(row.is_system, true, '1181 is seeded as a system row');
    assert.equal(row.allow_manual_entries, true, '1181 allows manual entries');
    assert.equal(row.is_control_account, false, '1181 is not a control account');
    assert.equal(row.is_cash_bank, false, '1181 is not cash/bank');
    assert.equal(row.is_receivable, false, '1181 is not a receivable');
    assert.equal(row.is_payable, false, '1181 is not a payable');
    assert.equal(row.is_inventory, false, '1181 is not inventory');
    assert.equal(row.is_tax, false, '1181 is not a tax account');

    // Case 2: up() twice is a no-op (idempotent).
    await migration.up(db as never);
    assert.equal((await rowsFor(db, 't1', '1181')).length, 1, 'Second up() still leaves exactly one 1181 for t1');

    // Case 3: a tenant-created 1181 is never overwritten by up().
    const manual = await rowsFor(db, 't2', '1181');
    assert.equal(manual.length, 1, 't2 keeps exactly one 1181');
    assert.equal(manual[0].name_ar, 'عهدة مخلص يدوي', 'up() never overwrites the tenant-created 1181 name');
    assert.equal(manual[0].is_system, false, 'up() never flips the tenant-created 1181 to a system row');

    // Case 4: a tenant with no chart gets no row, and no 1230 row
    // is invented for anyone.
    assert.equal((await rowsFor(db, 't3', '1181')).length, 0, 'A tenant with no chart gets no 1181 row');
    assert.equal((await rowsFor(db, 't1', '1230')).length, 0, 'No 1230 row is invented for t1');
    assert.equal((await rowsFor(db, 't2', '1230')).length, 0, 'No 1230 row is invented for t2');

    // Case 5: down() removes only the row it added, never the
    // tenant-created one.
    await migration.down!(db as never);
    assert.equal((await rowsFor(db, 't1', '1181')).length, 0, 'down() removes the seeded 1181 for t1');
    const manualAfterDown = await rowsFor(db, 't2', '1181');
    assert.equal(manualAfterDown.length, 1, 'down() never removes the tenant-created 1181');
    assert.equal(manualAfterDown[0].name_ar, 'عهدة مخلص يدوي', 'down() leaves the tenant-created row untouched');

    // Case 6: down() never removes a 1181 any journal line
    // references.
    await migration.up(db as never);
    const reseeded = await rowsFor(db, 't1', '1181');
    assert.equal(reseeded.length, 1, 'up() re-seeds 1181 for t1 after down()');
    await sql`INSERT INTO journal_entry_lines (account_id) VALUES (${Number(reseeded[0].id)})`.execute(db);
    await migration.down!(db as never);
    assert.equal((await rowsFor(db, 't1', '1181')).length, 1, 'down() keeps a 1181 that posted journals reference');

    console.log('Import broker advance account 1181 seed tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
