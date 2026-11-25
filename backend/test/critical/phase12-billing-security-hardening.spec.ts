import { strict as assert } from 'node:assert';
import * as crypto from 'crypto';
import { LoginAttemptLimiter } from '../../src/common/utils/login-attempt-limiter';
import { XPayGatewayService } from '../../src/modules/tenant-subscription/gateways/xpay.gateway';
import { PaymobGatewayService } from '../../src/modules/tenant-subscription/gateways/paymob.gateway';
import { StripeGatewayService } from '../../src/modules/tenant-subscription/gateways/stripe.gateway';

// Regression coverage for the fail-open -> fail-closed webhook fixes and the
// employee/driver-portal brute-force guard added during the September 2026
// call-path audit (see ARCHITECTURE_INVARIANTS.md F11-F15, O11, O15).

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function testLoginAttemptLimiter(): Promise<void> {
  const limiter = new LoginAttemptLimiter(3, 60_000, 60_000);

  // 1. Allows attempts under the threshold
  limiter.assertNotLocked('user-a');
  limiter.recordFailure('user-a');
  limiter.assertNotLocked('user-a');
  limiter.recordFailure('user-a');
  limiter.assertNotLocked('user-a');

  // 2. Locks after reaching maxAttempts
  limiter.recordFailure('user-a');
  assert.throws(() => limiter.assertNotLocked('user-a'), /تم إيقاف محاولات الدخول/, 'Should lock after 3 failures');

  // 3. A different key is unaffected (per-identifier isolation)
  limiter.assertNotLocked('user-b');

  // 4. recordSuccess clears the lock/counter
  const limiter2 = new LoginAttemptLimiter(2, 60_000, 60_000);
  limiter2.recordFailure('user-c');
  limiter2.recordSuccess('user-c');
  limiter2.recordFailure('user-c');
  limiter2.assertNotLocked('user-c'); // only 1 failure since reset, still under threshold

  console.log('  -> LoginAttemptLimiter: lock-after-threshold, per-key isolation, and reset-on-success verified.');
}

