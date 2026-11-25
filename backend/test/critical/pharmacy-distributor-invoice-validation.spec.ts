import assert from 'node:assert/strict';
import { validateDistributorInvoiceLines } from '../../src/modules/pharmacy/engines/distributor-invoice-validation.engine';

const valid = { productName: 'Insulin', quantity: 3, bonusQuantity: 1, costPrice: 12.5, publicPrice: 16 };
assert.doesNotThrow(() => validateDistributorInvoiceLines([valid]));
assert.throws(() => validateDistributorInvoiceLines([]), /at least one line/);
assert.throws(() => validateDistributorInvoiceLines([{ ...valid, productName: ' ' }]), /product name/);
assert.throws(() => validateDistributorInvoiceLines([{ ...valid, quantity: 0 }]), /quantity or price/);
assert.throws(() => validateDistributorInvoiceLines([{ ...valid, quantity: -1 }]), /quantity or price/);
assert.throws(() => validateDistributorInvoiceLines([{ ...valid, bonusQuantity: -2 }]), /quantity or price/);
assert.throws(() => validateDistributorInvoiceLines([{ ...valid, costPrice: -1 }]), /quantity or price/);
assert.throws(
  () => validateDistributorInvoiceLines([{ ...valid, publicPrice: Number.POSITIVE_INFINITY }]),
  /non-finite/,
);
assert.throws(() => validateDistributorInvoiceLines([{ ...valid, quantity: Number.NaN }]), /non-finite/);
assert.throws(
  () => validateDistributorInvoiceLines([{ ...valid, costPrice: null as unknown as number }]),
  /non-finite/,
);
assert.throws(() => validateDistributorInvoiceLines([{ ...valid }, { ...valid, quantity: 0 }]), /quantity or price/);
console.log('Pharmacy distributor invoice validation regressions passed');
