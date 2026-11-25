import { BadRequestException } from '@nestjs/common';

// =============================================================================
// FIDIC / MRICS Compliant 4-Layer IPC Calculation Engine
// Single Source of Truth for Subcontractor and Main Contractor IPC Calculations
// =============================================================================

export interface IpcTerms {
  contractValue: number;
  advanceTotal: number;
  advanceRecoveryStartPct: number;
  advanceRecoveryEndPct: number;
  retentionRate: number; // e.g. 0.05 for 5%
  retentionCap: number; // Maximum retention holdback amount in currency
  ldCapPct?: number; // e.g. 10 for 10% liquidated damages cap
}

export interface IpcPriorCumulatives {
  previousGrossWorkDone: number;
  previousAdvanceRecovered: number;
  previousRetentionHeld: number;
  carriedForwardDebitIn: number;
}

export interface IpcPeriodWork {
  grossWorkDone: number;
  escalationAmount?: number;
  mosAdded?: number;
  mosReleased?: number;
  vatAmount?: number;
}

export interface IpcItemizedDeduction {
  deductionType: string;
  amount: number;
  description?: string;
}

export interface IpcDeductionInputs {
  advanceRecoveryOverride?: boolean;
  advanceRecoveryPercent?: number;
  backchargeAmount?: number;
  ldAmount?: number;
  materialExcessAmount?: number;
  sharedResourceAmount?: number;
  directPaymentAmount?: number;
  socialInsuranceAmount?: number;
  whtAmount?: number;
  otherDeductions?: number;
  itemizedDeductions?: IpcItemizedDeduction[];
}

export interface IpcComputationResult {
  // Layer 1: Gross Certified Work
  grossCertified: number;
  mosBalance: number;
  cumulativeGrossWorkDone: number;
  progressRatio: number;

  // Layer 2: Contractual Holdbacks
  advanceRecoveryAmount: number;
  retentionHeldAmount: number;

  // Layer 3: Project Set-Offs / Contra-Charges
  backchargeAmount: number;
  ldAmount: number;
  materialExcessAmount: number;
  sharedResourceAmount: number;
  directPaymentAmount: number;
  otherDeductions: number;
  totalSetOffs: number;

  // Layer 4: Taxes, Statutory Obligations & Net Payable
  vatAmount: number;
  whtAmount: number;
  socialInsuranceAmount: number;
  netBeforeStatutory: number;
  rawNetPayable: number;
  netPayable: number;
  carriedForwardDebitOut: number;
  taxableBaseAmount: number;

  // Complete Reproducible Snapshot for Financial Audit
  calcInputsSnapshot: Record<string, any>;
}

/**
 * Pure calculation function for IPC Certificates (FIDIC 4-Layer Architecture)
 * Enforces Invariants:
 * - I1: Advance Recovery bounded by remaining advance on ALL paths.
 * - I2: Retention applied strictly to GWD, excluding MOS/Escalation, capped by retentionCap.
 * - I3: Liquidated damages capped by contractual limit.
 * - I12: Deductions aggregated without row loss, detail treated as single source of truth.
 */
