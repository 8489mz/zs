import { type Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. Create zatca_egs_units table for ZATCA Phase 2 compliance and cryptographic hardware units
    await sql
      .raw(
        `
      CREATE TABLE IF NOT EXISTS zatca_egs_units (
        id BIGSERIAL PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        branch_id INT,
        device_uuid VARCHAR(100) NOT NULL UNIQUE,
        device_name VARCHAR(150) NOT NULL,
        custom_id VARCHAR(100),
        private_key_pem TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        csr_content TEXT,
        compliance_csid TEXT,
        compliance_secret TEXT,
        production_csid TEXT,
        production_secret TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'unregistered',
        last_icv BIGINT NOT NULL DEFAULT 0,
        last_invoice_hash VARCHAR(64) NOT NULL DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMjRiMWUxMDhkNDQ3ZjhlNzY1ZmVhNGU3NDkyNDQ1NQ==',
        environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
      )
      .execute(db);

    await sql
      .raw(
        `
      CREATE INDEX IF NOT EXISTS idx_zatca_egs_tenant_branch ON zatca_egs_units(tenant_id, branch_id);
      CREATE INDEX IF NOT EXISTS idx_zatca_egs_status ON zatca_egs_units(status);
    `,
      )
      .execute(db);

    // 2. Add ZATCA Phase 2 and ETA CAdES-BES audit columns to sales table
    await sql
      .raw(
        `
      ALTER TABLE sales 
      ADD COLUMN IF NOT EXISTS zatca_uuid VARCHAR(100),
      ADD COLUMN IF NOT EXISTS zatca_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS zatca_prev_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS zatca_icv BIGINT,
      ADD COLUMN IF NOT EXISTS zatca_status VARCHAR(30) DEFAULT 'not_submitted',
      ADD COLUMN IF NOT EXISTS zatca_qr TEXT,
      ADD COLUMN IF NOT EXISTS zatca_ubl_xml TEXT,
      ADD COLUMN IF NOT EXISTS eta_cades_signature TEXT,
      ADD COLUMN IF NOT EXISTS eta_canonical_hash VARCHAR(64);
    `,
      )
      .execute(db);

    await sql
      .raw(
        `
      CREATE INDEX IF NOT EXISTS idx_sales_zatca_icv ON sales(tenant_id, zatca_icv);
      CREATE INDEX IF NOT EXISTS idx_sales_zatca_status ON sales(tenant_id, zatca_status);
    `,
      )
      .execute(db);
  },

  async down(_db: Kysely<any>): Promise<void> {
    // no-op: backwards compatibility preservation
  },
};
