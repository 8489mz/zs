/*
New file: backend/test/critical/cashier-shortage-tolerance.spec.ts

WHAT THIS PINS (INV-CASHIER-SHORTAGE-TOLERANCE-DEFAULT): when the
tenant has never configured cashierShortageTolerance, the default
tolerance is one minor unit — a dust shortage of a fils is absorbed
as an operating expense on 7210, not booked as an employee
receivable on 1135 that accumulates per cashier. Before this
package getCashierShortageTolerance defaulted to 0, so every fils
of shortage became a receivable. An explicitly configured value —
including 0 — is honoured exactly: configuring 0 still means zero
tolerance, with no silent override. Shortages above the tolerance
still charge the full amount to 1135, exactly as the code defines
it, and overages are unchanged.

WHAT IS DRIVEN: the real postCashierShiftVariance on PGlite (KWD
tenant, 3 book digits), asserting the exact journal lines, the
shift's variance_resolution, and the charged-to user per case. The
tolerance is varied between cases by writing the settings row, as
the production reader reads it fresh on every call.

NOT DRIVEN: any settings UI for the key (none exists — the key is
set directly in settings); live-Postgres acceptance (deferred by
written decision).
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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
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
      INSERT INTO users VALUES (2, 't1', NULL);
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
    for (const [code, type] of [[1110, 'asset'], [1135, 'asset'], [7110, 'revenue'], [7210, 'expense']] as const) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [code, 't1', String(code), type]);
    }

    const linesOf = async (entryId: number) => {
      const r = await pg.query<{ account_id: string; debit: string; credit: string; partner_type: string; partner_id: string }>(
        'SELECT account_id, debit, credit, partner_type, partner_id FROM journal_entry_lines WHERE journal_entry_id=$1 ORDER BY account_id', [entryId]);
      return r.rows.map((row) => [Number(row.account_id), Number(row.debit), Number(row.credit), row.partner_type, row.partner_id == null ? null : Number(row.partner_id)] as const);
    };
    const seedShift = async (id: number, expected: number, counted: number) => {
      await pg.query(`INSERT INTO cashier_shifts
        (id, tenant_id, branch_id, location_id, opened_by, expected_cash, counted_cash,
         status, closed_at, closed_by, doc_no)
        VALUES ($1,'t1',NULL,NULL,2,$2,$3,'closed','2026-10-20',1,$4)`, [id, expected, counted, `SHIFT-${id}`]);
    };
    const resolutionOf = async (id: number) => {
      const r = await pg.query<{ variance_resolution: string; variance_charged_to_user_id: string }>(
        'SELECT variance_resolution, variance_charged_to_user_id FROM cashier_shifts WHERE id=$1', [id]);
      return { resolution: r.rows[0].variance_resolution, chargedTo: r.rows[0].variance_charged_to_user_id == null ? null : Number(r.rows[0].variance_charged_to_user_id) };
    };
    const setTolerance = async (value: string | null) => {
      await pg.query(`DELETE FROM settings WHERE tenant_id='t1' AND key='cashierShortageTolerance'`);
      if (value !== null) await pg.query(`INSERT INTO settings VALUES ('t1','cashierShortageTolerance',$1)`, [value]);
    };

    // Case 1: tolerance UNSET (no row) — a one-minor-unit dust
    // shortage (0.001 KWD) is expensed to 7210, not charged.
    await seedShift(1, 100, 99.999);
    const res1 = await inTx((trx) => posting.postCashierShiftVariance(trx, 1, auth));
    assert.equal(res1.posted, true);
    assert.deepEqual(await linesOf(Number(res1.journalEntryId)), [[1110, 0, 0.001, 'none', null], [7210, 0.001, 0, 'none', null]]);
    assert.deepEqual(await resolutionOf(1), { resolution: 'within_tolerance', chargedTo: null });

    // Case 2: tolerance UNSET — a 0.005 shortage exceeds one minor
    // unit and charges the FULL amount to 1135 on the custodian.
    await seedShift(2, 100, 99.995);
    const res2 = await inTx((trx) => posting.postCashierShiftVariance(trx, 2, auth));
    assert.equal(res2.posted, true);
    assert.deepEqual(await linesOf(Number(res2.journalEntryId)), [[1110, 0, 0.005, 'none', null], [1135, 0.005, 0, 'employee', 2]]);
    assert.deepEqual(await resolutionOf(2), { resolution: 'charged_to_cashier', chargedTo: 2 });

    // Case 3: tolerance explicitly 0.01 — a 0.005 shortage is
    // absorbed, a 0.02 shortage is charged in full.
    await setTolerance('0.01');
    await seedShift(3, 100, 99.995);
    const res3 = await inTx((trx) => posting.postCashierShiftVariance(trx, 3, auth));
    assert.deepEqual(await linesOf(Number(res3.journalEntryId)), [[1110, 0, 0.005, 'none', null], [7210, 0.005, 0, 'none', null]]);
    assert.deepEqual(await resolutionOf(3), { resolution: 'within_tolerance', chargedTo: null });
    await seedShift(4, 100, 99.98);
    const res4 = await inTx((trx) => posting.postCashierShiftVariance(trx, 4, auth));
    assert.deepEqual(await linesOf(Number(res4.journalEntryId)), [[1110, 0, 0.02, 'none', null], [1135, 0.02, 0, 'employee', 2]]);
    assert.deepEqual(await resolutionOf(4), { resolution: 'charged_to_cashier', chargedTo: 2 });

    // Case 4: tolerance explicitly 0 — zero tolerance is honoured,
    // not silently overridden by the default: dust charges.
    await setTolerance('0');
    await seedShift(5, 100, 99.999);
    const res5 = await inTx((trx) => posting.postCashierShiftVariance(trx, 5, auth));
    assert.deepEqual(await linesOf(Number(res5.journalEntryId)), [[1110, 0, 0.001, 'none', null], [1135, 0.001, 0, 'employee', 2]]);
    assert.deepEqual(await resolutionOf(5), { resolution: 'charged_to_cashier', chargedTo: 2 });

    // Case 5: overages are unchanged by the tolerance.
    await setTolerance(null);
    await seedShift(6, 100, 100.005);
    const res6 = await inTx((trx) => posting.postCashierShiftVariance(trx, 6, auth));
    assert.deepEqual(await linesOf(Number(res6.journalEntryId)), [[1110, 0.005, 0, 'none', null], [7110, 0, 0.005, 'none', null]]);
    assert.deepEqual(await resolutionOf(6), { resolution: 'surplus_recognized', chargedTo: null });

    // Invariant pin: the entry exists exactly once and is last.
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-CASHIER-SHORTAGE-TOLERANCE-DEFAULT').length - 1, 1, 'the invariant entry must exist exactly once');
    const lastLine = invariants.trimEnd().split('\n').pop() || '';
    assert.ok(lastLine.includes('INV-CASHIER-SHORTAGE-TOLERANCE-DEFAULT'), 'the invariant entry must be the last line');

    console.log('Cashier shortage tolerance tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
