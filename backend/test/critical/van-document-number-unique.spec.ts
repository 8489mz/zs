/*
New file: backend/test/critical/van-document-number-unique.spec.ts
Pins the van document-number unique backstop
(INV-DOCUMENT-NUMBER-UNIQUE-BACKSTOP).

WHAT WAS WRONG: the daily sequence generator
(generateDailySequenceNumber, INV-SEQUENCE-NUMBER-FAIL-CLOSED)
serializes numbering with a transaction-held advisory lock per
tenant + daily prefix, but the database itself had no backstop:
van_load_requisitions.doc_no and van_field_returns.doc_no
(migration 0155) and van_stock_transfers.transfer_no (migration
0158) carried no unique index, so a duplicate number produced by
any path that slipped past the generator — a second numbering
transaction, a manual insert, a restore — landed silently instead
of failing loudly.

WHAT THIS PINS, driving the REAL migration 0297 on PGlite:
1. up() creates exactly the three unique indexes, and up() is
   idempotent (up -> up does not throw; PERF-9).
2. A duplicate (tenant_id, doc_no) / (tenant_id, transfer_no)
   insert fails with 23505 on each of the three tables; the same
   number under a different tenant succeeds, and a different
   number under the same tenant succeeds.
3. The production TMP-then-rename flow still works: an identical
   TMP placeholder inserted in two sequential transactions, each
   renamed to its final number before commit, both succeed.
4. down() removes the indexes, after which a duplicate insert
   SUCCEEDS — this is the fail-without-fix sensitivity: the
   duplicate assertions above only pass because up() ran. A final
   up() restores the guard.
5. up() refuses loudly on pre-existing duplicates (named error
   naming the table and the duplicate-group count) and creates no
   index at all in that case — never silently renumbering rows.

SCOPE DECISION (recorded): the key is (tenant_id, doc_no) /
(tenant_id, transfer_no), following the generator (numbers are
tenant-scoped, daily PREFIX-YYMMDD-XXXX) and the GRN precedent
(uq_grn_tenant_doc, migration 0106). account_id is NOT part of
the key: the generator never scopes by account. These three
tables are the complete set of generator-issued, NOT NULL
document-number columns without a unique backstop. Deliberately
OUT (follow-up, needs a writer audit + a live duplicate count
first): sales.doc_no (TEXT NULL, many writers), the nullable
legacy doc_no columns (purchases, returns, cashier_shifts,
stock_transfers, stock_count_sessions), user-supplied free
values (customs-broker receipt_no, van receipt_voucher_no), and
the number embedded in free text (customer_payments.note COL).
Already unique, so not re-indexed: goods_receipt_notes.doc_no,
import_projects.project_no, container preorders preorder_no.

LIMIT: true concurrency is not drivable on PGlite's single
connection, so the advisory lock's serialisation is proven by
the generator's own spec (daily-sequence-number.spec.ts); this
spec pins the index behaviour the services rely on.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { migration } from '../../src/database/migrations/2040000000297_document_number_unique_indexes';

const INDEX_NAMES = [
  'uq_van_load_requisitions_tenant_doc_no',
  'uq_van_field_returns_tenant_doc_no',
  'uq_van_stock_transfers_tenant_transfer_no',
];

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE van_load_requisitions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, doc_no text NOT NULL);
    CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, doc_no text NOT NULL);
    CREATE TABLE van_stock_transfers (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, transfer_no text NOT NULL);
  `);
  return db;
}

async function indexCount(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ n: string }>`
    SELECT COUNT(*) AS n FROM pg_indexes
    WHERE indexname IN ('uq_van_load_requisitions_tenant_doc_no', 'uq_van_field_returns_tenant_doc_no', 'uq_van_stock_transfers_tenant_transfer_no')
  `.execute(db);
  return Number(rows.rows[0]?.n ?? 0);
}

async function insertReq(db: any, tenant: string, docNo: string): Promise<void> {
  await db.insertInto('van_load_requisitions').values({ tenant_id: tenant, account_id: 'a1', doc_no: docNo }).execute();
}

async function insertRet(db: any, tenant: string, docNo: string): Promise<void> {
  await db.insertInto('van_field_returns').values({ tenant_id: tenant, account_id: 'a1', doc_no: docNo }).execute();
}

async function insertXfr(db: any, tenant: string, transferNo: string): Promise<void> {
  await db.insertInto('van_stock_transfers').values({ tenant_id: tenant, account_id: 'a1', transfer_no: transferNo }).execute();
}

async function main(): Promise<void> {
  // Case 1: up() creates exactly the three indexes and is idempotent.
  {
    const db = await makeDb();
    try {
      await migration.up(db as any);
      assert.equal(await indexCount(db), 3, 'up() must create all three unique indexes');
      await migration.up(db as any);
      assert.equal(await indexCount(db), 3, 'up() must be idempotent (up -> up keeps exactly three indexes)');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: duplicate numbers rejected per table; tenant scoping kept.
  {
    const db = await makeDb();
    try {
      await migration.up(db as any);
      await insertReq(db, 't1', 'REQ-261108-0001');
      await insertRet(db, 't1', 'VRET-261108-0001');
      await insertXfr(db, 't1', 'XFR-261108-0001');
      await assert.rejects(
        async () => insertReq(db, 't1', 'REQ-261108-0001'),
        (err: any) => err?.code === '23505',
        'A duplicate requisition number for the same tenant must fail with 23505',
      );
      await assert.rejects(
        async () => insertRet(db, 't1', 'VRET-261108-0001'),
        (err: any) => err?.code === '23505',
        'A duplicate field-return number for the same tenant must fail with 23505',
      );
      await assert.rejects(
        async () => insertXfr(db, 't1', 'XFR-261108-0001'),
        (err: any) => err?.code === '23505',
        'A duplicate transfer number for the same tenant must fail with 23505',
      );
      // Same number under a different tenant is a different document.
      await insertReq(db, 't2', 'REQ-261108-0001');
      await insertRet(db, 't2', 'VRET-261108-0001');
      await insertXfr(db, 't2', 'XFR-261108-0001');
      // A different number under the same tenant is fine.
      await insertReq(db, 't1', 'REQ-261108-0002');
      const n = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM van_load_requisitions`.execute(db);
      assert.equal(Number(n.rows[0].n), 3, 'Three requisition rows must exist (t1 x2, t2 x1)');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: the TMP-then-rename flow still works with an identical
  // placeholder in two sequential transactions.
  {
    const db = await makeDb();
    try {
      await migration.up(db as any);
      const tmp = 'TMP-REQ-1700000000000';
      for (const finalNo of ['REQ-261108-0001', 'REQ-261108-0002']) {
        await db.transaction().execute(async (trx: any) => {
          const [row] = await trx
            .insertInto('van_load_requisitions')
            .values({ tenant_id: 't1', account_id: 'a1', doc_no: tmp })
            .returning(['id'])
            .execute();
          await trx
            .updateTable('van_load_requisitions')
            .set({ doc_no: finalNo })
            .where('id', '=', Number(row.id))
            .execute();
        });
      }
      const rows: any[] = await (db as any)
        .selectFrom('van_load_requisitions')
        .select(['doc_no'])
        .orderBy('doc_no')
        .execute();
      assert.deepEqual(
        rows.map((r) => r.doc_no),
        ['REQ-261108-0001', 'REQ-261108-0002'],
        'Both TMP rows must end up with distinct final numbers',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 4: down() removes the guard — the duplicate then succeeds
  // (fail-without-fix sensitivity) — and a final up() restores it.
  {
    const db = await makeDb();
    try {
      await migration.up(db as any);
      await insertReq(db, 't1', 'REQ-261108-0001');
      await assert.rejects(
        async () => insertReq(db, 't1', 'REQ-261108-0001'),
        (err: any) => err?.code === '23505',
        'Duplicate must fail while the index exists',
      );
      await migration.down(db as any);
      assert.equal(await indexCount(db), 0, 'down() must remove all three indexes');
      await insertReq(db, 't1', 'REQ-261108-0001');
      const n = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM van_load_requisitions WHERE doc_no = 'REQ-261108-0001'`.execute(db);
      assert.equal(Number(n.rows[0].n), 2, 'Without the index the duplicate lands silently (the defect)');
      // Remove the duplicate this case itself created so the final
      // up() can succeed (test teardown only — no production row).
      const dupes: any[] = await (db as any)
        .selectFrom('van_load_requisitions')
        .select(['id'])
        .where('doc_no', '=', 'REQ-261108-0001')
        .orderBy('id', 'desc')
        .execute();
      await (db as any).deleteFrom('van_load_requisitions').where('id', '=', Number(dupes[0].id)).execute();
      await migration.up(db as any);
      assert.equal(await indexCount(db), 3, 'A final up() must restore all three indexes');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: up() refuses loudly on pre-existing duplicates and
  // creates no index at all in that case.
  {
    const db = await makeDb();
    try {
      await insertRet(db, 't1', 'VRET-261108-0001');
      await insertRet(db, 't1', 'VRET-261108-0001');
      await assert.rejects(
        async () => migration.up(db as any),
        /document-number unique backstop refused: van_field_returns already holds 1 duplicate/,
        'up() must refuse loudly on pre-existing duplicates, naming the table',
      );
      assert.equal(await indexCount(db), 0, 'A refused up() must leave no index behind');
    } finally {
      await db.destroy();
    }
  }

  console.log('van document number unique checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
