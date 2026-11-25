import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS annual_leave_balance NUMERIC(10, 2) DEFAULT 21`.execute(
      db,
    );
    await sql`ALTER TABLE hr_leave_types ADD COLUMN IF NOT EXISTS deducts_from_balance BOOLEAN DEFAULT FALSE`.execute(
      db,
    );
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE hr_employees DROP COLUMN IF EXISTS annual_leave_balance`.execute(db);
    await sql`ALTER TABLE hr_leave_types DROP COLUMN IF EXISTS deducts_from_balance`.execute(db);
  },
};
