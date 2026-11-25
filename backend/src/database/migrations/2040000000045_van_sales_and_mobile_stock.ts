import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. Add van stock location & van rep flag to delivery_representatives
    await sql`ALTER TABLE delivery_representatives ADD COLUMN IF NOT EXISTS van_location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL`.execute(
      db,
    );
    await sql`ALTER TABLE delivery_representatives ADD COLUMN IF NOT EXISTS is_van_rep BOOLEAN DEFAULT false`.execute(
      db,
    );

    // 2. Create van_sales_trips table for daily trips & route settlements
    await sql`
      CREATE TABLE IF NOT EXISTS van_sales_trips (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        rep_id INTEGER NOT NULL REFERENCES delivery_representatives(id) ON DELETE CASCADE,
        van_location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
        source_warehouse_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
        status VARCHAR(30) NOT NULL DEFAULT 'open',
        opened_at TIMESTAMP DEFAULT now(),
        closed_at TIMESTAMP,
        loaded_amount NUMERIC(15, 2) DEFAULT 0,
        sales_amount NUMERIC(15, 2) DEFAULT 0,
        cash_collected NUMERIC(15, 2) DEFAULT 0,
        credit_sales NUMERIC(15, 2) DEFAULT 0,
        returns_amount NUMERIC(15, 2) DEFAULT 0,
        variance NUMERIC(15, 2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_van_trips_tenant_rep ON van_sales_trips(tenant_id, rep_id, status)`.execute(
      db,
    );

    // 3. Add van_trip_id & sale_origin to sales
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS van_trip_id INTEGER`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_origin VARCHAR(50) DEFAULT 'pos'`.execute(db);

    // 4. Add van_trip_id to customer_ledger
    await sql`ALTER TABLE customer_ledger ADD COLUMN IF NOT EXISTS van_trip_id INTEGER`.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE customer_ledger DROP COLUMN IF EXISTS van_trip_id`.execute(db);
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS sale_origin`.execute(db);
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS van_trip_id`.execute(db);
    await sql`DROP TABLE IF EXISTS van_sales_trips`.execute(db);
    await sql`ALTER TABLE delivery_representatives DROP COLUMN IF EXISTS is_van_rep`.execute(db);
    await sql`ALTER TABLE delivery_representatives DROP COLUMN IF EXISTS van_location_id`.execute(db);
  },
};
