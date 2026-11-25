import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // Add tax and insurance columns to hr_employees
    await db.schema
      .alterTable('hr_employees')
      .addColumn('has_social_insurance', 'boolean', (col) => col.defaultTo(false).notNull())
      .addColumn('insurance_salary', 'decimal(15, 2)')
      .addColumn('has_income_tax', 'boolean', (col) => col.defaultTo(false).notNull())
      .execute();

    // Create hr_holidays table
    await db.schema
      .createTable('hr_holidays')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar', (col) => col.notNull())
      .addColumn('account_id', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar', (col) => col.notNull())
      .addColumn('start_date', 'date', (col) => col.notNull())
      .addColumn('end_date', 'date', (col) => col.notNull())
      .addColumn('created_by', 'integer')
      .addColumn('updated_by', 'integer')
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    await db.schema.createIndex('hr_holidays_tenant_id_idx').on('hr_holidays').column('tenant_id').execute();

    await db.schema
      .createIndex('hr_holidays_dates_idx')
      .on('hr_holidays')
      .columns(['tenant_id', 'start_date', 'end_date'])
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('hr_holidays').execute();

    await db.schema
      .alterTable('hr_employees')
      .dropColumn('has_social_insurance')
      .dropColumn('insurance_salary')
      .dropColumn('has_income_tax')
      .execute();
  },
};
