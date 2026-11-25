import { strict as assert } from 'node:assert';
import { BadRequestException } from '@nestjs/common';
import {
  computeIpc,
  IpcTerms,
  IpcPriorCumulatives,
  IpcPeriodWork,
  IpcDeductionInputs,
} from '../../src/modules/contracting/ipc-calculation.engine';

// =============================================================================
// Automated Proof Assertions for FIDIC / MRICS Construction Module
// Directly tests the PRODUCTION computeIpc engine (Single Source of Truth)
// =============================================================================

console.log('--- Testing Invariant I1: Bounded Window Advance Recovery & Ceiling Cap ---');

const baseTerms: IpcTerms = {
  contractValue: 1_000_000,
  advanceTotal: 100_000,
  advanceRecoveryStartPct: 10,
  advanceRecoveryEndPct: 80,
  retentionRate: 0.05,
  retentionCap: 50_000,
  ldCapPct: 10,
};

// 1. Below window start (5% progress vs 10% start) -> 0 recovery
const r1 = computeIpc(
  baseTerms,
  { previousGrossWorkDone: 0, previousAdvanceRecovered: 0, previousRetentionHeld: 0, carriedForwardDebitIn: 0 },
  { grossWorkDone: 50_000 },
  {},
);
assert.equal(r1.advanceRecoveryAmount, 0, 'Recovery below start window must be 0');

// 2. Mid window (45% progress -> factor = (45 - 10)/(80 - 10) = 35/70 = 50%) -> Target 50,000
const r2 = computeIpc(
  baseTerms,
  { previousGrossWorkDone: 50_000, previousAdvanceRecovered: 0, previousRetentionHeld: 0, carriedForwardDebitIn: 0 },
  { grossWorkDone: 400_000 }, // cumulative 450,000 = 45%
  {},
);
assert.equal(r2.advanceRecoveryAmount, 50_000, 'Mid-window recovery must be 50,000');

// 3. Beyond window end (85% progress -> factor clamped to 1.0) -> Target 100,000, prev 50,000 -> Recover 50,000
const r3 = computeIpc(
  baseTerms,
  {
    previousGrossWorkDone: 450_000,
    previousAdvanceRecovered: 50_000,
    previousRetentionHeld: 0,
    carriedForwardDebitIn: 0,
  },
  { grossWorkDone: 400_000 }, // cumulative 850,000 = 85%
  {},
);
assert.equal(r3.advanceRecoveryAmount, 50_000, 'End-window recovery must reach advance total (50,000 remaining)');

// 4. Invariant I1 Inviolable Ceiling: Future invoice with 100% progress -> remaining advance is 0 -> Recovery must be 0!
const r4 = computeIpc(
  baseTerms,
  {
    previousGrossWorkDone: 850_000,
    previousAdvanceRecovered: 100_000,
    previousRetentionHeld: 0,
    carriedForwardDebitIn: 0,
  },
  { grossWorkDone: 150_000 }, // cumulative 1,000,000 = 100%
  {},
);
assert.equal(r4.advanceRecoveryAmount, 0, 'Invariant I1: Recovery must NEVER exceed total advance paid');

// 5. Invariant I1 Override Ceiling: User attempts manual override with 50% on remaining advance of only 15,000
const r5 = computeIpc(
  baseTerms,
  {
    previousGrossWorkDone: 800_000,
    previousAdvanceRecovered: 85_000,
    previousRetentionHeld: 0,
    carriedForwardDebitIn: 0,
  },
  { grossWorkDone: 100_000 },
  {
    advanceRecoveryOverride: true,
    advanceRecoveryPercent: 50, // 50% of 100,000 = 50,000, but only 15,000 remains!
  },
);
assert.equal(
  r5.advanceRecoveryAmount,
  15_000,
  'Invariant I1: Manual override MUST be capped by remaining advance (15,000)',
);

// 6. Default Path Verification: When advanceRecoveryOverride is undefined/false, does NOT use flat 10%
// At 24% progress: factor = (24 - 10)/(80 - 10) = 14/70 = 20% of 100k = 20k target
const r6 = computeIpc(
  baseTerms,
  { previousGrossWorkDone: 0, previousAdvanceRecovered: 0, previousRetentionHeld: 0, carriedForwardDebitIn: 0 },
  { grossWorkDone: 240_000 }, // 24% progress
  { advanceRecoveryPercent: 10 }, // Notice: advanceRecoveryOverride is NOT true!
);
assert.equal(
  r6.advanceRecoveryAmount,
  20_000,
  'Default path must run bounded window (20,000), ignoring flat percentage without override flag',
);

console.log('Invariant I1 PASSED: Advance recovery correctly bounded and capped on all paths.');

console.log('--- Testing Invariant I2: Retention Strictly on GWD and Capped ---');

