import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // 1. Insert 4th plan: plan_omnichannel into plans
    await sql`
      INSERT INTO plans (id, code, name, description, price) VALUES 
      ('plan_omnichannel', 'omnichannel', 'باقة التجارة الشاملة (Omnichannel Enterprise)', 'تشمل كافة ميزات النظام المحاسبي المتقدم والمتجر الإلكتروني وبوابات الدفع وتتبع المناديب', 2000)
      ON CONFLICT (code) DO NOTHING;
    `.execute(db);

    // 2. Insert new modular features into features
    await sql`
      INSERT INTO features (id, code, name, module) VALUES 
      ('feat_installments', 'installments', 'مبيعات وجدولة التقسيط', 'sales'),
      ('feat_fixed_assets', 'fixed_assets', 'إدارة وإهلاك الأصول الثابتة', 'accounting'),
      ('feat_vat_declaration', 'vat_declaration', 'الإقرار الضريبي (ن10 و ZATCA)', 'taxIntegration'),
      ('feat_loyalty', 'loyalty', 'محرك نقاط وولاء العملاء', 'sales')
      ON CONFLICT (code) DO NOTHING;
    `.execute(db);

    // 3. Link new features to plan_ultimate
    await sql`
      INSERT INTO plan_features (plan_id, feature_code) VALUES 
      ('plan_ultimate', 'installments'),
      ('plan_ultimate', 'fixed_assets'),
      ('plan_ultimate', 'vat_declaration'),
      ('plan_ultimate', 'loyalty')
      ON CONFLICT DO NOTHING;
    `.execute(db);

    // 4. Link ALL features to plan_omnichannel
    await sql`
      INSERT INTO plan_features (plan_id, feature_code)
      SELECT 'plan_omnichannel', code FROM features
      ON CONFLICT DO NOTHING;
    `.execute(db);

    // 5. Insert 4th SaaS plan into saas_plans if exists
    await sql`
      INSERT INTO saas_plans (code, name, price, currency, billing_period_months, max_users, max_branches, feature_plan_id, is_active)
      VALUES ('OMNICHANNEL', 'باقة التجارة الشاملة (Omnichannel)', 24000, 'EGP', 12, 999, 999, 'plan_omnichannel', true)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        feature_plan_id = EXCLUDED.feature_plan_id,
        is_active = true;
    `.execute(db);
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await sql`DELETE FROM saas_plans WHERE code = 'OMNICHANNEL'`.execute(db);
    await sql`DELETE FROM plan_features WHERE plan_id = 'plan_omnichannel'`.execute(db);
    await sql`DELETE FROM plan_features WHERE plan_id = 'plan_ultimate' AND feature_code IN ('installments', 'fixed_assets', 'vat_declaration', 'loyalty')`.execute(
      db,
    );
    await sql`DELETE FROM features WHERE code IN ('installments', 'fixed_assets', 'vat_declaration', 'loyalty')`.execute(
      db,
    );
    await sql`DELETE FROM plans WHERE id = 'plan_omnichannel'`.execute(db);
  },
};
