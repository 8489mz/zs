/*
 * INV-RACE-WINDOW-JOURNAL-UNIQUENESS: the eight one-journal source
 * types whose post methods only SELECT before inserting must also be
 * protected by a database unique index, or two concurrent transactions
 * can both post. Three of the methods even carried a 23505 catch naming
 * an index that never covered their type (dead guards). This spec pins
 * migration 2040000000267 through the production migration code: the
 * index exists, a second active journal is rejected, a reversed
 * original plus its replacement is allowed (postSaleEdit's
 * reverse-then-repost), uncovered types are untouched, and legacy
 * active duplicates refuse the migration with a diagnosable error.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { up as raceWindowMigrationUp } from '../../src/database/migrations/2040000000267_race_window_journal_uniqueness';

const COVERED = [
  'manufacturing_work_order',
  'delivery_rep_settlement',
  'van_field_return',
  'hr_payroll_item_payment',
  'food_waste',
  'sale_edit',
  'customer_opening_balance',
  'supplier_opening_balance',
];

async function setupDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await sql`
    CREATE TABLE journal_entries (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id BIGINT,
      status TEXT NOT NULL DEFAULT 'posted',
      reversed_by_entry_id BIGINT
    )
  `.execute(db);
  return { pg, db };
}

async function insertJournal(
  db: Kysely<Database>,
  sourceType: string,
  sourceId: number,
  reversedBy: number | null,
): Promise<void> {
  await sql`
    INSERT INTO journal_entries (tenant_id, source_type, source_id, status, reversed_by_entry_id)
    VALUES ('t1', ${sourceType}, ${sourceId}, 'posted', ${reversedBy})
  `.execute(db);
}

async function countJournals(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<number> {
  const res = await sql<{ n: string }>`
    SELECT count(*) AS n FROM journal_entries WHERE source_type = ${sourceType} AND source_id = ${sourceId}
  `.execute(db);
  return Number(res.rows[0].n);
}

async function main(): Promise<void> {
  // --- 1. The index exists, is partial on active journals, and is idempotent ---
  {
    const { db } = await setupDb();
    try {
      await raceWindowMigrationUp(db as any);
      const idx = await sql<{ indexname: string; indexdef: string }>`
        SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_journal_entries_race_window_uniq'
      `.execute(db);
      assert.equal(idx.rows.length, 1, 'race-window index exists after up()');
      assert.match(idx.rows[0].indexdef, /sale_edit/, 'index covers sale_edit');
      assert.match(idx.rows[0].indexdef, /reversed_by_entry_id IS NULL/, 'index is partial on active journals');
      await raceWindowMigrationUp(db as any);
      const again = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes WHERE indexname = 'idx_journal_entries_race_window_uniq'
      `.execute(db);
      assert.equal(again.rows.length, 1, 'second up() is a no-op (IF NOT EXISTS)');
    } finally {
      await db.destroy();
    }
  }

  // --- 2. A second active journal is rejected for every covered type ---
  {
    const { db } = await setupDb();
    try {
      await raceWindowMigrationUp(db as any);
      let sourceId = 100;
      for (const sourceType of COVERED) {
        sourceId += 1;
        await insertJournal(db, sourceType, sourceId, null);
        await assert.rejects(
          () => insertJournal(db, sourceType, sourceId, null),
          /duplicate key|unique/i,
          `${sourceType}: second active journal must be rejected`,
        );
        assert.equal(await countJournals(db, sourceType, sourceId), 1, `${sourceType}: exactly one journal survives`);
      }
    } finally {
      await db.destroy();
    }
  }

  // --- 3. Reversed original + active replacement is allowed (sale_edit flow) ---
  {
    const { db } = await setupDb();
    try {
      await raceWindowMigrationUp(db as any);
      await insertJournal(db, 'sale_edit', 42, 999); // reversed original
      await insertJournal(db, 'sale_edit', 42, null); // reverse-then-repost replacement
      assert.equal(await countJournals(db, 'sale_edit', 42), 2, 'reversed + replacement coexist');
    } finally {
      await db.destroy();
    }
  }

  // --- 4. Uncovered types are untouched ---
  {
    const { db } = await setupDb();
    try {
      await raceWindowMigrationUp(db as any);
      await insertJournal(db, 'stock_count_chunk', 7, null);
      await insertJournal(db, 'stock_count_chunk', 7, null);
      assert.equal(
        await countJournals(db, 'stock_count_chunk', 7),
        2,
        'uncovered type keeps its own multiplicity rules',
      );
    } finally {
      await db.destroy();
    }
  }

  // --- 5. Legacy active duplicates refuse the migration diagnosably ---
  {
    const { db } = await setupDb();
    try {
      await insertJournal(db, 'manufacturing_work_order', 9, null);
      await insertJournal(db, 'manufacturing_work_order', 9, null);
      await assert.rejects(
        () => raceWindowMigrationUp(db as any),
        (err: unknown) => {
          assert.match(String((err as Error).message), /Race-window uniqueness migration refused/);
          assert.match(String((err as Error).message), /manufacturing_work_order#9/);
          return true;
        },
      );
    } finally {
      await db.destroy();
    }
  }
}

main().then(
  () => {
    console.log('race-window-uniqueness.spec: ok');
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
