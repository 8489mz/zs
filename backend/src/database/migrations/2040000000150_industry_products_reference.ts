import { Kysely, sql } from 'kysely';

/**
 * جدول مرجعي يربط كل منتج قطاعي في الكتالوج (`pricing/pricing-catalog.json` — 16 منتجاً)
 * باسمه التجاري ونطاقه — يُغلق باقي البند C3 في `PRICING_AND_PACKAGING.md` §11.
 *
 * جدول قراءة/عرض فقط (لوحة إدارة، تقارير، أو أي استهلاك مستقبلي)، ولا يُستخدم في مسار
 * التحقق الفعلي من الصلاحيات — ده لسه شغال عبر `industry-profiles.ts` (10 تصنيفات تشغيلية
 * أوسع من الـ16 منتجاً التسويقية، وهو المصدر الصحيح لأي قرار صلاحيات).
 *
 * `industry_profile_key` يربط كل منتج بمفتاح `IndustryProfileKey` الحقيقي في الكود حين
 * يوجد تطابق نظيف واحد لواحد؛ NULL حين لا يوجد (المنتج تسويقي فقط، أو مجموعة منتجات بتتشارك
 * مفتاحاً واحداً بالفعل زي fashion/perfumes -> clothing، أو مفيش تصنيف تشغيلي مخصص له أصلاً
 * زي appliances_installments/wholesale/services — دي فجوة حقيقية موجودة من قبل هذه الهجرة،
 * مُسجَّلة هنا بصراحة لا مُخفاة، وتحتاج قراراً منتجياً منفصلاً لو حبينا نخصص لهم تصنيفاً).
 */

type IndustryProduct = {
  presetId: string;
  commercialName: string;
  band: number;
  hasPos: boolean;
  sellOffline: boolean;
  sectorFeatureCode: string | null;
  industryProfileKey: string | null;
};

const PRODUCTS: IndustryProduct[] = [
  {
    presetId: 'supermarket',
    commercialName: 'برنامج السوبرماركت والبقالة والمواد الغذائية',
    band: 1,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: null,
    industryProfileKey: 'retail_general',
  },
  {
    presetId: 'retail',
    commercialName: 'برنامج محلات التجزئة العامة',
    band: 1,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: null,
    industryProfileKey: 'retail_general',
  },
  {
    presetId: 'spices',
    commercialName: 'برنامج العطارة والمحامص والمطاحن والبهارات',
    band: 1,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: null,
    industryProfileKey: 'retail_general',
  },
  {
    presetId: 'fashion',
    commercialName: 'برنامج الملابس والأزياء والأحذية',
    band: 1,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: 'clothing',
    industryProfileKey: 'clothing',
  },
  {
    presetId: 'perfumes',
    commercialName: 'برنامج العطور ومستحضرات التجميل والتركيبات',
    band: 1,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: 'clothing',
    industryProfileKey: 'clothing',
  },
  {
    presetId: 'pharmacy',
    commercialName: 'برنامج الصيدليات والمستلزمات الطبية',
    band: 2,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: 'pharmacy',
    industryProfileKey: 'pharmacy',
  },
  {
    presetId: 'electronics',
    commercialName: 'برنامج الموبايلات والإلكترونيات والصيانة',
    band: 2,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: 'maintenance',
    industryProfileKey: 'maintenance',
  },
  {
    presetId: 'appliances_installments',
    commercialName: 'برنامج معارض الأجهزة والأثاث بالتقسيط',
    band: 2,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: null,
    industryProfileKey: null,
  },
  {
    presetId: 'restaurant',
    commercialName: 'برنامج المطاعم والكافيهات',
    band: 3,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: 'restaurant',
    industryProfileKey: 'restaurant',
  },
  {
    presetId: 'wholesale',
    commercialName: 'برنامج الجملة والتوزيع',
    band: 4,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: null,
    industryProfileKey: null,
  },
  {
    presetId: 'manufacturing',
    commercialName: 'برنامج المصانع والمعامل والورش',
    band: 4,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: 'manufacturing',
    industryProfileKey: 'manufacturing',
  },
  {
    presetId: 'import_export',
    commercialName: 'برنامج الاستيراد والتصدير والتجارة الدولية',
    band: 4,
    hasPos: true,
    sellOffline: true,
    sectorFeatureCode: 'import',
    industryProfileKey: 'import_export',
  },
  {
    presetId: 'services',
    commercialName: 'برنامج الشركات الخدمية والمكاتب الاستشارية',
    band: 4,
    hasPos: false,
    sellOffline: true,
    sectorFeatureCode: null,
    industryProfileKey: null,
  },
  {
    presetId: 'ecommerce',
    commercialName: 'برنامج المتاجر الإلكترونية والبيع أونلاين',
    band: 4,
    hasPos: true,
    sellOffline: false,
    sectorFeatureCode: 'storefront',
    industryProfileKey: null,
  },
  {
    presetId: 'contracting',
    commercialName: 'نظام المقاولات وإدارة المشاريع الإنشائية',
    band: 5,
    hasPos: false,
    sellOffline: true,
    sectorFeatureCode: 'contracting',
    industryProfileKey: 'contracting',
  },
  {
    presetId: 'maritime',
    commercialName: 'نظام الشحن والتخليص والخدمات اللوجستية',
    band: 5,
    hasPos: false,
    sellOffline: true,
    sectorFeatureCode: 'maritime_freight',
    industryProfileKey: 'maritime_freight',
  },
];

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('industry_products')
      .ifNotExists()
      .addColumn('preset_id', 'text', (col) => col.primaryKey())
      .addColumn('commercial_name', 'text', (col) => col.notNull())
      .addColumn('band', 'smallint', (col) => col.notNull())
      .addColumn('has_pos', 'boolean', (col) => col.notNull())
      .addColumn('sell_offline', 'boolean', (col) => col.notNull())
      .addColumn('sector_feature_code', 'text')
      .addColumn('industry_profile_key', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    for (const p of PRODUCTS) {
      await db
        .insertInto('industry_products')
        .values({
          preset_id: p.presetId,
          commercial_name: p.commercialName,
          band: p.band,
          has_pos: p.hasPos,
          sell_offline: p.sellOffline,
          sector_feature_code: p.sectorFeatureCode,
          industry_profile_key: p.industryProfileKey,
        } as any)
        .onConflict((oc) =>
          oc.column('preset_id').doUpdateSet((eb) => ({
            commercial_name: eb.ref('excluded.commercial_name'),
            band: eb.ref('excluded.band'),
            has_pos: eb.ref('excluded.has_pos'),
            sell_offline: eb.ref('excluded.sell_offline'),
            sector_feature_code: eb.ref('excluded.sector_feature_code'),
            industry_profile_key: eb.ref('excluded.industry_profile_key'),
            updated_at: sql`now()`,
          })),
        )
        .execute();
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('industry_products').ifExists().execute();
  },
};
