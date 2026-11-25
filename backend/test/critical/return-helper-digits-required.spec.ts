/*
New file: backend/test/critical/return-helper-digits-required.spec.ts
Pins the returns-helper digits requirement (money-precision program,
package 2; INV-RETURN-HELPER-DIGITS-REQUIRED).

THE GAP: the four rounding helpers in returns-write.helper.ts took
`digits` with a silent `= 2` default. Every live caller in
returns.service.ts already passes the tenant's book digits, so no
posted return is wrong today — but any future caller that forgot
digits would silently cut a 3-decimal tenant's return lines, totals,
and ledger balances to cents.

THE FIX (zero behavior change): `digits` is REQUIRED on all four
functions (and on the file-private rounder). The type checker now
rejects a caller that omits it, and at runtime an omitted digits
fails closed instead of rounding to 2 decimals.

WHAT THIS PINS:
- Explicit-digits behavior is unchanged at 2 and 3 digits,
  including the KWD 0.001 cases.
- Omitting digits (passed as undefined) throws on all four
  functions instead of returning a 2-decimal value — the old code
  returned silently, which is the fail-first discrimination.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import {
  buildPurchaseReturnLine,
  buildSaleReturnLine,
  calculateNextLedgerBalance,
  calculateReturnDocumentTotal,
} from '../../src/modules/returns/helpers/returns-write.helper';

const NO_DIGITS = undefined as unknown as 2;

async function main(): Promise<void> {
  // Explicit 2-digit behavior, unchanged.
  const saleLine = buildSaleReturnLine(
    { product_id: 2, product_name: 'Tea', qty: 4, line_total: 50, unit_multiplier: 1.5 },
    { id: 2, stock_qty: 10 },
    { productId: 2, productName: 'Tea', qty: 2 },
    { qty: 0, amount: 0, tax: 0 },
    2,
  );
  assert.equal(saleLine.lineTotal, 25);
  assert.equal(saleLine.unitTotal, 12.5);
  assert.equal(calculateReturnDocumentTotal([{ lineTotal: 10.005 }, { lineTotal: 5.255 }], 2), 15.26);
  assert.equal(calculateNextLedgerBalance('12.50', -2.245, 2), 10.26);

  // Explicit 3-digit behavior, unchanged (KWD cases).
  const kwdSale = buildSaleReturnLine(
    {
      product_id: 11,
      product_name: 'KWD',
      qty: 1,
      line_total: 0.001,
      net_line_total: 0.001,
      allocated_tax: 0,
      unit_multiplier: 1,
    },
    { id: 11, stock_qty: 0 },
    { productId: 11, productName: 'KWD', qty: 1 },
    { qty: 0, amount: 0, tax: 0 },
    3,
  );
  assert.equal(kwdSale.lineTotal, 0.001);
  const kwdPurchase = buildPurchaseReturnLine(
    { product_id: 11, product_name: 'KWD', qty: 1, line_total: 0.001, unit_multiplier: 1 },
    { id: 11, stock_qty: 1 },
    { productId: 11, productName: 'KWD', qty: 1 },
    { qty: 0, amount: 0 },
    3,
  );
  assert.equal(kwdPurchase.lineTotal, 0.001);
  assert.equal(calculateReturnDocumentTotal([{ lineTotal: 0.001 }], 3), 0.001);
  assert.equal(calculateNextLedgerBalance('0.002', -0.001, 3), 0.001);

  // Omitted digits must fail closed, not fall back to 2 decimals.
  assert.throws(
    () =>
      buildSaleReturnLine(
        { product_id: 2, product_name: 'Tea', qty: 4, line_total: 50, unit_multiplier: 1.5 },
        { id: 2, stock_qty: 10 },
        { productId: 2, productName: 'Tea', qty: 2 },
        { qty: 0, amount: 0, tax: 0 },
        NO_DIGITS,
      ),
    /Invalid monetary minor units/,
  );
  assert.throws(
    () =>
      buildPurchaseReturnLine(
        { product_id: 5, product_name: 'Sugar', qty: 5, line_total: 40, unit_multiplier: 2 },
        { id: 5, stock_qty: 12 },
        { productId: 5, productName: 'Sugar', qty: 3 },
        { qty: 0, amount: 0 },
        NO_DIGITS,
      ),
    /Invalid monetary minor units/,
  );
  assert.throws(() => calculateReturnDocumentTotal([{ lineTotal: 10.005 }], NO_DIGITS), /Invalid monetary minor units/);
  assert.throws(() => calculateNextLedgerBalance('12.50', -2.245, NO_DIGITS), /Invalid monetary minor units/);

  console.log('Return helper digits-required tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
