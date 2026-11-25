import { strict as assert } from 'node:assert';
import * as crypto from 'crypto';
import { StorefrontPaymentService } from '../../src/modules/storefront/storefront-payment.service';
import {
  gatewayMinorUnitExponent,
  resolveGatewayCurrency,
  toGatewayMajorAmount,
  toGatewayMinorAmount,
} from '../../src/modules/storefront/engines/gateway-amount.engine';
import { hashOrderAccessToken } from '../../src/modules/storefront/engines/online-order-access.engine';

/**
 * Critical Regression Test Suite for Storefront Gateway Amounts & Currencies
 * (Invariant INV-GATEWAY-CURRENCY-AMOUNTS).
 *
 * Pins three Phase 1 findings at once: Stripe minor-unit conversion must use
 * the currency's ISO 4217 exponent (F1), Tap charge amounts must keep the
 * currency's own decimals instead of truncating to 2 (F4), and no gateway
 * may silently substitute another currency for the tenant's base currency
 * (F0: Tap forced SAR for EGP tenants). Pure-helper pins plus service-level
 * pins driving the real StorefrontPaymentService with a mock DB and a
 * captured fetch, mirroring storefront-payment-webhooks.spec.ts.
 */

interface MockOrder {
  id: number;
  tenant_id: string;
  order_number: string;
  total_amount: number;
  payment_status: string;
  status: string;
  gateway_provider?: string;
  gateway_transaction_id?: string;
  gateway_order_id?: string;
  stock_reserved?: boolean;
  access_token_hash?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  sale_id?: number | null;
}

interface MockTenant {
  id: string;
  slug: string;
  business_name: string;
}

function createMockDb(orders: MockOrder[], tenants: MockTenant[], settingsMap: Record<string, string>) {
  const db: any = {
    transaction: () => ({
      execute: async (cb: any) => cb(db),
    }),
    selectFrom: (table: string) => {
      if (table === 'settings') {
        return {
          select: () => ({
            where: () => ({
              where: (col: any, op: any, val: any) => ({
                execute: async () => {
                  return Object.entries(settingsMap).map(([key, value]) => ({ key, value }));
                },
                executeTakeFirst: async () => {
                  const key = typeof val === 'string' ? val : 'currency';
                  if (key in settingsMap) {
                    return { value: settingsMap[key] };
                  }
                  return undefined;
                },
              }),
            }),
          }),
        };
      }
      if (table === 'tenants') {
        return {
          selectAll: () => ({
            where: (col: any, op: any, val: any) => ({
              executeTakeFirst: async () => {
                if (col === 'slug') return tenants.find((t) => t.slug === val);
                return undefined;
              },
            }),
          }),
        };
      }
      if (table === 'online_orders') {
        const createQueryBuilder = () => {
          let selectedId: any = null;
          let filterCol: any = null;
          let filterVal: any = null;
          const builder: any = {
            where: (col: any, op: any, val: any) => {
              if (col === 'id') selectedId = val;
              else {
                filterCol = col;
                filterVal = val;
              }
              return builder;
            },
            forUpdate: () => builder,
            limit: (n: number) => ({
              execute: async () => orders.slice(0, n),
            }),
            executeTakeFirst: async () => {
              if (selectedId != null) return orders.find((o) => o.id === selectedId) || orders[0];
              if (filterCol === 'order_number') return orders.find((o) => o.order_number === filterVal) || orders[0];
              if (filterCol === 'gateway_order_id')
                return orders.find((o) => o.gateway_order_id === filterVal) || orders[0];
              return orders[0];
            },
            execute: async () => {
              if (filterCol === 'order_number') return orders.filter((o) => o.order_number === filterVal);
              if (filterCol === 'gateway_order_id') return orders.filter((o) => o.gateway_order_id === filterVal);
              return orders;
            },
          };
          return builder;
        };
        return {
          selectAll: () => createQueryBuilder(),
        };
      }
      return {};
    },
    updateTable: (table: string) => ({
      set: (updates: any) => ({
        where: (col: any, op: any, val: any) => ({
          where: (col2?: any, op2?: any, val2?: any) => ({
            execute: async () => {
              const targetId = col === 'id' ? val : col2 === 'id' ? val2 : null;
              const order = targetId ? orders.find((o) => o.id === targetId) : orders[0];
              if (order) Object.assign(order, updates);
            },
          }),
          execute: async () => {
            const order = orders.find((o) => o.id === val);
            if (order) Object.assign(order, updates);
          },
        }),
      }),
    }),
  };
  return db;
}

