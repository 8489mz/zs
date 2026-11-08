// @ts-nocheck
/*
 * INV-FE2-FRONTEND-BOOK-DIGITS (U6 FE2): purchases / inventory /
 * import-sales / products / storefront computed money must round at
 * the tenant's / store's book digits, not hardcoded 2dp.
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
 * Before this package the area rounded computed money at hardcoded
 * 2dp (`Number(x.toFixed(2))`, `Math.round(x * 100) / 100`, and the
 * cart-pricing factor from the incomplete `isThreeDecimalCurrency`,
 * which only knew KWD/BHD/OMR) while the backend rounds at the
 * tenant's book digits — so on a 3-decimal tenant (KWD/OMR/BHD/JOD/
 * TND/IQD/LYD) every frontend total disagreed with the posted journal
 * by up to half a fils per leg, and JOD/TND/IQD/LYD tenants were cut
 * to 2dp even by the code that tried to handle 3dp.
 *
 * §13 HONEST CAVEAT: `contracts.ts`, `storefront-cart-pricing.ts`
 * and `storefront-variant-pricing.ts` import production code through
 * the `@/` alias, which plain Node cannot resolve (proven:
 * ERR_MODULE_NOT_FOUND for '@/shared' when importing
 * variant-pricing). So — exactly like FE1's spec sections 6-7 did
 * for splitShares — the call-site shapes below are pinned through
 * the real helper's exact arithmetic, and section 8 pins the real
 * files on disk with source-pattern assertions (each fixed file must
 * contain the helper call and must NOT contain its old hardcoded-2dp
 * snippet). Reverting any file edit fails section 8; reverting the
 * helper fails sections 1-7. The real functions ARE covered by
 * Vitest neighbour specs that CI runs (contracts.test.ts gained a
 * KWD case; storefront-variant-pricing.spec.ts gained a 3dp case).
 *
 * Run with plain Node from `backend/` (NOT ts-node):
 *   `node test/critical/fe2-frontend-book-digits.spec.ts`
 * Node >= 23.6 strips the erasable TS types natively; the `.ts`
 * extensions on the imports below are what ESM resolution needs.
 * It is not in the `test:critical` chain in package.json.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currencyMoneyDigits as backendDigits, roundMoney as backendRoundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine.ts';
import { currencyMoneyDigits, roundMoneyValue } from '../../../frontend/src/shared/utils/money.ts';
import { isThreeDecimalCurrency } from '../../../frontend/src/lib/currencies.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

// 1. The 3-decimal set matches the backend exactly — the set FE2's
// call sites now resolve through (FE1 pinned this too; FE2's package
// depends on it, so it is re-pinned here rather than trusted).
for (const code of ['KWD', 'OMR', 'BHD', 'JOD', 'TND', 'IQD', 'LYD']) {
  assert.equal(currencyMoneyDigits(code), 3, `${code} must be 3dp`);
  assert.equal(backendDigits(code), 3, `backend: ${code} must be 3dp`);
}
for (const code of ['EGP', 'SAR', 'AED', 'USD', 'QAR']) {
  assert.equal(currencyMoneyDigits(code), 2, `${code} must be 2dp`);
  assert.equal(backendDigits(code), 2, `backend: ${code} must be 2dp`);
}
assert.equal(currencyMoneyDigits('kwd'), 3, 'lowercase codes normalize');
assert.equal(currencyMoneyDigits(null), 2, 'missing currency falls back to 2');
assert.equal(currencyMoneyDigits(''), 2, 'empty currency falls back to 2');
assert.throws(() => currencyMoneyDigits('ج.م'), /Invalid currency code/, 'a symbol is not a code — callers must pass the code');

// 2. Rounding parity with the backend on the FE2 shapes' tricky
// inputs, at both book precisions.
for (const value of [0, 1.005, 2.675, 0.125, 100.125, 0.004, 0.005, -1.005, 1234.567, 99.995, 0.1 + 0.2, 42.875]) {
  assert.equal(roundMoneyValue(value, 2), backendRoundMoney(value, 2), `2dp parity for ${value}`);
}
for (const value of [0, 1.0005, 2.6755, 0.0005, 0.0015, 100.1255, -1.0005, 42.8755, 0.12345, 99.9995]) {
  assert.equal(roundMoneyValue(value, 3), backendRoundMoney(value, 3), `3dp parity for ${value}`);
}
assert.equal(roundMoneyValue(100.125, 3), 100.125);
assert.equal(roundMoneyValue(100.125, 2), 100.13);
assert.equal(roundMoneyValue(42.875, 3), 42.875);
assert.equal(roundMoneyValue(42.875, 2), 42.88);

// 3. The cart-pricing factor bug, pinned at runtime: BEFORE FE3,
// `isThreeDecimalCurrency` (lib/currencies.ts) returned false for
// JOD/TND/IQD/LYD, so the old factor rounded those stores at 2dp
// and any cart line priced through it on a JOD tenant lost the
// third decimal. FE3 fixed it (getCurrencyDecimals now knows the
// full 3dp set, and isThreeDecimalCurrency is getCurrencyDecimals
// === 3) — so this section now asserts the FIXED behaviour and
// agrees with FE3's spec §1: reverting currencies.ts to the old
// KWD/BHD/OMR-only set fails here AND in FE3.
for (const code of ['JOD', 'TND', 'IQD', 'LYD']) {
  assert.equal(isThreeDecimalCurrency(code), true, `fixed helper must give ${code} 3dp (FE3)`);
  assert.equal(currencyMoneyDigits(code), 3, `canonical helper must give ${code} 3dp`);
}
for (const code of ['KWD', 'BHD', 'OMR']) {
  assert.equal(isThreeDecimalCurrency(code), true, `helper knew ${code} and still does`);
}

// 4. Real call-site shapes — purchases. The old code used
// `Number((qty * cost).toFixed(2))` for the draft line total and
// `Number(Math.max(0, discount).toFixed(2))` for discount/freight.
// At KWD digits 100.125 keeps its third decimal; at EGP digits it
// rounds to 100.13 — exactly the backend's journal.
assert.equal(roundMoneyValue(3 * 33.375, 3), 100.125, 'KWD draft line total keeps the fils');
assert.equal(roundMoneyValue(3 * 33.375, 2), 100.13, 'EGP draft line total rounds half-up');
assert.equal(roundMoneyValue(Math.max(0, 100.125), 3), 100.125, 'KWD discount keeps the fils');
assert.equal(roundMoneyValue(Math.max(0, 100.125), 2), 100.13, 'EGP discount rounds half-up');
assert.equal(roundMoneyValue(Math.max(0, 100.125), 3), 100.125, 'KWD freight (landedCosts) keeps the fils');

// 5. Real call-site shape — purchase composer tax extraction, the
// same arithmetic the composer and the edit dialog now route
// through the helper. Inclusive extraction and exclusive tax at
// both precisions, matching the backend exactly.
const taxableKwd = 100.125;
const extractedKwd = roundMoneyValue(taxableKwd - taxableKwd / (1 + 15 / 100), 3);
assert.equal(extractedKwd, backendRoundMoney(taxableKwd - taxableKwd / (1 + 15 / 100), 3));
assert.equal(extractedKwd, 13.06);
assert.equal(roundMoneyValue(taxableKwd * (15 / 100), 3), 15.019, 'exclusive KWD tax keeps the third decimal');
assert.equal(roundMoneyValue(100.13 * (15 / 100), 2), 15.02, 'exclusive EGP tax rounds half-up');

// 6. Real call-site shapes — import-sales. PI totals round at the
// PI currency's digits; the EGP-denominated amounts (landed cost,
// SupplierCredit, quotation estimate, shipment suggestion) round
// at EGP digits (2) — the denomination of the amount, never the
// tenant's digits and never a hardcoded 2dp.
assert.equal(roundMoneyValue(10 * 25.03125, 3), 250.313, 'PI line total at a 3dp PI currency');
assert.equal(roundMoneyValue(10 * 25.03125, 2), 250.31, 'PI line total at a 2dp PI currency');
assert.equal(roundMoneyValue(1234.567 / 3, currencyMoneyDigits('EGP')), 411.52, 'unit landed cost EGP');
assert.equal(roundMoneyValue(250.125 * 48.5, currencyMoneyDigits('EGP')), 12131.06, 'SupplierCredit EGP amount');
assert.equal(
  roundMoneyValue((1000 + 200) * 48.5 * (1 + 5 / 100) * 1.14, currencyMoneyDigits('EGP')),
  69665.4,
  'quotation estimated unit landed cost EGP',
);
assert.equal(roundMoneyValue(100.125 * (1 + 20 / 100), currencyMoneyDigits('EGP')), 120.15, 'shipment suggested retail EGP');

// 7. Real call-site shapes — storefront + inventory + table bill.
// Variant price: 550.125 stays at 3dp, rounds to 550.13 at 2dp.
// Cart line: standard (unit x qty), BOGO discounted total and unit
// price, bundle total, subtotal sum — all through the helper, so a
// JOD store's cart keeps the third decimal the old factor dropped.
// Coupon offline fallback: 10% of the subtotal at book digits.
// Stock-count money summary legs and the table-bill total (+ tip)
// round at the bill currency's digits.
assert.equal(roundMoneyValue(550.125, 3), 550.125, 'variant price at 3dp');
assert.equal(roundMoneyValue(550.125, 2), 550.13, 'variant price at 2dp');
assert.equal(roundMoneyValue(550.125, 3), backendRoundMoney(550.125, 3));
const cartUnitJod = 12.345;
assert.equal(roundMoneyValue(cartUnitJod * 2, 3), 24.69, 'JOD standard line total');
assert.equal(roundMoneyValue(cartUnitJod * 2, 2), 24.69, 'EGP standard line total (same here)');
const bogoTotal = roundMoneyValue(Math.max(0, 3 * cartUnitJod - 1 * cartUnitJod * (100 / 100)), 3);
assert.equal(bogoTotal, 24.69, 'BOGO discounted total at 3dp');
assert.equal(roundMoneyValue(bogoTotal / 3, 3), 8.23, 'BOGO unit price at 3dp');
assert.equal(roundMoneyValue((2 * 20.005) + (1 * cartUnitJod), 3), 52.355, 'bundle total at 3dp');
assert.equal(roundMoneyValue(24.69 + 52.355, 3), 77.045, 'cart subtotal sums rounded legs at 3dp');
assert.equal(roundMoneyValue(100.125 * 0.1, 3), 10.013, 'coupon fallback discount at 3dp');
assert.equal(roundMoneyValue(100.125 * 0.1, 2), 10.01, 'coupon fallback discount at 2dp');
assert.equal(roundMoneyValue(1000.125 + 250.5, 3), 1250.625, 'stock-count expected value at 3dp');
assert.equal(roundMoneyValue((100.125 + 10.005), currencyMoneyDigits('KWD')), 110.13, 'table-bill total + tip at KWD digits');
assert.equal(roundMoneyValue((100.125 + 10.005), currencyMoneyDigits('EGP')), 110.13, 'table-bill total + tip at EGP digits');

// 8. Source-pattern assertions — the real fail-without-fix. Each
// fixed file must route through the helper AND must not contain its
// old hardcoded-2dp snippet. Reverting any file edit below fails
// this section even though sections 1-7 still pass (the helper is
// unchanged by a revert), which is exactly the tripwire FE2 needs.
// Files with display-only toFixed(2) left in place (PurchaseEdit-
// Dialog :223, ContainerAutopsyModal :295, SupplierCredit rates)
// are pinned by their exact OLD COMPUTED snippet, not by a blanket
// "no toFixed(2)" — the display sites are out of scope by design.
const F = 'frontend/src/features/';
const checks = [
  // [file, mustContain, mustNotContain]
  [`${F}purchases/contracts.ts`, 'digits: MoneyDigits', 'total: Number((safeQty * safeCost).toFixed(2)),'],
  [`${F}purchases/contracts.ts`, 'roundMoneyValue(safeQty * safeCost, digits)', 'total: Number((mergedQty * incoming.cost).toFixed(2))'],
  [`${F}purchases/contracts.ts`, 'roundMoneyValue(Math.max(0, Number(values.discount || 0)), digits)', 'const discount = Number(Math.max(0, Number(values.discount || 0)).toFixed(2));'],
  [`${F}purchases/contracts.ts`, 'roundMoneyValue(Math.max(0, Number(values.freight || 0)), digits)', 'const freight = Number(Math.max(0, Number(values.freight || 0)).toFixed(2));'],
  [`${F}purchases/hooks/useCreatePurchaseMutation.ts`, "currencyMoneyDigits(values.currency || getGlobalSystemCurrency())", 'buildPurchasePayload(values, items, taxRate, pricesIncludeTax, attachments)'],
  [`${F}purchases/hooks/usePurchaseActions.ts`, 'currencyMoneyDigits(getGlobalSystemCurrency())', 'buildPurchaseUpdatePayload(purchase, payload)'],
  [`${F}purchases/components/purchase-composer/usePurchaseComposerController.ts`, 'roundMoneyValue(taxable - taxable / (1 + taxRate / 100), bookDigits)', 'return Number((taxable - taxable / (1 + taxRate / 100)).toFixed(2));'],
  [`${F}purchases/components/purchase-composer/usePurchaseComposerController.ts`, 'buildPurchaseDraftItem(product, parsed.qty, parsed.cost, bookDigits)', 'buildPurchaseDraftItem(product, parsed.qty, parsed.cost)'],
  [`${F}purchases/components/PurchaseEditDialog.tsx`, 'roundMoneyValue(items.reduce((sum, item) => sum + item.qty * item.cost, 0), bookDigits)', 'Number(items.reduce((sum, item) => sum + item.qty * item.cost, 0).toFixed(2))'],
  [`${F}purchases/components/MarginProtectionModal.tsx`, 'roundMoneyValue(item.newCost / (1 - (targetMargin / 100)), bookDigits)', 'Number((item.newCost / (1 - (targetMargin / 100))).toFixed(2))'],
  [`${F}inventory/components/sections/stockCountMonitor.helpers.ts`, 'roundMoneyValue(expectedValue, digits)', 'expectedValue: Number(expectedValue.toFixed(2)),'],
  [`${F}inventory/components/sections/StockCountMonitorCard.tsx`, 'summarizeSessionVariance(selectedSession, products, bookDigits)', 'summarizeSessionVariance(selectedSession, products)'],
  [`${F}import-sales/ContainerAutopsyModal.tsx`, "roundMoneyValue(Number(item.landed_cost_egp) / Number((item.received_quantity ?? item.quantity) || 1), currencyMoneyDigits('EGP'))", 'Number((Number(item.landed_cost_egp) / Number((item.received_quantity ?? item.quantity) || 1)).toFixed(2))'],
  [`${F}import-sales/SupplierCredit.tsx`, "roundMoneyValue(remaining * rate, currencyMoneyDigits('EGP'))", 'setAmountEgp(String(Number((remaining * rate).toFixed(2))));'],
  [`${F}import-sales/components/ChinaProformasTab.tsx`, 'roundMoneyValue(computedLinesTotal, currencyMoneyDigits(currency))', 'Number(computedLinesTotal.toFixed(2))'],
  [`${F}import-sales/components/ChinaQuotationsTab.tsx`, "currencyMoneyDigits('EGP')", 'const estimatedUnitLandedCostEgp = Number('],
  [`${F}import-sales/ShipmentDetailsPage.tsx`, "roundMoneyValue(pricingCostEgp * (1 + (Number(wholesaleMargin) || 0) / 100), currencyMoneyDigits('EGP'))", 'Math.round((pricingCostEgp * (1 + (Number(wholesaleMargin) || 0) / 100)) * 100) / 100'],
  [`${F}products/components/NewProductForm.tsx`, "roundMoneyValue(newRetail, bookDigits)", "form.setValue('retailPrice', Number(newRetail.toFixed(2))"],
  [`${F}products/components/ProductArchiveConfirmDialog.tsx`, 'roundMoneyValue(currentStock * unitCost, currencyMoneyDigits(getGlobalSystemCurrency()))', 'const totalCost = Number((currentStock * unitCost).toFixed(2));'],
  [`${F}storefront/api/storefront.api.ts`, 'roundMoneyValue(subtotal * 0.1, digits)', 'const discountAmount = Math.round(subtotal * 0.1 * 100) / 100;'],
  [`${F}storefront/lib/storefront-variant-pricing.ts`, 'roundMoneyValue(price, digits)', 'Math.round'],
  [`${F}storefront/lib/storefront-cart-pricing.ts`, 'roundMoneyValue(basePrice * qty, digits)', 'function getCartRoundFactor'],
  [`${F}storefront/lib/storefront-cart-pricing.ts`, 'roundMoneyValue(basePrice * qty, digits)', 'isThreeDecimalCurrency('],
  [`${F}storefront/lib/storefront-cart-pricing.ts`, 'roundMoneyValue(basePrice * qty, digits)', 'Math.round(basePrice * qty * factor) / factor'],
  [`${F}storefront/components/StorefrontCheckoutModal.tsx`, 'validateCoupon(tenantSlug, cleanCode, subtotal, currencyMoneyDigits(info?.currency || getGlobalSystemCurrency()))', 'validateCoupon(tenantSlug, cleanCode, subtotal)'],
  [`${F}storefront/components/StorefrontCheckoutModal.tsx`, 'calculateCartSubtotal(cartItems, info?.currency)', 'calculateCartSubtotal(cartItems)'],
  [`${F}storefront/components/StorefrontProductQuickViewModal.tsx`, 'resolveVariantUnitPrice(product.price, selectedVariant, bookDigits)', 'resolveVariantUnitPrice(product.price, selectedVariant)'],
  [`${F}storefront/hooks/usePublicStorefront.ts`, 'buildCartProduct(activeProductMap.get(String(item.product.id))!, item.product.variantName, bookDigits)', 'buildCartProduct(activeProductMap.get(String(item.product.id))!, item.product.variantName)'],
  [`${F}storefront/hooks/usePublicStorefront.ts`, 'calculateCartSubtotal(cartItems, infoQuery.data?.currency)', 'calculateCartSubtotal(cartItems)'],
  [`${F}storefront/components/TableBillModal.tsx`, "roundMoneyValue((bill?.total || 0) + tipAmount, currencyMoneyDigits(bill?.currency || getGlobalSystemCurrency()))", 'Math.round(((bill?.total || 0) + tipAmount) * 100) / 100'],
];
for (const [file, mustContain, mustNotContain] of checks) {
  const content = read(file);
  assert.ok(content.includes(mustContain), `${file} must route through the helper: missing ${JSON.stringify(mustContain)}`);
  assert.ok(!content.includes(mustNotContain), `${file} still contains the old hardcoded-2dp code: ${JSON.stringify(mustNotContain)}`);
}

console.log('FE2 frontend book-digits proof passed');
