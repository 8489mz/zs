import assert from 'node:assert/strict';
import {
  normalizeSnapshotItems,
  buildSnapshotAuditText,
  extractSnapshotFromDetails,
  evaluateCashierPeerBenchmarks,
} from '../../src/modules/sales/engines/cashier-peer-benchmark.engine';

// 1. Cart Snapshot Normalization + Round-Trip Serialization (CCTV / Audit Proof)
const rawItems = [
  { productId: 10, productName: 'بندق محمص فاخر', qty: 1.5, unitName: 'كجم', unitPrice: 480, lineTotal: 720 },
  { productId: 11, productName: 'قهوة محوجة وسط', qty: 2, previousQty: 4, unitName: 'عبوة', unitPrice: 125 },
  { productId: 12, productName: '   ', qty: 1, unitPrice: 50 }, // invalid blank name dropped
];

const normalized = normalizeSnapshotItems(rawItems);
assert.equal(normalized.length, 2, 'Blank-name items must be dropped cleanly');
assert.equal(normalized[0].lineTotal, 720);
assert.equal(normalized[1].lineTotal, 250, 'Missing lineTotal must compute qty * unitPrice');
assert.equal(normalized[1].previousQty, 4, 'previousQty must survive normalization for qty_decrease');

const auditText = buildSnapshotAuditText(['مسح سلة كاملة', 'الإجمالي: 970', 'عدد الأصناف: 2'], normalized, 2);
assert.ok(auditText.includes('بندق محمص فاخر'), 'Human-readable Arabic summary must name the items');
assert.ok(auditText.includes('::ITEMS_JSON::'), 'Structured JSON marker must be embedded');

const parsed = extractSnapshotFromDetails(auditText);
assert.ok(!parsed.cleanText.includes('::ITEMS_JSON::'), 'Clean display text must strip machine JSON');
assert.equal(parsed.items.length, 2, 'Round-trip extraction must restore all cart items');
assert.equal(parsed.items[0].productName, 'بندق محمص فاخر');
assert.equal(parsed.items[0].unitPrice, 480);
assert.equal(parsed.items[0].lineTotal, 720);
assert.equal(parsed.items[1].previousQty, 4);

// Corrupted JSON resilience
const corrupted = extractSnapshotFromDetails('ملخص السلة ::ITEMS_JSON::{not-valid-json');
assert.equal(corrupted.cleanText, 'ملخص السلة');
assert.deepEqual(corrupted.items, []);

// 2. Peer Benchmark — Sweethearting / Unscanned-Items Detection
const benchmark = evaluateCashierPeerBenchmarks([
  {
    cashierId: 1,
    cashierName: 'كاشير أ (طبيعي)',
    salesCount: 100,
    totalRevenue: 25000, // avg ticket 250
    totalLineItems: 420, // avg 4.2 items/sale
    suspiciousEventsCount: 1,
    returnsCount: 0,
  },
  {
    cashierId: 2,
    cashierName: 'كاشير ب (طبيعي)',
    salesCount: 100,
    totalRevenue: 26000, // avg ticket 260
    totalLineItems: 400, // avg 4.0 items/sale
    suspiciousEventsCount: 2,
    returnsCount: 1,
  },
  {
    cashierId: 3,
    cashierName: 'كاشير ج (تمرير بضاعة بدون مسح)',
    salesCount: 100,
    totalRevenue: 14500, // avg ticket 145 (-43% vs peers 255)
    totalLineItems: 210, // avg 2.1 items/sale (-48.8% vs peers 4.1)
    suspiciousEventsCount: 14, // 14 / 100 sales
    returnsCount: 2,
  },
]);

assert.equal(benchmark.eligibleCashiersCount, 3);
assert.equal(benchmark.flaggedCashiersCount, 1);

const suspect = benchmark.cashiers.find((c) => c.cashierId === 3)!;
assert.equal(suspect.anomalyLevel, 'alert', 'Sweethearting cashier must be flagged as alert');
assert.ok(suspect.avgTicketDeltaPercent <= -35, 'Leave-one-out ticket delta must reflect steep drop');
assert.ok(suspect.avgItemsDeltaPercent <= -35, 'Leave-one-out items/sale delta must reflect steep drop');
assert.ok(suspect.anomalyFlags.length >= 2, 'Multiple independent anomaly flags must fire');

const normalA = benchmark.cashiers.find((c) => c.cashierId === 1)!;
assert.equal(normalA.anomalyLevel, 'normal', 'Normal peer must stay normal');

// 3. Single-cashier quiet shift — zero false positives
const singleCashier = evaluateCashierPeerBenchmarks([
  {
    cashierId: 9,
    cashierName: 'كاشير وحيد',
    salesCount: 40,
    totalRevenue: 4000,
    totalLineItems: 80,
    suspiciousEventsCount: 0,
    returnsCount: 0,
  },
]);
assert.equal(singleCashier.eligibleCashiersCount, 1);
assert.equal(singleCashier.flaggedCashiersCount, 0);
assert.equal(singleCashier.cashiers.length, 1);
assert.equal(
  singleCashier.cashiers[0].anomalyLevel,
  'normal',
  'Must not flag peer-drop anomalies with fewer than 2 eligible peers',
);
assert.deepEqual(singleCashier.cashiers[0].anomalyFlags, []);

console.log('PASS: cashier-peer-benchmark-engine.spec.ts');
