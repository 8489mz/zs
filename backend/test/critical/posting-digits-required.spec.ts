/*
New file: backend/test/critical/posting-digits-required.spec.ts
Pins money unification package 1 (INV-POSTING-DIGITS-REQUIRED):
no silent 2dp default anywhere on the posting boundary. The
posting service's private toMoney, maxAllowedDifference, and
addLine all took digits with a `= 2` default, so any posting
method that forgot to pass the tenant's book digits silently
rounded its journal lines to 2dp. Three methods did exactly
that — postService, postManufacturingWorkOrder, and
postWithholdingTaxRemittance — each deriving bookDigits and
defining toBookMoney yet calling addLine without it. The
defaults are gone: tsc now rejects any call that omits digits
(the removal itself surfaced all 12 silent sites, now fixed),
and this spec pins the runtime contract those sites rely on.

WHAT THIS PINS, driving the REAL private helpers:
- toMoney rounds at the GIVEN digits: 10.125 stays 10.125 at
  3dp and becomes 10.13 at 2dp; non-finite input fails closed.
- addLine rounds and merges at the GIVEN digits: two 10.125
  lines at 3dp merge to 20.25, never to a 2dp rounding.
- maxAllowedDifference is 0.001 at 3dp and 0.01 at 2dp.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function main(): Promise<void> {
  const svc: any = Object.create(AccountingPostingService.prototype);

  // toMoney honors the given digits.
  assert.equal(svc.toMoney(10.125, 3), 10.125);
  assert.equal(svc.toMoney(10.125, 2), 10.13);
  assert.equal(svc.toMoney(10.124, 3), 10.124);
  assert.equal(svc.toMoney('7.5', 2), 7.5);
  assert.throws(() => svc.toMoney(Number.NaN, 3), /INVALID_JOURNAL_AMOUNT/);

  // maxAllowedDifference follows the given digits.
  assert.equal(svc.maxAllowedDifference(3), 0.001);
  assert.equal(svc.maxAllowedDifference(2), 0.01);

  // addLine rounds and merges at the given digits.
  const line = {
    accountId: 1,
    description: 'test',
    debit: 10.125,
    credit: 0,
    partnerType: 'none',
    partnerId: null,
    branchId: null,
    locationId: null,
  };
  const lines3: any[] = [];
  svc.addLine(lines3, { ...line }, 3);
  assert.equal(lines3.length, 1);
  assert.equal(lines3[0].debit, 10.125);
  svc.addLine(lines3, { ...line }, 3);
  assert.equal(lines3.length, 1);
  assert.equal(lines3[0].debit, 20.25);

  const lines2: any[] = [];
  svc.addLine(lines2, { ...line }, 2);
  assert.equal(lines2[0].debit, 10.13);

  // A both-sides line still fails closed, at any digits.
  assert.throws(() => svc.addLine([], { ...line, debit: 5, credit: 5 }, 3), /INVALID_JOURNAL_LINE/);

  console.log('Posting digits required tests passed.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
