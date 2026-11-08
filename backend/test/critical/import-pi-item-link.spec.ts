/*
I1-P1: PI lines must link to real inventory items so PO generation works.

WHAT WAS WRONG (live trial 2026-11-09, deployed 4ade6e01): two approved
PIs failed PO generation because no UI path linked a PI line to a real
item — the PI dialog item field was free text, and the feasibility
items form carried no productId, so the feasibility->PI pull copied
only name/qty/price. The backend fail-closed check was correct but its
error named no line, so the merchant could not tell which line to fix.

WHAT THIS PINS, driving the real service methods on PGlite:
- A PI whose lines link to real items generates a PO whose lines carry
  the linked productId, quantity, and unit cost (foreign x rate, 3dp).
- A PI line with no link fails PO generation fail-closed, and the error
  names the offending line (index + name); no PO is created.
- The approve-then-link workflow: a PI created unlinked can be
  approved, then linked via updateProformaInvoice (which persists
  productId intact), then generates its PO.
- The feasibility->PI pull contract: a project whose feasibility_data
  items carry productId produces PI items (mapped exactly as the PI
  dialog's handleSelectProject maps them) that generate a PO.
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
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id text, project_id text, supplier_id bigint, pi_number text, pi_date text, currency text, total_amount_foreign numeric, exchange_rate_contract numeric, status text, po_status text, po_number text, po_date text, items text, advance_percentage numeric, balance_percentage numeric, incoterm text, delivery_port text, payment_terms text, notes text, paid_amount_foreign numeric, payment_status text, approved_by bigint, approved_at timestamptz);
    CREATE TABLE purchase_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, supplier_id bigint, supplier_name text, subtotal numeric, tax_amount numeric, discount_amount numeric, total_amount numeric, status text, notes text, created_by bigint);
    CREATE TABLE purchase_order_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, purchase_order_id bigint, product_id bigint, product_name text, quantity numeric, received_quantity numeric, unit_cost numeric, tax_rate numeric, discount numeric, total numeric);
    CREATE TABLE settings (tenant_id text, key text, value text);
  `);
  await db.insertInto('suppliers' as never).values({
    id: 3, tenant_id: 't1', name: 'Supplier', account_id: 't1',
  } as never).execute();
  await db.insertInto('products' as never).values({
    id: 5, tenant_id: 't1', name: 'Widget',
  } as never).execute();
  return db;
}

async function poCount(db: Kysely<Database>): Promise<number> {
  const row: any = await (db as any).selectFrom('purchase_orders').select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function readPi(db: Kysely<Database>, id: string): Promise<any> {
  return (db as any).selectFrom('import_proforma_invoices').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function seedPi(db: Kysely<Database>, overrides: Record<string, unknown>): Promise<void> {
  await db.insertInto('import_proforma_invoices' as never).values({
    id: 'pi-1', tenant_id: 't1', project_id: null, supplier_id: 3, pi_number: 'PI-1',
    pi_date: '2026-11-02', currency: 'USD', total_amount_foreign: 10,
    exchange_rate_contract: 50, status: 'approved', po_status: 'draft', po_number: null,
    po_date: null, items: '[]', advance_percentage: 30, balance_percentage: 70,
    incoterm: 'FOB', delivery_port: null, payment_terms: null, notes: null,
    paid_amount_foreign: 0, payment_status: 'unpaid', approved_by: null, approved_at: null,
    ...overrides,
  } as never).execute();
}

async function main(): Promise<void> {
  // Case 1: linked lines (the trial numbers: 10 x $1 at rate 50) generate a PO with the linked product.
  {
    const db = await makeDb();
    try {
      await seedPi(db, {
        items: JSON.stringify([{ productId: 5, productName: 'Widget', quantity: 10, unitPriceForeign: 1 }]),
        total_amount_foreign: 10,
      });
      const service = new (ImportSalesService as any)(db);
      const result = await service.generatePoFromProforma('t1', 1, 'pi-1');
      assert.equal(result.po_status, 'issued');
      assert.ok(String(result.po_number).startsWith('PO-'));
      assert.equal(await poCount(db), 1);
      const line: any = await (db as any).selectFrom('purchase_order_items').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(line.product_id), 5, 'The PO line must carry the linked real item');
      assert.equal(Number(line.quantity), 10);
      assert.equal(Number(line.unit_cost), 50, 'Unit cost is foreign cost x contract rate');
      assert.equal(Number(line.total), 500);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: the second line has no link -> fail closed, error names the line (index + name), no PO.
  {
    const db = await makeDb();
    try {
      await seedPi(db, {
        items: JSON.stringify([
          { productId: 5, productName: 'Widget', quantity: 10, unitPriceForeign: 1 },
          { productName: 'بند بلا ربط', quantity: 2, unitPriceForeign: 3 },
        ]),
        total_amount_foreign: 16,
      });
      const service = new (ImportSalesService as any)(db);
      await assert.rejects(
        async () => service.generatePoFromProforma('t1', 1, 'pi-1'),
        (err: any) => /البند رقم 2/.test(err.message) && /بند بلا ربط/.test(err.message),
        'An unlinked PI line must fail closed naming the line (index + name)',
      );
      assert.equal(await poCount(db), 0, 'No purchase order may be created from a half-linked proforma');
      const pi = await readPi(db, 'pi-1');
      assert.equal(pi.po_status, 'draft');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: approve-then-link — create unlinked, approve, link via update (productId persists), generate PO.
  {
    const db = await makeDb();
    try {
      const service = new (ImportSalesService as any)(db);
      const created: any = await service.createProformaInvoice('t1', {
        supplierId: '3', piNumber: 'PI-LINK-1', piDate: '2026-11-09',
        currency: 'USD', totalAmountForeign: 10, exchangeRateContract: 50,
        advancePercentage: 30, balancePercentage: 70,
        items: [{ productName: 'Widget', quantity: 10, unitPriceForeign: 1 }],
      });
      await service.approveProformaInvoice('t1', 1, created.id);
      const updated: any = await service.updateProformaInvoice('t1', created.id, {
        items: [{ productId: 5, productName: 'Widget', quantity: 10, unitPriceForeign: 1 }],
      });
      const storedItems = JSON.parse(updated.items);
      assert.equal(Number(storedItems[0].productId), 5, 'updateProformaInvoice must persist productId intact');
      const result = await service.generatePoFromProforma('t1', 1, created.id);
      assert.equal(result.po_status, 'issued');
      assert.equal(await poCount(db), 1);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: feasibility->PI pull contract — a project whose feasibility
  // items carry productId maps (exactly as the PI dialog maps them) to
  // PI items that generate a PO with the linked product.
  {
    const db = await makeDb();
    try {
      await db.insertInto('import_projects' as never).values({
        id: 'proj-1', tenant_id: 't1',
        feasibility_data: JSON.stringify({
          items: [{ name: 'Widget', productId: 5, qty: 10, factoryPriceUsd: 1, hsCode: '8708.30' }],
        }),
        created_at: '2026-11-09T00:00:00Z',
      } as never).execute();
      const proj: any = await (db as any).selectFrom('import_projects').selectAll().where('id', '=', 'proj-1').executeTakeFirstOrThrow();
      const feas = JSON.parse(proj.feasibility_data);
      // Mirror of ChinaProformasTab handleSelectProject mapping.
      const pulledItems = feas.items.map((it: any) => ({
        productName: it.name || it.productName || 'بند استيراد',
        productId: it.productId || '',
        quantity: Number(it.qty ?? it.quantity ?? 1),
        unitPriceForeign: Number(it.factoryPriceUsd ?? it.unitPriceForeign ?? 0),
        hsCode: it.hsCode || '',
      }));
      assert.equal(Number(pulledItems[0].productId), 5, 'The feasibility->PI pull must carry productId through');
      const service = new (ImportSalesService as any)(db);
      const created: any = await service.createProformaInvoice('t1', {
        projectId: 'proj-1', supplierId: '3', piNumber: 'PI-PULL-1', piDate: '2026-11-09',
        currency: 'USD', totalAmountForeign: 10, exchangeRateContract: 50,
        advancePercentage: 30, balancePercentage: 70, items: pulledItems,
      });
      await service.approveProformaInvoice('t1', 1, created.id);
      const result = await service.generatePoFromProforma('t1', 1, created.id);
      assert.equal(result.po_status, 'issued');
      const line: any = await (db as any).selectFrom('purchase_order_items').selectAll().executeTakeFirstOrThrow();
      assert.equal(Number(line.product_id), 5, 'The pulled PI line must generate a PO line for the linked item');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import PI item-link tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
