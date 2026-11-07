import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { BalanceSheetService } from '../../src/modules/accounting/services/balance-sheet.service';
import { FiscalYearService } from '../../src/modules/accounting/services/fiscal-year.service';
import { TrialBalanceService } from '../../src/modules/accounting/services/trial-balance.service';
import {
  buildTrialBalance,
  type TrialBalanceAccountInput,
  type TrialBalanceReportData,
  type TrialBalanceSumsInput,
} from '../../src/modules/accounting/engines/trial-balance.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Core accounting digits (INV-ACCOUNTING-DIGITS-CORE, unification D1).
 *
 * THE GAP: the four core accounting read paths shaped every money value
 * with a private 2dp helper (Number(n.toFixed(2))) — accounting.service,
 * balance-sheet.service, fiscal-year.service (list/get) and the
 * trial-balance engine. On a 3-decimal book (KWD/OMR/BHD/JOD/TND/IQD/LYD)
 * a true 100.125 was displayed and summed as 100.13, and a true 10.005
 * was displayed as 10.00 (binary float sits below the half). The
 * posting paths already round at book digits, so the books and the
 * reports disagreed by whole fils.
 *
 * THE RULE: every one of these paths rounds with the canonical
 * roundMoney(amount, digits) at the tenant's book digits, resolved
 * with the P2 pattern (tenantBaseCurrency + currencyMoneyDigits) on
 * the caller's handle — or, for the pure trial-balance engine, from
 * a digits argument the caller passes. 2dp behaviour is preserved
 * exactly for 2dp books. Nothing here rewrites a posted journal or
 * a stored value; it only shapes what the read paths return.
 *
 * FLOAT ORDER: the cases use amounts exact in binary (100.125, 0.125,
 * 200.25) so the 2dp/3dp distinction is a decimal-precision fact, not
 * a float artefact: toFixed(2) rounds exact 100.125 up to 100.13,
 * while roundMoney(100.125, 3) is exactly 100.125.
 *
 * WHAT THIS PINS, driving the REAL code (trial-balance engine pure;
 * the four services on PGlite, fresh database per case):
 * - Trial balance at 3dp: 100.125 / 0.125 survive end to end.
 * - Trial balance at 2dp and with no digits argument: old shaping kept.
 * - Live trial-balance service at 3dp (KWD): getTrialBalance returns
 *   100.125 end to end — the service passes the tenant's book digits
 *   to the engine; without that wiring the live page stays 2dp even
 *   though the engine is digits-aware.
 * - Balance sheet at 3dp (KWD): totals 100.125, balanced, difference 0.
 * - Balance sheet at 2dp (EGP): 100.12 stays 100.12.
 * - Fiscal-year list/get at 3dp (KWD): stored 100.125 reads back 100.125.
 * - Journal-entry read at 3dp (KWD): line + totals 100.125.
 * - Draft-line validation at 3dp (KWD): lines stay 100.125 and a real
 *   0.005 difference plugs exactly 0.005 into 7290.
 * - Source pin: no .toFixed(2) remains in any of the four files.
 * This is not an end-to-end run on live Postgres.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

/* The 4-argument call compiles against the base signature too (where the
 * engine takes 3 arguments and ignores the extra one), so this spec can
 * run — and fail — on the base code for the fail-without-fix proof. */
const buildWithDigits = buildTrialBalance as unknown as (
  asOfDate: string,
  accounts: TrialBalanceAccountInput[],
  sums: TrialBalanceSumsInput[],
  digits?: 2 | 3,
) => TrialBalanceReportData;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
    CREATE TABLE accounting_fiscal_years (id bigint PRIMARY KEY, tenant_id text, name text, code text, start_date date, end_date date, status text, closing_entry_id bigint, net_profit_loss numeric, total_revenue numeric, total_expense numeric, retained_earnings_account_id bigint, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, cancelled_by bigint, cancel_reason text, cancelled_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean);
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: code } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

