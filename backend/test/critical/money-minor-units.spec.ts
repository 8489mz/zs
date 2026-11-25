import assert from 'node:assert/strict';
import {
  currencyMoneyDigits,
  toMinorUnits,
  fromMinorUnits,
  roundMoney,
} from '../../src/modules/accounting/engines/money-minor-units.engine';

assert.equal(currencyMoneyDigits('KWD'), 3);
assert.equal(currencyMoneyDigits('omr'), 3);
assert.equal(currencyMoneyDigits('EGP'), 2);
assert.equal(currencyMoneyDigits('SAR'), 2);
assert.equal(toMinorUnits(0.001, 3), 1);
assert.equal(toMinorUnits(0.999, 3), 999);
assert.equal(fromMinorUnits(1001, 3), 1.001);
assert.equal(roundMoney(0.00149, 3), 0.001);
assert.equal(roundMoney(0.00151, 3), 0.002);
assert.throws(() => toMinorUnits(0.001, 2), /precision/);
assert.throws(() => toMinorUnits(0.0001, 3), /precision/);
assert.throws(() => toMinorUnits(Number.POSITIVE_INFINITY, 3), /Non-finite/);
assert.throws(() => toMinorUnits(Number.MAX_SAFE_INTEGER, 3), /safe range/);
console.log('Currency minor-unit precision regressions passed');
