import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // 1. Create plans table
    await db.schema
      .createTable('plans')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('code', 'text', (col) => col.notNull().unique())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('price', 'numeric', (col) => col.defaultTo('0'))
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    // 2. Create features table
    await db.schema
      .createTable('features')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('code', 'text', (col) => col.notNull().unique()) // e.g. 'inventory.advanced', 'reports.profits'
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('module', 'text', (col) => col.notNull()) // e.g. 'inventory', 'reports'
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    // 3. Create plan_features table
    await db.schema
      .createTable('plan_features')
      .ifNotExists()
      .addColumn('plan_id', 'text', (col) => col.notNull().references('plans.id').onDelete('cascade'))
      .addColumn('feature_code', 'text', (col) => col.notNull().references('features.code').onDelete('cascade'))
      .addPrimaryKeyConstraint('plan_features_pkey', ['plan_id', 'feature_code'])
      .execute();

    // 4. Add plan_id and extra_features to tenants
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL`.execute(
      db,
    );
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS extra_features JSONB NOT NULL DEFAULT '[]'::jsonb`.execute(
      db,
    );

    // Seed default plans
    await sql`
      INSERT INTO plans (id, code, name, description, price) VALUES 
      ('plan_basic', 'basic', 'الأساسية', 'الباقة الأساسية', 0),
      ('plan_pro', 'pro', 'الاحترافية', 'الباقة المتقدمة', 500),
      ('plan_ultimate', 'ultimate', 'المتكاملة', 'الباقة الشاملة', 1000)
      ON CONFLICT (code) DO NOTHING;
    `.execute(db);

    // Seed default features
    await sql`
      INSERT INTO features (id, code, name, module) VALUES 
      ('feat_catalog', 'catalog', 'المنتجات', 'catalog'),
      ('feat_sales', 'sales', 'المبيعات', 'sales'),
      ('feat_sessions', 'sessions', 'ورديات العمل', 'sessions'),
      ('feat_cashDrawer', 'cashDrawer', 'صندوق الكاشير', 'cashDrawer'),
      ('feat_purchases', 'purchases', 'المشتريات', 'purchases'),
      ('feat_inventory', 'inventory', 'المخزون المتقدم', 'inventory'),
      ('feat_reports', 'reports', 'التقارير المتقدمة', 'reports'),
      ('feat_hr', 'hr', 'الموارد البشرية', 'hr'),
      ('feat_manufacturing', 'manufacturing', 'التصنيع', 'manufacturing'),
      ('feat_accounting', 'accounting', 'الحسابات العامة', 'accounting'),
      ('feat_deliveryReps', 'deliveryReps', 'مناديب التوصيل', 'deliveryReps'),
      ('feat_taxIntegration', 'taxIntegration', 'الربط الضريبي', 'taxIntegration')
      ON CONFLICT (code) DO NOTHING;
    `.execute(db);

    // Seed plan_features
    await sql`
      INSERT INTO plan_features (plan_id, feature_code) VALUES 
      -- Basic Plan
      ('plan_basic', 'catalog'),
      ('plan_basic', 'sales'),
      ('plan_basic', 'sessions'),
      ('plan_basic', 'cashDrawer'),
      -- Pro Plan
      ('plan_pro', 'catalog'),
      ('plan_pro', 'sales'),
      ('plan_pro', 'sessions'),
      ('plan_pro', 'cashDrawer'),
      ('plan_pro', 'purchases'),
      ('plan_pro', 'inventory'),
      ('plan_pro', 'reports'),
      -- Ultimate Plan (Everything)
      ('plan_ultimate', 'catalog'),
      ('plan_ultimate', 'sales'),
      ('plan_ultimate', 'sessions'),
      ('plan_ultimate', 'cashDrawer'),
      ('plan_ultimate', 'purchases'),
      ('plan_ultimate', 'inventory'),
      ('plan_ultimate', 'reports'),
      ('plan_ultimate', 'hr'),
      ('plan_ultimate', 'manufacturing'),
      ('plan_ultimate', 'accounting'),
      ('plan_ultimate', 'deliveryReps'),
      ('plan_ultimate', 'taxIntegration')
      ON CONFLICT DO NOTHING;
    `.execute(db);

    // Default all existing tenants to ultimate so nothing breaks
    await sql`UPDATE tenants SET plan_id = 'plan_ultimate' WHERE plan_id IS NULL`.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS extra_features`.execute(db);
    await sql`ALTER TABLE tenants DROP COLUMN IF EXISTS plan_id`.execute(db);
    await db.schema.dropTable('plan_features').ifExists().execute();
    await db.schema.dropTable('features').ifExists().execute();
    await db.schema.dropTable('plans').ifExists().execute();
  },
};
