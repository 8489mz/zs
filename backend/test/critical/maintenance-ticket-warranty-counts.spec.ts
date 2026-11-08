/*
New file: backend/test/critical/maintenance-ticket-warranty-counts.spec.ts
Pins batch M2 package 5 (review P1-4 / P2-1 / P2-2 / P2-4).

THE GAPS: warranty_days was a printed promise only — no expiry date
was ever computed; maintenance_tickets.sale_id was a dead column
nothing wrote; the tickets page counted KPIs client-side from a
pageSize-1000 fetch the backend caps at 100; and updateTicket
blanket-blocked any edit once an advance existed (even a phone typo)
while also nulling customer_id on an omitted field.

THE FIX: migration 0301 adds warranty_end (nullable timestamptz),
computed at first repair as repaired_at + then-current warranty_days;
createTicket links sale_id from a SOLD product_serials row matching
serial_number / imei_2 (case-insensitive, latest wins, silent null
otherwise); getTicketCounts answers the exact package-6 shape from
one SQL aggregate query; updateTicket allows non-financial
corrections after an advance / issued parts (D-M2-1) while financial
changes and delivered tickets still need the reversal flow; getTicket
exposes refundedAdvance from the refund treasury row.

WHAT THIS PINS, driving the REAL service code on PGlite:
- Pure helpers (no DB): computeWarrantyEnd arithmetic incl. the
  non-positive clamp; isFinancialTicketChange per field; the
  non-financial update builder preserves omitted values and never
  emits a financial key.
- Migration 0301 on PGlite: up adds warranty_end (idempotent re-run
  ok); down drops it again.
- findSoldSerialSaleId against the REAL query: case-insensitive
  serial_number and imei_2 matches, latest row wins, unsold /
  unknown / blank serials return null.
- getTicketCounts through the REAL service (plain selects only, so
  no PGlite transaction hang): per-status counts, tenant scoping,
  totalRemaining with the final_cost-0-falls-back-to-estimate rule,
  the max(0, ...) clamp, and exclusion of delivered / cancelled /
  unrepairable tickets.
- getTicket / listTickets through the REAL service: warrantyEnd
  exposed (null when unset) and refundedAdvance true only when a
  maintenance_advance_refund treasury row exists.

NOT pinned here (transactional service methods hang on PGlite — the
known harness limit): createTicket wiring the sale link, the repair
transition writing warranty_end, and updateTicket allowing / refusing
edits end to end. Those live as CI-only cases in
backend/test/acceptance/core-accounting.postgres.spec.ts.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  MaintenanceService,
  buildNonFinancialTicketUpdate,
  computeWarrantyEnd,
  findSoldSerialSaleId,
  isFinancialTicketChange,
} from '../../src/modules/maintenance/maintenance.service';
import { up as warrantyUp, down as warrantyDown } from '../../src/database/migrations/2040000000301_maintenance_ticket_warranty_end';

const DAY_MS = 24 * 60 * 60 * 1000;

function testPureHelpers(): void {
  // Warranty arithmetic: exact day multiples from the repair instant.
  const repairedAt = new Date('2026-11-08T10:00:00.000Z');
  assert.equal(computeWarrantyEnd(repairedAt, 30).getTime() - repairedAt.getTime(), 30 * DAY_MS);
  assert.equal(computeWarrantyEnd(repairedAt, 45).toISOString(), '2026-12-23T10:00:00.000Z');
  assert.equal(computeWarrantyEnd(repairedAt, 0).getTime(), repairedAt.getTime());
  assert.equal(computeWarrantyEnd(repairedAt, -5).getTime(), repairedAt.getTime(), 'negative days clamp to repair time');
  assert.equal(computeWarrantyEnd(repairedAt, 45.9).getTime() - repairedAt.getTime(), 45 * DAY_MS, 'fractional days floor');

  // Financial-change detection: each financial field, changed vs same.
  const existing = { advance_payment: 20, final_cost: 100, expected_cost: 100, status: 'received' };
  assert.equal(isFinancialTicketChange({}, existing), false);
  assert.equal(isFinancialTicketChange({ advancePayment: 20 }, existing), false);
  assert.equal(isFinancialTicketChange({ advancePayment: 30 }, existing), true);
  assert.equal(isFinancialTicketChange({ finalCost: 100 }, existing), false);
  assert.equal(isFinancialTicketChange({ finalCost: 120 }, existing), true);
  assert.equal(isFinancialTicketChange({ expectedCost: 100 }, existing), false);
  assert.equal(isFinancialTicketChange({ expectedCost: 90 }, existing), true);
  assert.equal(isFinancialTicketChange({ status: 'received' }, existing), false);
  assert.equal(isFinancialTicketChange({ status: 'repaired' }, existing), true);

  // Non-financial builder: omitted fields keep stored values, and no
  // financial key is ever emitted (a partial edit must not touch money).
  const stored = {
    customer_id: 42,
    customer_name: 'Stored Name',
    customer_phone: '01000000000',
    device_brand: 'Brand',
    device_model: 'Stored Model',
    serial_number: 'SN-1',
    passcode: '1234',
    problem_description: 'Stored problem',
    device_condition: 'Good',
    technician_id: 7,
    technician_name: 'Tech',
    technician_notes: 'Notes',
    branch_id: 3,
    location_id: 5,
    warranty_days: 30,
  };
  const built = buildNonFinancialTicketUpdate(
    { customerName: 'New Name', customerPhone: '01111111111', warrantyDays: 60 } as any,
    stored,
  );
  assert.equal(built.customer_id, 42, 'omitted customerId is preserved, not nulled');
  assert.equal(built.customer_name, 'New Name');
  assert.equal(built.customer_phone, '01111111111');
  assert.equal(built.device_model, 'Stored Model');
  assert.equal(built.problem_description, 'Stored problem');
  assert.equal(built.passcode, '1234', 'omitted passcode is preserved, not nulled');
  assert.equal(built.warranty_days, 60);
  assert.equal(built.serial_number, 'SN-1');
  for (const key of ['advance_payment', 'final_cost', 'expected_cost', 'status']) {
    assert.equal(key in built, false, `builder must never emit ${key}`);
  }
  const cleared = buildNonFinancialTicketUpdate({ serialNumber: '', deviceBrand: '' } as any, stored);
  assert.equal(cleared.serial_number, null, 'explicitly sent empty serial clears it');
  assert.equal(cleared.device_brand, null, 'explicitly sent empty brand clears it');
  assert.equal(cleared.customer_id, 42);
  const untouched = buildNonFinancialTicketUpdate({} as any, stored);
  assert.equal(untouched.customer_name, 'Stored Name');
  assert.equal(untouched.warranty_days, 30, 'omitted warrantyDays keeps the stored value, not the 30 default');
  assert.ok(untouched.updated_at instanceof Date);
}

async function columnExists(pg: PGlite, column: string): Promise<boolean> {
  const res = await pg.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'maintenance_tickets' AND column_name = $1`,
    [column],
  );
  return res.rows.length > 0;
}

async function insertTicket(
  pg: PGlite,
  ticketNo: string,
  status: string,
  finalCost: number,
  expectedCost: number,
  advance: number,
  tenantId = 't1',
  warrantyEnd: string | null = null,
): Promise<number> {
  const res = await pg.query(
    `INSERT INTO maintenance_tickets (tenant_id, account_id, ticket_no, customer_name, customer_phone, device_model, problem_description, status, final_cost, expected_cost, advance_payment, warranty_end)
     VALUES ($1, 'a1', $2, 'Customer', '01000000000', 'Model', 'Problem', $3, $4, $5, $6, $7) RETURNING id`,
    [tenantId, ticketNo, status, finalCost, expectedCost, advance, warrantyEnd],
  );
  return Number((res.rows[0] as { id: number }).id);
}

async function main(): Promise<void> {
  testPureHelpers();

  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });

  try {
    await pg.exec(`
      CREATE TABLE maintenance_tickets (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ticket_no VARCHAR(60) NOT NULL,
        customer_id INTEGER,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        device_brand VARCHAR(150),
        device_model VARCHAR(150) NOT NULL,
        serial_number VARCHAR(100),
        passcode VARCHAR(100),
        problem_description TEXT NOT NULL,
        device_condition TEXT,
        expected_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
        final_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
        advance_payment NUMERIC(15, 2) NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'received',
        technician_id INTEGER,
        technician_name VARCHAR(255),
        technician_notes TEXT,
        branch_id INTEGER,
        location_id INTEGER,
        sale_id INTEGER,
        warranty_days INTEGER NOT NULL DEFAULT 30,
        received_at TIMESTAMPTZ,
        repaired_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      );
      CREATE TABLE maintenance_ticket_parts (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ticket_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        qty NUMERIC NOT NULL,
        unit_cost NUMERIC NOT NULL DEFAULT 0,
        unit_price NUMERIC NOT NULL,
        location_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE product_serials (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        serial_number VARCHAR(255) NOT NULL,
        imei_2 VARCHAR(255),
        status VARCHAR(50) NOT NULL,
        sale_id INTEGER
      );
      CREATE TABLE treasury_transactions (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        reference_type VARCHAR(100),
        reference_id INTEGER
      );
    `);

    // Migration 0301: up adds the column (idempotent re-run ok).
    assert.equal(await columnExists(pg, 'warranty_end'), false);
    await warrantyUp(db as never);
    await warrantyUp(db as never);
    assert.equal(await columnExists(pg, 'warranty_end'), true);

    // Serial lookup through the real query: case-insensitive matches
    // on serial_number and imei_2, latest row wins, anything else null.
    await pg.exec(`
      INSERT INTO product_serials (tenant_id, account_id, product_id, serial_number, imei_2, status, sale_id) VALUES
        ('t1', 'a1', 1, 'ABC123', NULL, 'sold', 77),
        ('t1', 'a1', 1, 'DEF456', 'IMEI-9', 'sold', 78),
        ('t1', 'a1', 1, 'GHI789', NULL, 'in_stock', NULL),
        ('t1', 'a1', 1, 'JKL012', NULL, 'sold', NULL),
        ('t1', 'a1', 1, 'DUP1', NULL, 'sold', 1),
        ('t1', 'a1', 1, 'DUP1', NULL, 'sold', 2),
        ('t2', 'a1', 1, 'ABC123', NULL, 'sold', 99);
    `);
    assert.equal(await findSoldSerialSaleId(db, 't1', 'abc123'), 77, 'serial_number match is case-insensitive');
    assert.equal(await findSoldSerialSaleId(db, 't1', 'ABC123'), 77);
    assert.equal(await findSoldSerialSaleId(db, 't1', 'imei-9'), 78, 'imei_2 match is case-insensitive');
    assert.equal(await findSoldSerialSaleId(db, 't1', 'DUP1'), 2, 'latest sold row wins');
    assert.equal(await findSoldSerialSaleId(db, 't1', 'GHI789'), null, 'unsold serial links nothing');
    assert.equal(await findSoldSerialSaleId(db, 't1', 'JKL012'), null, 'sold serial with no sale links nothing');
    assert.equal(await findSoldSerialSaleId(db, 't1', 'NOPE'), null, 'unknown serial links nothing');
    assert.equal(await findSoldSerialSaleId(db, 't1', ''), null);
    assert.equal(await findSoldSerialSaleId(db, 't1', '   '), null);
    assert.equal(await findSoldSerialSaleId(db, 't2', 'ABC123'), 99, 'lookup is tenant-scoped');
    assert.equal(await findSoldSerialSaleId(db, 't1', 'ABC123'), 77, 'other tenant rows do not leak in');

    // Counts + getTicket / listTickets through the real service
    // (plain selects only — no transaction, so no PGlite hang).
    const service = new MaintenanceService(db as any, null as any, null as any, null as any, null as any);
    const auth = { tenantId: 't1', accountId: 'a1' } as any;
    await insertTicket(pg, 'ZM-260108-0001', 'received', 100, 100, 20);
    await insertTicket(pg, 'ZM-260108-0002', 'inspecting', 0, 50, 0);
    await insertTicket(pg, 'ZM-260108-0003', 'in_progress', 200, 200, 250);
    await insertTicket(pg, 'ZM-260108-0004', 'waiting_parts', 60, 60, 60);
    await insertTicket(pg, 'ZM-260108-0005', 'repaired', 300, 300, 100);
    await insertTicket(pg, 'ZM-260108-0006', 'delivered', 500, 500, 100);
    await insertTicket(pg, 'ZM-260108-0007', 'unrepairable', 100, 100, 0);
    await insertTicket(pg, 'ZM-260108-0008', 'cancelled', 100, 100, 50);
    await insertTicket(pg, 'ZM-260108-0009', 'received', 999, 999, 0, 't2');
    const refundedId = await insertTicket(pg, 'ZM-260108-0010', 'cancelled', 20, 20, 12, 't1', '2026-12-01T10:00:00.000Z');
    const plainId = await insertTicket(pg, 'ZM-260108-0011', 'received', 40, 40, 0);
    await pg.query(
      `INSERT INTO treasury_transactions (tenant_id, account_id, reference_type, reference_id)
       VALUES ('t1', 'a1', 'maintenance_advance_refund', $1)`,
      [refundedId],
    );

    const counts = await service.getTicketCounts(auth);
    assert.deepEqual(counts.counts, {
      received: 2,
      inspecting: 1,
      in_progress: 1,
      waiting_parts: 1,
      repaired: 1,
      delivered: 1,
      unrepairable: 1,
      cancelled: 2,
      total: 10,
    });
    // 80 (received) + 50 (inspecting: final 0 falls back to estimate)
    // + 0 (in_progress: advance over total clamps) + 0 (waiting_parts)
    // + 200 (repaired) + 40 (plain received) = 370; delivered /
    // unrepairable / cancelled excluded, and the t2 ticket never counts.
    assert.equal(counts.totalRemaining, 370);

    const refunded = await service.getTicket(refundedId, auth);
    assert.equal(
      new Date(refunded.ticket.warrantyEnd as any).getTime(),
      new Date('2026-12-01T10:00:00.000Z').getTime(),
      'getTicket exposes warranty_end',
    );
    assert.equal(refunded.ticket.refundedAdvance, true, 'refund treasury row sets the flag');
    const plain = await service.getTicket(plainId, auth);
    assert.equal(plain.ticket.warrantyEnd, null, 'unset warranty_end reads null, not a date');
    assert.equal(plain.ticket.refundedAdvance, false, 'no refund row means false');

    const listed = await service.listTickets(auth, { page: 1, pageSize: 25 });
    const listedRefunded = listed.tickets.find((t: any) => t.id === String(refundedId));
    assert.ok(listedRefunded, 'refunded ticket is listed');
    assert.equal(
      new Date(listedRefunded.warrantyEnd as any).getTime(),
      new Date('2026-12-01T10:00:00.000Z').getTime(),
      'listTickets exposes warranty_end',
    );
    const listedPlain = listed.tickets.find((t: any) => t.id === String(plainId));
    assert.equal(listedPlain?.warrantyEnd, null);

    // Migration 0301 down drops the column again.
    await warrantyDown(db as never);
    assert.equal(await columnExists(pg, 'warranty_end'), false);

    console.log('maintenance-ticket-warranty-counts.spec.ts passed');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
