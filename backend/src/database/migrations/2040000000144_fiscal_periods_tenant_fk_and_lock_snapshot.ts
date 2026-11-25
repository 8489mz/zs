import { sql, type Kysely } from 'kysely';

/**
 * إصلاحان في الفترات المحاسبية الشهرية (هجرة 143) بعد مراجعتها:
 *
 * **1. عزل المستأجر مفروض من القاعدة لا من الخدمة.**
 * هجرة 143 ربطت `accounting_fiscal_periods.fiscal_year_id` بـ`accounting_fiscal_years(id)`
 * بمفتاح **أحادي العمود**. معناه أن قاعدة البيانات تقبل فترةً لمستأجر تشير إلى سنة مالية
 * لمستأجر آخر؛ الشيء الوحيد الذي يمنع ذلك هو `where tenant_id` في الخدمة.
 * هذا بالضبط النمط الذي أُغلق في **O45** (هجرة 140 لـ`maritime_jobs`): المفتاح المركّب
 * `(tenant_id, fiscal_year_id) → (tenant_id, id)` يجعل الخلط **مستحيلاً** لا "مفحوصاً".
 *
 * **2. لقطة قفل الدفاتر قبل الإقفال.**
 * `reopenFiscalPeriod` كان يكتب `lock_date_all` بقيمة آخر فترة شهرية مقفلة **بلا شرط**، وبـ
 * `NULL` إن لم توجد. فمنشأة قفلت دفاترها يدوياً حتى 2025-12-31 (وهي الطريقة الوحيدة التي
 * كانت موجودة قبل الفترات الشهرية)، ثم أقفلت شهراً وأعادت فتحه، كان قفلها اليدوي **يُمحى
 * والدفاتر القديمة تُفتح**. العمود الجديد يحفظ القيمة قبل رفعها، فتُستعاد كما كانت.
 */
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // المفتاح المركّب يحتاج فهرساً فريداً مطابقاً على الطرف المشار إليه.
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'uq_accounting_fiscal_years_tenant_id'
        ) THEN
          ALTER TABLE accounting_fiscal_years
          ADD CONSTRAINT uq_accounting_fiscal_years_tenant_id UNIQUE (tenant_id, id);
        END IF;
      END $$;
    `.execute(db);

    // أي صف يتيم أو عابر للمستأجرين يمنع إنشاء المفتاح. لا توجد بيانات إنتاج لهذا الجدول بعد
    // (أُنشئ اليوم)، لكن الترميم هنا يجعل الهجرة قابلة للتشغيل على أي قاعدة بلا تدخل يدوي.
    await sql`
      DELETE FROM accounting_fiscal_periods p
      WHERE NOT EXISTS (
        SELECT 1 FROM accounting_fiscal_years y
        WHERE y.id = p.fiscal_year_id AND y.tenant_id = p.tenant_id
      )
    `.execute(db);

    await sql`
      ALTER TABLE accounting_fiscal_periods
      DROP CONSTRAINT IF EXISTS accounting_fiscal_periods_fiscal_year_id_fkey
    `.execute(db);

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'fk_fiscal_periods_tenant_year'
        ) THEN
          ALTER TABLE accounting_fiscal_periods
          ADD CONSTRAINT fk_fiscal_periods_tenant_year
          FOREIGN KEY (tenant_id, fiscal_year_id)
          REFERENCES accounting_fiscal_years (tenant_id, id)
          ON DELETE CASCADE;
        END IF;
      END $$;
    `.execute(db);

    // لقطة `lock_date_all` قبل أن يرفعه إقفال هذه الفترة — تُستعاد عند إعادة الفتح.
    await sql`
      ALTER TABLE accounting_fiscal_periods
      ADD COLUMN IF NOT EXISTS previous_lock_date_all DATE NULL
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE accounting_fiscal_periods DROP COLUMN IF EXISTS previous_lock_date_all`.execute(db);
    await sql`ALTER TABLE accounting_fiscal_periods DROP CONSTRAINT IF EXISTS fk_fiscal_periods_tenant_year`.execute(
      db,
    );
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'accounting_fiscal_periods_fiscal_year_id_fkey'
        ) THEN
          ALTER TABLE accounting_fiscal_periods
          ADD CONSTRAINT accounting_fiscal_periods_fiscal_year_id_fkey
          FOREIGN KEY (fiscal_year_id) REFERENCES accounting_fiscal_years (id) ON DELETE CASCADE;
        END IF;
      END $$;
    `.execute(db);
    await sql`ALTER TABLE accounting_fiscal_years DROP CONSTRAINT IF EXISTS uq_accounting_fiscal_years_tenant_id`.execute(
      db,
    );
  },
};
