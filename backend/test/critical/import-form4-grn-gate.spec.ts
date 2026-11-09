/*
New file: backend/test/critical/import-form4-grn-gate.spec.ts
Pins the Form 4 gate on the GRN (receiving) approval path
(INV-IMPORT-FORM4-GRN-GATE).

WHAT WAS WRONG (live re-test 2026-11-09 item 3(b), deployed
4d811676): the GRN dialog (inspector "اختبار", warehouse رصيد
الفرع الرئيسي, qty 2001) on MSCU-TEST-F4 (bank-transfer,
$2,001, no Form 4) returned a SUCCESS toast "تم اعتماد محضر
الفحص والاستلام بنجاح" with NO Form 4 error — but it posted
nothing: no new JE, stock unchanged, status stayed Pending.

ROOT CAUSE (grounded): the dialog POSTs to
/api/import-sales/qc-inspections → createQcInspection, which
only inserts an import_qc_inspections row (stage 'receiving').
The Form 4 gate (assertForm4ClearanceGate, the same engine and
the same IMPORT_FORM4_REQUIRED error that blocks clearance in
re-test 3(a)) is evaluated ONLY inside updateShipmentCosts, on
a status transition into 'In Customs' / 'Arrived'. The GRN
path never calls it — so a receiving approval for a gated
shipment recorded as if the receipt had been approved, while
the receipt itself could never post. The success toast follows
the POST's onSuccess; the backend never rejected anything.

WHAT THIS PINS, driving the real createQcInspection /
updateQcInspection on PGlite:
- The MSCU-TEST-F4 probe, exact shape: 2,001 x $1.00 =
  $2,001 (one dollar above the threshold), bank-transfer
  (legacy NULL funding_type, read as the bank default), Form 4
  blank, no funding rows → the GRN attempt is rejected with
  IMPORT_FORM4_REQUIRED naming the container, the USD value
  and the threshold; ZERO QC rows, status stays Pending, zero
  inventory receipt rows.
- The same four paths as the clearance gate, at the GRN:
  bank > $2k WITH a shipment Form 4 → records; bank > $2k
  with a Form 4 on the funding transfer → records;
  cash_carried > $2k, no Form 4 → records; bank at exactly
  $2,000, no Form 4 → records.
- The gate is scoped to the GRN stage: a pre-shipment QC check
  on a gated shipment still records (China QC is not a receipt
  approval).
- The PATCH bypass is closed too: flipping an existing
  pre-shipment QC to stage 'receiving' on a gated shipment is
  rejected with IMPORT_FORM4_REQUIRED and the row stays
  pre-shipment; the same flip on a Form 4-satisfied shipment
  succeeds.
- Ordering: the posted-receipt guard still wins over the gate
  — a gated shipment whose receipt is already posted is refused
  with IMPORT_GRN_RECEIPT_ALREADY_POSTED, not the Form 4 error.

NOT PROVEN HERE (honest limit): the toast itself is frontend.
What the backend proves is the rejection: with the POST
returning 400 IMPORT_FORM4_REQUIRED, the dialog's onSuccess
never fires, and its already-wired onError path
(toast.error(receivingInspectionErrorMessage(err)), pinned by
frontend/src/features/import-sales/api/receiving-inspection-contract.spec.tsx,
which passes backend named errors through) shows the named
error instead of the success toast. No frontend change was
needed.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE import_qc_inspections (id text PRIMARY KEY DEFAULT ('qc-' || md5(random()::text)), tenant_id text, project_id text, shipment_id text, stage text, inspection_date date, inspector_name text, sample_size int, passed_quantity int, failed_quantity int, defect_notes text, status text, report_file_url text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id text PRIMARY KEY, tenant_id text, shipment_id text, state text, posted_at timestamptz, review_reason text, journal_entry_id bigint);
    CREATE TABLE import_shipments (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, customs_duty_rate_percent numeric, vat_rate_percent numeric, insurance_cost_usd numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, funding_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, pi_number text, supplier_id bigint, project_id text, currency text, total_amount_foreign numeric, paid_amount_foreign numeric, exchange_rate_contract numeric, payment_status text);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, amount numeric, amount_foreign numeric, note text, created_by bigint, payment_date text, currency text, exchange_rate numeric, forex_variance_egp numeric, proforma_invoice_id text, idempotency_key text, doc_no text, created_at timestamptz DEFAULT NOW(), payment_method text, payment_reference text, bank_swift_code text, form4_number text, form4_date date, evidence_carrier_name text, evidence_travel_date date, evidence_handover_receipt text, evidence_lc_number text, evidence_lc_issuing_bank text, evidence_lc_expiry date, evidence_lc_documents text, evidence_cad_proof text, evidence_payment_terms text, evidence_payment_due_date date);
    INSERT INTO import_proforma_invoices VALUES ('pi-a', 't1', 'PI-A', 1, 'proj-1', 'USD', 5000, 0, 50, 'open');
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function seedShipment(
  db: Kysely<Database>,
  id: string,
  quantity: number,
  unitPrice: number,
  opts: { fundingType?: string | null; form4Number?: string | null; containerNumber?: string } = {},
): Promise<void> {
  // fundingType undefined omits the column (NULL in the harness:
  // the legacy row that predates the column, read as the
  // bank_transfer default). An explicit value seeds the declared
  // funding type.
  await db.insertInto('import_shipments' as never).values({
    id, tenant_id: 't1', container_number: opts.containerNumber || 'C-1', supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: 'proj-1',
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
    ...(opts.fundingType !== undefined ? { funding_type: opts.fundingType } : {}),
    ...(opts.form4Number !== undefined ? { form4_number: opts.form4Number } : {}),
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: `${id}-item`, tenant_id: 't1', shipment_id: id, product_id: 1,
    quantity, factory_unit_price_usd: unitPrice,
  } as never).execute();
}

async function seedFunding(
  db: Kysely<Database>,
  method: string,
  form4Number: string | null,
): Promise<void> {
  await db.insertInto('supplier_payments' as never).values({
    tenant_id: 't1', account_id: 't1', supplier_id: 1, amount: 50000, amount_foreign: 1000,
    note: 'funding', currency: 'USD', exchange_rate: 50, proforma_invoice_id: 'pi-a',
    payment_method: method, form4_number: form4Number,
  } as never).execute();
}

function grnDto(shipmentId: string, stage = 'receiving'): any {
  return {
    shipmentId,
    projectId: 'proj-1',
    stage,
    inspectionDate: '2026-11-09',
    inspectorName: 'Storekeeper',
    sampleSize: 10,
    passedQuantity: 10,
    failedQuantity: 0,
    status: 'passed',
  };
}

async function countRows(db: Kysely<Database>, table: string, where?: (eb: any) => any): Promise<number> {
  let query: any = (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c'));
  if (where) query = query.where(where);
  const row: any = await query.executeTakeFirstOrThrow();
  return Number(row.c);
}

async function shipmentStatus(db: Kysely<Database>, id: string): Promise<string> {
  const row: any = await (db as any).selectFrom('import_shipments').select('status').where('id', '=', id).executeTakeFirstOrThrow();
  return row.status;
}

async function main(): Promise<void> {
  // Case 1: the LIVE probe, exact shape (re-test 3(b), deployed
  // 4d811676): MSCU-TEST-F4, 2,001 x $1.00 = $2,001 — one dollar
  // above the threshold — bank-transfer (legacy NULL funding
  // type), Form 4 blank, no funding rows. Live the GRN dialog
  // toasted success and recorded the approval while posting
  // nothing. Here the attempt must be rejected with the named
  // error, zero QC rows, status Pending, zero receipt rows.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-f4-probe', 2001, 1, { containerNumber: 'MSCU-TEST-F4' });
      let thrown: any = null;
      try {
        await service.createQcInspection('t1', grnDto('sh-f4-probe'));
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown, 'The GRN attempt on a gated shipment must throw');
      assert.match(String(thrown?.message || thrown), /IMPORT_FORM4_REQUIRED/);
      assert.match(String(thrown?.message || thrown), /MSCU-TEST-F4/, 'The error names the container');
      assert.match(String(thrown?.message || thrown), /2001\.00/, 'The error names the USD value');
      assert.match(String(thrown?.message || thrown), /2000/, 'The error names the threshold');
      assert.equal(await countRows(db, 'import_qc_inspections'), 0, 'The refused GRN must not insert a QC row');
      assert.equal(await shipmentStatus(db, 'sh-f4-probe'), 'Pending', 'The blocked GRN leaves the status unchanged');
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'The blocked GRN posts no inventory receipt');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: bank > $2k WITH a Form 4 on the shipment records once.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50, { form4Number: 'F4-100' });
      const row = await service.createQcInspection('t1', grnDto('sh-1'));
      assert.equal(row.stage, 'receiving', 'A Form 4-satisfied GRN must record');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Exactly one GRN row must exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: bank > $2k with a Form 4 on the funding transfer records once.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      await seedFunding(db, 'bank_transfer', 'F4-200');
      const row = await service.createQcInspection('t1', grnDto('sh-1'));
      assert.equal(row.stage, 'receiving', 'A transfer Form 4 satisfies the GRN gate');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Exactly one GRN row must exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: cash-carried > $2k, no Form 4, records once (exempt).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50, { fundingType: 'cash_carried' });
      await seedFunding(db, 'cash_carried', null);
      const row = await service.createQcInspection('t1', grnDto('sh-1'));
      assert.equal(row.stage, 'receiving', 'Cash-carried money has no bank-issued Form 4 to require');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Exactly one GRN row must exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: bank at exactly $2,000, no Form 4, records once (strictly above only).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 40, 50);
      const row = await service.createQcInspection('t1', grnDto('sh-1'));
      assert.equal(row.stage, 'receiving', 'Exactly at the threshold the gate does not apply');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Exactly one GRN row must exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: the gate is scoped to the GRN stage — a pre-shipment
  // QC check on the gated probe shipment still records.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-f4-probe', 2001, 1, { containerNumber: 'MSCU-TEST-F4' });
      const row = await service.createQcInspection('t1', grnDto('sh-f4-probe', 'pre_shipment'));
      assert.equal(row.stage, 'pre_shipment', 'A non-GRN QC stage must not be blocked by the Form 4 gate');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Exactly one QC row must exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 7: the PATCH bypass is closed — flipping an existing
  // pre-shipment QC to 'receiving' on a gated shipment is
  // rejected with the named error and the row stays pre-shipment.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-f4-probe', 2001, 1, { containerNumber: 'MSCU-TEST-F4' });
      const created = await service.createQcInspection('t1', grnDto('sh-f4-probe', 'pre_shipment'));
      await assert.rejects(
        async () => service.updateQcInspection('t1', created.id, { stage: 'receiving' }),
        /IMPORT_FORM4_REQUIRED/,
        'Flipping a QC row to the GRN stage must not bypass the Form 4 gate',
      );
      const after: any = await (db as any).selectFrom('import_qc_inspections').select('stage').where('id', '=', created.id).executeTakeFirstOrThrow();
      assert.equal(after.stage, 'pre_shipment', 'The refused flip must not change the stored stage');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'No receiving row must exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 8: the same PATCH flip on a Form 4-satisfied shipment succeeds.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50, { form4Number: 'F4-300' });
      const created = await service.createQcInspection('t1', grnDto('sh-1', 'pre_shipment'));
      const updated = await service.updateQcInspection('t1', created.id, { stage: 'receiving' });
      assert.equal(updated.stage, 'receiving', 'A Form 4-satisfied flip must succeed');
    } finally {
      await db.destroy();
    }
  }

  // Case 9: ordering — the posted-receipt guard still wins over
  // the gate. A gated shipment whose receipt is already posted is
  // refused with IMPORT_GRN_RECEIPT_ALREADY_POSTED, not the Form 4
  // error, and no QC row is written.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-f4-probe', 2001, 1, { containerNumber: 'MSCU-TEST-F4' });
      await db.insertInto('import_inventory_receipts' as never)
        .values({ id: 'rc-1', tenant_id: 't1', shipment_id: 'sh-f4-probe', state: 'posted' } as never)
        .execute();
      await assert.rejects(
        async () => service.createQcInspection('t1', grnDto('sh-f4-probe')),
        /IMPORT_GRN_RECEIPT_ALREADY_POSTED/,
        'A posted receipt is refused as already posted, not as a Form 4 failure',
      );
      assert.equal(await countRows(db, 'import_qc_inspections'), 0, 'The refused approval must not insert a row');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import Form 4 GRN gate tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
