import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { FiscalYearService } from '../../src/modules/accounting/services/fiscal-year.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Fiscal-year close at book digits (INV-FISCAL-YEAR-CLOSE-BOOK-DIGITS).
 *
 * THE GAP: previewFiscalYearClose computed every closing balance with
 * a hardcoded two-decimal helper (Number(n.toFixed(2))), and
 * executeFiscalYearClose posted those preview lines verbatim. The
 * posting boundary re-rounds at book digits but cannot recover a
 * truncation: a true P&L net of 100.125 posted as 100.13, leaving a
 * 0.005 residual in the P&L accounts, and a 0.004 net was dropped
 * entirely. A 0.009 drift band hid precision loss between preview
 * and post, and a 0.05 balance band tolerated a real imbalance.
 *
 * THE RULE: the close computation rounds once with roundMoney at the
 * tenant's book digits. The standalone preview and the execute path
 * share one computation (buildFiscalYearClosePreview). Execute
 * re-runs it inside its transaction on the transaction handle and
 * posts the RECOMPUTED lines; preview and post can never disagree.
 *
 * DECISIONS, grounded in existing codebase patterns (flagged loudly):
 * (1) Currency mismatch fails closed. tenantBaseCurrency throws on
 *     a settings/rate mismatch, and the posting boundary
 *     (insertPostedJournal) resolves digits on the caller's handle
 *     the same way. No lenient 2dp fallback: a lenient preview would
 *     show totals the post would refuse to book.
 * (2) Drift tolerance is EXACT equality at book digits, per account
 *     and for the totals. Precedent: the boundary's own balance
 *     check (>= half a minor unit fails, plug only within one minor
 *     unit) and the close's per-account drift guard intent (detect
 *     ANY change). The old 0.009 band and the old 0.05 balance band
 *     are removed: the close is balanced by construction, so any
 *     imbalance after rounding is a real bug, not float dust.
 * (3) Recompute-at-post, NOT preview-verbatim-with-guard. The
 *     preview is computed outside the transaction on a different
 *     handle with possibly different digits; posting it verbatim
 *     would bake in stale precision. The recomputation (under the
 *     period lock, after the drafts re-check) is the single source
 *     of truth for posted lines and stored totals.
 *
 * DELIBERATELY UNCHANGED, as separate scope:
 * - The private toMoney 2dp helper still shapes list/get responses
 *   (stored fiscal-year totals displayed back); it is never used by
 *   the close computation.
 * - reopenFiscalYear reverses the STORED closing entry verbatim; it
 *   recomputes nothing and is untouched.
 * - recognizeInstallmentInterest is stubbed to a no-op in this
 *   harness (it is a separate accrual path, driven before the
 *   preview); the close computation and the real posting boundary
 *   (postDomainJournal/insertPostedJournal) run for real.
 *
 * FLOAT ORDER: roundMoney rounds the binary float product, so an
 * exact decimal half may land on the float side rather than the
 * decimal side toFixed would pick. The cases below use ordinary
 * amounts (100.125 is exact in neither base, but its float product
 * rounds to 100.125 at 3dp as asserted) and pin identity with the
 * canonical engine, not decimal-half behavior.
 *
 * WHAT THIS PINS, driving the REAL FiscalYearService + posting
 * boundary on PGlite (fresh database per case):
 * - 3dp full close (KWD): P&L net 100.125 posts exactly 100.125,
 *   no 7290 plug line, P&L accounts zeroed, stored totals 100.125.
 * - 2dp identity (EGP): net 100.12 posts 100.12.
 * - Drift guard: a posting that lands after the preview fails the
 *   close (stale-preview simulation via a captured preview), the
 *   year stays open, no closing entry is created.
 * - Fail-closed digits: a base-currency/rate mismatch rejects the
 *   preview and the execute with no stored change.
 * This is not an end-to-end close on live Postgres.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
    CREATE TABLE accounting_fiscal_years (id bigint PRIMARY KEY, tenant_id text, name text, code text, start_date date, end_date date, status text, closing_entry_id bigint, net_profit_loss numeric, total_revenue numeric, total_expense numeric, retained_earnings_account_id bigint, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE accounting_installment_interest (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, recognition_date date);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, resolved_at timestamptz);
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, status text, created_at timestamptz, total numeric, exchange_return_id bigint);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, qty numeric, cost_price numeric);
    CREATE TABLE purchases (id bigserial PRIMARY KEY, tenant_id text, status text, created_at timestamptz, total numeric);
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, created_at timestamptz, total numeric, return_type text, exchange_return_id bigint);
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, qty numeric, cost_price numeric);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts VALUES
      (10, 't1', '4100', 'إيرادات', 'Revenue', 'revenue', true, false, NULL),
      (20, 't1', '5100', 'مصروفات', 'Expenses', 'expense', true, false, NULL),
      (30, 't1', '3200', 'أرباح محتجزة', 'Retained', 'equity', true, false, NULL),
      (40, 't1', '7290', 'فروق تقريب', 'Rounding', 'expense', true, false, NULL);
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string, baseCode?: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: code } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: baseCode ?? code, exchange_rate: 1, is_base: true } as never).execute();
}

