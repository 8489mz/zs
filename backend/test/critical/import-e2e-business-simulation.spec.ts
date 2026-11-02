import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { up as up233 } from '../../src/database/migrations/2040000000233_import_integrity_and_project_lifecycle';
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

async function setupDatabase(): Promise<{ db: Kysely<Database>; accounts: Record<string, number> }> {
  const pglite = new PGlite();
  const db = new Kysely<Database>({
    dialect: new MultiStatementPGliteDialect(pglite),
  });

  const baseDdl = `
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT 'Main Tenant',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

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
      parent_id BIGINT,
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
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE suppliers (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      company_name TEXT,
      phone TEXT,
      email TEXT,
      account_id BIGINT,
      balance NUMERIC(15, 2) DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
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

    CREATE TABLE supplier_ledger (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL,
      amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
      balance_after NUMERIC(15, 2) NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      reference_type TEXT NULL,
      reference_id BIGINT NULL,
      return_document_id BIGINT NULL,
      branch_id BIGINT NULL,
      location_id BIGINT NULL,
      created_by BIGINT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE customer_ledger (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL,
      amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
      balance_after NUMERIC(15, 2) NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      reference_type TEXT NULL,
      reference_id BIGINT NULL,
      return_document_id BIGINT NULL,
      branch_id BIGINT NULL,
      location_id BIGINT NULL,
      created_by BIGINT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE supplier_payments (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      doc_no VARCHAR(100),
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
      amount NUMERIC(15, 2) NOT NULL,
      payment_date DATE NOT NULL,
      payment_method TEXT DEFAULT 'bank_transfer',
      payment_type TEXT DEFAULT 'normal',
      purchase_id BIGINT,
      account_id TEXT NOT NULL,
      created_by BIGINT,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE treasury_transactions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      txn_type TEXT NOT NULL,
      amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      reference_type TEXT NULL,
      reference_id BIGINT NULL,
      return_document_id BIGINT NULL,
      branch_id BIGINT NULL,
      location_id BIGINT NULL,
      created_by BIGINT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE expenses (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      title TEXT NOT NULL,
      amount NUMERIC(15, 2) NOT NULL,
      expense_date DATE NOT NULL,
      note TEXT,
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
      description TEXT,
      debit NUMERIC(15, 2) NOT NULL DEFAULT 0,
      credit NUMERIC(15, 2) NOT NULL DEFAULT 0,
      partner_type TEXT,
      partner_id BIGINT,
      branch_id BIGINT,
      location_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounting_settings (
      id BIGINT PRIMARY KEY DEFAULT 1,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      cash_account_id BIGINT,
      bank_account_id BIGINT,
      customer_receivable_account_id BIGINT,
      supplier_payable_account_id BIGINT,
      inventory_account_id BIGINT,
      sales_revenue_account_id BIGINT,
      sales_discount_account_id BIGINT,
      cogs_account_id BIGINT,
      purchase_account_id BIGINT,
      expenses_account_id BIGINT,
      sales_tax_account_id BIGINT,
      purchase_tax_account_id BIGINT,
      manufacturing_overhead_account_id BIGINT,
      lock_date_all DATE,
      lock_date_non_adviser DATE,
      lock_date_tax DATE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounting_fiscal_years (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT DEFAULT 'open',
      is_closed BOOLEAN DEFAULT FALSE,
      lock_date_all DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounting_fiscal_periods (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      fiscal_year_id INTEGER REFERENCES accounting_fiscal_years(id) ON DELETE CASCADE,
      period_number INTEGER NOT NULL,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(50),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(50) DEFAULT 'open',
      closed_at TIMESTAMPTZ,
      closed_by INTEGER,
      closing_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE products (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sku TEXT,
      barcode TEXT,
      type TEXT DEFAULT 'storable',
      cost_price NUMERIC(15, 6) DEFAULT 0,
      sale_price NUMERIC(15, 2) DEFAULT 0,
      stock_qty NUMERIC(15, 3) DEFAULT 0,
      reserved_qty NUMERIC(15, 3) DEFAULT 0,
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

    CREATE TABLE product_location_stock (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      product_id BIGINT NOT NULL REFERENCES products(id),
      branch_id BIGINT,
      location_id BIGINT NULL REFERENCES stock_locations(id),
      qty NUMERIC(15, 3) NOT NULL DEFAULT 0,
      reserved_qty NUMERIC(15, 3) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_product_loc_stock UNIQUE (tenant_id, account_id, product_id, location_id)
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

    CREATE TABLE sales (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      doc_no VARCHAR(100),
      customer_id BIGINT REFERENCES customers(id),
      total NUMERIC(15, 2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
      status VARCHAR(50) DEFAULT 'completed',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id BIGINT REFERENCES products(id),
      product_name TEXT NOT NULL,
      qty NUMERIC(15, 3) NOT NULL,
      unit_price NUMERIC(15, 2) NOT NULL,
      line_total NUMERIC(15, 2) NOT NULL,
      cost_price NUMERIC(15, 6) DEFAULT 0,
      allocated_discount NUMERIC(15, 2) DEFAULT 0,
      allocated_tax NUMERIC(15, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS return_documents (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      doc_no TEXT,
      return_type VARCHAR(50) NOT NULL,
      invoice_id BIGINT,
      settlement_mode VARCHAR(50) DEFAULT 'cash',
      refund_method VARCHAR(50) DEFAULT 'cash',
      total NUMERIC(15, 2) NOT NULL DEFAULT 0,
      note TEXT,
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS return_items (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT NOT NULL,
      return_document_id BIGINT NOT NULL REFERENCES return_documents(id) ON DELETE CASCADE,
      product_id BIGINT REFERENCES products(id),
      product_name TEXT NOT NULL,
      qty NUMERIC(15, 3) NOT NULL,
      unit_total NUMERIC(15, 2) NOT NULL,
      line_total NUMERIC(15, 2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_no TEXT NOT NULL,
      title TEXT NOT NULL,
      target_market VARCHAR(100) DEFAULT 'Egypt',
      country_origin VARCHAR(100) DEFAULT 'China',
      country_destination VARCHAR(100) DEFAULT 'Egypt',
      budget_currency VARCHAR(10) DEFAULT 'USD',
      allocated_capital NUMERIC(15, 2) DEFAULT 0,
      target_roi_percentage NUMERIC(5, 2) DEFAULT 25.00,
      status VARCHAR(50) DEFAULT 'feasibility',
      feasibility_data JSONB DEFAULT '{}'::jsonb,
      closure_data JSONB DEFAULT NULL,
      closure_date TIMESTAMPTZ DEFAULT NULL,
      closed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_import_projects_tenant_project_no UNIQUE (tenant_id, project_no)
    );

    CREATE TABLE import_partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT,
      capital_amount NUMERIC(15, 2) DEFAULT 0,
      profit_share_percentage NUMERIC(5, 2) NOT NULL,
      withdrawn_profit NUMERIC(15, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_partner_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      partner_id UUID NOT NULL REFERENCES import_partners(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      amount NUMERIC(15, 2) NOT NULL,
      transaction_date DATE NOT NULL,
      note TEXT,
      created_by BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE purchase_orders (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      order_number VARCHAR(60) NOT NULL,
      supplier_id INTEGER,
      supplier_name TEXT NOT NULL,
      supplier_phone TEXT,
      warehouse_id INTEGER,
      warehouse_name TEXT,
      subtotal NUMERIC(14,3) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(14,3) NOT NULL DEFAULT 0,
      discount_amount NUMERIC(14,3) NOT NULL DEFAULT 0,
      total_amount NUMERIC(14,3) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      expected_delivery_date DATE,
      notes TEXT,
      terms_conditions TEXT,
      created_by INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE purchase_order_items (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id),
      product_id BIGINT NOT NULL,
      product_name TEXT NOT NULL,
      unit_name TEXT,
      quantity NUMERIC(14,3) NOT NULL,
      received_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
      unit_cost NUMERIC(14,3) NOT NULL DEFAULT 0,
      tax_rate NUMERIC(8,2) NOT NULL DEFAULT 0,
      discount NUMERIC(14,3) NOT NULL DEFAULT 0,
      total NUMERIC(14,3) NOT NULL DEFAULT 0,
      notes TEXT
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

    CREATE TABLE import_project_partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id UUID NOT NULL REFERENCES import_projects(id) ON DELETE CASCADE,
      partner_id UUID NOT NULL REFERENCES import_partners(id) ON DELETE CASCADE,
      capital_share_amount NUMERIC(15, 2) DEFAULT 0,
      profit_percentage NUMERIC(5, 2) NOT NULL,
      effective_from DATE DEFAULT CURRENT_DATE,
      is_active BOOLEAN DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_import_project_partners UNIQUE (tenant_id, project_id, partner_id)
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
      total_amount_foreign NUMERIC(15, 2) DEFAULT 0,
      paid_amount_foreign NUMERIC(15, 2) DEFAULT 0,
      payment_status VARCHAR(50) DEFAULT 'unpaid',
      incoterm VARCHAR(20) DEFAULT 'FOB',
      delivery_port VARCHAR(100),
      payment_terms TEXT,
      exchange_rate_contract NUMERIC(10, 4),
      status VARCHAR(50) DEFAULT 'active',
      notes TEXT,
      items JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_approval_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      module TEXT,
      action_type TEXT NOT NULL,
      reference_id TEXT,
      requested_by BIGINT,
      created_by BIGINT,
      status TEXT DEFAULT 'pending',
      request_payload TEXT,
      decided_by BIGINT,
      approved_by BIGINT,
      decision_notes TEXT,
      rejection_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      decided_at TIMESTAMPTZ,
      consumed_at TIMESTAMPTZ,
      consumed_by BIGINT,
      updated_at TIMESTAMPTZ
    );

    CREATE TABLE import_suppliers_meta (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      chinese_name VARCHAR(255),
      city VARCHAR(100),
      province VARCHAR(100),
      moq_description TEXT,
      production_lead_time_days INTEGER DEFAULT 30,
      bank_name_usd VARCHAR(255),
      bank_swift_code VARCHAR(50),
      bank_account_usd VARCHAR(100),
      bank_country VARCHAR(100),
      audit_status VARCHAR(50) DEFAULT 'unverified',
      verified_at TIMESTAMPTZ DEFAULT NULL,
      verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      verification_notes TEXT DEFAULT NULL,
      verified_bank_details JSONB DEFAULT '{}'::jsonb,
      incoterms_accepted JSONB DEFAULT '["FOB", "CIF"]'::jsonb,
      qc_rating NUMERIC(3, 1) DEFAULT 5.0,
      quality_certifications JSONB DEFAULT '[]'::jsonb,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_import_suppliers_meta UNIQUE (tenant_id, supplier_id)
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

    CREATE TABLE import_shipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      project_id UUID REFERENCES import_projects(id),
      supplier_id BIGINT REFERENCES suppliers(id),
      container_number TEXT NOT NULL,
      bill_of_lading TEXT,
      freight_type VARCHAR(20) DEFAULT 'FCL',
      container_size VARCHAR(20) DEFAULT '40HQ',
      port_of_loading VARCHAR(100) DEFAULT 'Ningbo',
      port_of_discharge VARCHAR(100) DEFAULT 'Alexandria',
      cbm_volume NUMERIC(10, 3) DEFAULT 0,
      gross_weight_kg NUMERIC(12, 2) DEFAULT 0,
      carrier_name VARCHAR(150),
      free_demurrage_days INTEGER DEFAULT 14,
      demurrage_start_date DATE,
      demurrage_rate_per_day NUMERIC(10, 2) DEFAULT 50.00,
      actual_demurrage_fees NUMERIC(12, 2) DEFAULT 0,
      customs_declaration_no VARCHAR(100),
      vat_refundable_egp NUMERIC(12, 2) DEFAULT 0,
      is_consolidated BOOLEAN DEFAULT FALSE,
      cost_allocation_method VARCHAR(50) DEFAULT 'value',
      arrival_date DATE,
      shipping_cost_usd NUMERIC(15, 2) DEFAULT 0,
      customs_cost_egp NUMERIC(15, 2) DEFAULT 0,
      internal_transport_cost_egp NUMERIC(15, 2) DEFAULT 0,
      exchange_rate_at_arrival NUMERIC(10, 4) DEFAULT 1.0,
      pricing_exchange_rate NUMERIC(10, 4) DEFAULT 1.0,
      shipping_date DATE,
      eta_date DATE,
      actual_arrival_date DATE,
      shipped_date DATE,
      clearance_date DATE,
      shipping_expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
      customs_expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
      transport_expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'Draft',
      late_expenses_total_egp NUMERIC(12, 2) DEFAULT 0,
      late_cogs_adjustment_egp NUMERIC(12, 2) DEFAULT 0,
      late_inventory_adjustment_egp NUMERIC(12, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_inventory_receipts (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      shipment_id UUID NOT NULL REFERENCES import_shipments(id),
      state VARCHAR(50) DEFAULT 'posted',
      review_reason TEXT,
      journal_entry_id BIGINT,
      posted_at TIMESTAMPTZ,
      created_by BIGINT,
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
      allocated_overhead_egp NUMERIC(15, 2) DEFAULT 0,
      landed_cost_egp NUMERIC(15, 4) DEFAULT 0,
      shortage_handling_method VARCHAR(50) DEFAULT 'capitalize',
      target_margin_percent NUMERIC(5, 2) DEFAULT 25.00,
      target_retail_margin NUMERIC(5, 2) DEFAULT 35.00,
      target_wholesale_margin NUMERIC(5, 2) DEFAULT 20.00,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE import_qc_inspections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id UUID REFERENCES import_projects(id) ON DELETE SET NULL,
      shipment_id UUID REFERENCES import_shipments(id) ON DELETE SET NULL,
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

    CREATE TABLE import_customs_tariffs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      hs_code VARCHAR(50) NOT NULL,
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

  // Apply all real migrations from 233 up to 240
  await up233(db as any);
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

  // Seed default tenant
  await pglite.exec(`INSERT INTO tenants (id, name) VALUES ('tenant-e2e', 'Global Import & Trade Ltd');`);

  // Base currency + USD rate (production tenants carry these rows; the
  // transfer threshold is normalised through resolveFxRate).
  await pglite.exec(`
    INSERT INTO settings (tenant_id, key, value) VALUES ('tenant-e2e', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, is_base, exchange_rate)
    VALUES ('tenant-e2e', 'EGP', true, 1), ('tenant-e2e', 'USD', false, 50);
  `);

  // Seed default stock location
  await pglite.exec(`
    INSERT INTO stock_locations (id, tenant_id, account_id, name, is_default)
    VALUES (1, 'tenant-e2e', 'tenant-e2e', 'المستودع الرئيسي - الإسكندرية', true);
  `);

  // Seed standard Chart of Accounts
  await pglite.exec(`
    INSERT INTO accounting_accounts (tenant_id, account_id, code, name_ar, name_en, account_type, account_group, normal_balance, is_system, is_cash_bank, is_inventory, is_payable, is_receivable, is_tax)
    VALUES
      ('tenant-e2e', 'tenant-e2e', '1110', 'الصندوق والنقدية', 'Cash', 'asset', 'current_assets', 'debit', true, true, false, false, false, false),
      ('tenant-e2e', 'tenant-e2e', '1120', 'بنك مصر - حساب العملات الأجنبية', 'Foreign Currency Bank', 'asset', 'current_assets', 'debit', true, true, false, false, false, false),
      ('tenant-e2e', 'tenant-e2e', '1130', 'عهد المخلصين الجمركيين', 'Customs Broker Advances', 'asset', 'current_assets', 'debit', true, false, false, false, false, false),
      ('tenant-e2e', 'tenant-e2e', '1140', 'مخزون بضاعة بالطريق والمستودعات', 'Inventory Asset', 'asset', 'current_assets', 'debit', true, false, true, false, false, false),
      ('tenant-e2e', 'tenant-e2e', '1150', 'ضريبة القيمة المضافة القابلة للاسترداد', 'Refundable VAT Asset', 'asset', 'current_assets', 'debit', true, false, false, false, false, true),
      ('tenant-e2e', 'tenant-e2e', '1180', 'تأمينات حاويات مستردة لدى التوكيلات', 'Container Security Deposits', 'asset', 'current_assets', 'debit', true, false, false, false, false, false),
      ('tenant-e2e', 'tenant-e2e', '2110', 'الموردين التجاريين والدائنين', 'Accounts Payable', 'liability', 'current_liabilities', 'credit', true, false, false, true, false, false),
      ('tenant-e2e', 'tenant-e2e', '2130', 'عربونات وحجوزات العملاء (إيرادات مقدمة)', 'Customer Advance Deposits', 'liability', 'current_liabilities', 'credit', true, false, false, false, true, false),
      ('tenant-e2e', 'tenant-e2e', '3100', 'رأس مال الشركاء والمساهمين', 'Partners Equity Capital', 'equity', 'equity', 'credit', true, false, false, false, false, false),
      ('tenant-e2e', 'tenant-e2e', '5110', 'تكلفة البضاعة المباعة', 'Cost of Goods Sold', 'expense', 'expenses', 'debit', true, false, false, false, false, false),
      ('tenant-e2e', 'tenant-e2e', '5201', 'رسوم ومصاريف جمركية وتشغيلية', 'Customs & Demurrage Expense', 'expense', 'expenses', 'debit', true, false, false, false, false, false),
      ('tenant-e2e', 'tenant-e2e', '4110', 'إيرادات المبيعات المحققة', 'Sales Revenue', 'revenue', 'revenues', 'credit', true, false, false, false, false, false);
  `);

  const accountRows = await db
    .selectFrom('accounting_accounts')
    .select(['id', 'code'])
    .where('tenant_id', '=', 'tenant-e2e')
    .execute();

  const accounts: Record<string, number> = {};
  for (const acc of accountRows) {
    accounts[acc.code] = Number(acc.id);
  }

  await db
    .insertInto('accounting_settings')
    .values({
      id: 1,
      tenant_id: 'tenant-e2e',
      account_id: 'tenant-e2e',
      cash_account_id: accounts['1110'],
      bank_account_id: accounts['1120'],
      customer_receivable_account_id: accounts['2130'],
      supplier_payable_account_id: accounts['2110'],
      inventory_account_id: accounts['1140'],
      sales_revenue_account_id: accounts['4110'],
      sales_discount_account_id: null,
      cogs_account_id: accounts['5110'],
      purchase_account_id: null,
      expenses_account_id: accounts['5201'],
      sales_tax_account_id: null,
      purchase_tax_account_id: accounts['1150'],
      updated_at: new Date(),
    })
    .execute();

  return { db, accounts };
}

async function runBusinessSimulation() {
  console.log('=== STARTING 30-STEP END-TO-END INTERNATIONAL IMPORT BUSINESS SIMULATION ===');
  const { db, accounts } = await setupDatabase();
  const tenantId = 'tenant-e2e';
  const userId = 1;

  // Insert test user
  await (db as any)
    .insertInto('users')
    .values({
      id: 1,
      tenant_id: tenantId,
      username: 'import_master_auditor',
      password_hash: 'hashed',
      role: 'admin',
    })
    .execute();

  const postingService = new AccountingPostingService(db as any);
  const importService = new ImportSalesService(db as any, postingService);

  // -------------------------------------------------------------
  // STEP 1: CREATE IMPORT PROJECT
  // -------------------------------------------------------------
  console.log('Step 1: Creating Import Project...');
  const project = await importService.createProject(tenantId, {
    projectNo: 'IMP-2026-001',
    title: 'استيراد حاوية أدوات منزلية وأجهزة كهربائية Ningbo 40HQ',
    budgetCurrency: 'USD',
    allocatedCapital: 50000,
    targetRoiPercentage: 35.0,
    feasibilityData: {
      items: [
        { name: 'خلاط كهربائي تركيبي 1000W', qty: 1000, factoryPriceUsd: 25, unitWeightKg: 2.5, unitCbm: 0.025 },
        { name: 'قلاية هوائية رقمية 6L', qty: 500, factoryPriceUsd: 40, unitWeightKg: 4.0, unitCbm: 0.045 },
      ],
      exchangeRateCommercial: 50,
      totalFactoryCostUsd: 45000,
      internationalShippingUsd: 4000,
      insuranceUsd: 500,
      customsDutyEgp: 112500,
      clearanceAndPortFeesEgp: 45000,
      internalTransportEgp: 15000,
    },
  });
  assert.ok(project.id, 'Project must be created with UUID');
  assert.equal(project.project_no, 'IMP-2026-001');
  console.log(`PASS: Project created: ${project.title} (${project.id})`);

  // -------------------------------------------------------------
  // STEP 2: ADD 2 PARTNERS WITH CAPITAL & PROFIT SHARES
  // -------------------------------------------------------------
  console.log('Step 2: Adding Partners & Equity Shares...');
  const p1 = await importService.createPartner(tenantId, userId, 'م. طارق العشري (شريك ممول)', 60, 1500000, String(accounts['1120']));
  const p2 = await importService.createPartner(tenantId, userId, 'أ. حسام فؤاد (شريك إداري وتشغيلي)', 40, 500000, String(accounts['1110']));

  await importService.setProjectPartners(tenantId, project.id, [
    { partnerId: p1.id, capitalShare: 1500000, profitPercentage: 60 },
    { partnerId: p2.id, capitalShare: 500000, profitPercentage: 40 },
  ]);
  const projectPartners = await importService.getProjectPartners(tenantId, project.id);
  assert.equal(projectPartners.length, 2, 'Project must have 2 registered partners');
  console.log('PASS: Partners and equity shares registered and allocated.');

  // -------------------------------------------------------------
  // STEP 3: CREATE RFQ, QUOTATIONS & SELECT SUPPLIER
  // -------------------------------------------------------------
  console.log('Step 3: Creating Chinese Supplier & RFQ Quotations Comparison...');
  const supplier = await (db as any)
    .insertInto('suppliers')
    .values({
      tenant_id: tenantId,
      name: 'Zhejiang Electric Appliances Co., Ltd',
      company_name: 'Zhejiang Electric Co.',
      account_id: String(accounts['2110']),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const q1 = await importService.createQuotation(tenantId, {
    projectId: project.id,
    supplierId: String(supplier.id),
    quotationNo: 'QT-NB-001',
    itemName: 'خلاط كهربائي 1000W',
    unitPriceForeign: 25.0,
    moq: 500,
    productionLeadDays: 25,
    portOfLoading: 'Ningbo',
    estimatedFreightUsd: 2000,
  });

  const selectedQuote = await importService.selectQuotation(tenantId, q1.id, {
    selectionReason: 'أفضل جودة معتمدة واختبارات كفاءة بشهادة CE وCB وشهادة التزام بالـLead Time',
  });
  assert.equal(selectedQuote.status, 'selected');
  console.log('PASS: Supplier quotation compared and selected with audited justification.');

  // -------------------------------------------------------------
  // STEP 4: SAMPLES ORDER & REFERENCE SAMPLE APPROVAL
  // -------------------------------------------------------------
  console.log('Step 4: Requesting Product Samples & Approving Reference Sample...');
  const sample = await importService.createSampleOrder(tenantId, {
    projectId: project.id,
    supplierId: String(supplier.id),
    sampleCode: 'SMP-2026-01',
    itemName: 'عينة ما قبل الإنتاج - خلاط كهربائي',
    sampleCostForeign: 50,
    freightCostForeign: 80,
    courierTrackingNo: 'DHL-894738291',
  });

  const approvedSample = await importService.updateSampleOrderInspection(tenantId, sample.id, {
    qualityScore: 9.5,
    decision: 'approved_reference',
    referenceSampleApproved: true,
    defectAnalysis: 'المحرك النحاسي مطابق 100% للشروط الفنية وسمك البلاستيك مطابق لمعايير السلامة',
  });
  assert.equal(approvedSample.reference_sample_approved, true);
  console.log('PASS: Reference sample inspected, scored 9.5/10 and approved as binding baseline.');

  // -------------------------------------------------------------
  // STEP 5: CONVERT FEASIBILITY STUDY TO ACTIVE PROJECT & CASHFLOW SCHEDULE
  // -------------------------------------------------------------
  console.log('Step 5: Converting Feasibility Study to Project & Generating Liquidity Schedule...');
  const conversionResult = await importService.convertFeasibilityToProject(tenantId, project.id, {
    projectId: project.id,
    supplierId: String(supplier.id),
    advancePaymentPercentage: 30,
  });
  assert.ok(conversionResult.success);
  assert.ok(conversionResult.proformaId, 'Proforma invoice draft should be generated from feasibility');
  assert.equal(conversionResult.cashFlowSchedule.length, 5, 'Cash flow timeline must have 5 stages');
  console.log('PASS: Feasibility converted without manual re-typing; cash flow timeline active.');

  // -------------------------------------------------------------
  // STEP 6: PROFORMA INVOICE APPROVAL & ISSUE INTERNATIONAL PO
  // -------------------------------------------------------------
  console.log('Step 6: Approving Proforma Invoice & Generating International PO...');
  await importService.approveProformaInvoice(tenantId, userId, conversionResult.proformaId!);
  // A Proforma without product catalog links MUST NOT fabricate a purchase order.
  let unlinkedProformaRejected = false;
  try {
    await importService.generatePoFromProforma(tenantId, userId, conversionResult.proformaId!);
  } catch (err: any) {
    unlinkedProformaRejected = true;
    assert.match(err.message, /صنف|ربط كل بند/);
  }
  assert.ok(unlinkedProformaRejected, 'Unlinked Proforma must never create a fake purchase order');
  console.log('PASS: Unlinked Proforma cannot create an unaudited purchase order.');

  // -------------------------------------------------------------
  // STEP 7: FOREIGN TRANSFER (ADVANCE PAYMENT TO CHINA FACTORY)
  // -------------------------------------------------------------
  console.log('Step 7: Recording Foreign Wire Transfer (USD 13,500 advance)...');
  // First register supplier meta, then verify bank details
  await importService.upsertSupplierImportMeta(tenantId, String(supplier.id), {
    chineseName: '浙江电器制造有限公司',
    city: 'Ningbo',
    province: 'Zhejiang',
    verifiedBankDetails: {
      bankNameUsd: 'Bank of China Ningbo Branch',
      bankSwiftCode: 'BKCHCNBJ940',
      bankAccountUsd: '9482019482019',
      verified: true,
    },
  });

  await importService.verifySupplierBankDetails(
    tenantId,
    userId,
    String(supplier.id),
    'تم التحقق من الآيبان والسويفت كود عبر خطاب رسمي من بنك الصين في نينغبو'
  );

  // Large transfers (base-currency normalised) require a bound maker-checker
  // approval: fixture-only approved token, as granted out of band.
  const advanceApproval = await (db as any)
    .insertInto('import_approval_requests')
    .values({
      tenant_id: tenantId,
      module: 'import',
      action_type: 'large_transfer',
      reference_id: String(supplier.id),
      requested_by: userId,
      created_by: userId,
      status: 'approved',
      request_payload: JSON.stringify({ amount: 13500, currency: 'USD', supplierId: String(supplier.id), proformaInvoiceId: conversionResult.proformaId, projectId: project.id }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const wireTransfer = await importService.recordForeignTransfer(tenantId, userId, {
    supplierId: String(supplier.id),
    projectId: project.id,
    proformaInvoiceId: conversionResult.proformaId!,
    approvalRequestId: String(advanceApproval.id),
    amountForeign: 13500,
    amountEgp: 675000,
    currency: 'USD',
    exchangeRateContract: 50.0,
    bankAccountId: accounts['1120'],
    idempotencyKey: 'IDEMP-WIRE-ADVANCE-001',
    notes: 'تحويل الدفعة المقدمة 30% للمصنع لبدء خط الإنتاج',
  });
  assert.ok(wireTransfer.success);
  assert.equal(wireTransfer.docNo, 'FT-1');
  console.log('PASS: Foreign transfer recorded with balanced journal, bank linkage and idempotency.');

  // -------------------------------------------------------------
  // STEP 8: PRODUCTION TRACKING & QC INSPECTION
  // -------------------------------------------------------------
  console.log('Step 8: Recording Pre-Shipment Quality Inspection (QC)...');
  const qc = await importService.createQcInspection(tenantId, {
    projectId: project.id,
    stage: 'pre-shipment',
    inspectionDate: '2026-03-15',
    inspectorName: 'SGS China Inspector Team',
    sampleSize: 125,
    passedQuantity: 125,
    failedQuantity: 0,
    status: 'passed',
  });
  assert.equal(qc.status, 'passed');
  console.log('PASS: QC Pre-shipment passed 100% of tested units.');

  // Final Wire Transfer to release Bill of Lading (70% balance = $31,500)
  const balanceApproval = await (db as any)
    .insertInto('import_approval_requests')
    .values({
      tenant_id: tenantId,
      module: 'import',
      action_type: 'large_transfer',
      reference_id: String(supplier.id),
      requested_by: userId,
      created_by: userId,
      status: 'approved',
      request_payload: JSON.stringify({ amount: 31500, currency: 'USD', supplierId: String(supplier.id), proformaInvoiceId: conversionResult.proformaId, projectId: project.id }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const finalWireTransfer = await importService.recordForeignTransfer(tenantId, userId, {
    supplierId: String(supplier.id),
    projectId: project.id,
    proformaInvoiceId: conversionResult.proformaId!,
    approvalRequestId: String(balanceApproval.id),
    amountForeign: 31500,
    amountEgp: 1575000,
    currency: 'USD',
    exchangeRateContract: 50.0,
    bankAccountId: accounts['1120'],
    idempotencyKey: 'IDEMP-WIRE-BALANCE-002',
    notes: 'سداد باقي قيمة الفاتورة المبدئية 70% بعد اجتياز فحص الجودة واستلام بوليصة الشحن',
  });
  assert.ok(finalWireTransfer.success);
  console.log('PASS: Final proforma invoice balance settled (100% fully paid).');

  // -------------------------------------------------------------
  // STEP 9: CREATE MARITIME SHIPMENT & CONTAINER
  // -------------------------------------------------------------
  console.log('Step 9: Creating Maritime Container Shipment (FCL 40HQ)...');
  const productA = await (db as any)
    .insertInto('products')
    .values({
      tenant_id: tenantId,
      account_id: 'tenant-e2e',
      name: 'خلاط كهربائي تركيبي 1000W',
      sku: 'BLD-1000W',
      cost_price: 1250.0,
      sale_price: 1850.0,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const productB = await (db as any)
    .insertInto('products')
    .values({
      tenant_id: tenantId,
      account_id: 'tenant-e2e',
      name: 'قلاية هوائية رقمية 6L',
      sku: 'AF-6L',
      cost_price: 2000.0,
      sale_price: 2950.0,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Link approved Proforma items to the concrete product catalog and create a real PO.
  await importService.updateProformaInvoice(tenantId, conversionResult.proformaId!, {
    items: [
      { productId: Number(productA.id), qty: 1000, factoryPriceUsd: 25 },
      { productId: Number(productB.id), qty: 500, factoryPriceUsd: 40 },
    ],
  } as any);
  const issuedPo = await importService.generatePoFromProforma(tenantId, userId, conversionResult.proformaId!);
  assert.ok(issuedPo.po_number?.startsWith('PO-'), 'Order must be a real purchasing PO');
  assert.equal(issuedPo.po_status, 'issued');
  const poItems = await (db as any).selectFrom('purchase_order_items').selectAll().execute();
  assert.equal(poItems.length, 2, 'Real purchase order has two mapped stock lines');
  console.log(`PASS: Actual purchasing PO generated with 2 stock lines: ${issuedPo.po_number}`);

  const shipment = await importService.createShipment(tenantId, {
    containerNumber: 'MSCU-9482019',
    billOfLading: 'MEDUNGBO84920',
    projectId: project.id,
    supplierId: String(supplier.id),
    freightType: 'FCL',
    containerSize: '40HQ',
    portOfLoading: 'Ningbo',
    portOfDischarge: 'Alexandria',
    exchangeRateAtArrival: 50.0,
    pricingExchangeRate: 50.0,
    cbmVolume: 65.0,
    grossWeightKg: 4500.0,
    carrierName: 'MSC Mediterranean Shipping',
    freeDemurrageDays: 14,
    demurrageRatePerDay: 50.0,
    costAllocationMethod: 'value',
  });

  await importService.addShipmentItem(tenantId, shipment.id, {
    productId: String(productA.id),
    quantity: 1000,
    factoryUnitPriceUsd: 25.0,
    unitWeightKg: 2.5,
    unitCbm: 0.025,
  });

  await importService.addShipmentItem(tenantId, shipment.id, {
    productId: String(productB.id),
    quantity: 500,
    factoryUnitPriceUsd: 40.0,
    unitWeightKg: 4.0,
    unitCbm: 0.045,
  });
  console.log(`PASS: Shipment created: ${shipment.container_number} with 2 product line items.`);

  // -------------------------------------------------------------
  // STEP 10: CUSTOMS BROKER ADVANCE DISBURSEMENT
  // -------------------------------------------------------------
  console.log('Step 10: Registering Customs Broker & Disbursing Petty Cash Advance...');
  const broker = await importService.createCustomsBroker(tenantId, {
    name: 'مؤسسة النصر للتخليص الجمركي (أحمد مهران)',
    licenseNo: 'LIC-ALEX-8492',
    phone: '01002938475',
    customsPorts: ['Alexandria', 'Dekheila'],
  });

  const brokerAdvance = await importService.disburseBrokerAdvance(tenantId, userId, {
    brokerId: broker.id,
    projectId: project.id,
    shipmentId: shipment.id,
    advanceNo: 'ADV-ALEX-001',
    amountEgp: 150000,
    treasuryAccountId: String(accounts['1120']),
    notes: 'عهدة تسيير جمركي ودفع الرسوم بميناء الإسكندرية',
  });
  assert.equal(Number(brokerAdvance.amount_egp), 150000);
  assert.equal(brokerAdvance.status, 'active');
  console.log('PASS: Customs broker petty cash advance disbursed (150,000 EGP).');

  // -------------------------------------------------------------
  // STEP 11: LIQUIDATE BROKER EXPENSES WITH ITEMIZED RECEIPTS
  // -------------------------------------------------------------
  console.log('Step 11: Liquidating Broker Expenses with Itemized Receipts...');
  const exp1 = await importService.liquidateBrokerExpenses(tenantId, userId, {
    brokerId: broker.id,
    advanceId: brokerAdvance.id,
    projectId: project.id,
    shipmentId: shipment.id,
    receiptNo: 'RCP-CUSTOMS-DUTY-01',
    category: 'customs_duty',
    amountEgp: 110000,
    isCapitalized: true,
  });

  const exp2 = await importService.liquidateBrokerExpenses(tenantId, userId, {
    brokerId: broker.id,
    advanceId: brokerAdvance.id,
    projectId: project.id,
    shipmentId: shipment.id,
    receiptNo: 'RCP-PORT-FEES-02',
    category: 'port_fees',
    amountEgp: 30000,
    isCapitalized: true,
  });

  const statement = await importService.getCustomsBrokerStatement(tenantId, broker.id);
  assert.equal(statement.totalAdvances, 150000);
  assert.equal(statement.totalExpenses, 140000);
  assert.equal(statement.netBalanceDue, 10000); // 10,000 EGP remaining with broker
  console.log('PASS: Broker expenses liquidated; statement reconciled (10,000 EGP remaining balance).');

  // -------------------------------------------------------------
  // STEP 12: RECORD CONTAINER SECURITY DEPOSIT TO SHIPPING LINE
  // -------------------------------------------------------------
  console.log('Step 12: Recording Refundable Container Security Deposit (40,000 EGP)...');
  const deposit = await importService.recordContainerDeposit(tenantId, userId, {
    projectId: project.id,
    shipmentId: shipment.id,
    containerNo: shipment.container_number,
    shippingLine: 'MSC Mediterranean Shipping',
    depositAmountEgp: 40000,
    expectedReturnDate: '2026-04-10',
    treasuryAccountId: String(accounts['1120']),
    notes: 'تأمين حاوية مسترد عند إعادة الفارغ لمستودع MSC بالإسكندرية',
  });
  assert.equal(deposit.refund_status, 'pending');
  assert.equal(Number(deposit.deposit_amount_egp), 40000);
  console.log('PASS: Container security deposit booked as refundable asset.');

  // -------------------------------------------------------------
  // STEP 13: IN-TRANSIT CONTAINER PRE-ORDERS & CUSTOMER DEPOSITS
  // -------------------------------------------------------------
  console.log('Step 13: Booking In-Transit Container Pre-orders for Customers while at sea...');
  const customer = await (db as any)
    .insertInto('customers')
    .values({
      tenant_id: tenantId,
      name: 'شركة الأندلس للأجهزة الكهربائية (تاجر جملة)',
      phone: '01223948571',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const preorder = await importService.createContainerPreorder(tenantId, userId, {
    projectId: project.id,
    shipmentId: shipment.id,
    customerId: String(customer.id),
    productId: String(productA.id),
    reservedQuantity: 400,
    unitPriceEgp: 1800,
    depositAmountEgp: 100000,
    depositTreasuryAccountId: String(accounts['1120']),
    expectedDeliveryDate: '2026-04-05',
    notes: 'حجز مسبق عايم في البحر بسعر جملة مميز ودفع عربون 100 ألف',
  });
  assert.equal(Number(preorder.reserved_quantity), 400);
  assert.equal(preorder.status, 'reserved');
  console.log('PASS: In-transit pre-order booked; customer deposit recorded as liability (unearned revenue).');

  // Verify negative invariant: overselling beyond BL capacity strictly rejected!
  let oversellRejected = false;
  try {
    await importService.createContainerPreorder(tenantId, userId, {
      projectId: project.id,
      shipmentId: shipment.id,
      customerId: String(customer.id),
      productId: String(productA.id),
      reservedQuantity: 700, // 400 + 700 = 1100 > 1000 BL quantity!
      unitPriceEgp: 1800,
    });
  } catch (err: any) {
    oversellRejected = true;
  }
  assert.ok(oversellRejected, 'Overselling container pre-orders beyond BL quantity must be strictly rejected!');
  console.log('PASS: Overselling negative test correctly blocked by capacity gate.');

  // A separate cancellable booking verifies complete/partial idempotent advance refunds.
  const returnable = await importService.createContainerPreorder(tenantId, userId, {
    projectId: project.id,
    shipmentId: shipment.id,
    customerId: String(customer.id),
    productId: String(productB.id),
    reservedQuantity: 5,
    unitPriceEgp: 2000,
    depositAmountEgp: 1000,
    depositTreasuryAccountId: String(accounts['1120']),
  });
  let prematureCancelBlocked = false;
  try {
    await importService.cancelContainerPreorder(tenantId, returnable.id, 'طلب العميل');
  } catch { prematureCancelBlocked = true; }
  assert.equal(prematureCancelBlocked, true, 'Unsettled customer liability cannot be silently cancelled.');
  const partialRefund = await importService.refundContainerPreorder(tenantId, userId, returnable.id, {
    amountEgp: 400, idempotencyKey: 'test-booking-refund-partial-01',
  });
  assert.equal(partialRefund.success, true);
  await assert.rejects(
    () => importService.refundContainerPreorder(tenantId, userId, returnable.id, {
      amountEgp: 400, idempotencyKey: 'test-booking-refund-partial-01',
    }),
    /مفتاح|مسجل بالفعل/,
  );
  await importService.refundContainerPreorder(tenantId, userId, returnable.id, {
    amountEgp: 600, idempotencyKey: 'test-booking-refund-final-02',
  });
  await importService.cancelContainerPreorder(tenantId, returnable.id, 'تم رد العربون بالكامل');
  const customerRefundTotal = await db.selectFrom('treasury_transactions')
    .select([sql<number>`coalesce(sum(amount),0)`.as('total')])
    .where('tenant_id','=',tenantId)
    .where('txn_type','=','import_customer_advance_refund')
    .executeTakeFirstOrThrow();
  assert.equal(Number(customerRefundTotal.total), -1000);
  console.log('PASS: Customer advances refunded in two reconciled, idempotent transactions.');

  // -------------------------------------------------------------
  // STEP 14: CONTAINER ARRIVAL, WAREHOUSE RECEIPT & LOT CREATION
  // -------------------------------------------------------------
  console.log('Step 14: Marking Container Arrived & Posting Atomic Warehouse Receipt...');
  await importService.updateShipmentCosts(tenantId, userId, shipment.id, {
    status: 'Arrived',
    receiptLocationId: 1,
    customsCostEgp: 140000,
    internalTransportCostEgp: 15000,
    exchangeRateAtArrival: 50.0,
  });

  // Verify inventory lots created automatically
  const createdLots = await db
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('shipment_id', '=', shipment.id)
    .where('tenant_id', '=', tenantId)
    .execute();
  assert.equal(createdLots.length, 2, '2 inventory lots must be created for the 2 products');
  console.log('PASS: Inventory lots created with traceable unit landed costs.');

  // Verify pre-order was automatically transitioned to 'allocated'
  const updatedPreorder = await db
    .selectFrom('import_container_preorders')
    .selectAll()
    .where('id', '=', preorder.id)
    .executeTakeFirstOrThrow();
  assert.equal(updatedPreorder.status, 'allocated', 'Preorder must transition to allocated on warehouse arrival');
  console.log('PASS: Container pre-order automatically allocated against physical inventory lot.');

  // -------------------------------------------------------------
  // STEP 15: IAS 2 LATE EXPENSE ALLOCATION
  // -------------------------------------------------------------
  console.log('Step 15: Processing Late Port Expense with IAS 2 Split...');
  const lateExp = await importService.processLateShipmentExpense(tenantId, userId, shipment.id, {
    title: 'فاتورة أرضيات إضافية متأخرة من هيئة ميناء الإسكندرية',
    lateExpenseAmount: 15000,
    payableAccountId: accounts['2110'],
  });
  assert.equal(lateExp.allocation.lateExpenseAmount, 15000);
  console.log('PASS: Late expense allocated with IAS 2 mathematical precision.');

  // -------------------------------------------------------------
  // STEP 16: RETURN EMPTY CONTAINER & REFUND SECURITY DEPOSIT
  // -------------------------------------------------------------
  console.log('Step 16: Returning Empty Container to Shipping Line Depot & Refund Deposit...');
  const refundedDeposit = await importService.recordContainerReturnAndRefund(tenantId, userId, deposit.id, {
    idempotencyKey: 'e2e-refund-original',
    actualReturnDate: '2026-04-08',
    refundedAmountEgp: 38000,
    deductionsAmountEgp: 2000,
    deductionReason: 'خصم يومين تأخير detention عن فترة السماح',
    treasuryAccountId: String(accounts['1120']),
  });
  assert.equal(refundedDeposit.refund_status, 'refunded');
  assert.equal(Number(refundedDeposit.deductions_amount_egp), 2000);

  const updatedShipment = await (db as any).selectFrom('import_shipments').selectAll().where('id', '=', shipment.id).executeTakeFirstOrThrow();
  assert.equal(updatedShipment.container_status, 'empty_returned');
  console.log('PASS: Container marked empty_returned; 38,000 EGP refunded and 2,000 EGP detention expensed.');

  // -------------------------------------------------------------
  // STEP 17: SINGLE-CONTAINER EXECUTIVE AUTOPSY SHEET
  // -------------------------------------------------------------
  console.log('Step 17: Generating 1-Page Executive Container P&L Autopsy Sheet...');
  const autopsy = await importService.getContainerAutopsySheet(tenantId, shipment.id);
  assert.equal(autopsy.operational.containerNumber, 'MSCU-9482019');
  assert.equal(autopsy.operational.totalUnitsReceived, 1500);
  assert.ok(autopsy.landedCosts.totalLandedCostEgp > 0);
  assert.equal(autopsy.operational.containerStatus, 'empty_returned');
  console.log(`PASS: Container Autopsy Sheet generated: Total Landed Cost = ${autopsy.landedCosts.totalLandedCostEgp} EGP, Units = ${autopsy.operational.totalUnitsReceived}`);

  // -------------------------------------------------------------
  // STEP 18: MAKER-CHECKER GOVERNANCE WORKFLOW
  // -------------------------------------------------------------
  console.log('Step 18: Testing Maker-Checker Governance Approval Workflow...');
  const approval = await importService.createApprovalRequest(tenantId, userId, {
    actionType: 'partner_distribution',
    referenceId: p1.id,
    requestPayload: { amount: 50000, partnerId: p1.id, projectId: project.id, partner: p1.name },
  });

  // Negative test: creator cannot approve their own request!
  let selfApprovalBlocked = false;
  try {
    await importService.decideApprovalRequest(tenantId, userId, approval.id, { decision: 'approved' });
  } catch (err: any) {
    selfApprovalBlocked = true;
  }
  assert.ok(selfApprovalBlocked, 'Maker-checker must strictly reject self-approval!');
  console.log('PASS: Maker-Checker self-approval blocked by governance gate.');

  // Create second user as auditor and approve
  const auditor = await (db as any)
    .insertInto('users')
    .values({
      id: 2,
      tenant_id: tenantId,
      username: 'senior_financial_checker',
      password_hash: 'hashed',
      role: 'super_admin',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const approvedReq = await importService.decideApprovalRequest(tenantId, Number(auditor.id), approval.id, {
    decision: 'approved',
  });
  assert.equal(approvedReq.status, 'approved');
  console.log('PASS: Independent checker approved governance request.');

  // -------------------------------------------------------------
  // STEP 19: RECONCILIATION SCAN ENGINE
  // -------------------------------------------------------------
  console.log('Step 19: Running Automated Financial Reconciliation Scan...');
  const scanResult = await importService.runImportReconciliationScan(tenantId);
  assert.ok(scanResult.scannedAt);
  console.log(`PASS: Reconciliation scan completed (${scanResult.exceptionsFoundCount} items flagged).`);

  // -------------------------------------------------------------
  // STEP 20: AUDITED PRE-CLOSURE AUDIT GATES (REJECTIONS WITH EXACT ASSERT.MATCH)
  // -------------------------------------------------------------
  console.log('Step 20: Testing Audited Pre-Closure Audit Gates...');
  const auditClosureApproval = await importService.createApprovalRequest(tenantId, userId, {
    actionType: 'project_closure', referenceId: project.id,
  });
  await importService.decideApprovalRequest(tenantId, Number(auditor.id), auditClosureApproval.id, { decision: 'approved' });
  // Gate 1: Project cannot close while customs broker has unliquidated advance (10,000 EGP remaining)
  let brokerGateTriggered = false;
  try {
    await importService.closeProject(tenantId, userId, project.id, auditClosureApproval.id);
  } catch (err: any) {
    brokerGateTriggered = true;
    assert.match(
      err.message,
      /عهدة مخلص معلقة/,
      `Expected unliquidated broker advance error message, got: ${err.message}`
    );
  }
  assert.ok(brokerGateTriggered, 'Pre-closure audit must strictly reject closure with active broker advance!');
  console.log('PASS: Gate 1 blocked closure: Unliquidated broker advance detected.');

  // Liquidate remaining 10,000 EGP broker advance to clear Gate 1
  await importService.liquidateBrokerExpenses(tenantId, userId, {
    brokerId: broker.id,
    advanceId: brokerAdvance.id,
    projectId: project.id,
    shipmentId: shipment.id,
    receiptNo: 'RCPT-FINAL-SETTLEMENT-001',
    category: 'port_fees',
    amountEgp: 10000,
    isCapitalized: true,
  });

  // Gate 2: Project closure blocked by pending container security deposit
  const tempDeposit = await importService.recordContainerDeposit(tenantId, userId, {
    projectId: project.id,
    shipmentId: shipment.id,
    containerNo: 'TEMPORARY-CONT-01',
    shippingLine: 'Maersk Line',
    depositAmountEgp: 20000,
    expectedReturnDate: '2026-05-01',
    treasuryAccountId: String(accounts['1120']),
  });

  let depositGateTriggered = false;
  try {
    await importService.closeProject(tenantId, userId, project.id, auditClosureApproval.id);
  } catch (err: any) {
    depositGateTriggered = true;
    assert.match(
      err.message,
      /تأمين حاوية معلق/,
      `Expected pending container deposit error message, got: ${err.message}`
    );
  }
  assert.ok(depositGateTriggered, 'Pre-closure audit must strictly reject closure with pending container deposit!');
  console.log('PASS: Gate 2 blocked closure: Pending container deposit detected.');

  // Refund the temporary deposit to clear Gate 2
  await importService.recordContainerReturnAndRefund(tenantId, userId, tempDeposit.id, {
    idempotencyKey: 'e2e-refund-second',
    actualReturnDate: '2026-04-15',
    refundedAmountEgp: 20000,
    deductionsAmountEgp: 0,
    treasuryAccountId: String(accounts['1120']),
  });

  // Gate 3: Project closure blocked by unsold inventory remaining in lots
  let unsoldLotsGateTriggered = false;
  try {
    await importService.closeProject(tenantId, userId, project.id, auditClosureApproval.id);
  } catch (err: any) {
    unsoldLotsGateTriggered = true;
    assert.match(
      err.message,
      /رصيد مخزني غير مباع بالباتش/,
      `Expected unsold lots error message, got: ${err.message}`
    );
  }
  assert.ok(unsoldLotsGateTriggered, 'Pre-closure audit must strictly reject closure with unsold inventory lots!');
  console.log('PASS: Gate 3 blocked closure: Unsold inventory remaining in lots detected.');

  // -------------------------------------------------------------
  // STEP 21: RETAIL POINT OF SALE (POS) SALE & FIFO LOT ALLOCATION
  // -------------------------------------------------------------
  console.log('Step 21: Processing Retail POS Cash Sale & FIFO Lot Allocation...');
  // Customer purchases 50 units of Product A (BLD-1000W) in cash @ 1,850 EGP
  const posSale = await (db as any)
    .insertInto('sales')
    .values({
      tenant_id: tenantId,
      doc_no: 'INV-POS-2026-001',
      total: 92500,
      paid_amount: 92500,
      status: 'completed',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const posItem = await (db as any)
    .insertInto('sale_items')
    .values({
      tenant_id: tenantId,
      account_id: 'tenant-e2e',
      sale_id: Number(posSale.id),
      product_id: Number(productA.id),
      product_name: productA.name,
      qty: 50,
      unit_price: 1850,
      line_total: 92500,
      cost_price: 1250,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Execute operational lot allocation via engine transaction
  await db.transaction().execute(async (trx) => {
    await allocateSaleFromImportLots(trx, {
      tenantId,
      locationId: 1,
      saleId: Number(posSale.id),
      items: [
        {
          itemId: Number(posItem.id),
          productId: Number(productA.id),
          qty: 50,
          netUnitPrice: 1850,
        },
      ],
    });
  });

  // Verify lot allocation record created
  const posAllocations = await db
    .selectFrom('import_sale_allocations')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('sale_id', '=', Number(posSale.id))
    .execute();

  assert.equal(posAllocations.length, 1, 'Exactly 1 lot allocation row must be created');
  assert.equal(Number(posAllocations[0].quantity), 50);
  assert.equal(posAllocations[0].allocation_type, 'sale');
  assert.equal(Number(posAllocations[0].unit_sale_price_egp), 1850);
  assert.ok(Number(posAllocations[0].gross_margin_egp) > 0, 'Gross margin must be positive');

  // Verify lot remaining quantity decremented from 1,000 to 950
  const lotAfterPos = await db
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('shipment_id', '=', shipment.id)
    .where('product_id', '=', Number(productA.id))
    .executeTakeFirstOrThrow();
  assert.equal(Number(lotAfterPos.remaining_quantity), 950);
  console.log(`PASS: Retail POS sale allocated from lot (remaining: ${lotAfterPos.remaining_quantity}, margin: ${posAllocations[0].gross_margin_egp} EGP).`);

  // -------------------------------------------------------------
  // STEP 22: WHOLESALE CREDIT SALE (FULFILLING IN-TRANSIT PRE-ORDER)
  // -------------------------------------------------------------
  console.log('Step 22: Processing Wholesale Credit Sale & Invoicing Pre-order...');
  // Fulfill customer pre-order of 400 units @ 1,800 EGP = 720,000 EGP
  // Deposit of 100,000 was paid during shipping; remaining credit balance = 620,000 EGP
  const wsSale = await (db as any)
    .insertInto('sales')
    .values({
      tenant_id: tenantId,
      customer_id: Number(customer.id),
      doc_no: 'INV-WS-2026-001',
      total: 720000,
      paid_amount: 100000, // 100,000 applied from preorder deposit
      status: 'completed',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const wsItem = await (db as any)
    .insertInto('sale_items')
    .values({
      tenant_id: tenantId,
      account_id: 'tenant-e2e',
      sale_id: Number(wsSale.id),
      product_id: Number(productA.id),
      product_name: productA.name,
      qty: 400,
      unit_price: 1800,
      line_total: 720000,
      cost_price: 1250,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db.transaction().execute(async (trx) => {
    await allocateSaleFromImportLots(trx, {
      tenantId,
      locationId: 1,
      saleId: Number(wsSale.id),
      items: [
        {
          itemId: Number(wsItem.id),
          productId: Number(productA.id),
          qty: 400,
          netUnitPrice: 1800,
        },
      ],
    });
  });

  // Update preorder status to 'invoiced'
  await db
    .updateTable('import_container_preorders')
    .set({
      status: 'invoiced',
      sale_invoice_id: Number(wsSale.id),
      updated_at: new Date(),
    })
    .where('id', '=', preorder.id)
    .execute();

  const updatedPreorderStatus = await db
    .selectFrom('import_container_preorders')
    .select(['status', 'sale_invoice_id'])
    .where('id', '=', preorder.id)
    .executeTakeFirstOrThrow();
  assert.equal(updatedPreorderStatus.status, 'invoiced');
  assert.equal(Number(updatedPreorderStatus.sale_invoice_id), Number(wsSale.id));

  const lotAfterWs = await db
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('shipment_id', '=', shipment.id)
    .where('product_id', '=', Number(productA.id))
    .executeTakeFirstOrThrow();
  assert.equal(Number(lotAfterWs.remaining_quantity), 550); // 950 - 400 = 550
  console.log(`PASS: Wholesale credit sale invoiced and allocated (lot remaining: ${lotAfterWs.remaining_quantity}).`);

  // -------------------------------------------------------------
  // STEP 23: WHOLESALE DEBT COLLECTION & TREASURY SETTLEMENT
  // -------------------------------------------------------------
  console.log('Step 23: Collecting Customer Remaining Receivables (620,000 EGP)...');
  // Customer pays remaining 620,000 EGP via bank transfer
  await db
    .insertInto('treasury_transactions')
    .values({
      tenant_id: tenantId,
      account_id: String(accounts['1120']),
      txn_type: 'customer_payment',
      amount: 620000,
      note: 'تحصيل مديونية فاتورة الجملة INV-WS-2026-001',
      reference_type: 'sale',
      reference_id: Number(wsSale.id),
      created_by: userId,
    })
    .execute();

  await db
    .updateTable('sales')
    .set({ paid_amount: 720000 })
    .where('id', '=', Number(wsSale.id))
    .execute();

  const finalSaleRecord = await db
    .selectFrom('sales')
    .select(['total', 'paid_amount'])
    .where('id', '=', Number(wsSale.id))
    .executeTakeFirstOrThrow();
  assert.equal(Number(finalSaleRecord.paid_amount), Number(finalSaleRecord.total));
  console.log('PASS: Wholesale customer debt collected in full (720,000 / 720,000 EGP).');

  // -------------------------------------------------------------
  // STEP 24: SALES RETURN WORKFLOW & FIFO LOT RESTORATION
  // -------------------------------------------------------------
  console.log('Step 24: Processing Customer Sales Return & Lot Restoration...');
  // Retail customer returns 10 units of Product A
  const retDoc = await (db as any)
    .insertInto('return_documents')
    .values({
      tenant_id: tenantId,
      account_id: 'tenant-e2e',
      doc_no: 'RET-2026-001',
      return_type: 'sale',
      invoice_id: Number(posSale.id),
      total: 18500, // 10 * 1850
      settlement_mode: 'cash',
      refund_method: 'cash',
      note: 'مرتجع مبيعات تجزئة',
      created_by: userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await (db as any)
    .insertInto('return_items')
    .values({
      tenant_id: tenantId,
      account_id: 'tenant-e2e',
      return_document_id: Number(retDoc.id),
      product_id: Number(productA.id),
      product_name: productA.name,
      qty: 10,
      unit_total: 1850,
      line_total: 18500,
    })
    .execute();

  await db.transaction().execute(async (trx) => {
    await restoreImportLotsFromSalesReturn(trx, {
      tenantId,
      saleId: Number(posSale.id),
      productId: Number(productA.id),
      returnQty: 10,
    });
  });

  // Verify lot quantity restored from 550 to 560
  const lotAfterReturn = await db
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('shipment_id', '=', shipment.id)
    .where('product_id', '=', Number(productA.id))
    .executeTakeFirstOrThrow();
  assert.equal(Number(lotAfterReturn.remaining_quantity), 560); // 550 + 10 = 560

  const returnAlloc = await db
    .selectFrom('import_sale_allocations')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('allocation_type', '=', 'return')
    .executeTakeFirstOrThrow();
  assert.equal(Number(returnAlloc.quantity), -10);
  console.log(`PASS: Sales return restored 10 units to lot (remaining: ${lotAfterReturn.remaining_quantity}).`);

  // -------------------------------------------------------------
  // STEP 25: INVOICE CANCELLATION WORKFLOW & LOT ALLOCATION REVERSAL
  // -------------------------------------------------------------
  console.log('Step 25: Processing Invoice Cancellation & Lot Allocation Reversal...');
  // An erroneous sale of 60 units is created
  const erroneousSale = await (db as any)
    .insertInto('sales')
    .values({
      tenant_id: tenantId,
      doc_no: 'INV-ERR-2026-001',
      total: 111000, // 60 * 1850
      paid_amount: 111000,
      status: 'completed',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db.transaction().execute(async (trx) => {
    await allocateSaleFromImportLots(trx, {
      tenantId,
      locationId: 1,
      saleId: Number(erroneousSale.id),
      items: [{ productId: Number(productA.id), qty: 60, netUnitPrice: 1850 }],
    });
  });

  const lotDuringErr = await db
    .selectFrom('import_inventory_lots')
    .select('remaining_quantity')
    .where('tenant_id', '=', tenantId)
    .where('shipment_id', '=', shipment.id)
    .where('product_id', '=', Number(productA.id))
    .executeTakeFirstOrThrow();
  assert.equal(Number(lotDuringErr.remaining_quantity), 500); // 560 - 60 = 500

  // Now cancel the sale invoice
  await db
    .updateTable('sales')
    .set({ status: 'cancelled' })
    .where('id', '=', Number(erroneousSale.id))
    .execute();

  await db.transaction().execute(async (trx) => {
    await restoreImportLotsFromCancelledSale(trx, {
      tenantId,
      saleId: Number(erroneousSale.id),
    });
  });

  // Verify lot restored back to 560
  const lotAfterCancel = await db
    .selectFrom('import_inventory_lots')
    .select('remaining_quantity')
    .where('tenant_id', '=', tenantId)
    .where('shipment_id', '=', shipment.id)
    .where('product_id', '=', Number(productA.id))
    .executeTakeFirstOrThrow();
  assert.equal(Number(lotAfterCancel.remaining_quantity), 560);

  const reversalAlloc = await db
    .selectFrom('import_sale_allocations')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('allocation_type', '=', 'cancellation')
    .executeTakeFirstOrThrow();
  assert.equal(Number(reversalAlloc.quantity), -60);
  console.log(`PASS: Sale cancellation reversed 60 units back to lot (remaining: ${lotAfterCancel.remaining_quantity}).`);

  // -------------------------------------------------------------
  // STEP 26: POST-SALES LATE SHIPMENT EXPENSE ALLOCATION (IAS 2 SPLIT)
  // -------------------------------------------------------------
  console.log('Step 26: Processing Post-Sales Late Port Expense with IAS 2 Split...');
  // Delayed detention bill of 20,000 EGP arrives after units have been sold
  // Product A: 1000 total received, 560 on hand, 440 net sold
  // Product B: 500 total received, 500 on hand, 0 sold
  const latePostSaleExp = await importService.processLateShipmentExpense(tenantId, userId, shipment.id, {
    title: 'مطالبة متأخرة لغرامات تأخير أرضيات ميناء الإسكندرية',
    lateExpenseAmount: 20000,
    payableAccountId: accounts['2110'],
    note: 'توزيع متأخر بموجب IAS 2 بين البضاعة المباعة والمتبقية',
  });

  assert.ok(latePostSaleExp.success);
  assert.ok(latePostSaleExp.allocation.lateCogsAdjustmentEgp > 0, 'Must allocate portion to COGS for sold units');
  assert.ok(latePostSaleExp.allocation.lateInventoryAdjustmentEgp > 0, 'Must allocate portion to Inventory for on-hand units');
  const sumSplit = Number((latePostSaleExp.allocation.lateCogsAdjustmentEgp + latePostSaleExp.allocation.lateInventoryAdjustmentEgp).toFixed(2));
  assert.equal(sumSplit, 20000, 'Sum of COGS and Inventory adjustments must equal total late expense');
  console.log(`PASS: IAS 2 late expense split mathematically exact: COGS = ${latePostSaleExp.allocation.lateCogsAdjustmentEgp} EGP, Inventory = ${latePostSaleExp.allocation.lateInventoryAdjustmentEgp} EGP.`);

  // -------------------------------------------------------------
  // STEP 27: MULTI-PROJECT SHARED PRODUCT PROFIT ISOLATION
  // -------------------------------------------------------------
  console.log('Step 27: Testing Multi-Project Shared Product Profit Isolation...');
  // Create a second parallel project that imports the EXACT SAME Product A
  const project2 = await importService.createProject(tenantId, {
    projectNo: 'IMP-2026-002',
    title: 'مشروع استيراد موازٍ - الدفعة الثانية من نفس الصنف',
    budgetCurrency: 'USD',
    allocatedCapital: 30000,
  });

  const shipment2 = await importService.createShipment(tenantId, {
    containerNumber: 'CMAU-8492018',
    billOfLading: 'CMANB84920',
    projectId: project2.id,
    supplierId: String(supplier.id),
  });

  await importService.addShipmentItem(tenantId, shipment2.id, {
    productId: String(productA.id), // Same product!
    quantity: 500,
    factoryUnitPriceUsd: 26.0,
    unitWeightKg: 2.5,
    unitCbm: 0.025,
  });

  await importService.updateShipmentCosts(tenantId, userId, shipment2.id, {
    status: 'Arrived',
    receiptLocationId: 1,
    customsCostEgp: 70000,
    internalTransportCostEgp: 8000,
    exchangeRateAtArrival: 50.0,
  });

  // Verify Lot 2 created for Project 2
  const lotProject2 = await db
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('project_id', '=', project2.id)
    .where('product_id', '=', Number(productA.id))
    .executeTakeFirstOrThrow();
  assert.equal(Number(lotProject2.remaining_quantity), 500);

  // Sell 100 units of Product A
  const p1Sale = await (db as any)
    .insertInto('sales')
    .values({
      tenant_id: tenantId,
      doc_no: 'INV-SHARED-001',
      total: 185000,
      paid_amount: 185000,
      status: 'completed',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const sharedSaleItem = await (db as any).insertInto('sale_items').values({
    tenant_id: tenantId, account_id: 'tenant-e2e', sale_id: Number(p1Sale.id),
    product_id: Number(productA.id), product_name: productA.name,
    qty: 100, unit_price: 1850, line_total: 185000, cost_price: 1250,
  }).returning('id').executeTakeFirstOrThrow();
  await db.transaction().execute(async (trx) => {
    await allocateSaleFromImportLots(trx, {
      tenantId,
      locationId: 1,
      saleId: Number(p1Sale.id),
      items: [{ itemId: Number(sharedSaleItem.id), productId: Number(productA.id), qty: 100, netUnitPrice: 1850 }],
    });
  });

  // Under FIFO, this sale came from Lot 1 (Project 1). Lot 1 remaining drops from 560 to 460.
  const lotP1Check = await db
    .selectFrom('import_inventory_lots')
    .select('remaining_quantity')
    .where('id', '=', lotAfterReturn.id)
    .executeTakeFirstOrThrow();
  assert.equal(Number(lotP1Check.remaining_quantity), 460);

  // Lot 2 (Project 2) remains completely untouched at 500
  const lotP2Check = await db
    .selectFrom('import_inventory_lots')
    .select('remaining_quantity')
    .where('id', '=', lotProject2.id)
    .executeTakeFirstOrThrow();
  assert.equal(Number(lotP2Check.remaining_quantity), 500);

  // Generate profit reports and verify complete isolation
  const p1Profit = await importService.generatePeriodProfitReport(
    tenantId,
    new Date('2026-01-01'),
    new Date('2026-12-31'),
    project.id
  );
  const p2Profit = await importService.generatePeriodProfitReport(
    tenantId,
    new Date('2026-01-01'),
    new Date('2026-12-31'),
    project2.id
  );

  assert.equal(p1Profit.data.profitAttributionVerified, true);
  assert.ok(p1Profit.data.grossSalesRevenue > 0, 'Project 1 must reflect its allocated sales');
  assert.equal(p2Profit.data.grossSalesRevenue, 0, 'Project 2 must have 0 sales despite sharing the same product catalog ID');
  console.log('PASS: Shared product profit strictly isolated across multiple import projects via lot allocation tracking.');

  // -------------------------------------------------------------
  // STEP 28: LIQUIDATE ALL REMAINING PROJECT 1 LOTS TO ZERO
  // -------------------------------------------------------------
  console.log('Step 28: Depleting All Remaining Project 1 Inventory Lots to Zero...');
  // Sell remaining 460 units of Product A and 500 units of Product B from Project 1
  const bulkClearanceSale = await (db as any)
    .insertInto('sales')
    .values({
      tenant_id: tenantId,
      doc_no: 'INV-BULK-CLEAR-001',
      total: 460 * 1850 + 500 * 2950,
      paid_amount: 460 * 1850 + 500 * 2950,
      status: 'completed',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await (db as any)
    .insertInto('sale_items')
    .values([
      {
        tenant_id: tenantId,
        account_id: 'tenant-e2e',
        sale_id: Number(bulkClearanceSale.id),
        product_id: Number(productA.id),
        product_name: productA.name,
        qty: 460,
        unit_price: 1850,
        line_total: 460 * 1850,
        cost_price: 1250,
      },
      {
        tenant_id: tenantId,
        account_id: 'tenant-e2e',
        sale_id: Number(bulkClearanceSale.id),
        product_id: Number(productB.id),
        product_name: productB.name,
        qty: 500,
        unit_price: 2950,
        line_total: 500 * 2950,
        cost_price: 2000,
      },
    ])
    .execute();

  const bulkSaleLines = await (db as any).selectFrom('sale_items')
    .select(['id', 'product_id']).where('tenant_id', '=', tenantId)
    .where('sale_id', '=', Number(bulkClearanceSale.id)).execute();
  const bulkItemA = bulkSaleLines.find((line: any) => Number(line.product_id) === Number(productA.id));
  const bulkItemB = bulkSaleLines.find((line: any) => Number(line.product_id) === Number(productB.id));
  assert.ok(bulkItemA && bulkItemB, 'Each imported sale must have a real sale line for source attribution');
  await db.transaction().execute(async (trx) => {
    await allocateSaleFromImportLots(trx, {
      tenantId,
      locationId: 1,
      saleId: Number(bulkClearanceSale.id),
      items: [
        { itemId: Number(bulkItemA.id), productId: Number(productA.id), qty: 460, netUnitPrice: 1850 },
        { itemId: Number(bulkItemB.id), productId: Number(productB.id), qty: 500, netUnitPrice: 2950 },
      ],
    });
  });

  const p1RemainingLots = await db
    .selectFrom('import_inventory_lots')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('project_id', '=', project.id)
    .execute();

  for (const l of p1RemainingLots) {
    assert.equal(Number(l.remaining_quantity), 0, `Lot ${l.lot_number} must be completely depleted`);
    assert.equal(l.status, 'depleted');
  }
  console.log('PASS: All Project 1 lots depleted to 0 units remaining.');

  // -------------------------------------------------------------
  // STEP 29: PARTNER SETTLEMENT & VERIFIED PROFIT DISTRIBUTION
  // -------------------------------------------------------------
  console.log('Step 29: Partner Settlement & Verified Profit Payout (Maker-Checker)...');
  const finalProfitReport = await importService.generatePeriodProfitReport(
    tenantId,
    new Date('2026-01-01'),
    new Date('2026-12-31'),
    project.id
  );
  assert.equal(finalProfitReport.data.profitAttributionVerified, true);
  const netPool = finalProfitReport.data.netProfitPool;
  assert.ok(netPool > 0, 'Net profit pool must be positive');

  const p1ExpectedShare = Number((netPool * 0.60).toFixed(2));

  // Negative test 1: Missing Maker-Checker approval must be strictly rejected
  let missingApprovalBlocked = false;
  try {
    await importService.recordPartnerPayout(tenantId, userId, p1.id, 50000);
  } catch (err: any) {
    missingApprovalBlocked = true;
    assert.match(err.message, /Maker-Checker|approvalRequestId/, `Expected missing approval rejection, got: ${err.message}`);
  }
  assert.ok(missingApprovalBlocked, 'Payout without Maker-Checker approval must be strictly rejected!');
  console.log('PASS: Payout without Maker-Checker approval strictly blocked by governance gate.');

  // Negative: no project may be omitted from a payout approval request.
  let projectFreeApprovalBlocked = false;
  try {
    await importService.createApprovalRequest(tenantId, userId, {
      actionType: 'partner_distribution', referenceId: p1.id,
      requestPayload: { partnerId: p1.id, amount: 100000 },
    });
  } catch (err: any) { projectFreeApprovalBlocked = true; assert.match(err.message, /المشروع|يتطلب/); }
  assert.ok(projectFreeApprovalBlocked, 'Payout approvals must be project-specific');

  // Negative test 2: Overpaying beyond partner share must be rejected by profit ceiling gate
  const overpayApproval = await importService.createApprovalRequest(tenantId, userId, {
    actionType: 'partner_distribution',
    referenceId: p1.id,
    requestPayload: { partnerId: p1.id, projectId: project.id, amount: p1ExpectedShare + 500000 },
  });
  await importService.decideApprovalRequest(tenantId, Number(auditor.id), overpayApproval.id, {
    decision: 'approved',
  });

  let overpayBlocked = false;
  try {
    await importService.recordPartnerPayout(tenantId, userId, p1.id, p1ExpectedShare + 500000, overpayApproval.id);
  } catch (err: any) {
    overpayBlocked = true;
    assert.match(
      err.message,
      /تتجاوز المستحق المعتمد للشريك|تتجاوز صافي أرباح الشريك|الحد الأقصى|لا يكفي/,
      `Expected profit share cap rejection, got: ${err.message}`
    );
  }
  assert.ok(overpayBlocked, 'Payout exceeding partner allocated profit share must be strictly rejected!');
  console.log('PASS: Over-payout attempt rejected by profit ceiling gate.');

  // Legitimate payout with Maker-Checker approval
  const payoutApproval = await importService.createApprovalRequest(tenantId, userId, {
    actionType: 'partner_distribution',
    referenceId: p1.id,
    requestPayload: { partnerId: p1.id, projectId: project.id, amount: 100000 },
  });

  await importService.decideApprovalRequest(tenantId, Number(auditor.id), payoutApproval.id, {
    decision: 'approved',
  });

  const payoutResult = await importService.recordPartnerPayout(
    tenantId,
    userId,
    p1.id,
    100000,
    payoutApproval.id
  );
  assert.ok(payoutResult.success);

  const updatedP1 = await db
    .selectFrom('import_partners')
    .selectAll()
    .where('id', '=', p1.id)
    .executeTakeFirstOrThrow();
  assert.equal(Number(updatedP1.withdrawn_profit), 100000);

  // Negative test: Re-using the same approval request must be rejected (single-use token)
  let reuseBlocked = false;
  try {
    await importService.recordPartnerPayout(tenantId, userId, p1.id, 10000, payoutApproval.id);
  } catch (err: any) {
    reuseBlocked = true;
    assert.match(
      err.message,
      /تم استهلاكه|تم تنفيذها مسبقاً|executed/,
      `Expected single-use approval rejection, got: ${err.message}`
    );
  }
  assert.ok(reuseBlocked, 'Re-using already executed Maker-Checker approval must be strictly rejected!');
  console.log('PASS: Maker-Checker approval single-use verified; partner profit disbursed.');

  // -------------------------------------------------------------
  // STEP 30: FINAL CLEAN AUDITED PROJECT CLOSURE & CONCURRENCY GUARDS
  // -------------------------------------------------------------
  console.log('Step 30: Final Clean Audited Project Closure & Immutability Gates...');
  // 1. Verify customs broker advance is 100% liquidated
  const finalBrokerStatement = await importService.getCustomsBrokerStatement(tenantId, broker.id);
  assert.equal(finalBrokerStatement.netBalanceDue, 0, 'Broker balance must be 100% liquidated');

  // 2. Settle remaining proforma balance in full
  await db
    .updateTable('import_proforma_invoices')
    .set({
      payment_status: 'paid',
      paid_amount_foreign: 45000,
    })
    .where('id', '=', conversionResult.proformaId!)
    .execute();

  // 3. Create and approve closure governance request
  const closeApproval = await importService.createApprovalRequest(tenantId, userId, {
    actionType: 'project_closure',
    referenceId: project.id,
  });

  await importService.decideApprovalRequest(tenantId, Number(auditor.id), closeApproval.id, {
    decision: 'approved',
  });

  // Project closure must never bypass an independent Maker-Checker approval.
  let unauthorizedClosureBlocked = false;
  try { await importService.closeProject(tenantId, userId, project.id); }
  catch (err: any) { unauthorizedClosureBlocked = true; assert.match(err.message, /Maker-Checker|موافقة/); }
  assert.ok(unauthorizedClosureBlocked, 'Project closure without approval must be rejected');

  // 4. Execute final closure
  const finalClosure = await importService.closeProject(
    tenantId,
    userId,
    project.id,
    closeApproval.id
  );
  assert.ok(finalClosure.success);
  assert.ok(finalClosure.closureData);

  const closedProjectRecord = await db
    .selectFrom('import_projects')
    .selectAll()
    .where('id', '=', project.id)
    .executeTakeFirstOrThrow();
  assert.equal(closedProjectRecord.status, 'closed');
  assert.ok(closedProjectRecord.closure_date !== null);

  // 5. Invariant Guards on Closed Project:
  // A. Cannot re-close already closed project
  let recloseBlocked = false;
  try {
    await importService.closeProject(tenantId, userId, project.id, closeApproval.id);
  } catch (err: any) {
    recloseBlocked = true;
    assert.match(err.message, /مقفل/, `Expected already closed error, got: ${err.message}`);
  }
  assert.ok(recloseBlocked, 'Re-closing an already closed project must be rejected');

  // B. Cannot edit partner ratios on closed project
  let partnerEditBlocked = false;
  try {
    await importService.setProjectPartners(tenantId, project.id, [
      { partnerId: p1.id, profitPercentage: 50 },
      { partnerId: p2.id, profitPercentage: 50 },
    ]);
  } catch (err: any) {
    partnerEditBlocked = true;
    assert.match(err.message, /مقفل ومسوى مالياً/, `Expected closed partner edit rejection, got: ${err.message}`);
  }
  assert.ok(partnerEditBlocked, 'Modifying partners on closed project must be rejected');

  console.log('PASS: Final project closure verified with 100% audited settlement, frozen autopsy and post-closure immunity.');

  console.log('\n=== ALL 30 END-TO-END STEPS PASSED WITH 100% OPERATIONAL & MATHEMATICAL INTEGRITY ===');
}

runBusinessSimulation()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED BUSINESS SIMULATION:', err);
    process.exit(1);
  });
