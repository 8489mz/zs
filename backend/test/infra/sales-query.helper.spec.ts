import { mapSaleRows } from '../../src/modules/sales/helpers/sales-query.helper';
import assert from 'node:assert/strict';

async function runTests() {
  // Test 1: should map tenderedAmount and changeAmount correctly
  const sales1 = [
    {
      id: 1,
      total: 40.5,
      paid_amount: 40.5,
      tendered_amount: 100.0,
      change_amount: 59.5,
    },
  ];
  const mapped1 = mapSaleRows(sales1 as any, [], []);
  assert.equal(mapped1[0].id, '1');
  assert.equal(mapped1[0].total, 40.5);
  assert.equal(mapped1[0].paidAmount, 40.5);
  assert.equal(mapped1[0].tenderedAmount, 100.0);
  assert.equal(mapped1[0].changeAmount, 59.5);

  // Test 2: should fallback to 0 if tenderedAmount or changeAmount is missing
  const sales2 = [
    {
      id: 2,
      total: 40.5,
      paid_amount: 40.5,
    },
  ];
  const mapped2 = mapSaleRows(sales2 as any, [], []);
  assert.equal(mapped2[0].id, '2');
  assert.equal(mapped2[0].tenderedAmount, 0);
  assert.equal(mapped2[0].changeAmount, 0);
}

runTests()
  .then(() => console.log('sales query helper checks passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
