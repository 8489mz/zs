import { Kysely } from 'kysely';

interface BandFeatures {
  code: string;
  featurePlanId: string;
  name: string;
  band: number;
  level: number;
  maxUsers: number;
  maxBranches: number;
  priceMonthly: number;
  priceAnnual: number;
}

const BAND5_PLANS: BandFeatures[] = [
  {
    code: 'BAND5_L1',
    featurePlanId: 'tier_band5_L1',
    name: 'القطاعات المؤسسية والشحن — مكتب',
    band: 5,
    level: 1,
    maxUsers: 5,
    maxBranches: 1,
    priceMonthly: 4500,
    priceAnnual: 45000,
  },
  {
    code: 'BAND5_L2',
    featurePlanId: 'tier_band5_L2',
    name: 'القطاعات المؤسسية والشحن — شركة',
    band: 5,
    level: 2,
    maxUsers: 15,
    maxBranches: 3,
    priceMonthly: 9500,
    priceAnnual: 95000,
  },
  {
    code: 'BAND5_L3',
    featurePlanId: 'tier_band5_L3',
    name: 'القطاعات المؤسسية والشحن — مؤسسة',
    band: 5,
    level: 3,
    maxUsers: 40,
    maxBranches: 10,
    priceMonthly: 18000,
    priceAnnual: 180000,
  },
];

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    for (const plan of BAND5_PLANS) {
      await db
        .insertInto('plans')
        .values({
          id: plan.featurePlanId,
          code: plan.featurePlanId,
          name: plan.name,
          description: `نطاق ${plan.band} — مستوى ${plan.level}`,
          price: plan.priceAnnual,
        } as any)
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();

      await db
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
        } as any)
        .onConflict((oc) => oc.column('code').doNothing())
        .execute();
    }

    // Connect zs central tenant to BAND5_L3 (Enterprise Institution)
    const band5L3 = await db.selectFrom('saas_plans').select('id').where('code', '=', 'BAND5_L3').executeTakeFirst();

    if (band5L3?.id) {
      await db.updateTable('tenant_subscriptions').set({ plan_id: band5L3.id }).where('tenant_id', '=', 'zs').execute();
    }
  },

  async down(_db: Kysely<any>): Promise<void> {
    // Non-destructive rollback
  },
};