// 7. Retention strictly on GWD, excluding MOS and Escalation
const r7 = computeIpc(
  { ...baseTerms, retentionRate: 0.1, retentionCap: 100_000 },
  { previousGrossWorkDone: 0, previousAdvanceRecovered: 0, previousRetentionHeld: 0, carriedForwardDebitIn: 0 },
  {
    grossWorkDone: 100_000,
    escalationAmount: 20_000,
    mosAdded: 30_000,
    mosReleased: 5_000,
  },
  {},
);
// Gross certified = 100,000 + 20,000 + 30,000 - 5,000 = 145,000
// Retention must be 10% of 100,000 (GWD) = 10,000 (NOT 10% of 145,000)
assert.equal(r7.retentionHeldAmount, 10_000, 'Invariant I2: Retention must be calculated strictly on GWD');
assert.equal(r7.grossCertified, 145_000, 'Gross certified must include GWD + escalation + net MOS');

// 8. Retention Cap enforcement
const r8 = computeIpc(
  { ...baseTerms, retentionRate: 0.1, retentionCap: 50_000 },
  { previousGrossWorkDone: 0, previousAdvanceRecovered: 0, previousRetentionHeld: 46_000, carriedForwardDebitIn: 0 },
  { grossWorkDone: 100_000 }, // potential = 10,000, but only 4,000 under cap!
  {},
);
assert.equal(r8.retentionHeldAmount, 4_000, 'Invariant I2: Retention must be capped at contractual retention cap');

console.log('Invariant I2 PASSED: Retention held strictly on GWD and capped at contractual limit.');

console.log('--- Testing Invariant I3: Liquidated Damages Contractual Cap (LD Cap) ---');

// 9. Contract value = 1,000,000, LD Cap = 10% (100,000). Claimed LD = 150,000
const r9 = computeIpc(
  { ...baseTerms, ldCapPct: 10 },
  { previousGrossWorkDone: 0, previousAdvanceRecovered: 0, previousRetentionHeld: 0, carriedForwardDebitIn: 0 },
  { grossWorkDone: 100_000 },
  { ldAmount: 150_000 },
);
assert.equal(r9.ldAmount, 100_000, 'Invariant I3: Liquidated damages must be capped by contractual cap (100,000)');

console.log('Invariant I3 PASSED: Liquidated damages capped by contractual limit.');

console.log('--- Testing Invariant I12: Itemized Deductions Multiple Rows & Reconciliation ---');

// 10. Multiple rows for same deduction type aggregated without row loss
const r10 = computeIpc(
  baseTerms,
  { previousGrossWorkDone: 0, previousAdvanceRecovered: 0, previousRetentionHeld: 0, carriedForwardDebitIn: 0 },
  { grossWorkDone: 200_000 },
  {
    backchargeAmount: 10_000,
    itemizedDeductions: [
      { deductionType: 'backcharge', amount: 5_000, description: 'Row 1 repair' },
      { deductionType: 'backcharge', amount: 3_000, description: 'Row 2 cleanup' },
      { deductionType: 'backcharge', amount: 2_000, description: 'Row 3 equipment damage' },
    ],
  },
);
assert.equal(
  r10.backchargeAmount,
  10_000,
  'Invariant I12: All itemized rows of same type must be summed without row loss',
);

// 11. Header / detail discrepancy detection
let threwExpected = false;
try {
  computeIpc(
    baseTerms,
    { previousGrossWorkDone: 0, previousAdvanceRecovered: 0, previousRetentionHeld: 0, carriedForwardDebitIn: 0 },
    { grossWorkDone: 200_000 },
    {
      backchargeAmount: 15_000, // Discrepancy: Header says 15,000, but details sum to 10,000
      itemizedDeductions: [
        { deductionType: 'backcharge', amount: 5_000 },
        { deductionType: 'backcharge', amount: 5_000 },
      ],
    },
  );
} catch (err: any) {
  threwExpected = true;
  assert(err instanceof BadRequestException, 'Discrepancy must throw BadRequestException');
}
assert.equal(threwExpected, true, 'Invariant I12: Discrepancy between header and itemized sum must be rejected');

console.log('Invariant I12 PASSED: Itemized deductions aggregate duplicate rows and reconcile with header.');

// 12. Reproducible Snapshot Verification
assert(r10.calcInputsSnapshot, 'calcInputsSnapshot must exist');
assert.equal(r10.calcInputsSnapshot.contractValue, 1_000_000);
assert.equal(r10.calcInputsSnapshot.layer1_grossCertified.grossCertified, 200_000);
assert.equal(r10.taxableBaseAmount, 200_000, 'Taxable base must equal grossCertified');

console.log('=============================================================');
console.log('ALL CONTRACTING IPC INVARIANTS (I1, I2, I3, I12) PASSED 100%!');
console.log('=============================================================');
