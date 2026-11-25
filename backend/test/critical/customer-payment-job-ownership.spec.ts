import { strict as assert } from 'node:assert';
import { assertCustomerPaymentJobOwnership } from '../../src/modules/purchases/helpers/customer-payment-job-ownership';

assert.doesNotThrow(() => assertCustomerPaymentJobOwnership(11, 11));
assert.doesNotThrow(() => assertCustomerPaymentJobOwnership(11, '11'));
for (const mismatched of [12, '12', null, 0, -1, 'invalid', '11.5']) {
  assert.throws(
    () => assertCustomerPaymentJobOwnership(11, mismatched),
    { code: 'MARITIME_JOB_CUSTOMER_MISMATCH' },
    `wrong job owner must fail: ${mismatched}`,
  );
}
assert.throws(() => assertCustomerPaymentJobOwnership(0, 0), { code: 'MARITIME_JOB_CUSTOMER_MISMATCH' });
console.log('Customer payment maritime job ownership regressions passed');
