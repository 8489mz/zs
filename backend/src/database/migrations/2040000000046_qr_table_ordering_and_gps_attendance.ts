import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. Branches: add GPS coordinates and geofence radius
    await sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7)`.execute(db);
    await sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7)`.execute(db);
    await sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER NOT NULL DEFAULT 100`.execute(
      db,
    );

    // 2. HR Employees: add quick PIN code and mobile punch flag
    await sql`ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS pin_code VARCHAR(10)`.execute(db);
    await sql`ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS mobile_punch_enabled BOOLEAN NOT NULL DEFAULT true`.execute(
      db,
    );

    // 3. HR Attendance Records: expand source check constraint & add GPS + Selfie columns
    await sql`ALTER TABLE hr_attendance_records DROP CONSTRAINT IF EXISTS hr_attendance_records_source_valid`.execute(
      db,
    );
    await sql`ALTER TABLE hr_attendance_records ADD CONSTRAINT hr_attendance_records_source_valid CHECK (source IN ('manual', 'import', 'mobile_gps'))`.execute(
      db,
    );

    await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS check_in_gps_lat NUMERIC(10, 7)`.execute(db);
    await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS check_in_gps_lng NUMERIC(10, 7)`.execute(db);
    await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS check_in_selfie_url TEXT`.execute(db);
    await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS check_out_gps_lat NUMERIC(10, 7)`.execute(db);
    await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS check_out_gps_lng NUMERIC(10, 7)`.execute(db);
    await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS check_out_selfie_url TEXT`.execute(db);
    await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL`.execute(
      db,
    );
    await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS distance_meters NUMERIC(10, 2)`.execute(db);
    await sql`ALTER TABLE hr_attendance_records ADD COLUMN IF NOT EXISTS is_geofence_verified BOOLEAN NOT NULL DEFAULT true`.execute(
      db,
    );

    // 4. Online Orders: add table_number & order_type for Dine-in QR ordering
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(32) DEFAULT 'delivery'`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS table_number VARCHAR(64)`.execute(db);

    // Index for quick lookup of dine_in orders
    await sql`CREATE INDEX IF NOT EXISTS idx_online_orders_table ON online_orders(tenant_id, order_type, table_number)`.execute(
      db,
    );
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_online_orders_table`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS table_number`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS order_type`.execute(db);

    await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS is_geofence_verified`.execute(db);
    await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS distance_meters`.execute(db);
    await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS branch_id`.execute(db);
    await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS check_out_selfie_url`.execute(db);
    await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS check_out_gps_lng`.execute(db);
    await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS check_out_gps_lat`.execute(db);
    await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS check_in_selfie_url`.execute(db);
    await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS check_in_gps_lng`.execute(db);
    await sql`ALTER TABLE hr_attendance_records DROP COLUMN IF EXISTS check_in_gps_lat`.execute(db);

    await sql`ALTER TABLE hr_employees DROP COLUMN IF EXISTS mobile_punch_enabled`.execute(db);
    await sql`ALTER TABLE hr_employees DROP COLUMN IF EXISTS pin_code`.execute(db);

    await sql`ALTER TABLE branches DROP COLUMN IF EXISTS geofence_radius_meters`.execute(db);
    await sql`ALTER TABLE branches DROP COLUMN IF EXISTS longitude`.execute(db);
    await sql`ALTER TABLE branches DROP COLUMN IF EXISTS latitude`.execute(db);
  },
};
