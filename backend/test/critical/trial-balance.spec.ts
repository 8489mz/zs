/* Trial balance page (INV-TRIAL-BALANCE-PAGE): the dedicated trial balance
 * page shows every tenant account with its posted debit/credit totals and
 * proves total debit = total credit. The service reads posted journal lines
 * only (drafts, future-dated entries and other tenants never count), and a
 * zero-balance account is included with 0.00 / 0.00, never dropped.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TrialBalanceService } from '../../src/modules/accounting/services/trial-balance.service';
import { buildTrialBalance } from '../../src/modules/accounting/engines/trial-balance.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const service = new TrialBalanceService(db);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  try {
    await pg.exec(`
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', account_type text);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text,
        entry_date timestamptz, status text, branch_id bigint);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint,
        tenant_id text, account_id bigint, description text DEFAULT '', debit numeric, credit numeric,
        partner_type text DEFAULT 'none', partner_id bigint, branch_id bigint, location_id bigint);
    `);
    // t1 accounts: cash 1010, bank 1020 (never moves), payables 2110 (never
    // moves), revenue 4100, expense 5100; t2 owns its own 1010/4100 pair.
    await pg.exec(`
      INSERT INTO accounting_accounts (id, tenant_id, code, name_ar, name_en, account_type) VALUES
        (1, 't1', '1010', 'الصندوق', 'Cash', 'asset'),
        (2, 't1', '1020', 'البنك', 'Bank', 'asset'),
        (3, 't1', '2110', 'الدائنون', 'Payables', 'liability'),
        (4, 't1', '4100', 'الإيرادات', 'Revenue', 'revenue'),
        (5, 't1', '5100', 'المصروفات', 'Expenses', 'expense'),
        (6, 't2', '1010', 'الصندوق', 'Cash', 'asset'),
        (7, 't2', '4100', 'الإيرادات', 'Revenue', 'revenue');
    `);
    const entry = async (tenant: string, date: string, status: string, branch: number | null) => {
      const r = await pg.query<{ id: string }>(
        `INSERT INTO journal_entries (tenant_id, entry_date, status, branch_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenant, date, status, branch],
      );
      return Number(r.rows[0].id);
    };
    const line = async (entryId: number, tenant: string, accountId: number, debit: number, credit: number, branch: number | null) => {
      await pg.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, tenant_id, account_id, debit, credit, branch_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [entryId, tenant, accountId, debit, credit, branch],
      );
    };
    // JE1 posted 2026-09-10 branch 1: cash Dr 1000 / revenue Cr 1000.
    const je1 = await entry('t1', '2026-09-10T00:00:00Z', 'posted', 1);
    await line(je1, 't1', 1, 1000, 0, 1);
    await line(je1, 't1', 4, 0, 1000, 1);
    // JE2 posted 2026-09-15 branch 2: expense Dr 400 / cash Cr 400.
    const je2 = await entry('t1', '2026-09-15T00:00:00Z', 'posted', 2);
    await line(je2, 't1', 5, 400, 0, 2);
    await line(je2, 't1', 1, 0, 400, 2);
    // JE3 DRAFT 2026-09-12: cash Dr 999 / revenue Cr 999 — must not count.
    const je3 = await entry('t1', '2026-09-12T00:00:00Z', 'draft', 1);
    await line(je3, 't1', 1, 999, 0, 1);
    await line(je3, 't1', 4, 0, 999, 1);
    // JE4 posted 2026-10-05 (after the as-of date): must not count yet.
    const je4 = await entry('t1', '2026-10-05T00:00:00Z', 'posted', 1);
    await line(je4, 't1', 1, 500, 0, 1);
    await line(je4, 't1', 4, 0, 500, 1);
    // JE5 posted, other tenant: must not leak into t1.
    const je5 = await entry('t2', '2026-09-10T00:00:00Z', 'posted', 1);
    await line(je5, 't2', 6, 777, 0, 1);
    await line(je5, 't2', 7, 0, 777, 1);

    // 1. Full trial balance as of 2026-09-30: balanced 1000 = 1000.
    const tb = await service.getTrialBalance(auth, { asOfDate: '2026-09-30' });
    assert.equal(tb.asOfDate, '2026-09-30');
    assert.equal(tb.rows.length, 5, 'every t1 account appears, including zero-balance ones');
    assert.deepEqual(tb.rows.map((r) => r.code), ['1010', '1020', '2110', '4100', '5100']);
    const byCode = new Map(tb.rows.map((r) => [r.code, r]));
    assert.deepEqual([byCode.get('1010')!.debit, byCode.get('1010')!.credit], [600, 0]);
    assert.deepEqual([byCode.get('1020')!.debit, byCode.get('1020')!.credit], [0, 0]);
    assert.deepEqual([byCode.get('2110')!.debit, byCode.get('2110')!.credit], [0, 0]);
    assert.deepEqual([byCode.get('4100')!.debit, byCode.get('4100')!.credit], [0, 1000]);
    assert.deepEqual([byCode.get('5100')!.debit, byCode.get('5100')!.credit], [400, 0]);
    assert.equal(tb.totalDebit, 1000);
    assert.equal(tb.totalCredit, 1000);
    assert.equal(tb.difference, 0);
    assert.equal(tb.isBalanced, true);

    // 2. As-of cutoff: 2026-09-12 sees only JE1 (JE2 is 09-15, JE4 is 10-05).
    const early = await service.getTrialBalance(auth, { asOfDate: '2026-09-12' });
    assert.equal(early.totalDebit, 1000);
    assert.equal(early.totalCredit, 1000);
    assert.equal(early.isBalanced, true);
    assert.deepEqual(
      [early.rows.find((r) => r.code === '5100')!.debit, early.rows.find((r) => r.code === '5100')!.credit],
      [0, 0],
    );

    // 3. Branch filter: branch 1 sees only JE1 (JE2 is branch 2).
    const branch1 = await service.getTrialBalance(auth, { asOfDate: '2026-09-30', branchId: 1 });
    assert.equal(branch1.totalDebit, 1000);
    assert.equal(branch1.totalCredit, 1000);
    assert.equal(branch1.isBalanced, true);
    assert.deepEqual(
      [branch1.rows.find((r) => r.code === '5100')!.debit, branch1.rows.find((r) => r.code === '5100')!.credit],
      [0, 0],
    );

    // 4. Pure engine: a credit-net account lands in the credit column and a
    // zero account stays 0.00 / 0.00; totals prove the balance.
    const eng = buildTrialBalance(
      '2026-09-30',
      [
        { id: 1, code: '1010', nameAr: 'الصندوق', nameEn: 'Cash', accountType: 'asset' },
        { id: 2, code: '2110', nameAr: 'الدائنون', nameEn: 'Payables', accountType: 'liability' },
      ],
      [
        { accountId: 1, totalDebit: 600, totalCredit: 0 },
        { accountId: 2, totalDebit: 0, totalCredit: 600 },
      ],
    );
    assert.equal(eng.totalDebit, 600);
    assert.equal(eng.totalCredit, 600);
    assert.equal(eng.isBalanced, true);
    assert.deepEqual([eng.rows[1].debit, eng.rows[1].credit], [0, 600]);

    // 4b. Strict balance (merge review): a real 0.01 difference is NOT
    // balanced — no tolerance may hide a one-cent imbalance.
    const oneCent = buildTrialBalance(
      '2026-09-30',
      [
        { id: 1, code: '1010', nameAr: 'الصندوق', nameEn: 'Cash', accountType: 'asset' },
        { id: 2, code: '2110', nameAr: 'الدائنون', nameEn: 'Payables', accountType: 'liability' },
      ],
      [
        { accountId: 1, totalDebit: 600.01, totalCredit: 0 },
        { accountId: 2, totalDebit: 0, totalCredit: 600 },
      ],
    );
    assert.equal(oneCent.difference, 0.01);
    assert.equal(oneCent.isBalanced, false);

    // 5. Wiring: the route, module registration and frontend page exist.
    const controller = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/accounting/accounting.controller.ts'),
      'utf8',
    );
    assert.ok(controller.includes("reports/trial-balance"));
    assert.ok(controller.includes('TrialBalanceService'));
    const moduleSrc = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/accounting/accounting.module.ts'),
      'utf8',
    );
    assert.ok(moduleSrc.includes('TrialBalanceService'));
    const routes = fs.readFileSync(
      path.resolve(__dirname, '../../../frontend/src/features/accounting/routes.tsx'),
      'utf8',
    );
    assert.ok(routes.includes('accounting/trial-balance'));
    assert.ok(routes.includes('accounting-trial-balance'));

    console.log('Trial balance: posted-only totals, as-of cutoff, branch filter, zero rows and balance proof passed');
  } finally {
    await db.destroy();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
