import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { WarehouseBinsService } from '../../src/modules/inventory/services/warehouse-bins.service';

/*
New file: backend/test/critical/warehouse-bins-ledger.spec.ts
Pins bin allocations to the canonical stock ledger
(INV-BIN-LEDGER-JOURNAL).

THE GAP: quickReassignProduct and quickAuditUpdate overwrote
product_bin_allocations.quantity with any caller-supplied number,
directly on the pool handle (no transaction, no lock), with no
ledger call, no movement, no journal and no >= 0 check — while
listBins displays SUM(pba.quantity) as totalQuantityStored. Bin
totals could therefore diverge from real location stock with no
trace. A bin allocation is a slice of the location stock, never a
second stock of its own: nothing in the schema ties SUM(pba) to
product_location_stock, and the stock-count module never touches
bins, so the fix ties them in the two writers themselves.

THE RULE:
- quickReassignProduct is a PURE REALLOCATION of an unchanged
  location quantity: it moves no location stock and posts no
  journal, but the slice is capped at (location stock minus what
  other bins in the same location already hold), and the slice
  delta is recorded as a stock_movements row (bin_reassign).
- quickAuditUpdate takes the counted bin slice as physical truth
  and moves the location stock by exactly the bin delta, in the
  same transaction as the allocation write, the movement row and
  the journal — mirroring the stock-count path: setScopedStockQty
  (disableAutoDrain) for the location write, the ACTUAL scoped
  delta for the movement, and the existing adjustment posting
  (postInventoryAdjustment) for the journal leg (Dr 1140 / Cr 7100
  on a gain, Dr 5200 / Cr 1140 on a loss, at the movement total).
- Every write validates quantity: finite, >= 0, at most 3dp.
  Quantities stay 3dp; only money rounds, at book digits.
- All writes run in one transaction with the canonical lock order
  (products before product_location_stock before the allocation
  row), so a posting failure rolls the allocation, the location
  stock and the movement back together.

WHAT THIS PINS, driving the REAL WarehouseBinsService on PGlite
(the service runs everything on the transaction handle, so the
direct service drive works — the PGlite single-connection hang
only bites when a method reads the pool handle inside its own
open transaction, which this fix removes):
- Case 1: negative / 4dp quantities fail on both methods, with no
  write at all (allocation unchanged, no movement).
- Case 2: reassign 30 -> 40 records a bin_reassign movement
  (+10, before 30 / after 40), leaves location 100 / global 100
  untouched and posts NO journal; reassign to 90 is refused by
  the cap (location 100, other bins 20, at most 80); a duplicate
  reassign to the same 40 writes no second movement.
- Case 3: audit 40 -> 35 moves location 100 -> 95 and global
  100 -> 95, records an adjust movement (-5, before 100 /
  after 95, total 50) and posts Dr 5200 50 / Cr 1140 50; audit
  35 -> 38 moves location 95 -> 98 and posts Dr 1140 30 /
  Cr 7100 30; bin slices (38 + 20 = 58) stay within location 98
  and the location moved by exactly the bin delta each time.
- Case 4: 3dp audit 10 -> 10.125 moves location 100 -> 100.125
  (never rounded to 2dp) and posts 1.25 at book digits.
- Case 5: atomicity — a posting failure leaves the allocation,
  the location stock and the movement table exactly as before.
- Case 6: a duplicate audit to the same counted quantity writes
  no second movement and no second journal.

NOT TESTED HERE: live Postgres, and true two-terminal
concurrency (PGlite is a single connection — the lock order and
the absolute-quantity (set, not increment) shape are what make
a duplicate reassign a no-op rather than a double-apply; the
two-terminal drive stays a live-Postgres acceptance item).
*/

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: ['inventory'] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    INSERT INTO settings VALUES ('t1','currency','EGP');
    INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
    INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES (40,'t1','1140','asset'), (70,'t1','7100','revenue'), (80,'t1','5200','expense'), (90,'t1','7290','expense');
    CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    INSERT INTO accounting_settings VALUES (1,'t1',1110,1120,1130,2110,40,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
    CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
    INSERT INTO branches VALUES (1, 't1', 'Main', 1);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    INSERT INTO stock_locations VALUES (1, 't1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, primary_bin_id bigint, bin_location text, default_location_id bigint, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE warehouse_bins (id bigint PRIMARY KEY, tenant_id text, account_id text, location_id bigint, code text, barcode text, aisle text, rack text, shelf text, bin text, capacity numeric, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_bin_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, bin_id bigint, product_id bigint, quantity numeric DEFAULT 0, is_primary boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedProduct(db: Kysely<Database>, id: number, globalQty: number, cost: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, retail_price, is_active) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${globalQty}, 0, ${cost}, 0, true)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${globalQty}, 0)`.execute(db);
}

async function seedBin(db: Kysely<Database>, id: number, code: string): Promise<void> {
  await sql`INSERT INTO warehouse_bins (id, tenant_id, account_id, location_id, code, barcode, is_active) VALUES (${id}, 't1', 'a1', 1, ${code}, ${`BIN-${code}`}, true)`.execute(db);
}

async function seedAllocation(db: Kysely<Database>, binId: number, productId: number, qty: number): Promise<void> {
  await sql`INSERT INTO product_bin_allocations (tenant_id, account_id, bin_id, product_id, quantity, is_primary) VALUES ('t1', 'a1', ${binId}, ${productId}, ${qty}, false)`.execute(db);
}

async function allocQty(db: Kysely<Database>, binId: number, productId: number): Promise<number> {
  const row = await sql<{ quantity: string }>`SELECT quantity FROM product_bin_allocations WHERE bin_id = ${binId} AND product_id = ${productId}`.execute(db);
  return row.rows.length ? Number(row.rows[0].quantity) : 0;
}

async function locQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = 1`.execute(db);
  return row.rows.length ? Number(row.rows[0].qty) : 0;
}

async function globalQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ stock_qty: string }>`SELECT stock_qty FROM products WHERE id = ${productId}`.execute(db);
  return Number(row.rows[0].stock_qty);
}

async function binSumAtLocation(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ total: string }>`SELECT COALESCE(SUM(pba.quantity), 0) AS total FROM product_bin_allocations pba JOIN warehouse_bins wb ON wb.id = pba.bin_id WHERE pba.product_id = ${productId} AND wb.location_id = 1`.execute(db);
  return Number(row.rows[0].total);
}

async function movements(db: Kysely<Database>, productId: number): Promise<Array<{ movement_type: string; qty: number; before_qty: number; after_qty: number; total_cost: number; reference_type: string; reference_id: number }>> {
  const rows = await sql<{ movement_type: string; qty: string; before_qty: string; after_qty: string; total_cost: string; reference_type: string; reference_id: string }>`SELECT movement_type, qty, before_qty, after_qty, total_cost, reference_type, reference_id FROM stock_movements WHERE product_id = ${productId} ORDER BY id`.execute(db);
  return rows.rows.map((r) => ({ movement_type: r.movement_type, qty: Number(r.qty), before_qty: Number(r.before_qty), after_qty: Number(r.after_qty), total_cost: Number(r.total_cost), reference_type: r.reference_type, reference_id: Number(r.reference_id) }));
}

async function journalLines(db: Kysely<Database>, movementId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'inventory_adjustment' AND e.source_id = ${movementId} AND e.tenant_id = 't1' ORDER BY a.code`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function journalEntryCount(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries`.execute(db);
  return Number(rows.rows[0].n);
}

function makeService(db: Kysely<Database>, posting?: AccountingPostingService): WarehouseBinsService {
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  // `as any`: the constructor takes (db, tx, posting) with the fix and
  // (db) without it — the cast keeps the removal proof behavioural
  // (assertion failure) instead of a compile error either way.
  return new (WarehouseBinsService as any)(db, new TransactionHelper(), posting ?? new AccountingPostingService(foundation));
}

async function main(): Promise<void> {
  const { db } = await makeDb();
  const service = makeService(db);
  try {
    // Case 1: negative / 4dp quantities fail on both methods, with no write.
    await seedProduct(db, 1, 100, 10);
    await seedBin(db, 11, 'A-11');
    await seedBin(db, 12, 'A-12');
    await seedAllocation(db, 11, 1, 30);
    await seedAllocation(db, 12, 1, 20);
    await assert.rejects(service.quickReassignProduct({ binId: 11, productId: 1, quantity: -5 }, AUTH), /zero or greater/);
    await assert.rejects(service.quickAuditUpdate({ binId: 11, productId: 1, countedQty: -2 }, AUTH), /zero or greater/);
    await assert.rejects(service.quickReassignProduct({ binId: 11, productId: 1, quantity: 10.1234 }, AUTH), /three decimal places/);
    assert.equal(await allocQty(db, 11, 1), 30);
    assert.equal((await movements(db, 1)).length, 0);
    assert.equal(await locQty(db, 1), 100);

    // Case 2: reassign is a pure reallocation — movement, no journal, capped.
    const reassign = await service.quickReassignProduct({ binId: 11, productId: 1, quantity: 40, isPrimary: true }, AUTH);
    assert.equal(reassign.previousQty, 30);
    assert.equal(reassign.delta, 10);
    assert.ok(reassign.movementId);
    assert.equal(await allocQty(db, 11, 1), 40);
    assert.equal(await locQty(db, 1), 100);
    assert.equal(await globalQty(db, 1), 100);
    assert.equal(await binSumAtLocation(db, 1), 60);
    assert.deepEqual(await movements(db, 1), [
      { movement_type: 'bin_reassign', qty: 10, before_qty: 30, after_qty: 40, total_cost: 100, reference_type: 'bin_reassign', reference_id: 11 },
    ]);
    assert.equal(await journalEntryCount(db), 0);
    const prod1 = await sql<{ primary_bin_id: string; bin_location: string }>`SELECT primary_bin_id, bin_location FROM products WHERE id = 1`.execute(db);
    assert.equal(Number(prod1.rows[0].primary_bin_id), 11);
    assert.equal(prod1.rows[0].bin_location, 'A-11');
    // Cap: location 100, other bins 20, so at most 80 can sit in bin 11.
    await assert.rejects(service.quickReassignProduct({ binId: 11, productId: 1, quantity: 90 }, AUTH), /exceeds available location stock/);
    assert.equal(await allocQty(db, 11, 1), 40);
    // Duplicate reassign to the same quantity writes no second movement.
    const dupReassign = await service.quickReassignProduct({ binId: 11, productId: 1, quantity: 40 }, AUTH);
    assert.equal(dupReassign.delta, 0);
    assert.equal(dupReassign.movementId, null);
    assert.equal((await movements(db, 1)).length, 1);

    // Case 3: audit loss then gain — location moves by the bin delta, journal matches.
    const auditLoss = await service.quickAuditUpdate({ binId: 11, productId: 1, countedQty: 35 }, AUTH);
    assert.equal(auditLoss.previousQty, 40);
    assert.equal(auditLoss.variance, -5);
    assert.equal(auditLoss.locationBefore, 100);
    assert.equal(auditLoss.locationAfter, 95);
    assert.ok(auditLoss.movementId);
    assert.ok(auditLoss.journalEntryId);
    assert.equal(await allocQty(db, 11, 1), 35);
    assert.equal(await locQty(db, 1), 95);
    assert.equal(await globalQty(db, 1), 95);
    assert.equal(await binSumAtLocation(db, 1), 55);
    const lossMovs = await movements(db, 1);
    assert.deepEqual(lossMovs[1], { movement_type: 'adjust', qty: -5, before_qty: 100, after_qty: 95, total_cost: 50, reference_type: 'bin_audit', reference_id: 11 });
    assert.deepEqual(await journalLines(db, Number(auditLoss.movementId)), [
      { code: '1140', debit: 0, credit: 50 },
      { code: '5200', debit: 50, credit: 0 },
    ]);

    const auditGain = await service.quickAuditUpdate({ binId: 11, productId: 1, countedQty: 38 }, AUTH);
    assert.equal(auditGain.variance, 3);
    assert.equal(auditGain.locationBefore, 95);
    assert.equal(auditGain.locationAfter, 98);
    assert.equal(await allocQty(db, 11, 1), 38);
    assert.equal(await locQty(db, 1), 98);
    assert.equal(await globalQty(db, 1), 98);
    assert.equal(await binSumAtLocation(db, 1), 58);
    const gainMovs = await movements(db, 1);
    assert.deepEqual(gainMovs[2], { movement_type: 'adjust', qty: 3, before_qty: 95, after_qty: 98, total_cost: 30, reference_type: 'bin_audit', reference_id: 11 });
    assert.deepEqual(await journalLines(db, Number(auditGain.movementId)), [
      { code: '1140', debit: 30, credit: 0 },
      { code: '7100', debit: 0, credit: 30 },
    ]);

    // Zero-variance audit: no new movement, no new journal.
    const journalsBefore = await journalEntryCount(db);
    await service.quickAuditUpdate({ binId: 11, productId: 1, countedQty: 38 }, AUTH);
    assert.equal((await movements(db, 1)).length, 3);
    assert.equal(await journalEntryCount(db), journalsBefore);
    assert.equal(await locQty(db, 1), 98);

    // Case 4: 3dp audit — quantity stays 3dp, money at book digits.
    await seedProduct(db, 2, 100, 10);
    await seedBin(db, 21, 'B-21');
    await seedAllocation(db, 21, 2, 10);
    const audit3dp = await service.quickAuditUpdate({ binId: 21, productId: 2, countedQty: 10.125 }, AUTH);
    assert.equal(audit3dp.variance, 0.125);
    assert.equal(await allocQty(db, 21, 2), 10.125);
    assert.equal(await locQty(db, 2), 100.125);
    assert.equal(await globalQty(db, 2), 100.125);
    assert.deepEqual(await movements(db, 2), [
      { movement_type: 'adjust', qty: 0.125, before_qty: 100, after_qty: 100.125, total_cost: 1.25, reference_type: 'bin_audit', reference_id: 21 },
    ]);
    assert.deepEqual(await journalLines(db, Number(audit3dp.movementId)), [
      { code: '1140', debit: 1.25, credit: 0 },
      { code: '7100', debit: 0, credit: 1.25 },
    ]);

    // Case 5: atomicity — a posting failure rolls allocation, location and movement back.
    const failingPosting = {
      postInventoryAdjustment: async () => { throw new Error('POSTING_FAILED_SIMULATED'); },
    } as unknown as AccountingPostingService;
    const failingService = makeService(db, failingPosting);
    await seedProduct(db, 3, 50, 10);
    await seedBin(db, 31, 'C-31');
    await seedAllocation(db, 31, 3, 20);
    await assert.rejects(
      failingService.quickAuditUpdate({ binId: 31, productId: 3, countedQty: 15 }, AUTH),
      /POSTING_FAILED_SIMULATED/,
    );
    assert.equal(await allocQty(db, 31, 3), 20);
    assert.equal(await locQty(db, 3), 50);
    assert.equal(await globalQty(db, 3), 50);
    assert.equal((await movements(db, 3)).length, 0);

    // Case 6: duplicate audit to the same counted quantity cannot double-apply.
    await seedProduct(db, 4, 80, 10);
    await seedBin(db, 41, 'D-41');
    await seedAllocation(db, 41, 4, 30);
    const journalsBefore6 = await journalEntryCount(db);
    await service.quickAuditUpdate({ binId: 41, productId: 4, countedQty: 25 }, AUTH);
    assert.equal(await locQty(db, 4), 75);
    assert.equal((await movements(db, 4)).length, 1);
    await service.quickAuditUpdate({ binId: 41, productId: 4, countedQty: 25 }, AUTH);
    assert.equal(await allocQty(db, 41, 4), 25);
    assert.equal(await locQty(db, 4), 75);
    assert.equal((await movements(db, 4)).length, 1);
    assert.equal(await journalEntryCount(db), journalsBefore6 + 1);

    console.log('warehouse bins ledger checks passed');
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
