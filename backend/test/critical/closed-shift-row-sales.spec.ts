/*
New file: backend/test/critical/closed-shift-row-sales.spec.ts

WHAT THIS PINS (INV-CLOSED-SHIFT-ROW): a closed shift row in the
cash-drawer listing shows the shift's REAL sales and the correct
difference. Before this package the listing hydrated (live-computed
sales, services, movements, returns) only rows with status 'open';
closed and pending_review rows were returned as the raw database row,
and the raw SELECT does not even select the sales-total columns, so
mapCashDrawerShiftRow mapped them to 0 — sales 0.00 on a shift that
closed with real sales. The frontend variance column then recomputed
expected cash from the zeroed cash sales, so the counted cash
exceeded the understated expected cash by exactly the cash sales
(the reported +625.80). The stored variance column was correct all
along; only the row's sales figures were missing.

WHAT IS DRIVEN: the real closeCashierShift + reviewCashierShiftClose
+ listCashierShifts on PGlite (KWD tenant, 3 book digits), with the
real sales breakdown. A cash sale 625.80 + a card sale 200.00 inside
one shift, opening cash 100, counted cash 725.80 at close.

NOT DRIVEN: the frontend card (it renders whatever the listing
returns; this package gives it the real figures — the spec
recomputes the card's own difference formula from the returned row
fields); live-Postgres acceptance (deferred by written decision).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const TENANT = 't1';
const ACCOUNT = 'a1';
const PASSWORD = 'cashier-pw-1';
const SHIFT_AT = '2026-01-01T00:00:00.000Z';

const cashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec', username: 'cashier-a', role: 'cashier',
  permissions: [], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const managerAuth: AuthContext = {
  userId: 3, sessionId: 'spec', username: 'manager', role: 'manager',
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
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, normal_balance text, is_cash_bank boolean, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigint PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customer_payments (id bigint PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, request_key text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, updated_at timestamptz, variance_resolution text, variance_journal_entry_id bigint, variance_charged_to_user_id bigint, variance_approved_by bigint, variance_approved_at timestamptz);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: '"KWD"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'KWD', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'cashier-a', role: 'cashier', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 3, tenant_id: TENANT, username: 'manager', role: 'manager', is_active: true }).execute();
  const record = await createPasswordRecord(PASSWORD);
  await anyDb.updateTable('users').set({ password_hash: record.hash, password_salt: record.salt }).where('id', '=', 2).execute();
  const accounts: Array<[number, string, string, string, boolean]> = [
    [1110, '1110', 'asset', 'debit', true], [1120, '1120', 'asset', 'debit', true],
    [1130, '1130', 'asset', 'debit', false], [1140, '1140', 'asset', 'debit', false],
    [4100, '4100', 'income', 'credit', false], [5100, '5100', 'expense', 'debit', false],
    [7100, '7100', 'income', 'credit', false], [7210, '7210', 'expense', 'debit', false],
  ];
  for (const [id, code, type, balance, cashBank] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, name_en: code, account_type: type, normal_balance: balance, is_cash_bank: cashBank, is_active: true, is_tax: false, account_group: 'g' }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, cash_account_id: 1110, bank_account_id: 1120, customer_receivable_account_id: 1130, inventory_account_id: 1140, sales_revenue_account_id: 4100, cogs_account_id: 5100 }).execute();
}

/**
 * The row's displayed difference, recomputed exactly as
 * CashDrawerShiftsCard does: counted cash minus the expected cash
 * derived from the row's own figures (opening + cash sales +
 * service cash + drawer cash-ins − drawer cash-outs). With the
 * defect the row's cash sales were 0, so this came out +625.80.
 */
function rowDisplayedDifference(row: Record<string, number>): number {
  const openingCash = Number(row.openingCash || 0);
  const cashSales = Number(row.cashSalesTotal || 0) + Number(row.serviceCashTotal || 0);
  const deliveryIn = Number(row.cashDrawerDeliveryCashInTotal || 0);
  const manualIn = Number(row.cashDrawerManualCashInTotal || 0);
  const totalOut = Number(row.cashDrawerCashOutTotal || 0)
    + Number(row.expensesTotal || 0)
    + Number(row.supplierPaymentsTotal || 0)
    + Number(row.saleReturnCashRefundTotal || 0);
  const dynamicExpectedCash = openingCash + cashSales + manualIn + deliveryIn - totalOut;
  return Number(row.countedCash || 0) - dynamicExpectedCash;
}

