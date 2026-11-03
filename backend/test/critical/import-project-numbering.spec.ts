/*
New file: backend/test/critical/import-project-numbering.spec.ts
Pins collision-proof project numbering
(INV-IMPORT-PROJECT-NUMBERING).

WHAT WAS WRONG: createProject minted project_no with COUNT(*) + 1
over today's rows on the host-local day, so two concurrent
creations received the same number and there was no unique index
to stop the duplicate.

WHAT THIS PINS, driving the real createProject on PGlite:
- Two creations without an override get distinct numbers in the
  tenant-local daily format IMP-YYMMDD-XXXX, sequential within
  the day, and scoped per tenant (another tenant restarts at 0001).
- An explicitly supplied projectNo is kept verbatim, and a
  duplicate override is rejected with a named conflict instead of
  silently inserting a second row with the same number.
- The migration itself (0279) is proven on a minimal table: up()
  creates the unique index, and a duplicate insert then fails
  with 23505 at the database level.

LIMIT: true concurrency is not drivable on PGlite's single
connection, so the advisory lock's serialisation is proven by
the generator's own spec (daily-sequence-number.spec.ts); this
spec pins the numbering + index behaviour the service relies on.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { up as migrate0279Up } from '../../src/database/migrations/2040000000279_import_project_no_unique_index';

async function makeDb(withIndex: boolean): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE import_projects (
      id text PRIMARY KEY DEFAULT ('proj-' || md5(random()::text)),
      tenant_id text,
      project_no text,
      title text,
      target_market text,
      country_origin text,
      country_destination text,
      budget_currency text,
      allocated_capital numeric,
      target_roi_percentage numeric,
      status text,
      feasibility_data text,
      notes text,
      sector_preset text,
      created_at timestamptz DEFAULT NOW()
    );
    ${withIndex ? 'CREATE UNIQUE INDEX uq_import_projects_tenant_project_no ON import_projects (tenant_id, project_no);' : ''}
    INSERT INTO settings VALUES ('t1', 'timezone', '"Africa/Cairo"');
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  return new (ImportSalesService as any)(db);
}

async function main(): Promise<void> {
  // Case 1: two creations get distinct sequential daily numbers.
  {
    const db = await makeDb(true);
    try {
      const service = makeService(db);
      const first = await service.createProject('t1', { title: 'First' });
      const second = await service.createProject('t1', { title: 'Second' });
      assert.notEqual(first.project_no, second.project_no, 'Two creations must not share a number');
      assert.match(first.project_no, /^IMP-\d{6}-0001$/, `First number uses the daily format, got ${first.project_no}`);
      assert.match(second.project_no, /^IMP-\d{6}-0002$/, `Second number sequences within the day, got ${second.project_no}`);
      // Another tenant restarts at 0001.
      const other = await service.createProject('t2', { title: 'Other tenant' });
      assert.match(other.project_no, /^IMP-\d{6}-0001$/, `Numbering is tenant-scoped, got ${other.project_no}`);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: explicit override kept; duplicate override rejected.
  {
    const db = await makeDb(true);
    try {
      const service = makeService(db);
      const kept = await service.createProject('t1', { title: 'Override', projectNo: 'IMP-2026-001' });
      assert.equal(kept.project_no, 'IMP-2026-001', 'An explicitly supplied number is kept verbatim');
      await assert.rejects(
        async () => service.createProject('t1', { title: 'Duplicate', projectNo: 'IMP-2026-001' }),
        /مستخدم بالفعل/,
        'A duplicate override must be rejected with a named conflict',
      );
      const rows: any[] = await (db as any).selectFrom('import_projects').selectAll().execute();
      assert.equal(rows.length, 1, 'Only the first override row may exist');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: migration 0279 itself creates the index on a minimal table.
  {
    const db = await makeDb(false);
    try {
      await migrate0279Up(db as any);
      const indexes: any[] = await (db as any)
        .selectFrom('pg_indexes' as never)
        .selectAll()
        .where('indexname', '=', 'uq_import_projects_tenant_project_no')
        .execute();
      assert.equal(indexes.length, 1, 'Migration up() must create the unique index');
      await db.insertInto('import_projects' as never).values({
        tenant_id: 't1', project_no: 'IMP-2026-009', title: 'A',
      } as never).execute();
      await assert.rejects(
        async () => db.insertInto('import_projects' as never).values({
          tenant_id: 't1', project_no: 'IMP-2026-009', title: 'B',
        } as never).execute(),
        (err: any) => err?.code === '23505',
        'The index must reject a duplicate number at the database level',
      );
    } finally {
      await db.destroy();
    }
  }

  console.log('Import project numbering tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
