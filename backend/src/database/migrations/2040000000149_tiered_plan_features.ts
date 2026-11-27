import { Kysely, sql } from 'kysely';

/**
 * تفعيل التدرج الحقيقي بين المستويات الثلاثة لكل نطاق تسعير — يُغلق البند C1 في
 * `PRICING_AND_PACKAGING.md` §11.
 *
 * كانت `industry-profiles.ts` تمنح كل نشاط (صيدلية، مطعم، تجزئة...) كل ميزاته دفعة
 * واحدة بغض النظر عن الباقة، لأن `defaultFeatures` كانت تحمل كل شيء (مشتريات،
 * مخزون، تقارير، حسابات، موارد بشرية...)، و`hasFeature` كانت تتحقق من النشاط قبل
 * الباقة فترجع "مسموح" فوراً. فعلياً لم يكن فرق بين "أساسي" و"المتكاملة" لنفس النشاط.
 *
 * الآن `defaultFeatures` (هجرة الكود المصاحبة، غير هذه الهجرة) تحمل فقط علم هوية
 * القطاع وأساسيات نقطة البيع، والباقي يأتي من `plan_features` هنا حسب
 * `pricing/pricing-catalog.json` (bands[].levelGroups × featureGroups، مصدر الحقيقة
 * الوحيد — راجع §13). النطاقان 1-3 لا تفرّعات فيهما (كل منتجاتهما تتشارك نفس مجموعات
 * المستوى)، أما النطاق 4 ففيه مجموعة عامة (جملة · تصنيع · استيراد · خدمات) بمعرّف
 * `feature_plan_id` واحد لكل مستوى.
 *
 * المقاولات والشحن (النطاق 5) لم تُمس عمداً — تبقى معزولة وتُمنح كامل مجموعتها فوراً،
 * لأن بيعها بالتفاوض المباشر لا ذاتياً، بقرار صاحب المنتج.
 *
 * الحسابات التجريبية (trial) لا تتأثر: تبقى `tenants.plan_id = 'plan_ultimate'`
 * (الافتراضي في `trial-tenant-provisioning.service.ts`)، وصف `plan_features` القديم
 * لـ`plan_ultimate` من الهجرة 035 يبقى كما هو فيمنحها كل شيء طوال مدة التجربة.
 */

type BandFeatures = {
  code: string;
  featurePlanId: string;
  name: string;
  band: number;
  level: 1 | 2 | 3;
  maxUsers: number;
  maxBranches: number;
  priceMonthly: number;
  priceAnnual: number;
  featureCodes: string[];
};

// core_pos متاحة دائماً بصرف النظر عن المستوى (defaultFeatures في الكود)، فلا داعي
// لتكرارها هنا. الأعمدة أدناه تمثل فقط ما يُضاف بدءاً من كل مستوى — وتقتصر على
// أكواد موجودة فعلاً في جدول features (قيد مفتاحي أجنبي على plan_features.feature_code).
// 'suppliers'/'customers'/'crm'/'pricing'/'treasury'/'approvals'/'products' كانت أسماء
// وصفية في defaultFeatures القديمة، غير مسجَّلة في features وغير مُتحقَّق منها بأي
// حارس مسار فعلي — حُذفت من هنا ومن defaultFeatures معاً، لا تُفقَد أي حماية حقيقية.
const OPERATIONS = ['purchases', 'inventory', 'reports', 'loyalty', 'deliveryReps', 'installments'];
const FINANCE = ['accounting', 'fixed_assets'];
const HR = ['hr'];
const COMPLIANCE = ['taxIntegration', 'vat_declaration'];

function levelFeatures(level: 1 | 2 | 3): string[] {
  if (level === 1) return [];
  if (level === 2) return [...OPERATIONS];
  return [...OPERATIONS, ...FINANCE, ...HR, ...COMPLIANCE];
}

