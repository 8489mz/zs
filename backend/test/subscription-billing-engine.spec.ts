import assert from 'node:assert/strict';
import {
  calculateNextBillingDate,
  calculateSubscriptionLineTotals,
  calculateSubscriptionTotals,
  evaluateSubscriptionBillingStatus,
  type SubscriptionEvaluationInput,
} from '../src/modules/sales/engines/subscription-billing.engine';

// Test 1: Cycle intervals calculation
{
  const base = '2026-01-15';
  assert.equal(calculateNextBillingDate(base, 'monthly'), '2026-02-15');
  assert.equal(calculateNextBillingDate(base, 'quarterly'), '2026-04-15');
  assert.equal(calculateNextBillingDate(base, 'semi_annual'), '2026-07-15');
  assert.equal(calculateNextBillingDate(base, 'annual'), '2027-01-15');
  console.log('✓ Test 1 Passed: Cycle intervals advanced accurately across all 4 periodicities');
}

// Test 2: Line totals and VAT calculation
{
  const line = calculateSubscriptionLineTotals(5, 200, 14, 2); // 5 * 200 = 1000, VAT 14% = 140, total = 1140
  assert.equal(line.netAmount, 1000);
  assert.equal(line.taxAmount, 140);
  assert.equal(line.totalAmount, 1140);
  console.log('✓ Test 2 Passed: Line totals and VAT calculated with cent precision');
}

// Test 3: Multi-line subscription aggregation
{
  const lines = [
    { quantity: 2, unitPrice: 500, taxRate: 14 }, // net: 1000, tax: 140
    { quantity: 1, unitPrice: 2000, taxRate: 0 },  // net: 2000, tax: 0
  ];
  const totals = calculateSubscriptionTotals(lines, 2);
  assert.equal(totals.subtotal, 3000);
  assert.equal(totals.taxTotal, 140);
  assert.equal(totals.grandTotal, 3140);
  console.log('✓ Test 3 Passed: Multi-line aggregation computes exact subtotal and tax total');
}

// Test 4: Due for billing evaluation
{
  const sub: SubscriptionEvaluationInput = {
    status: 'active',
    startDate: '2026-01-01',
    nextBillingDate: '2026-09-01',
    autoRenew: true,
  };
  const asOf = new Date('2026-09-15');
  const res = evaluateSubscriptionBillingStatus(sub, asOf);
  assert.equal(res.isDueForBilling, true);
  assert.equal(res.isExpired, false);
  assert.equal(res.nextStatus, 'active');
  console.log('✓ Test 4 Passed: Subscription past nextBillingDate qualifies as due for billing');
}

// Test 5: Not yet due evaluation
{
  const sub: SubscriptionEvaluationInput = {
    status: 'active',
    startDate: '2026-01-01',
    nextBillingDate: '2026-10-01',
    autoRenew: true,
  };
  const asOf = new Date('2026-09-15');
  const res = evaluateSubscriptionBillingStatus(sub, asOf);
  assert.equal(res.isDueForBilling, false);
  console.log('✓ Test 5 Passed: Subscription with future billing date is not due');
}

// Test 6: Contract expiration without auto-renew
{
  const sub: SubscriptionEvaluationInput = {
    status: 'active',
    startDate: '2025-01-01',
    endDate: '2026-01-01',
    nextBillingDate: '2026-01-01',
    autoRenew: false,
  };
  const asOf = new Date('2026-09-15');
  const res = evaluateSubscriptionBillingStatus(sub, asOf);
  assert.equal(res.isDueForBilling, false);
  assert.equal(res.isExpired, true);
  assert.equal(res.nextStatus, 'expired');
  console.log('✓ Test 6 Passed: Non-renewing contract terminates and expires when endDate passes');
}

// Test 7: Three-decimal tenant rounds at book precision, not cents (INV-SUBSCRIPTION-BILLING-DIGITS)
{
  const line = calculateSubscriptionLineTotals(3, 0.125, 14, 3);
  assert.equal(line.netAmount, 0.375);
  assert.equal(line.taxAmount, 0.053);
  assert.equal(line.totalAmount, 0.428);
  console.log('✓ Test 7 Passed: 3-decimal tenant totals keep book precision');
}

console.log('\nAll 7 Subscription Billing Engine tests passed with 100% precision.');
