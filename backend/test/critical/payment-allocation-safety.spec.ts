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
  dto.paymentId = undefined;
}, 'must not accept unfunded allocation');
mustReject((dto) => {
  dto.paymentType = 'direct';
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
