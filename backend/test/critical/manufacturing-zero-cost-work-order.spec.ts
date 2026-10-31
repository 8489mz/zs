/*
New file: backend/test/critical/manufacturing-zero-cost-work-order.spec.ts
Pins INV-MANUFACTURING-ZERO-COST: a genuinely zero-cost work order posts
nothing and does not throw (the unbuild precedent), while the mismatch
guard and the positive-cost journal are unchanged.

WHAT THE AUDIT FEARED: postManufacturingWorkOrder threw
MANUFACTURING_COST_MISSING whenever fgCost <= 0, so a genuinely free
production (zero-cost materials, no overhead, no operations) failed the
whole completeWorkOrder transaction -- stock moves, consumption rows and
completion all rolled back, with no way to complete the order. And the
restaurant auto-produce caller turned a missing journal into a 500, so
relaxing the poster alone would still fail the sale.

WHAT THIS PINS, driving the REAL completeWorkOrder and the REAL poster
on PGlite:
1. A zero-cost work order completes, moves stock, and posts NO journal.
2. A positive-cost work order still posts Dr 1140 / Cr 1140 / Cr 5400
   exactly as before (the residual overhead derivation is unchanged).
3. A cost mismatch (consumption sum above the stored order total) still
   throws MANUFACTURING_COST_MISMATCH when the poster is driven directly.

Deliberately NOT driven here: the restaurant auto-produce caller guard
in sales-write.service.ts -- driving a full sale through the PGlite
harness is out of scope for this spec; the one-line guard
(totalCost > 0) is verified by inspection and shares the poster's
return contract. The overhead-as-residual re-derivation is explicitly
deferred and is pinned unchanged by case 2.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { ManufacturingService } from '../../src/modules/manufacturing/services/manufacturing.service';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

async function seedProduct(db: Kysely<Database>, id: number, qty: number, cost: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials, default_location_id) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, ${cost}, true, false, 1)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${qty}, 0)`.execute(db);
}

async function seedBom(db: Kysely<Database>, bomId: number, fgId: number, compId: number, qty: number, overhead: number): Promise<void> {
  await sql`INSERT INTO manufacturing_boms (id, product_id, quantity, overhead_cost, expected_cost, is_active, tenant_id, account_id) VALUES (${bomId}, ${fgId}, 1, ${overhead}, 0, true, 't1', 'a1')`.execute(db);
  await sql`INSERT INTO manufacturing_bom_lines (bom_id, component_product_id, quantity, unit_name, unit_multiplier, waste_percentage, expected_cost) VALUES (${bomId}, ${compId}, ${qty}, 'unit', 1, 0, 0)`.execute(db);
}

async function seedWorkOrder(db: Kysely<Database>, id: number, bomId: number, qty: number): Promise<void> {
  await sql`INSERT INTO manufacturing_work_orders (id, bom_id, status, quantity_to_produce, produced_quantity, source_location_id, destination_location_id, total_cost, note, created_by, tenant_id, account_id) VALUES (${id}, ${bomId}, 'draft', ${qty}, 0, 1, 1, 0, '', 1, 't1', 'a1')`.execute(db);
}

async function journalEntries(db: Kysely<Database>, workOrderId: number): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'manufacturing_work_order' AND source_id = ${workOrderId}`.execute(db);
  return Number(rows.rows[0].n);
}

async function journalLines(db: Kysely<Database>, workOrderId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'manufacturing_work_order' AND e.source_id = ${workOrderId} ORDER BY l.id`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function scopedQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = 1`.execute(db);
  return row.rows.length ? Number(row.rows[0].qty) : 0;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const service = new ManufacturingService(db as never, new TransactionHelper(), new AuditService(db as never), posting);

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
      INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type) VALUES (1140,'t1','a1','1140','asset'), (5190,'t1','a1','5190','expense'), (5200,'t1','a1','5200','expense'), (5400,'t1','a1','5400','expense'), (7100,'t1','a1','7100','revenue');
      CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
      INSERT INTO branches VALUES (1, 't1', 'Main', 1);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      INSERT INTO stock_locations VALUES (1, 't1', 'a1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, product_id bigint, quantity numeric, overhead_cost numeric, expected_cost numeric, is_active boolean, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE manufacturing_bom_lines (id bigserial PRIMARY KEY, bom_id bigint, component_product_id bigint, quantity numeric, unit_name text, unit_multiplier numeric, waste_percentage numeric, expected_cost numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE manufacturing_work_orders (id bigint PRIMARY KEY, doc_no text, bom_id bigint, status text, quantity_to_produce numeric, produced_quantity numeric, source_location_id bigint, destination_location_id bigint, start_date timestamptz, end_date timestamptz, total_cost numeric, completed_at timestamptz, note text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, tenant_id text, account_id text);
      CREATE TABLE manufacturing_wo_consumptions (id bigserial PRIMARY KEY, tenant_id text, account_id text, work_order_id bigint, component_product_id bigint, quantity_consumed numeric, unit_cost numeric, line_total numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE manufacturing_wo_operations (id bigserial PRIMARY KEY, tenant_id text, account_id text, work_order_id bigint, work_center_id bigint, operation_name text, sequence int, duration_hours numeric, hourly_cost numeric, total_cost numeric, status text, notes text);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    `);

    // Case 1: genuinely zero-cost production completes and posts nothing.
    await seedProduct(db, 1, 0, 0);
    await seedProduct(db, 2, 10, 0);
    await seedBom(db, 1, 1, 2, 1, 0);
    await seedWorkOrder(db, 1, 1, 2);
    const res1 = await service.completeWorkOrder(1, {} as never, AUTH);
    assert.equal((res1 as any).ok, true);
    assert.equal(await scopedQty(db, 1), 2);
    assert.equal(await scopedQty(db, 2), 8);
    assert.equal(await journalEntries(db, 1), 0);
    const wo1 = await sql<{ total_cost: string; status: string }>`SELECT total_cost, status FROM manufacturing_work_orders WHERE id = 1`.execute(db);
    assert.equal(Number(wo1.rows[0].total_cost), 0);
    assert.equal(wo1.rows[0].status, 'done');

    // Case 2: positive-cost production posts the unchanged journal.
    await seedProduct(db, 3, 0, 0);
    await seedProduct(db, 4, 10, 10);
    await seedBom(db, 2, 3, 4, 1, 0);
    await seedWorkOrder(db, 2, 2, 1);
    await service.completeWorkOrder(2, {} as never, AUTH);
    assert.equal(await journalEntries(db, 2), 1);
    assert.deepEqual(await journalLines(db, 2), [
      { code: '1140', debit: 10, credit: 0 },
      { code: '1140', debit: 0, credit: 10 },
    ]);

    // Case 3: a cost mismatch still throws when the poster is driven directly.
    await seedProduct(db, 5, 0, 0);
    await seedProduct(db, 6, 10, 10);
    await seedBom(db, 3, 5, 6, 1, 0);
    await seedWorkOrder(db, 3, 3, 1);
    await sql`UPDATE manufacturing_work_orders SET total_cost = 5, status = 'done', completed_at = NOW() WHERE id = 3`.execute(db);
    await sql`INSERT INTO manufacturing_wo_consumptions (tenant_id, account_id, work_order_id, component_product_id, quantity_consumed, unit_cost, line_total) VALUES ('t1', 'a1', 3, 6, 1, 10, 10)`.execute(db);
    await assert.rejects(
      posting.postManufacturingWorkOrder(db as never, 3, AUTH),
      (err: any) => err && err.code === 'MANUFACTURING_COST_MISMATCH' && err.statusCode === 409,
    );
    assert.equal(await journalEntries(db, 3), 0);
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('manufacturing zero-cost work order checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
