/*
New file: backend/test/critical/import-floating-reservation.spec.ts
Pins floating-goods reservations through the real
createContainerPreorder (INV-IMPORT-FLOATING-RESERVATION, I4-D12).

WHAT WAS WRONG (live trial phase 2, problem D12): a floating-goods
reservation could not be created for MSCU-TEST-001.
- The customer combobox contained only "-- اختر العميل --": the
  modal hand-rolled `http('/api/customers')` and read `res?.items`,
  but GET /api/customers returns the `{ customers: [...] }` envelope
  (never a bare array, never `.items`), so the list was always empty
  and native validation ("Please select an item in the list") stopped
  every confirm. Same read-path family as the I3-D4 quotation picker
  (a picker bypassing the canonical reader), different mechanism —
  this modal never converted the id to a number, so D4's fix did not
  cover it. Fix: the canonical `customersApi.list()`.
- The create mutation could never have succeeded even with a
  customer: it sent `agreedUnitPriceEgp` + `idempotencyKey` (neither
  declared on CreateContainerPreorderDto) and never sent the DTO's
  required `unitPriceEgp`, while sending `treasuryAccountId` for the
  DTO's `depositTreasuryAccountId`. The global pipe is whitelist +
  forbidNonWhitelisted, so every create was rejected 400 before the
  service ran — the same class as the I3-D8 deposit failure, masked
  in the trial by the earlier customer-list failure. Fix: the
  mutation sends exactly the DTO fields.
- The pre-filled defaults were impossible for the container: qty
  100 vs B/L capacity 10, price 1,500, deposit 20,000 — a 150,000
  EGP deal for goods worth 900 EGP. Fix: defaults derived from the
  selected B/L item (qty 1, price = landed cost, deposit 0 — a
  deposit asserts cash actually received, so no non-zero default may
  invent a payment; the deposit <= deal-total cap is enforced on
  submit and in the service before the insert).
- The dialog was offered for MSCU-TEST-001 although it was already
  received. Fix: the form is offered only while the goods are
  floating (status not 'Arrived' and no posted receipt); the dialog
  itself stays openable so existing reservations can still be
  converted to a sale after arrival, and the service refuses a
  post-receipt create fail-closed with the same rule.

WHAT THIS PINS, driving the real createContainerPreorder on PGlite
through the real posting boundary (trial shape: B/L capacity 10,
landed cost 90 EGP/unit, goods worth 900 EGP):
- Valid reservation, no deposit (qty 1 x 90): records 'reserved'
  with total 90 and posts no journal.
- Valid reservation with a proportionate deposit (9 = 10% of 90):
  records + one balanced JE Dr bank 1120 / Cr customer-advance
  2130 for 9 + one treasury row.
- Qty 100 exceeds B/L capacity 10: rejects naming the B/L capacity;
  nothing records.
- Deposit 20,000 on a 90 deal (the trial's impossible default):
  rejects naming the deposit rule; nothing records.
- Post-receipt create is refused: shipment 'Arrived', and a Pending
  shipment with a posted receipt row — both reject naming receipt.
- Unknown customer: rejects naming the customer rule.
- Frontend wiring source pins: the modal reads customers through
  customersApi.list() (no `.items` fallback, no hand-rolled
  /api/customers fetch), carries no hardcoded 100/1500/20000
  defaults, gates the form on the floating state, and the mutation
  sends exactly the DTO fields.

NOT PINNED HERE: rendering the modal (no component spec — the
wiring is pinned by source, the I3-D3 precedent); server-side
preorder idempotency (none exists — a retry after a network drop can
double-record, same open item as I3-D8's deposit).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

async function makeDb(opts: { shipmentStatus?: string; withReceipt?: boolean } = {}): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, status text, feasibility_data text, closure_data text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), serial_id bigserial, tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text, created_by bigint, idempotency_key text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric, payment_date date, expected_return_date date, actual_return_date date, refund_status text, refunded_amount_egp numeric, deductions_amount_egp numeric, deduction_reason text, treasury_account_id bigint, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, 12, 12, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (11, 't1', 't1', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', true, false, false, false, false, false),
      (12, 't1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', true, true, false, false, false, false),
      (24, 't1', 't1', '2130', 'دفعات عملاء مقدمة', 'Customer advances', 'liability', 'liabilities', true, false, false, false, false, false);
    INSERT INTO customers VALUES (201, 't1', 'عميل اختبار 00001', '01000000001', 0, true, NOW());
    INSERT INTO products VALUES (101, 't1', 't1', 'اختبار صنف استيراد 001', 10, 0, 90, NOW());
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'active', NULL, NULL, NOW());
    INSERT INTO import_shipments (id, tenant_id, container_number, project_id, status) VALUES ('sh-1', 't1', 'MSCU-TEST-001', 'proj-1', '${opts.shipmentStatus || 'Pending'}');
    INSERT INTO import_shipment_items (id, tenant_id, shipment_id, product_id, quantity, factory_unit_price_usd, landed_cost_egp, received_quantity) VALUES ('item-1', 't1', 'sh-1', 101, 10, 1.8, 90, NULL);
    ${opts.withReceipt ? `INSERT INTO import_inventory_receipts (tenant_id, shipment_id, state, posted_at) VALUES ('t1', 'sh-1', 'posted', NOW());` : ''}
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
    shipmentId: 'sh-1',
    projectId: 'proj-1',
    customerId: '201',
    productId: '101',
    reservedQuantity: 1,
    unitPriceEgp: 90,
    depositAmountEgp: 0,
    ...overrides,
  };
}

async function preorderCount(db: Kysely<Database>): Promise<number> {
  const rows = await db.selectFrom('import_container_preorders').select('id').execute();
  return rows.length;
}

async function journalLines(db: Kysely<Database>): Promise<Array<{ account_id: number; debit: number; credit: number }>> {
  const rows = await sql<{ account_id: string; debit: string; credit: string }>`
    SELECT l.account_id, l.debit, l.credit FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE e.tenant_id = 't1' AND e.source_type = 'import_container_preorder'
    ORDER BY l.id
  `.execute(db);
  return rows.rows.map((r) => ({ account_id: Number(r.account_id), debit: Number(r.debit), credit: Number(r.credit) }));
}

async function main(): Promise<void> {
  // Case 1: valid reservation, trial shape, no deposit — records, no journal.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const preorder = await service.createContainerPreorder('t1', 1, trialDto());
      assert.equal(preorder.status, 'reserved', 'Reservation records with status reserved');
      assert.equal(Number(preorder.reserved_quantity), 1, 'Reservation records qty 1 (the sane default, <= capacity 10)');
      assert.equal(Number(preorder.total_price_egp), 90, 'Reservation totals 1 x 90 landed cost, not the old 150,000 default deal');
      assert.equal(Number(preorder.deposit_amount_egp), 0, 'No deposit is asserted when none was paid');
      assert.equal(await journalLines(db).then((l) => l.length), 0, 'A deposit-free reservation posts no journal');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: valid reservation with a proportionate deposit (9 = 10% of 90) — records + balanced JE.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const preorder = await service.createContainerPreorder(
        't1',
        1,
        trialDto({ depositAmountEgp: 9, depositTreasuryAccountId: '12' }),
      );
      assert.equal(preorder.status, 'reserved', 'Deposit reservation records reserved');
      assert.equal(Number(preorder.total_price_egp), 90, 'Deposit reservation totals 90');
      const lines = await journalLines(db);
      assert.deepEqual(
        lines,
        [
          { account_id: 12, debit: 9, credit: 0 },
          { account_id: 24, debit: 0, credit: 9 },
        ],
        'JE is Dr bank 1120 / Cr customer-advance 2130 for the 9 EGP deposit',
      );
      const treasury = await db.selectFrom('treasury_transactions').select(['amount', 'txn_type']).execute();
      assert.equal(treasury.length, 1, 'One treasury row is recorded for the deposit');
      assert.equal(Number(treasury[0].amount), 9, 'Treasury row records the 9 EGP deposit');
      assert.equal(treasury[0].txn_type, 'import_customer_advance', 'Treasury row is typed as a customer advance');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: qty 100 exceeds B/L capacity 10 — rejects naming the B/L capacity; nothing records.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.createContainerPreorder('t1', 1, trialDto({ reservedQuantity: 100, unitPriceEgp: 1500 })),
        /لا يمكن تجاوز كمية البوليصة/,
        'Qty 100 against capacity 10 fails naming the B/L capacity rule',
      );
      assert.equal(await preorderCount(db), 0, 'An over-capacity reservation records nothing');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: deposit 20,000 on a 90 deal (the trial's impossible default) — rejects naming the deposit rule.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.createContainerPreorder('t1', 1, trialDto({ depositAmountEgp: 20000 })),
        /قيمة العربون يجب أن تكون موجبة ولا تتجاوز إجمالي قيمة الحجز/,
        'A 20,000 deposit on a 90 deal fails naming the deposit rule',
      );
      assert.equal(await preorderCount(db), 0, 'An over-deposit reservation records nothing');
      assert.equal((await journalLines(db)).length, 0, 'An over-deposit reservation posts no journal');
    } finally {
      await db.destroy();
    }
  }

  // Case 5a: shipment already Arrived — new reservations are refused.
  {
    const db = await makeDb({ shipmentStatus: 'Arrived' });
    try {
      const service = makeService(db);
      await expectReject(
        service.createContainerPreorder('t1', 1, trialDto()),
        /وصلت الحاوية وتم استلامها/,
        'An Arrived container refuses a new floating-goods reservation',
      );
      assert.equal(await preorderCount(db), 0, 'A post-arrival reservation records nothing');
    } finally {
      await db.destroy();
    }
  }

  // Case 5b: Pending shipment with a posted receipt row — new reservations are refused.
  {
    const db = await makeDb({ withReceipt: true });
    try {
      const service = makeService(db);
      await expectReject(
        service.createContainerPreorder('t1', 1, trialDto()),
        /تم ترحيل استلام الحاوية/,
        'A receipt-posted container refuses a new floating-goods reservation',
      );
      assert.equal(await preorderCount(db), 0, 'A post-receipt reservation records nothing');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: unknown customer — rejects naming the customer rule.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.createContainerPreorder('t1', 1, trialDto({ customerId: '999' })),
        /العميل المحدد لا ينتمي لهذه المنشأة/,
        'An unknown customer fails naming the customer rule',
      );
      assert.equal(await preorderCount(db), 0, 'A reservation for an unknown customer records nothing');
    } finally {
      await db.destroy();
    }
  }

  // Case 7: frontend wiring source pins — the modal and the mutation.
  {
    const modal = readSource('frontend/src/features/import-sales/ContainerPreordersModal.tsx');
    assert.ok(modal.includes('customersApi.list()'), 'Modal reads customers through the canonical customersApi.list()');
    assert.ok(!modal.includes("'/api/customers'"), 'Modal no longer hand-fetches /api/customers');
    assert.ok(!modal.includes('(res as any)'), 'Modal no longer unwraps the customer response by hand');
    assert.ok(!modal.includes('useState<number>(100)'), 'Modal no longer defaults qty to the impossible 100');
    assert.ok(!modal.includes('useState<number>(1500)'), 'Modal no longer defaults the price to 1,500');
    assert.ok(!modal.includes('useState<number>(20000)'), 'Modal no longer defaults the deposit to 20,000');
    assert.ok(modal.includes('landed_cost_egp'), 'Modal derives the default price from the item landed cost');
    assert.ok(modal.includes('isFloating'), 'Modal gates the form on the floating (pre-receipt) state');
    assert.ok(
      modal.includes("shipment.status !== 'Arrived'") && modal.includes("inventory_receipt?.state !== 'posted'"),
      'Modal offers the form only while the container has not arrived and its receipt is not posted',
    );
    assert.ok(
      modal.includes('flags?.isCashBank') && !modal.includes("accountGroup === 'current_assets'"),
      'Modal offers only cash/bank treasury accounts for the deposit (flags.isCashBank, the shape the accounts endpoint returns)',
    );
    const api = readSource('frontend/src/features/import-sales/api/shipments.api.ts');
    assert.ok(api.includes('unitPriceEgp:'), 'Create mutation sends the DTO field unitPriceEgp');
    assert.ok(api.includes('depositTreasuryAccountId:'), 'Create mutation sends the DTO field depositTreasuryAccountId');
    assert.ok(!api.includes('agreedUnitPriceEgp:'), 'Create mutation no longer sends the undeclared agreedUnitPriceEgp');
    assert.ok(!api.includes('idempotencyKey:'), 'Create mutation no longer sends the undeclared idempotencyKey');
  }

  console.log('Import floating reservation tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
