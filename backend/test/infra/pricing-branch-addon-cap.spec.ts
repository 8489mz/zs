/* Extra-branch addon cap: one additional branch costs at most half the
 * band's L1 monthly price (half-up to a whole currency unit), served
 * through the single public pricing endpoint. Gulf countries keep no
 * published addon price (contact-for-price, never an invented number).
 * The spec drives the real PricingCatalogService over the generated
 * catalog, never a local copy of the numbers. */
import assert from 'node:assert/strict';
import { PricingCatalogService } from '../../src/modules/tenant-subscription/pricing/pricing-catalog.service';

const pricing = new PricingCatalogService();

function extraBranch(product: string, country: string): number | null {
  const offer = pricing.resolvePublicOffer({ industryPresetId: product, countryCode: country });
  assert.ok(offer, `${product}/${country} must resolve`);
  return offer.addons.extraBranchMonthly;
}

// Band 1 (retail): 450/2 = 225 EG, 149/2 = 74.5 -> 75 SA (half-up).
assert.equal(extraBranch('retail', 'EG'), 225);
assert.equal(extraBranch('retail', 'SA'), 75);

// Band 2 (pharmacy): 650/2 = 325 EG, 199/2 = 99.5 -> 100 SA (half-up).
assert.equal(extraBranch('pharmacy', 'EG'), 325);
assert.equal(extraBranch('pharmacy', 'SA'), 100);

// Band 3 (restaurant): 1400/2 = 700 EG, 249/2 = 124.5 -> 125 SA (half-up).
assert.equal(extraBranch('restaurant', 'EG'), 700);
assert.equal(extraBranch('restaurant', 'SA'), 125);

// Band 4 (wholesale): 1500/2 = 750 EG, 349/2 = 174.5 -> 175 SA (half-up).
assert.equal(extraBranch('wholesale', 'EG'), 750);
assert.equal(extraBranch('wholesale', 'SA'), 175);

// Band 5 (contracting): already under the cap, unchanged.
assert.equal(extraBranch('contracting', 'EG'), 1200);
assert.equal(extraBranch('contracting', 'SA'), 329);

// Gulf: no published addon price in any band — contact-for-price.
assert.equal(extraBranch('retail', 'AE'), null);
assert.equal(extraBranch('restaurant', 'AE'), null);

console.log('pricing-branch-addon-cap: OK');
