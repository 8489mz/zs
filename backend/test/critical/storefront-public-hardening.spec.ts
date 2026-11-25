import { strict as assert } from 'node:assert';
import {
  classifyStorefrontPublicRequest,
  resolveClientIp,
} from '../../src/common/middleware/storefront-public-rate-limit.middleware';
import {
  maskGatewaySecret,
  isMaskedGatewaySecret,
} from '../../src/modules/storefront/engines/gateway-secret-mask.engine';

// Regression coverage for O60 (public storefront rate limits) and SF-7 / O59 (gateway secrets never
// leave the server in full). See ARCHITECTURE_INVARIANTS.md.

function testClassification(): void {
  const create = classifyStorefrontPublicRequest('POST', '/api/storefront/MyShop/orders');
  assert.equal(create?.rule.bucket, 'order-create');
  assert.equal(create?.slug, 'myshop', 'slug is normalised so casing cannot split buckets');
  assert.equal(
    classifyStorefrontPublicRequest('POST', '/api/storefront/s/orders?x=1')?.rule.bucket,
    'order-create',
    'query string ignored',
  );
  assert.equal(
    classifyStorefrontPublicRequest('POST', '/api/storefront/s/coupons/validate')?.rule.bucket,
    'coupon-validate',
  );
  assert.equal(classifyStorefrontPublicRequest('POST', '/api/storefront/s/products/5/reviews')?.rule.bucket, 'review');
  assert.equal(
    classifyStorefrontPublicRequest('POST', '/api/storefront/s/abandoned-cart')?.rule.bucket,
    'abandoned-cart',
  );
  assert.equal(classifyStorefrontPublicRequest('POST', '/api/storefront/s/orders/lookup')?.rule.bucket, 'order-access');
  assert.equal(
    classifyStorefrontPublicRequest('POST', '/api/storefront/s/orders/ON-1/cancel')?.rule.bucket,
    'order-access',
  );
  assert.equal(
    classifyStorefrontPublicRequest('POST', '/api/storefront/s/orders/ON-1/mock-pay')?.rule.bucket,
    'order-access',
  );
  assert.equal(classifyStorefrontPublicRequest('PUT', '/api/storefront/s/orders/ON-1')?.rule.bucket, 'order-access');

  // Never limited here: reads, payment webhooks (gateways retry), merchant routes.
  assert.equal(classifyStorefrontPublicRequest('GET', '/api/storefront/s/catalog'), null);
  assert.equal(classifyStorefrontPublicRequest('GET', '/api/storefront/s/orders/ON-1/payment-status'), null);
  assert.equal(classifyStorefrontPublicRequest('POST', '/api/storefront/webhooks/paymob'), null);
  assert.equal(classifyStorefrontPublicRequest('POST', '/api/storefront/admin/orders'), null);
  assert.equal(classifyStorefrontPublicRequest('POST', '/api/storefront/admin/coupons'), null);
  assert.equal(classifyStorefrontPublicRequest('POST', '/api/storefront/marketplaces/config'), null);
}

function testClientIp(): void {
  // Behind nginx: the peer is the proxy, the real client is in X-Real-IP.
  assert.equal(resolveClientIp('127.0.0.1', '41.33.10.5'), '41.33.10.5');
  assert.equal(resolveClientIp('::ffff:172.18.0.2', '41.33.10.5'), '41.33.10.5');
  assert.equal(resolveClientIp('10.0.0.4', ['41.33.10.5']), '41.33.10.5');
  // A client reaching the app directly cannot pick its own bucket by sending the header.
  assert.equal(resolveClientIp('41.33.10.5', '1.2.3.4'), '41.33.10.5');
  // Garbage header is ignored.
  assert.equal(resolveClientIp('127.0.0.1', 'evil; drop'), '127.0.0.1');
  assert.equal(resolveClientIp(undefined, undefined), 'unknown');
}

function testSecretMask(): void {
  const secret = 'sk_live_51HfakeFAKEfake9876';
  const masked = maskGatewaySecret(secret);
  assert.ok(!masked.includes('sk_live'), 'the secret itself never appears');
  assert.ok(masked.endsWith('9876'), 'last 4 characters hint which key is stored');
  assert.equal(isMaskedGatewaySecret(masked), true, 'saving the form back unchanged is recognised');
  assert.equal(maskGatewaySecret(''), '', 'unset stays empty so the UI can show "not configured"');
  assert.equal(maskGatewaySecret(null), '');
  assert.ok(!maskGatewaySecret('short').includes('short'), 'short secrets reveal nothing');
  assert.equal(isMaskedGatewaySecret(secret), false, 'a real new key is saved');
  assert.equal(isMaskedGatewaySecret(''), false, 'clearing a key is a real change');
}

testClassification();
testClientIp();
testSecretMask();
console.log('storefront-public-hardening.spec: all checks passed');
