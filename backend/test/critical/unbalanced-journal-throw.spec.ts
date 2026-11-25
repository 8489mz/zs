import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

/*
 * INV-UNBALANCED-JOURNAL-THROW: the posting boundary's unbalanced-journal
 * throw, pinned directly.
 *
 * THE GAP: journal-posting-core.service.ts:389 throws UNBALANCED_JOURNAL
 * (400) when |debit - credit| exceeds one minor unit, and :406 throws
 * the same code as a second hard check after the rounding plug — but
 * no spec asserted the throw itself. The only mention of
 * UNBALANCED_JOURNAL in backend/test/ was a comment in
 * manual-journal-book-digits.spec.ts:41. A future refactor could have
 * silently dropped the throw (or widened the band) and nothing would
 * have failed. The manual-journal cases that reject an unbalanced
 * entry assert the manual path's own Arabic message, not this code.
 *
 * WHAT THIS PINS, driving the REAL AccountingPostingService boundary
 * (postDomainJournal) on PGlite — same harness shape as the
 * manual-journal spec, fresh database per case, foundation stubbed
 * to a no-op because foundation seeding is a separate setup path:
 * - EGP (2dp): debit 100.03 / credit 100.00 rejects with code
 *   UNBALANCED_JOURNAL, status 400, and stores no entry.
 * - KWD (3dp): debit 100.002 / credit 100.000 rejects with the
 *   same code and stores no entry (two minor units over).
 * - Balanced control (EGP 100 / 100) posts through the same call:
 *   stored, status posted, JE-######## number, both lines exact.
 *   This proves the throw cases reach a working boundary, not a
 *   broken path that rejects everything.
 * - Plug boundary (EGP): debit 100.01 / credit 100.00 — exactly
 *   one minor unit — does NOT throw; it plugs exactly 0.01 into
 *   account 7290 and posts. The throw fires only ABOVE one minor
 *   unit; the plug owns exactly one.
 * - Static pin: the core file carries exactly two
 *   UNBALANCED_JOURNAL throw sites (the pre-plug check and the
 *   post-plug hard check).
 *
 * Fail-first: neutralising either throw lets the unbalanced case
 * post (or fall through to the plug), so the rejects assertion
 * fails. Verified by temporarily mutating the core and watching
 * this spec fail, then restoring it byte-identical.
 *
 * Prospective only. This is not an end-to-end post on live Postgres.
 */

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, allow_manual_entries boolean, is_control_account boolean, is_receivable boolean, is_payable boolean, is_inventory boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, cash_flow_category text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, balance numeric DEFAULT 0, is_active boolean);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, balance numeric DEFAULT 0, is_active boolean);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, stock_qty numeric, cost_price numeric, is_active boolean);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (10, 't1', '1110', 'الخزينة', 'Cash', 'asset', true, false, NULL, true, false, false, false, false),
      (20, 't1', '9001', 'إيرادات', 'Revenue', 'revenue', true, false, NULL, true, false, false, false, false),
      (70, 't1', '7290', 'فروق تقريب', 'Rounding', 'expense', true, false, NULL, true, false, false, false, false);
    INSERT INTO cost_centers VALUES (7, 't1');
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db
    .insertInto('settings' as never)
    .values({ tenant_id: 't1', key: 'currency', value: `"${code}"` } as never)
    .execute();
  await db
    .insertInto('currency_exchange_rates' as never)
    .values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never)
    .execute();
}

function makePosting(db: Kysely<Database>): AccountingPostingService {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  return new AccountingPostingService(fakeFoundation);
}

function journalParams(debit: number, credit: number): Parameters<AccountingPostingService['postDomainJournal']>[1] {
  return {
    sourceType: 'manual',
    sourceId: 0,
    tenantId: 't1',
    accountId: 'a1',
    entryDate: '2026-10-01',
    description: 'unbalanced throw probe',
    createdBy: 1,
    lines: [
      { accountId: 10, description: 'cash', debit, credit: 0, partnerType: 'none', partnerId: null },
      { accountId: 20, description: 'revenue', debit: 0, credit, partnerType: 'none', partnerId: null },
    ],
  };
}

