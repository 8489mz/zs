/*
New file: backend/test/critical/daily-sequence-number.spec.ts
Pins INV-SEQUENCE-NUMBER-FAIL-CLOSED: generateDailySequenceNumber issues
a daily number only under a transaction-held advisory lock. The old code
swallowed every lock failure (including real ones) and fell back to an
unguarded MAX+1, and four call sites passed the pool handle, where an
xact lock releases the moment the SELECT returns.

WHAT THIS PINS, driving the REAL generator on PGlite:
1. Sequential numbers inside transactions: 0001 then 0002 for the same
   tenant/prefix/day; a different tenant starts again at 0001.
2. Passing the pool handle (the `db` itself) is rejected with
   SEQUENCE_REQUIRES_TRANSACTION and no number is issued.
3. A lock failure is rethrown as SEQUENCE_LOCK_FAILED, never silently
   degraded to an unguarded MAX+1.
4. Insert + numbering + rename inside one transaction rolls back
   together: a failure after numbering leaves no TMP row behind.

Deliberately NOT driven here: two concurrent transactions racing for
the same number (PGlite is single-connection; the advisory lock is the
serialization, and the expense sibling's period lock uses the same
pg_advisory_xact_lock call on PGlite). No unique index on the numbered
columns is added by this package; see the invariant note. The
contracting COUNT+1 numbering is a separate decision (D6) and is
untouched.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { generateDailySequenceNumber } from '../../src/modules/delivery-reps/services/van-common.util';

const FIXED_DATE = new Date(2026, 10, 1, 12, 0, 0);

async function countRequisitions(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM van_load_requisitions`.execute(db);
  return Number(rows.rows[0].n);
}

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE van_load_requisitions (id bigserial PRIMARY KEY, tenant_id text, doc_no text);
    `);

    // 1. Sequential, tenant-scoped numbers inside transactions.
    const first = await db.transaction().execute(async (trx) => {
      const docNo = await generateDailySequenceNumber(trx as any, db, 'van_load_requisitions', 'doc_no', 'REQ', 't1', FIXED_DATE);
      await (trx as any).insertInto('van_load_requisitions').values({ tenant_id: 't1', doc_no: docNo }).execute();
      return docNo;
    });
    assert.equal(first, 'REQ-261101-0001');
    const second = await db.transaction().execute(async (trx) => {
      const docNo = await generateDailySequenceNumber(trx as any, db, 'van_load_requisitions', 'doc_no', 'REQ', 't1', FIXED_DATE);
      await (trx as any).insertInto('van_load_requisitions').values({ tenant_id: 't1', doc_no: docNo }).execute();
      return docNo;
    });
    assert.equal(second, 'REQ-261101-0002');
    const otherTenant = await db.transaction().execute(async (trx) =>
      generateDailySequenceNumber(trx as any, db, 'van_load_requisitions', 'doc_no', 'REQ', 't2', FIXED_DATE),
    );
    assert.equal(otherTenant, 'REQ-261101-0001');
    assert.equal(await countRequisitions(db), 2);

    // 2. The pool handle is rejected outright.
    await assert.rejects(
      generateDailySequenceNumber(db as any, db, 'van_load_requisitions', 'doc_no', 'REQ', 't1', FIXED_DATE),
      (err: any) => err && err.code === 'SEQUENCE_REQUIRES_TRANSACTION' && err.statusCode === 500,
    );

    // 3. A lock failure fails closed with a named error.
    const failingHandle = {
      executeQuery: async () => {
        throw new Error('lock unavailable');
      },
    };
    await assert.rejects(
      generateDailySequenceNumber(failingHandle as any, db, 'van_load_requisitions', 'doc_no', 'REQ', 't1', FIXED_DATE),
      (err: any) => err && err.code === 'SEQUENCE_LOCK_FAILED' && err.statusCode === 500,
    );
    assert.equal(await countRequisitions(db), 2);

    // 4. Insert + numbering + rename roll back together.
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        const tempDocNo = 'TMP-REQ-rollback';
        const [inserted] = await (trx as any)
          .insertInto('van_load_requisitions')
          .values({ tenant_id: 't1', doc_no: tempDocNo })
          .returning(['id'])
          .execute();
        const docNo = await generateDailySequenceNumber(trx as any, db, 'van_load_requisitions', 'doc_no', 'REQ', 't1', FIXED_DATE);
        await (trx as any)
          .updateTable('van_load_requisitions')
          .set({ doc_no: docNo })
          .where('id', '=', Number(inserted.id))
          .execute();
        throw new Error('simulated failure after numbering');
      }),
    );
    assert.equal(await countRequisitions(db), 2);
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('daily sequence number checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
