import { strict as assert } from 'node:assert';
import {
  issueOrderAccessToken,
  hashOrderAccessToken,
  verifyOrderAccessToken,
  isSandboxPaymentAllowed,
  resolveOnlineOrderCollection,
  buildOrderTrackingUrl,
  buildPaymentReturnUrl,
  buildGatewayWebhookUrl,
  unwrapConvertedSale,
  type SandboxGatewayFlags,
} from '../../src/modules/storefront/engines/online-order-access.engine';

// Regression coverage for invariants SF-1 / SF-2 / SF-3 (ARCHITECTURE_INVARIANTS.md section 4).
//
// Before: every public "my order" route found the order by `order_number` alone
// (ON-YYMMDD-0001, sequential per tenant). Anyone could read customers' PII, cancel or rewrite
// their orders, or call `mock-pay` to flip any order to `paid` — and `convertToSale` then issued
// the delivery invoice as already collected, so the courier handed the goods over for free.
// Choosing InstaPay at checkout had the same effect with no transfer at all.

function testTokenRoundTrip(): void {
  const { token, hash } = issueOrderAccessToken();
  assert.ok(token.length >= 16, 'token must carry real entropy');
  assert.equal(hash, hashOrderAccessToken(token));
  assert.notEqual(hash, token, 'only the hash is stored');
  assert.equal(verifyOrderAccessToken(token, hash), true);
  assert.equal(verifyOrderAccessToken(`  ${token}  `, hash), true, 'surrounding whitespace is tolerated');
}

function testTokenFailsClosed(): void {
  const { token, hash } = issueOrderAccessToken();
  const other = issueOrderAccessToken();
  assert.equal(verifyOrderAccessToken(other.token, hash), false, 'another order token is rejected');
  assert.equal(verifyOrderAccessToken(undefined, hash), false, 'missing token is rejected');
  assert.equal(verifyOrderAccessToken('', hash), false);
  assert.equal(verifyOrderAccessToken('ON-260921-0001', hash), false, 'the order number is not a credential');
  // Legacy rows have no hash: nobody can reach them publicly, whatever they send.
  assert.equal(verifyOrderAccessToken(token, null), false);
  assert.equal(verifyOrderAccessToken(token, undefined), false);
  assert.equal(verifyOrderAccessToken(token, ''), false);
  assert.equal(verifyOrderAccessToken(token, 'not-a-hash'), false);
  // Presenting the stored hash itself must not work (DB leak must not equal access).
  assert.equal(verifyOrderAccessToken(hash, hash), false);
}

const baseFlags: SandboxGatewayFlags = {
  enabled: true,
  provider: 'paymob',
  testMode: false,
  xpayTestMode: false,
  tapTestMode: false,
  stripeTestMode: false,
};

function testSandboxOnlyInTestMode(): void {
  assert.equal(
    isSandboxPaymentAllowed({ ...baseFlags, enabled: false, provider: 'mock' }),
    false,
    'disabled payment never allows sandbox',
  );
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, provider: 'mock' }), true);
  assert.equal(isSandboxPaymentAllowed(baseFlags), false, 'live paymob must not fall back to the simulator');
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, testMode: true }), true);
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, provider: 'xpay' }), false);
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, provider: 'xpay', xpayTestMode: true }), true);
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, provider: 'tap' }), false);
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, provider: 'tap', tapTestMode: true }), true);
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, provider: 'stripe' }), false);
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, provider: 'stripe', stripeTestMode: true }), true);
  // Another provider's test flag does not leak across.
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, provider: 'stripe', testMode: true }), false);
  assert.equal(isSandboxPaymentAllowed({ ...baseFlags, provider: 'unknown' }), false);
}

