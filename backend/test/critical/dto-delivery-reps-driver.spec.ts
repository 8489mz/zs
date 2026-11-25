/*
 * New file: backend/test/critical/dto-delivery-reps-driver.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-DELIVERY-REPS-58, D3): the driver
 * van-sales routes (pre-sales, trips, sales, collections, swaps,
 * returns, customers, visits, transfers, expenses, packaging,
 * promotions, routes, surveys, breadcrumbs) now take DTO classes, so
 * the real global requestValidationPipe validates and whitelists
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
 * CALLER TRAPS PINNED HERE (found during D3 caller verification):
 * - CreatePreSalesOrderDto was an INTERFACE in the service types
 *   file (the pipe does nothing for interfaces) — it is now a class
 *   in place. The caller sends `quantity` per item; the service reads
 *   qty ?? quantity — both spellings are accepted.
 * - SettleTripDriverDto keeps supervisorPin / supervisorOverridePin
 *   optional even though the slice throws
 *   SETTLEMENT_REQUIRES_SUPERVISOR_PIN when a PIN is required and
 *   missing — the DTO preserves that 403 instead of turning it into
 *   a 400. chargeStockVarianceToRep stays accepted so older phone
 *   builds keep sending it without a 400.
 * - SubmitTripSettlementDto has NO frontend caller in the tree; its
 *   DTO mirrors the controller type exactly (no countedStock, no
 *   supervisor PIN fields, no activeVisitCustomerId) — and a
 *   supervisorPin on this route is pinned REJECTED.
 * - ExecuteSaleDto items have NO min-size and NO Min on qty: the
 *   service never throws on an empty list and SKIPS qty <= 0 lines —
 *   an empty items list passes the pipe (pinned positive).
 * - SubmitFieldReturnDto.saleId is REQUIRED even though the
 *   controller type marks it optional: the service throws
 *   RETURN_REQUIRES_SALE_ID without it, and the real caller always
 *   sends it.
 * - ExecuteDamagedSwapDto has NO tripId in the body: the caller
 *   passes tripId as the URL param only — a body tripId is pinned
 *   REJECTED. RecordTripExpenseDto / RecordPackagingMovementDto DO
 *   carry the tripId body echo the caller always sends (the URL
 *   param stays authoritative).
 * - RecordTripExpenseDto: the caller normalizes description to notes
 *   and receiptPhoto to receiptPhotoUrl BEFORE the call — the wire
 *   carries only the normalized names, so `description` is pinned
 *   REJECTED. RecordPackagingMovementDto: packagingType / qtyOut /
 *   qtyIn are normalized the same way — `packagingType` is pinned
 *   REJECTED.
 * - RecordFieldVisitDto.negativeReason is a 6-value enum, required
 *   exactly when visitType is 'negative' (ValidateIf).
 * - RecordVisitInventoryDto items carry productId REQUIRED: the real
 *   caller sends a row number (idx + 1) per item even though the
 *   service never reads it.
 * - CreateTransferDto items carry ArrayMinSize(1) (EMPTY_ITEMS); the
 *   per-item qty carries no Min — the service SKIPS qty <= 0 lines.
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop for
 * conditional rules — e.g. CREDIT_REQUIRES_CUSTOMER, the
 * EMPTY_PACKAGING_QTY rule, the money-digits precision check on
 * collections); the frontend screens (untouched).
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
import { CreatePreSalesOrderDto } from '../../src/modules/delivery-reps/services/van-pre-sales/van-pre-sales-types';
import {
  ExecuteDamagedSwapDto,
  ExecuteSaleDto,
  OpenTripDto,
  RecordCollectionDto,
  SettleTripDriverDto,
  SubmitFieldReturnDto,
  SubmitTripSettlementDto,
} from '../../src/modules/delivery-reps/dto/van-driver-orders.dto';
import {
  CheckInStoreVisitDto,
  CheckOutStoreVisitDto,
  CreateDriverCustomerDto,
  CreateTransferDto,
  EvaluateCartPromotionsDto,
  OptimizeDriverRouteDto,
  RecordBreadcrumbDto,
  RecordFieldVisitDto,
  RecordPackagingMovementDto,
  RecordTradeSurveyDto,
  RecordTripExpenseDto,
  RecordVisitInventoryDto,
  RecordVisitNoSaleDto,
} from '../../src/modules/delivery-reps/dto/van-driver-field.dto';
import { RecordFuelLogDto, RecordOilChangeDto } from '../../src/modules/delivery-reps/dto/van-fleet.dto';

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
  // 1. CreatePreSalesOrderDto — caller: the driver pre-sales form
  // sends { customerId, customerName?, customerPhone?,
  // customerAddress?, warehouseLocationId?, paymentMethod, items:
  // [{ productId, quantity, unitName?, unitMultiplier?, unitPrice?
  // }], notes?, deliveryDate? }.
  {
    const transformed = await pipeOk(CreatePreSalesOrderDto, {
      customerId: 5,
      customerName: 'Shop A',
      customerPhone: '01012345678',
      paymentMethod: 'credit',
      items: [{ productId: 10, quantity: 5, unitName: 'pcs', unitPrice: 100 }],
      notes: 'pre-sale',
    });
    assert.equal(transformed.customerId, 5, 'the customer survives the pipe');
    assert.equal(transformed.paymentMethod, 'credit', 'the payment method survives the pipe');
    assert.equal(transformed.items[0].quantity, 5, 'the caller quantity spelling survives the pipe');
    const qtyAlias = await pipeOk(CreatePreSalesOrderDto, {
      customerId: 5,
      paymentMethod: 'cash',
      items: [{ productId: 10, qty: 3 }],
    });
    assert.equal(qtyAlias.items[0].qty, 3, 'the service qty spelling survives the pipe');
    await pipeRejects(
      CreatePreSalesOrderDto,
      { customerId: 5, paymentMethod: 'cash', items: [{ productId: 10, quantity: 1 }], status: 'x' },
      'an extra status must be rejected on create-pre-sales-order',
    );
    await pipeRejects(
      CreatePreSalesOrderDto,
      { customerId: 5, paymentMethod: 'card', items: [{ productId: 10, quantity: 1 }] },
      'a payment method outside the union must be rejected on create-pre-sales-order',
    );
    await pipeRejects(
      CreatePreSalesOrderDto,
      { customerId: 5, paymentMethod: 'cash', items: [] },
      'an empty items list must be rejected on create-pre-sales-order',
    );
    console.log('  (1) CreatePreSalesOrderDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 2. OpenTripDto — caller: the driver open-trip call sends
  // { sourceWarehouseId?, items?, notes? } or an empty object.
  {
    const transformed = await pipeOk(OpenTripDto, {
      sourceWarehouseId: 2,
      items: [{ productId: 10, qty: 20 }],
      notes: 'morning load',
    });
    assert.equal(transformed.sourceWarehouseId, 2, 'the source warehouse survives the pipe');
    assert.equal(transformed.items!.length, 1, 'the load item survives the pipe');
    const empty = await pipeOk(OpenTripDto, {});
    assert.equal(empty.sourceWarehouseId, undefined, 'an empty open-trip passes the pipe (all fields optional)');
    await pipeRejects(OpenTripDto, { sourceWarehouseId: 2, repId: 3 }, 'an extra repId must be rejected on open-trip');
    await pipeRejects(
      OpenTripDto,
      { items: [{ productId: 'x', qty: 5 }] },
      'a string product id must be rejected on open-trip',
    );
    console.log('  (2) OpenTripDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 3. SettleTripDriverDto — caller: van-sales-driver-core.ts
  // settleTrip sends { tripId, countedCash, perDayCash?,
  // endOdometer?, unloadRemainingToWarehouse, countedStock?,
  // nightStockApproved?, notes?, supervisorPin? } (supervisorPin
  // only, never supervisorOverridePin or chargeStockVarianceToRep —
  // both stay accepted for older builds).
  {
    const transformed = await pipeOk(SettleTripDriverDto, {
      tripId: 12,
      countedCash: 8500,
      perDayCash: [{ businessDay: '2026-11-24', countedCash: 8500 }],
      unloadRemainingToWarehouse: true,
      countedStock: [{ productId: 10, countedQty: 3 }],
      nightStockApproved: false,
      notes: 'settled',
      supervisorPin: '1234',
    });
    assert.equal(transformed.tripId, 12, 'the trip survives the pipe');
    assert.equal(transformed.countedCash, 8500, 'the counted cash survives the pipe');
    assert.equal(transformed.supervisorPin, '1234', 'the supervisor PIN survives the pipe');
    const older = await pipeOk(SettleTripDriverDto, {
      tripId: 12,
      countedCash: 8500,
      unloadRemainingToWarehouse: true,
      chargeStockVarianceToRep: true,
    });
    assert.equal(
      older.chargeStockVarianceToRep,
      true,
      'the older-build variance flag survives the pipe (service ignores it)',
    );
    await pipeRejects(
      SettleTripDriverDto,
      { tripId: 12, countedCash: 8500, unloadRemainingToWarehouse: true, vehicleId: 1 },
      'an extra vehicleId must be rejected on driver settle-trip',
    );
    await pipeRejects(
      SettleTripDriverDto,
      { tripId: 12, countedCash: 'lots', unloadRemainingToWarehouse: true },
      'a string counted cash must be rejected on driver settle-trip',
    );
    console.log('  (3) SettleTripDriverDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 4. SubmitTripSettlementDto — NO frontend caller exists in the
  // tree; the positive case is the controller shape itself. A
  // supervisorPin on this route is rejected: this route has no PIN
  // fields at all.
  {
    const transformed = await pipeOk(SubmitTripSettlementDto, {
      tripId: 12,
      countedCash: 8500,
      unloadRemainingToWarehouse: true,
      notes: 'submit',
    });
    assert.equal(transformed.tripId, 12, 'the trip survives the pipe');
    assert.equal(transformed.unloadRemainingToWarehouse, true, 'the unload flag survives the pipe');
    await pipeRejects(
      SubmitTripSettlementDto,
      { tripId: 12, countedCash: 8500, unloadRemainingToWarehouse: true, supervisorPin: '1234' },
      'a supervisorPin must be rejected on submit-settlement (this route has no PIN fields)',
    );
    await pipeRejects(
      SubmitTripSettlementDto,
      { tripId: 12, countedCash: 8500 },
      'a missing unload flag must be rejected on submit-settlement',
    );
    console.log('  (4) SubmitTripSettlementDto: controller shape passes, extra/wrong-type rejected passed');
  }

  // 5. ExecuteSaleDto — caller: the driver sale call sends the full
  // sale payload (tripId, paymentMethod, items, proof / GPS /
  // offline fields). An empty items list passes the pipe: the
  // service never throws on it and SKIPS qty <= 0 lines.
  {
    const transformed = await pipeOk(ExecuteSaleDto, {
      tripId: 12,
      customerId: 5,
      customerName: 'Shop A',
      paymentMethod: 'cash',
      paidAmount: 1000,
      items: [{ productId: 10, qty: 2, unitPrice: 100, unitName: 'pcs', unitMultiplier: 1 }],
      notes: 'sale',
      clientTxId: 'tx-1',
      offlineCreatedAt: '2026-11-25T10:00:00+02:00',
    });
    assert.equal(transformed.paymentMethod, 'cash', 'the payment method survives the pipe');
    assert.equal(transformed.items.length, 1, 'the sale item survives the pipe');
    assert.equal(transformed.items[0].qty, 2, 'the item qty survives the pipe');
    const emptyItems = await pipeOk(ExecuteSaleDto, { tripId: 12, paymentMethod: 'cash', items: [] });
    assert.deepEqual(emptyItems.items, [], 'an empty items list passes the pipe (service never throws on it)');
    await pipeRejects(
      ExecuteSaleDto,
      { tripId: 12, paymentMethod: 'cash', items: [{ productId: 10, qty: 1 }], status: 'x' },
      'an extra status must be rejected on execute-sale',
    );
    await pipeRejects(
      ExecuteSaleDto,
      { tripId: 12, paymentMethod: 'cheque', items: [{ productId: 10, qty: 1 }] },
      'a payment method outside the union must be rejected on execute-sale',
    );
    console.log('  (5) ExecuteSaleDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 6. RecordCollectionDto — caller: the driver collection call
  // sends { tripId, customerId, amount, paymentMethod?, ... }.
  {
    const transformed = await pipeOk(RecordCollectionDto, {
      tripId: 12,
      customerId: 5,
      amount: 500,
      paymentMethod: 'cash',
      notes: 'collected',
      gpsLat: 30.05,
      gpsLng: 31.25,
      clientTxId: 'tx-2',
    });
    assert.equal(transformed.amount, 500, 'the amount survives the pipe');
    assert.equal(transformed.paymentMethod, 'cash', 'the payment method survives the pipe');
    await pipeRejects(
      RecordCollectionDto,
      { tripId: 12, customerId: 5, amount: 500, repId: 3 },
      'an extra repId must be rejected on record-collection',
    );
    await pipeRejects(
      RecordCollectionDto,
      { tripId: 12, customerId: 5, amount: 0 },
      'a zero amount must be rejected on record-collection',
    );
    console.log('  (6) RecordCollectionDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 7. ExecuteDamagedSwapDto — caller: the driver damaged-swap call
  // sends only the payload (tripId is the URL param only — a body
  // tripId is rejected).
  {
    const transformed = await pipeOk(ExecuteDamagedSwapDto, {
      customerId: 5,
      damagedProductId: 10,
      damagedQty: 2,
      damageReason: 'broken',
      replacementProductId: 11,
      replacementQty: 2,
      notes: 'swap',
      clientTxId: 'tx-3',
    });
    assert.equal(transformed.damagedProductId, 10, 'the damaged product survives the pipe');
    assert.equal(transformed.replacementQty, 2, 'the replacement qty survives the pipe');
    await pipeRejects(
      ExecuteDamagedSwapDto,
      { damagedProductId: 10, damagedQty: 2, replacementProductId: 11, replacementQty: 2, tripId: 12 },
      'a body tripId must be rejected on damaged-swap (tripId is a URL param only)',
    );
    await pipeRejects(
      ExecuteDamagedSwapDto,
      { damagedProductId: 10, damagedQty: 0, replacementProductId: 11, replacementQty: 2 },
      'a zero damaged qty must be rejected on damaged-swap',
    );
    console.log('  (7) ExecuteDamagedSwapDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 8. SubmitFieldReturnDto — caller: the driver field-return call
  // sends { tripId, customerId, saleId, returnReason, refundMethod?,
  // items, notes?, offlineCreatedAt? }.
  {
    const transformed = await pipeOk(SubmitFieldReturnDto, {
      tripId: 12,
      customerId: 5,
      saleId: 99,
      returnReason: 'damaged',
      refundMethod: 'credit',
      items: [{ productId: 10, qty: 1, unitPrice: 100, saleItemId: 7 }],
      notes: 'return',
    });
    assert.equal(transformed.saleId, 99, 'the sale id survives the pipe');
    assert.equal(transformed.returnReason, 'damaged', 'the return reason survives the pipe');
    assert.equal(transformed.items[0].unitPrice, 100, 'the item price survives the pipe');
    await pipeRejects(
      SubmitFieldReturnDto,
      {
        tripId: 12,
        customerId: 5,
        saleId: 99,
        returnReason: 'damaged',
        items: [{ productId: 10, qty: 1, unitPrice: 100 }],
        status: 'x',
      },
      'an extra status must be rejected on submit-field-return',
    );
    await pipeRejects(
      SubmitFieldReturnDto,
      {
        tripId: 12,
        customerId: 5,
        returnReason: 'damaged',
        items: [{ productId: 10, qty: 1, unitPrice: 100 }],
      },
      'a missing saleId must be rejected on submit-field-return',
    );
    console.log('  (8) SubmitFieldReturnDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 9. CreateDriverCustomerDto — caller: use-van-itinerary-add-
  // customer.ts sends { name, phone?, address?, district?, route?,
  // visitDays?, notes?, metadata: { district, route, visit_days,
  // visit_day, gpsLat, gpsLng, locationUrl } }.
  {
    const transformed = await pipeOk(CreateDriverCustomerDto, {
      name: 'New Shop',
      phone: '01012345678',
      district: 'Downtown',
      route: 'R1',
      visitDays: ['sun', 'tue'],
      metadata: {
        district: 'Downtown',
        route: 'R1',
        visit_days: ['sun', 'tue'],
        visit_day: 'sun',
        gpsLat: 30.05,
        gpsLng: 31.25,
        locationUrl: 'https://maps/example',
      },
    });
    assert.equal(transformed.name, 'New Shop', 'the customer name survives the pipe');
    assert.equal(
      (transformed.metadata as Record<string, unknown>).visit_day,
      'sun',
      'the metadata visit day survives the pipe',
    );
    await pipeRejects(
      CreateDriverCustomerDto,
      { name: 'x', customerId: 1 },
      'an extra customerId must be rejected on create-driver-customer',
    );
    await pipeRejects(CreateDriverCustomerDto, { name: '' }, 'a blank name must be rejected on create-driver-customer');
    console.log('  (9) CreateDriverCustomerDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 10. RecordFieldVisitDto — caller: the driver field-visit call
  // sends { tripId, customerId, visitType, saleId?, negativeReason?,
  // postponedToDate?, gpsLat?, gpsLng?, notes? }. negativeReason is
  // required exactly when visitType is 'negative'.
  {
    const positive = await pipeOk(RecordFieldVisitDto, {
      tripId: 12,
      customerId: 5,
      visitType: 'positive',
      gpsLat: 30.05,
      gpsLng: 31.25,
      notes: 'visited',
    });
    assert.equal(positive.visitType, 'positive', 'the positive visit survives the pipe');
    const negative = await pipeOk(RecordFieldVisitDto, {
      tripId: 12,
      customerId: 5,
      visitType: 'negative',
      negativeReason: 'shop_closed',
      postponedToDate: '2026-11-26',
    });
    assert.equal(negative.negativeReason, 'shop_closed', 'the negative reason survives the pipe');
    await pipeRejects(
      RecordFieldVisitDto,
      { tripId: 12, customerId: 5, visitType: 'positive', driverId: 1 },
      'an extra driverId must be rejected on record-field-visit',
    );
    await pipeRejects(
      RecordFieldVisitDto,
      { tripId: 12, customerId: 5, visitType: 'negative' },
      'a negative visit without a reason must be rejected on record-field-visit',
    );
    await pipeRejects(
      RecordFieldVisitDto,
      { tripId: 12, customerId: 5, visitType: 'negative', negativeReason: 'other_reason' },
      'a reason outside the enum must be rejected on record-field-visit',
    );
    console.log('  (10) RecordFieldVisitDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 11. RecordFuelLogDto — caller: the driver fuel-log form sends
  // { vehicleId, tripId?, odometer, liters, pricePerLiter,
  // stationName?, notes? } (no repId — the driver never sends it).
  {
    const transformed = await pipeOk(RecordFuelLogDto, {
      vehicleId: 1,
      tripId: 5,
      odometer: 123500,
      liters: 40,
      pricePerLiter: 13.5,
      stationName: 'Total',
    });
    assert.equal(transformed.vehicleId, 1, 'the vehicle survives the pipe');
    assert.equal(transformed.pricePerLiter, 13.5, 'the price survives the pipe');
    await pipeRejects(
      RecordFuelLogDto,
      { vehicleId: 1, odometer: 1, liters: 1, pricePerLiter: 1, repId: 3 },
      'a repId must be rejected on driver fuel-log (the driver never sends it)',
    );
    await pipeRejects(
      RecordFuelLogDto,
      { vehicleId: 1, odometer: 123500, liters: 0, pricePerLiter: 13.5 },
      'zero liters must be rejected on driver fuel-log',
    );
    console.log('  (11) RecordFuelLogDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 12. RecordOilChangeDto — caller: the driver oil-change form
  // sends { vehicleId, odometerAtChange, oilType, ratedKm,
  // withFilter, alertKmBefore?, cost?, performedBy?, notes? }.
  {
    const transformed = await pipeOk(RecordOilChangeDto, {
      vehicleId: 1,
      odometerAtChange: 120000,
      oilType: '10W-40',
      ratedKm: 5000,
      withFilter: true,
      cost: 800,
      performedBy: 'Ali',
    });
    assert.equal(transformed.oilType, '10W-40', 'the oil type survives the pipe');
    assert.equal(transformed.withFilter, true, 'the filter flag survives the pipe');
    await pipeRejects(
      RecordOilChangeDto,
      { vehicleId: 1, odometerAtChange: 1, oilType: 'x', ratedKm: 1, withFilter: true, repId: 3 },
      'a repId must be rejected on driver oil-change (the driver never sends it)',
    );
    await pipeRejects(
      RecordOilChangeDto,
      { vehicleId: 1, odometerAtChange: 120000, oilType: 'x', ratedKm: -5, withFilter: true },
      'a negative ratedKm must be rejected on driver oil-change',
    );
    console.log('  (12) RecordOilChangeDto: real caller payload passes, extra/wrong-type rejected passed');
  }
  // 13. CreateTransferDto — caller: the driver transfer call sends
  // { toRepId, fromTripId?, toTripId?, items, notes? }.
  {
    const transformed = await pipeOk(CreateTransferDto, {
      toRepId: 4,
      fromTripId: 12,
      items: [{ productId: 10, qty: 5 }],
      notes: 'transfer',
    });
    assert.equal(transformed.toRepId, 4, 'the target rep survives the pipe');
    assert.equal(transformed.items[0].qty, 5, 'the transfer qty survives the pipe');
    await pipeRejects(
      CreateTransferDto,
      { toRepId: 4, items: [{ productId: 10, qty: 5 }], fromRepId: 3 },
      'an extra fromRepId must be rejected on create-transfer',
    );
    await pipeRejects(
      CreateTransferDto,
      { toRepId: 4, items: [] },
      'an empty items list must be rejected on create-transfer',
    );
    console.log('  (13) CreateTransferDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 14. RecordTripExpenseDto — caller: the driver expense call
  // sends { tripId, expenseType, amount, notes?, receiptPhotoUrl?,
  // supervisorOverridePin? } — the tripId body echo is always sent,
  // and description / receiptPhoto are normalized to notes /
  // receiptPhotoUrl BEFORE the call (the wire carries only the
  // normalized names).
  {
    const transformed = await pipeOk(RecordTripExpenseDto, {
      tripId: 12,
      expenseType: 'fuel',
      amount: 350,
      notes: 'diesel',
      receiptPhotoUrl: 'https://x/r.jpg',
    });
    assert.equal(transformed.tripId, 12, 'the tripId echo survives the pipe');
    assert.equal(transformed.amount, 350, 'the amount survives the pipe');
    await pipeRejects(
      RecordTripExpenseDto,
      { tripId: 12, expenseType: 'fuel', amount: 350, description: 'diesel' },
      'an unnormalized description must be rejected on record-trip-expense',
    );
    await pipeRejects(
      RecordTripExpenseDto,
      { tripId: 12, expenseType: 'fuel', amount: 0 },
      'a zero amount must be rejected on record-trip-expense',
    );
    console.log('  (14) RecordTripExpenseDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 15. RecordPackagingMovementDto — caller: the driver packaging
  // call sends { tripId, customerId?, packageType, deliveredQty,
  // returnedQty, notes? } — the tripId body echo is always sent, and
  // packagingType / qtyOut / qtyIn are normalized to packageType /
  // deliveredQty / returnedQty BEFORE the call.
  {
    const transformed = await pipeOk(RecordPackagingMovementDto, {
      tripId: 12,
      customerId: 5,
      packageType: 'crate_plastic',
      deliveredQty: 10,
      returnedQty: 4,
      notes: 'crates',
    });
    assert.equal(transformed.packageType, 'crate_plastic', 'the package type survives the pipe');
    assert.equal(transformed.deliveredQty, 10, 'the delivered qty survives the pipe');
    await pipeRejects(
      RecordPackagingMovementDto,
      { tripId: 12, packageType: 'crate_plastic', deliveredQty: 10, returnedQty: 4, packagingType: 'crate_plastic' },
      'an unnormalized packagingType must be rejected on record-packaging',
    );
    await pipeRejects(
      RecordPackagingMovementDto,
      { tripId: 12, packageType: 'crate_plastic', deliveredQty: 'ten', returnedQty: 4 },
      'a string delivered qty must be rejected on record-packaging',
    );
    console.log('  (15) RecordPackagingMovementDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 16. EvaluateCartPromotionsDto — caller: the driver cart
  // evaluation sends { cartItems, invoiceSubtotal?,
  // customerType? }; cartItems is an opaque array (the engine's
  // CartItemInput shape is not validated).
  {
    const transformed = await pipeOk(EvaluateCartPromotionsDto, {
      cartItems: [{ productId: 10, qty: 2, unitPrice: 100 }],
      invoiceSubtotal: 200,
      customerType: 'retail',
    });
    assert.equal(transformed.cartItems.length, 1, 'the cart items survive the pipe');
    assert.equal(transformed.invoiceSubtotal, 200, 'the subtotal survives the pipe');
    await pipeRejects(
      EvaluateCartPromotionsDto,
      { cartItems: [{ productId: 10, qty: 2 }], promoId: 1 },
      'an extra promoId must be rejected on evaluate-cart',
    );
    await pipeRejects(
      EvaluateCartPromotionsDto,
      { cartItems: 'not-an-array' },
      'a string cartItems must be rejected on evaluate-cart',
    );
    console.log('  (16) EvaluateCartPromotionsDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 17. OptimizeDriverRouteDto — caller: the driver route optimizer
  // sends any subset of { customerIds?, startLat?, startLng?,
  // persistSequence?, route? }; an empty body passes the pipe (the
  // either/or rule stays in the service).
  {
    const transformed = await pipeOk(OptimizeDriverRouteDto, {
      customerIds: [1, 2],
      startLat: 30.05,
      startLng: 31.25,
      persistSequence: true,
    });
    assert.deepEqual(transformed.customerIds, [1, 2], 'the customer ids survive the pipe');
    const empty = await pipeOk(OptimizeDriverRouteDto, {});
    assert.equal(empty.route, undefined, 'an empty optimize passes the pipe (all fields optional)');
    await pipeRejects(
      OptimizeDriverRouteDto,
      { route: 'R1', driverId: 1 },
      'an extra driverId must be rejected on optimize-driver-route',
    );
    await pipeRejects(
      OptimizeDriverRouteDto,
      { customerIds: [0] },
      'a zero customer id must be rejected on optimize-driver-route',
    );
    console.log('  (17) OptimizeDriverRouteDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 18. CheckInStoreVisitDto — caller: the driver check-in call
  // sends { tripId?, customerId, customerName?, latitude?,
  // longitude? }.
  {
    const transformed = await pipeOk(CheckInStoreVisitDto, {
      tripId: 12,
      customerId: 5,
      customerName: 'Shop A',
      latitude: 30.05,
      longitude: 31.25,
    });
    assert.equal(transformed.customerId, 5, 'the customer survives the pipe');
    assert.equal(transformed.latitude, 30.05, 'the latitude survives the pipe');
    await pipeRejects(
      CheckInStoreVisitDto,
      { customerId: 5, visitId: 1 },
      'an extra visitId must be rejected on check-in',
    );
    await pipeRejects(CheckInStoreVisitDto, { customerId: 'x' }, 'a string customer id must be rejected on check-in');
    console.log('  (18) CheckInStoreVisitDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 19. RecordVisitInventoryDto — caller: VanStoreInventoryModal
  // sends { items: [{ productId (row number), productName,
  // qtyOnShelf, expiryDate? }] }.
  {
    const transformed = await pipeOk(RecordVisitInventoryDto, {
      items: [
        { productId: 1, productName: 'Item A', qtyOnShelf: 5, expiryDate: '2026-12-01' },
        { productId: 2, productName: 'Item B', qtyOnShelf: 0, expiryDate: null },
      ],
    });
    assert.equal(transformed.items.length, 2, 'the inventory items survive the pipe');
    assert.equal(transformed.items[0].productId, 1, 'the row productId survives the pipe');
    assert.equal(transformed.items[1].expiryDate, null, 'the null expiry survives the pipe');
    await pipeRejects(
      RecordVisitInventoryDto,
      { items: [{ productId: 1, productName: 'A', qtyOnShelf: 5 }], visitId: 1 },
      'an extra visitId must be rejected on record-visit-inventory',
    );
    await pipeRejects(
      RecordVisitInventoryDto,
      { items: [{ productName: 'Item A', qtyOnShelf: 5 }] },
      'an item without productId must be rejected on record-visit-inventory',
    );
    console.log('  (19) RecordVisitInventoryDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 20. RecordVisitNoSaleDto — caller: the driver no-sale call
  // sends { noSaleReason, noSaleNotes? }.
  {
    const transformed = await pipeOk(RecordVisitNoSaleDto, {
      noSaleReason: 'shop closed',
      noSaleNotes: 'will return tomorrow',
    });
    assert.equal(transformed.noSaleReason, 'shop closed', 'the no-sale reason survives the pipe');
    await pipeRejects(
      RecordVisitNoSaleDto,
      { noSaleReason: 'x', visitId: 1 },
      'an extra visitId must be rejected on record-visit-no-sale',
    );
    await pipeRejects(
      RecordVisitNoSaleDto,
      { noSaleReason: '' },
      'a blank no-sale reason must be rejected on record-visit-no-sale',
    );
    console.log('  (20) RecordVisitNoSaleDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 21. CheckOutStoreVisitDto — caller: the driver check-out call
  // sends any subset of { hasSale?, saleId?, saleAmount?,
  // hasCollection?, collectionAmount? }; an empty body passes the
  // pipe (the amount-anchoring rules stay in the service).
  {
    const transformed = await pipeOk(CheckOutStoreVisitDto, {
      hasSale: true,
      saleId: 99,
      saleAmount: 500,
      hasCollection: false,
    });
    assert.equal(transformed.hasSale, true, 'the sale flag survives the pipe');
    assert.equal(transformed.saleAmount, 500, 'the sale amount survives the pipe');
    const empty = await pipeOk(CheckOutStoreVisitDto, {});
    assert.equal(empty.hasSale, undefined, 'an empty check-out passes the pipe (all fields optional)');
    await pipeRejects(
      CheckOutStoreVisitDto,
      { hasSale: true, visitId: 1 },
      'an extra visitId must be rejected on check-out',
    );
    await pipeRejects(CheckOutStoreVisitDto, { saleId: 'x' }, 'a string sale id must be rejected on check-out');
    console.log('  (21) CheckOutStoreVisitDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 22. RecordTradeSurveyDto — caller: VanTradeSurveyModal sends
  // the cooler_inspection variant (asset fields, temperature,
  // cleanliness) or the competitor_survey variant (competitor
  // fields); isPureCompanyProducts is true for the competitor
  // variant.
  {
    const cooler = await pipeOk(RecordTradeSurveyDto, {
      customerId: 5,
      surveyType: 'cooler_inspection',
      tripId: 12,
      assetId: 'FRIDGE-01',
      assetName: 'display fridge',
      assetCondition: 'good',
      isPureCompanyProducts: true,
      temperatureCelsius: 4,
      cleanlinessRating: 5,
      notes: 'ok',
    });
    assert.equal(cooler.surveyType, 'cooler_inspection', 'the cooler survey survives the pipe');
    assert.equal(cooler.assetId, 'FRIDGE-01', 'the asset id survives the pipe');
    const competitor = await pipeOk(RecordTradeSurveyDto, {
      customerId: 5,
      surveyType: 'competitor_survey',
      competitorName: 'Brand X',
      competitorProduct: 'Cola',
      competitorPrice: 15,
      competitorOfferDetails: '2 for 1',
      isPureCompanyProducts: true,
    });
    assert.equal(competitor.competitorName, 'Brand X', 'the competitor name survives the pipe');
    await pipeRejects(
      RecordTradeSurveyDto,
      { customerId: 5, surveyType: 'cooler_inspection', surveyId: 1 },
      'an extra surveyId must be rejected on record-trade-survey',
    );
    await pipeRejects(
      RecordTradeSurveyDto,
      { customerId: 5, surveyType: 'price_check' },
      'a survey type outside the union must be rejected on record-trade-survey',
    );
    console.log('  (22) RecordTradeSurveyDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 23. RecordBreadcrumbDto — caller: the driver breadcrumb call
  // sends { tripId, latitude, longitude, speedKmh?, batteryLevel? }.
  {
    const transformed = await pipeOk(RecordBreadcrumbDto, {
      tripId: 12,
      latitude: 30.05,
      longitude: 31.25,
      speedKmh: 45,
      batteryLevel: 80,
    });
    assert.equal(transformed.tripId, 12, 'the trip survives the pipe');
    assert.equal(transformed.speedKmh, 45, 'the speed survives the pipe');
    await pipeRejects(
      RecordBreadcrumbDto,
      { tripId: 12, latitude: 30, longitude: 31, driverId: 1 },
      'an extra driverId must be rejected on record-breadcrumb',
    );
    await pipeRejects(
      RecordBreadcrumbDto,
      { tripId: 12, latitude: 'north', longitude: 31 },
      'a string latitude must be rejected on record-breadcrumb',
    );
    console.log('  (23) RecordBreadcrumbDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // Source pins: the driver controller takes the DTO classes, and
  // the DTO files declare classes.
  {
    const here = __dirname;
    const read = (p: string): string => readFileSync(resolve(here, '../../src', p), 'utf8');
    const driverController = read('modules/delivery-reps/van-sales.controller.ts');
    for (const name of [
      'CreatePreSalesOrderDto',
      'OpenTripDto',
      'SettleTripDriverDto',
      'SubmitTripSettlementDto',
      'ExecuteSaleDto',
      'RecordCollectionDto',
      'ExecuteDamagedSwapDto',
      'SubmitFieldReturnDto',
      'CreateDriverCustomerDto',
      'RecordFieldVisitDto',
      'RecordFuelLogDto',
      'RecordOilChangeDto',
      'CreateTransferDto',
      'RejectWithReasonDto',
      'RecordTripExpenseDto',
      'RecordPackagingMovementDto',
      'EvaluateCartPromotionsDto',
      'OptimizeDriverRouteDto',
      'CheckInStoreVisitDto',
      'RecordVisitInventoryDto',
      'RecordVisitNoSaleDto',
      'CheckOutStoreVisitDto',
      'RecordTradeSurveyDto',
      'RecordBreadcrumbDto',
    ]) {
      assert.ok(driverController.includes(name), `the driver controller takes ${name}`);
    }
    assert.ok(!driverController.includes('body: any'), 'no driver route takes any anymore');
    const ordersDto = read('modules/delivery-reps/dto/van-driver-orders.dto.ts');
    assert.ok(ordersDto.includes('export class ExecuteSaleDto'), 'ExecuteSaleDto is a class, not an interface');
    assert.ok(
      ordersDto.includes('export class SubmitFieldReturnDto'),
      'SubmitFieldReturnDto is a class, not an interface',
    );
    const fieldDto = read('modules/delivery-reps/dto/van-driver-field.dto.ts');
    assert.ok(
      fieldDto.includes('export class RecordFieldVisitDto'),
      'RecordFieldVisitDto is a class, not an interface',
    );
    assert.ok(
      fieldDto.includes('export class RecordTradeSurveyDto'),
      'RecordTradeSurveyDto is a class, not an interface',
    );
    const preSalesTypes = read('modules/delivery-reps/services/van-pre-sales/van-pre-sales-types.ts');
    assert.ok(
      preSalesTypes.includes('export class CreatePreSalesOrderDto'),
      'CreatePreSalesOrderDto is a class, not an interface',
    );
    assert.ok(!preSalesTypes.includes('export interface CreatePreSalesOrderDto'), 'the pre-sales interface is gone');
    console.log('  source pins passed');
  }

  console.log('DTO delivery-reps driver tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
