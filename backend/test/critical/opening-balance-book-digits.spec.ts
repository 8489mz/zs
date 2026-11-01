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
 * Opening-balance posting at book digits (INV-OPENING-BALANCE-POSTING-BOOK-DIGITS).
 *
 * THE GAP: postOpeningBalances inserted its journal header and lines
 * directly (insertInto journal_entries / journal_entry_lines),
 * rounding every amount with a hardcoded two-decimal helper
 * (Number(n.toFixed(2))). It never called the canonical posting
 * boundary (AccountingPostingService.insertPostedJournal, reached
 * through postDomainJournal) and never resolved tenantBaseCurrency
 * in the chain. A KWD cash opening of 100.125 posted as 100.13,
 * with no downstream re-rounding to recover the third decimal.
 * (The partner-opening writers were already pinned by
 * opening-balance-book-precision.spec.ts; this path was not.)
 *
 * THE RULE: the opening-balance computation rounds once with
 * roundMoney at the tenant's book digits, and the post goes through
 * the posting boundary. The standalone preview and the post share
 * one computation (buildOpeningBalancesPreview). Post re-runs it
 * inside its transaction on the transaction handle and posts the
 * RECOMPUTED lines through the boundary; preview and post can
 * never disagree.
 *
 * DECISIONS, grounded in existing codebase patterns (flagged loudly):
 * (1) Preview on currency mismatch FAILS CLOSED. tenantBaseCurrency
 *     throws on a settings/rate mismatch, and the posting boundary
 *     resolves digits on the caller's handle the same way (P0-1
 *     chose fail-closed for the fiscal close on the same pattern).
 *     No lenient 2dp fallback: a lenient preview would show totals
 *     the post would refuse to book.
 * (2) Digits are resolved SEPARATELY on the transaction handle at
 *     post time, behind an EXACT-EQUALITY drift guard (per line and
 *     for the totals), NOT shared from the preview. The preview is
 *     computed outside the transaction on a different handle with
 *     possibly different digits; posting it verbatim would bake in
 *     stale precision. The recomputation under the period lock is
 *     the single source of truth. This mirrors P0-1.
 *
 * DELIBERATELY UNCHANGED, as separate scope:
 * - The private toMoney 2dp helper still shapes other responses;
 *   it is never used by the opening-balance computation.
 * - PartnersService partner openings are untouched (already pinned
 *   by their own spec); catalog opening stock is a separate
 *   package (P1-3); manual journals are a separate package (P0-3).
 * - The once-per-tenant guard stays: a second post returns
 *   alreadyPosted with the existing entry id, and the unique index
 *   on (tenant_id) for posted opening_balance entries is untouched.
 * - sourceId 0 follows the forex-revaluation precedent for a
 *   sourceless journal through postDomainJournal; no lookup keys
 *   on source_id for this source type.
 *
 * BEHAVIOR CHANGE, fail-closed and deliberate: the boundary also
 * runs assertAutomatedJournalPeriodOpen, whose operational-lock
 * check (lock_date_non_adviser) has NO admin exemption, while the
 * old path's assertNotInLockedPeriod exempted admins. An admin
 * posting opening balances into an operationally locked period
 * is now rejected instead of posted. This is the canonical lock
 * behavior every other automated posting already has; it is
 * pinned below as proof the boundary is actually reached.
 *
 * FLOAT ORDER: roundMoney rounds the binary float product, so an
 * exact decimal half may land on the float side rather than the
 * decimal side toFixed would pick. The cases below pin identity
 * with the canonical engine, not decimal-half behavior.
 *
 * WHAT THIS PINS, driving the REAL AccountingService + the REAL
 * posting boundary on PGlite (fresh database per case; the tenant
 * foundation service is stubbed to a no-op because foundation
 * seeding is a separate setup path, not the posting computation):
 * - 3dp full post (KWD): cash 100.125 posts exactly 100.125 with
 *   a matching 100.125 capital credit, no 7290 plug line, preview
 *   totals agree with the posted lines, second post is
 *   alreadyPosted with the same entry id.
 * - 2dp identity (EGP): 100.125 / 50.125 become 100.13 / 50.13.
 * - Fail-closed digits: a base-currency/rate mismatch rejects the
 *   preview and the post with no stored change.
 * - Post uses CURRENT digits, not a stale preview: changing the
 *   currency from KWD to EGP between preview and post posts at
 *   2dp (100.13), never the stale 3dp preview lines.
 * - Boundary lock behavior: an operationally locked period rejects
 *   the post (proving the boundary runs).
 * This is not an end-to-end post on live Postgres.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, allow_manual_entries boolean, is_control_account boolean, is_receivable boolean, is_payable boolean, is_inventory boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, balance numeric DEFAULT 0, is_active boolean);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, balance numeric DEFAULT 0, is_active boolean);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, stock_qty numeric, cost_price numeric, is_active boolean);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (10, 't1', '1110', 'الخزينة', 'Cash', 'asset', true, false, NULL, true, false, false, false, false),
      (20, 't1', '1120', 'البنك', 'Bank', 'asset', true, false, NULL, true, false, false, false, false),
      (30, 't1', '1130', 'عملاء', 'Receivables', 'asset', true, false, NULL, true, false, true, false, false),
      (40, 't1', '1140', 'مخزون', 'Inventory', 'asset', true, false, NULL, true, false, false, false, true),
      (50, 't1', '2110', 'موردون', 'Payables', 'liability', true, false, NULL, true, false, false, true, false),
      (60, 't1', '3100', 'رأس المال', 'Capital', 'equity', true, false, NULL, true, false, false, false, false),
      (70, 't1', '7290', 'فروق تقريب', 'Rounding', 'expense', true, false, NULL, true, false, false, false, false);
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: `"${code}"` } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makeServices(db: Kysely<Database>): AccountingService {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new AccountingService(db as any, fakeFoundation, posting as any);
}

