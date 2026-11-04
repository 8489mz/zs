/*
New file: backend/test/critical/manufacturing-unbuild-bom-binding.spec.ts

WHAT THIS PINS (INV-MANUFACTURING-UNBUILD-BOM-BINDING):
createUnbuildOrder may only use a BOM that belongs to the
product being unbuilt. Before this fix the BOM fetch
filtered on id + active + tenant only, so ANY active BOM
satisfied it: unbuilding product A with the BOM of product
C silently recovered C's components into stock and posted
the wrong journal. The mismatch now throws
BOM_PRODUCT_MISMATCH before any stock or journal write.

THE 5190 CAP/ALERT PART OF THE SAME FINDING IS NOW ENFORCED
(INV-MANUFACTURING-UNBUILD-5190-CAP-ALERT): a variance over one
minor unit fails the whole unbuild closed with a review alert.
This spec's match case therefore uses a balanced fixture, so
the binding stays the subject under test.

THE CASES, WORKED ONCE (EGP, 2 book digits):
(a) MISMATCH: product A (finished, cost 20, stock 10)
unbuilt with the BOM of product C (component B, 2 per
unit) throws BOM_PRODUCT_MISMATCH, creates no unbuild
order, moves no stock, posts no journal.
(b) MATCH: the same unbuild with A's own BOM (component B,
2 per unit) succeeds: A 10 -> 8, B 0 -> 4, and the posted
journal balances (finished cost 40, recovered 40, no
variance line).

HOW THIS IS DRIVEN: the real ManufacturingService over the
real AccountingPostingService on PGlite. Stock and journal
figures are read from the posted rows, never re-implemented.

RED PROOF: on the unfixed tree case (a) succeeds and
recovers 4 units of B into stock.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { ManufacturingService } from '../../src/modules/manufacturing/services/manufacturing.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['manufacturing'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, cost_price numeric, default_location_id bigint, is_active boolean, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, barcode text, sku text, unit text, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, quantity numeric DEFAULT 1, expected_cost numeric DEFAULT 0, overhead_cost numeric DEFAULT 0, is_active boolean DEFAULT true, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE manufacturing_bom_lines (id bigserial PRIMARY KEY, tenant_id text, account_id text, bom_id bigint, component_product_id bigint, quantity numeric DEFAULT 1, unit_multiplier numeric DEFAULT 1, expected_cost numeric DEFAULT 0);
    CREATE TABLE manufacturing_unbuild_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, unbuild_number text, product_id bigint, product_name text, bom_id bigint, quantity numeric DEFAULT 1, warehouse_id bigint, status text DEFAULT 'completed', total_cost numeric DEFAULT 0, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, location_id bigint, branch_id bigint, created_by bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
  `);
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Main' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('accounting_settings').values({ id: 1, tenant_id: TENANT }).execute();
  for (const [id, code, type] of [[1140, '1140', 'asset'], [5190, '5190', 'expense']] as const) {
    await anyDb.insertInto('accounting_accounts').values({
      id, tenant_id: TENANT, code, name_ar: code, account_type: type, is_active: true, allow_manual_entries: true,
    }).execute();
  }
  // A: finished product, cost 20, stock 10 at location 1.
  await anyDb.insertInto('products').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'Meal A', cost_price: 20, default_location_id: 1, is_active: true, stock_qty: 10 }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 10, location_id: 1, branch_id: null, qty: 10 }).execute();
  // B: component, cost 10 (equal to the finished value per
  // recovered unit, so the match case is balanced), no stock.
  await anyDb.insertInto('products').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, name: 'Component B', cost_price: 10, default_location_id: 1, is_active: true, stock_qty: 0 }).execute();
  // C: a different finished product whose BOM must never unbuild A.
  await anyDb.insertInto('products').values({ id: 30, tenant_id: TENANT, account_id: ACCOUNT, name: 'Meal C', cost_price: 30, default_location_id: 1, is_active: true, stock_qty: 5 }).execute();
  // BOM of C: 2 x B per unit.
  await anyDb.insertInto('manufacturing_boms').values({ id: 100, tenant_id: TENANT, account_id: ACCOUNT, product_id: 30, quantity: 1, is_active: true }).execute();
  await anyDb.insertInto('manufacturing_bom_lines').values({ tenant_id: TENANT, account_id: ACCOUNT, bom_id: 100, component_product_id: 20, quantity: 2, unit_multiplier: 1 }).execute();
  // BOM of A: 2 x B per unit.
  await anyDb.insertInto('manufacturing_boms').values({ id: 101, tenant_id: TENANT, account_id: ACCOUNT, product_id: 10, quantity: 1, is_active: true }).execute();
  await anyDb.insertInto('manufacturing_bom_lines').values({ tenant_id: TENANT, account_id: ACCOUNT, bom_id: 101, component_product_id: 20, quantity: 2, unit_multiplier: 1 }).execute();
  return { pg, db };
}

function buildService(db: Kysely<Database>): ManufacturingService {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  return new ManufacturingService(db, new TransactionHelper(), new AuditService(db), posting);
}

async function stockOf(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await (db as any).selectFrom('products').select('stock_qty').where('id', '=', productId).executeTakeFirst();
  return Number(row?.stock_qty || 0);
}

async function main(): Promise<void> {
  // (a) MISMATCH: A's unbuild with C's BOM is rejected before any write.
  {
    const { pg, db } = await makeDb();
    try {
      const service = buildService(db);
      let thrown: any = null;
      try {
        await service.createUnbuildOrder({ productId: 10, bomId: 100, quantity: 2 } as any, adminAuth);
      } catch (err: any) {
        thrown = err;
      }
      assert.ok(thrown, 'a mismatched BOM must throw');
      assert.match(String(thrown?.message || ''), /لا تخص المنتج/, 'the error names the mismatch');
      assert.equal(await stockOf(db, 10), 10, 'finished stock is untouched');
      assert.equal(await stockOf(db, 20), 0, 'no component is recovered');
      const orders = await (db as any).selectFrom('manufacturing_unbuild_orders').select('id').execute();
      assert.equal(orders.length, 0, 'no unbuild order is created');
      const movements = await (db as any).selectFrom('stock_movements').select('id').execute();
      assert.equal(movements.length, 0, 'no stock movement is written');
      const journals = await (db as any).selectFrom('journal_entries').select('id').execute();
      assert.equal(journals.length, 0, 'no journal is posted');
    } finally {
      await db.destroy();
    }
    console.log('  Unbuild BOM mismatch rejection passed');
  }

  // (b) MATCH: A's own BOM unbuilds, recovers components, posts balanced.
  {
    const { pg, db } = await makeDb();
    try {
      const service = buildService(db);
      const result = await service.createUnbuildOrder({ productId: 10, bomId: 101, quantity: 2 } as any, adminAuth);
      assert.equal(result.ok, true, 'a matching BOM must unbuild');
      assert.equal(await stockOf(db, 10), 8, 'finished stock falls by the unbuilt quantity');
      assert.equal(await stockOf(db, 20), 4, 'components recover at 2 per unit');
      const journals = await (db as any).selectFrom('journal_entries').select(['id', 'source_type']).execute();
      assert.equal(journals.length, 1, 'exactly one journal posts');
      const lines = await (db as any).selectFrom('journal_entry_lines').select(['debit', 'credit'])
        .where('journal_entry_id', '=', journals[0].id).execute();
      const debit = lines.reduce((s: number, r: any) => s + Number(r.debit || 0), 0);
      const credit = lines.reduce((s: number, r: any) => s + Number(r.credit || 0), 0);
      assert.equal(debit, credit, 'the unbuild journal balances');
      assert.equal(debit, 40, 'the journal equals the finished cost (2 x 20)');
      assert.equal(lines.length, 2, 'no variance line posts for a balanced unbuild');
    } finally {
      await db.destroy();
    }
    console.log('  Unbuild matching BOM passed');
  }

  console.log('Manufacturing unbuild BOM-binding tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
