import assert from 'node:assert/strict';
import {
  buildCustomerBalanceRows,
  buildSupplierBalanceRows,
  filterCustomerBalanceRows,
  filterSupplierBalanceRows,
  summarizeCustomerBalanceRows,
  summarizeSupplierBalanceRows,
} from '../../src/modules/reports/helpers/reports-balances.helper';

const customerRows = buildCustomerBalanceRows(
  [
    { id: 1, name: 'Ali', phone: '0100', balance: 0, credit_limit: 100 },
    { id: 2, name: 'Mona', phone: '0200', balance: 10, credit_limit: 50 },
    { id: 3, name: 'Omar', phone: '0300', balance: 0, credit_limit: 1000 },
  ],
  new Map([
    ['1', 80],
    ['3', 1250],
  ]),
);
assert.deepEqual(customerRows[0], {
  id: '1',
  name: 'Ali',
  phone: '0100',
  balance: 80,
  creditLimit: 100,
  availableCredit: 20,
});

const filteredCustomers = filterCustomerBalanceRows(customerRows, { search: 'o', filter: 'high-balance' });
assert.equal(filteredCustomers.length, 1);
assert.equal(filteredCustomers[0]?.id, '3');
assert.deepEqual(summarizeCustomerBalanceRows(customerRows.filter((row) => row.balance > 0)), {
  totalItems: 3,
  totalBalance: 1340,
  overLimit: 1,
});

const supplierRows = buildSupplierBalanceRows(
  [
    { id: 4, name: 'North', phone: '100', balance: 0 },
    { id: 5, name: 'Delta', phone: '200', balance: 250 },
  ],
  new Map([['4', 1100]]),
);
assert.deepEqual(supplierRows[0], {
  id: '4',
  name: 'North',
  phone: '100',
  balance: 1100,
});

const filteredSuppliers = filterSupplierBalanceRows(supplierRows, { search: 'ta', filter: 'high-balance' });
assert.equal(filteredSuppliers.length, 0);
assert.deepEqual(summarizeSupplierBalanceRows(filterSupplierBalanceRows(supplierRows, { filter: 'all' })), {
  totalItems: 2,
  totalBalance: 1350,
});

console.log('reports balances helper checks passed');

const filCustomerRows = buildCustomerBalanceRows(
  [{ id: 7, name: 'KWD', balance: 0, credit_limit: 0.005 }],
  new Map([['7', 0.001]]),
  3,
);
assert.equal(filCustomerRows[0].balance, 0.001);
assert.equal(filCustomerRows[0].availableCredit, 0.004);
assert.equal(summarizeCustomerBalanceRows(filCustomerRows, 3).totalBalance, 0.001);
assert.equal(
  summarizeSupplierBalanceRows([{ id: '8', name: 'OMR', phone: '', balance: 0.001 }], 3).totalBalance,
  0.001,
);