// مصدر الأرقام: pricing/pricing-catalog.json (bands.band{1..4}.levels.L{1..3}, بلد EG) —
// إصدار 25 سبتمبر 2026. لو الكتالوج اتغيّر بعد كده، الرقم الحاكم فعلياً هو استجابة
// PricingCatalogService (تقرأ الملف مباشرة)، والأرقام هنا مجرد قيم أولية لعمود
// max_users/max_branches الإرشادي في saas_plans — راجع §13.
const PLANS: BandFeatures[] = [
  {
    code: 'BAND1_L1',
    featurePlanId: 'tier_band1_L1',
    name: 'تجزئة عامة — محل',
    band: 1,
    level: 1,
    maxUsers: 3,
    maxBranches: 1,
    priceMonthly: 450,
    priceAnnual: 4500,
    featureCodes: levelFeatures(1),
  },
  {
    code: 'BAND1_L2',
    featurePlanId: 'tier_band1_L2',
    name: 'تجزئة عامة — متعدد الفروع',
    band: 1,
    level: 2,
    maxUsers: 10,
    maxBranches: 2,
    priceMonthly: 1900,
    priceAnnual: 19000,
    featureCodes: levelFeatures(2),
  },
  {
    code: 'BAND1_L3',
    featurePlanId: 'tier_band1_L3',
    name: 'تجزئة عامة — سلسلة ومؤسسة',
    band: 1,
    level: 3,
    maxUsers: 25,
    maxBranches: 5,
    priceMonthly: 4500,
    priceAnnual: 45000,
    featureCodes: levelFeatures(3),
  },

  {
    code: 'BAND2_L1',
    featurePlanId: 'tier_band2_L1',
    name: 'معارض عالية القيمة — محل/معرض',
    band: 2,
    level: 1,
    maxUsers: 3,
    maxBranches: 1,
    priceMonthly: 650,
    priceAnnual: 6500,
    featureCodes: levelFeatures(1),
  },
  {
    code: 'BAND2_L2',
    featurePlanId: 'tier_band2_L2',
    name: 'معارض عالية القيمة — متعدد الفروع',
    band: 2,
    level: 2,
    maxUsers: 12,
    maxBranches: 3,
    priceMonthly: 2200,
    priceAnnual: 22000,
    featureCodes: levelFeatures(2),
  },
  {
    code: 'BAND2_L3',
    featurePlanId: 'tier_band2_L3',
    name: 'معارض عالية القيمة — سلسلة ومؤسسة',
    band: 2,
    level: 3,
    maxUsers: 25,
    maxBranches: 8,
    priceMonthly: 5000,
    priceAnnual: 50000,
    featureCodes: levelFeatures(3),
  },

  {
    code: 'BAND3_L1',
    featurePlanId: 'tier_band3_L1',
    name: 'مطاعم وكافيهات — فرع واحد',
    band: 3,
    level: 1,
    maxUsers: 5,
    maxBranches: 1,
    priceMonthly: 1400,
    priceAnnual: 14000,
    featureCodes: levelFeatures(1),
  },
  {
    code: 'BAND3_L2',
    featurePlanId: 'tier_band3_L2',
    name: 'مطاعم وكافيهات — ثلاثة فروع',
    band: 3,
    level: 2,
    maxUsers: 15,
    maxBranches: 3,
    priceMonthly: 3400,
    priceAnnual: 34000,
    featureCodes: levelFeatures(2),
  },
  {
    code: 'BAND3_L3',
    featurePlanId: 'tier_band3_L3',
    name: 'مطاعم وكافيهات — سلسلة',
    band: 3,
    level: 3,
    maxUsers: 30,
    maxBranches: 8,
    priceMonthly: 6900,
    priceAnnual: 69000,
    featureCodes: levelFeatures(3),
  },

  {
    code: 'BAND4_L1',
    featurePlanId: 'tier_band4_L1',
    name: 'الشركات — أساسي',
    band: 4,
    level: 1,
    maxUsers: 5,
    maxBranches: 1,
    priceMonthly: 1500,
    priceAnnual: 15000,
    featureCodes: levelFeatures(1),
  },
  {
    code: 'BAND4_L2',
    featurePlanId: 'tier_band4_L2',
    name: 'الشركات — شركة',
    band: 4,
    level: 2,
    maxUsers: 12,
    maxBranches: 3,
    priceMonthly: 3600,
    priceAnnual: 36000,
    featureCodes: levelFeatures(2),
  },
  {
    code: 'BAND4_L3',
    featurePlanId: 'tier_band4_L3',
    name: 'الشركات — مؤسسة',
    band: 4,
    level: 3,
    maxUsers: 30,
    maxBranches: 10,
    priceMonthly: 7500,
    priceAnnual: 75000,
    featureCodes: levelFeatures(3),
  },
];

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await sql`
      ALTER TABLE saas_plans
      ADD COLUMN IF NOT EXISTS price_monthly numeric,
      ADD COLUMN IF NOT EXISTS pricing_band smallint,
      ADD COLUMN IF NOT EXISTS pricing_level smallint
    `.execute(db);

    for (const plan of PLANS) {
      // plan_features.plan_id and saas_plans.feature_plan_id both carry a foreign key to
      // plans.id (see 2031000000000_plans_and_features.ts / 2032000000000_add_feature_plan_id_to_saas_plans.ts) —
      // the row must exist here first.
      await db
        .insertInto('plans')
        .values({
          id: plan.featurePlanId,
          code: plan.featurePlanId,
          name: plan.name,
          description: `نطاق ${plan.band} — مستوى ${plan.level}`,
          price: plan.priceAnnual,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();

      const inserted = await db
        .insertInto('saas_plans')
        .values({
          code: plan.code,
          name: plan.name,
          price: plan.priceAnnual,
          price_monthly: plan.priceMonthly,
          currency: 'EGP',
          billing_period_months: 12,
          max_users: plan.maxUsers,
          max_branches: plan.maxBranches,
          feature_plan_id: plan.featurePlanId,
          pricing_band: plan.band,
          pricing_level: plan.level,
          is_active: true,
        })
        .onConflict((oc) => oc.column('code').doNothing())
        .returning(['id'])
        .executeTakeFirst();

      // onConflict doNothing() returns nothing on a conflict — re-migration safety, not expected
      // on a first run.
      if (!inserted) continue;

      if (plan.featureCodes.length > 0) {
        await db
          .insertInto('plan_features')
          .values(plan.featureCodes.map((code) => ({ plan_id: plan.featurePlanId, feature_code: code })))
          .onConflict((oc) => oc.columns(['plan_id', 'feature_code']).doNothing())
          .execute();
      }
    }
  },

  async down(_db: Kysely<any>): Promise<void> {
    // لا تراجع: هذه هجرة إضافية بحتة (باقات وميزات جديدة)، ولا تمس أي بيانات سابقة.
    // التراجع الآمن الوحيد هو تعطيل الباقات (is_active = false)، لا حذفها، فلا تحذف
    // اشتراكات محتملة تشير إليها.
  },
};
