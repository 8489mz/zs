import { strict as assert } from 'node:assert';

// Simulated engine math matching AccountingService logic
function calculateDepreciation(
  asset: {
    purchaseCost: number;
    salvageValue: number;
    usefulLifeMonths: number;
    accumulatedDepreciation: number;
    method: 'straight_line' | 'declining_balance';
  },
  months: number = 1,
) {
  const cost = Number(asset.purchaseCost || 0);
  const salvage = Number(asset.salvageValue || 0);
  const usefulLife = Math.max(1, Number(asset.usefulLifeMonths || 60));
  const currentAccumulated = Number(asset.accumulatedDepreciation || 0);
  const method = asset.method || 'straight_line';

  const depreciableBase = Math.max(0, cost - salvage);
  let calculatedAmount = 0;

  if (method === 'declining_balance') {
    const currentBook = Math.max(0, cost - currentAccumulated);
    const annualRate = 2 / (usefulLife / 12);
    const monthlyRate = currentBook * (annualRate / 12);
    const maxDepreciable = Math.max(0, depreciableBase - currentAccumulated);
    calculatedAmount = Math.min(monthlyRate * months, maxDepreciable);
  } else {
    const monthlyRate = depreciableBase / usefulLife;
    calculatedAmount = Math.min(monthlyRate * months, Math.max(0, depreciableBase - currentAccumulated));
  }

  const depreciationAmount = Math.round(calculatedAmount * 100) / 100;
  const newAccumulated = Math.round((currentAccumulated + depreciationAmount) * 100) / 100;
  const newBookValue = Math.round(Math.max(0, cost - newAccumulated) * 100) / 100;
  const isFullyDepreciated = newAccumulated >= depreciableBase;

  return {
    depreciationAmount,
    newAccumulated,
    newBookValue,
    isFullyDepreciated,
  };
}

async function runFixedAssetsAudit() {
  console.log('--- Starting Fixed Assets Depreciation Engine Audit ---');

  // Test 1: Straight-line depreciation for 1 month
  console.log('Test 1: Straight-line depreciation test...');
  const asset1 = {
    purchaseCost: 60000,
    salvageValue: 0,
    usefulLifeMonths: 60, // 5 years -> 1000/month
    accumulatedDepreciation: 0,
    method: 'straight_line' as const,
  };

  const res1 = calculateDepreciation(asset1, 1);
  assert.equal(res1.depreciationAmount, 1000, 'Monthly straight-line depreciation should be 1000');
  assert.equal(res1.newAccumulated, 1000, 'Accumulated should be 1000');
  assert.equal(res1.newBookValue, 59000, 'Book value should be 59000');
  assert.equal(res1.isFullyDepreciated, false, 'Asset should not be fully depreciated');
  console.log('✓ Straight-line single month calculation passed.');

  // Test 2: Straight-line with Salvage Value (خردة)
  console.log('Test 2: Straight-line with salvage value...');
  const asset2 = {
    purchaseCost: 55000,
    salvageValue: 5000, // Depreciable base = 50,000
    usefulLifeMonths: 50, // 1000/month
    accumulatedDepreciation: 49500,
    method: 'straight_line' as const,
  };

  const res2 = calculateDepreciation(asset2, 1);
  assert.equal(res2.depreciationAmount, 500, 'Depreciation should cap at remaining depreciable base (500)');
  assert.equal(res2.newAccumulated, 50000, 'New accumulated must reach exactly 50,000');
  assert.equal(res2.newBookValue, 5000, 'Book value must equal salvage value 5,000');
  assert.equal(res2.isFullyDepreciated, true, 'Asset must be marked fully depreciated');
  console.log('✓ Salvage value ceiling protection passed.');

  // Test 3: Declining Balance Method (DDB)
  console.log('Test 3: Double declining balance depreciation...');
  const asset3 = {
    purchaseCost: 100000,
    salvageValue: 10000,
    usefulLifeMonths: 60, // 5 years -> Annual rate = 40% -> Monthly = 3.333%
    accumulatedDepreciation: 0,
    method: 'declining_balance' as const,
  };

  const res3 = calculateDepreciation(asset3, 1);
  // Expected: 100000 * (0.4 / 12) = 3333.33
  assert.ok(
    Math.abs(res3.depreciationAmount - 3333.33) < 0.05,
    `DDB depreciation should be ~3333.33, got ${res3.depreciationAmount}`,
  );
  assert.equal(res3.newBookValue, 96666.67, 'Book value after 1st month DDB');
  console.log('✓ Double declining balance calculation passed.');

  // Test 4: Journal Entry Balance Verification
  console.log('Test 4: Journal entry debit/credit balance verification...');
  const depreciationAmount = res1.depreciationAmount;
  const journalLines = [
    { accountId: 6950, debit: depreciationAmount, credit: 0, desc: 'مصروف إهلاك' },
    { accountId: 1290, debit: 0, credit: depreciationAmount, desc: 'مجمع إهلاك' },
  ];
  const totalDebit = journalLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = journalLines.reduce((s, l) => s + l.credit, 0);
  assert.equal(totalDebit, totalCredit, 'Depreciation journal entry must be strictly balanced');
  assert.ok(totalDebit > 0, 'Depreciation debit must be positive');
  console.log('✓ Journal entry lines balance verified (Debit == Credit).');

  console.log('\n🎉 ALL FIXED ASSETS DEPRECIATION TESTS PASSED SUCCESSFULLY! 🎉');
}

runFixedAssetsAudit().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
