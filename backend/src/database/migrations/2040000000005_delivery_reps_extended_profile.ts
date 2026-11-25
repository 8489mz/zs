import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE delivery_representatives ADD COLUMN IF NOT EXISTS full_name VARCHAR(255)`.execute(db);
    await sql`ALTER TABLE delivery_representatives ADD COLUMN IF NOT EXISTS national_id VARCHAR(50)`.execute(db);
    await sql`ALTER TABLE delivery_representatives ADD COLUMN IF NOT EXISTS address TEXT`.execute(db);
    await sql`ALTER TABLE delivery_representatives ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(50)`.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('delivery_representatives')
      .dropColumn('full_name')
      .dropColumn('national_id')
      .dropColumn('address')
      .dropColumn('vehicle_plate')
      .execute();
  },
};
