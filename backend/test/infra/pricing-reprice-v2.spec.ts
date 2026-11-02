/* Reprice v2 (2 November 2026, market study): Saudi restaurant/wholesale
 * list prices cut to the published competitor cluster, Gulf rows recomputed
 * from the Saudi list at the catalog FX rule — never raised: cells the
 * formula would have raised (Bahrain/Oman retail/wholesale/construction
 * rows) were deliberately HELD at their old values, pinned below, because
 * no market evidence supports a rise. Egypt list prices are unchanged.
 * The launch offer (20% off the first year, new customers only) is served
 * as catalog data through the same single endpoint. The spec drives the
 * real PricingCatalogService over the generated catalog, never a local
 * copy of the numbers. */
import assert from 'node:assert/strict';
import { PricingCatalogService } from '../../src/modules/tenant-subscription/pricing/pricing-catalog.service';

const pricing = new PricingCatalogService();

function offer(product: string, country: string) {
  const o = pricing.resolvePublicOffer({ industryPresetId: product, countryCode: country });
  assert.ok(o, `${product}/${country} must resolve`);
  return o;
}

function level(product: string, country: string, index: number) {
  const o = offer(product, country);
  assert.equal(o.levels.length, 3);
  return o.levels[index];
}

// Saudi Arabia: restaurant cut 349 -> 249 (Matbex 199 / Noqqat-Saheeh 249
// cluster), wholesale L1 cut 399 -> 349; annuals stay monthly x 10.
assert.equal(level('restaurant', 'SA', 0).monthly, 249);
assert.equal(level('restaurant', 'SA', 0).annual, 2490);
assert.equal(level('restaurant', 'SA', 1).monthly, 649);
assert.equal(level('restaurant', 'SA', 1).annual, 6490);
assert.equal(level('restaurant', 'SA', 2).monthly, 1299);
assert.equal(level('restaurant', 'SA', 2).annual, 12990);
assert.equal(level('wholesale', 'SA', 0).monthly, 349);
assert.equal(level('wholesale', 'SA', 0).annual, 3490);
assert.equal(level('restaurant', 'SA', 0).currency, 'SAR');

// Kuwait (the meeting numbers): restaurant L1 22, retail L1 13,
// wholesale L1 30 — all below the Foodics Kuwait list (16.6/27.4/45.7).
assert.equal(level('restaurant', 'KW', 0).monthly, 22);
assert.equal(level('restaurant', 'KW', 0).annual, 220);
assert.equal(level('retail', 'KW', 0).monthly, 13);
assert.equal(level('wholesale', 'KW', 0).monthly, 30);

// UAE/Qatar restaurant rows follow the same formula recompute.
assert.equal(level('restaurant', 'AE', 0).monthly, 255);
assert.equal(level('restaurant', 'AE', 0).annual, 2550);
assert.equal(level('restaurant', 'QA', 0).monthly, 253);

// HELD, not raised: the formula recompute would have lifted these
// Bahrain/Oman cells (e.g. BH wholesale L2 89 -> 95); with no market
// evidence for a rise they stay at their old list prices.
assert.equal(level('wholesale', 'BH', 1).monthly, 89);
assert.equal(level('wholesale', 'BH', 2).monthly, 179);
assert.equal(level('wholesale', 'OM', 1).monthly, 89);
assert.equal(level('wholesale', 'OM', 2).monthly, 179);
assert.equal(level('retail', 'BH', 0).monthly, 15);
assert.equal(level('contracting', 'OM', 2).monthly, 489);

// Egypt is unchanged by this package (validated against Daftra's card).
assert.equal(level('retail', 'EG', 0).monthly, 450);
assert.equal(level('retail', 'EG', 0).annual, 4500);
assert.equal(level('retail', 'EG', 1).monthly, 1900);
assert.equal(level('retail', 'EG', 2).monthly, 4500);
assert.equal(level('restaurant', 'EG', 0).monthly, 1400);

// Extra-user addons are unchanged by this package.
assert.equal(offer('retail', 'SA').addons.extraUserMonthly, 35);
assert.equal(offer('retail', 'EG').addons.extraUserMonthly, 120);

// Launch offer: 20% off the first year, new customers only, served on
// both the strict public path and the tenant fallback path.
for (const o of [offer('retail', 'EG'), pricing.resolveForTenant({ industryPresetId: 'nope', countryCode: 'XX' })]) {
  assert.equal(o.launchOffer.percentOffFirstYear, 20);
  assert.equal(o.launchOffer.firstYearOnly, true);
  assert.equal(o.launchOffer.newCustomersOnly, true);
}

console.log('pricing-reprice-v2: OK');
