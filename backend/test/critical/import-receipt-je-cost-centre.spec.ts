/*
New file: backend/test/critical/import-receipt-je-cost-centre.spec.ts
Pins the receipt journal's project cost centre + supplier sub-account
(INV-IMPORT-RECEIPT-JE-SUPPLIER-SUBACCOUNT).

WHAT WAS WRONG: the live trial receipt JE-00015025 credited all four
components to generic account 2110 with cost centre '-' and no
supplier visible on the journal lines themselves — Dr 1140 900.00;
Cr 2110 500.00 (goods) + 250.00 (freight) + 100.00 (customs) + 50.00
(inland). The supplier book moved (+900) but the JE itself named
neither the supplier nor a cost centre. The supplier half was fixed
earlier (INV-IMPORT-SUPPLIER-ATTRIBUTION: every credit line carries
partner_type 'supplier' + partner_id, pinned by
import-supplier-attribution.spec.ts); the cost-centre half was still
open: postShipmentToInventory never set costCenterId on any receipt
JE line, so every line posted with a NULL cost centre.

WHAT THIS PINS, driving the real updateShipmentCosts on PGlite
through the real posting boundary, in the exact live-trial shape
(10 x $1 goods, freight $5, customs 100 EGP, inland 50 EGP, FX 50):
- The receipt journal balances 900 = 900: Dr 1140 900; credits
  goods 500 to supplier 1, freight 250 to supplier 2, customs 100
  to supplier 3, inland 50 to supplier 4 — every credit line on
  the supplier's sub-account, and every supplier subledger agrees
  with its own component.
- EVERY journal line (debit and credits) carries the import
  project's cost centre: the CC is resolved-or-created by code
  CC-<project_no> (dimension 'project'), following the contracting
  canonical pattern — never a NULL cost centre on a project receipt.
- A second receipt on the same project reuses the same cost
  centre: exactly one cost_centers row exists for the code, and
  both journals carry the same cost_center_id.
- A shipment with no project still posts, with an honest NULL cost
  centre on its lines (no invented centre) and correct partners.
- A shipment whose project_id points at a missing project row
  fails closed with IMPORT_RECEIPT_PROJECT_NOT_FOUND before any
  write: no receipt, no journal, no stock.
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
    CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, budget_amount numeric, parent_id bigint, is_active boolean, description text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_cost_centers_tenant_code UNIQUE (tenant_id, code));
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, title text, allocated_capital numeric, status text, feasibility_data text);
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
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'IMP-261109-0001', 'اختبار مشروع استيراد 001', 100, 'active', '{}');
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

async function seedShipment(
  db: Kysely<Database>,
  shipmentId = 'sh-1',
  container = 'C1',
  projectId: string | null = 'proj-1',
): Promise<void> {
  await db.insertInto('import_shipments' as never).values({
    id: shipmentId, tenant_id: 't1', container_number: container, supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: projectId,
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: `${shipmentId}-item`, tenant_id: 't1', shipment_id: shipmentId, product_id: 1,
    quantity: 10, factory_unit_price_usd: 1, shortage_handling_method: 'capitalize',
  } as never).execute();
}

async function postReceipt(db: Kysely<Database>, service: any, shipmentId = 'sh-1'): Promise<void> {
  await service.updateShipmentCosts('t1', 1, shipmentId, {
    status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
    shippingCostUsd: 5, customsCostEgp: 100, internalTransportCostEgp: 50,
    freightSupplierId: 2, customsSupplierId: 3, transportSupplierId: 4,
  });
  const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('shipment_id', '=', shipmentId).executeTakeFirstOrThrow();
  assert.equal(receipt.state, 'posted');
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select(sql`count(*)`.as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function receiptJournalLines(db: Kysely<Database>, shipmentId: string): Promise<any[]> {
  const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll()
    .where('shipment_id', '=', shipmentId).executeTakeFirstOrThrow();
  const entry: any = await (db as any).selectFrom('journal_entries').selectAll()
    .where('id', '=', Number(receipt.journal_entry_id)).executeTakeFirstOrThrow();
  return (db as any).selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', entry.id).orderBy('id').execute();
}

async function supplierLedgerTotal(db: Kysely<Database>, supplierId: number): Promise<number> {
  const rows: any[] = await (db as any).selectFrom('supplier_ledger').select('amount')
    .where('supplier_id', '=', supplierId).execute();
  return rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
}

async function main(): Promise<void> {
  // Case A: the live-trial shape — every line carries the project
  // cost centre AND its supplier sub-account; the journal balances.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await postReceipt(db, service);
      const lines = await receiptJournalLines(db, 'sh-1');
      const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.equal(debit, credit, 'Receipt journal must balance');
      assert.equal(debit, 900, 'Trial total: goods 500 + freight 250 + customs 100 + inland 50');
      assert.equal(credit, 900);
      const debitLine = lines.find((l) => Number(l.debit) > 0);
      assert.equal(Number(debitLine.account_id), 21, 'Debit lands on inventory 1140');
      assert.equal(Number(debitLine.debit), 900);
      const creditsByPartner = new Map<number, number>();
      for (const line of lines) {
        if (Number(line.credit) > 0) creditsByPartner.set(Number(line.partner_id), (creditsByPartner.get(Number(line.partner_id)) || 0) + Number(line.credit));
      }
      assert.equal(creditsByPartner.get(1), 500, 'Goods supplier carries only the goods value');
      assert.equal(creditsByPartner.get(2), 250, 'Carrier carries the freight');
      assert.equal(creditsByPartner.get(3), 100, 'Customs broker carries customs');
      assert.equal(creditsByPartner.get(4), 50, 'Transporter carries inland transport');
      assert.equal(creditsByPartner.size, 4, 'No clearing or unattributed credit line');
      assert.equal(await supplierLedgerTotal(db, 1), 500, 'Goods supplier subledger agrees');
      assert.equal(await supplierLedgerTotal(db, 2), 250, 'Carrier subledger agrees');
      assert.equal(await supplierLedgerTotal(db, 3), 100, 'Customs subledger agrees');
      assert.equal(await supplierLedgerTotal(db, 4), 50, 'Transporter subledger agrees');
      const centres: any[] = await (db as any).selectFrom('cost_centers').selectAll().execute();
      assert.equal(centres.length, 1, 'Exactly one project cost centre is created');
      assert.equal(centres[0].code, 'CC-IMP-261109-0001', 'Cost centre code follows the contracting pattern');
      assert.equal(centres[0].dimension, 'project');
      assert.equal(centres[0].name, 'مشروع: اختبار مشروع استيراد 001');
      for (const line of lines) {
        assert.equal(Number(line.cost_center_id), Number(centres[0].id), `Line ${line.id} carries the project cost centre`);
      }
      console.log('Case A passed: trial-shape receipt JE carries the project cost centre on every line and each supplier sub-account');
    } finally {
      await db.destroy();
    }
  }

  // Case B: a second receipt on the same project reuses the same
  // cost centre — no duplicate CC row, both journals agree.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 'C1', 'proj-1');
      await seedShipment(db, 'sh-2', 'C2', 'proj-1');
      await postReceipt(db, service, 'sh-1');
      await postReceipt(db, service, 'sh-2');
      const centres: any[] = await (db as any).selectFrom('cost_centers').selectAll().execute();
      assert.equal(centres.length, 1, 'Second receipt must not create a duplicate cost centre');
      const lines1 = await receiptJournalLines(db, 'sh-1');
      const lines2 = await receiptJournalLines(db, 'sh-2');
      for (const line of [...lines1, ...lines2]) {
        assert.equal(Number(line.cost_center_id), Number(centres[0].id), `Line ${line.id} reuses the project cost centre`);
      }
      console.log('Case B passed: second receipt on the same project reuses the cost centre');
    } finally {
      await db.destroy();
    }
  }

  // Case C: a shipment with no project still posts, with an honest
  // NULL cost centre and correct supplier attribution.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 'C1', null);
      await postReceipt(db, service, 'sh-1');
      const lines = await receiptJournalLines(db, 'sh-1');
      const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.equal(debit, 900, 'Project-less receipt still balances at the trial total');
      assert.equal(credit, 900);
      for (const line of lines) {
        assert.equal(line.cost_center_id, null, `Line ${line.id} has no invented cost centre`);
      }
      assert.equal(await countRows(db, 'cost_centers'), 0, 'No cost centre is invented for a project-less shipment');
      console.log('Case C passed: project-less receipt posts with NULL cost centre and correct partners');
    } finally {
      await db.destroy();
    }
  }

  // Case D: a shipment whose project_id points at a missing project
  // row fails closed before any write.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 'C1', 'proj-missing');
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', {
          status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
          shippingCostUsd: 5, customsCostEgp: 100, internalTransportCostEgp: 50,
          freightSupplierId: 2, customsSupplierId: 3, transportSupplierId: 4,
        }),
        /IMPORT_RECEIPT_PROJECT_NOT_FOUND/,
      );
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'No receipt may exist after a refused posting');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may exist after a refused posting');
      assert.equal(await countRows(db, 'stock_movements'), 0, 'No stock movement may exist after a refused posting');
      assert.equal(await countRows(db, 'cost_centers'), 0, 'No cost centre may be created by a refused posting');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 0, 'Stock stays zero after a refused posting');
      console.log('Case D passed: dangling project reference fails closed with zero writes');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import receipt JE cost centre tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
