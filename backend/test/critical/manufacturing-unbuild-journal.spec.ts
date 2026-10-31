/*
New file: backend/test/critical/manufacturing-unbuild-journal.spec.ts
Pins the unbuild journal (INV-MANUFACTURING-UNBUILD-JOURNAL).

THE GAP: createUnbuildOrder moved stock with NO journal and NO
WAC update, valued the recovered components at the BOM line's
stale expected_cost (not the live WAC), and rounded money with
toFixed(3). Finished goods left the books at one value while
components returned at another, and the difference vanished --
inventory value changed with no general-ledger trace at all.

THE RULE: the unbuild consumes the finished product at its live
WAC and recovers each component at its live WAC, with money
rounded once at the tenant's book digits; both legs are stamped
on their stock movements, and a balanced journal is posted in
the same transaction -- Dr inventory for the recovered value,
Cr inventory for the consumed finished-goods value, and the
difference to the price-variance account 5190 (debit when the
finished goods were worth more than what came back, credit
when the recovery is worth more). A zero-cost unbuild posts
nothing and does not throw; a missing 5190 with a nonzero
difference fails the whole unbuild closed.

WHAT THIS PINS, driving the REAL createUnbuildOrder on PGlite:
- stale BOM expected_cost (99) is ignored: recovery values at
  the live WAC (6), the journal is Dr 1140 12 / Cr 1140 20 /
  Dr 5190 8 for 2 units, and the order total is 12.
- an exactly-balanced unbuild posts no 5190 line.
- recovery worth more than the finished goods credits 5190.
- a zero-cost unbuild succeeds, moves stock, and posts no
  journal instead of throwing.
- a missing 5190 account is auto-created by the system-account
  resolver (the same treatment GRN price variance gets) and the
  journal posts to it.
- an inactive BOM or an inactive finished product is rejected
  before any stock moves.
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

async function seedProduct(db: Kysely<Database>, id: number, qty: number, cost: number, active = true): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials, default_location_id) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, ${cost}, ${active}, false, 1)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${qty}, 0)`.execute(db);
}

async function seedBom(db: Kysely<Database>, bomId: number, fgId: number, lines: Array<{ compId: number; qty: number; expectedCost: number }>, active = true): Promise<void> {
  await sql`INSERT INTO manufacturing_boms (id, product_id, quantity, overhead_cost, expected_cost, is_active, tenant_id, account_id) VALUES (${bomId}, ${fgId}, 1, 0, 0, ${active}, 't1', 'a1')`.execute(db);
  for (const line of lines) {
    await sql`INSERT INTO manufacturing_bom_lines (bom_id, component_product_id, quantity, unit_name, unit_multiplier, waste_percentage, expected_cost) VALUES (${bomId}, ${line.compId}, ${line.qty}, 'unit', 1, 0, ${line.expectedCost})`.execute(db);
  }
}

async function scopedQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = 1`.execute(db);
  return row.rows.length ? Number(row.rows[0].qty) : 0;
}

async function journalLines(db: Kysely<Database>, unbuildId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'manufacturing_unbuild_order' AND e.source_id = ${unbuildId} ORDER BY a.code, l.id`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
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
      CREATE TABLE manufacturing_unbuild_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, unbuild_number text, product_id bigint, product_name text, bom_id bigint, quantity numeric, warehouse_id bigint, status text, total_cost numeric, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    `);

    // Case 1: stale BOM cost ignored; difference goes to 5190.
    await seedProduct(db, 1, 10, 10);
    await seedProduct(db, 2, 0, 6);
    await seedBom(db, 1, 1, [{ compId: 2, qty: 1, expectedCost: 99 }]);
    const res1 = await service.createUnbuildOrder({ productId: 1, bomId: 1, quantity: 2, warehouseId: 1 } as never, AUTH) as any;
    assert.equal(await scopedQty(db, 1), 8);
    assert.equal(await scopedQty(db, 2), 2);
    const fgMov1 = await sql<{ unit_cost: string; total_cost: string }>`SELECT unit_cost, total_cost FROM stock_movements WHERE reference_id = ${Number(res1.unbuildId)} AND movement_type = 'manufacturing_unbuild'`.execute(db);
    assert.equal(Number(fgMov1.rows[0].unit_cost), 10);
    assert.equal(Number(fgMov1.rows[0].total_cost), 20);
    const recMov1 = await sql<{ unit_cost: string; total_cost: string }>`SELECT unit_cost, total_cost FROM stock_movements WHERE reference_id = ${Number(res1.unbuildId)} AND movement_type = 'manufacturing_unbuild_recovery'`.execute(db);
    assert.equal(Number(recMov1.rows[0].unit_cost), 6);
    assert.equal(Number(recMov1.rows[0].total_cost), 12);
    const order1 = await sql<{ total_cost: string }>`SELECT total_cost FROM manufacturing_unbuild_orders WHERE id = ${Number(res1.unbuildId)}`.execute(db);
    assert.equal(Number(order1.rows[0].total_cost), 12);
    assert.deepEqual(await journalLines(db, Number(res1.unbuildId)), [
      { code: '1140', debit: 12, credit: 0 },
      { code: '1140', debit: 0, credit: 20 },
      { code: '5190', debit: 8, credit: 0 },
    ]);

    // Case 2: exactly balanced -- no 5190 line.
    await seedProduct(db, 3, 10, 10);
    await seedProduct(db, 4, 0, 10);
    await seedBom(db, 2, 3, [{ compId: 4, qty: 1, expectedCost: 10 }]);
    const res2 = await service.createUnbuildOrder({ productId: 3, bomId: 2, quantity: 2, warehouseId: 1 } as never, AUTH) as any;
    assert.deepEqual(await journalLines(db, Number(res2.unbuildId)), [
      { code: '1140', debit: 20, credit: 0 },
      { code: '1140', debit: 0, credit: 20 },
    ]);

    // Case 3: recovery worth more -- 5190 is credited.
    await seedProduct(db, 5, 10, 10);
    await seedProduct(db, 6, 0, 12);
    await seedBom(db, 3, 5, [{ compId: 6, qty: 1, expectedCost: 12 }]);
    const res3 = await service.createUnbuildOrder({ productId: 5, bomId: 3, quantity: 2, warehouseId: 1 } as never, AUTH) as any;
    assert.deepEqual(await journalLines(db, Number(res3.unbuildId)), [
      { code: '1140', debit: 24, credit: 0 },
      { code: '1140', debit: 0, credit: 20 },
      { code: '5190', debit: 0, credit: 4 },
    ]);

    // Case 4: zero-cost unbuild posts nothing and does not throw.
    await seedProduct(db, 7, 10, 0);
    await seedProduct(db, 8, 0, 0);
    await seedBom(db, 4, 7, [{ compId: 8, qty: 1, expectedCost: 0 }]);
    const res4 = await service.createUnbuildOrder({ productId: 7, bomId: 4, quantity: 2, warehouseId: 1 } as never, AUTH) as any;
    assert.equal(await scopedQty(db, 7), 8);
    assert.equal(await scopedQty(db, 8), 2);
    assert.deepEqual(await journalLines(db, Number(res4.unbuildId)), []);

    // Case 5: a missing 5190 is auto-created by the system-account
    // resolver (the same treatment GRN price variance gets), so the
    // unbuild succeeds and the journal posts to the fresh account.
    await sql`DELETE FROM accounting_accounts WHERE code = '5190'`.execute(db);
    await seedProduct(db, 9, 10, 10);
    await seedProduct(db, 10, 0, 6);
    await seedBom(db, 5, 9, [{ compId: 10, qty: 1, expectedCost: 6 }]);
    const res5 = await service.createUnbuildOrder({ productId: 9, bomId: 5, quantity: 2, warehouseId: 1 } as never, AUTH) as any;
    const recreated = await sql<{ is_system: boolean; account_type: string }>`SELECT is_system, account_type FROM accounting_accounts WHERE tenant_id = 't1' AND code = '5190'`.execute(db);
    assert.equal(recreated.rows.length, 1);
    assert.equal(recreated.rows[0].is_system, true);
    assert.equal(recreated.rows[0].account_type, 'expense');
    assert.deepEqual(await journalLines(db, Number(res5.unbuildId)), [
      { code: '1140', debit: 12, credit: 0 },
      { code: '1140', debit: 0, credit: 20 },
      { code: '5190', debit: 8, credit: 0 },
    ]);

    // Case 6: inactive BOM / inactive product are rejected before any move.
    await seedProduct(db, 11, 10, 10);
    await seedProduct(db, 12, 0, 6);
    await seedBom(db, 6, 11, [{ compId: 12, qty: 1, expectedCost: 6 }], false);
    await assert.rejects(
      service.createUnbuildOrder({ productId: 11, bomId: 6, quantity: 2, warehouseId: 1 } as never, AUTH),
      /BOM_NOT_FOUND/,
    );
    await seedProduct(db, 13, 10, 10, false);
    await seedProduct(db, 14, 0, 6);
    await seedBom(db, 7, 13, [{ compId: 14, qty: 1, expectedCost: 6 }]);
    await assert.rejects(
      service.createUnbuildOrder({ productId: 13, bomId: 7, quantity: 2, warehouseId: 1 } as never, AUTH),
      /PRODUCT_NOT_FOUND/,
    );
    assert.equal(await scopedQty(db, 11), 10);
    assert.equal(await scopedQty(db, 13), 10);

    console.log('manufacturing unbuild journal checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
