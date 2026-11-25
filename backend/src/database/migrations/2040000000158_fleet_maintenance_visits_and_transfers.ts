import { sql, type Kysely } from 'kysely';

/**
 * Migration 2040000000158: FMCG Wholesale & Van Distribution Enterprise Capabilities
 *
 * 1. fleet_fuel_logs: Fueling logs with price/liter, odometer, consumed km, and consumption rate (km/liter).
 * 2. fleet_oil_changes: Oil change records with customizable alert threshold (alert_km_before), filter flag, and next due odometer.
 * 3. fleet_vehicle_drivers: Multiple drivers and shifts assigned to a single vehicle.
 * 4. van_field_visits: Daily customer itinerary tracking (positive sales vs negative visits with reasons, postponement, GPS, and consecutive alert tracking).
 * 5. van_stock_transfers & van_stock_transfer_items: Inter-van street stock transfers requiring peer driver confirmation with supervisor audit notice.
 * 6. sales: Delivery proof photo URL and packaging breakdown (cartons, pieces, lines).
 */
export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // 1. Fleet Fuel Logs
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_fuel_logs (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        trip_id INTEGER NULL REFERENCES van_sales_trips(id) ON DELETE SET NULL,
        rep_id INTEGER NULL REFERENCES delivery_representatives(id) ON DELETE SET NULL,
        odometer NUMERIC(12, 2) NOT NULL,
        liters NUMERIC(10, 2) NOT NULL,
        price_per_liter NUMERIC(10, 2) NOT NULL,
        total_cost NUMERIC(12, 2) NOT NULL,
        station_name VARCHAR(150) NULL,
        km_since_last_fuel NUMERIC(12, 2) NOT NULL DEFAULT 0,
        consumption_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_fuel_logs_vehicle ON fleet_fuel_logs(tenant_id, vehicle_id);`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_fuel_logs_created ON fleet_fuel_logs(tenant_id, created_at DESC);`.execute(
      db,
    );

    // 2. Fleet Oil Changes & Maintenance
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_oil_changes (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        rep_id INTEGER NULL REFERENCES delivery_representatives(id) ON DELETE SET NULL,
        odometer_at_change NUMERIC(12, 2) NOT NULL,
        oil_type VARCHAR(100) NOT NULL,
        rated_km NUMERIC(10, 2) NOT NULL,
        with_filter BOOLEAN NOT NULL DEFAULT true,
        alert_km_before NUMERIC(10, 2) NOT NULL DEFAULT 500,
        next_due_odometer NUMERIC(12, 2) NOT NULL,
        cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
        performed_by VARCHAR(150) NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'overdue')),
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_oil_changes_vehicle ON fleet_oil_changes(tenant_id, vehicle_id);`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_oil_changes_status ON fleet_oil_changes(tenant_id, status);`.execute(
      db,
    );

    // 3. Multi-Driver Shift Vehicle Assignments
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_vehicle_drivers (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        vehicle_id INTEGER NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        rep_id INTEGER NOT NULL REFERENCES delivery_representatives(id) ON DELETE CASCADE,
        shift_name VARCHAR(50) NOT NULL DEFAULT 'صباحي',
        shift_start_time VARCHAR(10) NULL,
        shift_end_time VARCHAR(10) NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_vehicle_drivers_vehicle ON fleet_vehicle_drivers(tenant_id, vehicle_id);`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_vehicle_drivers_rep ON fleet_vehicle_drivers(tenant_id, rep_id);`.execute(
      db,
    );

    // 4. Van Field Visits & Itinerary
    await sql`
      CREATE TABLE IF NOT EXISTS van_field_visits (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        trip_id INTEGER NOT NULL REFERENCES van_sales_trips(id) ON DELETE CASCADE,
        rep_id INTEGER NOT NULL REFERENCES delivery_representatives(id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        visit_type VARCHAR(20) NOT NULL DEFAULT 'positive' CHECK (visit_type IN ('positive', 'negative')),
        sale_id INTEGER NULL REFERENCES sales(id) ON DELETE SET NULL,
        negative_reason VARCHAR(50) NULL CHECK (negative_reason IN ('no_cash', 'shop_closed', 'sufficient_stock', 'item_unavailable', 'postponed', 'other')),
        postponed_to_date DATE NULL,
        gps_lat DOUBLE PRECISION NULL,
        gps_lng DOUBLE PRECISION NULL,
        notes TEXT NULL,
        visited_at TIMESTAMP DEFAULT now(),
        created_at TIMESTAMP DEFAULT now()
      );
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_van_field_visits_trip ON van_field_visits(tenant_id, trip_id);`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_van_field_visits_customer ON van_field_visits(tenant_id, customer_id);`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_van_field_visits_rep ON van_field_visits(tenant_id, rep_id);`.execute(db);

    // 5. Inter-Van Transfers
    await sql`
      CREATE TABLE IF NOT EXISTS van_stock_transfers (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        transfer_no VARCHAR(100) NOT NULL,
        from_rep_id INTEGER NOT NULL REFERENCES delivery_representatives(id),
        from_trip_id INTEGER NULL REFERENCES van_sales_trips(id) ON DELETE SET NULL,
        from_van_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
        to_rep_id INTEGER NOT NULL REFERENCES delivery_representatives(id),
        to_trip_id INTEGER NULL REFERENCES van_sales_trips(id) ON DELETE SET NULL,
        to_van_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
        status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
        total_items_count INTEGER NOT NULL DEFAULT 0,
        total_qty NUMERIC(12, 2) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        accepted_at TIMESTAMP NULL,
        rejected_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_van_stock_transfers_tenant_status ON van_stock_transfers(tenant_id, status);`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_van_stock_transfers_to_rep ON van_stock_transfers(tenant_id, to_rep_id, status);`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_van_stock_transfers_from_rep ON van_stock_transfers(tenant_id, from_rep_id);`.execute(
      db,
    );

    await sql`
      CREATE TABLE IF NOT EXISTS van_stock_transfer_items (
        id SERIAL PRIMARY KEY,
        transfer_id INTEGER NOT NULL REFERENCES van_stock_transfers(id) ON DELETE CASCADE,
        tenant_id VARCHAR(50) NOT NULL,
        product_id INTEGER NOT NULL REFERENCES products(id),
        qty NUMERIC(12, 2) NOT NULL,
        unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
        unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0
      );
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_van_stock_transfer_items_transfer ON van_stock_transfer_items(transfer_id);`.execute(
      db,
    );

    // 6. Sales Table Extensions (Delivery Proof & Packaging Breakdown)
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_proof_photo TEXT;`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS packaging_breakdown JSONB;`.execute(db);
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS packaging_breakdown;`.execute(db);
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS delivery_proof_photo;`.execute(db);
    await sql`DROP TABLE IF EXISTS van_stock_transfer_items;`.execute(db);
    await sql`DROP TABLE IF EXISTS van_stock_transfers;`.execute(db);
    await sql`DROP TABLE IF EXISTS van_field_visits;`.execute(db);
    await sql`DROP TABLE IF EXISTS fleet_vehicle_drivers;`.execute(db);
    await sql`DROP TABLE IF EXISTS fleet_oil_changes;`.execute(db);
    await sql`DROP TABLE IF EXISTS fleet_fuel_logs;`.execute(db);
  },
};
