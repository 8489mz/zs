/*
 * INV-INSTALLMENT-PAYMENT-CHANNEL: an installment paid by bank
 * transfer / card / InstaPay must be recorded and posted on its
 * real channel, not as cash.
 *
 * THE DEFECT (delivery-reps review B4, re-verified at 629aa2bb):
 * payInstallment wrote the payment method into the installment row
 * ONLY. The customer_payments insert carried no payment_channel
 * (so it defaulted to 'cash' per migration 0251) and the treasury
 * call carried no channel either, so postCustomerPayment read
 * 'cash' and debited 1110. A bank-transfer installment was recorded
 * and posted as CASH — the drawer overstated, the bank understated,
 * phantom cash at drawer settlement.
 *
 * THE FIX (prospective only):
 * - The installment's method is carried as payment_channel into
 *   the customer_payments row AND into the treasury row, so the
 *   journal debits the right account (1120 for non-cash, 1110 for
 *   cash). 'bank_transfer' maps to 'bank': the 0251 CHECK allows
 *   only cash/bank/card/wallet/instapay, so writing 'bank_transfer'
 *   would violate the constraint.
 * - A missing or unknown method fails closed with a named error
 *   instead of silently defaulting to cash — that silent default
 *   IS the defect. The only in-repo caller (InstallmentsPage)
 *   always sends a method (state defaults to 'cash').
 * - A non-cash installment needs a transfer reference of at least
 *   3 characters (same bar as the general-receipt gate,
 *   INV-REP-NONCASH-EVIDENCE-GATE): without it the payment is
 *   refused before anything is written, and postCustomerPayment
 *   re-checks the stored reference itself. A note alone is not
 *   evidence. Cash stores NULL for the reference.
 *
 * WHAT THIS PINS, driving the REAL CustomerInstallmentsService and
 * the REAL AccountingPostingService on PGlite (fresh database per
 * case):
 * - bank_transfer + reference stores channel 'bank' + the trimmed
 *   reference, the treasury row carries 'bank', and the journal
 *   debits 1120 (not 1110) / credits 1130.
 * - card / instapay + reference store their channel and also post
 *   Dr 1120.
 * - cash still stores channel 'cash' + NULL reference, the treasury
 *   row carries 'cash', and the journal debits 1110.
 * - bank_transfer WITHOUT a reference is refused with
 *   NONCASH_RECEIPT_REFERENCE_REQUIRED and nothing is written or
 *   posted; the installment stays pending.
 * - a missing method is refused with
 *   INSTALLMENT_PAYMENT_METHOD_REQUIRED and an unknown method with
 *   INSTALLMENT_PAYMENT_METHOD_INVALID, both writing nothing.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { CustomerInstallmentsService } from '../../src/modules/sales/services/customer-installments.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';

const TENANT = 't1';
const ACCOUNT = 'a1';

const ADMIN = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: [], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, payment_channel text, instapay_address text, transfer_reference text, transfer_receipt_url text, note text, branch_id bigint, location_id bigint, job_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_installment_plans (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_number text, sale_id bigint, customer_id bigint, total_amount numeric, down_payment numeric, financed_amount numeric, interest_rate_percent numeric, interest_amount numeric, total_with_interest numeric, installment_count int, monthly_amount numeric, start_date date, status text, notes text, branch_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_installments (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_id bigint, sale_id bigint, customer_id bigint, installment_number int, due_date date, amount numeric, paid_amount numeric DEFAULT 0, status text, payment_method text, receipt_no text, notes text, paid_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  for (const [id, code] of [
    [1110, '1110'], [1120, '1120'], [1130, '1130'], [2110, '2110'],
  ] as Array<[number, string]>) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, supplier_payable_account_id: 2110,
  }).execute();
  await anyDb.insertInto('customers').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'عميل اختبار', phone: '010',
    balance: 500, credit_limit: 0, is_credit_blocked: false, store_credit_balance: 0,
    loyalty_points: 0, is_active: true,
  }).execute();
  await anyDb.insertInto('customer_installment_plans').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, plan_number: 'PLAN-1', customer_id: 1,
    total_amount: 100, down_payment: 0, financed_amount: 100, interest_rate_percent: 0,
    interest_amount: 0, total_with_interest: 100, installment_count: 1, monthly_amount: 100,
    start_date: '2026-11-05', status: 'active', created_by: 1,
  }).execute();
  await anyDb.insertInto('customer_installments').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, plan_id: 1, customer_id: 1,
    installment_number: 1, due_date: '2026-11-05', amount: 100, paid_amount: 0,
    status: 'pending', payment_method: 'cash',
  }).execute();
}

function buildService(db: Kysely<Database>): CustomerInstallmentsService {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  return new CustomerInstallmentsService(db, new TransactionHelper(), new SalesFinanceService(db), posting as any);
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM ${sql.raw(table)}`.execute(db);
  return Number(rows.rows[0]?.n || 0);
}

async function journalDebitAccount(db: Kysely<Database>): Promise<number> {
  const anyDb = db as any;
  const lines = await anyDb.selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit']).execute();
  assert.equal(lines.length, 2);
  const debit = lines.find((l: any) => Number(l.debit) > 0);
  const credit = lines.find((l: any) => Number(l.credit) > 0);
  assert.equal(Number(debit.debit), 100);
  assert.equal(Number(credit.account_id), 1130);
  assert.equal(Number(credit.credit), 100);
  return Number(debit.account_id);
}

async function main(): Promise<void> {
  // 1. Bank transfer + reference: channel 'bank', treasury 'bank', Dr 1120.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const service = buildService(db);
      const result = await service.payInstallment(
        1, { amount: 100, paymentMethod: 'bank_transfer', transferReference: '  TRX-987654  ' }, ADMIN,
      );
      assert.equal((result as any).success, true);
      const payment = await anyDb.selectFrom('customer_payments')
        .select(['payment_channel', 'transfer_reference', 'amount']).executeTakeFirstOrThrow();
      assert.equal(payment.payment_channel, 'bank');
      assert.equal(payment.transfer_reference, 'TRX-987654');
      assert.equal(Number(payment.amount), 100);
      const treasury = await anyDb.selectFrom('treasury_transactions')
        .select(['payment_channel', 'amount']).executeTakeFirstOrThrow();
      assert.equal(treasury.payment_channel, 'bank');
      assert.equal(Number(treasury.amount), 100);
      assert.equal(await journalDebitAccount(db), 1120);
      const installment = await anyDb.selectFrom('customer_installments')
        .select(['status', 'payment_method', 'paid_amount']).where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(installment.status, 'paid');
      assert.equal(installment.payment_method, 'bank_transfer');
      assert.equal(Number(installment.paid_amount), 100);
    } finally {
      await db.destroy();
    }
    console.log('  bank_transfer installment posts Dr 1120 with channel bank passed');
  }

  // 2. Card and InstaPay + reference: their channel, also Dr 1120.
  for (const method of ['card', 'instapay'] as const) {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const service = buildService(db);
      await service.payInstallment(1, { amount: 100, paymentMethod: method, transferReference: 'REF-123' }, ADMIN);
      const payment = await anyDb.selectFrom('customer_payments')
        .select(['payment_channel', 'transfer_reference']).executeTakeFirstOrThrow();
      assert.equal(payment.payment_channel, method);
      assert.equal(payment.transfer_reference, 'REF-123');
      const treasury = await anyDb.selectFrom('treasury_transactions')
        .select(['payment_channel']).executeTakeFirstOrThrow();
      assert.equal(treasury.payment_channel, method);
      assert.equal(await journalDebitAccount(db), 1120);
    } finally {
      await db.destroy();
    }
    console.log(`  ${method} installment posts Dr 1120 with its channel passed`);
  }

  // 3. Cash is unchanged: channel 'cash', NULL reference, Dr 1110.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const service = buildService(db);
      const result = await service.payInstallment(1, { amount: 100, paymentMethod: 'cash' }, ADMIN);
      assert.equal((result as any).success, true);
      const payment = await anyDb.selectFrom('customer_payments')
        .select(['payment_channel', 'transfer_reference', 'amount']).executeTakeFirstOrThrow();
      assert.equal(payment.payment_channel, 'cash');
      assert.equal(payment.transfer_reference, null);
      const treasury = await anyDb.selectFrom('treasury_transactions')
        .select(['payment_channel']).executeTakeFirstOrThrow();
      assert.equal(treasury.payment_channel, 'cash');
      assert.equal(await journalDebitAccount(db), 1110);
      const installment = await anyDb.selectFrom('customer_installments')
        .select(['status', 'payment_method']).where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(installment.status, 'paid');
      assert.equal(installment.payment_method, 'cash');
    } finally {
      await db.destroy();
    }
    console.log('  cash installment still posts Dr 1110 with channel cash passed');
  }

  // 4. Bank transfer WITHOUT a reference is refused; nothing written.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const service = buildService(db);
      await assert.rejects(
        () => service.payInstallment(1, { amount: 100, paymentMethod: 'bank_transfer' }, ADMIN),
        (err: any) => err.code === 'NONCASH_RECEIPT_REFERENCE_REQUIRED'
          && String(err.message || '').includes('transfer reference'),
      );
      assert.equal(await countRows(db, 'customer_payments'), 0);
      assert.equal(await countRows(db, 'treasury_transactions'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
      assert.equal(await countRows(db, 'customer_ledger'), 0);
      const installment = await anyDb.selectFrom('customer_installments')
        .select(['status', 'paid_amount']).where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(installment.status, 'pending');
      assert.equal(Number(installment.paid_amount), 0);
    } finally {
      await db.destroy();
    }
    console.log('  bank_transfer without a reference is refused with nothing written passed');
  }

  // 5. A missing method fails closed instead of defaulting to cash.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const service = buildService(db);
      await assert.rejects(
        () => service.payInstallment(1, { amount: 100 } as any, ADMIN),
        (err: any) => err.code === 'INSTALLMENT_PAYMENT_METHOD_REQUIRED',
      );
      assert.equal(await countRows(db, 'customer_payments'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
    } finally {
      await db.destroy();
    }
    console.log('  missing payment method fails closed with INSTALLMENT_PAYMENT_METHOD_REQUIRED passed');
  }

  // 6. An unknown method fails closed instead of defaulting to cash.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const service = buildService(db);
      await assert.rejects(
        () => service.payInstallment(1, { amount: 100, paymentMethod: 'cheque' } as any, ADMIN),
        (err: any) => err.code === 'INSTALLMENT_PAYMENT_METHOD_INVALID',
      );
      assert.equal(await countRows(db, 'customer_payments'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
    } finally {
      await db.destroy();
    }
    console.log('  unknown payment method fails closed with INSTALLMENT_PAYMENT_METHOD_INVALID passed');
  }

  // Source pins: the channel travels on both rows, the DTO declares
  // the reference, and the method validation fails closed.
  const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/customer-installments.service.ts'), 'utf8');
  assert.ok(serviceSource.includes('payment_channel: paymentChannel'), 'the customer_payments insert must carry the channel');
  assert.ok(serviceSource.includes('transfer_reference: transferReference'), 'the customer_payments insert must carry the transfer reference');
  assert.ok(serviceSource.includes('INSTALLMENT_PAYMENT_METHOD_REQUIRED'), 'a missing method must fail closed with a named error');
  assert.ok(serviceSource.includes('INSTALLMENT_PAYMENT_METHOD_INVALID'), 'an unknown method must fail closed with a named error');
  assert.ok(serviceSource.includes("bank_transfer: 'bank'"), "bank_transfer must map to the 'bank' channel the 0251 CHECK allows");
  const financeSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/sales-finance.service.ts'), 'utf8');
  assert.ok(financeSource.includes('payment_channel: paymentChannel'), 'the treasury insert must carry the channel');
  const dtoSource = readFileSync(resolve(__dirname, '../../src/modules/sales/dto/customer-installment.dto.ts'), 'utf8');
  assert.ok(dtoSource.includes('transferReference?: string'), 'the pay-installment DTO must declare transferReference');

  console.log('installment-payment-channel: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

// Source pins are checked inside main() after the cases, in the
// same shape as installment-first-due-date.spec.ts.