async function testPureHelpers(): Promise<void> {
  // Stripe minor units follow the currency exponent, not a hard-coded x100.
  assert.equal(toGatewayMinorAmount(10.123, 'KWD'), 10123);
  assert.equal(toGatewayMinorAmount(10.123, 'BHD'), 10123);
  assert.equal(toGatewayMinorAmount(10.123, 'OMR'), 10123);
  assert.equal(toGatewayMinorAmount(10.12, 'USD'), 1012);
  assert.equal(toGatewayMinorAmount(300, 'USD'), 30000);
  assert.equal(toGatewayMinorAmount(500, 'JPY'), 500);
  assert.equal(toGatewayMinorAmount(500, 'KRW'), 500);
  assert.equal(toGatewayMinorAmount(10.123, 'EGP'), 1012);
  assert.equal(gatewayMinorUnitExponent('KWD'), 3);
  assert.equal(gatewayMinorUnitExponent('USD'), 2);
  assert.equal(gatewayMinorUnitExponent('JPY'), 0);
  assert.equal(gatewayMinorUnitExponent('garbage'), 2);

  // Tap major amounts keep the currency's own decimals.
  assert.equal(toGatewayMajorAmount(10.123, 'KWD'), 10.123);
  assert.equal(toGatewayMajorAmount(10.129, 'USD'), 10.13);
  assert.equal(toGatewayMajorAmount(100, 'EGP'), 100);

  // Currency resolution never substitutes another currency for the base.
  assert.equal(resolveGatewayCurrency('tap', 'EGP'), 'EGP');
  assert.equal(resolveGatewayCurrency('tap', 'KWD'), 'KWD');
  // An unset base keeps Tap's historical GCC default; only a configured
  // currency must never be overridden.
  assert.equal(resolveGatewayCurrency('tap', ''), 'SAR');
  assert.equal(resolveGatewayCurrency('stripe', 'KWD'), 'KWD');
  assert.equal(resolveGatewayCurrency('stripe', ''), 'USD');
  assert.equal(resolveGatewayCurrency('paymob', 'KWD'), 'EGP');
  assert.equal(resolveGatewayCurrency('xpay', 'SAR'), 'EGP');

  console.log('  -> Gateway amount helpers: exponents 0/2/3, Tap major rounding, no currency substitution.');
}

function withCapturedFetch(responseJson: any) {
  const captured: Array<{ url: string; init: any }> = [];
  const previousFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, init: any) => {
    captured.push({ url: String(url), init });
    return {
      ok: true,
      json: async () => responseJson,
      text: async () => '',
    };
  };
  return {
    captured,
    restore: () => {
      (globalThis as any).fetch = previousFetch;
    },
  };
}

function initiationFixture(totalAmount: number, orderNumber: string) {
  const token = 'test-access-token-123456';
  const order: MockOrder = {
    id: 1,
    tenant_id: 'tenant-1',
    order_number: orderNumber,
    total_amount: totalAmount,
    payment_status: 'pending',
    status: 'pending',
    access_token_hash: hashOrderAccessToken(token),
    customer_name: 'Test Customer',
    customer_phone: '96550000000',
    customer_address: 'Test Street',
    sale_id: null,
  };
  const tenant: MockTenant = { id: 'tenant-1', slug: 'test-store', business_name: 'Test Store' };
  return { order, tenant, token };
}

async function testStripeInitiationAmounts(): Promise<void> {
  const previousAppUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = 'https://shop.example.com';
  try {
    // KWD: 10.123 must charge 10,123 fils, not 1,012.
    {
      const { order, tenant, token } = initiationFixture(10.123, 'ON-KWD-1');
      const db = createMockDb([order], [tenant], {
        currency: '"KWD"',
        storefront_online_payment_enabled: 'true',
        storefront_online_payment_provider: 'stripe',
        storefront_stripe_secret_key: 'sk_test_stripe_123',
      });
      const service = new StorefrontPaymentService(db);
      const { captured, restore } = withCapturedFetch({
        url: 'https://checkout.stripe.com/pay/cs_test',
        id: 'cs_test_kwd',
      });
      try {
        const result = await service.initiatePaymentSession(
          'test-store',
          'ON-KWD-1',
          token,
          'https://shop.example.com',
        );
        assert.equal(result.ok, true);
      } finally {
        restore();
      }
      assert.equal(captured.length, 1);
      const params = new URLSearchParams(String(captured[0].init.body));
      assert.equal(params.get('line_items[0][price_data][unit_amount]'), '10123');
      assert.equal(params.get('line_items[0][price_data][currency]'), 'kwd');
    }

    // USD regression: 2-decimal behaviour is unchanged.
    {
      const { order, tenant, token } = initiationFixture(10.12, 'ON-USD-1');
      const db = createMockDb([order], [tenant], {
        currency: '"USD"',
        storefront_online_payment_enabled: 'true',
        storefront_online_payment_provider: 'stripe',
        storefront_stripe_secret_key: 'sk_test_stripe_123',
      });
      const service = new StorefrontPaymentService(db);
      const { captured, restore } = withCapturedFetch({
        url: 'https://checkout.stripe.com/pay/cs_test',
        id: 'cs_test_usd',
      });
      try {
        const result = await service.initiatePaymentSession(
          'test-store',
          'ON-USD-1',
          token,
          'https://shop.example.com',
        );
        assert.equal(result.ok, true);
      } finally {
        restore();
      }
      assert.equal(captured.length, 1);
      const params = new URLSearchParams(String(captured[0].init.body));
      assert.equal(params.get('line_items[0][price_data][unit_amount]'), '1012');
      assert.equal(params.get('line_items[0][price_data][currency]'), 'usd');
    }
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = previousAppUrl;
  }
  console.log('  -> Stripe initiation: KWD 10.123 -> 10123 fils; USD behaviour unchanged.');
}

