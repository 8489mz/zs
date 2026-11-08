import { strict as assert } from 'node:assert';
import { computeThreeWayMatch } from '../../src/modules/purchases/three-way-match.engine';
import { validateMakerCheckerOverride } from '../../src/modules/maritime-freight/engines/freight-audit.engine';
import { evaluateTripExpenseGovernance } from '../../src/modules/delivery-reps/van-trip-reconciliation.engine';
import { assertDamagedStockNote } from '../../src/modules/inventory/helpers/inventory-count-write.helper';
import { allocateRefundTenders } from '../../src/modules/returns/engines/refund-tender.engine';

/*
New file: backend/test/critical/reason-length-minima.spec.ts
Pins the spirit-of-law reason-length rule (INV-SPIRIT-REASON-LENGTHS):
every reason/note minimum in the system is reduced to non-empty
(trimmed length >= 1). A single clear word is accepted and recorded
as-is; role and approval gates are unchanged. This spec drives the
pure gates directly; the service-level gates (sale/purchase edit
reasons, goods-receipt and duplicate-bill overrides, import
reversal reasons, demurrage-reduction reason) share the same
one-line change and are covered by their existing specs with the
old minima updated.

WHAT THIS PINS, driving the REAL engines/helpers:
- three-way-match override: a one-word reason approves the override
  (full scope); an empty reason does not.
- freight maker-checker override: a one-word rationale is valid for
  a finance manager; an empty rationale is invalid; a cashier role
  stays invalid even with a reason (role gate unchanged).
- trip expense governance: a one-word note allows a routine petty
  expense; empty notes are rejected.
- damage note: a one-word note passes; blank fails.
- refund-tender override: a one-word reason allows the override;
  empty fails (the long-reason case stays covered by
  sales-return-cost.spec.ts).
*/

console.log('=== reason-length minima (spirit-of-law Q8) ===\n');

// Three-way-match override: one word approves, empty does not.
const poItems = [{ id: 1, productId: 100, qty: 100, unitCost: 10 }];
const grnLines = [{ id: 1, grnId: 1, poItemId: 1, productId: 100, receivedQty: 100, acceptedQty: 100, rejectedQty: 0, unitCost: 10 }];
const qtyBlocked = {
  poItems,
  grnLines,
  invoiceItems: [{ productId: 100, poItemId: 1, qty: 150, unitCost: 10 }],
};
const shortOverride = computeThreeWayMatch({
  minorUnits: 2, vatRate: 0.14, ...qtyBlocked,
  allowOverride: true, overrideReason: 'موافقة', overrideScope: 'full',
});
assert.equal(shortOverride.isValidForPosting, true, 'a one-word override reason must approve the override');
const emptyOverride = computeThreeWayMatch({
  minorUnits: 2, vatRate: 0.14, ...qtyBlocked,
  allowOverride: true, overrideReason: '   ', overrideScope: 'full',
});
assert.equal(emptyOverride.isValidForPosting, false, 'an empty override reason must not approve the override');
console.log('✓ three-way-match override reason: one word ok, empty rejected');

// Freight maker-checker override: role gate unchanged, reason non-empty.
assert.equal(
  validateMakerCheckerOverride({ userId: 2, role: 'finance_manager', invoiceCreatedBy: 1, reason: 'موافقة' }).valid,
  true, 'a one-word rationale must be valid for a finance manager',
);
assert.equal(
  validateMakerCheckerOverride({ userId: 2, role: 'finance_manager', invoiceCreatedBy: 1, reason: '  ' }).valid,
  false, 'an empty rationale must stay invalid',
);
assert.equal(
  validateMakerCheckerOverride({ userId: 2, role: 'cashier', invoiceCreatedBy: 1, reason: 'موافقة مفصلة جدا' }).valid,
  false, 'the role gate stays: a cashier cannot approve even with a long reason',
);
console.log('✓ freight override rationale: one word ok, role gate unchanged');

// Trip expense governance: one-word note allows a routine petty expense.
const routine = evaluateTripExpenseGovernance({ moneyDigits: 2, expenseType: 'fuel', amount: 100, notes: 'وقود', existingTripExpenses: 0 });
assert.equal(routine.allowed, true, 'a one-word expense note must allow a routine petty expense');
const noNotes = evaluateTripExpenseGovernance({ moneyDigits: 2, expenseType: 'fuel', amount: 100, notes: '   ', existingTripExpenses: 0 });
assert.equal(noNotes.allowed, false, 'empty expense notes must stay rejected');
assert.equal(noNotes.reasonCode, 'EXPENSE_NOTES_REQUIRED');
console.log('✓ trip expense notes: one word ok, empty rejected');

// Damage note: one word passes, blank fails.
assert.doesNotThrow(() => assertDamagedStockNote('تلف'));
assert.throws(() => assertDamagedStockNote('   '), /DAMAGE_NOTE_REQUIRED/);
console.log('✓ damage note: one word ok, blank rejected');

// Refund-tender override: one word allows, empty fails.
const refundBase = {
  requested: 'cash' as const, amount: 100,
  originalCashPaid: 0, originalNonCashPaid: 100, originalDebt: 0,
  previousCashRefunded: 0, previousNonCashRefunded: 0, previousDebtReversed: 0,
  hasCustomer: false, override: true,
};
assert.deepEqual(
  allocateRefundTenders({ ...refundBase, overrideReason: 'موافقة' }),
  [{ tender: 'cash', amount: 100 }],
);
assert.throws(
  () => allocateRefundTenders({ ...refundBase, overrideReason: '' }),
  /REFUND_OVERRIDE_REASON_REQUIRED/,
);
console.log('✓ refund override reason: one word ok, empty rejected');

console.log('\nreason-length minima checks passed');
