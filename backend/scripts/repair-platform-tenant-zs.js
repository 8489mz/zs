require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

async function repair() {
  const pool = new Pool({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME || 'zsystems_db',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    ssl: String(process.env.DATABASE_SSL || 'false') === 'true' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();

  try {
    console.log('[1/5] Starting transaction to purify platform tenant "zs"...');
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");

    // List of tables containing commercial/operational data to clean for tenant_id = 'zs'
    const commercialTables = [
      'held_sale_items',
      'held_sales',
      'settlement_allocations',
      'van_rep_financial_settlements',
      'sale_items',
      'sale_line_stock_allocations',
      'sale_payments',
      'sales_order_items',
      'sales_orders',
      'sales',
      'customer_payments',
      'customer_ledger',
      'customer_loyalty_logs',
      'customers',
      'purchase_items',
      'purchases',
      'supplier_ledger',
      'supplier_payment_schedule_logs',
      'supplier_payment_schedules',
      'supplier_payments',
      'suppliers',
      'return_items',
      'return_documents',
      'damaged_stock_records',
      'stock_count_items',
      'stock_count_sessions',
      'stock_transfer_items',
      'stock_transfers',
      'stock_movements',
      'product_location_stock',
      'product_pricing_profiles',
      'pricing_rules',
      'product_customer_prices',
      'product_offers',
      'product_units',
      'product_categories',
      'products',
      'product_serials',
      'online_orders',
      'quotation_items',
      'quotations',
      'expenses',
      'price_change_items',
      'price_change_runs',
      'cashier_shifts',
      'treasury_transactions',
      'journal_entry_lines',
      'journal_entries',
      'cost_centers',
      'accounting_accounts',
      'accounting_settings',
      'branches',
      'stock_locations',
      'user_branches',
      'maritime_containers',
      'maritime_inland_trucking_trips',
      'maritime_inquiries',
      'maritime_job_milestones',
      'maritime_jobs',
      'maritime_quotation_charges',
      'maritime_quotations',
      'maritime_rfq_bids',
      'maritime_rfqs',
      'shipping_lines',
      'shipping_ports',
      'van_field_visits',
      'van_load_requisitions',
      'van_rep_financial_settlements',
      'van_sales_trips',
      'delivery_representatives',
      'restaurant_stamp_cards',
      'restaurant_table_layouts',
      'storefront_abandoned_carts',
      'storefront_media',
      'pos_audit_events',
      'operation_executions',
      'settings',
    ];

    console.log('[2/5] Purging commercial store rows tied to tenant_id = "zs"...');
    for (const table of commercialTables) {
      try {
        const res = await client.query(`DELETE FROM "${table}" WHERE tenant_id = 'zs'`);
        if (res.rowCount > 0) {
          console.log(`  - Cleared ${res.rowCount} rows from ${table}`);
        }
      } catch (err) {
        // Table might not exist in some versions, ignore safely
      }
    }

    // Clean user sessions and any rogue users under 'zs' except user 'zs'
    console.log('[3/5] Cleaning sessions and rogue users under tenant "zs"...');
    await client.query("DELETE FROM sessions WHERE tenant_id = 'zs'");
    await client.query("DELETE FROM users WHERE tenant_id = 'zs' AND LOWER(TRIM(username)) != 'zs'");

    // Ensure platform root tenant 'zs' exists and is properly configured
    console.log('[4/5] Re-establishing platform tenant "zs" in tenants table...');
    const superAdminPerms = JSON.stringify([
      'dashboard',
      'products',
      'sales',
      'purchases',
      'inventory',
      'suppliers',
      'customers',
      'accounts',
      'accounting',
      'returns',
      'reports',
      'audit',
      'treasury',
      'services',
      'hr',
      'hrEmployees',
      'hrAttendance',
      'hrContracts',
      'hrLoans',
      'hrPayrollView',
      'hrPayrollManage',
      'hrPayrollApprove',
      'hrSalaryView',
      'hrSalaryManage',
      'settings',
      'pricingCenterView',
      'pricingCenterManage',
      'canEditUsers',
      'canManageUsers',
      'canManageSettings',
      'canManageBackups',
      'canPrint',
      'canDiscount',
      'canEditPrice',
      'canSellWholesale',
      'canViewProfit',
      'canDelete',
      'canEditInvoices',
      'canDirectReturn',
      'canAdjustInventory',
      'canManageBranchStock',
      'cashDrawer',
      'deliveryReps',
    ]);

    await client.query(`
      INSERT INTO tenants (
        id, slug, business_name, owner_name, owner_phone, owner_email,
        activity_type, status, trial_starts_at, trial_ends_at, activated_at,
        created_at, updated_at, plan_id, extra_features, country_code
      ) VALUES (
        'zs', 'zs', 'منصة Z-Systems المركزية', 'محمود زكريا', '0000000000', 'admin@zsystems.io',
        'retail_general', 'active', NOW(), NOW() + INTERVAL '100 years', NOW(),
        NOW(), NOW(), 'plan_omnichannel', '[]'::jsonb, 'EG'
      )
      ON CONFLICT (id) DO UPDATE SET
        slug = 'zs',
        business_name = 'منصة Z-Systems المركزية',
        owner_name = 'محمود زكريا',
        owner_email = 'admin@zsystems.io',
        status = 'active',
        trial_ends_at = NOW() + INTERVAL '100 years',
        updated_at = NOW();
    `);

    // Ensure perpetual subscription for 'zs'
    const existingSub = await client.query("SELECT id FROM tenant_subscriptions WHERE tenant_id = 'zs' LIMIT 1");
    if (existingSub.rows.length > 0) {
      await client.query(`
        UPDATE tenant_subscriptions
        SET status = 'active', ends_at = NOW() + INTERVAL '100 years', grace_ends_at = NOW() + INTERVAL '100 years', updated_at = NOW()
        WHERE tenant_id = 'zs';
      `);
    } else {
      await client.query(`
        INSERT INTO tenant_subscriptions (
          tenant_id, plan_id, status, starts_at, ends_at, grace_ends_at, auto_renew, created_at, updated_at
        ) VALUES (
          'zs', (SELECT id FROM saas_plans ORDER BY id LIMIT 1), 'active', NOW(), NOW() + INTERVAL '100 years', NOW() + INTERVAL '100 years', true, NOW(), NOW()
        );
      `);
    }

    // Ensure user 'zs' has super_admin role and clean isolation
    console.log('[5/5] Re-establishing super_admin user "zs"...');
    await client.query(
      `
      UPDATE users
      SET tenant_id = 'zs',
          account_id = 'zs',
          role = 'super_admin',
          is_active = true,
          display_name = 'محمود زكريا',
          permissions_json = $1::json,
          default_branch_id = NULL,
          failed_login_count = 0,
          locked_until = NULL
      WHERE LOWER(TRIM(username)) = 'zs'
    `,
      [superAdminPerms],
    );

    // Insert platform company name in settings
    await client.query("DELETE FROM settings WHERE tenant_id = 'zs'");
    await client.query(`
      INSERT INTO settings (tenant_id, account_id, key, value)
      VALUES ('zs', 'zs', 'companyName', '"منصة Z-Systems المركزية"')
    `);

    await client.query("SET LOCAL session_replication_role = 'origin'");
    await client.query('COMMIT');
    console.log(
      '\n[SUCCESS] Platform tenant "zs" has been completely purified and restored to clean Super Admin state!',
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n[FATAL] Error repairing platform tenant:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

repair().catch((e) => {
  console.error(e);
  process.exit(1);
});
