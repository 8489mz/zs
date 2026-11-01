import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { CustomerInstallmentsService } from '../../src/modules/sales/services/customer-installments.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { splitInstallmentSchedule, allocateInstallmentInterest } from '../../src/modules/accounting/engines/installment-interest.engine';
import { toMinorUnits } from '../../src/modules/accounting/engines/money-minor-units.engine';

/*
 * Customer installments minor units (INV-CUSTOMER-INSTALLMENTS-MINOR-UNITS).
 *
 * THE DEFECT: createPlan in customer-installments.service.ts rounded every
 * plan total with a private roundCurrency at toFixed(2) and split the
 * total in hard-coded cents (Math.round(total * 100), base/extra cents,
 * / 100). On a 3-decimal tenant (KWD) a true 100.125 total was stored
 * as 100.13, the schedule was cut in 0.01 steps, and the customer was
 * charged 0.005 more than the book-precision total — while the
 * interest allocation engine (allocateInstallmentInterest) and the
 * interest posting (postCustomerInstallmentInterest) already worked
 * at book digits, so the plan, the schedule and the interest legs
 * disagreed about the same money.
 *
 * THE FIX, in the user-decided direction (adopt tenant minor units
 * across plan + schedule): plan totals round once with roundMoney at
 * the tenant's book digits (tenantBaseCurrency + currencyMoneyDigits,
 * resolved on the transaction handle inside createPlan and on the db
 * handle for reads, fail closed on a base-currency/rate mismatch);
 * the schedule splits in minor units through the pure helper
 * splitInstallmentSchedule (book digits required, never a silent
 * default to 2), with the LAST row absorbing the remainder — the same
 * last-row shape as the supplier schedule builder and as
 * allocateInstallmentInterest. Inputs with sub-minor precision round
 * leniently at book digits; they do not throw.
 *
 * SHAPE CHANGE, recorded deliberately: the old cents split gave the
 * remainder to the FIRST rows ([33.34, 33.33, 33.33] for 100 over 3
 * at 2dp); the new split gives it to the LAST row ([33.33, 33.33,
 * 33.34]). monthly_amount keeps the old meaning — the floored share
 * (the first rows' amount), not the last row's amount.
 *
 * WHAT THIS PINS, driving the REAL code (no duplicated formula):
 * - Pure helper: 3dp worked examples summing exactly, rows differing
 *   by at most one minor unit, last row absorbing the remainder; the
 *   2dp case pinning the new last-row shape; guard throws.
 * - Reconcile chain: the schedule the helper produces for a financed
 *   100 + 7.125 interest plan is accepted by allocateInstallmentInterest
 *   at 3dp and its allocations sum to exactly 7.125.
 * - Service level on PGlite (fresh database; foundation stubbed, the
 *   interest/down-payment posting legs are NOT driven here — they
 *   already resolve book digits and are untouched): a KWD plan and an
 *   EGP plan through the real createPlan, with stored totals,
 *   monthly_amount and schedule rows at book digits; sub-minor input
 *   rounding leniently; the count guard rejecting more installments
 *   than minor units.
 * - Source pin: no toFixed(2)/cents split remains in the service.
 *
 * DELIBERATELY UNCHANGED: allocateInstallmentInterest and
 * postCustomerInstallmentInterest (already book digits); the interest
 * scheduler/accrual path (no money math, delegates to recognition);
 * frontend display (formatCurrency already resolves decimals per
 * currency; display shaping is an honest limit, not verified here);
 * already-posted plans keep their stored amounts (prospective only,
 * no history is re-rounded, no migration — the plan/schedule amount
 * columns are NUMERIC(15,4), which already stores a third decimal).
 */

const minorOf = (amounts: number[], digits: 2 | 3): number[] =>
  amounts.map((amount) => toMinorUnits(amount, digits));

