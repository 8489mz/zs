/*
 * New file: backend/test/critical/dto-delivery-reps-admin.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-DELIVERY-REPS-58, D3): the admin trip /
 * fleet / requisition / target / commission / route / financial-ledger
 * routes now take DTO classes, so the real global
 * requestValidationPipe validates and whitelists them. Before D3 they
 * took inline types — and the pipe does nothing for an inline type, so
 * any extra field (or a wrong-typed field) reached the service
 * untouched.
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
 * - SetRepTargetDto / SaveCommissionConfigDto: the caller sends the
 *   non-Percent rate names; the service reads only the Percent names.
 *   PRE-EXISTING MISMATCHES, NOT fixed here: the DTO accepts both
 *   spellings so the caller does not 400; the rates are still lost /
 *   the config call is still a no-op today.
 * - SettleRepCommissionDto: the caller sends `month` + `amount`; the
 *   service reads `periodMonth` and falls back to the current month.
 *   PRE-EXISTING MISMATCH, NOT fixed here: `month` is required
 *   (the caller always sends it), `periodMonth` is optional.
 * - SettleRepCommissionDto.amount has no Min: the service falls back
 *   to maxPayable for a non-positive amount instead of throwing.
 * - ReviewRequisitionDto.approvedItems has NO min-size: the service
 *   stores an empty list as JSON without throwing — an empty list
 *   passes the pipe (pinned positive).
 * - TogglePromotionActiveDto.isActive: under enableImplicitConversion
 *   a string "false" coerces to true (contract Rule 3), so there is
 *   no wrong-type case for a boolean — the coercion is pinned and the
 *   second negative is a missing required field.
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop for
 * conditional rules — e.g. the per-day sum / odometer checks on
 * settle-trip, the INVALID_VEHICLE_STATUS throw, the
 * SETTLEMENT_METHOD_INVALID throw); the frontend screens (untouched).
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
  AddRepBonusOrCommissionDto,
  AutoCreateEmployeeDto,
  LinkRepToEmployeeDto,
  OptimizeSupervisorRouteDto,
  PushRepShortagesToPayrollDto,
  SettleRepFinancialItemDto,
  TogglePromotionActiveDto,
} from '../../src/modules/delivery-reps/dto/van-admin-ops.dto';
import {
  AssignVehicleDriverDto,
  RecordAdminFuelLogDto,
  RecordAdminOilChangeDto,
} from '../../src/modules/delivery-reps/dto/van-fleet.dto';
import {
  BulkAssignCustomerRoutesDto,
  SaveCommissionConfigDto,
  SetCustomerRouteScheduleDto,
  SetRepTargetDto,
  SettleRepCommissionDto,
} from '../../src/modules/delivery-reps/dto/van-targets.dto';
import {
  AssignRepDto,
  CreateAdminRequisitionDto,
  CreateVehicleDto,
  RejectWithReasonDto,
  ReviewRequisitionDto,
  SettleTripAdminDto,
  UpdateVehicleDto,
} from '../../src/modules/delivery-reps/dto/van-trips.dto';

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
  // 1. SettleTripAdminDto — caller: the admin settle-trip dialog
  // sends the rep, the counted cash, the per-day split, and the
  // unload flag (van-sales-admin-trips.ts settleTripAdmin).
  {
    const transformed = await pipeOk(SettleTripAdminDto, {
      repId: 3,
      countedCash: 12500,
      perDayCash: [{ businessDay: '2026-11-24', countedCash: 6000 }],
      unloadRemainingToWarehouse: true,
      countedStock: [{ productId: 10, countedQty: 5 }],
      endOdometer: 123450,
      notes: 'settled',
    });
    assert.equal(transformed.repId, 3, 'the rep survives the pipe');
    assert.equal(transformed.countedCash, 12500, 'the counted cash survives the pipe');
    assert.equal(transformed.perDayCash!.length, 1, 'the per-day split survives the pipe');
    assert.equal(transformed.unloadRemainingToWarehouse, true, 'the unload flag survives the pipe');
    await pipeRejects(
      SettleTripAdminDto,
      { repId: 3, countedCash: 12500, unloadRemainingToWarehouse: true, tripId: 1 },
      'an extra tripId must be rejected on admin settle-trip (the id is a URL param)',
    );
    await pipeRejects(
      SettleTripAdminDto,
      { repId: 3, countedCash: 'lots', unloadRemainingToWarehouse: true },
      'a string counted cash must be rejected on admin settle-trip',
    );
    console.log('  (1) SettleTripAdminDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 2. CreateVehicleDto — caller: the fleet form sends plateNumber
  // plus the optional vehicle fields.
  {
    const transformed = await pipeOk(CreateVehicleDto, {
      plateNumber: 'ABC-1234',
      modelName: 'Hiace',
      vehicleType: 'van',
      branchId: 1,
      currentOdometer: 50000,
      fuelType: 'diesel',
    });
    assert.equal(transformed.plateNumber, 'ABC-1234', 'the plate survives the pipe');
    assert.equal(transformed.branchId, 1, 'the branch survives the pipe');
    await pipeRejects(
      CreateVehicleDto,
      { plateNumber: 'ABC-1234', driverId: 1 },
      'an extra driverId must be rejected on create-vehicle',
    );
    await pipeRejects(CreateVehicleDto, { plateNumber: '' }, 'a blank plate must be rejected on create-vehicle');
    console.log('  (2) CreateVehicleDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 3. UpdateVehicleDto — caller: the fleet form sends any subset of
  // the vehicle fields; an empty update passes the pipe.
  {
    const transformed = await pipeOk(UpdateVehicleDto, { status: 'maintenance', notes: 'oil change' });
    assert.equal(transformed.status, 'maintenance', 'the status survives the pipe');
    const empty = await pipeOk(UpdateVehicleDto, {});
    assert.equal(empty.status, undefined, 'an empty update passes the pipe (all fields optional)');
    await pipeRejects(
      UpdateVehicleDto,
      { status: 'maintenance', plate: 'X' },
      'an extra plate must be rejected on update-vehicle',
    );
    await pipeRejects(
      UpdateVehicleDto,
      { status: 'flying' },
      'a status outside the union must be rejected on update-vehicle',
    );
    console.log('  (3) UpdateVehicleDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 4. AssignRepDto — caller: the assign dialog sends { repId,
  // shiftName? }; repId may be null (unassign).
  {
    const transformed = await pipeOk(AssignRepDto, { repId: 3, shiftName: 'morning' });
    assert.equal(transformed.repId, 3, 'the rep survives the pipe');
    const unassign = await pipeOk(AssignRepDto, { repId: null });
    assert.equal(unassign.repId, null, 'a null repId passes the pipe (unassign)');
    await pipeRejects(AssignRepDto, { repId: 3, vehicleId: 1 }, 'an extra vehicleId must be rejected on assign-rep');
    await pipeRejects(AssignRepDto, { repId: 0 }, 'a zero repId must be rejected on assign-rep');
    console.log('  (4) AssignRepDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 5. RejectWithReasonDto — caller: the admin reject dialogs (return
  // reject, requisition reject) and the driver transfer reject all
  // send { reason? }; an empty body passes the pipe.
  {
    const transformed = await pipeOk(RejectWithReasonDto, { reason: 'damaged goods' });
    assert.equal(transformed.reason, 'damaged goods', 'the reason survives the pipe');
    const empty = await pipeOk(RejectWithReasonDto, {});
    assert.equal(empty.reason, undefined, 'an empty reject passes the pipe (reason optional)');
    await pipeRejects(
      RejectWithReasonDto,
      { reason: 'x', approved: true },
      'an extra approved flag must be rejected on reject-with-reason',
    );
    await pipeRejects(RejectWithReasonDto, { reason: ['x'] }, 'an array reason must be rejected on reject-with-reason');
    console.log('  (5) RejectWithReasonDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 6. CreateAdminRequisitionDto — caller: the admin requisition
  // form sends repId, items with the display fields the frontend
  // always sends (productName / barcode), and the dispatch flag.
  {
    const transformed = await pipeOk(CreateAdminRequisitionDto, {
      repId: 3,
      sourceWarehouseId: 2,
      items: [
        {
          productId: 10,
          qty: 20,
          sourceWarehouseId: 2,
          sourceWarehouseName: 'Main',
          productName: 'Item A',
          barcode: '622000000001',
        },
      ],
      notes: 'load',
      dispatchImmediately: true,
    });
    assert.equal(transformed.items.length, 1, 'the requisition item survives the pipe');
    assert.equal(transformed.items[0].productName, 'Item A', 'the display productName survives the pipe');
    assert.equal(transformed.items[0].barcode, '622000000001', 'the display barcode survives the pipe');
    assert.equal(transformed.dispatchImmediately, true, 'the dispatch flag survives the pipe');
    await pipeRejects(
      CreateAdminRequisitionDto,
      { repId: 3, items: [{ productId: 10, qty: 5 }], approved: true },
      'an extra approved flag must be rejected on create-requisition',
    );
    await pipeRejects(
      CreateAdminRequisitionDto,
      { repId: 3, items: [] },
      'an empty items list must be rejected on create-requisition',
    );
    console.log('  (6) CreateAdminRequisitionDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 7. ReviewRequisitionDto — caller: the review dialog sends
  // { approvedItems, notes?, sourceWarehouseId? }. An empty
  // approvedItems list passes the pipe (the service stores it as
  // JSON and tolerates it — no min-size).
  {
    const transformed = await pipeOk(ReviewRequisitionDto, {
      approvedItems: [{ productId: 10, qty: 15 }],
      notes: 'ok',
      sourceWarehouseId: 2,
    });
    assert.equal(transformed.approvedItems.length, 1, 'the approved item survives the pipe');
    const empty = await pipeOk(ReviewRequisitionDto, { approvedItems: [] });
    assert.deepEqual(empty.approvedItems, [], 'an empty approved list passes the pipe (service tolerates it)');
    await pipeRejects(
      ReviewRequisitionDto,
      { approvedItems: [{ productId: 10, qty: 15 }], repId: 3 },
      'an extra repId must be rejected on review-requisition',
    );
    await pipeRejects(
      ReviewRequisitionDto,
      { approvedItems: [{ productId: 'x', qty: 15 }] },
      'a string product id must be rejected on review-requisition',
    );
    console.log('  (7) ReviewRequisitionDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 8. SetRepTargetDto — caller: van-sales-admin-ops.ts setRepTarget
  // spreads its commissionRates flat with the non-Percent names
  // (salesCommissionRate / collectionCommissionRate / targetBonusRate);
  // the Percent spellings are accepted too (PRE-EXISTING MISMATCH:
  // the slice reads only the Percent names, so the caller rates are
  // lost today — the DTO accepts both spellings, it does not fix the
  // mapping).
  {
    const transformed = await pipeOk(SetRepTargetDto, {
      repId: 3,
      month: '2026-11',
      targetAmount: 50000,
      salesCommissionRate: 5,
      collectionCommissionRate: 3,
      targetBonusRate: 2,
    });
    assert.equal(transformed.targetAmount, 50000, 'the target amount survives the pipe');
    assert.equal(transformed.salesCommissionRate, 5, 'the caller rate spelling survives the pipe');
    const percent = await pipeOk(SetRepTargetDto, {
      repId: 3,
      month: '2026-11',
      targetAmount: 50000,
      salesCommissionRatePercent: 5,
    });
    assert.equal(percent.salesCommissionRatePercent, 5, 'the Percent rate spelling survives the pipe');
    await pipeRejects(
      SetRepTargetDto,
      { repId: 3, month: '2026-11', targetAmount: 50000, bonus: 1 },
      'an extra bonus must be rejected on set-target',
    );
    await pipeRejects(
      SetRepTargetDto,
      { repId: 3, month: '2026-11', targetAmount: 'fifty' },
      'a string target amount must be rejected on set-target',
    );
    console.log('  (8) SetRepTargetDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 9. SaveCommissionConfigDto — caller: van-sales-admin-ops.ts
  // saveCommissionConfig sends the non-Percent names
  // (defaultSalesRate / defaultCollectionRate /
  // defaultTargetBonusRate / salesRate / collectionRate /
  // targetBonusRate); the Percent spellings are accepted too
  // (PRE-EXISTING MISMATCH: the service reads only the Percent
  // names, so the call is a no-op today).
  {
    const transformed = await pipeOk(SaveCommissionConfigDto, {
      defaultSalesRate: 5,
      defaultCollectionRate: 3,
      defaultTargetBonusRate: 2,
    });
    assert.equal(transformed.defaultSalesRate, 5, 'the caller default rate survives the pipe');
    const empty = await pipeOk(SaveCommissionConfigDto, {});
    assert.equal(empty.defaultSalesRate, undefined, 'an empty config passes the pipe (all fields optional)');
    await pipeRejects(
      SaveCommissionConfigDto,
      { defaultSalesRate: 5, repName: 'x' },
      'an extra repName must be rejected on save-commission-config',
    );
    await pipeRejects(
      SaveCommissionConfigDto,
      { salesCommissionRatePercent: 'high' },
      'a string rate must be rejected on save-commission-config',
    );
    console.log('  (9) SaveCommissionConfigDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 10. SettleRepCommissionDto — caller: van-sales-admin-ops.ts
  // settleRepCommission sends { repId, month, amount,
  // paymentMethod?, notes? } (PRE-EXISTING MISMATCH: the slice reads
  // periodMonth, not month, so the caller's chosen month is lost
  // today — the DTO requires month and accepts periodMonth too).
  {
    const transformed = await pipeOk(SettleRepCommissionDto, {
      repId: 3,
      month: '2026-11',
      amount: 2500,
      paymentMethod: 'cash',
      notes: 'settled',
    });
    assert.equal(transformed.month, '2026-11', 'the caller month survives the pipe');
    assert.equal(transformed.amount, 2500, 'the amount survives the pipe');
    await pipeRejects(
      SettleRepCommissionDto,
      { repId: 3, month: '2026-11', amount: 2500, status: 'x' },
      'an extra status must be rejected on settle-commission',
    );
    await pipeRejects(
      SettleRepCommissionDto,
      { repId: 3, month: '2026-11', amount: 'lots' },
      'a string amount must be rejected on settle-commission',
    );
    console.log('  (10) SettleRepCommissionDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 11. SetCustomerRouteScheduleDto — caller: the route-schedule
  // dialog sends any subset of the schedule fields; an empty body
  // passes the pipe.
  {
    const transformed = await pipeOk(SetCustomerRouteScheduleDto, {
      route: 'R1',
      routeSequence: 1,
      visitDays: ['sun', 'tue'],
      assignedRepId: 3,
      repSchedules: [{ repId: 3, repName: 'Ali', days: ['sun'] }],
    });
    assert.equal(transformed.route, 'R1', 'the route survives the pipe');
    assert.equal(transformed.repSchedules!.length, 1, 'the rep schedule survives the pipe');
    const empty = await pipeOk(SetCustomerRouteScheduleDto, {});
    assert.equal(empty.route, undefined, 'an empty schedule passes the pipe (all fields optional)');
    await pipeRejects(
      SetCustomerRouteScheduleDto,
      { route: 'R1', customerId: 5 },
      'an extra customerId must be rejected on set-route-schedule',
    );
    await pipeRejects(
      SetCustomerRouteScheduleDto,
      { visitDays: 'sun' },
      'a string visitDays must be rejected on set-route-schedule',
    );
    console.log('  (11) SetCustomerRouteScheduleDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 12. BulkAssignCustomerRoutesDto — caller: the bulk-assign dialog
  // sends { customerIds, assignedRepId?, assignedRepIds?,
  // appendReps?, assignedRepName?, route?, visitDays? }.
  {
    const transformed = await pipeOk(BulkAssignCustomerRoutesDto, {
      customerIds: [1, 2, 3],
      assignedRepId: 3,
      appendReps: true,
      route: 'R1',
      visitDays: ['sun'],
    });
    assert.deepEqual(transformed.customerIds, [1, 2, 3], 'the customer ids survive the pipe');
    assert.equal(transformed.appendReps, true, 'the append flag survives the pipe');
    await pipeRejects(
      BulkAssignCustomerRoutesDto,
      { customerIds: [1], repId: 3 },
      'an extra repId must be rejected on bulk-assign',
    );
    await pipeRejects(
      BulkAssignCustomerRoutesDto,
      { customerIds: [] },
      'an empty customer list must be rejected on bulk-assign',
    );
    console.log('  (12) BulkAssignCustomerRoutesDto: real caller payload passes, extra/wrong-type rejected passed');
  }
  // 13. RecordAdminFuelLogDto — caller: the admin fuel-log form
  // sends vehicleId, odometer, liters, pricePerLiter plus the
  // optional trip/rep/station/notes fields.
  {
    const transformed = await pipeOk(RecordAdminFuelLogDto, {
      vehicleId: 1,
      tripId: 5,
      repId: 3,
      odometer: 123500,
      liters: 40,
      pricePerLiter: 13.5,
      stationName: 'Total',
      notes: 'fill',
    });
    assert.equal(transformed.vehicleId, 1, 'the vehicle survives the pipe');
    assert.equal(transformed.repId, 3, 'the admin repId survives the pipe');
    assert.equal(transformed.liters, 40, 'the liters survive the pipe');
    await pipeRejects(
      RecordAdminFuelLogDto,
      { vehicleId: 1, odometer: 1, liters: 1, pricePerLiter: 1, driverId: 1 },
      'an extra driverId must be rejected on admin fuel-log',
    );
    await pipeRejects(
      RecordAdminFuelLogDto,
      { vehicleId: 1, odometer: 0, liters: 40, pricePerLiter: 13.5 },
      'a zero odometer must be rejected on admin fuel-log',
    );
    console.log('  (13) RecordAdminFuelLogDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 14. RecordAdminOilChangeDto — caller: the admin oil-change form
  // sends the vehicle, the change details, and the optional rep.
  {
    const transformed = await pipeOk(RecordAdminOilChangeDto, {
      vehicleId: 1,
      odometerAtChange: 120000,
      oilType: '10W-40',
      ratedKm: 5000,
      withFilter: true,
      alertKmBefore: 500,
      cost: 800,
      performedBy: 'Ali',
      repId: 3,
    });
    assert.equal(transformed.oilType, '10W-40', 'the oil type survives the pipe');
    assert.equal(transformed.withFilter, true, 'the filter flag survives the pipe');
    await pipeRejects(
      RecordAdminOilChangeDto,
      { vehicleId: 1, odometerAtChange: 1, oilType: 'x', ratedKm: 1, withFilter: true, driverId: 1 },
      'an extra driverId must be rejected on admin oil-change',
    );
    await pipeRejects(
      RecordAdminOilChangeDto,
      { vehicleId: 1, odometerAtChange: 120000, oilType: '', ratedKm: 5000, withFilter: true },
      'a blank oil type must be rejected on admin oil-change',
    );
    console.log('  (14) RecordAdminOilChangeDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 15. AssignVehicleDriverDto — caller: the vehicle-driver form
  // sends { repId, shiftName, shiftStartTime?, shiftEndTime?,
  // notes? }.
  {
    const transformed = await pipeOk(AssignVehicleDriverDto, {
      repId: 3,
      shiftName: 'morning',
      shiftStartTime: '08:00',
      shiftEndTime: '16:00',
    });
    assert.equal(transformed.repId, 3, 'the rep survives the pipe');
    assert.equal(transformed.shiftName, 'morning', 'the shift name survives the pipe');
    await pipeRejects(
      AssignVehicleDriverDto,
      { repId: 3, shiftName: 'x', vehicleId: 1 },
      'an extra vehicleId must be rejected on assign-vehicle-driver',
    );
    await pipeRejects(
      AssignVehicleDriverDto,
      { repId: 3, shiftName: ['x'] },
      'an array shift name must be rejected on assign-vehicle-driver',
    );
    console.log('  (15) AssignVehicleDriverDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 16. TogglePromotionActiveDto — caller: the promotions tab sends
  // { isActive } with a real boolean. Boolean-coercion pin (Rule 3):
  // a string "false" coerces to true under enableImplicitConversion,
  // so there is no wrong-type case for a boolean — the coercion is
  // pinned instead, and the second negative is a missing field.
  {
    const transformed = await pipeOk(TogglePromotionActiveDto, { isActive: false });
    assert.equal(transformed.isActive, false, 'a real false flag survives the pipe');
    const coerced = await pipeOk(TogglePromotionActiveDto, { isActive: 'false' });
    assert.equal(
      coerced.isActive,
      true,
      'a string "false" coerces to true (Rule 3 — callers must send a real boolean)',
    );
    await pipeRejects(
      TogglePromotionActiveDto,
      { isActive: true, promoId: 1 },
      'an extra promoId must be rejected on toggle-promotion-active',
    );
    await pipeRejects(TogglePromotionActiveDto, {}, 'a missing isActive must be rejected on toggle-promotion-active');
    console.log(
      '  (16) TogglePromotionActiveDto: real caller payload passes, extra/missing rejected, boolean coercion pinned passed',
    );
  }

  // 17. OptimizeSupervisorRouteDto — caller: the supervisor route
  // optimizer sends any subset of { customerIds?, route?, repId?,
  // startLat?, startLng?, persistSequence? }; an empty body passes
  // the pipe (the either/or rule stays in the service).
  {
    const transformed = await pipeOk(OptimizeSupervisorRouteDto, {
      customerIds: [1, 2],
      route: 'R1',
      repId: 3,
      persistSequence: true,
    });
    assert.deepEqual(transformed.customerIds, [1, 2], 'the customer ids survive the pipe');
    const empty = await pipeOk(OptimizeSupervisorRouteDto, {});
    assert.equal(empty.route, undefined, 'an empty optimize passes the pipe (all fields optional)');
    await pipeRejects(
      OptimizeSupervisorRouteDto,
      { route: 'R1', driverId: 1 },
      'an extra driverId must be rejected on optimize-supervisor-route',
    );
    await pipeRejects(
      OptimizeSupervisorRouteDto,
      { customerIds: 'all' },
      'a string customerIds must be rejected on optimize-supervisor-route',
    );
    console.log('  (17) OptimizeSupervisorRouteDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 18. SettleRepFinancialItemDto — caller: the financial-ledger
  // settle dialog sends { method, notes?, reason?,
  // supervisorPin? }.
  {
    const transformed = await pipeOk(SettleRepFinancialItemDto, {
      method: 'waiver',
      reason: 'shortage waived',
      supervisorPin: '1234',
    });
    assert.equal(transformed.method, 'waiver', 'the method survives the pipe');
    assert.equal(transformed.supervisorPin, '1234', 'the supervisor PIN survives the pipe');
    await pipeRejects(
      SettleRepFinancialItemDto,
      { method: 'cash', itemId: 1 },
      'an extra itemId must be rejected on settle-financial-item',
    );
    await pipeRejects(
      SettleRepFinancialItemDto,
      { method: 'card' },
      'a method outside the union must be rejected on settle-financial-item',
    );
    console.log('  (18) SettleRepFinancialItemDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 19. PushRepShortagesToPayrollDto — caller: the push-to-payroll
  // dialog sends { settlementIds, targetMonth? }.
  {
    const transformed = await pipeOk(PushRepShortagesToPayrollDto, { settlementIds: [7, 8], targetMonth: '2026-11' });
    assert.deepEqual(transformed.settlementIds, [7, 8], 'the settlement ids survive the pipe');
    await pipeRejects(
      PushRepShortagesToPayrollDto,
      { settlementIds: [7], repId: 3 },
      'an extra repId must be rejected on push-to-payroll',
    );
    await pipeRejects(
      PushRepShortagesToPayrollDto,
      { settlementIds: [] },
      'an empty settlement list must be rejected on push-to-payroll',
    );
    console.log('  (19) PushRepShortagesToPayrollDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 20. AddRepBonusOrCommissionDto — caller: the bonus dialog sends
  // { repId, entryType, amount, notes }.
  {
    const transformed = await pipeOk(AddRepBonusOrCommissionDto, {
      repId: 3,
      entryType: 'bonus',
      amount: 500,
      notes: 'top seller',
    });
    assert.equal(transformed.amount, 500, 'the amount survives the pipe');
    assert.equal(transformed.notes, 'top seller', 'the note survives the pipe');
    await pipeRejects(
      AddRepBonusOrCommissionDto,
      { repId: 3, entryType: 'bonus', amount: 500, notes: 'x', month: 'x' },
      'an extra month must be rejected on add-bonus',
    );
    await pipeRejects(
      AddRepBonusOrCommissionDto,
      { repId: 3, entryType: 'bonus', amount: 0, notes: 'x' },
      'a zero amount must be rejected on add-bonus',
    );
    console.log('  (20) AddRepBonusOrCommissionDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 21. LinkRepToEmployeeDto — caller: the link dialog sends
  // { repId, employeeId }; employeeId may be null (unlink).
  {
    const transformed = await pipeOk(LinkRepToEmployeeDto, { repId: 3, employeeId: 42 });
    assert.equal(transformed.employeeId, 42, 'the employee survives the pipe');
    const unlinked = await pipeOk(LinkRepToEmployeeDto, { repId: 3, employeeId: null });
    assert.equal(unlinked.employeeId, null, 'a null employeeId passes the pipe (unlink)');
    await pipeRejects(
      LinkRepToEmployeeDto,
      { repId: 3, employeeId: 42, name: 'x' },
      'an extra name must be rejected on link-employee',
    );
    await pipeRejects(
      LinkRepToEmployeeDto,
      { repId: 3, employeeId: 0 },
      'a zero employeeId must be rejected on link-employee',
    );
    console.log('  (21) LinkRepToEmployeeDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 22. AutoCreateEmployeeDto — caller: the auto-create dialog sends
  // { repId }.
  {
    const transformed = await pipeOk(AutoCreateEmployeeDto, { repId: 3 });
    assert.equal(transformed.repId, 3, 'the rep survives the pipe');
    await pipeRejects(
      AutoCreateEmployeeDto,
      { repId: 3, name: 'x' },
      'an extra name must be rejected on auto-create-employee',
    );
    await pipeRejects(AutoCreateEmployeeDto, { repId: 0 }, 'a zero repId must be rejected on auto-create-employee');
    console.log('  (22) AutoCreateEmployeeDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // Source pins: the admin controller takes the DTO classes, and the
  // DTO files declare classes.
  {
    const here = __dirname;
    const read = (p: string): string => readFileSync(resolve(here, '../../src', p), 'utf8');
    const adminController = read('modules/delivery-reps/van-sales-admin.controller.ts');
    for (const name of [
      'SettleTripAdminDto',
      'CreateVehicleDto',
      'UpdateVehicleDto',
      'AssignRepDto',
      'RejectWithReasonDto',
      'CreateAdminRequisitionDto',
      'ReviewRequisitionDto',
      'SetRepTargetDto',
      'SaveCommissionConfigDto',
      'SettleRepCommissionDto',
      'SetCustomerRouteScheduleDto',
      'BulkAssignCustomerRoutesDto',
      'RecordAdminFuelLogDto',
      'RecordAdminOilChangeDto',
      'AssignVehicleDriverDto',
      'TogglePromotionActiveDto',
      'OptimizeSupervisorRouteDto',
      'SettleRepFinancialItemDto',
      'PushRepShortagesToPayrollDto',
      'AddRepBonusOrCommissionDto',
      'LinkRepToEmployeeDto',
      'AutoCreateEmployeeDto',
    ]) {
      assert.ok(adminController.includes(name), `the admin controller takes ${name}`);
    }
    const tripsDto = read('modules/delivery-reps/dto/van-trips.dto.ts');
    assert.ok(tripsDto.includes('export class SettleTripAdminDto'), 'SettleTripAdminDto is a class, not an interface');
    assert.ok(tripsDto.includes('export class CreateVehicleDto'), 'CreateVehicleDto is a class, not an interface');
    const targetsDto = read('modules/delivery-reps/dto/van-targets.dto.ts');
    assert.ok(targetsDto.includes('export class SetRepTargetDto'), 'SetRepTargetDto is a class, not an interface');
    assert.ok(
      targetsDto.includes('export class SettleRepCommissionDto'),
      'SettleRepCommissionDto is a class, not an interface',
    );
    const fleetDto = read('modules/delivery-reps/dto/van-fleet.dto.ts');
    assert.ok(
      fleetDto.includes('export class RecordAdminFuelLogDto'),
      'RecordAdminFuelLogDto is a class, not an interface',
    );
    const opsDto = read('modules/delivery-reps/dto/van-admin-ops.dto.ts');
    assert.ok(
      opsDto.includes('export class TogglePromotionActiveDto'),
      'TogglePromotionActiveDto is a class, not an interface',
    );
    assert.ok(
      opsDto.includes('export class AddRepBonusOrCommissionDto'),
      'AddRepBonusOrCommissionDto is a class, not an interface',
    );
    console.log('  source pins passed');
  }

  console.log('DTO delivery-reps admin tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
