/*
New file: backend/test/critical/cash-drawer-variance.spec.ts
Pure asserts + PGlite gate test. The pure part imports production
computeCashDrawerVariance; the PGlite part imports production
postCashierShiftVariance. No re-implemented formula anywhere.

WHAT THIS PINS (two layers):
1. The variance itself is computed at the tenant minor unit. Before the
   Treasury P1 package, computeCashDrawerVariance used toFixed(2), so a
   KWD 0.005 variance became 0.01 (GL overcharged) or 0.00 (dropped).
2. The GL gate posts ANY non-zero book variance. Before the package,
   postCashierShiftVariance returned posted:false for |variance| < 0.01,
   so a KWD shift 5 fils short stored its variance but posted nothing:
   GL cash and physical cash diverged invisibly, shift after shift.
   This spec posts a 0.005 KWD surplus and asserts the exact journal
   (Dr 1110 / Cr 7110), the shift update, and that an exactly-zero
   variance still posts nothing.

SCOPE NOTE (read before extending this spec): postCashierShiftVariance
consumes the shift's STORED expected_cash. The expected-cash COMPUTATION
(computeShiftExpectedCashFromShift and its helpers) still rounds its
components with the drawer service's private toMoney (2dp) and is NOT
fixed by this package -- see the package header. This spec therefore
seeds expected_cash directly and does not test the computation path.

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
import { computeCashDrawerVariance } from '../../src/modules/cash-drawer/helpers/cash-drawer.helper';

// --- Pure layer: variance at book precision, including float traps. ---
assert.equal(computeCashDrawerVariance(100.005, 100, 3), 0.005);
assert.equal(computeCashDrawerVariance(100.123, 100, 3), 0.123);
assert.equal(computeCashDrawerVariance(99.995, 100, 3), -0.005);
assert.equal(computeCashDrawerVariance(100.12, 100, 2), 0.12);
assert.equal(computeCashDrawerVariance(100, 100, 3), 0);

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
      CREATE TABLE cashier_shifts (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, location_id bigint,
        opened_by bigint, expected_cash numeric, counted_cash numeric, status text,
        closed_at timestamptz, closed_by bigint, variance_resolution text,
        variance_journal_entry_id bigint, variance_charged_to_user_id bigint,
        variance_approved_by bigint, variance_approved_at timestamptz, doc_no text);
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO settings VALUES ('t1','currency','KWD');
    `);
    for (const [code, type] of [
      [1110, 'asset'],
      [7110, 'revenue'],
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

    // Shift 1: KWD, expected 100, counted 100.005 -> surplus 0.005 posts.
    await pg.query(`INSERT INTO cashier_shifts
      (id, tenant_id, branch_id, location_id, opened_by, expected_cash, counted_cash,
       status, closed_at, closed_by, doc_no)
      VALUES (1,'t1',NULL,NULL,1,100,100.005,'closed','2026-10-20',1,'SHIFT-1')`);
    const res1 = await inTx((trx) => posting.postCashierShiftVariance(trx, 1, auth));
    assert.equal(res1.posted, true, 'a 0.005 KWD variance must post (old gate dropped it)');
    assert.deepEqual(await linesOf(Number(res1.journalEntryId)), [
      [1110, 0.005, 0],
      [7110, 0, 0.005],
    ]);
    const shift1 = await pg.query<{ variance_resolution: string; variance_journal_entry_id: string }>(
      'SELECT variance_resolution, variance_journal_entry_id FROM cashier_shifts WHERE id=1',
    );
    assert.equal(shift1.rows[0].variance_resolution, 'surplus_recognized');
    assert.equal(Number(shift1.rows[0].variance_journal_entry_id), Number(res1.journalEntryId));

    // Shift 2: exactly zero variance still posts nothing.
    await pg.query(`INSERT INTO cashier_shifts
      (id, tenant_id, branch_id, location_id, opened_by, expected_cash, counted_cash,
       status, closed_at, closed_by, doc_no)
      VALUES (2,'t1',NULL,NULL,1,50,50,'closed','2026-10-20',1,'SHIFT-2')`);
    const res2 = await inTx((trx) => posting.postCashierShiftVariance(trx, 2, auth));
    assert.equal(res2.posted, false);
    assert.equal(res2.journalEntryId, null);
    const count = await pg.query<{ count: string }>(
      `SELECT count(*) AS count FROM journal_entries WHERE source_type='cashier_shift_variance'`,
    );
    assert.equal(Number(count.rows[0].count), 1);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