async function testXpayWebhookFailClosed(): Promise<void> {
  // 1. Fail-closed: no secret configured at all -> rejected regardless of body/signature shape.
  await withEnv({ XPAY_WEBHOOK_SECRET: undefined }, async () => {
    const gateway = new XPayGatewayService();
    const body = { data: { status: 'successful', tenant_id: 't1', amount: 1000, custom_fields: [] } };
    const result = await gateway.verifyAndParseWebhook(
      { 'x-xpay-signature': 'anything' },
      body,
      Buffer.from(JSON.stringify(body)),
    );
    assert.equal(result.isValid, false, 'XPay webhook must be rejected when XPAY_WEBHOOK_SECRET is unset');
  });

  // 2. Fail-closed: secret configured but signature missing.
  await withEnv({ XPAY_WEBHOOK_SECRET: 'test-secret' }, async () => {
    const gateway = new XPayGatewayService();
    const body = { data: { status: 'successful' } };
    const result = await gateway.verifyAndParseWebhook({}, body, Buffer.from(JSON.stringify(body)));
    assert.equal(result.isValid, false, 'XPay webhook must be rejected without a signature header');
  });

  // 3. Valid HMAC-SHA256 over the raw body is accepted.
  await withEnv({ XPAY_WEBHOOK_SECRET: 'test-secret' }, async () => {
    const gateway = new XPayGatewayService();
    const body = {
      data: { status: 'successful', tenant_id: 't1', total_amount: 500, currency: 'EGP', custom_fields: [] },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = crypto.createHmac('sha256', 'test-secret').update(rawBody).digest('hex');
    const result = await gateway.verifyAndParseWebhook({ 'x-xpay-signature': signature }, body, rawBody);
    assert.equal(result.isValid, true, 'XPay webhook with a correct HMAC over the raw body must be accepted');
    assert.equal(result.isSuccessful, true);
  });

  // 4. A tampered signature is rejected.
  await withEnv({ XPAY_WEBHOOK_SECRET: 'test-secret' }, async () => {
    const gateway = new XPayGatewayService();
    const body = { data: { status: 'successful' } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const result = await gateway.verifyAndParseWebhook({ 'x-xpay-signature': 'deadbeef'.repeat(8) }, body, rawBody);
    assert.equal(result.isValid, false, 'XPay webhook with a forged signature must be rejected');
  });

  console.log('  -> XPay gateway: fail-closed without secret/signature, accepts valid HMAC, rejects forged signature.');
}

async function testPaymobWebhookFailClosed(): Promise<void> {
  // 1. Fail-closed without a configured secret.
  await withEnv({ PAYMOB_HMAC_SECRET: undefined }, async () => {
    const gateway = new PaymobGatewayService();
    const body = { obj: { success: true, pending: false, amount_cents: 1000, order: { merchant_order_id: 'x' } } };
    const result = await gateway.verifyAndParseWebhook({ hmac: 'anything' }, body);
    assert.equal(result.isValid, false, 'Paymob webhook must be rejected when PAYMOB_HMAC_SECRET is unset');
  });

  // 2. A tampered hmac is rejected even with a secret configured.
  await withEnv({ PAYMOB_HMAC_SECRET: 'test-secret' }, async () => {
    const gateway = new PaymobGatewayService();
    const body = { obj: { success: true, pending: false, amount_cents: 1000, order: { merchant_order_id: 'x' } } };
    const result = await gateway.verifyAndParseWebhook({ hmac: 'not-the-real-hmac' }, body);
    assert.equal(result.isValid, false, 'Paymob webhook with a forged hmac must be rejected');
  });

  console.log('  -> Paymob gateway: fail-closed without secret, rejects forged hmac.');
}

async function testStripeWebhookFailClosed(): Promise<void> {
  // 1. Fail-closed: no secret configured.
  await withEnv({ STRIPE_WEBHOOK_SECRET: undefined }, async () => {
    const gateway = new StripeGatewayService();
    const body = { type: 'checkout.session.completed', data: { object: {} } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const result = await gateway.verifyAndParseWebhook({ 'stripe-signature': 't=1,v1=abc' }, body, rawBody);
    assert.equal(result.isValid, false, 'Stripe webhook must be rejected when STRIPE_WEBHOOK_SECRET is unset');
  });

  // 2. Fail-closed: no signature header at all (this used to be `isValid: true` unconditionally).
  await withEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_test' }, async () => {
    const gateway = new StripeGatewayService();
    const body = { type: 'checkout.session.completed', data: { object: {} } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const result = await gateway.verifyAndParseWebhook({}, body, rawBody);
    assert.equal(result.isValid, false, 'Stripe webhook without a signature header must be rejected');
  });

  // 3. A correctly computed t=...,v1=... signature over the raw body is accepted.
  await withEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_test' }, async () => {
    const gateway = new StripeGatewayService();
    const body = {
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_1', amount_total: 10000, currency: 'usd', metadata: { tenant_id: 't1', plan_id: '2' } },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
    const signature = crypto.createHmac('sha256', 'whsec_test').update(signedPayload).digest('hex');
    const result = await gateway.verifyAndParseWebhook(
      { 'stripe-signature': `t=${timestamp},v1=${signature}` },
      body,
      rawBody,
    );
    assert.equal(result.isValid, true, 'Stripe webhook with a correct t=...,v1=... signature must be accepted');
    assert.equal(result.isSuccessful, true);
  });

  // 4. A stale timestamp (replay) is rejected even with a correct signature.
  await withEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_test' }, async () => {
    const gateway = new StripeGatewayService();
    const body = { type: 'checkout.session.completed', data: { object: {} } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour old
    const signedPayload = `${staleTimestamp}.${rawBody.toString('utf8')}`;
    const signature = crypto.createHmac('sha256', 'whsec_test').update(signedPayload).digest('hex');
    const result = await gateway.verifyAndParseWebhook(
      { 'stripe-signature': `t=${staleTimestamp},v1=${signature}` },
      body,
      rawBody,
    );
    assert.equal(
      result.isValid,
      false,
      'Stripe webhook with a stale (>300s) timestamp must be rejected (replay protection)',
    );
  });

  console.log(
    '  -> Stripe gateway: fail-closed without secret/signature, accepts valid signed payload, rejects replayed/stale timestamp.',
  );
}

async function run(): Promise<void> {
  console.log('=== [PHASE 12] BILLING & PORTAL SECURITY HARDENING REGRESSION TESTS ===\n');

  console.log('[Test 1] LoginAttemptLimiter brute-force guard');
  await testLoginAttemptLimiter();

  console.log('[Test 2] XPay webhook signature verification (fail-closed)');
  await testXpayWebhookFailClosed();

  console.log('[Test 3] Paymob webhook signature verification (fail-closed)');
  await testPaymobWebhookFailClosed();

  console.log('[Test 4] Stripe webhook signature verification (fail-closed + replay protection)');
  await testStripeWebhookFailClosed();

  console.log('\n=== ALL PHASE 12 SECURITY HARDENING TESTS PASSED (4/4) ===');
}

run().catch((err) => {
  console.error('PHASE 12 SECURITY HARDENING TESTS FAILED:', err);
  process.exit(1);
});
