import { strict as assert } from 'node:assert';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import {
  isStorefrontEntitledForOrders,
  parseTenantExtraFeatures,
  STOREFRONT_NOT_ENTITLED_MESSAGE,
  type StorefrontTenantEntitlementRow,
} from '../../src/modules/storefront/engines/storefront-entitlement.engine';

/*
 * INV-STOREFRONT-ORDERS: a public storefront order is accepted only when the
 * tenant is entitled to the storefront app.
 *
 * Before: `createOnlineOrder` checked only the tenant-controlled settings toggle
 * (`storefront_enabled`). A tenant whose plan/activity excludes the storefront —
 * the test10k warehousing tenant — still took orders (ON-261105-0001, 150.00,
 * cash on delivery), because the toggle defaults to enabled and no code ever
 * consulted the plan resolver. The recorded order was then invisible to admin:
 * the /online-orders route demanded the `storefront` feature, which the tenant
 * does not have.
 *
 * After: order intake consults the canonical resolver
 * (`PlanFeatureService.hasFeature(..., 'storefront', ...)`); a tenant without
 * the feature is refused with a named error, before any stock or money moves.
 * The recorded-orders list stays permission-gated to 'sales' (no feature
 * requirement), so already-recorded orders remain visible to admin.
 */

const checker = new PlanFeatureService(undefined as any);

function row(
  activityType: string,
  planId: string | null = 'plan_basic',
  extraFeatures: unknown = [],
): StorefrontTenantEntitlementRow {
  return { plan_id: planId, extra_features: extraFeatures, activity_type: activityType };
}

function testEngineEntitlement(): void {
  // The test10k case: a warehousing tenant on a basic plan takes no new orders.
  assert.equal(isStorefrontEntitledForOrders(row('warehousing'), checker), false);
  assert.equal(isStorefrontEntitledForOrders(row('services'), checker), false);
  assert.equal(isStorefrontEntitledForOrders(row('contracting'), checker), false);
  assert.equal(isStorefrontEntitledForOrders(row('maritime_freight'), checker), false);
  // A plain retail tenant on a basic plan has no storefront in its profile
  // defaults and nothing in the plan cache, so it is not entitled either.
  assert.equal(isStorefrontEntitledForOrders(row('retail_general'), checker), false);
  // plan_ultimate explicitly excludes the storefront.
  assert.equal(isStorefrontEntitledForOrders(row('pharmacy', 'plan_ultimate'), checker), false);

  // Entitled: the e-commerce profile carries the storefront by default.
  assert.equal(isStorefrontEntitledForOrders(row('ecommerce'), checker), true);
  // Entitled: the omnichannel plan carries every feature.
  assert.equal(isStorefrontEntitledForOrders(row('pharmacy', 'plan_omnichannel'), checker), true);
  // An explicit grant beats the pillar exclusion.
  assert.equal(isStorefrontEntitledForOrders(row('warehousing', 'plan_basic', ['storefront']), checker), true);
  // An explicit minus beats an otherwise entitled plan.
  assert.equal(isStorefrontEntitledForOrders(row('ecommerce', 'plan_omnichannel', ['-storefront']), checker), false);
  // Extra features stored as a JSON string are parsed, not ignored.
  assert.equal(
    isStorefrontEntitledForOrders(row('warehousing', 'plan_basic', '["storefront"]'), checker),
    true,
  );
}

function testExtraFeaturesParsing(): void {
  assert.deepEqual(parseTenantExtraFeatures(['storefront', 'pos']), ['storefront', 'pos']);
  assert.deepEqual(parseTenantExtraFeatures('["storefront"]'), ['storefront']);
  assert.deepEqual(parseTenantExtraFeatures('not-json'), [], 'malformed extras grant nothing');
  assert.deepEqual(parseTenantExtraFeatures(42), []);
  assert.deepEqual(parseTenantExtraFeatures(null), []);
  assert.deepEqual(parseTenantExtraFeatures(['storefront', 3, null]), ['storefront']);
}

