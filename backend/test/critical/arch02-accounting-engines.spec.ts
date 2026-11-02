import { strict as assert } from 'node:assert';
import { nextAccountingDay } from '../../src/modules/accounting/engines/accounting-date.engine';
import { weightedReceiptCost } from '../../src/modules/accounting/engines/inventory-valuation.engine';
import { assertPdcTransition, pdcBookAmount } from '../../src/modules/accounting/engines/pdc-transition.engine';
import { allocateInstallmentInterest } from '../../src/modules/accounting/engines/installment-interest.engine';
import { classifyCashFlow } from '../../src/modules/accounting/engines/cash-flow-classification.engine';
import { valueStockReceipt } from '../../src/modules/accounting/inventory-valuation';
import { areOppositeJournalLines } from '../../src/modules/accounting/engines/journal-reversal.engine';
import { roundMoney, currencyMoneyDigits, toMinorUnits, fromMinorUnits } from '../../src/modules/accounting/engines/money-minor-units.engine';

// Minor units and half-boundary precision guarantees:
assert.equal(roundMoney(2.675, 2), 2.68);
assert.equal(roundMoney(0.045, 2), 0.05);
assert.equal(roundMoney(1.2345, 3), 1.235);
assert.equal(currencyMoneyDigits('KWD'), 3);
assert.equal(currencyMoneyDigits('BHD'), 3);
assert.equal(currencyMoneyDigits('EGP'), 2);
assert.equal(toMinorUnits(10.55, 2), 1055);
assert.equal(toMinorUnits(10.555, 3), 10555);
assert.equal(fromMinorUnits(1055, 2), 10.55);
assert.equal(fromMinorUnits(10555, 3), 10.555);

// Regression cases import production engines; accounting logic is not copied here.
// A posting at 23:59:59.999999 on year end must survive an exclusive next-day bound.
assert.equal(nextAccountingDay('2026-12-31').toISOString(), '2027-01-01T00:00:00.000Z');
assert.equal(nextAccountingDay('2028-02-29').toISOString(), '2028-03-01T00:00:00.000Z');
assert.throws(() => nextAccountingDay('2026-02-29'));

// 10 units @ 10 + production of 10 units costing 200 = 20 units @ 15.
assert.equal(weightedReceiptCost(10, 10, 10, 200), 15);
// A return of 2 units @ their original 10 joins 8 remaining units @ 20.
assert.equal(weightedReceiptCost(8, 20, 2, 20), 18);
// Sold-unit multiplication must happen before the base-unit receipt is valued.
assert.equal(weightedReceiptCost(0, 0, 12, 360), 30);
assert.equal(weightedReceiptCost(-1, 10, 2, 40), 30);
assert.throws(() => weightedReceiptCost(10, 10, 0, 0));

// Settlement cannot be repeated or reversed by applying an unrelated action.
for (const action of ['collect', 'bounce', 'restore_to_safe', 'cancel', 'endorse']) {
  assert.throws(() => assertPdcTransition('receivable', 'collected', action));
}
assert.throws(() => assertPdcTransition('receivable', 'under_collection', 'endorse'));
assert.throws(() => assertPdcTransition('payable', 'bounced', 'clear'));
for (const [status, action] of [['in_safe', 'deposit'], ['under_collection', 'bounce'], ['bounced', 'restore_to_safe'], ['in_safe', 'deposit']]) {
  assert.doesNotThrow(() => assertPdcTransition('receivable', status, action));
}
assert.equal(pdcBookAmount({ amount: 100, base_amount: 5000 }, 2), 5000);
assert.throws(() => pdcBookAmount({ amount: 100 }, 2));
assert.throws(() => pdcBookAmount({ amount: 100, base_amount: Infinity }, 2));
// 3-decimal book amounts survive when digits = 3; the old hard-coded
// *100 truncated 10.123 to 10.12 in every PDC journal.
assert.equal(pdcBookAmount({ amount: 100, base_amount: 10.123 }, 3), 10.123);
assert.equal(pdcBookAmount({ amount: 100, base_amount: 10.123 }, 2), 10.12);

