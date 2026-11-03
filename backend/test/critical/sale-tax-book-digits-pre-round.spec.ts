/*
 * Sale-side tax pre-rounding to book digits before invoice allocation
 * (INV-SALE-TAX-BOOK-DIGITS-PRE-ROUND, Slice 5 P2).
 *
 * THE DEFECT: `computeInvoiceTotals` always rounds tax/total to 3 decimals,
 * but `allocateInvoiceDiscount` fails closed on anything finer than the
 * tenant's book digits. On a 2-decimal tenant, any sale whose tax needs a
 * third decimal (subtotal 100.00, discount 33.33, 14% VAT -> tax 9.334)
 * was rejected outright with INVALID_INVOICE_ALLOCATION before any
 * write — fail-closed, but cashier-facing on ordinary baskets.
 *
 * THE FIX: the sale writer rounds the totals to book digits at the
 * `roundSaleInvoiceTotals` seam, before allocation, at both the create
 * and the edit call sites. The shared totals util keeps its 3dp ceiling
 * (purchases rely on it) and the allocation engine keeps its fail-closed
 * contract; postSale re-rounds these same book-digits values, so the
 * journal legs are unchanged and the stored tax_amount/total are now
 * exactly the amounts postSale journals.
 *
 * WHAT THIS DRIVES: the real seam end to end in process —
 * `computeInvoiceTotals` -> `roundSaleInvoiceTotals` ->
 * `allocateInvoiceDiscount` — plus a source pin proving both call sites
 * in the sale writer use the seam. The integrated createSale path is
 * NOT driven end to end here: no harness exists that runs a full
 * successful sale (the Tax F1 spec's mock harness stops at the gate),
 * and inventing one would misrepresent production; the acceptance
 * suite must cover the integrated path. The wiring guarantee is the
 * composition cases below + the source pin + tsc (the helper is
 * imported and called at both sites).
 *
 * Mutation: returning the totals unrounded from the helper, or dropping
 * the helper calls at either call site, must fail this spec.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeInvoiceTotals } from '../../src/common/utils/invoice-totals';
import { allocateInvoiceDiscount } from '../../src/modules/sales/engines/invoice-discount.engine';
import { roundSaleInvoiceTotals } from '../../src/modules/sales/helpers/sales-write.helper';

function minorUnits(value: number, digits: 2 | 3): number {
  return Math.round(value * 10 ** digits);
}

function allocatedSums(lines: { lineTotal: number; qty: number }[], invoiceDiscount: number, invoiceTax: number, pricesIncludeTax: boolean, digits: 2 | 3) {
  const allocated = allocateInvoiceDiscount({ lines, invoiceDiscount, invoiceTax, pricesIncludeTax, digits });
  return {
    discount: minorUnits(allocated.reduce((sum, line) => sum + line.allocatedDiscount, 0), digits),
    tax: minorUnits(allocated.reduce((sum, line) => sum + line.allocatedTax, 0), digits),
    net: minorUnits(allocated.reduce((sum, line) => sum + line.netLineTotal, 0), digits),
    allocated,
  };
}

function main(): void {
  // Case 1 — the worked illustration (2dp, exclusive tax): the sale
  // that was rejected outright before this fix now posts.
  {
    const raw = computeInvoiceTotals(100, 33.33, 14, false);
    // The shared util keeps its 3dp ceiling: unchanged behaviour.
    assert.equal(raw.taxAmount, 9.334);
    assert.equal(raw.total, 76.004);
    // The old behaviour: the raw tax straight into allocation throws.
    assert.throws(
      () => allocateInvoiceDiscount({
        lines: [{ lineTotal: 50, qty: 1 }, { lineTotal: 50, qty: 1 }],
        invoiceDiscount: 33.33, invoiceTax: raw.taxAmount, pricesIncludeTax: false, digits: 2,
      }),
      /INVALID_INVOICE_ALLOCATION/,
    );
    const booked = roundSaleInvoiceTotals(raw, 2);
    assert.equal(booked.taxAmount, 9.33);
    assert.equal(booked.total, 76);
    const itemOnly = roundSaleInvoiceTotals(computeInvoiceTotals(100, 33.33, 14, false, 0, 0, 0), 2);
    assert.equal(itemOnly.taxAmount, 9.33);
    const sums = allocatedSums(
      [{ lineTotal: 50, qty: 1 }, { lineTotal: 50, qty: 1 }],
      33.33, itemOnly.taxAmount, false, 2,
    );
    assert.equal(sums.discount, 3333);
    assert.equal(sums.tax, 933);
    assert.equal(sums.net, 6667);
  }

  // Case 2 — a 3-decimal tenant's tax still allocates exactly: the
  // pre-rounding is the identity at book digits, no behaviour change.
  {
    const raw = computeInvoiceTotals(66.7, 0, 15, false);
    assert.equal(raw.taxAmount, 10.005);
    const booked = roundSaleInvoiceTotals(raw, 3);
    assert.equal(booked.taxAmount, 10.005);
    assert.equal(booked.total, 76.705);
    const sums = allocatedSums(
      [{ lineTotal: 33.35, qty: 1 }, { lineTotal: 33.35, qty: 1 }],
      0, booked.taxAmount, false, 3,
    );
    assert.equal(sums.tax, 10005);
    assert.equal(sums.net, 66700);
  }

  // Case 3 — prices include tax (2dp): the extracted tax is pre-rounded
  // and the net + tax identity holds exactly at book digits.
  {
    const raw = computeInvoiceTotals(100, 0, 14, true);
    assert.equal(raw.taxAmount, 12.281);
    assert.throws(
      () => allocateInvoiceDiscount({
        lines: [{ lineTotal: 100, qty: 1 }],
        invoiceDiscount: 0, invoiceTax: raw.taxAmount, pricesIncludeTax: true, digits: 2,
      }),
      /INVALID_INVOICE_ALLOCATION/,
    );
    const booked = roundSaleInvoiceTotals(raw, 2);
    assert.equal(booked.taxAmount, 12.28);
    assert.equal(booked.total, 100);
    const sums = allocatedSums([{ lineTotal: 100, qty: 1 }], 0, booked.taxAmount, true, 2);
    assert.equal(sums.tax, 1228);
    assert.equal(sums.net, 8772);
    assert.equal(minorUnits(sums.allocated[0].netLineTotal + sums.allocated[0].allocatedTax, 2), 10000);
  }

  // Case 4 — the 2dp last-line absorption regression is unchanged:
  // a 10 discount over three 100 lines absorbs as 3.33 / 3.33 / 3.34.
  {
    const raw = computeInvoiceTotals(300, 10, 0, false);
    const booked = roundSaleInvoiceTotals(raw, 2);
    assert.equal(booked.taxAmount, 0);
    assert.equal(booked.total, 290);
    const allocated = allocateInvoiceDiscount({
      lines: [{ lineTotal: 100, qty: 1 }, { lineTotal: 100, qty: 1 }, { lineTotal: 100, qty: 1 }],
      invoiceDiscount: 10, invoiceTax: 0, pricesIncludeTax: false, digits: 2,
    });
    assert.deepEqual(
      allocated.map((line) => minorUnits(line.allocatedDiscount, 2)),
      [333, 333, 334],
    );
  }

  // Case 5 — half-up boundary: a tax of 9.335 rounds UP to 9.34 at
  // book digits (the canonical engine), never truncated; the journal
  // re-rounds the stored value the same way, so the legs agree.
  {
    const raw = computeInvoiceTotals(66.68, 0, 14, false);
    assert.equal(raw.taxAmount, 9.335);
    const booked = roundSaleInvoiceTotals(raw, 2);
    assert.equal(booked.taxAmount, 9.34);
    const sums = allocatedSums([{ lineTotal: 66.68, qty: 1 }], 0, booked.taxAmount, false, 2);
    assert.equal(sums.tax, 934);
  }

  // Case 6 — non-finite inputs fail closed through the canonical
  // rounder; they are never coerced to 0 at this seam.
  {
    assert.throws(
      () => roundSaleInvoiceTotals({ taxAmount: Number.NaN, total: 1 }, 2),
      /Non-finite/,
    );
    assert.throws(
      () => roundSaleInvoiceTotals({ taxAmount: 1, total: Number.POSITIVE_INFINITY }, 2),
      /Non-finite/,
    );
  }

  // Case 7 — source pin: both call sites in the sale writer use the
  // seam (two computeInvoiceTotals calls per site, create + edit),
  // and the shared totals util is still the one imported.
  {
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/sales/services/sales-write.service.ts'),
      'utf8',
    );
    const seamCalls = source.split('roundSaleInvoiceTotals(').length - 1;
    assert.equal(seamCalls, 4, 'roundSaleInvoiceTotals must wrap all four computeInvoiceTotals calls in the sale writer');
    assert.ok(source.includes("import { computeInvoiceTotals } from '../../../common/utils/invoice-totals'"));
    const helper = readFileSync(
      resolve(__dirname, '../../src/modules/sales/helpers/sales-write.helper.ts'),
      'utf8',
    );
    assert.ok(helper.includes('export function roundSaleInvoiceTotals'));
  }

  // Case 8 — invariant pin: exactly one entry, at the end of the file
  // once the package is applied (checked here against the working
  // tree; the clean-worktree verification re-checks the applied tree).
  {
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-SALE-TAX-BOOK-DIGITS-PRE-ROUND').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('Sale tax book-digits pre-round tests passed');
}

main();
