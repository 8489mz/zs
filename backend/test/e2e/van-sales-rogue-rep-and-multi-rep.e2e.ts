import dotenv from 'dotenv';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import type { AuditService } from '../../src/core/audit/audit.service';
import type { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { ManagerActionsService } from '../../src/modules/manager-actions/manager-actions.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

dotenv.config({ path: path.resolve(__dirname, '../../.env.development'), override: true });

const TENANT = '__van_rogue_and_multirep_e2e__';
const ACCOUNT = 'e2e-van-rogue-multirep';

async function bootstrapPgliteSchema(db: Kysely<Database>): Promise<void> {
  const ddl = `
    CREATE TABLE IF NOT EXISTS branches (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      default_stock_location_id INTEGER,
      sales_stock_mode TEXT DEFAULT 'single_location',
      allow_external_sales_stock BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS stock_locations (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      branch_id INTEGER,
      location_type TEXT DEFAULT 'internal_warehouse',
      is_active BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      username TEXT NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT DEFAULT 'cashier',
      is_active BOOLEAN DEFAULT true,
      permissions_json TEXT DEFAULT '[]',
      default_branch_id INTEGER,
      display_name TEXT,
      must_change_password BOOLEAN DEFAULT false,
      failed_login_count INTEGER DEFAULT 0,
      locked_until TIMESTAMPTZ,
      pin TEXT,
      pin_hash TEXT,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS delivery_representatives (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      full_name TEXT,
      national_id TEXT,
      address TEXT,
      vehicle_plate TEXT,
      pin_hash TEXT,
      pin_salt TEXT,
      rep_type TEXT DEFAULT 'van',
      is_van_rep BOOLEAN DEFAULT true,
      van_location_id INTEGER,
      user_id INTEGER,
      max_credit_limit NUMERIC(14,2) DEFAULT 0,
      max_cash_custody NUMERIC(14,2) DEFAULT 0,
      max_discount_percent NUMERIC(5,2) DEFAULT 0,
      max_bonus_percent NUMERIC(5,2) DEFAULT 0,
      allow_price_override BOOLEAN DEFAULT false,
      require_gps_checkin BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fleet_vehicles (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      plate_number TEXT NOT NULL,
      model_name TEXT,
      vehicle_type TEXT,
      vin_chassis TEXT,
      van_location_id INTEGER,
      branch_id INTEGER,
      current_odometer NUMERIC(12,2) DEFAULT 0,
      fuel_type TEXT,
      license_expires_at TEXT,
      status TEXT DEFAULT 'active',
      assigned_rep_id INTEGER,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      barcode TEXT,
      category_id INTEGER,
      supplier_id INTEGER,
      item_type TEXT DEFAULT 'product',
      item_kind TEXT DEFAULT 'standard',
      style_code TEXT,
      color TEXT,
      size TEXT,
      bin_location TEXT,
      primary_bin_id INTEGER,
      default_location_id INTEGER,
      cost_price NUMERIC(14,4) DEFAULT 0,
      retail_price NUMERIC(14,4) DEFAULT 0,
      wholesale_price NUMERIC(14,4) DEFAULT 0,
      credit_price NUMERIC(14,4),
      consumer_price NUMERIC(14,4),
      min_selling_price NUMERIC(14,4) DEFAULT 0,
      stock_qty NUMERIC(14,4) DEFAULT 0,
      reserved_qty NUMERIC(14,4) DEFAULT 0,
      min_stock_qty NUMERIC(14,4) DEFAULT 0,
      max_bonus_percent NUMERIC(5,2) DEFAULT 0,
      notes TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT true,
      tax_code_type TEXT,
      tax_code TEXT,
      metadata JSONB,
      track_serials BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      catalog_updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS product_units (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      multiplier NUMERIC(14,4) DEFAULT 1,
      barcode TEXT,
      is_base_unit BOOLEAN DEFAULT false,
      is_sale_unit_default BOOLEAN DEFAULT false,
      is_purchase_unit_default BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS product_location_stock (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      branch_id INTEGER,
      location_id INTEGER,
      qty NUMERIC(14,4) DEFAULT 0,
      reserved_qty NUMERIC(14,4) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      product_id INTEGER,
      movement_type TEXT NOT NULL,
      qty NUMERIC(14,4) NOT NULL,
      before_qty NUMERIC(14,4) DEFAULT 0,
      after_qty NUMERIC(14,4) DEFAULT 0,
      reason TEXT DEFAULT '',
      note TEXT DEFAULT '',
      reference_type TEXT,
      reference_id INTEGER,
      created_by INTEGER,
      branch_id INTEGER,
      location_id INTEGER,
      unit_cost NUMERIC(14,4),
      total_cost NUMERIC(14,4),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      balance NUMERIC(14,2) DEFAULT 0,
      customer_type TEXT DEFAULT 'wholesale',
      credit_limit NUMERIC(14,2) DEFAULT 0,
      store_credit_balance NUMERIC(14,2) DEFAULT 0,
      company_name TEXT DEFAULT '',
      tax_number TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT true,
      metadata JSONB,
      loyalty_points NUMERIC(14,2) DEFAULT 0,
      price_list_id INTEGER,
      is_credit_blocked BOOLEAN DEFAULT false,
      credit_block_reason TEXT,
      credit_blocked_at TIMESTAMPTZ,
      credit_blocked_by INTEGER,
      portal_access_pin TEXT,
      portal_token TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS customer_payments (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      note TEXT DEFAULT '',
      branch_id INTEGER,
      location_id INTEGER,
      job_id INTEGER,
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS customer_ledger (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      balance_after NUMERIC(14,2) NOT NULL,
      note TEXT DEFAULT '',
      reference_type TEXT,
      reference_id INTEGER,
      return_document_id INTEGER,
      branch_id INTEGER,
      location_id INTEGER,
      van_trip_id INTEGER,
      gps_lat NUMERIC(10,7),
      gps_lng NUMERIC(10,7),
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS van_sales_trips (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      rep_id INTEGER NOT NULL,
      vehicle_id INTEGER,
      shift_name TEXT,
      van_location_id INTEGER NOT NULL,
      source_warehouse_id INTEGER NOT NULL,
      status TEXT DEFAULT 'open',
      opened_at TIMESTAMPTZ DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      start_odometer NUMERIC(12,2),
      end_odometer NUMERIC(12,2),
      loaded_amount NUMERIC(14,2) DEFAULT 0,
      sales_amount NUMERIC(14,2) DEFAULT 0,
      cash_collected NUMERIC(14,2) DEFAULT 0,
      credit_sales NUMERIC(14,2) DEFAULT 0,
      returns_amount NUMERIC(14,2) DEFAULT 0,
      cash_refunds NUMERIC(14,2) DEFAULT 0,
      variance NUMERIC(14,2) DEFAULT 0,
      settlement_status TEXT DEFAULT 'open',
      submitted_at TIMESTAMPTZ,
      supervisor_id INTEGER,
      settled_by INTEGER,
      stock_variance_amount NUMERIC(14,2) DEFAULT 0,
      stock_variance_details JSONB,
      night_stock_approved BOOLEAN DEFAULT false,
      night_stock_approved_by INTEGER,
      night_stock_notes TEXT,
      distance_km NUMERIC(12,2),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS van_load_requisitions (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      doc_no TEXT NOT NULL,
      rep_id INTEGER NOT NULL,
      source_warehouse_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      requested_items JSONB NOT NULL,
      approved_items JSONB,
      notes TEXT,
      rejection_reason TEXT,
      reviewed_by INTEGER,
      reviewed_at TIMESTAMPTZ,
      trip_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS van_field_returns (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      doc_no TEXT NOT NULL,
      trip_id INTEGER NOT NULL,
      rep_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      sale_id INTEGER,
      status TEXT DEFAULT 'pending_approval',
      return_reason TEXT NOT NULL,
      refund_method TEXT DEFAULT 'credit',
      total_amount NUMERIC(14,2) DEFAULT 0,
      items_json JSONB NOT NULL,
      notes TEXT,
      rejection_reason TEXT,
      approved_by INTEGER,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS van_trip_expenses (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      trip_id INTEGER NOT NULL,
      expense_type TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      notes TEXT,
      receipt_photo_url TEXT,
      created_by_user_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS van_trip_packaging_movements (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      trip_id INTEGER NOT NULL,
      customer_id INTEGER,
      package_type TEXT NOT NULL,
      delivered_qty NUMERIC(14,2) DEFAULT 0,
      returned_qty NUMERIC(14,2) DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS van_field_visits (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      trip_id INTEGER,
      rep_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      visit_type TEXT NOT NULL,
      sale_id INTEGER,
      negative_reason TEXT,
      postponed_to_date TEXT,
      gps_lat NUMERIC(10,7),
      gps_lng NUMERIC(10,7),
      notes TEXT,
      visited_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS van_stock_transfers (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      doc_no TEXT NOT NULL,
      from_trip_id INTEGER NOT NULL,
      from_rep_id INTEGER NOT NULL,
      from_location_id INTEGER NOT NULL,
      to_trip_id INTEGER NOT NULL,
      to_rep_id INTEGER NOT NULL,
      to_location_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending_receiver',
      items_json JSONB NOT NULL,
      total_value NUMERIC(14,2) DEFAULT 0,
      notes TEXT,
      accepted_by INTEGER,
      accepted_at TIMESTAMPTZ,
      rejected_by INTEGER,
      rejected_at TIMESTAMPTZ,
      rejection_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      exchange_return_id INTEGER,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      table_number TEXT DEFAULT '',
      order_type TEXT DEFAULT 'pos',
      doc_no TEXT,
      customer_id INTEGER,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      payment_type TEXT DEFAULT 'cash',
      payment_channel TEXT DEFAULT 'cash',
      subtotal NUMERIC(14,2) DEFAULT 0,
      discount NUMERIC(14,2) DEFAULT 0,
      tax_rate NUMERIC(6,2) DEFAULT 0,
      tax_amount NUMERIC(14,2) DEFAULT 0,
      delivery_fee NUMERIC(14,2) DEFAULT 0,
      delivery_fee_mode TEXT,
      prices_include_tax BOOLEAN DEFAULT false,
      total NUMERIC(14,2) DEFAULT 0,
      paid_amount NUMERIC(14,2) DEFAULT 0,
      applied_amount NUMERIC(14,2) DEFAULT 0,
      tendered_amount NUMERIC(14,2) DEFAULT 0,
      change_amount NUMERIC(14,2) DEFAULT 0,
      store_credit_used NUMERIC(14,2) DEFAULT 0,
      status TEXT DEFAULT 'completed',
      note TEXT DEFAULT '',
      branch_id INTEGER,
      location_id INTEGER,
      created_by INTEGER,
      cancelled_at TIMESTAMPTZ,
      cancelled_by INTEGER,
      cancel_reason TEXT DEFAULT '',
      delivery_rep_id INTEGER,
      delivery_status TEXT,
      collection_status TEXT,
      settled_at TIMESTAMPTZ,
      settled_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      eta_uuid TEXT,
      eta_status TEXT DEFAULT 'none',
      eta_submission_id TEXT,
      is_credit_overridden BOOLEAN DEFAULT false,
      credit_override_by_user_id INTEGER,
      credit_override_reason TEXT,
      terminal_id TEXT,
      terminal_auth_code TEXT,
      terminal_rrn TEXT,
      card_scheme TEXT,
      card_last_four TEXT,
      driver_cash_settled BOOLEAN DEFAULT false,
      sale_origin TEXT DEFAULT 'pos',
      van_trip_id INTEGER,
      delivery_gps_lat NUMERIC(10,7),
      delivery_gps_lng NUMERIC(10,7),
      delivery_proof_photo TEXT,
      packaging_breakdown JSONB
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      qty NUMERIC(14,4) NOT NULL,
      unit_price NUMERIC(14,4) NOT NULL,
      line_total NUMERIC(14,2) NOT NULL,
      unit_name TEXT DEFAULT 'قطعة',
      unit_multiplier NUMERIC(14,4) DEFAULT 1,
      cost_price NUMERIC(14,4) DEFAULT 0,
      net_unit_price NUMERIC(14,4),
      net_line_total NUMERIC(14,2),
      allocated_discount NUMERIC(14,2) DEFAULT 0,
      allocated_tax NUMERIC(14,2) DEFAULT 0,
      price_type TEXT DEFAULT 'wholesale',
      consumer_price NUMERIC(14,4),
      pricing_tier_type TEXT,
      unit_offer_savings NUMERIC(14,4),
      is_bonus BOOLEAN DEFAULT false,
      bonus_reason TEXT,
      notes TEXT DEFAULT '',
      modifiers JSONB,
      serials JSONB
    );
    CREATE TABLE IF NOT EXISTS sale_payments (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      sale_id INTEGER NOT NULL,
      payment_channel TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      applied_amount NUMERIC(14,2),
      tendered_amount NUMERIC(14,2),
      change_amount NUMERIC(14,2),
      terminal_id TEXT,
      card_auth_code TEXT,
      card_rrn TEXT,
      card_scheme TEXT,
      card_last_four TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      action TEXT NOT NULL,
      event_code TEXT,
      details TEXT DEFAULT '',
      target_tenant_id TEXT,
      created_by INTEGER,
      impersonated_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS settings (
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(tenant_id, key)
    );
    CREATE TABLE IF NOT EXISTS accounting_accounts (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT DEFAULT '',
      account_type TEXT NOT NULL,
      parent_id INTEGER,
      account_group TEXT DEFAULT '',
      normal_balance TEXT NOT NULL,
      is_active BOOLEAN DEFAULT true,
      is_system BOOLEAN DEFAULT false,
      allow_manual_entries BOOLEAN DEFAULT true,
      is_control_account BOOLEAN DEFAULT false,
      is_cash_bank BOOLEAN DEFAULT false,
      is_receivable BOOLEAN DEFAULT false,
      is_payable BOOLEAN DEFAULT false,
      is_inventory BOOLEAN DEFAULT false,
      is_tax BOOLEAN DEFAULT false,
      is_monetary BOOLEAN DEFAULT false,
      revaluation_currency TEXT,
      description_ar TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, code)
    );
    CREATE TABLE IF NOT EXISTS accounting_settings (
      id INTEGER DEFAULT 1,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      cash_account_id INTEGER,
      bank_account_id INTEGER,
      customer_receivable_account_id INTEGER,
      supplier_payable_account_id INTEGER,
      inventory_account_id INTEGER,
      sales_revenue_account_id INTEGER,
      sales_discount_account_id INTEGER,
      cogs_account_id INTEGER,
      purchase_account_id INTEGER,
      expenses_account_id INTEGER,
      sales_tax_account_id INTEGER,
      purchase_tax_account_id INTEGER,
      manufacturing_overhead_account_id INTEGER,
      lock_date_all TEXT,
      lock_date_non_adviser TEXT,
      lock_date_tax TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, id)
    );
    CREATE TABLE IF NOT EXISTS journal_entries (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT,
      account_id TEXT,
      entry_no TEXT NOT NULL,
      entry_date TIMESTAMPTZ DEFAULT NOW(),
      description TEXT DEFAULT '',
      source_type TEXT NOT NULL,
      source_id INTEGER,
      status TEXT DEFAULT 'posted',
      branch_id INTEGER,
      location_id INTEGER,
      created_by INTEGER,
      posted_by INTEGER,
      posted_at TIMESTAMPTZ,
      cancelled_by INTEGER,
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT DEFAULT '',
      reversed_by_entry_id INTEGER,
      reversal_of_entry_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS journal_entry_lines (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT,
      journal_entry_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      cost_center_id INTEGER,
      description TEXT DEFAULT '',
      debit NUMERIC(14,2) DEFAULT 0,
      credit NUMERIC(14,2) DEFAULT 0,
      partner_type TEXT DEFAULT 'none',
      partner_id INTEGER,
      branch_id INTEGER,
      location_id INTEGER,
      is_reconciled BOOLEAN DEFAULT false,
      reconciled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS accounting_posting_failures (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      error_message TEXT DEFAULT '',
      attempts INTEGER DEFAULT 1,
      first_failed_at TIMESTAMPTZ DEFAULT NOW(),
      last_attempt_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      UNIQUE(tenant_id, source_type, source_id)
    );
    CREATE TABLE IF NOT EXISTS accounting_fiscal_periods (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      fiscal_year_id INTEGER,
      period_number INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      closed_at TIMESTAMPTZ,
      closed_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS delivery_rep_targets (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      rep_id INTEGER NOT NULL,
      period_month TEXT NOT NULL,
      target_amount NUMERIC(14,2) DEFAULT 0,
      collection_target NUMERIC(14,2),
      visits_target INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, rep_id, period_month)
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      business_name TEXT NOT NULL,
      owner_name TEXT DEFAULT '',
      owner_phone TEXT DEFAULT '',
      owner_email TEXT,
      activity_type TEXT,
      country_code TEXT,
      status TEXT DEFAULT 'active',
      trial_starts_at TIMESTAMPTZ DEFAULT NOW(),
      trial_ends_at TIMESTAMPTZ DEFAULT NOW(),
      activated_at TIMESTAMPTZ,
      plan_id TEXT,
      custom_domain TEXT,
      extra_features JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS treasury_transactions (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      txn_type TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      note TEXT DEFAULT '',
      reference_type TEXT,
      reference_id INTEGER,
      return_document_id INTEGER,
      branch_id INTEGER,
      location_id INTEGER,
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      title TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      cost_center_id INTEGER,
      expense_date TIMESTAMPTZ DEFAULT NOW(),
      note TEXT DEFAULT '',
      branch_id INTEGER,
      location_id INTEGER,
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS product_offers (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      offer_type TEXT NOT NULL,
      value NUMERIC(14,4) DEFAULT 0,
      min_qty NUMERIC(14,4) DEFAULT 1,
      start_date TEXT,
      end_date TEXT,
      bogo_buy_qty NUMERIC(14,4),
      bogo_get_qty NUMERIC(14,4),
      bogo_discount_percent NUMERIC(5,2),
      happy_hour_start TEXT,
      happy_hour_end TEXT,
      days_of_week TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  for (const stmt of ddl
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    await sql.raw(stmt).execute(db);
  }
}

async function cleanup(db: Kysely<Database>): Promise<void> {
  const dbAny = db as any;
  await sql`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${TENANT})`.execute(
    db,
  );
  const tables = [
    'journal_entries',
    'accounting_posting_failures',
    'audit_logs',
    'settlement_allocations',
    'van_rep_financial_settlements',
    'van_field_visits',
    'van_trip_expenses',
    'van_field_returns',
    'customer_payments',
    'customer_ledger',
    'sale_items',
    'sales',
    'van_sales_trips',
    'stock_movements',
    'product_location_stock',
    'customers',
    'products',
    'delivery_representatives',
    'stock_locations',
    'accounting_settings',
    'accounting_accounts',
    'users',
    'branches',
  ];
  for (const table of tables) {
    try {
      await dbAny.deleteFrom(table).where('tenant_id', '=', TENANT).execute();
    } catch {
      // Ignore if optional table doesn't exist
    }
  }
}

async function main(): Promise<void> {
  const useExternalPg = process.env.USE_PG_POOL === '1';
  const db = useExternalPg
    ? new Kysely<Database>({
        dialect: new PostgresDialect({
          pool: new Pool({
            host: process.env.TEST_DB_HOST || process.env.DATABASE_HOST || '127.0.0.1',
            port: Number(process.env.TEST_DB_PORT || process.env.DATABASE_PORT || 5433),
            user: process.env.TEST_DB_USER || process.env.DATABASE_USER || 'postgres',
            password: process.env.TEST_DB_PASSWORD || process.env.DATABASE_PASSWORD || 'postgres',
            database: process.env.TEST_DB_NAME || process.env.DATABASE_NAME || 'zs_dev',
            application_name: 'backend-e2e-van-rogue-and-multirep',
          }),
        }),
      })
    : (() => {
        const rawDb = new Kysely<Database>({ dialect: new PGliteDialect(new PGlite()) });
        let inTx = 0;
        let spCounter = 0;
        Object.defineProperty(rawDb, 'isTransaction', {
          get: () => inTx > 0,
          configurable: true,
        });
        (rawDb as any).transaction = () => ({
          execute: async <T>(cb: (trx: any) => Promise<T>): Promise<T> => {
            const maxAuditBefore = await sql<{ max_id: number }>`SELECT COALESCE(MAX(id), 0) as max_id FROM audit_logs`
              .execute(rawDb)
              .catch(() => ({ rows: [{ max_id: 0 }] }));
            const prevMaxAuditId = Number(maxAuditBefore.rows[0]?.max_id || 0);

            if (inTx === 0) {
              await sql.raw('BEGIN').execute(rawDb);
              inTx++;
              try {
                const res = await cb(rawDb);
                await sql.raw('COMMIT').execute(rawDb);
                return res;
              } catch (err) {
                const newAudits = await sql<any>`SELECT * FROM audit_logs WHERE id > ${prevMaxAuditId} ORDER BY id ASC`
                  .execute(rawDb)
                  .catch(() => ({ rows: [] }));
                await sql
                  .raw('ROLLBACK')
                  .execute(rawDb)
                  .catch(() => {});
                for (const row of newAudits.rows) {
                  await (rawDb as any)
                    .insertInto('audit_logs')
                    .values({
                      tenant_id: row.tenant_id,
                      account_id: row.account_id,
                      action: row.action,
                      event_code: row.event_code,
                      details: row.details,
                      target_tenant_id: row.target_tenant_id,
                      created_by: row.created_by,
                      impersonated_by: row.impersonated_by,
                    })
                    .execute();
                }
                throw err;
              } finally {
                inTx--;
              }
            } else {
              const sp = `sp_${++spCounter}`;
              await sql.raw(`SAVEPOINT ${sp}`).execute(rawDb);
              inTx++;
              try {
                const res = await cb(rawDb);
                await sql.raw(`RELEASE SAVEPOINT ${sp}`).execute(rawDb);
                return res;
              } catch (err) {
                const newAudits = await sql<any>`SELECT * FROM audit_logs WHERE id > ${prevMaxAuditId} ORDER BY id ASC`
                  .execute(rawDb)
                  .catch(() => ({ rows: [] }));
                await sql
                  .raw(`ROLLBACK TO SAVEPOINT ${sp}`)
                  .execute(rawDb)
                  .catch(() => {});
                await sql
                  .raw(`RELEASE SAVEPOINT ${sp}`)
                  .execute(rawDb)
                  .catch(() => {});
                for (const row of newAudits.rows) {
                  await (rawDb as any)
                    .insertInto('audit_logs')
                    .values({
                      tenant_id: row.tenant_id,
                      account_id: row.account_id,
                      action: row.action,
                      event_code: row.event_code,
                      details: row.details,
                      target_tenant_id: row.target_tenant_id,
                      created_by: row.created_by,
                      impersonated_by: row.impersonated_by,
                    })
                    .execute();
                }
                throw err;
              } finally {
                inTx--;
              }
            }
          },
        });
        return rawDb;
      })();
  const dbAny = db as any;

  if (!useExternalPg) {
    await bootstrapPgliteSchema(db);
  }
  await cleanup(db);

  try {
    console.log('1. Setting up branch, warehouse, supervisor, 3 delivery reps, products, and customers...');
    const branch = await dbAny
      .insertInto('branches')
      .values({
        name: `فرع التوزيع الرئيسي ${Date.now()}`,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        is_active: true,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const warehouse = await dbAny
      .insertInto('stock_locations')
      .values({
        name: 'المستودع الرئيسي للجملة',
        branch_id: branch.id,
        location_type: 'internal_warehouse',
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Supervisor User (PIN: 7788)
    const supervisorUser = await dbAny
      .insertInto('users')
      .values({
        username: `sup-van-${Date.now()}`,
        display_name: 'المشرف العام للتوزيع',
        password_hash: 'x',
        password_salt: 'x',
        pin: '7788',
        role: 'admin',
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Rogue Rep User (PIN: 1111)
    const rogueRepUser = await dbAny
      .insertInto('users')
      .values({
        username: `rep1-user-${Date.now()}`,
        phone: '01000000001',
        display_name: 'أحمد المندوب الأول',
        password_hash: 'x',
        password_salt: 'x',
        pin: '1111',
        role: 'cashier',
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Create 3 Delivery Representatives
    const rep1 = await dbAny
      .insertInto('delivery_representatives')
      .values({
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'أحمد - مندوب التوزيع الأول',
        phone: '01000000001',
        user_id: rogueRepUser.id,
        pin_hash: '1111',
        is_van_rep: true,
        rep_type: 'van',
        is_active: true,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const rep2 = await dbAny
      .insertInto('delivery_representatives')
      .values({
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'محمود - مندوب التوزيع الثاني',
        phone: '01000000002',
        is_van_rep: true,
        rep_type: 'van',
        is_active: true,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const rep3 = await dbAny
      .insertInto('delivery_representatives')
      .values({
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'كريم - مندوب التوزيع الثالث',
        phone: '01000000003',
        is_van_rep: true,
        rep_type: 'van',
        is_active: true,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const rep1Id = Number(rep1.id);
    const rep2Id = Number(rep2.id);
    const rep3Id = Number(rep3.id);

    // Create 2 Products:
    // Product A: Wholesale Carton (Cost: 80, Retail: 100)
    const productA = await dbAny
      .insertInto('products')
      .values({
        name: 'كرتونة زيت طعام 12 زجاجة',
        cost_price: 80,
        retail_price: 100,
        stock_qty: 500,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        is_active: true,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Product B: Never sold to shared customer (Cost: 40, Retail: 60)
    const productB = await dbAny
      .insertInto('products')
      .values({
        name: 'كرتونة سمن نباتي فاخرة',
        cost_price: 40,
        retail_price: 60,
        stock_qty: 200,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        is_active: true,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await dbAny
      .insertInto('product_location_stock')
      .values([
        {
          product_id: productA.id,
          location_id: warehouse.id,
          branch_id: branch.id,
          qty: 500,
          tenant_id: TENANT,
          account_id: ACCOUNT,
        },
        {
          product_id: productB.id,
          location_id: warehouse.id,
          branch_id: branch.id,
          qty: 200,
          tenant_id: TENANT,
          account_id: ACCOUNT,
        },
      ])
      .execute();

    // Shared Customer assigned to all 3 reps!
    // Coordinates: Cairo Tahrir Square (30.0444, 31.2357)
    const sharedCustomer = await dbAny
      .insertInto('customers')
      .values({
        name: 'سوبر ماركت الأمانة المشترك',
        phone: '01234567890',
        customer_type: 'credit',
        credit_limit: 20000,
        balance: 0,
        metadata: JSON.stringify({
          assignedRepId: rep1Id,
          assignedRepIds: [rep1Id, rep2Id, rep3Id],
          route: 'خط وسط البلد التجاري',
          locationUrl: 'https://maps.google.com/?q=30.0444,31.2357',
        }),
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Cash-Only Customer (credit_limit = 0)
    const cashOnlyCustomer = await dbAny
      .insertInto('customers')
      .values({
        name: 'بقالة النقدي فقط',
        phone: '01112223334',
        customer_type: 'cash',
        credit_limit: 0,
        balance: 0,
        metadata: JSON.stringify({
          assignedRepId: rep1Id,
          assignedRepIds: [rep1Id],
          route: 'خط وسط البلد التجاري',
        }),
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const sharedCustomerId = Number(sharedCustomer.id);
    const cashOnlyCustomerId = Number(cashOnlyCustomer.id);

    const foundation = new AccountingTenantFoundationService();
    const accountingPosting = new AccountingPostingService(foundation);
    const vanSales = new VanSalesService(db, {} as AuditService, {} as DeliveryRepsService, accountingPosting);
    const managerActions = new ManagerActionsService(db);

    const supervisorAuth: AuthContext = {
      userId: Number(supervisorUser.id),
      sessionId: 'e2e-sup-session',
      username: 'sup-van',
      role: 'admin',
      permissions: ['dashboard', 'deliveryReps', 'sales', 'inventory', 'accounting', 'customers'],
      tenantId: TENANT,
      accountId: ACCOUNT,
    };

    const rogueRepAuth: AuthContext = {
      userId: Number(rogueRepUser.id),
      sessionId: 'e2e-rep1-session',
      username: 'rep1-user',
      role: 'cashier',
      permissions: ['sales'],
      tenantId: TENANT,
      accountId: ACCOUNT,
    };

    // Open trips for all 3 reps
    console.log('2. Opening active distribution trips for Rep 1, Rep 2, and Rep 3...');
    const trip1 = await vanSales.openTripAndLoad(rep1Id, TENANT, ACCOUNT, {
      sourceWarehouseId: Number(warehouse.id),
      startOdometer: 1000,
      items: [
        { productId: Number(productA.id), qty: 50 },
        { productId: Number(productB.id), qty: 10 },
      ],
    });
    const trip2 = await vanSales.openTripAndLoad(rep2Id, TENANT, ACCOUNT, {
      sourceWarehouseId: Number(warehouse.id),
      startOdometer: 2000,
      items: [{ productId: Number(productA.id), qty: 50 }],
    });
    const trip3 = await vanSales.openTripAndLoad(rep3Id, TENANT, ACCOUNT, {
      sourceWarehouseId: Number(warehouse.id),
      startOdometer: 3000,
      items: [{ productId: Number(productA.id), qty: 50 }],
    });

    // =========================================================================
    // PART A: MULTI-REP SHARED CUSTOMER CREDIT SALES & ISOLATED COLLECTIONS
    // =========================================================================
    console.log('3. Executing credit sales by 3 different reps to the SAME shared customer...');
    // Rep 1 sells 15 units @ 100 = 1,500 EGP credit
    const saleRep1 = await vanSales.executeFieldSale(rep1Id, TENANT, ACCOUNT, {
      tripId: trip1.tripId,
      customerId: sharedCustomerId,
      paymentMethod: 'credit',
      items: [{ productId: Number(productA.id), qty: 15, unitPrice: 100 }],
    });
    assert.equal(saleRep1.total, 1500);

    // Rep 2 sells 24 units @ 100 = 2,400 EGP credit
    const saleRep2 = await vanSales.executeFieldSale(rep2Id, TENANT, ACCOUNT, {
      tripId: trip2.tripId,
      customerId: sharedCustomerId,
      paymentMethod: 'credit',
      items: [{ productId: Number(productA.id), qty: 24, unitPrice: 100 }],
    });
    assert.equal(saleRep2.total, 2400);

    // Rep 3 sells 9 units @ 100 = 900 EGP credit
    const saleRep3 = await vanSales.executeFieldSale(rep3Id, TENANT, ACCOUNT, {
      tripId: trip3.tripId,
      customerId: sharedCustomerId,
      paymentMethod: 'credit',
      items: [{ productId: Number(productA.id), qty: 9, unitPrice: 100 }],
    });
    assert.equal(saleRep3.total, 900);

    // Verify each rep sees ONLY their own isolated debt balance on the shared customer!
    const rep1Active = await vanSales.getActiveTrip(rep1Id, TENANT, ACCOUNT);
    const rep2Active = await vanSales.getActiveTrip(rep2Id, TENANT, ACCOUNT);
    const rep3Active = await vanSales.getActiveTrip(rep3Id, TENANT, ACCOUNT);
    const rep1Customers = rep1Active.customers;
    const rep2Customers = rep2Active.customers;
    const rep3Customers = rep3Active.customers;

    const sharedForRep1 = rep1Customers.find((c) => c.id === sharedCustomerId)!;
    const sharedForRep2 = rep2Customers.find((c) => c.id === sharedCustomerId)!;
    const sharedForRep3 = rep3Customers.find((c) => c.id === sharedCustomerId)!;

    assert.equal(sharedForRep1.balance, 1500, 'Rep 1 isolated balance must be 1,500');
    assert.equal(sharedForRep1.otherRepsBalance, 3300, 'Rep 1 sees 3,300 owed to other reps');
    assert.equal(sharedForRep1.totalCompanyBalance, 4800, 'Total company balance is 4,800');

    assert.equal(sharedForRep2.balance, 2400, 'Rep 2 isolated balance must be 2,400');
    assert.equal(sharedForRep2.otherRepsBalance, 2400, 'Rep 2 sees 2,400 owed to other reps');
    assert.equal(sharedForRep2.totalCompanyBalance, 4800, 'Total company balance is 4,800');

    assert.equal(sharedForRep3.balance, 900, 'Rep 3 isolated balance must be 900');
    assert.equal(sharedForRep3.otherRepsBalance, 3900, 'Rep 3 sees 3,900 owed to other reps');
    assert.equal(sharedForRep3.totalCompanyBalance, 4800, 'Total company balance is 4,800');

    console.log('4. Testing cross-rep collection blocking and valid isolated collections across the 3 reps...');
    // Rogue attempt: Rep 3 (owed 900) tries to collect 2,000 EGP (encroaching on Rep 1 & Rep 2's debt!)
    await assert.rejects(
      () =>
        vanSales.recordFieldCollection(rep3Id, TENANT, ACCOUNT, {
          tripId: trip3.tripId,
          customerId: sharedCustomerId,
          amount: 2000,
        }),
      (err: any) => err.code === 'REP_ISOLATED_BALANCE_EXCEEDED',
      'Rep 3 must be blocked from collecting more than his 900 EGP isolated balance',
    );

    // Valid partial collection by Rep 1: collects 500 of 1,500 -> remaining 1,000
    const col1 = await vanSales.recordFieldCollection(rep1Id, TENANT, ACCOUNT, {
      tripId: trip1.tripId,
      customerId: sharedCustomerId,
      amount: 500,
    });
    assert.equal(col1.previousBalance, 1500);
    assert.equal(col1.newBalance, 1000);

    // Valid partial collection by Rep 2: collects 1,400 of 2,400 -> remaining 1,000
    const col2 = await vanSales.recordFieldCollection(rep2Id, TENANT, ACCOUNT, {
      tripId: trip2.tripId,
      customerId: sharedCustomerId,
      amount: 1400,
    });
    assert.equal(col2.previousBalance, 2400);
    assert.equal(col2.newBalance, 1000);

    // Valid full collection by Rep 3: collects all 900 of 900 -> remaining 0
    const col3 = await vanSales.recordFieldCollection(rep3Id, TENANT, ACCOUNT, {
      tripId: trip3.tripId,
      customerId: sharedCustomerId,
      amount: 900,
    });
    assert.equal(col3.previousBalance, 900);
    assert.equal(col3.newBalance, 0);

    // Now Rep 3 has 0 balance while customer still owes 2,000 (1,000 to Rep 1 + 1,000 to Rep 2).
    // Rep 3 tries to collect another 100 EGP -> must be blocked!
    await assert.rejects(
      () =>
        vanSales.recordFieldCollection(rep3Id, TENANT, ACCOUNT, {
          tripId: trip3.tripId,
          customerId: sharedCustomerId,
          amount: 100,
        }),
      (err: any) => err.code === 'REP_ISOLATED_BALANCE_EXCEEDED',
      'Rep 3 with 0 balance must be blocked from collecting other reps remaining 2,000 EGP',
    );

    // Verify Supervisor Dashboard sees the exact 3-rep breakdown!
    const supRoutes = await vanSales.getSupervisorCustomerRoutes(TENANT);
    const customerList = Array.isArray(supRoutes) ? supRoutes : (supRoutes as any).customers || [];
    const supSharedCust = customerList.find((c: any) => Number(c.customerId || c.id) === sharedCustomerId);
    assert.ok(supSharedCust, 'Supervisor route dashboard must include the shared customer');
    assert.equal(
      Number(supSharedCust.balance ?? supSharedCust.totalCompanyBalance),
      2000,
      'Supervisor sees total remaining company balance = 2,000',
    );
    assert.ok(Array.isArray(supSharedCust.repBalances), 'Supervisor sees repBalances breakdown array');
    const supRep1Bal = supSharedCust.repBalances.find((rb: any) => Number(rb.repId) === rep1Id);
    const supRep2Bal = supSharedCust.repBalances.find((rb: any) => Number(rb.repId) === rep2Id);
    assert.equal(supRep1Bal?.balance, 1000, 'Supervisor sees Rep 1 owed 1,000');
    assert.equal(supRep2Bal?.balance, 1000, 'Supervisor sees Rep 2 owed 1,000');

    // =========================================================================
    // PART B: ROGUE REP / THIEF REP SABOTAGE & THEFT ATTEMPTS
    // =========================================================================
    console.log('5. Running adversarial rogue-rep theft & manipulation attempts...');

    // 5.1 Price manipulation: selling below cost (50 EGP when cost is 80 and retail is 100) without supervisor PIN
    await assert.rejects(
      () =>
        vanSales.executeFieldSale(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          customerId: sharedCustomerId,
          paymentMethod: 'cash',
          items: [{ productId: Number(productA.id), qty: 2, unitPrice: 50 }],
        }),
      (err: any) => err.code === 'PRICE_DISCOUNT_REQUIRES_SUPERVISOR_PIN',
      'Selling below cost without supervisor PIN must be blocked',
    );

    // 5.2 Unauthorized Free Bonus (unitPrice = 0) without supervisor PIN
    await assert.rejects(
      () =>
        vanSales.executeFieldSale(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          customerId: sharedCustomerId,
          paymentMethod: 'cash',
          items: [{ productId: Number(productA.id), qty: 2, unitPrice: 0 }],
        }),
      (err: any) => err.code === 'BONUS_REQUIRES_SUPERVISOR_PIN',
      'Granting free bonus without supervisor PIN must be blocked',
    );

    // 5.3 Self-Approval: Rogue rep enters HIS OWN PIN (1111) as supervisorOverridePin
    await assert.rejects(
      () =>
        vanSales.executeFieldSale(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          customerId: sharedCustomerId,
          paymentMethod: 'cash',
          supervisorOverridePin: '1111',
          items: [{ productId: Number(productA.id), qty: 2, unitPrice: 0 }],
        }),
      (err: any) => err.code === 'MAKER_CHECKER_SELF_APPROVAL',
      'Rep using his own PIN for supervisor override must be blocked',
    );

    // 5.4 Brute-forcing / Invalid Supervisor PIN (9999)
    await assert.rejects(
      () =>
        vanSales.executeFieldSale(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          customerId: sharedCustomerId,
          paymentMethod: 'cash',
          supervisorOverridePin: '9999',
          items: [{ productId: Number(productA.id), qty: 2, unitPrice: 0 }],
        }),
      (err: any) => err.code === 'INVALID_SUPERVISOR_PIN',
      'Invalid supervisor PIN must be blocked',
    );

    // 5.5 Fake Card / Network Payment without reference number
    await assert.rejects(
      () =>
        vanSales.executeFieldSale(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          customerId: sharedCustomerId,
          paymentMethod: 'card',
          items: [{ productId: Number(productA.id), qty: 1, unitPrice: 100 }],
        }),
      (err: any) => err.code === 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
      'Card payment without terminal/transfer reference must be blocked',
    );

    // 5.6 Credit Sale to Cash-Only Customer (credit_limit = 0) without supervisor PIN
    await assert.rejects(
      () =>
        vanSales.executeFieldSale(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          customerId: cashOnlyCustomerId,
          paymentMethod: 'credit',
          items: [{ productId: Number(productA.id), qty: 1, unitPrice: 100 }],
        }),
      (err: any) => err.code === 'CASH_ONLY_CUSTOMER',
      'Credit sale to cash-only customer must be blocked',
    );

    // 5.7 Unlinked Fraudulent Return (omitting saleId) for Product B which was NEVER sold to the customer
    await assert.rejects(
      () =>
        vanSales.submitFieldReturn(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          customerId: sharedCustomerId,
          saleId: null,
          returnReason: 'damaged',
          items: [{ productId: Number(productB.id), qty: 1, unitPrice: 60 }],
        }),
      (err: any) => err.code === 'RETURN_QTY_EXCEEDS_SOLD',
      'Unlinked return of a product never sold to customer must be blocked',
    );

    // 5.8 Unlinked Fraudulent Return (omitting saleId) with inflated unitPrice (250 EGP instead of 100 EGP)
    await assert.rejects(
      () =>
        vanSales.submitFieldReturn(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          customerId: sharedCustomerId,
          saleId: null,
          returnReason: 'damaged',
          items: [{ productId: Number(productA.id), qty: 2, unitPrice: 250 }],
        }),
      (err: any) => err.code === 'RETURN_PRICE_EXCEEDS_NET',
      'Unlinked return with unit price higher than historical sale price must be blocked',
    );

    // 5.9 Cash Refund Return exceeding rep's collected cash in trip1 (trip1 currently has 500 EGP cash_collected)
    await assert.rejects(
      () =>
        vanSales.submitFieldReturn(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          customerId: sharedCustomerId,
          saleId: saleRep1.saleId,
          returnReason: 'customer_request',
          refundMethod: 'cash',
          items: [{ productId: Number(productA.id), qty: 10, unitPrice: 100 }], // 1,000 EGP > 500 EGP collected
        }),
      (err: any) => err.code === 'INSUFFICIENT_REP_CASH_FOR_REFUND',
      'Cash refund return exceeding trip cash_collected must be blocked',
    );

    // 5.10 Valid Cash Sale + Valid Cash Refund Return -> Verify GL Sub-ledger Invariance (1130 partner_type='none')
    const cashSale = await vanSales.executeFieldSale(rep1Id, TENANT, ACCOUNT, {
      tripId: trip1.tripId,
      customerId: sharedCustomerId,
      paymentMethod: 'cash',
      items: [{ productId: Number(productA.id), qty: 5, unitPrice: 100 }], // 500 EGP cash sale
    });
    assert.equal(cashSale.total, 500);

    const cashReturnSub = await vanSales.submitFieldReturn(rep1Id, TENANT, ACCOUNT, {
      tripId: trip1.tripId,
      customerId: sharedCustomerId,
      saleId: cashSale.saleId,
      returnReason: 'customer_request',
      refundMethod: 'cash',
      items: [{ productId: Number(productA.id), qty: 1, unitPrice: 100 }], // 100 EGP cash refund
    });
    await vanSales.approveFieldReturn(TENANT, ACCOUNT, cashReturnSub.returnId, Number(supervisorUser.id));

    // Verify customer's credit balance was NOT altered by the cash sale or cash return!
    const custAfterCashReturn = await dbAny
      .selectFrom('customers')
      .select(['balance'])
      .where('id', '=', sharedCustomerId)
      .executeTakeFirstOrThrow();
    assert.equal(
      Number(custAfterCashReturn.balance),
      2000,
      'Customer balance must remain 2,000 after cash sale & cash return',
    );

    // 5.11 Fake Road Expense Abuse (300 EGP fuel expense > 150 EGP single-expense cap without supervisor PIN)
    await assert.rejects(
      () =>
        vanSales.recordTripExpense(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          expenseType: 'fuel',
          amount: 300,
          notes: 'بنزين مبالغ فيه بدون إيصال',
        }),
      (err: any) => err.code === 'EXPENSE_REQUIRES_SUPERVISOR_PIN',
      'Expense exceeding single-item ceiling without supervisor PIN must be blocked',
    );

    // 5.12 Odometer Rollback (startOdometer = 1000, rep submits endOdometer = 920)
    await assert.rejects(
      () =>
        vanSales.submitTripSettlement(rep1Id, TENANT, ACCOUNT, {
          tripId: trip1.tripId,
          countedCash: 900,
          endOdometer: 920,
          unloadRemainingToWarehouse: true,
        }),
      (err: any) => err.code === 'INVALID_ODOMETER',
      'Odometer rollback must be rejected',
    );

    // 5.13 Fake GPS Visit Outside Geofence (Customer at 30.0444, 31.2357; Rep logs visit 6km away at 30.0950, 31.2800)
    const ghostVisit = await vanSales.recordFieldVisit(rep1Id, TENANT, ACCOUNT, {
      tripId: trip1.tripId,
      customerId: sharedCustomerId,
      visitType: 'negative',
      negativeReason: 'shop_closed',
      gpsLat: 30.095,
      gpsLng: 31.28,
      notes: 'المحل مغلق',
    });
    assert.equal(ghostVisit.isWithinGeofence, false, 'Visit 6km away must be flagged as outside geofence');

    // 5.14 Maker-Checker Self-Settlement Violation (Rep 1 tries to call settleTrip using his own user account)
    await assert.rejects(
      () =>
        vanSales.settleTrip(
          rep1Id,
          TENANT,
          ACCOUNT,
          {
            tripId: trip1.tripId,
            countedCash: 900,
            unloadRemainingToWarehouse: true,
            endOdometer: 1050,
          },
          rogueRepAuth,
        ),
      (err: any) =>
        err.code === 'MAKER_CHECKER_SELF_APPROVAL' || err.code === 'MAKER_CHECKER_SELF_SETTLEMENT_FORBIDDEN',
      'Rep settling his own trip must be blocked by Maker-Checker',
    );

    // 5.15 Supervisor settles Trip 1 with a Cash Shortage (expectedCash = 500 col + 500 cashSale - 100 cashReturn = 900; countedCash = 750 -> 150 shortage)
    // and Stock Shortage (Product B had 10 loaded, 0 sold, supervisor counts 8 -> 2 units missing @ 40 cost = 80 EGP shortage)
    const settlement = await vanSales.settleTrip(
      rep1Id,
      TENANT,
      ACCOUNT,
      {
        tripId: trip1.tripId,
        countedCash: 750,
        unloadRemainingToWarehouse: true,
        countedStock: [
          { productId: Number(productA.id), countedQty: 31 }, // 50 loaded - 15 credit - 5 cash + 1 return = 31 (exact)
          { productId: Number(productB.id), countedQty: 8 }, // 10 loaded -> 8 counted (2 missing!)
        ],
        chargeStockVarianceToRep: true,
        endOdometer: 1065,
      },
      supervisorAuth,
    );
    assert.equal(settlement.expectedCash, 900);
    assert.equal(settlement.variance, -150, 'Cash shortage of 150 EGP detected');
    assert.equal(settlement.stockVarianceAmount, 80, 'Stock shortage of 80 EGP (2 units * 40 cost) detected');

    // =========================================================================
    // PART C: VERIFY SUPERVISOR FRAUD RADAR & OWNER NOTIFICATION BELL
    // =========================================================================
    console.log('6. Verifying Supervisor Fraud Radar summary, events, and Owner Notification Bell...');
    const radarSummary = await vanSales.getFraudRadarSummary(TENANT, { days: 30 });
    assert.ok(
      radarSummary.kpis.totalSuspicionEvents >= 13,
      `Expected at least 13 suspicion events recorded, got ${radarSummary.kpis.totalSuspicionEvents}`,
    );
    assert.ok(radarSummary.kpis.highRiskRepsCount >= 1, 'At least 1 rep (Rep 1) must be classified as high_risk');
    assert.ok(radarSummary.kpis.blockedTamperAttemptsCount >= 11, 'Blocked tamper attempts count must be >= 11');
    assert.equal(radarSummary.kpis.settlementShortageEventsCount, 1, '1 settlement shortage event must be recorded');

    const rep1Profile = radarSummary.repProfiles.find((p) => p.repId === rep1Id)!;
    assert.ok(rep1Profile, 'Rep 1 profile must be present in radar');
    assert.equal(rep1Profile.riskLevel, 'high_risk', 'Rep 1 must be flagged as high_risk');
    assert.equal(rep1Profile.priceManipulationCount, 1);
    assert.equal(rep1Profile.unauthorizedBonusCount, 1);
    assert.equal(rep1Profile.selfApprovalCount, 1);
    assert.equal(rep1Profile.invalidPinCount, 1);
    assert.equal(rep1Profile.fakeCardCount, 1);
    assert.equal(rep1Profile.creditBypassCount, 1);
    assert.equal(rep1Profile.fraudulentReturnCount, 3);
    assert.equal(rep1Profile.expenseAbuseCount, 1);
    assert.equal(rep1Profile.odometerRollbackCount, 1);
    assert.equal(rep1Profile.geofenceViolationCount, 1);
    assert.equal(rep1Profile.unauthorizedLoadOrSettleCount, 1);
    assert.equal(rep1Profile.settlementShortageCount, 1);

    const rep3Profile = radarSummary.repProfiles.find((p) => p.repId === rep3Id)!;
    assert.ok(rep3Profile, 'Rep 3 profile must be present in radar');
    assert.equal(rep3Profile.crossRepCollectionCount, 2, 'Rep 3 must have 2 cross-rep collection attempts recorded');

    // Verify Owner/Supervisor Top-Bar Notification Bell (ManagerActionsService)
    const bellNotifications = await managerActions.list(25, supervisorAuth);
    const vanSuspicionInsights = bellNotifications.insights.filter((i) => i.domain === 'van_suspicion');
    assert.ok(
      vanSuspicionInsights.length > 0,
      'Owner Notification Bell (ManagerActionsService) must surface van_suspicion alerts',
    );
    assert.equal(
      vanSuspicionInsights[0].actionHref,
      '/van-sales/management?tab=radar',
      'Clicking a van suspicion notification must navigate to /van-sales/management?tab=radar',
    );

    console.log('ALL VAN SALES ROGUE-REP, MULTI-REP SHARED CUSTOMER, AND FRAUD RADAR E2E TESTS PASSED!');
  } finally {
    await cleanup(db);
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});
