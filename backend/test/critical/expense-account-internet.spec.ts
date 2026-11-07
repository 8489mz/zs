/*
 * Expense account for internet (INV-EXPENSE-ACCOUNT-6300): an
 * "internet" expense must post to 6700 Administrative, not 6300.
 *
 * The live defect: an internet expense of 250.00 on test10k posted to
 * account 6300 (electricity & utilities) because
 * mapExpenseTitleToAccountCode listed the Arabic words for internet
 * (انترنت/إنترنت) in the 6300 branch, and the English word "internet"
 * was not in the map at all, so it fell through to 6900. The chart of
 * accounts has no internet/telecom account at all, and the user decided
 * (2026-11-07) that internet posts to 6700 Administrative -- the
 * code-supported generic-expense account (the foundation engine's
 * generic-expense order is ['6700', '6900', '6000']).
 *
 * The fix moves only انترنت/إنترنت (and adds English "internet") out
 * of the 6300 branch into a 6700 branch in that one canonical map
 * function, so treasury, van-targets, and recovery replay -- all three
 * postExpense callers -- are corrected at once. The posted journal
 * JE-00014980 stays untouched: this is prospective only.
 *
 * WHAT THIS PINS, driving the REAL postExpense on PGlite:
 * 1. An Arabic internet expense (إنترنت, 250.00) debits 6700, credits
 *    cash 1110, and balances exactly.
 * 2. An English internet expense ("Internet bill") also debits 6700
 *    (the title is lowercased before matching).
 * 3. Neighbours are unchanged: كهرباء and مياه still debit 6300,
 *    إيجار still debits 6100.
 * 4. An unknown expense title still falls through to 6900.
 * 5. Every posted journal balances: total debit equals total credit
 *    equals the expense amount.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;
const EXPENSE_DATE = '2026-11-01T10:00:00.000Z';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
      INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, allow_manual_entries) VALUES
        (1110,'t1','a1','1110','asset',true),
        (6100,'t1','a1','6100','expense',true),
        (6300,'t1','a1','6300','expense',true),
        (6700,'t1','a1','6700','expense',true),
        (6900,'t1','a1','6900','expense',true);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,6900,NULL,NULL,NULL);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE expenses (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT NOT NULL DEFAULT '', branch_id BIGINT NULL, location_id BIGINT NULL, cost_center_id BIGINT NULL, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tenant_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '', request_key TEXT NULL);
    `);

    const postAndRead = async (title: string, amount: number): Promise<{ debitCode: string; creditCode: string; debitTotal: number; creditTotal: number }> => {
      const inserted = await pg.query(
        `INSERT INTO expenses (title, amount, expense_date, tenant_id, account_id, created_by) VALUES ($1, $2, $3, 't1', 'a1', 1) RETURNING id`,
        [title, amount, EXPENSE_DATE],
      );
      const expenseId = Number((inserted.rows[0] as { id: string }).id);
      const result = await posting.postExpense(db, expenseId, AUTH);
      assert.equal(result.posted, true, `expense "${title}" must post a journal`);
      assert.ok(result.journalEntryId, `expense "${title}" must return a journal entry id`);
      const lines = await db
        .selectFrom('journal_entry_lines')
        .select(['account_id', 'debit', 'credit'])
        .where('journal_entry_id', '=', Number(result.journalEntryId))
        .execute();
      assert.equal(lines.length, 2, `expense "${title}" must post exactly two lines`);
      const codeOf = async (accountId: number): Promise<string> => {
        const row = await db.selectFrom('accounting_accounts').select('code').where('id', '=', accountId).executeTakeFirstOrThrow();
        return String(row.code);
      };
      const debitLine = lines.find((line) => Number(line.debit) > 0)!;
      const creditLine = lines.find((line) => Number(line.credit) > 0)!;
      const debitTotal = lines.reduce((sum, line) => sum + Number(line.debit), 0);
      const creditTotal = lines.reduce((sum, line) => sum + Number(line.credit), 0);
      return {
        debitCode: await codeOf(Number(debitLine.account_id)),
        creditCode: await codeOf(Number(creditLine.account_id)),
        debitTotal,
        creditTotal,
      };
    };

    const assertBalanced = (title: string, amount: number, read: { debitTotal: number; creditTotal: number }): void => {
      assert.equal(read.debitTotal, amount, `expense "${title}" total debit equals the amount`);
      assert.equal(read.creditTotal, amount, `expense "${title}" total credit equals the amount`);
      assert.equal(read.debitTotal, read.creditTotal, `expense "${title}" journal balances`);
    };

    // 1. The live case: Arabic internet expense of 250.00 debits 6700, not 6300.
    const arabic = await postAndRead('إنترنت', 250);
    assert.equal(arabic.debitCode, '6700', 'Arabic internet expense posts to 6700 Administrative');
    assert.equal(arabic.creditCode, '1110', 'internet expense credits cash 1110');
    assertBalanced('إنترنت', 250, arabic);

    // 2. English internet expense debits 6700 as well (title is lowercased first).
    const english = await postAndRead('Internet bill', 120);
    assert.equal(english.debitCode, '6700', 'English internet expense posts to 6700 Administrative');
    assert.equal(english.creditCode, '1110', 'English internet expense credits cash 1110');
    assertBalanced('Internet bill', 120, english);

    // 3. Neighbours pinned: electricity and water stay on 6300.
    const electricity = await postAndRead('كهرباء', 80);
    assert.equal(electricity.debitCode, '6300', 'electricity expense still posts to 6300');
    assertBalanced('كهرباء', 80, electricity);
    const water = await postAndRead('مياه', 45);
    assert.equal(water.debitCode, '6300', 'water expense still posts to 6300');
    assertBalanced('مياه', 45, water);

    // 4. Rent still posts to 6100.
    const rent = await postAndRead('إيجار', 500);
    assert.equal(rent.debitCode, '6100', 'rent expense still posts to 6100');
    assertBalanced('إيجار', 500, rent);

    // 5. An unknown expense title still falls through to 6900.
    const unknown = await postAndRead('مصروف غريب', 30);
    assert.equal(unknown.debitCode, '6900', 'unknown expense title still falls through to 6900');
    assertBalanced('مصروف غريب', 30, unknown);

    console.log('expense-account-internet: internet (ar/en) -> 6700, electricity/water -> 6300, rent -> 6100, unknown -> 6900, all journals balance');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('expense-account-internet checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
