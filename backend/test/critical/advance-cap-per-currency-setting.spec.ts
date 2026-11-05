/*
 * Direct-advance cash cap, configurable from settings per currency (N2):
 * the hardcoded 2,000 ignores the contract currency; the cap now resolves
 * from the payroll policies (per-currency map, then scalar, then the 2,000
 * default) and the currency label follows the tenant currency.
 * INV-ADVANCE-CAP-PER-CURRENCY-SETTING.
 *
 * Bars: resolver table (map / scalar / invalid -> default); engine cap
 * binds at the configured value and defaults to 2,000 when omitted;
 * calculation text and result label use د.ك for KWD and ج.م otherwise;
 * service-level: getEmployeeWithdrawalBalance with a KWD 500 policy row
 * caps at 500, with no policies row caps at the 2,000 default, a scalar
 * 100 caps at 100, and the map wins over the scalar. The service cases
 * use the daily path with 3 present punches dated today (UTC, seeded) so
 * the accrual is date-independent: 3 x (30000/30) = 3000, 50% = 1500.
 * Run: npx ts-node test/critical/advance-cap-per-currency-setting.spec.ts (from backend/).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import {
  calculateEmployeeWithdrawalBalance,
  currencyDisplayLabel,
  resolveDirectAdvanceCashCap,
  DEFAULT_DIRECT_ADVANCE_CASH_CAP,
} from '../../src/modules/hr/engines/employee-withdrawal-balance.engine';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';

const AUTH = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: [] } as never;
const AUDIT_STUB = { log: async () => ({}) } as never;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

// ---------- Part A: resolver, label, engine cap (pure) ----------
function partA(): void {
  assert.equal(DEFAULT_DIRECT_ADVANCE_CASH_CAP, 2000, 'default cap is 2000');
  assert.equal(resolveDirectAdvanceCashCap(null, 'KWD'), 2000, 'no policies -> default');
  assert.equal(resolveDirectAdvanceCashCap({}, 'KWD'), 2000, 'empty policies -> default');
  assert.equal(resolveDirectAdvanceCashCap({ directAdvanceCashCapByCurrency: { KWD: 500 } }, 'KWD'), 500, 'map entry for the currency');
  assert.equal(resolveDirectAdvanceCashCap({ directAdvanceCashCapByCurrency: { KWD: 500 } }, 'EGP'), 2000, 'map without this currency -> default');
  assert.equal(resolveDirectAdvanceCashCap({ directAdvanceCashCap: 3000 }, 'EGP'), 3000, 'scalar applies');
  assert.equal(resolveDirectAdvanceCashCap({ directAdvanceCashCap: 100, directAdvanceCashCapByCurrency: { KWD: 500 } }, 'KWD'), 500, 'map wins over scalar');
  assert.equal(resolveDirectAdvanceCashCap({ directAdvanceCashCapByCurrency: { KWD: 0 } }, 'KWD'), 2000, 'zero map entry -> default');
  assert.equal(resolveDirectAdvanceCashCap({ directAdvanceCashCapByCurrency: { KWD: -50 } }, 'KWD'), 2000, 'negative map entry -> default');
  assert.equal(resolveDirectAdvanceCashCap({ directAdvanceCashCap: 'lots' }, 'KWD'), 2000, 'non-numeric scalar -> default');
  assert.equal(resolveDirectAdvanceCashCap({ directAdvanceCashCapByCurrency: { kwd: 700 } }, 'KWD'), 700, 'map keys match case-insensitively');

  assert.equal(currencyDisplayLabel('KWD'), 'د.ك', 'KWD label');
  assert.equal(currencyDisplayLabel('SAR'), 'ر.س', 'SAR label');
  assert.equal(currencyDisplayLabel('EGP'), 'ج.م', 'EGP label');
  assert.equal(currencyDisplayLabel(undefined), 'ج.م', 'missing currency falls back to ج.م');

  const baseCtx = {
    employee: {
      id: 1, displayName: 'Test', compensationType: 'monthly' as const,
      payFrequency: 'monthly' as const, hourlyRate: 0,
      expectedDailyHours: 8, status: 'active',
    },
    contract: { baseSalary: 10000, currency: 'KWD' },
    currentCycle: { cycleStart: '2026-03-01', cycleEnd: '2026-03-31', daysElapsed: 31 },
    punches: [], priorLoans: [], unpaidApprovedPayrollItems: [],
    todayDate: '2026-03-31', minorUnits: 2 as const,
  };
  const capped = calculateEmployeeWithdrawalBalance({ ...baseCtx, directAdvanceCashCap: 500 });
  assert.equal(capped.directAdvanceCashCap, 500, 'engine reports the configured cap');
  assert.equal(capped.maxDirectAdvance, 500, 'configured cap binds (50% of 10000 is 5000)');
  assert.equal(capped.currencyLabel, 'د.ك', 'result label follows contract currency');
  assert.ok(capped.accrual.calculationText.includes('د.ك'), 'calculation text uses د.ك');

  const def = calculateEmployeeWithdrawalBalance(baseCtx);
  assert.equal(def.directAdvanceCashCap, 2000, 'omitted cap defaults to 2000');
  assert.equal(def.maxDirectAdvance, 2000, 'default cap binds as before');

  const invalid = calculateEmployeeWithdrawalBalance({ ...baseCtx, directAdvanceCashCap: 0 });
  assert.equal(invalid.directAdvanceCashCap, 2000, 'zero cap input falls back to default');

  const egp = calculateEmployeeWithdrawalBalance({ ...baseCtx, contract: { baseSalary: 10000, currency: 'EGP' } });
  assert.equal(egp.currencyLabel, 'ج.م', 'EGP label stays ج.م');
  console.log('part A ok (resolver / label / engine cap)');
}

// ---------- Part B: service-level threading through payroll policies ----------
const DDL = [
  `CREATE TABLE settings (tenant_id text NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (tenant_id, key))`,
  `CREATE TABLE hr_hr_settings (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text, key text NOT NULL, value text NOT NULL, updated_by integer, updated_at timestamptz DEFAULT now(), UNIQUE (tenant_id, key))`,
  `CREATE TABLE hr_employees (id integer PRIMARY KEY, tenant_id text NOT NULL, employee_no text, display_name text, compensation_type text, pay_frequency text, hourly_rate numeric, expected_daily_hours numeric, hire_date date, status text)`,
  `CREATE TABLE hr_employment_contracts (id integer PRIMARY KEY, tenant_id text NOT NULL, account_id text, employee_id integer NOT NULL, contract_no text, contract_type text, status text, start_date date, end_date date, base_salary numeric(14,3), currency text, notes text, created_by integer, updated_by integer, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`,
  `CREATE TABLE hr_payroll_runs (id integer PRIMARY KEY, tenant_id text NOT NULL, status text, period_month text, start_date date, end_date date)`,
  `CREATE TABLE hr_payroll_run_items (id integer PRIMARY KEY, tenant_id text NOT NULL, run_id integer, employee_id integer, status text, base_salary numeric, allowance_amount numeric, gross_pay numeric, deduction_amount numeric, loan_deduction_amount numeric, net_pay numeric)`,
  `CREATE TABLE hr_attendance_records (id integer PRIMARY KEY, tenant_id text NOT NULL, employee_id integer, work_date date, status text, check_in_at timestamptz, check_out_at timestamptz)`,
  `CREATE TABLE hr_employee_loans (id integer PRIMARY KEY, tenant_id text NOT NULL, employee_id integer, loan_type text, principal_amount numeric, remaining_amount numeric, issue_date date, status text)`,
];

async function runServiceCase(policiesJson: string | null): Promise<{ maxDirectAdvance: number; directAdvanceCashCap: number; currencyLabel: string; calculationText: string }> {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    for (const statement of DDL) await sql.raw(statement).execute(db);
    const today = new Date().toISOString().slice(0, 10);
    await sql.raw(`INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'currency', 'KWD'), ('t1', 'timezone', 'UTC')`).execute(db);
    if (policiesJson !== null) {
      await sql.raw(`INSERT INTO hr_hr_settings (tenant_id, account_id, key, value, updated_by) VALUES ('t1', 'a1', 'payroll_policies', '${policiesJson.replace(/'/g, "''")}', 1)`).execute(db);
    }
    await sql.raw(`INSERT INTO hr_employees (id, tenant_id, display_name, compensation_type, pay_frequency, hourly_rate, expected_daily_hours, hire_date, status) VALUES (1, 't1', 'Ahmed', 'monthly', 'daily', 0, 8, '2026-01-01', 'active')`).execute(db);
    await sql.raw(`INSERT INTO hr_employment_contracts (id, tenant_id, account_id, employee_id, contract_no, contract_type, status, start_date, end_date, base_salary, currency) VALUES (1, 't1', 'a1', 1, 'CON-1', 'standard', 'active', '2026-01-01', NULL, 30000, 'KWD')`).execute(db);
    for (let i = 1; i <= 3; i++) {
      await sql.raw(`INSERT INTO hr_attendance_records (id, tenant_id, employee_id, work_date, status) VALUES (${i}, 't1', 1, '${today}', 'present')`).execute(db);
    }
    const service = new HrService(db, new TransactionHelper(), AUDIT_STUB, {} as never, {} as never, undefined);
    const result = await withTimeout(service.getEmployeeWithdrawalBalance(1, AUTH), 25000, 'getEmployeeWithdrawalBalance');
    return {
      maxDirectAdvance: result.maxDirectAdvance,
      directAdvanceCashCap: result.directAdvanceCashCap,
      currencyLabel: result.currencyLabel,
      calculationText: result.accrual.calculationText,
    };
  } finally {
    await db.destroy();
  }
}

async function partB(): Promise<void> {
  // Map KWD 500 -> caps at 500 (accrual 3000, 50% is 1500).
  const mapped = await runServiceCase(JSON.stringify({ directAdvanceCashCapByCurrency: { KWD: 500 } }));
  assert.equal(mapped.directAdvanceCashCap, 500, 'service resolves the KWD map entry');
  assert.equal(mapped.maxDirectAdvance, 500, 'service caps at 500');
  assert.equal(mapped.currencyLabel, 'د.ك', 'service label follows contract currency');
  assert.ok(mapped.calculationText.includes('د.ك'), 'service calculation text uses د.ك');

  // No policies row -> 2,000 default, 50% binds at 1500.
  const unconfigured = await runServiceCase(null);
  assert.equal(unconfigured.directAdvanceCashCap, 2000, 'no policies row -> default cap');
  assert.equal(unconfigured.maxDirectAdvance, 1500, 'default cap: 50% of 3000 binds');

  // Scalar 100 -> caps at 100.
  const scalar = await runServiceCase(JSON.stringify({ directAdvanceCashCap: 100 }));
  assert.equal(scalar.directAdvanceCashCap, 100, 'service resolves the scalar cap');
  assert.equal(scalar.maxDirectAdvance, 100, 'service caps at 100');

  // Map wins over scalar.
  const both = await runServiceCase(JSON.stringify({ directAdvanceCashCap: 100, directAdvanceCashCapByCurrency: { KWD: 500 } }));
  assert.equal(both.directAdvanceCashCap, 500, 'service prefers the map entry');
  assert.equal(both.maxDirectAdvance, 500, 'service caps at the map value');

  console.log('part B ok (service threading: map / default / scalar / map-wins)');
}

async function main(): Promise<void> {
  partA();
  await partB();
  console.log('advance-cap-per-currency-setting.spec: ok');
}

main();
