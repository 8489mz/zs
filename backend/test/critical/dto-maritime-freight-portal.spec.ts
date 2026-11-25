/*
 * New file: backend/test/critical/dto-maritime-freight-portal.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-MARITIME-FREIGHT-28, D4): the maritime
 * customer portal routes (login / token-login / quote request /
 * approve / reject) and the public carrier bid route now take DTO
 * classes, so the real global requestValidationPipe validates and
 * whitelists them. Before D4 they took inline types or `any` (and
 * the quote request took an interface named *Dto) — and the pipe
 * does nothing for an inline type, `any`, or an interface, so any
 * extra field (or a wrong-typed field) reached the service untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH DTO, (a) a positive case with the REAL caller payload (the
 * exact shape the frontend api file sends — see the per-case comments
 * for the caller file), which must pass the pipe with every field
 * intact, and (b) two negative cases: an extra field the caller never
 * sends is rejected with 400 VALIDATION_ERROR, and a wrong-typed
 * field is rejected the same way.
 *
 * AUTH-ADJACENT (portal login / token-login): these are the only
 * calls a freight customer can reach unauthenticated, and a DTO that
 * rejects a real customer payload locks customers out of their
 * portal. Their positive cases use the real caller payloads with no
 * exceptions. The portal PIN route is in dto-maritime-freight.spec.ts
 * (staff-side); the quote request is here because it lives in the
 * portal service.
 *
 * CALLER TRAPS PINNED HERE (found during D4 caller verification):
 * - MaritimeCustomerLoginDto.phone: a numeric phone coerces to its
 *   string form under enableImplicitConversion (the service String()s
 *   it the same way today), so the wrong-type case uses an array,
 *   which does not coerce.
 * - CreatePortalQuoteRequestDto: the form always sends the 15
 *   fields below; transportMode/polCode/polName/podCode/podName/
 *   commodityDescription stay required (the form client-validates
 *   the description and always picks ports); cargoReadyDate and
 *   notes are sent as '' and pass as strings. volumetricWeightKg,
 *   chargeableWeightKg, targetDeliveryDate and targetFreeDays are
 *   never sent by the form — they stay optional because the service
 *   reads them.
 * - SubmitPublicCarrierBidDto.token: OPTIONAL on purpose. A missing
 *   or mismatched token must still reach the service's own 404
 *   (assertValidPublicQuoteToken), not become a 400 at the boundary.
 *   The positive case carries the token the page always sends.
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop —
 * e.g. INVALID_CREDENTIALS on a blank phone/pin, the service's 404
 * on a bad public-quote token, the PASSCODE rules on the PIN);
 * the frontend screens (untouched).
 *
 * Fail-first: this spec is new in D4 — on the unpatched tree the DTO
 * classes do not exist, so the imports fail (MODULE_NOT_FOUND) and the
 * spec exits 1 (see the log). GREEN means the pipe accepts every real
 * caller payload and rejects every extra/wrong-typed field below.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import {
  ApproveQuotationDto,
  MaritimeCustomerLoginDto,
  MaritimeCustomerTokenLoginDto,
  RejectQuotationDto,
} from '../../src/modules/maritime-freight/dto/customer-portal.dto';
import { CreatePortalQuoteRequestDto } from '../../src/modules/maritime-freight/maritime-customer-portal.service';
import { SubmitPublicCarrierBidDto } from '../../src/modules/maritime-freight/dto/public-carrier-bid.dto';

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

async function main(): Promise<void> {
  // 1. MaritimeCustomerLoginDto — caller: freightCustomerPortalApi.login
  // sends { phone, pinCode, companyCode? | tenantId? }
  // (frontend/.../maritime-freight-portal-api.ts).
  {
    const transformed = await pipeOk(MaritimeCustomerLoginDto, {
      phone: '01012345678',
      pinCode: '1234',
      companyCode: 'ACME',
    });
    assert.equal(transformed.phone, '01012345678', 'the customer phone survives the pipe');
    assert.equal(transformed.pinCode, '1234', 'the customer PIN survives the pipe');
    assert.equal(transformed.companyCode, 'ACME', 'the company code survives the pipe');
    const withTenant = await pipeOk(MaritimeCustomerLoginDto, {
      phone: '01012345678',
      pinCode: '1234',
      tenantId: 't-1',
    });
    assert.equal(withTenant.tenantId, 't-1', 'the tenant disambiguation survives the pipe');
    await pipeRejects(
      MaritimeCustomerLoginDto,
      { phone: '01012345678', pinCode: '1234', role: 'admin' },
      'an extra role must be rejected on customer login',
    );
    await pipeRejects(
      MaritimeCustomerLoginDto,
      { phone: ['01012345678'], pinCode: '1234' },
      'an array phone must be rejected on customer login',
    );
    console.log('  (1) MaritimeCustomerLoginDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 2. MaritimeCustomerTokenLoginDto — caller:
  // freightCustomerPortalApi.tokenLogin sends { token }.
  {
    const transformed = await pipeOk(MaritimeCustomerTokenLoginDto, { token: 'portal-token-abc' });
    assert.equal(transformed.token, 'portal-token-abc', 'the portal token survives the pipe');
    await pipeRejects(
      MaritimeCustomerTokenLoginDto,
      { token: 'portal-token-abc', admin: true },
      'an extra admin flag must be rejected on token login',
    );
    await pipeRejects(MaritimeCustomerTokenLoginDto, { token: '' }, 'an empty token must be rejected on token login');
    console.log('  (2) MaritimeCustomerTokenLoginDto: real caller payload passes, extra/empty rejected passed');
  }

  // 3. CreatePortalQuoteRequestDto — caller: MaritimeCustomerPortalPage
  // always sends the 15 fields below (frontend/.../
  // MaritimeCustomerPortalPage.tsx:58).
  {
    const transformed = await pipeOk(CreatePortalQuoteRequestDto, {
      transportMode: 'sea',
      direction: 'import',
      polCode: 'EGALY',
      polName: 'Alexandria',
      podCode: 'AEJEA',
      podName: 'Jebel Ali',
      cargoMode: 'FCL',
      containerType: "40' HC",
      containerCount: 2,
      commodityDescription: 'Dates, packed cartons',
      grossWeightKg: 12000,
      totalCbm: 55,
      incoterm: 'FOB',
      cargoReadyDate: '',
      notes: '',
    });
    assert.equal(transformed.transportMode, 'sea', 'the transport mode survives the pipe');
    assert.equal(transformed.polCode, 'EGALY', 'the POL code survives the pipe');
    assert.equal(transformed.containerCount, 2, 'the container count survives the pipe');
    assert.equal(transformed.commodityDescription, 'Dates, packed cartons', 'the description survives the pipe');
    const withTargets = await pipeOk(CreatePortalQuoteRequestDto, {
      transportMode: 'air',
      polCode: 'EGCAI',
      polName: 'Cairo',
      podCode: 'AEJEA',
      podName: 'Jebel Ali',
      commodityDescription: 'Frozen strawberries',
      volumetricWeightKg: 800,
      chargeableWeightKg: 900,
      targetDeliveryDate: '2026-12-20',
      targetFreeDays: 14,
    });
    assert.equal(withTargets.volumetricWeightKg, 800, 'the volumetric weight survives the pipe');
    assert.equal(withTargets.targetFreeDays, 14, 'the target free days survive the pipe');
    await pipeRejects(
      CreatePortalQuoteRequestDto,
      {
        transportMode: 'sea',
        polCode: 'EGALY',
        polName: 'Alexandria',
        podCode: 'AEJEA',
        podName: 'Jebel Ali',
        commodityDescription: 'Dates',
        isAdmin: true,
      },
      'an extra admin flag must be rejected on a quote request',
    );
    await pipeRejects(
      CreatePortalQuoteRequestDto,
      {
        transportMode: 'sea',
        polCode: 'EGALY',
        polName: 'Alexandria',
        podCode: 'AEJEA',
        podName: 'Jebel Ali',
        commodityDescription: '',
      },
      'an empty commodity description must be rejected on a quote request',
    );
    await pipeRejects(
      CreatePortalQuoteRequestDto,
      {
        transportMode: 'sea',
        polCode: 'EGALY',
        polName: 'Alexandria',
        podCode: 'AEJEA',
        podName: 'Jebel Ali',
        commodityDescription: 'Dates',
        containerCount: 'two',
      },
      'a non-numeric container count must be rejected on a quote request',
    );
    console.log(
      '  (3) CreatePortalQuoteRequestDto: real caller payload passes, extra/empty/wrong-type rejected passed',
    );
  }

  // 4. ApproveQuotationDto — caller: freightCustomerPortalApi.
  // approveQuotation sends { approvalNotes?, clientReference?,
  // confirmedBy? } (the portal page sends the client reference from
  // the PO-number field and the confirmed-by name from the logged-in
  // customer; either may be absent).
  {
    const transformed = await pipeOk(ApproveQuotationDto, {
      approvalNotes: 'Approved, please proceed',
      clientReference: 'PO-2026-118',
      confirmedBy: 'Acme Trading',
    });
    assert.equal(transformed.clientReference, 'PO-2026-118', 'the client reference survives the pipe');
    assert.equal(transformed.confirmedBy, 'Acme Trading', 'the confirmed-by name survives the pipe');
    const empty = await pipeOk(ApproveQuotationDto, {});
    assert.equal(empty.approvalNotes, undefined, 'an empty approve payload passes (all optional)');
    await pipeRejects(
      ApproveQuotationDto,
      { approvalNotes: 'ok', isAdmin: true },
      'an extra admin flag must be rejected on approve',
    );
    await pipeRejects(
      ApproveQuotationDto,
      { approvalNotes: ['ok'] },
      'an array approval note must be rejected on approve',
    );
    console.log('  (4) ApproveQuotationDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 5. RejectQuotationDto — caller: freightCustomerPortalApi.
  // rejectQuotation sends { reason? }.
  {
    const transformed = await pipeOk(RejectQuotationDto, { reason: 'Price too high' });
    assert.equal(transformed.reason, 'Price too high', 'the reject reason survives the pipe');
    const empty = await pipeOk(RejectQuotationDto, {});
    assert.equal(empty.reason, undefined, 'an empty reject payload passes (reason optional)');
    await pipeRejects(
      RejectQuotationDto,
      { reason: 'too high', isAdmin: true },
      'an extra admin flag must be rejected on reject',
    );
    await pipeRejects(RejectQuotationDto, { reason: ['too high'] }, 'an array reason must be rejected on reject');
    console.log('  (5) RejectQuotationDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 6. SubmitPublicCarrierBidDto — caller: PublicCarrierQuotePage sends
  // the 13 fields below (frontend/.../PublicCarrierQuotePage.tsx).
  {
    const transformed = await pipeOk(SubmitPublicCarrierBidDto, {
      token: 'quote-token-abc',
      shippingLineName: 'Maersk',
      shippingLineId: 7,
      oceanFreight: 1250,
      currency: 'USD',
      thcOrigin: 120,
      thcDestination: 140,
      bafCharges: 85,
      otherCharges: 0,
      transitTimeDays: 18,
      freeDays: 14,
      validityDate: '',
      notes: '',
    });
    assert.equal(transformed.shippingLineName, 'Maersk', 'the line name survives the pipe');
    assert.equal(transformed.oceanFreight, 1250, 'the ocean freight survives the pipe');
    assert.equal(transformed.transitTimeDays, 18, 'the transit time survives the pipe');
    const legacyName = await pipeOk(SubmitPublicCarrierBidDto, {
      token: 'quote-token-abc',
      lineName: 'MSC',
      oceanFreight: 900,
      currency: 'USD',
    });
    assert.equal(legacyName.lineName, 'MSC', 'the legacy lineName spelling survives the pipe');
    const nullLine = await pipeOk(SubmitPublicCarrierBidDto, {
      token: 'quote-token-abc',
      shippingLineName: 'CMA CGM',
      shippingLineId: null,
      oceanFreight: 1100,
    });
    assert.equal(nullLine.shippingLineId, null, 'a null shipping line id survives the pipe');
    await pipeRejects(
      SubmitPublicCarrierBidDto,
      { token: 'quote-token-abc', oceanFreight: 1250, isAdmin: true },
      'an extra admin flag must be rejected on a public bid',
    );
    await pipeRejects(
      SubmitPublicCarrierBidDto,
      { token: 'quote-token-abc', oceanFreight: 'twelve-fifty' },
      'a non-numeric ocean freight must be rejected on a public bid',
    );
    await pipeRejects(
      SubmitPublicCarrierBidDto,
      { token: 'quote-token-abc', oceanFreight: 1250, transitTimeDays: 18.5 },
      'a fractional transit time must be rejected on a public bid',
    );
    console.log('  (6) SubmitPublicCarrierBidDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // Source pins: the portal controller takes the DTO classes (not the
  // old inline types), the public tracking controller takes the bid
  // DTO, and the quote interface is gone from the portal service.
  {
    const read = (rel: string): string => readFileSync(resolve(__dirname, '../../src', rel), 'utf8');
    const portalController = read('modules/maritime-freight/maritime-customer-portal.controller.ts');
    assert.ok(
      portalController.includes('MaritimeCustomerLoginDto'),
      'the portal controller takes MaritimeCustomerLoginDto',
    );
    assert.ok(
      portalController.includes('MaritimeCustomerTokenLoginDto'),
      'the portal controller takes MaritimeCustomerTokenLoginDto',
    );
    assert.ok(portalController.includes('ApproveQuotationDto'), 'the portal controller takes ApproveQuotationDto');
    assert.ok(portalController.includes('RejectQuotationDto'), 'the portal controller takes RejectQuotationDto');
    assert.ok(!portalController.includes('body: {'), 'no portal route takes an inline object type anymore');
    const trackingController = read('modules/maritime-freight/maritime-public-tracking.controller.ts');
    assert.ok(
      trackingController.includes('SubmitPublicCarrierBidDto'),
      'the public tracking controller takes SubmitPublicCarrierBidDto',
    );
    assert.ok(!trackingController.includes('dto: any'), 'no public tracking route takes any anymore');
    const portalService = read('modules/maritime-freight/maritime-customer-portal.service.ts');
    assert.ok(
      portalService.includes('export class CreatePortalQuoteRequestDto'),
      'CreatePortalQuoteRequestDto is a class, not an interface',
    );
    assert.ok(
      !portalService.includes('export interface CreatePortalQuoteRequestDto'),
      'the quote request interface is gone',
    );
    const portalDto = read('modules/maritime-freight/dto/customer-portal.dto.ts');
    assert.ok(portalDto.includes('export class MaritimeCustomerLoginDto'), 'MaritimeCustomerLoginDto is a class');
    assert.ok(
      portalDto.includes('export class MaritimeCustomerTokenLoginDto'),
      'MaritimeCustomerTokenLoginDto is a class',
    );
    console.log('  source pins passed');
  }

  console.log('DTO maritime-freight portal tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
