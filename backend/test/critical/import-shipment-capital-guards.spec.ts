/*
New file: backend/test/critical/import-shipment-capital-guards.spec.ts
Pins over-receipt, duplicate-container and capital-idempotency
guards plus the per-project percentage pool
(INV-IMPORT-SHIPMENT-CAPITAL-GUARDS).

WHAT WAS WRONG: updateShipmentItem accepted any received
quantity, so receipts could exceed the bill of lading;
createShipment had no duplicate check for a container recorded
twice on the same bill of lading; recordCapitalTransaction had
no idempotency key, so a retried capital movement posted twice;
and the global import_partners percentage sum was enforced
while distribution actually reads the per-project pool, which
createProject never checked — so two partners at 60% each could
be created globally-blocked yet a project could still carry
60% + 60%.

WHAT THIS PINS, driving the real service methods on PGlite:
- Receiving 11 against a B/L quantity of 10 is rejected (and
  3-decimal drift is rejected); receiving exactly 10 succeeds.
- The same container + bill of lading pair is rejected; the
  same B/L with a different container succeeds (one B/L covers
  many containers); the same container on another B/L is
  rejected by the pre-existing (tenant, container) unique
  index backstop.
- A capital movement retried with the same key is rejected and
  posts once; a different key posts again.
- Two partners at 60% global each are creatable (the global
  field is legacy and unenforced); a project carrying 60% +
  60% is rejected, while 60% + 40% is stored per-project.
- Migration 0282 itself is proven on a minimal ledger table:
  up() adds the column and the partial unique index.

LIMIT: true concurrency is not drivable on PGlite's single
connection; the 23505 backstops are proven by the index
assertions and the duplicate-key cases, not by racing threads.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { up as migrate0282Up } from '../../src/database/migrations/2040000000282_partner_ledger_idempotency_key';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY, name text);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE import_projects (id text PRIMARY KEY DEFAULT ('proj-' || md5(random()::text)), tenant_id text, project_no text, title text, target_market text, country_origin text, country_destination text, budget_currency text, allocated_capital numeric, target_roi_percentage numeric, status text, feasibility_data text, notes text, sector_preset text, created_at timestamptz DEFAULT NOW());
    CREATE UNIQUE INDEX uq_import_projects_tenant_project_no ON import_projects (tenant_id, project_no);
    CREATE TABLE import_shipments (id text PRIMARY KEY DEFAULT ('sh-' || md5(random()::text)), tenant_id text, supplier_id bigint, project_id text, container_number text, bill_of_lading text, status text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days numeric, demurrage_start_date text, demurrage_rate_per_day numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, actual_demurrage_fees numeric, shipped_date text, eta_date text, clearance_date text, arrival_date text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE UNIQUE INDEX uq_import_shipments_tenant_container ON import_shipments (tenant_id, container_number);
    CREATE TABLE import_shipment_items (id text PRIMARY KEY DEFAULT ('item-' || md5(random()::text)), tenant_id text, shipment_id text, product_id bigint, quantity numeric, received_quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, shortage_handling_method text, gross_weight_kg_unit numeric, cbm_unit numeric, target_retail_margin numeric, target_wholesale_margin numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text, paid_amount_foreign numeric);
    CREATE TABLE import_partners (id text PRIMARY KEY DEFAULT ('par-' || md5(random()::text)), tenant_id text, name text, profit_share_percentage numeric, capital_amount numeric, withdrawn_profit numeric);
    CREATE TABLE import_project_partners (id bigserial PRIMARY KEY, tenant_id text, project_id text, partner_id text, capital_share_amount numeric, profit_percentage numeric, is_active boolean, effective_from text);
    CREATE UNIQUE INDEX uq_import_project_partners ON import_project_partners (tenant_id, project_id, partner_id);
    CREATE TABLE import_partner_ledger (id text PRIMARY KEY DEFAULT ('led-' || md5(random()::text)), tenant_id text, partner_id text, type text, amount numeric, transaction_date text, note text, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text);
    CREATE UNIQUE INDEX uq_partner_ledger_tenant_partner_key ON import_partner_ledger (tenant_id, partner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    INSERT INTO tenants VALUES ('t1', 'Tenant One');
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"'), ('t1', 'timezone', '"Africa/Cairo"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (27, 't1', 't1', '3100', 'رأس مال', 'Equity', 'equity', 'equity', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (9, 't1', 'Shipment Supplier');
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

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function main(): Promise<void> {
  // Case 1: over-receipt rejected, exact receipt accepted.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const shipment = await service.createShipment('t1', { containerNumber: 'MSCU-10', billOfLading: 'BL-10', supplierId: '9', exchangeRateAtArrival: 50 });
      await db.insertInto('import_shipment_items' as never).values({
        tenant_id: 't1', shipment_id: shipment.id, product_id: 5, quantity: 10,
        received_quantity: 0, factory_unit_price_usd: 10, landed_cost_egp: 0,
        shortage_handling_method: 'capitalize',
      } as never).execute();
      const item: any = await (db as any).selectFrom('import_shipment_items').selectAll().executeTakeFirstOrThrow();
      await assert.rejects(
        async () => service.updateShipmentItem('t1', item.id, { receivedQuantity: 11 }),
        /تتجاوز البوليصة/,
        'Receiving more than the B/L quantity must be rejected',
      );
      await assert.rejects(
        async () => service.updateShipmentItem('t1', item.id, { receivedQuantity: 10.0001 }),
        /تتجاوز البوليصة|دقة المخزون/,
        'Receiving beyond 3-decimal stock precision must be rejected',
      );
      const unchanged: any = await (db as any).selectFrom('import_shipment_items').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
      assert.equal(Number(unchanged.received_quantity), 0, 'Rejected updates must not change the stored quantity');
      await service.updateShipmentItem('t1', item.id, { receivedQuantity: 10 });
      const stored: any = await (db as any).selectFrom('import_shipment_items').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
      assert.equal(Number(stored.received_quantity), 10, 'Receiving exactly the B/L quantity succeeds');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: duplicate container + B/L rejected; B/L alone is not unique.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await service.createShipment('t1', { containerNumber: 'MSCU-20', billOfLading: 'BL-20', supplierId: '9' });
      await assert.rejects(
        async () => service.createShipment('t1', { containerNumber: 'MSCU-20', billOfLading: 'BL-20', supplierId: '9' }),
        /مسجلة بالفعل/,
        'The same container on the same B/L must be rejected',
      );
      await assert.rejects(
        async () => service.createShipment('t1', { containerNumber: '  MSCU-20  ', billOfLading: 'BL-20', supplierId: '9' }),
        /مسجلة بالفعل/,
        'Whitespace variants of the same pair must be rejected',
      );
      const otherBl = await service.createShipment('t1', { containerNumber: 'MSCU-21', billOfLading: 'BL-20', supplierId: '9' });
      assert.ok(otherBl.id, 'The same B/L with a different container succeeds: one B/L covers many containers');
      await assert.rejects(
        async () => service.createShipment('t1', { containerNumber: 'MSCU-20', billOfLading: 'BL-99', supplierId: '9' }),
        /مسجل بالفعل/,
        'The same container number is stopped by the pre-existing unique index backstop',
      );
      assert.equal(await countRows(db, 'import_shipments'), 2, 'Only the two legitimate shipments exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: capital double-submit with the same key posts once.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const partner = await service.createPartner('t1', 1, 'Capital Partner', 10, 0);
      const dto = { type: 'DEPOSIT', amount: 1000, date: '2026-11-02', accountId: '24', idempotencyKey: 'cap-key-1' };
      const first = await service.recordCapitalTransaction('t1', 1, partner.id, dto);
      assert.equal(first.success, true);
      await assert.rejects(
        async () => service.recordCapitalTransaction('t1', 1, partner.id, dto),
        /عدم التكرار/,
        'A retry with the same key must be rejected as a duplicate',
      );
      const stored: any = await (db as any).selectFrom('import_partners').selectAll().where('id', '=', partner.id).executeTakeFirstOrThrow();
      assert.equal(Number(stored.capital_amount), 1000, 'Capital moves once');
      assert.equal(await countRows(db, 'import_partner_ledger'), 1, 'Exactly one ledger row may exist');
      await service.recordCapitalTransaction('t1', 1, partner.id, { ...dto, idempotencyKey: 'cap-key-2' });
      const after: any = await (db as any).selectFrom('import_partners').selectAll().where('id', '=', partner.id).executeTakeFirstOrThrow();
      assert.equal(Number(after.capital_amount), 2000, 'A different key posts again');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: per-project pool is authoritative; the global field is not.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const a = await service.createPartner('t1', 1, 'Partner A', 60, 0);
      const b = await service.createPartner('t1', 1, 'Partner B', 60, 0);
      assert.ok(a.id && b.id, 'Two partners at 60% global each are creatable: the global field is legacy');
      await assert.rejects(
        async () => service.createPartner('t1', 1, 'Partner C', 150, 0),
        /بين 0% و100%/,
        'Range validation on the global field is kept',
      );
      await assert.rejects(
        async () => service.updatePartner('t1', a.id, undefined, 150),
        /بين 0% و 100%/,
        'Range validation on percentage edits is kept',
      );
      await assert.rejects(
        async () => service.createProject('t1', {
          title: 'Over-subscribed',
          partners: [
            { partnerId: a.id, capitalShare: 0, profitPercentage: 60 },
            { partnerId: b.id, capitalShare: 0, profitPercentage: 60 },
          ],
        }),
        /يتجاوز 100%/,
        'A project carrying 60% + 60% must be rejected',
      );
      assert.equal(await countRows(db, 'import_projects'), 0, 'The rejected project must roll back');
      const project = await service.createProject('t1', {
        title: 'Balanced',
        partners: [
          { partnerId: a.id, capitalShare: 0, profitPercentage: 60 },
          { partnerId: b.id, capitalShare: 0, profitPercentage: 40 },
        ],
      });
      const pool: any[] = await (db as any).selectFrom('import_project_partners').selectAll().where('project_id', '=', project.id).execute();
      assert.equal(pool.length, 2, 'Both project partners are stored');
      const total = pool.reduce((s, r) => s + Number(r.profit_percentage), 0);
      assert.equal(total, 100, 'The stored per-project pool sums to 100');
      // setProjectPartners still enforces the same ceiling (existing behaviour pinned).
      await assert.rejects(
        async () => service.setProjectPartners('t1', project.id, [
          { partnerId: a.id, profitPercentage: 60 },
          { partnerId: b.id, profitPercentage: 60 },
        ]),
        /يتجاوز 100%/,
        'setProjectPartners keeps enforcing the per-project ceiling',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 5: migration 0282 itself adds the column + partial index.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE import_partner_ledger (
          id TEXT PRIMARY KEY, tenant_id TEXT, partner_id TEXT, type TEXT,
          amount NUMERIC, transaction_date TEXT, note TEXT, created_by BIGINT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await migrate0282Up(db as any);
      const cols: any[] = await (db as any)
        .selectFrom('information_schema.columns' as never).selectAll()
        .where('table_name', '=', 'import_partner_ledger')
        .where('column_name', '=', 'idempotency_key')
        .execute();
      assert.equal(cols.length, 1, 'Migration up() must add the idempotency_key column');
      const indexes: any[] = await (db as any)
        .selectFrom('pg_indexes' as never).selectAll()
        .where('indexname', '=', 'uq_partner_ledger_tenant_partner_key')
        .execute();
      assert.equal(indexes.length, 1, 'Migration up() must create the partial unique index');
      await db.insertInto('import_partner_ledger' as never).values({
        id: 'l1', tenant_id: 't1', partner_id: 'p1', type: 'DEPOSIT', amount: 10,
        transaction_date: '2026-11-02', idempotency_key: 'k1',
      } as never).execute();
      await assert.rejects(
        async () => db.insertInto('import_partner_ledger' as never).values({
          id: 'l2', tenant_id: 't1', partner_id: 'p1', type: 'DEPOSIT', amount: 10,
          transaction_date: '2026-11-02', idempotency_key: 'k1',
        } as never).execute(),
        (err: any) => err?.code === '23505',
        'The index must reject a duplicate key for the same partner',
      );
      await db.insertInto('import_partner_ledger' as never).values({
        id: 'l3', tenant_id: 't1', partner_id: 'p1', type: 'DEPOSIT', amount: 10,
        transaction_date: '2026-11-02', idempotency_key: null,
      } as never).execute();
      await db.insertInto('import_partner_ledger' as never).values({
        id: 'l4', tenant_id: 't1', partner_id: 'p1', type: 'DEPOSIT', amount: 10,
        transaction_date: '2026-11-02', idempotency_key: null,
      } as never).execute();
    } finally {
      await db.destroy();
    }
  }

  console.log('Import shipment and capital guard tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
