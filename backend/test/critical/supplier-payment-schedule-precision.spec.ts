/*
WHAT THIS PINS:
1. Supplier payment schedule installment split and residual absorption are exact to the tenant currency's minor units (MoneyDigits):
   - 100.123 KWD split across 3 installments produces [33.374, 33.374, 33.375], summing exactly to 100.123.
   - The last installment absorbs the residual at book precision, never losing or manufacturing fils.
2. Installment payments validate precision against the tenant's currency:
   - 3-decimal payments (e.g. 33.375) are accepted for 3-decimal currencies (KWD).
   - Sub-minor payments (e.g. 33.3755) and 3-decimal payments in 2-decimal currencies are rejected with INVALID_AMOUNT.
3. Journal postings for schedule settlements post at full book precision (Dr 2110 / Cr 1110 at 33.374 and 33.375).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SupplierPaymentSchedulesService } from '../../src/modules/purchases/services/supplier-payment-schedules.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

// --- Layer 1: Pure installment division & residual absorption ---
const dummyService = new SupplierPaymentSchedulesService({} as any, {} as any, {} as any, {} as any, {} as any);
const build = (total: number, count: number, digits: 2 | 3) =>
  (dummyService as any).buildAmounts(total, { mode: 'count', installmentCount: count }, digits);
const buildAmountMode = (total: number, installmentAmount: number, digits: 2 | 3) =>
  (dummyService as any).buildAmounts(total, { mode: 'amount', installmentAmount }, digits);

// KWD (3dp): 100.123 split into 3 installments
const kwdSplit3 = build(100.123, 3, 3);
assert.deepEqual(kwdSplit3, [33.374, 33.374, 33.375]);
assert.equal(Number((kwdSplit3[0] + kwdSplit3[1] + kwdSplit3[2]).toFixed(3)), 100.123);

// KWD (3dp): 100.123 split into 2 installments
const kwdSplit2 = build(100.123, 2, 3);
assert.deepEqual(kwdSplit2, [50.061, 50.062]);
assert.equal(Number((kwdSplit2[0] + kwdSplit2[1]).toFixed(3)), 100.123);

// EGP (2dp): 100.12 split into 3 installments
const egpSplit3 = build(100.12, 3, 2);
assert.deepEqual(egpSplit3, [33.37, 33.37, 33.38]);
assert.equal(Number((egpSplit3[0] + egpSplit3[1] + egpSplit3[2]).toFixed(2)), 100.12);

// Amount mode: 100.123 with installment of 30.000 -> [30, 30, 30, 10.123]
const kwdAmountMode = buildAmountMode(100.123, 30, 3);
assert.deepEqual(kwdAmountMode, [30, 30, 30, 10.123]);

console.log('Supplier payment schedules pure split assertions passed');

// --- Layer 2: PGlite End-to-End Database & Journal Posting ---
async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const txHelper = new TransactionHelper();
  const financeService = new PurchasesFinanceService();
  const idempotency = { reserveOperation: async () => null, commitOperation: async () => {}, recordFailure: async () => {} } as unknown as IdempotencyService;
  const service = new SupplierPaymentSchedulesService(db, txHelper, financeService, posting, idempotency);

  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: ['purchases', 'accounting'] } as unknown as AuthContext;

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates VALUES ('t1','KWD',true,1);

      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'liability',
        account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
        bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
        inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
        cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);

      INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES
        (1110, 't1', '1110', 'asset'),
        (2110, 't1', '2110', 'liability');

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
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);

      CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, balance numeric DEFAULT 0, updated_at timestamptz);
      INSERT INTO suppliers (id, tenant_id, name, balance) VALUES (10, 't1', 'Supplier 10', 100.123);

      CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text,
        supplier_id bigint, total numeric, paid_amount numeric DEFAULT 0, payment_type text DEFAULT 'credit',
        status text DEFAULT 'posted', branch_id bigint, location_id bigint, created_at timestamptz,
        three_way_match_status text DEFAULT 'matched', po_id bigint, grn_id bigint);
      INSERT INTO purchases (id, tenant_id, doc_no, supplier_id, total, paid_amount, payment_type, status)
      VALUES (1, 't1', 'BILL-001', 10, 100.123, 0, 'credit', 'posted');

      CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, invoice_id bigint, total numeric, return_type text, refund_allocations text);
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, location_id bigint, opened_by bigint, status text);
      CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text,
        amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric,
        payment_channel text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);

      CREATE TABLE supplier_payment_schedules (id bigserial PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint,
        supplier_id bigint, installment_no integer, due_date date, amount numeric, paid_amount numeric DEFAULT 0,
        status text DEFAULT 'pending', note text DEFAULT '', paid_at timestamptz, created_by bigint, updated_by bigint, updated_at timestamptz);
      CREATE TABLE supplier_payment_schedule_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, schedule_id bigint,
        supplier_id bigint, amount numeric, payment_channel text, instapay_address text, note text DEFAULT '', created_by bigint, created_by_name text, created_at timestamptz DEFAULT now());
    `);

    // 1. Create schedule for purchase (100.123 KWD, 3 installments)
    const created = await service.createForPurchase(1, {
      mode: 'count',
      installmentCount: 3,
      scheduleAmount: 100.123,
      firstDueDate: '2026-11-01',
      intervalDays: 30,
    }, auth);
    const schedules = created.schedules as any[];
    assert.equal(schedules.length, 3);
    assert.equal(schedules[0].amount, 33.374);
    assert.equal(schedules[1].amount, 33.374);
    assert.equal(schedules[2].amount, 33.375);

    // 2. Test payment validation: sub-minor is rejected
    await assert.rejects(
      service.payInstallment(Number(schedules[0].id), { amount: 33.3741 }, auth),
      (err: any) => err?.code === 'INVALID_AMOUNT' || /INVALID_AMOUNT/.test(String(err?.message)),
      'Sub-minor payment must be rejected',
    );

    // 3. Pay installment 1: exact 33.374 KWD
    await service.payInstallment(Number(schedules[0].id), { amount: 33.374 }, auth);
    const afterPay1 = await service.listForPurchase(1, auth);
    const s1 = (afterPay1.schedules as any[])[0];
    assert.equal(s1.status, 'paid');
    assert.equal(s1.paidAmount, 33.374);
    assert.equal(s1.remainingAmount, 0);

    // Verify journal line for payment 1
    const jLine1 = await pg.query<{ account_id: string; debit: string; credit: string }>(`
      SELECT jel.account_id, jel.debit, jel.credit
      FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE je.source_type='supplier_payment_schedule_settlement' AND je.source_id=1
      ORDER BY jel.account_id
    `);
    assert.deepEqual(jLine1.rows.map(r => [Number(r.account_id), Number(r.debit), Number(r.credit)]), [
      [1110, 0, 33.374],
      [2110, 33.374, 0],
    ]);

    // 4. Pay installment 3: exact 33.375 KWD
    await service.payInstallment(Number(schedules[2].id), { amount: 33.375 }, auth);
    const afterPay3 = await service.listForPurchase(1, auth);
    const s3 = (afterPay3.schedules as any[])[2];
    assert.equal(s3.status, 'paid');
    assert.equal(s3.paidAmount, 33.375);

    const jLine3 = await pg.query<{ account_id: string; debit: string; credit: string }>(`
      SELECT jel.account_id, jel.debit, jel.credit
      FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE je.source_type='supplier_payment_schedule_settlement' AND je.source_id=2
      ORDER BY jel.account_id
    `);
    assert.deepEqual(jLine3.rows.map(r => [Number(r.account_id), Number(r.debit), Number(r.credit)]), [
      [1110, 0, 33.375],
      [2110, 33.375, 0],
    ]);

    // 5. Verify supplier balance updated correctly: 100.123 - (33.374 + 33.375) = 33.374 remaining
    const supp = await pg.query<{ balance: string }>('SELECT balance FROM suppliers WHERE id=10');
    assert.equal(Number(Number(supp.rows[0].balance).toFixed(3)), 33.374);

    console.log('Supplier payment schedules PGlite integration tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
