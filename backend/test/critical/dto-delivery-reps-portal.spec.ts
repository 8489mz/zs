/*
 * New file: backend/test/critical/dto-delivery-reps-portal.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-DELIVERY-REPS-58, D3): the driver-portal
 * (login / change-pin / settle), delivery-reps settlement + dispatch,
 * admin pre-sales, and promotion upsert routes now take DTO classes,
 * so the real global requestValidationPipe validates and whitelists
 * them. Before D3 they took inline types or `any` — and the pipe does
 * nothing for an inline type or `any`, so any extra field (or a
 * wrong-typed field) reached the service untouched.
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
 * AUTH-ADJACENT (login / change-pin / settle): these three are the
 * only driver-portal calls a rep can reach, and a DTO that rejects a
 * real driver payload locks drivers out of their portal. Their
 * positive cases use the real caller payloads with no exceptions.
 *
 * CALLER TRAPS PINNED HERE (found during D3 caller verification):
 * - ConvertPreSalesOrderDto: the caller sends paymentMethod only,
 *   the service reads paymentType only. PRE-EXISTING MISMATCH, NOT
 *   fixed here: the DTO accepts both spellings so the caller does
 *   not 400; the caller's payment choice is still dropped by the
 *   service today (it defaults to the order's payment terms).
 * - UpsertFmcgPromotionDto.buyConditions: an ARRAY for mix_and_match,
 *   an OBJECT for tiered_qty / invoice_threshold. The stock IsObject
 *   validator rejects arrays (probed: 1 error on an array, 0 on an
 *   object), so the field uses the custom IsObjectOrArray validator.
 *   Both shapes are pinned positive below.
 * - DriverLoginDto.phone / pinCode: a numeric phone coerces to its
 *   string form under enableImplicitConversion (the service String()s
 *   it the same way today), so the wrong-type case uses an array,
 *   which does not coerce.
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop for
 * conditional rules — e.g. the either/or rep rule on consolidate,
 * the both-empty rule on dispatch, the INVALID_PROMOTION_NAME throw
 * on a blank promotion name); the frontend screens (untouched).
 *
 * Fail-first: this spec is new in D3 — on the unpatched tree the DTO
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
  DriverChangePinDto,
  DriverLoginDto,
  DriverSettleOrderDto,
} from '../../src/modules/delivery-reps/dto/driver-portal.dto';
import {
  DispatchDeliveryOrdersDto,
  SettleAllDeliveryOrdersDto,
  SettleDeliveryOrderDto,
} from '../../src/modules/delivery-reps/dto/delivery-reps-settlement.dto';
import {
  ConsolidatePreSalesOrdersDto,
  ConvertPreSalesOrderDto,
} from '../../src/modules/delivery-reps/dto/van-pre-sales.dto';
import {
  UpdateFmcgPromotionDto,
  UpsertFmcgPromotionDto,
} from '../../src/modules/delivery-reps/services/van-promotions.service';

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
  // 1. DriverLoginDto — caller: DriverPortalLogin.tsx sends
  // { phone, pinCode } plus companyCode (from the URL ?c=/?tenant=
  // or localStorage) or tenantId for disambiguation.
  {
    const transformed = await pipeOk(DriverLoginDto, {
      phone: '01012345678',
      pinCode: '1234',
      companyCode: 'ACME',
    });
    assert.equal(transformed.phone, '01012345678', 'the driver phone survives the pipe');
    assert.equal(transformed.pinCode, '1234', 'the driver PIN survives the pipe');
    assert.equal(transformed.companyCode, 'ACME', 'the company code survives the pipe');
    const withTenant = await pipeOk(DriverLoginDto, { phone: '01012345678', pinCode: '1234', tenantId: 't-1' });
    assert.equal(withTenant.tenantId, 't-1', 'the tenant disambiguation survives the pipe');
    await pipeRejects(
      DriverLoginDto,
      { phone: '01012345678', pinCode: '1234', role: 'admin' },
      'an extra role must be rejected on driver login',
    );
    await pipeRejects(
      DriverLoginDto,
      { phone: ['01012345678'], pinCode: '1234' },
      'an array phone must be rejected on driver login',
    );
    console.log('  (1) DriverLoginDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 2. DriverChangePinDto — caller: DriverPinChangeScreen.tsx sends
  // { currentPin, newPin } always.
  {
    const transformed = await pipeOk(DriverChangePinDto, { currentPin: '0000', newPin: '5678' });
    assert.equal(transformed.currentPin, '0000', 'the current PIN survives the pipe');
    assert.equal(transformed.newPin, '5678', 'the new PIN survives the pipe');
    await pipeRejects(
      DriverChangePinDto,
      { currentPin: '0000', newPin: '5678', pinCode: '0000' },
      'an extra pinCode must be rejected on change-pin',
    );
    await pipeRejects(
      DriverChangePinDto,
      { currentPin: ['0000'], newPin: '5678' },
      'an array current PIN must be rejected on change-pin',
    );
    console.log('  (2) DriverChangePinDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 3. DriverSettleOrderDto — caller: the driver portal settle call
  // sends the proof fields, all optional.
  {
    const transformed = await pipeOk(DriverSettleOrderDto, {
      signatureDataUrl: 'data:image/png;base64,AAA',
      proofPhotoUrl: 'https://x/y.jpg',
      gpsLat: 30.05,
      gpsLng: 31.25,
      notes: 'delivered',
    });
    assert.equal(transformed.signatureDataUrl, 'data:image/png;base64,AAA', 'the signature survives the pipe');
    assert.equal(transformed.gpsLat, 30.05, 'the GPS latitude survives the pipe');
    const empty = await pipeOk(DriverSettleOrderDto, {});
    assert.equal(empty.signatureDataUrl, undefined, 'an empty settle passes the pipe (all fields optional)');
    await pipeRejects(
      DriverSettleOrderDto,
      { signatureDataUrl: 'x', driverId: 1 },
      'an extra driverId must be rejected on portal settle',
    );
    await pipeRejects(
      DriverSettleOrderDto,
      { gpsLat: 'north' },
      'a string GPS latitude must be rejected on portal settle',
    );
    console.log('  (3) DriverSettleOrderDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 4. SettleDeliveryOrderDto — caller: the delivery-reps settle /
  // settle-partial calls send the same 6 optional fields.
  {
    const transformed = await pipeOk(SettleDeliveryOrderDto, {
      signatureDataUrl: 'data:image/png;base64,AAA',
      proofPhotoUrl: 'https://x/y.jpg',
      gpsLat: 30.05,
      gpsLng: 31.25,
      notes: 'settled',
      countedCashAmount: 1250.5,
    });
    assert.equal(transformed.countedCashAmount, 1250.5, 'the counted cash survives the pipe');
    await pipeRejects(
      SettleDeliveryOrderDto,
      { countedCashAmount: 100, saleId: 5 },
      'an extra saleId must be rejected on settle-order',
    );
    await pipeRejects(
      SettleDeliveryOrderDto,
      { countedCashAmount: -5 },
      'a negative counted cash must be rejected on settle-order',
    );
    console.log('  (4) SettleDeliveryOrderDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 5. SettleAllDeliveryOrdersDto — caller: the settle-all call
  // sends { expectedAmount, countedCashAmount? }.
  {
    const transformed = await pipeOk(SettleAllDeliveryOrdersDto, { expectedAmount: 5000, countedCashAmount: 4980 });
    assert.equal(transformed.expectedAmount, 5000, 'the expected amount survives the pipe');
    assert.equal(transformed.countedCashAmount, 4980, 'the counted cash survives the pipe');
    await pipeRejects(
      SettleAllDeliveryOrdersDto,
      { expectedAmount: 5000, repId: 1 },
      'an extra repId must be rejected on settle-all',
    );
    await pipeRejects(
      SettleAllDeliveryOrdersDto,
      { expectedAmount: -1 },
      'a negative expected amount must be rejected on settle-all',
    );
    await pipeRejects(SettleAllDeliveryOrdersDto, {}, 'a missing expected amount must be rejected on settle-all');
    console.log('  (5) SettleAllDeliveryOrdersDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 6. DispatchDeliveryOrdersDto — caller: the dispatch call sends
  // { repId, saleIds?, onlineOrderIds?, notes? }.
  {
    const transformed = await pipeOk(DispatchDeliveryOrdersDto, {
      repId: 3,
      saleIds: [11, 12],
      notes: 'morning round',
    });
    assert.equal(transformed.repId, 3, 'the rep survives the pipe');
    assert.deepEqual(transformed.saleIds, [11, 12], 'the sale ids survive the pipe');
    await pipeRejects(
      DispatchDeliveryOrdersDto,
      { repId: 3, saleIds: [11], driverId: 1 },
      'an extra driverId must be rejected on dispatch',
    );
    await pipeRejects(
      DispatchDeliveryOrdersDto,
      { repId: 3, saleIds: [11, 11] },
      'duplicate sale ids must be rejected on dispatch',
    );
    console.log('  (6) DispatchDeliveryOrdersDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 7. ConsolidatePreSalesOrdersDto — caller: the admin consolidate
  // dialog sends { orderIds, deliveryRepId, sourceWarehouseId?,
  // notes? } (deliveryRepId is the F18 name; targetRepId is the
  // older name — both accepted).
  {
    const transformed = await pipeOk(ConsolidatePreSalesOrdersDto, {
      orderIds: [101, 102],
      deliveryRepId: 3,
      sourceWarehouseId: 2,
      notes: 'consolidate',
    });
    assert.deepEqual(transformed.orderIds, [101, 102], 'the order ids survive the pipe');
    assert.equal(transformed.deliveryRepId, 3, 'the delivery rep survives the pipe');
    const older = await pipeOk(ConsolidatePreSalesOrdersDto, { orderIds: [101], targetRepId: 3 });
    assert.equal(older.targetRepId, 3, 'the older targetRepId spelling survives the pipe');
    await pipeRejects(
      ConsolidatePreSalesOrdersDto,
      { orderIds: [101], repId: 3 },
      'an extra repId must be rejected on consolidate',
    );
    await pipeRejects(
      ConsolidatePreSalesOrdersDto,
      { orderIds: [] },
      'an empty order list must be rejected on consolidate',
    );
    console.log('  (7) ConsolidatePreSalesOrdersDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 8. ConvertPreSalesOrderDto — caller:
  // convertAdminPreSalesOrderToInvoice sends { paymentMethod?,
  // notes? } (paymentMethod only). The whole body is optional and
  // the caller always sends at least an empty object.
  {
    const transformed = await pipeOk(ConvertPreSalesOrderDto, { paymentMethod: 'cash', notes: 'paid' });
    assert.equal(transformed.paymentMethod, 'cash', 'the caller paymentMethod spelling survives the pipe');
    const empty = await pipeOk(ConvertPreSalesOrderDto, {});
    assert.equal(empty.paymentMethod, undefined, 'an empty convert passes the pipe (all fields optional)');
    const older = await pipeOk(ConvertPreSalesOrderDto, { paymentType: 'credit' });
    assert.equal(older.paymentType, 'credit', 'the service paymentType spelling survives the pipe');
    await pipeRejects(
      ConvertPreSalesOrderDto,
      { paymentMethod: 'cash', paid: true },
      'an extra paid flag must be rejected on convert-invoice',
    );
    await pipeRejects(
      ConvertPreSalesOrderDto,
      { paymentMethod: 'cheque' },
      'a payment method outside the union must be rejected on convert-invoice',
    );
    console.log('  (8) ConvertPreSalesOrderDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 9. UpsertFmcgPromotionDto — caller: VanPromotionsAdminTab builds
  // the payload explicitly. buyConditions is an ARRAY for
  // mix_and_match and an OBJECT for tiered_qty / invoice_threshold;
  // both shapes are pinned positive here.
  {
    const mixAndMatch = await pipeOk(UpsertFmcgPromotionDto, {
      name: 'Buy 2 get 1',
      code: 'B2G1',
      promoType: 'mix_and_match',
      applyType: 'free_bonus',
      buyConditions: [{ productId: 10, minQty: 2 }],
      reward: { bonusProductId: 11, bonusProductName: 'Item B', bonusQty: 1, bonusReason: 'promo: Buy 2 get 1' },
      startDate: null,
      endDate: null,
      maxApplicationsPerOrder: 1,
      priority: 0,
      notes: null,
    });
    assert.equal(mixAndMatch.name, 'Buy 2 get 1', 'the promotion name survives the pipe');
    assert.equal(Array.isArray(mixAndMatch.buyConditions), true, 'the array buyConditions survive the pipe');
    assert.equal(mixAndMatch.reward.bonusProductId, 11, 'the bonus product survives the pipe');
    const tiered = await pipeOk(UpsertFmcgPromotionDto, {
      name: 'Tiered 5+',
      promoType: 'tiered_qty',
      applyType: 'discount_percent',
      buyConditions: { minQty: 5 },
      reward: { discountPercent: 10 },
      maxApplicationsPerOrder: 1,
      priority: 0,
    });
    assert.equal(typeof tiered.buyConditions, 'object', 'the object buyConditions survive the pipe');
    assert.equal(tiered.reward.discountPercent, 10, 'the discount percent survives the pipe');
    await pipeRejects(
      UpsertFmcgPromotionDto,
      {
        name: 'x',
        promoType: 'mix_and_match',
        applyType: 'free_bonus',
        buyConditions: [],
        reward: {},
        maxApplicationsPerOrder: 1,
        priority: 0,
        promoId: 1,
      },
      'an extra promoId must be rejected on create-promotion',
    );
    await pipeRejects(
      UpsertFmcgPromotionDto,
      {
        name: 'x',
        promoType: 'mix_and_match',
        applyType: 'free_bonus',
        buyConditions: 'buy 2',
        reward: {},
        maxApplicationsPerOrder: 1,
        priority: 0,
      },
      'a string buyConditions must be rejected on create-promotion',
    );
    console.log('  (9) UpsertFmcgPromotionDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 10. UpdateFmcgPromotionDto — the update service takes Partial
  // of the upsert shape, so a name-less partial update is legitimate:
  // the positive case updates only isActive, with no name.
  {
    const transformed = await pipeOk(UpdateFmcgPromotionDto, { isActive: false });
    assert.equal(transformed.isActive, false, 'the partial update survives the pipe');
    const full = await pipeOk(UpdateFmcgPromotionDto, {
      name: 'Renamed',
      promoType: 'invoice_threshold',
      applyType: 'discount_amount',
      buyConditions: { minInvoiceTotal: 5000 },
      reward: { discountAmount: 100 },
    });
    assert.equal(full.name, 'Renamed', 'the renamed promotion survives the pipe');
    await pipeRejects(
      UpdateFmcgPromotionDto,
      { isActive: false, promoId: 1 },
      'an extra promoId must be rejected on update-promotion',
    );
    await pipeRejects(
      UpdateFmcgPromotionDto,
      { buyConditions: 42 },
      'a numeric buyConditions must be rejected on update-promotion',
    );
    console.log('  (10) UpdateFmcgPromotionDto: partial update passes, extra/wrong-type rejected passed');
  }

  // Source pins: every controller takes the DTO class (not an
  // interface, not an inline type, not `any`), and every DTO file
  // declares classes.
  {
    const here = __dirname;
    const read = (p: string): string => readFileSync(resolve(here, '../../src', p), 'utf8');
    const portalController = read('modules/delivery-reps/driver-portal.controller.ts');
    assert.ok(portalController.includes('DriverLoginDto'), 'the portal controller takes DriverLoginDto');
    assert.ok(portalController.includes('DriverChangePinDto'), 'the portal controller takes DriverChangePinDto');
    assert.ok(portalController.includes('DriverSettleOrderDto'), 'the portal controller takes DriverSettleOrderDto');
    const repsController = read('modules/delivery-reps/delivery-reps.controller.ts');
    assert.ok(repsController.includes('SettleDeliveryOrderDto'), 'the reps controller takes SettleDeliveryOrderDto');
    assert.ok(
      repsController.includes('SettleAllDeliveryOrdersDto'),
      'the reps controller takes SettleAllDeliveryOrdersDto',
    );
    assert.ok(
      repsController.includes('DispatchDeliveryOrdersDto'),
      'the reps controller takes DispatchDeliveryOrdersDto',
    );
    const adminController = read('modules/delivery-reps/van-sales-admin.controller.ts');
    assert.ok(
      adminController.includes('ConsolidatePreSalesOrdersDto'),
      'the admin controller takes ConsolidatePreSalesOrdersDto',
    );
    assert.ok(
      adminController.includes('ConvertPreSalesOrderDto'),
      'the admin controller takes ConvertPreSalesOrderDto',
    );
    assert.ok(adminController.includes('UpsertFmcgPromotionDto'), 'the admin controller takes UpsertFmcgPromotionDto');
    assert.ok(adminController.includes('UpdateFmcgPromotionDto'), 'the admin controller takes UpdateFmcgPromotionDto');
    assert.ok(!adminController.includes('body: any'), 'no admin promotion route takes any anymore');
    const portalDto = read('modules/delivery-reps/dto/driver-portal.dto.ts');
    assert.ok(portalDto.includes('export class DriverLoginDto'), 'DriverLoginDto is a class, not an interface');
    assert.ok(portalDto.includes('export class DriverChangePinDto'), 'DriverChangePinDto is a class, not an interface');
    const promotionsService = read('modules/delivery-reps/services/van-promotions.service.ts');
    assert.ok(
      promotionsService.includes('export class UpsertFmcgPromotionDto'),
      'UpsertFmcgPromotionDto is a class, not an interface',
    );
    assert.ok(
      promotionsService.includes('export class UpdateFmcgPromotionDto'),
      'UpdateFmcgPromotionDto is a class, not an interface',
    );
    assert.ok(
      !promotionsService.includes('export interface UpsertFmcgPromotionDto'),
      'the promotion interface is gone',
    );
    console.log('  source pins passed');
  }

  console.log('DTO delivery-reps portal tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
