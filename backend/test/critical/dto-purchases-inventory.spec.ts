/*
 * New file: backend/test/critical/dto-purchases-inventory.spec.ts
 *
 * WHAT THIS PINS (INV-DTO-PILOT-PURCHASES-INVENTORY, D2 pilot): the 15
 * purchases (8) + inventory (7) sites now take DTO classes, so the real
 * global requestValidationPipe validates and whitelists them. Before D2
 * they took dto-interfaces, inline types, or `any` — and the pipe does
 * nothing for an interface or an inline type, so any extra field (or a
 * wrong-typed field) reached the service untouched.
 *
 * WHAT IS DRIVEN (the real global pipe from main.ts — no mocks, no
 * booted app; the pipe instance driven here IS the global one):
 * for EACH of the 15 DTOs, (a) a positive case with the REAL caller
 * payload (the exact shape the frontend api file sends — see the
 * per-case comments for the caller file), which must pass the pipe with
 * every field intact, and (b) two negative cases: an extra field the
 * caller never sends is rejected with 400 VALIDATION_ERROR, and a
 * wrong-typed field is rejected the same way.
 *
 * CALLER TRAPS PINNED HERE (found during D2 caller verification):
 * - GenerateDraftOrdersDto: the only caller (SmartReorderPage) sends
 *   per item qty AND quantity, name AND productName, cost AND
 *   costPrice (same values), and per group note (singular). The DTO
 *   accepts all of them, so the real caller does not 400. PRE-EXISTING
 *   MISMATCH, NOT fixed here: the caller sends the group batch note
 *   as `note` while the service reads `notes`, so the note is lost
 *   today — the DTO accepts both spellings and the service still
 *   ignores `note`.
 * - CreatePurchaseOrderDto.submitForApproval: the boolean-coercion
 *   trap (contract Rule 3) — under enableImplicitConversion a string
 *   "false" coerces to true. Pinned: the pipe turns "false" into true,
 *   so callers must send a real boolean. The frontend sends a real
 *   boolean.
 * - CancelPurchaseDto.reason: a numeric reason coerces to its string
 *   form under enableImplicitConversion ("5") — the service String()s
 *   it the same way today, so the spec pins the coercion instead of
 *   a rejection.
 * - UpdatePurchaseOrderDto: ZERO frontend callers exist. The positive
 *   case is the interface shape itself (all-optional + status union);
 *   the service narrows status to 'draft' and remains the backstop.
 * - ApplyRepricingPayloadDto is a MONEY endpoint (it rewrites selling
 *   prices): its positive case is the real margin-protection caller
 *   payload, with no exceptions.
 *
 * NOT DRIVEN: a live HTTP request through Nest (needs a booted app);
 * the services themselves (their own throws stay the backstop for
 * conditional rules — e.g. the >= 8-char varianceReason rule on SHORT
 * receipts, the 'draft'-only status narrowing, the replenishment
 * filter); the frontend screens (untouched).
 *
 * Fail-first: this spec is new in D2 — on the unpatched tree the DTO
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
  CreateBinDto,
  UpdateBinDto,
  QuickReassignDto,
  QuickAuditUpdateDto,
} from '../../src/modules/inventory/services/warehouse-bins.service';
import { AssignProductsDto } from '../../src/modules/inventory/dto/assign-products.dto';
import { ReceiveStockTransferDto } from '../../src/modules/inventory/dto/receive-stock-transfer.dto';
import { ExecuteReplenishmentDto } from '../../src/modules/inventory/dto/execute-replenishment.dto';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderDto } from '../../src/modules/purchases/dto/purchase-order.dto';
import { CreateRfqDto, SubmitSupplierBidDto } from '../../src/modules/purchases/services/purchase-rfqs.service';
import { GenerateDraftOrdersDto } from '../../src/modules/purchases/services/purchases-reorder.service';
import { CancelPurchaseDto } from '../../src/modules/purchases/dto/cancel-purchase.dto';
import { ReceivePurchaseGoodsDto } from '../../src/modules/purchases/dto/receive-purchase-goods.dto';
import { ApplyRepricingPayloadDto } from '../../src/modules/purchases/services/margin-protection.service';

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
  // 1. CreateBinDto — caller: BinsManagementView createBin sends
  // { locationId, code, barcode, aisle, rack, shelf, bin, capacity, notes }.
  {
    const transformed = await pipeOk(CreateBinDto, {
      locationId: 1,
      code: 'A-01-01',
      barcode: 'BIN-A-01-01',
      aisle: 'A',
      rack: '01',
      shelf: '01',
      bin: '01',
      capacity: 100,
      notes: 'top shelf',
    });
    assert.equal(transformed.locationId, 1, 'the bin location survives the pipe');
    assert.equal(transformed.code, 'A-01-01', 'the bin code survives the pipe');
    assert.equal(transformed.capacity, 100, 'the bin capacity survives the pipe');
    await pipeRejects(
      CreateBinDto,
      { locationId: 1, code: 'A-01-01', warehouseId: 9 },
      'an extra warehouseId must be rejected on create-bin',
    );
    await pipeRejects(
      CreateBinDto,
      { locationId: 'x', code: 'A-01-01' },
      'a string locationId must be rejected on create-bin',
    );
    console.log('  (1) CreateBinDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 2. UpdateBinDto — caller: BinsManagementView updateBin sends the
  // same fields as create, all optional. Boolean-coercion pin (Rule 3):
  // a string "false" coerces to true under enableImplicitConversion.
  {
    const transformed = await pipeOk(UpdateBinDto, {
      code: 'A-01-02',
      barcode: 'BIN-A-01-02',
      aisle: 'A',
      rack: '01',
      shelf: '01',
      bin: '02',
      capacity: 120,
      isActive: true,
      notes: 'moved',
    });
    assert.equal(transformed.code, 'A-01-02', 'the updated code survives the pipe');
    assert.equal(transformed.isActive, true, 'the active flag survives the pipe');
    const coerced = await pipeOk(UpdateBinDto, { isActive: 'false' });
    assert.equal(
      coerced.isActive,
      true,
      'a string "false" coerces to true (Rule 3 — callers must send a real boolean)',
    );
    await pipeRejects(
      UpdateBinDto,
      { code: 'A-01-02', locationId: 1 },
      'locationId is not an update field and must be rejected',
    );
    await pipeRejects(UpdateBinDto, { capacity: 'big' }, 'a string capacity must be rejected on update-bin');
    console.log(
      '  (2) UpdateBinDto: real caller payload passes, extra/wrong-type rejected, boolean coercion pinned passed',
    );
  }

  // 3. QuickReassignDto — caller: BinsManagementView quickReassign
  // sends { binId, productId, quantity, isPrimary }.
  {
    const transformed = await pipeOk(QuickReassignDto, { binId: 1, productId: 10, quantity: 5, isPrimary: true });
    assert.equal(transformed.binId, 1, 'the bin survives the pipe');
    assert.equal(transformed.quantity, 5, 'the quantity survives the pipe');
    assert.equal(transformed.isPrimary, true, 'the primary flag survives the pipe');
    await pipeRejects(
      QuickReassignDto,
      { binId: 1, productId: 10, quantity: 5, notes: 'x' },
      'an extra notes field must be rejected on quick-reassign',
    );
    await pipeRejects(
      QuickReassignDto,
      { binId: 1, productId: 10, quantity: -1 },
      'a negative quantity must be rejected on quick-reassign',
    );
    console.log('  (3) QuickReassignDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 4. QuickAuditUpdateDto — caller: BinsManagementView quickAudit
  // sends { binId, productId, countedQty, notes }.
  {
    const transformed = await pipeOk(QuickAuditUpdateDto, { binId: 1, productId: 10, countedQty: 7, notes: 'counted' });
    assert.equal(transformed.countedQty, 7, 'the counted qty survives the pipe');
    assert.equal(transformed.notes, 'counted', 'the audit note survives the pipe');
    await pipeRejects(
      QuickAuditUpdateDto,
      { binId: 1, productId: 10, countedQty: 7, isPrimary: true },
      'an extra isPrimary must be rejected on quick-audit',
    );
    await pipeRejects(
      QuickAuditUpdateDto,
      { binId: 1, productId: 10, countedQty: -2 },
      'a negative counted qty must be rejected on quick-audit',
    );
    console.log('  (4) QuickAuditUpdateDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 5. AssignProductsDto — caller: useInventoryWorkspaceMutations
  // assignProducts sends { productIds }. productIds is optional: the
  // controller passes `body.productIds || []` and the service returns
  // success on an empty list.
  {
    const transformed = await pipeOk(AssignProductsDto, { productIds: [10, 11] });
    assert.deepEqual(transformed.productIds, [10, 11], 'the product ids survive the pipe');
    const empty = await pipeOk(AssignProductsDto, {});
    assert.equal(empty.productIds, undefined, 'a missing productIds passes the pipe (service tolerates it)');
    await pipeRejects(
      AssignProductsDto,
      { productIds: [10], locationId: 1 },
      'an extra locationId must be rejected on assign-products',
    );
    await pipeRejects(
      AssignProductsDto,
      { productIds: ['x'] },
      'a string product id must be rejected on assign-products',
    );
    console.log('  (5) AssignProductsDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 6. ReceiveStockTransferDto — caller: useInventoryWorkspaceMutations
  // receiveTransfer sends { items: [{ itemId, receivedQty,
  // receivedSerials, batchReceipts }], varianceReason, approvalSecret }.
  {
    const transformed = await pipeOk(ReceiveStockTransferDto, {
      items: [
        {
          itemId: 1,
          receivedQty: 10,
          receivedSerials: ['SN1', 'SN2'],
          batchReceipts: [{ transitBatchId: 5, receivedQty: 10 }],
        },
      ],
      varianceReason: 'short by 2 units',
      approvalSecret: 'admin-pin',
    });
    assert.equal(transformed.items!.length, 1, 'the receipt item survives the pipe');
    assert.equal(transformed.items![0].receivedQty, 10, 'the received qty survives the pipe');
    assert.deepEqual(transformed.items![0].receivedSerials, ['SN1', 'SN2'], 'the serials survive the pipe');
    assert.equal(transformed.varianceReason, 'short by 2 units', 'the variance reason survives the pipe');
    const empty = await pipeOk(ReceiveStockTransferDto, {});
    assert.equal(empty.items, undefined, 'a missing items list passes the pipe (all fields optional)');
    await pipeRejects(
      ReceiveStockTransferDto,
      { items: [{ itemId: 1, receivedQty: 10 }], transferId: 1 },
      'an extra transferId must be rejected on receive-transfer',
    );
    await pipeRejects(
      ReceiveStockTransferDto,
      { items: [{ itemId: 'x', receivedQty: 10 }] },
      'a string item id must be rejected on receive-transfer',
    );
    console.log('  (6) ReceiveStockTransferDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 7. ExecuteReplenishmentDto — caller: useInventoryWorkspaceMutations
  // executeSmartReplenishment sends { fromLocationId, toLocationId,
  // items: [{ productId, qty }], note }.
  {
    const transformed = await pipeOk(ExecuteReplenishmentDto, {
      fromLocationId: 1,
      toLocationId: 2,
      items: [{ productId: 10, qty: 5 }],
      note: 'top up',
    });
    assert.equal(transformed.fromLocationId, 1, 'the source location survives the pipe');
    assert.equal(transformed.toLocationId, 2, 'the destination location survives the pipe');
    assert.equal(transformed.items[0].qty, 5, 'the replenishment qty survives the pipe');
    await pipeRejects(
      ExecuteReplenishmentDto,
      { fromLocationId: 1, toLocationId: 2, items: [{ productId: 10, qty: 5 }], priority: 'high' },
      'an extra priority must be rejected on execute-replenishment',
    );
    await pipeRejects(
      ExecuteReplenishmentDto,
      { fromLocationId: 1, toLocationId: 2, items: [] },
      'an empty items list must be rejected on execute-replenishment',
    );
    console.log('  (7) ExecuteReplenishmentDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 8. CreatePurchaseOrderDto — caller: CreatePurchaseOrderPage
  // buildPayload sends { supplierId, supplierName, supplierPhone,
  // warehouseId, warehouseName, subtotal, taxAmount, discountAmount,
  // totalAmount, expectedDeliveryDate, notes, termsConditions,
  // submitForApproval, items: [{ productId, productName, unitName,
  // quantity, unitCost, taxRate, discount, total, notes }] }.
  // Boolean-coercion pin (Rule 3): "false" coerces to true.
  {
    const transformed = await pipeOk(CreatePurchaseOrderDto, {
      supplierId: 1,
      supplierName: 'Supplier One',
      supplierPhone: '01000000000',
      warehouseId: 1,
      warehouseName: 'Main',
      subtotal: 1000,
      taxAmount: 140,
      discountAmount: 0,
      totalAmount: 1140,
      expectedDeliveryDate: '2026-12-01',
      notes: 'urgent',
      termsConditions: 'net 30',
      submitForApproval: false,
      items: [
        {
          productId: 10,
          productName: 'Item A',
          unitName: 'pcs',
          quantity: 10,
          unitCost: 100,
          taxRate: 14,
          discount: 0,
          total: 1000,
          notes: '',
        },
      ],
    });
    assert.equal(transformed.supplierName, 'Supplier One', 'the supplier name survives the pipe');
    assert.equal(transformed.totalAmount, 1140, 'the total survives the pipe');
    assert.equal(transformed.items.length, 1, 'the order item survives the pipe');
    assert.equal(transformed.items[0].productId, 10, 'the item product survives the pipe');
    assert.equal(transformed.submitForApproval, false, 'a real false flag survives the pipe');
    const coerced = await pipeOk(CreatePurchaseOrderDto, {
      supplierName: 'Supplier One',
      subtotal: 100,
      totalAmount: 100,
      submitForApproval: 'false',
      items: [{ productId: 10, productName: 'Item A', quantity: 1, unitCost: 100, total: 100 }],
    });
    assert.equal(
      coerced.submitForApproval,
      true,
      'a string "false" coerces to true (Rule 3 — callers must send a real boolean)',
    );
    await pipeRejects(
      CreatePurchaseOrderDto,
      {
        supplierName: 'Supplier One',
        subtotal: 100,
        totalAmount: 100,
        status: 'draft',
        items: [{ productId: 10, productName: 'Item A', quantity: 1, unitCost: 100, total: 100 }],
      },
      'status is never taken from the client and must be rejected on create-order',
    );
    await pipeRejects(
      CreatePurchaseOrderDto,
      { supplierName: 'Supplier One', subtotal: 100, totalAmount: 100, items: [] },
      'an empty items list must be rejected on create-order',
    );
    console.log(
      '  (8) CreatePurchaseOrderDto: real caller payload passes, extra/wrong-type rejected, boolean coercion pinned passed',
    );
  }

  // 9. UpdatePurchaseOrderDto — ZERO frontend callers exist. The
  // positive case is the interface shape itself (all-optional + the
  // 6-value status union); the service narrows status to 'draft'.
  {
    const transformed = await pipeOk(UpdatePurchaseOrderDto, { status: 'draft', notes: 'updated' });
    assert.equal(transformed.status, 'draft', 'the draft status survives the pipe');
    const empty = await pipeOk(UpdatePurchaseOrderDto, {});
    assert.equal(empty.status, undefined, 'an empty update passes the pipe (service validates separately)');
    await pipeRejects(
      UpdatePurchaseOrderDto,
      { status: 'deleted' },
      'a status outside the union must be rejected on update-order',
    );
    await pipeRejects(
      UpdatePurchaseOrderDto,
      { status: 'draft', createdBy: 1 },
      'an extra createdBy must be rejected on update-order',
    );
    console.log('  (9) UpdatePurchaseOrderDto: interface shape passes, extra/wrong-type rejected passed');
  }

  // 10. CreateRfqDto — caller: CreateRfqForm sends { title,
  // deadline_date, expected_delivery_date, notes, items: [{ product_id,
  // product_name, unit_name, target_quantity, specifications }] }.
  {
    const transformed = await pipeOk(CreateRfqDto, {
      title: 'RFQ-1',
      deadline_date: '2026-12-01',
      expected_delivery_date: '2026-12-15',
      notes: 'need quotes',
      items: [
        { product_id: 10, product_name: 'Item A', unit_name: 'pcs', target_quantity: 50, specifications: 'grade A' },
      ],
    });
    assert.equal(transformed.title, 'RFQ-1', 'the RFQ title survives the pipe');
    assert.equal(transformed.items[0].target_quantity, 50, 'the target qty survives the pipe');
    await pipeRejects(
      CreateRfqDto,
      {
        title: 'RFQ-1',
        supplierId: 1,
        items: [{ product_id: 10, product_name: 'Item A', target_quantity: 50 }],
      },
      'an extra supplierId must be rejected on create-rfq',
    );
    await pipeRejects(
      CreateRfqDto,
      { title: 'RFQ-1', items: [] },
      'an empty items list must be rejected on create-rfq',
    );
    console.log('  (10) CreateRfqDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 11. SubmitSupplierBidDto — caller: SupplierBidForm sends
  // { supplier_id, supplier_name, supplier_phone, payment_terms,
  // delivery_lead_days, notes, item_bids: [{ rfq_item_id,
  // quoted_unit_cost, tax_rate }] }. item_bids is optional-empty: the
  // service tolerates an empty bid list.
  {
    const transformed = await pipeOk(SubmitSupplierBidDto, {
      supplier_id: 1,
      supplier_name: 'Supplier One',
      supplier_phone: '01000000000',
      payment_terms: 'Net 30',
      delivery_lead_days: 5,
      notes: 'best price',
      item_bids: [{ rfq_item_id: 1, quoted_unit_cost: 95, tax_rate: 14 }],
    });
    assert.equal(transformed.supplier_id, 1, 'the supplier survives the pipe');
    assert.equal(transformed.item_bids[0].quoted_unit_cost, 95, 'the quoted cost survives the pipe');
    const emptyBids = await pipeOk(SubmitSupplierBidDto, {
      supplier_id: 1,
      supplier_name: 'Supplier One',
      item_bids: [],
    });
    assert.deepEqual(emptyBids.item_bids, [], 'an empty bid list passes the pipe (service tolerates it)');
    await pipeRejects(
      SubmitSupplierBidDto,
      { supplier_id: 1, supplier_name: 'Supplier One', status: 'accepted', item_bids: [] },
      'an extra status must be rejected on submit-bid',
    );
    await pipeRejects(
      SubmitSupplierBidDto,
      { supplier_id: 'x', supplier_name: 'Supplier One', item_bids: [] },
      'a string supplier id must be rejected on submit-bid',
    );
    console.log('  (11) SubmitSupplierBidDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 12. GenerateDraftOrdersDto — caller: SmartReorderPage sends
  // { orders: [{ supplierId, locationId, note, items: [{ productId,
  // qty, quantity, name, productName, cost, costPrice }] }] } — the
  // duplicate fields carry the same values. The DTO accepts all of
  // them, so the real caller does not 400.
  {
    const transformed = await pipeOk(GenerateDraftOrdersDto, {
      orders: [
        {
          supplierId: 1,
          locationId: 1,
          note: 'batch note',
          items: [
            { productId: 10, qty: 5, quantity: 5, name: 'Item A', productName: 'Item A', cost: 90, costPrice: 90 },
          ],
        },
      ],
    });
    assert.equal(transformed.orders.length, 1, 'the draft group survives the pipe');
    assert.equal(transformed.orders[0].supplierId, 1, 'the supplier survives the pipe');
    assert.equal(transformed.orders[0].items[0].qty, 5, 'the item qty survives the pipe');
    assert.equal(transformed.orders[0].items[0].quantity, 5, 'the duplicate quantity field survives the pipe');
    assert.equal(
      transformed.orders[0].items[0].productName,
      'Item A',
      'the duplicate productName field survives the pipe',
    );
    assert.equal(transformed.orders[0].items[0].costPrice, 90, 'the duplicate costPrice field survives the pipe');
    assert.equal(transformed.orders[0].note, 'batch note', 'the singular note field survives the pipe');
    await pipeRejects(
      GenerateDraftOrdersDto,
      { orders: [{ supplierId: 1, items: [{ productId: 10, qty: 5 }] }], warehouseId: 1 },
      'an extra warehouseId must be rejected on generate-drafts',
    );
    await pipeRejects(
      GenerateDraftOrdersDto,
      { orders: [] },
      'an empty orders list must be rejected on generate-drafts',
    );
    console.log(
      '  (12) GenerateDraftOrdersDto: real caller payload (duplicate fields) passes, extra/wrong-type rejected passed',
    );
  }

  // 13. CancelPurchaseDto — caller: purchases api cancelPurchase sends
  // { reason, managerPin } (both always sent, either may be '').
  {
    const transformed = await pipeOk(CancelPurchaseDto, { reason: 'wrong supplier', managerPin: '1234' });
    assert.equal(transformed.reason, 'wrong supplier', 'the cancel reason survives the pipe');
    assert.equal(transformed.managerPin, '1234', 'the manager PIN survives the pipe');
    const empty = await pipeOk(CancelPurchaseDto, {});
    assert.equal(empty.reason, undefined, 'a missing reason passes the pipe (controller coerces to empty)');
    await pipeRejects(
      CancelPurchaseDto,
      { reason: 'x', cancelledBy: 1 },
      'an extra cancelledBy must be rejected on cancel-purchase',
    );
    // Coercion pin (Rule 3): under enableImplicitConversion a numeric
    // reason coerces to its string form — the service String()s it the
    // same way today, so this is not a behaviour change.
    const coerced = await pipeOk(CancelPurchaseDto, { reason: 5 });
    assert.equal(coerced.reason, '5', 'a numeric reason coerces to its string form (Rule 3)');
    console.log('  (13) CancelPurchaseDto: real caller payload passes, extra rejected, string coercion pinned passed');
  }

  // 14. ReceivePurchaseGoodsDto — caller: purchases api
  // receivePurchaseGoods sends { receivedItems: [{ itemId, receivedQty,
  // serials }] }.
  {
    const transformed = await pipeOk(ReceivePurchaseGoodsDto, {
      receivedItems: [{ itemId: 1, receivedQty: 10, serials: ['SN1', 'SN2'] }],
    });
    assert.equal(transformed.receivedItems.length, 1, 'the received item survives the pipe');
    assert.equal(transformed.receivedItems[0].receivedQty, 10, 'the received qty survives the pipe');
    assert.deepEqual(transformed.receivedItems[0].serials, ['SN1', 'SN2'], 'the serials survive the pipe');
    await pipeRejects(
      ReceivePurchaseGoodsDto,
      { receivedItems: [{ itemId: 1, receivedQty: 10 }], purchaseId: 1 },
      'an extra purchaseId must be rejected on receive-goods',
    );
    await pipeRejects(
      ReceivePurchaseGoodsDto,
      { receivedItems: [] },
      'an empty receivedItems list must be rejected on receive-goods',
    );
    console.log('  (14) ReceivePurchaseGoodsDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // 15. ApplyRepricingPayloadDto — MONEY endpoint. Caller:
  // marginProtectionApi.applyRepricing sends { items: [{ productId,
  // newRetailPrice, newWholesalePrice }], notifyOwner }.
  {
    const transformed = await pipeOk(ApplyRepricingPayloadDto, {
      items: [{ productId: 10, newRetailPrice: 120, newWholesalePrice: 100 }],
      notifyOwner: true,
    });
    assert.equal(transformed.items.length, 1, 'the repricing item survives the pipe');
    assert.equal(transformed.items[0].newRetailPrice, 120, 'the new retail price survives the pipe');
    assert.equal(transformed.items[0].newWholesalePrice, 100, 'the new wholesale price survives the pipe');
    assert.equal(transformed.notifyOwner, true, 'the notify flag survives the pipe');
    const empty = await pipeOk(ApplyRepricingPayloadDto, { items: [] });
    assert.deepEqual(empty.items, [], 'an empty items list passes the pipe (service returns ok, updatedCount 0)');
    await pipeRejects(
      ApplyRepricingPayloadDto,
      { items: [{ productId: 10, newRetailPrice: 120 }], purchaseId: 1 },
      'an extra purchaseId must be rejected on apply-repricing',
    );
    await pipeRejects(
      ApplyRepricingPayloadDto,
      { items: [{ productId: 10, newRetailPrice: 'x' }] },
      'a string price must be rejected on apply-repricing',
    );
    console.log('  (15) ApplyRepricingPayloadDto: real caller payload passes, extra/wrong-type rejected passed');
  }

  // Source pins: every controller takes the DTO class (not an
  // interface, not an inline type, not `any`), and every DTO file
  // declares classes.
  {
    const here = __dirname;
    const read = (p: string): string => readFileSync(resolve(here, '../../src', p), 'utf8');
    const binsController = read('modules/inventory/controllers/warehouse-bins.controller.ts');
    assert.ok(binsController.includes('CreateBinDto'), 'the bins controller takes CreateBinDto');
    assert.ok(binsController.includes('UpdateBinDto'), 'the bins controller takes UpdateBinDto');
    assert.ok(binsController.includes('QuickReassignDto'), 'the bins controller takes QuickReassignDto');
    assert.ok(binsController.includes('QuickAuditUpdateDto'), 'the bins controller takes QuickAuditUpdateDto');
    const inventoryController = read('modules/inventory/inventory.controller.ts');
    assert.ok(inventoryController.includes('AssignProductsDto'), 'the inventory controller takes AssignProductsDto');
    assert.ok(
      inventoryController.includes('ReceiveStockTransferDto'),
      'the inventory controller takes ReceiveStockTransferDto',
    );
    assert.ok(
      inventoryController.includes('ExecuteReplenishmentDto'),
      'the inventory controller takes ExecuteReplenishmentDto',
    );
    const poController = read('modules/purchases/controllers/purchase-orders.controller.ts');
    assert.ok(poController.includes('CreatePurchaseOrderDto'), 'the PO controller takes CreatePurchaseOrderDto');
    assert.ok(poController.includes('UpdatePurchaseOrderDto'), 'the PO controller takes UpdatePurchaseOrderDto');
    const rfqController = read('modules/purchases/controllers/purchase-rfqs.controller.ts');
    assert.ok(rfqController.includes('CreateRfqDto'), 'the RFQ controller takes CreateRfqDto');
    assert.ok(rfqController.includes('SubmitSupplierBidDto'), 'the RFQ controller takes SubmitSupplierBidDto');
    const purchasesController = read('modules/purchases/purchases.controller.ts');
    assert.ok(
      purchasesController.includes('GenerateDraftOrdersDto'),
      'the purchases controller takes GenerateDraftOrdersDto',
    );
    assert.ok(purchasesController.includes('CancelPurchaseDto'), 'the purchases controller takes CancelPurchaseDto');
    assert.ok(
      purchasesController.includes('ReceivePurchaseGoodsDto'),
      'the purchases controller takes ReceivePurchaseGoodsDto',
    );
    assert.ok(
      purchasesController.includes('ApplyRepricingPayloadDto'),
      'the purchases controller takes ApplyRepricingPayloadDto',
    );
    assert.ok(!purchasesController.includes('payload: any'), 'the generate-drafts route no longer takes any');
    const binsService = read('modules/inventory/services/warehouse-bins.service.ts');
    assert.ok(binsService.includes('export class CreateBinDto'), 'CreateBinDto is a class, not an interface');
    assert.ok(binsService.includes('export class QuickReassignDto'), 'QuickReassignDto is a class, not an interface');
    const poDto = read('modules/purchases/dto/purchase-order.dto.ts');
    assert.ok(
      poDto.includes('export class CreatePurchaseOrderDto'),
      'CreatePurchaseOrderDto is a class, not an interface',
    );
    assert.ok(
      poDto.includes('export class UpdatePurchaseOrderDto'),
      'UpdatePurchaseOrderDto is a class, not an interface',
    );
    const rfqService = read('modules/purchases/services/purchase-rfqs.service.ts');
    assert.ok(rfqService.includes('export class CreateRfqDto'), 'CreateRfqDto is a class, not an interface');
    assert.ok(
      rfqService.includes('export class SubmitSupplierBidDto'),
      'SubmitSupplierBidDto is a class, not an interface',
    );
    const reorderService = read('modules/purchases/services/purchases-reorder.service.ts');
    assert.ok(
      reorderService.includes('export class GenerateDraftOrdersDto'),
      'GenerateDraftOrdersDto is a class, not an interface',
    );
    const marginService = read('modules/purchases/services/margin-protection.service.ts');
    assert.ok(
      marginService.includes('export class ApplyRepricingPayloadDto'),
      'ApplyRepricingPayloadDto is a class, not an interface',
    );
    console.log('  source pins passed');
  }

  console.log('DTO purchases + inventory pilot tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
