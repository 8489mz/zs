/*
New file: backend/test/critical/import-container-preorder-idempotency.spec.ts
Pins server-side preorder idempotency through the real
createContainerPreorder (INV-IMPORT-PREORDER-IDEMPOTENCY, I6-E).

WHAT WAS WRONG (live trial phase 2, problem D12 residual): no
server-side preorder idempotency — a retry after a network drop
double-recorded the reservation: a second row, a second slice of
B/L capacity consumed, and (with a deposit) a second advance JE.
Unlike deposits there is NO natural unique constraint here:
preorder_no is a fresh randomUUID per row, so nothing at the DB
level could ever stop the duplicate.

KEY SOURCE (grounded, decision recorded): the key is OPTIONAL on
the DTO. A caller that sends idempotencyKey owns the retry
identity; a caller that does not (the live form sends exactly the
DTO fields and no key, after I4-D12 removed the dead field) gets
a server-derived key from the reservation identity —
'preorder:<shipmentId>:<customerId>:<productId>:<qty>:<unitPrice>:
<deposit>'. A retry sends the identical payload, so it replays;
a genuinely different reservation gets a different key.
KNOWN LIMIT, pinned in case 7: two intentionally identical
reservations with no client key are indistinguishable from a
retry and the second returns the first; sending a client key
removes the ambiguity. The duplicate identity is (tenant,
effective key); the replay compares shipment + customer +
product + qty + unit price + deposit, and a same-key /
different-payload retry fails closed with
IMPORT_CONTAINER_PREORDER_DUPLICATE_KEY.

WHAT THIS PINS, driving the real createContainerPreorder on
PGlite through the real posting boundary (trial shape: B/L
capacity 10, landed cost 90 EGP/unit):
- The real migration 0306 up() applies to a pre-migration schema:
  a legacy preorder row is backfilled with a 'legacy:<serial_id>'
  key, the column is NOT NULL afterwards, the unique index exists,
  and a second up() run is a no-op.
- Retry, same payload, no client key, with a 9 EGP deposit:
  returns the SAME reservation — still 1 preorder, 1 JE, 1
  treasury row. (On base this fails: the retry inserts a second
  row and posts a second JE.)
- Retry with an explicit client key: same replay; the stored key
  is the client key.
- Same key, different qty: named conflict
  IMPORT_CONTAINER_PREORDER_DUPLICATE_KEY, still 1 row, 1 JE.
- A different reservation (different qty, no key) still records
  as a second row — the derived key does not over-block distinct
  reservations; the B/L capacity check still binds both.
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
// leave them (no idempotency column on preorders). The preorders
// DDL mirrors migration 0239, including its
// (tenant_id, preorder_no) unique constraint. makeDb applies the
// real migration 0306 up() unless told not to.
async function makeDb(opts: { migrate?: boolean } = {}): Promise<Kysely<Database>> {
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
    CREATE TABLE import_qc_inspections (id text PRIMARY KEY DEFAULT ('qc-' || md5(random()::text)), tenant_id text, shipment_id text, stage text);
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), serial_id bigserial, tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_import_preorders_no UNIQUE (tenant_id, preorder_no));
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
    INSERT INTO import_shipments (id, tenant_id, container_number, project_id, status) VALUES ('sh-1', 't1', 'MSCU-TEST-001', 'proj-1', 'Pending');
    INSERT INTO import_shipment_items (id, tenant_id, shipment_id, product_id, quantity, factory_unit_price_usd, landed_cost_egp, received_quantity) VALUES ('item-1', 't1', 'sh-1', 101, 10, 1.8, 90, NULL);
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

async function journalEntryCount(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ c: string }>`
    SELECT COUNT(*) AS c FROM journal_entries
    WHERE tenant_id = 't1' AND source_type = 'import_container_preorder'
  `.execute(db);
  return Number(rows.rows[0].c);
}

async function treasuryCount(db: Kysely<Database>): Promise<number> {
  const rows = await db
    .selectFrom('treasury_transactions')
    .select('id')
    .where('txn_type', '=', 'import_customer_advance')
    .execute();
  return rows.length;
}

async function main(): Promise<void> {
  // Case 1: the real migration 0306 up() applies to a pre-migration
  // schema: a legacy preorder row is backfilled, the column is
  // NOT NULL, the unique index exists, and a second run is a no-op.
  {
    const db = await makeDb({ migrate: false });
    try {
      await db
        .insertInto('import_container_preorders' as never)
        .values({
          tenant_id: 't1',
          preorder_no: 'PRE-legacy-1',
          project_id: 'proj-1',
          shipment_id: 'sh-1',
          customer_id: 201,
          product_id: 101,
          reserved_quantity: 1,
          unit_price_egp: 90,
          total_price_egp: 90,
          deposit_amount_egp: 0,
          status: 'reserved',
          created_by: 1,
        } as never)
        .execute();
      const before = await sql<{ column_name: string }>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'import_container_preorders' AND column_name = 'idempotency_key'
      `.execute(db);
      assert.equal(before.rows.length, 0, 'Bare fixture carries no idempotency_key column (pre-migration shape)');
      await writeUniquenessMigration.up(db as never);
      const after = await sql<{ column_name: string; is_nullable: string }>`
        SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'import_container_preorders' AND column_name = 'idempotency_key'
      `.execute(db);
      assert.equal(after.rows.length, 1, 'Migration up() adds the idempotency_key column');
      assert.equal(after.rows[0].is_nullable, 'NO', 'The idempotency_key column is NOT NULL after the backfill');
      const legacy = await db
        .selectFrom('import_container_preorders')
        .select(['serial_id', 'idempotency_key'] as never)
        .execute();
      assert.equal((legacy[0] as any).idempotency_key, `legacy:${(legacy[0] as any).serial_id}`, 'Legacy rows are backfilled with a stable legacy:<serial_id> key');
      const index = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'import_container_preorders'
          AND indexname = 'uq_import_container_preorders_tenant_idempotency'
      `.execute(db);
      assert.equal(index.rows.length, 1, 'Migration up() creates the tenant idempotency unique index');
      await writeUniquenessMigration.up(db as never);
      assert.equal(await preorderCount(db), 1, 'Migration up() is idempotent: a second run keeps the legacy row');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: a valid reservation with a proportionate deposit (9 = 10%
  // of 90) records + posts exactly as before, storing the derived key.
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
      assert.equal(
        preorder.idempotency_key,
        'preorder:sh-1:201:101:1:90:9',
        'No client key: the service stores the derived reservation-identity key',
      );
      assert.equal(await journalEntryCount(db), 1, 'Exactly one JE is posted');
      assert.equal(await treasuryCount(db), 1, 'Exactly one treasury row is recorded');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: retry, same payload, no client key — returns the SAME
  // reservation, no second row, no second JE, no second treasury
  // row. On base this fails: the retry inserts a second row and
  // posts a second JE (preorder_no is a fresh randomUUID, so
  // nothing at the DB level could stop it).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const dto = trialDto({ depositAmountEgp: 9, depositTreasuryAccountId: '12' });
      const first = await service.createContainerPreorder('t1', 1, dto);
      const replayed = await service.createContainerPreorder('t1', 1, trialDto({ depositAmountEgp: 9, depositTreasuryAccountId: '12' }));
      assert.equal(replayed.id, first.id, 'A same-payload retry returns the existing reservation, not a new one');
      assert.equal(replayed.preorder_no, first.preorder_no, 'The replayed reservation carries the same preorder number');
      assert.equal(await preorderCount(db), 1, 'The retry records no second reservation');
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
      const first = await service.createContainerPreorder('t1', 1, trialDto({ idempotencyKey: 'pre-retry-001' }));
      assert.equal(first.idempotency_key, 'pre-retry-001', 'A client key is stored as sent');
      const replayed = await service.createContainerPreorder('t1', 1, trialDto({ idempotencyKey: 'pre-retry-001' }));
      assert.equal(replayed.id, first.id, 'A same-key retry returns the existing reservation');
      assert.equal(await preorderCount(db), 1, 'The keyed retry records no second reservation');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: same client key, different qty — named conflict, no
  // second row, no second JE.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await service.createContainerPreorder(
        't1',
        1,
        trialDto({ idempotencyKey: 'pre-retry-002', depositAmountEgp: 9, depositTreasuryAccountId: '12' }),
      );
      await expectReject(
        service.createContainerPreorder(
          't1',
          1,
          trialDto({ idempotencyKey: 'pre-retry-002', reservedQuantity: 2, depositAmountEgp: 18, depositTreasuryAccountId: '12' }),
        ),
        /IMPORT_CONTAINER_PREORDER_DUPLICATE_KEY/,
        'Same key with a different qty fails with the named duplicate-key error',
      );
      assert.equal(await preorderCount(db), 1, 'The conflicting retry records no second reservation');
      assert.equal(await journalEntryCount(db), 1, 'The conflicting retry posts no second JE');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: a different reservation (different qty, no key) still
  // records as a second row — the derived key does not over-block
  // distinct reservations; the B/L capacity check still binds both.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const first = await service.createContainerPreorder('t1', 1, trialDto());
      const second = await service.createContainerPreorder('t1', 1, trialDto({ reservedQuantity: 2 }));
      assert.notEqual(second.id, first.id, 'A distinct reservation records a new row');
      assert.equal(await preorderCount(db), 2, 'Two distinct reservations coexist');
      const over = service.createContainerPreorder('t1', 1, trialDto({ reservedQuantity: 8 }));
      await expectReject(over, /لا يمكن تجاوز كمية البوليصة/, '1 + 2 + 8 exceeds capacity 10 and still fails naming the B/L rule');
      assert.equal(await preorderCount(db), 2, 'The over-capacity reservation records nothing');
    } finally {
      await db.destroy();
    }
  }

  // Case 7 (documented limit): two intentionally identical
  // reservations with no client key are indistinguishable from a
  // retry — the second returns the first. A client key (case 4)
  // is what disambiguates them.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const first = await service.createContainerPreorder('t1', 1, trialDto());
      const second = await service.createContainerPreorder('t1', 1, trialDto());
      assert.equal(second.id, first.id, 'An identical no-key second submit replays the first reservation by design');
      assert.equal(await preorderCount(db), 1, 'Only one reservation row exists');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import container preorder idempotency tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
