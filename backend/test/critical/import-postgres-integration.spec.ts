import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { up as up234 } from '../../src/database/migrations/2040000000234_purchases_import_project_link';
import { up as up235 } from '../../src/database/migrations/2040000000235_supplier_payments_idempotency_key';
import { up as up236 } from '../../src/database/migrations/2040000000236_supplier_payments_foreign_amount';
import { up as up237 } from '../../src/database/migrations/2040000000237_international_trade_procurement_and_sourcing';
import { up as up238 } from '../../src/database/migrations/2040000000238_customs_broker_advances_and_container_deposits';
import { up as up239 } from '../../src/database/migrations/2040000000239_container_preorders_and_inventory_traceability';
import { up as up240 } from '../../src/database/migrations/2040000000240_import_governance_approvals_and_reconciliation';
import { up as up241 } from '../../src/database/migrations/2040000000241_import_container_refund_events';
import { up as up242 } from '../../src/database/migrations/2040000000242_import_late_expense_events';
import { up as up245 } from '../../src/database/migrations/2040000000245_import_preorder_refunds';
import {
  allocateSaleFromImportLots,
  restoreImportLotsFromCancelledSale,
  restoreImportLotsFromSalesReturn,
} from '../../src/modules/import-sales/helpers/import-lot-allocation.helper';

/**
 * Custom PGlite dialect supporting multi-statement execution via simple query protocol,
 * ensuring 100% fidelity when running real production migrations.
 */
class MultiStatementPGliteDialect extends PGliteDialect {
  constructor(private readonly pgliteInstance: PGlite) {
    super(pgliteInstance);
  }

  createDriver(): any {
    const driver: any = super.createDriver();
    const origAcquire = driver.acquireConnection.bind(driver);
    driver.acquireConnection = async () => {
      const conn = await origAcquire();
      const origExec = conn.executeQuery.bind(conn);
      conn.executeQuery = async (compiledQuery: any) => {
        if (!compiledQuery.parameters || compiledQuery.parameters.length === 0) {
          const results = await this.pgliteInstance.exec(compiledQuery.sql);
          const last = results[results.length - 1];
          return { rows: last?.rows || [] };
        }
        return origExec(compiledQuery);
      };
      return conn;
    };
    return driver;
  }
}

/**
 * IMPORT-POSTGRES-INTEGRATION — Real PostgreSQL Integration Tests.
 *
 * Verifies real database operations against production-grade schema and migrations:
 * 1. Project Closure: Architecture link between purchases and import_projects (import_project_id UUID vs project_id BIGINT), rejecting unsettled liabilities.
 * 2. Accounting Entries: Dynamic COA resolution without hardcoded account codes (2110, 1110, 5201, 1130, 5101) with balanced entries and tenant isolation.
 * 3. Foreign Transfers: Proforma supplier/project/currency matching, overpayment and DB idempotency key prevention, real bank account linkage, and EGP-only balanced journal.
 * 4. Late Shipment Expenses: Dynamic COA account resolution, decoupled supplier entity from payable account, and IAS 2 split between COGS and on-hand stock (using column `qty`).
 * 5. Partner UPSERT & UNIQUE Constraint Safety.
 * 6. Official Customs Tariff Reality Check.
 * 7. Hardened Negative Invariant Tests:
 *    - Supplier ID passed as GL account rejected.
 *    - Bank account pointing to expense account rejected.
 *    - Accounting operation in locked period rejected.
 *    - Unlinked purchase invoice vs linked purchase invoice checks.
 *    - Two legitimate transfers with identical amounts succeed.
 *    - Duplicate request with same idempotency key fails with ConflictException.
 */

