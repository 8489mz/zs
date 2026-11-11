/*
 * GRN real quarantine (INV-GRN-REAL-QUARANTINE).
 *
 * THE DEFECT, grounded at 9b1938a2: quarantine was name-only.
 * `createGoodsReceipt` checked and stored `quarantineLocationId`
 * (goods-receipt.service.ts:181-185, 265), but the acceptance loop
 * in `postGoodsReceipt` posted ALL accepted qty to `grn.locationId`
 * via `applyStockDelta` — the quarantine id never appeared in the
 * acceptance path. There was no `quarantine` location type
 * (database.types.ts:338), and `recordInspection` wrote an NCR only
 * and moved no stock. Result: quarantined goods entered normal stock
 * and were sellable immediately.
 *
 * THE FIX: a real `quarantine` location type (migration 0316), the
 * acceptance loop posts quarantined lines to the quarantine location
 * (global stock and the WAC still move — the goods are owned
 * inventory and the GRNI journal Dr 1140 / Cr 2125 posts on receipt
 * exactly as before; only the location leg changes), the sales
 * availability reads exclude quarantine exactly like `damaged` and
 * `in_transit`, and a passed goods-receipt QA inspection releases the
 * approved quantity quarantine -> normal warehouse through the
 * canonical transfer legs, in the same transaction as the inspection,
 * with no second journal.
 *
 * THE WORKED EXAMPLE, closed exactly: fresh product, GRN 10 units @
 * 100 with quarantineLocationId = the quarantine location. Posting
 * puts 10 in quarantine and 0 in the normal warehouse, global stock
 * 10, WAC 100, journal Dr 1140 1000 / Cr 2125 1000. The sales reads
 * still say 0 sellable (the global figure says 10 — that is the
 * trap this fix closes at the location reads, not by hiding owned
 * inventory). QA approval of 10 releases 10 to the normal warehouse
 * (quarantine 0, normal 10, global still 10, no second journal).
 *
 * WHAT THIS PINS, driving the REAL GoodsReceiptService and the REAL
 * QualityAssuranceService.recordInspection on PGlite:
 * - Case 1: quarantined receipt posts to quarantine, zero to normal.
 * - Case 2: quarantined qty is not sellable by the sales path's own
 *   reads (ledger getLocationAvailability at the normal warehouse =
 *   0; resolveBranchSellableLocations excludes the quarantine
 *   location; availableAcrossLocations over sellable locations = 0).
 * - Case 3: QA approval moves 10 quarantine -> normal with a
 *   transfer_send / transfer_receive pair and no second journal.
 * - Case 4: approval with the target warehouse deleted fails closed
 *   — no inspection row, no movement, quarantine still 10.
 * - Case 5: a sellable location named as quarantine is rejected at
 *   creation; a plain receipt without quarantine still posts to the
 *   normal warehouse; migration 0316 applies cleanly and its CHECK
 *   admits 'quarantine' and rejects 'bogus'.
 * - Case 6: source pins — the services, the sellable-locations
 *   engine, the sales-write guards, the location create/update
 *   allowlists and the locations UI all name 'quarantine'.
 *
 * DELIBERATELY UNCHANGED: the GRNI journal (one entry per receipt,
 * at the receipt warehouse — mixed lines cannot split it); the WAC
 * writer (valueStockReceipt stays the single writer); the canonical
 * ledger (the release reuses relocateStockBetweenLocations and the
 * classified location-only transfer types — a new movement type
 * would throw in stockMovementGlobalDelta); sales orders (their
 * warehouse picker has no location-type guard at all, pre-existing,
 * for damaged too — flagged, not fixed here); location-less sales
 * (the no-location fallback reads the global figure, which counts
 * owned quarantined stock — the location-scoped paths above are the
 * real sales paths). Not a live-Postgres or live-POS proof.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { GoodsReceiptService } from '../../src/modules/purchases/services/goods-receipt.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { QualityAssuranceService } from '../../src/modules/inventory/services/quality-assurance.service';
import { getLocationAvailability } from '../../src/common/utils/location-stock-ledger';
import {
  availableAcrossLocations,
  resolveBranchSellableLocations,
} from '../../src/common/engines/branch-sellable-locations.engine';
import { migration as quarantineMigration } from '../../src/database/migrations/2040000000316_quarantine_location_type';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'tester', permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, location_type text, is_active boolean DEFAULT true);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
      name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
      allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '', account_type text DEFAULT '',
      normal_balance text DEFAULT '', is_system boolean DEFAULT false,
      is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false);
    CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
      bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
      inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
      cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
      purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
      lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
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
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text,
      stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0,
      track_serials boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE suppliers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE supplier_payment_schedules (id bigserial PRIMARY KEY, tenant_id text, purchase_id bigint,
      paid_amount numeric DEFAULT 0, status text DEFAULT 'active', updated_by bigint, updated_at timestamptz);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint,
      payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, tax_rate numeric DEFAULT 0,
      prices_include_tax boolean DEFAULT false, total numeric, paid_amount numeric DEFAULT 0,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      grn_id bigint, po_id bigint, lifecycle_status text, matched_status text, three_way_match_status text,
      status text DEFAULT 'posted', supplier_invoice_no text,
      landed_cost_applied_at timestamptz, landed_cost_total numeric DEFAULT 0,
      cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, updated_at timestamptz);
    CREATE TABLE purchase_items (id bigint PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint, product_id bigint,
      product_name text, qty numeric, unit_cost numeric, unit_multiplier numeric DEFAULT 1, line_total numeric,
      unit_name text, category_id bigint, location_id bigint, batch_number text, serials text,
      grn_line_id bigint, grni_amount numeric, po_item_id bigint, received_qty numeric DEFAULT 0);
    CREATE TABLE purchase_orders (id bigint PRIMARY KEY, tenant_id text, account_id text, order_number text,
      supplier_id bigint, supplier_name text, supplier_phone text, warehouse_id bigint, warehouse_name text,
      subtotal numeric DEFAULT 0, tax_amount numeric DEFAULT 0, discount_amount numeric DEFAULT 0, total_amount numeric DEFAULT 0,
      status text DEFAULT 'draft', expected_delivery_date date, converted_purchase_id bigint, notes text,
      created_by bigint, created_at timestamptz DEFAULT '2026-10-01', updated_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE purchase_order_items (id bigint PRIMARY KEY, tenant_id text, account_id text, purchase_order_id bigint,
      product_id bigint, product_name text, unit_name text, quantity numeric, received_quantity numeric DEFAULT 0,
      unit_cost numeric DEFAULT 0, tax_rate numeric DEFAULT 0, discount numeric DEFAULT 0, total numeric DEFAULT 0,
      notes text, created_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE goods_receipt_notes (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, doc_no text,
      purchase_order_id bigint, supplier_id bigint, location_id bigint, received_at timestamptz,
      received_by bigint, supplier_delivery_note_ref text, status text DEFAULT 'draft', notes text,
      freight_amount numeric DEFAULT 0,
      grni_journal_entry_id bigint, pending_review boolean NOT NULL DEFAULT FALSE, pending_review_reason text,
      created_at timestamptz DEFAULT '2026-10-01', updated_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE goods_receipt_lines (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, grn_id bigint,
      purchase_order_item_id bigint, product_id bigint, ordered_qty numeric, received_qty numeric,
      accepted_qty numeric, rejected_qty numeric, rejection_reason text, batch_number text,
      expiry_date date, manufacturing_date date, unit_cost numeric, allocated_landed_cost numeric DEFAULT 0,
      landed_unit_cost numeric, quarantine_location_id bigint,
      coa_document_id bigint, over_received_qty numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric,
      reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, serial_number text,
      imei_2 text, status text, product_id bigint, purchase_id bigint, purchase_item_id bigint,
      location_id bigint, branch_id bigint, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint,
      batch_number text, expiry_date date, quantity numeric DEFAULT 0, unit_cost numeric, location_id bigint,
      supplier_name text, status text, notes text, created_at timestamptz DEFAULT '2026-10-01', updated_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text,
      amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint,
      branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text,
      opened_by bigint, status text, branch_id bigint, expected_cash numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE quality_control_points (id text PRIMARY KEY, tenant_id text, name text, product_id bigint,
      trigger_stage text, test_type text, norm_measure_min numeric, norm_measure_max numeric,
      measure_unit text, instructions text, is_mandatory boolean DEFAULT true, created_at timestamptz);
    CREATE TABLE quality_inspections (id text PRIMARY KEY, tenant_id text, point_id text,
      reference_doc_type text, reference_doc_id text, product_id bigint, inspected_qty numeric,
      accepted_qty numeric, rejected_qty numeric, measured_value numeric, status text,
      inspector_id text, notes text, created_at timestamptz);
    CREATE TABLE quality_non_conformance_reports (id text PRIMARY KEY, tenant_id text, ncr_number text,
      inspection_id text, product_id bigint, defect_description text, severity text, root_cause text,
      disposition_action text, status text, resolution_notes text, assigned_to text,
      closed_at timestamptz, created_at timestamptz, updated_at timestamptz);
    INSERT INTO accounting_settings VALUES
      (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
  `);
  for (const code of [1110, 1120, 1130, 1140, 1150, 2110, 2120, 2125, 4100, 5100, 5190, 7290]) {
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,is_tax) VALUES ($1,$2,$3,$4)',
      [code, 't1', String(code), code === 1150 || code === 2120]);
  }
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: 'EGP' } as never).execute();
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'timezone', value: 'Africa/Cairo' } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: 'EGP', exchange_rate: 1, is_base: true } as never).execute();
}

function makeGrnService(db: Kysely<Database>): GoodsReceiptService {
  const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const finance = new PurchasesFinanceService();
  return new GoodsReceiptService(db as any, posting as any, finance as any);
}

function makeQaService(db: Kysely<Database>): QualityAssuranceService {
  return new QualityAssuranceService(db as any);
}

async function seedBase(db: Kysely<Database>): Promise<void> {
  await db.insertInto('branches' as never).values({ id: 5, tenant_id: 't1', default_stock_location_id: 1 } as never).execute();
  await db.insertInto('stock_locations' as never).values({ id: 1, tenant_id: 't1', branch_id: 5, name: 'Main', location_type: 'branch_stock', is_active: true } as never).execute();
  await db.insertInto('stock_locations' as never).values({ id: 2, tenant_id: 't1', branch_id: 5, name: 'Quarantine', location_type: 'quarantine', is_active: true } as never).execute();
  await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier', balance: 0 } as never).execute();
  await db.insertInto('products' as never).values({
    id: 10, tenant_id: 't1', account_id: 'a1', name: 'Widget 10',
    stock_qty: 0, reserved_qty: 0, cost_price: 0, track_serials: false,
  } as never).execute();
}

async function seedPo(db: Kysely<Database>): Promise<void> {
  await db.insertInto('purchase_orders' as never).values({
    id: 7, tenant_id: 't1', account_id: 'a1', order_number: 'PO-7', supplier_id: 9,
    supplier_name: 'Supplier', warehouse_id: 1, subtotal: 1000, tax_amount: 0, discount_amount: 0,
    total_amount: 1000, status: 'confirmed', updated_at: new Date('2026-10-01'),
  } as never).execute();
  await db.insertInto('purchase_order_items' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', purchase_order_id: 7, product_id: 10,
    product_name: 'Widget 10', unit_name: 'piece', quantity: 10, received_quantity: 0,
    unit_cost: 100, tax_rate: 0, discount: 0, total: 1000,
  } as never).execute();
}

async function createQuarantinedGrn(db: Kysely<Database>): Promise<number> {
  const grn = makeGrnService(db);
  const created = await grn.createGoodsReceipt({
    purchaseOrderId: 7,
    supplierId: 9,
    locationId: 1,
    lines: [{
      purchaseOrderItemId: 1,
      productId: 10,
      orderedQty: 10,
      receivedQty: 10,
      acceptedQty: 10,
      rejectedQty: 0,
      unitCost: 100,
      quarantineLocationId: 2,
    }],
  } as any, auth);
  return Number(created.id);
}

async function locationQty(db: Kysely<Database>, locationId: number): Promise<number> {
  const row = await (db as any).selectFrom('product_location_stock').select('qty')
    .where('product_id', '=', 10).where('location_id', '=', locationId).executeTakeFirst();
  return Number(row?.qty || 0);
}

async function readProduct(db: Kysely<Database>): Promise<{ stockQty: number; costPrice: number }> {
  const row = await (db as any).selectFrom('products').select(['stock_qty', 'cost_price']).where('id', '=', 10).executeTakeFirstOrThrow();
  return { stockQty: Number(row.stock_qty), costPrice: Number(row.cost_price) };
}

async function readJournal(db: Kysely<Database>): Promise<any> {
  const header = await (db as any).selectFrom('journal_entries').selectAll().executeTakeFirst();
  const lines = header
    ? await (db as any).selectFrom('journal_entry_lines').selectAll().orderBy('id', 'asc').execute()
    : [];
  return { header, lines };
}

async function journalCount(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entries').select('id').execute();
  return rows.length;
}

async function readMovements(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('stock_movements').selectAll().orderBy('id', 'asc').execute();
}

async function main(): Promise<void> {
  // Case 1: the quarantined receipt posts to quarantine, zero to normal.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db);
      const grn = makeGrnService(db);
      const grnId = await createQuarantinedGrn(db);
      const result = await grn.postGoodsReceipt(grnId, auth);
      assert.equal(result.status, 'posted');
      assert.equal(Number(result.totalGrniAmount), 1000, 'GRNI still accrues the full accepted value');
      assert.equal(await locationQty(db, 2), 10, 'accepted qty sits in the quarantine location');
      assert.equal(await locationQty(db, 1), 0, 'zero reaches the normal warehouse');
      const product = await readProduct(db);
      assert.equal(product.stockQty, 10, 'global stock counts the owned goods');
      assert.equal(product.costPrice, 100, 'WAC blends the receipt exactly as before');
      const { header, lines } = await readJournal(db);
      assert.ok(header, 'GRNI journal posted');
      const invLine = lines.find((l: any) => Number(l.account_id) === 1140);
      const grniLine = lines.find((l: any) => Number(l.account_id) === 2125);
      assert.equal(Number(invLine.debit), 1000);
      assert.equal(Number(grniLine.credit), 1000);
      const movements = await readMovements(db);
      assert.equal(movements.length, 1, 'one receipt movement');
      assert.equal(movements[0].movement_type, 'goods_receipt');
      assert.equal(Number(movements[0].qty), 10);
      assert.equal(Number(movements[0].location_id), 2, 'the receipt movement is at the quarantine location');
      assert.equal(Number(movements[0].total_cost), 1000);
      console.log('  case 1 passed: quarantined receipt posts to quarantine only');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: quarantined qty is not sellable by the sales path's own reads.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db);
      const grn = makeGrnService(db);
      const grnId = await createQuarantinedGrn(db);
      await grn.postGoodsReceipt(grnId, auth);
      // The ledger read the sales-order path uses, at the normal warehouse.
      const availability = await getLocationAvailability(db as any, {
        tenantId: 't1', accountId: 'a1', productId: 10, locationId: 1, branchId: 5,
      });
      assert.equal(availability.availableAtLocation, 0, 'nothing sellable at the normal warehouse');
      assert.equal(availability.globalAvailable, 10, 'the global figure still counts the owned quarantined goods — the trap');
      // The sellable-locations engine the POS and catalog paths use.
      const sellable = resolveBranchSellableLocations(
        { default_stock_location_id: 1, sales_stock_mode: 'all_operational_locations', allow_external_sales_stock: false },
        5,
        [
          { id: 1, location_type: 'branch_stock', branch_id: 5 },
          { id: 2, location_type: 'quarantine', branch_id: 5 },
        ],
      );
      assert.deepEqual(sellable.map((l) => l.id), [1], 'the quarantine location is never sellable');
      const sellableAvailable = availableAcrossLocations(
        sellable.map((l) => ({ qty: l.id === 1 ? 0 : 10, reserved: 0 })),
      );
      assert.equal(sellableAvailable, 0, 'sellable availability across sellable locations is zero');
      console.log('  case 2 passed: quarantined qty is not sellable');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: QA approval releases quarantine -> normal, with a movement pair and no second journal.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db);
      const grn = makeGrnService(db);
      const qa = makeQaService(db);
      const grnId = await createQuarantinedGrn(db);
      await grn.postGoodsReceipt(grnId, auth);
      const receipt = await grn.getGoodsReceipt(grnId, auth);
      const inspection = await qa.recordInspection(auth, {
        referenceDocType: 'goods_receipt',
        referenceDocId: String(receipt.docNo),
        productId: 10,
        inspectedQty: 10,
        acceptedQty: 10,
        rejectedQty: 0,
        passed: true,
      } as any);
      assert.equal(inspection.status, 'passed', 'the inspection itself passes');
      assert.equal(await locationQty(db, 2), 0, 'quarantine is empty after release');
      assert.equal(await locationQty(db, 1), 10, 'the normal warehouse holds the released qty');
      const product = await readProduct(db);
      assert.equal(product.stockQty, 10, 'global stock is unchanged by a location-only move');
      assert.equal(await journalCount(db), 1, 'no second journal — the receipt already posted Dr 1140 / Cr 2125');
      const movements = await readMovements(db);
      const outLeg = movements.find((m: any) => m.movement_type === 'transfer_send');
      const inLeg = movements.find((m: any) => m.movement_type === 'transfer_receive');
      assert.ok(outLeg, 'release out-leg recorded');
      assert.ok(inLeg, 'release in-leg recorded');
      assert.equal(Number(outLeg.qty), -10);
      assert.equal(Number(outLeg.location_id), 2);
      assert.equal(Number(outLeg.before_qty), 10);
      assert.equal(Number(outLeg.after_qty), 0);
      assert.equal(outLeg.reason, 'quarantine_release');
      assert.equal(Number(inLeg.qty), 10);
      assert.equal(Number(inLeg.location_id), 1);
      assert.equal(Number(inLeg.before_qty), 0);
      assert.equal(Number(inLeg.after_qty), 10);
      assert.equal(inLeg.reason, 'quarantine_release');
      const availability = await getLocationAvailability(db as any, {
        tenantId: 't1', accountId: 'a1', productId: 10, locationId: 1, branchId: 5,
      });
      assert.equal(availability.availableAtLocation, 10, 'the released qty is sellable at the normal warehouse');
      const inspections = await (db as any).selectFrom('quality_inspections').selectAll().execute();
      assert.equal(inspections.length, 1, 'the inspection row is recorded');
      assert.equal(inspections[0].status, 'passed');
      console.log('  case 3 passed: QA approval releases quarantine -> normal');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: approval with the target warehouse deleted fails closed — no partial move.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db);
      const grn = makeGrnService(db);
      const qa = makeQaService(db);
      const grnId = await createQuarantinedGrn(db);
      await grn.postGoodsReceipt(grnId, auth);
      const receipt = await grn.getGoodsReceipt(grnId, auth);
      await sql`DELETE FROM stock_locations WHERE id = 1`.execute(db);
      await assert.rejects(
        () => qa.recordInspection(auth, {
          referenceDocType: 'goods_receipt',
          referenceDocId: String(receipt.docNo),
          productId: 10,
          inspectedQty: 10,
          acceptedQty: 10,
          rejectedQty: 0,
          passed: true,
        } as any),
        /غير موجود/,
        'a missing target warehouse fails the approval closed',
      );
      const inspections = await (db as any).selectFrom('quality_inspections').selectAll().execute();
      assert.equal(inspections.length, 0, 'no inspection is recorded for a release that never happened');
      assert.equal(await locationQty(db, 2), 10, 'quarantine is untouched');
      const movements = await readMovements(db);
      assert.equal(movements.filter((m: any) => m.movement_type === 'transfer_send').length, 0, 'no release out-leg');
      assert.equal(movements.filter((m: any) => m.movement_type === 'transfer_receive').length, 0, 'no release in-leg');
      console.log('  case 4 passed: missing target warehouse fails closed');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: guards — a sellable location named as quarantine is rejected;
  // a plain receipt still posts to the normal warehouse; migration 0316 applies cleanly.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db);
      const grn = makeGrnService(db);
      await assert.rejects(
        () => grn.createGoodsReceipt({
          purchaseOrderId: 7,
          supplierId: 9,
          locationId: 1,
          lines: [{
            purchaseOrderItemId: 1,
            productId: 10,
            orderedQty: 10,
            receivedQty: 10,
            acceptedQty: 10,
            rejectedQty: 0,
            unitCost: 100,
            quarantineLocationId: 1,
          }],
        } as any, auth),
        /حجر صحي/,
        'a branch-stock location cannot pose as quarantine',
      );
      const plainId = await (async () => {
        const created = await grn.createGoodsReceipt({
          purchaseOrderId: 7,
          supplierId: 9,
          locationId: 1,
          lines: [{
            purchaseOrderItemId: 1,
            productId: 10,
            orderedQty: 10,
            receivedQty: 10,
            acceptedQty: 10,
            rejectedQty: 0,
            unitCost: 100,
          }],
        } as any, auth);
        return Number(created.id);
      })();
      await grn.postGoodsReceipt(plainId, auth);
      assert.equal(await locationQty(db, 1), 10, 'a plain receipt still posts to the normal warehouse');
      assert.equal(await locationQty(db, 2), 0, 'nothing leaks into quarantine without a quarantine pointer');
      // Migration 0316 applies cleanly on a live-shaped table and enforces the new type.
      await quarantineMigration.up(db as any);
      await assert.rejects(
        () => (db as any).insertInto('stock_locations').values({ id: 99, tenant_id: 't1', name: 'Bogus', location_type: 'bogus' }).execute(),
        /constraint/i,
        'the CHECK rejects an unknown location type',
      );
      await (db as any).insertInto('stock_locations').values({ id: 98, tenant_id: 't1', name: 'Q2', location_type: 'quarantine' }).execute();
      const q2 = await (db as any).selectFrom('stock_locations').select('location_type').where('id', '=', 98).executeTakeFirstOrThrow();
      assert.equal(q2.location_type, 'quarantine', 'the CHECK admits the quarantine type');
      console.log('  case 5 passed: creation guard, plain-receipt regression, migration 0316');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: source pins — every layer names the quarantine type.
  {
    const here = __dirname;
    const grnSource = readFileSync(resolve(here, '../../src/modules/purchases/services/goods-receipt.service.ts'), 'utf8');
    assert.ok(grnSource.includes('INV-GRN-REAL-QUARANTINE'), 'postGoodsReceipt names the invariant');
    assert.ok(grnSource.includes('quarantineLocationId'), 'the acceptance path reads the quarantine id');
    const qaSource = readFileSync(resolve(here, '../../src/modules/inventory/services/quality-assurance.service.ts'), 'utf8');
    assert.ok(qaSource.includes('releaseQuarantinedReceipt'), 'the QA service owns the release');
    assert.ok(qaSource.includes('relocateStockBetweenLocations'), 'the release routes through the canonical transfer primitive');
    const engineSource = readFileSync(resolve(here, '../../src/common/engines/branch-sellable-locations.engine.ts'), 'utf8');
    assert.ok(engineSource.includes("'quarantine'"), 'the sellable-locations engine excludes quarantine');
    const salesWriteSource = readFileSync(resolve(here, '../../src/modules/sales/services/sales-write.service.ts'), 'utf8');
    assert.ok(salesWriteSource.includes("'damaged', 'in_transit', 'quarantine'"), 'the sale guards exclude quarantine');
    const settingsSource = readFileSync(resolve(here, '../../src/modules/settings/settings.service.ts'), 'utf8');
    assert.ok(settingsSource.includes("'damaged', 'quarantine'"), 'location creation accepts the quarantine type');
    const locationsPage = readFileSync(resolve(here, '../../../frontend/src/features/inventory/pages/LocationsManagementPage.tsx'), 'utf8');
    assert.ok(locationsPage.includes("'quarantine'"), 'the locations UI offers the quarantine type');
    console.log('  case 6 passed: source pins');
  }

  console.log('grn quarantine checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
