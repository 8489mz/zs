/*
New file: backend/test/critical/storefront-line-total-digits.spec.ts
Pins storefront quote totals at the tenant's canonical book digits
(money-precision program, package 6;
INV-STOREFRONT-LINE-TOTAL-DIGITS).

THE GAP: quoteOnlineOrder and createOnlineOrder rounded every line
total and subtotal with a hand-rolled `roundFactor` driven by a
three-currency list (KWD/BHD/OMR only). The canonical 3-decimal set
also has JOD, TND, IQD, and LYD — so a Jordanian tenant's quote cut
10.125 to 10.13 while the per-line pricing engines (closed by the
storefront-pricing package) already returned 10.125. The quote
total disagreed with the priced line it displayed.

THE FIX: both functions derive one `moneyDigits` from the same
storefrontMoneyDigits helper the pricing engines already use and
round every total through the canonical engine; the hand-rolled
factor and the 3-currency list are gone. The rounding formula
itself is unchanged (Math.round at the factor), so KWD/BHD/OMR and
2-decimal tenants compute exactly what they computed before — the
only change is that the four missing 3-decimal currencies now
round at 3 instead of 2. The WhatsApp display formatter in
createOnlineOrder keeps its EGP whole-number special case and now
takes its 3-decimal branch from the same digits value.

WHAT THIS PINS (real quoteOnlineOrder, stubbed Kysely db):
- A JOD tenant quotes 10.125 / 0.005 / 0.005 / 10.125 (the old
  code gave 10.13 / 0.01 / 0.01 / 10.13) — the fail-first
  discrimination.
- KWD and EGP quotes are unchanged.
- A settings currency overrides the tenant currency, the same
  source storefrontMoneyDigits reads.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { StorefrontOrderQuoteService } from '../../src/modules/storefront/services/storefront-order-quote.service';

function makeFakeDb(rowsByTable: Record<string, any[]>): any {
  const eb: any = Object.assign((..._args: any[]) => true, {
    or: (..._args: any[]) => true,
    and: (..._args: any[]) => true,
  });
  const makeQuery = (table: string): any => {
    const q: any = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'execute') return async () => rowsByTable[table] ?? [];
        if (prop === 'executeTakeFirst') return async () => (rowsByTable[table] ?? [])[0];
        if (prop === 'then') return undefined;
        return (...args: any[]) => {
          for (const arg of args) {
            if (typeof arg === 'function') {
              try {
                arg(eb);
              } catch {
                /* expression-builder shapes only */
              }
            }
          }
          return q;
        };
      },
      apply() {
        return q;
      },
    });
    return q;
  };
  return { selectFrom: (table: string) => makeQuery(table) };
}

const PRODUCT = {
  id: 1,
  name: 'منتج',
  barcode: '',
  retail_price: 10.125,
  metadata: null,
  is_active: true,
  item_type: 'product',
};

// The quote lives in the T1 slice now (storefront split 2026-11-16). The slice
// captures its deps at construction, so stubbing methods on a facade instance
// no longer reaches it — construct the slice directly with stub deps. The
// charges stub is assigned on the slice instance: quoteOnlineOrder calls the
// slice's own resolveOrderCharges, and an own property shadows the prototype
// method, so the fixed 0.005/0.005 charges still drive the digits pins.
function makeService(tenantCurrency: string, settingsCurrency?: string): any {
  const svc: any = new StorefrontOrderQuoteService({
    db: makeFakeDb({ products: [PRODUCT], product_offers: [] }),
    getTenantBySlug: async () => ({ id: 'tenant-1', currency: tenantCurrency, slug: 'shop', activity_type: null }),
    getTenantSettingsMap: async () => new Map<string, string>(settingsCurrency ? [['currency', settingsCurrency]] : []),
  } as any);
  svc.resolveOrderCharges = async () => ({
    deliveryFee: 0.005,
    deliveryZoneId: null,
    deliveryZoneName: null,
    discountAmount: 0.005,
    appliedCouponCode: null,
    couponId: null,
  });
  return svc;
}

async function main(): Promise<void> {
  const dto = { items: [{ productId: 1, quantity: 1 }] };

  const jod = await makeService('JOD').quoteOnlineOrder('shop', dto);
  assert.equal(jod.ok, true);
  assert.equal(jod.items[0].total, 10.125);
  assert.equal(jod.subtotal, 10.125);
  assert.equal(jod.discountAmount, 0.005);
  assert.equal(jod.deliveryFee, 0.005);
  assert.equal(jod.totalAmount, 10.125);

  const kwd = await makeService('KWD').quoteOnlineOrder('shop', dto);
  assert.equal(kwd.items[0].total, 10.125);
  assert.equal(kwd.subtotal, 10.125);
  assert.equal(kwd.totalAmount, 10.125);

  const egp = await makeService('EGP').quoteOnlineOrder('shop', dto);
  assert.equal(egp.items[0].total, 10.13);
  assert.equal(egp.subtotal, 10.13);
  assert.equal(egp.discountAmount, 0.01);
  assert.equal(egp.deliveryFee, 0.01);
  assert.equal(egp.totalAmount, 10.13);

  // Settings currency wins over the tenant currency, as storefrontMoneyDigits reads it.
  const overridden = await makeService('EGP', 'JOD').quoteOnlineOrder('shop', dto);
  assert.equal(overridden.items[0].total, 10.125);
  assert.equal(overridden.subtotal, 10.125);

  console.log('Storefront line total digits tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
