/* Accounts balances column (INV-ACCOUNTS-BALANCES-COLUMN): the accounts
 * list must show each account's balance from POSTED journal lines only,
 * oriented by the account's normal balance (debit-normal: debit minus
 * credit; credit-normal: credit minus debit); draft/cancelled entries
 * and other tenants' lines never move it, and an account with no lines
 * shows zero. Drives the REAL AccountingService.listAccounts on PGlite.
 */
import assert from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { AccountingService } from '../../src/modules/accounting/accounting.service';

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
    await sql`CREATE TABLE accounting_accounts (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT, account_type TEXT, account_group TEXT, parent_id INTEGER, normal_balance TEXT NOT NULL DEFAULT 'debit', is_active BOOLEAN NOT NULL DEFAULT true, is_system BOOLEAN NOT NULL DEFAULT false, allow_manual_entries BOOLEAN NOT NULL DEFAULT true, is_control_account BOOLEAN NOT NULL DEFAULT false, is_cash_bank BOOLEAN NOT NULL DEFAULT false, is_receivable BOOLEAN NOT NULL DEFAULT false, is_payable BOOLEAN NOT NULL DEFAULT false, is_inventory BOOLEAN NOT NULL DEFAULT false, is_tax BOOLEAN NOT NULL DEFAULT false, is_monetary BOOLEAN NOT NULL DEFAULT false, revaluation_currency TEXT, sort_order INTEGER NOT NULL DEFAULT 0)`.execute(db);
    await sql`CREATE TABLE journal_entries (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, status TEXT NOT NULL)`.execute(db);
    await sql`CREATE TABLE journal_entry_lines (id SERIAL PRIMARY KEY, journal_entry_id INTEGER NOT NULL, tenant_id TEXT NOT NULL, account_id INTEGER NOT NULL, debit NUMERIC(14,2) NOT NULL DEFAULT 0, credit NUMERIC(14,2) NOT NULL DEFAULT 0)`.execute(db);

    // 1010 cash, debit-normal, no lines at all -> 0.00
    await sql`INSERT INTO accounting_accounts (id, tenant_id, code, name_ar, normal_balance) VALUES (5, ${TENANT}, ${'1010'}, ${'الصندوق'}, ${'debit'})`.execute(db);
    // 1140 inventory, debit-normal: posted debit 100 / credit 40 -> 60
    await sql`INSERT INTO accounting_accounts (id, tenant_id, code, name_ar, normal_balance) VALUES (1, ${TENANT}, ${'1140'}, ${'المخزون'}, ${'debit'})`.execute(db);
    // 2140 payables, credit-normal: posted credit 200 / debit 50 -> 150
    await sql`INSERT INTO accounting_accounts (id, tenant_id, code, name_ar, normal_balance) VALUES (2, ${TENANT}, ${'2140'}, ${'الدائنون'}, ${'credit'})`.execute(db);
    // 5110 COGS, debit-normal: only a DRAFT entry -> 0
    await sql`INSERT INTO accounting_accounts (id, tenant_id, code, name_ar, normal_balance) VALUES (3, ${TENANT}, ${'5110'}, ${'تكلفة البضاعة'}, ${'debit'})`.execute(db);
    // 4100 revenue, credit-normal: only a CANCELLED entry -> 0
    await sql`INSERT INTO accounting_accounts (id, tenant_id, code, name_ar, normal_balance) VALUES (4, ${TENANT}, ${'4100'}, ${'الإيرادات'}, ${'credit'})`.execute(db);

    await sql`INSERT INTO journal_entries (id, tenant_id, status) VALUES (10, ${TENANT}, ${'posted'}), (11, ${TENANT}, ${'draft'}), (12, ${TENANT}, ${'cancelled'}), (13, ${'t2'}, ${'posted'})`.execute(db);
    await sql`INSERT INTO journal_entry_lines (journal_entry_id, tenant_id, account_id, debit, credit) VALUES
      (10, ${TENANT}, 1, 100, 0),
      (10, ${TENANT}, 1, 0, 40),
      (10, ${TENANT}, 2, 50, 0),
      (10, ${TENANT}, 2, 0, 200),
      (11, ${TENANT}, 3, 500, 0),
      (12, ${TENANT}, 4, 0, 999),
      (13, ${'t2'}, 1, 1000, 0)`.execute(db);

    const service = new AccountingService(
      db as never,
      { ensureForAuth: async () => undefined } as never,
    );
    const result = (await service.listAccounts(ACTOR)) as any;
    const byCode = new Map<string, any>(result.accounts.map((a: any) => [a.code, a]));

    assert.equal(byCode.get('1140').balance, 60, 'debit-normal posted 100-40 must be 60');
    assert.equal(byCode.get('2140').balance, 150, 'credit-normal posted 200-50 must be 150');
    assert.equal(byCode.get('5110').balance, 0, 'draft lines must not move the balance');
    assert.equal(byCode.get('4100').balance, 0, 'cancelled lines must not move the balance');
    assert.equal(byCode.get('1010').balance, 0, 'an account with no lines must show 0');
    assert.equal(byCode.get('1140').balance, 60, 'another tenant\'s posted lines must not leak in');

    console.log('accounts-balances-column backend checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