async function setupDatabase(): Promise<{ db: Kysely<Database>; accounts: Record<string, number> }> {
  const pglite = new PGlite();
  const db = new Kysely<Database>({
    dialect: new MultiStatementPGliteDialect(pglite),
  });

  // Base production tables prior to migrations 234 and 235
  const baseDdl = `
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT 'Main Tenant',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Currency scope is now read by the real posting service. Do not mock out
    -- tenant base-currency validation just to make an embedded DB test green.
    CREATE TABLE settings (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );

    CREATE TABLE currency_exchange_rates (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      currency_code TEXT NOT NULL,
      is_base BOOLEAN NOT NULL DEFAULT FALSE,
      exchange_rate NUMERIC(18, 8) NOT NULL DEFAULT 1
    );

    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE accounting_accounts (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      code VARCHAR(50) NOT NULL,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NOT NULL,
      account_type VARCHAR(50) NOT NULL,
      account_group VARCHAR(50) NOT NULL,
      normal_balance VARCHAR(10) NOT NULL,
      parent_id BIGINT REFERENCES accounting_accounts(id) ON DELETE RESTRICT,
      is_active BOOLEAN DEFAULT TRUE,
      is_system BOOLEAN DEFAULT FALSE,
      allow_manual_entries BOOLEAN DEFAULT TRUE,
      is_control_account BOOLEAN DEFAULT FALSE,
      is_cash_bank BOOLEAN DEFAULT FALSE,
      is_receivable BOOLEAN DEFAULT FALSE,
      is_payable BOOLEAN DEFAULT FALSE,
      is_inventory BOOLEAN DEFAULT FALSE,
      is_tax BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_accounting_accounts_tenant_code UNIQUE (tenant_id, code)
    );

    CREATE TABLE accounting_settings (
      id BIGINT PRIMARY KEY DEFAULT 1,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      cash_account_id BIGINT REFERENCES accounting_accounts(id),
      bank_account_id BIGINT REFERENCES accounting_accounts(id),
      customer_receivable_account_id BIGINT REFERENCES accounting_accounts(id),
      supplier_payable_account_id BIGINT REFERENCES accounting_accounts(id),
      inventory_account_id BIGINT REFERENCES accounting_accounts(id),
      sales_revenue_account_id BIGINT REFERENCES accounting_accounts(id),
      sales_discount_account_id BIGINT REFERENCES accounting_accounts(id),
      cogs_account_id BIGINT REFERENCES accounting_accounts(id),
      purchase_account_id BIGINT REFERENCES accounting_accounts(id),
      expenses_account_id BIGINT REFERENCES accounting_accounts(id),
      sales_tax_account_id BIGINT REFERENCES accounting_accounts(id),
      purchase_tax_account_id BIGINT REFERENCES accounting_accounts(id),
      manufacturing_overhead_account_id BIGINT REFERENCES accounting_accounts(id),
      lock_date_all DATE,
      lock_date_non_adviser DATE,
      lock_date_tax DATE,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_accounting_settings_tenant UNIQUE (tenant_id)
    );

    CREATE TABLE accounting_fiscal_periods (
      id SERIAL PRIMARY KEY,
      tenant_id VARCHAR(255) NOT NULL,
      fiscal_year_id INTEGER,
      period_number INTEGER NOT NULL,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(50),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'open',
      closed_at TIMESTAMPTZ,
      closed_by INTEGER,
      closing_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE products (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT DEFAULT '1',
      name TEXT NOT NULL,
      name_en TEXT,
      sku TEXT,
      barcode TEXT,
      category_id BIGINT,
      supplier_id BIGINT,
      item_type TEXT DEFAULT 'product',
      item_kind TEXT DEFAULT 'standard',
      style_code TEXT,
      color TEXT,
      size TEXT,
      bin_location TEXT,
      default_location_id BIGINT,
      cost_price NUMERIC(15, 6) DEFAULT 0,
      retail_price NUMERIC(15, 2) DEFAULT 0,
      wholesale_price NUMERIC(15, 2) DEFAULT 0,
      stock_qty NUMERIC(15, 2) DEFAULT 0,
      reserved_qty NUMERIC(15, 2) DEFAULT 0,
      min_stock_qty NUMERIC(15, 2) DEFAULT 0,
      notes TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      tax_code_type TEXT,
      tax_code TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE product_location_stock (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT DEFAULT '1',
      product_id BIGINT NOT NULL REFERENCES products(id),
      branch_id BIGINT,
      location_id BIGINT,
      qty NUMERIC(15, 2) DEFAULT 0,
      reserved_qty NUMERIC(15, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE suppliers (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT DEFAULT '2110',
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      balance NUMERIC(15, 2) DEFAULT 0,
      notes TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE customers (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      balance NUMERIC(15, 2) DEFAULT 0,
      credit_limit NUMERIC(15, 2) DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE stock_locations (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      branch_id BIGINT NULL,
      name TEXT NOT NULL,
      is_default BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE stock_movements (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      product_id BIGINT NOT NULL REFERENCES products(id),
      movement_type VARCHAR(50) NOT NULL,
      qty NUMERIC(15, 3) NOT NULL,
      before_qty NUMERIC(15, 3) NOT NULL,
      after_qty NUMERIC(15, 3) NOT NULL,
      unit_cost NUMERIC(15, 6) NOT NULL,
      total_cost NUMERIC(15, 4) NOT NULL,
      reason TEXT,
      note TEXT,
      reference_type VARCHAR(50),
      reference_id BIGINT,
      import_receipt_id BIGINT,
      branch_id BIGINT,
      location_id BIGINT,
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE supplier_payments (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
      amount NUMERIC(15, 2) NOT NULL,
      doc_no TEXT,
      note TEXT,
      payment_date DATE DEFAULT CURRENT_DATE,
      currency VARCHAR(10) DEFAULT 'USD',
      exchange_rate NUMERIC(10, 4) DEFAULT 1.0,
      forex_variance_egp NUMERIC(12, 2) DEFAULT 0,
      proforma_invoice_id UUID,
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE supplier_ledger (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
      entry_type TEXT NOT NULL,
      amount NUMERIC(15, 2) NOT NULL,
      balance_after NUMERIC(15, 2) NOT NULL,
      note TEXT,
      reference_type TEXT,
      reference_id BIGINT,
      return_document_id BIGINT,
      branch_id BIGINT,
      location_id BIGINT,
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE customer_ledger (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT,
      customer_id BIGINT NOT NULL REFERENCES customers(id),
      entry_type TEXT NOT NULL,
      amount NUMERIC(15, 2) NOT NULL,
      balance_after NUMERIC(15, 2) NOT NULL,
      note TEXT,
      reference_type TEXT,
      reference_id BIGINT,
      return_document_id BIGINT,
      branch_id BIGINT,
      location_id BIGINT,
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE treasury_transactions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT,
      txn_type TEXT NOT NULL,
      amount NUMERIC(15, 2) NOT NULL,
      note TEXT,
      reference_type TEXT,
      reference_id BIGINT,
      return_document_id BIGINT,
      branch_id BIGINT,
      location_id BIGINT,
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE journal_entries (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT REFERENCES tenants(id),
      account_id TEXT,
      entry_no TEXT NOT NULL,
      dedup_key TEXT,
      cash_flow_category TEXT,
      entry_date DATE NOT NULL,
      description TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id BIGINT,
      status TEXT NOT NULL DEFAULT 'posted',
      branch_id BIGINT,
      location_id BIGINT,
      created_by BIGINT,
      posted_by BIGINT,
      posted_at TIMESTAMPTZ,
      cancelled_by BIGINT,
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT,
      reversal_of_entry_id BIGINT,
      reversed_by_entry_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE journal_entry_lines (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT REFERENCES tenants(id),
      journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account_id BIGINT NOT NULL REFERENCES accounting_accounts(id),
      cost_center_id BIGINT,
      description TEXT NOT NULL,
      debit NUMERIC(15, 2) DEFAULT 0,
      credit NUMERIC(15, 2) DEFAULT 0,
      partner_type TEXT DEFAULT 'none',
      partner_id BIGINT,
      branch_id BIGINT,
      location_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE expenses (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT,
      title TEXT NOT NULL,
      amount NUMERIC(15, 2) NOT NULL,
      cost_center_id BIGINT,
      expense_date DATE NOT NULL,
      note TEXT,
      branch_id BIGINT,
      location_id BIGINT,
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE sales (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT DEFAULT '1',
      doc_no TEXT,
      total NUMERIC(15, 2) DEFAULT 0,
      status TEXT DEFAULT 'completed',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE sale_items (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT DEFAULT '1',
      sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id BIGINT REFERENCES products(id),
      product_name TEXT NOT NULL,
      qty NUMERIC(15, 2) NOT NULL,
      unit_price NUMERIC(15, 2) NOT NULL,
      line_total NUMERIC(15, 2) NOT NULL,
      cost_price NUMERIC(15, 6) DEFAULT 0,
      allocated_discount NUMERIC(15, 2) DEFAULT 0
    );

    CREATE TABLE return_documents (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      return_type TEXT NOT NULL DEFAULT 'sale',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE return_items (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      return_document_id BIGINT NOT NULL REFERENCES return_documents(id) ON DELETE CASCADE,
      product_id BIGINT REFERENCES products(id),
      qty NUMERIC(15, 2) NOT NULL,
      line_total NUMERIC(15, 2) NOT NULL,
      cost_price NUMERIC(15, 6) DEFAULT 0
    );

    CREATE TABLE purchases (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      doc_no TEXT,
      supplier_id BIGINT REFERENCES suppliers(id),
      payment_type VARCHAR(20) DEFAULT 'credit',
      subtotal NUMERIC(15, 2) DEFAULT 0,
      discount NUMERIC(15, 2) DEFAULT 0,
      tax_rate NUMERIC(5, 2) DEFAULT 0,
      tax_amount NUMERIC(15, 2) DEFAULT 0,
      prices_include_tax BOOLEAN DEFAULT FALSE,
      total NUMERIC(15, 2) DEFAULT 0,
      paid_amount NUMERIC(15, 2) DEFAULT 0,
      note TEXT DEFAULT '',
      status VARCHAR(50) DEFAULT 'received',
      branch_id BIGINT,
      location_id BIGINT,
      created_by BIGINT,
      cancelled_at TIMESTAMPTZ,
      cancelled_by BIGINT,
      cancel_reason TEXT,
      required_date DATE,
      currency TEXT,
      company_name TEXT,
      contact_id BIGINT,
      shipping_address_id BIGINT,
      cost_center_id BIGINT,
      project_id BIGINT,
      terms_template TEXT,
      lifecycle_status TEXT,
      matched_status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_no TEXT NOT NULL,
      title TEXT NOT NULL,
      target_market TEXT DEFAULT NULL,
      country_origin TEXT DEFAULT NULL,
      country_destination TEXT DEFAULT NULL,
      budget_currency TEXT DEFAULT 'USD',
      allocated_capital NUMERIC(15, 2) DEFAULT 0,
      target_roi_percentage NUMERIC(5, 2) DEFAULT 0,
      status TEXT DEFAULT 'active',
      feasibility_data JSONB DEFAULT NULL,
      closure_data JSONB DEFAULT NULL,
      closure_date TIMESTAMPTZ DEFAULT NULL,
      closed_by BIGINT,
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_import_projects_tenant_project_no UNIQUE (tenant_id, project_no)
    );

    CREATE TABLE import_partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      phone TEXT,
      capital_amount NUMERIC(15, 2) DEFAULT 0,
      profit_share_percentage NUMERIC(5, 2) DEFAULT 0,
      withdrawn_profit NUMERIC(15, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_project_partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_id UUID NOT NULL REFERENCES import_projects(id) ON DELETE CASCADE,
      partner_id UUID NOT NULL REFERENCES import_partners(id) ON DELETE CASCADE,
      capital_share_amount NUMERIC(15, 2) DEFAULT 0,
      profit_percentage NUMERIC(5, 2) NOT NULL,
      effective_from DATE DEFAULT CURRENT_DATE,
      is_active BOOLEAN DEFAULT TRUE,
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_import_project_partners UNIQUE (tenant_id, project_id, partner_id)
    );

    CREATE TABLE import_partner_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      partner_id UUID NOT NULL REFERENCES import_partners(id) ON DELETE CASCADE,
      project_id UUID REFERENCES import_projects(id) ON DELETE SET NULL,
      entry_type TEXT NOT NULL,
      amount NUMERIC(15, 2) NOT NULL,
      notes TEXT,
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_partner_project_payouts (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      partner_id UUID NOT NULL REFERENCES import_partners(id),
      project_id UUID NOT NULL REFERENCES import_projects(id),
      treasury_transaction_id BIGINT NOT NULL REFERENCES treasury_transactions(id),
      amount_egp NUMERIC(15,2) NOT NULL CHECK (amount_egp > 0),
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, treasury_transaction_id)
    );

    CREATE TABLE import_sourcing_trips (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id UUID REFERENCES import_projects(id) ON DELETE SET NULL,
      trip_title VARCHAR(255) NOT NULL,
      destination_city VARCHAR(100) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE,
      budget_egp NUMERIC(12, 2) DEFAULT 0,
      actual_cost_egp NUMERIC(12, 2) DEFAULT 0,
      notes TEXT,
      findings JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_proforma_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_id UUID REFERENCES import_projects(id),
      supplier_id BIGINT REFERENCES suppliers(id),
      pi_number TEXT NOT NULL,
      pi_date DATE NOT NULL,
      currency VARCHAR(10) DEFAULT 'USD',
      exchange_rate NUMERIC(10, 4) DEFAULT 1.0,
      exchange_rate_contract NUMERIC(10, 4),
      total_amount_foreign NUMERIC(15, 2) DEFAULT 0,
      paid_amount_foreign NUMERIC(15, 2) DEFAULT 0,
      payment_status VARCHAR(50) DEFAULT 'unpaid',
      incoterms VARCHAR(20) DEFAULT 'FOB',
      payment_terms TEXT,
      status VARCHAR(50) DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_suppliers_meta (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      chinese_name VARCHAR(255),
      city VARCHAR(100),
      province VARCHAR(100),
      bank_name_usd VARCHAR(255),
      bank_swift_code VARCHAR(50),
      bank_account_usd VARCHAR(100),
      bank_country VARCHAR(100),
      factory_audit_rating VARCHAR(10),
      audit_status VARCHAR(50) DEFAULT 'unverified',
      verified_at TIMESTAMPTZ DEFAULT NULL,
      verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      verification_notes TEXT DEFAULT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_qc_inspections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id UUID REFERENCES import_projects(id) ON DELETE SET NULL,
      shipment_id UUID,
      stage VARCHAR(50) NOT NULL,
      inspection_date DATE NOT NULL,
      inspector_name VARCHAR(150),
      sample_size INTEGER DEFAULT 0,
      passed_quantity INTEGER DEFAULT 0,
      failed_quantity INTEGER DEFAULT 0,
      defect_notes TEXT,
      status VARCHAR(50) DEFAULT 'passed',
      report_file_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_shipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_id UUID REFERENCES import_projects(id),
      supplier_id BIGINT REFERENCES suppliers(id),
      container_number TEXT NOT NULL,
      container_type TEXT,
      seal_number TEXT,
      bl_number TEXT,
      shipping_line TEXT,
      departure_port TEXT,
      arrival_port TEXT,
      etd_date DATE,
      eta_date DATE,
      actual_arrival_date DATE,
      shipped_date DATE,
      clearance_date DATE,
      shipping_expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
      customs_expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
      transport_expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
      free_time_days INTEGER DEFAULT 14,
      daily_demurrage_usd NUMERIC(10, 2) DEFAULT 50,
      status TEXT DEFAULT 'Draft',
      cost_allocation_method VARCHAR(50) DEFAULT 'value',
      late_expenses_total_egp NUMERIC(12, 2) DEFAULT 0,
      late_cogs_adjustment_egp NUMERIC(12, 2) DEFAULT 0,
      late_inventory_adjustment_egp NUMERIC(12, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_aci_compliance (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id UUID REFERENCES import_projects(id) ON DELETE SET NULL,
      shipment_id UUID REFERENCES import_shipments(id) ON DELETE SET NULL,
      acid_number VARCHAR(50) NOT NULL,
      acid_issue_date DATE,
      acid_expiry_date DATE,
      cargox_document_id VARCHAR(100),
      importer_tax_number VARCHAR(50),
      exporter_id VARCHAR(100),
      status VARCHAR(50) DEFAULT 'pending',
      compliance_checklist JSONB DEFAULT '{}'::jsonb,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_shipment_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      shipment_id UUID NOT NULL REFERENCES import_shipments(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id),
      quantity NUMERIC(15, 2) NOT NULL,
      received_quantity NUMERIC(15, 2),
      factory_unit_price_usd NUMERIC(15, 4) NOT NULL,
      landed_cost_egp NUMERIC(15, 4) DEFAULT 0,
      shortage_handling_method VARCHAR(50) DEFAULT 'capitalize'
    );

    CREATE TABLE import_inventory_receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      shipment_id UUID NOT NULL REFERENCES import_shipments(id),
      receipt_number VARCHAR(100) DEFAULT 'REC-001',
      receipt_date DATE DEFAULT CURRENT_DATE,
      state VARCHAR(50) NOT NULL DEFAULT 'posted'
    );

    CREATE TABLE import_customs_tariffs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      hs_code VARCHAR(20) NOT NULL,
      description_ar VARCHAR(255) NOT NULL,
      description_en VARCHAR(255),
      duty_rate_percent NUMERIC(5, 2) NOT NULL,
      vat_rate_percent NUMERIC(5, 2) DEFAULT 14.00,
      regulatory_body TEXT,
      inspection_fees_percent NUMERIC(5, 2) DEFAULT 0,
      effective_date DATE DEFAULT CURRENT_DATE,
      official_source VARCHAR(255) DEFAULT NULL,
      is_official BOOLEAN DEFAULT FALSE,
      CONSTRAINT uq_import_customs_tariffs UNIQUE (tenant_id, hs_code)
    );
  `;

  await pglite.exec(baseDdl);

  // Execute real production migrations 234 to 240 directly using Kysely
  await up234(db as any);
  await up235(db as any);
  await up236(db as any);
  await up237(db as any);
  await up238(db as any);
  await up239(db as any);
  await up240(db as any);
  await up241(db as any);
  await up242(db as any);
  await up245(db as any);

  // Seed default tenant and users
  await pglite.exec(`INSERT INTO tenants (id, name) VALUES ('tenant-audit-1', 'Audited Trading Tenant');`);

  // Base currency + USD rate (production tenants carry these rows; the
  // transfer threshold is normalised through resolveFxRate).
  await pglite.exec(`
    INSERT INTO settings (tenant_id, key, value) VALUES ('tenant-audit-1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, is_base, exchange_rate)
    VALUES ('tenant-audit-1', 'EGP', true, 1), ('tenant-audit-1', 'USD', false, 50), ('tenant-audit-1', 'EUR', false, 55);
  `);
  await pglite.exec(`
    INSERT INTO users (id, tenant_id, username, password_hash, role)
    VALUES (101, 'tenant-audit-1', 'admin', 'hash', 'admin'), (102, 'tenant-audit-1', 'checker', 'hash', 'admin');
  `);

  // Seed standard Chart of Accounts
  await pglite.exec(`
    INSERT INTO accounting_accounts (tenant_id, account_id, code, name_ar, name_en, account_type, account_group, normal_balance, is_system, is_cash_bank, is_inventory, is_payable)
    VALUES
      ('tenant-audit-1', 'tenant-audit-1', '1110', 'الصندوق والنقدية', 'Cash and Cash Equivalents', 'asset', 'current_assets', 'debit', true, true, false, false),
      ('tenant-audit-1', 'tenant-audit-1', '1120', 'حساب البنك الرئيسي', 'Main Bank Account', 'asset', 'current_assets', 'debit', true, true, false, false),
      ('tenant-audit-1', 'tenant-audit-1', '1140', 'مخزون بضاعة ومواد خام', 'Inventory Asset', 'asset', 'current_assets', 'debit', true, false, true, false),
      ('tenant-audit-1', 'tenant-audit-1', '2110', 'حسابات الموردين والدائنين', 'Accounts Payable', 'liability', 'current_liabilities', 'credit', true, false, false, true),
      ('tenant-audit-1', 'tenant-audit-1', '5110', 'تكلفة البضاعة المباعة', 'Cost of Goods Sold', 'expense', 'expenses', 'debit', true, false, false, false),
      ('tenant-audit-1', 'tenant-audit-1', '5201', 'خسائر فروق أسعار صرف محققة', 'Realized Forex Loss', 'expense', 'expenses', 'debit', true, false, false, false),
      ('tenant-audit-1', 'tenant-audit-1', '4201', 'أرباح فروق أسعار صرف محققة', 'Realized Forex Gain', 'revenue', 'revenues', 'credit', true, false, false, false),
      ('tenant-audit-1', 'tenant-audit-1', '1130', 'عهد المخلصين الجمركيين', 'Customs Broker Advances', 'asset', 'current_assets', 'debit', true, false, false, false),
      ('tenant-audit-1', 'tenant-audit-1', '1180', 'تأمينات حاويات مستردة لدى التوكيلات', 'Container Security Deposits', 'asset', 'current_assets', 'debit', true, false, false, false),
      ('tenant-audit-1', 'tenant-audit-1', '2130', 'عربونات وحجوزات العملاء (إيرادات مقدمة)', 'Customer Advance Deposits', 'liability', 'current_liabilities', 'credit', true, false, false, false),
      ('tenant-audit-1', 'tenant-audit-1', '3100', 'رأس مال الشركاء والمساهمين', 'Partners Equity Capital', 'equity', 'equity', 'credit', true, false, false, false);
  `);

  // Query account IDs to configure accounting_settings
  const accountRows = await db
    .selectFrom('accounting_accounts')
    .select(['id', 'code'])
    .where('tenant_id', '=', 'tenant-audit-1')
    .execute();

  const accounts: Record<string, number> = {};
  for (const acc of accountRows) {
    accounts[acc.code] = Number(acc.id);
  }

  // Seed accounting_settings linked to real accounts
  await db
    .insertInto('accounting_settings')
    .values({
      id: 1,
      tenant_id: 'tenant-audit-1',
      account_id: 'tenant-audit-1',
      cash_account_id: accounts['1110'],
      bank_account_id: accounts['1120'],
      customer_receivable_account_id: null,
      supplier_payable_account_id: accounts['2110'],
      inventory_account_id: accounts['1140'],
      sales_revenue_account_id: null,
      sales_discount_account_id: null,
      cogs_account_id: accounts['5110'],
      purchase_account_id: null,
      expenses_account_id: null,
      sales_tax_account_id: null,
      purchase_tax_account_id: null,
      updated_at: new Date(),
    })
    .execute();

  return { db, accounts };
}

