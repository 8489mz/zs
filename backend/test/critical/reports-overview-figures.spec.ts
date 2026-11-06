/*
 * INV-REPORTS-OVERVIEW-FIGURES: the /reports/overview "sales movement" card
 * must count and total merchandise sales invoices only.
 *
 * Proven live on test10k (build 1.1.40): the card showed 5 sale invoices
 * while the sales register held 4 invoices totalling 925.80, and the
 * 75.00 services revenue appeared as its own line under revenue although
 * the "total sales" figure (1,000.80) already contained it, so adding the
 * two lines gave 1,075.80. The cause was buildCommercialSummary folding
 * services into sales.count (4 + 1) and sales.total (925.80 + 75.00).
 *
 * This spec drives the real helper and fails on the old code: with a
 * services invoice present the old count is 5 and the old total is
 * 1,000.80; the fixed values are 4 and 925.80. Services revenue stays
 * visible exactly once, as services.total, and the revenue-level
 * commercial figures (netSales / gross profit) are unchanged because
 * services are real revenue with no COGS.
 */

import assert from 'node:assert/strict';
import {
  buildCommercialSummary,
  buildReportSummaryPayload,
  type SummaryCounts,
  type SummaryTotals,
} from '../../src/modules/reports/helpers/reports-summary.helper';

function counts(overrides: Partial<SummaryCounts>): SummaryCounts {
  return {
    salesCount: 0,
    servicesCount: 0,
    purchasesCount: 0,
    expensesCount: 0,
    returnsCount: 0,
    salesReturnCount: 0,
    purchaseReturnCount: 0,
    ...overrides,
  };
}

function totals(overrides: Partial<SummaryTotals>): SummaryTotals {
  return {
    salesTotal: 0,
    servicesTotal: 0,
    purchasesTotal: 0,
    expensesTotal: 0,
    salesReturnsTotal: 0,
    purchaseReturnsTotal: 0,
    cashIn: 0,
    cashOut: 0,
    cogs: 0,
    ...overrides,
  };
}

// The proven live case: 4 sale invoices totalling 925.80 plus one 75.00
// services invoice. The overview card must agree with the register.
(function testLiveCaseServicesExcludedFromSalesCountAndTotal() {
  const summary = buildCommercialSummary(
    counts({ salesCount: 4, servicesCount: 1 }),
    totals({ salesTotal: 925.8, servicesTotal: 75 }),
  );

  assert.equal(summary.sales.count, 4);
  assert.equal(summary.sales.invoiceCount, 4);
  assert.equal(summary.sales.servicesCount, 1);
  assert.equal(summary.sales.total, 925.8);
  assert.equal(summary.sales.merchandiseTotal, 925.8);
  assert.equal(summary.sales.servicesTotal, 75);
  assert.equal(summary.services.count, 1);
  assert.equal(summary.services.total, 75);
  // Revenue is sales + services counted once: 925.80 + 75.00 = 1,000.80,
  // never sales.total (1,000.80) + services.total (75.00) = 1,075.80.
  assert.equal(summary.sales.total + summary.services.total, 1000.8);
  // Revenue-level commercial figures are unchanged: services are real
  // revenue (no COGS), so net sales still covers the full 1,000.80.
  assert.equal(summary.sales.netSales, 1000.8);
})();

// Same case through the payload path the reports service actually calls:
// 4 sales rows (150.00 + 150.00 + 287.00 + 338.80) and 1 services row.
(function testPayloadPathAgreesWithRegister() {
  const payload = buildReportSummaryPayload({
    salesRows: [{ total: 150 }, { total: 150 }, { total: 287 }, { total: 338.8 }],
    servicesRows: [{ total: 75 }],
  });

  assert.equal(payload.sales.count, 4);
  assert.equal(payload.sales.invoiceCount, 4);
  assert.equal(payload.sales.total, 925.8);
  assert.equal(payload.services.count, 1);
  assert.equal(payload.services.total, 75);
  assert.equal(payload.sales.total + payload.services.total, 1000.8);
})();

// No services at all: count and total are unchanged (plain regression).
(function testNoServicesUnchanged() {
  const summary = buildCommercialSummary(
    counts({ salesCount: 3 }),
    totals({ salesTotal: 400 }),
  );

  assert.equal(summary.sales.count, 3);
  assert.equal(summary.sales.invoiceCount, 3);
  assert.equal(summary.sales.total, 400);
  assert.equal(summary.services.count, 0);
  assert.equal(summary.services.total, 0);
})();

// Services only: the sales card is empty, services carry their own totals.
(function testServicesOnlyLeavesSalesEmpty() {
  const summary = buildCommercialSummary(
    counts({ salesCount: 0, servicesCount: 2 }),
    totals({ salesTotal: 0, servicesTotal: 120 }),
  );

  assert.equal(summary.sales.count, 0);
  assert.equal(summary.sales.invoiceCount, 0);
  assert.equal(summary.sales.total, 0);
  assert.equal(summary.services.count, 2);
  assert.equal(summary.services.total, 120);
})();

console.log('reports-overview-figures specs passed');