async function seedYear(db: Kysely<Database>, id: number): Promise<void> {
  await db.insertInto('accounting_fiscal_years' as never).values({
    id, tenant_id: 't1', name: 'FY2025', code: 'FY25',
    start_date: '2025-01-01', end_date: '2025-12-31', status: 'open',
    closing_entry_id: null, net_profit_loss: null, total_revenue: null, total_expense: null,
    retained_earnings_account_id: null, closed_at: null, closed_by: null, closing_notes: null,
    updated_at: new Date(),
  } as never).execute();
}

async function seedPostedEntry(
  db: Kysely<Database>,
  lines: Array<{ accountId: number; debit: number; credit: number }>,
): Promise<number> {
  const inserted = await db.insertInto('journal_entries' as never).values({
    tenant_id: 't1', account_id: 'a1', entry_no: 'JE-SEED', dedup_key: null,
    entry_date: '2025-06-15', description: 'seed', source_type: 'sale', source_id: 1,
    status: 'posted', branch_id: null, location_id: null, created_by: 1, posted_by: 1,
    posted_at: new Date(), reversal_of_entry_id: null, reversed_by_entry_id: null, updated_at: new Date(),
  } as never).returning('id' as never).executeTakeFirstOrThrow() as unknown as { id: number };
  const entryId = Number((inserted as any).id);
  for (const line of lines) {
    await db.insertInto('journal_entry_lines' as never).values({
      tenant_id: 't1', journal_entry_id: entryId, account_id: line.accountId, cost_center_id: null,
      description: 'seed', debit: line.debit, credit: line.credit,
      partner_type: 'none', partner_id: null, branch_id: null, location_id: null,
    } as never).execute();
  }
  return entryId;
}

function buildService(db: Kysely<Database>): FiscalYearService {
  const posting = new AccountingPostingService({
    ensureForScope: async () => {
      throw new Error('ensureForScope must not run for a balanced close');
    },
  } as never);
  (posting as any).recognizeInstallmentInterest = async () => {};
  const service = Object.create(FiscalYearService.prototype) as any;
  service.db = db;
  service.accountingPosting = posting;
  return service as FiscalYearService;
}

async function closingLines(db: Kysely<Database>): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .innerJoin('journal_entries', 'journal_entries.id', 'journal_entry_lines.journal_entry_id')
    .select(['journal_entry_lines.account_id', 'journal_entry_lines.debit', 'journal_entry_lines.credit'])
    .where('journal_entries.source_type', '=', 'fiscal_year_closing')
    .execute() as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({ accountId: Number(r.account_id), debit: Number(r.debit), credit: Number(r.credit) }));
}

async function accountNet(db: Kysely<Database>, accountId: number): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .select(['debit', 'credit'])
    .where('account_id', '=', accountId)
    .execute() as unknown as Array<Record<string, unknown>>;
  return rows.reduce((sum, r) => sum + Number(r.debit) - Number(r.credit), 0);
}

