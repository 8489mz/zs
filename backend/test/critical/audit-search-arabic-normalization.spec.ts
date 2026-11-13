/*
 * New file: backend/test/critical/audit-search-arabic-normalization.spec.ts
 *
 * WHAT THIS PINS (INV-AUDIT-SEARCH-ARABIC-NORMALIZATION): the admin audit
 * log search returned 0 rows for "رحلة" (and "تسوية") though matching
 * rows exist. The frontend SearchToolbar normalizes the term before
 * sending it (ة→ه, أ/إ/آ→ا, ى→ي — normalizeArabicSearchText), so the
 * server receives search=رحله; but applyAuditSearch matched that
 * pattern against the RAW stored text ('بدء رحلة توزيع' with ة) with a
 * plain lower() LIKE — no match. Terms without ة/ى/أ ("بيع", "مندوب")
 * worked, which is exactly the live pattern.
 *
 * WHAT IS DRIVEN (real PGlite, real Kysely query, real production
 * helper applyAuditSearch — no mocks): seed audit_logs rows with
 * Arabic actions/details; run the helper's query with the normalized
 * search pattern the toolbar sends and assert the matching rows come
 * back.
 * (a) search 'رحله' (normalized form) returns the trip-start row;
 * (b) search 'تسويه' returns the settlement row;
 * (c) search 'بيع' still returns the sale row (no regression);
 * (d) search 'رحلة' (un-normalized term, e.g. a direct API call)
 *     also returns the trip-start row — the helper normalizes the
 *     pattern itself and must not depend on the caller normalizing.
 *
 * NOT DRIVEN: the frontend SearchToolbar (untouched); other
 * applySearch callers (treasury, partner ledger — untouched).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { applyAuditSearch } from '../../src/modules/reports/helpers/reports-query-pipeline.helper';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text);
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, created_by bigint, tenant_id text, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function searchIds(db: Kysely<Database>, pattern: string): Promise<number[]> {
  const query = db
    .selectFrom('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.created_by')
    .select(['a.id']);
  const rows = await applyAuditSearch(query, pattern).execute();
  return (rows as Array<{ id: number }>).map((r) => Number(r.id)).sort((a, b) => a - b);
}

(async () => {
  const { pg, db } = await makeDb();
  try {
    const anyDb = db as any;
    await anyDb.insertInto('users').values({ id: 1, tenant_id: 't1', username: 'muse' }).execute();
    await anyDb
      .insertInto('audit_logs')
      .values([
        {
          id: 1,
          action: 'بدء رحلة توزيع',
          details: 'بدأ المندوب مندوب اختبار جملة (#38) رحلة التوزيع #6',
          event_code: 'VAN_TRIP_STARTED',
          created_by: 1,
          tenant_id: 't1',
        },
        {
          id: 2,
          action: 'تسوية مندوب',
          details: 'تسوية حساب المندوب #6',
          event_code: 'VAN_TRIP_SETTLED',
          created_by: 1,
          tenant_id: 't1',
        },
        {
          id: 3,
          action: 'بيع ميداني',
          details: 'بيع منتج اختبار',
          event_code: 'VAN_FIELD_SALE',
          created_by: 1,
          tenant_id: 't1',
        },
      ])
      .execute();

    // (a) The normalized form the toolbar actually sends.
    assert.deepEqual(await searchIds(db, '%رحله%'), [1], 'search رحله must return the trip-start row');
    // (b) Same failure class, second term.
    assert.deepEqual(await searchIds(db, '%تسويه%'), [2], 'search تسويه must return the settlement row');
    // (c) No regression for terms without ة/ى/أ.
    assert.deepEqual(await searchIds(db, '%بيع%'), [3], 'search بيع must still return the sale row');
    // (d) Un-normalized term must work too (helper normalizes the pattern).
    assert.deepEqual(await searchIds(db, '%رحلة%'), [1], 'search رحلة must return the trip-start row');
    assert.deepEqual(await searchIds(db, '%تسوية%'), [2], 'search تسوية must return the settlement row');

    console.log('audit-search-arabic-normalization.spec passed');
  } finally {
    await db.destroy();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
