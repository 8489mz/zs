/*
New file: backend/test/critical/import-supplier-attribution.spec.ts
Pins explicit payee attribution per cost component
(INV-IMPORT-SUPPLIER-ATTRIBUTION).

WHAT WAS WRONG: a posted import receipt credited the WHOLE landed
value (goods + freight + customs + transport + demurrage) to one
payable line attributed to the goods supplier, so the goods
supplier's subledger was overstated by every other component and
the carrier / customs / transporter payees had no subledger
record at all. A late expense did the same: its whole amount was
credited to the goods supplier whatever the expense really was.

WHAT THIS PINS, driving the real updateShipmentCosts /
processLateShipmentExpense on PGlite through the real posting
boundary:
- A receipt splits its credit into one line per nonzero cost
  component, each attributed to its explicit payee; the lines
  sum to exactly the old single-line total, the journal
  balances, and every supplier subledger agrees with its own
  component (goods 25000 / freight 5000 / customs 2000 /
  transport 1000), with no clearing line.
- A nonzero component with no payee and no recorded unallocable
  reason fails closed with IMPORT_COMPONENT_PAYEE_REQUIRED
  before any write: no receipt, no journal, no stock.
- A component with a recorded unallocable reason posts to the
  tenant-designated clearing account, labelled with the reason,
  partner-less — and no supplier subledger carries it.
- A late expense with no payee and no reason fails closed with
  IMPORT_LATE_EXPENSE_PAYEE_REQUIRED; with an explicit payee
  its credit lands on that supplier's subledger and the event
  records the payee; with a recorded reason it posts to
  clearing and the event records the reason with a NULL payee.
- A clearing account designated as a control account (code
  2110) fails closed at resolve time: the clearing role never
  accepts a flagged control account.
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
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, clearing_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, status text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, freight_supplier_id bigint, customs_supplier_id bigint, transport_supplier_id bigint, demurrage_supplier_id bigint, unallocable_cost_reason text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_inventory_receipt_reversals (id bigserial PRIMARY KEY, tenant_id text, receipt_id bigint, shipment_id text, approval_request_id text, journal_entry_id bigint, reason text, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, receipt_id));
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id text PRIMARY KEY DEFAULT ('alloc-' || md5(random()::text)), tenant_id text, sale_id bigint, sale_item_id bigint, lot_id text, project_id text, shipment_id text, product_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, gross_margin_egp numeric, allocation_type text, reversal_of_allocation_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text, supplier_id bigint, unallocable_reason text);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings (id, tenant_id, customer_receivable_account_id, supplier_payable_account_id, inventory_account_id, sales_revenue_account_id, cogs_account_id, clearing_account_id, updated_at) VALUES (1, 't1', 25, 22, 21, 26, 23, 27, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '1120', 'عملاء', 'Receivables', 'asset', 'assets', true, false, false, false, true, false),
      (26, 't1', 't1', '4100', 'إيراد مبيعات', 'Sales revenue', 'revenue', 'income', true, false, false, false, false, false),
      (27, 't1', 't1', '2190', 'حساب تسوية', 'Clearing', 'liability', 'liabilities', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES
      (1, 't1', 't1', 'Goods Supplier', '', '', 0, true, NOW()),
      (2, 't1', 't1', 'Carrier', '', '', 0, true, NOW()),
      (3, 't1', 't1', 'Customs Broker', '', '', 0, true, NOW()),
      (4, 't1', 't1', 'Transporter', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO branches VALUES (1, 't1', 'Main Branch');
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'active', '{}');
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 'W-1', NULL, 0, 0, 0, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 0, 0),
      ('t1', 't1', 1, NULL, NULL, 0, 0);
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

async function postReceipt(db: Kysely<Database>, service: any, extra: Record<string, unknown> = {}): Promise<void> {
  await service.updateShipmentCosts('t1', 1, 'sh-1', {
    status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
    shippingCostUsd: 100, customsCostEgp: 2000, internalTransportCostEgp: 1000,
    freightSupplierId: 2, customsSupplierId: 3, transportSupplierId: 4,
    ...extra,
  });
  const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
  assert.equal(receipt.state, 'posted');
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select(sql`count(*)`.as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function receiptJournalLines(db: Kysely<Database>): Promise<any[]> {
  const entry: any = await (db as any).selectFrom('journal_entries').selectAll()
    .where('source_type', '=', 'import_inventory_receipt').executeTakeFirstOrThrow();
  return (db as any).selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', entry.id).orderBy('id').execute();
}

async function supplierLedgerTotal(db: Kysely<Database>, supplierId: number): Promise<number> {
  const rows: any[] = await (db as any).selectFrom('supplier_ledger').select('amount')
    .where('supplier_id', '=', supplierId).execute();
  return rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
}

async function main(): Promise<void> {
  // Case A: the receipt credit splits per component, each to its explicit payee.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await postReceipt(db, service);
      const lines = await receiptJournalLines(db);
      const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.equal(debit, credit, 'Receipt journal must balance');
      assert.equal(debit, 33000, 'Goods 25000 + freight 5000 + customs 2000 + transport 1000');
      const creditsByPartner = new Map<number, number>();
      for (const line of lines) {
        if (Number(line.credit) > 0) creditsByPartner.set(Number(line.partner_id), (creditsByPartner.get(Number(line.partner_id)) || 0) + Number(line.credit));
      }
      assert.equal(creditsByPartner.get(1), 25000, 'Goods supplier carries only the goods value');
      assert.equal(creditsByPartner.get(2), 5000, 'Carrier carries the freight');
      assert.equal(creditsByPartner.get(3), 2000, 'Customs broker carries customs');
      assert.equal(creditsByPartner.get(4), 1000, 'Transporter carries transport');
      assert.equal(creditsByPartner.size, 4, 'No clearing or unattributed credit line');
      assert.equal(await supplierLedgerTotal(db, 1), 25000, 'Goods supplier subledger agrees');
      assert.equal(await supplierLedgerTotal(db, 2), 5000, 'Carrier subledger agrees');
      assert.equal(await supplierLedgerTotal(db, 3), 2000, 'Customs subledger agrees');
      assert.equal(await supplierLedgerTotal(db, 4), 1000, 'Transporter subledger agrees');
      console.log('Case A passed: receipt credit splits per component to explicit payees');
    } finally {
      await db.destroy();
    }
  }

  // Case B: a nonzero component with no payee and no reason fails closed with zero writes.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', {
          status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
          shippingCostUsd: 100, customsCostEgp: 2000, internalTransportCostEgp: 1000,
          freightSupplierId: 2, transportSupplierId: 4,
        }),
        /IMPORT_COMPONENT_PAYEE_REQUIRED/,
      );
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'No receipt may exist after a refused posting');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may exist after a refused posting');
      assert.equal(await countRows(db, 'stock_movements'), 0, 'No stock movement may exist after a refused posting');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 0, 'Stock stays zero after a refused posting');
      console.log('Case B passed: unattributed customs component fails closed with zero writes');
    } finally {
      await db.destroy();
    }
  }

  // Case C: a recorded unallocable reason routes the component to clearing, labelled.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await postReceipt(db, service, { customsSupplierId: undefined, unallocableCostReason: 'رسوم ميناء بلا فاتورة مورد محدد' });
      const lines = await receiptJournalLines(db);
      const clearingLines = lines.filter((l) => Number(l.account_id) === 27);
      assert.equal(clearingLines.length, 1, 'Exactly one clearing line');
      assert.equal(Number(clearingLines[0].credit), 2000, 'Clearing carries the customs amount');
      assert.equal(clearingLines[0].partner_type, 'none', 'Clearing line has no partner');
      assert.equal(clearingLines[0].partner_id, null, 'Clearing line has no partner id');
      assert.match(String(clearingLines[0].description), /رسوم ميناء بلا فاتورة مورد محدد/, 'Clearing line is labelled with the recorded reason');
      assert.equal(await supplierLedgerTotal(db, 1), 25000, 'Goods supplier carries only goods');
      assert.equal(await supplierLedgerTotal(db, 3), 0, 'No supplier subledger carries the unallocable customs fee');
      console.log('Case C passed: unallocable component posts to clearing, labelled with its reason');
    } finally {
      await db.destroy();
    }
  }

  // Case D: late expenses need an explicit payee or a recorded reason.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await postReceipt(db, service);
      await assert.rejects(
        service.processLateShipmentExpense('t1', 1, 'sh-1', { lateExpenseAmount: 1000, title: 'Demurrage' }),
        /IMPORT_LATE_EXPENSE_PAYEE_REQUIRED/,
        'A late expense with no payee must not default to the goods supplier',
      );
      assert.equal(await countRows(db, 'journal_entries'), 1, 'Only the receipt journal exists after the refused late expense');
      const first = await service.processLateShipmentExpense('t1', 1, 'sh-1', {
        lateExpenseAmount: 1000, title: 'Demurrage', supplierId: 2, idempotencyKey: 'late-payee-1',
      });
      assert.equal(first.success, true);
      const second = await service.processLateShipmentExpense('t1', 1, 'sh-1', {
        lateExpenseAmount: 500, title: 'Port storage', unallocableReason: 'إيصال ميناء نقدي بلا مورد', idempotencyKey: 'late-clearing-1',
      });
      assert.equal(second.success, true);
      const lateLines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll()
        .where('journal_entry_id', 'in', (eb: any) => eb.selectFrom('journal_entries').select('id').where('source_type', '=', 'import_late_expense'))
        .orderBy('id').execute();
      const carrierCredit = lateLines.find((l) => Number(l.partner_id) === 2);
      assert.equal(Number(carrierCredit.credit), 1000, 'Explicit-payee late expense credits the named supplier');
      const clearingCredit = lateLines.find((l) => Number(l.account_id) === 27);
      assert.equal(Number(clearingCredit.credit), 500, 'Unallocable late expense credits clearing');
      assert.match(String(clearingCredit.description), /إيصال ميناء نقدي بلا مورد/, 'Clearing late-expense line carries its reason');
      const events: any[] = await (db as any).selectFrom('import_late_expense_events').selectAll().orderBy('id').execute();
      assert.equal(events.length, 2);
      assert.equal(Number(events[0].supplier_id), 2, 'First event records its payee');
      assert.equal(events[0].unallocable_reason, null);
      assert.equal(events[1].supplier_id, null, 'Clearing event records no payee');
      assert.equal(events[1].unallocable_reason, 'إيصال ميناء نقدي بلا مورد', 'Clearing event records its reason');
      assert.equal(await supplierLedgerTotal(db, 2), 6000, 'Carrier subledger: freight 5000 + late expense 1000');
      assert.equal(await supplierLedgerTotal(db, 1), 25000, 'Goods supplier subledger untouched by late expenses');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(product.cost_price), 3450, 'WAC: 3300 full landed cost + (1000 + 500) / 10 on hand');
      console.log('Case D passed: late expenses carry explicit payees or recorded clearing reasons');
    } finally {
      await db.destroy();
    }
  }

  // Case E: designating a control account as the clearing account fails closed at resolve time.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await (db as any).updateTable('accounting_settings').set({ clearing_account_id: 22 }).where('tenant_id', '=', 't1').execute();
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', {
          status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
          shippingCostUsd: 100, customsCostEgp: 2000, internalTransportCostEgp: 1000,
          freightSupplierId: 2, transportSupplierId: 4,
          unallocableCostReason: 'رسوم بلا مورد',
        }),
        /clearing/,
        'A control account must never serve as the clearing account',
      );
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
      console.log('Case E passed: control account rejected as the clearing account');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import supplier attribution tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
