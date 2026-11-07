import { strict as assert } from 'node:assert';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import {
  isStorefrontEntitledForOrders,
  isStorefrontTrialActive,
  STOREFRONT_NOT_ENTITLED_MESSAGE,
  type StorefrontTenantEntitlementRow,
} from '../../src/modules/storefront/engines/storefront-entitlement.engine';

/*
 * INV-STOREFRONT-ORDER-PRICE: an ACTIVE trial is the evaluation window, so it
 * entitles a commerce tenant to take storefront orders even when its plan row
 * does not grant the storefront.
 *
 * Live case (2026-11-07, test10k): Ultimate plan, retail, trial to
 * 2026-11-07 + 97 days. The plan resolver refuses Ultimate (hasFeature
 * hard-codes plan_ultimate + storefront to false before the seeded
 * plan_features row is consulted), so createOnlineOrder refused the order —
 * and the frontend demo fallback fabricated the fake order ORD-180027 (item
 * price 0, delivery 35.00 despite free delivery, never persisted, invisible
 * to admin). The refusal for a genuinely unpaid tenant is user-decided and
 * stays; only the active-trial window is exempted, narrowly and fail-closed.
 *
 * Pinned here, driving the real engine and the real service:
 * - trial retail + Ultimate with a future expiry => entitled (the live case);
 * - trial expired / missing expiry / non-trial Ultimate => refused;
 * - trial warehousing / services / contracting / maritime => refused
 *   (structural exclusions are never re-granted by a trial);
 * - an explicit '-storefront' opt-out still wins over the trial;
 * - at the service level the trial tenant passes the gate (fails later on
 *   the missing product) while the non-trial Ultimate tenant is refused
 *   with the named entitlement message.
 */

const checker = new PlanFeatureService(undefined as any);
const NOW = new Date('2026-11-07T12:00:00Z');
const FUTURE = new Date('2027-02-12T00:00:00Z');
const PAST = new Date('2026-11-01T00:00:00Z');

function row(
  activityType: string,
  planId: string | null = 'plan_ultimate',
  extraFeatures: unknown = [],
  status: string | null = null,
  trialEndsAt: string | Date | null = null,
): StorefrontTenantEntitlementRow {
  return { plan_id: planId, extra_features: extraFeatures, activity_type: activityType, status, trial_ends_at: trialEndsAt };
}

function testTrialWindow(): void {
  // The live test10k case: retail + Ultimate + active trial => entitled.
  assert.equal(isStorefrontEntitledForOrders(row('retail_general', 'plan_ultimate', [], 'trial', FUTURE), checker, NOW), true);
  // A trial also entitles a real shop on a basic plan (evaluation window).
  assert.equal(isStorefrontEntitledForOrders(row('pharmacy', 'plan_basic', [], 'trial', FUTURE), checker, NOW), true);
  assert.equal(isStorefrontTrialActive(row('retail_general', 'plan_ultimate', [], 'trial', FUTURE), NOW), true);
  // The boundary is strict: at the expiry instant the window is closed.
  assert.equal(isStorefrontEntitledForOrders(row('retail_general', 'plan_ultimate', [], 'trial', NOW), checker, NOW), false);
  // Expired trial => the plan decision governs again (Ultimate refused).
  assert.equal(isStorefrontEntitledForOrders(row('retail_general', 'plan_ultimate', [], 'trial', PAST), checker, NOW), false);
  assert.equal(isStorefrontTrialActive(row('retail_general', 'plan_ultimate', [], 'trial', PAST), NOW), false);
  // Trial status with no expiry on file grants nothing (fail-closed).
  assert.equal(isStorefrontEntitledForOrders(row('retail_general', 'plan_ultimate', [], 'trial', null), checker, NOW), false);
  // Malformed expiry grants nothing.
  assert.equal(isStorefrontTrialActive(row('retail_general', 'plan_ultimate', [], 'trial', 'not-a-date'), NOW), false);
  // A non-trial tenant is refused exactly as before (pinned Batch 10 rule).
  assert.equal(isStorefrontEntitledForOrders(row('retail_general', 'plan_ultimate', [], 'active', FUTURE), checker, NOW), false);
  assert.equal(isStorefrontEntitledForOrders(row('retail_general', 'plan_ultimate'), checker, NOW), false);
}

function testTrialNeverRegrantsStructuralExclusions(): void {
  // Warehousing and services structurally exclude the storefront, trial or not.
  assert.equal(isStorefrontEntitledForOrders(row('warehousing', 'plan_basic', [], 'trial', FUTURE), checker, NOW), false);
  assert.equal(isStorefrontEntitledForOrders(row('services', 'plan_basic', [], 'trial', FUTURE), checker, NOW), false);
  // The isolated pillars are never re-granted by a trial either.
  assert.equal(isStorefrontEntitledForOrders(row('contracting', 'plan_basic', [], 'trial', FUTURE), checker, NOW), false);
  assert.equal(isStorefrontEntitledForOrders(row('maritime_freight', 'plan_basic', [], 'trial', FUTURE), checker, NOW), false);
  // An explicit opt-out wins over the trial.
  assert.equal(isStorefrontEntitledForOrders(row('retail_general', 'plan_ultimate', ['-storefront'], 'trial', FUTURE), checker, NOW), false);
  // An explicit grant still works without a trial (unchanged behavior).
  assert.equal(isStorefrontEntitledForOrders(row('warehousing', 'plan_basic', ['storefront']), checker, NOW), true);
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

async function testServicePassesGateForTrialTenant(): Promise<void> {
  const tenant = {
    id: 't-test10k', slug: 'test10k', plan_id: 'plan_ultimate', extra_features: [],
    activity_type: 'retail_general', status: 'trial', trial_ends_at: FUTURE,
  };
  const service = buildService(tenant, []);
  let caught: unknown;
  try {
    await service.createOnlineOrder('test10k', orderDto);
  } catch (error) {
    caught = error;
  }
  // The fake catalog is empty, so the order must fail on the missing product —
  // which proves it passed the entitlement gate instead of being refused there.
  assert.ok(caught instanceof Error, 'the trial order must reach product validation');
  assert.notEqual((caught as Error).message, STOREFRONT_NOT_ENTITLED_MESSAGE);
  assert.match((caught as Error).message, /غير متاح/);
}

async function testServiceStillRefusesNonTrialUltimate(): Promise<void> {
  const tenant = {
    id: 't-ultimate', slug: 'test-shop', plan_id: 'plan_ultimate', extra_features: [],
    activity_type: 'retail_general', status: 'active', trial_ends_at: FUTURE,
  };
  const service = buildService(tenant, []);
  let caught: unknown;
  try {
    await service.createOnlineOrder('test-shop', orderDto);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, 'a non-trial Ultimate tenant must be refused');
  assert.equal((caught as Error).message, STOREFRONT_NOT_ENTITLED_MESSAGE);
}

async function main(): Promise<void> {
  testTrialWindow();
  testTrialNeverRegrantsStructuralExclusions();
  await testServicePassesGateForTrialTenant();
  await testServiceStillRefusesNonTrialUltimate();
  console.log('storefront-order-trial-entitlement.spec: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
