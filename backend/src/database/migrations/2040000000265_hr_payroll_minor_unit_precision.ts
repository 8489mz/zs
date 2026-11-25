import { sql, type Kysely } from 'kysely';

/**
 * HR payroll P1 storage widening (INV-HR-PAYROLL-BOOK-PRECISION): without
 * this, Postgres silently rounds the package's 3-decimal payroll values
 * back to 2dp at insert/update time -- exactly the failure 0263 fixed
 * for GRNI and 0264 fixed for treasury. The payroll engines in this
 * package compute at tenant book precision; the columns below are the
 * complete input -> run-item -> loan-allocation chain for a payroll run.
 * Rollback deliberately NEVER truncates posted three-decimal balances.
 * Follows the 0263/0264 information_schema pattern; integer capacity
 * preserved (precision grows by exactly the scale growth).
 *
 * Deliberately NOT widened here (separate packages, separate engines):
 * - hr_end_of_service_settlements (EOS computation is still 2dp; its
 *   storage and engine move together in the EOS sub-package).
 * - hr_employees.annual_leave_balance / used_annual_leaves (leave DAYS,
 *   not money), hr_attendance_records.distance_meters (metres),
 *   recruitment expected_salary (not a payroll input), and
 *   hr_employees.commission_value/target (already numeric(15,4)).
 */
const columns: Array<[string, string, number]> = [
  // Payroll run output: every amount the run stores and the GL reads.
  ['hr_payroll_run_items', 'base_salary', 3],
  ['hr_payroll_run_items', 'allowance_amount', 3],
  ['hr_payroll_run_items', 'deduction_amount', 3],
  ['hr_payroll_run_items', 'loan_deduction_amount', 3],
  ['hr_payroll_run_items', 'gross_pay', 3],
  ['hr_payroll_run_items', 'net_pay', 3],
  ['hr_payroll_run_items', 'employee_social_insurance', 3],
  ['hr_payroll_run_items', 'employer_social_insurance', 3],
  ['hr_payroll_run_items', 'income_tax', 3],
  ['hr_payroll_run_items', 'penalty_deduction', 3],
  ['hr_payroll_run_items', 'carried_forward_deduction', 3],
  ['hr_payroll_run_items', 'asset_recovery_deduction_amount', 3],
  // Manual run adjustments and the loan amounts allocated inside a run.
  ['hr_payroll_item_adjustments', 'amount', 3],
  ['hr_payroll_loan_deduction_allocations', 'amount', 3],
  // Payroll inputs: a KWD contract salary of 100.125 must survive
  // storage before the run ever sees it; the old 2dp columns (and the
  // requireStoredHrMoney gate) rounded it to 100.13 at save time.
  ['hr_employment_contracts', 'base_salary', 3],
  ['hr_compensation_packages', 'allowance_amount', 3],
  ['hr_compensation_packages', 'deduction_amount', 3],
  ['hr_employees', 'hourly_rate', 3],
  ['hr_employees', 'insurance_salary', 3],
  ['hr_employee_adjustments', 'amount', 3],
  // Employee loans: principal, balances and installments feed the
  // scheduled loan deduction of the run through the loan engine.
  ['hr_employee_loans', 'principal_amount', 3],
  ['hr_employee_loans', 'paid_amount', 3],
  ['hr_employee_loans', 'remaining_amount', 3],
  ['hr_employee_loans', 'installment_amount', 3],
  ['hr_employee_loans', 'monthly_installment_amount', 3],
  ['hr_employee_loan_installments', 'amount', 3],
  ['hr_employee_loan_installments', 'paid_amount', 3],
  ['hr_employee_ledger', 'amount', 3],
  ['hr_employee_ledger', 'balance_after', 3],
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const [table, column, requiredScale] of columns) {
    const { rows } = await sql<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>`
      SELECT data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}
    `.execute(db);
    if (!rows.length) continue; // Legacy optional schema tables are absent on some migrations.
    const info = rows[0];
    if (info.data_type !== 'numeric' || info.numeric_scale === null || info.numeric_precision === null) {
      throw new Error(`Currency precision migration requires a constrained numeric column: ${table}.${column}`);
    }
    if (Number(info.numeric_scale) >= requiredScale) continue;
    const widenedPrecision = Number(info.numeric_precision) - Number(info.numeric_scale) + requiredScale;
    // Names are a fixed internal allowlist; no tenant-controlled SQL identifiers.
    await sql
      .raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(${widenedPrecision}, ${requiredScale})`)
      .execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never destroy 0.001 posted data by narrowing numeric precision on rollback.
}

export const migration = { up, down };