async function postedLines(db: Kysely<Database>, entryId: number): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const rows = await (db as any)
    .selectFrom('journal_entry_lines')
    .select(['account_id', 'debit', 'credit'])
    .where('journal_entry_id', '=', entryId)
    .orderBy('id')
    .execute() as unknown as Array<{ account_id: number; debit: string; credit: string }>;
  return rows.map((row) => ({ accountId: Number(row.account_id), debit: Number(row.debit), credit: Number(row.credit) }));
}

async function main(): Promise<void> {
  // Case 1: KWD (3dp) full post through the boundary.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const svc = makeServices(db);
      const body = { system_start_date: '2026-01-01', cash_opening: 100.125, bank_opening: 0 } as any;
      const preview = await svc.previewOpeningBalances(body, auth) as unknown as {
        totals: { cashOpening: number; bankOpening: number; balancingCapital: number };
        linesPreview: Array<{ accountCode: string; debit: number; credit: number }>;
      };
      assert.equal(preview.totals.cashOpening, 100.125);
      assert.equal(preview.totals.balancingCapital, 100.125);
      assert.equal(preview.linesPreview.length, 2);
      assert.equal(preview.linesPreview[0].accountCode, '1110');
      assert.equal(preview.linesPreview[0].debit, 100.125);
      assert.equal(preview.linesPreview[1].accountCode, '3100');
      assert.equal(preview.linesPreview[1].credit, 100.125);

      const result = await svc.postOpeningBalances(body, auth) as unknown as {
        posted: boolean; journalEntryId: string;
        preview: { totals: { cashOpening: number; balancingCapital: number } };
      };
      assert.equal(result.posted, true);
      const entryId = Number(result.journalEntryId);
      assert.ok(entryId > 0);
      assert.equal(result.preview.totals.cashOpening, 100.125);
      assert.equal(result.preview.totals.balancingCapital, 100.125);

      const entry = await (db as any).selectFrom('journal_entries').selectAll().where('id', '=', entryId).executeTakeFirst() as unknown as {
        source_type: string; source_id: number | null; status: string; entry_no: string;
      };
      assert.equal(entry.source_type, 'opening_balance');
      assert.equal(entry.source_id, 0);
      assert.equal(entry.status, 'posted');
      assert.match(entry.entry_no, /^JE-\d{8}$/);

      const lines = await postedLines(db, entryId);
      assert.equal(lines.length, 2);
      assert.deepEqual(lines[0], { accountId: 10, debit: 100.125, credit: 0 });
      assert.deepEqual(lines[1], { accountId: 60, debit: 0, credit: 100.125 });
      assert.ok(!lines.some((line) => line.accountId === 70), 'no 7290 rounding plug line');

      const again = await svc.postOpeningBalances(body, auth) as unknown as { posted: boolean; alreadyPosted: boolean; journalEntryId: string };
      assert.equal(again.posted, false);
      assert.equal(again.alreadyPosted, true);
      assert.equal(again.journalEntryId, String(entryId));
    } finally {
      await db.destroy();
    }
  }

  // Case 2: EGP (2dp) identity — 100.125 / 50.125 round to 100.13 / 50.13.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      const svc = makeServices(db);
      const body = { system_start_date: '2026-01-01', cash_opening: 100.125, bank_opening: 50.125 } as any;
      const preview = await svc.previewOpeningBalances(body, auth) as unknown as {
        totals: { cashOpening: number; bankOpening: number; balancingCapital: number };
      };
      assert.equal(preview.totals.cashOpening, 100.13);
      assert.equal(preview.totals.bankOpening, 50.13);
      assert.equal(preview.totals.balancingCapital, 150.26);
      const result = await svc.postOpeningBalances(body, auth) as unknown as { posted: boolean; journalEntryId: string };
      assert.equal(result.posted, true);
      const lines = await postedLines(db, Number(result.journalEntryId));
      assert.equal(lines.length, 3);
      assert.deepEqual(lines[0], { accountId: 10, debit: 100.13, credit: 0 });
      assert.deepEqual(lines[1], { accountId: 20, debit: 50.13, credit: 0 });
      assert.deepEqual(lines[2], { accountId: 60, debit: 0, credit: 150.26 });
    } finally {
      await db.destroy();
    }
  }

  // Case 3: fail closed on a base-currency/rate mismatch — no stored change.
  {
    const { pg, db } = await makeDb();
    try {
      await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: '"KWD"' } as never).execute();
      await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: 'EGP', exchange_rate: 1, is_base: true } as never).execute();
      const svc = makeServices(db);
      const body = { system_start_date: '2026-01-01', cash_opening: 100.125 } as any;
      await assert.rejects(() => svc.previewOpeningBalances(body, auth));
      await assert.rejects(() => svc.postOpeningBalances(body, auth));
      const entries = await db.selectFrom('journal_entries' as never).selectAll().execute();
      assert.equal(entries.length, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: post uses CURRENT digits, never a stale preview.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const svc = makeServices(db);
      const body = { system_start_date: '2026-01-01', cash_opening: 100.125 } as any;
      const preview = await svc.previewOpeningBalances(body, auth) as unknown as { totals: { cashOpening: number } };
      assert.equal(preview.totals.cashOpening, 100.125);
      // Currency changes between preview and post: settings + rates move to EGP.
      await (db as any).updateTable('settings').set({ value: '"EGP"' }).where('tenant_id', '=', 't1').where('key', '=', 'currency').execute();
      await (db as any).updateTable('currency_exchange_rates').set({ currency_code: 'EGP' }).where('tenant_id', '=', 't1').execute();
      const result = await svc.postOpeningBalances(body, auth) as unknown as { posted: boolean; journalEntryId: string };
      assert.equal(result.posted, true);
      const lines = await postedLines(db, Number(result.journalEntryId));
      assert.equal(lines.length, 2);
      assert.deepEqual(lines[0], { accountId: 10, debit: 100.13, credit: 0 });
      assert.deepEqual(lines[1], { accountId: 60, debit: 0, credit: 100.13 });
    } finally {
      await db.destroy();
    }
  }

  // Case 5: boundary lock behavior — an operationally locked period rejects the post.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await (db as any).updateTable('accounting_settings').set({ lock_date_non_adviser: '2026-06-30' }).where('tenant_id', '=', 't1').execute();
      const svc = makeServices(db);
      const body = { system_start_date: '2026-01-01', cash_opening: 50 } as any;
      await assert.rejects(() => svc.postOpeningBalances(body, auth), (err: any) => err?.code === 'ACCOUNTING_PERIOD_LOCKED_OPERATIONAL');
      const entries = await db.selectFrom('journal_entries' as never).selectAll().execute();
      assert.equal(entries.length, 0);
    } finally {
      await db.destroy();
    }
  }

  // Source pin: the preview->post slice routes through the boundary
  // at book digits, with no direct journal insert and no 2dp helper.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/accounting/accounting.service.ts'), 'utf8');
    const start = source.indexOf('async previewOpeningBalances(');
    const end = source.indexOf('async createDraftJournalEntry(');
    assert.ok(start > 0 && end > start);
    const body = source.slice(start, end);
    assert.ok(body.includes('postDomainJournal('), 'opening-balance post must go through the posting boundary');
    assert.ok(body.includes('tenantBaseCurrency(this.db,'), 'preview resolves digits on the pool handle');
    assert.ok(body.includes('tenantBaseCurrency(trx,'), 'post resolves digits on the transaction handle');
    assert.ok(body.includes('buildOpeningBalancesPreview('), 'preview and post share one computation');
    assert.ok(body.includes('toBookMoney('), 'opening-balance computation rounds at book digits');
    assert.ok(!body.includes("insertInto('journal_entries')"), 'no direct journal header insert in the opening-balance path');
    assert.ok(!body.includes("insertInto('journal_entry_lines')"), 'no direct journal line insert in the opening-balance path');
    assert.ok(!body.includes('this.toMoney('), 'opening-balance path must not use the 2dp helper');
    assert.ok(!body.includes('.toFixed(2)'), 'opening-balance path must not hardcode 2dp formatting');
    assert.ok(!body.includes('> 0.0001'), 'the old 0.0001 balance tolerance is removed');
  }

  console.log('opening-balance-book-digits: all cases passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