async function runTests() {
  console.log('--- STARTING AUDITED POSTGRESQL (PGLITE) INTEGRATION AUDIT ---');
  const { db, accounts } = await setupDatabase();
  const service = new ImportSalesService(db as any);
  const tenantId = 'tenant-audit-1';
  const userId = 101;

  // Fixture-only bound approval for large transfers (base-currency
  // normalised threshold): created with a full binding payload, then
  // marked approved exactly like approvedClosure above.
  const approvedTransfer = async (opts: { supplierId: string; amount: number; proformaInvoiceId?: string; projectId?: string }) => {
    const request = await service.createApprovalRequest(tenantId, userId, {
      actionType: 'large_transfer', referenceId: opts.supplierId,
      requestPayload: { amount: opts.amount, currency: 'USD', supplierId: opts.supplierId, proformaInvoiceId: opts.proformaInvoiceId, projectId: opts.projectId },
    });
    await db.updateTable('import_approval_requests').set({ status: 'approved', approved_by: userId, decided_at: new Date() })
      .where('id', '=', request.id).execute();
    return request.id;
  };

  // Fixture-only approval arrangement for unrelated close-project guard tests.
  const approvedClosure = async (projectId: string) => {
    const request = await service.createApprovalRequest(tenantId, userId, {
      actionType: 'project_closure', referenceId: projectId,
    });
    await db.updateTable('import_approval_requests').set({ status: 'approved', approved_by: userId, decided_at: new Date() })
      .where('id', '=', request.id).execute();
    return request.id;
  };

  // -------------------------------------------------------------
  // Test 1: Project Closure & Purchases Architectural Link
  // -------------------------------------------------------------
  console.log('\nRunning Test 1: Project Closure & Purchases Architectural Link...');
  {
    const project = await db
      .insertInto('import_projects')
      .values({
        tenant_id: tenantId,
        project_no: 'PRJ-CLOSE-01',
        title: 'Project With Architectural Purchase Invoices',
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const projectId = project.id;

    // Arrived and received shipment
    const shipment = await db
      .insertInto('import_shipments')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        container_number: 'CONT-CLOSE-01',
        status: 'Arrived',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('import_inventory_receipts')
      .values({
        tenant_id: tenantId,
        shipment_id: shipment.id,
        state: 'posted',
      })
      .execute();

    // Supplier & Fully paid proforma
    const supplier = await db
      .insertInto('suppliers')
      .values({
        tenant_id: tenantId,
        name: 'Guangzhou Electronics Ltd',
        phone: '020-888888',
        address: 'Guangzhou, China',
        balance: 0,
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('import_proforma_invoices')
      .values({
        tenant_id: tenantId,
        project_id: projectId,
        supplier_id: supplier.id,
        pi_number: 'PI-CLOSE-01',
        pi_date: '2026-10-01' as any,
        currency: 'USD',
        status: 'active',
        total_amount_foreign: 10000,
        paid_amount_foreign: 10000,
        payment_status: 'paid',
      })
      .execute();

    // 1-A: Create an UNPAID purchase invoice linked architecturally via import_project_id UUID
    // purchases.project_id BIGINT is left null (or contains a legacy contracting id)
    const unpaidPur = await db
      .insertInto('purchases')
      .values({
        tenant_id: tenantId,
        doc_no: 'PUR-UNSETTLED-01',
        project_id: null, // Legacy BIGINT column untouched!
        import_project_id: projectId, // Architectural UUID link!
        payment_type: 'credit',
        subtotal: 25000,
        discount: 0,
        tax_rate: 0,
        tax_amount: 0,
        prices_include_tax: false,
        total: 25000,
        paid_amount: 10000, // Unsettled remaining 15000 EGP
        note: 'Customs clearance invoice for project',
        status: 'received',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Attempt to close project: MUST BE REJECTED
    let rejected = false;
    try {
      await service.closeProject(tenantId, userId, projectId, await approvedClosure(projectId));
    } catch (err: any) {
      rejected = true;
      assert.ok(
        err.message.includes('غير مسددة بالكامل') || err.message.includes('رصيد مستحق غير مسوّى'),
        `Unexpected rejection error: ${err.message}`
      );
    }
    assert.ok(rejected, 'closeProject must reject projects with unsettled purchase invoice liabilities');
    console.log('PASS: closeProject correctly rejected closure due to unsettled purchase invoice.');

    // 1-B: Settle the purchase invoice in full
    await db
      .updateTable('purchases')
      .set({ paid_amount: 25000 })
      .where('id', '=', unpaidPur.id)
      .execute();

    // Attempt closure again: MUST SUCCEED
    const closeRes = await service.closeProject(tenantId, userId, projectId, await approvedClosure(projectId));
    assert.strictEqual(closeRes.success, true);

    const closedPrj = await db
      .selectFrom('import_projects')
      .select(['status', 'closure_data'])
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();
    assert.strictEqual(closedPrj.status, 'closed');
    assert.ok(closedPrj.closure_data !== null, 'closure_data must be frozen');
    console.log('PASS: closeProject succeeded after full settlement of purchase invoice obligations.');
  }

  // -------------------------------------------------------------
  // Test 2: Accounting Entries & Zero Hardcoded Accounts Resolution
  // -------------------------------------------------------------
  console.log('\nRunning Test 2: Accounting Entries & Dynamic COA Resolution...');
  {
    const supplier = await db
      .insertInto('suppliers')
      .values({
        tenant_id: tenantId,
        name: 'Shenzhen Fast Components',
        phone: '0755-666666',
        address: 'Shenzhen, China',
        balance: 5000,
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Execute foreign transfer without specifying accounts; service must dynamically resolve from COA / settings
    const transferRes = await service.recordForeignTransfer(tenantId, userId, {
      supplierId: String(supplier.id),
      approvalRequestId: await approvedTransfer({ supplierId: String(supplier.id), amount: 2000 }),
      amountForeign: 2000,
      amountEgp: 100000,
      currency: 'USD',
      exchangeRateContract: 49.00, // 2000 * 49 = 98000 contract value -> 2000 EGP forex loss
      notes: 'Dynamic COA resolution verification',
      idempotencyKey: 'IDEMP-TEST-2',
    });

    assert.strictEqual(transferRes.success, true);
    assert.strictEqual(transferRes.forexVarianceEgp, 2000);

    // Verify journal entry lines reference REAL primary keys in accounting_accounts
    const jeLines = await db
      .selectFrom('journal_entry_lines')
      .selectAll()
      .where('journal_entry_id', '=', transferRes.journalEntryId)
      .orderBy('id', 'asc')
      .execute();

    assert.strictEqual(jeLines.length, 3, 'Must have exactly 3 journal lines (Debit AP, Debit FX Loss, Credit Bank)');

    // Line 1: Debit Supplier AP
    const lineAp = jeLines.find((l) => Number(l.debit) > 0 && l.partner_type === 'supplier');
    assert.ok(lineAp, 'Supplier AP line must exist');
    assert.strictEqual(Number(lineAp.debit), 98000);
    assert.strictEqual(Number(lineAp.account_id), accounts['2110'], 'Must dynamically resolve AP account ID');

    // Line 2: Debit Forex Loss
    const lineFx = jeLines.find((l) => Number(l.debit) > 0 && l.partner_type === 'none');
    assert.ok(lineFx, 'Forex Loss line must exist');
    assert.strictEqual(Number(lineFx.debit), 2000);
    assert.strictEqual(Number(lineFx.account_id), accounts['5201'], 'Must dynamically resolve Forex Loss account ID');

    // Line 3: Credit Bank Account
    const lineBank = jeLines.find((l) => Number(l.credit) > 0);
    assert.ok(lineBank, 'Bank line must exist');
    assert.strictEqual(Number(lineBank.credit), 100000);
    assert.strictEqual(Number(lineBank.account_id), accounts['1120'], 'Must dynamically resolve Bank account ID');

    // Total Debits == Total Credits
    const totalDebits = jeLines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredits = jeLines.reduce((s, l) => s + Number(l.credit), 0);
    assert.strictEqual(totalDebits, totalCredits, 'Journal lines must strictly balance');
    assert.strictEqual(totalDebits, 100000);
    console.log('PASS: Dynamic COA resolution verified with 0 hardcoded accounts and 100% balanced lines.');
  }

  // -------------------------------------------------------------
  // Test 3: Foreign Transfer Real Bank, Currency & Proforma Validation
  // -------------------------------------------------------------
  console.log('\nRunning Test 3: Foreign Transfer Real Bank, Currency & Proforma Validation...');
  {
    const supplierA = await db
      .insertInto('suppliers')
      .values({ tenant_id: tenantId, name: 'Supplier A Global', phone: '111', address: 'China', balance: 0, is_active: true })
      .returning('id')
      .executeTakeFirstOrThrow();

    const supplierB = await db
      .insertInto('suppliers')
      .values({ tenant_id: tenantId, name: 'Supplier B Overseas', phone: '222', address: 'China', balance: 0, is_active: true })
      .returning('id')
      .executeTakeFirstOrThrow();

    const projectA = await db
      .insertInto('import_projects')
      .values({ tenant_id: tenantId, project_no: 'PRJ-FT-01', title: 'Import Project A', status: 'active' })
      .returning('id')
      .executeTakeFirstOrThrow();

    const projectB = await db
      .insertInto('import_projects')
      .values({ tenant_id: tenantId, project_no: 'PRJ-FT-02', title: 'Import Project B', status: 'active' })
      .returning('id')
      .executeTakeFirstOrThrow();

    const proforma = await db
      .insertInto('import_proforma_invoices')
      .values({
        tenant_id: tenantId,
        project_id: projectA.id,
        supplier_id: supplierA.id,
        pi_number: 'PI-VALIDATE-01',
        pi_date: '2026-10-05' as any,
        currency: 'USD',
        status: 'active',
        total_amount_foreign: 5000,
        paid_amount_foreign: 2000,
        payment_status: 'partially_paid',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // 3-A: Supplier mismatch rejection
    let rejectedSupplier = false;
    try {
      await service.recordForeignTransfer(tenantId, userId, {
        supplierId: String(supplierB.id), // Wrong supplier
        amountForeign: 1000,
        amountEgp: 50000,
        currency: 'USD',
        proformaInvoiceId: proforma.id,
        idempotencyKey: 'IDEMP-TEST-3A',
      });
    } catch (err: any) {
      rejectedSupplier = true;
      assert.ok(err.message.includes('تخص مورداً آخر'), `Unexpected error: ${err.message}`);
    }
    assert.ok(rejectedSupplier, 'Must reject foreign transfer with mismatched supplier');
    console.log('PASS: Proforma supplier mismatch rejected.');

    // 3-B: Project mismatch rejection
    let rejectedProject = false;
    try {
      await service.recordForeignTransfer(tenantId, userId, {
        supplierId: String(supplierA.id),
        projectId: projectB.id, // Wrong project
        amountForeign: 1000,
        amountEgp: 50000,
        currency: 'USD',
        proformaInvoiceId: proforma.id,
        idempotencyKey: 'IDEMP-TEST-3B',
      });
    } catch (err: any) {
      rejectedProject = true;
      assert.ok(err.message.includes('مشروع استيراد آخر'), `Unexpected error: ${err.message}`);
    }
    assert.ok(rejectedProject, 'Must reject foreign transfer with mismatched project');
    console.log('PASS: Proforma project mismatch rejected.');

    // 3-C: Currency mismatch rejection
    let rejectedCurrency = false;
    try {
      await service.recordForeignTransfer(tenantId, userId, {
        supplierId: String(supplierA.id),
        amountForeign: 1000,
        amountEgp: 50000,
        currency: 'EUR', // Wrong currency
        proformaInvoiceId: proforma.id,
        idempotencyKey: 'IDEMP-TEST-3C',
      });
    } catch (err: any) {
      rejectedCurrency = true;
      assert.ok(err.message.includes('لا تطابق عملة الفاتورة المبدئية'), `Unexpected error: ${err.message}`);
    }
    assert.ok(rejectedCurrency, 'Must reject foreign transfer with mismatched currency');
    console.log('PASS: Proforma currency mismatch rejected.');

    // 3-D: Overpayment rejection (remaining is 5000 - 2000 = 3000)
    let rejectedOverpay = false;
    try {
      await service.recordForeignTransfer(tenantId, userId, {
        supplierId: String(supplierA.id),
        approvalRequestId: await approvedTransfer({ supplierId: String(supplierA.id), amount: 3500, proformaInvoiceId: proforma.id, projectId: projectA.id }),
        amountForeign: 3500, // Overpayment!
        amountEgp: 175000,
        currency: 'USD',
        proformaInvoiceId: proforma.id,
        idempotencyKey: 'IDEMP-TEST-3D',
      });
    } catch (err: any) {
      rejectedOverpay = true;
      assert.ok(err.message.includes('يتجاوز المتبقي غير المسدد'), `Unexpected error: ${err.message}`);
    }
    assert.ok(rejectedOverpay, 'Must reject overpayment beyond remaining proforma balance');
    console.log('PASS: Proforma overpayment rejected.');

    // 3-E: Successful legitimate transfer paying remainder exactly
    const transferSuccess = await service.recordForeignTransfer(tenantId, userId, {
      supplierId: String(supplierA.id),
      approvalRequestId: await approvedTransfer({ supplierId: String(supplierA.id), amount: 3000, proformaInvoiceId: proforma.id, projectId: projectA.id }),
      projectId: projectA.id,
      amountForeign: 3000,
      amountEgp: 153000,
      currency: 'USD',
      exchangeRateContract: 50.00, // 3000 * 50 = 150000 -> 3000 EGP forex loss
      proformaInvoiceId: proforma.id,
      bankAccountId: accounts['1120'], // Real bank account
      idempotencyKey: 'IDEMP-PROFORMA-3E',
    });
    assert.strictEqual(transferSuccess.success, true);

    const updatedPI = await db
      .selectFrom('import_proforma_invoices')
      .selectAll()
      .where('id', '=', proforma.id)
      .executeTakeFirstOrThrow();
    assert.strictEqual(Number(updatedPI.paid_amount_foreign), 5000);
    assert.strictEqual(updatedPI.payment_status, 'paid');
    console.log('PASS: Proforma settled in full with exact foreign currency tracking.');

    // 3-F: DB Idempotency rejection
    let rejectedDuplicate = false;
    try {
      await service.recordForeignTransfer(tenantId, userId, {
        supplierId: String(supplierA.id),
        approvalRequestId: await approvedTransfer({ supplierId: String(supplierA.id), amount: 3000, projectId: projectA.id }),
        projectId: projectA.id,
        amountForeign: 3000,
        amountEgp: 153000,
        currency: 'USD',
        idempotencyKey: 'IDEMP-PROFORMA-3E', // Same key!
      });
    } catch (err: any) {
      rejectedDuplicate = true;
      assert.ok(
        err.message.includes('مفتاح عدم التكرار') || err.message.includes('Idempotency Key'),
        `Unexpected error: ${err.message}`
      );
    }
    assert.ok(rejectedDuplicate, 'Must reject duplicate transfer submission with identical idempotency key');
    console.log('PASS: Replay / duplicate foreign transfer prevented via DB idempotency.');
  }

  // -------------------------------------------------------------
  // Test 4: Late Shipment Expense Real Schema & Decoupled Supplier ID
  // -------------------------------------------------------------
  console.log('\nRunning Test 4: Late Shipment Expense Real Schema (qty) & Dynamic COA...');
  {
    const product = await db
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        name: 'Industrial Valve 2-inch',
        retail_price: 800,
        cost_price: 400,
        stock_qty: 100,
        min_stock_qty: 0,
        wholesale_price: 600,
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // 40 units on hand in stock using real column `qty`
    await db
      .insertInto('product_location_stock')
      .values({
        tenant_id: tenantId,
        product_id: product.id,
        qty: 40,
        reserved_qty: 0,
      })
      .execute();

    const expenseSupplier = await db
      .insertInto('suppliers')
      .values({
        tenant_id: tenantId,
        name: 'Late Expense Shipping Supplier',
        phone: '020-999999',
        address: 'Port, Egypt',
        balance: 0,
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const shipment = await db
      .insertInto('import_shipments')
      .values({
        tenant_id: tenantId,
        supplier_id: expenseSupplier.id,
        container_number: 'CONT-EXP-01',
        status: 'Arrived',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('import_inventory_receipts')
      .values({
        tenant_id: tenantId,
        shipment_id: shipment.id,
        state: 'posted',
      })
      .execute();

    // 100 units total received (40 on hand -> 60 sold)
    const lateItem = await db
      .insertInto('import_shipment_items')
      .values({
        tenant_id: tenantId,
        shipment_id: shipment.id,
        product_id: product.id,
        quantity: 100,
        received_quantity: 100,
        factory_unit_price_usd: 8.00,
        landed_cost_egp: 400,
      })
      .returning('id').executeTakeFirstOrThrow();
    await db.insertInto('import_inventory_lots').values({
      tenant_id: tenantId, lot_number: 'EXP-LOT-01',
      shipment_id: shipment.id, shipment_item_id: lateItem.id,
      product_id: product.id, location_id: null,
      initial_quantity: 100, remaining_quantity: 40,
      unit_landed_cost_egp: 400, status: 'active',
    } as any).execute();

    const res = await service.processLateShipmentExpense(tenantId, userId, shipment.id, {
      title: 'Late Detention & Terminal Charges',
      lateExpenseAmount: 10000,
      note: 'Late demurrage from shipping line',
    });

    assert.strictEqual(res.success, true);
    // 60 units sold (60%) -> 6,000 COGS, 40 units on hand (40%) -> 4,000 Inventory
    assert.strictEqual(res.allocation.lateCogsAdjustmentEgp, 6000);
    assert.strictEqual(res.allocation.lateInventoryAdjustmentEgp, 4000);

    // Verify journal entry lines created with dynamically resolved accounts
    const je = await db
      .selectFrom('journal_entries')
      .selectAll()
      .where('source_type', '=', 'import_late_expense')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();

    const lines = await db
      .selectFrom('journal_entry_lines')
      .selectAll()
      .where('journal_entry_id', '=', je.id)
      .execute();

    assert.strictEqual(lines.length, 3);
    const lineCogs = lines.find((l) => Number(l.debit) === 6000);
    assert.ok(lineCogs, 'COGS line must exist');
    assert.strictEqual(Number(lineCogs.account_id), accounts['5110'], 'COGS account must match dynamic resolution');

    const lineInv = lines.find((l) => Number(l.debit) === 4000);
    assert.ok(lineInv, 'Inventory line must exist');
    assert.strictEqual(Number(lineInv.account_id), accounts['1140'], 'Inventory account must match dynamic resolution');

    const lineAp = lines.find((l) => Number(l.credit) === 10000);
    assert.ok(lineAp, 'Payable line must exist');
    assert.strictEqual(Number(lineAp.account_id), accounts['2110'], 'Payable account must match dynamic resolution');

    console.log('PASS: Late shipment expense dynamic COA resolution and IAS 2 split verified.');
  }

  // -------------------------------------------------------------
  // Test 5: Partner UPSERT & Constraint Safety
  // -------------------------------------------------------------
  console.log('\nRunning Test 5: setProjectPartners UPSERT & Constraint Safety...');
  {
    const project = await db
      .insertInto('import_projects')
      .values({ tenant_id: tenantId, project_no: 'PRJ-UPSERT-01', title: 'Partner Upsert Project', status: 'active' })
      .returning('id')
      .executeTakeFirstOrThrow();

    const partnerA = await db
      .insertInto('import_partners')
      .values({ tenant_id: tenantId, name: 'Investor Alpha', capital_amount: 50000 })
      .returning('id')
      .executeTakeFirstOrThrow();

    const partnerB = await db
      .insertInto('import_partners')
      .values({ tenant_id: tenantId, name: 'Investor Beta', capital_amount: 50000 })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Round 1: Assign 60% Alpha, 40% Beta
    await service.setProjectPartners(tenantId, project.id, [
      { partnerId: partnerA.id, profitPercentage: 60, capitalShare: 60000 },
      { partnerId: partnerB.id, profitPercentage: 40, capitalShare: 40000 },
    ]);

    // Round 2: Update same partners to 70% Alpha, 30% Beta (MUST NOT crash on UNIQUE constraint)
    const updateRes = await service.setProjectPartners(tenantId, project.id, [
      { partnerId: partnerA.id, profitPercentage: 70, capitalShare: 70000 },
      { partnerId: partnerB.id, profitPercentage: 30, capitalShare: 30000 },
    ]);
    assert.strictEqual(updateRes.success, true);

    const partnerRows = await db
      .selectFrom('import_project_partners')
      .selectAll()
      .where('project_id', '=', project.id)
      .where('tenant_id', '=', tenantId)
      .execute();
    assert.strictEqual(partnerRows.length, 2);

    const alphaRow = partnerRows.find((p) => p.partner_id === partnerA.id);
    assert.strictEqual(Number(alphaRow?.profit_percentage), 70);
    console.log('PASS: setProjectPartners UPSERT safely updated partners without constraint conflict.');
  }

  // -------------------------------------------------------------
  // Test 6: Official Customs Tariff Reality Check
  // -------------------------------------------------------------
  console.log('\nRunning Test 6: Customs Tariff Official Source Verification...');
  {
    await db
      .insertInto('import_customs_tariffs')
      .values({
        tenant_id: tenantId,
        hs_code: '8481.80.90',
        description_ar: 'صمامات صناعية',
        description_en: 'Industrial Valves',
        duty_rate_percent: 5.0,
        vat_rate_percent: 14.0,
        is_official: false,
        official_source: null,
      })
      .execute();

    const calculation = await service.calculateCustomsTax(
      tenantId,
      '8481.80.90',
      100000
    );

    assert.strictEqual(calculation.customsDuty, 5000);
    assert.strictEqual(calculation.vatAmount, 14700);
    assert.strictEqual(calculation.isOfficialTariff, false);
    assert.strictEqual(calculation.isDocumentedTariff, false);
    console.log('PASS: Unofficial customs tariff correctly marked without false official designation.');
  }

  // -------------------------------------------------------------
  // Test 7: Hardened Negative Invariant Tests
  // -------------------------------------------------------------
  console.log('\nRunning Test 7: Hardened Negative Invariant Tests...');
  {
    const supplier = await db
      .insertInto('suppliers')
      .values({ tenant_id: tenantId, name: 'Negative Test Supplier', phone: '999', address: 'China', balance: 0, is_active: true })
      .returning('id')
      .executeTakeFirstOrThrow();

    const shipment = await db
      .insertInto('import_shipments')
      .values({ tenant_id: tenantId, supplier_id: supplier.id, container_number: 'CONT-NEG-01', status: 'Arrived' })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db.insertInto('import_inventory_receipts').values({ tenant_id: tenantId, shipment_id: shipment.id, state: 'posted' }).execute();

    const product = await db
      .insertInto('products')
      .values({ tenant_id: tenantId, name: 'Negative Test Item', retail_price: 100, cost_price: 50, stock_qty: 10, min_stock_qty: 0, wholesale_price: 80, is_active: true })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db.insertInto('product_location_stock').values({ tenant_id: tenantId, product_id: product.id, qty: 10, reserved_qty: 0 }).execute();
    const negativeItem = await db.insertInto('import_shipment_items').values({
      tenant_id: tenantId, shipment_id: shipment.id, product_id: product.id,
      quantity: 10, received_quantity: 10, factory_unit_price_usd: 5, landed_cost_egp: 50,
    }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('import_inventory_lots').values({
      tenant_id: tenantId, lot_number: 'NEG-LOT-01',
      shipment_id: shipment.id, shipment_item_id: negativeItem.id,
      product_id: product.id, location_id: null,
      initial_quantity: 10, remaining_quantity: 10,
      unit_landed_cost_egp: 50, status: 'active',
    } as any).execute();

    // Negative 7-A: Supplier ID passed as GL account rejected
    let supplierAsGlRejected = false;
    try {
      await service.processLateShipmentExpense(tenantId, userId, shipment.id, {
        title: 'Invalid Payable Account ID',
        lateExpenseAmount: 1000,
        payableAccountId: 99999, // Non-existent GL account
      });
    } catch (err: any) {
      supplierAsGlRejected = true;
      assert.ok(err.message.includes('غير موجود في دليل حسابات'), `Expected non-existent account error, got: ${err.message}`);
    }
    assert.ok(supplierAsGlRejected, 'Non-existent account passed as GL account must be rejected');

    // Negative 7-B: Bank account pointing to expense account rejected
    let expenseAsBankRejected = false;
    try {
      await service.recordForeignTransfer(tenantId, userId, {
        supplierId: String(supplier.id),
        amountForeign: 500,
        amountEgp: 25000,
        currency: 'USD',
        bankAccountId: accounts['5110'], // COGS (expense) account!
        idempotencyKey: 'IDEMP-TEST-7B',
      });
    } catch (err: any) {
      expenseAsBankRejected = true;
      assert.ok(
        err.message.includes('غير صالح') && (err.message.includes('الأصول') || err.message.includes('bank') || err.message.includes('البنك')),
        `Expected bank type rejection, got: ${err.message}`
      );
    }
    assert.ok(expenseAsBankRejected, 'Expense account passed as bank account must be rejected');
    console.log('PASS: Bank account pointing to expense account correctly rejected.');

    // Negative 7-C: Operation in locked accounting period rejected
    await db
      .updateTable('accounting_settings')
      .set({ lock_date_all: '2099-12-31' as any })
      .where('tenant_id', '=', tenantId)
      .execute();

    let lockedPeriodRejected = false;
    try {
      await service.recordForeignTransfer(tenantId, userId, {
        supplierId: String(supplier.id),
        amountForeign: 500,
        amountEgp: 25000,
        currency: 'USD',
        exchangeRateContract: 50,
        idempotencyKey: 'IDEMP-TEST-7C',
      });
    } catch (err: any) {
      lockedPeriodRejected = true;
      assert.ok(
        err.message.includes('الفترة المحاسبية مقفلة') || err.code === 'ACCOUNTING_PERIOD_LOCKED',
        `Expected period lock rejection, got: ${err.message}`
      );
    }
    assert.ok(lockedPeriodRejected, 'Must reject foreign transfer posting in locked accounting period');

    // Unlock period
    await db
      .updateTable('accounting_settings')
      .set({ lock_date_all: null })
      .where('tenant_id', '=', tenantId)
      .execute();
    console.log('PASS: Accounting operation in locked period correctly rejected.');

    // Negative 7-D: Unlinked purchase invoice vs linked purchase invoice checks
    const prjLink = await db
      .insertInto('import_projects')
      .values({ tenant_id: tenantId, project_no: 'PRJ-LINK-01', title: 'Link Test Project', status: 'active' })
      .returning('id')
      .executeTakeFirstOrThrow();

    const shipLink = await db
      .insertInto('import_shipments')
      .values({ tenant_id: tenantId, project_id: prjLink.id, container_number: 'CONT-LINK-01', status: 'Arrived' })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db.insertInto('import_inventory_receipts').values({ tenant_id: tenantId, shipment_id: shipLink.id, state: 'posted' }).execute();

    // 1. Unlinked unpaid purchase invoice (import_project_id is null)
    const unlinkedPur = await db
      .insertInto('purchases')
      .values({
        tenant_id: tenantId,
        doc_no: 'PUR-GENERAL-UNLINKED',
        payment_type: 'credit',
        subtotal: 50000,
        discount: 0,
        tax_rate: 0,
        tax_amount: 0,
        prices_include_tax: false,
        total: 50000,
        paid_amount: 0,
        note: '',
        import_project_id: null,
        status: 'received',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Closure MUST SUCCEED because unlinked invoice is not part of this import project
    const closeRes1 = await service.closeProject(tenantId, userId, prjLink.id, await approvedClosure(prjLink.id));
    assert.strictEqual(closeRes1.success, true);
    console.log('PASS: Unlinked unpaid purchase invoice does not block unrelated project closure.');

    // Re-open project for link test
    await db.updateTable('import_projects').set({ status: 'active', closure_data: null, closure_date: null }).where('id', '=', prjLink.id).execute();

    // 2. Now link the unpaid purchase invoice to this import project
    await db.updateTable('purchases').set({ import_project_id: prjLink.id }).where('id', '=', unlinkedPur.id).execute();

    // Closure MUST BE REJECTED now!
    let blockedWhenLinked = false;
    try {
      await service.closeProject(tenantId, userId, prjLink.id, await approvedClosure(prjLink.id));
    } catch (err: any) {
      blockedWhenLinked = true;
      assert.ok(err.message.includes('غير مسددة بالكامل'));
    }
    assert.ok(blockedWhenLinked, 'Must block closure when purchase invoice is linked and unpaid');
    console.log('PASS: Linked unpaid purchase invoice strictly blocks project closure.');

    // 3. Settle invoice and close successfully
    await db.updateTable('purchases').set({ paid_amount: 50000 }).where('id', '=', unlinkedPur.id).execute();
    const closeRes2 = await service.closeProject(tenantId, userId, prjLink.id, await approvedClosure(prjLink.id));
    assert.strictEqual(closeRes2.success, true);
    console.log('PASS: Linked purchase invoice settlement unblocks project closure.');

    // Negative 7-E: Two legitimate transfers of identical amounts succeed
    const legRes1 = await service.recordForeignTransfer(tenantId, userId, {
      supplierId: String(supplier.id),
      amountForeign: 1500,
      amountEgp: 75000,
      currency: 'USD',
      exchangeRateContract: 50,
      idempotencyKey: 'IDEMP-FT-LEGIT-001',
      notes: 'Legitimate Transfer 1',
    });
    assert.strictEqual(legRes1.success, true);

    const legRes2 = await service.recordForeignTransfer(tenantId, userId, {
      supplierId: String(supplier.id),
      amountForeign: 1500,
      amountEgp: 75000,
      currency: 'USD',
      exchangeRateContract: 50,
      idempotencyKey: 'IDEMP-FT-LEGIT-002',
      notes: 'Legitimate Transfer 2',
    });
    assert.strictEqual(legRes2.success, true);
    assert.notStrictEqual(legRes1.paymentId, legRes2.paymentId);
    console.log('PASS: Two legitimate transfers of identical amounts succeed without artificial window block.');

    // Negative 7-F: Duplicate request with same idempotency key fails with ConflictException
    let duplicateRejected = false;
    try {
      await service.recordForeignTransfer(tenantId, userId, {
        supplierId: String(supplier.id),
        amountForeign: 1500,
        amountEgp: 75000,
        currency: 'USD',
        idempotencyKey: 'IDEMP-FT-LEGIT-001', // Identical key!
      });
    } catch (err: any) {
      duplicateRejected = true;
      assert.ok(
        err.message.includes('مفتاح عدم التكرار') || err.message.includes('Idempotency Key'),
        `Expected idempotency rejection, got: ${err.message}`
      );
    }
    assert.ok(duplicateRejected, 'Must reject duplicate transfer submission with identical idempotency key');
    console.log('PASS: Duplicate request with same idempotency key strictly rejected with ConflictException.');

    // =========================================================================
    // Test 8: Sales Return Profit Calculation Scenario (P0-1)
    // 50 sold @ 1850 cost 1250, then 10 returned. Correct gross profit = 24,000 (NOT 36,000).
    // =========================================================================
    console.log('\nRunning Test 8: Sales Return Profit Calculation Scenario (P0-1)...');
    const prjP01 = await db
      .insertInto('import_projects')
      .values({
        tenant_id: tenantId,
        project_no: 'PRJ-P01-RET',
        title: 'P01 Return Profit Scenario Project',
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const prodP01 = await db
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        name: 'Product P01 High Margin',
        retail_price: 1850,
        cost_price: 1250,
        stock_qty: 100,
        min_stock_qty: 0,
        wholesale_price: 1850,
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const shpP01 = await db
      .insertInto('import_shipments')
      .values({
        tenant_id: tenantId,
        project_id: prjP01.id,
        container_number: 'CONT-P01-RETURN',
        status: 'Arrived',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('import_shipment_items')
      .values({
        tenant_id: tenantId,
        shipment_id: shpP01.id,
        product_id: Number(prodP01.id),
        quantity: 100,
        received_quantity: 100,
        factory_unit_price_usd: 25,
        landed_cost_egp: 1250,
      })
      .execute();

    await db
      .insertInto('import_inventory_lots')
      .values({
        tenant_id: tenantId,
        project_id: prjP01.id,
        shipment_id: shpP01.id,
        product_id: Number(prodP01.id),
        lot_number: 'LOT-P01-001',
        initial_quantity: 100,
        remaining_quantity: 100,
        unit_landed_cost_egp: 1250,
        location_id: 1,
        status: 'active',
      })
      .execute();

    // Sale of 50 units @ 1850 EGP
    await allocateSaleFromImportLots(db, {
      tenantId,
      saleId: 7001,
      locationId: 1,
      items: [
        {
          itemId: 101,
          productId: Number(prodP01.id),
          qty: 50,
          netUnitPrice: 1850,
          locationId: 1,
        },
      ],
    });

    const lotAfterSale = await db
      .selectFrom('import_inventory_lots')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', Number(prodP01.id))
      .executeTakeFirstOrThrow();
    assert.strictEqual(Number(lotAfterSale.remaining_quantity), 50);

    // Sales return of 10 units
    await restoreImportLotsFromSalesReturn(db, {
      tenantId,
      saleId: 7001,
      saleItemId: 101,
      productId: Number(prodP01.id),
      returnQty: 10,
    });

    const lotAfterReturn = await db
      .selectFrom('import_inventory_lots')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', Number(prodP01.id))
      .executeTakeFirstOrThrow();
    assert.strictEqual(Number(lotAfterReturn.remaining_quantity), 60);

    const profitRepP01 = await service.generatePeriodProfitReport(
      tenantId,
      new Date('2026-01-01'),
      new Date('2026-12-31'),
      prjP01.id
    );

    assert.strictEqual(profitRepP01.data.grossSalesRevenue, 92500);
    assert.strictEqual(profitRepP01.data.salesReturnsRevenue, 18500);
    assert.strictEqual(profitRepP01.data.netSalesRevenue, 74000);
    assert.strictEqual(profitRepP01.data.grossCogs, 62500);
    assert.strictEqual(profitRepP01.data.returnsCogs, 12500);
    assert.strictEqual(profitRepP01.data.netCogs, 50000);
    assert.strictEqual(profitRepP01.data.grossProfit, 24000);
    assert.notStrictEqual(profitRepP01.data.grossProfit, 36000);
    console.log('PASS: Period profit report correctly calculated 24,000 gross profit (50 sold @ 1850, 10 returned, cost 1250).');

    const autopsyP01 = await service.getContainerAutopsySheet(tenantId, shpP01.id);
    assert.strictEqual(autopsyP01.salesAndInventory.invoicedSalesEgp, 74000);
    assert.strictEqual(autopsyP01.profitability.cogsSoldUnitsEgp, 50000);
    assert.strictEqual(autopsyP01.profitability.realizedNetProfitEgp, 24000);
    console.log('PASS: Container Autopsy Sheet reflects net profit of 24,000 EGP.');

    // =========================================================================
    // Test 9: Cumulative Container Deposit Partial Refunds & Zero-Balance Guard (P0-4)
    // =========================================================================
    console.log('\nRunning Test 9: Cumulative Container Deposit Partial Refunds (P0-4)...');
    const depRes = await service.recordContainerDeposit(tenantId, userId, {
      projectId: prjP01.id,
      shipmentId: shpP01.id,
      containerNo: 'CONT-P01-RETURN',
      shippingLine: 'Maersk Line Deposit',
      depositAmountEgp: 40000,
      expectedReturnDate: '2026-04-01',
      paymentDate: '2026-03-05',
    });
    assert.ok(depRes.id);
    const depositId = depRes.id;

    // Partial refund 1: 20,000 refund, 5,000 detention fee (total settled: 25,000, remaining: 15,000)
    const ref1 = await service.recordContainerReturnAndRefund(tenantId, userId, depositId, {
      idempotencyKey: 'refund-a',
      actualReturnDate: '2026-03-10',
      refundedAmountEgp: 20000,
      deductionsAmountEgp: 5000,
      deductionReason: 'First partial return with demurrage deduction',
    });
    assert.ok(ref1.id);

    const depRow1 = await db.selectFrom('import_container_deposits').selectAll().where('id', '=', depositId).executeTakeFirstOrThrow();
    assert.strictEqual(Number(depRow1.refunded_amount_egp), 20000);
    const event1 = await db.selectFrom('import_container_refund_events').selectAll()
      .where('tenant_id', '=', tenantId).where('deposit_id', '=', depositId)
      .where('idempotency_key', '=', 'refund-a').executeTakeFirstOrThrow();
    assert.ok(event1.journal_entry_id, 'Refund event must link to its own posted journal');
    const treasuryRefund1 = await db.selectFrom('treasury_transactions').selectAll()
      .where('tenant_id', '=', tenantId).where('reference_type', '=', 'import_container_refund')
      .where('reference_id', '=', Number(event1.serial_id)).executeTakeFirstOrThrow();
    assert.strictEqual(Number(treasuryRefund1.amount), 20000, 'Actual refunded cash must be traceable in treasury');
    let repeatedKeyBlocked = false;
    try {
      await service.recordContainerReturnAndRefund(tenantId, userId, depositId, {
        idempotencyKey: 'refund-a', actualReturnDate: '2026-03-10', refundedAmountEgp: 20000,
      });
    } catch (err: any) { repeatedKeyBlocked = true; assert.match(err.message, /المفتاح|مسبق/); }
    assert.ok(repeatedKeyBlocked, 'Retry with the same refund request key must not credit cash twice');
    assert.strictEqual(Number(depRow1.deductions_amount_egp), 5000);
    const remaining1 = Number(depRow1.deposit_amount_egp) - Number(depRow1.refunded_amount_egp) - Number(depRow1.deductions_amount_egp);
    assert.strictEqual(remaining1, 15000);
    assert.strictEqual(depRow1.refund_status, 'partially_refunded');

    // Negative: attempting to refund 20,000 when remaining is 15,000
    let overRefundBlocked = false;
    try {
      await service.recordContainerReturnAndRefund(tenantId, userId, depositId, {
        idempotencyKey: 'refund-over',
      actualReturnDate: '2026-03-12',
        refundedAmountEgp: 20000,
      });
    } catch (err: any) {
      overRefundBlocked = true;
      assert.ok(err.message.includes('يتجاوز الرصيد المتبقي'));
    }
    assert.ok(overRefundBlocked, 'Must block refund exceeding remaining deposit balance');

    // Partial refund 2: 15,000 refund, 0 deduction (remaining becomes 0)
    const ref2 = await service.recordContainerReturnAndRefund(tenantId, userId, depositId, {
      idempotencyKey: 'refund-b',
      actualReturnDate: '2026-03-15',
      refundedAmountEgp: 15000,
    });
    assert.ok(ref2.id);

    const depRow2 = await db.selectFrom('import_container_deposits').selectAll().where('id', '=', depositId).executeTakeFirstOrThrow();
    assert.strictEqual(Number(depRow2.refunded_amount_egp), 35000);
    assert.strictEqual(Number(depRow2.deductions_amount_egp), 5000);
    const remaining2 = Number(depRow2.deposit_amount_egp) - Number(depRow2.refunded_amount_egp) - Number(depRow2.deductions_amount_egp);
    assert.strictEqual(remaining2, 0);
    assert.strictEqual(depRow2.refund_status, 'refunded');

    // Negative: attempting to refund on fully refunded deposit
    let duplicateRefundBlocked = false;
    try {
      await service.recordContainerReturnAndRefund(tenantId, userId, depositId, {
        idempotencyKey: 'refund-duplicate',
      actualReturnDate: '2026-03-16',
        refundedAmountEgp: 1000,
      });
    } catch (err: any) {
      duplicateRefundBlocked = true;
      console.log('ACTUAL DUPLICATE REFUND ERROR:', err?.message || err);
      assert.ok(
        err.message.includes('تمت تسويته واسترداده بالكامل مسبقاً') || err.message.includes('مسبقاً') || err.message.includes('تكرار'),
        `Unexpected error: ${err.message}`
      );
    }
    assert.ok(duplicateRefundBlocked, 'Must block subsequent refunds when container deposit is fully settled');
    console.log('PASS: Cumulative container deposit partial refunds and zero-balance guards strictly verified.');

    // =========================================================================
    // Test 10: Strict COA Qualification & Anti-Contamination (P0-5)
    // =========================================================================
    console.log('\nRunning Test 10: Strict COA Qualification & Anti-Contamination (P0-5)...');
    let invalidCustomerAdvanceBlocked = false;
    try {
      await (service as any).resolveTenantAccount(db, tenantId, 'customer_advance', accounts['2110']);
    } catch (err: any) {
      invalidCustomerAdvanceBlocked = true;
      assert.ok(err.message.includes('غير صالح لدور (customer_advance)'));
    }
    assert.ok(invalidCustomerAdvanceBlocked, 'Must reject supplier payable account as customer advance');

    let invalidBrokerAdvanceBlocked = false;
    try {
      await (service as any).resolveTenantAccount(db, tenantId, 'broker_advance', accounts['1110']);
    } catch (err: any) {
      invalidBrokerAdvanceBlocked = true;
      assert.ok(err.message.includes('غير صالح لدور (broker_advance)'));
    }
    assert.ok(invalidBrokerAdvanceBlocked, 'Must reject cash/bank account as broker advance');
    console.log('PASS: Strict COA role qualification and anti-contamination verified.');

    // =========================================================================
    // Test 11: Multi-Location Lot Matching & Multiple Partial Returns (P1-6)
    // =========================================================================
    console.log('\nRunning Test 11: Multi-Location Lot Matching & Multiple Partial Returns (P1-6)...');
    await (db as any)
      .insertInto('stock_locations')
      .values({
        id: 2,
        tenant_id: tenantId,
        account_id: tenantId,
        name: 'فرع القاهرة - مخزن التجمع',
      })
      .execute();

    const prodP16 = await db
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        name: 'Product Multi-Warehouse Lot',
        retail_price: 2000,
        cost_price: 1000,
        stock_qty: 50,
        min_stock_qty: 0,
        wholesale_price: 2000,
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const lot1 = await db
      .insertInto('import_inventory_lots')
      .values({
        tenant_id: tenantId,
        project_id: prjP01.id,
        shipment_id: shpP01.id,
        product_id: Number(prodP16.id),
        lot_number: 'LOT-P16-001',
        initial_quantity: 20,
        remaining_quantity: 20,
        unit_landed_cost_egp: 1000,
        location_id: 1,
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const lot2 = await db
      .insertInto('import_inventory_lots')
      .values({
        tenant_id: tenantId,
        project_id: prjP01.id,
        shipment_id: shpP01.id,
        product_id: Number(prodP16.id),
        lot_number: 'LOT-P16-002',
        initial_quantity: 30,
        remaining_quantity: 30,
        unit_landed_cost_egp: 1100,
        location_id: 2,
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Sale in Warehouse 2 for 15 units
    await allocateSaleFromImportLots(db, {
      tenantId,
      saleId: 8001,
      locationId: 2,
      items: [
        {
          itemId: 201,
          productId: Number(prodP16.id),
          qty: 15,
          netUnitPrice: 2000,
          locationId: 2,
        },
      ],
    });

    const checkLot1 = await db.selectFrom('import_inventory_lots').selectAll().where('id', '=', lot1.id).executeTakeFirstOrThrow();
    const checkLot2 = await db.selectFrom('import_inventory_lots').selectAll().where('id', '=', lot2.id).executeTakeFirstOrThrow();
    assert.strictEqual(Number(checkLot1.remaining_quantity), 20, 'Lot 1 in Warehouse 1 must remain untouched');
    assert.strictEqual(Number(checkLot2.remaining_quantity), 15, 'Lot 2 in Warehouse 2 must be deducted to 15');

    // First partial return: 5 units
    await restoreImportLotsFromSalesReturn(db, {
      tenantId,
      saleId: 8001,
      saleItemId: 201,
      productId: Number(prodP16.id),
      returnQty: 5,
    });
    const checkLot2R1 = await db.selectFrom('import_inventory_lots').selectAll().where('id', '=', lot2.id).executeTakeFirstOrThrow();
    assert.strictEqual(Number(checkLot2R1.remaining_quantity), 20, 'Lot 2 must be restored to 20');

    // Second partial return: 5 units
    await restoreImportLotsFromSalesReturn(db, {
      tenantId,
      saleId: 8001,
      saleItemId: 201,
      productId: Number(prodP16.id),
      returnQty: 5,
    });
    const checkLot2R2 = await db.selectFrom('import_inventory_lots').selectAll().where('id', '=', lot2.id).executeTakeFirstOrThrow();
    assert.strictEqual(Number(checkLot2R2.remaining_quantity), 25, 'Lot 2 must be restored to 25');

    // Third partial return: requesting 10 units (only 5 units remaining unreturned from the 15 sold)
    await restoreImportLotsFromSalesReturn(db, {
      tenantId,
      saleId: 8001,
      saleItemId: 201,
      productId: Number(prodP16.id),
      returnQty: 10,
    });
    const checkLot2R3 = await db.selectFrom('import_inventory_lots').selectAll().where('id', '=', lot2.id).executeTakeFirstOrThrow();
    assert.strictEqual(Number(checkLot2R3.remaining_quantity), 30, 'Lot 2 must only be restored up to initial 30 units (no over-restoration)');
    console.log('PASS: Multi-location lot matching and multiple partial returns with alreadyRestored tracking verified.');
  }

  console.log('\n--- ALL AUDITED POSTGRESQL (PGLITE) INTEGRATION AUDITS PASSED (100%) ---');
}

runTests().catch((err) => {
  console.error('\nFAILED INTEGRATION AUDIT:', err);
  process.exit(1);
});