async function listRow(drawer: CashDrawerService, shiftId: number): Promise<any> {
  const listing = await drawer.listCashierShifts({}, managerAuth) as any;
  const row = (listing.cashierShifts as any[]).find((r) => Number(r.id) === shiftId);
  assert.ok(row, `shift ${shiftId} must be listed`);
  return row;
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  try {
    await seedFoundation(db);
    const anyDb = db as any;

    // Shift 1: opening cash 100; a cash sale 625.80 and a card sale
    // 200.00 inside the shift window, both posted by the opener.
    await anyDb.insertInto('cashier_shifts').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'SHIFT-1', opened_by: 2, status: 'open', branch_id: null, location_id: null, opening_cash: 100, expected_cash: 100, created_at: SHIFT_AT }).execute();
    await anyDb.insertInto('sales').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, status: 'posted', created_by: 2, created_at: '2026-01-01T10:00:00.000Z', total: 625.80, paid_amount: 625.80, payment_channel: 'cash' }).execute();
    await anyDb.insertInto('sale_payments').values({ tenant_id: TENANT, account_id: ACCOUNT, sale_id: 1, payment_channel: 'cash', amount: 625.80 }).execute();
    await anyDb.insertInto('sales').values({ id: 2, tenant_id: TENANT, account_id: ACCOUNT, status: 'posted', created_by: 2, created_at: '2026-01-01T11:00:00.000Z', total: 200, paid_amount: 200, payment_channel: 'card' }).execute();
    await anyDb.insertInto('sale_payments').values({ tenant_id: TENANT, account_id: ACCOUNT, sale_id: 2, payment_channel: 'card', amount: 200 }).execute();

    // Case 1 — pending_review: the cashier closes with the exact
    // counted cash (100 opening + 625.80 cash sales). The row must
    // already show the real sales, not 0.00.
    await drawer.closeCashierShift(1, {
      countedCash: 725.80,
      cardDeclaredTotal: 200,
      cardOperationCount: 1,
      cardDetails: [{ amount: 200, reference: 'AUTH-1' }],
      walletDeclaredTotal: 0,
      walletOperationCount: 0,
      instapayDeclaredTotal: 0,
      instapayOperationCount: 0,
      managerPin: PASSWORD,
    }, cashierAuth);

    const pendingRow = await listRow(drawer, 1);
    assert.equal(pendingRow.status, 'pending_review');
    assert.equal(pendingRow.shiftSalesTotal, 825.8);
    assert.equal(pendingRow.cashSalesTotal, 625.8);
    assert.equal(pendingRow.cardSalesTotal, 200);
    assert.equal(pendingRow.saleCount, 2);
    assert.equal(pendingRow.expectedCash, 725.8);
    assert.equal(pendingRow.countedCash, 725.8);
    assert.equal(pendingRow.variance, 0);
    assert.equal(rowDisplayedDifference(pendingRow), 0);

    // Case 2 — closed: after manager review the same row keeps the
    // real sales and the correct difference (0, not +625.80).
    await drawer.reviewCashierShiftClose(1, { note: 'reviewed' }, managerAuth);
    const closedRow = await listRow(drawer, 1);
    assert.equal(closedRow.status, 'closed');
    assert.equal(closedRow.shiftSalesTotal, 825.8);
    assert.equal(closedRow.cashSalesTotal, 625.8);
    assert.equal(closedRow.cardSalesTotal, 200);
    assert.equal(closedRow.saleCount, 2);
    assert.equal(closedRow.expectedCash, 725.8);
    assert.equal(closedRow.countedCash, 725.8);
    assert.equal(closedRow.variance, 0);
    assert.equal(rowDisplayedDifference(closedRow), 0);

    // Case 3 — open shift unchanged: a still-open shift keeps
    // showing its live sales exactly as before.
    await anyDb.insertInto('cashier_shifts').values({ id: 2, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'SHIFT-2', opened_by: 2, status: 'open', branch_id: null, location_id: null, opening_cash: 0, expected_cash: 0, created_at: '2026-01-02T00:00:00.000Z' }).execute();
    await anyDb.insertInto('sales').values({ id: 3, tenant_id: TENANT, account_id: ACCOUNT, status: 'posted', created_by: 2, created_at: '2026-01-02T10:00:00.000Z', total: 50, paid_amount: 50, payment_channel: 'cash' }).execute();
    await anyDb.insertInto('sale_payments').values({ tenant_id: TENANT, account_id: ACCOUNT, sale_id: 3, payment_channel: 'cash', amount: 50 }).execute();
    const openRow = await listRow(drawer, 2);
    assert.equal(openRow.status, 'open');
    assert.equal(openRow.shiftSalesTotal, 50);
    assert.equal(openRow.cashSalesTotal, 50);

    console.log('Closed-shift row sales tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
