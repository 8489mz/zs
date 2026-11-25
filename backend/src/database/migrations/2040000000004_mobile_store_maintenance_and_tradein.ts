import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // 1. Create maintenance_tickets table
    await db.schema
      .createTable('maintenance_tickets')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'text', (col) => col.notNull())
      .addColumn('account_id', 'text', (col) => col.notNull())
      .addColumn('ticket_no', 'varchar(60)', (col) => col.notNull())
      .addColumn('customer_id', 'integer')
      .addColumn('customer_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('customer_phone', 'varchar(50)', (col) => col.notNull())
      .addColumn('device_brand', 'varchar(100)')
      .addColumn('device_model', 'varchar(150)', (col) => col.notNull())
      .addColumn('serial_number', 'varchar(120)')
      .addColumn('passcode', 'varchar(100)')
      .addColumn('problem_description', 'text', (col) => col.notNull())
      .addColumn('device_condition', 'text')
      .addColumn('expected_cost', 'numeric(14, 3)', (col) => col.defaultTo('0').notNull())
      .addColumn('final_cost', 'numeric(14, 3)', (col) => col.defaultTo('0').notNull())
      .addColumn('advance_payment', 'numeric(14, 3)', (col) => col.defaultTo('0').notNull())
      .addColumn('status', 'varchar(50)', (col) => col.defaultTo('received').notNull())
      .addColumn('technician_id', 'integer')
      .addColumn('technician_name', 'varchar(150)')
      .addColumn('technician_notes', 'text')
      .addColumn('branch_id', 'integer')
      .addColumn('location_id', 'integer')
      .addColumn('sale_id', 'integer')
      .addColumn('warranty_days', 'integer', (col) => col.defaultTo(30).notNull())
      .addColumn('received_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('repaired_at', 'timestamptz')
      .addColumn('delivered_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    // 2. Create maintenance_ticket_parts table
    await db.schema
      .createTable('maintenance_ticket_parts')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'text', (col) => col.notNull())
      .addColumn('account_id', 'text', (col) => col.notNull())
      .addColumn('ticket_id', 'integer', (col) => col.notNull())
      .addColumn('product_id', 'integer', (col) => col.notNull())
      .addColumn('product_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('qty', 'numeric(14, 3)', (col) => col.defaultTo('1').notNull())
      .addColumn('unit_cost', 'numeric(14, 3)', (col) => col.defaultTo('0').notNull())
      .addColumn('unit_price', 'numeric(14, 3)', (col) => col.defaultTo('0').notNull())
      .addColumn('location_id', 'integer')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    // 3. Create trade_in_transactions table
    await db.schema
      .createTable('trade_in_transactions')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'text', (col) => col.notNull())
      .addColumn('account_id', 'text', (col) => col.notNull())
      .addColumn('doc_no', 'varchar(60)', (col) => col.notNull())
      .addColumn('seller_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('seller_phone', 'varchar(50)', (col) => col.notNull())
      .addColumn('seller_national_id', 'varchar(30)', (col) => col.notNull())
      .addColumn('device_brand', 'varchar(100)')
      .addColumn('device_model', 'varchar(150)', (col) => col.notNull())
      .addColumn('serial_number', 'varchar(120)', (col) => col.notNull())
      .addColumn('imei_2', 'varchar(120)')
      .addColumn('device_condition_notes', 'text')
      .addColumn('agreed_purchase_price', 'numeric(14, 3)', (col) => col.defaultTo('0').notNull())
      .addColumn('transaction_type', 'varchar(50)', (col) => col.defaultTo('cash_purchase').notNull())
      .addColumn('created_product_id', 'integer')
      .addColumn('sale_id', 'integer')
      .addColumn('payment_method', 'varchar(50)', (col) => col.defaultTo('cash').notNull())
      .addColumn('signature_data', 'text')
      .addColumn('branch_id', 'integer')
      .addColumn('location_id', 'integer')
      .addColumn('notes', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    // Indexes
    await db.schema
      .createIndex('idx_maintenance_tickets_tenant_ticket_no')
      .on('maintenance_tickets')
      .columns(['tenant_id', 'account_id', 'ticket_no'])
      .execute();

    await db.schema
      .createIndex('idx_maintenance_tickets_status')
      .on('maintenance_tickets')
      .columns(['tenant_id', 'account_id', 'status'])
      .execute();

    await db.schema
      .createIndex('idx_maintenance_tickets_serial')
      .on('maintenance_tickets')
      .columns(['tenant_id', 'account_id', 'serial_number'])
      .execute();

    await db.schema
      .createIndex('idx_maintenance_parts_ticket')
      .on('maintenance_ticket_parts')
      .columns(['tenant_id', 'account_id', 'ticket_id'])
      .execute();

    await db.schema
      .createIndex('idx_trade_in_tenant_serial')
      .on('trade_in_transactions')
      .columns(['tenant_id', 'account_id', 'serial_number'])
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.dropTable('trade_in_transactions').ifExists().execute();
    await db.schema.dropTable('maintenance_ticket_parts').ifExists().execute();
    await db.schema.dropTable('maintenance_tickets').ifExists().execute();
  },
};
