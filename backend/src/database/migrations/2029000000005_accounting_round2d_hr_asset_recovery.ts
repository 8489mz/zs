import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('hr_employee_adjustments')
      .addColumn('source_type', 'varchar(100)', (col) => col.defaultTo(null))
      .addColumn('source_id', 'varchar(100)', (col) => col.defaultTo(null))
      .addColumn('accounting_category', 'varchar(100)', (col) => col.defaultTo(null))
      .execute();

    await db.schema
      .alterTable('hr_payroll_run_items')
      .addColumn('asset_recovery_deduction_amount', 'numeric(15, 2)', (col) => col.notNull().defaultTo(0))
      .execute();

    await sql`
      CREATE UNIQUE INDEX idx_hr_employee_adjustments_asset_recovery_uniq
      ON hr_employee_adjustments(tenant_id, source_type, source_id)
      WHERE accounting_category = 'asset_recovery' AND source_type = 'hr_employee_asset' AND source_id IS NOT NULL
    `.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_hr_employee_adjustments_asset_recovery_uniq`.execute(db);

    await db.schema.alterTable('hr_payroll_run_items').dropColumn('asset_recovery_deduction_amount').execute();

    await db.schema
      .alterTable('hr_employee_adjustments')
      .dropColumn('source_type')
      .dropColumn('source_id')
      .dropColumn('accounting_category')
      .execute();
  },
};