async function seedAccount(db: Kysely<Database>, id: number, code: string, type: string, group?: string | null): Promise<void> {
  await db.insertInto('accounting_accounts' as never).values({
    id, tenant_id: 't1', code, name_ar: code, name_en: code, account_type: type,
    is_active: true, is_tax: false, account_group: group ?? null,
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
    posted_at: new Date(), cancelled_by: null, cancel_reason: null, cancelled_at: null,
    reversal_of_entry_id: null, reversed_by_entry_id: null, updated_at: new Date(),
  } as never).returning('id' as never).executeTakeFirstOrThrow() as unknown as { id: number };
  const entryId = Number((inserted as any).id);
  for (const line of lines) {
    await db.insertInto('journal_entry_lines' as never).values({
      tenant_id: 't1', journal_entry_id: entryId, account_id: line.accountId, cost_center_id: null,
      description: 'seed', debit: line.debit, credit: line.credit,
      partner_type: 'none', partner_id: null, branch_id: null, location_id: null, is_reconciled: false,
    } as never).execute();
  }
  return entryId;
}

async function seedYear(db: Kysely<Database>, totals: { net: number; revenue: number; expense: number }): Promise<void> {
  await db.insertInto('accounting_fiscal_years' as never).values({
    id: 1, tenant_id: 't1', name: 'FY2025', code: 'FY25',
    start_date: '2025-01-01', end_date: '2025-12-31', status: 'open',
    closing_entry_id: null, net_profit_loss: totals.net, total_revenue: totals.revenue, total_expense: totals.expense,
    retained_earnings_account_id: null, closed_at: null, closed_by: null, closing_notes: null,
    updated_at: new Date(),
  } as never).execute();
}

function buildBalanceSheet(db: Kysely<Database>): BalanceSheetService {
  const service = Object.create(BalanceSheetService.prototype) as any;
  service.db = db;
  return service as BalanceSheetService;
}

function buildFiscalYear(db: Kysely<Database>): FiscalYearService {
  const service = Object.create(FiscalYearService.prototype) as any;
  service.db = db;
  return service as FiscalYearService;
}

function buildAccounting(db: Kysely<Database>): AccountingService {
  const service = Object.create(AccountingService.prototype) as any;
  service.db = db;
  return service as AccountingService;
}

function buildTrialBalanceService(db: Kysely<Database>): TrialBalanceService {
  const service = Object.create(TrialBalanceService.prototype) as any;
  service.db = db;
  return service as TrialBalanceService;
}