async function testTapInitiationAmounts(): Promise<void> {
  const previousAppUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = 'https://shop.example.com';
  try {
    // KWD: Tap must charge the full 10.123, not a 2dp truncation.
    {
      const { order, tenant, token } = initiationFixture(10.123, 'ON-TAP-KWD-1');
      const db = createMockDb([order], [tenant], {
        currency: '"KWD"',
        storefront_online_payment_enabled: 'true',
        storefront_online_payment_provider: 'tap',
        storefront_tap_secret_key: 'sk_test_tap_123',
      });
      const service = new StorefrontPaymentService(db);
      const { captured, restore } = withCapturedFetch({
        id: 'chg_test_kwd',
        transaction: { url: 'https://checkout.tap.company/x' },
      });
      try {
        const result = await service.initiatePaymentSession(
          'test-store',
          'ON-TAP-KWD-1',
          token,
          'https://shop.example.com',
        );
        assert.equal(result.ok, true);
      } finally {
        restore();
      }
      assert.equal(captured.length, 1);
      const payload = JSON.parse(String(captured[0].init.body));
      assert.equal(payload.amount, 10.123);
      assert.equal(payload.currency, 'KWD');
    }

    // EGP: Tap must charge EGP, never a substituted SAR.
    {
      const { order, tenant, token } = initiationFixture(100, 'ON-TAP-EGP-1');
      const db = createMockDb([order], [tenant], {
        currency: '"EGP"',
        storefront_online_payment_enabled: 'true',
        storefront_online_payment_provider: 'tap',
        storefront_tap_secret_key: 'sk_test_tap_123',
      });
      const service = new StorefrontPaymentService(db);
      const { captured, restore } = withCapturedFetch({
        id: 'chg_test_egp',
        transaction: { url: 'https://checkout.tap.company/y' },
      });
      try {
        const result = await service.initiatePaymentSession(
          'test-store',
          'ON-TAP-EGP-1',
          token,
          'https://shop.example.com',
        );
        assert.equal(result.ok, true);
      } finally {
        restore();
      }
      assert.equal(captured.length, 1);
      const payload = JSON.parse(String(captured[0].init.body));
      assert.equal(payload.amount, 100);
      assert.equal(payload.currency, 'EGP');
    }
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = previousAppUrl;
  }
  console.log('  -> Tap initiation: KWD keeps 10.123; EGP charges EGP, never SAR.');
}

function tapHash(body: any, secret: string): string {
  const strToHash = `${body.id || ''}${Number(body.amount || 0).toFixed(2)}${body.currency || ''}${body.gateway?.reference || ''}${body.payment_reference || ''}${body.status || ''}${body.created || ''}`;
  return crypto.createHmac('sha256', secret).update(strToHash).digest('hex');
}

