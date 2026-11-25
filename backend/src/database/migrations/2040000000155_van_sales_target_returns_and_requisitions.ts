import { sql, type Kysely } from 'kysely';

/**
 * Migration 2040000000155: Van Sales Enterprise Capabilities
 *
 * 1. van_field_returns: Structured field returns workflow requiring admin approval,
 *    categorized return reasons, original invoice matching, and ledger/stock posting.
 * 2. delivery_rep_targets: Monthly sales targets per delivery/van representative.
 * 3. van_load_requisitions: Self-service loading requisition workflow (Driver drafts -> Manager reviews/adjusts -> Dispatches).
 * 4. customer_ledger: Add gps_lat and gps_lng for recording field collection geolocations.
 */
export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // 1. Van Field Returns with Admin Approval Workflow
    await sql`
      CREATE TABLE IF NOT EXISTS van_field_returns (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        doc_no VARCHAR(100) NOT NULL,
        trip_id INTEGER NOT NULL REFERENCES van_sales_trips(id) ON DELETE CASCADE,
        rep_id INTEGER NOT NULL REFERENCES delivery_representatives(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        sale_id INTEGER NULL REFERENCES sales(id),
        status VARCHAR(30) NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected')),
        return_reason VARCHAR(50) NOT NULL CHECK (return_reason IN ('damaged', 'expired', 'manufacturing_defect', 'stagnant', 'order_mismatch', 'customer_request')),
        total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
        items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        notes TEXT NULL,
        rejection_reason TEXT NULL,
        approved_by INTEGER NULL,
        approved_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_van_field_returns_tenant_trip ON van_field_returns(tenant_id, trip_id);
      CREATE INDEX IF NOT EXISTS idx_van_field_returns_tenant_status ON van_field_returns(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_van_field_returns_customer ON van_field_returns(tenant_id, customer_id);
    `.execute(db);

    // 2. Representative Monthly Sales Targets
    await sql`
      CREATE TABLE IF NOT EXISTS delivery_rep_targets (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        rep_id INTEGER NOT NULL REFERENCES delivery_representatives(id) ON DELETE CASCADE,
        period_month VARCHAR(7) NOT NULL,
        target_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now(),
        CONSTRAINT uq_rep_target_month UNIQUE (tenant_id, rep_id, period_month)
      );
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_delivery_rep_targets_period ON delivery_rep_targets(tenant_id, period_month);
    `.execute(db);

    // 3. Van Load Requisitions (Morning Loading Requisitions & Dispatch)
    await sql`
      CREATE TABLE IF NOT EXISTS van_load_requisitions (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(50) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        doc_no VARCHAR(100) NOT NULL,
        rep_id INTEGER NOT NULL REFERENCES delivery_representatives(id),
        source_warehouse_id INTEGER NOT NULL REFERENCES stock_locations(id),
        status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'dispatched')),
        requested_items JSONB NOT NULL DEFAULT '[]'::jsonb,
        approved_items JSONB NULL,
        notes TEXT NULL,
        rejection_reason TEXT NULL,
        reviewed_by INTEGER NULL,
        reviewed_at TIMESTAMP NULL,
        trip_id INTEGER NULL REFERENCES van_sales_trips(id),
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_van_load_requisitions_tenant_rep ON van_load_requisitions(tenant_id, rep_id);
      CREATE INDEX IF NOT EXISTS idx_van_load_requisitions_tenant_status ON van_load_requisitions(tenant_id, status);
    `.execute(db);

    // 4. Field collection GPS coordinates
    await sql`
      ALTER TABLE customer_ledger ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION;
      ALTER TABLE customer_ledger ADD COLUMN IF NOT EXISTS gps_lng DOUBLE PRECISION;
    `.execute(db);
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await sql`ALTER TABLE customer_ledger DROP COLUMN IF EXISTS gps_lng;`.execute(db);
    await sql`ALTER TABLE customer_ledger DROP COLUMN IF EXISTS gps_lat;`.execute(db);
    await sql`DROP TABLE IF EXISTS van_load_requisitions;`.execute(db);
    await sql`DROP TABLE IF EXISTS delivery_rep_targets;`.execute(db);
    await sql`DROP TABLE IF EXISTS van_field_returns;`.execute(db);
  },
};