const bounce = [
  { accountId: 1, debit: 100, credit: 0, partnerType: 'customer', partnerId: 7 },
  { accountId: 2, debit: 0, credit: 100 },
];
const restore = [
  { accountId: 2, debit: 100, credit: 0 },
  { accountId: 1, debit: 0, credit: 100, partnerType: 'customer', partnerId: 7 },
];
assert.equal(areOppositeJournalLines(bounce, restore, 2), true);
assert.equal(areOppositeJournalLines(bounce, restore.map(line => ({ ...line, partnerId: line.partnerType === 'customer' ? 8 : null })), 2), false);
// Restoring custody leaves bank fees incurred; it cannot claim to fully reverse them.
assert.equal(areOppositeJournalLines([...bounce, { accountId: 3, debit: 10, credit: 0 }, { accountId: 4, debit: 0, credit: 10 }], restore, 2), false);
assert.equal(areOppositeJournalLines(bounce, [{ accountId: 5, debit: 100, credit: 0 }, restore[1]], 2), false);
// A reversal link is exact at the tenant's book digits, never in cents: at
// 3 digits 0.011 vs 0.009 differ by 2 fils and must not link, while 0.011
// vs 0.006 + 0.005 offsets exactly and must link. The old cents netting
// answered both cases backwards. The same amounts at 2 digits round to
// the same cent, so the digits — not the amounts alone — decide the answer.
const threeDpOriginal = [
  { accountId: 1, debit: 0.011, credit: 0 },
  { accountId: 2, debit: 0, credit: 0.011 },
];
const threeDpShort = [
  { accountId: 1, debit: 0, credit: 0.009 },
  { accountId: 2, debit: 0.009, credit: 0 },
];
const threeDpSplit = [
  { accountId: 1, debit: 0, credit: 0.006 },
  { accountId: 1, debit: 0, credit: 0.005 },
  { accountId: 2, debit: 0.006, credit: 0 },
  { accountId: 2, debit: 0.005, credit: 0 },
];
assert.equal(areOppositeJournalLines(threeDpOriginal, threeDpShort, 3), false);
assert.equal(areOppositeJournalLines(threeDpOriginal, threeDpSplit, 3), true);
assert.equal(areOppositeJournalLines(threeDpOriginal, threeDpShort, 2), true);
assert.equal(areOppositeJournalLines([], restore, 2), false);
assert.equal(areOppositeJournalLines(bounce, [{ accountId: 2, debit: 100, credit: 0 }, { accountId: 1, debit: 0, credit: Number.NaN, partnerType: 'customer', partnerId: 7 }], 2), false);

// Principal 100, two payments of 60: total interest 20 is earned over time.
assert.deepEqual(allocateInstallmentInterest(100, [60, 60], 20, 2), [13.07, 6.93]);
assert.deepEqual(allocateInstallmentInterest(100, [50, 50], 0, 2), [0, 0]);
const fractional = allocateInstallmentInterest(1000, [366.67, 366.67, 366.66], 100, 2);
assert.equal(Math.round(fractional.reduce((sum, amount) => sum + amount, 0) * 100), 10000);
assert.ok(fractional[0] > fractional[1] && fractional[1] > fractional[2]);
assert.throws(() => allocateInstallmentInterest(100, [60, 60], 30, 2));

// Neither non-cash purchases nor receipt of post-dated cheques create cash flow.
assert.deepEqual(classifyCashFlow(0, 100, 0, -100), { operating: 0, investing: 0, financing: 0, unclassified: 0 });
assert.deepEqual(classifyCashFlow(100, 100, 0, 0), { operating: 100, investing: 0, financing: 0, unclassified: 0 });
// An asset sold for 150 with book value 100 and gain 50 needs explicit attribution.
assert.deepEqual(classifyCashFlow(150, 50, 100, 0), { operating: 0, investing: 0, financing: 0, unclassified: 150 });
assert.deepEqual(classifyCashFlow(150, 50, 100, 0, 'investing'), { operating: 0, investing: 150, financing: 0, unclassified: 0 });
// Asset 100 financed by debt 80 and cash 20 has ambiguous gross cash legs.
assert.deepEqual(classifyCashFlow(-20, 0, -100, 80), { operating: 0, investing: 0, financing: 0, unclassified: -20 });

async function verifyReceiptAdapter(): Promise<void> {
  let currentCost = 20;
  const predicates: Array<[string, unknown]> = [];
  const query = {
    select: () => query,
    where: (column: string, _operator: string, value: unknown) => { predicates.push([column, value]); return query; },
    executeTakeFirstOrThrow: async () => ({ cost_price: currentCost }),
    set: (values: { cost_price: number }) => { currentCost = values.cost_price; return query; },
    execute: async () => [],
  };
  const db = { selectFrom: () => query, updateTable: () => query } as any;
  // Two physical locations return one unit each. Each receipt uses corrected
  // stock AFTER that location change; a stale cached product quantity is unused.
  await valueStockReceipt(db, 'tenant-a', 7, 9, 1, 10);
  assert.equal(currentCost, 18.888889);
  await valueStockReceipt(db, 'tenant-a', 7, 10, 1, 10);
  assert.equal(currentCost, 18);
  assert.ok(predicates.filter(([column]) => column === 'tenant_id').every(([, value]) => value === 'tenant-a'));
  // Production adds 10 costing 200 to the true prior 10 @ 10, even when a
  // cached quantity before reconciliation would have incorrectly read 5.
  currentCost = 10;
  await valueStockReceipt(db, 'tenant-a', 7, 20, 10, 200);
  assert.equal(currentCost, 15);
}

void verifyReceiptAdapter().catch(error => { console.error(error); process.exitCode = 1; });
