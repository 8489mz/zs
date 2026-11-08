/*
New file: backend/test/critical/maintenance-part-issue-location.spec.ts
Pins Round-2 package R2-P1 (MUST-FIX).

THE BUG (live, ticket ZM-261108-0003, deployed 4ade6e01): issuing a
spare part failed with "الرصيد غير كافٍ" although the product was
stocked (global stock 10, 75 EGP, per the app's own lookup +
catalog), 0 parts recorded, no 5100/1140 journal, stock 10 -> 10.

THE ROOT CAUSE: the modal shows GLOBAL stock (part options built
from p.stock ?? p.stock_qty) and sends NO locationId; tickets are
created without branch/location, so addPart's targetLocationId was
null. applyStockDelta with a null location deducts ONLY from the
UNASSIGNED (NULL-location) balance row and throws INSUFFICIENT_STOCK
when that row is 0 — even when all 10 units sit in a real location
row (الفرع الرئيسي) and global stock_qty is 10.

THE FIX (maintenance.service.ts addPart only; applyStockDelta, the
shared engine with 78 call sites, is untouched, and the modal is
untouched): when no location is specified anywhere (payload +
ticket both null), resolve the deduction location from the
product's available location stock INSIDE the same transaction:
the location row holding sufficient available qty (qty -
reserved_qty), largest available first, tie-break lowest location
id. Restricted to the ticket's branch when ticket.branch_id is set
— never another branch's stock. The resolved location's branch_id
is used for the stock movement + journal. If no single location
covers the full qty, the exact same INSUFFICIENT_STOCK error is
kept (the guard stays correct for genuinely insufficient stock).
The resolved location_id is recorded on the
maintenance_ticket_parts row, so removePart returns the stock to
that same location.

WHAT THIS PINS, driving the REAL service (addPart / removePart)
on PGlite: addPart reads this.db nowhere inside its own
transaction (every read/write goes through trx, including
tenantBaseCurrency, the foundation check and the journal post),
so — unlike updateTicketStatus — it is PGlite-safe with the real
AccountingPostingService + AccountingTenantFoundationService.
The fixture seeds the foundation (18 required account codes +
accounting_settings id=1 with the 5 critical mappings) so the
foundation check passes without seeding; the journal path is the
real one (advisory lock, period gates, gapless numbering).
- S1 (the live bug): product global 10, ALL 10 in ONE real
  location row, unassigned 0, ticket with no branch/location.
  addPart succeeds: location 10 -> 9, global 10 -> 9, journal
  Dr 5100 / Cr 1140 at cost (75), part row records the resolved
  location, movement carries the resolved branch + location.
  On BASE production code this scenario FAILS with
  INSUFFICIENT_STOCK (proven by running this spec against the
  base file: exit 1).
- S2: removePart returns the stock to the SAME location
  (10 -> 9 -> 10, global likewise) and posts the reversal
  Dr 1140 / Cr 5100 at the historical cost. EXTENDED (same
  package, same root cause): the return must NOT null the
  location row's branch_id, and the return movement + journal
  must carry the resolved branch.
- S7: explicit-location addPart on a branchless ticket (payload
  locationId set, ticket branch null) deducts from that location
  AND leaves its branch_id intact. PRE-EXISTING corruption, now
  fixed: the old code passed a null branch on this path too, so
  the deduction itself nulled the row's branch.

THE BRANCH-NULLING GAP (coordinator-verified in code, pinned
here): backend/src/common/utils/location-stock-ledger.ts
updateBalanceQty treats an explicitly-passed null branchId as
"overwrite the row's branch_id with null" (branchId !== undefined
&& branchId !== row.branch_id -> payload.branch_id = branchId).
Before R2-P1 this was harmless for maintenance returns — part
rows on branchless tickets carried location_id null, so the null
branch went to the already-branchless unassigned row. R2-P1 made
part rows carry REAL locations, so removePart (and deleteTicket's
per-part return loop) now touch real location rows with a null
branch and NULL their branch_id; a later branch-restricted
resolution then misses the row and falsely reports
INSUFFICIENT_STOCK. The fix stays local to
maintenance.service.ts (the shared engine, 78 call sites, is
untouched): addPart / removePart / deleteTicket derive the branch
from the location row (SELECT branch_id FROM
product_location_stock, tenant-scoped, same transaction) whenever
the location is known and the ticket sets no branch — never
overriding an explicit ticket branch_id.
- S3: genuinely-insufficient stock (global 0) still throws
  INSUFFICIENT_STOCK and records no part.
- S4: no SINGLE location covers the qty (4 + 5, ask 6) — still
  INSUFFICIENT_STOCK, no split across locations, balances
  untouched.
- S5: largest-available location wins (3 vs 10, ask 5 -> the 10).
- S6: branch restriction — stock only in another branch throws
  INSUFFICIENT_STOCK; with stock in both branches the ticket's
  branch wins (tie-break lowest location id).

Run: npx ts-node test/critical/maintenance-part-issue-location.spec.ts
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaintenanceService } from '../../src/modules/maintenance/maintenance.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';

const TENANT = 't1';
const AUTH = { tenantId: TENANT, accountId: TENANT, userId: 7 } as any;

// Required account codes (accounting-foundation.engine.ts), ids 1..18.
const ACCOUNTS: Array<[number, string]> = [
  [1, '1110'], [2, '1120'], [3, '1130'], [4, '1140'], [5, '1150'],
  [6, '2110'], [7, '2120'], [8, '2150'], [9, '4100'], [10, '4300'],
  [11, '4400'], [12, '5100'], [13, '5300'], [14, '6900'], [15, '6000'],
  [16, '7290'], [17, '7110'], [18, '7210'],
];
// Branches: 1 = الفرع الرئيسي, 2 = other branch. Locations: 10/11 on
// branch 1, 12 on branch 2.
const BRANCH_MAIN = 1;
const BRANCH_OTHER = 2;
const LOC_MAIN_A = 10;
const LOC_MAIN_B = 11;
const LOC_OTHER = 12;

async function seedProduct(pg: PGlite, id: number, stock: number, cost: number): Promise<void> {
  await pg.query(
    `INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price)
     VALUES ($1, $2, $2, $3, $4, 0, $5)`,
    [id, TENANT, `Product ${id}`, stock, cost],
  );
}

async function seedLocationStock(
  pg: PGlite, productId: number, branchId: number | null, locationId: number | null, qty: number,
): Promise<void> {
  await pg.query(
    `INSERT INTO product_location_stock (product_id, branch_id, location_id, qty, reserved_qty, tenant_id, account_id)
     VALUES ($1, $2, $3, $4, 0, $5, $5)`,
    [productId, branchId, locationId, qty, TENANT],
  );
}

async function seedTicket(pg: PGlite, ticketNo: string, branchId: number | null, locationId: number | null): Promise<number> {
  const res = await pg.query(
    `INSERT INTO maintenance_tickets
       (tenant_id, account_id, ticket_no, customer_name, customer_phone, device_model,
        problem_description, expected_cost, final_cost, advance_payment, status, branch_id, location_id, warranty_days)
     VALUES ($1, $1, $2, 'Customer', '01000000000', 'Model', 'Problem', 0, 0, 0, 'received', $3, $4, 30)
     RETURNING id`,
    [TENANT, ticketNo, branchId, locationId],
  );
  return Number((res.rows[0] as { id: number }).id);
}

async function locationQty(pg: PGlite, productId: number, locationId: number | null): Promise<number> {
  const res = await pg.query(
    `SELECT qty FROM product_location_stock WHERE tenant_id = $1 AND product_id = $2 AND location_id IS NOT DISTINCT FROM $3`,
    [TENANT, productId, locationId],
  );
  assert.equal(res.rows.length, 1, `expected one balance row for product ${productId} location ${locationId}`);
  return Number((res.rows[0] as { qty: string }).qty);
}

async function locationBranch(pg: PGlite, productId: number, locationId: number | null): Promise<number | null> {
  const res = await pg.query(
    `SELECT branch_id FROM product_location_stock WHERE tenant_id = $1 AND product_id = $2 AND location_id IS NOT DISTINCT FROM $3`,
    [TENANT, productId, locationId],
  );
  assert.equal(res.rows.length, 1, `expected one balance row for product ${productId} location ${locationId}`);
  const value = (res.rows[0] as { branch_id: number | null }).branch_id;
  return value == null ? null : Number(value);
}

async function globalQty(pg: PGlite, productId: number): Promise<number> {
  const res = await pg.query(`SELECT stock_qty FROM products WHERE tenant_id = $1 AND id = $2`, [TENANT, productId]);
  return Number((res.rows[0] as { stock_qty: string }).stock_qty);
}

async function productCost(pg: PGlite, productId: number): Promise<number> {
  const res = await pg.query(`SELECT cost_price FROM products WHERE tenant_id = $1 AND id = $2`, [TENANT, productId]);
  return Number((res.rows[0] as { cost_price: string }).cost_price);
}

async function partRows(pg: PGlite, ticketId: number): Promise<Array<{ id: number; location_id: number | null; qty: string }>> {
  const res = await pg.query(
    `SELECT id, location_id, qty FROM maintenance_ticket_parts WHERE tenant_id = $1 AND ticket_id = $2 ORDER BY id`,
    [TENANT, ticketId],
  );
  return res.rows as Array<{ id: number; location_id: number | null; qty: string }>;
}

async function movementFor(pg: PGlite, ticketId: number, movementType: string): Promise<{ id: number; branch_id: number | null; location_id: number | null; qty: string }> {
  const res = await pg.query(
    `SELECT id, branch_id, location_id, qty FROM stock_movements
     WHERE tenant_id = $1 AND reference_type = 'maintenance_ticket' AND reference_id = $2 AND movement_type = $3 ORDER BY id`,
    [TENANT, ticketId, movementType],
  );
  assert.equal(res.rows.length, 1, `expected one ${movementType} movement for ticket ${ticketId}`);
  return res.rows[0] as { id: number; branch_id: number | null; location_id: number | null; qty: string };
}

async function journalLines(pg: PGlite, sourceType: string, sourceId: number): Promise<Array<{ code: string; debit: string; credit: string; branch_id: number | null; location_id: number | null }>> {
  const res = await pg.query(
    `SELECT a.code, jel.debit, jel.credit, je.branch_id, je.location_id
     FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
     JOIN accounting_accounts a ON a.id = jel.account_id
     WHERE je.tenant_id = $1 AND je.source_type = $2 AND je.source_id = $3 ORDER BY jel.id`,
    [TENANT, sourceType, sourceId],
  );
  return res.rows as Array<{ code: string; debit: string; credit: string; branch_id: number | null; location_id: number | null }>;
}

function assertJournal(lines: Array<{ code: string; debit: string; credit: string }>, debitCode: string, creditCode: string, amount: number): void {
  assert.equal(lines.length, 2, `expected exactly 2 journal lines, got ${JSON.stringify(lines)}`);
  const debit = lines.find((l) => l.code === debitCode);
  const credit = lines.find((l) => l.code === creditCode);
  assert.ok(debit, `journal must debit ${debitCode}`);
  assert.ok(credit, `journal must credit ${creditCode}`);
  assert.equal(Number(debit.debit), amount, `debit ${debitCode} must be ${amount}`);
  assert.equal(Number(debit.credit), 0);
  assert.equal(Number(credit.credit), amount, `credit ${creditCode} must be ${amount}`);
  assert.equal(Number(credit.debit), 0);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE maintenance_tickets (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ticket_no VARCHAR(60) NOT NULL,
        customer_id INTEGER,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        device_brand VARCHAR(100),
        device_model VARCHAR(150) NOT NULL,
        serial_number VARCHAR(120),
        passcode VARCHAR(100),
        problem_description TEXT NOT NULL,
        device_condition TEXT,
        expected_cost NUMERIC(14, 3) NOT NULL DEFAULT 0,
        final_cost NUMERIC(14, 3) NOT NULL DEFAULT 0,
        advance_payment NUMERIC(14, 3) NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'received',
        technician_id INTEGER,
        technician_name VARCHAR(150),
        technician_notes TEXT,
        branch_id INTEGER,
        location_id INTEGER,
        sale_id INTEGER,
        warranty_days INTEGER NOT NULL DEFAULT 30,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        repaired_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE maintenance_ticket_parts (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ticket_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        qty NUMERIC(14, 3) NOT NULL DEFAULT 1,
        unit_cost NUMERIC(14, 3) NOT NULL DEFAULT 0,
        unit_price NUMERIC(14, 3) NOT NULL DEFAULT 0,
        location_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        stock_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
        reserved_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
        cost_price NUMERIC(14, 3) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE product_location_stock (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        branch_id INTEGER,
        location_id INTEGER,
        qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
        reserved_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE stock_movements (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        movement_type TEXT NOT NULL,
        qty NUMERIC(14, 3) NOT NULL,
        before_qty NUMERIC(14, 3),
        after_qty NUMERIC(14, 3),
        reason TEXT,
        note TEXT,
        reference_type TEXT,
        reference_id INTEGER,
        unit_cost NUMERIC(14, 3),
        total_cost NUMERIC(14, 3),
        branch_id INTEGER,
        location_id INTEGER,
        created_by INTEGER,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE branches (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT
      );
      CREATE TABLE stock_locations (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        branch_id INTEGER,
        name TEXT NOT NULL,
        code TEXT,
        location_type TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true
      );
      CREATE TABLE settings (
        tenant_id TEXT NOT NULL,
        account_id TEXT,
        key TEXT NOT NULL,
        value TEXT
      );
      CREATE TABLE currency_exchange_rates (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        currency_code TEXT NOT NULL,
        exchange_rate NUMERIC(14, 6) NOT NULL DEFAULT 1,
        is_base BOOLEAN NOT NULL DEFAULT false
      );
      CREATE TABLE accounting_accounts (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name_ar TEXT,
        name_en TEXT,
        account_type TEXT,
        parent_id INTEGER,
        account_group TEXT,
        normal_balance TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        is_system BOOLEAN NOT NULL DEFAULT false,
        allow_manual_entries BOOLEAN NOT NULL DEFAULT true,
        is_control_account BOOLEAN NOT NULL DEFAULT false,
        is_cash_bank BOOLEAN NOT NULL DEFAULT false,
        is_receivable BOOLEAN NOT NULL DEFAULT false,
        is_payable BOOLEAN NOT NULL DEFAULT false,
        is_inventory BOOLEAN NOT NULL DEFAULT false,
        is_tax BOOLEAN NOT NULL DEFAULT false,
        description_ar TEXT
      );
      CREATE TABLE accounting_settings (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT,
        cash_account_id INTEGER,
        bank_account_id INTEGER,
        customer_receivable_account_id INTEGER,
        supplier_payable_account_id INTEGER,
        inventory_account_id INTEGER,
        sales_revenue_account_id INTEGER,
        sales_discount_account_id INTEGER,
        cogs_account_id INTEGER,
        purchase_account_id INTEGER,
        expenses_account_id INTEGER,
        sales_tax_account_id INTEGER,
        purchase_tax_account_id INTEGER,
        lock_date_all DATE,
        lock_date_non_adviser DATE,
        lock_date_tax DATE
      );
      CREATE TABLE accounting_fiscal_periods (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT,
        status TEXT NOT NULL,
        start_date DATE,
        end_date DATE
      );
      CREATE TABLE journal_entries (
        id SERIAL PRIMARY KEY,
        entry_no TEXT NOT NULL,
        dedup_key TEXT,
        tenant_id TEXT NOT NULL,
        account_id TEXT,
        entry_date TIMESTAMPTZ NOT NULL,
        description TEXT,
        source_type TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        branch_id INTEGER,
        location_id INTEGER,
        created_by INTEGER,
        posted_by INTEGER,
        posted_at TIMESTAMPTZ,
        reversal_of_entry_id INTEGER,
        reversed_by_entry_id INTEGER,
        cash_flow_category TEXT,
        updated_at TIMESTAMPTZ
      );
      CREATE TABLE journal_entry_lines (
        id SERIAL PRIMARY KEY,
        journal_entry_id INTEGER NOT NULL,
        tenant_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        cost_center_id INTEGER,
        description TEXT,
        debit NUMERIC(14, 3) NOT NULL DEFAULT 0,
        credit NUMERIC(14, 3) NOT NULL DEFAULT 0,
        partner_type TEXT NOT NULL DEFAULT 'none',
        partner_id INTEGER,
        branch_id INTEGER,
        location_id INTEGER
      );
    `);

    await pg.query(`INSERT INTO branches (id, tenant_id, account_id, name, code) VALUES (1, $1, $1, 'Main', 'B1'), (2, $1, $1, 'Other', 'B2')`, [TENANT]);
    await pg.query(
      `INSERT INTO stock_locations (id, tenant_id, account_id, branch_id, name, code, location_type)
       VALUES (10, $1, $1, 1, 'Main Warehouse', 'L10', 'internal_warehouse'),
              (11, $1, $1, 1, 'Main Shelf', 'L11', 'internal_warehouse'),
              (12, $1, $1, 2, 'Other Warehouse', 'L12', 'internal_warehouse')`,
      [TENANT],
    );
    await pg.query(`INSERT INTO settings (tenant_id, account_id, key, value) VALUES ($1, $1, 'currency', '"EGP"')`, [TENANT]);
    await pg.query(`INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ($1, 'EGP', 1, true)`, [TENANT]);
    for (const [id, code] of ACCOUNTS) {
      await pg.query(
        `INSERT INTO accounting_accounts (id, tenant_id, account_id, code, name_ar, name_en, account_type, is_active, is_system)
         VALUES ($1, $2, $2, $3, $3, $3, 'asset', true, true)`,
        [id, TENANT, code],
      );
    }
    await pg.query(
      `INSERT INTO accounting_settings
         (id, tenant_id, account_id, cash_account_id, bank_account_id, customer_receivable_account_id,
          supplier_payable_account_id, inventory_account_id, sales_revenue_account_id, sales_discount_account_id,
          cogs_account_id, purchase_account_id, expenses_account_id, sales_tax_account_id, purchase_tax_account_id)
       VALUES (1, $1, $1, 1, 2, 3, 6, 4, 9, 10, 12, 12, 15, 7, 5)`,
      [TENANT],
    );

    const foundation = new AccountingTenantFoundationService();
    const posting = new AccountingPostingService(foundation);
    const service = new MaintenanceService(db as any, new TransactionHelper(), {} as any, posting as any, foundation as any);
    const issue = (ticketId: number, productId: number, qty: number, price = 75) =>
      service.addPart(ticketId, { productId, productName: `Product ${productId}`, qty, unitCost: price, unitPrice: price } as any, AUTH);
    const issueAt = (ticketId: number, productId: number, qty: number, locationId: number, price = 75) =>
      service.addPart(ticketId, { productId, productName: `Product ${productId}`, qty, unitCost: price, unitPrice: price, locationId } as any, AUTH);

    // S1 — the live bug: global 10, ALL 10 in ONE real location row,
    // unassigned 0, ticket with no branch/location.
    await seedProduct(pg, 101, 10, 75);
    await seedLocationStock(pg, 101, BRANCH_MAIN, LOC_MAIN_A, 10);
    await seedLocationStock(pg, 101, null, null, 0);
    const t1 = await seedTicket(pg, 'ZM-261108-0001', null, null);
    const issued = await issue(t1, 101, 1);
    assert.equal(issued.ok, true, 'S1: addPart must succeed when the stock sits in a real location');
    const parts1 = await partRows(pg, t1);
    assert.equal(parts1.length, 1, 'S1: exactly one part row');
    assert.equal(parts1[0].location_id, LOC_MAIN_A, 'S1: part row records the resolved location');
    assert.equal(await locationQty(pg, 101, LOC_MAIN_A), 9, 'S1: location stock 10 -> 9');
    assert.equal(await locationQty(pg, 101, null), 0, 'S1: unassigned stays 0');
    assert.equal(await globalQty(pg, 101), 9, 'S1: global stock 10 -> 9');
    const move1 = await movementFor(pg, t1, 'maintenance_consumption');
    assert.equal(move1.branch_id, BRANCH_MAIN, 'S1: movement carries the resolved branch');
    assert.equal(move1.location_id, LOC_MAIN_A, 'S1: movement carries the resolved location');
    assert.equal(Number(move1.qty), -1);
    assertJournal(await journalLines(pg, 'maintenance_part_issue', move1.id), '5100', '1140', 75);
    const je1 = await journalLines(pg, 'maintenance_part_issue', move1.id);
    assert.equal(je1[0].branch_id, BRANCH_MAIN, 'S1: journal carries the resolved branch');
    assert.equal(je1[0].location_id, LOC_MAIN_A, 'S1: journal carries the resolved location');

    // S2 — removal returns the stock to the SAME location.
    await service.removePart(t1, parts1[0].id, AUTH);
    assert.deepEqual(await partRows(pg, t1), [], 'S2: part row is gone after removal');
    assert.equal(await locationQty(pg, 101, LOC_MAIN_A), 10, 'S2: location stock 9 -> 10');
    assert.equal(await globalQty(pg, 101), 10, 'S2: global stock 9 -> 10');
    assert.equal(await productCost(pg, 101), 75, 'S2: WAC stays 75 after a same-cost return');
    const move2 = await movementFor(pg, t1, 'maintenance_return');
    assert.equal(move2.location_id, LOC_MAIN_A, 'S2: return movement targets the same location');
    assert.equal(move2.branch_id, BRANCH_MAIN, 'S2: return movement carries the resolved branch');
    assertJournal(await journalLines(pg, 'maintenance_part_return', move2.id), '1140', '5100', 75);
    const je2 = await journalLines(pg, 'maintenance_part_return', move2.id);
    assert.equal(je2[0].branch_id, BRANCH_MAIN, 'S2: return journal carries the resolved branch');
    assert.equal(je2[0].location_id, LOC_MAIN_A, 'S2: return journal carries the location');
    assert.equal(await locationBranch(pg, 101, LOC_MAIN_A), BRANCH_MAIN, 'S2: return must not NULL the location row branch_id');

    // S3 — genuinely insufficient stock still throws INSUFFICIENT_STOCK.
    await seedProduct(pg, 102, 0, 75);
    const t2 = await seedTicket(pg, 'ZM-261108-0002', null, null);
    await assert.rejects(
      issue(t2, 102, 1),
      (e: any) => e.code === 'INSUFFICIENT_STOCK',
      'S3: global 0 must still throw INSUFFICIENT_STOCK',
    );
    assert.deepEqual(await partRows(pg, t2), [], 'S3: no part row on a refused issue');

    // S4 — no SINGLE location covers the qty: no split, same error,
    // balances untouched.
    await seedProduct(pg, 103, 10, 75);
    await seedLocationStock(pg, 103, BRANCH_MAIN, LOC_MAIN_A, 4);
    await seedLocationStock(pg, 103, BRANCH_MAIN, LOC_MAIN_B, 5);
    await seedLocationStock(pg, 103, null, null, 0);
    const t3 = await seedTicket(pg, 'ZM-261108-0003', null, null);
    await assert.rejects(
      issue(t3, 103, 6),
      (e: any) => e.code === 'INSUFFICIENT_STOCK',
      'S4: 4 + 5 must not be split to cover 6',
    );
    assert.equal(await locationQty(pg, 103, LOC_MAIN_A), 4, 'S4: location A untouched');
    assert.equal(await locationQty(pg, 103, LOC_MAIN_B), 5, 'S4: location B untouched');
    assert.equal(await globalQty(pg, 103), 10, 'S4: global untouched');

    // S5 — largest available location wins.
    await seedProduct(pg, 104, 13, 75);
    await seedLocationStock(pg, 104, BRANCH_MAIN, LOC_MAIN_A, 3);
    await seedLocationStock(pg, 104, BRANCH_MAIN, LOC_MAIN_B, 10);
    await seedLocationStock(pg, 104, null, null, 0);
    const t4 = await seedTicket(pg, 'ZM-261108-0004', null, null);
    await issue(t4, 104, 5);
    const parts4 = await partRows(pg, t4);
    assert.equal(parts4[0].location_id, LOC_MAIN_B, 'S5: the location holding 10 wins over the one holding 3');
    assert.equal(await locationQty(pg, 104, LOC_MAIN_B), 5, 'S5: location B 10 -> 5');
    assert.equal(await locationQty(pg, 104, LOC_MAIN_A), 3, 'S5: location A untouched');
    assert.equal(await globalQty(pg, 104), 8, 'S5: global 13 -> 8');

    // S6 — branch restriction: stock only in another branch is never
    // consumed; with stock in both branches the ticket's branch wins
    // (tie-break: lowest location id).
    await seedProduct(pg, 105, 10, 75);
    await seedLocationStock(pg, 105, BRANCH_OTHER, LOC_OTHER, 10);
    await seedLocationStock(pg, 105, null, null, 0);
    const t5 = await seedTicket(pg, 'ZM-261108-0005', BRANCH_MAIN, null);
    await assert.rejects(
      issue(t5, 105, 1),
      (e: any) => e.code === 'INSUFFICIENT_STOCK',
      'S6: another branch stock must not be consumed',
    );
    assert.equal(await locationQty(pg, 105, LOC_OTHER), 10, 'S6: other-branch stock untouched');
    assert.equal(await globalQty(pg, 105), 10, 'S6: global untouched');
    await seedProduct(pg, 106, 20, 75);
    await seedLocationStock(pg, 106, BRANCH_MAIN, LOC_MAIN_A, 10);
    await seedLocationStock(pg, 106, BRANCH_OTHER, LOC_OTHER, 10);
    await seedLocationStock(pg, 106, null, null, 0);
    const t6 = await seedTicket(pg, 'ZM-261108-0006', BRANCH_MAIN, null);
    await issue(t6, 106, 1);
    const parts6 = await partRows(pg, t6);
    assert.equal(parts6[0].location_id, LOC_MAIN_A, 'S6: ticket branch location wins the tie');
    assert.equal(await locationQty(pg, 106, LOC_MAIN_A), 9, 'S6: main location 10 -> 9');
    assert.equal(await locationQty(pg, 106, LOC_OTHER), 10, 'S6: other-branch location untouched');
    assert.equal(await globalQty(pg, 106), 19, 'S6: global 20 -> 19');

    // S7 — explicit-location addPart on a branchless ticket: the
    // deduction must leave the location row's branch_id intact
    // (pre-existing corruption on this path: the old code passed a
    // null branch, so the deduction itself nulled the row's branch).
    await seedProduct(pg, 107, 10, 75);
    await seedLocationStock(pg, 107, BRANCH_MAIN, LOC_MAIN_A, 10);
    await seedLocationStock(pg, 107, null, null, 0);
    const t7 = await seedTicket(pg, 'ZM-261108-0007', null, null);
    await issueAt(t7, 107, 1, LOC_MAIN_A);
    const parts7 = await partRows(pg, t7);
    assert.equal(parts7[0].location_id, LOC_MAIN_A, 'S7: part row records the explicit location');
    assert.equal(await locationQty(pg, 107, LOC_MAIN_A), 9, 'S7: location stock 10 -> 9');
    assert.equal(await locationBranch(pg, 107, LOC_MAIN_A), BRANCH_MAIN, 'S7: deduction must not NULL the location row branch_id');
    assert.equal(await globalQty(pg, 107), 9, 'S7: global stock 10 -> 9');
    const move7 = await movementFor(pg, t7, 'maintenance_consumption');
    assert.equal(move7.branch_id, BRANCH_MAIN, 'S7: movement carries the derived branch');
    assert.equal(move7.location_id, LOC_MAIN_A, 'S7: movement carries the explicit location');
    const je7 = await journalLines(pg, 'maintenance_part_issue', move7.id);
    assert.equal(je7[0].branch_id, BRANCH_MAIN, 'S7: journal carries the derived branch');
    assert.equal(je7[0].location_id, LOC_MAIN_A, 'S7: journal carries the explicit location');

    console.log('maintenance-part-issue-location.spec.ts passed');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
