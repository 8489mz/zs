/*
New file: backend/test/critical/import-grn-write-uniqueness.spec.ts
Pins the server-side uniqueness of the GRN write path
(INV-IMPORT-GRN-WRITE-UNIQUENESS, I6-E).

WHAT WAS WRONG (live trial phase 2, problem D10 residual): I3-D10
added a pre-check in createQcInspection — a second receiving-stage
inspection for the same shipment is refused with
IMPORT_GRN_ALREADY_RECORDED — but a pre-check is a read-then-write:
two concurrent submits can both read "no GRN yet" and both insert,
recording the approval twice. No unique DB constraint backed the
guard.

WHAT THIS PINS, driving the real createQcInspection on PGlite:
- The real migration 0306 up() applies to a pre-migration schema
  and is idempotent (second run is a no-op); the partial unique
  index uq_import_qc_inspections_receiving_per_shipment exists
  afterwards.
- The race window, proven at the DB level: on a bare fixture (no
  migration) two raw receiving inserts for the same
  (tenant, shipment) BOTH succeed — that is the hole on base. On
  the migrated fixture the second raw insert is rejected with a
  23505 naming the index — that is the exact error the service
  maps to IMPORT_GRN_ALREADY_RECORDED.
- A sequential second receiving approval still fails closed with
  IMPORT_GRN_ALREADY_RECORDED and no second row (the pre-check,
  first line of defence — this case also passes on base; the
  race proof is the DB-level case above).
- The index is scoped to the receiving stage: two pre-shipment QC
  rows for the same shipment both record, and a receiving row and
  a pre-shipment row coexist (China pre-shipment QC unaffected).
- The posted-receipt gate still refuses (the try/catch restructure
  around the insert did not change the gate).

NOT PROVEN HERE (honest limit): the service's 23505 catch branch
itself. It fires only when the pre-check passes but the insert
collides — i.e. only under true concurrency (two connections
overlapping between the check and the insert). PGlite is a single
connection, so the check and the insert always serialise and the
pre-check wins first. What IS proven is both halves the branch
depends on: the DB raises 23505 naming this index (case 4b), and
the branch maps it to the same named error the pre-check throws
(case 3, same message and code string).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { up as migrate0306Up, down as migrate0306Down } from '../../src/database/migrations/2040000000306_import_write_uniqueness';

// Pre-migration shape: the tables exactly as migrations <= 0304
// leave them (no GRN unique index, no idempotency columns).
// makeDb applies the real migration 0306 up() unless told not to,
// so the service is exercised against the true post-migration
// schema and the migration's own SQL is proven to apply.
async function makeDb(opts: { migrate?: boolean } = {}): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE import_qc_inspections (id text PRIMARY KEY DEFAULT ('qc-' || md5(random()::text)), tenant_id text, project_id text, shipment_id text, stage text, inspection_date date, inspector_name text, sample_size int, passed_quantity int, failed_quantity int, defect_notes text, status text, report_file_url text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, journal_entry_id bigint);
    -- Stubs for the two tables migration 0306 also touches (the
    -- deposit/preorder specs carry the full DDL); up() backfills
    -- them by serial_id, so the stubs need that column.
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, shipment_id text, container_no text);
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), serial_id bigserial, tenant_id text, preorder_no text);
  `);
  if (opts.migrate !== false) {
    await migrate0306Up(db as never);
  }
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

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function receivingIndexExists(db: Kysely<Database>): Promise<boolean> {
  const rows = await sql<{ indexname: string }>`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'import_qc_inspections'
      AND indexname = 'uq_import_qc_inspections_receiving_per_shipment'
  `.execute(db);
  return rows.rows.length === 1;
}

async function rawReceivingInsert(db: Kysely<Database>, shipmentId: string): Promise<void> {
  await db
    .insertInto('import_qc_inspections' as never)
    .values({
      tenant_id: 't1',
      shipment_id: shipmentId,
      stage: 'receiving',
      inspection_date: '2026-11-09',
      sample_size: 10,
      passed_quantity: 10,
      failed_quantity: 0,
      status: 'passed',
    } as never)
    .execute();
}

async function main(): Promise<void> {
  // Case 1: the real migration 0306 up() applies and is idempotent.
  {
    const db = await makeDb({ migrate: false });
    try {
      assert.equal(await receivingIndexExists(db), false, 'Bare fixture carries no GRN unique index (pre-migration shape)');
      await migrate0306Up(db as never);
      assert.equal(await receivingIndexExists(db), true, 'Migration up() creates the receiving-per-shipment unique index');
      await migrate0306Up(db as never);
      assert.equal(await receivingIndexExists(db), true, 'Migration up() is idempotent: a second run keeps exactly one index');
    } finally {
      await db.destroy();
    }
  }

  // Case 1b: down() reverses up() and up() re-applies cleanly.
  {
    const db = await makeDb();
    try {
      assert.equal(await receivingIndexExists(db), true, 'Migrated fixture carries the index before down()');
      await migrate0306Down(db as never);
      assert.equal(await receivingIndexExists(db), false, 'down() drops the receiving-per-shipment index');
      const cols = await sql<{ column_name: string }>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('import_container_deposits', 'import_container_preorders')
          AND column_name = 'idempotency_key'
      `.execute(db);
      assert.equal(cols.rows.length, 0, 'down() drops both idempotency_key columns');
      await migrate0306Up(db as never);
      assert.equal(await receivingIndexExists(db), true, 'up() re-applies cleanly after down()');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: first receiving GRN records exactly once.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const row = await service.createQcInspection('t1', {
        shipmentId: 'sh-1',
        stage: 'receiving',
        inspectionDate: '2026-11-09',
        inspectorName: 'Storekeeper',
        sampleSize: 10,
        passedQuantity: 10,
        failedQuantity: 0,
        status: 'passed',
      });
      assert.equal(row.stage, 'receiving', 'The recorded row must carry the GRN stage');
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Exactly one GRN row must exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a sequential second GRN approval fails closed — no second row.
  // (Passes on base too via the pre-check; the race proof is case 4.)
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await service.createQcInspection('t1', {
        shipmentId: 'sh-1',
        stage: 'receiving',
        inspectionDate: '2026-11-09',
        sampleSize: 10,
        passedQuantity: 10,
        failedQuantity: 0,
      });
      await assert.rejects(
        async () =>
          service.createQcInspection('t1', {
            shipmentId: 'sh-1',
            stage: 'receiving',
            inspectionDate: '2026-11-09',
            sampleSize: 10,
            passedQuantity: 10,
            failedQuantity: 0,
          }),
        /IMPORT_GRN_ALREADY_RECORDED/,
        'A second GRN approval for the same shipment must fail closed',
      );
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'The refused second approval must not insert a row');
    } finally {
      await db.destroy();
    }
  }

  // Case 4a: THE HOLE — on the bare (pre-migration) fixture two raw
  // receiving inserts for the same shipment both succeed. This is
  // the base behaviour the pre-check cannot close: two concurrent
  // submits both pass the check and both record.
  {
    const db = await makeDb({ migrate: false });
    try {
      await rawReceivingInsert(db, 'sh-race');
      await rawReceivingInsert(db, 'sh-race');
      assert.equal(
        await countRows(db, 'import_qc_inspections'),
        2,
        'Without the migration, two receiving rows for one shipment both record (the race hole)',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 4b: THE FIX — on the migrated fixture the second raw
  // receiving insert is rejected with a 23505 naming the index.
  // On base this case fails: the migration file does not exist, so
  // makeDb cannot apply it and the second insert succeeds.
  {
    const db = await makeDb();
    try {
      await rawReceivingInsert(db, 'sh-race');
      await assert.rejects(
        async () => rawReceivingInsert(db, 'sh-race'),
        /uq_import_qc_inspections_receiving_per_shipment/,
        'The migrated index must reject a second receiving row for the same shipment',
      );
      assert.equal(await countRows(db, 'import_qc_inspections'), 1, 'Only the first receiving row survives');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: the index is scoped to the receiving stage — pre-shipment
  // QC is unaffected (China checks can repeat for one shipment).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const first = await service.createQcInspection('t1', {
        shipmentId: 'sh-5',
        stage: 'pre_shipment',
        inspectionDate: '2026-11-09',
        sampleSize: 5,
        passedQuantity: 5,
        failedQuantity: 0,
      });
      const second = await service.createQcInspection('t1', {
        shipmentId: 'sh-5',
        stage: 'pre_shipment',
        inspectionDate: '2026-11-10',
        sampleSize: 5,
        passedQuantity: 4,
        failedQuantity: 1,
      });
      assert.equal(first.stage, 'pre_shipment', 'First pre-shipment check records');
      assert.equal(second.stage, 'pre_shipment', 'Second pre-shipment check for the same shipment records too');
      const grn = await service.createQcInspection('t1', {
        shipmentId: 'sh-5',
        stage: 'receiving',
        inspectionDate: '2026-11-11',
        sampleSize: 10,
        passedQuantity: 10,
        failedQuantity: 0,
      });
      assert.equal(grn.stage, 'receiving', 'A receiving GRN still records alongside pre-shipment checks');
      assert.equal(await countRows(db, 'import_qc_inspections'), 3, 'Two pre-shipment rows + one GRN row coexist');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: posted receipt still refuses (the gate survives the
  // try/catch restructure around the insert).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await db
        .insertInto('import_inventory_receipts' as never)
        .values({ tenant_id: 't1', shipment_id: 'sh-6', state: 'posted' } as never)
        .execute();
      await assert.rejects(
        async () =>
          service.createQcInspection('t1', {
            shipmentId: 'sh-6',
            stage: 'receiving',
            inspectionDate: '2026-11-09',
            sampleSize: 10,
            passedQuantity: 10,
            failedQuantity: 0,
          }),
        /IMPORT_GRN_RECEIPT_ALREADY_POSTED/,
        'A GRN approval for an already-posted receipt must fail closed',
      );
      assert.equal(await countRows(db, 'import_qc_inspections'), 0, 'The refused approval must not insert a row');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import GRN write-uniqueness tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
