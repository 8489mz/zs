/*
New file: backend/test/critical/import-project-proforma-guards.spec.ts
Pins the project/proforma lifecycle guards
(INV-IMPORT-PROJECT-PROFORMA-GUARDS).

WHAT WAS WRONG: the plain PATCH endpoints bypassed every lifecycle
rule. updateProject accepted an arbitrary `status` (a caller could
"close" or reopen a project without the maker-checker close flow,
its shipment/PI/PO/broker/deposit/attribution checks) and could
rewrite feasibilityData after closure. updateProformaInvoice
rewrote a proforma after payment or after its PO was issued.
approveProformaInvoice approved any row regardless of status or
items. createProformaInvoice trusted any supplier id and allowed a
duplicate pi_number in the same tenant.

WHAT THIS PINS, driving the real service on PGlite:
- updateProject rejects ANY status field (status changes only
  through closeProject); feasibilityData edits on a closed project
  are rejected, while ordinary title edits on a closed project are
  still allowed and feasibility edits on an active project work.
- updateProformaInvoice refuses all changes after PO issue
  (po_status 'issued' or po_number present), and refuses money or
  identity fields after any payment (paid_amount_foreign > 0 or
  payment_status != 'unpaid'). An items-only update stays allowed
  after payment because the established workflow pays the proforma
  BEFORE its items are linked to catalog products (the e2e
  simulation settles the balance, then links items, then generates
  the PO); PO generation re-validates the header total against the
  items, so an items edit cannot corrupt the PO. Post-approval
  updates are allowed while unpaid and PO-less for the same reason.
- approveProformaInvoice requires draft status and at least one
  validated item (quantity/qty > 0 or a non-empty name; feasibility
  items without a catalog productId are accepted), and rejects a
  second approval.
- createProformaInvoice requires the supplier to exist AND belong to
  the tenant, and rejects a duplicate pi_number in the same tenant
  (a different tenant may reuse the number); the same duplicate
  check applies when updateProformaInvoice changes pi_number.

RESIDUAL (not provable from existing fields): maker-checker
approver != creator cannot be enforced — import_proforma_invoices
has no created_by column, so approve cannot know the creator. That
gap is recorded in the invariant; it needs a migration, not a
service-only fix. The duplicate-pi_number check is a service check
only: two concurrent creates can still race (no unique index).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE SEQUENCE proj_seq;
    CREATE SEQUENCE pi_seq;
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, balance numeric, is_active boolean);
    CREATE TABLE import_projects (
      id text PRIMARY KEY DEFAULT ('proj-' || nextval('proj_seq')::text),
      tenant_id text, title text, target_market text, country_origin text, country_destination text,
      budget_currency text, allocated_capital numeric, target_roi_percentage numeric,
      status text, feasibility_data text, notes text, updated_at timestamptz
    );
    CREATE TABLE import_proforma_invoices (
      id text PRIMARY KEY DEFAULT ('pi-' || nextval('pi_seq')::text),
      tenant_id text, project_id text, supplier_id bigint, pi_number text, pi_date text,
      currency text, total_amount_foreign numeric, incoterm text, delivery_port text,
      payment_terms text, exchange_rate_contract numeric, advance_percentage numeric,
      balance_percentage numeric, status text, payment_status text, paid_amount_foreign numeric,
      items text, notes text, po_status text, po_number text, approved_by bigint, approved_at timestamptz
    );
    INSERT INTO suppliers VALUES (11, 't1', 'Guangzhou Ltd', 0, true), (12, 't2', 'Other Tenant Supplier', 0, true);
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined };
  return new (ImportSalesService as any)(db, new AccountingPostingService(fakeFoundation));
}

async function seedProject(db: Kysely<Database>, status = 'active'): Promise<string> {
  const row: any = await (db as any).insertInto('import_projects').values({
    tenant_id: 't1', title: 'Ningbo Container', status,
    feasibility_data: JSON.stringify({ items: [{ name: 'Mixer', qty: 100 }] }),
  }).returning('id').executeTakeFirstOrThrow();
  return row.id as string;
}

async function seedProforma(
  db: Kysely<Database>,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row: any = await (db as any).insertInto('import_proforma_invoices').values({
    tenant_id: 't1', project_id: null, supplier_id: 11, pi_number: 'PI-100',
    pi_date: '2026-11-02', currency: 'USD', total_amount_foreign: 10000,
    incoterm: 'FOB', delivery_port: null, payment_terms: null, exchange_rate_contract: null,
    advance_percentage: 30, balance_percentage: 70, status: 'draft', payment_status: 'unpaid',
    paid_amount_foreign: 0, items: JSON.stringify([{ name: 'Mixer', qty: 100, factoryPriceUsd: 25 }]),
    notes: null, po_status: null, po_number: null, approved_by: null, approved_at: null,
    ...overrides,
  }).returning('id').executeTakeFirstOrThrow();
  return row.id as string;
}

async function readProforma(db: Kysely<Database>, id: string): Promise<any> {
  return (db as any).selectFrom('import_proforma_invoices').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function main(): Promise<void> {
  // Case 1: PATCH status is rejected; the row is untouched.
  {
    const db = await makeDb();
    try {
      const id = await seedProject(db);
      const service = makeService(db);
      await assert.rejects(
        async () => service.updateProject('t1', id, { status: 'closed' }),
        /IMPORT_PROJECT_STATUS_VIA_CLOSE_ONLY/,
      );
      const row: any = await (db as any).selectFrom('import_projects').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      assert.equal(row.status, 'active');
    } finally { await db.destroy(); }
  }

  // Case 2: feasibility freeze on a closed project; title edits still allowed.
  {
    const db = await makeDb();
    try {
      const id = await seedProject(db, 'closed');
      const service = makeService(db);
      await assert.rejects(
        async () => service.updateProject('t1', id, { feasibilityData: { items: [] } }),
        /IMPORT_PROJECT_CLOSED_FEASIBILITY_FROZEN/,
      );
      const updated: any = await service.updateProject('t1', id, { title: 'Renamed' });
      assert.equal(updated.title, 'Renamed');
      const row: any = await (db as any).selectFrom('import_projects').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      assert.equal(JSON.parse(row.feasibility_data).items.length, 1, 'Feasibility data must be untouched');
    } finally { await db.destroy(); }
  }

  // Case 3: feasibility edits on an active project work.
  {
    const db = await makeDb();
    try {
      const id = await seedProject(db);
      const service = makeService(db);
      const updated: any = await service.updateProject('t1', id, { feasibilityData: { items: [{ name: 'Fryer', qty: 50 }] } });
      assert.equal(JSON.parse(updated.feasibility_data).items[0].name, 'Fryer');
    } finally { await db.destroy(); }
  }

  // Case 4: update after payment is refused.
  {
    const db = await makeDb();
    try {
      const id = await seedProforma(db, { paid_amount_foreign: 3000, payment_status: 'partial' });
      const service = makeService(db);
      await assert.rejects(
        async () => service.updateProformaInvoice('t1', id, { totalAmountForeign: 9999 }),
        /IMPORT_PROFORMA_FROZEN/,
      );
      assert.equal(Number((await readProforma(db, id)).total_amount_foreign), 10000);
    } finally { await db.destroy(); }
  }

  // Case 4b: items-only update after payment is allowed (linking workflow); money fields are frozen.
  {
    const db = await makeDb();
    try {
      const id = await seedProforma(db, { paid_amount_foreign: 3000, payment_status: 'partial' });
      const service = makeService(db);
      const updated: any = await service.updateProformaInvoice('t1', id, {
        items: [{ productId: 5, qty: 100, factoryPriceUsd: 25 }],
      } as any);
      assert.equal(JSON.parse(updated.items)[0].productId, 5);
      assert.equal(Number(updated.total_amount_foreign), 10000, 'The header total must survive an items-only update');
    } finally { await db.destroy(); }
  }

  // Case 5: update after PO issue is refused.
  {
    const db = await makeDb();
    try {
      const id = await seedProforma(db, { status: 'approved', po_status: 'issued', po_number: 'PO-261102-0001' });
      const service = makeService(db);
      await assert.rejects(
        async () => service.updateProformaInvoice('t1', id, { totalAmountForeign: 9999 }),
        /IMPORT_PROFORMA_FROZEN/,
      );
      assert.equal(Number((await readProforma(db, id)).total_amount_foreign), 10000);
    } finally { await db.destroy(); }
  }

  // Case 6: approved + unpaid + PO-less proforma CAN be updated (approve -> link -> PO workflow).
  {
    const db = await makeDb();
    try {
      const id = await seedProforma(db, { status: 'approved' });
      const service = makeService(db);
      const updated: any = await service.updateProformaInvoice('t1', id, {
        items: [{ productId: 5, qty: 100, factoryPriceUsd: 25 }],
      } as any);
      assert.equal(JSON.parse(updated.items)[0].productId, 5);
    } finally { await db.destroy(); }
  }

  // Case 7: approve requires draft + validated items; second approval rejected.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const draft = await seedProforma(db);
      const approved: any = await service.approveProformaInvoice('t1', 1, draft);
      assert.equal(approved.status, 'approved');
      await assert.rejects(
        async () => service.approveProformaInvoice('t1', 1, draft),
        /IMPORT_PROFORMA_NOT_DRAFT/,
      );
      const empty = await seedProforma(db, { pi_number: 'PI-101', items: '[]' });
      await assert.rejects(
        async () => service.approveProformaInvoice('t1', 1, empty),
        /IMPORT_PROFORMA_NO_VALID_ITEMS/,
      );
      const junk = await seedProforma(db, { pi_number: 'PI-102', items: JSON.stringify([{ qty: 0 }]) });
      await assert.rejects(
        async () => service.approveProformaInvoice('t1', 1, junk),
        /IMPORT_PROFORMA_NO_VALID_ITEMS/,
      );
    } finally { await db.destroy(); }
  }

  // Case 8: create requires a supplier that exists in this tenant.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const base: any = {
        supplierId: '99999', piNumber: 'PI-200', piDate: '2026-11-02',
        totalAmountForeign: 5000, items: [{ name: 'Mixer', qty: 10 }],
      };
      await assert.rejects(
        async () => service.createProformaInvoice('t1', base),
        /IMPORT_PROFORMA_SUPPLIER_REQUIRED/,
      );
      await assert.rejects(
        async () => service.createProformaInvoice('t1', { ...base, supplierId: '12' }),
        /IMPORT_PROFORMA_SUPPLIER_REQUIRED/,
        'A supplier of another tenant must not be usable',
      );
      const created: any = await service.createProformaInvoice('t1', { ...base, supplierId: '11' });
      assert.equal(created.status, 'draft');
      assert.equal(created.pi_number, 'PI-200');
    } finally { await db.destroy(); }
  }

  // Case 9: duplicate pi_number per tenant rejected on create and on update; other tenant unaffected.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedProforma(db, { pi_number: 'PI-300' });
      await assert.rejects(
        async () => service.createProformaInvoice('t1', {
          supplierId: '11', piNumber: 'PI-300', piDate: '2026-11-02',
          totalAmountForeign: 100, items: [{ name: 'X', qty: 1 }],
        }),
        /IMPORT_PROFORMA_DUPLICATE_NUMBER/,
      );
      const other: any = await service.createProformaInvoice('t2', {
        supplierId: '12', piNumber: 'PI-300', piDate: '2026-11-02',
        totalAmountForeign: 100, items: [{ name: 'X', qty: 1 }],
      } as any);
      assert.equal(other.pi_number, 'PI-300');
      const second = await seedProforma(db, { pi_number: 'PI-301' });
      await assert.rejects(
        async () => service.updateProformaInvoice('t1', second, { piNumber: 'PI-300' }),
        /IMPORT_PROFORMA_DUPLICATE_NUMBER/,
      );
      const renamed: any = await service.updateProformaInvoice('t1', second, { piNumber: 'PI-302' });
      assert.equal(renamed.pi_number, 'PI-302');
    } finally { await db.destroy(); }
  }

  console.log('Import project/proforma guard tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
