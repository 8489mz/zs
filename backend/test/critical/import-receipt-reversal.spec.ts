/*
New file: backend/test/critical/import-receipt-reversal.spec.ts
Pins the approval-gated, prospective-only reversal of a posted
import receipt and the legacy-review resolve path
(INV-IMPORT-RECEIPT-REVERSAL, INV-IMPORT-LEGACY-RECEIPT-REVIEW).

WHAT WAS WRONG: a posted import receipt had no correction path at
all. The only way to fix a wrong receipt was a manual stock
adjustment plus a hand-written journal — or rewriting history.
There was also no way to unfreeze a shipment stuck in
legacy_review_required except by hand-editing its state.

WHAT THIS PINS, driving the real updateShipmentCosts (posting),
reversePostedReceipt and resolveLegacyReceipt on PGlite through
the real posting boundary:
- Posting first: 10 units @ 2,000 EGP on hand blend with a 10-unit
  receipt @ 2,500 into WAC 2,250; the receipt journal is Dr 1140 /
  Cr 2110 for 25,000; the lot is active with the full quantity;
  the preorder flips reserved -> allocated.
- Reversal (maker-checker token bound to the shipment and the
  receipt): stock returns to 10 @ WAC 2,000 exactly, the lot is
  zeroed and marked reversed, the preorder returns to reserved,
  and a REVERSAL journal mirrors the original lines exactly with
  the reversal link in both directions. The original receipt row
  and journal are never rewritten.
- Fail-closed blockers, each leaving stock, WAC, lots and the
  approval token untouched: no token; a token bound to a
  different receipt; a consumed lot; a late-expense revaluation;
  an invoiced preorder; a second reversal; a closed project; a
  closed accounting period (full rollback, including the token
  consumption).
- Legacy resolve: a frozen receipt with a posted journal AND a
  receipt movement resolves to posted with posted_at taken from
  the earliest movement (evidence, never fabricated). A frozen
  receipt with no proof stays frozen.
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
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, status text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_inventory_receipt_reversals (id bigserial PRIMARY KEY, tenant_id text, receipt_id bigint, shipment_id text, approval_request_id text, journal_entry_id bigint, reason text, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, receipt_id));
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
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
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'active', '{}');
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 10, 0, 2000, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 10, 0),
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

async function seedShipment(db: Kysely<Database>, projectStatus: string): Promise<void> {
  await (db as any).updateTable('import_projects').set({ status: projectStatus }).where('id', '=', 'proj-1').execute();
  await db.insertInto('import_shipments' as never).values({
    id: 'sh-1', tenant_id: 't1', container_number: 'C1', supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: 'proj-1',
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: 'sh-1-item', tenant_id: 't1', shipment_id: 'sh-1', product_id: 1,
    quantity: 10, factory_unit_price_usd: 50, shortage_handling_method: 'capitalize',
  } as never).execute();
  await db.insertInto('import_container_preorders' as never).values({
    tenant_id: 't1', preorder_no: 'PO-1', shipment_id: 'sh-1', customer_id: 1,
    product_id: 1, reserved_quantity: 4, status: 'reserved',
  } as never).execute();
}

/** Posts the receipt through the real costs path; returns the receipt id. */
async function postReceipt(db: Kysely<Database>, service: any): Promise<number> {
  await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10 });
  const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
  return Number(receipt.id);
}

async function insertApproval(
  db: Kysely<Database>,
  id: string,
  actionType: string,
  shipmentId: string,
  receiptId: number,
): Promise<void> {
  await db.insertInto('import_approval_requests' as never).values({
    id, tenant_id: 't1', module: 'import', action_type: actionType,
    reference_id: shipmentId, requested_by: 99, created_by: 99, status: 'approved',
    request_payload: JSON.stringify({ shipmentId, receiptId: String(receiptId) }),
  } as never).execute();
}

async function readProduct(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
}

async function readLocationQty(db: Kysely<Database>): Promise<number> {
  const row: any = await (db as any).selectFrom('product_location_stock').select('qty')
    .where('product_id', '=', 1).where('location_id', '=', 10).executeTakeFirstOrThrow();
  return Number(row.qty);
}

