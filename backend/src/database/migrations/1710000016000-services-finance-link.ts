import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await sql`ALTER TABLE services ADD COLUMN IF NOT EXISTS payment_channel TEXT NOT NULL DEFAULT 'cash'`.execute(db);
    await sql`ALTER TABLE services ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL`.execute(
      db,
    );
    await sql`ALTER TABLE services ADD COLUMN IF NOT EXISTS location_id BIGINT NULL REFERENCES stock_locations(id) ON DELETE SET NULL`.execute(
      db,
    );
    await sql`UPDATE services SET payment_channel = 'cash' WHERE payment_channel IS NULL OR payment_channel NOT IN ('cash', 'card')`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_services_payment_channel ON services(payment_channel)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_services_branch_location ON services(branch_id, location_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_treasury_service_reference ON treasury_transactions(reference_type, reference_id)`.execute(
      db,
    );
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`DELETE FROM treasury_transactions WHERE reference_type = 'service'`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_treasury_service_reference`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_services_branch_location`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_services_payment_channel`.execute(db);
    await sql`ALTER TABLE services DROP COLUMN IF EXISTS location_id`.execute(db);
    await sql`ALTER TABLE services DROP COLUMN IF EXISTS branch_id`.execute(db);
    await sql`ALTER TABLE services DROP COLUMN IF EXISTS payment_channel`.execute(db);
  },
};
