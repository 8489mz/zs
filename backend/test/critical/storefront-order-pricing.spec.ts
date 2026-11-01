import { strict as assert } from 'node:assert';
import {
  readProductVariants,
  resolveOrderLinePrice,
  formatVariantLineName,
} from '../../src/modules/storefront/engines/online-order-pricing.engine';

// Regression coverage for invariant SF-4 / open item O54 (ARCHITECTURE_INVARIANTS.md).
//
// Before: the storefront cart showed the chosen variant's price, but the order DTO carried no variant
// and the server billed `retail_price` and dropped the variant name. The customer saw one total, the
// merchant received another, and nobody knew which size was ordered.

const metadata = {
  variants: [
    { name: 'صغير' },
    { name: 'وسط', extraPrice: 15 },
    { name: 'كبير', price: 120 },
    { name: 'عائلي', price: '180.5' },
    { name: '   ' },
    { name: 'خصم', extraPrice: -200 },
  ],
};

function testVariantParsing(): void {
  const variants = readProductVariants(metadata);
  assert.deepEqual(variants.map((v) => v.name), ['صغير', 'وسط', 'كبير', 'عائلي', 'خصم'], 'blank names are dropped');
  assert.equal(readProductVariants(JSON.stringify(metadata)).length, 5, 'metadata stored as a JSON string is read too');
  assert.deepEqual(readProductVariants(null), []);
  assert.deepEqual(readProductVariants('{not json'), []);
  assert.deepEqual(readProductVariants({ variants: 'nope' }), []);
}

function testPricing(): void {
  assert.deepEqual(resolveOrderLinePrice(100, metadata, undefined, 2), { ok: true, unitPrice: 100, variantName: null }, 'no variant = base price');
  assert.deepEqual(resolveOrderLinePrice(100, metadata, '  ', 2), { ok: true, unitPrice: 100, variantName: null });
  assert.deepEqual(resolveOrderLinePrice(100, metadata, 'صغير', 2), { ok: true, unitPrice: 100, variantName: 'صغير' }, 'variant without price = base');
  assert.deepEqual(resolveOrderLinePrice(100, metadata, 'وسط', 2), { ok: true, unitPrice: 115, variantName: 'وسط' }, 'extraPrice is added to base');
  assert.deepEqual(resolveOrderLinePrice(100, metadata, 'كبير', 2), { ok: true, unitPrice: 120, variantName: 'كبير' }, 'absolute price wins');
  assert.deepEqual(resolveOrderLinePrice(100, metadata, ' عائلي ', 2), { ok: true, unitPrice: 180.5, variantName: 'عائلي' }, 'numeric strings and trimming');
  // The exact old bug: an unknown variant must not silently fall back to base price.
  assert.deepEqual(resolveOrderLinePrice(100, metadata, 'عملاق', 2), { ok: false, reason: 'UNKNOWN_VARIANT' });
  assert.deepEqual(resolveOrderLinePrice(100, {}, 'كبير', 2), { ok: false, reason: 'UNKNOWN_VARIANT' }, 'variant on a product without variants');
  assert.deepEqual(resolveOrderLinePrice(100, metadata, 'خصم', 2), { ok: false, reason: 'INVALID_PRICE' }, 'a variant can never price below zero');
}

function testLineName(): void {
  assert.equal(formatVariantLineName('بيتزا', 'كبير'), 'بيتزا (كبير)');
  assert.equal(formatVariantLineName('بيتزا', null), 'بيتزا');
}

function testVariantPhotos(): void {
  // SF-12: the display-only variant photo rides readProductVariants verbatim
  // (trimmed; blank/non-string dropped) and never affects the priced amount.
  const withPhotos = {
    variants: [
      { name: 'أحمر', price: 550, imageUrl: '  /api/storefront/media/2/bbb  ' },
      { name: 'أزرق', extraPrice: 20 },
      { name: 'أخضر', price: 500, imageUrl: '   ' },
      { name: 'أصفر', price: 500, imageUrl: 42 },
    ],
  };
  const variants = readProductVariants(withPhotos);
  assert.equal(variants[0]?.imageUrl, '/api/storefront/media/2/bbb', 'variant photo is carried, trimmed');
  assert.equal(variants[1]?.imageUrl, undefined, 'no photo stays absent');
  assert.equal(variants[2]?.imageUrl, undefined, 'blank photo is dropped');
  assert.equal(variants[3]?.imageUrl, undefined, 'non-string photo is dropped');
  assert.deepEqual(resolveOrderLinePrice(500, withPhotos, 'أحمر', 2), { ok: true, unitPrice: 550, variantName: 'أحمر' }, 'photo never changes price');
}

testVariantParsing();
testPricing();
testLineName();
testVariantPhotos();
console.log('storefront-order-pricing.spec: all checks passed');
