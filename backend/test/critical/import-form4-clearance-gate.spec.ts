/*
New file: backend/test/critical/import-form4-clearance-gate.spec.ts
Pins the Form 4 clearance gate (INV-IMPORT-FORM4-CLEARANCE-GATE).

WHAT WAS WRONG (trial 2026-11-09 problem 4): container
MSCU-TEST-002 (goods $2,500, above the USD 2,000 threshold,
Form 4 blank) moved to "In Customs" with a success toast. The
gate engine was already correct and already wired at both
clearance and receipt — but its funding input came only from
supplier_payments rows, and the trial shipment had none, so
the engine's "no funding recorded → gate does not apply"
scoping let it through. The shipment screen had no
funding-type field at all.

WHAT THIS PINS, driving the real updateShipmentCosts on PGlite
(no inventory posting is reached in the blocked cases: the gate
throws first, and the passing clearance cases stop at
'In Customs'):
- Form 4 stays optional at transfer recording: that is pinned by
  import-payment-methods.spec.ts Case 2 (a bank transfer with no
  Form 4 records successfully with form4_number NULL). A transfer
  with no Form 4 does not satisfy this gate.
- The shipment now always carries a funding_type (migration
  2040000000303, default bank_transfer), and the service ALWAYS
  feeds it to the engine as a funding method alongside any
  transfer methods. The old "no funding recorded → gate does
  not apply" scoping is SUPERSEDED: Case 6 below, which used to
  pin the exemption, now pins the block. A legacy NULL
  funding_type reads as bank_transfer, never as "no funding".
- ALL FOUR paths, at BOTH transitions (In Customs clearance
  AND Arrived receipt): bank > $2k no Form 4 → blocked with
  IMPORT_FORM4_REQUIRED; cash_carried > $2k no Form 4 →
  allowed; bank ≤ $2k no Form 4 → allowed; bank > $2k WITH
  Form 4 → allowed. The allowed Arrived cases prove the gate
  passed by failing later, at the receipt-location check — the
  gate runs before any inventory posting, so a receipt that
  reaches the location check has already cleared the gate.
- The blocked error names the container, the USD value and the
  threshold, not just the code.
- funding_type defaults to bank_transfer on createShipment, and
  an explicit cash_carried is stored; changing it through
  updateShipmentCosts persists and re-arms the gate.
- Any bank-channel method anywhere (shipment or transfer)
  triggers the gate; only all-cash_carried is exempt. A cash
  transfer does not exempt a bank-declared shipment, and a bank
  transfer does not stay hidden behind a cash-declared one.
- The threshold is ONE named constant: the spec imports
  FORM4_REQUIRED_THRESHOLD_USD, asserts its decided value, and
  pins the strict above-threshold boundary with it.
- Case 13 pins the LIVE receipt probe (phase-2 trial 2026-11-09
  problem 11, deployed 6357f22f): MSCU-TEST-F4, 2,001 × $1.00
  = $2,001 — one dollar above the threshold — Form 4 blank,
  no funding rows, status → Arrived. Live it reached the final
  arrival confirmation with no Form 4 error anywhere (the
  trial cancelled, so no JE exists for it). Here the same shape
  must throw IMPORT_FORM4_REQUIRED BEFORE any posting: the
  status stays Pending and no inventory receipt row exists.

HARNESS NOTE: the spec DDL keeps funding_type nullable on
purpose, so a seeded NULL row pins the legacy-NULL defensive
default. Production is NOT NULL DEFAULT 'bank_transfer' (the
migration backfills existing rows), and the service treats NULL
as bank_transfer either way.
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
    CREATE TABLE import_shipments (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, customs_duty_rate_percent numeric, vat_rate_percent numeric, insurance_cost_usd numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, funding_type text, created_at timestamptz DEFAULT NOW());
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

async function seedShipment(
  db: Kysely<Database>,
  id: string,
  quantity: number,
  unitPrice: number,
  fundingType?: string | null,
  containerNumber = 'C-1',
): Promise<void> {
  // fundingType undefined omits the column (NULL in the harness:
  // the legacy row that predates the column). An explicit value
  // seeds the declared funding type.
  await db.insertInto('import_shipments' as never).values({
    id, tenant_id: 't1', container_number: containerNumber, supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: 'proj-1',
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
    ...(fundingType !== undefined ? { funding_type: fundingType } : {}),
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

async function shipmentFundingType(db: Kysely<Database>, id: string): Promise<string | null> {
  const row: any = await (db as any).selectFrom('import_shipments').select('funding_type').where('id', '=', id).executeTakeFirstOrThrow();
  return row.funding_type;
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

  // Case 4: cash-carried funding is exempt — but only when the
  // SHIPMENT declares cash_carried. The shipment's own funding
  // type governs; a cash transfer alone does not exempt a
  // bank-default shipment (see Case 11).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50, 'cash_carried');
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

  // Case 6 (SUPERSEDED SCOPING — trial 2026-11-09 problem 4):
  // no project-linked funding recorded at all used to exempt the
  // shipment. It no longer does: the shipment's own funding_type
  // (NULL legacy row here, read as the bank_transfer default)
  // feeds the gate, so the $5,000 shipment is BLOCKED. This is
  // the trial defect: MSCU-TEST-002 had no funding rows and
  // sailed into "In Customs".
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      assert.equal(await shipmentFundingType(db, 'sh-1'), null, 'The seeded row is a legacy NULL funding_type');
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'In Customs' }),
        /IMPORT_FORM4_REQUIRED/,
        'No funding rows must no longer exempt a bank-default shipment above the threshold',
      );
      assert.equal(await shipmentStatus(db, 'sh-1'), 'Pending', 'The blocked transition leaves the status unchanged');
    } finally {
      await db.destroy();
    }
  }

  // Case 7: the RECEIPT transition is gated too, with no funding
  // rows at all — the trial's second half. The error names the
  // container, the USD value and the threshold, not just the code.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 2500, 1, undefined, 'MSCU-TEST-002');
      let thrown: any = null;
      try {
        await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'Arrived', exchangeRateAtArrival: 50 });
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown, 'The receipt transition must throw without a Form 4');
      assert.match(String(thrown?.message || thrown), /IMPORT_FORM4_REQUIRED/);
      assert.match(String(thrown?.message || thrown), /MSCU-TEST-002/, 'The error names the container');
      assert.match(String(thrown?.message || thrown), /2500\.00/, 'The error names the USD value');
      assert.match(String(thrown?.message || thrown), /2000/, 'The error names the threshold');
      assert.equal(await shipmentStatus(db, 'sh-1'), 'Pending');
    } finally {
      await db.destroy();
    }
  }

  // Case 8: the four paths at RECEIPT. An allowed receipt proves
  // the gate passed by failing LATER, at the receipt-location
  // check: the gate runs before any inventory posting, so a call
  // that reaches the location check has already cleared it.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      // bank > $2k, no Form 4 → blocked at receipt.
      await seedShipment(db, 'sh-bank', 100, 50);
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-bank', { status: 'Arrived', exchangeRateAtArrival: 50 }),
        /IMPORT_FORM4_REQUIRED/,
        'Bank-funded above the threshold must not post a receipt without a Form 4',
      );
      // cash_carried > $2k, no Form 4 → gate passes (location check is the failure).
      await seedShipment(db, 'sh-cash', 100, 50, 'cash_carried');
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-cash', { status: 'Arrived', exchangeRateAtArrival: 50 }),
        /مخزن الاستلام/,
        'Cash-carried receipt clears the gate and reaches the receipt-location check',
      );
      // bank ≤ $2k, no Form 4 → gate passes (location check is the failure).
      await seedShipment(db, 'sh-low', 40, 50);
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-low', { status: 'Arrived', exchangeRateAtArrival: 50 }),
        /مخزن الاستلام/,
        'At-threshold receipt clears the gate and reaches the receipt-location check',
      );
      // bank > $2k WITH a Form 4 → gate passes (location check is the failure).
      await seedShipment(db, 'sh-f4', 100, 50);
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-f4', { status: 'Arrived', exchangeRateAtArrival: 50, form4Number: 'F4-300' }),
        /مخزن الاستلام/,
        'A Form 4 lets the receipt clear the gate and reach the receipt-location check',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 9: funding_type defaults to bank_transfer on create,
  // and an explicit cash_carried is stored.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const created = await service.createShipment('t1', { containerNumber: 'C-CREATE-1' });
      assert.equal((created as any).funding_type, 'bank_transfer', 'Create defaults the funding type to bank_transfer');
      const createdCash = await service.createShipment('t1', { containerNumber: 'C-CREATE-2', fundingType: 'cash_carried' });
      assert.equal((createdCash as any).funding_type, 'cash_carried', 'An explicit cash_carried is stored on create');
    } finally {
      await db.destroy();
    }
  }

  // Case 10: changing funding_type through updateShipmentCosts
  // persists — and re-arms the gate. Cash first (exempt), then a
  // second shipment switched back to bank_transfer (gated again).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      const asCash = await service.updateShipmentCosts('t1', 1, 'sh-1', { fundingType: 'cash_carried' });
      assert.equal((asCash as any).funding_type, 'cash_carried', 'The funding type change is persisted');
      const cleared = await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'In Customs' });
      assert.equal(cleared.status, 'In Customs', 'Cash-carried clears customs');
    } finally {
      await db.destroy();
    }
    const db2 = await makeDb();
    try {
      const service2 = makeService(db2);
      await seedShipment(db2, 'sh-2', 100, 50, 'cash_carried');
      await service2.updateShipmentCosts('t1', 1, 'sh-2', { fundingType: 'bank_transfer' });
      assert.equal(await shipmentFundingType(db2, 'sh-2'), 'bank_transfer', 'The funding type change back is persisted');
      await assert.rejects(
        async () => service2.updateShipmentCosts('t1', 1, 'sh-2', { status: 'In Customs' }),
        /IMPORT_FORM4_REQUIRED/,
        'A shipment switched back to bank_transfer is gated again',
      );
    } finally {
      await db2.destroy();
    }
  }

  // Case 11: a cash transfer does NOT exempt a bank-default
  // shipment. The shipment's declaration governs; the transfer
  // is additional evidence, never an override.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50);
      await seedFunding(db, 'cash_carried', null);
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'In Customs' }),
        /IMPORT_FORM4_REQUIRED/,
        'A cash transfer must not exempt a bank-default shipment',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 12: a bank transfer does not stay hidden behind a
  // cash-declared shipment. Any bank-channel method anywhere
  // triggers the gate.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-1', 100, 50, 'cash_carried');
      await seedFunding(db, 'bank_transfer', null);
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'In Customs' }),
        /IMPORT_FORM4_REQUIRED/,
        'A bank transfer funding the project triggers the gate even when the shipment declares cash_carried',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 13: the LIVE receipt probe, exact shape (phase-2 trial
  // 2026-11-09 problem 11, deployed 6357f22f): MSCU-TEST-F4,
  // 2,001 × $1.00 = $2,001 — one dollar above the threshold —
  // Form 4 blank, no funding rows, status → Arrived. Live it
  // reached the final arrival confirmation with no Form 4 error
  // anywhere and the trial had to cancel it. Here it must block
  // BEFORE any posting: IMPORT_FORM4_REQUIRED, status unchanged,
  // and no inventory receipt row exists for the shipment.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-f4-probe', 2001, 1, undefined, 'MSCU-TEST-F4');
      await assert.rejects(
        async () => service.updateShipmentCosts('t1', 1, 'sh-f4-probe', { status: 'Arrived', exchangeRateAtArrival: 50 }),
        /IMPORT_FORM4_REQUIRED/,
        'The live probe shape ($2,001, Form 4 blank, Arrived) must not post a receipt',
      );
      assert.equal(await shipmentStatus(db, 'sh-f4-probe'), 'Pending', 'The blocked receipt leaves the status unchanged');
      const receipts: any[] = await (db as any).selectFrom('import_inventory_receipts').select('id').where('shipment_id', '=', 'sh-f4-probe').execute();
      assert.equal(receipts.length, 0, 'The blocked receipt posts no inventory receipt: no JE, no stock movement');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import Form 4 clearance gate tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
