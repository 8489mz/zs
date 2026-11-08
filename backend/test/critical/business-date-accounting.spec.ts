/*
 * R3a (U5): business-date UTC-slice fix, accounting/posting slice.
 *
 * Phase 0 section 1.8 inventoried 51 files cutting a UTC date off a live
 * instant with toISOString().slice(0, 10); re-grounding at base 30a84e93
 * found 53. This package owns the 15 accounting files; every site was
 * classified before it was touched:
 *
 * FIXED (instant cut -- the UTC day is the wrong business day around local
 * midnight, tenant Africa/Cairo is UTC+2/+3):
 * - accounting-posting.service.ts: entryDate of a fiscal transition (a
 *   00:30 Cairo closing entry compared its UTC day to the year-end DATE
 *   and was rejected), and the plan-creation floor of installment-interest
 *   recognition.
 * - accounting.service.ts: normalizeDateInput fallback "today" for the
 *   opening-balances system start date.
 * - fiscal-year.service.ts: "today" in listFiscalYears (current-year pick),
 *   executeFiscalYearClose and closeFiscalPeriod (interest-recognition
 *   cap), and the two reopen-note dates.
 * - installment-interest-scheduler.service.ts: the scheduler's "today"
 *   (now per-tenant local; the candidate pre-filter uses a UTC+1-day
 *   horizon so a tenant whose local day is already tomorrow is missed).
 * - cash-flow.service.ts: default report-end "today".
 * - balance-sheet.service.ts: default as-of "today" and the compare label
 *   (now the requested day string, not a re-sliced Date).
 * - pdc-cheques.service.ts: getStats "today" / +7-day horizon, and the
 *   default action date in updateChequeStatus.
 * - payment-allocation.service.ts: the four created_at row dates (open
 *   invoices + unallocated payments, customer + supplier).
 * - aged-debts.service.ts: default as-of "today".
 * - ar-dunning.engine.ts: createdAt display day (pure engine, no tenant
 *   context: system business timezone, env BUSINESS_TIMEZONE else
 *   Africa/Cairo -- the same fallback the tenant gateway uses).
 * - sale-edit-remediation-repair.engine.ts: default run-id day (threaded
 *   through the gateway from the entry point, which owns the db handle).
 *
 * LEFT AS-IS (stored-DATE slice -- slicing a DATE column's UTC rendering
 * is exact, or a validation round-trip on a YYYY-MM-DD string):
 * - accounting-posting.service.ts fiscal-year end_date, installment
 *   due_date; accounting-boundaries.ts lock dates; accounting-tax-lock.ts
 *   accountingDateKey (documented stored-DATE-only, all callers pass DATE
 *   columns); forex-revaluation.service.ts period-date validation;
 *   fiscal-year / pdc formatDate (every caller passes DATE columns);
 *   pdc-cheques.service.ts cheque/action-date validations;
 *   aged-debts.service.ts min(invoice_date); ar-dunning.engine.ts
 *   effectiveDueDate (the engine's own computed date -- its slice must
 *   stay consistent with the daysOverdue math from the same Date);
 *   fiscal-period-generation.engine.ts (Date.UTC calendar math).
 *
 * The fix routes every instant through the canonical gateway
 * resolveBusinessDateKey (tenant timezone from settings, default
 * Africa/Cairo) or, for sync row formatting, its formatter todayTenantDate
 * with a once-resolved zone. No new helper was invented.
 *
 * Deterministic proofs (fixed instants, so they fail on unfixed code at any
 * hour -- never a "today" comparison): the gateway boundary itself, the
 * payment-allocation rows end to end through the real service, and the
 * pure dunning engine. The remediation run-id case is window-limited by
 * construction (it can only distinguish fixed/unfixed inside 00:00-02:59
 * Cairo, when the UTC day and the Cairo day differ); it pins the wiring.
 *
 * Run: npx ts-node test/critical/business-date-accounting.spec.ts (from backend/).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { resolveBusinessDateKey } from '../../src/modules/accounting/engines/accounting-date.engine';
import { accountingDateKey } from '../../src/modules/accounting/accounting-tax-lock';
import { todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { PaymentAllocationService } from '../../src/modules/accounting/services/payment-allocation.service';
import { allocateCustomerOverdueFifo } from '../../src/modules/accounting/engines/ar-dunning.engine';
import { buildMonthlyFiscalPeriods } from '../../src/modules/accounting/engines/fiscal-period-generation.engine';
import { repairSaleEditCandidates } from '../../src/modules/accounting/remediation/sale-edit-remediation-repair.engine';

// The dunning engine is pure and has no tenant context: its display day
// uses the system business timezone. Pin it explicitly so the run does not
// depend on the machine's environment.
process.env.BUSINESS_TIMEZONE = 'Africa/Cairo';

const AUTH = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: [] } as never;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const allocation = new PaymentAllocationService(db);
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, doc_no text, total numeric, paid_amount numeric, store_credit_used numeric, payment_type text, status text, created_at timestamptz);
      CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, supplier_id bigint, doc_no text, total numeric, paid_amount numeric, payment_type text, status text, created_at timestamptz);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, invoice_id bigint, total numeric, refund_allocations text, return_type text);
      CREATE TABLE supplier_payment_schedules (id bigint PRIMARY KEY, tenant_id text, purchase_id bigint, paid_amount numeric);
      CREATE TABLE customer_payments (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, amount numeric, note text, created_at timestamptz);
      CREATE TABLE supplier_payments (id bigint PRIMARY KEY, tenant_id text, supplier_id bigint, doc_no text, amount numeric, note text, created_at timestamptz);
      CREATE TABLE payment_allocations (id bigint PRIMARY KEY, tenant_id text, payment_id bigint, payment_type text, allocated_amount numeric);
    `);
    await sql.raw(`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`).execute(db);
    await sql.raw(`INSERT INTO settings VALUES ('t1', 'timezone', 'Africa/Cairo')`).execute(db);
    await sql.raw(`INSERT INTO settings VALUES ('t2', 'currency', 'EGP')`).execute(db);
    await sql.raw(`INSERT INTO settings VALUES ('t2', 'timezone', 'Asia/Dubai')`).execute(db);
    await sql.raw(`INSERT INTO currency_exchange_rates VALUES ('t1', 'EGP', true, 1)`).execute(db);

    // 1. Gateway boundary: 00:30 Cairo on 2026-11-08 is 22:30 UTC on
    // 2026-11-07. The UTC slice keys the previous day; the gateway keys
    // the tenant-local day. Same instant in Dubai (+04) is 02:30 on the 8th.
    const cairoInstant = new Date('2026-11-07T22:30:00.000Z');
    assert.equal(await resolveBusinessDateKey(db, 't1', cairoInstant), '2026-11-08', 'Cairo 00:30 instant keys 2026-11-08');
    assert.equal(await resolveBusinessDateKey(db, 't2', cairoInstant), '2026-11-08', 'Dubai 02:30 instant keys 2026-11-08');
    assert.equal(await resolveBusinessDateKey(db, 't1', '2026-11-08'), '2026-11-08', 'calendar-day string passes through untouched');
    assert.equal(await resolveBusinessDateKey(db, 't1', new Date('2026-11-08T22:30:00.000Z')), '2026-11-09', 'Cairo 00:30 on the 9th keys 2026-11-09, not the UTC 8th');
    // Stored-DATE helper stays exact (the LEAVE verdict, pinned).
    assert.equal(accountingDateKey(new Date('2026-11-08T00:00:00.000Z')), '2026-11-08', 'stored DATE slices to itself');
    assert.equal(accountingDateKey('2026-11-08'), '2026-11-08', 'stored DATE string passes through');

    // 2. Payment-allocation rows end to end: a sale/payment recorded at
    // 00:30 Cairo belongs to the Cairo business day, not the UTC day.
    await sql.raw(`INSERT INTO sales VALUES (1, 't1', 1, 'INV-1', 1000, 0, 0, 'cash', 'posted', '2026-11-07 22:30:00+00')`).execute(db);
    await sql.raw(`INSERT INTO purchases VALUES (1, 't1', 7, 'BILL-1', 500, 0, 'cash', 'posted', '2026-11-07 22:30:00+00')`).execute(db);
    await sql.raw(`INSERT INTO customer_payments VALUES (1, 't1', 1, 300, '', '2026-11-07 22:30:00+00')`).execute(db);
    await sql.raw(`INSERT INTO supplier_payments VALUES (1, 't1', 7, 'SP-1', 200, '', '2026-11-07 22:30:00+00')`).execute(db);
    const openSales = await withTimeout(allocation.getOpenInvoices('customer', 1, AUTH), 25000, 'getOpenInvoices customer');
    assert.equal(openSales.length, 1, 'one open sale');
    assert.equal(openSales[0].date, '2026-11-08', 'open sale date is the Cairo business day');
    const openBills = await withTimeout(allocation.getOpenInvoices('supplier', 7, AUTH), 25000, 'getOpenInvoices supplier');
    assert.equal(openBills.length, 1, 'one open bill');
    assert.equal(openBills[0].date, '2026-11-08', 'open bill date is the Cairo business day');
    const openPayments = await withTimeout(allocation.getUnallocatedPayments('customer', 1, AUTH), 25000, 'getUnallocatedPayments customer');
    assert.equal(openPayments.length, 1, 'one unallocated customer payment');
    assert.equal(openPayments[0].date, '2026-11-08', 'unallocated customer payment date is the Cairo business day');
    const openSupplierPayments = await withTimeout(allocation.getUnallocatedPayments('supplier', 7, AUTH), 25000, 'getUnallocatedPayments supplier');
    assert.equal(openSupplierPayments.length, 1, 'one unallocated supplier payment');
    assert.equal(openSupplierPayments[0].date, '2026-11-08', 'unallocated supplier payment date is the Cairo business day');

    // 3. Dunning engine (pure, no db): invoice created 00:30 Cairo shows
    // the Cairo day; the engine-computed due date is untouched.
    const dunning = allocateCustomerOverdueFifo(
      1000,
      [{ id: 1, invoiceNumber: 'INV-1', createdAt: new Date('2026-11-07T22:30:00.000Z'), dueDate: '2026-11-10', total: 1000, paidAmount: 0 }],
      new Date('2026-11-20T12:00:00Z'),
      0,
      2,
    );
    assert.equal(dunning.overdueInvoices.length, 1, 'one overdue invoice');
    assert.equal(dunning.overdueInvoices[0].createdAt, '2026-11-08', 'dunning createdAt is the Cairo business day');
    assert.equal(dunning.overdueInvoices[0].dueDate, '2026-11-10', 'dunning dueDate unchanged');
    assert.equal(dunning.overdueInvoices[0].daysOverdue, 10, 'daysOverdue unchanged by the display fix');

    // 4. Fiscal-period generation stays exact (UTC calendar math, pinned).
    const periods = buildMonthlyFiscalPeriods('2026-01-01', '2026-03-31');
    assert.equal(periods.length, 3, 'three monthly periods');
    assert.equal(periods[0].startDate, '2026-01-01', 'Jan starts 2026-01-01');
    assert.equal(periods[0].endDate, '2026-01-31', 'Jan ends 2026-01-31');
    assert.equal(periods[1].endDate, '2026-02-28', 'Feb 2026 ends 2026-02-28');
    assert.equal(periods[2].endDate, '2026-03-31', 'Mar ends 2026-03-31');

    // 5. Remediation run id carries the tenant-local day. Window-limited:
    // it distinguishes fixed/unfixed only while the UTC day and the Cairo
    // day differ (00:00-02:59 Cairo); the deterministic proofs are (1)-(3).
    const expectedRunDay = await resolveBusinessDateKey(db, 't1', new Date());
    const report = await withTimeout(
      repairSaleEditCandidates(db, {} as never, AUTH, [], { tenantId: 't1', bookDigits: 2 }),
      25000,
      'repairSaleEditCandidates empty batch',
    );
    assert.equal(report.runId, `sale-edit-remediation-${expectedRunDay}`, 'empty-batch run id uses the tenant-local day');
    assert.equal(report.counts.wouldReverse, 0, 'empty batch reverses nothing');
    // The formatter the services use agrees with the gateway on the same instant.
    assert.equal(todayTenantDate('Africa/Cairo', cairoInstant), '2026-11-08', 'todayTenantDate agrees with the gateway');

    console.log('business-date-accounting.spec: ok (gateway Cairo/Dubai boundary, allocation 4/4 rows 2026-11-08, dunning createdAt 2026-11-08, periods Jan-Mar, remediation run id tenant-local)');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
