// @ts-nocheck
/*
 * INV-FE1-FRONTEND-BOOK-DIGITS (U6 FE1): the frontend canonical money
 * helper must round exactly like the backend canonical engine.
 *
 * NOTE on the @ts-nocheck above: this spec runs under plain Node, not
 * ts-node, because the frontend package is ESM ("type": "module") and
 * ts-node's CJS loader refuses it — so its imports MUST carry the
 * explicit `.ts` extensions Node ESM resolution needs. The backend
 * tsconfig (CommonJS, no allowImportingTsExtensions) rejects exactly
 * those extensions (TS5097), so type-checking this file would fail
 * the repo typecheck on import syntax alone. The file's value is its
 * runtime assertions (it imports the real helper + the real backend
 * engine and executes them); a passing run proves it, no type
 * checking of the spec file itself is needed. Do NOT "fix" this by
 * dropping the extensions (plain Node would fail to resolve) or by
 * moving the spec under ts-node (CJS require of the ESM helper fails).
 *
 * Before this package the frontend rounded money at hardcoded 2dp
 * (`Number(x.toFixed(2))`, `Math.round(x * 100) / 100`, local
 * `roundMoney`/`toMoney` helpers) while the backend rounds at the
 * tenant's book digits — so on a 3-decimal tenant (KWD/OMR/BHD/JOD/
 * TND/IQD/LYD) every frontend total disagreed with the posted journal
 * by up to half a fils per leg. This spec pins the fix: the frontend
 * helper in `frontend/src/shared/utils/money.ts` must produce
 * byte-identical results to `money-minor-units.engine.ts` for the
 * same inputs, including the full 3-decimal currency set (the old
 * frontend `getCurrencyDecimals` only knew KWD/BHD/OMR) and the
 * fail-closed errors. It also pins the two real call-site shapes
 * that used to hardcode 2dp: the POS inclusive-tax extraction and
 * the split-bill last-share remainder (shares must sum to the total
 * at book digits).
 *
 * Run with plain Node from `backend/` (NOT ts-node: the frontend
 * package is ESM, so ts-node's CJS loader refuses it):
 *   `node test/critical/fe1-frontend-book-digits.spec.ts`
 * Node >= 23.6 strips the erasable TS types natively; the `.ts`
 * extensions on the imports below are what ESM resolution needs.
 * It is not in the `test:critical` chain in package.json.
 */