async function main(): Promise<void> {
  // 1. Trial balance at 3dp: exact 100.125 and 0.125 survive end to end.
  {
    const accounts = [
      { id: 10, code: '1110', nameAr: 'نقد', nameEn: 'Cash', accountType: 'asset' },
      { id: 20, code: '3200', nameAr: 'رأس مال', nameEn: 'Capital', accountType: 'equity' },
    ];
    const sums = [
      { accountId: 10, totalDebit: 100.125, totalCredit: 0 },
      { accountId: 20, totalDebit: 0, totalCredit: 100.125 },
    ];
    const report = buildWithDigits('2025-12-31', accounts, sums, 3);
    assert.equal(report.totalDebit, 100.125, 'trial-balance debit total must keep the third decimal');
    assert.equal(report.totalCredit, 100.125, 'trial-balance credit total must keep the third decimal');
    assert.equal(report.difference, 0);
    assert.equal(report.isBalanced, true);
    assert.equal(report.rows[0].debit, 100.125);
    assert.equal(report.rows[1].credit, 100.125);
    const small = buildWithDigits('2025-12-31',
      [{ id: 10, code: '1110', nameAr: 'نقد', nameEn: 'Cash', accountType: 'asset' }],
      [{ accountId: 10, totalDebit: 0.125, totalCredit: 0 }], 3);
    assert.equal(small.rows[0].debit, 0.125, 'a single fils (0.125) must not round up to 0.13');
    assert.equal(small.totalDebit, 0.125);
  }

  // 2. Trial balance at 2dp, and with no digits argument: old shaping kept.
  {
    const accounts = [{ id: 10, code: '1110', nameAr: 'نقد', nameEn: 'Cash', accountType: 'asset' }];
    const sums = [{ accountId: 10, totalDebit: 100.12, totalCredit: 0 }];
    const report = buildWithDigits('2025-12-31', accounts, sums, 2);
    assert.equal(report.totalDebit, 100.12);
    const fallback = buildTrialBalance('2025-12-31', accounts,
      [{ accountId: 10, totalDebit: 100.125, totalCredit: 0 }]);
    assert.equal(fallback.totalDebit, 100.13, 'no-digits callers keep the previous 2dp shaping');
  }

  // 3. Balance sheet at 3dp (KWD): totals 100.125, balanced, difference 0.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedAccount(db, 10, '1110', 'asset', 'current_assets');
      await seedAccount(db, 20, '3200', 'equity', null);
      await seedPostedEntry(db, [
        { accountId: 10, debit: 100.125, credit: 0 },
        { accountId: 20, debit: 0, credit: 100.125 },
      ]);
      const sheet = await buildBalanceSheet(db).getBalanceSheet(auth, { asOfDate: '2100-12-31' });
      assert.equal(sheet.assets.totalAssets, 100.125, 'balance-sheet assets must keep the third decimal');
      assert.equal(sheet.totalLiabilitiesAndEquity, 100.125);
      assert.equal(sheet.difference, 0);
      assert.equal(sheet.isBalanced, true);
      assert.equal(sheet.assets.currentAssets.total, 100.125);
    } finally {
      await db.destroy();
    }
  }

  // 4. Balance sheet at 2dp (EGP): 100.12 stays 100.12.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedAccount(db, 10, '1110', 'asset', 'current_assets');
      await seedAccount(db, 20, '3200', 'equity', null);
      await seedPostedEntry(db, [
        { accountId: 10, debit: 100.12, credit: 0 },
        { accountId: 20, debit: 0, credit: 100.12 },
      ]);
      const sheet = await buildBalanceSheet(db).getBalanceSheet(auth, { asOfDate: '2100-12-31' });
      assert.equal(sheet.assets.totalAssets, 100.12);
      assert.equal(sheet.totalLiabilitiesAndEquity, 100.12);
      assert.equal(sheet.isBalanced, true);
    } finally {
      await db.destroy();
    }
  }

  // 5. Fiscal-year list/get at 3dp (KWD): stored 100.125 reads back 100.125.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedYear(db, { net: 100.125, revenue: 200.25, expense: 100.125 });
      const service = buildFiscalYear(db);
      const list = await service.listFiscalYears(auth);
      assert.equal(list.data[0].net_profit_loss, 100.125, 'list must not round the stored net to 100.13');
      assert.equal(list.data[0].total_revenue, 200.25);
      assert.equal(list.data[0].total_expense, 100.125);
      const one = await service.getFiscalYear(auth, 1);
      assert.equal(one.net_profit_loss, 100.125, 'get must not round the stored net to 100.13');
      assert.equal(one.total_expense, 100.125);
    } finally {
      await db.destroy();
    }
  }

  // 6. Journal-entry read at 3dp (KWD): line and totals 100.125.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedAccount(db, 10, '1110', 'asset', 'current_assets');
      await seedAccount(db, 20, '3200', 'equity', null);
      const entryId = await seedPostedEntry(db, [
        { accountId: 10, debit: 100.125, credit: 0 },
        { accountId: 20, debit: 0, credit: 100.125 },
      ]);
      const result = await buildAccounting(db).getJournalEntry(entryId, auth) as any;
      assert.equal(result.entry.totals.debit, 100.125, 'journal totals must keep the third decimal');
      assert.equal(result.entry.totals.credit, 100.125);
      assert.equal(result.entry.totals.balanced, true);
      assert.equal(result.entry.lines[0].debit, 100.125);
      assert.equal(result.entry.lines[1].credit, 100.125);
    } finally {
      await db.destroy();
    }
  }

  // 7. Draft-line validation at 3dp (KWD): lines stay 100.125, and a
  // real 0.005 difference plugs exactly 0.005 into 7290.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedAccount(db, 10, '4100', 'revenue', null);
      await seedAccount(db, 20, '5100', 'expense', null);
      await seedAccount(db, 30, '7290', 'expense', null);
      const service = buildAccounting(db);
      const exact = await service.validateBalancedLines([
        { accountId: 10, debit: 100.125, credit: 0 },
        { accountId: 20, debit: 0, credit: 100.125 },
      ], auth);
      assert.equal(exact.ok, true);
      if (exact.ok) {
        assert.equal(exact.lines[0].debit, 100.125, 'draft lines must keep the third decimal');
        assert.equal(exact.lines[1].credit, 100.125);
      }
      const plugged = await service.validateBalancedLines([
        { accountId: 10, debit: 100.125, credit: 0 },
        { accountId: 20, debit: 0, credit: 100.12 },
      ], auth);
      assert.equal(plugged.ok, true);
      if (plugged.ok) {
        assert.equal(plugged.lines.length, 3, 'a one-fils-scale difference plugs into 7290');
        assert.equal(plugged.lines[2].accountId, 30);
        assert.equal(plugged.lines[2].credit, 0.005, 'plug must be the true 0.005 difference, not 0.01');
      }
    } finally {
      await db.destroy();
    }
  }

  // 8. Live trial-balance service at 3dp (KWD): getTrialBalance returns
  // 100.125 end to end. This pins the service wiring, not just the
  // engine: with the engine fixed but the service still calling it
  // with 3 arguments, the digits = 2 default applies and this case
  // reads 100.13.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedAccount(db, 10, '1110', 'asset', 'current_assets');
      await seedAccount(db, 20, '3200', 'equity', null);
      await seedPostedEntry(db, [
        { accountId: 10, debit: 100.125, credit: 0 },
        { accountId: 20, debit: 0, credit: 100.125 },
      ]);
      const report = await buildTrialBalanceService(db).getTrialBalance(auth, { asOfDate: '2100-12-31' });
      assert.equal(report.totalDebit, 100.125, 'live trial balance must keep the third decimal');
      assert.equal(report.totalCredit, 100.125);
      assert.equal(report.difference, 0);
      assert.equal(report.isBalanced, true);
      assert.equal(report.rows[0].debit, 100.125);
      assert.equal(report.rows[1].credit, 100.125);
    } finally {
      await db.destroy();
    }
  }

  // 9. Source pin: no .toFixed(2) remains in any of the four files, and
  // each one rounds through the canonical engine.
  {
    const files = [
      'src/modules/accounting/accounting.service.ts',
      'src/modules/accounting/services/balance-sheet.service.ts',
      'src/modules/accounting/services/fiscal-year.service.ts',
      'src/modules/accounting/engines/trial-balance.engine.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, '../../', file), 'utf8');
      assert.ok(!source.includes('.toFixed(2)'), `${file} must not hardcode 2dp formatting`);
      assert.ok(source.includes('roundMoney('), `${file} must round through the canonical engine`);
    }
    const serviceSource = readFileSync(resolve(__dirname, '../../', 'src/modules/accounting/services/trial-balance.service.ts'), 'utf8');
    assert.ok(!serviceSource.includes('.toFixed(2)'), 'trial-balance.service.ts must not hardcode 2dp formatting');
    assert.ok(serviceSource.includes('currencyMoneyDigits'), 'trial-balance.service.ts must resolve book digits');
  }

  console.log('accounting-digits-core: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
