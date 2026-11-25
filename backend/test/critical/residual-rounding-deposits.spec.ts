/*
 * INV-RESIDUAL-ROUNDING-DEPOSITS: container deposit refunds round at
 * the tenant base currency's book digits (3dp on a 3dp tenant, 2dp
 * otherwise), not at a hardcoded 2dp.
 *
 * WHAT WAS WRONG: the refund path cut every settled total with a
 * hardcoded 2dp rounding, so on a 3dp tenant a 50.125 refund posted
 * a 50.13 journal credit while the journal lines themselves carry
 * scale 3, and the deposit row and the refund event stored 50.13
 * too — the GL and the subledger agreed with each other but both
 * disagreed with the amount actually owed by 0.005, and the next
 * refund's remaining balance was computed from the 2dp-rounded
 * stored totals, so the residual drifted from the journal from
 * then on. The storage for the 3dp values was widened first by the
 * 0337 migration (five deposit columns to NUMERIC(16,3)); this
 * package is the calculation half and must not land before it.
 *
 * WHAT THIS PINS, driving the REAL recordContainerReturnAndRefund
 * on PGlite through the real posting boundary (same harness as the
 * deposit spec, tables at the migrated NUMERIC(16,3) schema):
 * - KWD (3dp tenant): deposit 100.125; refund 50.125 with no
 *   deductions posts a journal credit of exactly 50.125, the
 *   deposit row records refunded 50.125 with 50.000 remaining, and
 *   the refund event records 50.125. At 2dp the same inputs give
 *   100.13 / 50.13 — so this case FAILS on unpatched code.
 * - KWD deduction split: deposit 200.000; refund 100.000 plus
 *   deductions 0.125 posts a journal credit of exactly 100.125
 *   (bank debit 100.000 plus expense debit 0.125), the event
 *   records deductions 0.125, and the deposit row records
 *   refunded 100.000 and deductions 0.125.
 * - Egypt (2dp tenant, no behaviour change): deposit 100.12;
 *   refund 50.12 posts a journal credit of 50.12, the deposit
 *   row records refunded 50.12 with 50.00 remaining — identical
 *   before and after the fix.
 * - Static pins: the service file keeps exactly one hardcoded
 *   2dp rounding site (the ROI percentage, which is a percentage
 *   not money) and no EGP-digits rounder remains; the spec is
 *   wired into test:critical and the invariant entry exists
 *   exactly once.
 *
 * Fail-first: with the refund path restored to the hardcoded 2dp
 * rounding, the KWD journal-credit assertions fail (50.13, not
 * 50.125; 100.13, not 100.125). Verified by temporarily mutating
 * the service and watching this spec fail, then restoring it
 * byte-identical.
 *
 * Prospective only: refunds already posted stay as posted. Honest
 * limits: PGlite only — the live-DB information_schema scale
 * check is still owed from the user's PC; no live trial applies
 * beyond the next refund on a 3dp tenant.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const REPO_ROOT = path.resolve(__dirname, '../../..');

async function makeDb(opts: { tenant: string; currency: 'KWD' | 'EGP' }): Promise<Kysely<Database>> {
  const { tenant, currency } = opts;
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
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE purchases (id text PRIMARY KEY DEFAULT ('pur-' || md5(random()::text)), tenant_id text, import_project_id text, doc_no text, total numeric, paid_amount numeric, status text);
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric(16,3), payment_date date, expected_return_date date, actual_return_date date, refund_status text, refunded_amount_egp numeric(16,3), deductions_amount_egp numeric(16,3), deduction_reason text, treasury_account_id bigint, notes text, idempotency_key text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_refund_events (id text PRIMARY KEY DEFAULT ('evt-' || md5(random()::text)), serial_id bigserial, tenant_id text, deposit_id text, idempotency_key text, refunded_amount_egp numeric(16,3), deductions_amount_egp numeric(16,3), treasury_account_id bigint, created_by bigint, journal_entry_id bigint, created_at timestamptz DEFAULT NOW());
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
    INSERT INTO settings VALUES ('${tenant}', 'currency', '"${currency}"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('${tenant}', '${currency}', 1, true), ('${tenant}', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, '${tenant}', NULL, NULL, NULL, NULL, NULL, 12, 12, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (11, '${tenant}', '${tenant}', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', true, false, false, false, false, false),
      (12, '${tenant}', '${tenant}', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', true, true, false, false, false, false),
      (21, '${tenant}', '${tenant}', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, '${tenant}', '${tenant}', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, '${tenant}', '${tenant}', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (25, '${tenant}', '${tenant}', '1130', 'عهد مخلصين', 'Broker advances', 'asset', 'assets', true, false, false, false, false, false),
      (26, '${tenant}', '${tenant}', '1160', 'ضريبة مستردة', 'VAT receivable', 'asset', 'assets', true, false, false, false, false, false),
      (18, '${tenant}', '${tenant}', '1180', 'تأمينات حاويات مستردة', 'Container deposits', 'asset', 'current_assets', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, '${tenant}', '${tenant}', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, '${tenant}', NULL);
    INSERT INTO import_projects VALUES ('proj-1', '${tenant}', 'active', NULL, NULL, NOW());
    INSERT INTO import_shipments (id, tenant_id, container_number, project_id, status) VALUES ('sh-1', '${tenant}', 'MSCU-TEST-001', 'proj-1', 'in_transit');
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

function depositDto(overrides: Record<string, unknown> = {}): any {
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

function refundDto(overrides: Record<string, unknown> = {}): any {
  return {
    idempotencyKey: 'refund-1',
    actualReturnDate: '2026-11-20',
    refundedAmountEgp: 50,
    deductionsAmountEgp: 0,
    treasuryAccountId: '12',
    ...overrides,
  };
}

async function refundJournalLines(
  db: Kysely<Database>,
  tenant: string,
): Promise<Array<{ account_id: number; debit: number; credit: number }>> {
  const rows = await sql<{ account_id: string; debit: string; credit: string }>`
    SELECT l.account_id, l.debit, l.credit FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE e.tenant_id = ${tenant} AND e.source_type = 'import_container_refund'
    ORDER BY l.id
  `.execute(db);
  return rows.rows.map((r) => ({ account_id: Number(r.account_id), debit: Number(r.debit), credit: Number(r.credit) }));
}

async function main(): Promise<void> {
  // Case 1: KWD (3dp tenant) — deposit 100.125, refund 50.125, no
  // deductions: the journal credit, the deposit row and the event
  // must all carry exactly 50.125, with 50.000 remaining.
  {
    const db = await makeDb({ tenant: 't-kwd', currency: 'KWD' });
    try {
      const service = makeService(db);
      const deposit = await service.recordContainerDeposit('t-kwd', 1, depositDto({ depositAmountEgp: 100.125 }));
      assert.equal(Number(deposit.deposit_amount_egp), 100.125, 'KWD deposit records 100.125 exactly');
      const updated = await service.recordContainerReturnAndRefund(
        't-kwd',
        1,
        deposit.id,
        refundDto({ refundedAmountEgp: 50.125, deductionsAmountEgp: 0 }),
      );
      assert.equal(updated.refund_status, 'partially_refunded', 'A half refund leaves the deposit partially refunded');
      assert.equal(Number(updated.refunded_amount_egp), 50.125, 'KWD deposit row records refunded 50.125, not 50.13');
      assert.equal(Number(updated.deductions_amount_egp), 0, 'KWD deposit row records deductions 0');
      const kwdRemaining =
        Number(updated.deposit_amount_egp) -
        Number(updated.refunded_amount_egp) -
        Number(updated.deductions_amount_egp);
      assert.ok(
        Math.abs(kwdRemaining - 50) < 1e-9,
        `KWD remaining balance must be 50.000 after a 50.125 refund of 100.125, got ${kwdRemaining}`,
      );
      assert.deepEqual(
        await refundJournalLines(db, 't-kwd'),
        [
          { account_id: 12, debit: 50.125, credit: 0 },
          { account_id: 18, debit: 0, credit: 50.125 },
        ],
        'KWD refund JE is Dr bank 50.125 / Cr container-deposit asset 50.125',
      );
      const events = await db
        .selectFrom('import_container_refund_events')
        .select(['refunded_amount_egp', 'deductions_amount_egp'])
        .execute();
      assert.equal(events.length, 1, 'One refund event is recorded');
      assert.equal(Number(events[0].refunded_amount_egp), 50.125, 'KWD refund event records 50.125, not 50.13');
      assert.equal(Number(events[0].deductions_amount_egp), 0, 'KWD refund event records deductions 0');
      const treasury = await db
        .selectFrom('treasury_transactions')
        .select(['amount', 'txn_type'])
        .where('txn_type', '=', 'import_container_refund')
        .execute();
      assert.equal(treasury.length, 1, 'One refund treasury row is recorded');
      assert.equal(Number(treasury[0].amount), 50.125, 'KWD refund treasury row pays 50.125');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: KWD deduction split — deposit 200.000, refund 100.000
  // plus deductions 0.125: the settled total is 100.125, so the
  // journal credit must be exactly 100.125 (bank 100.000 + expense
  // 0.125) and the event must record deductions 0.125.
  {
    const db = await makeDb({ tenant: 't-kwd', currency: 'KWD' });
    try {
      const service = makeService(db);
      const deposit = await service.recordContainerDeposit('t-kwd', 1, depositDto({ depositAmountEgp: 200 }));
      const updated = await service.recordContainerReturnAndRefund(
        't-kwd',
        1,
        deposit.id,
        refundDto({ idempotencyKey: 'refund-2', refundedAmountEgp: 100, deductionsAmountEgp: 0.125 }),
      );
      assert.equal(Number(updated.refunded_amount_egp), 100, 'KWD split deposit row records refunded 100.000');
      assert.equal(
        Number(updated.deductions_amount_egp),
        0.125,
        'KWD split deposit row records deductions 0.125, not 0.13',
      );
      assert.deepEqual(
        await refundJournalLines(db, 't-kwd'),
        [
          { account_id: 12, debit: 100, credit: 0 },
          { account_id: 23, debit: 0.125, credit: 0 },
          { account_id: 18, debit: 0, credit: 100.125 },
        ],
        'KWD split refund JE is Dr bank 100 + Dr expense 0.125 / Cr container-deposit asset 100.125',
      );
      const events = await db
        .selectFrom('import_container_refund_events')
        .select(['refunded_amount_egp', 'deductions_amount_egp'])
        .execute();
      assert.equal(Number(events[0].refunded_amount_egp), 100, 'KWD split event records refunded 100.000');
      assert.equal(
        Number(events[0].deductions_amount_egp),
        0.125,
        'KWD split event records deductions 0.125, not 0.13',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 3: Egypt (2dp tenant, no behaviour change) — deposit
  // 100.12, refund 50.12: journal credit 50.12, deposit row
  // refunded 50.12, remaining 50.00 — identical before/after.
  {
    const db = await makeDb({ tenant: 't-egp', currency: 'EGP' });
    try {
      const service = makeService(db);
      const deposit = await service.recordContainerDeposit('t-egp', 1, depositDto({ depositAmountEgp: 100.12 }));
      assert.equal(Number(deposit.deposit_amount_egp), 100.12, 'EGP deposit records 100.12');
      const updated = await service.recordContainerReturnAndRefund(
        't-egp',
        1,
        deposit.id,
        refundDto({ refundedAmountEgp: 50.12, deductionsAmountEgp: 0 }),
      );
      assert.equal(Number(updated.refunded_amount_egp), 50.12, 'EGP deposit row records refunded 50.12');
      const egpRemaining =
        Number(updated.deposit_amount_egp) -
        Number(updated.refunded_amount_egp) -
        Number(updated.deductions_amount_egp);
      assert.ok(
        Math.abs(egpRemaining - 50) < 1e-9,
        `EGP remaining balance must be 50.00 after a 50.12 refund of 100.12, got ${egpRemaining}`,
      );
      assert.deepEqual(
        await refundJournalLines(db, 't-egp'),
        [
          { account_id: 12, debit: 50.12, credit: 0 },
          { account_id: 18, debit: 0, credit: 50.12 },
        ],
        'EGP refund JE is Dr bank 50.12 / Cr container-deposit asset 50.12',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 4: static pins — the service file keeps exactly one
  // hardcoded 2dp rounding site (the ROI percentage) and no
  // EGP-digits rounder remains; the spec is wired into
  // test:critical and the invariant entry exists exactly once.
  {
    const serviceSrc = fs.readFileSync(
      path.join(
        REPO_ROOT,
        'backend',
        'src',
        'modules',
        'import-sales',
        'services',
        'import-container-deposits.service.ts',
      ),
      'utf8',
    );
    const stripped = serviceSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    const toFixed2 = (stripped.match(/\.toFixed\(\s*2\s*\)/g) || []).length;
    assert.equal(
      toFixed2,
      1,
      `the service must keep exactly 1 hardcoded 2dp rounding site (the ROI percentage), got ${toFixed2}`,
    );
    assert.ok(
      stripped.includes('roiPercentage: Number(roiPercentage.toFixed(2))'),
      'the single remaining 2dp site must be the ROI percentage',
    );
    assert.equal(
      (stripped.match(/currencyMoneyDigits\('EGP'\)/g) || []).length,
      0,
      'no EGP-digits rounder may remain in the service — autopsy money sites round at tenant digits',
    );
    const specs = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'backend', 'scripts', 'critical-specs.json'), 'utf8'))
      .specs as string[];
    assert.ok(
      specs.includes('test/critical/residual-rounding-deposits.spec.ts'),
      'this spec must be wired into test:critical',
    );
    const invariants = fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(
      invariants.split('INV-RESIDUAL-ROUNDING-DEPOSITS').length - 1,
      1,
      'the invariant entry must exist exactly once',
    );
  }

  console.log('residual-rounding-deposits: all cases passed (KWD 50.125 / 100.125 split, EGP 50.12 unchanged)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