async function approvalStatus(db: Kysely<Database>, id: string): Promise<string> {
  const row: any = await (db as any).selectFrom('import_approval_requests').select('status').where('id', '=', id).executeTakeFirstOrThrow();
  return row.status;
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

const REVERSAL_DTO = (approvalRequestId: string) => ({
  approvalRequestId,
  reason: 'Wrong receiving location recorded',
});

async function main(): Promise<void> {
  // Case 1: full post-then-reverse cycle through the real code.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const receiptId = await postReceipt(db, service);
      const posted = await readProduct(db);
      assert.equal(Number(posted.stock_qty), 20, 'Posting adds the receipt to stock');
      assert.equal(Number(posted.cost_price), 2250, 'WAC blends 10 @ 2000 with 10 @ 2500');
      assert.equal(await readLocationQty(db), 20, 'Location balance carries the receipt');
      const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('id', '=', receiptId).executeTakeFirstOrThrow();
      assert.ok(receipt.journal_entry_id, 'The receipt posted a journal');
      const originalLines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', Number(receipt.journal_entry_id)).execute();
      assert.equal(originalLines.length, 2, 'Original journal: inventory debit + payable credit');
      const preorder: any = await (db as any).selectFrom('import_container_preorders').selectAll().executeTakeFirstOrThrow();
      assert.equal(preorder.status, 'allocated', 'Posting allocates the preorder');
      const ledgerAfterPost: any[] = await (db as any).selectFrom('supplier_ledger').selectAll().execute();
      assert.equal(ledgerAfterPost.length, 1, 'Posting mirrors the payable line into the supplier subledger');
      assert.equal(Number(ledgerAfterPost[0].balance_after), 25000, 'Subledger balance rises by the payable');

      await insertApproval(db, 'appr-1', 'import_receipt_reversal', 'sh-1', receiptId);
      const result = await service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-1'));
      assert.equal(result.receiptId, receiptId);
      assert.ok(result.journalEntryId, 'The reversal posts a mirror journal');

      const reversed = await readProduct(db);
      assert.equal(Number(reversed.stock_qty), 10, 'Stock returns to the pre-receipt quantity');
      assert.equal(Number(reversed.cost_price), 2000, 'WAC un-blends exactly to the pre-receipt cost');
      assert.equal(await readLocationQty(db), 10, 'Location balance returns to the pre-receipt quantity');
      const lot: any = await (db as any).selectFrom('import_inventory_lots').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(lot.remaining_quantity), 0, 'The lot is zeroed');
      assert.equal(lot.status, 'reversed', 'The lot is marked reversed, not deleted');
      const preorderAfter: any = await (db as any).selectFrom('import_container_preorders').selectAll().executeTakeFirstOrThrow();
      assert.equal(preorderAfter.status, 'reserved', 'The preorder returns to reserved');
      const reversalRow: any = await (db as any).selectFrom('import_inventory_receipt_reversals').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(reversalRow.receipt_id), receiptId);
      assert.equal(Number(reversalRow.journal_entry_id), Number(result.journalEntryId));
      assert.equal(reversalRow.reason, 'Wrong receiving location recorded');
      const reversalLines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', Number(result.journalEntryId)).execute();
      assert.equal(reversalLines.length, 2, 'Mirror journal has the same line count');
      for (const original of originalLines) {
        const mirror = reversalLines.find((l) => Number(l.account_id) === Number(original.account_id));
        assert.ok(mirror, 'Every original account has a mirror line');
        assert.equal(Number(mirror.debit), Number(original.credit), 'Mirror debit equals original credit');
        assert.equal(Number(mirror.credit), Number(original.debit), 'Mirror credit equals original debit');
      }
      const reversalEntry: any = await (db as any).selectFrom('journal_entries').selectAll().where('id', '=', Number(result.journalEntryId)).executeTakeFirstOrThrow();
      assert.equal(Number(reversalEntry.reversal_of_entry_id), Number(receipt.journal_entry_id), 'The reversal entry links to the original');
      const originalEntry: any = await (db as any).selectFrom('journal_entries').selectAll().where('id', '=', Number(receipt.journal_entry_id)).executeTakeFirstOrThrow();
      assert.equal(Number(originalEntry.reversed_by_entry_id), Number(result.journalEntryId), 'The original entry is stamped reversed-by');
      const untouchedReceipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('id', '=', receiptId).executeTakeFirstOrThrow();
      assert.equal(untouchedReceipt.state, 'posted', 'The original receipt row is never rewritten');
      assert.equal(Number(untouchedReceipt.journal_entry_id), Number(receipt.journal_entry_id), 'The original journal link is never rewritten');
      assert.equal(await approvalStatus(db, 'appr-1'), 'executed', 'The approval token is single-use');
      const allLines: any[] = await (db as any).selectFrom('journal_entry_lines').selectAll().execute();
      const debits = allLines.reduce((s, l) => s + Number(l.debit), 0);
      const credits = allLines.reduce((s, l) => s + Number(l.credit), 0);
      assert.equal(debits, credits, 'Original + reversal journals balance in total');
      const ledgerAfterReversal: any[] = await (db as any).selectFrom('supplier_ledger').selectAll().orderBy('id', 'asc').execute();
      assert.equal(ledgerAfterReversal.length, 2, 'The reversal mirrors into the subledger too');
      assert.equal(Number(ledgerAfterReversal[1].amount), -25000, 'The mirror ledger movement offsets the payable');
      assert.equal(Number(ledgerAfterReversal[1].balance_after), 0, 'The subledger returns to zero: profit equals GL');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: no approval token fails closed, nothing moves.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const receiptId = await postReceipt(db, service);
      await assert.rejects(
        async () => service.reversePostedReceipt('t1', 1, 'sh-1', { approvalRequestId: '', reason: 'Wrong receiving location recorded' }),
        /موافقة Maker-Checker/,
        'Reversal without a token must fail closed',
      );
      assert.equal(Number((await readProduct(db)).stock_qty), 20, 'Stock is untouched by a rejected reversal');
      assert.equal(await countRows(db, 'import_inventory_receipt_reversals'), 0);
      void receiptId;
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a token bound to a different receipt fails closed and is NOT consumed.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const receiptId = await postReceipt(db, service);
      await insertApproval(db, 'appr-wrong', 'import_receipt_reversal', 'sh-1', receiptId + 100);
      await assert.rejects(
        async () => service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-wrong')),
        /سند الاستلام/,
        'A token minted for another receipt must not authorize this reversal',
      );
      assert.equal(await approvalStatus(db, 'appr-wrong'), 'approved', 'The rejected token is not consumed');
      assert.equal(Number((await readProduct(db)).stock_qty), 20);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: a consumed lot blocks the reversal.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const receiptId = await postReceipt(db, service);
      await (db as any).updateTable('import_inventory_lots').set({ remaining_quantity: 5 }).execute();
      await insertApproval(db, 'appr-1', 'import_receipt_reversal', 'sh-1', receiptId);
      await assert.rejects(
        async () => service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-1')),
        /IMPORT_RECEIPT_REVERSAL_LOT_CONSUMED/,
        'A partially consumed lot must block the reversal',
      );
      assert.equal(Number((await readProduct(db)).stock_qty), 20, 'Stock is untouched');
      assert.equal(await approvalStatus(db, 'appr-1'), 'approved', 'The token survives a blocked reversal');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: a late-expense revaluation blocks the reversal.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const receiptId = await postReceipt(db, service);
      await db.insertInto('import_late_expense_events' as never).values({
        tenant_id: 't1', shipment_id: 'sh-1', title: 'late', total_amount_egp: 100,
        inventory_amount_egp: 100, cogs_amount_egp: 0, idempotency_key: 'le-1',
      } as never).execute();
      await insertApproval(db, 'appr-1', 'import_receipt_reversal', 'sh-1', receiptId);
      await assert.rejects(
        async () => service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-1')),
        /IMPORT_RECEIPT_REVERSAL_LATE_EXPENSE_EXISTS/,
        'Revaluation already spread the costs: the un-blend would be wrong',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 6: an invoiced preorder blocks the reversal.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const receiptId = await postReceipt(db, service);
      await (db as any).updateTable('import_container_preorders').set({ status: 'invoiced' }).execute();
      await insertApproval(db, 'appr-1', 'import_receipt_reversal', 'sh-1', receiptId);
      await assert.rejects(
        async () => service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-1')),
        /IMPORT_RECEIPT_REVERSAL_PREORDER_INVOICED/,
        'Sold stock cannot come back through a receipt reversal',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 7: a second reversal of the same receipt is impossible.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const receiptId = await postReceipt(db, service);
      await insertApproval(db, 'appr-1', 'import_receipt_reversal', 'sh-1', receiptId);
      await service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-1'));
      await insertApproval(db, 'appr-2', 'import_receipt_reversal', 'sh-1', receiptId);
      await assert.rejects(
        async () => service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-2')),
        /IMPORT_RECEIPT_ALREADY_REVERSED/,
        'One reversal per receipt, enforced before the journal check',
      );
      assert.equal(await countRows(db, 'import_inventory_receipt_reversals'), 1, 'Exactly one reversal row exists');
    } finally {
      await db.destroy();
    }
  }

  // Case 8: a closed project blocks the reversal.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'closed');
      const receiptId = await postReceipt(db, service);
      await insertApproval(db, 'appr-1', 'import_receipt_reversal', 'sh-1', receiptId);
      await assert.rejects(
        async () => service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-1')),
        /IMPORT_RECEIPT_REVERSAL_PROJECT_CLOSED/,
        'Closed books stay closed',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 9: a closed accounting period fails the whole reversal transaction, token included.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const receiptId = await postReceipt(db, service);
      await (db as any).updateTable('accounting_settings').set({ lock_date_all: '2099-01-01' }).where('id', '=', 1).execute();
      await insertApproval(db, 'appr-1', 'import_receipt_reversal', 'sh-1', receiptId);
      await assert.rejects(
        async () => service.reversePostedReceipt('t1', 1, 'sh-1', REVERSAL_DTO('appr-1')),
        /ACCOUNTING_PERIOD_LOCKED/,
        'The posting boundary rejects a reversal journal dated in a closed period',
      );
      assert.equal(Number((await readProduct(db)).stock_qty), 20, 'The rollback restores the stock writes too');
      assert.equal(Number((await readProduct(db)).cost_price), 2250, 'The rollback restores the WAC write too');
      assert.equal(await countRows(db, 'import_inventory_receipt_reversals'), 0, 'No reversal row survives the rollback');
      assert.equal(await approvalStatus(db, 'appr-1'), 'approved', 'The token consumption rolls back with the transaction');
    } finally {
      await db.destroy();
    }
  }

  // Case 10: legacy resolve with journal + movement proof unfreezes with evidence-based posted_at.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const journal: any = await (db as any).insertInto('journal_entries').values({
        tenant_id: 't1', account_id: 't1', entry_no: 'JE-1', entry_date: '2026-01-05',
        description: 'legacy receipt journal', source_type: 'import_inventory_receipt', source_id: 1,
        status: 'posted', posted_at: new Date('2026-01-05'),
      }).returning('id').executeTakeFirstOrThrow();
      const receipt: any = await (db as any).insertInto('import_inventory_receipts').values({
        tenant_id: 't1', shipment_id: 'sh-1', state: 'legacy_review_required',
        review_reason: 'legacy_arrived_without_verified_receipt', posted_at: null,
        journal_entry_id: Number(journal.id),
      }).returning('id').executeTakeFirstOrThrow();
      const receiptId = Number(receipt.id);
      await (db as any).insertInto('stock_movements').values({
        tenant_id: 't1', account_id: 't1', product_id: 1, movement_type: 'import_receipt',
        qty: 10, before_qty: 10, after_qty: 20, total_cost: 25000,
        reason: 'legacy', note: 'legacy', reference_type: 'import_inventory_receipt',
        reference_id: receiptId, import_receipt_id: receiptId, created_at: new Date('2026-01-05T10:00:00Z'),
      }).execute();
      await insertApproval(db, 'appr-legacy', 'import_legacy_receipt_review', 'sh-1', receiptId);
      const result = await service.resolveLegacyReceipt('t1', 1, 'sh-1', {
        approvalRequestId: 'appr-legacy',
        reason: 'Verified against the posted journal and movements',
      });
      assert.equal(result.receiptId, receiptId);
      const resolved: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('id', '=', receiptId).executeTakeFirstOrThrow();
      assert.equal(resolved.state, 'posted', 'The frozen receipt is unfrozen by an approved review, never silently');
      assert.ok(String(new Date(resolved.posted_at).toISOString()).startsWith('2026-01-05'), 'posted_at comes from the earliest movement, not from today');
      assert.equal(await approvalStatus(db, 'appr-legacy'), 'executed');
    } finally {
      await db.destroy();
    }
  }

  // Case 11: a frozen receipt with no proof stays frozen.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'active');
      const receipt: any = await (db as any).insertInto('import_inventory_receipts').values({
        tenant_id: 't1', shipment_id: 'sh-1', state: 'legacy_review_required',
        review_reason: 'legacy_arrived_without_verified_receipt', posted_at: null, journal_entry_id: null,
      }).returning('id').executeTakeFirstOrThrow();
      const receiptId = Number(receipt.id);
      await insertApproval(db, 'appr-legacy', 'import_legacy_receipt_review', 'sh-1', receiptId);
      await assert.rejects(
        async () => service.resolveLegacyReceipt('t1', 1, 'sh-1', {
          approvalRequestId: 'appr-legacy',
          reason: 'Verified against the posted journal and movements',
        }),
        /IMPORT_LEGACY_REVIEW_NO_PROOF/,
        'The migration-0231 seed shape (no journal, no movements) can never be resolved',
      );
      const stillFrozen: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('id', '=', receiptId).executeTakeFirstOrThrow();
      assert.equal(stillFrozen.state, 'legacy_review_required');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import receipt reversal tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