export function computeIpc(
  terms: IpcTerms,
  prior: IpcPriorCumulatives,
  period: IpcPeriodWork,
  deductions: IpcDeductionInputs,
): IpcComputationResult {
  const contractValue = Number(terms.contractValue || 0);
  const advanceTotal = Number(terms.advanceTotal || 0);
  const recoveryStartPct = Number(terms.advanceRecoveryStartPct ?? 10);
  const recoveryEndPct = Number(terms.advanceRecoveryEndPct ?? 80);
  const retentionRate = Number(terms.retentionRate ?? 0.05);
  const retentionCap = Number(terms.retentionCap || 0);
  const ldCapPct = Number(terms.ldCapPct ?? 10);

  const previousGrossWorkDone = Number(prior.previousGrossWorkDone || 0);
  const previousAdvanceRecovered = Number(prior.previousAdvanceRecovered || 0);
  const previousRetentionHeld = Number(prior.previousRetentionHeld || 0);
  const carriedForwardDebitIn = Number(prior.carriedForwardDebitIn || 0);

  const grossWorkDone = Number(period.grossWorkDone || 0);
  const escalationAmount = Number(period.escalationAmount || 0);
  const mosAdded = Number(period.mosAdded || 0);
  const mosReleased = Number(period.mosReleased || 0);
  const vatAmount = Number(period.vatAmount || 0);

  // =========================================================================
  // Layer 1: Gross Certified Work (إجمالي الأعمال المعتمدة)
  // =========================================================================
  const grossCertified = Math.round((grossWorkDone + escalationAmount + mosAdded - mosReleased) * 100) / 100;
  const mosBalance = Math.max(0, mosAdded - mosReleased);
  const cumulativeGrossWorkDone = previousGrossWorkDone + grossWorkDone;
  const progressRatio = contractValue > 0 ? cumulativeGrossWorkDone / contractValue : 0;

  // =========================================================================
  // Layer 2: Contractual Holdbacks (استردادات الدفعة المقدمة وحجز الضمان)
  // =========================================================================
  const useManualOverride =
    deductions.advanceRecoveryOverride === true && deductions.advanceRecoveryPercent !== undefined;
  let advanceRecoveryAmount = 0;

  if (useManualOverride) {
    advanceRecoveryAmount = (grossWorkDone * Number(deductions.advanceRecoveryPercent)) / 100;
  } else if (advanceTotal > 0 && recoveryEndPct > recoveryStartPct && contractValue > 0) {
    const startRatio = recoveryStartPct / 100;
    const endRatio = recoveryEndPct / 100;
    const clampedFactor = Math.min(1, Math.max(0, (progressRatio - startRatio) / (endRatio - startRatio)));
    const targetCumulativeRecovery = advanceTotal * clampedFactor;
    advanceRecoveryAmount = Math.max(0, targetCumulativeRecovery - previousAdvanceRecovered);
  } else if (advanceTotal > 0) {
    advanceRecoveryAmount = (grossWorkDone * 10) / 100;
  }

  // Invariant I1: Universal Ceiling Cap on ALL execution paths (never recover more than remaining advance)
  const remainingAdvance = Math.max(0, advanceTotal - previousAdvanceRecovered);
  advanceRecoveryAmount = Math.round(Math.max(0, Math.min(advanceRecoveryAmount, remainingAdvance)) * 100) / 100;

  // Invariant I2: Retention held strictly on GWD (excluding MOS and Escalation), capped at retentionCap
  let retentionHeldAmount = 0;
  const potentialRetention = grossWorkDone * retentionRate;
  if (retentionCap > 0) {
    const remainingRetentionAllowed = Math.max(0, retentionCap - previousRetentionHeld);
    retentionHeldAmount = Math.min(potentialRetention, remainingRetentionAllowed);
  } else {
    retentionHeldAmount = potentialRetention;
  }
  retentionHeldAmount = Math.round(retentionHeldAmount * 100) / 100;

  // =========================================================================
  // Layer 3: Project Set-Offs / Contra-Charges (المقاصات واستقطاعات المشروع)
  // =========================================================================
  let backchargeAmount = Number(deductions.backchargeAmount || 0);
  let ldAmount = Number(deductions.ldAmount || 0);
  let materialExcessAmount = Number(deductions.materialExcessAmount || 0);
  let sharedResourceAmount = Number(deductions.sharedResourceAmount || 0);
  let directPaymentAmount = Number(deductions.directPaymentAmount || 0);
  let socialInsuranceAmount = Number(deductions.socialInsuranceAmount || 0);
  let whtAmount = Number(deductions.whtAmount || 0);
  let otherDeductions = Number(deductions.otherDeductions || 0);

  // Invariant I3: Liquidated Damages Contractual Cap (LD Cap)
  if (ldCapPct > 0 && contractValue > 0) {
    const ldCap = (contractValue * ldCapPct) / 100;
    ldAmount = Math.min(ldAmount, ldCap);
  }

  // Invariant I12: Reconcile itemized deductions (Map aggregation across ALL rows)
  if (deductions.itemizedDeductions && deductions.itemizedDeductions.length > 0) {
    const itemizedSums = new Map<string, number>();
    for (const d of deductions.itemizedDeductions) {
      const type = d.deductionType;
      const amt = Number(d.amount || 0);
      itemizedSums.set(type, (itemizedSums.get(type) || 0) + amt);
    }

    for (const [type, detailSum] of itemizedSums.entries()) {
      if (type === 'backcharge') {
        if (backchargeAmount > 0 && Math.abs(backchargeAmount - detailSum) > 0.01) {
          throw new BadRequestException(
            `تعارض في خصم المحملات (Backcharge): الرأس ${backchargeAmount} والتفصيل ${detailSum}`,
          );
        }
        backchargeAmount = detailSum;
      } else if (type === 'liquidated_damages') {
        if (ldAmount > 0 && Math.abs(ldAmount - detailSum) > 0.01) {
          throw new BadRequestException(`تعارض في غرامة التأخير (LD): الرأس ${ldAmount} والتفصيل ${detailSum}`);
        }
        ldAmount = detailSum;
      } else if (type === 'material_excess') {
        if (materialExcessAmount > 0 && Math.abs(materialExcessAmount - detailSum) > 0.01) {
          throw new BadRequestException(`تعارض في هالك المواد: الرأس ${materialExcessAmount} والتفصيل ${detailSum}`);
        }
        materialExcessAmount = detailSum;
      } else if (type === 'shared_resources') {
        if (sharedResourceAmount > 0 && Math.abs(sharedResourceAmount - detailSum) > 0.01) {
          throw new BadRequestException(
            `تعارض في الموارد المشتركة: الرأس ${sharedResourceAmount} والتفصيل ${detailSum}`,
          );
        }
        sharedResourceAmount = detailSum;
      } else if (type === 'direct_labor_payment') {
        if (directPaymentAmount > 0 && Math.abs(directPaymentAmount - detailSum) > 0.01) {
          throw new BadRequestException(
            `تعارض في سداد العمالة المباشر: الرأس ${directPaymentAmount} والتفصيل ${detailSum}`,
          );
        }
        directPaymentAmount = detailSum;
      } else if (type === 'social_insurance') {
        if (socialInsuranceAmount > 0 && Math.abs(socialInsuranceAmount - detailSum) > 0.01) {
          throw new BadRequestException(
            `تعارض في التأمينات الاجتماعية: الرأس ${socialInsuranceAmount} والتفصيل ${detailSum}`,
          );
        }
        socialInsuranceAmount = detailSum;
      } else if (type === 'withholding_tax') {
        if (whtAmount > 0 && Math.abs(whtAmount - detailSum) > 0.01) {
          throw new BadRequestException(`تعارض في ضريبة الخصم: الرأس ${whtAmount} والتفصيل ${detailSum}`);
        }
        whtAmount = detailSum;
      } else if (type === 'other') {
        if (otherDeductions > 0 && Math.abs(otherDeductions - detailSum) > 0.01) {
          throw new BadRequestException(`تعارض في الاستقطاعات الأخرى: الرأس ${otherDeductions} والتفصيل ${detailSum}`);
        }
        otherDeductions = detailSum;
      }
    }
  }

  // Re-verify LD Cap after itemized deduction
  if (ldCapPct > 0 && contractValue > 0) {
    const ldCap = (contractValue * ldCapPct) / 100;
    ldAmount = Math.min(ldAmount, ldCap);
  }

  const totalSetOffs =
    Math.round(
      (backchargeAmount +
        ldAmount +
        materialExcessAmount +
        sharedResourceAmount +
        directPaymentAmount +
        carriedForwardDebitIn +
        otherDeductions) *
        100,
    ) / 100;

  // =========================================================================
  // Layer 4: Taxes, Statutory Obligations & Net Final
  // =========================================================================
  const netBeforeStatutory =
    Math.round((grossCertified - advanceRecoveryAmount - retentionHeldAmount - totalSetOffs) * 100) / 100;
  const rawNetPayable = Math.round((netBeforeStatutory + vatAmount - whtAmount - socialInsuranceAmount) * 100) / 100;

  let netPayable = 0;
  let carriedForwardDebitOut = 0;

  if (rawNetPayable < 0) {
    carriedForwardDebitOut = Math.abs(rawNetPayable);
    netPayable = 0;
  } else {
    netPayable = rawNetPayable;
    carriedForwardDebitOut = 0;
  }

  const taxableBaseAmount = grossCertified;

  // Financial snapshot for complete reproducibility
  const calcInputsSnapshot = {
    contractValue,
    progressRatio,
    cumulativeGrossWorkDone,
    recoveryWindow: {
      startPct: recoveryStartPct,
      endPct: recoveryEndPct,
    },
    previousTotals: {
      previousGrossWorkDone,
      previousAdvanceRecovered,
      previousRetentionHeld,
    },
    layer1_grossCertified: {
      grossWorkDone,
      escalationAmount,
      mosAdded,
      mosReleased,
      grossCertified,
    },
    layer2_holdbacks: {
      retentionRate,
      retentionCap,
      previousRetentionHeld,
      retentionHeldAmount,
      advanceRecoveryAmount,
      remainingAdvance,
    },
    layer3_setOffs: {
      backchargeAmount,
      ldAmount,
      materialExcessAmount,
      sharedResourceAmount,
      directPaymentAmount,
      carriedForwardDebitIn,
      otherDeductions,
      totalSetOffs,
    },
    layer4_statutoryAndNet: {
      taxableBaseAmount,
      vatAmount,
      whtAmount,
      socialInsuranceAmount,
      netBeforeStatutory,
      rawNetPayable,
      netPayable,
      carriedForwardDebitOut,
    },
  };

  return {
    grossCertified,
    mosBalance,
    cumulativeGrossWorkDone,
    progressRatio,
    advanceRecoveryAmount,
    retentionHeldAmount,
    backchargeAmount,
    ldAmount,
    materialExcessAmount,
    sharedResourceAmount,
    directPaymentAmount,
    otherDeductions,
    totalSetOffs,
    vatAmount,
    whtAmount,
    socialInsuranceAmount,
    netBeforeStatutory,
    rawNetPayable,
    netPayable,
    carriedForwardDebitOut,
    taxableBaseAmount,
    calcInputsSnapshot,
  };
}
