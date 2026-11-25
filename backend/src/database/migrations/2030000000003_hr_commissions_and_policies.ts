import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('hr_employees')
      .addColumn('commission_type', 'varchar(50)', (col) => col.defaultTo('inherit'))
      .addColumn('commission_value', 'numeric(15, 4)')
      .addColumn('commission_target', 'numeric(15, 4)')
      .addColumn('delay_policy', 'varchar(50)', (col) => col.defaultTo('inherit'))
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('hr_employees')
      .dropColumn('commission_type')
      .dropColumn('commission_value')
      .dropColumn('commission_target')
      .dropColumn('delay_policy')
      .execute();
  },
};