async function main(): Promise<void> {
  // 1. 3dp full close (KWD): net 100.125 posts exactly, no plug, accounts zeroed.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedYear(db, 1);
      await seedPostedEntry(db, [
        { accountId: 10, debit: 0, credit: 200.25 },
        { accountId: 20, debit: 100.125, credit: 0 },
      ]);
      const service = buildService(db);
      const preview = await service.previewFiscalYearClose(auth, 1);
      assert.equal(preview.canClose, true);
      assert.equal(preview.totalRevenue, 200.25);
      assert.equal(preview.totalExpense, 100.125);
      assert.equal(preview.netProfitLoss, 100.125);
      assert.deepEqual(
        preview.proposedClosingLines.map((l) => [l.accountId, l.debit, l.credit]),
        [[10, 200.25, 0], [20, 0, 100.125], [30, 0, 100.125]],
      );
      await service.executeFiscalYearClose(auth, 1, {});
      const lines = await closingLines(db);
      assert.equal(lines.length, 3, 'closing entry must have exactly the 3 close lines, no 7290 plug');
      assert.deepEqual(
        lines.map((l) => [l.accountId, l.debit, l.credit]).sort((a, b) => a[0] - b[0]),
        [[10, 200.25, 0], [20, 0, 100.125], [30, 0, 100.125]],
      );
      assert.equal(await accountNet(db, 10), 0, 'revenue account must be zeroed exactly');
      assert.equal(await accountNet(db, 20), 0, 'expense account must be zeroed exactly');
      const fy = await db.selectFrom('accounting_fiscal_years').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal((fy as any).status, 'closed');
      assert.equal(Number((fy as any).net_profit_loss), 100.125);
      assert.equal(Number((fy as any).total_revenue), 200.25);
      assert.equal(Number((fy as any).total_expense), 100.125);
    } finally {
      await db.destroy();
    }
  }

  // 2. 2dp identity (EGP): net 100.12 posts 100.12.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedYear(db, 1);
      await seedPostedEntry(db, [{ accountId: 10, debit: 0, credit: 100.12 }]);
      const service = buildService(db);
      const preview = await service.previewFiscalYearClose(auth, 1);
      assert.equal(preview.netProfitLoss, 100.12);
      await service.executeFiscalYearClose(auth, 1, {});
      const lines = await closingLines(db);
      assert.deepEqual(
        lines.map((l) => [l.accountId, l.debit, l.credit]).sort((a, b) => a[0] - b[0]),
        [[10, 100.12, 0], [30, 0, 100.12]],
      );
    } finally {
      await db.destroy();
    }
  }

  // 3. Drift guard: a posting that lands after the preview fails the close.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedYear(db, 1);
      await seedPostedEntry(db, [
        { accountId: 10, debit: 0, credit: 200.25 },
        { accountId: 20, debit: 100.125, credit: 0 },
      ]);
      const service = buildService(db);
      const stale = await service.previewFiscalYearClose(auth, 1);
      await seedPostedEntry(db, [{ accountId: 10, debit: 0, credit: 0.005 }]);
      (service as any).previewFiscalYearClose = async () => stale;
      await assert.rejects(
        () => service.executeFiscalYearClose(auth, 1, {}),
        /تغير رصيد/,
      );
      const fy = await db.selectFrom('accounting_fiscal_years').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal((fy as any).status, 'open');
      assert.equal((await closingLines(db)).length, 0, 'no closing entry may be created on drift');
    } finally {
      await db.destroy();
    }
  }

  // 4. Fail-closed digits: base-currency/rate mismatch rejects preview and execute.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD', 'EGP');
      await seedYear(db, 1);
      await seedPostedEntry(db, [{ accountId: 10, debit: 0, credit: 100 }]);
      const service = buildService(db);
      await assert.rejects(() => service.previewFiscalYearClose(auth, 1), /عملة الأساس/);
      await assert.rejects(() => service.executeFiscalYearClose(auth, 1, {}), /عملة الأساس/);
      const fy = await db.selectFrom('accounting_fiscal_years').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal((fy as any).status, 'open');
      assert.equal((await closingLines(db)).length, 0);
    } finally {
      await db.destroy();
    }
  }

  // 5. Source pin: the close path uses book digits on the caller's
  // handle and keeps no 2dp computation or tolerance band. The
  // private toMoney helper remains only for list/get shaping.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/accounting/services/fiscal-year.service.ts'), 'utf8');
    const start = source.indexOf('async previewFiscalYearClose(');
    const end = source.indexOf('async reopenFiscalYear(');
    assert.ok(start > 0 && end > start);
    const body = source.slice(start, end);
    assert.ok(body.includes('tenantBaseCurrency(this.db, tenantId)'));
    assert.ok(body.includes('tenantBaseCurrency(trx, tenantId)'));
    assert.ok(body.includes('buildFiscalYearClosePreview('));
    assert.ok(body.includes('toBookMoney('));
    assert.ok(!body.includes('this.toMoney('), 'close path must not use the 2dp helper');
    assert.ok(!body.includes('.toFixed(2)'), 'close path must not hardcode 2dp formatting');
    assert.ok(!body.includes('> 0.009'), 'drift band must be exact equality, not 0.009');
    assert.ok(!body.includes('> 0.05'), 'balance band must be exact equality, not 0.05');
    assert.ok(source.includes('private toMoney('), 'list/get display helper stays, untouched');
  }

  console.log('fiscal-close-book-digits: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
