import assert from 'node:assert/strict';
import { settlePosExchange } from '../../src/modules/sales/engines/pos-exchange.engine';
import { allocateRefundTenders } from '../../src/modules/returns/engines/refund-tender.engine';
import {
  exchangeStoreCreditAmount,
  hasUnpaidExchangeBalance,
} from '../../src/modules/returns/engines/exchange-store-credit.engine';

assert.equal(exchangeStoreCreditAmount(0.001, 3), 0.001);
assert.equal(exchangeStoreCreditAmount(0.002, 3), 0.002);
assert.equal(exchangeStoreCreditAmount(1.234, 3), 1.234);
assert.equal(exchangeStoreCreditAmount(1.234, 2), 1.23);
assert.throws(() => exchangeStoreCreditAmount(-0.001, 3), /Invalid exchange credit/);
assert.throws(() => exchangeStoreCreditAmount(Number.NaN, 3), /Invalid exchange credit/);
console.log('POS exchange credit precision regressions passed');

assert.equal(hasUnpaidExchangeBalance(0.003, 0.002, 0, 3), true, 'one unpaid KWD fil must block exchange');
assert.equal(hasUnpaidExchangeBalance(0.003, 0.003, 0, 3), false);
assert.equal(hasUnpaidExchangeBalance(1.01, 1, 0, 2), true);
assert.equal(hasUnpaidExchangeBalance(1, 1, 0, 2), false);
assert.throws(() => hasUnpaidExchangeBalance(NaN, 0, 0, 3), /Invalid exchange invoice/);

assert.deepEqual(settlePosExchange(0.003, 0.001, 3), {
  appliedCredit: 0.001,
  refundAmount: 0.002,
  collectibleAmount: 0,
});
assert.deepEqual(settlePosExchange(0.001, 0.003, 3), {
  appliedCredit: 0.001,
  refundAmount: 0,
  collectibleAmount: 0.002,
});
assert.deepEqual(settlePosExchange(0.03, 0.01), { appliedCredit: 0.01, refundAmount: 0.02, collectibleAmount: 0 });
assert.throws(() => settlePosExchange(0.0001, 0, 3), /قيمة الاستبدال/);
const allocations = allocateRefundTenders({
  requested: 'store_credit',
  amount: 0.002,
  originalCashPaid: 0,
  originalNonCashPaid: 0,
  originalDebt: 0,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: true,
  digits: 3,
});
assert.deepEqual(allocations, [{ tender: 'store_credit', amount: 0.002 }]);
