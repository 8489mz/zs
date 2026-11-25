import { type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    try {
      await db.schema.alterTable('accounting_settings').addColumn('lock_date_all', 'date').execute();
    } catch (e) {
      // Ignore if column already exists
    }

    try {
      await db.schema.alterTable('accounting_settings').addColumn('lock_date_non_adviser', 'date').execute();
    } catch (e) {
      // Ignore if column already exists
    }

    try {
      await db.schema.alterTable('accounting_settings').addColumn('lock_date_tax', 'date').execute();
    } catch (e) {
      // Ignore if column already exists
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    try {
      await db.schema.alterTable('accounting_settings').dropColumn('lock_date_all').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('accounting_settings').dropColumn('lock_date_non_adviser').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('accounting_settings').dropColumn('lock_date_tax').execute();
    } catch (e) {}
  },
};
