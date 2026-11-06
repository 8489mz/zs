/* Expenses stale list (INV-EXPENSES-STALE-LIST): listExpenses must return
 * rangeStart/rangeEnd in its pagination (one expense reads "1-1 of 1",
 * an empty list reads 0-0), so the register never shows "0-0 of 1".
 * Drives the REAL TreasuryService.listExpenses on PGlite.
 */
import assert from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { TreasuryService } from '../../src/modules/treasury/treasury.service';

const TENANT = 't1';
const ACTOR: any = {
  userId: 1,
  sessionId: 's1',
  username: 'admin',
  role: 'admin',
  permissions: [],
  tenantId: TENANT,
  accountId: 'a1',
};

async function main() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    await sql`CREATE TABLE expenses (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT, amount NUMERIC(14,2) NOT NULL DEFAULT 0, expense_date DATE, note TEXT, branch_id INTEGER, location_id INTEGER, created_by INTEGER)`.execute(db);
    await sql`CREATE TABLE branches (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT)`.execute(db);
    await sql`CREATE TABLE stock_locations (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT)`.execute(db);
    await sql`CREATE TABLE users (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, username TEXT)`.execute(db);
    await sql`CREATE TABLE settings (tenant_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT)`.execute(db);
    await sql`CREATE TABLE currency_exchange_rates (tenant_id TEXT NOT NULL, currency_code TEXT, exchange_rate NUMERIC(14,6), is_base BOOLEAN NOT NULL DEFAULT false)`.execute(db);

    await sql`INSERT INTO expenses (tenant_id, title, amount, expense_date) VALUES (${TENANT}, ${'قرطاسية'}, 50, ${'2026-11-06'}), (${'t2'}, ${'مصروف مستأجر آخر'}, 999, ${'2026-11-06'})`.execute(db);

    const service = new TreasuryService(db as never, {} as never, {} as never, {} as never);
    const one = (await service.listExpenses({ page: 1, pageSize: 20 }, ACTOR)) as any;
    assert.equal(one.pagination.totalItems, 1, 'only this tenant expense counts');
    assert.equal(one.pagination.rangeStart, 1, 'one expense starts at 1, not 0');
    assert.equal(one.pagination.rangeEnd, 1, 'one expense ends at 1, not 0');
    assert.equal(one.expenses.length, 1, 'one row returned');

    await sql`DELETE FROM expenses WHERE tenant_id = ${TENANT}`.execute(db);
    const empty = (await service.listExpenses({ page: 1, pageSize: 20 }, ACTOR)) as any;
    assert.equal(empty.pagination.totalItems, 0, 'empty list has 0 items');
    assert.equal(empty.pagination.rangeStart, 0, 'empty list starts at 0');
    assert.equal(empty.pagination.rangeEnd, 0, 'empty list ends at 0');

    console.log('expense-stale-list backend checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