/* Minimal Kysely stand-in: serves canned rows per table and ignores predicates. */
function makeFakeDb(tenant: Record<string, unknown>, settings: Array<{ key: string; value: string }>): any {
  const rowsByTable: Record<string, unknown[]> = {
    tenants: [tenant],
    settings,
    products: [],
    product_offers: [],
  };
  const eb: any = new Proxy(function () {}, {
    get: () => (..._args: unknown[]) => eb,
    apply: () => eb,
  });
  class FakeQueryBuilder {
    constructor(private readonly table: string) {}
    select(..._args: unknown[]): this {
      return this;
    }
    selectAll(): this {
      return this;
    }
    where(...args: unknown[]): this {
      for (const arg of args) {
        if (typeof arg === 'function') {
          try {
            (arg as (builder: unknown) => unknown)(eb);
          } catch {
            // A predicate that cannot run against the stub is irrelevant here.
          }
        }
      }
      return this;
    }
    orderBy(..._args: unknown[]): this {
      return this;
    }
    limit(..._args: unknown[]): this {
      return this;
    }
    offset(..._args: unknown[]): this {
      return this;
    }
    $if(..._args: unknown[]): this {
      return this;
    }
    async execute(): Promise<unknown[]> {
      return [...(rowsByTable[this.table] ?? [])];
    }
    async executeTakeFirst(): Promise<unknown> {
      return (rowsByTable[this.table] ?? [])[0];
    }
  }
  return { selectFrom: (table: string) => new FakeQueryBuilder(table) };
}

function buildService(tenant: Record<string, unknown>, settings: Array<{ key: string; value: string }>): StorefrontService {
  return new StorefrontService(makeFakeDb(tenant, settings), {} as never, {} as never, {} as never, undefined, checker);
}

const orderDto: any = {
  customerName: 'عميل اختبار',
  customerPhone: '01012345678',
  countryCode: 'EG',
  items: [{ productId: 1, quantity: 1 }],
};

async function testServiceRejectsUnentitledTenant(): Promise<void> {
  const tenant = { id: 't-warehousing', slug: 'test-shop', plan_id: 'plan_basic', extra_features: [], activity_type: 'warehousing' };
  const service = buildService(tenant, []);
  let caught: unknown;
  try {
    await service.createOnlineOrder('test-shop', orderDto);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, 'an unentitled tenant must be refused');
  assert.equal((caught as Error).message, STOREFRONT_NOT_ENTITLED_MESSAGE);
}

async function testServicePassesGateForEntitledTenant(): Promise<void> {
  const tenant = { id: 't-ecommerce', slug: 'test-shop', plan_id: 'plan_basic', extra_features: [], activity_type: 'ecommerce' };
  const service = buildService(tenant, []);
  let caught: unknown;
  try {
    await service.createOnlineOrder('test-shop', orderDto);
  } catch (error) {
    caught = error;
  }
  // The fake catalog is empty, so the order must fail on the missing product —
  // which proves it passed the entitlement gate instead of being refused there.
  assert.ok(caught instanceof Error, 'the entitled order must reach product validation');
  assert.notEqual((caught as Error).message, STOREFRONT_NOT_ENTITLED_MESSAGE);
  assert.match((caught as Error).message, /غير متاح/);
}

async function testServiceKeepsToggleMessage(): Promise<void> {
  const tenant = { id: 't-ecommerce', slug: 'test-shop', plan_id: 'plan_basic', extra_features: [], activity_type: 'ecommerce' };
  const service = buildService(tenant, [{ key: 'storefront_enabled', value: '"false"' }]);
  let caught: unknown;
  try {
    await service.createOnlineOrder('test-shop', orderDto);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, 'a toggled-off store still refuses orders');
  assert.equal((caught as Error).message, 'المتجر الإلكتروني متوقف حالياً عن استقبال الطلبات');
}

async function main(): Promise<void> {
  testEngineEntitlement();
  testExtraFeaturesParsing();
  await testServiceRejectsUnentitledTenant();
  await testServicePassesGateForEntitledTenant();
  await testServiceKeepsToggleMessage();
  console.log('storefront-order-entitlement.spec: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
