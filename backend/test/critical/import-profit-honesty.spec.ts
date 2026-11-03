/*
New file: backend/test/critical/import-profit-honesty.spec.ts
Pins honest project profit and autopsy figures
(INV-IMPORT-PROFIT-HONESTY).

WHAT WAS WRONG: the project profit report counted sourcing trips
and late-expense COGS portions but silently omitted the receipt
shortage expense, non-capitalised broker expenses, realised FX
variance and container-deposit deductions — all posted to the
ledger — so the reported "profit" overstated the books. The
autopsy called invoiced-minus-COGS "realised net profit" while
excluding operating/broker/FX costs, computed factory cost on
B/L quantity, used a silent || 50 exchange rate, and counted
broker expenses without saying where each one landed.

WHAT THIS PINS, driving the real updateShipmentCosts (receipt),
disburseBrokerAdvance, liquidateBrokerExpenses,
recordForeignTransfer and recordContainerReturnAndRefund on
PGlite through the real posting boundary:
- The report's posted components equal the posted GL lines to
  the cent, independently re-read from journal_entry_lines:
  shortage COGS, expensed broker COGS, signed FX variance and
  deposit deductions — each counted exactly once.
- A reversal mirror nets the original receipt journal to zero
  in the same period (shortage component 0 after mirroring).
- Unposted trip estimates and unposted late-expense memos are
  reported as excluded and never enter profit.
- The autopsy renames the figure to gross trading margin (the
  old net-profit field is gone), labels the exchange-rate
  source (arrival / pricing / assumed 50), reports factory
  cost on both B/L and received quantities, states the posted
  receipt landed value separately from shipment-field
  estimates, and breaks broker expenses down by the path each
  one took.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
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
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, title text, project_no text, status text, feasibility_data text, closure_data text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, amount numeric, amount_foreign numeric, note text, created_by bigint, payment_date text, currency text, exchange_rate numeric, forex_variance_egp numeric, proforma_invoice_id text, idempotency_key text, doc_no text, created_at timestamptz DEFAULT NOW(), payment_method text, payment_reference text, bank_swift_code text, form4_number text, form4_date date, evidence_carrier_name text, evidence_travel_date date, evidence_handover_receipt text, evidence_lc_number text, evidence_lc_issuing_bank text, evidence_lc_expiry date, evidence_lc_documents text, evidence_cad_proof text, evidence_payment_terms text, evidence_payment_due_date date);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY DEFAULT ('pi-' || md5(random()::text)), tenant_id text, pi_number text, supplier_id bigint, project_id text, currency text, total_amount_foreign numeric, paid_amount_foreign numeric, exchange_rate_contract numeric, payment_status text, pi_date text, incoterm text, delivery_port text, payment_terms text, advance_percentage numeric, balance_percentage numeric, status text, items text, notes text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE import_customs_brokers (id text PRIMARY KEY, tenant_id text, name text, license_number text, phone text, port_name text, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_advances (id text PRIMARY KEY DEFAULT ('badv-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, project_id text, shipment_id text, advance_no text, amount_egp numeric, disbursement_date text, payment_method text, treasury_account_id bigint, status text, settled_amount_egp numeric, remaining_amount_egp numeric, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY DEFAULT ('bexp-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, advance_id text, project_id text, shipment_id text, receipt_no text, expense_date text, category text, amount_egp numeric, is_capitalized boolean, is_refundable_vat boolean, attachment_url text, is_verified boolean, verified_by bigint, verified_at timestamptz, notes text, late_expense_event_id bigint, capitalization_state text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE purchases (id text PRIMARY KEY DEFAULT ('pur-' || md5(random()::text)), tenant_id text, import_project_id text, doc_no text, total numeric, paid_amount numeric, status text);
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric, payment_date text, expected_return_date text, refund_status text, refunded_amount_egp numeric, deductions_amount_egp numeric, treasury_account_id bigint, notes text, actual_return_date text, deduction_reason text, updated_at timestamptz DEFAULT NOW(), created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_refund_events (id text PRIMARY KEY DEFAULT ('ref-' || md5(random()::text)), serial_id bigserial, tenant_id text, deposit_id text, idempotency_key text, refunded_amount_egp numeric, deductions_amount_egp numeric, treasury_account_id bigint, created_by bigint, journal_entry_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, project_id text, shipment_id text, sale_item_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, allocation_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, product_id bigint, qty numeric, line_total numeric, allocated_discount numeric, cost_price numeric);
    CREATE TABLE import_sourcing_trips (id text PRIMARY KEY DEFAULT ('trip-' || md5(random()::text)), tenant_id text, project_id text, actual_cost_egp numeric, start_date text, journal_entry_id bigint);
    CREATE TABLE import_project_partners (id text PRIMARY KEY DEFAULT ('pp-' || md5(random()::text)), tenant_id text, project_id text, partner_id text, profit_percentage numeric, capital_share_amount numeric, is_active boolean);
    CREATE TABLE import_partners (id text PRIMARY KEY DEFAULT ('par-' || md5(random()::text)), tenant_id text, name text, withdrawn_profit numeric, profit_share_percentage numeric, capital_share_amount numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_partner_project_payouts (id bigserial PRIMARY KEY, tenant_id text, project_id text, partner_id text, amount_egp numeric);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, retail_price numeric, wholesale_price numeric, supplier_id bigint, category_id bigint, notes text, metadata text, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '1130', 'عهد مخلصين', 'Broker advances', 'asset', 'assets', true, false, false, false, false, false),
      (26, 't1', 't1', '1160', 'ضريبة مستردة', 'VAT receivable', 'asset', 'assets', true, false, false, false, false, false),
      (27, 't1', 't1', '5201', 'خسائر فروق عملة', 'Forex Loss', 'expense', 'expenses', true, false, false, false, false, false),
      (28, 't1', 't1', '4201', 'أرباح فروق عملة', 'Forex Gain', 'revenue', 'revenues', true, false, false, false, false, false),
      (29, 't1', 't1', '1180', 'تأمينات حاويات', 'Container deposits', 'asset', 'assets', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'Project One', 'IMP-261102-0001', 'active', '{}', NULL, NOW());
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', NULL, NULL, 10, 0, 2000, 0, 0, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 10, 0),
      ('t1', 't1', 1, NULL, NULL, 0, 0);
    INSERT INTO import_customs_brokers VALUES ('br-1', 't1', 'Broker One', NULL, NULL, 'Alexandria', NULL, NOW());
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

function makePosting(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  return new AccountingPostingService(fakeFoundation);
}

async function seedShipment(db: Kysely<Database>, rate: number | null): Promise<void> {
  await db.insertInto('import_shipments' as never).values({
    id: 'sh-1', tenant_id: 't1', container_number: 'C1', supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: rate, pricing_exchange_rate: null, cost_allocation_method: 'value',
    project_id: 'proj-1', shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: 'sh-1-item', tenant_id: 't1', shipment_id: 'sh-1', product_id: 1,
    quantity: 10, factory_unit_price_usd: 50, shortage_handling_method: 'capitalize',
  } as never).execute();
}

/** Independent GL read: signed sum of posted lines on the given accounts. */
async function glSum(
  db: Kysely<Database>,
  entryIds: number[],
  accountIds: number[],
): Promise<number> {
  if (entryIds.length === 0) return 0;
  const rows: any[] = await (db as any)
    .selectFrom('journal_entry_lines')
    .select(['debit', 'credit'])
    .where('journal_entry_id', 'in', entryIds)
    .where('account_id', 'in', accountIds)
    .execute();
  return rows.reduce((s, r) => s + Number(r.debit || 0) - Number(r.credit || 0), 0);
}

