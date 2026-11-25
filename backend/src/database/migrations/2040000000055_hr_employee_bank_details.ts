import { type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    try {
      await db.schema.alterTable('hr_employees').addColumn('bank_name', 'varchar(100)').execute();
    } catch (e) {}

    try {
      await db.schema.alterTable('hr_employees').addColumn('bank_account_number', 'varchar(50)').execute();
    } catch (e) {}

    try {
      await db.schema.alterTable('hr_employees').addColumn('iban', 'varchar(50)').execute();
    } catch (e) {}

    try {
      await db.schema.alterTable('hr_employees').addColumn('bank_swift_code', 'varchar(20)').execute();
    } catch (e) {}
  },

  async down(db: Kysely<any>): Promise<void> {
    try {
      await db.schema.alterTable('hr_employees').dropColumn('bank_name').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('hr_employees').dropColumn('bank_account_number').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('hr_employees').dropColumn('iban').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('hr_employees').dropColumn('bank_swift_code').execute();
    } catch (e) {}
  },
};
