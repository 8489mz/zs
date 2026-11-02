/*
New file: backend/test/critical/import-po-from-proforma-fail-closed.spec.ts
Pins the PO-generation fail-closed rules (INV-IMPORT-PO-FROM-PROFORMA-FAIL-CLOSED).

WHAT WAS WRONG: when a proforma carried no usable items,
generatePoFromProforma first tried the linked project's feasibility,
then fell back to the tenant's MOST RECENTLY CREATED project with any
feasibility items — a purchase order could be built from a different
project's goods. Separately, when the lines' foreign total differed
from the proforma header total by more than 0.02, the header total was
silently overwritten, hiding a supplier-document discrepancy and
laundering it into the later paid-amount checks.

The same-project recovery was dead code, not a working fallback: its
mapping built items without productId, so the line-validation loop
always rejected them and the transaction rolled back, discarding even
the items backfill. Removing the whole auto-recovery block therefore
changes no working behaviour; a proforma without usable items now
fails closed at the existing empty-items guard.

WHAT THIS PINS, driving the real generatePoFromProforma on PGlite:
- A proforma with empty items fails even when the tenant's newest
  project carries feasibility items: no PO, no PO lines, and the
  proforma header (items, total) is untouched.
- A lines total more than 0.02 away from the header total throws
  IMPORT_PROFORMA_TOTAL_MISMATCH, creates no PO, and leaves the header
  total untouched.
- A mismatch within 0.02 still converts, and a valid proforma still
  converts at the contract rate.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, account_id text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, feasibility_data text, created_at timestamptz);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text, supplier_id bigint, pi_number text, pi_date text, currency text, total_amount_foreign numeric, exchange_rate_contract numeric, status text, po_status text, po_number text, po_date text, items text, advance_percentage numeric, balance_percentage numeric, incoterm text, delivery_port text, payment_terms text, notes text);
    CREATE TABLE purchase_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, supplier_id bigint, supplier_name text, subtotal numeric, tax_amount numeric, discount_amount numeric, total_amount numeric, status text, notes text, created_by bigint);
    CREATE TABLE purchase_order_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, purchase_order_id bigint, product_id bigint, product_name text, quantity numeric, received_quantity numeric, unit_cost numeric, tax_rate numeric, discount numeric, total numeric);
  `);
  await db.insertInto('suppliers' as never).values({
    id: 3, tenant_id: 't1', name: 'Supplier', account_id: 't1',
  } as never).execute();
  await db.insertInto('products' as never).values({
    id: 5, tenant_id: 't1', name: 'Widget',
  } as never).execute();
  return db;
}

async function seedProject(db: Kysely<Database>, id: string, createdAt: string): Promise<void> {
  await db.insertInto('import_projects' as never).values({
    id, tenant_id: 't1',
    feasibility_data: JSON.stringify({ items: [{ name: 'Other Project Goods', qty: 10, factoryPriceUsd: 9 }] }),
    created_at: createdAt,
  } as never).execute();
}

async function seedPi(db: Kysely<Database>, overrides: Record<string, unknown>): Promise<void> {
  await db.insertInto('import_proforma_invoices' as never).values({
    id: 'pi-1', tenant_id: 't1', project_id: null, supplier_id: 3, pi_number: 'PI-1',
    pi_date: '2026-11-02', currency: 'USD', total_amount_foreign: 200,
    exchange_rate_contract: 50, status: 'approved', po_status: 'draft', po_number: null,
    po_date: null, items: '[]', advance_percentage: 30, balance_percentage: 70,
    incoterm: 'FOB', delivery_port: null, payment_terms: null, notes: null,
    ...overrides,
  } as never).execute();
}

async function poCount(db: Kysely<Database>): Promise<number> {
  const row: any = await (db as any).selectFrom('purchase_orders').select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function readPi(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('import_proforma_invoices').selectAll().where('id', '=', 'pi-1').executeTakeFirstOrThrow();
}

async function main(): Promise<void> {
  // Case 1: empty items + a newer feasibility-bearing project -> fail, borrow nothing.
  {
    const db = await makeDb();
    try {
      await seedProject(db, 'proj-old', '2026-11-01T00:00:00Z');
      await seedProject(db, 'proj-new', '2026-11-02T00:00:00Z');
      await seedPi(db, {});
      const service = new (ImportSalesService as any)(db);
      await assert.rejects(
        async () => service.generatePoFromProforma('t1', 1, 'pi-1'),
        /لا تحتوي على أصناف/,
        'An item-less proforma must fail closed instead of borrowing another project goods',
      );
      assert.equal(await poCount(db), 0, 'No purchase order may be created from borrowed goods');
      const pi = await readPi(db);
      assert.equal(pi.items, '[]', 'The proforma items must stay untouched');
      assert.equal(Number(pi.total_amount_foreign), 200);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: lines total differs from the header by more than 0.02 -> throw, header untouched.
  {
    const db = await makeDb();
    try {
      await seedPi(db, {
        items: JSON.stringify([{ productId: 5, quantity: 2, unitPriceForeign: 120 }]),
        total_amount_foreign: 200,
      });
      const service = new (ImportSalesService as any)(db);
      await assert.rejects(
        async () => service.generatePoFromProforma('t1', 1, 'pi-1'),
        /IMPORT_PROFORMA_TOTAL_MISMATCH/,
        'A total mismatch must fail closed with a named error',
      );
      assert.equal(await poCount(db), 0);
      const pi = await readPi(db);
      assert.equal(Number(pi.total_amount_foreign), 200, 'The header total must never be silently overwritten');
      assert.equal(pi.po_status, 'draft');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a mismatch within 0.02 still converts (existing tolerance preserved).
  // Case 4: a valid proforma converts at the contract rate.
  {
    const db = await makeDb();
    try {
      await seedPi(db, {
        items: JSON.stringify([{ productId: 5, quantity: 2, unitPriceForeign: 100 }]),
        total_amount_foreign: 200.01,
      });
      const service = new (ImportSalesService as any)(db);
      const result = await service.generatePoFromProforma('t1', 1, 'pi-1');
      assert.equal(result.po_status, 'issued');
      assert.ok(String(result.po_number).startsWith('PO-'));
      assert.equal(await poCount(db), 1);
      const line: any = await (db as any).selectFrom('purchase_order_items').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(line.unit_cost), 5000, 'Unit cost is foreign cost x contract rate at 3dp');
      assert.equal(Number(line.total), 10000);
    } finally {
      await db.destroy();
    }
  }

  console.log('Import PO-from-proforma fail-closed tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
