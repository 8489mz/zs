/*
New file: backend/test/critical/import-feasibility-fx-persist.spec.ts
Pins the I8-B rule (INV-IMPORT-FEASIBILITY-FX-PERSIST): the commercial
FX rate the merchant enters on the feasibility study must survive the
recalculate -> persist -> approve round-trip, so approval succeeds and
transitions the SAME project.

THE GAP (live re-test 2026-11-09, R2): approving the study opened from
IMP-261108-0001 AND from IMP-261109-0001 both failed with
IMPORT_EXCHANGE_RATE_REQUIRED, even after re-entering commercial FX 50
and recalculating; project count stayed 3, nothing was updated. The
write path dropped the rate at the engine boundary:
- the form sends exchangeRateCommercial to calculate-feasibility and
  the engine PRICES with it, but the engine result
  (FeasibilityCalculationResult) never echoed it back;
- the approval handler persists that engine result as the project's
  stored feasibility_data, so the stored study has no
  exchangeRateCommercial;
- convertFeasibilityToProject reads Number(feas.exchangeRateCommercial)
  from the STORED study -> NaN -> IMPORT_EXCHANGE_RATE_REQUIRED.
Re-entering FX and recalculating repeated the same lossy round-trip,
so the failure was unrecoverable from the UI. The same drop also
starved the shipment-import path, which reads feas.exchangeRateCommercial
from the stored study as its fallback rate.

THE RULE: the engine result echoes the rates it was priced at
(exchangeRateCommercial, exchangeRateCustoms), so the stored study
carries them; a legacy project whose stored study lacks FX converts
fine once the merchant re-enters FX, recalculates and persists. The
fail-closed gate itself is unchanged: a study with no rate still
fails with IMPORT_EXCHANGE_RATE_REQUIRED before any write.

WHAT THIS PINS, driving the REAL engine + the REAL service methods
(calculateFeasibility, updateProject, convertFeasibilityToProject)
on PGlite:
- calculateImportFeasibility at FX 50 (customs 48.5) returns
  exchangeRateCommercial 50 / exchangeRateCustoms 48.5, and the
  money figures are priced at that rate (10 x $100 -> 50000 EGP).
- a legacy USD project whose stored study has NO commercial rate
  still fails closed on convert with IMPORT_EXCHANGE_RATE_REQUIRED,
  project untouched, count still 1.
- re-enter FX 50 + recalculate (real service calculateFeasibility)
  + persist (real service updateProject) stores exchangeRateCommercial
  50 on the project; convert then SUCCEEDS, transitions the SAME
  project (status sourcing, converted_at set, 30% advance $300 at
  rate 50 -> 15000 EGP) with the project count still 1.
- converting the same project a second time fails closed with
  IMPORT_FEASIBILITY_ALREADY_CONVERTED.
- the same legacy flow with a supplier mints exactly one proforma
  on the SAME project with exchange_rate_contract 50, still no
  second project.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { calculateImportFeasibility } from '../../src/modules/import-sales/engines/import-feasibility.engine';

/** A legacy trial study: priced items, but NO exchangeRateCommercial. */
function legacyFeasibility(): Record<string, unknown> {
  return {
    items: [{ name: 'Widget', qty: 10, factoryPriceUsd: 100 }],
    totalFactoryCostUsd: 1000,
    internationalShippingUsd: 5,
    insuranceUsd: 1,
    customsDutyEgp: 40,
    clearanceAndPortFeesEgp: 100,
    vatIsRefundable: true,
    customsVatEgp: 0,
    internalTransportEgp: 50,
  };
}

async function seedLegacyProject(db: Kysely<Database>, id: string): Promise<void> {
  await sql`INSERT INTO import_projects (id, tenant_id, project_no, feasibility_data, budget_currency, country_destination, status) VALUES (${id}, 't1', ${`IMP-${id}`}, ${JSON.stringify(legacyFeasibility())}::jsonb, 'USD', 'Alexandria', 'feasibility')`.execute(db);
}

