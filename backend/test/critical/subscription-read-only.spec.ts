import { strict as assert } from 'node:assert';
import { TenantSubscriptionService } from '../../src/modules/tenant-subscription/tenant-subscription.service';
import { PricingCatalogService } from '../../src/modules/tenant-subscription/pricing/pricing-catalog.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

// O33 (ARCHITECTURE_INVARIANTS.md §8): opening the subscription screen used to create a tenant row,
// seed the platform plan catalogue and insert a 10-year "active" subscription — platform revenue
// records fabricated by a GET. The read path must now touch nothing.

const writes: string[] = [];
const reads: string[] = [];

/** Chainable Kysely stand-in: any builder call returns itself; terminals resolve to fixtures. */
function queryBuilder(rows: any[]): any {
  const builder: any = new Proxy(function () {} as any, {
    get(_t, prop: string) {
      if (prop === 'execute') return async () => rows;
      if (prop === 'executeTakeFirst') return async () => rows[0];
      if (prop === 'executeTakeFirstOrThrow')
        return async () => {
          if (!rows[0]) throw new Error('no row');
          return rows[0];
        };
      if (prop === 'then') return undefined;
      return () => builder;
    },
    apply: () => builder,
  });
  return builder;
}

function fakeDb(fixtures: Record<string, any[]>) {
  return {
    selectFrom(table: string) {
      const name = String(table).split(' ')[0];
      reads.push(name);
      return queryBuilder(fixtures[name] || []);
    },
    insertInto(table: string) {
      writes.push(`insert:${table}`);
      return queryBuilder([]);
    },
    updateTable(table: string) {
      writes.push(`update:${table}`);
      return queryBuilder([]);
    },
    deleteFrom(table: string) {
      writes.push(`delete:${table}`);
      return queryBuilder([]);
    },
    transaction() {
      writes.push('transaction');
      return { execute: async (cb: any) => cb(this) };
    },
  } as any;
}

const auth = {
  tenantId: 'acme',
  accountId: 'acme',
  userId: 1,
  username: 'owner',
  role: 'admin',
  permissions: [],
} as unknown as AuthContext;

async function testReadPathWritesNothing(): Promise<void> {
  const service = new TenantSubscriptionService(
    fakeDb({}),
    { log: async () => undefined } as any,
    new PricingCatalogService(),
  );
  const result: any = await service.getMySubscription(auth);

  assert.deepEqual(writes, [], `the subscription screen must not write: ${writes.join(', ')}`);
  assert.ok(reads.includes('tenants') && reads.includes('saas_plans'), 'it still reads what it shows');
  assert.equal(result.subscription, null, 'no subscription row means none is reported');
  // PRICE-2 / F40: كانت هنا قائمة باقات بأسعار مكتوبة في الكود تُعرض حين يكون الجدول
  // فارغاً، بمعرّفات وهمية 1..4 تُمرَّر إلى طلب الترقية. جدول فارغ = لا باقات.
  assert.ok(
    Array.isArray(result.availablePlans) && result.availablePlans.length === 0,
    'an empty catalogue lists no plans — it never invents them',
  );
  assert.equal(result.tenant.id, 'acme');
}

async function testExistingRowsAreReported(): Promise<void> {
  writes.length = 0;
  const ends = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const service = new TenantSubscriptionService(
    fakeDb({
      tenants: [
        {
          id: 'acme',
          slug: 'acme',
          business_name: 'Acme',
          owner_name: 'O',
          owner_phone: '1',
          status: 'active',
          trial_ends_at: null,
          created_at: new Date(),
        },
      ],
      saas_plans: [
        {
          id: 7,
          code: 'PRO',
          name: 'Pro',
          price: 7500,
          currency: 'EGP',
          billing_period_months: 12,
          max_users: 6,
          max_branches: 3,
          is_active: true,
        },
      ],
      tenant_subscriptions: [
        {
          id: 3,
          status: 'active',
          starts_at: new Date(),
          ends_at: ends,
          grace_ends_at: null,
          auto_renew: false,
          created_at: new Date(),
          plan_id: 7,
          plan_name: 'Pro',
          plan_code: 'PRO',
          plan_price: 7500,
          plan_currency: 'EGP',
          billing_period_months: 12,
          max_users: 6,
          max_branches: 3,
        },
      ],
    }),
    { log: async () => undefined } as any,
    new PricingCatalogService(),
  );
  const result: any = await service.getMySubscription(auth);
  assert.deepEqual(writes, [], 'still no writes when rows exist');
  assert.equal(result.subscription.id, 3);
  assert.equal(result.subscription.planCode, 'PRO');
  assert.equal(result.statusMeta.isExpired, false);
}

async function testPricingResolutionForMaritimeAndContracting(): Promise<void> {
  // Scenario 1: Tenant has maritimeFreightModuleEnabled=true in settings, but legacy activity_type='retail_general'
  const maritimeService = new TenantSubscriptionService(
    fakeDb({
      settings: [
        { key: 'maritimeFreightModuleEnabled', value: 'true' },
        { key: 'businessIndustry', value: '"general"' },
      ],
      tenants: [{ id: 'acme', country_code: 'EG', activity_type: 'retail_general' }],
    }),
    { log: async () => undefined } as any,
    new PricingCatalogService(),
  );

  const maritimePricing: any = await maritimeService.getResolvedPricing(auth);
  assert.equal(
    maritimePricing.product.id,
    'maritime',
    'must resolve to maritime product when maritimeFreightModuleEnabled is true',
  );
  assert.equal(maritimePricing.product.name, 'نظام الشحن والتخليص والخدمات اللوجستية');
  assert.equal(maritimePricing.levels[0].name, 'مكتب');
  assert.equal(maritimePricing.levels[1].name, 'شركة');
  assert.equal(maritimePricing.levels[2].name, 'مؤسسة');

  // Scenario 2: Tenant has contractingModuleEnabled=true in settings
  const contractingService = new TenantSubscriptionService(
    fakeDb({
      settings: [{ key: 'contractingModuleEnabled', value: 'true' }],
      tenants: [{ id: 'acme', country_code: 'EG', activity_type: 'retail_general' }],
    }),
    { log: async () => undefined } as any,
    new PricingCatalogService(),
  );

  const contractingPricing: any = await contractingService.getResolvedPricing(auth);
  assert.equal(
    contractingPricing.product.id,
    'contracting',
    'must resolve to contracting product when contractingModuleEnabled is true',
  );
  assert.equal(contractingPricing.product.name, 'نظام المقاولات وإدارة المشاريع الإنشائية');
}

(async () => {
  await testReadPathWritesNothing();
  await testExistingRowsAreReported();
  await testPricingResolutionForMaritimeAndContracting();
  console.log('subscription-read-only.spec: all checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
