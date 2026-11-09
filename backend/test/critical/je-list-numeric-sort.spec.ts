import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * JE list numeric document order (INV-ACCOUNTING-JE-LIST-NUMERIC-SORT).
 *
 * THE OBSERVED DEFECT (live re-test on deployed 4d811676, R10): the JE
 * list sorted JE-00015026 AFTER JE-00015009 — out of document order.
 *
 * THE GROUNDED CAUSE, two layers compounding:
 * (1) Frontend default sort: AccountingJournalEntriesPage set
 *     defaultSort { columnId: 'date', direction: 'desc' }, so the
 *     DataTable re-sorted the fetched page by entry day. JE-00015026
 *     is dated 2026-11-08 while JE-00015009 is dated 2026-11-09 (a
 *     later date on a lower number — a backdated / late posting), so
 *     date-desc put 15009 before 15026. Within one day the comparator
 *     returns 0 and the served order survives, so the defect only
 *     bites across dates — exactly the observed case.
 * (2) Backend order: listJournalEntries ordered by je.id desc. The
 *     row identity is burned by failed/rolled-back inserts while the
 *     visible number comes from the gapless allocator (MAX(entry_no)
 *     + 1, journal-number.engine.ts), and the temp-number flows
 *     insert JE-TMP-* / JE-DRAFT-TMP-* rows that are renamed later —
 *     so id order is NOT document order in general. The entryNo
 *     column's own sortValue sorted by Number(row.id) too, so even
 *     clicking the "رقم القيد" header mis-ordered whenever id and
 *     entry_no diverged.
 *
 * THE RULE: the JE list is ordered by document number (entry_no)
 * everywhere — the backend serves entry_no desc (je.id desc is only
 * the tiebreak), the page defaults to the entryNo column desc, and
 * the column's sort key parses the trailing digits of the visible
 * number. entry_no is fixed-width (JE- + 8 zero-padded digits), so
 * its lexicographic order is its numeric order. The entry_no cursor
 * replaces the id cursor, so cursor paging follows the same order.
 *
 * WHAT THIS PINS, driving the REAL AccountingService on PGlite with
 * the exact R10 rows — ids deliberately anti-correlated with the
 * numbers (a burned-identity / renamed-temp shape), and the backdated
 * 2026-11-08 date on the higher number:
 * - Page 1 returns JE-00015029, JE-00015026, JE-00015009: 15026 in
 *   its correct place between 15029 and 15009 (numeric sequence
 *   15009 < 15026 < 15029), despite its earlier date and its highest
 *   id. On the pristine base (id desc) this reads 15026, 15009,
 *   15029 and the case fails.
 * - Cursor paging follows document order: pageSize 2 returns
 *   [15029, 15026] with nextCursor 'JE-00015026', and continuing
 *   from that cursor returns [15009] only.
 * - The other tenant's JE-00015030 never leaks into the list.
 * - Source pins: the service orders by entry_no desc, the page
 *   defaults to the entryNo column desc, and its sort key parses
 *   the entryNo digits instead of the row id.
 * This is not an end-to-end render on live Postgres; the visible
 * DOM order is pinned by the sibling frontend spec
 * je-list-numeric-sort.spec.tsx.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, entry_no text, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, cancelled_at timestamptz, created_at timestamptz);
    INSERT INTO users VALUES (1, 't1', 'tester');
    -- ids anti-correlated with the numbers on purpose: 15026 carries the
    -- highest id (burned identities / a renamed temp row), 15029 the
    -- lowest. The backdated 2026-11-08 date sits on the higher number.
    INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, description, source_type, source_id, status, created_by, posted_by) VALUES
      (900, 't1', 'JE-00015029', '2026-11-09', 'invoice Z-261109-16323', 'sale', 1, 'posted', 1, 1),
      (901, 't1', 'JE-00015009', '2026-11-09', 'earlier journal', 'manual', 0, 'posted', 1, 1),
      (902, 't1', 'JE-00015026', '2026-11-08', 'broker advance ADV-TEST-001', 'import_broker_advance', 0, 'posted', 1, 1),
      (903, 't2', 'JE-00015030', '2026-11-09', 'other tenant journal', 'manual', 0, 'posted', 1, 1);
  `);
  return { pg, db };
}

function makeServices(db: Kysely<Database>): AccountingService {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new AccountingService(db as any, fakeFoundation, posting as any);
}

type ListResult = {
  entries: Array<{ entryNo: string }>;
  pagination: { totalItems: number; nextCursor: string | null };
};

async function main(): Promise<void> {
  // Case 1: the R10 rows come back in true numeric document order.
  {
    const { pg, db } = await makeDb();
    try {
      const svc = makeServices(db);
      const result = (await svc.listJournalEntries({ page: 1, pageSize: 20 } as any, auth)) as unknown as ListResult;
      assert.deepEqual(
        result.entries.map((entry) => entry.entryNo),
        ['JE-00015029', 'JE-00015026', 'JE-00015009'],
        'JE-00015026 must sit between JE-00015029 and JE-00015009 despite its earlier date and highest id',
      );
      assert.equal(result.pagination.totalItems, 3, 'the other tenant row must not leak into the list');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: cursor paging follows the same document order.
  {
    const { pg, db } = await makeDb();
    try {
      const svc = makeServices(db);
      const first = (await svc.listJournalEntries({ page: 1, pageSize: 2 } as any, auth)) as unknown as ListResult;
      assert.deepEqual(
        first.entries.map((entry) => entry.entryNo),
        ['JE-00015029', 'JE-00015026'],
      );
      assert.equal(first.pagination.nextCursor, 'JE-00015026', 'the cursor must be the last document number, not the row id');
      const second = (await svc.listJournalEntries({ page: 1, pageSize: 2, cursor: first.pagination.nextCursor } as any, auth)) as unknown as ListResult;
      assert.deepEqual(
        second.entries.map((entry) => entry.entryNo),
        ['JE-00015009'],
      );
      assert.equal(second.pagination.nextCursor, null);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: source pins — service order, page default sort, column key.
  {
    const service = readFileSync(resolve(__dirname, '../../src/modules/accounting/accounting.service.ts'), 'utf8');
    const start = service.indexOf('async listJournalEntries(');
    const end = service.indexOf('async getJournalEntry(');
    assert.ok(start > 0 && end > start);
    const body = service.slice(start, end);
    assert.ok(body.includes(".orderBy('je.entry_no', 'desc')"), 'the served list must order by entry_no desc');
    assert.ok(
      body.indexOf(".orderBy('je.entry_no', 'desc')") < body.indexOf(".orderBy('je.id', 'desc')"),
      'entry_no desc must be the primary list order; id desc is only the tiebreak',
    );
    assert.ok(body.includes("where('je.entry_no', '<', cursor)"), 'the cursor must page by entry_no');

    const page = readFileSync(
      resolve(__dirname, '../../../frontend/src/features/accounting/pages/AccountingJournalEntriesPage.tsx'),
      'utf8',
    );
    assert.ok(
      page.includes("defaultSort={{ columnId: 'entryNo', direction: 'desc' }}"),
      'the page must default to the entryNo column, newest document first — not the date column',
    );
    assert.ok(!page.includes("defaultSort={{ columnId: 'date', direction: 'desc' }}"), 'the date default sort must be gone');
    assert.ok(page.includes('exec(row.entryNo'), 'the entryNo sort key must parse the visible number');
    assert.ok(page.includes('Number(match[1])'), 'the entryNo sort key must use the parsed trailing digits');
    assert.ok(!page.includes('sortValue: (row) => Number(row.id || 0)'), 'the entryNo sort key must not sort by the row identity');
  }

  console.log('je-list-numeric-sort: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
