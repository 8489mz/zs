import { strict as assert } from 'node:assert';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';

// O62 (ARCHITECTURE_INVARIANTS.md §8): billing a storefront order from the POS cart used to run the
// order's own coupon discount and line prices through the cashier gates, so a cashier without
// canDiscount was asked for a manager PIN — or the discount was dropped and the customer overcharged.
// The terms now come from the stored order, and only from it.

function serviceWith(order: Record<string, unknown> | undefined) {
  const service = Object.create(SalesWriteService.prototype) as any;
  const builder: any = new Proxy(function () {} as any, {
    get(_t, prop: string) {
      if (prop === 'executeTakeFirst') return async () => order;
      if (prop === 'execute') return async () => (order ? [order] : []);
      if (prop === 'catch') return (..._args: unknown[]) => builder;
      if (prop === 'then') return undefined;
      return () => builder;
    },
    apply: () => builder,
  });
  service.db = { selectFrom: () => builder };
  return service;
}

const ORDER = {
  id: 41,
  status: 'processing',
  sale_id: null,
  discount_amount: 25,
  items_json: JSON.stringify([
    { productId: 7, unitPrice: 90 },
    { productId: 9, price: 45 },
  ]),
};

async function testOrderTermsComeFromTheStoredOrder(): Promise<void> {
  const terms = await serviceWith(ORDER).resolveOnlineOrderTerms(41, 'acme');
  assert.equal(terms.approvedDiscount, 25, "the order's own coupon discount is pre-approved");
  assert.deepEqual(terms.approvedUnitPrices, { 7: 90, 9: 45 }, 'each line price the server fixed is pre-approved');
}

async function testAClosedOrderApprovesNothing(): Promise<void> {
  for (const order of [{ ...ORDER, status: 'cancelled' }, { ...ORDER, sale_id: 900 }, undefined]) {
    const terms = await serviceWith(order).resolveOnlineOrderTerms(41, 'acme');
    assert.equal(terms, undefined, 'a cancelled, already invoiced or missing order grants no approval');
  }
}

async function testCallerTermsAreKeptAndNeverShrunk(): Promise<void> {
  // convertToSale already passes its own terms; the two are merged, taking the larger discount.
  const terms = await serviceWith(ORDER).resolveOnlineOrderTerms(41, 'acme', {
    approvedDiscount: 40,
    approvedUnitPrices: { 3: 10 },
  });
  assert.equal(terms.approvedDiscount, 40);
  assert.deepEqual(terms.approvedUnitPrices, { 3: 10, 7: 90, 9: 45 });
}

(async () => {
  await testOrderTermsComeFromTheStoredOrder();
  await testAClosedOrderApprovesNothing();
  await testCallerTermsAreKeptAndNeverShrunk();
  console.log('online-order-pos-terms.spec: all checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
