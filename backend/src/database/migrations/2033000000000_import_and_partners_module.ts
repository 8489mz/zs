import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // 1. Partners Table
    await db.schema
      .createTable('import_partners')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('role', 'varchar(100)')
      .addColumn('profit_share_percentage', 'numeric(5, 2)', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
      .execute();

    // 2. Exchange Rates
    await db.schema
      .createTable('import_exchange_rates')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('date', 'date', (col) => col.notNull().defaultTo(sql`CURRENT_DATE`))
      .addColumn('rate_usd_to_egp', 'numeric(10, 4)', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
      .addUniqueConstraint('uq_import_exchange_rates_tenant_date', ['tenant_id', 'date'])
      .execute();

    // 3. Shipments
    await db.schema
      .createTable('import_shipments')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('container_number', 'varchar(100)', (col) => col.notNull())
      .addColumn('arrival_date', 'date')
      .addColumn('shipping_cost_usd', 'numeric(12, 2)', (col) => col.defaultTo('0'))
      .addColumn('customs_cost_egp', 'numeric(12, 2)', (col) => col.defaultTo('0'))
      .addColumn('internal_transport_cost_egp', 'numeric(12, 2)', (col) => col.defaultTo('0'))
      .addColumn('exchange_rate_at_arrival', 'numeric(10, 4)', (col) => col.defaultTo('1'))
      .addColumn('status', 'varchar(50)', (col) => col.defaultTo('Pending'))
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
      .addUniqueConstraint('uq_import_shipments_tenant_container', ['tenant_id', 'container_number'])
      .execute();

    // 4. Supplier Credit
    await db.schema
      .createTable('import_supplier_credit')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('factory_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('total_debt_usd', 'numeric(15, 2)', (col) => col.defaultTo('0'))
      .addColumn('last_updated', 'timestamptz', (col) => col.defaultTo(sql`now()`))
      .addUniqueConstraint('uq_import_supplier_credit_tenant_factory', ['tenant_id', 'factory_name'])
      .execute();

    // 5. Payment Transactions
    await db.schema
      .createTable('import_payment_transactions')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('factory_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('amount_usd', 'numeric(15, 2)', (col) => col.notNull())
      .addColumn('exchange_rate', 'numeric(10, 4)', (col) => col.notNull())
      .addColumn('amount_egp', 'numeric(15, 2)')
      .addColumn('payment_date', 'date', (col) => col.notNull())
      .addColumn('reference_number', 'varchar(100)')
      .addColumn('payment_method', 'varchar(50)')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
      .execute();

    // 6. Shipment Items
    await db.schema
      .createTable('import_shipment_items')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('shipment_id', 'uuid', (col) => col.notNull().references('import_shipments.id').onDelete('cascade'))
      .addColumn('product_id', 'bigint', (col) => col.notNull().references('products.id').onDelete('restrict'))
      .addColumn('quantity', 'integer', (col) => col.notNull())
      .addColumn('factory_unit_price_usd', 'numeric(10, 2)', (col) => col.notNull())
      .addColumn('allocated_overhead_egp', 'numeric(10, 2)', (col) => col.defaultTo('0'))
      .addColumn('landed_cost_egp', 'numeric(10, 2)', (col) => col.defaultTo('0'))
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
      .execute();

    // 7. Sales and Profit Table
    await db.schema
      .createTable('import_sales_and_profit')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('product_id', 'bigint', (col) => col.notNull().references('products.id').onDelete('restrict'))
      .addColumn('shipment_item_id', 'uuid', (col) =>
        col.notNull().references('import_shipment_items.id').onDelete('restrict'),
      )
      .addColumn('quantity_sold', 'integer', (col) => col.notNull())
      .addColumn('unit_sale_price_egp', 'numeric(12, 2)', (col) => col.notNull())
      .addColumn('total_sale_egp', 'numeric(12, 2)', (col) => col.notNull())
      .addColumn('total_cost_egp', 'numeric(12, 2)', (col) => col.notNull())
      .addColumn('net_profit_egp', 'numeric(12, 2)', (col) => col.notNull())
      .addColumn('debt_deduction_egp', 'numeric(12, 2)', (col) => col.notNull())
      .addColumn('sale_date', 'timestamptz', (col) => col.defaultTo(sql`now()`))
      .execute();

    // 8. Sale Partner Shares
    await db.schema
      .createTable('import_sale_partner_shares')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('sale_id', 'uuid', (col) => col.notNull().references('import_sales_and_profit.id').onDelete('cascade'))
      .addColumn('partner_id', 'uuid', (col) => col.notNull().references('import_partners.id').onDelete('restrict'))
      .addColumn('share_amount_egp', 'numeric(12, 2)', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.dropTable('import_sale_partner_shares').execute();
    await db.schema.dropTable('import_sales_and_profit').execute();
    await db.schema.dropTable('import_shipment_items').execute();
    await db.schema.dropTable('import_payment_transactions').execute();
    await db.schema.dropTable('import_supplier_credit').execute();
    await db.schema.dropTable('import_shipments').execute();
    await db.schema.dropTable('import_exchange_rates').execute();
    await db.schema.dropTable('import_partners').execute();
  },
};