import assert from 'node:assert/strict';
import { currencyMoneyDigits as backendDigits, roundMoney as backendRoundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine.ts';
import { currencyMoneyDigits, roundMoneyValue } from '../../../frontend/src/shared/utils/money.ts';

// 1. The 3-decimal set matches the backend exactly — including the
// currencies the old frontend `getCurrencyDecimals` missed.
for (const code of ['KWD', 'OMR', 'BHD', 'JOD', 'TND', 'IQD', 'LYD']) {
  assert.equal(currencyMoneyDigits(code), 3, `${code} must be 3dp`);
  assert.equal(backendDigits(code), 3, `backend: ${code} must be 3dp`);
}
for (const code of ['EGP', 'SAR', 'AED', 'USD', 'QAR']) {
  assert.equal(currencyMoneyDigits(code), 2, `${code} must be 2dp`);
  assert.equal(backendDigits(code), 2, `backend: ${code} must be 2dp`);
}
assert.equal(currencyMoneyDigits('kwd'), 3, 'lowercase codes normalize');
assert.equal(currencyMoneyDigits(null), 2, 'missing currency falls back to 2 (settings loading)');
assert.equal(currencyMoneyDigits(undefined), 2, 'missing currency falls back to 2');
assert.equal(currencyMoneyDigits(''), 2, 'empty currency falls back to 2');
assert.throws(() => currencyMoneyDigits('XX'), /Invalid currency code/);
assert.throws(() => currencyMoneyDigits('EGPX'), /Invalid currency code/);

// 2. Rounding parity with the backend on a battery of tricky floats,
// at both book precisions. Any divergence here is a live defect: the
// frontend total would print/post a different number than the journal.
const tricky2dp = [0, 1, 1.005, 2.675, 0.125, 10.115, 100.125, 0.004, 0.005, 0.015, -1.005, -2.675, 1234.567, 99.995, 0.335, 250.555, 1.2345, 0.1 + 0.2, 42.875, 7.125, 0.045, 999.999];
for (const value of tricky2dp) {
  assert.equal(roundMoneyValue(value, 2), backendRoundMoney(value, 2), `2dp parity for ${value}`);
}
const tricky3dp = [0, 1.0005, 2.6755, 0.0005, 0.0015, 10.1155, 100.1255, -1.0005, 42.8755, 0.12345, 99.9995, 1.23456, 0.0004, 7.1255, 250.5555];
for (const value of tricky3dp) {
  assert.equal(roundMoneyValue(value, 3), backendRoundMoney(value, 3), `3dp parity for ${value}`);
}

// 3. Pinned exact values (not just agreement): the old 2dp code
// truncated these on a 3-decimal tenant, and the old mixed 2dp/3dp
// POS totals left 3dp dust on a 2-decimal tenant.
assert.equal(roundMoneyValue(100.125, 3), 100.125);
assert.equal(roundMoneyValue(100.125, 2), 100.13);
assert.equal(roundMoneyValue(100.124, 2), 100.12);
assert.equal(roundMoneyValue(42.875, 3), 42.875);
assert.equal(roundMoneyValue(42.875, 2), 42.88);
assert.equal(roundMoneyValue(0.0005, 3), 0.001);
assert.equal(roundMoneyValue(0.0004, 3), 0);
assert.equal(roundMoneyValue(-100.125, 3), -100.125);
assert.equal(roundMoneyValue(100.125, 2), backendRoundMoney(100.125, 2));

// 4. Fail-closed, like the backend.
assert.throws(() => roundMoneyValue(Number.NaN, 2), /Non-finite/);
assert.throws(() => roundMoneyValue(Number.POSITIVE_INFINITY, 3), /Non-finite/);
assert.throws(() => roundMoneyValue(1.23, 4 as never), /digits must be 2 or 3/);
assert.throws(() => roundMoneyValue(Number.MAX_SAFE_INTEGER, 2), /safe range/);

// 5. Idempotence: re-rounding an already-rounded total is a no-op,
// so call sites that defensively re-round cannot drift the value.
assert.equal(roundMoneyValue(roundMoneyValue(100.125, 3), 3), 100.125);
assert.equal(roundMoneyValue(roundMoneyValue(100.13, 2), 2), 100.13);

// 6. Real call-site shape 1 — POS inclusive-tax extraction (the old
// code used toFixed(2) here in one branch and toFixed(3) in the
// other, so the same cart printed two different totals). At KWD
// digits the extracted tax keeps its third decimal; at EGP digits
// it matches the backend's 2dp journal exactly.
const baseBeforeTax = 100.125;
const taxRate = 15;
const extractedKwd = roundMoneyValue(baseBeforeTax - baseBeforeTax / (1 + taxRate / 100), 3);
assert.equal(extractedKwd, backendRoundMoney(baseBeforeTax - baseBeforeTax / (1 + taxRate / 100), 3));
assert.equal(extractedKwd, 13.06);
const extractedEgp = roundMoneyValue(100.13 - 100.13 / (1 + taxRate / 100), 2);
assert.equal(extractedEgp, backendRoundMoney(100.13 - 100.13 / (1 + taxRate / 100), 2));
assert.equal(extractedEgp, 13.06);

// 7. Real call-site shape 2 — split-bill shares: every guest but the
// last pays the rounded share, the last pays the remainder, so the
// shares sum to the total EXACTLY at book digits (no penny lost or
// created). The old 2dp code leaked the remainder on 3-decimal tenants.
function splitShares(total: number, count: number, digits: 2 | 3): number[] {
  const perGuest = roundMoneyValue(total / count, digits);
  const shares: number[] = [];
  let allocated = 0;
  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    const amt = isLast ? roundMoneyValue(total - allocated, digits) : perGuest;
    allocated = roundMoneyValue(allocated + amt, digits);
    shares.push(amt);
  }
  return shares;
}
assert.deepEqual(splitShares(100.125, 3, 3), [33.375, 33.375, 33.375]);
assert.deepEqual(splitShares(100.13, 3, 2), [33.38, 33.38, 33.37]);
assert.deepEqual(splitShares(10, 3, 2), [3.33, 3.33, 3.34]);
for (const [total, count, digits] of [[100.125, 3, 3], [100.13, 3, 2], [10, 3, 2], [7.125, 2, 3]] as Array<[number, number, 2 | 3]>) {
  const shares = splitShares(total, count, digits);
  assert.equal(roundMoneyValue(shares.reduce((a, b) => a + b, 0), digits), roundMoneyValue(total, digits), `shares must sum to ${total} at ${digits}dp`);
}

console.log('FE1 frontend book-digits helper parity passed');
