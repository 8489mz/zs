/*
New file: backend/test/critical/import-form4-clearance-gate.spec.ts
Pins the Form 4 clearance gate (INV-IMPORT-FORM4-CLEARANCE-GATE).

WHAT WAS WRONG: nothing stopped a bank-funded shipment from moving
into customs clearance or receipt posting with no Form 4 on record
anywhere — the document Egyptian customs requires to prove the
currency was arranged through official banking channels. Form 4
number/date were optional at transfer recording (correctly), but
no gate ever required them later, and cash-carried money — which
has no bank-issued Form 4 — was indistinguishable from bank
funding.

WHAT THIS PINS, driving the real updateShipmentCosts on PGlite
(no inventory posting is reached: the gate throws first, and the
passing cases stop at 'In Customs'):
- Form 4 stays optional at transfer recording: that is pinned by
  import-payment-methods.spec.ts Case 2 (a bank transfer with no
  Form 4 records successfully with form4_number NULL). A transfer
  with no Form 4 does not satisfy this gate.
- A bank-transfer-funded shipment above USD 2,000 cannot move to
  'In Customs' (or 'Arrived') without a Form 4 number on the
  shipment or on a project-linked funding transfer: it fails
  closed with IMPORT_FORM4_REQUIRED and the status stays Pending.
- Supplying the Form 4 number in the same costs call satisfies
  the gate; a Form 4 on the funding transfer satisfies it too.
- Cash-carried funding is exempt: no bank arranged the currency.
- At or below the threshold the gate does not apply; with no
  project-linked funding recorded at all the gate does not apply
  (unrecorded funding is a scoping limit, recorded not hidden).
- The threshold is ONE named constant: the spec imports
  FORM4_REQUIRED_THRESHOLD_USD, asserts its decided value, and
  pins the strict above-threshold boundary with it.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { FORM4_REQUIRED_THRESHOLD_USD } from '../../src/modules/import-sales/engines/import-form4-gate.engine';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE products (id bigint PRIMARY KEY, name text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id text PRIMARY KEY, tenant_id text, shipment_id text, state text, posted_at timestamptz, review_reason text, journal_entry_id bigint);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, pi_number text, supplier_id bigint, project_id text, currency text, total_amount_foreign numeric, paid_amount_foreign numeric, exchange_rate_contract numeric, payment_status text);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, amount numeric, amount_foreign numeric, note text, created_by bigint, payment_date text, currency text, exchange_rate numeric, forex_variance_egp numeric, proforma_invoice_id text, idempotency_key text, doc_no text, created_at timestamptz DEFAULT NOW(), payment_method text, payment_reference text, bank_swift_code text, form4_number text, form4_date date, evidence_carrier_name text, evidence_travel_date date, evidence_handover_receipt text, evidence_lc_number text, evidence_lc_issuing_bank text, evidence_lc_expiry date, evidence_lc_documents text, evidence_cad_proof text, evidence_payment_terms text, evidence_payment_due_date date);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    INSERT INTO products VALUES (1, 'Widget');
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

async function seedShipment(db: Kysely<Database>, id: string, quantity: number, unitPrice: number): Promise<void> {
  await db.insertInto('import_shipments' as never).values({
    id, tenant_id: 't1', container_number: 'C-1', supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: 'proj-1',
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
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

async function shipmentStatus(db: Kysely<Database>, id: string): Promise<string> {
  const row: any = await (db as any).selectFrom('import_shipments').select('status').where('id', '=', id).executeTakeFirstOrThrow();
  return row.status;
}

async function main(): Promise<void> {
  // The threshold is one named constant with the decided value.
  assert.equal(FORM4_REQUIRED_THRESHOLD_USD, 2000, 'The Form 4 threshold is USD 2,000 in exactly one place');

  // Case 1: bank-funded $5,000 shipment, no Form 4 anywhere: blocked from clearance.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      await seedFunding(db, 'bank_transfer', null);
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'In Customs' }),
        /IMPORT_FORM4_REQUIRED/,
        'A bank-funded shipment above the threshold must not enter customs without a Form 4',
      );
      assert.equal(await shipmentStatus(db, 'sh-1'), 'Pending', 'The blocked transition leaves the status unchanged');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: Form 4 supplied in the same costs call satisfies the gate.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      await seedFunding(db, 'bank_transfer', null);
      const updated = await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'In Customs', form4Number: 'F4-100', form4Date: '2026-02-01' });
      assert.equal(updated.status, 'In Customs', 'The transition succeeds once a Form 4 is recorded');
      assert.equal(updated.form4_number, 'F4-100', 'The Form 4 number is stored on the shipment');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a Form 4 on the funding transfer satisfies the gate without a shipment Form 4.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      await seedFunding(db, 'bank_transfer', 'F4-200');
      const updated = await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'In Customs' });
      assert.equal(updated.status, 'In Customs');
      assert.equal(updated.form4_number, null, 'No shipment-level Form 4 was recorded; the transfer Form 4 satisfied the gate');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: cash-carried funding is exempt.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      await seedFunding(db, 'cash_carried', null);
      const updated = await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'In Customs' });
      assert.equal(updated.status, 'In Customs', 'Cash-carried money has no bank-issued Form 4 to require');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: at or below the threshold the gate does not apply; strictly above it does.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-low', 40, 50); // exactly USD 2,000
      await seedShipment(db, 'sh-high', 41, 50); // USD 2,050
      await seedFunding(db, 'bank_transfer', null);
      const low = await service.updateShipmentCosts('t1', 1, 'sh-low', { status: 'In Customs' });
      assert.equal(low.status, 'In Customs', 'Exactly at the threshold: the gate requires ABOVE the threshold');
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-high', { status: 'In Customs' }),
        /IMPORT_FORM4_REQUIRED/,
        'Above the threshold the gate applies',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 6: no project-linked funding recorded: the gate does not apply (recorded scoping).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      const updated = await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'In Customs' });
      assert.equal(updated.status, 'In Customs', 'Unrecorded funding cannot trigger the gate');
    } finally {
      await db.destroy();
    }
  }

  // Case 7: the Arrived transition is gated before any inventory posting.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      await seedFunding(db, 'bank_transfer', null);
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'Arrived', exchangeRateAtArrival: 50 }),
        /IMPORT_FORM4_REQUIRED/,
        'The arrival-rate guard passes, so only the Form 4 gate can reject this call: the gate runs before posting',
      );
      assert.equal(await shipmentStatus(db, 'sh-1'), 'Pending');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import Form 4 clearance gate tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
