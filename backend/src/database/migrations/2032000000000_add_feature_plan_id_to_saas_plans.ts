import { type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable('saas_plans')
      .addColumn('feature_plan_id', 'varchar(255)', (col) => col.references('plans.id').onDelete('set null'))
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('saas_plans').dropColumn('feature_plan_id').execute();
  },
};
