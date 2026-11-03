/*
New file: backend/test/critical/import-broker-capitalisation.spec.ts
Pins broker-expense capitalisation exactly once, through exactly
one path, with maker-checker verification
(INV-IMPORT-BROKER-CAPITALISATION).

WHAT WAS WRONG: liquidateBrokerExpenses self-verified every
expense (is_verified=true, verified_by=the liquidator) and
posted a lump-sum Dr-inventory journal that touched no lot, no
WAC pool and no landed cost — while the same cost could also
sit in a shipment cost bucket and enter landed cost at receipt.
The inventory account was inflated twice for one cost, and no
second person ever reviewed the evidence.

WHAT THIS PINS, driving the real disburseBrokerAdvance,
liquidateBrokerExpenses, updateShipmentCosts (posting),
verifyBrokerExpense and closeProject on PGlite through the real
posting boundary:
- Fold (pre-receipt): liquidation folds the amount into the
  shipment bucket (customs_cost_egp += amount), records one
  'folded' link row, posts NO journal and creates NO expenses
  row, and leaves the expense unverified with the liquidator
  recorded. The bucket floor rejects lowering the bucket below
  the folded sum.
- Receipt split: posting consumes the fold in the same
  transaction — Dr inventory for the full landed value, Cr
  supplier payable for landed-minus-folded, Cr broker-advance
  asset for the folded amount — the supplier subledger rises
  by the payable only, and the link/expense flip to 'consumed'.
  The 1130-code advance account exercises the partner-ledger
  exemption: the partner-less advance leg must not throw.
- Revaluation (post-receipt): liquidation spreads through the
  late-expense core — WAC, lot and item landed costs move by
  the spread, one journal Dr inventory / Cr broker-advance with
  sourceType import_broker_capitalization, one late-expense
  event linked to the broker expense, one 'revalued' link row.
  No separate broker journal with a lump-sum inventory debit.
- VAT asset / period expense: refundable VAT posts Dr
  VAT-receivable / Cr advance (state 'vat_asset', no link row);
  a non-capitalised expense posts Dr COGS / Cr advance
  (state 'expensed').
- Fail-closed: capitalised with no shipment; 'other' (and
  non-refundable VAT) with no bucket before receipt. Neither
  writes an expense row nor settles the advance.
- Verification: the liquidator cannot verify their own
  expense (token not consumed); a token bound to another
  expense cannot verify this one (token not consumed); a
  second user verifies; a second verification conflicts.
- closeProject: an unverified broker expense blocks closure;
  after verification the closure proceeds past the gate to the
  later stock guard.
- The pure bucket engine: every category maps to its bucket,
  refundable VAT maps to the tax-asset path, and 'other' /
  unknown categories have no bucket.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { resolveBrokerCapitalizationBucket } from '../../src/modules/import-sales/engines/import-broker-capitalization.engine';

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
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), tenant_id text, project_id text, shipment_id text, container_no text, refund_status text);
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
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '1130', 'عهد مخلصين', 'Broker advances', 'asset', 'assets', true, false, false, false, false, false),
      (26, 't1', 't1', '1160', 'ضريبة مستردة', 'VAT receivable', 'asset', 'assets', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'active', '{}', NULL, NOW());
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 10, 0, 2000, NOW());
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

async function seedShipment(db: Kysely<Database>): Promise<void> {
  await db.insertInto('import_shipments' as never).values({
    id: 'sh-1', tenant_id: 't1', container_number: 'C1', supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: 'proj-1',
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: 'sh-1-item', tenant_id: 't1', shipment_id: 'sh-1', product_id: 1,
    quantity: 10, factory_unit_price_usd: 50, shortage_handling_method: 'capitalize',
  } as never).execute();
}

async function postReceipt(db: Kysely<Database>, service: any): Promise<number> {
  await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10 });
  const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
  return Number(receipt.id);
}

async function disburse(db: Kysely<Database>, service: any, amount: number, shipmentId?: string): Promise<any> {
  const advance = await service.disburseBrokerAdvance('t1', 1, {
    brokerId: 'br-1', advanceNo: `ADV-${Math.random().toString(36).slice(2, 8)}`, amountEgp: amount,
    projectId: 'proj-1', shipmentId: shipmentId || undefined, paymentMethod: 'bank_transfer', treasuryAccountId: 24,
  });
  return advance;
}

async function liquidate(service: any, advanceId: string, dto: any): Promise<any> {
  return service.liquidateBrokerExpenses('t1', 1, {
    brokerId: 'br-1', advanceId, projectId: 'proj-1', receiptNo: dto.receiptNo,
    category: dto.category, amountEgp: dto.amountEgp,
    shipmentId: dto.shipmentId, isCapitalized: dto.isCapitalized, isRefundableVat: dto.isRefundableVat,
    notes: dto.notes,
  });
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function journalLines(db: Kysely<Database>, entryId: number): Promise<any[]> {
  return (db as any).selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', entryId).execute();
}

async function readShipment(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('import_shipments').selectAll().where('id', '=', 'sh-1').executeTakeFirstOrThrow();
}

async function readProduct(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
}

async function insertApproval(db: Kysely<Database>, id: string, actionType: string, referenceId: string, payload: any): Promise<void> {
  await db.insertInto('import_approval_requests' as never).values({
    id, tenant_id: 't1', module: 'import', action_type: actionType,
    reference_id: referenceId, requested_by: 99, created_by: 99, status: 'approved',
    request_payload: JSON.stringify(payload),
  } as never).execute();
}

async function approvalStatus(db: Kysely<Database>, id: string): Promise<string> {
  const row: any = await (db as any).selectFrom('import_approval_requests').select('status').where('id', '=', id).executeTakeFirstOrThrow();
  return row.status;
}

async function expectReject(promise: Promise<any>, pattern: RegExp, message: string): Promise<void> {
  await assert.rejects(async () => promise, pattern, message);
}

async function main(): Promise<void> {
  // Case 1: pre-receipt liquidation folds into the bucket with no
  // journal and no expenses row, and stays unverified.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const advance = await disburse(db, service, 10000, 'sh-1');
      const journalsBefore = await countRows(db, 'journal_entries');
      const expensesBefore = await countRows(db, 'expenses');
      const expense = await liquidate(service, advance.id, { receiptNo: 'RC-1', category: 'customs_duty', amountEgp: 5000 });
      assert.equal(expense.is_verified, false, 'Liquidation never self-verifies');
      assert.equal(Number(expense.created_by), 1, 'The liquidator is recorded for maker-checker');
      assert.equal(expense.capitalization_state, 'folded', 'Pre-receipt capitalisation folds');
      const shipment = await readShipment(db);
      assert.equal(Number(shipment.customs_cost_egp), 5000, 'The fold increments the customs bucket');
      const link: any = await (db as any).selectFrom('import_broker_capitalizations').selectAll().executeTakeFirstOrThrow();
      assert.equal(link.state, 'folded');
      assert.equal(link.cost_bucket, 'customs_cost_egp');
      assert.equal(Number(link.amount_egp), 5000);
      assert.equal(link.broker_expense_id, expense.id);
      assert.equal(await countRows(db, 'journal_entries'), journalsBefore, 'The fold posts no journal');
      assert.equal(await countRows(db, 'expenses'), expensesBefore, 'The fold creates no expenses row');
      const settled: any = await (db as any).selectFrom('import_broker_advances').selectAll().where('id', '=', advance.id).executeTakeFirstOrThrow();
      assert.equal(Number(settled.settled_amount_egp), 5000, 'Advance bookkeeping still settles');
      assert.equal(Number(settled.remaining_amount_egp), 5000);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: the bucket floor binds, and receipt posting splits
  // the credit and consumes the fold exactly once.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const advance = await disburse(db, service, 10000, 'sh-1');
      const expense = await liquidate(service, advance.id, { receiptNo: 'RC-1', category: 'customs_duty', amountEgp: 5000 });
      await expectReject(
        service.updateShipmentCosts('t1', 1, 'sh-1', { customsCostEgp: 4000 }),
        /IMPORT_BROKER_CAPITALIZATION_FLOOR/,
        'Lowering the bucket below the folded sum must fail closed',
      );
      assert.equal(Number((await readShipment(db)).customs_cost_egp), 5000, 'The rejected floor write leaves the bucket untouched');
      await service.updateShipmentCosts('t1', 1, 'sh-1', { customsCostEgp: 5000 });
      assert.equal(Number((await readShipment(db)).customs_cost_egp), 5000, 'Setting the bucket at the folded sum is allowed');

      const receiptId = await postReceipt(db, service);
      const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('id', '=', receiptId).executeTakeFirstOrThrow();
      const lines = await journalLines(db, Number(receipt.journal_entry_id));
      assert.equal(lines.length, 3, 'Receipt journal: inventory debit + payable credit + advance credit');
      const inventoryLine = lines.find((l) => Number(l.account_id) === 21);
      const payableLine = lines.find((l) => Number(l.account_id) === 22);
      const advanceLine = lines.find((l) => Number(l.account_id) === 25);
      assert.ok(inventoryLine && payableLine && advanceLine, 'All three legs are present');
      assert.equal(Number(inventoryLine.debit), 30000, 'Inventory carries the full landed value');
      assert.equal(Number(payableLine.credit), 25000, 'The supplier is credited only for the non-broker landed value');
      assert.equal(Number(advanceLine.credit), 5000, 'The folded broker cost relieves the advance asset');
      assert.equal(advanceLine.partner_type, 'none', 'The advance leg carries no supplier partner');
      const ledger: any[] = await (db as any).selectFrom('supplier_ledger').selectAll().execute();
      assert.equal(ledger.length, 1, 'One subledger movement for the receipt');
      assert.equal(Number(ledger[0].amount), 25000, 'The subledger rises by the payable only: profit equals GL');
      assert.equal(Number(ledger[0].balance_after), 25000);
      const link: any = await (db as any).selectFrom('import_broker_capitalizations').selectAll().executeTakeFirstOrThrow();
      assert.equal(link.state, 'consumed', 'The fold is consumed by the receipt posting');
      const expenseAfter: any = await (db as any).selectFrom('import_broker_expenses').selectAll().where('id', '=', expense.id).executeTakeFirstOrThrow();
      assert.equal(expenseAfter.capitalization_state, 'consumed', 'The expense row agrees with the link row');
      assert.equal(Number((await readProduct(db)).cost_price), 2500, 'WAC blends 10 @ 2000 with 10 @ 3000 landed');
      const lot: any = await (db as any).selectFrom('import_inventory_lots').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(lot.unit_landed_cost_egp), 3000, 'The lot carries the folded cost');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: post-receipt liquidation revalues through the shared
  // core: WAC, lot and item costs move, one journal credits the
  // advance, one event links back to the broker expense.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await postReceipt(db, service);
      assert.equal(Number((await readProduct(db)).cost_price), 2250, 'Baseline WAC before revaluation');
      const advance = await disburse(db, service, 10000, 'sh-1');
      const journalsBefore = await countRows(db, 'journal_entries');
      const expense = await liquidate(service, advance.id, { receiptNo: 'RC-2', category: 'customs_duty', amountEgp: 4000 });
      assert.equal(expense.capitalization_state, 'revalued');
      assert.equal(Number((await readProduct(db)).cost_price), 2450, 'WAC spreads 4000 over the 20-unit company pool');
      const lot: any = await (db as any).selectFrom('import_inventory_lots').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(lot.unit_landed_cost_egp), 2900, 'The lot unit cost rises by the spread');
      const item: any = await (db as any).selectFrom('import_shipment_items').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(item.landed_cost_egp), 2900, 'The item landed cost rises by the spread');
      const shipment = await readShipment(db);
      assert.equal(Number(shipment.late_expenses_total_egp), 4000, 'Shipment late totals record the revaluation');
      assert.equal(Number(shipment.late_inventory_adjustment_egp), 4000);
      const event: any = await (db as any).selectFrom('import_late_expense_events').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(event.total_amount_egp), 4000);
      assert.equal(Number(event.inventory_amount_egp), 4000);
      assert.equal(Number(event.cogs_amount_egp), 0);
      assert.equal(event.broker_expense_id, expense.id, 'The event links back to the broker expense');
      assert.equal(await countRows(db, 'journal_entries'), journalsBefore + 1, 'Exactly one revaluation journal');
      const entry: any = await (db as any).selectFrom('journal_entries').selectAll().orderBy('id', 'desc').executeTakeFirstOrThrow();
      assert.equal(entry.source_type, 'import_broker_capitalization', 'The revaluation journal is not a broker-expense journal');
      const lines = await journalLines(db, Number(entry.id));
      assert.equal(lines.length, 2);
      assert.equal(Number(lines.find((l) => Number(l.account_id) === 21).debit), 4000);
      assert.equal(Number(lines.find((l) => Number(l.account_id) === 25).credit), 4000, 'The revaluation relieves the advance asset');
      const brokerJournals: any[] = await (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', 'import_broker_expense').execute();
      assert.equal(brokerJournals.length, 0, 'No separate lump-sum broker journal exists for the capitalised portion');
      const link: any = await (db as any).selectFrom('import_broker_capitalizations').selectAll().executeTakeFirstOrThrow();
      assert.equal(link.state, 'revalued');
      assert.equal(Number(link.late_expense_event_id), Number(event.id));
      const expenseAfter: any = await (db as any).selectFrom('import_broker_expenses').selectAll().where('id', '=', expense.id).executeTakeFirstOrThrow();
      assert.equal(Number(expenseAfter.late_expense_event_id), Number(event.id), 'The expense row links to its event');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: refundable VAT is a tax asset, never capitalised.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const advance = await disburse(db, service, 5000, 'sh-1');
      const expense = await liquidate(service, advance.id, { receiptNo: 'RC-VAT', category: 'vat', amountEgp: 1000, isRefundableVat: true });
      assert.equal(expense.capitalization_state, 'vat_asset');
      assert.equal(Number((await readShipment(db)).customs_cost_egp), 0, 'VAT never folds into a cost bucket');
      assert.equal(await countRows(db, 'import_broker_capitalizations'), 0, 'No capitalisation link for a tax asset');
      const entries: any[] = await (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', 'import_broker_expense').execute();
      assert.equal(entries.length, 1);
      const lines = await journalLines(db, Number(entries[0].id));
      assert.equal(Number(lines.find((l) => Number(l.account_id) === 26).debit), 1000, 'VAT-receivable debited');
      assert.equal(Number(lines.find((l) => Number(l.account_id) === 25).credit), 1000, 'Advance relieved');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: a non-capitalised expense is a period COGS expense.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const advance = await disburse(db, service, 5000, 'sh-1');
      const expense = await liquidate(service, advance.id, { receiptNo: 'RC-EXP', category: 'broker_fee', amountEgp: 800, isCapitalized: false });
      assert.equal(expense.capitalization_state, 'expensed');
      assert.equal(await countRows(db, 'import_broker_capitalizations'), 0, 'No capitalisation link for a period expense');
      const entries: any[] = await (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', 'import_broker_expense').execute();
      assert.equal(entries.length, 1);
      const lines = await journalLines(db, Number(entries[0].id));
      assert.equal(Number(lines.find((l) => Number(l.account_id) === 23).debit), 800, 'COGS debited');
      assert.equal(Number(lines.find((l) => Number(l.account_id) === 25).credit), 800, 'Advance relieved');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: capitalised with no shipment fails closed before any
  // write; the advance is untouched.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const advance = await disburse(db, service, 10000);
      await expectReject(
        liquidate(service, advance.id, { receiptNo: 'RC-NOSHIP', category: 'customs_duty', amountEgp: 1000 }),
        /IMPORT_BROKER_EXPENSE_NO_SHIPMENT/,
        'A capitalised expense with no shipment must fail closed',
      );
      assert.equal(await countRows(db, 'import_broker_expenses'), 0, 'No expense row is written');
      const after: any = await (db as any).selectFrom('import_broker_advances').selectAll().where('id', '=', advance.id).executeTakeFirstOrThrow();
      assert.equal(Number(after.remaining_amount_egp), 10000, 'The advance is untouched by a rejected liquidation');
    } finally {
      await db.destroy();
    }
  }

  // Case 7: 'other' and non-refundable VAT have no pre-receipt
  // bucket and fail closed before receipt.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const advance = await disburse(db, service, 10000, 'sh-1');
      await expectReject(
        liquidate(service, advance.id, { receiptNo: 'RC-OTHER', category: 'other', amountEgp: 1000 }),
        /IMPORT_BROKER_EXPENSE_NO_BUCKET/,
        "'other' has no cost bucket before receipt",
      );
      await expectReject(
        liquidate(service, advance.id, { receiptNo: 'RC-VATNR', category: 'vat', amountEgp: 1000, isRefundableVat: false }),
        /IMPORT_BROKER_EXPENSE_NO_BUCKET/,
        'Non-refundable VAT has no bucket before receipt',
      );
      assert.equal(await countRows(db, 'import_broker_expenses'), 0, 'Neither rejected liquidation writes a row');
    } finally {
      await db.destroy();
    }
  }

  // Case 8: maker-checker verification — the liquidator cannot
  // verify, a foreign token cannot verify, a second user can,
  // and a second verification conflicts.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const advance = await disburse(db, service, 10000, 'sh-1');
      const expenseA = await liquidate(service, advance.id, { receiptNo: 'RC-V1', category: 'broker_fee', amountEgp: 1000, isCapitalized: false });
      const expenseB = await liquidate(service, advance.id, { receiptNo: 'RC-V2', category: 'broker_fee', amountEgp: 2000, isCapitalized: false });
      await insertApproval(db, 'tok-1', 'broker_expense_verification', expenseA.id, { brokerExpenseId: expenseA.id, amount: 1000 });
      await insertApproval(db, 'tok-2', 'broker_expense_verification', expenseA.id, { brokerExpenseId: expenseA.id, amount: 1000 });
      await insertApproval(db, 'tok-3', 'broker_expense_verification', expenseB.id, { brokerExpenseId: expenseB.id, amount: 2000 });
      await expectReject(
        service.verifyBrokerExpense('t1', 1, expenseA.id, { approvalRequestId: 'tok-1' }),
        /Maker-Checker/,
        'The liquidator must not verify their own expense',
      );
      assert.equal(await approvalStatus(db, 'tok-1'), 'approved', 'The rejected self-verification does not consume the token');
      await expectReject(
        service.verifyBrokerExpense('t1', 2, expenseB.id, { approvalRequestId: 'tok-2' }),
        /مرتبط بمرجع/,
        'A token bound to another expense must not verify this one',
      );
      assert.equal(await approvalStatus(db, 'tok-2'), 'approved', 'The rejected foreign token is not consumed');
      const verified = await service.verifyBrokerExpense('t1', 2, expenseA.id, { approvalRequestId: 'tok-1' });
      assert.equal(verified.is_verified, true, 'A second user verifies with a bound token');
      assert.equal(Number(verified.verified_by), 2);
      assert.equal(await approvalStatus(db, 'tok-1'), 'executed', 'The verification token is single-use');
      await expectReject(
        service.verifyBrokerExpense('t1', 2, expenseA.id, { approvalRequestId: 'tok-1' }),
        /مسبقاً/,
        'A second verification conflicts',
      );
      const verifiedB = await service.verifyBrokerExpense('t1', 2, expenseB.id, { approvalRequestId: 'tok-3' });
      assert.equal(verifiedB.is_verified, true, 'A token bound to its own expense verifies it for a second user');
    } finally {
      await db.destroy();
    }
  }

  // Case 9: closeProject is blocked by an unverified broker
  // expense, and proceeds past the gate once it is verified.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await postReceipt(db, service);
      const advance = await disburse(db, service, 3000, 'sh-1');
      const expense = await liquidate(service, advance.id, { receiptNo: 'RC-CL', category: 'customs_duty', amountEgp: 3000 });
      await insertApproval(db, 'tok-close', 'project_closure', 'proj-1', {});
      await expectReject(
        service.closeProject('t1', 1, 'proj-1', 'tok-close'),
        /غير متحقق/,
        'An unverified broker expense blocks project closure',
      );
      await insertApproval(db, 'tok-verify', 'broker_expense_verification', expense.id, { brokerExpenseId: expense.id, amount: 3000 });
      await service.verifyBrokerExpense('t1', 2, expense.id, { approvalRequestId: 'tok-verify' });
      await insertApproval(db, 'tok-close-2', 'project_closure', 'proj-1', {});
      await expectReject(
        service.closeProject('t1', 1, 'proj-1', 'tok-close-2'),
        /رصيد مخزني غير مباع/,
        'After verification the closure proceeds past the gate to the later stock guard',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 10: the pure bucket engine maps every category.
  {
    assert.equal(resolveBrokerCapitalizationBucket('customs_duty', false).bucket, 'customs_cost_egp');
    assert.equal(resolveBrokerCapitalizationBucket('port_fees', false).bucket, 'customs_cost_egp');
    assert.equal(resolveBrokerCapitalizationBucket('inspection', false).bucket, 'customs_cost_egp');
    assert.equal(resolveBrokerCapitalizationBucket('broker_fee', false).bucket, 'customs_cost_egp');
    assert.equal(resolveBrokerCapitalizationBucket('demurrage', false).bucket, 'actual_demurrage_fees');
    assert.equal(resolveBrokerCapitalizationBucket('transport', false).bucket, 'internal_transport_cost_egp');
    assert.equal(resolveBrokerCapitalizationBucket('vat', true).bucket, null);
    assert.equal(resolveBrokerCapitalizationBucket('vat', true).reason, 'vat_asset');
    assert.equal(resolveBrokerCapitalizationBucket('vat', false).bucket, null);
    assert.equal(resolveBrokerCapitalizationBucket('vat', false).reason, 'no_bucket');
    assert.equal(resolveBrokerCapitalizationBucket('other', false).bucket, null);
    assert.equal(resolveBrokerCapitalizationBucket('other', false).reason, 'no_bucket');
    assert.equal(resolveBrokerCapitalizationBucket('unknown_category', false).bucket, null);
  }

  console.log('Import broker capitalisation tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