async function entryCount(db: Kysely<Database>): Promise<number> {
  const row = (await (db as any)
    .selectFrom('journal_entries')
    .select((eb: any) => eb.fn.countAll().as('n'))
    .executeTakeFirst()) as unknown as { n: string };
  return Number(row.n);
}

async function postedLines(
  db: Kysely<Database>,
  entryId: number,
): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const rows = (await (db as any)
    .selectFrom('journal_entry_lines')
    .select(['account_id', 'debit', 'credit'])
    .where('journal_entry_id', '=', entryId)
    .orderBy('id')
    .execute()) as unknown as Array<{ account_id: number; debit: string; credit: string }>;
  return rows.map((row) => ({
    accountId: Number(row.account_id),
    debit: Number(row.debit),
    credit: Number(row.credit),
  }));
}

function isUnbalancedThrow(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const statusCode = (error as { statusCode?: number }).statusCode;
  const message = error instanceof Error ? error.message : '';
  return code === 'UNBALANCED_JOURNAL' && statusCode === 400 && /Unbalanced journal/.test(message);
}

async function main(): Promise<void> {
  // Case 1: EGP unbalanced by 0.03 — above one minor unit, throws.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      const posting = makePosting(db);
      await assert.rejects(posting.postDomainJournal(db, journalParams(100.03, 100.0)), isUnbalancedThrow);
      assert.equal(await entryCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: KWD unbalanced by 0.002 — two minor units, throws.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const posting = makePosting(db);
      await assert.rejects(posting.postDomainJournal(db, journalParams(100.002, 100.0)), isUnbalancedThrow);
      assert.equal(await entryCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: balanced control — same call posts, proving the boundary works.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      const posting = makePosting(db);
      const entryId = await posting.postDomainJournal(db, journalParams(100, 100));
      assert.ok(Number(entryId) > 0);
      assert.equal(await entryCount(db), 1);
      const entry = (await (db as any)
        .selectFrom('journal_entries')
        .selectAll()
        .where('id', '=', entryId)
        .executeTakeFirst()) as unknown as { status: string; entry_no: string; source_type: string };
      assert.equal(entry.status, 'posted');
      assert.equal(entry.source_type, 'manual');
      assert.match(entry.entry_no, /^JE-\d{8}$/);
      const lines = await postedLines(db, Number(entryId));
      assert.equal(lines.length, 2);
      assert.deepEqual(lines[0], { accountId: 10, debit: 100, credit: 0 });
      assert.deepEqual(lines[1], { accountId: 20, debit: 0, credit: 100 });
    } finally {
      await db.destroy();
    }
  }

  // Case 4: EGP exactly one minor unit — plugs 0.01 into 7290, no throw.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      const posting = makePosting(db);
      const entryId = await posting.postDomainJournal(db, journalParams(100.01, 100.0));
      assert.equal(await entryCount(db), 1);
      const lines = await postedLines(db, Number(entryId));
      assert.equal(lines.length, 3);
      assert.deepEqual(lines[2], { accountId: 70, debit: 0, credit: 0.01 });
    } finally {
      await db.destroy();
    }
  }

  // Case 5: static pin — exactly two UNBALANCED_JOURNAL throw sites
  // in the core (pre-plug check + post-plug hard check).
  {
    const core = readFileSync(
      resolve(__dirname, '../../src/modules/accounting/services/journal-posting-core.service.ts'),
      'utf8',
    );
    const sites = core.split('UNBALANCED_JOURNAL').length - 1;
    assert.equal(sites, 2, 'the core must carry exactly two UNBALANCED_JOURNAL throw sites');
    assert.ok(
      core.includes('throw new AppError(`Unbalanced journal for ${params.sourceType} #${params.sourceId}: debit='),
      'pre-plug throw must name the totals',
    );
    assert.ok(
      core.includes('throw new AppError(`Unbalanced journal for ${params.sourceType} #${params.sourceId}`'),
      'post-plug hard check must exist',
    );
  }

  console.log('unbalanced-journal-throw: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
