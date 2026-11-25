import { type Kysely, sql } from 'kysely';

/**
 * هجرة 143: الفترات المالية المحاسبية الشهرية وإقفال الشهور (البند O6).
 *
 * جدول `accounting_fiscal_periods` يُمثّل الفترات المحاسبية الشهرية داخل كل سنة مالية.
 * يسمح للمنشأة بإقفال وتجميد الدفاتر شهرياً بعد مراجعة الحسابات وتقديم الإقرارات الضريبية،
 * ويمنع ترحيل أو تعديل أي قيد في فترة مقفلة.
 */
export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('accounting_fiscal_periods')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(255)', (col) => col.notNull())
      .addColumn('fiscal_year_id', 'integer', (col) =>
        col.notNull().references('accounting_fiscal_years.id').onDelete('cascade'),
      )
      .addColumn('period_number', 'integer', (col) => col.notNull())
      .addColumn('name', 'varchar(150)', (col) => col.notNull())
      .addColumn('code', 'varchar(50)')
      .addColumn('start_date', 'date', (col) => col.notNull())
      .addColumn('end_date', 'date', (col) => col.notNull())
      .addColumn('status', 'varchar(50)', (col) => col.defaultTo('open').notNull())
      .addColumn('closed_at', 'timestamptz')
      .addColumn('closed_by', 'integer')
      .addColumn('closing_notes', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .execute();

    await db.schema
      .createIndex('idx_fiscal_periods_tenant_year')
      .on('accounting_fiscal_periods')
      .columns(['tenant_id', 'fiscal_year_id'])
      .execute();

    await db.schema
      .createIndex('idx_fiscal_periods_dates')
      .on('accounting_fiscal_periods')
      .columns(['tenant_id', 'start_date', 'end_date'])
      .execute();

    await db.schema
      .createIndex('idx_fiscal_periods_status')
      .on('accounting_fiscal_periods')
      .columns(['tenant_id', 'status'])
      .execute();

    await sql`
      ALTER TABLE accounting_fiscal_periods
      ADD CONSTRAINT uq_fiscal_period_tenant_year_num UNIQUE (tenant_id, fiscal_year_id, period_number)
    `.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('accounting_fiscal_periods').ifExists().execute();
  },
};
