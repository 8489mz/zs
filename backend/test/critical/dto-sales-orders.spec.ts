/*
 * New file: backend/test/critical/dto-sales-orders.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-SALES-ORDERS, D5): the 17 sales-orders
 * controller routes (sales orders, installments, quotations,
 * delivery aggregators, restaurant F&B, food waste) now take DTO
 * classes, so the real global requestValidationPipe validates
 * and whitelists them. Before D5 they took inline object types
 * or dto-interface types — and the pipe does nothing for an
 * inline type or an interface, so any extra field (or a
 * wrong-typed field) reached the service untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH DTO, (a) a positive case with the REAL caller payload
 * (the exact shape the frontend api file sends — see the per-case
 * comments for the caller file; the two endpoints with no
 * frontend caller use the interface shape itself), which must
 * pass the pipe with every field intact, and (b) two negative
 * cases: an extra field the caller never sends is rejected with
 * 400 VALIDATION_ERROR, and a wrong-typed field is rejected the
 * same way. Money endpoints (sales-order create, manager comp)
 * get their positive case with the REAL caller payload.
 *
 * CALLER TRAPS PINNED HERE (found during D5 caller verification):
 * - CreateSalesOrderDto: the caller payload matches the interface
 *   field for field (useCreateSalesOrderForm / SalesOrdersPage).
 * - PayInstallmentDto.paymentMethod: the interface marks it
 *   optional, but the service THROWS when it is missing
 *   (INSTALLMENT_PAYMENT_METHOD_REQUIRED) and the only caller
 *   always sends it (defaults 'cash'). It is REQUIRED in the
 *   DTO. transferReference / receiptNo are never sent by the
 *   caller and stay optional.
 * - UpdateQuotationDto: ZERO frontend callers (no page calls the
 *   update endpoint). The positive case is the interface shape
 *   itself (the D2 UpdatePurchaseOrderDto precedent).
 * - IngestOrderDto: NO caller (manual / mock ingest only, per
 *   the controller comment). The positive case is the interface
 *   shape itself. The service NEVER reads dto.items (it stores
 *   the whole body opaquely as order_payload), so items stay
 *   optional — a body without items passes the pipe (pinned).
 * - Toggle86ItemDto.is86ed: a string "false" coerces to boolean
 *   true under enableImplicitConversion — pinned, not fought
 *   (the caller sends real booleans; this documents the
 *   footgun, contract Rule 3).
 * - CalculateTipPoolDto.shiftDate: the interface declares it
 *   required but the service defaults to the business date when
 *   absent. It stays optional.
 * - SaveTableZoneDto.tableNumbers: the interface declares it
 *   required but the service defaults to []. It stays optional.
 * - GeneratePrepSheetDto.items: the caller never sends items
 *   (the service falls back to default prep templates). Items
 *   stay optional with all-optional item fields.
 * - SaveTableLayoutsDto layouts: the caller (saveTableLayouts)
 *   sends TableLayout items that carry `is_active` per item —
 *   NOT in the controller type. The DTO accepts it, or the save
 *   would 400. A body without layouts passes the pipe (the
 *   service returns [] for a non-array — pinned, the D3
 *   executeSale precedent).
 * - RecordManagerCompDto.managerName: the interface declares it
 *   required and the caller always sends it, but the service
 *   records the VERIFIED approver, never the free-text name. It
 *   stays required (the caller sends it).
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted
 * app); the services themselves (their own throws stay the
 * backstop — e.g. the sales-order money reconciliation, the
 * installment amount / method gates, the tip-pool total
 * reconciliation); the frontend screens (untouched).
 *
 * Fail-first: this spec is new in D5 — on the unpatched tree the
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
import { CreateInstallmentPlanDto, PayInstallmentDto } from '../../src/modules/sales/dto/customer-installment.dto';
import { UpdateAggregatorChannelDto } from '../../src/modules/sales/dto/delivery-aggregators.dto';
import {
  CreateDriveThruOrderDto,
  CreateUpsellRuleDto,
  RecordManagerCompDto,
  RecordTableRatingDto,
  RenameHeldDraftTableDto,
  SaveTableLayoutsDto,
} from '../../src/modules/sales/dto/restaurant-fnb.dto';
import { CreateSalesOrderDto } from '../../src/modules/sales/dto/sales-order.dto';
import { UpdateQuotationDto } from '../../src/modules/sales/dto/quotation.dto';
import { IngestOrderDto } from '../../src/modules/sales/services/delivery-aggregators.service';
import {
  CalculateTipPoolDto,
  GeneratePrepSheetDto,
  SaveTableZoneDto,
  Toggle86ItemDto,
} from '../../src/modules/sales/services/restaurant-fnb/restaurant-fnb-types';
import { CreateFoodWasteLogDto } from '../../src/modules/sales/services/restaurant-food-waste.service';

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
  // 1. CreateSalesOrderDto (MONEY) — caller: the sales-order form
  // builds exactly CreateSalesOrderPayload (useCreateSalesOrderForm
  // / SalesOrdersPage) and posts it unchanged.
  {
    const transformed = await pipeOk(CreateSalesOrderDto, {
      customerId: 12,
      customerName: 'Ahmed Ali',
      customerPhone: '01012345678',
      customerAddress: 'Cairo',
      branchId: 1,
      warehouseLocationId: null,
      subtotal: 1000,
      discountAmount: 50,
      taxAmount: 0,
      totalAmount: 950,
      reservationExpiresAt: null,
      deliveryDate: null,
      quotationId: null,
      notes: 'urgent',
      termsConditions: 'net 30',
      autoReserve: true,
      items: [
        {
          productId: 5,
          productName: 'Sugar 1kg',
          unitName: 'piece',
          quantity: 10,
          unitPrice: 100,
          discount: 0,
          total: 1000,
          notes: '',
        },
      ],
    });
    assert.equal(transformed.customerName, 'Ahmed Ali', 'the customer name survives the pipe');
    assert.equal(transformed.items[0].quantity, 10, 'the item quantity survives the pipe');
    await pipeRejects(
      CreateSalesOrderDto,
      {
        customerName: 'Ahmed Ali',
        subtotal: 1000,
        totalAmount: 950,
        items: [{ productId: 5, productName: 'Sugar 1kg', quantity: 10, unitPrice: 100, total: 1000 }],
        isAdmin: true,
      },
      'an extra admin flag must be rejected on create sales order',
    );
    await pipeRejects(
      CreateSalesOrderDto,
      { subtotal: 1000, totalAmount: 950, items: [] },
      'a missing customer name must be rejected on create sales order',
    );
    await pipeRejects(
      CreateSalesOrderDto,
      {
        customerName: 'Ahmed Ali',
        subtotal: 1000,
        totalAmount: 950,
        items: [],
      },
      'an empty items list must be rejected on create sales order',
    );
    console.log('  (1) CreateSalesOrderDto: real caller payload passes, extra/missing/empty rejected passed');
  }

  // 2. CreateInstallmentPlanDto — caller: CreateInstallmentPlanModal
  // submits { customerId, saleId, totalAmount, downPayment,
  // interestRatePercent, installmentCount, startDate, firstDueDate
  // (= startDate), notes }.
  {
    const transformed = await pipeOk(CreateInstallmentPlanDto, {
      customerId: 12,
      saleId: null,
      totalAmount: 12000,
      downPayment: 2000,
      interestRatePercent: 0,
      installmentCount: 10,
      startDate: '2026-11-25',
      firstDueDate: '2026-11-25',
      notes: 'plan',
    });
    assert.equal(transformed.installmentCount, 10, 'the installment count survives the pipe');
    assert.equal(transformed.firstDueDate, '2026-11-25', 'the first due date survives the pipe');
    await pipeRejects(
      CreateInstallmentPlanDto,
      { customerId: 12, totalAmount: 12000, installmentCount: 10, isAdmin: true },
      'an extra admin flag must be rejected on create installment plan',
    );
    await pipeRejects(
      CreateInstallmentPlanDto,
      { totalAmount: 12000, installmentCount: 10 },
      'a missing customer must be rejected on create installment plan',
    );
    await pipeRejects(
      CreateInstallmentPlanDto,
      { customerId: 12, totalAmount: 12000, installmentCount: 0 },
      'a zero installment count must be rejected on create installment plan',
    );
    console.log('  (2) CreateInstallmentPlanDto: real caller payload passes, extra/missing/zero rejected passed');
  }

  // 3. PayInstallmentDto — caller: the InstallmentsPage pay modal
  // sends { amount, paymentMethod, notes } (no transferReference,
  // no receiptNo). paymentMethod is REQUIRED: the service throws
  // when it is missing and the caller always sends it.
  {
    const transformed = await pipeOk(PayInstallmentDto, { amount: 1200, paymentMethod: 'cash', notes: 'paid' });
    assert.equal(transformed.amount, 1200, 'the payment amount survives the pipe');
    assert.equal(transformed.paymentMethod, 'cash', 'the payment method survives the pipe');
    await pipeRejects(
      PayInstallmentDto,
      { amount: 1200, paymentMethod: 'cash', isAdmin: true },
      'an extra admin flag must be rejected on pay installment',
    );
    await pipeRejects(
      PayInstallmentDto,
      { paymentMethod: 'cash' },
      'a missing amount must be rejected on pay installment',
    );
    await pipeRejects(
      PayInstallmentDto,
      { amount: 1200 },
      'a missing payment method must be rejected on pay installment',
    );
    await pipeRejects(
      PayInstallmentDto,
      { amount: 1200, paymentMethod: 'cheque' },
      'an unknown payment method must be rejected on pay installment',
    );
    console.log('  (3) PayInstallmentDto: real caller payload passes, extra/missing/wrong-type rejected passed');
  }

  // 4. UpdateQuotationDto — ZERO frontend callers (no page calls
  // the update endpoint). The positive case is the interface shape
  // itself: a partial update with the full lifecycle status.
  {
    const transformed = await pipeOk(UpdateQuotationDto, {
      customerName: 'Ahmed Ali',
      subtotal: 1000,
      totalAmount: 950,
      status: 'accepted',
      items: [{ productId: 5, productName: 'Sugar 1kg', quantity: 10, unitPrice: 100, total: 1000 }],
    });
    assert.equal(transformed.status, 'accepted', 'the accepted status survives the pipe');
    const partial = await pipeOk(UpdateQuotationDto, { status: 'sent' });
    assert.equal(partial.status, 'sent', 'a status-only update passes (all optional)');
    await pipeRejects(
      UpdateQuotationDto,
      { status: 'sent', isAdmin: true },
      'an extra admin flag must be rejected on update quotation',
    );
    await pipeRejects(
      UpdateQuotationDto,
      { status: 'shipped' },
      'an unknown status must be rejected on update quotation',
    );
    console.log('  (4) UpdateQuotationDto: interface shape passes, extra/wrong-type rejected passed');
  }

  // 5. UpdateAggregatorChannelDto — caller: PosDeliveryAggregatorsModal
  // sends { is_active } only. The DTO mirrors the channel interface
  // (all optional); the service picks the seven fields it stores.
  {
    const transformed = await pipeOk(UpdateAggregatorChannelDto, { is_active: false });
    assert.equal(transformed.is_active, false, 'the active flag survives the pipe');
    const full = await pipeOk(UpdateAggregatorChannelDto, {
      code: 'talabat',
      name: 'Talabat Egypt',
      commission_rate: 18,
      is_active: true,
      auto_accept_orders: false,
    });
    assert.equal(full.commission_rate, 18, 'the commission rate survives the pipe');
    await pipeRejects(
      UpdateAggregatorChannelDto,
      { is_active: false, isAdmin: true },
      'an extra admin flag must be rejected on update aggregator',
    );
    await pipeRejects(
      UpdateAggregatorChannelDto,
      { commission_rate: 'high' },
      'a non-numeric commission rate must be rejected on update aggregator',
    );
    console.log('  (5) UpdateAggregatorChannelDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 6. IngestOrderDto — NO caller (manual / mock ingest only, per
  // the controller comment). The positive case is the interface
  // shape itself. The service never reads items (it stores the
  // whole body opaquely as order_payload), so items stay optional.
  {
    const transformed = await pipeOk(IngestOrderDto, {
      aggregatorCode: 'talabat',
      externalOrderId: 'EXT-1001',
      displayNumber: 'T-1001',
      branchId: 1,
      customerName: 'Sara',
      customerPhone: '01111111111',
      deliveryAddress: 'Cairo',
      riderName: 'Omar',
      riderPhone: '01222222222',
      subtotal: 500,
      deliveryFee: 20,
      commissionRate: 18,
      items: [{ productId: 5, name: 'Sugar 1kg', qty: 2, unitPrice: 100, notes: '' }],
      notes: 'fast',
    });
    assert.equal(transformed.externalOrderId, 'EXT-1001', 'the external order id survives the pipe');
    const noItems = await pipeOk(IngestOrderDto, {
      aggregatorCode: 'talabat',
      externalOrderId: 'EXT-1002',
      subtotal: 100,
    });
    assert.equal(noItems.items, undefined, 'a body without items passes — the service never reads items');
    await pipeRejects(
      IngestOrderDto,
      { aggregatorCode: 'talabat', externalOrderId: 'EXT-1001', subtotal: 500, isAdmin: true },
      'an extra admin flag must be rejected on ingest order',
    );
    await pipeRejects(
      IngestOrderDto,
      { aggregatorCode: 'talabat', subtotal: 500 },
      'a missing external order id must be rejected on ingest order',
    );
    console.log('  (6) IngestOrderDto: interface shape passes, extra/missing rejected passed');
  }

  // 7. Toggle86ItemDto — caller: restaurant-advanced-fnb.api.ts
  // toggle86Item sends { productId, productName, is86ed, reason?,
  // autoRestoreHours? } (no componentProductId).
  {
    const transformed = await pipeOk(Toggle86ItemDto, {
      productId: 5,
      productName: 'Sugar 1kg',
      is86ed: true,
      reason: 'out of stock',
      autoRestoreHours: 4,
    });
    assert.equal(transformed.is86ed, true, 'the 86 flag survives the pipe');
    const coerced = await pipeOk(Toggle86ItemDto, { productId: 5, productName: 'Sugar 1kg', is86ed: 'false' });
    assert.equal(coerced.is86ed, true, 'a string "false" coerces to boolean true (contract Rule 3 footgun)');
    await pipeRejects(
      Toggle86ItemDto,
      { productId: 5, productName: 'Sugar 1kg', is86ed: true, isAdmin: true },
      'an extra admin flag must be rejected on toggle 86',
    );
    await pipeRejects(
      Toggle86ItemDto,
      { productName: 'Sugar 1kg', is86ed: true },
      'a missing product id must be rejected on toggle 86',
    );
    console.log('  (7) Toggle86ItemDto: real caller payload passes, extra/missing rejected passed');
  }

  // 8. CalculateTipPoolDto — caller: restaurant-advanced-fnb.api.ts
  // calculateTipPool sends the full pool shape.
  {
    const transformed = await pipeOk(CalculateTipPoolDto, {
      shiftDate: '2026-11-25',
      shiftName: 'evening',
      totalCashTips: 300,
      totalCardTips: 200,
      distributionMethod: 'hours',
      staff: [{ employeeId: 3, employeeName: 'Ali', roleName: 'waiter', hoursWorked: 8, pointWeight: 1 }],
      notes: 'evening pool',
    });
    assert.equal(transformed.distributionMethod, 'hours', 'the distribution method survives the pipe');
    assert.equal(transformed.staff[0].employeeId, 3, 'the staff employee id survives the pipe');
    await pipeRejects(
      CalculateTipPoolDto,
      {
        shiftDate: '2026-11-25',
        distributionMethod: 'hours',
        staff: [{ employeeId: 3, employeeName: 'Ali', roleName: 'waiter', hoursWorked: 8 }],
        isAdmin: true,
      },
      'an extra admin flag must be rejected on calculate tip pool',
    );
    await pipeRejects(
      CalculateTipPoolDto,
      { shiftDate: '2026-11-25', distributionMethod: 'hours', staff: [] },
      'an empty staff list must be rejected on calculate tip pool',
    );
    await pipeRejects(
      CalculateTipPoolDto,
      {
        shiftDate: '2026-11-25',
        distributionMethod: 'seniority',
        staff: [{ employeeId: 3, employeeName: 'Ali', roleName: 'waiter', hoursWorked: 8 }],
      },
      'an unknown distribution method must be rejected on calculate tip pool',
    );
    console.log('  (8) CalculateTipPoolDto: real caller payload passes, extra/wrong-type/empty rejected passed');
  }

  // 9. SaveTableZoneDto — caller: restaurant-advanced-fnb.api.ts
  // saveZone sends { id?, zoneCode, name, sortOrder?, capacitySeats?,
  // tableNumbers, minimumSpend? }.
  {
    const transformed = await pipeOk(SaveTableZoneDto, {
      zoneCode: 'main',
      name: 'Main Hall',
      sortOrder: 1,
      capacitySeats: 40,
      tableNumbers: ['T1', 'T2'],
      minimumSpend: 200,
    });
    assert.equal(transformed.zoneCode, 'main', 'the zone code survives the pipe');
    assert.deepEqual(transformed.tableNumbers, ['T1', 'T2'], 'the table numbers survive the pipe');
    await pipeRejects(
      SaveTableZoneDto,
      { zoneCode: 'main', name: 'Main Hall', tableNumbers: ['T1'], isAdmin: true },
      'an extra admin flag must be rejected on save zone',
    );
    await pipeRejects(
      SaveTableZoneDto,
      { zoneCode: 'main', tableNumbers: ['T1'] },
      'a missing zone name must be rejected on save zone',
    );
    console.log('  (9) SaveTableZoneDto: real caller payload passes, extra/missing rejected passed');
  }

  // 10. GeneratePrepSheetDto — caller: restaurant-advanced-fnb.api.ts
  // generatePrepSheet sends { prepDate, shiftType?, notes? } (never
  // items — the service falls back to default prep templates).
  {
    const transformed = await pipeOk(GeneratePrepSheetDto, {
      prepDate: '2026-11-25',
      shiftType: 'morning',
      notes: 'friday prep',
    });
    assert.equal(transformed.prepDate, '2026-11-25', 'the prep date survives the pipe');
    assert.equal(transformed.shiftType, 'morning', 'the shift type survives the pipe');
    await pipeRejects(
      GeneratePrepSheetDto,
      { prepDate: '2026-11-25', isAdmin: true },
      'an extra admin flag must be rejected on generate prep sheet',
    );
    await pipeRejects(
      GeneratePrepSheetDto,
      { prepDate: '2026-11-25', shiftType: 'dawn' },
      'an unknown shift type must be rejected on generate prep sheet',
    );
    console.log('  (10) GeneratePrepSheetDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 11. RecordManagerCompDto (MONEY) — caller:
  // restaurant-advanced-fnb.api.ts recordManagerComp sends the full
  // comp shape.
  {
    const transformed = await pipeOk(RecordManagerCompDto, {
      saleId: 77,
      tableNumber: 'T3',
      compType: 'vip_guest',
      managerName: 'Mona',
      managerPin: '4321',
      amount: 150,
      itemsSummary: 'dessert',
      notes: 'VIP guest',
    });
    assert.equal(transformed.compType, 'vip_guest', 'the comp type survives the pipe');
    assert.equal(transformed.amount, 150, 'the comp amount survives the pipe');
    await pipeRejects(
      RecordManagerCompDto,
      { compType: 'vip_guest', managerName: 'Mona', amount: 150, isAdmin: true },
      'an extra admin flag must be rejected on record manager comp',
    );
    await pipeRejects(
      RecordManagerCompDto,
      { compType: 'vip_guest', managerName: 'Mona' },
      'a missing comp amount must be rejected on record manager comp',
    );
    await pipeRejects(
      RecordManagerCompDto,
      { compType: 'free_meal', managerName: 'Mona', amount: 150 },
      'an unknown comp type must be rejected on record manager comp',
    );
    console.log('  (11) RecordManagerCompDto: real caller payload passes, extra/missing/wrong-type rejected passed');
  }

  // 12. RecordTableRatingDto — caller: restaurant-advanced-fnb.api.ts
  // recordTableRating sends { tableNumber, saleId?, rating,
  // feedbackCategory?, notes? }.
  {
    const transformed = await pipeOk(RecordTableRatingDto, {
      tableNumber: 'T3',
      saleId: 77,
      rating: 5,
      feedbackCategory: 'food_quality',
      notes: 'great',
    });
    assert.equal(transformed.rating, 5, 'the rating survives the pipe');
    await pipeRejects(
      RecordTableRatingDto,
      { tableNumber: 'T3', rating: 5, isAdmin: true },
      'an extra admin flag must be rejected on record table rating',
    );
    await pipeRejects(
      RecordTableRatingDto,
      { rating: 5 },
      'a missing table number must be rejected on record table rating',
    );
    await pipeRejects(
      RecordTableRatingDto,
      { tableNumber: 'T3', rating: 0 },
      'a zero rating must be rejected on record table rating',
    );
    console.log('  (12) RecordTableRatingDto: real caller payload passes, extra/missing/zero rejected passed');
  }

  // 13. CreateDriveThruOrderDto — caller:
  // restaurant-advanced-fnb.api.ts createDriveThruOrder sends
  // { vehiclePlate, vehicleDesc?, totalAmount?, notes? }.
  {
    const transformed = await pipeOk(CreateDriveThruOrderDto, {
      vehiclePlate: 'ABC-1234',
      vehicleDesc: 'white sedan',
      totalAmount: 250,
      notes: 'window 2',
    });
    assert.equal(transformed.vehiclePlate, 'ABC-1234', 'the vehicle plate survives the pipe');
    await pipeRejects(
      CreateDriveThruOrderDto,
      { vehiclePlate: 'ABC-1234', isAdmin: true },
      'an extra admin flag must be rejected on create drive-thru order',
    );
    await pipeRejects(
      CreateDriveThruOrderDto,
      { vehicleDesc: 'white sedan' },
      'a missing plate must be rejected on create drive-thru order',
    );
    console.log('  (13) CreateDriveThruOrderDto: real caller payload passes, extra/missing rejected passed');
  }

  // 14. CreateUpsellRuleDto — caller: restaurant-advanced-fnb.api.ts
  // createUpsellRule sends { triggerProductId?, triggerCategoryName?,
  // suggestedProductId, suggestedProductName, title, discountAmount? }.
  {
    const transformed = await pipeOk(CreateUpsellRuleDto, {
      triggerProductId: 5,
      suggestedProductId: 9,
      suggestedProductName: 'Extra Cheese',
      title: 'Add cheese?',
      discountAmount: 10,
    });
    assert.equal(transformed.suggestedProductId, 9, 'the suggested product survives the pipe');
    await pipeRejects(
      CreateUpsellRuleDto,
      { suggestedProductId: 9, suggestedProductName: 'Extra Cheese', title: 'Add cheese?', isAdmin: true },
      'an extra admin flag must be rejected on create upsell rule',
    );
    await pipeRejects(
      CreateUpsellRuleDto,
      { suggestedProductName: 'Extra Cheese', title: 'Add cheese?' },
      'a missing suggested product must be rejected on create upsell rule',
    );
    console.log('  (14) CreateUpsellRuleDto: real caller payload passes, extra/missing rejected passed');
  }

  // 15. SaveTableLayoutsDto — caller: restaurant-advanced-fnb.api.ts
  // saveTableLayouts sends { layouts, branchId } where each layout
  // carries `is_active` — NOT in the controller type, so the DTO
  // accepts it.
  {
    const transformed = await pipeOk(SaveTableLayoutsDto, {
      layouts: [
        {
          table_number: 'T1',
          zone_code: 'main',
          shape: 'square',
          x_pos: 10,
          y_pos: 20,
          width: 80,
          height: 80,
          seats: 4,
          rotation: 0,
          is_active: true,
        },
      ],
      branchId: 1,
    });
    assert.equal(transformed.layouts![0].table_number, 'T1', 'the layout table number survives the pipe');
    assert.equal(transformed.layouts![0].is_active, true, 'the caller-sent is_active survives the pipe');
    const noLayouts = await pipeOk(SaveTableLayoutsDto, {});
    assert.equal(noLayouts.layouts, undefined, 'a body without layouts passes — the service returns []');
    await pipeRejects(
      SaveTableLayoutsDto,
      { layouts: [{ table_number: 'T1' }], isAdmin: true },
      'an extra admin flag must be rejected on save table layouts',
    );
    await pipeRejects(
      SaveTableLayoutsDto,
      { layouts: [{ table_number: 'T1', shape: 'triangle' }] },
      'an unknown layout shape must be rejected on save table layouts',
    );
    console.log('  (15) SaveTableLayoutsDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 16. RenameHeldDraftTableDto — caller:
  // restaurant-advanced-fnb.api.ts renameHeldDraftTable sends
  // { tableNumber }.
  {
    const transformed = await pipeOk(RenameHeldDraftTableDto, { tableNumber: 'T5' });
    assert.equal(transformed.tableNumber, 'T5', 'the table number survives the pipe');
    const empty = await pipeOk(RenameHeldDraftTableDto, {});
    assert.equal(empty.tableNumber, undefined, 'an empty body passes — the controller String()s a missing table');
    await pipeRejects(
      RenameHeldDraftTableDto,
      { tableNumber: 'T5', isAdmin: true },
      'an extra admin flag must be rejected on rename held draft table',
    );
    console.log('  (16) RenameHeldDraftTableDto: real caller payload passes, extra rejected passed');
  }

  // 17. CreateFoodWasteLogDto — caller: restaurant-food-waste.api.ts
  // logWaste sends { branchId, productId, quantity, reason, notes? }.
  {
    const transformed = await pipeOk(CreateFoodWasteLogDto, {
      branchId: 1,
      productId: 5,
      quantity: 2.5,
      reason: 'spoilage',
      notes: 'expired milk',
    });
    assert.equal(transformed.reason, 'spoilage', 'the waste reason survives the pipe');
    assert.equal(transformed.quantity, 2.5, 'the waste quantity survives the pipe');
    await pipeRejects(
      CreateFoodWasteLogDto,
      { branchId: 1, productId: 5, quantity: 2.5, reason: 'spoilage', isAdmin: true },
      'an extra admin flag must be rejected on log food waste',
    );
    await pipeRejects(
      CreateFoodWasteLogDto,
      { branchId: 1, productId: 5, quantity: 0, reason: 'spoilage' },
      'a zero quantity must be rejected on log food waste',
    );
    await pipeRejects(
      CreateFoodWasteLogDto,
      { branchId: 1, productId: 5, quantity: 2.5, reason: 'burned' },
      'an unknown waste reason must be rejected on log food waste',
    );
    console.log('  (17) CreateFoodWasteLogDto: real caller payload passes, extra/zero/wrong-type rejected passed');
  }

  // Source pins: every orders-area controller takes the DTO class now.
  {
    const read = (rel: string): string => readFileSync(resolve(__dirname, '../../src/modules/sales', rel), 'utf8');
    const orders = read('controllers/sales-orders.controller.ts');
    const installments = read('controllers/customer-installments.controller.ts');
    const quotations = read('controllers/quotations.controller.ts');
    const aggregators = read('controllers/delivery-aggregators.controller.ts');
    const fnb = read('controllers/restaurant-advanced-fnb.controller.ts');
    const waste = read('controllers/restaurant-food-waste.controller.ts');
    assert.ok(orders.includes('CreateSalesOrderDto'), 'the sales-orders controller takes CreateSalesOrderDto');
    for (const name of ['CreateInstallmentPlanDto', 'PayInstallmentDto']) {
      assert.ok(installments.includes(name), `the installments controller takes ${name}`);
    }
    assert.ok(quotations.includes('UpdateQuotationDto'), 'the quotations controller takes UpdateQuotationDto');
    for (const name of ['UpdateAggregatorChannelDto', 'IngestOrderDto']) {
      assert.ok(aggregators.includes(name), `the aggregators controller takes ${name}`);
    }
    for (const name of [
      'Toggle86ItemDto',
      'CalculateTipPoolDto',
      'SaveTableZoneDto',
      'GeneratePrepSheetDto',
      'RecordManagerCompDto',
      'RecordTableRatingDto',
      'CreateDriveThruOrderDto',
      'CreateUpsellRuleDto',
      'SaveTableLayoutsDto',
      'RenameHeldDraftTableDto',
    ]) {
      assert.ok(fnb.includes(name), `the restaurant controller takes ${name}`);
    }
    assert.ok(waste.includes('CreateFoodWasteLogDto'), 'the food-waste controller takes CreateFoodWasteLogDto');
    for (const [label, src] of [
      ['sales-orders', orders],
      ['installments', installments],
      ['quotations', quotations],
      ['aggregators', aggregators],
      ['restaurant', fnb],
      ['food-waste', waste],
    ] as const) {
      assert.ok(!src.includes('body: any'), `no ${label} route takes any anymore`);
    }
    console.log('  source pins passed');
  }

  console.log('DTO sales orders tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
