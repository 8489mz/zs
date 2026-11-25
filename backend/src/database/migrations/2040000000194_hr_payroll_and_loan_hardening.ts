import { Kysely, sql } from 'kysely';

/**
 * Migration 2040000000194: HR Payroll and Loan Hardening
 *
 * 1. Adds missing statutory & deduction tracking columns to hr_payroll_run_items:
 *    - employee_social_insurance, employer_social_insurance, income_tax, penalty_deduction, carried_forward_deduction
 * 2. Adds physical column `used_annual_leaves` to hr_employees (preventing silent 0-fallback in EOS).
 * 3. Adds performance composite indexes for fast cumulative loan checks and leave balance aggregations.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // 1. hr_payroll_run_items statutory & deduction breakdown columns
  await sql`
    ALTER TABLE hr_payroll_run_items
    ADD COLUMN IF NOT EXISTS employee_social_insurance NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS employer_social_insurance NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS income_tax NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS penalty_deduction NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS carried_forward_deduction NUMERIC(14, 2) NOT NULL DEFAULT 0
  `.execute(db);

  // 2. hr_employees used_annual_leaves physical column
  await sql`
    ALTER TABLE hr_employees
    ADD COLUMN IF NOT EXISTS used_annual_leaves NUMERIC(10, 2) NOT NULL DEFAULT 0
  `.execute(db);

  // Backfill existing used annual leaves from approved requests
  await sql`
    UPDATE hr_employees e
    SET used_annual_leaves = COALESCE((
      SELECT SUM(lr.days_count)
      FROM hr_leave_requests lr
      LEFT JOIN hr_leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id = e.id
        AND lr.tenant_id = e.tenant_id
        AND lr.status = 'approved'
        AND (
          LOWER(COALESCE(lt.code, '')) IN ('annual', 'vacation')
          OR LOWER(COALESCE(lr.leave_type, '')) IN ('annual', 'vacation')
          OR COALESCE(lt.name, '') LIKE '%سنوية%'
        )
    ), 0)
    WHERE e.used_annual_leaves = 0
  `.execute(db);

  // 3. Composite indexes for high-frequency queries
  await sql`
    CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_tenant_emp_status
    ON hr_leave_requests (tenant_id, employee_id, status)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_hr_employee_loans_tenant_emp_status
    ON hr_employee_loans (tenant_id, employee_id, status)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_hr_employee_loans_tenant_emp_status`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_hr_leave_requests_tenant_emp_status`.execute(db);

  await sql`
    ALTER TABLE hr_employees
    DROP COLUMN IF EXISTS used_annual_leaves
  `.execute(db);

  await sql`
    ALTER TABLE hr_payroll_run_items
    DROP COLUMN IF EXISTS carried_forward_deduction,
    DROP COLUMN IF EXISTS penalty_deduction,
    DROP COLUMN IF EXISTS income_tax,
    DROP COLUMN IF EXISTS employer_social_insurance,
    DROP COLUMN IF EXISTS employee_social_insurance
  `.execute(db);
}

export const migration = {
  up,
  down,
};

export default migration;
