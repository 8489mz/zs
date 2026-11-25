/*
New file: backend/test/critical/invoice-allocation-book-precision.spec.ts
Pins the invoice allocation engine at the tenant's book precision
(Phase 1, tax F2): allocateInvoiceDiscount already accepted an optional
digits parameter, and both sale create/edit paths pass the tenant's
book digits — but the sales-return path (the legacy-line backfill in
createSaleReturn) called it with no digits argument, so it defaulted
to 2. On a 3-decimal tenant the stored line totals and tax (e.g. tax
10.005) do not survive a cents conversion: toCents rejects them and
the return is blocked with INVALID_INVOICE_ALLOCATION.

WHAT THIS PINS:
- The exact stored-values case from the audit, at digits 3: lines
  20.025 + 13.350 with stored tax 10.005 allocates exactly (tax shares
  sum to 10.005, no throw) — the return path's inputs, pinned at the
  engine seam.
- The same inputs without digits, and with digits 2, throw
  INVALID_INVOICE_ALLOCATION: a silent 2 default is the defect, and an
  omitted digits argument fails closed instead of rounding.
- Finer-than-book inputs (4dp at digits 3) fail closed.
- The 2-decimal behaviour is unchanged (10 over 3 x 100 -> 3.33 /
  3.33 / 3.34, last line absorbs).
- The wiring guarantee is compile-time: digits is a required
  parameter, so no caller can omit it again (tsc proves all call
  sites; the returns site passes the book digits it already derives).
  The integrated createSaleReturn path is not driven end to end in
  the clone (no returns-service harness exists here); the acceptance
  suite must cover it.
*/

import { strict as assert } from 'node:assert';
import { allocateInvoiceDiscount } from '../../src/modules/sales/engines/invoice-discount.engine';

function testBookPrecisionAllocation(): void {
  // The returns-path inputs, stored at 3dp on a KWD tenant.
  const allocated = allocateInvoiceDiscount({
    lines: [
      { lineTotal: 20.025, qty: 1 },
      { lineTotal: 13.35, qty: 2 },
    ],
    invoiceDiscount: 0,
    invoiceTax: 10.005,
    pricesIncludeTax: false,
    digits: 3,
  });
  assert.equal(allocated.length, 2);
  const taxSum = allocated.reduce((sum, line) => sum + line.allocatedTax, 0);
  assert.equal(Number(taxSum.toFixed(3)), 10.005);
  assert.equal(allocated[0].netLineTotal, 20.025);
  assert.equal(allocated[1].netLineTotal, 13.35);

  // A 3dp discount allocates exactly at book precision too.
  const discounted = allocateInvoiceDiscount({
    lines: [
      { lineTotal: 33.375, qty: 3 },
      { lineTotal: 16.688, qty: 1 },
    ],
    invoiceDiscount: 5.005,
    invoiceTax: 0,
    pricesIncludeTax: false,
    digits: 3,
  });
  const discountSum = discounted.reduce((sum, line) => sum + line.allocatedDiscount, 0);
  assert.equal(Number(discountSum.toFixed(3)), 5.005);

  // The defect: the same stored inputs under a 2dp book throw.
  assert.throws(
    () =>
      allocateInvoiceDiscount({
        lines: [
          { lineTotal: 20.025, qty: 1 },
          { lineTotal: 13.35, qty: 2 },
        ],
        invoiceDiscount: 0,
        invoiceTax: 10.005,
        pricesIncludeTax: false,
        digits: 2,
      }),
    /INVALID_INVOICE_ALLOCATION/,
  );

  // Omitting digits fails closed instead of silently defaulting to 2.
  assert.throws(
    () =>
      (allocateInvoiceDiscount as any)({
        lines: [
          { lineTotal: 20.025, qty: 1 },
          { lineTotal: 13.35, qty: 2 },
        ],
        invoiceDiscount: 0,
        invoiceTax: 10.005,
        pricesIncludeTax: false,
      }),
    /INVALID_INVOICE_ALLOCATION/,
  );

  // Finer-than-book inputs fail closed at digits 3.
  assert.throws(
    () =>
      allocateInvoiceDiscount({
        lines: [{ lineTotal: 10.0085, qty: 1 }],
        invoiceDiscount: 0,
        invoiceTax: 0,
        pricesIncludeTax: false,
        digits: 3,
      }),
    /INVALID_INVOICE_ALLOCATION/,
  );

  // 2-decimal behaviour unchanged: the last line absorbs the remainder.
  const twoDp = allocateInvoiceDiscount({
    lines: [
      { lineTotal: 100, qty: 1 },
      { lineTotal: 100, qty: 1 },
      { lineTotal: 100, qty: 1 },
    ],
    invoiceDiscount: 10,
    invoiceTax: 0,
    pricesIncludeTax: false,
    digits: 2,
  });
  assert.deepEqual(
    twoDp.map((line) => line.allocatedDiscount),
    [3.33, 3.33, 3.34],
  );

  console.log('Invoice allocation book precision tests passed');
}

testBookPrecisionAllocation();
