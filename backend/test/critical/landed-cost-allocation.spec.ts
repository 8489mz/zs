import { strict as assert } from 'node:assert';
import { allocateLandedCosts } from '../../src/modules/purchases/engines/landed-cost-allocation.engine';

assert.deepEqual(allocateLandedCosts(0.01, [1, 1, 1]), [0.01, 0, 0]);
assert.deepEqual(allocateLandedCosts(0.02, [1, 1, 1]), [0.01, 0.01, 0]);
assert.deepEqual(allocateLandedCosts(1, [4, 3, 3]), [0.4, 0.3, 0.3]);
assert.deepEqual(allocateLandedCosts(0.03, [0, 0, 0]), [0.01, 0.01, 0.01]);
for (const amount of [0.01, 0.03, 1.01, 199.99, 10325.67]) {
  const parts = allocateLandedCosts(amount, [3, 7, 3, 11, 0, 2]);
  assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), Math.round(amount * 100));
  assert.ok(
    parts.every((p) => p >= 0),
    'negative share',
  );
}
assert.throws(() => allocateLandedCosts(0.005, [1, 1]), /دقة/);
assert.throws(() => allocateLandedCosts(1, [-1, 2]), /غير صالحة/);
console.log('Exact-cent landed cost allocation regressions passed');
