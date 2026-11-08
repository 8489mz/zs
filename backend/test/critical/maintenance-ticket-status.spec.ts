/*
New file: backend/test/critical/maintenance-ticket-status.spec.ts
Pins maintenance ticket status validation (P2-6 / P2-7).

THE GAP: both maintenance DTOs typed `status` as a bare string with
no @IsIn, the TS union even omitted `waiting_parts`, and the
maintenance_tickets.status column is a plain varchar(50) with no
CHECK — any text could be stored through the API. The tickets page
also had no filter tabs for inspecting / unrepairable / cancelled.

THE FIX: @IsIn over exactly the 8 statuses (received, inspecting,
in_progress, waiting_parts, repaired, delivered, unrepairable,
cancelled) in both DTOs, with the TS unions fixed to include
waiting_parts; migration 0299 adds
chk_maintenance_tickets_status_valid as NOT VALID after a
fail-loudly backfill check; migration 0300 runs VALIDATE CONSTRAINT.

WHAT THIS PINS, driving the REAL DTOs and the REAL migrations:
- DTOs: 'bogus' fails validation in both DTOs; each of the 8
  allowed statuses passes in both DTOs (plain class-validator,
  no DB).
- Migrations on PGlite: 0299 up FAILS LOUDLY while a legacy row
  holds an out-of-set status; after the row is removed 0299 up
  succeeds; a new 'bogus' insert is then rejected (NOT VALID still
  enforces new rows); each of the 8 statuses inserts fine; 0300 up
  validates; 0299 down drops the constraint and 'bogus' inserts
  again (proving the constraint, not the column, was the guard).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { UpsertMaintenanceTicketDto } from '../../src/modules/maintenance/dto/upsert-maintenance-ticket.dto';
import { UpdateTicketStatusDto } from '../../src/modules/maintenance/dto/update-ticket-status.dto';
import { up as statusCheckUp, down as statusCheckDown } from '../../src/database/migrations/2040000000299_maintenance_ticket_status_check';
import { up as statusValidateUp, down as statusValidateDown } from '../../src/database/migrations/2040000000300_maintenance_ticket_status_check_validate';

const ALLOWED_STATUSES = [
  'received',
  'inspecting',
  'in_progress',
  'waiting_parts',
  'repaired',
  'delivered',
  'unrepairable',
  'cancelled',
] as const;

function assertDtoValid<T>(cls: new () => T, payload: unknown): void {
  const instance = plainToInstance(cls, payload);
  const errors = validateSync(instance as object);
  assert.equal(errors.length, 0, `Expected valid payload, got ${JSON.stringify(errors)}`);
}

function assertDtoInvalid<T>(cls: new () => T, payload: unknown): void {
  const instance = plainToInstance(cls, payload);
  const errors = validateSync(instance as object);
  assert.ok(errors.length > 0, 'Expected payload to be invalid');
}

function testDtos(): void {
  const upsertBase = {
    customerName: 'Test Customer',
    customerPhone: '01000000000',
    deviceModel: 'Test Model',
    problemDescription: 'Screen broken',
  };
  for (const status of ALLOWED_STATUSES) {
    assertDtoValid(UpsertMaintenanceTicketDto, { ...upsertBase, status });
    assertDtoValid(UpdateTicketStatusDto, { status });
  }
  assertDtoInvalid(UpsertMaintenanceTicketDto, { ...upsertBase, status: 'bogus' });
  assertDtoInvalid(UpdateTicketStatusDto, { status: 'bogus' });
  // Waiting parts is a real status (page + statusConfig already use
  // it); the old TS union omitted it, so this also pins the union fix.
  assertDtoValid(UpsertMaintenanceTicketDto, { ...upsertBase, status: 'waiting_parts' });
  assertDtoValid(UpdateTicketStatusDto, { status: 'waiting_parts' });
}

async function insertTicket(pg: PGlite, ticketNo: string, status: string): Promise<void> {
  await pg.query(
    `INSERT INTO maintenance_tickets (tenant_id, account_id, ticket_no, customer_name, customer_phone, device_model, problem_description, status)
     VALUES ('t1', 'a1', $1, 'Test Customer', '01000000000', 'Test Model', 'Screen broken', $2)`,
    [ticketNo, status],
  );
}

async function main(): Promise<void> {
  testDtos();

  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });

  try {
    await pg.exec(`
      CREATE TABLE maintenance_tickets (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        ticket_no VARCHAR(60) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        device_model VARCHAR(150) NOT NULL,
        problem_description TEXT NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'received'
      );
      INSERT INTO maintenance_tickets (tenant_id, account_id, ticket_no, customer_name, customer_phone, device_model, problem_description, status)
        VALUES ('t1', 'a1', 'ZM-260108-0001', 'Test Customer', '01000000000', 'Test Model', 'Screen broken', 'received');
      INSERT INTO maintenance_tickets (tenant_id, account_id, ticket_no, customer_name, customer_phone, device_model, problem_description, status)
        VALUES ('t1', 'a1', 'ZM-260108-0002', 'Test Customer', '01000000000', 'Test Model', 'Screen broken', 'bogus');
    `);

    // 0299 up fails loudly while a legacy row is out of set.
    await assert.rejects(
      statusCheckUp(db as never),
      /outside the allowed set/,
    );

    // Remove the bad row: 0299 up now succeeds (idempotent re-run ok).
    await pg.exec(`DELETE FROM maintenance_tickets WHERE status = 'bogus'`);
    await statusCheckUp(db as never);
    await statusCheckUp(db as never);

    // NOT VALID still enforces the constraint on NEW rows.
    await assert.rejects(insertTicket(pg, 'ZM-260108-0003', 'bogus'));
    for (const [i, status] of ALLOWED_STATUSES.entries()) {
      await insertTicket(pg, `ZM-260108-00${10 + i}`, status);
    }

    // 0300 validates the (now clean) table.
    await statusValidateUp(db as never);
    await assert.rejects(insertTicket(pg, 'ZM-260108-0004', 'bogus'));

    // Down: 0300 is a no-op by design; 0299 drops the constraint,
    // and a bogus insert succeeds again — proving the constraint
    // (not the column) was the guard.
    await statusValidateDown(db as never);
    await statusCheckDown(db as never);
    await insertTicket(pg, 'ZM-260108-0005', 'bogus');

    console.log('maintenance-ticket-status.spec.ts passed');
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
