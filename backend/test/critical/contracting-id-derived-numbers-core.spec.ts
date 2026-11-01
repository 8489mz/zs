/*
 * INV-CONTRACTING-ID-DERIVED-NUMBERS (D6a — core documents): project
 * codes and change-order / subcontract / RFI / material-requisition
 * numbers are derived from the inserted row's id inside one
 * transaction (the DRG/MOM pattern already established in this
 * file), never from a COUNT(*) query.
 *
 * THE TWO BUGS IN THE OLD CODE:
 * 1. Race: two concurrent creates read the same COUNT, compute the
 *    same candidate, and the second insert fails on the UNIQUE
 *    (tenant_id, number) constraint — a user-facing 500. The
 *    check-then-retry loops (PRJ, SC, MR) could not help: both
 *    transactions pass the check before either inserts.
 * 2. Reuse after delete: COUNT(*) drops when a row is deleted, so a
 *    later document reuses a dead document's number.
 * An id-derived suffix is unique by construction (ids never repeat
 * and never go backwards) and needs no lock, no retry, and no
 * sequence table — the D6 decision the user approved.
 *
 * WHAT THIS PINS, driving the REAL ContractingService on PGlite:
 * 1. Two sequential creates of each document type get distinct
 *    numbers whose suffix is exactly the row id (zero-padded).
 * 2. Delete-then-create never reuses the deleted number.
 * 3. A caller-supplied number is kept verbatim (no generation).
 * 4. A generated project code creates its cost center against the
 *    FINAL code (CC-<code>), not a temp code.
 * 5. Source pin: the five converted function bodies contain no
 *    COUNT(*) numbering query and no LIKE-prefix count.
 *
 * Deliberately NOT covered here: the seven operational documents
 * (RTN/CSH/WIR/submittals/ESC/BCH/ALLOC) — converted by D6b, the
 * sibling package; true concurrent (multi-connection) creates —
 * PGlite is single-connection, so the race is proven by
 * construction (no count is read at all) plus the source pin.
 * enrichProjectMetrics is stubbed on the instance: it aggregates
 * invoices/change orders and is proven by its own specs.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ContractingService } from '../../src/modules/contracting/contracting.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = {
  userId: 1,
  sessionId: 'sess-spec',
  username: 'actor-1',
  role: 'admin',
  permissions: [],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;

const NUMBER_PATTERN = /^(PRJ|CO|SC|RFI|MR)-\d{6}-\d{4,}$/;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE contracting_projects (id bigserial PRIMARY KEY, tenant_id text, code text NOT NULL, name text, client_id bigint, client_name text, status text, contract_value numeric, revised_contract_value numeric, down_payment_amount numeric, down_payment_recovered numeric, retention_percent numeric, retention_total_held numeric, retention_released numeric, start_date text, expected_end_date text, actual_end_date text, site_location_id bigint, cost_center_id bigint, project_manager text, location_address text, consultant_name text, contract_ref text, contract_date text, loss_reason text, loss_notes text, competitor_price numeric, revision_number int, original_tender_id bigint, submitted_at timestamptz, awarded_at timestamptz, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_projects_tenant_code UNIQUE (tenant_id, code));
      CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, budget_amount numeric, is_active boolean);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE contracting_change_orders (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, change_order_number text, title text, reason text, impact_type text, cost_impact numeric, time_impact_days numeric, status text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_subcontracts (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, subcontractor_id bigint, contract_number text, contract_type text, scope_of_work text, total_amount numeric, retention_percent numeric, advance_pct numeric, advance_amount numeric, advance_recovery_start_pct numeric, advance_recovery_end_pct numeric, retention_limit_pct numeric, penalty_per_day numeric, ld_cap_pct numeric, liability_cap_amount numeric, wht_rate numeric, social_insurance_pct numeric, payment_linkage_mode text, payment_terms_days int, tail_reserve_pct numeric, wastage_allowance_pct numeric, mos_admissible_pct numeric, mos_cap_pct numeric, dlp_months int, start_date text, end_date text, status text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_subcontracts_tenant_code UNIQUE (tenant_id, contract_number));
      CREATE TABLE contracting_rfis (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, rfi_number text, subject text, question text, assigned_to text, status text, date_requested text, date_required text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_material_requisitions (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, requisition_number text, boq_item_id bigint, warehouse_id bigint, product_id bigint, item_name text, unit text, quantity numeric, unit_cost numeric, total_cost numeric, issue_date text, recipient_name text, status text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    `);

    const service = new ContractingService(db as never, {} as never);
    (service as any).enrichProjectMetrics = async (_tenantId: string, row: any) => row;

    // 1. Projects: id-derived codes, no reuse, cost center on the final code.
    const p1: any = await service.createProject(AUTH, { name: 'Tower A' } as any);
    const p2: any = await service.createProject(AUTH, { name: 'Tower B' } as any);
    assert.match(p1.code, NUMBER_PATTERN);
    assert.match(p2.code, NUMBER_PATTERN);
    assert.notEqual(p1.code, p2.code);
    assert.ok(p1.code.endsWith(String(p1.id).padStart(4, '0')), 'suffix must be the row id');
    assert.ok(p2.code.endsWith(String(p2.id).padStart(4, '0')), 'suffix must be the row id');
    const ccRows = await db.selectFrom('cost_centers' as never).selectAll().execute();
    assert.equal(ccRows.length, 2);
    assert.ok((ccRows as any[]).some((row) => row.code === `CC-${p1.code}`), 'cost center must use the final code');
    await db.deleteFrom('contracting_projects').where('id', '=', p1.id).execute();
    const p3: any = await service.createProject(AUTH, { name: 'Tower C' } as any);
    assert.notEqual(p3.code, p1.code, 'a deleted project code must never be reused');

    // 2. Supplied codes and numbers are kept verbatim.
    const pSupplied: any = await service.createProject(AUTH, { name: 'Supplied', code: 'PRJ-CUSTOM-1' } as any);
    assert.equal(pSupplied.code, 'PRJ-CUSTOM-1');
    const scSupplied: any = await service.createSubcontract(AUTH, '1', { subcontractorId: 1, scopeOfWork: 'Steel', contractNumber: 'SC-CUSTOM-9' } as any);
    assert.equal(scSupplied.contract_number, 'SC-CUSTOM-9');

    // 3. Change orders: distinct, id-derived.
    const co1: any = await service.createChangeOrder(AUTH, '1', { title: 'Extra floor' } as any);
    const co2: any = await service.createChangeOrder(AUTH, '1', { title: 'Extra lift' } as any);
    assert.match(co1.change_order_number, NUMBER_PATTERN);
    assert.notEqual(co1.change_order_number, co2.change_order_number);
    assert.ok(co1.change_order_number.endsWith(String(co1.id).padStart(4, '0')));

    // 4. Subcontracts: distinct, id-derived, no reuse after delete.
    const sc1: any = await service.createSubcontract(AUTH, '1', { subcontractorId: 1, scopeOfWork: 'Concrete' } as any);
    const sc2: any = await service.createSubcontract(AUTH, '1', { subcontractorId: 1, scopeOfWork: 'MEP' } as any);
    assert.match(sc1.contract_number, NUMBER_PATTERN);
    assert.notEqual(sc1.contract_number, sc2.contract_number);
    assert.ok(sc1.contract_number.endsWith(String(sc1.id).padStart(4, '0')));
    await db.deleteFrom('contracting_subcontracts').where('id', '=', sc1.id).execute();
    const sc3: any = await service.createSubcontract(AUTH, '1', { subcontractorId: 1, scopeOfWork: 'Finishing' } as any);
    assert.notEqual(sc3.contract_number, sc1.contract_number, 'a deleted subcontract number must never be reused');

    // 5. RFIs: distinct, id-derived.
    const rfi1: any = await service.createRfi(AUTH, '1', { subject: 'S1', question: 'Q1' } as any);
    const rfi2: any = await service.createRfi(AUTH, '1', { subject: 'S2', question: 'Q2' } as any);
    assert.match(rfi1.rfi_number, NUMBER_PATTERN);
    assert.notEqual(rfi1.rfi_number, rfi2.rfi_number);
    assert.ok(rfi1.rfi_number.endsWith(String(rfi1.id).padStart(4, '0')));

    // 6. Material requisitions: distinct, id-derived, supplied kept.
    const mr1: any = await service.createMaterialRequisition(AUTH, '1', { itemName: 'Cement', quantity: 10, unitCost: 5 } as any);
    const mr2: any = await service.createMaterialRequisition(AUTH, '1', { itemName: 'Sand', quantity: 4, unitCost: 2 } as any);
    assert.match(mr1.requisition_number, NUMBER_PATTERN);
    assert.notEqual(mr1.requisition_number, mr2.requisition_number);
    assert.ok(mr1.requisition_number.endsWith(String(mr1.id).padStart(4, '0')));
    const mrSupplied: any = await service.createMaterialRequisition(AUTH, '1', { itemName: 'Steel', requisitionNumber: 'MR-CUSTOM-3' } as any);
    assert.equal(mrSupplied.requisition_number, 'MR-CUSTOM-3');

    // 7. Source pin: the five converted bodies contain no COUNT(*) numbering.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/contracting/contracting.service.ts'),
      'utf8',
    );
    const bodies: Array<[string, string, string]> = [
      ['createProject', 'async createProject(', 'async updateProject('],
      ['createChangeOrder', 'async createChangeOrder(', 'async updateChangeOrderStatus('],
      ['createSubcontract', 'async createSubcontract(', 'async getSubcontractById('],
      ['createRfi', 'async createRfi(', 'async answerRfi('],
      ['createMaterialRequisition', 'async createMaterialRequisition(', 'async deleteMaterialRequisition('],
    ];
    for (const [name, startMarker, endMarker] of bodies) {
      const body = source.slice(source.indexOf(startMarker), source.indexOf(endMarker));
      assert.ok(body.length > 0, `${name} body must be locatable`);
      assert.ok(!body.includes('count(*)::int'), `${name} must not count rows for its number`);
      assert.ok(!body.includes("'like'"), `${name} must not count by LIKE prefix`);
    }

    console.log('contracting id-derived numbers (core) checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
