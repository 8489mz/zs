import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .createTable('hr_employee_adjustments')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(36)', (col) => col.notNull())
      .addColumn('employee_id', 'integer', (col) => col.notNull().references('hr_employees.id'))
      .addColumn('adjustment_type', 'varchar(50)', (col) => col.notNull()) // 'allowance', 'deduction'
      .addColumn('amount_type', 'varchar(50)', (col) => col.notNull()) // 'money', 'days', 'hours'
      .addColumn('amount', 'decimal(10, 2)', (col) => col.notNull())
      .addColumn('date', 'date', (col) => col.notNull())
      .addColumn('reason', 'text')
      .addColumn('status', 'varchar(50)', (col) => col.notNull().defaultTo('pending')) // 'pending', 'applied'
      .addColumn('applied_in_run_id', 'integer') // referencing hr_payroll_runs.id
      .addColumn('created_by', 'integer', (col) => col.notNull())
      .addColumn('updated_by', 'integer', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`NOW()`).notNull())
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`NOW()`).notNull())
      .execute();

    await db.schema
      .createIndex('hr_employee_adjustments_tenant_id_idx')
      .on('hr_employee_adjustments')
      .column('tenant_id')
      .execute();

    await db.schema
      .createIndex('hr_employee_adjustments_employee_id_idx')
      .on('hr_employee_adjustments')
      .column('employee_id')
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.dropTable('hr_employee_adjustments').execute();
  },
};
