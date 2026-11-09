/*
 * R6-B (INV-REST-RESERVATION-NO-OVERLAP, I4): reservations can overlap with
 * no check — createReservation inserts with no query for an existing
 * reservation on that table/time, and updateStatus moves tables (or
 * re-activates a cancelled/no_show row) with no check either.
 *
 * Fix (exact-instant conflict, no migration): before the insert, and in
 * updateStatus whenever the effective table changes or a cancelled/no_show
 * row is re-activated into confirmed/seated, query for an existing row
 * with the same tenant + branch (null matches null) + trimmed table_number
 * + equal reservation_time instant, status confirmed/seated, and
 * reservation_type != 'waitlist' (waitlist rows hold no table; cancelled
 * and no_show rows never block). On a clash throw 409 ConflictException
 * TABLE_ALREADY_RESERVED naming the table and the time. updateStatus
 * always excludes the row's own id, so a pure confirmed -> seated on the
 * same table needs no check and succeeds.
 *
 * Honest limit: exact-instant only. 19:00 and 19:30 on one table both
 * pass — a true time-window check needs a duration the data does not have
 * (no end time / duration column anywhere); that is a follow-up package,
 * not this one. Out of scope by decision: status state machine,
 * past-time rejection, guestCount coercion.
 *
 * RED PROOF: on the unfixed tree the second insert in case (1) succeeds
 * (no 409), the move in case (6) succeeds, and the re-activation in
 * case (10) succeeds — each assert.rejects below fails at base.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { ConflictException } from '@nestjs/common';
import { Database } from '../../src/database/database.types';
import { TableReservationsService } from '../../src/modules/sales/services/table-reservations.service';

const TENANT = 't1';
const OTHER_TENANT = 't2';
const TIME = '2026-11-10T19:00:00.000Z';
const OTHER_TIME = '2026-11-10T20:00:00.000Z';

const DDL = `
  CREATE TABLE restaurant_table_reservations (id bigserial PRIMARY KEY, tenant_id text,
    branch_id bigint, table_number text, guest_name text, guest_phone text,
    guest_count int, reservation_time timestamptz, status text,
    special_requests text, reservation_type text, created_by bigint,
    created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
`;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(DDL);
  return { pg, db };
}

async function resetDb(pg: PGlite): Promise<void> {
  await pg.exec(`TRUNCATE restaurant_table_reservations RESTART IDENTITY`);
}

function createDto(overrides: Record<string, unknown> = {}): any {
  return {
    tableNumber: '5',
    guestName: 'Guest',
    reservationTime: TIME,
    ...overrides,
  };
}

async function expectConflict(promise: Promise<unknown>, table: string): Promise<void> {
  try {
    await promise;
  } catch (error: any) {
    assert.ok(
      error instanceof ConflictException,
      `expected ConflictException, got ${error?.constructor?.name}: ${error?.message}`,
    );
    assert.equal(error.getStatus(), 409, 'overlap must be HTTP 409 Conflict');
    assert.match(error.message, /TABLE_ALREADY_RESERVED/, 'message must carry TABLE_ALREADY_RESERVED');
    assert.ok(error.message.includes(table), `message must name table ${table}`);
    assert.ok(error.message.includes(TIME), 'message must name the reservation time');
    return;
  }
  assert.fail('expected a 409 TABLE_ALREADY_RESERVED but the call succeeded');
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    const service = new TableReservationsService(db as any);

    // (1) Same table + same instant, both confirmed -> second throws 409.
    {
      await resetDb(pg);
      await service.createReservation(TENANT, 1, createDto({ guestName: 'First' }));
      await expectConflict(
        service.createReservation(TENANT, 1, createDto({ guestName: 'Second' })),
        '5',
      );
      console.log('  (1) same table + same instant confirmed -> 409 passed');
    }

    // (2) Same table, different instant -> both succeed.
    {
      await resetDb(pg);
      await service.createReservation(TENANT, 1, createDto({ guestName: 'First' }));
      const second = await service.createReservation(
        TENANT, 1, createDto({ guestName: 'Second', reservationTime: OTHER_TIME }),
      );
      assert.ok(second.id, 'different instant must succeed');
      console.log('  (2) same table, different instant -> both succeed passed');
    }

    // (3) Same instant, different table -> both succeed.
    {
      await resetDb(pg);
      await service.createReservation(TENANT, 1, createDto({ guestName: 'First' }));
      const second = await service.createReservation(
        TENANT, 1, createDto({ guestName: 'Second', tableNumber: '7' }),
      );
      assert.ok(second.id, 'different table must succeed');
      console.log('  (3) same instant, different table -> both succeed passed');
    }

    // (4) Existing row cancelled (then no_show) + new confirmed same
    // table+time -> succeeds.
    {
      await resetDb(pg);
      const first = await service.createReservation(TENANT, 1, createDto({ guestName: 'First' }));
      await service.updateStatus(TENANT, first.id, { status: 'cancelled' });
      const second = await service.createReservation(TENANT, 1, createDto({ guestName: 'Second' }));
      assert.ok(second.id, 'cancelled row must not block');
      await service.updateStatus(TENANT, second.id, { status: 'no_show' });
      const third = await service.createReservation(TENANT, 1, createDto({ guestName: 'Third' }));
      assert.ok(third.id, 'no_show row must not block');
      console.log('  (4) cancelled / no_show existing -> new confirmed succeeds passed');
    }

    // (5) Existing waitlist row + new confirmed same table+time -> succeeds
    // (waitlist rows hold no table; the exclusion is pinned explicitly even
    // though the waitlist row here carries a real table number).
    {
      await resetDb(pg);
      await service.createReservation(TENANT, 1, createDto({
        guestName: 'Waitlisted', reservationType: 'waitlist',
      }));
      const booked = await service.createReservation(TENANT, 1, createDto({ guestName: 'Booked' }));
      assert.ok(booked.id, 'waitlist row must not block');
      console.log('  (5) waitlist existing -> new confirmed succeeds passed');
    }

    // (6) updateStatus moving a reservation onto a booked table+time -> 409.
    {
      await resetDb(pg);
      await service.createReservation(TENANT, 1, createDto({ guestName: 'Table 5' }));
      const other = await service.createReservation(
        TENANT, 1, createDto({ guestName: 'Table 7', tableNumber: '7' }),
      );
      await expectConflict(
        service.updateStatus(TENANT, other.id, { status: 'confirmed', tableNumber: '5' }),
        '5',
      );
      console.log('  (6) updateStatus move onto booked table -> 409 passed');
    }

    // (7) updateStatus on the same table (self) -> succeeds (self-exclusion).
    {
      await resetDb(pg);
      const row = await service.createReservation(TENANT, 1, createDto({ guestName: 'Self' }));
      const seated = await service.updateStatus(
        TENANT, row.id, { status: 'seated', tableNumber: '5' },
      );
      assert.equal(seated.status, 'seated', 'self seated move must succeed');
      const again = await service.updateStatus(TENANT, row.id, { status: 'confirmed' });
      assert.equal(again.status, 'confirmed', 'self status-only update must succeed');
      console.log('  (7) updateStatus on the same table (self) -> succeeds passed');
    }

    // (8) Same table+time on a different branch_id -> succeeds (and a
    // null branch does not collide with a numbered branch).
    {
      await resetDb(pg);
      await service.createReservation(TENANT, 1, createDto({ guestName: 'Branch 1', branchId: 1 }));
      const otherBranch = await service.createReservation(
        TENANT, 1, createDto({ guestName: 'Branch 2', branchId: 2 }),
      );
      assert.ok(otherBranch.id, 'different branch must succeed');
      const nullBranch = await service.createReservation(
        TENANT, 1, createDto({ guestName: 'No branch' }),
      );
      assert.ok(nullBranch.id, 'null branch must not collide with a numbered branch');
      console.log('  (8) same table+time, different branch -> succeeds passed');
    }

    // (9) Same table+time under a different tenant -> succeeds.
    {
      await resetDb(pg);
      await service.createReservation(TENANT, 1, createDto({ guestName: 'Tenant 1' }));
      const otherTenant = await service.createReservation(
        OTHER_TENANT, 1, createDto({ guestName: 'Tenant 2' }),
      );
      assert.ok(otherTenant.id, 'different tenant must succeed');
      console.log('  (9) same table+time, different tenant -> succeeds passed');
    }

    // (10) Re-activating a cancelled row into a slot another confirmed row
    // now holds -> 409.
    {
      await resetDb(pg);
      const first = await service.createReservation(TENANT, 1, createDto({ guestName: 'First' }));
      await service.updateStatus(TENANT, first.id, { status: 'cancelled' });
      const second = await service.createReservation(TENANT, 1, createDto({ guestName: 'Second' }));
      assert.ok(second.id, 're-booking a cancelled slot must succeed');
      await expectConflict(
        service.updateStatus(TENANT, first.id, { status: 'confirmed' }),
        '5',
      );
      console.log('  (10) re-activating cancelled into a taken slot -> 409 passed');
    }

    console.log('table-reservation-overlap.spec: all checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
