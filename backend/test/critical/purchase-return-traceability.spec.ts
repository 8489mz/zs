import { strict as assert } from 'node:assert';
import {
  selectPurchaseReturnBatch,
  selectPurchaseReturnSerials,
} from '../../src/modules/returns/helpers/purchase-return-traceability.helper';

const serials = [
  { id: 1, serial_number: 'ABC', imei_2: null, status: 'in_stock' },
  { id: 2, serial_number: 'DEF', imei_2: 'ALT2', status: 'in_stock' },
];
assert.deepEqual(
  selectPurchaseReturnSerials(serials, ['def'], 1).map((x) => x.id),
  [2],
);
assert.deepEqual(
  selectPurchaseReturnSerials(serials, ['alt2'], 1).map((x) => x.id),
  [2],
);
assert.deepEqual(
  selectPurchaseReturnSerials(serials, [], 2).map((x) => x.id),
  [1, 2],
);
assert.throws(() => selectPurchaseReturnSerials(serials, [], 1), /حدد السيريالات/);
assert.throws(() => selectPurchaseReturnSerials(serials, ['abc', 'abc'], 2), /مكررة/);
assert.throws(() => selectPurchaseReturnSerials(serials, ['unknown'], 1), /غير موجود/);
assert.throws(() => selectPurchaseReturnSerials(serials, ['abc'], 1.5), /عدداً صحيحاً/);

const batches = [
  { id: 10, quantity: 10 },
  { id: 20, quantity: 5 },
];
assert.equal(selectPurchaseReturnBatch(batches, 20, 4).id, 20);
assert.equal(selectPurchaseReturnBatch(batches, undefined, 8).id, 10);
assert.throws(() => selectPurchaseReturnBatch(batches, undefined, 4), /حدد تشغيلة/);
assert.throws(() => selectPurchaseReturnBatch(batches, 20, 8), /حدد تشغيلة/);
console.log('Purchase return serial and pharmacy batch regressions passed');
