import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Maritime settle at book digits (INV-MARITIME-SETTLE-BOOK-DIGITS).
 *
 * THE GAP: settleJobFromCustomerBalance rounded the unpaid remainder
 * and the accumulated paid total with a hardcoded two-decimal form
 * (Number(...toFixed(2))) and stored the result in
 * maritime_jobs.client_paid_total (NUMERIC(15,4)). The invoiced total
 * it settles against is book-precision (posted journal credits
 * converted with convertFxAmount at tenant book digits), so a
 * 3-decimal book mis-settled: invoiced 100.005 settled as 100.01.
 *
 * THE RULE: the remainder and the paid total are rounded once with
 * roundMoney at the tenant's book digits, resolved on the transaction
 * handle with the pattern this file already uses
 * (tenantBaseCurrency + currencyMoneyDigits). The Math.max(0, ...)
 * guard, the `amount > remaining + 0.001` cap tolerance, and the
 * no-journal behavior (milestone note only) are unchanged.
 *
 * DELIBERATELY UNCHANGED, as separate decisions:
 * - The 0.01 `full` band: at 3dp a 0.005 remainder still marks the job
 *   paid (a zero-amount settle on a 100.005/100.000 job stays 'paid').
 *   It is a policy band, not precision.
 * - The sibling writer in purchases-write.service.ts (customer-payment
 *   allocation stores client_paid_total as an unrounded float sum).
 *   Converging it onto the same rounding is a separate package; the
 *   source pin below pins that it is still unrounded.
 * - The return's remainingUnpaid field keeps its raw Math.max form; it
 *   is display-only and is computed from the unified newPaid.
 *
 * FLOAT ORDER: roundMoney rounds the binary float product, so an exact
 * 2dp half (100.005 at 2 decimals) may land on the float side rather
 * than the decimal side toFixed would pick. The 2dp case below uses an
 * ordinary amount (100.12) and pins identity with the canonical engine,
 * not decimal-half behavior.
 *
 * WHAT THIS PINS, driving the REAL settleJobFromCustomerBalance on
 * PGlite (KWD base, stubbed collaborators; the customer ledger is
 * seeded to match the customer balance, as the function requires):
 * - 3dp full settle: invoiced 100.005 stores newPaid 100.005, 'paid'.
 * - 3dp partial settle: amount 40.002 stores 40.002, 'partially_paid'.
 * - 2dp identity: EGP 100.12 stores 100.12, 'paid'.
 * - Cap uses book digits: amount 100.01 against remaining 100.005 is
 *   rejected (under the old 2dp remainder 100.01 it would have passed).
 * - Fail-closed digits: a base-currency/rate mismatch rejects with no
 *   stored change.
 * - The unchanged 0.01 `full` band: a zero-amount settle on a job with
 *   a 0.005 remainder stays 'paid' and writes no milestone.
 * This is not an end-to-end job-to-settle run on live Postgres.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

