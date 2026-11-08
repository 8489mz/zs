// @ts-nocheck
/*
 * INV-FE3-FRONTEND-BOOK-DIGITS (U6 FE3): the frontend's computed money
 * must round at the tenant's book digits — and the currency-to-digits
 * mapping the whole frontend reads must know the full 3-decimal set.
 *
 * NOTE on the @ts-nocheck above: this spec runs under plain Node, not
 * ts-node, because the frontend package is ESM ("type": "module") and
 * ts-node's CJS loader refuses it — so its imports MUST carry the
 * explicit `.ts` extensions Node ESM resolution needs. The backend
 * tsconfig (CommonJS, no allowImportingTsExtensions) rejects exactly
 * those extensions (TS5097), so type-checking this file would fail
 * the repo typecheck on import syntax alone. The file's value is its
 * runtime assertions (it imports the real helper, the real
 * `getCurrencyDecimals`, and the real backend engine and executes
 * them); a passing run proves it, no type checking of the spec file
 * itself is needed. Do NOT "fix" this by dropping the extensions
 * (plain Node would fail to resolve) or by moving the spec under
 * ts-node (CJS require of the ESM helper fails).
 *
 * Before this package the frontend computed money at hardcoded 2dp
 * (`Number(x.toFixed(2))`, `Math.round(x * 100) / 100`) in reports,
 * accounting, settings, accounts, maritime, contracting, HR and
 * pharmacy — journal lines, statement balances, opening balances,
 * settlement payouts, retention releases, BOQ prices, loan
 * remainders, strip prices — while the backend rounds at the tenant's
 * book digits. On a 3-decimal tenant (KWD/OMR/BHD/JOD/TND/IQD/LYD)
 * every one of those values lost its third decimal, and the
 * marketplace settlement form could never reconcile at all (it
 * hardcoded currency 'EGP'). Worse, `getCurrencyDecimals` in
 * `lib/currencies.ts` only knew KWD/BHD/OMR, so even the display
 * helpers that read it formatted JOD/TND/IQD/LYD tenants at 2dp.
 * This spec pins the fix: (1) `getCurrencyDecimals` returns 3 for
 * the full 3-decimal set and never throws (display formatting must
 * not throw); (2) the frontend helper still matches the backend
 * engine on the values FE3's call sites compute; (3) the real
 * call-site shapes — settlement identity, retention release, price
 * from margin, strip price, loan remainder, daily average, workbook
 * total, journal legs, cash-custody difference — keep their third
 * decimal at 3dp and match the backend exactly.
 *
 * Run with plain Node from `backend/` (NOT ts-node: the frontend
 * package is ESM, so ts-node's CJS loader refuses it):
 *   `node test/critical/fe3-frontend-book-digits.spec.ts`
 * Node >= 23.6 strips the erasable TS types natively; the `.ts`
 * extensions on the imports below are what ESM resolution needs.
 * It is not in the `test:critical` chain in package.json.
 */