async function testTapWebhookAmounts(): Promise<void> {
  const secret = 'sk_test_tap_123';

  // A truncated legacy charge (10.120 reported for a 10.123 order) must go
  // to review, not to paid.
  {
    const order: MockOrder = {
      id: 4,
      tenant_id: 'tenant-1',
      order_number: 'ON-TAP-KWD-2',
      total_amount: 10.123,
      payment_status: 'pending',
      status: 'pending',
      gateway_provider: 'tap',
      gateway_order_id: 'chg_test_456',
    };
    const body: any = {
      id: 'chg_test_456',
      status: 'CAPTURED',
      amount: 10.12,
      currency: 'KWD',
      metadata: { orderNumber: 'ON-TAP-KWD-2', tenantId: 'tenant-1' },
    };
    const db = createMockDb([{ ...order }], [], { currency: '"KWD"', storefront_tap_secret_key: secret });
    const service = new StorefrontPaymentService(db);
    const result = await service.processTapWebhook({ hashstring: tapHash(body, secret) }, body);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'review_required');
  }

  // The full 10.123 charge marks the order paid.
  {
    const order: MockOrder = {
      id: 5,
      tenant_id: 'tenant-1',
      order_number: 'ON-TAP-KWD-3',
      total_amount: 10.123,
      payment_status: 'pending',
      status: 'pending',
      gateway_provider: 'tap',
      gateway_order_id: 'chg_test_457',
    };
    const body: any = {
      id: 'chg_test_457',
      status: 'CAPTURED',
      amount: 10.123,
      currency: 'KWD',
      metadata: { orderNumber: 'ON-TAP-KWD-3', tenantId: 'tenant-1' },
    };
    const db = createMockDb([{ ...order }], [], { currency: '"KWD"', storefront_tap_secret_key: secret });
    const service = new StorefrontPaymentService(db);
    const result = await service.processTapWebhook({ hashstring: tapHash(body, secret) }, body);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'paid');
  }

  // An EGP tenant's Tap webhook is verified in EGP, never SAR.
  {
    const order: MockOrder = {
      id: 6,
      tenant_id: 'tenant-1',
      order_number: 'ON-TAP-EGP-2',
      total_amount: 100,
      payment_status: 'pending',
      status: 'pending',
      gateway_provider: 'tap',
      gateway_order_id: 'chg_test_458',
    };
    const body: any = {
      id: 'chg_test_458',
      status: 'CAPTURED',
      amount: 100,
      currency: 'EGP',
      metadata: { orderNumber: 'ON-TAP-EGP-2', tenantId: 'tenant-1' },
    };
    const db = createMockDb([{ ...order }], [], { currency: '"EGP"', storefront_tap_secret_key: secret });
    const service = new StorefrontPaymentService(db);
    const result = await service.processTapWebhook({ hashstring: tapHash(body, secret) }, body);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'paid');
  }

  console.log('  -> Tap webhooks: truncated KWD charge -> review; full charge -> paid; EGP verified in EGP.');
}

async function testStripeWebhookAmounts(): Promise<void> {
  const secret = 'whsec_stripe_test';

  async function runStripeWebhook(order: MockOrder, amountTotal: number, currency: string) {
    const body = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_kwd',
          client_reference_id: 'tenant-1__ON-STR-KWD-1',
          payment_intent: 'pi_test_999',
          payment_status: 'paid',
          amount_total: amountTotal,
          currency,
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const db = createMockDb([{ ...order }], [], {
      currency: '"KWD"',
      storefront_stripe_webhook_secret: secret,
    });
    const service = new StorefrontPaymentService(db);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${currentTimestamp}.${rawBody.toString('utf8')}`;
    const validSig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    return service.processStripeWebhook({ 'stripe-signature': `t=${currentTimestamp},v1=${validSig}` }, body, rawBody);
  }

  const order: MockOrder = {
    id: 7,
    tenant_id: 'tenant-1',
    order_number: 'ON-STR-KWD-1',
    total_amount: 10.123,
    payment_status: 'pending',
    status: 'pending',
    gateway_provider: 'stripe',
    gateway_order_id: 'cs_test_kwd',
  };

  // The correct 10,123 fils charge marks the order paid.
  {
    const result = await runStripeWebhook(order, 10123, 'kwd');
    assert.equal(result.ok, true);
    assert.equal(result.status, 'paid');
  }

  // The 10x undercharge (1,012 fils) must go to review, not to paid.
  {
    const result = await runStripeWebhook(order, 1012, 'kwd');
    assert.equal(result.ok, true);
    assert.equal(result.status, 'review_required');
  }

  console.log('  -> Stripe webhooks: 10123 fils -> paid; 1012 fils undercharge -> review.');
}

async function runAll(): Promise<void> {
  console.log('[GATEWAY-AMOUNTS] Running Storefront Gateway Amounts & Currencies Test Suite...');
  await testPureHelpers();
  await testStripeInitiationAmounts();
  await testTapInitiationAmounts();
  await testTapWebhookAmounts();
  await testStripeWebhookAmounts();
  console.log('[GATEWAY-AMOUNTS] ALL GATEWAY AMOUNT TESTS PASSED!');
}

runAll().catch((err) => {
  console.error('[GATEWAY-AMOUNTS] TEST FAILED:', err);
  process.exit(1);
});
