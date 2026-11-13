import assert from 'node:assert/strict';
import { buildCustomerSearchPredicate, calculatePagination, mapCustomerRow, mapSupplierRow, parsePartnersListQuery } from '../../src/modules/partners/helpers/partners-listing.helper';

const parsed = parsePartnersListQuery({ page: '0', pageSize: '500', q: '  ali  ', filter: 'vip' });
assert.equal(parsed.page, 1);
assert.equal(parsed.pageSize, 100);
assert.equal(parsed.q, 'ali');
assert.equal(parsed.filter, 'vip');
assert.equal(parsed.isUnpagedDefault, false);

const unpaged = parsePartnersListQuery({});
assert.equal(unpaged.isUnpagedDefault, true);

assert.deepEqual(
  mapCustomerRow({ id: 7 as never, name: 'Ali', phone: null as never, address: null as never, balance: '4.5' as never, customer_type: 'vip' as never, credit_limit: '10' as never, store_credit_balance: '2' as never, company_name: null as never, tax_number: null as never } as never),
  { id: '7', name: 'Ali', phone: '', address: '', customerCode: 'C-0007', balance: 4.5, repBalances: [], unassignedBalance: 0, type: 'vip', creditLimit: 10, storeCreditBalance: 2, companyName: '', taxNumber: '', loyaltyPoints: 0, metadata: {} },
);

assert.deepEqual(
  mapSupplierRow({ id: 9 as never, name: 'Supp', phone: null as never, address: null as never, balance: '3.2' as never, notes: null as never } as never),
  { id: '9', name: 'Supp', phone: '', address: '', balance: 3.2, notes: '', metadata: {} },
);

assert.deepEqual(calculatePagination(4, 20, 35), { page: 2, pageSize: 20, totalItems: 35, totalPages: 2 });
assert.ok(buildCustomerSearchPredicate('ali'));
assert.equal(buildCustomerSearchPredicate(''), null);

console.log('partners listing helper checks passed');
