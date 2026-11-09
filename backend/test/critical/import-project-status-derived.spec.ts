/*
New file: backend/test/critical/import-project-status-derived.spec.ts
Pins the I9-C rule (R9, live re-test 2026-11-09, deployed 4d811676):
all project statuses read "feasibility" even when approved.

WHAT WAS WRONG: the project list returned the stored
import_projects.status verbatim, and only three writers ever touch
that column — create writes 'feasibility', convert writes
'sourcing', close writes 'closed'. No other lifecycle event (an
approved proforma, a shipment, an arrival, a posted receipt, a
sale) ever advances it, and 'warehousing' / 'selling' have no
writer at all. Live proof: IMP-261108-0001 and IMP-261109-0001 ran
the full cycle — approved PIs, shipments, an Arrived container, a
posted receipt (JE-00015025) and a sale invoiced (Z-261109-16323)
— while the list still read 'feasibility' for both, because their
feasibility studies were never converted. The displayed status is
therefore DERIVED at read time from the authoritative lifecycle
evidence (INV-IMPORT-PROJECT-STATUS-APPROVED), which also repairs
the already-stale live rows without touching posted data.

WHAT THIS PINS, driving the REAL listProjects / getProjectById on
PGlite:
- a plain 'feasibility' project with no proforma or shipment still
  reads 'feasibility' (the control — nothing approved yet).
- a stored-'feasibility' project with an APPROVED proforma reads
  'sourcing' — the live IMP-261109-0001 shape (approved
  PI-IMP-261109-0001-5287, study never converted).
- a stored-'feasibility' project with a Pending shipment reads
  'sourcing'; with an Arrived shipment it reads 'warehousing' —
  the live MSCU-TEST-001 shape.
- a stored-'feasibility' project whose feasibility_converted_at is
  set reads 'sourcing' (the converted flag without the stored move).
- a draft-only proforma does NOT move the state: still 'feasibility'.
- 'closed' is terminal: a closed project with an Arrived shipment
  still reads 'closed'.
- a normally converted project (stored 'sourcing') still reads
  'sourcing' — no regression.
- the ?status= filter applies to the DERIVED status: filtering for
  'sourcing' finds the approved-but-unconverted project and excludes
  the plain feasibility one; filtering for 'feasibility' returns
  only the plain one.
- getProjectById agrees with the list for the same project.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, status text, feasibility_converted_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, project_id text, status text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_proforma_invoices (id bigserial PRIMARY KEY, tenant_id text, project_id text, status text);
    CREATE TABLE import_qc_inspections (id text PRIMARY KEY, tenant_id text, project_id text, inspection_date timestamptz);
    CREATE TABLE import_sourcing_trips (id text PRIMARY KEY, tenant_id text, project_id text, start_date timestamptz);
    CREATE TABLE import_aci_compliance (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_project_partners (id text PRIMARY KEY, tenant_id text, project_id text, partner_id text, capital_share_amount numeric, profit_percentage numeric);
    CREATE TABLE import_partners (id text PRIMARY KEY, tenant_id text, name text);
  `);
  return db;
}

async function seedProject(
  db: Kysely<Database>,
  id: string,
  status: string,
  convertedAt: string | null,
): Promise<void> {
  if (convertedAt) {
    await sql`INSERT INTO import_projects (id, tenant_id, project_no, status, feasibility_converted_at) VALUES (${id}, 't1', ${`IMP-${id}`}, ${status}, NOW())`.execute(db);
  } else {
    await sql`INSERT INTO import_projects (id, tenant_id, project_no, status, feasibility_converted_at) VALUES (${id}, 't1', ${`IMP-${id}`}, ${status}, NULL)`.execute(db);
  }
}

async function seedProforma(db: Kysely<Database>, projectId: string, status: string): Promise<void> {
  await sql`INSERT INTO import_proforma_invoices (tenant_id, project_id, status) VALUES ('t1', ${projectId}, ${status})`.execute(db);
}

async function seedShipment(db: Kysely<Database>, id: string, projectId: string, status: string): Promise<void> {
  await sql`INSERT INTO import_shipments (id, tenant_id, project_id, status) VALUES (${id}, 't1', ${projectId}, ${status})`.execute(db);
}

async function main(): Promise<void> {
  const db = await makeDb();
  const service = new ImportSalesService(db as never, undefined);
  try {
    // Live shapes (re-test 2026-11-09, tenant test10k).
    await seedProject(db, 'proj-feas', 'feasibility', null);
    await seedProject(db, 'proj-pi', 'feasibility', null);
    await seedProforma(db, 'proj-pi', 'approved');
    await seedProject(db, 'proj-draft-pi', 'feasibility', null);
    await seedProforma(db, 'proj-draft-pi', 'draft');
    await seedProject(db, 'proj-ship', 'feasibility', null);
    await seedShipment(db, 'sh-pending', 'proj-ship', 'Pending');
    await seedProject(db, 'proj-arrived', 'feasibility', null);
    await seedShipment(db, 'sh-arrived', 'proj-arrived', 'Arrived');
    await seedProject(db, 'proj-conv', 'feasibility', 'converted');
    await seedProject(db, 'proj-closed', 'closed', 'converted');
    await seedShipment(db, 'sh-closed-arrived', 'proj-closed', 'Arrived');
    await seedProject(db, 'proj-sourcing', 'sourcing', 'converted');

    const listed = await service.listProjects('t1');
    const byId = new Map<string, any>(listed.map((p: any) => [String(p.id), p]));

    // 1. Control: nothing approved, nothing shipped — still feasibility.
    assert.equal(byId.get('proj-feas')?.status, 'feasibility', 'plain study-stage project stays feasibility');
    // 2. Approved proforma on an unconverted project — the R9 shape.
    assert.equal(byId.get('proj-pi')?.status, 'sourcing', 'approved PI on a stored-feasibility project must read sourcing, never feasibility');
    // 3. A draft-only proforma proves nothing approved yet.
    assert.equal(byId.get('proj-draft-pi')?.status, 'feasibility', 'draft-only proforma must not move the state');
    // 4. Shipments move the state: Pending -> sourcing, Arrived -> warehousing.
    assert.equal(byId.get('proj-ship')?.status, 'sourcing', 'Pending shipment means sourcing is under way');
    assert.equal(byId.get('proj-arrived')?.status, 'warehousing', 'Arrived shipment means goods are in the warehouse');
    // 5. Converted flag without the stored move still reads sourcing.
    assert.equal(byId.get('proj-conv')?.status, 'sourcing', 'feasibility_converted_at set must read sourcing');
    // 6. Closed is terminal even with an Arrived shipment.
    assert.equal(byId.get('proj-closed')?.status, 'closed', 'closed never re-opens');
    // 7. A normally converted project is unchanged.
    assert.equal(byId.get('proj-sourcing')?.status, 'sourcing', 'stored sourcing stays sourcing');

    // 8. The ?status= filter applies to the DERIVED status.
    const sourcing = await service.listProjects('t1', 'sourcing');
    const sourcingIds = sourcing.map((p: any) => String(p.id)).sort();
    assert.deepEqual(
      sourcingIds,
      ['proj-conv', 'proj-pi', 'proj-ship', 'proj-sourcing'],
      'filtering for sourcing must find the approved-but-unconverted project',
    );
    const feasibility = await service.listProjects('t1', 'feasibility');
    assert.deepEqual(
      feasibility.map((p: any) => String(p.id)).sort(),
      ['proj-draft-pi', 'proj-feas'],
      'filtering for feasibility must exclude approved / shipped projects',
    );
    const warehousing = await service.listProjects('t1', 'warehousing');
    assert.deepEqual(
      warehousing.map((p: any) => String(p.id)),
      ['proj-arrived'],
      'filtering for warehousing finds the Arrived project',
    );

    // 9. The detail view agrees with the list for the same project.
    const detailPi: any = await service.getProjectById('t1', 'proj-pi');
    assert.equal(detailPi.status, 'sourcing', 'detail must agree with the list (approved PI)');
    const detailArrived: any = await service.getProjectById('t1', 'proj-arrived');
    assert.equal(detailArrived.status, 'warehousing', 'detail must agree with the list (Arrived shipment)');
    const detailFeas: any = await service.getProjectById('t1', 'proj-feas');
    assert.equal(detailFeas.status, 'feasibility', 'detail must agree with the list (plain project)');

    console.log('import project derived status checks passed');
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
