import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_fee_mode VARCHAR(32) DEFAULT 'freelance_courier'`.execute(
      db,
    );
    await sql`ALTER TABLE delivery_representatives ADD COLUMN IF NOT EXISTS rep_type VARCHAR(32) DEFAULT 'freelance'`.execute(
      db,
    );
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS delivery_fee_mode`.execute(db);
    await sql`ALTER TABLE delivery_representatives DROP COLUMN IF EXISTS rep_type`.execute(db);
  },
};
