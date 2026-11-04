import { strict as assert } from 'node:assert';
import { AppError } from '../../src/common/errors/app-error';
import { ensureUniqueFlowItems } from '../../src/common/utils/financial-integrity';
import { normalizeSalePayload } from '../../src/modules/sales/helpers/sales-payload.helper';

/*
 * Duplicate lines (INV-SPIRIT-DUPLICATE-LINES).
 *
 * THE RIGIDITY: two lines for the same product and unit at different
 * prices were rejected outright, so a sale mixing a retail line and a
 * wholesale line for one product (the POS cart keeps one line per
 * price type) failed as a whole document.
 *
 * THE FIX: only an exact duplicate — same product, unit AND price —
 * is rejected. The price segment reads the caller's own field
 * (`price` on sale lines, `cost` on purchase lines); callers without
 * a price (stock transfers, line-id returns) keep the previous
 * product-and-unit identity.
 *
 * REMAINDER GROUNDING (why two price lines cannot break remainder
 * math): the COGS remainder residual groups sale lines by product and
 * FROZEN COST (sale_items.cost_price in
 * accounting-posting.service residualCogsGroups), never by selling
 * price, so two price lines for one product aggregate into one cost
 * group exactly as two same-price lines do. No separate-group
 * handling is needed; this spec pins the gate, and the existing
 * COGS remainder specs pin the grouping.
 */

function expectCode(fn: () => void, code: string): void {
  let caught: unknown;
  try { fn(); } catch (error) { caught = error; }
  assert.ok(caught, `expected AppError(${code})`);
  assert.ok(caught instanceof AppError);
  assert.equal((caught as AppError).code, code);
}

async function main(): Promise<void> {
  // Sale lines: same product + unit at different prices pass.
  ensureUniqueFlowItems([
    { productId: 1, qty: 2, unitMultiplier: 1, price: 100 },
    { productId: 1, qty: 1, unitMultiplier: 1, price: 80 },
  ], 'SALE_DUPLICATE_PRODUCT', 'duplicate');

  // Sale lines: an exact duplicate (same product, unit, price) still throws.
  expectCode(() => ensureUniqueFlowItems([
    { productId: 1, qty: 2, unitMultiplier: 1, price: 100 },
    { productId: 1, qty: 1, unitMultiplier: 1, price: 100 },
  ], 'SALE_DUPLICATE_PRODUCT', 'duplicate'), 'SALE_DUPLICATE_PRODUCT');

  // Different units still pass even at the same price.
  ensureUniqueFlowItems([
    { productId: 1, qty: 2, unitMultiplier: 1, price: 100 },
    { productId: 1, qty: 1, unitMultiplier: 12, price: 100 },
  ], 'SALE_DUPLICATE_PRODUCT', 'duplicate');

  // Purchase lines use `cost`: different costs pass, same cost throws.
  ensureUniqueFlowItems([
    { productId: 1, qty: 2, unitMultiplier: 1, cost: 50 },
    { productId: 1, qty: 1, unitMultiplier: 1, cost: 55 },
  ], 'PURCHASE_DUPLICATE_PRODUCT', 'duplicate');
  expectCode(() => ensureUniqueFlowItems([
    { productId: 1, qty: 2, unitMultiplier: 1, cost: 50 },
    { productId: 1, qty: 1, unitMultiplier: 1, cost: 50 },
  ], 'PURCHASE_DUPLICATE_PRODUCT', 'duplicate'), 'PURCHASE_DUPLICATE_PRODUCT');

  // Transfer lines carry no price: the previous identity is unchanged.
  ensureUniqueFlowItems([
    { productId: 1, qty: 2, unitMultiplier: 1 },
    { productId: 1, qty: 1, unitMultiplier: 2 },
  ], 'TRANSFER_DUPLICATE_PRODUCT', 'duplicate');
  expectCode(() => ensureUniqueFlowItems([
    { productId: 1, qty: 2, unitMultiplier: 1 },
    { productId: 1, qty: 1, unitMultiplier: 1 },
  ], 'TRANSFER_DUPLICATE_PRODUCT', 'duplicate'), 'TRANSFER_DUPLICATE_PRODUCT');

  // Line-id identity (returns) takes precedence over price.
  expectCode(() => ensureUniqueFlowItems([
    { productId: 1, qty: 1, lineId: 7, price: 100 },
    { productId: 1, qty: 1, lineId: 7, price: 80 },
  ], 'RETURN_DUPLICATE_PRODUCT', 'duplicate'), 'RETURN_DUPLICATE_PRODUCT');
  ensureUniqueFlowItems([
    { productId: 1, qty: 1, lineId: 7, price: 100 },
    { productId: 1, qty: 1, lineId: 8, price: 100 },
  ], 'RETURN_DUPLICATE_PRODUCT', 'duplicate');

  // End-to-end through the real sale normalizer: a retail line and a
  // wholesale line for one product normalize with their prices intact
  // and pass the gate together.
  const normalized = normalizeSalePayload({
    paymentType: 'cash',
    items: [
      { productId: 1, qty: 2, price: 100, priceType: 'retail' },
      { productId: 1, qty: 1, price: 80, priceType: 'wholesale' },
    ],
  } as any);
  assert.equal(normalized.items.length, 2);
  assert.equal(normalized.items[0].price, 100);
  assert.equal(normalized.items[1].price, 80);
  ensureUniqueFlowItems(normalized.items as any, 'SALE_DUPLICATE_PRODUCT', 'duplicate');

  console.log('duplicate-lines checks passed');
}

main();
