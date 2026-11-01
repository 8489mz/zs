import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { PublicController } from '../../src/modules/public/public.controller';
import { PricingCatalogService } from '../../src/modules/tenant-subscription/pricing/pricing-catalog.service';

const pricing = new PricingCatalogService();
const controller = new PublicController({} as any, pricing);

// Valid single offer: exact prices, shape additions, no silent substitution.
const retailEg = pricing.resolvePublicOffer({ industryPresetId: 'retail', countryCode: 'EG' });
assert.ok(retailEg);
assert.equal(retailEg.product.id, 'retail');
assert.equal(retailEg.product.sellOffline, true);
assert.equal(retailEg.vatIncluded, false);
assert.equal(retailEg.country.code, 'EG');
assert.equal(retailEg.country.currency, 'EGP');
assert.equal(retailEg.levels.length, 3);
assert.equal(retailEg.levels[0].monthly, 450);
assert.equal(retailEg.levels[0].annual, 4500);
assert.equal(retailEg.annualEqualsMonths, 10);
assert.equal(retailEg.trialDays, 14);

// Case-insensitive matching still resolves.
const retailLower = pricing.resolvePublicOffer({ industryPresetId: 'RETAIL', countryCode: 'eg' });
assert.ok(retailLower);
assert.equal(retailLower.product.id, 'retail');
assert.equal(retailLower.country.code, 'EG');

// Aliases shared with the tenant path still resolve on the strict path.
const maritime = pricing.resolvePublicOffer({ industryPresetId: 'maritime_freight', countryCode: 'EG' });
assert.ok(maritime);
assert.equal(maritime.product.id, 'maritime');

// Warehousing resolves (it is a real product, not a fallback).
const warehousing = pricing.resolvePublicOffer({ industryPresetId: 'warehousing', countryCode: 'EG' });
assert.ok(warehousing);
assert.equal(warehousing.product.id, 'warehousing');
assert.equal(warehousing.product.sellOffline, true);

// Unknown product, unknown country, and blocked country all refuse
// instead of silently serving another product's or country's prices.
assert.equal(pricing.resolvePublicOffer({ industryPresetId: 'nope', countryCode: 'EG' }), null);
assert.equal(pricing.resolvePublicOffer({ industryPresetId: 'retail', countryCode: 'XX' }), null);
assert.equal(pricing.resolvePublicOffer({ industryPresetId: 'retail', countryCode: 'JO' }), null);
assert.equal(pricing.resolvePublicOffer({ industryPresetId: undefined, countryCode: 'EG' }), null);
assert.equal(pricing.resolvePublicOffer({ industryPresetId: 'retail', countryCode: undefined }), null);

// The controller turns a refused offer into a 404 with a stable code,
// never a 200 carrying the wrong prices.
function assertController404(product: string, country: string): void {
  assert.throws(
    () => controller.pricingCatalog(product, country),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.getStatus(), 404);
      const body = error.getResponse() as { code?: string };
      assert.equal(body.code, 'pricing_offer_not_found');
      return true;
    },
  );
}
assertController404('nope', 'EG');
assertController404('retail', 'XX');
assertController404('retail', 'JO');

// A valid request still returns the offer through the controller.
const viaController = controller.pricingCatalog('retail', 'EG') as ReturnType<typeof pricing.resolvePublicOffer>;
assert.ok(viaController);
assert.equal(viaController.product.id, 'retail');

// Tenant path keeps its deliberate fallback: an unknown activity never
// breaks the in-app billing screen, and it carries the new shape fields.
const tenantFallback = pricing.resolveForTenant({ industryPresetId: 'nope', countryCode: 'XX' });
assert.equal(tenantFallback.product.id, 'retail');
assert.equal(tenantFallback.country.code, 'EG');
assert.equal(tenantFallback.product.sellOffline, true);
assert.equal(tenantFallback.vatIncluded, false);
const tenantEcommerce = pricing.resolveForTenant({ industryPresetId: 'ecommerce', countryCode: 'EG' });
assert.equal(tenantEcommerce.product.sellOffline, false);

// Gulf shape is documented, not hidden: levels are priced, addons are
// null (the website must render contact-for-price, never invent numbers).
const retailAe = pricing.resolvePublicOffer({ industryPresetId: 'retail', countryCode: 'AE' });
assert.ok(retailAe);
assert.equal(retailAe.levels.length, 3);
assert.equal(retailAe.addons.extraUserMonthly, null);
assert.equal(retailAe.addons.extraBranchMonthly, null);

console.log('public-pricing-offer.spec.ts passed');
