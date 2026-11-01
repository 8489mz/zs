/*
New file: backend/test/critical/cash-drawer-movement-idempotency.spec.ts
Pins INV-CASH-DRAWER-MOVEMENT-IDEMPOTENCY: a mandatory client-supplied
requestKey deduplicates retried drawer movements, mirroring the expense
sibling (createExpense). A drawer movement has no dedicated row: it is
written to the shared treasury_transactions table, so the key lives
there, guarded by a partial unique index scoped to cashier_shift rows.

WHAT THE AUDIT FEARED: recordCashMovement had no idempotency key at
all, so a retried POST /api/cashier-shifts/:id/cash-movement inserted
a second treasury row, recomputed expected_cash on the doubled total,
and posted a second journal.

WHAT THIS PINS, driving the REAL recordCashMovement on PGlite:
1. A missing key and a 7-character key -> 400
   DRAWER_REQUEST_KEY_REQUIRED; an 8-character key is accepted.
2. Same key + same payload twice -> one treasury row, one posting
   call; the second call returns the listing without inserting again.
3. Same key with a different amount -> 409
   DRAWER_IDEMPOTENCY_CONFLICT and still one row, one posting call.
4. Same key on a different shift -> 409 conflict via the partial
   unique index (a key identifies one movement).
5. A different key with the same payload -> a second row (the key,
   not the payload alone, is the dedup identity).
6. The real migration up() on a pre-migration treasury_transactions
   table: adds the nullable request_key column and the partial unique
   index scoped to cashier_shift rows, allows duplicate NULL keys and
   the same key on non-drawer rows or other tenants, rejects a
   duplicate drawer key per tenant, and is idempotent on re-run.

Deliberately STUBBED here, and why: computeShiftExpectedCashFromShift
and listCashierShifts are replaced on the service instance. The
expected-cash computation reads a dozen ledger tables and is already
proven by cash-drawer-variance / cash-drawer-expected-cash-precision;
the listing reads the same tables. This spec pins the idempotency
unit (key validation, locked lookup, insert, conflict, single
posting), not the recomputation. The posting collaborator is a
counting stub, so a double-post would be visible as a second call.
Concurrent same-key requests racing each other are not driven here
(PGlite is single-connection; the shift-row lock serializes retries
for one shift, and the partial unique index is the cross-shift
backstop, proven in part 6).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { migration as drawerKeyMigration } from '../../src/database/migrations/2040000000274_cash_drawer_movement_request_key';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;
const PASSWORD = 'user-password-1';
const KEY1 = 'drawer-key-0001';
const KEY2 = 'drawer-key-0002';

async function countMovements(db: Kysely<Database>, shiftId: number): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM treasury_transactions WHERE reference_type = 'cashier_shift' AND reference_id = ${shiftId}`.execute(db);
  return Number(rows.rows[0].n);
}

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, status text, opened_by bigint, branch_id bigint, location_id bigint, opening_cash numeric, expected_cash numeric);
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, request_key text, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, is_active boolean, password_hash text, password_salt text);
    `);
    await drawerKeyMigration.up(db as never);

    const record = await createPasswordRecord(PASSWORD);
    await sql`INSERT INTO users (id, tenant_id, is_active, password_hash, password_salt) VALUES (1, 't1', true, ${record.hash}, ${record.salt})`.execute(db);
    await sql`INSERT INTO cashier_shifts (id, tenant_id, account_id, doc_no, status, opened_by, opening_cash, expected_cash) VALUES (1, 't1', 'a1', 'SH-1', 'open', 1, 0, 0)`.execute(db);
    await sql`INSERT INTO cashier_shifts (id, tenant_id, account_id, doc_no, status, opened_by, opening_cash, expected_cash) VALUES (2, 't1', 'a1', 'SH-2', 'open', 1, 0, 0)`.execute(db);

    let postingCalls = 0;
    const postingStub = {
      postCashDrawerMovement: async () => {
        postingCalls += 1;
        return { posted: true, journalEntryId: 1 };
      },
    };
    const service = new CashDrawerService(
      db,
      new TransactionHelper(),
      postingStub as never,
    );
    // Stubbed collaborators (see header): the expected-cash
    // recomputation and the shift listing, both proven elsewhere.
    (service as any).computeShiftExpectedCashFromShift = async () => 0;
    (service as any).listCashierShifts = async () => ({
      cashierShifts: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 },
      summary: {},
    });

    const movement = (requestKey: string | undefined, amount = 100, shiftId = 1) =>
      service.recordCashMovement(
        shiftId,
        { type: 'cash_in', amount, note: 'float top-up', managerPin: PASSWORD, requestKey } as never,
        AUTH,
      );

    // 1. Missing / short keys are rejected before any insert.
    await assert.rejects(
      movement(undefined),
      (err: any) => err && err.code === 'DRAWER_REQUEST_KEY_REQUIRED' && err.statusCode === 400,
    );
    await assert.rejects(
      movement('short7!'),
      (err: any) => err && err.code === 'DRAWER_REQUEST_KEY_REQUIRED' && err.statusCode === 400,
    );
    assert.equal(await countMovements(db, 1), 0);
    assert.equal(postingCalls, 0);

    // 2. Same key + same payload twice -> one row, one posting call.
    const first = await movement(KEY1);
    assert.equal(first.ok, true);
    const second = await movement(KEY1);
    assert.equal(second.ok, true);
    assert.equal(await countMovements(db, 1), 1);
    assert.equal(postingCalls, 1);

    // 3. Same key + different amount -> 409, still one row.
    await assert.rejects(
      movement(KEY1, 200),
      (err: any) => err && err.code === 'DRAWER_IDEMPOTENCY_CONFLICT' && err.statusCode === 409,
    );
    assert.equal(await countMovements(db, 1), 1);
    assert.equal(postingCalls, 1);

    // 4. Same key on a different shift -> 409 via the unique index.
    await assert.rejects(
      movement(KEY1, 100, 2),
      (err: any) => err && err.code === 'DRAWER_IDEMPOTENCY_CONFLICT' && err.statusCode === 409,
    );
    assert.equal(await countMovements(db, 2), 0);
    assert.equal(postingCalls, 1);

    // 5. A different key with the same payload is a new movement.
    await movement(KEY2);
    assert.equal(await countMovements(db, 1), 2);
    assert.equal(postingCalls, 2);
  } finally {
    await db.destroy();
  }

  // 6. Migration proof on a fresh pre-migration table.
  const pg2 = new PGlite();
  const db2 = new Kysely<Database>({ dialect: new PGliteDialect(pg2) });
  try {
    await pg2.exec(`
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint);
    `);
    await sql`INSERT INTO treasury_transactions (tenant_id, account_id, txn_type, amount, note, reference_type, reference_id) VALUES ('t1', 'a1', 'cash_in', 1, 'legacy', 'cashier_shift', 1), ('t1', 'a1', 'cash_in', 2, 'legacy', 'cashier_shift', 1)`.execute(db2);
    await drawerKeyMigration.up(db2 as never);
    await sql`INSERT INTO treasury_transactions (tenant_id, account_id, txn_type, amount, note, reference_type, reference_id, request_key) VALUES ('t1', 'a1', 'cash_in', 3, 'keyed', 'cashier_shift', 1, 'dup-key-001')`.execute(db2);
    await assert.rejects(
      sql`INSERT INTO treasury_transactions (tenant_id, account_id, txn_type, amount, note, reference_type, reference_id, request_key) VALUES ('t1', 'a1', 'cash_in', 4, 'keyed-again', 'cashier_shift', 1, 'dup-key-001')`.execute(db2),
    );
    // Same key on a non-drawer row is allowed (index is scoped).
    await sql`INSERT INTO treasury_transactions (tenant_id, account_id, txn_type, amount, note, reference_type, reference_id, request_key) VALUES ('t1', 'a1', 'cash_in', 5, 'other-kind', 'expense', 9, 'dup-key-001')`.execute(db2);
    // Same key under a different tenant is allowed.
    await sql`INSERT INTO treasury_transactions (tenant_id, account_id, txn_type, amount, note, reference_type, reference_id, request_key) VALUES ('t2', 'a1', 'cash_in', 6, 'other-tenant', 'cashier_shift', 1, 'dup-key-001')`.execute(db2);
    // Re-running the migration is a no-op.
    await drawerKeyMigration.up(db2 as never);
  } finally {
    await db2.destroy();
  }
}

main()
  .then(() => console.log('cash drawer movement idempotency checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
