/*
New file: backend/test/critical/import-container-deposit.spec.ts
Pins container-deposit recording through the real recordContainerDeposit
(INV-IMPORT-CONTAINER-DEPOSIT, I3-D8).

WHAT WAS WRONG (live trial phase 2, problem D8): the deposit form
always failed with the generic "فشل إثبات التأمين: البيانات المدخلة
غير صحيحة." — 5 attempts, MSCU-TEST-001/002, 100 EGP, return date
12/20/2026, treasury account set and unset. No deposit, no JE.
Root cause (grounded, NOT the bank-role check): the record mutation
sent `idempotencyKey` (always generated) and `receiptNo`, fields the
RecordContainerDepositDto does not declare, so the global whitelist +
forbidNonWhitelisted validation pipe rejected every request before
the service ran — identically with the treasury account set or unset.
The pipe names the field ("الحقل idempotencyKey غير مسموح إرساله.")
but the frontend error mapper replaced every VALIDATION_ERROR with
the generic code text (pinned by
frontend/src/lib/__tests__/api-error-message.test.ts). A second,
latent trap in the same form: the treasury dropdown offered parent
current-asset accounts (e.g. 1100 "الأصول المتداولة", isCashBank
false) that the backend 'bank' role rejects.

WHAT THIS PINS, driving the real recordContainerDeposit on PGlite
through the real posting boundary:
- Valid deposit, trial shape (100 EGP, MSCU-TEST-001, return
  2026-12-20, treasury account set): deposit row recorded pending
  + one balanced JE Dr container-deposit asset 1180 / Cr bank 1120
  + one treasury row of -100.
- Valid deposit, treasury account unset: resolves the bank through
  accounting_settings and posts the same JE shape.
- Invalid amount (0): rejects naming the amount rule.
- Unknown shipment: rejects naming the shipment/project mismatch.
- Treasury account = parent 1100 (not a cash/bank account):
  rejects naming the account id and the (bank) role.
- No container-deposit account configured (no 1180/1182/1240):
  rejects naming the (container_deposit) role instead of posting
  to a wrong account or skipping the journal silently.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(opts: { withDepositAccount?: boolean } = {}): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, status text, feasibility_data text, closure_data text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text, supplier_id bigint, unallocable_reason text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE import_customs_brokers (id text PRIMARY KEY, tenant_id text, name text, license_number text, phone text, port_name text, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_advances (id text PRIMARY KEY DEFAULT ('badv-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, project_id text, shipment_id text, advance_no text, amount_egp numeric, disbursement_date text, payment_method text, treasury_account_id bigint, status text, settled_amount_egp numeric, remaining_amount_egp numeric, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY DEFAULT ('bexp-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, advance_id text, project_id text, shipment_id text, receipt_no text, expense_date text, category text, amount_egp numeric, is_capitalized boolean, is_refundable_vat boolean, attachment_url text, is_verified boolean, verified_by bigint, verified_at timestamptz, notes text, late_expense_event_id bigint, capitalization_state text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE purchases (id text PRIMARY KEY DEFAULT ('pur-' || md5(random()::text)), tenant_id text, import_project_id text, doc_no text, total numeric, paid_amount numeric, status text);
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric, payment_date date, expected_return_date date, actual_return_date date, refund_status text, refunded_amount_egp numeric, deductions_amount_egp numeric, deduction_reason text, treasury_account_id bigint, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, project_id text, sale_item_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, allocation_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, product_id bigint, qty numeric, line_total numeric, allocated_discount numeric, cost_price numeric);
    CREATE TABLE import_sourcing_trips (id text PRIMARY KEY DEFAULT ('trip-' || md5(random()::text)), tenant_id text, project_id text, actual_cost_egp numeric, start_date text, journal_entry_id bigint);
    CREATE TABLE import_project_partners (id text PRIMARY KEY DEFAULT ('pp-' || md5(random()::text)), tenant_id text, project_id text, partner_id text, profit_percentage numeric, capital_share_amount numeric, is_active boolean);
    CREATE TABLE import_partners (id text PRIMARY KEY DEFAULT ('par-' || md5(random()::text)), tenant_id text, name text, withdrawn_profit numeric, profit_share_percentage numeric, capital_share_amount numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_partner_project_payouts (id bigserial PRIMARY KEY, tenant_id text, project_id text, partner_id text, amount_egp numeric);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, 12, 12, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (11, 't1', 't1', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', true, false, false, false, false, false),
      (12, 't1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', true, true, false, false, false, false),
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (25, 't1', 't1', '1130', 'عهد مخلصين', 'Broker advances', 'asset', 'assets', true, false, false, false, false, false),
      (26, 't1', 't1', '1160', 'ضريبة مستردة', 'VAT receivable', 'asset', 'assets', true, false, false, false, false, false)
      ${opts.withDepositAccount === false ? '' : `,(18, 't1', 't1', '1180', 'تأمينات حاويات مستردة', 'Container deposits', 'asset', 'current_assets', true, false, false, false, false, false)`};
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'active', NULL, NULL, NOW());
    INSERT INTO import_shipments (id, tenant_id, container_number, project_id, status) VALUES ('sh-1', 't1', 'MSCU-TEST-001', 'proj-1', 'in_transit');
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function expectReject(promise: Promise<any>, pattern: RegExp, message: string): Promise<void> {
  await assert.rejects(async () => promise, pattern, message);
}

function trialDto(overrides: Record<string, unknown> = {}): any {
  return {
    projectId: 'proj-1',
    shipmentId: 'sh-1',
    containerNo: 'MSCU-TEST-001',
    shippingLine: 'MSC Mediterranean Shipping Company',
    depositAmountEgp: 100,
    paymentDate: '2026-11-09',
    expectedReturnDate: '2026-12-20',
    treasuryAccountId: '12',
    ...overrides,
  };
}

async function journalLines(db: Kysely<Database>): Promise<Array<{ account_id: number; debit: number; credit: number }>> {
  const rows = await sql<{ account_id: string; debit: string; credit: string }>`
    SELECT l.account_id, l.debit, l.credit FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE e.tenant_id = 't1' AND e.source_type = 'import_container_deposit'
    ORDER BY l.id
  `.execute(db);
  return rows.rows.map((r) => ({ account_id: Number(r.account_id), debit: Number(r.debit), credit: Number(r.credit) }));
}

async function main(): Promise<void> {
  // Case 1: valid deposit, trial shape, treasury account set — records + posts JE.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const deposit = await service.recordContainerDeposit('t1', 1, trialDto());
      assert.equal(Number(deposit.deposit_amount_egp), 100, 'Deposit records the trial 100 EGP amount');
      assert.equal(deposit.refund_status, 'pending', 'Deposit starts pending');
      assert.equal(deposit.container_no, 'MSCU-TEST-001', 'Deposit records the trial container');
      const lines = await journalLines(db);
      assert.deepEqual(
        lines,
        [
          { account_id: 18, debit: 100, credit: 0 },
          { account_id: 12, debit: 0, credit: 100 },
        ],
        'JE is Dr container-deposit asset 1180 / Cr bank 1120 for 100',
      );
      const treasury = await db.selectFrom('treasury_transactions').select(['amount', 'txn_type']).execute();
      assert.equal(treasury.length, 1, 'One treasury row is recorded');
      assert.equal(Number(treasury[0].amount), -100, 'Treasury row pays out 100');
      assert.equal(treasury[0].txn_type, 'import_container_deposit', 'Treasury row is typed as a container deposit');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: valid deposit, treasury account unset — bank resolves from settings, same JE shape.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const dto = trialDto();
      delete dto.treasuryAccountId;
      const deposit = await service.recordContainerDeposit('t1', 1, dto);
      assert.equal(Number(deposit.deposit_amount_egp), 100, 'Unset-treasury deposit still records 100 EGP');
      const lines = await journalLines(db);
      assert.deepEqual(
        lines,
        [
          { account_id: 18, debit: 100, credit: 0 },
          { account_id: 12, debit: 0, credit: 100 },
        ],
        'Unset-treasury JE still credits the settings bank account 1120',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 3: invalid amount names the amount rule.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.recordContainerDeposit('t1', 1, trialDto({ depositAmountEgp: 0 })),
        /تأمين الحاوية يجب أن يكون مبلغاً موجباً/,
        'A zero deposit amount fails naming the amount rule',
      );
      const deposits = await db.selectFrom('import_container_deposits').select('id').execute();
      assert.equal(deposits.length, 0, 'A rejected deposit records nothing');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: unknown shipment names the shipment/project mismatch.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.recordContainerDeposit('t1', 1, trialDto({ shipmentId: 'sh-missing' })),
        /حاوية التأمين لا تتبع مشروع الاستيراد/,
        'An unknown shipment fails naming the shipment/project mismatch',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 5: treasury account = parent 1100 (not a cash/bank account) names the account and the role.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.recordContainerDeposit('t1', 1, trialDto({ treasuryAccountId: '11' })),
        /الحساب المحاسبي المحدد \(11\) غير صالح لدور \(bank\)/,
        'A parent current-assets account fails naming the account id and the bank role',
      );
      const deposits = await db.selectFrom('import_container_deposits').select('id').execute();
      assert.equal(deposits.length, 0, 'A rejected deposit records nothing');
      const lines = await journalLines(db);
      assert.equal(lines.length, 0, 'A rejected deposit posts no journal');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: no container-deposit account configured — fails naming the role, never a wrong account.
  {
    const db = await makeDb({ withDepositAccount: false });
    try {
      const service = makeService(db);
      await expectReject(
        service.recordContainerDeposit('t1', 1, trialDto()),
        /دور \(container_deposit\)/,
        'A missing container-deposit account fails naming the container_deposit role',
      );
      const deposits = await db.selectFrom('import_container_deposits').select('id').execute();
      assert.equal(deposits.length, 0, 'A fail-closed deposit records nothing');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import container deposit tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
