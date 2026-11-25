import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .alterTable('hr_employees')
      .addColumn('pay_frequency', 'varchar(50)', (col) => col.notNull().defaultTo('monthly'))
      .execute();

    await db.schema
      .alterTable('hr_payroll_runs')
      .addColumn('pay_frequency', 'varchar(50)', (col) => col.notNull().defaultTo('monthly'))
      .addColumn('start_date', 'date')
      .addColumn('end_date', 'date')
      .execute();

    // Populate existing rows with dummy dates based on period_month (e.g., '2026-06')
    await sql`
    UPDATE hr_payroll_runs
    SET start_date = CAST(CONCAT(period_month, '-01') AS DATE),
        end_date = CAST(CONCAT(period_month, '-01') AS DATE) + INTERVAL '1 month' - INTERVAL '1 day'
    WHERE start_date IS NULL
  `.execute(db);
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .alterTable('hr_payroll_runs')
      .dropColumn('end_date')
      .dropColumn('start_date')
      .dropColumn('pay_frequency')
      .execute();

    await db.schema.alterTable('hr_employees').dropColumn('pay_frequency').execute();
  },
};
