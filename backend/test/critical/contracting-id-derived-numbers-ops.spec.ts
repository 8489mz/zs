/*
 * INV-CONTRACTING-ID-DERIVED-NUMBERS (D6b — operational documents):
 * supplier-return, petty-cash, inspection-request, submittal,
 * material-escalation, backcharge, and allocation-batch numbers are
 * derived from the inserted row's id inside one transaction (the
 * DRG/MOM pattern), never from a COUNT(*) query. Same invariant as
 * D6a (core documents); this package completes it.
 *
 * THE TWO BUGS (same as D6a): concurrent creates raced on the same
 * COUNT (unique-constraint 500s despite check-then-retry loops),
 * and delete-then-create reused dead numbers. An id-derived suffix
 * is unique by construction.
 *
 * WHAT THIS PINS, driving the REAL ContractingService on PGlite:
 * 1. Two sequential creates of each type get distinct numbers whose
 *    suffix is exactly the row id (zero-padded).
 * 2. Delete-then-create never reuses the deleted number (returns).
 * 3. Caller-supplied numbers are kept verbatim (returns, petty
 *    cash, inspection requests); a generated return also derives
 *    its credit-note number from the SAME final number.
 * 4. Both submittal prefixes (DWG-SUB / MAT-SUB) derive from the id.
 * 5. An allocation batch posted over an empty period gets an
 *    id-derived batch number.
 * 6. Global source pin: no COUNT(*) query anywhere in
 *    contracting.service.ts is followed by a LIKE-prefix filter
 *    within 8 lines (the numbering idiom), and no fn.count numbering
 *    remains — the five legitimate counts (pagination, metrics,
 *    delete guards) use no LIKE filter.
 *
 * Deliberately NOT covered here: true concurrent (multi-connection)
 * creates — PGlite is single-connection, so the race is proven by
 * construction (no count is read at all) plus the source pin.
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

function suffixOf(number: string, id: unknown): boolean {
  return number.endsWith(String(id).padStart(4, '0'));
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE contracting_supplier_returns (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, return_number text, supplier_id bigint, supplier_name text, return_date text, total_amount numeric, status text, credit_note_number text, items_json text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_petty_cash (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, custodian_name text, custodian_role text, disbursement_number text, amount_given numeric, amount_settled numeric, remaining_balance numeric, issue_date text, settlement_due_date text, status text, receipts_json text, closure_notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_inspection_requests (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, wir_number text, boq_item_id bigint, subcontract_id bigint, location_grid text, trade_category text, inspection_type text, scheduled_date text, status text, consultant_name text, consultant_notes text, inspected_at timestamptz, attachments text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_boq_items (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, item_code text, description text, category text, unit text, contract_qty numeric, revised_qty numeric, direct_labor_cost numeric, direct_material_cost numeric, direct_equipment_cost numeric, allocated_indirect_cost numeric, total_actual_cost numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_subcontracts (id bigserial PRIMARY KEY, tenant_id text, contract_number text);
      CREATE TABLE contracting_submittals (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, submittal_number text, submittal_type text, title text, specification_section text, supplier_manufacturer text, boq_item_id bigint, subcontract_id bigint, submission_date timestamptz, review_due_date text, status text, consultant_review_date timestamptz, consultant_name text, consultant_comments text, attachments text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_material_escalations (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, claim_number text, material_type text, material_name text, base_price_contract numeric, current_market_price numeric, price_difference numeric, executed_quantity numeric, unit text, total_compensation_amount numeric, bulletin_source_reference text, status text, ipc_invoice_id bigint, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_subcontractor_backcharges (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, voucher_number text, subcontract_id bigint, beneficiary_subcontract_id bigint, backcharge_category text, amount numeric, description text, occurrence_date timestamptz, status text, applied_ipc_invoice_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_cost_pools (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, pool_code text, pool_name text, pool_type text, driver_type text, description text, is_active boolean, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_indirect_expenses (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, batch_id bigint, pool_id bigint, expense_date text, gross_amount numeric, recovered_amount numeric);
      CREATE TABLE contracting_allocation_batches (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, batch_number text, period_start text, period_end text, status text, total_gross_expenses numeric, total_recovered_backcharges numeric, total_net_pool_cost numeric, total_allocated_amount numeric, deferred_in_amount numeric, deferred_out_amount numeric, posted_at timestamptz, posted_by text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE contracting_boq_indirect_allocations (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, batch_id bigint, pool_id bigint, boq_item_id bigint, driver_type text, driver_qty numeric, total_pool_driver_qty numeric, allocation_ratio numeric, pool_net_cost numeric, allocated_amount numeric);
      CREATE TABLE contracting_labor_attendance_records (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, attendance_date text, boq_item_id bigint, status text, total_payable numeric);
      CREATE TABLE contracting_equipment_fuel_logs (id bigserial PRIMARY KEY, tenant_id text, project_id bigint, log_date text, boq_item_id bigint, operating_hours numeric, fuel_cost_total numeric);
      CREATE TABLE settings (tenant_id text, key text, value text, PRIMARY KEY (tenant_id, key));
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    `);
    await pg.exec(`
      INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'currency', 'EGP');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, is_base, exchange_rate) VALUES ('t1', 'EGP', true, 1);
    `);

    const service = new ContractingService(db as never, {} as never);

    // 1. Supplier returns: id-derived, no reuse, credit note follows, supplied kept.
    const rtn1: any = await service.createSupplierReturn(AUTH, '1', { supplierName: 'S1', items: [{ quantity: 2, unitCost: 10 }] } as any);
    const rtn2: any = await service.createSupplierReturn(AUTH, '1', { supplierName: 'S1', items: [{ quantity: 1, unitCost: 5 }] } as any);
    assert.match(rtn1.return_number, /^RTN-\d{6}-\d{4,}$/);
    assert.notEqual(rtn1.return_number, rtn2.return_number);
    assert.ok(suffixOf(rtn1.return_number, rtn1.id));
    assert.equal(rtn1.credit_note_number, `CN-${rtn1.return_number}`);
    await (db as any).deleteFrom('contracting_supplier_returns').where('id', '=', rtn1.id).execute();
    const rtn3: any = await service.createSupplierReturn(AUTH, '1', { supplierName: 'S1', items: [{ quantity: 1, unitCost: 5 }] } as any);
    assert.notEqual(rtn3.return_number, rtn1.return_number, 'a deleted return number must never be reused');
    const rtnSupplied: any = await service.createSupplierReturn(AUTH, '1', { supplierName: 'S1', returnNumber: 'RTN-CUSTOM-7', items: [{ quantity: 1, unitCost: 5 }] } as any);
    assert.equal(rtnSupplied.return_number, 'RTN-CUSTOM-7');
    assert.equal(rtnSupplied.credit_note_number, 'CN-RTN-CUSTOM-7');

    // 2. Petty cash: id-derived, supplied kept.
    const csh1: any = await service.createPettyCash(AUTH, '1', { custodianName: 'Eng A', amountGiven: 500 } as any);
    assert.match(csh1.disbursement_number, /^CSH-\d{6}-\d{4,}$/);
    assert.ok(suffixOf(csh1.disbursement_number, csh1.id));
    const cshSupplied: any = await service.createPettyCash(AUTH, '1', { custodianName: 'Eng B', amountGiven: 100, disbursementNumber: 'CSH-CUSTOM-2' } as any);
    assert.equal(cshSupplied.disbursement_number, 'CSH-CUSTOM-2');

    // 3. Inspection requests: id-derived, supplied kept.
    const wir1: any = await service.createInspectionRequest(AUTH, '1', { locationGrid: 'A1', tradeCategory: 'civil', scheduledDate: '2026-11-01' } as any);
    const wir2: any = await service.createInspectionRequest(AUTH, '1', { locationGrid: 'A2', tradeCategory: 'civil', scheduledDate: '2026-11-01' } as any);
    assert.match(wir1.wirNumber, /^WIR-\d{6}-\d{4,}$/);
    assert.notEqual(wir1.wirNumber, wir2.wirNumber);
    assert.ok(suffixOf(wir1.wirNumber, wir1.id));
    const wirSupplied: any = await service.createInspectionRequest(AUTH, '1', { locationGrid: 'A3', tradeCategory: 'civil', scheduledDate: '2026-11-01', wirNumber: 'wir-custom-5' } as any);
    assert.equal(wirSupplied.wirNumber, 'WIR-CUSTOM-5');

    // 4. Submittals: both prefixes id-derived.
    const sub1: any = await service.createSubmittal(AUTH, '1', { submittalType: 'material', title: 'Cement' } as any);
    const sub2: any = await service.createSubmittal(AUTH, '1', { submittalType: 'shop_drawing', title: 'Plan' } as any);
    assert.match(sub1.submittalNumber, /^MAT-SUB-\d{6}-\d{4,}$/);
    assert.match(sub2.submittalNumber, /^DWG-SUB-\d{6}-\d{4,}$/);
    assert.ok(suffixOf(sub1.submittalNumber, sub1.id));
    assert.ok(suffixOf(sub2.submittalNumber, sub2.id));

    // 5. Material escalations: id-derived.
    const esc1: any = await service.createMaterialEscalation(AUTH, '1', { materialType: 'steel', materialName: 'Rebar', basePriceContract: 100, currentMarketPrice: 120, executedQuantity: 10, unit: 'ton' } as any);
    const esc2: any = await service.createMaterialEscalation(AUTH, '1', { materialType: 'cement', materialName: 'Cement', basePriceContract: 50, currentMarketPrice: 55, executedQuantity: 20, unit: 'bag' } as any);
    assert.match(esc1.claimNumber, /^ESC-\d{6}-\d{4,}$/);
    assert.notEqual(esc1.claimNumber, esc2.claimNumber);
    assert.ok(suffixOf(esc1.claimNumber, esc1.id));

    // 6. Backcharges: id-derived.
    const bch1: any = await service.createSubcontractorBackcharge(AUTH, '1', { subcontractId: 1, backchargeCategory: 'damage', amount: 100, description: 'D1' } as any);
    const bch2: any = await service.createSubcontractorBackcharge(AUTH, '1', { subcontractId: 1, backchargeCategory: 'delay', amount: 50, description: 'D2' } as any);
    assert.match(bch1.voucherNumber, /^BCH-\d{6}-\d{4,}$/);
    assert.notEqual(bch1.voucherNumber, bch2.voucherNumber);
    assert.ok(suffixOf(bch1.voucherNumber, bch1.id));

    // 7. Allocation batches: id-derived over an empty period.
    const alloc1: any = await service.postBatchAllocation(AUTH, '1', { periodStart: '2026-10-01', periodEnd: '2026-10-31' } as any);
    const alloc2: any = await service.postBatchAllocation(AUTH, '1', { periodStart: '2026-10-01', periodEnd: '2026-10-31' } as any);
    assert.match(alloc1.batch.batchNumber, /^ALLOC-\d{6}-\d{4,}$/);
    assert.notEqual(alloc1.batch.batchNumber, alloc2.batch.batchNumber);
    assert.ok(suffixOf(alloc1.batch.batchNumber, alloc1.batch.id));

    // 8. Global source pin: no COUNT(*) numbering idiom remains in the file.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/contracting/contracting.service.ts'),
      'utf8',
    );
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('count(*)::int')) {
        const window = lines.slice(i, i + 9).join('\n');
        assert.ok(!window.includes("'like'"), `COUNT(*) query at line ${i + 1} must not count by LIKE prefix`);
      }
    }
    assert.ok(!source.includes('fn.count'), 'no fn.count numbering may remain');
    const bodies: Array<[string, string, string]> = [
      ['createSupplierReturn', 'async createSupplierReturn(', 'async getLaborAttendance('],
      ['createPettyCash', 'async createPettyCash(', 'async settlePettyCash('],
      ['createInspectionRequest', 'async createInspectionRequest(', 'async updateInspectionRequestStatus('],
      ['createSubmittal', 'async createSubmittal(', 'async updateSubmittalStatus('],
      ['createMaterialEscalation', 'async createMaterialEscalation(', 'async updateMaterialEscalationStatus('],
      ['createSubcontractorBackcharge', 'async createSubcontractorBackcharge(', 'async updateBackchargeStatus('],
      ['postBatchAllocation', 'async postBatchAllocation(', 'async createDocument('],
    ];
    for (const [name, startMarker, endMarker] of bodies) {
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker);
      assert.ok(start > -1 && end > start, `${name} body must be locatable`);
      const body = source.slice(start, end);
      assert.ok(!body.includes('count(*)::int') && !body.includes('fn.count'), `${name} must not count rows for its number`);
    }

    console.log('contracting id-derived numbers (ops) checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
