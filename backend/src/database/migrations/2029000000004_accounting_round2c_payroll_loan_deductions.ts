import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('hr_payroll_loan_deduction_allocations')
      .addColumn('id', 'bigserial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar', (col) => col.notNull())
      .addColumn('account_id', 'varchar', (col) => col.notNull())
      .addColumn('payroll_run_id', 'bigint', (col) =>
        col.references('hr_payroll_runs.id').notNull().onDelete('cascade'),
      )
      .addColumn('payroll_run_item_id', 'bigint', (col) =>
        col.references('hr_payroll_run_items.id').notNull().onDelete('cascade'),
      )
      .addColumn('employee_id', 'bigint', (col) => col.references('hr_employees.id').notNull())
      .addColumn('loan_id', 'bigint', (col) => col.references('hr_employee_loans.id').notNull())
      .addColumn('installment_id', 'bigint', (col) => col.references('hr_employee_loan_installments.id').notNull())
      .addColumn('amount', 'numeric(15, 2)', (col) => col.notNull())
      .addColumn('ledger_id', 'bigint', (col) => col.references('hr_employee_ledger.id'))
      .addColumn('created_by', 'bigint', (col) => col.references('users.id').onDelete('set null'))
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    await sql`
      CREATE UNIQUE INDEX idx_hr_payroll_loan_deductions_uniq
      ON hr_payroll_loan_deduction_allocations(tenant_id, payroll_run_item_id, loan_id, installment_id)
    `.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('hr_payroll_loan_deduction_allocations').execute();
  },
};