async function projectCount(db: Kysely<Database>): Promise<number> {
  const r = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM import_projects`.execute(db);
  return Number(r.rows[0].n);
}

async function storedFeasibility(db: Kysely<Database>, id: string): Promise<Record<string, any>> {
  const r = await sql<{ feasibility_data: any }>`SELECT feasibility_data FROM import_projects WHERE id = ${id}`.execute(db);
  const raw = r.rows[0].feasibility_data;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
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

    // 1. The engine echoes the rates it priced at.
    const engineResult = calculateImportFeasibility({
      items: [{ name: 'Widget', qty: 10, factoryPriceUsd: 100 }],
      exchangeRateCommercial: 50,
      exchangeRateCustoms: 48.5,
    });
    assert.equal(engineResult.exchangeRateCommercial, 50, 'engine result must carry the commercial rate it priced at');
    assert.equal(engineResult.exchangeRateCustoms, 48.5, 'engine result must carry the customs rate it priced at');
    assert.equal(engineResult.totalFactoryCostEgp, 50000, '10 x $100 at rate 50 is 50000 EGP');

    // 2. Legacy study without FX still fails closed; the gate is intact.
    await seedLegacyProject(db, 'legacy-1');
    await assert.rejects(
      service.convertFeasibilityToProject('t1', 'legacy-1', { projectId: 'legacy-1' } as never),
      /IMPORT_EXCHANGE_RATE_REQUIRED/,
      'a stored study with no commercial rate must still fail closed',
    );
    assert.equal(await projectCount(db), 1);
    const untouched = await sql<{ status: string; feasibility_converted_at: string | null }>`SELECT status, feasibility_converted_at FROM import_projects WHERE id = 'legacy-1'`.execute(db);
    assert.equal(untouched.rows[0].status, 'feasibility');
    assert.equal(untouched.rows[0].feasibility_converted_at, null);

    // 3. Re-enter FX 50 + recalculate (real service) + persist (real
    // service): the stored study now carries the rate.
    const recalculated = service.calculateFeasibility({
      items: [{ name: 'Widget', qty: 10, factoryPriceUsd: 100 }],
      exchangeRateCommercial: 50,
    } as never);
    assert.equal(recalculated.exchangeRateCommercial, 50);
    await service.updateProject('t1', 'legacy-1', { feasibilityData: recalculated } as never);
    const stored = await storedFeasibility(db, 'legacy-1');
    assert.equal(stored.exchangeRateCommercial, 50, 're-enter + recalc must persist the rate on the stored study');
    assert.equal(stored.totalFactoryCostEgp, 50000, 'persisted figures stay priced at the entered rate');

    // 4. Approval now succeeds and transitions the SAME project.
    const converted = await service.convertFeasibilityToProject('t1', 'legacy-1', { projectId: 'legacy-1' } as never);
    assert.equal(converted.projectId, 'legacy-1');
    assert.equal(converted.proformaId, null);
    assert.equal(converted.cashFlowSchedule[0].amountEgp, 15000, '30% advance of $1000 at rate 50 is 15000 EGP');
    assert.equal(await projectCount(db), 1, 'approval must not create a second project');
    const after = await sql<{ status: string; feasibility_converted_at: string | null; cash_flow_schedule: string | null }>`SELECT status, feasibility_converted_at, cash_flow_schedule FROM import_projects WHERE id = 'legacy-1'`.execute(db);
    assert.equal(after.rows[0].status, 'sourcing');
    assert.notEqual(after.rows[0].feasibility_converted_at, null);
    assert.equal(JSON.parse(after.rows[0].cash_flow_schedule as string).length, 5);

    // 5. A second approval fails closed; the project row is untouched.
    await assert.rejects(
      service.convertFeasibilityToProject('t1', 'legacy-1', { projectId: 'legacy-1' } as never),
      /IMPORT_FEASIBILITY_ALREADY_CONVERTED/,
      'second convert must fail closed',
    );
    assert.equal(await projectCount(db), 1);

    // 6. Same legacy flow with a supplier: exactly one proforma on the
    // SAME project, contract rate 50, still no second project.
    await seedLegacyProject(db, 'legacy-2');
    const recalculated2 = service.calculateFeasibility({
      items: [{ name: 'Widget', qty: 10, factoryPriceUsd: 100 }],
      exchangeRateCommercial: 50,
    } as never);
    await service.updateProject('t1', 'legacy-2', { feasibilityData: recalculated2 } as never);
    const withSupplier = await service.convertFeasibilityToProject('t1', 'legacy-2', { projectId: 'legacy-2', supplierId: '7' } as never);
    assert.equal(withSupplier.projectId, 'legacy-2');
    assert.notEqual(withSupplier.proformaId, null);
    assert.equal(await projectCount(db), 2, 'still exactly the two seeded projects');
    const pi = await sql<{ exchange_rate_contract: string; project_id: string }>`SELECT exchange_rate_contract, project_id FROM import_proforma_invoices WHERE project_id = 'legacy-2'`.execute(db);
    assert.equal(pi.rows.length, 1);
    assert.equal(pi.rows[0].project_id, 'legacy-2');
    assert.equal(Number(pi.rows[0].exchange_rate_contract), 50);

    console.log('feasibility FX persist checks passed');
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
