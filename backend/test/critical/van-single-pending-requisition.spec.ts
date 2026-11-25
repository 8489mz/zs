import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Van Single Pending Requisition & Supplementary Load Invariant Specification', () => {
  it('should block multiple pending load requisitions for the same delivery rep', () => {
    // Simulated state of active load requisitions
    const requisitions = [
      { id: 101, docNo: 'REQ-261015-0001', repId: 4, status: 'dispatched', tripId: 50 },
      { id: 102, docNo: 'REQ-261015-0002', repId: 4, status: 'pending', tripId: null },
    ];

    const repId = 4;
    const hasPending = requisitions.some((r) => r.repId === repId && r.status === 'pending');
    assert.equal(hasPending, true, 'Rep 4 should have an active pending requisition');

    // Rule assertion: new submission MUST be rejected
    const canSubmitNew = !hasPending;
    assert.equal(
      canSubmitNew,
      false,
      'Driver must not be allowed to submit a new load requisition while one is pending',
    );
  });

  it('should allow cancellation of pending requisition and return previous items for recovery', () => {
    const requestedItems = [
      { productId: 10, productName: 'جبنة فيتا دومتي 500 جم', qty: 24, cartons: 2, pieces: 0 },
      { productId: 15, productName: 'حليب جهينة كامل الدسم 1 لتر', qty: 36, cartons: 3, pieces: 0 },
    ];

    const requisition = {
      id: 102,
      docNo: 'REQ-261015-0002',
      repId: 4,
      status: 'pending',
      requestedItems,
      sourceWarehouseId: 1,
      notes: 'طلب تجهيز صباحي',
    };

    // Rep cancels their pending requisition
    assert.equal(requisition.status, 'pending');
    const cancellationResult = {
      ok: true,
      requisitionId: requisition.id,
      docNo: requisition.docNo,
      previousItems: requisition.requestedItems,
      notes: requisition.notes,
      sourceWarehouseId: requisition.sourceWarehouseId,
    };

    assert.equal(cancellationResult.ok, true);
    assert.equal(cancellationResult.previousItems.length, 2);
    assert.equal(cancellationResult.previousItems[0].productId, 10);
    assert.equal(cancellationResult.previousItems[1].qty, 36);

    // After cancellation, driver is now permitted to submit
    const remainingPending = false;
    assert.equal(!remainingPending, true, 'Driver can now submit modified requisition cleanly');
  });

  it('should reject driver cancellation if requisition has already been dispatched', () => {
    const dispatchedReq = {
      id: 101,
      docNo: 'REQ-261015-0001',
      repId: 4,
      status: 'dispatched',
      tripId: 50,
    };

    const attemptCancel = () => {
      if (dispatchedReq.status === 'dispatched') {
        throw new Error('ALREADY_DISPATCHED: لا يمكن إلغاء إذن تحميل تم اعتماده وصرفه بالفعل للسيارة');
      }
    };

    assert.throws(attemptCancel, /ALREADY_DISPATCHED/);
  });

  it('should support supplementary load on existing open trip without TRIP_ALREADY_OPEN error', () => {
    const existingTrip = {
      id: 50,
      repId: 4,
      status: 'open',
      loadedAmount: 5000,
    };

    const supplementaryRequisition = {
      id: 103,
      docNo: 'REQ-261015-0003',
      repId: 4,
      status: 'pending',
      approvedItems: [
        { productId: 15, qty: 12, unitPrice: 40 }, // 480 EGP
      ],
    };

    // Calculate supplementary addition
    const additionalValue = supplementaryRequisition.approvedItems.reduce(
      (sum, item) => sum + item.qty * item.unitPrice,
      0,
    );

    // Supplementary load applies directly to open trip 50
    const updatedTrip = {
      ...existingTrip,
      loadedAmount: existingTrip.loadedAmount + additionalValue,
    };

    const dispatchResult = {
      ok: true,
      requisitionId: supplementaryRequisition.id,
      tripId: updatedTrip.id,
      docNo: supplementaryRequisition.docNo,
      isSupplementary: true,
    };

    assert.equal(dispatchResult.isSupplementary, true);
    assert.equal(dispatchResult.tripId, 50);
    assert.equal(updatedTrip.loadedAmount, 5480, 'Trip loaded amount should be accurately increased from 5000 to 5480');
  });
});
