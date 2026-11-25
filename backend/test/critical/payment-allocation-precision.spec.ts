/*
New file: backend/test/critical/payment-allocation-precision.spec.ts
Pure spec: imports production validatePaymentAllocationRequest, no
re-implemented formula. Run with the backend critical specs.

WHAT THIS PINS: allocation amounts are validated and totalled in the
TENANT currency's minor units. Before the Treasury P1 package the
validator accumulated cents (*100): a KWD allocation of 10.123 was
rejected outright, and a KWD total was silently re-based through /100.
The DB-backed allocation flow (paid_amount writes, FIFO) uses the same
digits through roundMoney; this spec pins the entry point, which is
where a 3-decimal tenant used to be refused at the door.

*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { validatePaymentAllocationRequest } from '../../src/modules/accounting/services/payment-allocation.service';

const dto = (allocations: Array<{ invoiceId: number; amount: number }>) => ({
  partnerType: 'customer' as const,
  paymentType: 'customer_payment' as const,
  partnerId: 25,
  paymentId: 1,
  allocations,
});

// KWD (3dp): a 10.123 allocation is legal and totals exactly.
assert.deepEqual(validatePaymentAllocationRequest(dto([{ invoiceId: 1, amount: 10.123 }]), 3).totalAllocating, 10.123);
// KWD: multi-line totals accumulate in fils, not cents.
assert.deepEqual(
  validatePaymentAllocationRequest(
    dto([
      { invoiceId: 1, amount: 10.123 },
      { invoiceId: 2, amount: 0.007 },
    ]),
    3,
  ).totalAllocating,
  10.13,
);
// EGP (2dp): the same 10.123 is correctly rejected -- precision is judged
// in the tenant currency, not by a hard-coded cent rule.
assert.throws(() => validatePaymentAllocationRequest(dto([{ invoiceId: 1, amount: 10.123 }]), 2));
// Sub-minor at 3dp is rejected, not rounded into existence.
assert.throws(() => validatePaymentAllocationRequest(dto([{ invoiceId: 1, amount: 10.1234 }]), 3));
// Unchanged guards: empty, non-positive, and non-finite amounts still fail.
assert.throws(() => validatePaymentAllocationRequest(dto([]), 3));
assert.throws(() => validatePaymentAllocationRequest(dto([{ invoiceId: 1, amount: 0 }]), 3));
assert.throws(() => validatePaymentAllocationRequest(dto([{ invoiceId: 1, amount: Number.NaN }]), 3));
// Allocations come back sorted by invoice id, as before.
assert.deepEqual(
  validatePaymentAllocationRequest(
    dto([
      { invoiceId: 2, amount: 1 },
      { invoiceId: 1, amount: 2 },
    ]),
    2,
  ).allocations.map((a) => a.invoiceId),
  [1, 2],
);

console.log('payment-allocation-precision: all assertions passed');
