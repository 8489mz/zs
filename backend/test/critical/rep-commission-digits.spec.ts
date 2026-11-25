/*
New file: backend/test/critical/rep-commission-digits.spec.ts
Pins rep commissions and rep-isolated customer balances at the
tenant's book digits (money-precision program, package 5;
INV-REP-COMMISSION-DIGITS).

THE GAP: the rep-target engine's money functions rounded through a
file-private 2-decimal rounder — which also swallowed non-finite
values to 0. Commissions, bonuses, amounts still payable, and the
per-rep isolated customer balances were all cut to cents on a
3-decimal tenant (KWD/BHD/OMR), even though the same request path
already knew the tenant. This was the last file-private money
rounder in the money program: the storefront pair, the returns
helper, and the POS offer chain were closed by the earlier packages.

THE FIX (behavior change ONLY on 3-decimal tenants, and only toward
the correct book precision): digits are REQUIRED on
calculateRepCommissionMetrics (new moneyDigits input field),
aggregateCustomerBalancesByRep, resolveIsolatedRepCustomerBalance,
and validateIsolatedRepCollection, rounding through the canonical
engine; the services derive the digits from the tenant's base
currency and pass the same value down the whole isolated-balance
chain. 2-decimal tenants compute exactly what they computed before,
except for floating-point half-cent edge cases, where the canonical
rounder (plain Math.round) can differ from the old EPSILON formula
by one minor unit — the canonical engine is the single source of
truth, and no pinned 2-decimal value in the existing specs sits on
such an edge.

WHAT THIS PINS:
- Commission, collection, bonus, total, paid, and remaining
  amounts keep three decimals at digits 3.
- Aggregated rep balances keep three decimals, including the
  sub-cent credit leg that the 2-decimal path drops entirely.
- The isolated-balance fallback and the collection validation
  round at the caller's digits; a 0.0015 collection is valid at 3
  decimals and rounds to an invalid zero at 2.
- Non-finite commission input now fails closed (the old rounder
  silently returned 0 commission).
- Omitting digits fails closed instead of rounding to cents — the
  old code returned silently, which is the fail-first
  discrimination.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import {
  aggregateCustomerBalancesByRep,
  calculateRepCommissionMetrics,
  resolveIsolatedRepCustomerBalance,
  validateIsolatedRepCollection,
} from '../../src/modules/delivery-reps/rep-target.engine';

const NO_DIGITS = undefined as unknown as 2;

async function main(): Promise<void> {
  // Commissions at 3 digits, with the 2-digit answers beside them.
  const comm3 = calculateRepCommissionMetrics({
    actualSales: 1012.5,
    actualCollections: 2025,
    salesTarget: 1000,
    salesCommissionRatePercent: 1,
    collectionCommissionRatePercent: 0.5,
    targetBonusRatePercent: 0.5,
    alreadyPaidAmount: 10.125,
    moneyDigits: 3,
  });
  assert.equal(comm3.salesCommissionAmount, 10.125);
  assert.equal(comm3.collectionCommissionAmount, 10.125);
  assert.equal(comm3.isTargetBonusEligible, true);
  assert.equal(comm3.targetBonusAmount, 5.063);
  assert.equal(comm3.totalEarnedCommission, 25.313);
  assert.equal(comm3.alreadyPaidAmount, 10.125);
  assert.equal(comm3.remainingPayableCommission, 15.188);
  const comm2 = calculateRepCommissionMetrics({
    actualSales: 1012.5,
    actualCollections: 2025,
    salesTarget: 1000,
    salesCommissionRatePercent: 1,
    collectionCommissionRatePercent: 0.5,
    targetBonusRatePercent: 0.5,
    alreadyPaidAmount: 10.125,
    moneyDigits: 2,
  });
  assert.equal(comm2.salesCommissionAmount, 10.13);
  assert.equal(comm2.collectionCommissionAmount, 10.13);
  assert.equal(comm2.targetBonusAmount, 5.06);
  assert.equal(comm2.totalEarnedCommission, 25.32);
  assert.equal(comm2.remainingPayableCommission, 15.19);
  const commMissed = calculateRepCommissionMetrics({
    actualSales: 500,
    actualCollections: 500,
    salesTarget: 1000,
    moneyDigits: 3,
  });
  assert.equal(commMissed.isTargetBonusEligible, false);
  assert.equal(commMissed.targetBonusAmount, 0);

  // Non-finite input fails closed instead of paying zero commission.
  assert.throws(
    () =>
      calculateRepCommissionMetrics({ actualSales: Number.POSITIVE_INFINITY, actualCollections: 0, moneyDigits: 3 }),
    /Non-finite monetary amount/,
  );

  // Aggregated balances: the sub-cent credit leg survives at 3 digits.
  const entries = [
    { customerId: 2, repId: 101, repName: 'مندوب 1', amount: 10.125 },
    { customerId: 2, repId: 101, repName: 'مندوب 1', amount: -0.001 },
  ];
  const map3 = aggregateCustomerBalancesByRep(entries, { 2: 10.125 }, 3);
  const b3 = map3.get(2)!;
  assert.equal(b3.repBalances[0].balance, 10.124);
  assert.equal(b3.repBalances[0].totalDebit, 10.125);
  assert.equal(b3.repBalances[0].totalCredit, 0.001);
  assert.equal(b3.totalRepBalance, 10.124);
  assert.equal(b3.totalCustomerBalance, 10.125);
  assert.equal(b3.unassignedBalance, 0.001);
  const map2 = aggregateCustomerBalancesByRep(entries, { 2: 10.125 }, 2);
  const b2 = map2.get(2)!;
  assert.equal(b2.repBalances[0].balance, 10.13);
  assert.equal(b2.repBalances[0].totalCredit, 0);
  assert.equal(b2.unassignedBalance, 0);

  // Isolated view: fallback path and breakdown path at the caller's digits.
  const fallback3 = resolveIsolatedRepCustomerBalance({
    repId: 101,
    breakdown: null,
    assignedRepIds: [101],
    fallbackTotalBalance: 10.125,
    moneyDigits: 3,
  });
  assert.equal(fallback3.repBalance, 10.125);
  assert.equal(fallback3.totalCustomerBalance, 10.125);
  const fallback2 = resolveIsolatedRepCustomerBalance({
    repId: 101,
    breakdown: null,
    assignedRepIds: [101],
    fallbackTotalBalance: 10.125,
    moneyDigits: 2,
  });
  assert.equal(fallback2.repBalance, 10.13);
  const view3 = resolveIsolatedRepCustomerBalance({
    repId: 101,
    breakdown: b3,
    assignedRepIds: [101],
    fallbackTotalBalance: 10.125,
    moneyDigits: 3,
  });
  // Exclusively assigned: the unassigned 0.001 joins this rep's own 10.124.
  assert.equal(view3.repBalance, 10.125);
  assert.equal(view3.otherRepsBalance, 0);
  assert.equal(view3.totalCustomerBalance, 10.125);

  // Collection validation rounds at the caller's digits.
  const valid3 = validateIsolatedRepCollection({
    repId: 101,
    collectionAmount: 0.0015,
    repBalance: 10.124,
    otherRepsBalance: 0,
    totalCustomerBalance: 10.125,
    moneyDigits: 3,
  });
  assert.equal(valid3.allowed, true);
  assert.equal(valid3.repPreviousBalance, 10.124);
  assert.equal(valid3.repNewBalance, 10.122);
  assert.equal(valid3.companyNewBalance, 10.123);
  const valid2 = validateIsolatedRepCollection({
    repId: 101,
    collectionAmount: 0.0015,
    repBalance: 10.124,
    otherRepsBalance: 0,
    totalCustomerBalance: 10.125,
    moneyDigits: 2,
  });
  assert.equal(valid2.allowed, false);
  assert.equal(valid2.errorCode, 'INVALID_COLLECTION_AMOUNT');

  // Omitted digits must fail closed, not fall back to cents.
  assert.throws(
    () => calculateRepCommissionMetrics({ actualSales: 100, actualCollections: 0, moneyDigits: NO_DIGITS }),
    /Invalid monetary minor units/,
  );
  assert.throws(
    () => aggregateCustomerBalancesByRep(entries, { 2: 10.125 }, NO_DIGITS),
    /Invalid monetary minor units/,
  );
  assert.throws(
    () =>
      resolveIsolatedRepCustomerBalance({
        repId: 101,
        breakdown: null,
        assignedRepIds: [101],
        fallbackTotalBalance: 10.125,
        moneyDigits: NO_DIGITS,
      }),
    /Invalid monetary minor units/,
  );
  assert.throws(
    () =>
      validateIsolatedRepCollection({
        repId: 101,
        collectionAmount: 1,
        repBalance: 10,
        otherRepsBalance: 0,
        totalCustomerBalance: 10,
        moneyDigits: NO_DIGITS,
      }),
    /Invalid monetary minor units/,
  );

  console.log('Rep commission digits tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
