/*
New file: backend/test/critical/feasibility-contract-rate-required.spec.ts
Pins the feasibility-to-project contract-rate gate
(INV-FEASIBILITY-CONTRACT-RATE-REQUIRED).

THE GAP: convertFeasibilityToProject fell back to an invented 50
when the feasibility study carried no commercial exchange rate,
then stored that 50 as the proforma's exchange_rate_contract and
priced the whole cash-flow schedule at it -- so the invented rate
became the authoritative contract rate that the proforma-to-PO
conversion (guarded by INV-IMPORT-PROFORMA-EXCHANGE-RATE) then
treated as chosen. The merchant never set it anywhere.

THE RULE: a non-EGP project whose feasibility study has no
positive, finite commercial rate fails closed with
IMPORT_EXCHANGE_RATE_REQUIRED before any write. An explicit rate
converts exactly; an EGP-budget project converts at rate 1
without needing a rate, mirroring the proforma gate.

WHAT THIS PINS, driving the REAL convertFeasibilityToProject on
PGlite:
- a USD project with a null, zero, or negative commercial rate
  is rejected with IMPORT_EXCHANGE_RATE_REQUIRED, with zero
  proforma rows and the project untouched.
- a USD project with an explicit 48.5 converts exactly
  (300 USD advance -> 14550 EGP) and stores 48.5 as the
  contract rate.
- an EGP-budget project with no rate converts at rate 1.
- without a supplier, no proforma is created but the project
  still converts with the explicit rate.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';

function feasibility(rate: unknown): Record<string, unknown> {
  return {
    items: [{ name: 'Widget', qty: 10 }],
    totalFactoryCostUsd: 1000,
    exchangeRateCommercial: rate,
    internationalShippingUsd: 0,
    insuranceUsd: 0,
    customsDutyEgp: 0,
    clearanceAndPortFeesEgp: 0,
    vatIsRefundable: true,
    customsVatEgp: 0,
    internalTransportEgp: 0,
  };
}

async function seedProject(db: Kysely<Database>, id: string, budgetCurrency: string, rate: unknown): Promise<void> {
  await sql`INSERT INTO import_projects (id, tenant_id, project_no, feasibility_data, budget_currency, country_destination, status) VALUES (${id}, 't1', ${`PRJ-${id}`}, ${JSON.stringify(feasibility(rate))}::jsonb, ${budgetCurrency}, 'Alexandria', 'draft')`.execute(db);
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

    for (const bad of [null, 0, -5]) {
      const id = `bad-${String(bad)}`;
      await seedProject(db, id, 'USD', bad);
      await assert.rejects(
        service.convertFeasibilityToProject('t1', id, { projectId: id, supplierId: '7' } as never),
        /IMPORT_EXCHANGE_RATE_REQUIRED/,
        `rate ${String(bad)} must fail closed`,
      );
      const proformas = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM import_proforma_invoices`.execute(db);
      assert.equal(Number(proformas.rows[0].n), 0);
      const project = await sql<{ status: string; feasibility_converted_at: string | null }>`SELECT status, feasibility_converted_at FROM import_projects WHERE id = ${id}`.execute(db);
      assert.equal(project.rows[0].status, 'draft');
      assert.equal(project.rows[0].feasibility_converted_at, null);
    }

    await seedProject(db, 'good', 'USD', 48.5);
    const converted = await service.convertFeasibilityToProject('t1', 'good', { projectId: 'good', supplierId: '7' } as never);
    assert.equal(converted.cashFlowSchedule[0].amountEgp, 14550);
    const pi = await sql<{ exchange_rate_contract: string }>`SELECT exchange_rate_contract FROM import_proforma_invoices WHERE project_id = 'good'`.execute(db);
    assert.equal(Number(pi.rows[0].exchange_rate_contract), 48.5);

    await seedProject(db, 'egp', 'EGP', null);
    const egpConverted = await service.convertFeasibilityToProject('t1', 'egp', { projectId: 'egp', supplierId: '7' } as never);
    assert.equal(egpConverted.cashFlowSchedule[0].amountEgp, 300);
    const egpPi = await sql<{ exchange_rate_contract: string }>`SELECT exchange_rate_contract FROM import_proforma_invoices WHERE project_id = 'egp'`.execute(db);
    assert.equal(Number(egpPi.rows[0].exchange_rate_contract), 1);

    await seedProject(db, 'nosupplier', 'USD', 48.5);
    const noSupplier = await service.convertFeasibilityToProject('t1', 'nosupplier', { projectId: 'nosupplier' } as never);
    assert.equal(noSupplier.proformaId, null);
    assert.equal(noSupplier.cashFlowSchedule[0].amountEgp, 14550);

    console.log('feasibility contract rate required checks passed');
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