async function entriesBySource(
  db: Kysely<Database>,
  sourceType: string,
  sourceIds: number[],
): Promise<number[]> {
  if (sourceIds.length === 0) return [];
  const rows: any[] = await (db as any)
    .selectFrom('journal_entries')
    .select('id')
    .where('tenant_id', '=', 't1')
    .where('source_type', '=', sourceType)
    .where('source_id', 'in', sourceIds)
    .where('status', '=', 'posted')
    .execute();
  return rows.map((r) => Number(r.id));
}

async function main(): Promise<void> {
  // Case 1: every posted cost component is counted exactly once,
  // equals the GL, and unposted estimates stay out of profit.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 50);

      // Receipt with a 2-unit shortage handled as expense: the
      // receipt journal debits COGS for the shortfall.
      await (db as any)
        .updateTable('import_shipment_items')
        .set({ received_quantity: 8, shortage_handling_method: 'expense' })
        .where('id', '=', 'sh-1-item')
        .execute();
      await service.updateShipmentCosts('t1', 1, 'sh-1', {
        status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
      });
      const receipt: any = await (db as any)
        .selectFrom('import_inventory_receipts')
        .selectAll()
        .where('shipment_id', '=', 'sh-1')
        .executeTakeFirstOrThrow();
      const receiptJournalId = Number(receipt.journal_entry_id);
      assert.ok(receiptJournalId > 0, 'Receipt posts a journal');

      // Non-capitalised broker expense: Dr COGS / Cr advance.
      const advance = await service.disburseBrokerAdvance('t1', 1, {
        brokerId: 'br-1', advanceNo: 'ADV-1', amountEgp: 5000,
        projectId: 'proj-1', shipmentId: 'sh-1', paymentMethod: 'bank_transfer', treasuryAccountId: 24,
      });
      await service.liquidateBrokerExpenses('t1', 1, {
        brokerId: 'br-1', advanceId: advance.id, projectId: 'proj-1', shipmentId: 'sh-1',
        receiptNo: 'RC-1', category: 'customs_duty', amountEgp: 1200,
        isCapitalized: false, isRefundableVat: false,
      });

      // Two PI-linked transfers: a 2000 loss and a 500 gain.
      await db.insertInto('import_proforma_invoices' as never).values([
        { id: 'pi-1', tenant_id: 't1', pi_number: 'PI-1', supplier_id: 1, project_id: 'proj-1', currency: 'USD', total_amount_foreign: 5000, paid_amount_foreign: 0, exchange_rate_contract: 50, payment_status: 'open', pi_date: '2026-03-01', status: 'draft' },
        { id: 'pi-2', tenant_id: 't1', pi_number: 'PI-2', supplier_id: 1, project_id: 'proj-1', currency: 'USD', total_amount_foreign: 5000, paid_amount_foreign: 0, exchange_rate_contract: 50, payment_status: 'open', pi_date: '2026-03-01', status: 'draft' },
      ] as never).execute();
      const t1: any = await service.recordForeignTransfer('t1', 1, {
        supplierId: 1, amountEgp: 52000, amountForeign: 1000, currency: 'USD',
        bankAccountId: 24, idempotencyKey: 'fx-loss-1', proformaInvoiceId: 'pi-1', projectId: 'proj-1',
      });
      assert.equal(t1.forexVarianceEgp, 2000, 'Loss transfer posts a 2000 variance');
      const t2: any = await service.recordForeignTransfer('t1', 1, {
        supplierId: 1, amountEgp: 49500, amountForeign: 1000, currency: 'USD',
        bankAccountId: 24, idempotencyKey: 'fx-gain-1', proformaInvoiceId: 'pi-2', projectId: 'proj-1',
      });
      assert.equal(t2.forexVarianceEgp, -500, 'Gain transfer posts a -500 variance');

      // Container deposit refund with a 1500 deduction: Dr COGS.
      await db.insertInto('import_container_deposits' as never).values({
        id: 'dep-1', tenant_id: 't1', project_id: 'proj-1', shipment_id: 'sh-1',
        container_no: 'C1', shipping_line: 'Maersk', deposit_amount_egp: 10000,
        payment_date: '2026-03-01', refund_status: 'pending',
        refunded_amount_egp: 0, deductions_amount_egp: 0,
      } as never).execute();
      await service.recordContainerReturnAndRefund('t1', 1, 'dep-1', {
        refundedAmountEgp: 8000, deductionsAmountEgp: 1500,
        idempotencyKey: 'refund-1', actualReturnDate: '2026-03-10', treasuryAccountId: 24,
      });

      // Posted trip (journal link set) counts; unposted trip does not.
      await db.insertInto('import_sourcing_trips' as never).values([
        { id: 'trip-posted', tenant_id: 't1', project_id: 'proj-1', actual_cost_egp: 700, start_date: '2026-03-05', journal_entry_id: receiptJournalId },
        { id: 'trip-memo', tenant_id: 't1', project_id: 'proj-1', actual_cost_egp: 900, start_date: '2026-03-05', journal_entry_id: null },
      ] as never).execute();

      // Late-expense COGS: one posted event counts, one provisional
      // memo (no journal link) is reported as excluded only.
      await db.insertInto('import_late_expense_events' as never).values([
        { tenant_id: 't1', shipment_id: 'sh-1', title: 'Posted late cost', total_amount_egp: 400, inventory_amount_egp: 0, cogs_amount_egp: 400, journal_entry_id: receiptJournalId, created_by: 1, created_at: '2026-03-05' },
        { tenant_id: 't1', shipment_id: 'sh-1', title: 'Provisional memo', total_amount_egp: 250, inventory_amount_egp: 250, cogs_amount_egp: 0, journal_entry_id: null, created_by: 1, created_at: '2026-03-05' },
      ] as never).execute();

      // One sale, fully lot-allocated: revenue 20000, COGS 6000.
      await db.insertInto('sales' as never).values({ id: 1, tenant_id: 't1', status: 'confirmed', created_at: '2026-03-05' } as never).execute();
      await db.insertInto('sale_items' as never).values({
        id: 1, sale_id: 1, product_id: 1, qty: 4, line_total: 20000, allocated_discount: 0, cost_price: 1500,
      } as never).execute();
      await db.insertInto('import_sale_allocations' as never).values({
        tenant_id: 't1', project_id: 'proj-1', shipment_id: 'sh-1', sale_item_id: 1,
        quantity: 4, unit_sale_price_egp: 5000, unit_cost_egp: 1500,
        allocation_type: 'sale', created_at: '2026-03-05',
      } as never).execute();

      const report: any = await service.generatePeriodProfitReport(
        't1', new Date('2026-01-01'), new Date('2027-12-31'), 'proj-1',
      );
      const d = report.data;
      assert.equal(d.profitAttributionVerified, true, 'Fully allocated sales verify attribution');
      assert.equal(d.grossSalesRevenue, 20000);
      assert.equal(d.netCogs, 6000);
      assert.equal(d.grossProfit, 14000);
      assert.equal(d.profitBasis, 'POSTED_LEDGER_ONLY');

      // Independent GL reconciliation: each component equals the
      // posted journal lines, to the cent.
      const receiptLines = await glSum(db, [receiptJournalId], [23]);
      assert.ok(receiptLines > 0, 'Receipt journal carries a COGS shortage line');
      assert.equal(d.postedCostComponents.shortageExpenseEgp, receiptLines, 'Shortage equals the receipt COGS line');
      const brokerExpense: any = await (db as any)
        .selectFrom('import_broker_expenses').select('serial_id').executeTakeFirstOrThrow();
      const brokerEntries = await entriesBySource(db, 'import_broker_expense', [Number(brokerExpense.serial_id)]);
      assert.equal(d.postedCostComponents.brokerExpensedEgp, 1200, 'Expensed broker cost counted once');
      assert.equal(d.postedCostComponents.brokerExpensedEgp, await glSum(db, brokerEntries, [23]));
      const fxEntries = await entriesBySource(db, 'supplier_payment', [t1.paymentId, t2.paymentId]);
      assert.equal(d.postedCostComponents.fxVarianceEgp, 1500, 'Signed FX variance: 2000 loss - 500 gain');
      assert.equal(d.postedCostComponents.fxVarianceEgp, await glSum(db, fxEntries, [27, 28]));
      const refundEvent: any = await (db as any)
        .selectFrom('import_container_refund_events').select('serial_id').executeTakeFirstOrThrow();
      const refundEntries = await entriesBySource(db, 'import_container_refund', [Number(refundEvent.serial_id)]);
      assert.equal(d.postedCostComponents.depositDeductionsEgp, 1500, 'Deposit deduction counted once');
      assert.equal(d.postedCostComponents.depositDeductionsEgp, await glSum(db, refundEntries, [23]));

      // Totals reconcile: profit = revenue - COGS - posted expenses.
      const expectedExpenses = 700 + 400 + receiptLines + 1200 + 1500 + 1500;
      assert.equal(d.totalExpenses, expectedExpenses, 'Total expenses include every posted component');
      assert.equal(d.netProfitPool, 14000 - expectedExpenses, 'Net pool reconciles to the GL components');
      assert.equal(
        d.postedCostComponents.totalPostedCostComponentsEgp,
        receiptLines + 1200 + 1500 + 1500,
      );

      // Unposted estimates are labelled and excluded.
      assert.equal(d.unpostedEstimatesExcluded.unpostedTripEstimatesEgp, 900);
      assert.equal(d.unpostedEstimatesExcluded.unpostedLateExpenseMemosEgp, 250);
      assert.equal(d.unpostedEstimatesExcluded.totalExcludedEgp, 1150);

      // Autopsy: honest labels, posted landed value, broker split.
      const autopsy: any = await service.getContainerAutopsySheet('t1', 'sh-1');
      assert.equal(autopsy.basis.exchangeRateSource, 'arrival');
      assert.equal(autopsy.basis.exchangeRateAssumed, false);
      assert.equal(autopsy.landedCosts.exchangeRateSource, 'arrival');
      assert.equal('realizedNetProfitEgp' in autopsy.profitability, false, 'The net-profit field is gone');
      assert.ok(autopsy.profitability.realizedGrossTradingMarginEgp !== undefined);
      assert.ok(String(autopsy.profitability.marginBasis).includes('gross_trading_margin'));
      assert.ok(autopsy.landedCosts.factoryTotalReceivedEgp < autopsy.landedCosts.factoryTotalEgp, 'Received basis is below B/L basis by the shortage');
      assert.equal(autopsy.landedCosts.factoryTotalBasis, 'bill_of_lading_quantity');
      assert.equal(autopsy.landedCosts.landedCostBasis, 'posted_receipt_journal');
      assert.ok(autopsy.landedCosts.postedLandedValueEgp !== null && autopsy.landedCosts.postedLandedValueEgp > 0);
      const invLine = await glSum(db, [receiptJournalId], [21]);
      assert.equal(autopsy.landedCosts.postedLandedValueEgp, invLine, 'Posted landed value equals the receipt inventory line');
      assert.equal(autopsy.liabilities.brokerExpensedEgp, 1200);
      assert.equal(autopsy.liabilities.brokerCapitalisedInLandedEgp, 0, 'Nothing capitalised in this scenario');
      assert.equal(autopsy.liabilities.brokerExpensesByState.expensed.amountEgp, 1200);
      assert.equal(autopsy.basis.postedReceipt, true);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: a reversal mirror nets the original receipt journal
  // to zero in the same period (shortage component 0).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const posting = makePosting(db);
      await seedShipment(db, 50);
      await (db as any)
        .updateTable('import_shipment_items')
        .set({ received_quantity: 8, shortage_handling_method: 'expense' })
        .where('id', '=', 'sh-1-item')
        .execute();
      await service.updateShipmentCosts('t1', 1, 'sh-1', {
        status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
      });
      const receipt: any = await (db as any)
        .selectFrom('import_inventory_receipts')
        .selectAll()
        .where('shipment_id', '=', 'sh-1')
        .executeTakeFirstOrThrow();
      const receiptJournalId = Number(receipt.journal_entry_id);
      const before: any = await service.generatePeriodProfitReport(
        't1', new Date('2026-01-01'), new Date('2027-12-31'), 'proj-1',
      );
      assert.ok(before.data.postedCostComponents.shortageExpenseEgp > 0, 'Shortage counts before reversal');

      // Mirror the receipt journal through the real posting
      // boundary, exactly as the Batch-3 reversal does (swapped
      // debit/credit, linked by reversal_of_entry_id).
      const originalLines: any[] = await (db as any)
        .selectFrom('journal_entry_lines')
        .selectAll()
        .where('journal_entry_id', '=', receiptJournalId)
        .execute();
      assert.ok(originalLines.length > 0);
      await posting.postDomainJournal(db as any, {
        sourceType: 'import_inventory_receipt_reversal',
        sourceId: Number(receipt.id),
        tenantId: 't1',
        accountId: 't1',
        entryDate: new Date(),
        description: 'Mirror of receipt journal (harness reversal)',
        branchId: null,
        locationId: null,
        createdBy: 1,
        postedBy: 1,
        reversalOfEntryId: receiptJournalId,
        lines: originalLines.map((l) => ({
          accountId: Number(l.account_id),
          description: l.description,
          debit: Number(l.credit || 0),
          credit: Number(l.debit || 0),
          partnerType: l.partner_type,
          partnerId: l.partner_id,
          branchId: null,
          locationId: null,
        })),
      });

      const after: any = await service.generatePeriodProfitReport(
        't1', new Date('2026-01-01'), new Date('2027-12-31'), 'proj-1',
      );
      assert.equal(
        after.data.postedCostComponents.shortageExpenseEgp,
        0,
        'A reversed receipt contributes exactly zero shortage cost',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 3: no arrival or pricing rate — the autopsy labels the
  // assumed rate instead of silently using 50.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, null);
      const autopsy: any = await service.getContainerAutopsySheet('t1', 'sh-1');
      assert.equal(autopsy.basis.exchangeRateSource, 'assumed_50');
      assert.equal(autopsy.basis.exchangeRateAssumed, true);
      assert.equal(autopsy.landedCosts.exchangeRate, 50);
      assert.equal(autopsy.landedCosts.exchangeRateAssumed, true);
      assert.equal(autopsy.landedCosts.postedLandedValueEgp, null, 'No posted receipt, no frozen value');
      assert.equal(autopsy.landedCosts.landedCostBasis, 'shipment_field_estimates');
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('Import profit honesty tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
