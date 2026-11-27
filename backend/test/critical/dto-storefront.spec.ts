/*
 * New file: backend/test/critical/dto-storefront.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-STOREFRONT-14, D8): the 14 storefront
 * controller routes (marketplace config, SKU mapping, fee calculator,
 * competitor price, settlement reconcile, repricing settings, FBA
 * inbound shipment, onboarding profile, GTIN exemption, coupon
 * validate, cart quote + quote alias, mock pay, pay-table-bill) now
 * take DTO classes, so the real global requestValidationPipe
 * validates and whitelists them. Before D8 they took inline object
 * types, `any`, or a named interface — and the pipe does nothing for
 * an inline type, `any`, or an interface, so any extra field (or a
 * wrong-typed field) reached the service untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH DTO, (a) a positive case with the REAL caller payload
 * (the exact shape the frontend api file sends; see the per-case
 * comments for the caller file), which must pass the pipe with
 * every field intact, and (b) negative cases: an extra field the
 * caller never sends is rejected with 400 VALIDATION_ERROR, and a
 * wrong-typed field is rejected the same way.
 *
 * CALLER TRAPS PINNED HERE (found during D8 caller verification):
 * - SaveMarketplaceConfigDto: the configs form round-trips the full
 *   GET config per marketplace, including the masked '••••••••'
 *   secrets. The service SKIPS every masked secret (refreshToken /
 *   clientSecret / webhookSecret Amazon; apiKey / appSecret /
 *   webhookSecret Noon; apiKey / webhookSecret Jumia; apiKey /
 *   apiSecret / webhookSecret Trendyol) — so NO @MinLength on any
 *   secret: a min-length would 400 the save whenever the user does
 *   not change the secret (D7 WhatsApp precedent). A non-masked
 *   webhookSecret shorter than 32 chars throws in the SERVICE, not
 *   the pipe. All fields optional (Partial merge).
 * - SaveMarketplaceSkuMappingDto: the add form SENDS status:
 *   'synced' — the DTO must accept it (the service ignores it and
 *   sets 'synced' itself). Edit flows use separate endpoints
 *   (competitor-price, repricing-settings), never saveMapping. The
 *   other Omit fields (productName, barcode, costPrice, retailPrice,
 *   currentLocalStock, lastSyncedStock, lastSyncedAt, errorMessage,
 *   buyBoxStatus, lastPriceCheckedAt, repricing*, lastRepricedAt,
 *   repricingLog) are deliberately NOT in the DTO: the service
 *   builds newMapping explicitly and would silently drop them (and
 *   an edit via saveMapping would wipe repricing settings —
 *   pre-existing service behavior, out of scope).
 * - CalculateMarketplaceFeesDto.category + fulfillmentType stay
 *   plain strings (NOT enums): the service switch has a default
 *   (unknown category computes at 12%) and the fulfillment check
 *   falls back to the FBM path — an enum would 400 a category the
 *   service handles. marketplace / region / weightTier are the
 *   interface enums.
 * - ReconcileMarketplaceSettlementDto.marketplace is amazon|noon
 *   ONLY — the SERVICE whitelist (`!['amazon','noon'].includes(...)`
 *   throws), narrower than the interface's SupportedMarketplace (D5
 *   service-whitelist precedent). grossSales must be > 0
 *   (@IsPositive, the service throws otherwise); netPayout >= 0;
 *   the fee fields >= 0 when present; referralFees/fulfillmentFees
 *   are REQUIRED (interface-required, the form always sends 0).
 *   periodStart/periodEnd stay
 *   REQUIRED: the service spreads the input into a
 *   MarketplaceSettlementRecord whose type requires them, and the
 *   only caller always sends both. Book-digits precision
 *   + the gross-vs-parts identity stay service checks, not DTO.
 * - CreateFbaInboundShipmentDto: the modal sends totalUnits /
 *   totalBoxes / status 'draft' — the service RECOMPUTES the totals
 *   from items, so both are optional in the DTO; status stays
 *   REQUIRED (the only caller always sends 'draft', and the service
 *   spreads the input into an FbaInboundShipment whose type requires
 *   it). items is REQUIRED non-empty (the service throws otherwise).
 * - SaveMarketplaceOnboardingProfileDto: the modal round-trips the
 *   FULL GET check object (initialData spread into formData) — all
 *   22 interface fields can arrive, including checklist[],
 *   platformGuides[] (with nested steps[]), the letters, the score
 *   and the name-match fields. The service reads ONLY the 16
 *   scalars — but the DTO must accept the computed fields as
 *   optional nested DTOs or the save 400s (Package C trap).
 * - QuoteCartDto: the service TOLERATES missing/empty items (it
 *   returns a zero quote), so items is OPTIONAL (D5 precedent).
 *   productId is `number | string` in the type; the service does
 *   Number()/String() on it — the DTO NARROWS to number (D5
 *   cashierShiftId precedent): a numeric string coerces ("42" ->
 *   42, pinned below); a non-numeric string 400s (no real caller
 *   sends one; cart ids are numeric). fulfillmentType is
 *   delivery|pickup|dine_in — the FRONTEND type is wider than the
 *   backend facade type (delivery|pickup); the service treats
 *   non-'pickup' as not-pickup, so 'dine_in' must pass.
 * - PayTableBillDto: the service THROWS ServiceUnavailable
 *   unconditionally today ("الدفع الإلكتروني لفاتورة الطاولة غير
 *   متاح حالياً") — every call 503s. The DTO only validates shape;
 *   the 503 behavior is unchanged.
 * - Booleans under enableImplicitConversion: the string "false"
 *   converts to boolean true (Boolean("false") === true), pinned
 *   below wherever a boolean field exists; a boolean false still
 *   passes as false. A string field COERCES any JSON value (number
 *   42 -> '42', object -> '[object Object]') instead of rejecting
 *   — pin the coercion, never write an object-for-string negative
 *   (D7 finding). A number field coerces a numeric string ('250'
 *   -> 250, pinned) but rejects a non-numeric one ('much' -> NaN).
 *
 * NOT CONVERTED — THE 6 WEBHOOK PINS (new in D8, same rationale as
 * the pinned tenant-subscription POST webhooks/:gateway exclusion):
 * the 6 `any` webhook sites stay `any` and are pinned as exclusions
 * (census script + coverage spec + Rule 7 of the contract doc, 9 ->
 * 15). Their payload shape is defined by the provider, outside the
 * repo, and signature verification reads the raw body or
 * concatenated provider fields — a strict DTO would 400 a live
 * money notification the first time a provider adds a key:
 * - marketplace-sync :187 handleWebhook: the receive service stores
 *   the RAW payload and extracts identity across the root AND the
 *   nested notification/Notification/data/payload layers, for 4
 *   marketplaces (Amazon SP-API, Noon, Jumia, Trendyol) with 4
 *   different notification schemas.
 * - public :253 Paymob: `body?.obj || body` + ~20 fields under obj
 *   + custom_fields; HMAC-SHA512 over concatenated field values.
 * - public :263 XPay: `body?.data || body`, transaction_status /
 *   transaction_id / amount / currency under data or the root,
 *   custom_fields.
 * - public :273 Tap: body.id/status/metadata/reference/amount/
 *   currency/gateway?.reference/payment_reference/created; HMAC
 *   over a concatenated string of those fields.
 * - public :283 Stripe: body.type + body.data.object (+ metadata /
 *   client_reference_id / id); the stripe-signature header is
 *   verified over rawBody, which the service requires.
 * - public :302 marketplace webhook: same receive path as :187 —
 *   the raw payload is persisted first, 200 only after durable
 *   store (INV-MARKETPLACE-WEBHOOK-PERSISTENCE).
 * The spec pins all six as `any` by source grep below, so a future
 * agent does not "fix" them.
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted
 * app); the services themselves (their own throws stay the
 * backstop — e.g. the settlement book-digits gate, the gross-vs-
 * parts identity, the webhook HMAC checks, the pay-bill 503); the
 * frontend screens (untouched); the 6 pinned webhook exclusions.
 *
 * Fail-first: this spec is new in D8 — on the unpatched tree the
 * DTO classes do not exist, so the imports fail (MODULE_NOT_FOUND)
 * and the spec exits 1 (see the log). GREEN means the pipe
 * accepts every real caller payload and rejects every
 * extra/wrong-typed field below.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import {
  CalculateMarketplaceFeesDto,
  CreateFbaInboundShipmentDto,
  GenerateGtinExemptionDto,
  ReconcileMarketplaceSettlementDto,
  SaveMarketplaceConfigDto,
  SaveMarketplaceOnboardingProfileDto,
  SaveMarketplaceSkuMappingDto,
  SaveRepricingSettingsDto,
  UpdateCompetitorPriceDto,
} from '../../src/modules/storefront/dto/marketplace-sync-write.dto';
import {
  MockPayDto,
  PayTableBillDto,
  QuoteCartDto,
  ValidateCouponDto,
} from '../../src/modules/storefront/dto/storefront-public-write.dto';

function isValidationError(err: unknown): boolean {
  return err instanceof BadRequestException && (err.getResponse() as { code?: string }).code === 'VALIDATION_ERROR';
}

async function pipeOk<T>(Dto: new () => T, payload: unknown): Promise<T> {
  return (await requestValidationPipe.transform(payload, { type: 'body', metatype: Dto })) as T;
}

async function pipeRejects(Dto: new () => unknown, payload: unknown, why: string): Promise<void> {
  await assert.rejects(
    () => requestValidationPipe.transform(payload, { type: 'body', metatype: Dto }),
    isValidationError,
    why,
  );
}

function readSrc(rel: string): string {
  return readFileSync(resolve(__dirname, '../../src', rel), 'utf8');
}

async function main(): Promise<void> {
  // 1. SaveMarketplaceConfigDto — caller: marketplace-configs.tsx
  // round-trips the full GET config per marketplace (all fields incl.
  // the masked '••••••••' secrets). Every field optional (Partial
  // merge); no @MinLength on any secret.
  {
    const transformed = await pipeOk(SaveMarketplaceConfigDto, {
      amazon: {
        enabled: true,
        sellerId: 'A1SELLER',
        refreshToken: '••••••••',
        clientId: 'amzn1.application-oa2-client.test',
        clientSecret: '••••••••',
        webhookSecret: '••••••••',
        marketplaceId: 'eg',
        autoSyncStock: true,
        autoPullOrders: true,
        fulfillmentType: 'fba',
      },
      noon: { enabled: false, merchantId: 'NOON-1', marketplace: 'sa', fulfillmentType: 'fbn' },
      jumia: { enabled: true, sellerEmail: 'seller@example.com', marketplace: 'eg', fulfillmentType: 'express' },
      trendyol: { enabled: true, supplierId: 'TR-1', fulfillmentType: 'trendyol_cargo' },
    });
    assert.equal(transformed.amazon?.sellerId, 'A1SELLER', 'amazon sellerId survives the pipe');
    assert.equal(transformed.amazon?.refreshToken, '••••••••', 'a masked refreshToken survives — no @MinLength');
    assert.equal(transformed.amazon?.webhookSecret, '••••••••', 'a masked webhookSecret survives — no @MinLength');
    assert.equal(transformed.amazon?.fulfillmentType, 'fba', 'amazon fulfillmentType survives the pipe');
    assert.equal(transformed.noon?.merchantId, 'NOON-1', 'noon merchantId survives the pipe');
    const empty = await pipeOk(SaveMarketplaceConfigDto, {});
    assert.equal(empty.amazon, undefined, 'an empty config passes — every marketplace is optional');
    const partial = await pipeOk(SaveMarketplaceConfigDto, { amazon: { enabled: false } });
    assert.equal(partial.amazon?.enabled, false, 'a boolean false stays false through the pipe');
    const stringFalse = await pipeOk(SaveMarketplaceConfigDto, { amazon: { enabled: 'false' } });
    assert.equal(
      stringFalse.amazon?.enabled,
      true,
      'the string "false" converts to boolean true (implicit conversion)',
    );
    await pipeRejects(
      SaveMarketplaceConfigDto,
      { amazon: { enabled: true, marketplaceId: 'xx' } },
      'a marketplaceId outside eg/sa/ae is rejected',
    );
    await pipeRejects(
      SaveMarketplaceConfigDto,
      { amazon: { enabled: true, fulfillmentType: 'dropship' } },
      'an amazon fulfillmentType outside fba/fbm is rejected',
    );
    await pipeRejects(
      SaveMarketplaceConfigDto,
      { amazon: { enabled: true, bogus: 1 } },
      'an extra field inside a nested config is rejected',
    );
    await pipeRejects(SaveMarketplaceConfigDto, { ebay: {} }, 'an extra marketplace key is rejected');
    // A non-string sellerId is COERCED, not rejected (implicit
    // conversion turns the number into the string '123' — pinned).
    const coercedSeller = await pipeOk(SaveMarketplaceConfigDto, { amazon: { sellerId: 123 } });
    assert.strictEqual(coercedSeller.amazon?.sellerId, '123', 'a numeric sellerId coerces to the string "123"');
  }

  // 2. SaveMarketplaceSkuMappingDto — caller: the add form in
  // marketplace-mapping-modals.tsx:282 sends { productId,
  // marketplace, marketplaceSku, customPrice?, buyBoxPrice?,
  // competitorPrice?, syncStock, status: 'synced' }.
  {
    const transformed = await pipeOk(SaveMarketplaceSkuMappingDto, {
      productId: 42,
      marketplace: 'amazon',
      marketplaceSku: 'B0TEST123',
      customPrice: 350,
      buyBoxPrice: 340,
      competitorPrice: 330,
      syncStock: true,
      status: 'synced',
    });
    assert.equal(transformed.productId, 42, 'mapping productId survives the pipe');
    assert.equal(transformed.marketplaceSku, 'B0TEST123', 'mapping marketplaceSku survives the pipe');
    assert.equal(transformed.status, 'synced', 'the caller-sent status survives the pipe');
    const minimal = await pipeOk(SaveMarketplaceSkuMappingDto, {
      productId: 42,
      marketplace: 'noon',
      marketplaceSku: 'SKU-1',
    });
    assert.equal(minimal.syncStock, undefined, 'a minimal mapping passes — syncStock defaults server-side');
    await pipeRejects(
      SaveMarketplaceSkuMappingDto,
      { marketplace: 'amazon', marketplaceSku: 'SKU-1' },
      'a missing productId is rejected',
    );
    await pipeRejects(
      SaveMarketplaceSkuMappingDto,
      { productId: 42, marketplace: 'amazon' },
      'a missing marketplaceSku is rejected',
    );
    await pipeRejects(
      SaveMarketplaceSkuMappingDto,
      { productId: 42, marketplace: 'ebay', marketplaceSku: 'SKU-1' },
      'a marketplace outside the 4 supported is rejected',
    );
    await pipeRejects(
      SaveMarketplaceSkuMappingDto,
      { productId: 42, marketplace: 'amazon', marketplaceSku: 'SKU-1', repricingLog: 'x' },
      'a server-managed field (repricingLog) is rejected — it belongs to no caller',
    );
    // A non-string marketplaceSku is COERCED, not rejected (implicit
    // conversion turns the number into the string '123' — pinned).
    const coercedSku = await pipeOk(SaveMarketplaceSkuMappingDto, {
      productId: 42,
      marketplace: 'amazon',
      marketplaceSku: 123,
    });
    assert.strictEqual(coercedSku.marketplaceSku, '123', 'a numeric marketplaceSku coerces to the string "123"');
  }

  // 3. CalculateMarketplaceFeesDto — caller: marketplace-tools.tsx
  // calcInput sends the full input (marketplace, region, category,
  // fulfillmentType, weightTier, sellingPrice, itemCost, costs).
  {
    const transformed = await pipeOk(CalculateMarketplaceFeesDto, {
      marketplace: 'amazon',
      region: 'eg',
      category: 'electronics',
      fulfillmentType: 'fba',
      weightTier: 'standard',
      sellingPrice: 350,
      itemCost: 200,
      inboundShippingCost: 10,
      packagingCost: 5,
    });
    assert.equal(transformed.sellingPrice, 350, 'fee sellingPrice survives the pipe');
    assert.equal(transformed.category, 'electronics', 'fee category survives the pipe');
    const minimal = await pipeOk(CalculateMarketplaceFeesDto, {
      marketplace: 'noon',
      region: 'sa',
      category: 'apparel',
      fulfillmentType: 'fbn',
      weightTier: 'small',
      sellingPrice: 100,
      itemCost: 60,
    });
    assert.equal(minimal.inboundShippingCost, undefined, 'a minimal fee input passes — the costs are optional');
    // An unknown category PASSES: the service switch has a default
    // (12%) — category is a plain string, not an enum (pinned).
    const unknownCategory = await pipeOk(CalculateMarketplaceFeesDto, {
      marketplace: 'amazon',
      region: 'eg',
      category: 'books',
      fulfillmentType: 'fba',
      weightTier: 'standard',
      sellingPrice: 100,
      itemCost: 60,
    });
    assert.equal(unknownCategory.category, 'books', 'an unknown category passes — the service default handles it');
    // An unknown fulfillmentType PASSES too: the service falls back
    // to the FBM path — fulfillmentType is a plain string (pinned).
    const unknownFulfillment = await pipeOk(CalculateMarketplaceFeesDto, {
      marketplace: 'amazon',
      region: 'eg',
      category: 'electronics',
      fulfillmentType: 'unknown_type',
      weightTier: 'standard',
      sellingPrice: 100,
      itemCost: 60,
    });
    assert.equal(
      unknownFulfillment.fulfillmentType,
      'unknown_type',
      'an unknown fulfillmentType passes — the service fallback handles it',
    );
    await pipeRejects(
      CalculateMarketplaceFeesDto,
      {
        marketplace: 'amazon',
        region: 'eg',
        category: 'electronics',
        fulfillmentType: 'fba',
        weightTier: 'huge',
        sellingPrice: 100,
        itemCost: 60,
      },
      'a weightTier outside the 5 tiers is rejected',
    );
    await pipeRejects(
      CalculateMarketplaceFeesDto,
      {
        marketplace: 'amazon',
        region: 'eg',
        category: 'electronics',
        fulfillmentType: 'fba',
        weightTier: 'standard',
        itemCost: 60,
      },
      'a missing sellingPrice is rejected',
    );
    await pipeRejects(
      CalculateMarketplaceFeesDto,
      {
        marketplace: 'amazon',
        region: 'eg',
        category: 'electronics',
        fulfillmentType: 'fba',
        weightTier: 'standard',
        sellingPrice: 100,
        itemCost: 60,
        extra: 1,
      },
      'an extra field is rejected',
    );
    await pipeRejects(
      CalculateMarketplaceFeesDto,
      {
        marketplace: 'amazon',
        region: 'eg',
        category: 'electronics',
        fulfillmentType: 'fba',
        weightTier: 'standard',
        sellingPrice: 'much',
        itemCost: 60,
      },
      'a non-numeric sellingPrice is rejected',
    );
  }

  // 4. UpdateCompetitorPriceDto — caller: marketplace-sync.api.ts
  // updateCompetitorPrice sends { competitorPrice?, buyBoxPrice? };
  // the service keeps the existing value when one is undefined.
  {
    const transformed = await pipeOk(UpdateCompetitorPriceDto, { competitorPrice: 330, buyBoxPrice: 340 });
    assert.equal(transformed.competitorPrice, 330, 'competitorPrice survives the pipe');
    assert.equal(transformed.buyBoxPrice, 340, 'buyBoxPrice survives the pipe');
    const empty = await pipeOk(UpdateCompetitorPriceDto, {});
    assert.equal(empty.competitorPrice, undefined, 'an empty competitor-price body passes — both fields optional');
    await pipeRejects(
      UpdateCompetitorPriceDto,
      { competitorPrice: 'much' },
      'a non-numeric competitorPrice is rejected',
    );
    await pipeRejects(UpdateCompetitorPriceDto, { competitorPrice: 330, extra: 1 }, 'an extra field is rejected');
  }

  // 5. ReconcileMarketplaceSettlementDto — caller: the settlements
  // form sends the FULL MarketplaceSettlementInput state (all fields;
  // the account ids are undefined when unchosen). MONEY endpoint.
  {
    const transformed = await pipeOk(ReconcileMarketplaceSettlementDto, {
      marketplace: 'amazon',
      settlementId: 'SET-2026-11-001',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-14',
      currency: 'EGP',
      grossSales: 1000,
      referralFees: 120,
      fulfillmentFees: 35,
      refunds: 0,
      storageOrOtherFees: 0,
      netPayout: 845,
      bankAccountId: 5,
      referralFeesAccountId: 12,
      fulfillmentFeesAccountId: 13,
      salesAccountId: 21,
      notes: 'November settlement',
    });
    assert.equal(transformed.settlementId, 'SET-2026-11-001', 'settlementId survives the pipe');
    assert.equal(transformed.grossSales, 1000, 'settlement grossSales survives the pipe');
    assert.equal(transformed.netPayout, 845, 'settlement netPayout survives the pipe');
    // periodStart/periodEnd are REQUIRED: the service stores them
    // via spread into a MarketplaceSettlementRecord whose type
    // requires them, and the only caller always sends both — making
    // them optional would force a service-code change in money code
    // for a caller that does not exist.
    const noPeriods = await pipeOk(ReconcileMarketplaceSettlementDto, {
      marketplace: 'noon',
      settlementId: 'SET-2',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-14',
      grossSales: 500,
      referralFees: 0,
      fulfillmentFees: 0,
      netPayout: 450,
    });
    assert.equal(noPeriods.periodStart, '2026-11-01', 'settlement periodStart survives the pipe');
    await pipeRejects(
      ReconcileMarketplaceSettlementDto,
      {
        marketplace: 'noon',
        settlementId: 'SET-2b',
        periodEnd: '2026-11-14',
        grossSales: 500,
        referralFees: 0,
        fulfillmentFees: 0,
        netPayout: 450,
      },
      'a missing periodStart is rejected',
    );
    await pipeRejects(
      ReconcileMarketplaceSettlementDto,
      { marketplace: 'amazon', grossSales: 1000, referralFees: 120, fulfillmentFees: 35, netPayout: 845 },
      'a missing settlementId is rejected',
    );
    await pipeRejects(
      ReconcileMarketplaceSettlementDto,
      {
        marketplace: 'jumia',
        settlementId: 'SET-3',
        grossSales: 1000,
        referralFees: 120,
        fulfillmentFees: 35,
        netPayout: 845,
      },
      'jumia is rejected — the SERVICE whitelist is amazon|noon only, narrower than the interface',
    );
    await pipeRejects(
      ReconcileMarketplaceSettlementDto,
      {
        marketplace: 'amazon',
        settlementId: 'SET-4',
        grossSales: 0,
        referralFees: 0,
        fulfillmentFees: 0,
        netPayout: 0,
      },
      'a zero grossSales is rejected — the service requires it > 0',
    );
    await pipeRejects(
      ReconcileMarketplaceSettlementDto,
      {
        marketplace: 'amazon',
        settlementId: 'SET-5',
        grossSales: 1000,
        referralFees: 120,
        fulfillmentFees: 35,
        netPayout: -5,
      },
      'a negative netPayout is rejected',
    );
    await pipeRejects(
      ReconcileMarketplaceSettlementDto,
      {
        marketplace: 'amazon',
        settlementId: 'SET-6',
        grossSales: 1000,
        referralFees: 120,
        fulfillmentFees: 35,
        netPayout: 845,
        extra: 1,
      },
      'an extra field is rejected',
    );
  }

  // 6. SaveRepricingSettingsDto — caller: marketplace-sync.api.ts
  // saveRepricingSettings sends the full shape; repricingEnabled is
  // REQUIRED (the service assigns it directly).
  {
    const transformed = await pipeOk(SaveRepricingSettingsDto, {
      repricingEnabled: true,
      minPrice: 300,
      maxPrice: 400,
      repricingRule: 'match_buy_box',
      repricingDelta: 5,
    });
    assert.equal(transformed.repricingEnabled, true, 'repricingEnabled survives the pipe');
    assert.equal(transformed.repricingRule, 'match_buy_box', 'repricingRule survives the pipe');
    const minimal = await pipeOk(SaveRepricingSettingsDto, { repricingEnabled: false });
    assert.equal(minimal.repricingEnabled, false, 'a boolean false stays false through the pipe');
    const stringFalse = await pipeOk(SaveRepricingSettingsDto, { repricingEnabled: 'false' });
    assert.equal(
      stringFalse.repricingEnabled,
      true,
      'the string "false" converts to boolean true (implicit conversion)',
    );
    await pipeRejects(SaveRepricingSettingsDto, { minPrice: 300 }, 'a missing repricingEnabled is rejected');
    await pipeRejects(
      SaveRepricingSettingsDto,
      { repricingEnabled: true, repricingRule: 'cheapest' },
      'a repricingRule outside the 4 service values is rejected',
    );
    await pipeRejects(SaveRepricingSettingsDto, { repricingEnabled: true, extra: 1 }, 'an extra field is rejected');
  }

  // 7. CreateFbaInboundShipmentDto — caller: the inbound modal
  // sends { marketplace, fulfillmentCenterId, items, totalUnits,
  // totalBoxes, trackingNumber?, notes?, status: 'draft' }. The
  // service RECOMPUTES totalUnits/totalBoxes from items, so both are
  // optional; status stays REQUIRED (the only caller always sends
  // 'draft', and the service spreads the input into an
  // FbaInboundShipment whose type requires it).
  {
    const transformed = await pipeOk(CreateFbaInboundShipmentDto, {
      marketplace: 'amazon',
      fulfillmentCenterId: 'CAI1',
      items: [
        {
          productId: 42,
          marketplaceSku: 'B0TEST123',
          productName: 'Test Product',
          barcode: '622000000001',
          quantityShipped: 10,
          boxNumber: 1,
        },
        { productId: 43, marketplaceSku: 'B0TEST124', productName: 'Second', quantityShipped: 5, boxNumber: 2 },
      ],
      totalUnits: 15,
      totalBoxes: 2,
      trackingNumber: 'TRK-1',
      notes: 'First shipment',
      status: 'draft',
    });
    assert.equal(transformed.marketplace, 'amazon', 'shipment marketplace survives the pipe');
    assert.equal(transformed.items?.length, 2, 'shipment items survive the pipe');
    assert.equal(transformed.items?.[0]?.productName, 'Test Product', 'an item productName survives the pipe');
    assert.equal(transformed.totalUnits, 15, 'a caller-sent totalUnits survives the pipe');
    await pipeRejects(
      CreateFbaInboundShipmentDto,
      { marketplace: 'amazon', fulfillmentCenterId: 'CAI1', items: [] },
      'an empty items list is rejected — the service requires at least one item',
    );
    await pipeRejects(
      CreateFbaInboundShipmentDto,
      { marketplace: 'amazon', fulfillmentCenterId: 'CAI1' },
      'a missing items list is rejected',
    );
    await pipeRejects(
      CreateFbaInboundShipmentDto,
      {
        marketplace: 'amazon',
        fulfillmentCenterId: 'CAI1',
        items: [{ productId: 42, marketplaceSku: 'B0TEST123', quantityShipped: 10 }],
      },
      'an item without a productName is rejected',
    );
    await pipeRejects(
      CreateFbaInboundShipmentDto,
      {
        marketplace: 'jumia',
        fulfillmentCenterId: 'CAI1',
        items: [{ productId: 42, marketplaceSku: 'B0TEST123', productName: 'Test', quantityShipped: 10 }],
      },
      'a marketplace outside amazon|noon is rejected',
    );
    await pipeRejects(
      CreateFbaInboundShipmentDto,
      {
        marketplace: 'amazon',
        fulfillmentCenterId: 'CAI1',
        items: [{ productId: 42, marketplaceSku: 'B0TEST123', productName: 'Test', quantityShipped: 10 }],
        extra: 1,
      },
      'an extra field is rejected',
    );
  }

  // 8. SaveMarketplaceOnboardingProfileDto — caller: the onboarding
  // modal round-trips the FULL GET check object (initialData spread
  // into formData), so all 22 interface fields can arrive, including
  // checklist[], platformGuides[] (with nested steps[]), the letters,
  // the score and the name-match fields. The service reads ONLY the
  // 16 scalars — the DTO must still accept the computed fields or
  // the save 400s (Package C trap).
  {
    const transformed = await pipeOk(SaveMarketplaceOnboardingProfileDto, {
      companyLegalName: 'Test Trading LLC',
      tradeName: 'Test Store',
      ownerName: 'Ahmed Test',
      ownerNationalId: '29901011234567',
      legalEntityType: 'business',
      hasCreditCard: true,
      commercialRegister: '123456',
      taxNumber: '987654321',
      vatRegistered: true,
      bankName: 'Test Bank',
      bankAccountName: 'Test Trading LLC',
      bankIban: 'EG330019000000000000000000001',
      bankSwift: 'TESTEGCX',
      businessAddress: '1 Test St, Cairo',
      phone: '01012345678',
      email: 'owner@example.com',
      overallReadinessScore: 85,
      nameMatchStatus: 'perfect_match',
      nameMatchDetails: 'Names match exactly',
      checklist: [{ key: 'company', label: 'Company', required: true, status: 'ready', notes: '' }],
      platformGuides: [
        {
          marketplace: 'amazon',
          nameAr: 'أمازون',
          portalUrl: 'https://sellercentral.amazon.eg',
          steps: [{ stepNumber: 1, title: 'Register', instruction: 'Create an account', tip: 'Use the legal name' }],
        },
      ],
      letterOfAuthorizationAr: 'خطاب تفويض',
      letterOfAuthorizationEn: 'Letter of authorization',
    });
    assert.equal(transformed.companyLegalName, 'Test Trading LLC', 'onboarding companyLegalName survives the pipe');
    assert.equal(transformed.checklist?.length, 1, 'an onboarding checklist survives the pipe');
    assert.equal(
      transformed.platformGuides?.[0]?.steps?.[0]?.title,
      'Register',
      'a nested platform-guide step survives the pipe',
    );
    const scalars = await pipeOk(SaveMarketplaceOnboardingProfileDto, {
      tradeName: 'Test Store',
      phone: '01012345678',
    });
    assert.equal(scalars.tradeName, 'Test Store', 'a scalars-only onboarding save passes');
    const empty = await pipeOk(SaveMarketplaceOnboardingProfileDto, {});
    assert.equal(empty.tradeName, undefined, 'an empty onboarding save passes — every field is optional');
    await pipeRejects(
      SaveMarketplaceOnboardingProfileDto,
      { legalEntityType: 'company' },
      'a legalEntityType outside business|individual is rejected',
    );
    await pipeRejects(
      SaveMarketplaceOnboardingProfileDto,
      { checklist: [{ key: 'company', label: 'Company', required: true, status: 'done', notes: '' }] },
      'a checklist status outside ready|missing|warning is rejected',
    );
    await pipeRejects(
      SaveMarketplaceOnboardingProfileDto,
      { tradeName: 'Test Store', extra: 1 },
      'an extra field is rejected',
    );
  }

  // 9. GenerateGtinExemptionDto — caller: marketplace-sync.api.ts
  // generateGtinExemption sends the 5-field shape; the service
  // defaults everything (marketplace 'amazon', reason 'unbranded',
  // brandName 'Generic / Generic Brand', category 'Home / Fashion /
  // General Goods'), so all fields are optional.
  {
    const transformed = await pipeOk(GenerateGtinExemptionDto, {
      productId: 42,
      brandName: 'My Brand',
      category: 'Home',
      marketplace: 'noon',
      reason: 'private_label',
    });
    assert.equal(transformed.marketplace, 'noon', 'gtin marketplace survives the pipe');
    assert.equal(transformed.reason, 'private_label', 'gtin reason survives the pipe');
    const empty = await pipeOk(GenerateGtinExemptionDto, {});
    assert.equal(empty.productId, undefined, 'an empty gtin body passes — every field is optional');
    await pipeRejects(
      GenerateGtinExemptionDto,
      { reason: 'no_barcode' },
      'a reason outside the 4 service values is rejected',
    );
    await pipeRejects(
      GenerateGtinExemptionDto,
      { marketplace: 'ebay' },
      'a marketplace outside the 4 supported is rejected',
    );
    await pipeRejects(GenerateGtinExemptionDto, { brandName: 'My Brand', extra: 1 }, 'an extra field is rejected');
  }

  // 10. ValidateCouponDto — caller: storefront.api.ts validateCoupon
  // sends { code, subtotal } — both required (interface + caller).
  {
    const transformed = await pipeOk(ValidateCouponDto, { code: 'WELCOME10', subtotal: 250 });
    assert.equal(transformed.code, 'WELCOME10', 'coupon code survives the pipe');
    assert.equal(transformed.subtotal, 250, 'coupon subtotal survives the pipe');
    await pipeRejects(ValidateCouponDto, { subtotal: 250 }, 'a missing code is rejected');
    await pipeRejects(ValidateCouponDto, { code: 'WELCOME10' }, 'a missing subtotal is rejected');
    await pipeRejects(ValidateCouponDto, { code: 'WELCOME10', subtotal: 250, extra: 1 }, 'an extra field is rejected');
    await pipeRejects(ValidateCouponDto, { code: 'WELCOME10', subtotal: 'much' }, 'a non-numeric subtotal is rejected');
    // A numeric-string subtotal COERCES to a number (implicit
    // conversion turns '250' into 250 — pinned, not rejected).
    const coercedSubtotal = await pipeOk(ValidateCouponDto, { code: 'WELCOME10', subtotal: '250' });
    assert.strictEqual(coercedSubtotal.subtotal, 250, 'a string subtotal coerces to the number 250');
  }

  // 11. QuoteCartDto — callers: storefront.api.ts quoteCart
  // (POST /cart/quote) + the /quote alias send QuoteCartPayload.
  // The service TOLERATES missing/empty items (it returns a zero
  // quote), so items is OPTIONAL. productId is `number | string`
  // in the type — the DTO narrows to number: a numeric string
  // coerces, a non-numeric one 400s (no real caller sends one).
  {
    const transformed = await pipeOk(QuoteCartDto, {
      items: [
        { productId: 42, quantity: 2, variantName: 'Large' },
        { productId: 43, quantity: 1 },
      ],
      couponCode: 'WELCOME10',
      deliveryZoneId: 3,
      deliveryZoneName: 'Downtown',
      fulfillmentType: 'delivery',
      orderType: 'delivery',
    });
    assert.equal(transformed.items?.length, 2, 'quote items survive the pipe');
    assert.equal(transformed.items?.[0]?.productId, 42, 'a quote productId survives the pipe');
    assert.equal(transformed.items?.[0]?.variantName, 'Large', 'a quote variantName survives the pipe');
    const empty = await pipeOk(QuoteCartDto, {});
    assert.equal(empty.items, undefined, 'an empty quote passes — the service returns a zero quote');
    const emptyItems = await pipeOk(QuoteCartDto, { items: [] });
    assert.deepEqual(emptyItems.items, [], 'an empty items list passes — the service returns a zero quote');
    // A numeric-string productId COERCES to a number (pinned).
    const coercedId = await pipeOk(QuoteCartDto, { items: [{ productId: '42', quantity: 1 }] });
    assert.strictEqual(coercedId.items?.[0]?.productId, 42, 'a string productId coerces to the number 42');
    // fulfillmentType 'dine_in' PASSES: the FRONTEND type is wider
    // than the backend facade type (delivery|pickup) and the service
    // treats non-'pickup' as not-pickup (pinned).
    const dineIn = await pipeOk(QuoteCartDto, {
      items: [{ productId: 42, quantity: 1 }],
      fulfillmentType: 'dine_in',
      orderType: 'dine_in',
      tableNumber: 'T5',
    });
    assert.equal(dineIn.fulfillmentType, 'dine_in', 'a dine_in fulfillmentType passes — the frontend sends it');
    await pipeRejects(QuoteCartDto, { items: [{ productId: 42 }] }, 'an item without a quantity is rejected');
    await pipeRejects(
      QuoteCartDto,
      { items: [{ productId: 'ABC', quantity: 1 }] },
      'a non-numeric productId is rejected',
    );
    await pipeRejects(
      QuoteCartDto,
      { items: [{ productId: 42, quantity: 1 }], fulfillmentType: 'drone' },
      'a fulfillmentType outside delivery|pickup|dine_in is rejected',
    );
    await pipeRejects(
      QuoteCartDto,
      { items: [{ productId: 42, quantity: 1 }], extra: 1 },
      'an extra field is rejected',
    );
  }

  // 12. MockPayDto — caller: storefront.api.ts mockPayOrder sends
  // payload || {} — both fields optional; an empty {} passes.
  {
    const transformed = await pipeOk(MockPayDto, { cardNumber: '4242424242424242', cardHolder: 'Test User' });
    assert.equal(transformed.cardNumber, '4242424242424242', 'mock cardNumber survives the pipe');
    const empty = await pipeOk(MockPayDto, {});
    assert.equal(empty.cardNumber, undefined, 'an empty mock-pay body passes — both fields optional');
    await pipeRejects(MockPayDto, { cardNumber: '4242424242424242', extra: 1 }, 'an extra field is rejected');
    // A numeric cardNumber COERCES to a string (implicit conversion
    // turns 4242 into '4242' — pinned, not rejected).
    const coercedCard = await pipeOk(MockPayDto, { cardNumber: 4242 });
    assert.strictEqual(coercedCard.cardNumber, '4242', 'a numeric cardNumber coerces to the string "4242"');
  }

  // 13. PayTableBillDto — caller: storefront.api.ts payTableBill
  // sends the 4-field shape, all optional. NOTE: the service throws
  // ServiceUnavailable unconditionally today, so every call 503s —
  // the DTO only validates shape; the 503 behavior is unchanged.
  {
    const transformed = await pipeOk(PayTableBillDto, {
      tipAmount: 10,
      paymentMethod: 'cash',
      guestName: 'Guest',
      guestPhone: '01012345678',
    });
    assert.equal(transformed.tipAmount, 10, 'pay-bill tipAmount survives the pipe');
    assert.equal(transformed.paymentMethod, 'cash', 'pay-bill paymentMethod survives the pipe');
    const empty = await pipeOk(PayTableBillDto, {});
    assert.equal(empty.tipAmount, undefined, 'an empty pay-bill body passes — every field is optional');
    await pipeRejects(PayTableBillDto, { tipAmount: 10, extra: 1 }, 'an extra field is rejected');
    await pipeRejects(PayTableBillDto, { tipAmount: 'much' }, 'a non-numeric tipAmount is rejected');
    // A numeric-string tipAmount COERCES to a number (implicit
    // conversion turns '10' into 10 — pinned, not rejected).
    const coercedTip = await pipeOk(PayTableBillDto, { tipAmount: '10' });
    assert.strictEqual(coercedTip.tipAmount, 10, 'a string tipAmount coerces to the number 10');
  }

  // 14. Source pins: the controllers take the DTO classes, and the 6
  // webhook sites still take `any` (pinned exclusions — see the
  // header; a future agent must not "fix" them into DTOs).
  {
    const sync = readSrc('modules/storefront/controllers/marketplace-sync.controller.ts');
    for (const name of [
      'SaveMarketplaceConfigDto',
      'SaveMarketplaceSkuMappingDto',
      'CalculateMarketplaceFeesDto',
      'UpdateCompetitorPriceDto',
      'ReconcileMarketplaceSettlementDto',
      'SaveRepricingSettingsDto',
      'CreateFbaInboundShipmentDto',
      'SaveMarketplaceOnboardingProfileDto',
      'GenerateGtinExemptionDto',
    ]) {
      assert.ok(sync.includes(name), `marketplace-sync controller takes ${name}`);
    }
    const syncAnyCount = sync.split('@Body() payload: any').length - 1;
    assert.equal(syncAnyCount, 1, 'exactly one `any` body remains in marketplace-sync — the :187 webhook');
    assert.ok(sync.includes('handleWebhook'), 'the marketplace webhook handler still exists');
    const pub = readSrc('modules/storefront/storefront-public.controller.ts');
    for (const name of ['ValidateCouponDto', 'QuoteCartDto', 'MockPayDto', 'PayTableBillDto']) {
      assert.ok(pub.includes(name), `storefront-public controller takes ${name}`);
    }
    const pubAnyCount = pub.split('@Body() body: any').length - 1;
    assert.equal(pubAnyCount, 5, 'exactly five `any` bodies remain in storefront-public — the 5 webhooks');
    for (const name of [
      'handlePaymobWebhook',
      'handleXPayWebhook',
      'handleTapWebhook',
      'handleStripeWebhook',
      'handleMarketplaceWebhook',
    ]) {
      assert.ok(pub.includes(name), `the ${name} handler still exists`);
    }
    console.log('  source pins passed');
  }

  // 15. Wiring: this spec is in both critical lists, in identical order
  // (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 397);
    assert.equal(chain.length, 397);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/dto-storefront.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-d-m3-mail-nested.spec.ts');
    console.log('  evidence spec wired into both critical lists (373 = 373, identical order), passed');
  }

  console.log('DTO storefront tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
