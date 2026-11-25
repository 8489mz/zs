import { sql, type Kysely } from 'kysely';

// Closes the Multimodal Freight Forwarding, Cargo Insurance, and Warehouse Intake gaps:
// 1. Expands ports & carriers to support Air Freight (IATA airports, airlines).
// 2. Expands inquiries, RFQs, quotations, and jobs to support transport_mode ('sea', 'air', 'road', 'multimodal').
// 3. Adds Air Freight operational fields: gross_weight, volumetric_weight, chargeable_weight, CBM, AWB numbers, flight number/date.
// 4. Creates maritime_cargo_insurances: policy tracking, coverage types, insured values, and claims.
// 5. Creates maritime_warehouse_receipts: bonded/transit warehouse intake (linked to stock_locations), rack/bin allocation, release workflow.
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // 1. Alter shipping_ports to support airports & land terminals
    await sql`
      ALTER TABLE shipping_ports
      ADD COLUMN IF NOT EXISTS port_type TEXT NOT NULL DEFAULT 'sea',
      ADD COLUMN IF NOT EXISTS iata_code VARCHAR(3) NULL,
      ADD COLUMN IF NOT EXISTS icao_code VARCHAR(4) NULL;
    `.execute(db);

    // Seed major international and regional cargo airports if not present
    await sql`
      INSERT INTO shipping_ports (tenant_id, code, name_ar, name_en, country_code, country_name, port_type, iata_code, icao_code, is_active)
      VALUES
        ('', 'CAI', 'مطار القاهرة الدولي لشحن البضائع', 'Cairo International Cargo Airport', 'EG', 'مصر', 'air', 'CAI', 'HECA', true),
        ('', 'DXB', 'مطار دبي الدولي للشحن - قرية الشحن', 'Dubai Cargo Village (DXB)', 'AE', 'الإمارات', 'air', 'DXB', 'OMDB', true),
        ('', 'DWC', 'مطار آل مكتوم الدولي - دبي ورلد سنترال', 'Al Maktoum International Cargo (DWC)', 'AE', 'الإمارات', 'air', 'DWC', 'OMDW', true),
        ('', 'JED', 'مطار الملك عبد العزيز الدولي للشحن', 'King Abdulaziz Cargo Airport - Jeddah', 'SA', 'السعودية', 'air', 'JED', 'OEJN', true),
        ('', 'RUH', 'مطار الملك خالد الدولي للشحن - الرياض', 'King Khalid Cargo Airport - Riyadh', 'SA', 'السعودية', 'air', 'RUH', 'OERK', true),
        ('', 'FRA', 'مطار فرانكفورت الدولي للشحن', 'Frankfurt CargoCity (FRA)', 'DE', 'ألمانيا', 'air', 'FRA', 'EDDF', true),
        ('', 'LHR', 'مطار لندن هيثرو للشحن', 'London Heathrow World Cargo Centre (LHR)', 'GB', 'بريطانيا', 'air', 'LHR', 'EGLL', true),
        ('', 'JFK', 'مطار جون إف كينيدي الدولي للشحن', 'John F. Kennedy International Cargo (JFK)', 'US', 'الولايات المتحدة', 'air', 'JFK', 'KJFK', true),
        ('', 'HKG', 'مطار هونغ كونغ الدولي للشحن', 'Hong Kong International Cargo (HKG)', 'HK', 'هونغ كونغ', 'air', 'HKG', 'VHHH', true),
        ('', 'IST', 'مطار إسطنبول الدولي للشحن', 'Istanbul Cargo Hub (IST)', 'TR', 'تركيا', 'air', 'IST', 'LTFM', true)
      ON CONFLICT DO NOTHING;
    `.execute(db);

    // 2. Alter shipping_lines to support Airlines and Trucking carriers
    await sql`
      ALTER TABLE shipping_lines
      ADD COLUMN IF NOT EXISTS carrier_type TEXT NOT NULL DEFAULT 'shipping_line',
      ADD COLUMN IF NOT EXISTS airline_prefix VARCHAR(3) NULL;
    `.execute(db);

    // Seed major air cargo carriers
    await sql`
      INSERT INTO shipping_lines (tenant_id, code, name_ar, name_en, carrier_type, airline_prefix, is_active)
      VALUES
        ('', 'MS-CARGO', 'مصر للطيران للشحن الجوي', 'EgyptAir Cargo', 'airline', '077', true),
        ('', 'EK-SKY', 'الإمارات للشحن الجوي', 'Emirates SkyCargo', 'airline', '176', true),
        ('', 'SV-CARGO', 'الخطوط السعودية للشحن', 'Saudia Cargo', 'airline', '065', true),
        ('', 'QR-CARGO', 'القطرية للشحن الجوي', 'Qatar Airways Cargo', 'airline', '157', true),
        ('', 'TK-CARGO', 'الخطوط التركية للشحن', 'Turkish Cargo', 'airline', '235', true),
        ('', 'LH-CARGO', 'لوفتهانزا للشحن الجوي', 'Lufthansa Cargo', 'airline', '020', true)
      ON CONFLICT DO NOTHING;
    `.execute(db);

    // 3. Alter operational tables with transport_mode and air cargo fields
    const tablesToAlter = ['maritime_inquiries', 'maritime_rfqs', 'maritime_quotations', 'maritime_jobs'];

    for (const table of tablesToAlter) {
      await sql`
        ALTER TABLE ${sql.raw(table)}
        ADD COLUMN IF NOT EXISTS transport_mode TEXT NOT NULL DEFAULT 'sea',
        ADD COLUMN IF NOT EXISTS air_cargo_type TEXT NULL,
        ADD COLUMN IF NOT EXISTS gross_weight_kg NUMERIC(15, 3) NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS volumetric_weight_kg NUMERIC(15, 3) NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS chargeable_weight_kg NUMERIC(15, 3) NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_cbm NUMERIC(15, 3) NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS package_count INT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS flight_number TEXT NULL,
        ADD COLUMN IF NOT EXISTS flight_date DATE NULL,
        ADD COLUMN IF NOT EXISTS mawb_number TEXT NULL,
        ADD COLUMN IF NOT EXISTS hawb_number TEXT NULL;
      `.execute(db);
    }

    // 4. Alter rate cards to support Air & Road rates
    await sql`
      ALTER TABLE maritime_rate_cards
      ADD COLUMN IF NOT EXISTS transport_mode TEXT NOT NULL DEFAULT 'sea',
      ADD COLUMN IF NOT EXISTS rate_basis TEXT NOT NULL DEFAULT 'per_container',
      ADD COLUMN IF NOT EXISTS min_charge NUMERIC(15, 3) NULL DEFAULT 0;
    `.execute(db);

    // 5. Create maritime_cargo_insurances
    await sql`
      CREATE TABLE IF NOT EXISTS maritime_cargo_insurances (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '',
        job_id BIGINT NOT NULL REFERENCES maritime_jobs(id) ON DELETE CASCADE,
        policy_number TEXT NOT NULL,
        insurance_company TEXT NOT NULL,
        insured_value NUMERIC(15, 3) NOT NULL DEFAULT 0,
        premium_amount NUMERIC(15, 3) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        coverage_type TEXT NOT NULL DEFAULT 'all_risks',
        issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
        expiry_date DATE NULL,
        status TEXT NOT NULL DEFAULT 'active',
        claim_amount NUMERIC(15, 3) NULL DEFAULT 0,
        claim_status TEXT NULL,
        claim_notes TEXT NULL,
        certificate_url TEXT NULL,
        notes TEXT NULL,
        created_by BIGINT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_cargo_ins_status CHECK (status IN ('draft', 'active', 'claimed', 'cancelled', 'expired')),
        CONSTRAINT chk_cargo_ins_coverage CHECK (coverage_type IN ('all_risks', 'clauses_a', 'clauses_b', 'clauses_c'))
      );
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_cargo_ins_job
      ON maritime_cargo_insurances (tenant_id, job_id);
    `.execute(db);

    // 6. Create maritime_warehouse_receipts
    await sql`
      CREATE TABLE IF NOT EXISTS maritime_warehouse_receipts (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '',
        receipt_number TEXT NOT NULL,
        job_id BIGINT NOT NULL REFERENCES maritime_jobs(id) ON DELETE CASCADE,
        location_id BIGINT NULL REFERENCES stock_locations(id) ON DELETE SET NULL,
        received_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        package_count INT NOT NULL DEFAULT 0,
        gross_weight_kg NUMERIC(15, 3) NOT NULL DEFAULT 0,
        cbm NUMERIC(15, 3) NOT NULL DEFAULT 0,
        bay_rack_bin TEXT NULL,
        warehouse_status TEXT NOT NULL DEFAULT 'in_storage',
        released_at TIMESTAMPTZ NULL,
        released_by BIGINT NULL,
        notes TEXT NULL,
        created_by BIGINT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_wh_receipt_status CHECK (warehouse_status IN ('in_storage', 'inspected', 'released', 'transferred'))
      );
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_wh_receipts_job
      ON maritime_warehouse_receipts (tenant_id, job_id);
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_wh_receipts_location
      ON maritime_warehouse_receipts (tenant_id, location_id);
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TABLE IF EXISTS maritime_warehouse_receipts;`.execute(db);
    await sql`DROP TABLE IF EXISTS maritime_cargo_insurances;`.execute(db);

    await sql`
      ALTER TABLE maritime_rate_cards
      DROP COLUMN IF EXISTS transport_mode,
      DROP COLUMN IF EXISTS rate_basis,
      DROP COLUMN IF EXISTS min_charge;
    `.execute(db);

    const tablesToRevert = ['maritime_jobs', 'maritime_quotations', 'maritime_rfqs', 'maritime_inquiries'];

    for (const table of tablesToRevert) {
      await sql`
        ALTER TABLE ${sql.raw(table)}
        DROP COLUMN IF EXISTS transport_mode,
        DROP COLUMN IF EXISTS air_cargo_type,
        DROP COLUMN IF EXISTS gross_weight_kg,
        DROP COLUMN IF EXISTS volumetric_weight_kg,
        DROP COLUMN IF EXISTS chargeable_weight_kg,
        DROP COLUMN IF EXISTS total_cbm,
        DROP COLUMN IF EXISTS package_count,
        DROP COLUMN IF EXISTS flight_number,
        DROP COLUMN IF EXISTS flight_date,
        DROP COLUMN IF EXISTS mawb_number,
        DROP COLUMN IF EXISTS hawb_number;
      `.execute(db);
    }

    await sql`
      ALTER TABLE shipping_lines
      DROP COLUMN IF EXISTS carrier_type,
      DROP COLUMN IF EXISTS airline_prefix;
    `.execute(db);

    await sql`
      ALTER TABLE shipping_ports
      DROP COLUMN IF EXISTS port_type,
      DROP COLUMN IF EXISTS iata_code,
      DROP COLUMN IF EXISTS icao_code;
    `.execute(db);
  },
};
