/*
New file: backend/test/critical/import-container-deposit-idempotency.spec.ts
Pins server-side deposit idempotency through the real
recordContainerDeposit (INV-IMPORT-DEPOSIT-IDEMPOTENCY, I6-E).

WHAT WAS WRONG (live trial phase 2, problem D8 residual): no
server-side deposit idempotency — a retry after a network drop
could double-record the deposit (a second row, a second treasury
row, a second JE). I3-D8 had REMOVED idempotencyKey from the
frontend payload because the DTO never declared it, and recorded
that no server-side idempotency existed (needs a migration).

KEY SOURCE (grounded, decision recorded): the key is OPTIONAL on
the DTO. A caller that sends idempotencyKey owns the retry
identity; a caller that does not (the live form sends exactly the
DTO fields and no key) gets a server-derived key from the natural
key — 'deposit:<shipmentId>:<containerNo>' — which migration
0238 already makes unique per tenant
(uq_container_deposits_tenant_shipment_container). Requiring a
client key would break the live form until a frontend package
wires it; deriving it server-side makes every retry safe today.
The duplicate identity is therefore (tenant, effective key);
the replay compares amount + shipping line + container + shipment
+ expected return date, and a same-key/different-payload retry
fails closed with IMPORT_CONTAINER_DEPOSIT_DUPLICATE_KEY.

WHAT THIS PINS, driving the real recordContainerDeposit on PGlite
through the real posting boundary (trial shape: 100 EGP,
MSCU-TEST-001, return 2026-12-20, treasury 1120):
- The real migration 0306 up() applies to a pre-migration schema:
  a legacy deposit row is backfilled with a 'legacy:<serial_id>'
  key, the column is NOT NULL afterwards, the unique index exists,
  and a second up() run is a no-op.
- Retry, same payload, no client key: returns the SAME deposit
  row — still 1 deposit, 1 JE, 1 treasury row. (On base this
  fails: the second insert throws a raw 23505, no replay.)
- Retry with an explicit client key: same replay; the stored key
  is the client key.
- Same key, different amount: named conflict
  IMPORT_CONTAINER_DEPOSIT_DUPLICATE_KEY, still 1 deposit, 1 JE.
- Same container, different key: named conflict
  IMPORT_CONTAINER_DEPOSIT_ALREADY_RECORDED (one deposit per
  container per shipment is the standing rule), still 1 row.
- Two different containers, same client key: the second fails
  with IMPORT_CONTAINER_DEPOSIT_DUPLICATE_KEY (key collision
  across containers is fail-closed, never a silent replay).
- A valid first deposit still records + posts exactly as before.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { migration as writeUniquenessMigration } from '../../src/database/migrations/2040000000306_import_write_uniqueness';

// Pre-migration shape: the tables exactly as migrations <= 0304
// leave them. The deposits DDL below mirrors migration 0238,
// INCLUDING its natural unique constraint
// (tenant_id, shipment_id, container_no) — a retry without it
// would double-record in the fixture and the "same container,
// different key" case could never fire. makeDb applies the real
// migration 0306 up() unless told not to.
async function makeDb(opts: { withDepositAccount?: boolean; migrate?: boolean } = {}): Promise<Kysely<Database>> {
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
    CREATE TABLE import_qc_inspections (id text PRIMARY KEY DEFAULT ('qc-' || md5(random()::text)), tenant_id text, shipment_id text, stage text);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), serial_id bigserial, tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text, supplier_id bigint, unallocable_reason text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE import_customs_brokers (id text PRIMARY KEY, tenant_id text, name text, license_number text, phone text, port_name text, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_advances (id text PRIMARY KEY DEFAULT ('badv-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, project_id text, shipment_id text, advance_no text, amount_egp numeric, disbursement_date text, payment_method text, treasury_account_id bigint, status text, settled_amount_egp numeric, remaining_amount_egp numeric, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY DEFAULT ('bexp-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, advance_id text, project_id text, shipment_id text, receipt_no text, expense_date text, category text, amount_egp numeric, is_capitalized boolean, is_refundable_vat boolean, attachment_url text, is_verified boolean, verified_by bigint, verified_at timestamptz, notes text, late_expense_event_id bigint, capitalization_state text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE purchases (id text PRIMARY KEY DEFAULT ('pur-' || md5(random()::text)), tenant_id text, import_project_id text, doc_no text, total numeric, paid_amount numeric, status text);
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric, payment_date date, expected_return_date date, actual_return_date date, refund_status text, refunded_amount_egp numeric, deductions_amount_egp numeric, deduction_reason text, treasury_account_id bigint, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_container_deposits_tenant_shipment_container UNIQUE (tenant_id, shipment_id, container_no));
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
  if (opts.migrate !== false) {
    await writeUniquenessMigration.up(db as never);
  }
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

async function depositCount(db: Kysely<Database>): Promise<number> {
  const rows = await db.selectFrom('import_container_deposits').select('id').execute();
  return rows.length;
}

async function journalEntryCount(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ c: string }>`
    SELECT COUNT(*) AS c FROM journal_entries
    WHERE tenant_id = 't1' AND source_type = 'import_container_deposit'
  `.execute(db);
  return Number(rows.rows[0].c);
}

async function treasuryCount(db: Kysely<Database>): Promise<number> {
  const rows = await db
    .selectFrom('treasury_transactions')
    .select('id')
    .where('txn_type', '=', 'import_container_deposit')
    .execute();
  return rows.length;
}

async function main(): Promise<void> {
  // Case 1: the real migration 0306 up() applies to a pre-migration
  // schema: a legacy deposit row is backfilled, the column is
  // NOT NULL, the unique index exists, and a second run is a no-op.
  {
    const db = await makeDb({ migrate: false });
    try {
      await db
        .insertInto('import_container_deposits' as never)
        .values({
          tenant_id: 't1',
          project_id: 'proj-1',
          shipment_id: 'sh-1',
          container_no: 'MSCU-LEGACY-001',
          shipping_line: 'MSC Mediterranean Shipping Company',
          deposit_amount_egp: 50,
          payment_date: '2026-11-01',
          expected_return_date: '2026-12-01',
          refund_status: 'pending',
          refunded_amount_egp: 0,
          deductions_amount_egp: 0,
        } as never)
        .execute();
      const before = await sql<{ column_name: string }>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'import_container_deposits' AND column_name = 'idempotency_key'
      `.execute(db);
      assert.equal(before.rows.length, 0, 'Bare fixture carries no idempotency_key column (pre-migration shape)');
      await writeUniquenessMigration.up(db as never);
      const after = await sql<{ column_name: string; is_nullable: string }>`
        SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'import_container_deposits' AND column_name = 'idempotency_key'
      `.execute(db);
      assert.equal(after.rows.length, 1, 'Migration up() adds the idempotency_key column');
      assert.equal(after.rows[0].is_nullable, 'NO', 'The idempotency_key column is NOT NULL after the backfill');
      const legacy = await db
        .selectFrom('import_container_deposits')
        .select(['serial_id', 'idempotency_key'] as never)
        .execute();
      assert.equal((legacy[0] as any).idempotency_key, `legacy:${(legacy[0] as any).serial_id}`, 'Legacy rows are backfilled with a stable legacy:<serial_id> key');
      const index = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'import_container_deposits'
          AND indexname = 'uq_import_container_deposits_tenant_idempotency'
      `.execute(db);
      assert.equal(index.rows.length, 1, 'Migration up() creates the tenant idempotency unique index');
      await writeUniquenessMigration.up(db as never);
      assert.equal(await depositCount(db), 1, 'Migration up() is idempotent: a second run keeps the legacy row');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: a valid first deposit records + posts exactly as before.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const deposit = await service.recordContainerDeposit('t1', 1, trialDto());
      assert.equal(Number(deposit.deposit_amount_egp), 100, 'Deposit records the trial 100 EGP amount');
      assert.equal(deposit.refund_status, 'pending', 'Deposit starts pending');
      assert.equal(deposit.idempotency_key, 'deposit:sh-1:MSCU-TEST-001', 'No client key: the service stores the derived natural key');
      assert.equal(await depositCount(db), 1, 'Exactly one deposit row exists');
      assert.equal(await journalEntryCount(db), 1, 'Exactly one JE is posted');
      assert.equal(await treasuryCount(db), 1, 'Exactly one treasury row is recorded');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: retry, same payload, no client key — returns the SAME
  // deposit, no second row, no second JE, no second treasury row.
  // On base this fails: the second insert throws a raw 23505
  // (the natural unique constraint) and nothing replays it.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const first = await service.recordContainerDeposit('t1', 1, trialDto());
      const replayed = await service.recordContainerDeposit('t1', 1, trialDto());
      assert.equal(replayed.id, first.id, 'A same-payload retry returns the existing deposit, not a new one');
      assert.equal(Number(replayed.deposit_amount_egp), 100, 'The replayed deposit carries the same amount');
      assert.equal(await depositCount(db), 1, 'The retry records no second deposit');
      assert.equal(await journalEntryCount(db), 1, 'The retry posts no second JE');
      assert.equal(await treasuryCount(db), 1, 'The retry records no second treasury row');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: retry with an explicit client key — same replay, and the
  // stored key is the client key.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const first = await service.recordContainerDeposit('t1', 1, trialDto({ idempotencyKey: 'dep-retry-001' }));
      assert.equal(first.idempotency_key, 'dep-retry-001', 'A client key is stored as sent');
      const replayed = await service.recordContainerDeposit('t1', 1, trialDto({ idempotencyKey: 'dep-retry-001' }));
      assert.equal(replayed.id, first.id, 'A same-key retry returns the existing deposit');
      assert.equal(await depositCount(db), 1, 'The keyed retry records no second deposit');
      assert.equal(await journalEntryCount(db), 1, 'The keyed retry posts no second JE');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: same client key, different amount — named conflict, no
  // second row, no second JE (a key collision is fail-closed, never
  // a silent replay of different money).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await service.recordContainerDeposit('t1', 1, trialDto({ idempotencyKey: 'dep-retry-002' }));
      await expectReject(
        service.recordContainerDeposit('t1', 1, trialDto({ idempotencyKey: 'dep-retry-002', depositAmountEgp: 250 })),
        /IMPORT_CONTAINER_DEPOSIT_DUPLICATE_KEY/,
        'Same key with a different amount fails with the named duplicate-key error',
      );
      assert.equal(await depositCount(db), 1, 'The conflicting retry records no second deposit');
      assert.equal(await journalEntryCount(db), 1, 'The conflicting retry posts no second JE');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: same container, different key — named conflict
  // IMPORT_CONTAINER_DEPOSIT_ALREADY_RECORDED (one deposit per
  // container per shipment), still one row and one JE.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await service.recordContainerDeposit('t1', 1, trialDto({ idempotencyKey: 'dep-key-a' }));
      await expectReject(
        service.recordContainerDeposit('t1', 1, trialDto({ idempotencyKey: 'dep-key-b', depositAmountEgp: 100 })),
        /IMPORT_CONTAINER_DEPOSIT_ALREADY_RECORDED/,
        'A second deposit for the same container fails with the named already-recorded error',
      );
      assert.equal(await depositCount(db), 1, 'The second-container deposit records nothing');
      assert.equal(await journalEntryCount(db), 1, 'The second-container deposit posts no JE');
    } finally {
      await db.destroy();
    }
  }

  // Case 7: two different containers, same client key — the second
  // fails with the named duplicate-key error (a key collision across
  // containers is fail-closed, never a silent replay of the wrong
  // container's deposit).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await service.recordContainerDeposit('t1', 1, trialDto({ idempotencyKey: 'dep-shared-key' }));
      await expectReject(
        service.recordContainerDeposit(
          't1',
          1,
          trialDto({ idempotencyKey: 'dep-shared-key', containerNo: 'MSCU-TEST-002' }),
        ),
        /IMPORT_CONTAINER_DEPOSIT_DUPLICATE_KEY/,
        'Reusing one client key for a different container fails with the named duplicate-key error',
      );
      assert.equal(await depositCount(db), 1, 'The colliding deposit records nothing');
      assert.equal(await journalEntryCount(db), 1, 'The colliding deposit posts no JE');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import container deposit idempotency tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