function testCollectionRequiresVerifiedMoney(): void {
  // The exact bug: InstaPay chosen, nothing confirmed.
  assert.deepEqual(
    resolveOnlineOrderCollection({
      payment_status: 'pending',
      payment_method: 'instapay_wallet',
      gateway_provider: null,
    }),
    { collected: false, paymentChannel: 'cash', provider: null },
  );
  // Sandbox payment is never money.
  assert.equal(
    resolveOnlineOrderCollection({ payment_status: 'paid', payment_method: 'credit_card', gateway_provider: 'mock' })
      .collected,
    false,
  );
  // "paid" with no provider (e.g. a hand-edited row) is not trusted either.
  assert.equal(
    resolveOnlineOrderCollection({ payment_status: 'paid', payment_method: 'credit_card', gateway_provider: null })
      .collected,
    false,
  );
  // Verified gateway payments are collected on the CARD channel. The sales engine maps any
  // unknown channel name to 'cash', so returning 'stripe' here booked card money into the drawer.
  for (const provider of ['paymob', 'xpay', 'tap', 'stripe']) {
    assert.deepEqual(
      resolveOnlineOrderCollection({
        payment_status: 'paid',
        payment_method: 'credit_card',
        gateway_provider: provider,
      }),
      { collected: true, paymentChannel: 'card', provider },
    );
  }
  // A webhook that reported failure does not count.
  assert.equal(
    resolveOnlineOrderCollection({
      payment_status: 'failed',
      payment_method: 'credit_card',
      gateway_provider: 'stripe',
    }).collected,
    false,
  );
  // Merchant-confirmed InstaPay transfer.
  assert.deepEqual(
    resolveOnlineOrderCollection({
      payment_status: 'paid',
      payment_method: 'instapay_wallet',
      gateway_provider: 'manual',
    }),
    { collected: true, paymentChannel: 'instapay', provider: 'manual' },
  );
  assert.equal(
    resolveOnlineOrderCollection({ payment_status: 'pending', payment_method: 'cod', gateway_provider: null })
      .collected,
    false,
  );
}

function testTrackingLink(): void {
  const { token, hash } = issueOrderAccessToken();
  const url = buildOrderTrackingUrl('https://shop.example.com/', 'MyShop', 'ON-260921-0007', token, {});
  assert.ok(url, 'link is built for a valid origin');
  const [path, fragment] = String(url).split('#');
  assert.equal(path, 'https://shop.example.com/store/myshop/track/ON-260921-0007');
  assert.ok(!path.includes(token), 'the token never appears in the path or query (it would reach server logs)');
  const t = new URLSearchParams(fragment).get('t');
  assert.equal(verifyOrderAccessToken(t, hash), true, 'the fragment token opens exactly this order');
  assert.equal(buildOrderTrackingUrl('', 's', 'ON-1', token, {}), null, 'no origin, no link');
  assert.equal(buildOrderTrackingUrl('javascript:alert(1)', 's', 'ON-1', token, {}), null);
  assert.equal(
    buildOrderTrackingUrl('https://evil.com/path', 's', 'ON-1', token, {}),
    null,
    'origin only, no path smuggling',
  );

  // SF-10: with subdomain stores on, the link is the store's own host and ignores the request origin.
  const env = { STOREFRONT_ROOT_DOMAIN: 'zsystemai.com' } as NodeJS.ProcessEnv;
  const sub = buildOrderTrackingUrl('https://evil.com', 'MyShop', 'ON-1', token, env);
  assert.equal(String(sub).split('#')[0], 'https://myshop.zsystemai.com/track/ON-1');
  assert.equal(new URLSearchParams(String(sub).split('#')[1]).get('t'), token, 'token stays in the fragment');
}

function testGatewayReturnAndWebhookUrls(): void {
  // O67: Tap/Stripe used to return shoppers to `<slug>.z-systems.cloud/storefront/orders` and post
  // Tap webhooks to `z-systems.cloud` — neither is ours, so card payments were never confirmed.
  const on = {
    STOREFRONT_ROOT_DOMAIN: 'zsystemai.com',
    APP_PUBLIC_URL: 'https://app.zsystemai.com',
  } as NodeJS.ProcessEnv;
  assert.equal(
    buildPaymentReturnUrl('https://evil.com', 'MyShop', 'ON-1', on),
    'https://myshop.zsystemai.com/track/ON-1',
  );
  assert.equal(
    buildPaymentReturnUrl('https://zsystemai.com', 'myshop', 'ON-1', {}),
    'https://zsystemai.com/st/myshop/track/ON-1',
  );
  assert.equal(buildPaymentReturnUrl('', 'myshop', 'ON-1', {}), null);
  const returnUrl = String(buildPaymentReturnUrl('https://x.test', 'myshop', 'ON-1', {}));
  assert.ok(!returnUrl.includes('#') && !returnUrl.includes('t='), 'no order token is handed to the gateway (SF-1)');

  assert.equal(
    buildGatewayWebhookUrl('https://evil.com', 'tap', on),
    'https://app.zsystemai.com/api/storefront/webhooks/tap',
    'configured URL wins over the request host',
  );
  assert.equal(
    buildGatewayWebhookUrl('https://app.zsystemai.com/', 'stripe', {}),
    'https://app.zsystemai.com/api/storefront/webhooks/stripe',
  );
  assert.equal(buildGatewayWebhookUrl('https://evil.com/path', 'tap', {}), null);
  assert.equal(buildGatewayWebhookUrl(undefined, 'tap', {}), null);
}

