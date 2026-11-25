import { type Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    try {
      await db.schema
        .createTable('withholding_tax_transactions')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('tenant_id', 'varchar(255)', (col) => col.notNull())
        .addColumn('direction', 'varchar(20)', (col) => col.defaultTo('payable').notNull()) // 'payable' (خصم من مورد) | 'receivable' (خصم من عميل)
        .addColumn('source_type', 'varchar(30)', (col) => col.defaultTo('purchase').notNull()) // 'purchase' | 'sale' | 'expense' | 'manual'
        .addColumn('source_id', 'integer')
        .addColumn('invoice_number', 'varchar(100)', (col) => col.notNull())
        .addColumn('invoice_date', 'date', (col) => col.notNull())
        .addColumn('partner_type', 'varchar(30)', (col) => col.defaultTo('supplier'))
        .addColumn('partner_id', 'integer')
        .addColumn('partner_name', 'varchar(255)', (col) => col.notNull())
        .addColumn('tax_id_number', 'varchar(50)') // الرقم الضريبي 9 أرقام
        .addColumn('file_number', 'varchar(50)') // رقم الملف الضريبي
        .addColumn('tax_office_code', 'varchar(100)') // المأمورية الضريبية
        .addColumn('partner_address', 'text') // عنوان المورد / العميل
        .addColumn('wht_type', 'varchar(50)', (col) => col.defaultTo('goods').notNull()) // 'goods' (1%) | 'services' (3%) | 'professional' (5%) | 'custom'
        .addColumn('wht_rate', 'numeric(5, 2)', (col) => col.defaultTo(1.0).notNull())
        .addColumn('base_amount', 'numeric(15, 2)', (col) => col.notNull()) // وعاء المعاملة الخاضع
        .addColumn('tax_amount', 'numeric(15, 2)', (col) => col.notNull()) // قيمة الضريبة المخصومة
        .addColumn('quarter', 'varchar(10)', (col) => col.notNull()) // 'Q1' | 'Q2' | 'Q3' | 'Q4'
        .addColumn('tax_year', 'integer', (col) => col.notNull()) // e.g. 2026
        .addColumn('status', 'varchar(30)', (col) => col.defaultTo('draft').notNull()) // 'draft' | 'declared' | 'paid'
        .addColumn('payment_reference', 'varchar(100)')
        .addColumn('notes', 'text')
        .addColumn('created_by', 'integer')
        .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .execute();

      await db.schema
        .createIndex('idx_wht_tenant_period')
        .on('withholding_tax_transactions')
        .columns(['tenant_id', 'tax_year', 'quarter', 'direction'])
        .execute();

      await db.schema
        .createIndex('idx_wht_tenant_partner')
        .on('withholding_tax_transactions')
        .columns(['tenant_id', 'partner_name'])
        .execute();
    } catch (e) {
      // Table or index may already exist
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    try {
      await db.schema.dropTable('withholding_tax_transactions').ifExists().execute();
    } catch (e) {}
  },
};
