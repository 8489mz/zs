import { strict as assert } from 'node:assert';

(() => {
  console.log('Testing inventory issue modes: STARTED');

  // Verify mathematical constraint formula for chk_transfer_item_variance
  function satisfiesVarianceConstraint(dispatched: number, received: number, variance: number): boolean {
    return (
      dispatched >= 0 &&
      received >= 0 &&
      received <= dispatched &&
      ((received === 0 && variance === 0) || variance === dispatched - received)
    );
  }

  // 1. Final issue: immediately received with 0 variance
  assert.equal(
    satisfiesVarianceConstraint(5, 5, 0),
    true,
    'Final issue with received_qty = dispatched_qty must satisfy constraint',
  );
  assert.equal(satisfiesVarianceConstraint(1, 1, 0), true, 'Final issue single unit must satisfy constraint');

  // 2. In-transit transfer: dispatched, 0 received yet, 0 variance
  assert.equal(
    satisfiesVarianceConstraint(5, 0, 0),
    true,
    'In-transit transfer with received_qty = 0 must satisfy constraint',
  );

  // 3. Received with shrinkage/variance: dispatched 10, received 9, variance 1
  assert.equal(
    satisfiesVarianceConstraint(10, 9, 1),
    true,
    'Partial receipt with recorded shrinkage must satisfy constraint',
  );

  // 4. Invalid combinations
  assert.equal(satisfiesVarianceConstraint(10, 11, 0), false, 'Receiving more than dispatched must fail');
  assert.equal(
    satisfiesVarianceConstraint(10, 8, 0),
    false,
    'Receiving 8 with variance 0 must fail (variance must be 2)',
  );
  assert.equal(satisfiesVarianceConstraint(10, 0, 2), false, 'In-transit cannot have variance without receiving');

  console.log('Testing inventory issue modes: PASSED');
})();
