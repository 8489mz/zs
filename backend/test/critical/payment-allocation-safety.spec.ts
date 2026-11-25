import { strict as assert } from 'node:assert';
import {
  validatePaymentAllocationRequest,
  AllocatePaymentDto,
} from '../../src/modules/accounting/services/payment-allocation.service';

const request = (): AllocatePaymentDto => ({
  partnerType: 'customer',
  partnerId: 11,
  paymentType: 'customer_payment',
  paymentId: 70,
  allocations: [{ invoiceId: 99, amount: 10 }],
});
function mustReject(mutator: (dto: AllocatePaymentDto) => void, label: string): void {
  const dto = request();
  mutator(dto);
  assert.throws(() => validatePaymentAllocationRequest(dto, 2), label);
}
assert.deepEqual(validatePaymentAllocationRequest(request(), 2), {
  totalAllocating: 10,
  allocations: [{ invoiceId: 99, amount: 10 }],
});
mustReject((dto) => {
  // D6: the DTO class makes paymentId required, so the pipe rejects a
  // missing paymentId before the service ever sees it — but the service
  // validator keeps its own rejection as the backstop for internal
  // callers (autoAllocateFIFO calls allocatePayment directly), so this
  // service-level case stays, with a cast past the DTO type.
  dto.paymentId = undefined as unknown as number;
}, 'must not accept unfunded allocation');
mustReject((dto) => {
  // D6: the DTO enum excludes 'direct' (the service whitelist is
  // customer_payment / supplier_payment only), so the pipe rejects it —
  // the service validator keeps its own rejection as the backstop.
  dto.paymentType = 'direct' as AllocatePaymentDto['paymentType'];
}, 'must reject direct paid_amount modification');
mustReject((dto) => {
  dto.partnerType = 'supplier';
}, 'must not mix customer and supplier payment types');
mustReject((dto) => {
  dto.allocations.push({ invoiceId: 100, amount: -9 });
}, 'negative row cannot mask over-allocation');
mustReject((dto) => {
  dto.allocations.push({ invoiceId: 100, amount: 0 });
}, 'zero rows forbidden');
mustReject((dto) => {
  dto.allocations.push({ invoiceId: 100, amount: NaN });
}, 'non-finite values forbidden');
mustReject((dto) => {
  dto.allocations.push({ invoiceId: 100, amount: 0.001 });
}, 'subcent values forbidden');
mustReject((dto) => {
  dto.allocations.push({ invoiceId: 99, amount: 2 });
}, 'duplicate invoice IDs forbidden');
mustReject((dto) => {
  dto.allocations = [
    { invoiceId: 2, amount: 2 },
    { invoiceId: 1, amount: 3 },
  ];
  dto.partnerId = 0;
}, 'partner required');
const sorted = request();
sorted.allocations = [
  { invoiceId: 22, amount: 1.1 },
  { invoiceId: 21, amount: 2.2 },
];
assert.deepEqual(validatePaymentAllocationRequest(sorted, 2), {
  totalAllocating: 3.3,
  allocations: [
    { invoiceId: 21, amount: 2.2 },
    { invoiceId: 22, amount: 1.1 },
  ],
});
console.log('Payment allocation input safety regressions passed');