import assert from 'node:assert/strict';
import { currencyMoneyDigits as backendDigits, roundMoney as backendRoundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine.ts';
import { currencyMoneyDigits, roundMoneyValue } from '../../../frontend/src/shared/utils/money.ts';
import { getCurrencyDecimals, isThreeDecimalCurrency } from '../../../frontend/src/lib/currencies.ts';

// 1. The handoff fix: `getCurrencyDecimals` knows the FULL 3-decimal
// set. The old inline list only knew KWD/BHD/OMR — JOD/TND/IQD/LYD
// returned 2, so every display helper (and `useSystemCurrency`)
// formatted those tenants at 2dp. This section fails on the old code.
for (const code of ['KWD', 'OMR', 'BHD', 'JOD', 'TND', 'IQD', 'LYD']) {
  assert.equal(getCurrencyDecimals(code), 3, `${code} must be 3dp`);
  assert.equal(isThreeDecimalCurrency(code), true, `${code} must be three-decimal`);
  assert.equal(currencyMoneyDigits(code), 3, `helper: ${code} must be 3dp`);
  assert.equal(backendDigits(code), 3, `backend: ${code} must be 3dp`);
}
for (const code of ['EGP', 'SAR', 'AED', 'USD', 'QAR']) {
  assert.equal(getCurrencyDecimals(code), 2, `${code} must be 2dp`);
  assert.equal(isThreeDecimalCurrency(code), false, `${code} must not be three-decimal`);
}
assert.equal(getCurrencyDecimals(null), 2, 'missing currency falls back to 2 (settings loading)');
assert.equal(getCurrencyDecimals(undefined), 2, 'missing currency falls back to 2');
assert.equal(getCurrencyDecimals(''), 2, 'empty currency falls back to 2');
assert.equal(getCurrencyDecimals('kwd'), 3, 'lowercase codes normalize');
// Display formatting must never throw, so unlike the helper a
// malformed code falls back to 2 instead of failing closed.
assert.equal(getCurrencyDecimals('XX'), 2, 'malformed code falls back to 2, never throws');
assert.equal(getCurrencyDecimals('EGPX'), 2, 'malformed code falls back to 2, never throws');

// 2. Helper <-> backend parity on the values FE3's call sites compute
// (the full battery lives in FE1's spec; this pins the FE3 shapes).
const tricky2dp = [0, 1.005, 2.675, 0.125, 100.125, 0.004, 0.005, 42.875, 7.125, 0.1 + 0.2, 50.0625, 117.794];
for (const value of tricky2dp) {
  assert.equal(roundMoneyValue(value, 2), backendRoundMoney(value, 2), `2dp parity for ${value}`);
}
const tricky3dp = [0, 1.0005, 2.6755, 0.0005, 0.0015, 100.1255, 0.12345, 50.0625, 117.7941, 12.5156, 33.375, 82.121];
for (const value of tricky3dp) {
  assert.equal(roundMoneyValue(value, 3), backendRoundMoney(value, 3), `3dp parity for ${value}`);
}

// 3. Real call-site shapes. Each mirrors a fixed site's exact formula
// and asserts the third decimal survives at 3dp — the old hardcoded
// 2dp code produced the 2dp value shown in the companion assertion,
// so a revert of any site to 2dp changes the pinned value.
const D3 = 3;
const D2 = 2;

// 3a. Marketplace settlement (SettingsMarketplacesSection): net payout
// is gross minus the four fee legs, and the double-entry check is an
// EXACT identity at book digits. At 2dp the net lost a fils (82.12
// instead of 82.121) and the old < 0.05 tolerance hid the imbalance.
const gross = 100.125;
const fees = [10.001, 5.001, 2.001, 1.001];
const netPayout = roundMoneyValue(gross - fees.reduce((a, b) => a + b, 0), D3);
assert.equal(netPayout, 82.121);
assert.equal(roundMoneyValue(gross - fees.reduce((a, b) => a + b, 0), D2), 82.12, 'old 2dp net differs');
const totalDebit = roundMoneyValue(netPayout + fees.reduce((a, b) => a + b, 0), D3);
const totalCredit = roundMoneyValue(gross, D3);
assert.equal(totalDebit, totalCredit, 'settlement must balance exactly at book digits');
assert.equal(totalDebit, backendRoundMoney(netPayout + fees.reduce((a, b) => a + b, 0), D3));

// 3b. Retention release (ProjectHandoverModal): the old code used
// Math.round, i.e. WHOLE units — a 500.25 release posted as 500.
const release = roundMoneyValue((1000.5 * 50) / 100, D3);
assert.equal(release, 500.25);
assert.notEqual(release, Math.round((1000.5 * 50) / 100), 'integer rounding must not apply');
assert.equal(roundMoneyValue((100.125 * 50) / 100, D3), 50.063);
assert.equal(roundMoneyValue((100.125 * 50) / 100, D3), backendRoundMoney((100.125 * 50) / 100, D3));

// 3c. Price from margin (UniversalBoqItemModal.calculatePriceFromMargin):
// cost / (1 - margin). At 3dp the price keeps its third decimal.
const priceFromMargin = roundMoneyValue(100.125 / (1 - 15 / 100), D3);
assert.equal(priceFromMargin, 117.794);
assert.equal(roundMoneyValue(100.125 / (1 - 15 / 100), D2), 117.79, 'old 2dp price differs');
assert.equal(priceFromMargin, backendRoundMoney(100.125 / (1 - 15 / 100), D3));

// 3d. Strip price (PharmacyDrugFormModal): box price / units per box.
const stripPrice = roundMoneyValue(100.125 / 8, D3);
assert.equal(stripPrice, 12.516);
assert.equal(roundMoneyValue(100.125 / 8, D2), 12.52, 'old 2dp strip price differs');

// 3e. Loan installment remainder (hr-api.normalizers): amount - paid.
const remaining = roundMoneyValue(500.125 - 200, D3);
assert.equal(remaining, 300.125);
assert.equal(roundMoneyValue(500.125 - 200, D2), 300.13, 'old 2dp remainder differs');

// 3f. Daily average (useReportsWorkspaceMetrics): net sales / days.
const dailyAverage = roundMoneyValue(1001.25 / 30, D3);
assert.equal(dailyAverage, 33.375);
assert.equal(roundMoneyValue(1001.25 / 30, D2), 33.38, 'old 2dp average differs');

// 3g. Workbook total (originalWorkbookPricer / ImportBoqModal):
// qty x unit price.
const workbookTotal = roundMoneyValue(3 * 33.375, D3);
assert.equal(workbookTotal, 100.125);
assert.equal(roundMoneyValue(3 * 33.375, D2), 100.13, 'old 2dp total differs');

// 3h. Journal legs (ManualJournalEntryDialog): each posted line rounds
// at book digits, then the legs sum — two 50.0625 legs make 100.126,
// not the 100.12 the old 2dp code posted.
const leg = roundMoneyValue(50.0625, D3);
assert.equal(leg, 50.063);
assert.equal(roundMoneyValue(leg + leg, D3), 100.126);

// 3i. Cash-custody difference (HrAssetsPage / hr-assets.helpers):
// amount - spent - returned. A 0.001 difference is real at 3dp and
// must trip the needs-review gate; the old 2dp code rounded it to 0
// and the old > 0.009 threshold missed it as well.
const cashDifference = roundMoneyValue(100.125 - 50 - 50.124, D3);
assert.equal(cashDifference, 0.001);
assert.ok(Math.abs(cashDifference) > 0, 'any nonzero difference is real at book digits');
assert.equal(roundMoneyValue(100.125 - 50 - 50.124, D2), 0, 'old 2dp difference vanished');

// 3j. Split of a 3dp amount (CostCenterAllocationsTab share): a 33.375
// share is exact at 3dp, and three of them sum to the total exactly.
const share = roundMoneyValue(100.125 / 3, D3);
assert.equal(share, 33.375);
assert.equal(roundMoneyValue(share * 3, D3), 100.125);

console.log('FE3 frontend book-digits (computed money + getCurrencyDecimals) passed');