async function setupDb(pg: InstanceType<typeof PGlite>): Promise<void> {
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE maritime_jobs (id text PRIMARY KEY, tenant_id text, customer_id bigint, client_invoiced_total numeric, client_paid_total numeric, payment_status text, paid_at timestamptz, updated_at timestamptz);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, balance numeric);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, status text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, partner_type text, partner_id bigint, debit numeric, credit numeric);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, is_receivable boolean);
    CREATE TABLE maritime_job_milestones (id bigserial PRIMARY KEY, tenant_id text, job_id text, milestone_key text, milestone_title text, location text, notes text, recorded_by bigint);
    INSERT INTO accounting_accounts VALUES (1130, 't1', '1130', true);
    INSERT INTO journal_entries VALUES (1, 't1', 'posted');
  `);
}

async function seedCurrency(pg: InstanceType<typeof PGlite>, code: string): Promise<void> {
  await pg.exec(`
    DELETE FROM settings WHERE tenant_id = 't1';
    DELETE FROM currency_exchange_rates WHERE tenant_id = 't1';
    INSERT INTO settings VALUES ('t1', 'currency', '${code}');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', '${code}', 1, true);
  `);
}

async function seedJob(
  db: Kysely<Database>,
  jobId: string,
  invoiced: number,
  paid: number,
  customerBalance: number,
): Promise<void> {
  // One customer and one ledger line per case: the function requires
  // the posted-ledger balance to match the customer balance, and the
  // ledger sum is global per customer, so prior cases must not leak in.
  await db.deleteFrom('journal_entry_lines' as never).execute();
  await db.deleteFrom('customers' as never).execute();
  await db
    .insertInto('maritime_jobs' as never)
    .values({ id: jobId, tenant_id: 't1', customer_id: 4, client_invoiced_total: invoiced, client_paid_total: paid, payment_status: 'unpaid', paid_at: null, updated_at: new Date() } as never)
    .execute();
  await db
    .insertInto('customers' as never)
    .values({ id: 4, tenant_id: 't1', balance: customerBalance } as never)
    .execute();
  const credit = -customerBalance;
  await db
    .insertInto('journal_entry_lines' as never)
    .values({ tenant_id: 't1', journal_entry_id: 1, account_id: 1130, partner_type: 'customer', partner_id: 4, debit: 0, credit: credit > 0 ? credit : 0 } as never)
    .execute();
}

async function readJob(db: Kysely<Database>, jobId: string): Promise<{ paid: number; status: string }> {
  const row = await db.selectFrom('maritime_jobs').select(['client_paid_total', 'payment_status']).where('tenant_id', '=', 't1').where('id', '=', jobId as never).executeTakeFirstOrThrow();
  return { paid: Number((row as any).client_paid_total), status: String((row as any).payment_status) };
}

async function milestoneCount(db: Kysely<Database>): Promise<number> {
  const rows = await db.selectFrom('maritime_job_milestones' as never).selectAll().execute();
  return rows.length;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);

  try {
    await setupDb(pg);

    // 1. 3dp full settle (KWD): no explicit amount settles the remainder.
    await seedCurrency(pg, 'KWD');
    await seedJob(db, 'job1', 100.005, 0, -100.005);
    const full = await service.settleJobFromCustomerBalance(auth, 'job1');
    assert.equal(full.settledAmount, 100.005);
    assert.equal(full.remainingUnpaid, 0);
    const job1 = await readJob(db, 'job1');
    assert.equal(job1.paid, 100.005);
    assert.equal(job1.status, 'paid');
    assert.equal(await milestoneCount(db), 1);

    // 2. 3dp partial settle (KWD): explicit amount keeps the third decimal.
    await seedJob(db, 'job2', 100.005, 0, -100.005);
    const partial = await service.settleJobFromCustomerBalance(auth, 'job2', { amount: 40.002 });
    assert.equal(partial.settledAmount, 40.002);
    assert.equal(Number(partial.remainingUnpaid.toFixed(3)), 60.003);
    const job2 = await readJob(db, 'job2');
    assert.equal(job2.paid, 40.002);
    assert.equal(job2.status, 'partially_paid');

    // 3. 2dp identity (EGP): ordinary amounts are unchanged.
    await seedCurrency(pg, 'EGP');
    await seedJob(db, 'job3', 100.12, 0, -100.12);
    const egp = await service.settleJobFromCustomerBalance(auth, 'job3');
    assert.equal(egp.settledAmount, 100.12);
    const job3 = await readJob(db, 'job3');
    assert.equal(job3.paid, 100.12);
    assert.equal(job3.status, 'paid');

    // 4. Cap uses book digits (KWD): 100.01 exceeds remaining 100.005
    // plus the 0.001 tolerance, so it must reject. Under the old 2dp
    // remainder (100.01) this amount would have passed.
    await seedCurrency(pg, 'KWD');
    await seedJob(db, 'job4', 100.005, 0, -100.005);
    await assert.rejects(
      service.settleJobFromCustomerBalance(auth, 'job4', { amount: 100.01 }),
      /يتجاوز المتبقي/,
    );
    const job4 = await readJob(db, 'job4');
    assert.equal(job4.paid, 0);
    assert.equal(job4.status, 'unpaid');

    // 5. Fail-closed digits: a base-rate row that disagrees with the
    // settings currency rejects with no stored change. (Zero base
    // rows do NOT fail closed in tenantBaseCurrency — the mismatch
    // check runs over the rows present — so the mismatch is seeded.)
    await pg.exec(`UPDATE currency_exchange_rates SET currency_code = 'EGP' WHERE tenant_id = 't1' AND is_base`);
    await seedJob(db, 'job5', 100.005, 0, -100.005);
    await assert.rejects(service.settleJobFromCustomerBalance(auth, 'job5'), /عملة الأساس/);
    const job5 = await readJob(db, 'job5');
    assert.equal(job5.paid, 0);
    assert.equal(job5.status, 'unpaid');

    // 6. Unchanged 0.01 `full` band: a zero-amount settle on a job with
    // a 0.005 remainder stays 'paid' and writes no milestone.
    await seedCurrency(pg, 'KWD');
    await seedJob(db, 'job6', 100.005, 100, -100.005);
    const before = await milestoneCount(db);
    const band = await service.settleJobFromCustomerBalance(auth, 'job6', { amount: 0 });
    assert.equal(band.settledAmount, 0);
    const job6 = await readJob(db, 'job6');
    assert.equal(job6.paid, 100);
    assert.equal(job6.status, 'paid');
    assert.equal(await milestoneCount(db), before);

    // 7. Source pin: this function rounds with roundMoney at book
    // digits on the transaction handle and keeps no toFixed(2) on the
    // remainder or the paid total; the sibling writer is still the
    // unrounded float sum (separate decision, pinned as unchanged).
    const source = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const start = source.indexOf('async settleJobFromCustomerBalance(');
    const end = source.indexOf('async getCustomerActiveJobs(');
    assert.ok(start > 0 && end > start);
    const body = source.slice(start, end);
    assert.ok(body.includes('currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId))'));
    assert.ok(body.includes('roundMoney(Math.max(0, invoiced - paid), digits)'));
    assert.ok(body.includes('roundMoney(paid + amount, digits)'));
    assert.ok(!body.includes('toFixed(2)'));
    assert.ok(body.includes('newPaid >= invoiced - 0.01'));
    const sibling = readFileSync(resolve(__dirname, '../../src/modules/purchases/services/purchases-write.service.ts'), 'utf8');
    assert.ok(sibling.includes('const newPaid = currentPaid + amount;'));

    console.log('maritime settle book digits checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
