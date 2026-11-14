/*
 * SPICE-PKG8 (INV-THREE-WAY-PAYMENT-SPLIT): the trial E-block sale
 * (cash + Visa + wallet, 200/200/200 on a 600 total) could not be
 * recorded because the checkout dialog rendered only one shared
 * second input — the sale writer itself never capped the legs.
 * This pins the writer side of that fix, driving the real pure
 * engine (sale-tender.engine.ts, imported identically by
 * sales-write.service.ts):
 *
 * - allocateSaleTenders accepts three legs and applies all three,
 *   summing exactly to the invoice total with zero change;
 * - a piastre-exact split (200.33 + 200.33 + 199.34 = 600.00)
 *   applies 600.00 — no piastre is lost to rounding;
 * - a three-leg sum one piastre short (599.99 on 600) is NOT
 *   silently rounded up: the engine reports applied 599.99, so the
 *   writer's remaining-debt gate still sees the 0.01 shortfall;
 * - a non-cash overpay across two non-cash legs is refused
 *   (NON_CASH_OVERPAYMENT), never absorbed into the cash leg.
 *
 * No DB is needed: the engine is pure. Run with
 *   npx ts-node test/critical/sale-tender-three-way-split.spec.ts
 * Exit 0 on pass, 1 on any failure.
 */

import { strict as assert } from 'node:assert';
import { allocateSaleTenders } from '../../src/modules/sales/engines/sale-tender.engine';

const failures: string[] = [];

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function threeLegs(cash: number, card: number, transfer: number) {
  return [
    { paymentChannel: 'cash' as const, amount: cash },
    { paymentChannel: 'card' as const, amount: card },
    { paymentChannel: 'wallet' as const, amount: transfer },
  ];
}

async function main(): Promise<void> {
  await check('three legs 200/200/200 apply exactly to a 600 total', () => {
    const result = allocateSaleTenders({
      paymentType: 'cash',
      payments: threeLegs(200, 200, 200),
      collectibleTotal: 600,
      fallbackChannel: 'cash',
    });
    assert.equal(result.payments.length, 3, 'all three legs are applied');
    assert.deepEqual(
      result.payments.map((leg) => [leg.paymentChannel, leg.amount]),
      [['card', 200], ['wallet', 200], ['cash', 200]],
      'each leg keeps its channel and amount',
    );
    assert.equal(result.appliedAmount, 600, 'applied amount equals the invoice total');
    assert.equal(result.changeAmount, 0, 'an exact split produces no change');
    assert.equal(result.tenderedAmount, 200, 'tendered cash is the cash leg only');
  });

  await check('piastre-exact split 200.33 + 200.33 + 199.34 applies 600.00', () => {
    const result = allocateSaleTenders({
      paymentType: 'cash',
      payments: threeLegs(200.33, 200.33, 199.34),
      collectibleTotal: 600,
      fallbackChannel: 'cash',
    });
    assert.equal(result.payments.length, 3, 'all three legs are applied');
    assert.equal(result.appliedAmount, 600, 'no piastre is lost to rounding');
    assert.equal(result.changeAmount, 0, 'an exact split produces no change');
  });

  await check('three legs one piastre short report the 0.01 shortfall, never rounded up', () => {
    const result = allocateSaleTenders({
      paymentType: 'cash',
      payments: threeLegs(200, 200, 199.99),
      collectibleTotal: 600,
      fallbackChannel: 'cash',
    });
    assert.equal(result.appliedAmount, 599.99, 'the applied amount is the legs sum, not the total');
    assert.equal(Math.round((600 - result.appliedAmount) * 100), 1, 'the writer still sees a 1-piastre remaining debt');
  });

  await check('non-cash overpay across two non-cash legs is refused', () => {
    assert.throws(
      () =>
        allocateSaleTenders({
          paymentType: 'cash',
          payments: threeLegs(0, 400, 300),
          collectibleTotal: 600,
          fallbackChannel: 'cash',
        }),
      (error: unknown) =>
        error instanceof Error && (error as unknown as { code?: string }).code === 'NON_CASH_OVERPAYMENT',
      'card 400 + wallet 300 on a 600 total must throw NON_CASH_OVERPAYMENT',
    );
  });

  if (failures.length) throw new Error(`${failures.length} three-way tender case(s) failed: ${failures.join('; ')}`);
  console.log('Sale tender three-way split tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
