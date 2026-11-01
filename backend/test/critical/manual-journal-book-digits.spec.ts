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
 * Manual journal entry at book digits (INV-MANUAL-JOURNAL-BOOK-DIGITS).
 *
 * THE GAP: createManualJournalEntry rounded every line, the totals
 * and the balance/plug bands with a hardcoded two-decimal helper
 * (Number(n.toFixed(2))), tolerated an imbalance of up to 0.05, and
 * plugged differences of >= 0.001 into 7290. It then inserted the
 * journal header and lines directly (insertInto journal_entries /
 * journal_entry_lines with a JE-TMP temp number), bypassing the
 * canonical posting boundary (AccountingPostingService), and never
 * resolved tenantBaseCurrency in the chain. A KWD manual entry of
 * debit 100.125 / credit 100.000 posted 100.13 / 100.00 with a
 * 0.13 plug line; a 0.03 imbalance passed the 0.05 band and was
 * plugged as if it were rounding dust.
 *
 * THE RULE: manual-journal lines, totals, the balance band and the
 * plug trigger are computed at the tenant's book digits, resolved
 * on the transaction handle, and the entry posts through the
 * posting boundary (postDomainJournal / insertPostedJournal). The
 * boundary owns numbering, re-rounding and the balance/plug
 * backstop; the manual eligibility checks (manual-entry accounts,
 * control accounts, mapped controls, tax period, references) stay
 * in the manual path because the boundary checks active accounts
 * only.
 *
 * DECISIONS, grounded in existing codebase patterns (flagged loudly):
 * (1) Balance band = ONE MINOR UNIT. The boundary's own
 *     maxAllowedDifference returns 10 ** -bookDigits, and its
 *     balance check throws UNBALANCED_JOURNAL above it. The old
 *     0.05 band is replaced by that rule; the manual pre-check
 *     keeps the Arabic unbalanced message.
 * (2) Plug trigger = HALF A MINOR UNIT, the boundary's own trigger
 *     (difference >= unit / 2, plugged while <= one minor unit).
 *     After book-digit rounding a nonzero difference is exactly
 *     one minor unit, so the plug fires exactly when the rounded
 *     lines differ by one minor unit. The manual path keeps its
 *     own plug line (Arabic description 'فروق تقريب القيد') and
 *     the boundary backstops it; a difference above one minor
 *     unit fails closed in both.
 * (3) Currency mismatch FAILS CLOSED. tenantBaseCurrency throws
 *     on a settings/rate mismatch; digits are resolved on the
 *     transaction handle inside writeJournal (P0-1/P0-2 pattern).
 *     No lenient fallback: a lenient post would book totals the
 *     boundary refuses.
 *
 * DELIBERATELY UNCHANGED, as separate scope:
 * - The private toMoney 2dp helper still shapes other responses;
 *   it is never used by the manual-journal computation.
 * - Draft journal entries are a separate path and untouched.
 * - Fiscal close (P0-1) and opening balances (P0-2) are separate
 *   packages; catalog opening stock is P1-3.
 * - The 7290 lookup moved from the pool handle onto the
 *   transaction handle (same snapshot as the post); the account
 *   must still exist and be active.
 * - sourceId 0 follows the forex-revaluation precedent for a
 *   sourceless journal through postDomainJournal; 'manual' has
 *   no dedup lookup, and no lookup keys on source_id for it.
 *
 * BEHAVIOR CHANGE, fail-closed and deliberate: the boundary also
 * runs assertAutomatedJournalPeriodOpen, whose operational-lock
 * check (lock_date_non_adviser) has NO admin exemption, while the
 * old path's assertNotInLockedPeriod exempted admins. An admin
 * posting a manual journal into an operationally locked period
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
 * - 3dp exact post (KWD): 100.125 / 100.125 posts exactly, no
 *   7290 plug, JE-######## number, cash_flow_category stored.
 * - 2dp identity (EGP): 100.125 / 100.125 become 100.13 / 100.13.
 * - Plug case (KWD): a one-minor-unit difference plugs exactly
 *   0.001 into 7290; a two-minor-unit difference fails closed.
 * - Old-band case (EGP): a 0.03 imbalance that the old 0.05 band
 *   would have plugged now fails closed.
 * - Fail-closed digits: a base-currency/rate mismatch rejects
 *   the post with no stored change.
 * - Boundary lock behavior: an operationally locked period
 *   rejects an admin post (proving the boundary runs).
 * - Cost-center passthrough + control-account rejection preserved.
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
      (30, 't1', '1130', 'عملاء', 'Receivables', 'asset', true, false, NULL, true, false, true, false, false),
      (70, 't1', '7290', 'فروق تقريب', 'Rounding', 'expense', true, false, NULL, true, false, false, false, false);
    INSERT INTO cost_centers VALUES (7, 't1');
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

