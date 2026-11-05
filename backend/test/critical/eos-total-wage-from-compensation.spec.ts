/*
 * INV-EOS-TOTAL-WAGE-FROM-COMPENSATION: the end-of-service total wage
 * is the contract base salary PLUS the allowance of the compensation
 * package effective on the termination date, derived from the existing
 * hr_compensation_packages store. Before this package the service read
 * housing_allowance / transport_allowance / other_allowances /
 * gross_salary off hr_employment_contracts -- columns that DO NOT
 * EXIST in the schema -- so every read silently yielded 0 and every
 * settlement was computed on base salary alone.
 *
 * THE FLAGGED ASSUMPTION: hr_compensation_packages has ONE allowance
 * bucket with no housing/transport split, so the WHOLE bucket counts
 * toward the statutory total wage. If non-statutory allowances are
 * ever recorded in the same bucket, gratuity is overstated. The
 * preview discloses allowanceAmount so the user can see the
 * derivation. Deductions never count toward the wage.
 *
 * RULES PINNED HERE, driving the REAL EndOfServiceService preview
 * on PGlite (the settle path reuses this preview, so fixing it
 * fixes settlements too):
 * 1. A package effective on the termination date adds its FULL
 *    monthly allowance (never prorated) to the base salary.
 * 2. No package covering the date -> base salary alone (unchanged).
 * 3. Expired / not-yet-effective packages are ignored.
 * 4. Two packages covering the termination date fail closed
 *    (ambiguous, mirroring payroll's overlap rejection) instead of
 *    summing or picking one silently.
 * 5. A negative allowance fails closed.
 * 6. A deduction-only package adds nothing to the wage.
 * 7. Source pin: the service reads no phantom contract columns.
 *
 * Deliberately unchanged: the employee-portal profile display, which
 * shows housing/transport allowances off the contract row (always 0).
 * The package store has no split to display as housing vs transport,
 * so inventing one there would fabricate data. Prospective only:
 * settlements already posted on the base-only basis are untouched.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { EndOfServiceService } from '../../src/modules/hr/services/end-of-service.service';
import { calculateGratuity } from '../../src/modules/hr/engines/eos-calculation.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = {
  userId: 1,
  sessionId: 'sess-spec',
  username: 'actor-1',
  role: 'admin',
  permissions: [],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE settings (id bigserial PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, employee_no text, first_name text, last_name text, display_name text, hire_date text, status text, department_id bigint, annual_leave_balance numeric, used_annual_leaves numeric);
      CREATE TABLE hr_employment_contracts (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, contract_no text, contract_type text, status text, start_date text, end_date text, base_salary numeric, currency text);
      CREATE TABLE hr_compensation_packages (id bigserial PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, contract_id bigint, package_name text, allowance_amount numeric, deduction_amount numeric, effective_from text, effective_to text, notes text);
      CREATE TABLE hr_leave_requests (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, leave_type_id bigint, leave_type text, days_count numeric, status text);
      CREATE TABLE hr_leave_types (id bigserial PRIMARY KEY, tenant_id text, code text, name text);
      CREATE TABLE hr_employee_loans (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, remaining_amount numeric, status text);
      CREATE TABLE hr_employee_assets (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, asset_type text, asset_name text, asset_code text, serial_no text, assigned_at text, status text);
      INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'currency', 'EGP');
    `);
    // Seven employees, one per case, so packages never interfere.
    for (let i = 1; i <= 7; i++) {
      await pg.exec(`
        INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, annual_leave_balance, used_annual_leaves)
        VALUES (${i}, 't1', 'E${i}', 'Emp', '${i}', 'Emp ${i}', '2020-01-01', 'active', 0, 0);
        INSERT INTO hr_employment_contracts (tenant_id, employee_id, contract_no, contract_type, status, start_date, end_date, base_salary, currency)
        VALUES ('t1', ${i}, 'C${i}', 'unlimited', 'active', '2020-01-01', NULL, 3000, 'EGP');
      `);
    }
    await pg.exec(`
      INSERT INTO hr_compensation_packages (tenant_id, employee_id, package_name, allowance_amount, deduction_amount, effective_from, effective_to)
      VALUES ('t1', 1, 'Allowances', 1000, 0, '2025-01-01', NULL);
      INSERT INTO hr_compensation_packages (tenant_id, employee_id, package_name, allowance_amount, deduction_amount, effective_from, effective_to)
      VALUES ('t1', 3, 'Expired', 1000, 0, '2024-01-01', '2025-12-31');
      INSERT INTO hr_compensation_packages (tenant_id, employee_id, package_name, allowance_amount, deduction_amount, effective_from, effective_to)
      VALUES ('t1', 4, 'Future', 1000, 0, '2026-02-01', NULL);
      INSERT INTO hr_compensation_packages (tenant_id, employee_id, package_name, allowance_amount, deduction_amount, effective_from, effective_to)
      VALUES ('t1', 5, 'First', 800, 0, '2025-01-01', NULL);
      INSERT INTO hr_compensation_packages (tenant_id, employee_id, package_name, allowance_amount, deduction_amount, effective_from, effective_to)
      VALUES ('t1', 5, 'Second', 500, 0, '2025-06-01', NULL);
      INSERT INTO hr_compensation_packages (tenant_id, employee_id, package_name, allowance_amount, deduction_amount, effective_from, effective_to)
      VALUES ('t1', 6, 'Deductions only', 0, 500, '2025-01-01', NULL);
      INSERT INTO hr_compensation_packages (tenant_id, employee_id, package_name, allowance_amount, deduction_amount, effective_from, effective_to)
      VALUES ('t1', 7, 'Negative', -100, 0, '2025-01-01', NULL);
    `);

    const service = new EndOfServiceService(db as never, {} as never, {} as never);
    const preview = (employeeId: number) =>
      service.calculateSettlementPreview(
        { employeeId, terminationDate: '2026-01-01', terminationReason: 'resignation', lawType: 'saudi', pendingSalaryAmount: 0 },
        AUTH,
      );

    // 1. Package effective at termination: full monthly allowance added.
    const withPackage: any = await preview(1);
    assert.equal(withPackage.salaries.basicSalary, 3000);
    assert.equal(withPackage.salaries.allowanceAmount, 1000);
    assert.equal(withPackage.salaries.totalSalary, 4000);
    // D4: the daily wage divides by the termination month's days
    // (January = 31): 4000 / 31 = 129.03, never a fixed 30.
    assert.equal(withPackage.salaries.dailyWage, 129.03);
    const expected = calculateGratuity({
      serviceYearsDecimal: withPackage.servicePeriod.totalYearsDecimal,
      totalSalary: 4000,
      dailyWage: 4000 / 30,
      lawType: 'saudi',
      reason: 'resignation',
      minorUnits: 2,
    });
    assert.equal(withPackage.gratuity.gratuityAmount, expected.gratuityAmount, 'gratuity must be computed on the derived total wage');

    // 2. No package: base salary alone, unchanged behaviour.
    const noPackage: any = await preview(2);
    assert.equal(noPackage.salaries.allowanceAmount, 0);
    assert.equal(noPackage.salaries.totalSalary, 3000);

    // 3. Expired and 4. future packages are ignored.
    assert.equal((await preview(3)).salaries.totalSalary, 3000);
    assert.equal((await preview(4)).salaries.totalSalary, 3000);

    // 5. Overlapping packages fail closed.
    await assert.rejects(preview(5), /حزمة بدلات/);

    // 6. Deduction-only package adds nothing to the wage.
    assert.equal((await preview(6)).salaries.totalSalary, 3000);

    // 7. Negative allowance fails closed.
    await assert.rejects(preview(7), /حزمة التعويض/);

    // 8. Source pin: no phantom contract-column reads remain.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/hr/services/end-of-service.service.ts'),
      'utf8',
    );
    for (const prop of ['housing_allowance', 'transport_allowance', 'other_allowances', 'gross_salary']) {
      assert.ok(!source.includes(`latestContract.${prop}`), `phantom read latestContract.${prop} must be gone`);
    }

    console.log('EOS total wage from compensation checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
