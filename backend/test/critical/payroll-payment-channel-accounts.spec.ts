/*
New file: backend/test/critical/payroll-payment-channel-accounts.spec.ts
Pins the payroll payment channel map (INV-PAYROLL-PAYMENT-CHANNEL-ACCOUNTS).

THE GAP: the whole-run and per-item payroll payment postings mapped
the payment channel to different accounts. postPayrollPayment sent
only 'cash' to cash 1110 and EVERYTHING else — including 'drawer'
— to bank 1120, while postPayrollItemPayment sent 'bank' to 1120
and everything else to 1110. Paying a whole run from the cashier
drawer therefore decremented the drawer (payPayrollRun moves the
cash and records a treasury cash_out) while the journal credited
bank 1120 — money the bank never paid. The DTOs allow exactly
'cash', 'bank', 'drawer' on both endpoints, and 'drawer' is the
frontend default.

THE RULE: 'bank' pays from 1120; 'cash' and 'drawer' pay from
cash 1110 — in both postings, identically.

WHAT THIS PINS, driving the REAL postPayrollPayment and
postPayrollItemPayment on PGlite (EGP tenant, approved items):
- whole-run 'drawer' -> 2140 debit / 1110 credit, zero on 1120.
- whole-run 'cash' -> 1110; whole-run 'bank' -> 1120.
- per-item 'drawer' / 'cash' -> 1110; per-item 'bank' -> 1120.
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

async function main(): Promise<void> {
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
        allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '', is_control_account boolean DEFAULT false,is_receivable boolean DEFAULT false,is_payable boolean DEFAULT false,is_inventory boolean DEFAULT false, account_type text DEFAULT '');
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
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, run_id bigint, employee_id bigint,
        gross_pay numeric, net_pay numeric, deduction_amount numeric, loan_deduction_amount numeric,
        asset_recovery_deduction_amount numeric, employee_social_insurance numeric,
        employer_social_insurance numeric, income_tax numeric, status text);
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
    `);
    for (const code of [1110, 1120, 2140]) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [
        code,
        't1',
        String(code),
        '',
      ]);
    }
    // Whole-run drives: one approved item per run.
    await pg.exec(`
      INSERT INTO hr_payroll_run_items (id, tenant_id, run_id, employee_id, net_pay, status) VALUES
        (1,'t1',7,3,150,'approved'),
        (2,'t1',8,3,150,'approved'),
        (3,'t1',9,3,150,'approved'),
        (11,'t1',17,3,100,'approved'),
        (12,'t1',18,3,100,'approved'),
        (13,'t1',19,3,100,'approved');
    `);
    const amount = async (id: number, code: number, side: 'debit' | 'credit') => {
      const rows = await pg.query<{ amount: string }>(
        `SELECT coalesce(sum(${side}),0) AS amount FROM journal_entry_lines WHERE journal_entry_id=$1 AND account_id=$2`,
        [id, code],
      );
      return Number(rows.rows[0].amount);
    };

    const drawerRun = await inTx((trx) => posting.postPayrollPayment(trx, 7, 'drawer', auth));
    assert.equal(drawerRun.posted, true);
    assert.equal(await amount(drawerRun.journalEntryId!, 2140, 'debit'), 150);
    assert.equal(await amount(drawerRun.journalEntryId!, 1110, 'credit'), 150);
    assert.equal(await amount(drawerRun.journalEntryId!, 1120, 'credit'), 0);

    const cashRun = await inTx((trx) => posting.postPayrollPayment(trx, 8, 'cash', auth));
    assert.equal(await amount(cashRun.journalEntryId!, 1110, 'credit'), 150);
    assert.equal(await amount(cashRun.journalEntryId!, 1120, 'credit'), 0);

    const bankRun = await inTx((trx) => posting.postPayrollPayment(trx, 9, 'bank', auth));
    assert.equal(await amount(bankRun.journalEntryId!, 1120, 'credit'), 150);
    assert.equal(await amount(bankRun.journalEntryId!, 1110, 'credit'), 0);

    const drawerItem = await inTx((trx) => posting.postPayrollItemPayment(trx, 11, 'drawer', auth));
    assert.equal(await amount(drawerItem.journalEntryId!, 1110, 'credit'), 100);
    assert.equal(await amount(drawerItem.journalEntryId!, 1120, 'credit'), 0);

    const cashItem = await inTx((trx) => posting.postPayrollItemPayment(trx, 12, 'cash', auth));
    assert.equal(await amount(cashItem.journalEntryId!, 1110, 'credit'), 100);

    const bankItem = await inTx((trx) => posting.postPayrollItemPayment(trx, 13, 'bank', auth));
    assert.equal(await amount(bankItem.journalEntryId!, 1120, 'credit'), 100);
    assert.equal(await amount(bankItem.journalEntryId!, 1110, 'credit'), 0);

    console.log('Payroll payment channel accounts tests passed.');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