async function postedLines(db: Kysely<Database>, entryId: number): Promise<Array<{ accountId: number; debit: number; credit: number; costCenterId: number | null }>> {
  const rows = await (db as any)
    .selectFrom('journal_entry_lines')
    .select(['account_id', 'debit', 'credit', 'cost_center_id'])
    .where('journal_entry_id', '=', entryId)
    .orderBy('id')
    .execute() as unknown as Array<{ account_id: number; debit: string; credit: string; cost_center_id: number | null }>;
  return rows.map((row) => ({ accountId: Number(row.account_id), debit: Number(row.debit), credit: Number(row.credit), costCenterId: row.cost_center_id == null ? null : Number(row.cost_center_id) }));
}

async function entryCount(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('journal_entries').select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst() as unknown as { n: string };
  return Number(row.n);
}

async function main(): Promise<void> {
  // Case 1: KWD (3dp) exact post through the boundary, no plug.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const svc = makeServices(db);
      const result = await svc.createManualJournalEntry({
        entryDate: '2026-10-01', description: 'manual kwd', cashFlowCategory: 'operating',
        lines: [
          { accountId: 10, debit: 100.125, credit: 0 },
          { accountId: 20, debit: 0, credit: 100.125 },
        ],
      } as any, auth) as unknown as { entry: { id: number; entryNo: string; totalDebit: number; totalCredit: number } };
      assert.equal(result.entry.totalDebit, 100.125);
      assert.equal(result.entry.totalCredit, 100.125);
      assert.match(result.entry.entryNo, /^JE-\d{8}$/);
      const entry = await (db as any).selectFrom('journal_entries').selectAll().where('id', '=', result.entry.id).executeTakeFirst() as unknown as {
        source_type: string; source_id: number | null; status: string; entry_no: string; cash_flow_category: string | null;
      };
      assert.equal(entry.source_type, 'manual');
      assert.equal(entry.source_id, 0);
      assert.equal(entry.status, 'posted');
      assert.equal(entry.entry_no, result.entry.entryNo);
      assert.equal(entry.cash_flow_category, 'operating');
      const lines = await postedLines(db, result.entry.id);
      assert.equal(lines.length, 2);
      assert.deepEqual(lines[0], { accountId: 10, debit: 100.125, credit: 0, costCenterId: null });
      assert.deepEqual(lines[1], { accountId: 20, debit: 0, credit: 100.125, costCenterId: null });
      assert.ok(!lines.some((line) => line.accountId === 70), 'no 7290 rounding plug line');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: EGP (2dp) identity — 100.125 / 100.125 become 100.13 / 100.13.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      const svc = makeServices(db);
      const result = await svc.createManualJournalEntry({
        entryDate: '2026-10-01', description: 'manual egp',
        lines: [
          { accountId: 10, debit: 100.125, credit: 0 },
          { accountId: 20, debit: 0, credit: 100.125 },
        ],
      } as any, auth) as unknown as { entry: { totalDebit: number; totalCredit: number } };
      assert.equal(result.entry.totalDebit, 100.13);
      assert.equal(result.entry.totalCredit, 100.13);
      const lines = await postedLines(db, (await (db as any).selectFrom('journal_entries').select('id').executeTakeFirst() as any).id);
      assert.deepEqual(lines[0], { accountId: 10, debit: 100.13, credit: 0, costCenterId: null });
      assert.deepEqual(lines[1], { accountId: 20, debit: 0, credit: 100.13, costCenterId: null });
    } finally {
      await db.destroy();
    }
  }

  // Case 3: KWD one-minor-unit difference plugs exactly 0.001 into 7290.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const svc = makeServices(db);
      const result = await svc.createManualJournalEntry({
        entryDate: '2026-10-01', description: 'manual plug',
        lines: [
          { accountId: 10, debit: 100.001, credit: 0 },
          { accountId: 20, debit: 0, credit: 100.0 },
        ],
      } as any, auth) as unknown as { entry: { id: number; totalDebit: number; totalCredit: number } };
      assert.equal(result.entry.totalDebit, 100.001);
      assert.equal(result.entry.totalCredit, 100.001);
      const lines = await postedLines(db, result.entry.id);
      assert.equal(lines.length, 3);
      assert.deepEqual(lines[2], { accountId: 70, debit: 0, credit: 0.001, costCenterId: null });
    } finally {
      await db.destroy();
    }
  }

  // Case 4: KWD two-minor-unit difference fails closed (above one minor unit).
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const svc = makeServices(db);
      await assert.rejects(svc.createManualJournalEntry({
        entryDate: '2026-10-01', description: 'manual unbalanced',
        lines: [
          { accountId: 10, debit: 100.002, credit: 0 },
          { accountId: 20, debit: 0, credit: 100.0 },
        ],
      } as any, auth), /غير متزن/);
      assert.equal(await entryCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: EGP 0.03 imbalance — the old 0.05 band would have plugged it; now it fails.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      const svc = makeServices(db);
      await assert.rejects(svc.createManualJournalEntry({
        entryDate: '2026-10-01', description: 'manual old band',
        lines: [
          { accountId: 10, debit: 100.03, credit: 0 },
          { accountId: 20, debit: 0, credit: 100.0 },
        ],
      } as any, auth), /غير متزن/);
      assert.equal(await entryCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 6: fail-closed currency mismatch — settings KWD, base rate EGP.
  {
    const { pg, db } = await makeDb();
    try {
      await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: '"KWD"' } as never).execute();
      await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: 'EGP', exchange_rate: 1, is_base: true } as never).execute();
      const svc = makeServices(db);
      await assert.rejects(svc.createManualJournalEntry({
        entryDate: '2026-10-01', description: 'manual mismatch',
        lines: [
          { accountId: 10, debit: 100, credit: 0 },
          { accountId: 20, debit: 0, credit: 100 },
        ],
      } as any, auth), /عملة الأساس/);
      assert.equal(await entryCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 7: boundary lock behavior — operationally locked period rejects an admin post.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await (db as any).updateTable('accounting_settings').set({ lock_date_non_adviser: '2026-10-01' }).where('tenant_id', '=', 't1').where('id', '=', 1).execute();
      const svc = makeServices(db);
      await assert.rejects(
        svc.createManualJournalEntry({
          entryDate: '2026-10-01', description: 'manual locked',
          lines: [
            { accountId: 10, debit: 100, credit: 0 },
            { accountId: 20, debit: 0, credit: 100 },
          ],
        } as any, auth),
        (error: unknown) => {
          const code = (error as { code?: string }).code;
          const message = error instanceof Error ? error.message : '';
          return code === 'ACCOUNTING_PERIOD_LOCKED_OPERATIONAL' || /التشغيلية/.test(message);
        },
      );
      assert.equal(await entryCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 8: cost-center passthrough + control-account rejection preserved.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const svc = makeServices(db);
      const result = await svc.createManualJournalEntry({
        entryDate: '2026-10-01', description: 'manual cost center',
        lines: [
          { accountId: 10, debit: 50, credit: 0, costCenterId: 7 },
          { accountId: 20, debit: 0, credit: 50, costCenterId: 7 },
        ],
      } as any, auth) as unknown as { entry: { id: number } };
      const lines = await postedLines(db, result.entry.id);
      assert.equal(lines[0].costCenterId, 7);
      assert.equal(lines[1].costCenterId, 7);
      await assert.rejects(svc.createManualJournalEntry({
        entryDate: '2026-10-01', description: 'manual control',
        lines: [
          { accountId: 30, debit: 50, credit: 0 },
          { accountId: 20, debit: 0, credit: 50 },
        ],
      } as any, auth), /الرقابي/);
    } finally {
      await db.destroy();
    }
  }

  // Case 9: source pin — the manual-journal slice goes through the
  // boundary at book digits, with no direct inserts and no 2dp bands.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/accounting/accounting.service.ts'), 'utf8');
    const start = source.indexOf('async createManualJournalEntry(');
    const end = source.indexOf('async reverseJournalEntry(');
    assert.ok(start > 0 && end > start);
    const body = source.slice(start, end);
    assert.ok(body.includes('postDomainJournal('), 'manual-journal post must go through the posting boundary');
    assert.ok(body.includes('tenantBaseCurrency(trx, scope.tenantId)'), 'digits must resolve on the transaction handle');
    assert.ok(body.includes('toBookMoney('), 'manual-journal computation must round at book digits');
    assert.ok(!body.includes('this.toMoney('), 'manual-journal computation must not use the 2dp helper');
    assert.ok(!body.includes('.toFixed(2)'), 'manual-journal slice must not hardcode 2dp formatting');
    assert.ok(!body.includes('> 0.05'), 'manual-journal slice must not keep the 0.05 balance band');
    assert.ok(!body.includes('>= 0.001'), 'manual-journal slice must not keep the 0.001 plug trigger');
    assert.ok(!body.includes("insertInto('journal_entries')"), 'manual-journal slice must not insert headers directly');
    assert.ok(!body.includes("insertInto('journal_entry_lines')"), 'manual-journal slice must not insert lines directly');
    assert.ok(!body.includes('JE-TMP-'), 'manual-journal slice must not mint temp entry numbers');
    const boundary = readFileSync(resolve(__dirname, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
    assert.ok(boundary.includes('cashFlowCategory'), 'boundary must carry the cash-flow category');
    assert.ok(boundary.includes('cash_flow_category'), 'boundary must store the cash-flow category');
  }

  console.log('manual-journal-book-digits: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
