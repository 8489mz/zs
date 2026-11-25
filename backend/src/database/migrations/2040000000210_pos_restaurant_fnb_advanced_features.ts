import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. Upgrade pos_modifier_options with raw ingredient link and consumption qty
    await sql`
      ALTER TABLE pos_modifier_options
      ADD COLUMN IF NOT EXISTS component_product_id bigint,
      ADD COLUMN IF NOT EXISTS consumption_qty numeric(14, 3) DEFAULT 1,
      ADD COLUMN IF NOT EXISTS unit_name varchar(50) DEFAULT 'قطعة';
    `.execute(db);

    // 2. Add foreign key on component_product_id (NOT VALID for safety)
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_pos_mod_option_component'
        ) THEN
          ALTER TABLE pos_modifier_options
          ADD CONSTRAINT fk_pos_mod_option_component
          FOREIGN KEY (component_product_id)
          REFERENCES products(id)
          ON DELETE SET NULL
          NOT VALID;
        END IF;
      END $$;
    `.execute(db);

    // 3. Create pos_delivery_aggregators table (Jahez, Hungerstation, Talabat, Keeta, Deliveroo, etc.)
    await db.schema
      .createTable('pos_delivery_aggregators')
      .ifNotExists()
      .addColumn('id', 'bigserial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(128)', (col) => col.notNull())
      .addColumn('account_id', 'varchar(160)', (col) => col.notNull())
      .addColumn('code', 'varchar(50)', (col) => col.notNull()) // 'jahez', 'hungerstation', 'talabat', 'keeta', 'deliveroo', 'careem', 'toyou'
      .addColumn('name', 'varchar(100)', (col) => col.notNull())
      .addColumn('name_en', 'varchar(100)')
      .addColumn('commission_rate', 'numeric(5, 2)', (col) => col.defaultTo(0).notNull())
      .addColumn('is_active', 'boolean', (col) => col.defaultTo(true).notNull())
      .addColumn('auto_accept_orders', 'boolean', (col) => col.defaultTo(true).notNull())
      .addColumn('api_key', 'text')
      .addColumn('webhook_secret', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    await db.schema
      .createIndex('idx_pos_deliv_agg_tenant_code')
      .ifNotExists()
      .on('pos_delivery_aggregators')
      .columns(['tenant_id', 'code'])
      .execute();

    // 4. Create pos_aggregator_orders table (Live incoming delivery orders)
    await db.schema
      .createTable('pos_aggregator_orders')
      .ifNotExists()
      .addColumn('id', 'bigserial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(128)', (col) => col.notNull())
      .addColumn('account_id', 'varchar(160)', (col) => col.notNull())
      .addColumn('aggregator_id', 'bigint', (col) => col.notNull())
      .addColumn('external_order_id', 'varchar(100)', (col) => col.notNull())
      .addColumn('display_number', 'varchar(50)')
      .addColumn('branch_id', 'bigint')
      .addColumn('status', 'varchar(50)', (col) => col.defaultTo('received').notNull()) // 'received', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled'
      .addColumn('customer_name', 'varchar(255)')
      .addColumn('customer_phone', 'varchar(50)')
      .addColumn('delivery_address', 'text')
      .addColumn('rider_name', 'varchar(100)')
      .addColumn('rider_phone', 'varchar(50)')
      .addColumn('subtotal', 'numeric(14, 2)', (col) => col.defaultTo(0).notNull())
      .addColumn('delivery_fee', 'numeric(14, 2)', (col) => col.defaultTo(0).notNull())
      .addColumn('aggregator_commission', 'numeric(14, 2)', (col) => col.defaultTo(0).notNull())
      .addColumn('net_payout', 'numeric(14, 2)', (col) => col.defaultTo(0).notNull())
      .addColumn('order_payload', 'jsonb', (col) => col.defaultTo('{}').notNull())
      .addColumn('sale_id', 'bigint')
      .addColumn('kds_ticket_id', 'bigint')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    await db.schema
      .createIndex('idx_pos_agg_orders_tenant_status')
      .ifNotExists()
      .on('pos_aggregator_orders')
      .columns(['tenant_id', 'status', 'created_at'])
      .execute();

    await db.schema
      .createIndex('idx_pos_agg_orders_tenant_ext_id')
      .ifNotExists()
      .on('pos_aggregator_orders')
      .columns(['tenant_id', 'aggregator_id', 'external_order_id'])
      .execute();

    // 5. Add dining course and aggregator metadata to sales table if not exists
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'sales' AND column_name = 'dining_course'
        ) THEN
          ALTER TABLE sales ADD COLUMN dining_course varchar(50) DEFAULT 'main';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'sales' AND column_name = 'aggregator_channel'
        ) THEN
          ALTER TABLE sales ADD COLUMN aggregator_channel varchar(50);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'sales' AND column_name = 'aggregator_order_id'
        ) THEN
          ALTER TABLE sales ADD COLUMN aggregator_order_id varchar(100);
        END IF;
      END $$;
    `.execute(db);

    // 6. Create restaurant_food_waste_logs table
    await db.schema
      .createTable('restaurant_food_waste_logs')
      .ifNotExists()
      .addColumn('id', 'bigserial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(128)', (col) => col.notNull())
      .addColumn('account_id', 'varchar(160)', (col) => col.notNull())
      .addColumn('branch_id', 'bigint', (col) => col.notNull())
      .addColumn('product_id', 'bigint', (col) => col.notNull())
      .addColumn('quantity', 'numeric(14, 3)', (col) => col.notNull())
      .addColumn('cost_price', 'numeric(14, 2)', (col) => col.defaultTo(0).notNull())
      .addColumn('total_cost', 'numeric(14, 2)', (col) => col.defaultTo(0).notNull())
      .addColumn('reason', 'varchar(100)', (col) => col.notNull()) // 'spoilage', 'prep_error', 'expired', 'customer_complaint', 'other'
      .addColumn('notes', 'text')
      .addColumn('logged_by', 'bigint')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    await db.schema
      .createIndex('idx_fnb_waste_tenant_branch')
      .ifNotExists()
      .on('restaurant_food_waste_logs')
      .columns(['tenant_id', 'branch_id', 'created_at'])
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('restaurant_food_waste_logs').ifExists().execute();
    await db.schema.dropTable('pos_aggregator_orders').ifExists().execute();
    await db.schema.dropTable('pos_delivery_aggregators').ifExists().execute();
    await db.schema
      .alterTable('pos_modifier_options')
      .dropColumn('component_product_id')
      .dropColumn('consumption_qty')
      .dropColumn('unit_name')
      .execute();
  },
};
