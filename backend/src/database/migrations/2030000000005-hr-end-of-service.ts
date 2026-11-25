import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await sql`
    ALTER TABLE hr_employees 
    ADD COLUMN IF NOT EXISTS end_of_service_date DATE,
    ADD COLUMN IF NOT EXISTS end_of_service_reason TEXT;
  `.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`
    ALTER TABLE hr_employees 
    DROP COLUMN IF EXISTS end_of_service_date,
    DROP COLUMN IF EXISTS end_of_service_reason;
  `.execute(db);
  },
};
