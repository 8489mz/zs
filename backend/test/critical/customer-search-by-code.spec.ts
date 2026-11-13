/*
 * New file: backend/test/critical/customer-search-by-code.spec.ts
 *
 * WHAT THIS PINS (INV-CUSTOMER-SEARCH-BY-CODE): searching customers by
 * the full display code "C-3060" returned 0 rows, though "3060" alone
 * found the customer. The frontend SearchToolbar normalizes the input
 * (normalizeArabicSearchText strips '-' to a space), so the server
 * receives q='c 3060'; but buildCustomerSearchPredicate's code regex
 * /^(?:c-|#)?0*(\d+)$/i accepts 'c-3060' (hyphen, no space) and NOT
 * 'c 3060' (space), so the numeric-id branch is skipped and the
 * generic branch tests '%c 3060%' against name/phone/padded-id/
 * metadata/address/type/company/tax — none contains "c 3060".
 *
 * WHAT IS DRIVEN (real PGlite, real Kysely query, real production
 * helper buildCustomerSearchPredicate — no mocks): seed customers and
 * run the predicate with the exact terms the toolbar sends.
 * (a) 'c 3060' (the normalized term) matches id 3060;
 * (b) 'C-3060' still matches id 3060;
 * (c) '3060' still matches id 3060;
 * (d) 'محل اختبار' still matches by name (no regression).
 *
 * NOT DRIVEN: the frontend SearchToolbar (untouched); the supplier
 * predicate (untouched).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { buildCustomerSearchPredicate } from '../../src/modules/partners/helpers/partners-listing.helper';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE customers (
      id bigint PRIMARY KEY, tenant_id text, name text, phone text,
      metadata text, address text, customer_type text,
      company_name text, tax_number text, balance numeric DEFAULT 0,
      credit_limit numeric DEFAULT 0
    );
  `);
  return { pg, db };
}

async function searchIds(db: Kysely<Database>, q: string): Promise<number[]> {
  const predicate = buildCustomerSearchPredicate(q);
  const query = db.selectFrom('customers').select(['id']);
  const rows = await (predicate ? query.where(predicate) : query).execute();
  return (rows as Array<{ id: number }>).map((r) => Number(r.id)).sort((a, b) => a - b);
}

(async () => {
  const { pg, db } = await makeDb();
  try {
    const anyDb = db as any;
    await anyDb
      .insertInto('customers')
      .values([
        { id: 3060, tenant_id: 't1', name: 'محل اختبار جملة 1', phone: '01122220001', metadata: '{}', address: '', customer_type: 'wholesale', company_name: '', tax_number: '' },
        { id: 3061, tenant_id: 't1', name: 'عميل آخر', phone: '01000000000', metadata: '{}', address: '', customer_type: 'cash', company_name: '', tax_number: '' },
      ])
      .execute();

    // (a) The exact normalized term the toolbar sends.
    assert.deepEqual(await searchIds(db, 'c 3060'), [3060], "search 'c 3060' must match id 3060");
    // (b) The raw code with hyphen still works.
    assert.deepEqual(await searchIds(db, 'C-3060'), [3060], "search 'C-3060' must match id 3060");
    // (c) Bare digits still work.
    assert.deepEqual(await searchIds(db, '3060'), [3060], "search '3060' must match id 3060");
    // (d) Name search is not regressed.
    assert.deepEqual(await searchIds(db, 'محل اختبار'), [3060], "search by name must still match id 3060");

    console.log('customer-search-by-code.spec passed');
  } finally {
    await db.destroy();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
