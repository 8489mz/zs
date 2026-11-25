import { strict as assert } from 'node:assert';
import { calculateFreightAudit, validateMakerCheckerOverride } from './freight-audit.engine';

const sampleRateCard = {
  id: 101,
  carrierName: 'Maersk Line',
  totalFreightCost: 2000,
  oceanFreight: 1600,
  thcOrigin: 200,
  thcDestination: 150,
  bafCharges: 50,
  otherCharges: 0,
  currency: 'USD',
};

// 1. Exact match test
{
  const res = calculateFreightAudit({
    invoicedTotal: 2000,
    oceanFreight: 1600,
    thcCharges: 350,
    bafCharges: 50,
    otherCharges: 0,
    rateCard: sampleRateCard,
    containerCount: 1,
  });

  assert.equal(res.hasRateCard, true);
  assert.equal(res.rateCardId, 101);
  assert.equal(res.contractedTotal, 2000);
  assert.equal(res.invoicedTotal, 2000);
  assert.equal(res.varianceAmount, 0);
  assert.equal(res.variancePct, 0);
  assert.equal(res.auditStatus, 'matched');
  assert.equal(res.isMatched, true);
  assert.equal(res.isOvercharged, false);
  assert.equal(res.recommendation, 'auto_approvable');
}

// 2. Overcharge with multiple containers (2x 40HC)
{
  const res = calculateFreightAudit({
    invoicedTotal: 4500, // 4500 invoiced vs 4000 contracted
    oceanFreight: 3600,
    thcCharges: 700,
    bafCharges: 200,
    otherCharges: 0,
    rateCard: sampleRateCard,
    containerCount: 2,
  });

  assert.equal(res.contractedTotal, 4000); // 2000 * 2
  assert.equal(res.invoicedTotal, 4500);
  assert.equal(res.varianceAmount, 500);
  assert.equal(res.variancePct, 12.5); // (500 / 4000) * 100
  assert.equal(res.auditStatus, 'overcharge');
  assert.equal(res.isOvercharged, true);
  assert.equal(res.isMatched, false);
  assert.equal(res.recommendation, 'requires_override_or_dispute');
  assert.equal(res.varianceBreakdown.oceanFreightDiff, 400); // 3600 - (1600*2)
  assert.equal(res.varianceBreakdown.bafDiff, 100); // 200 - (50*2)
}

// 3. Undercharge (discounted / partial bill)
{
  const res = calculateFreightAudit({
    invoicedTotal: 1800, // 1800 vs 2000
    rateCard: sampleRateCard,
    containerCount: 1,
  });

  assert.equal(res.contractedTotal, 2000);
  assert.equal(res.varianceAmount, -200);
  assert.equal(res.variancePct, -10);
  assert.equal(res.auditStatus, 'undercharge');
  assert.equal(res.isUndercharged, true);
  assert.equal(res.isOvercharged, false);
  assert.equal(res.recommendation, 'auto_approvable');
}

// 4. No active rate card scenario
{
  const res = calculateFreightAudit({
    invoicedTotal: 2500,
    rateCard: null,
    containerCount: 1,
  });

  assert.equal(res.hasRateCard, false);
  assert.equal(res.rateCardId, null);
  assert.equal(res.contractedTotal, 0);
  assert.equal(res.auditStatus, 'no_contract');
  assert.equal(res.recommendation, 'manual_review_no_contract');
}

// 5. Tolerance for tiny float rounding differences (<= 0.01)
{
  const res = calculateFreightAudit({
    invoicedTotal: 2000.004,
    rateCard: sampleRateCard,
    containerCount: 1,
  });

  assert.equal(res.isMatched, true);
  assert.equal(res.auditStatus, 'matched');
}

// 6. Maker-checker: Creator cannot approve their own override
{
  const res = validateMakerCheckerOverride({
    userId: 42,
    role: 'admin',
    invoiceCreatedBy: 42,
    reason: 'Client agreed to pay additional congestion surcharge',
  });

  assert.equal(res.valid, false);
  assert.ok(res.error?.includes('حظر فصل المهام'));
}

// 7. Maker-checker: Unauthorized role
{
  const res = validateMakerCheckerOverride({
    userId: 99,
    role: 'operator',
    invoiceCreatedBy: 42,
    reason: 'Client agreed to pay additional congestion surcharge',
  });

  assert.equal(res.valid, false);
  assert.ok(res.error?.includes('صلاحيات غير كافية'));
}

// 8. Maker-checker: Short rationale (< 10 chars)
{
  const res = validateMakerCheckerOverride({
    userId: 99,
    role: 'admin',
    invoiceCreatedBy: 42,
    reason: 'ok',
  });

  assert.equal(res.valid, false);
  assert.ok(res.error?.includes('لا يقل عن 10 أحرف'));
}

// 9. Maker-checker: Valid override
{
  const res = validateMakerCheckerOverride({
    userId: 99,
    role: 'admin',
    invoiceCreatedBy: 42,
    reason: 'اعتماد الزيادة بعد مراجعة إيميل الخط الملاحي بخصوص رسوم التكدس بالميناء',
  });

  assert.equal(res.valid, true);
  assert.equal(res.error, undefined);
}

console.log('freight-audit.engine.spec: all 9 audit & maker-checker assertions passed successfully.');
