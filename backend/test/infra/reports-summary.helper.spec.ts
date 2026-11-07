import assert from 'node:assert/strict';
import { toMoney, sumMoney, buildAggregatedBalances, buildTrendMap } from '../../src/modules/reports/helpers/reports-math.helper';
import { buildCommercialSummary, buildReportSummaryPayload, splitReturnRowsByType } from '../../src/modules/reports/helpers/reports-summary.helper';

(function testSplitReturnRowsByType() {
  const rows = [
    { return_type: 'sale', total: 10 },
    { return_type: 'purchase', total: 20 },
    { return_type: 'other', total: 30 },
  ];

  const split = splitReturnRowsByType(rows);
  assert.equal(split.sales.length, 1);
  assert.equal(split.purchases.length, 1);
})();

(function testBuildReportSummaryPayload() {
  const payload = buildReportSummaryPayload({
    salesRows: [{ total: 200 }, { total: 50 }],
    purchasesRows: [{ total: 120 }],
    expensesRows: [{ amount: 30 }],
    returnsRows: [
      { return_type: 'sale', total: 20 },
      { return_type: 'purchase', total: 10 },
    ],
    treasuryRows: [
      { amount: 100 },
      { amount: -40 },
    ],
    saleItemsRows: [
      { product_id: 1, product_name: 'Milk', qty: 2, cost_price: 25, line_total: 80 },
      { product_id: 1, product_name: 'Milk', qty: 1, cost_price: 25, line_total: 40 },
      { product_id: 2, product_name: 'Bread', qty: 3, cost_price: 10, line_total: 45 },
    ],
  });

  assert.equal(payload.sales.count, 2);
  assert.equal(payload.sales.total, 250);
  assert.equal(payload.sales.netSales, 230);
  assert.equal(payload.purchases.netPurchases, 110);
  assert.equal(payload.expenses.total, 30);
  assert.equal(payload.returns.count, 2);
  assert.equal(payload.returns.salesTotal, 20);
  assert.equal(payload.returns.purchasesTotal, 10);
  assert.equal(payload.treasury.cashIn, 100);
  assert.equal(payload.treasury.cashOut, 40);
  assert.equal(payload.treasury.net, 60);
  assert.equal(payload.commercial.cogs, 105);
  assert.equal(payload.commercial.grossProfit, 125);
  assert.equal(payload.commercial.netOperatingProfit, 95);
  assert.equal(payload.topProducts.length, 2);
  assert.equal(payload.topProducts[0].name, 'Milk');
  assert.equal(payload.topProducts[0].qty, 3);
  assert.equal(payload.topProducts[0].revenue, 120);
})();

console.log('reports-summary.helper specs passed');

// INV-SALES-REPORT-RETURNS-CARD: the sales-report "returns and discounts"
// card showed 250.00 on test10k because returns.total folded purchase
// returns in (150.00 sale returns + 100.00 purchase returns) and never
// counted the 15.00 invoice discounts. The card must be sales returns +
// sales discounts only: 150.00 + 15.00 = 165.00, with the 100.00 purchase
// return still visible separately as returns.purchasesTotal.
(function testReturnsCardExcludesPurchaseReturnsAndAddsDiscounts() {
  const payload = buildReportSummaryPayload({
    salesRows: [
      { total: 500, discount: 10 },
      { total: 300, discount: 5 },
    ],
    returnsRows: [
      { return_type: 'sale', total: 150 },
      { return_type: 'purchase', total: 100 },
    ],
  });

  assert.equal(payload.returns.salesTotal, 150);
  assert.equal(payload.returns.discountsTotal, 15);
  assert.equal(payload.returns.purchasesTotal, 100);
  assert.equal(payload.returns.total, 165);
})();

// Same figures through the production aggregate path (totalsOverride).
(function testReturnsCardViaTotalsOverride() {
  const summary = buildCommercialSummary(
    {
      salesCount: 2,
      servicesCount: 0,
      purchasesCount: 0,
      expensesCount: 0,
      returnsCount: 2,
      salesReturnCount: 1,
      purchaseReturnCount: 1,
    },
    {
      salesTotal: 800,
      servicesTotal: 0,
      purchasesTotal: 0,
      expensesTotal: 0,
      salesReturnsTotal: 150,
      purchaseReturnsTotal: 100,
      salesDiscountsTotal: 15,
      cashIn: 0,
      cashOut: 0,
      cogs: 0,
    },
  );

  assert.equal(summary.returns.salesTotal, 150);
  assert.equal(summary.returns.discountsTotal, 15);
  assert.equal(summary.returns.purchasesTotal, 100);
  assert.equal(summary.returns.total, 165);
})();

// A purchase return alone must not move the sales card at all.
(function testPurchaseReturnAloneLeavesReturnsCardAtZero() {
  const payload = buildReportSummaryPayload({
    salesRows: [{ total: 500 }],
    returnsRows: [{ return_type: 'purchase', total: 100 }],
  });

  assert.equal(payload.returns.total, 0);
  assert.equal(payload.returns.salesTotal, 0);
  assert.equal(payload.returns.discountsTotal, 0);
  assert.equal(payload.returns.purchasesTotal, 100);
})();

// No returns and no discounts: the card stays zero (plain regression).
(function testNoReturnsNoDiscountsCardIsZero() {
  const payload = buildReportSummaryPayload({
    salesRows: [{ total: 500, discount: 0 }],
    returnsRows: [],
  });

  assert.equal(payload.returns.total, 0);
});

// KWD/OMR receivable aging and book amounts cannot silently drop one fil.
assert.equal(toMoney(0.001, 3), 0.001);
assert.equal(toMoney(0.001, 2), 0);
assert.equal(sumMoney([{amount:0.001},{amount:0.002}], row => row.amount, 3), 0.003);
assert.equal(sumMoney([{amount:1.255},{amount:0.001}], row => row.amount, 3), 1.256);

// Existing signed supplier ledger balances must not change at half-cent boundaries.
assert.equal(toMoney(-10.505), -10.51);
assert.equal(toMoney(15.255), 15.26);
assert.equal(toMoney(0.001,3),0.001);

assert.deepEqual(buildTrendMap([{k:'day',v:0.001},{k:'day',v:0.002}],['day'],r=>r.k,r=>r.v,3),[{key:'day',value:0.003}]);
assert.deepEqual(buildTrendMap([{k:'day',v:0.004},{k:'day',v:0.004}],['day'],r=>r.k,r=>r.v),[{key:'day',value:0.01}]);

// A report helper must not silently discard one-fil ledger balances.
const tinyBalances=[{id:1,balance:'0.001'},{id:2,balance:'0.002'}];
assert.equal(buildAggregatedBalances(tinyBalances,new Map(),3).get('1'),0.001);
assert.equal(buildAggregatedBalances(tinyBalances,new Map([['2',0.003]]),3).get('2'),0.003);
assert.equal(buildAggregatedBalances(tinyBalances,new Map()).get('1'),0);
