/*
New file: backend/test/critical/posting-book-precision.spec.ts
PGlite spec (no duplicated formulas): drives production posting methods
on a KWD tenant (3 book digits) and asserts exact 3dp journal amounts.

WHAT THIS PINS: the repo-wide bare-toMoney remainder in the posting
service (INV-POSTING-BOOK-PRECISION). Before this package, thirteen
posting methods rounded every amount through the private toMoney
default (2dp) AND through addLine's default digits (2dp), so on a
3-decimal tenant a KWD amount of 10.125 was journalled as 10.13 — a
phantom 0.005 on every payroll payment, loan, van settlement, opening
balance and installment interest posting. insertPostedJournal's own
bookDigits normalisation could not recover amounts already truncated
upstream, exactly as the PDC case in the treasury package.

The package threads tenant bookDigits through all thirteen methods
(the same toBookMoney/addBookLine shape the fortified methods already
use) and moves the two hard-coded 0.01 tolerances (delivery-rep fee
reconciliation, van-trip variance) to one minor unit. This spec drives
five of the thirteen methods end-to-end — opening balance, payroll
item payment, van field collection, van trip settlement, installment
interest — because those five need only small fixtures; the other
eight use the identical, mechanically applied pattern (same two-line
insert, same toMoney/addLine substitution, verified by tsc and by
the absence of any bare toMoney call left in the posting service).
The van-trip case also pins the tolerance change: a 0.005 overage,
invisible under the old 0.01 threshold, is now journalled to 7100.
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
        name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
        allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '',
        is_control_account boolean DEFAULT false,is_receivable boolean DEFAULT false,is_payable boolean DEFAULT false,is_inventory boolean DEFAULT false, account_type text DEFAULT '');
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
        bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
        inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
        cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
        period_number int, start_date date, end_date date);
      CREATE TABLE accounting_fiscal_years (id bigint PRIMARY KEY, tenant_id text, status text, closing_entry_id bigint);
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
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates VALUES ('t1','KWD',true,1);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE customer_ledger (tenant_id text, customer_id bigint, amount numeric, reference_type text, reference_id bigint, entry_type text);
      CREATE TABLE supplier_ledger (tenant_id text, account_id text, supplier_id bigint, entry_type text,
        amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      CREATE TABLE customers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0);
      INSERT INTO customers VALUES (25,'t1','Customer 25',0);
      CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, run_id bigint, employee_id bigint, net_pay numeric, status text);
      INSERT INTO hr_payroll_run_items VALUES (1,'t1',7,3,33.125,'approved');
      CREATE TABLE customer_installment_plans (id bigint PRIMARY KEY, tenant_id text, plan_number text, customer_id bigint, financed_amount numeric, interest_amount numeric, branch_id bigint, created_by bigint, created_at timestamptz);
      INSERT INTO customer_installment_plans VALUES (1,'t1','P1',25,100,7.125,NULL,1,'2026-10-01');
      CREATE TABLE customer_installments (id bigint PRIMARY KEY, tenant_id text, plan_id bigint, installment_number int, amount numeric, due_date date);
      -- Payments sum to principal + interest at book precision
      -- (100 + 7.125), as the installment-interest engine now reconciles
      -- in the tenant's minor units (INV-INSTALLMENT-INTEREST-PRECISION).
      INSERT INTO customer_installments VALUES (1,'t1',1,1,53.562,'2026-11-01');
      INSERT INTO customer_installments VALUES (2,'t1',1,2,53.563,'2026-12-01');
      CREATE TABLE accounting_installment_interest (id bigserial PRIMARY KEY, tenant_id text, plan_id bigint, installment_id bigint, recognition_date date, amount numeric, account_id text, journal_entry_id bigint, UNIQUE(tenant_id, installment_id));
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
    `);
    const accountTypes: Record<number, string> = { 2155: 'liability', 3200: 'equity' };
    for (const code of [1110, 1120, 1130, 1140, 2110, 2140, 2155, 3200, 4100, 5100, 7100, 7290]) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [
        code,
        't1',
        String(code),
        accountTypes[code] || '',
      ]);
    }
    const amount = async (id: number, code: number, side: 'debit' | 'credit') => {
      const rows = await pg.query<{ amount: string }>(
        `SELECT coalesce(sum(${side}),0) AS amount FROM journal_entry_lines WHERE journal_entry_id=$1 AND account_id=$2`,
        [id, code],
      );
      return Number(rows.rows[0].amount);
    };

    // 1. Opening balance: 10.125 stays 10.125 (old: 10.13).
    const opening = await inTx((trx) => posting.postCustomerOpeningBalance(trx, 25, 10.125, auth));
    assert.equal(await amount(opening.journalEntryId!, 1130, 'debit'), 10.125);
    assert.equal(await amount(opening.journalEntryId!, 3200, 'credit'), 10.125);

    // 2. Payroll item payment: net pay 33.125 stays 33.125 (old: 33.13).
    const payroll = await inTx((trx) => posting.postPayrollItemPayment(trx, 1, 'cash', auth));
    assert.equal(await amount(payroll.journalEntryId!, 2140, 'debit'), 33.125);
    assert.equal(await amount(payroll.journalEntryId!, 1110, 'credit'), 33.125);

    // 3. Van field collection: 20.125 stays 20.125 (old: 20.13).
    const collection = await inTx((trx) =>
      posting.postVanFieldCollection(
        trx,
        1,
        { amount: 20.125, customerId: 25, branchId: null, locationId: null, paymentMethod: 'cash' },
        auth,
      ),
    );
    assert.equal(await amount(collection.journalEntryId!, 1130, 'debit'), 20.125);
    assert.equal(await amount(collection.journalEntryId!, 1130, 'credit'), 20.125);

    // 4. Van trip settlement: expected 50.125, counted 50.13. The 0.005
    // overage is journalled to 7100 (old: invisible under the 0.01
    // threshold, and both legs rounded to 50.13).
    const trip = await inTx((trx) =>
      posting.postVanTripSettlement(
        trx,
        1,
        { expectedCash: 50.125, countedCash: 50.13, branchId: null, locationId: null },
        auth,
      ),
    );
    assert.equal(await amount(trip.journalEntryId!, 1130, 'credit'), 50.125);
    assert.equal(await amount(trip.journalEntryId!, 1110, 'debit'), 50.13);
    assert.equal(await amount(trip.journalEntryId!, 7100, 'credit'), 0.005);

    // 5. Installment interest: 7.125 stays 7.125 (old: 7.13).
    // Since INV-INSTALLMENT-INTEREST-PRECISION, the allocation rows
    // created here also sum to exactly 7.125 at book precision, so
    // recognition can no longer over-release the 2155 deferred balance.
    const interest = await inTx((trx) => posting.postCustomerInstallmentInterest(trx, 1, auth));
    assert.equal(await amount(interest.journalEntryId!, 1130, 'debit'), 7.125);
    assert.equal(await amount(interest.journalEntryId!, 2155, 'credit'), 7.125);
    const allocated = await pg.query<{ total: string }>(
      `SELECT coalesce(sum(amount),0) AS total FROM accounting_installment_interest WHERE tenant_id='t1' AND plan_id=1`,
    );
    assert.equal(Number(allocated.rows[0].total), 7.125);

    console.log('Posting book precision tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