function testConvertedSaleContract(): void {
  // SF-11 Guard: convertToSale must always hand the frontend the pure flat Sale object,
  // never the nested { sale: mappedSale, scope } from getSaleById or { ok: true, sale: mappedSale } from createSale.
  // A wrapper leak causes the POS dialog and print engine to see sale.total=undefined (showing 0.00),
  // sale.docNo=undefined (showing "إيصال بيع undefined"), and sale.items=undefined (showing "لا توجد أصناف").

  // Case 1: getSaleById wrapper { sale: mappedSale, scope } (the exact bug that occurred on convertToSale)
  const getSaleByIdWrapper = {
    sale: {
      id: 15,
      docNo: 'INV-260924-0015',
      total: 1280,
      items: [{ productId: 1, name: 'صنف متجر', quantity: 2, price: 640 }],
      customerName: 'سيد محمد',
      orderType: 'delivery',
      deliveryRepId: 3,
    },
    scope: { tenantId: 'tenant-1', accountId: 1 },
  };
  const unwrapped1 = unwrapConvertedSale(getSaleByIdWrapper);
  assert.ok(unwrapped1, 'unwrapped sale must not be null');
  assert.equal(unwrapped1.id, 15);
  assert.equal(unwrapped1.docNo, 'INV-260924-0015');
  assert.equal(unwrapped1.total, 1280);
  assert.equal(unwrapped1.customerName, 'سيد محمد');
  assert.equal(Array.isArray(unwrapped1.items), true);
  assert.equal(unwrapped1.items.length, 1);
  assert.equal(unwrapped1.sale, undefined, 'CRITICAL GUARD: must never leak nested .sale wrapper to frontend');
  assert.equal(unwrapped1.scope, undefined, 'CRITICAL GUARD: must never leak internal query .scope to frontend');

  // Case 2: createSale wrapper { ok: true, sale: mappedSale }
  const createSaleWrapper = {
    ok: true,
    sale: {
      id: 15,
      docNo: 'INV-260924-0015',
      total: 1280,
      items: [{ productId: 1, name: 'صنف متجر', quantity: 2, price: 640 }],
    },
  };
  const unwrapped2 = unwrapConvertedSale(createSaleWrapper);
  assert.equal(unwrapped2.id, 15);
  assert.equal(unwrapped2.docNo, 'INV-260924-0015');
  assert.equal(unwrapped2.total, 1280);
  assert.equal(unwrapped2.sale, undefined, 'CRITICAL GUARD: must not nest .sale');
  assert.equal(unwrapped2.ok, undefined, 'CRITICAL GUARD: must not nest .ok');

  // Case 3: Flat mappedSale passed directly
  const flatSale = { id: 15, docNo: 'INV-260924-0015', total: 1280 };
  const unwrapped3 = unwrapConvertedSale(flatSale);
  assert.equal(unwrapped3.id, 15);
  assert.equal(unwrapped3.docNo, 'INV-260924-0015');
  assert.equal(unwrapped3.total, 1280);

  // Case 4: Null / undefined edge cases
  assert.equal(unwrapConvertedSale(null), null);
  assert.equal(unwrapConvertedSale(undefined), null);
}

testTokenRoundTrip();
testGatewayReturnAndWebhookUrls();
testTrackingLink();
testTokenFailsClosed();
testSandboxOnlyInTestMode();
testCollectionRequiresVerifiedMoney();
testConvertedSaleContract();
console.log('storefront-order-access.spec: all checks passed');
