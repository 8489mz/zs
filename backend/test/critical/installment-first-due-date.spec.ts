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

/*
 * Installment first due date (INV-INSTALLMENT-FIRST-DUE-DATE).
 *
 * THE DEFECT: the create form labels its date field "first installment
 * due date" and sends it as startDate, but createPlan generated the
 * schedule with `dueDate = startDate + i months` for i = 1..count, so
 * the first installment always landed one month after the entered
 * date. Contract INST-261105-0002 (entered 2026-11-05) scheduled
 * 2026-12-05, 2027-01-05, 2027-02-05; the rest of the math was right.
 *
 * THE FIX: CreateInstallmentPlanDto gains an optional firstDueDate.
 * When the caller supplies it, the schedule is anchored on it
 * (first due on the entered date, then monthly); when it is absent,
 * the schedule keeps the old shape (first due one month after the
 * plan start). The form sends firstDueDate from the field the user
 * already fills in, so the live flow is fixed with no form change
 * in behaviour. Invalid firstDueDate fails closed with a named
 * error instead of storing an invalid date. Prospective only: plans
 * already created keep their stored schedules.
 *
 * WHAT THIS PINS, driving the REAL code (no duplicated formula):
 * - Service level on PGlite (fresh database; interest/down-payment
 *   legs are zero, so no foundation or ledger call runs): a plan
 *   with firstDueDate 2026-11-05 schedules 2026-11-05, 2026-12-05,
 *   2027-01-05 with the same amounts as before; a plan without
 *   firstDueDate keeps the old 2026-12-05, 2027-01-05, 2027-02-05
 *   shape; an invalid firstDueDate rejects with
 *   INVALID_FIRST_DUE_DATE.
 * - Source pins: the service anchors on firstDueDate, the DTO and
 *   the frontend payload declare it, and the modal sends it.
 *
 * DELIBERATELY UNCHANGED: the month arithmetic (setMonth, same as
 * before — only the offset changes), the plan start_date and the
 * daily plan number (still built from startDate), the amount split
 * (splitInstallmentSchedule, last row absorbs the remainder), and
 * every other installments behaviour.
 */

// Date keys are built from local calendar parts, never from UTC
// toISOString() after a local-midnight construction — in UTC+2 that
// yields the previous day.
const dateKey = (value: unknown): string => {
  const d = new Date(value as string | number | Date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE customers (id bigint, tenant_id text, name text, phone text, balance numeric DEFAULT 0);
      CREATE TABLE customer_installment_plans (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_number text, sale_id bigint, customer_id bigint, total_amount numeric, down_payment numeric, financed_amount numeric, interest_rate_percent numeric, interest_amount numeric, total_with_interest numeric, installment_count int, monthly_amount numeric, start_date date, status text, notes text, branch_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_installments (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_id bigint, sale_id bigint, customer_id bigint, installment_number int, due_date date, amount numeric, paid_amount numeric DEFAULT 0, status text, payment_method text, receipt_no text, notes text, paid_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      INSERT INTO settings VALUES ('t-egp', 'currency', 'EGP');
      INSERT INTO currency_exchange_rates VALUES ('t-egp', 'EGP', true, 1);
      INSERT INTO customers VALUES (2, 't-egp', 'EGP Customer', '0101', 0);
    `);
    const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
    const posting = new AccountingPostingService(foundation);
    const service = new CustomerInstallmentsService(db, new TransactionHelper(), new SalesFinanceService(db), posting as any);
    const auth = { tenantId: 't-egp', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

    // The reported contract: entered first due 2026-11-05, 3 x 100.
    // Before the fix the schedule started 2026-12-05.
    const withFirstDue = await service.createPlan(
      { customerId: 2, totalAmount: 300, downPayment: 0, interestRatePercent: 0, installmentCount: 3, startDate: '2026-11-05', firstDueDate: '2026-11-05' },
      auth,
    );
    assert.deepEqual(
      withFirstDue.installments.map((row: any) => dateKey(row.due_date)),
      ['2026-11-05', '2026-12-05', '2027-01-05'],
    );
    assert.deepEqual(
      withFirstDue.installments.map((row: any) => Number(row.amount)),
      [100, 100, 100],
    );
    assert.equal(Number(withFirstDue.plan.monthly_amount), 100);
    assert.equal(Number(withFirstDue.plan.total_with_interest), 300);
    assert.equal(dateKey((withFirstDue.plan as any).start_date), '2026-11-05');

    // Without an entered first due date the old shape is preserved:
    // first due one month after the plan start, amounts unchanged.
    const withoutFirstDue = await service.createPlan(
      { customerId: 2, totalAmount: 300, downPayment: 0, interestRatePercent: 0, installmentCount: 3, startDate: '2026-11-05' },
      auth,
    );
    assert.deepEqual(
      withoutFirstDue.installments.map((row: any) => dateKey(row.due_date)),
      ['2026-12-05', '2027-01-05', '2027-02-05'],
    );
    assert.deepEqual(
      withoutFirstDue.installments.map((row: any) => Number(row.amount)),
      [100, 100, 100],
    );

    // An invalid entered first due date fails closed with a named
    // error instead of storing an invalid schedule.
    await assert.rejects(
      () => service.createPlan(
        { customerId: 2, totalAmount: 300, downPayment: 0, interestRatePercent: 0, installmentCount: 3, startDate: '2026-11-05', firstDueDate: 'not-a-date' },
        auth,
      ),
      (error: unknown) => (error as { code?: string }).code === 'INVALID_FIRST_DUE_DATE',
    );
  } finally {
    await db.destroy();
  }

  // Source pins: the service anchors the schedule on the entered
  // first due date, and the field is declared and sent end to end.
  const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/customer-installments.service.ts'), 'utf8');
  assert.ok(serviceSource.includes('firstDueDate'), 'createPlan must read firstDueDate');
  assert.ok(serviceSource.includes('INVALID_FIRST_DUE_DATE'), 'an invalid first due date must fail closed with a named error');
  assert.ok(serviceSource.includes('firstDueDate ? i - 1 : i'), 'an entered first due date anchors the first row, otherwise the old one-month offset stays');
  const dtoSource = readFileSync(resolve(__dirname, '../../src/modules/sales/dto/customer-installment.dto.ts'), 'utf8');
  assert.ok(dtoSource.includes('firstDueDate?: string'), 'the create-plan DTO must declare firstDueDate');
  const modalSource = readFileSync(resolve(__dirname, '../../../frontend/src/features/sales/components/CreateInstallmentPlanModal.tsx'), 'utf8');
  assert.ok(modalSource.includes('firstDueDate: newPlan.startDate'), 'the modal must send the entered first due date');
  const apiSource = readFileSync(resolve(__dirname, '../../../frontend/src/features/sales/api/installments.api.ts'), 'utf8');
  assert.ok(apiSource.includes('firstDueDate?: string'), 'the frontend payload type must declare firstDueDate');

  console.log('installment-first-due-date: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