async function main(): Promise<void> {
  // Pure helper: 3-decimal worked examples.
  const kwdSchedule = splitInstallmentSchedule(107.125, 3, 3);
  assert.deepEqual(minorOf(kwdSchedule, 3), [35708, 35708, 35709]);
  assert.equal(minorOf(kwdSchedule, 3).reduce((sum, minor) => sum + minor, 0), 107125);
  const kwdUneven = splitInstallmentSchedule(100.126, 3, 3);
  assert.deepEqual(minorOf(kwdUneven, 3), [33375, 33375, 33376]);
  assert.equal(minorOf(kwdUneven, 3).reduce((sum, minor) => sum + minor, 0), 100126);

  // Pure helper: 2-decimal case pins the NEW last-row shape.
  const egpSchedule = splitInstallmentSchedule(100, 3, 2);
  assert.deepEqual(minorOf(egpSchedule, 2), [3333, 3333, 3334]);
  assert.deepEqual(minorOf(splitInstallmentSchedule(100, 2, 2), 2), [5000, 5000]);
  assert.deepEqual(minorOf(splitInstallmentSchedule(100.125, 1, 3), 3), [100125]);

  // Pure helper: guards fail closed, never silently.
  assert.throws(() => splitInstallmentSchedule(0, 3, 3));
  assert.throws(() => splitInstallmentSchedule(100, 0, 2));
  assert.throws(() => splitInstallmentSchedule(0.01, 2, 2));
  assert.throws(() => splitInstallmentSchedule(100.1234, 1, 2));
  assert.throws(() => splitInstallmentSchedule(Number.NaN, 1, 2));

  // Reconcile chain: the helper's schedule feeds the real interest
  // allocation at book digits and its allocations sum exactly.
  const planSchedule = splitInstallmentSchedule(107.125, 2, 3);
  assert.deepEqual(minorOf(planSchedule, 3), [53562, 53563]);
  const allocations = allocateInstallmentInterest(100, planSchedule, 7.125, 3);
  assert.equal(allocations.reduce((sum, amount) => sum + amount, 0), 7.125);
  const egpAllocations = allocateInstallmentInterest(900, splitInstallmentSchedule(1000, 3, 2), 100, 2);
  assert.equal(Math.round(egpAllocations.reduce((sum, amount) => sum + amount, 0) * 100), 10000);

  // Service level on PGlite: real createPlan for a KWD tenant and an
  // EGP tenant, with the interest/down-payment posting legs skipped
  // (both amounts are zero, so no foundation or ledger call runs).
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE customers (id bigint, tenant_id text, name text, phone text, balance numeric DEFAULT 0);
      CREATE TABLE customer_installment_plans (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_number text, sale_id bigint, customer_id bigint, total_amount numeric, down_payment numeric, financed_amount numeric, interest_rate_percent numeric, interest_amount numeric, total_with_interest numeric, installment_count int, monthly_amount numeric, start_date date, status text, notes text, branch_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_installments (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_id bigint, sale_id bigint, customer_id bigint, installment_number int, due_date date, amount numeric, paid_amount numeric DEFAULT 0, status text, payment_method text, receipt_no text, notes text, paid_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      INSERT INTO settings VALUES ('t-kwd', 'currency', 'KWD'), ('t-egp', 'currency', 'EGP');
      INSERT INTO currency_exchange_rates VALUES ('t-kwd', 'KWD', true, 1), ('t-egp', 'EGP', true, 1);
      INSERT INTO customers VALUES (1, 't-kwd', 'KWD Customer', '0100', 0), (2, 't-egp', 'EGP Customer', '0101', 0);
    `);
    const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
    const posting = new AccountingPostingService(foundation);
    const service = new CustomerInstallmentsService(db, new TransactionHelper(), new SalesFinanceService(db), posting as any);
    const kwdAuth = { tenantId: 't-kwd', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
    const egpAuth = { tenantId: 't-egp', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

    // KWD: uneven 3dp total splits in fils, last row absorbs remainder.
    const kwd = await service.createPlan(
      { customerId: 1, totalAmount: 100.126, downPayment: 0, interestRatePercent: 0, installmentCount: 3, startDate: '2026-11-01' },
      kwdAuth,
    );
    assert.equal(toMinorUnits(Number(kwd.plan.total_amount), 3), 100126);
    assert.equal(toMinorUnits(Number(kwd.plan.financed_amount), 3), 100126);
    assert.equal(toMinorUnits(Number(kwd.plan.total_with_interest), 3), 100126);
    assert.equal(toMinorUnits(Number(kwd.plan.monthly_amount), 3), 33375);
    assert.deepEqual(minorOf(kwd.installments.map((row: any) => Number(row.amount)), 3), [33375, 33375, 33376]);

    // KWD: sub-minor input rounds leniently at book digits, no throw.
    const kwdRounded = await service.createPlan(
      { customerId: 1, totalAmount: 100.1254, downPayment: 0, interestRatePercent: 0, installmentCount: 1, startDate: '2026-11-01' },
      kwdAuth,
    );
    assert.equal(toMinorUnits(Number(kwdRounded.plan.total_amount), 3), 100125);
    assert.deepEqual(minorOf(kwdRounded.installments.map((row: any) => Number(row.amount)), 3), [100125]);

    // EGP: the new last-row shape at 2dp through the real service.
    const egp = await service.createPlan(
      { customerId: 2, totalAmount: 100, downPayment: 0, interestRatePercent: 0, installmentCount: 3, startDate: '2026-11-01' },
      egpAuth,
    );
    assert.equal(toMinorUnits(Number(egp.plan.total_with_interest), 2), 10000);
    assert.equal(toMinorUnits(Number(egp.plan.monthly_amount), 2), 3333);
    assert.deepEqual(minorOf(egp.installments.map((row: any) => Number(row.amount)), 2), [3333, 3333, 3334]);

    // Guard: more installments than minor units fails closed with the
    // same error code as before (message wording updated to minor units).
    await assert.rejects(
      () => service.createPlan(
        { customerId: 2, totalAmount: 0.01, downPayment: 0, interestRatePercent: 0, installmentCount: 2, startDate: '2026-11-01' },
        egpAuth,
      ),
      (error: unknown) => (error as { code?: string }).code === 'INVALID_INSTALLMENT_COUNT',
    );
  } finally {
    await db.destroy();
  }

  // Source pin: the cents split is gone from the service and the pure
  // helper is the single schedule computation.
  const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/customer-installments.service.ts'), 'utf8');
  assert.ok(!serviceSource.includes('roundCurrency'), 'the 2dp roundCurrency helper must be gone');
  assert.ok(!serviceSource.includes('toFixed(2)'), 'no 2dp shaping may remain in the service');
  assert.ok(!serviceSource.includes('baseCents'), 'the cents split must be gone');
  assert.ok(serviceSource.includes('splitInstallmentSchedule(totalWithInterest, installmentCount, bookDigits)'), 'createPlan must split through the pure helper at book digits');
  const engineSource = readFileSync(resolve(__dirname, '../../src/modules/accounting/engines/installment-interest.engine.ts'), 'utf8');
  assert.ok(engineSource.includes('export function splitInstallmentSchedule('), 'the split must live in the canonical installment engine');

  console.log('customer-installments-minor-units: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
