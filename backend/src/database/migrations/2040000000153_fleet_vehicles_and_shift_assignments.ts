import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. Create fleet_vehicles table for company distribution vans and delivery vehicles
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_vehicles (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        plate_number VARCHAR(50) NOT NULL,
        model_name VARCHAR(100),
        vehicle_type VARCHAR(50) NOT NULL DEFAULT 'van',
        vin_chassis VARCHAR(100),
        van_location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
        branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
        current_odometer NUMERIC(12, 2) NOT NULL DEFAULT 0,
        fuel_type VARCHAR(30) DEFAULT 'gasoline',
        license_expires_at DATE,
        status VARCHAR(30) NOT NULL DEFAULT 'available',
        assigned_rep_id INTEGER REFERENCES delivery_representatives(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      )
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_tenant_status ON fleet_vehicles(tenant_id, status)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_tenant_plate ON fleet_vehicles(tenant_id, plate_number)`.execute(
      db,
    );

    // 2. Link van_sales_trips with fleet_vehicles and shift metadata
    await sql`ALTER TABLE van_sales_trips ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES fleet_vehicles(id) ON DELETE SET NULL`.execute(
      db,
    );
    await sql`ALTER TABLE van_sales_trips ADD COLUMN IF NOT EXISTS shift_name VARCHAR(50) DEFAULT 'صباحي'`.execute(db);
    await sql`ALTER TABLE van_sales_trips ADD COLUMN IF NOT EXISTS start_odometer NUMERIC(12, 2)`.execute(db);
    await sql`ALTER TABLE van_sales_trips ADD COLUMN IF NOT EXISTS end_odometer NUMERIC(12, 2)`.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE van_sales_trips DROP COLUMN IF EXISTS end_odometer`.execute(db);
    await sql`ALTER TABLE van_sales_trips DROP COLUMN IF EXISTS start_odometer`.execute(db);
    await sql`ALTER TABLE van_sales_trips DROP COLUMN IF EXISTS shift_name`.execute(db);
    await sql`ALTER TABLE van_sales_trips DROP COLUMN IF EXISTS vehicle_id`.execute(db);
    await sql`DROP TABLE IF EXISTS fleet_vehicles`.execute(db);
  },
};
