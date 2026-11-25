/*
New file: backend/test/critical/pdc-cheque-kwd.spec.ts
Style follows backend/test/critical/pdc-cheque-recycle.spec.ts
(PGlite + Kysely, imports production posting code).

WHAT THIS PINS: a KWD cheque posts its journals at 3-decimal precision
end to end. Before the Treasury P1 package, pdcBookAmount hard-coded *100
in all ten posting methods, so a 100.123 cheque posted 100.12 journals
while pdcCurrencySnapshot had computed base_amount = 100.123 correctly
-- the truncation happened between snapshot and journal, where
insertPostedJournal's bookDigits normalisation could not recover it.
This spec runs a receive -> deposit -> bounce cycle for a 100.123 KWD
cheque and asserts exact 3dp legs and zero nets. It proves the CODE
path; the STORAGE path (accounting_cheques.amount was numeric(15,2)
until migration 0264) is pinned by that migration, not by this spec:
the PGlite DDL below uses unbounded numerics, so a storage regression
would not fail here -- run the migration, don't just run the spec.

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

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const inTx = <T>(fn: (trx: any) => Promise<T>): Promise<T> => db.transaction().execute(fn);
  try {
    await pg.exec(`
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset',
        account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
        bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
        inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
        cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
        period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text,
        entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint,
        status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint,
        posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint,
        reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text,
        dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint,
        tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric,
        partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE customer_ledger (tenant_id text, customer_id bigint, amount numeric, reference_type text, reference_id bigint, entry_type text);
      CREATE TABLE supplier_ledger (tenant_id text, account_id text, supplier_id bigint, entry_type text,
        amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0);
      CREATE TABLE suppliers (id bigint, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE accounting_cheques (id bigint PRIMARY KEY, tenant_id text, account_id text, type text,
        cheque_number text, bank_name text, branch_name text, drawer_name text, partner_type text,
        partner_id bigint, partner_name text, amount numeric, currency text, base_amount numeric,
        base_currency text, exchange_rate numeric, issue_date date, due_date date, status text,
        deposit_bank_id bigint, deposit_date date, cleared_date date, bounced_date date,
        bounced_reason text, bounced_fee numeric, endorsed_to_supplier_id bigint,
        endorsed_to_supplier_name text, journal_entry_id bigint, last_action_date date,
        settlement_base_amount numeric, posting_sequence bigint DEFAULT 0, created_by bigint,
        notes text, created_at timestamptz, updated_at timestamptz);
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO customers VALUES (25,'t1',0);
    `);
    for (const [code, type] of [
      [1110, 'asset'],
      [1120, 'asset'],
      [1121, 'asset'],
      [1122, 'asset'],
      [1130, 'asset'],
      [7290, 'expense'],
    ] as const) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [
        code,
        't1',
        String(code),
        type,
      ]);
    }

    const linesOf = async (entryId: number) => {
      const r = await pg.query<{ account_id: string; debit: string; credit: string }>(
        'SELECT account_id, debit, credit FROM journal_entry_lines WHERE journal_entry_id=$1 ORDER BY account_id',
        [entryId],
      );
      return r.rows.map((row) => [Number(row.account_id), Number(row.debit), Number(row.credit)] as const);
    };

    // KWD cheque, face and book amount both 100.123 (rate 1, base KWD).
    await pg.query(`INSERT INTO accounting_cheques
      (id, tenant_id, type, cheque_number, bank_name, partner_type, partner_id, partner_name,
       amount, currency, base_amount, base_currency, exchange_rate,
       issue_date, due_date, status, posting_sequence, created_by)
      VALUES (1,'t1','receivable','CHQ-KWD-1','Test Bank','customer',25,'Customer 25',
       100.123,'KWD',100.123,'KWD',1,'2026-10-01','2026-11-01','in_safe',0,1)`);

    // Receive (sequence 0): Dr 1122 / Cr 1130 at exactly 100.123.
    const j1 = await inTx((trx) => posting.postPdcChequeReceive(trx, 1, auth));
    assert.equal(j1.posted, true);
    assert.deepEqual(await linesOf(Number(j1.journalEntryId)), [
      [1122, 100.123, 0],
      [1130, 0, 100.123],
    ]);

    // Deposit (sequence 1): Dr 1121 / Cr 1122 at exactly 100.123.
    await pg.query('UPDATE accounting_cheques SET posting_sequence=1, last_action_date=$1 WHERE id=1', ['2026-10-05']);
    const j2 = await inTx((trx) => posting.postPdcChequeDeposit(trx, 1, auth));
    assert.equal(j2.posted, true);
    assert.deepEqual(await linesOf(Number(j2.journalEntryId)), [
      [1121, 100.123, 0],
      [1122, 0, 100.123],
    ]);
    await pg.query("UPDATE accounting_cheques SET status='under_collection' WHERE id=1");

    // Bounce from under_collection (sequence 2): Dr 1130 / Cr 1121 at 100.123.
    await pg.query('UPDATE accounting_cheques SET posting_sequence=2, last_action_date=$1 WHERE id=1', ['2026-10-10']);
    const j3 = await inTx((trx) => posting.postPdcChequeBounce(trx, 1, 0, null, auth));
    assert.equal(j3.posted, true);
    assert.deepEqual(await linesOf(Number(j3.journalEntryId)), [
      [1121, 0, 100.123],
      [1130, 100.123, 0],
    ]);

    // Whole-cycle nets to exactly zero; every journal balances exactly.
    const nets = await pg.query<{ account_id: string; net: string }>(`
      SELECT jel.account_id, coalesce(sum(jel.debit - jel.credit), 0) AS net
      FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE je.tenant_id='t1' AND je.source_type LIKE 'pdc_cheque_%' AND je.source_id=1
      GROUP BY jel.account_id ORDER BY jel.account_id`);
    assert.deepEqual(
      nets.rows.map((r) => [Number(r.account_id), Number(r.net)]),
      [
        [1121, 0],
        [1122, 0],
        [1130, 0],
      ],
    );
    const unbalanced = await pg.query(
      `SELECT journal_entry_id FROM journal_entry_lines GROUP BY journal_entry_id HAVING sum(debit) <> sum(credit)`,
    );
    assert.deepEqual(unbalanced.rows, []);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
