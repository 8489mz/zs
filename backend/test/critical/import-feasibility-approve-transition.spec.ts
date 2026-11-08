/*
New file: backend/test/critical/import-feasibility-approve-transition.spec.ts
Pins the I1-P2 rule: approving a feasibility study transitions the
EXISTING project, never creates a second project (trial problem 2,
2026-11-09: approving the study for IMP-261108-0001 created a second
project IMP-261109-0001 while the first stayed "feasibility").

THE GAP: the backend convert already updated the project in place,
but the frontend approval handler called the convert mutation with a
CREATE-project payload and NO projectId, so the mutation fell through
to POST /api/import-sales/projects and created a duplicate project.
The backend also re-ran the conversion on a second approval, which
would rebuild the cash-flow schedule and mint a second proforma.

THE RULE: converting feasibility on an existing project transitions
THAT project (status -> sourcing, feasibility_converted_at set, the
cash-flow schedule stored) and creates NO second project and NO
proforma unless a supplier is given; a second convert on an
already-converted project fails closed with
IMPORT_FEASIBILITY_ALREADY_CONVERTED and leaves the project untouched.

WHAT THIS PINS, driving the REAL convertFeasibilityToProject on
PGlite:
- converting a 'feasibility' project transitions that same project
  (status sourcing, converted_at set, 5-stage cash-flow schedule)
  with the project count still 1 and no proforma without a supplier.
- converting with a supplier creates exactly one proforma linked to
  the SAME project, still with project count 1.
- a second convert attempt fails closed with
  IMPORT_FEASIBILITY_ALREADY_CONVERTED and the project row is unchanged.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';

function feasibility(): Record<string, unknown> {
  return {
    items: [{ name: 'Widget', qty: 10 }],
    totalFactoryCostUsd: 1000,
    exchangeRateCommercial: 50,
    internationalShippingUsd: 5,
    insuranceUsd: 1,
    customsDutyEgp: 40,
    clearanceAndPortFeesEgp: 100,
    vatIsRefundable: true,
    customsVatEgp: 0,
    internalTransportEgp: 50,
  };
}

async function seedProject(db: Kysely<Database>, id: string): Promise<void> {
  await sql`INSERT INTO import_projects (id, tenant_id, project_no, feasibility_data, budget_currency, country_destination, status) VALUES (${id}, 't1', ${`IMP-${id}`}, ${JSON.stringify(feasibility())}::jsonb, 'USD', 'Alexandria', 'feasibility')`.execute(db);
}

async function projectCount(db: Kysely<Database>): Promise<number> {
  const r = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM import_projects`.execute(db);
  return Number(r.rows[0].n);
}

async function proformaCount(db: Kysely<Database>): Promise<number> {
  const r = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM import_proforma_invoices`.execute(db);
  return Number(r.rows[0].n);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const service = new ImportSalesService(db as never, undefined);

  try {
    await pg.exec(`
      CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, feasibility_data jsonb, budget_currency text, country_destination text, status text, feasibility_converted_at timestamptz, cash_flow_schedule text, initial_po_id bigint, updated_at timestamptz);
      CREATE TABLE import_proforma_invoices (id bigserial PRIMARY KEY, tenant_id text, project_id text, supplier_id bigint, pi_number text, pi_date date, currency text, total_amount_foreign numeric, incoterm text, delivery_port text, payment_terms text, exchange_rate_contract numeric, status text, advance_percentage numeric, balance_percentage numeric, items text);
      CREATE TABLE settings (tenant_id text, key text, value text);
    `);

    // 1. Convert transitions THE existing project, creates nothing else.
    await seedProject(db, 'proj-1');
    const converted = await service.convertFeasibilityToProject('t1', 'proj-1', { projectId: 'proj-1' } as never);
    assert.equal(converted.projectId, 'proj-1');
    assert.equal(converted.proformaId, null);
    assert.equal(converted.cashFlowSchedule.length, 5);
    assert.equal(await projectCount(db), 1, 'convert must not create a second project');
    assert.equal(await proformaCount(db), 0, 'no supplier given, so no proforma');
    const after = await sql<{ status: string; feasibility_converted_at: string | null; cash_flow_schedule: string | null }>`SELECT status, feasibility_converted_at, cash_flow_schedule FROM import_projects WHERE id = 'proj-1'`.execute(db);
    assert.equal(after.rows[0].status, 'sourcing');
    assert.notEqual(after.rows[0].feasibility_converted_at, null);
    const schedule = JSON.parse(after.rows[0].cash_flow_schedule as string);
    assert.equal(schedule.length, 5);
    assert.equal(schedule[0].stage, 'T0_Contract_Advance');
    assert.equal(schedule[0].amountEgp, 15000, '30% advance of $1000 at rate 50 is 15000 EGP');
    const scheduleBeforeSecond = after.rows[0].cash_flow_schedule;

    // 2. A second convert on the same project fails closed, row untouched.
    await assert.rejects(
      service.convertFeasibilityToProject('t1', 'proj-1', { projectId: 'proj-1' } as never),
      /IMPORT_FEASIBILITY_ALREADY_CONVERTED/,
      'second convert must fail closed',
    );
    assert.equal(await projectCount(db), 1);
    assert.equal(await proformaCount(db), 0);
    const afterSecond = await sql<{ status: string; cash_flow_schedule: string | null }>`SELECT status, cash_flow_schedule FROM import_projects WHERE id = 'proj-1'`.execute(db);
    assert.equal(afterSecond.rows[0].status, 'sourcing');
    assert.equal(afterSecond.rows[0].cash_flow_schedule, scheduleBeforeSecond);

    // 3. Convert with a supplier links the single proforma to the SAME project.
    await seedProject(db, 'proj-2');
    const withSupplier = await service.convertFeasibilityToProject('t1', 'proj-2', { projectId: 'proj-2', supplierId: '7' } as never);
    assert.equal(withSupplier.projectId, 'proj-2');
    assert.notEqual(withSupplier.proformaId, null);
    assert.equal(await projectCount(db), 2, 'still exactly the two seeded projects');
    assert.equal(await proformaCount(db), 1);
    const pi = await sql<{ project_id: string }>`SELECT project_id FROM import_proforma_invoices WHERE project_id = 'proj-2'`.execute(db);
    assert.equal(pi.rows.length, 1);
    assert.equal(pi.rows[0].project_id, 'proj-2');

    console.log('feasibility approve transition checks passed');
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
