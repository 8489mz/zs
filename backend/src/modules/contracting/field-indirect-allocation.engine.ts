/**
 * Field Indirect Costs & Distributables Allocation Engine
 * (محرك توزيع المصاريف غير المباشرة للموقع وفق المعايير الدولية AACE RP 10S-90 / 34R-05)
 *
 * Constitutional Rules & Invariants:
 * 1. Pure functional engine with zero external I/O or DB dependencies (Rule 13).
 * 2. 4 Standard Cost Pools:
 *    - P1: labor_care (سكن عمال، إعاشة، انتقالات، بوفيه) -> Driver: Labor Days/Hours
 *    - P2: labor_burden (تأمينات، إقامات، تذاكر، علاج) -> Driver: Direct Labor Cost
 *    - P3: equipment_shared (معدات عامة للموقع، مولدات، وقود مشترك) -> Driver: Equipment Operating Hours
 *    - P4: site_supervision (رواتب مهندسي الموقع، كرفانات، تصاريح، حراسة) -> Driver: Direct Effort (Labor + Equipment)
 * 3. Strict Material Cost Exclusion: Material costs are strictly excluded from drivers to prevent value distortion.
 * 4. Subcontractor Backcharges: Recovered amounts (e.g. camp rent backcharged to subcontractors) are deducted from gross pool cost.
 * 5. Mobilization / Zero Production: If total driver quantity is 0, net cost is carried forward (deferred_out) with zero division by zero.
 * 6. Reconciliation Invariant: sum(allocated) + deferred_out === net_pool_cost to the exact millieme/cent (Single Source of Truth).
 */

export type CostPoolType = 'labor_care' | 'labor_burden' | 'equipment_shared' | 'site_supervision' | 'custom';
export type DriverType = 'labor_days' | 'labor_cost' | 'equipment_hours' | 'direct_effort' | 'manual_ratio';

export interface CostPoolInput {
  poolId: string;
  poolCode: string;
  poolName: string;
  poolType: CostPoolType;
  driverType: DriverType;
  grossExpenseAmount: number;
  recoveredBackchargeAmount?: number;
  deferredInAmount?: number;
}

export interface BoqDriverMetricsInput {
  boqItemId: string;
  boqCode: string;
  description: string;
  laborDays: number;
  laborCost: number;
  equipmentHours: number;
  directEquipmentCost?: number;
  directMaterialCost?: number; // purely for audit/reporting, strictly NOT used as driver!
  manualRatio?: number;
}

export interface ItemAllocationDetail {
  boqItemId: string;
  boqCode: string;
  driverQty: number;
  allocationRatio: number;
  allocatedAmount: number;
}

export interface PoolAllocationResult {
  poolId: string;
  poolCode: string;
  poolName: string;
  poolType: CostPoolType;
  driverType: DriverType;
  grossExpenseAmount: number;
  recoveredBackchargeAmount: number;
  deferredInAmount: number;
  netPoolCost: number;
  totalDriverQty: number;
  ratePerDriverUnit: number;
  deferredOutAmount: number;
  allocatedAmountTotal: number;
  allocations: ItemAllocationDetail[];
}

export interface BoqItemAggregatedSummary {
  boqItemId: string;
  boqCode: string;
  allocatedByPool: Record<string, number>;
  totalAllocatedIndirectCost: number;
}

export interface BatchAllocationSummary {
  totalGrossExpense: number;
  totalRecoveredBackcharge: number;
  totalDeferredIn: number;
  totalNetCost: number;
  totalAllocated: number;
  totalDeferredOut: number;
  poolSummaries: PoolAllocationResult[];
  boqItemSummaries: BoqItemAggregatedSummary[];
}

/**
 * Extracts the driver quantity for a specific BOQ item based on the driver type.
 * Enforces Constitutional Rule: Material costs are NEVER used as a driver.
 */
export function extractDriverQuantity(driverType: DriverType, metrics: BoqDriverMetricsInput): number {
  switch (driverType) {
    case 'labor_days':
      return Math.max(0, Number(metrics.laborDays || 0));

    case 'labor_cost':
      return Math.max(0, Number(metrics.laborCost || 0));

    case 'equipment_hours':
      return Math.max(0, Number(metrics.equipmentHours || 0));

    case 'direct_effort': {
      // Direct Effort = Direct Labor Cost + Direct Equipment Cost (Strictly EXCLUDES Material Cost)
      const labor = Math.max(0, Number(metrics.laborCost || 0));
      const equip = Math.max(0, Number(metrics.directEquipmentCost || 0));
      return Math.round((labor + equip) * 1000) / 1000;
    }

    case 'manual_ratio':
      return Math.max(0, Number(metrics.manualRatio || 0));

    default:
      return 0;
  }
}

/**
 * Computes allocation for a single cost pool across a set of BOQ items.
 * Handles zero-driver mobilization carry-forward, backcharges deduction, and penny rounding reconciliation.
 */
export function computePoolAllocation(pool: CostPoolInput, items: BoqDriverMetricsInput[]): PoolAllocationResult {
  const gross = Math.max(0, Number(pool.grossExpenseAmount || 0));
  const recovered = Math.max(0, Number(pool.recoveredBackchargeAmount || 0));
  const deferredIn = Math.max(0, Number(pool.deferredInAmount || 0));

  // Net Pool Cost = Gross - Recovered Backcharges + Deferred In
  const netPoolCost = Math.round(Math.max(0, gross - recovered + deferredIn) * 1000) / 1000;

  // Calculate driver quantity per item
  const itemDrivers = items.map((it) => ({
    boqItemId: it.boqItemId,
    boqCode: it.boqCode,
    driverQty: extractDriverQuantity(pool.driverType, it),
  }));

  const totalDriverQty = itemDrivers.reduce((sum, d) => sum + d.driverQty, 0);

  // Mobilization / Zero-production defense:
  // If totalDriverQty is 0, no allocation is made to any item.
  // Full netPoolCost is carried forward (deferredOutAmount) to the next productive period.
  if (totalDriverQty <= 0 || netPoolCost <= 0) {
    return {
      poolId: pool.poolId,
      poolCode: pool.poolCode,
      poolName: pool.poolName,
      poolType: pool.poolType,
      driverType: pool.driverType,
      grossExpenseAmount: gross,
      recoveredBackchargeAmount: recovered,
      deferredInAmount: deferredIn,
      netPoolCost,
      totalDriverQty: 0,
      ratePerDriverUnit: 0,
      deferredOutAmount: netPoolCost,
      allocatedAmountTotal: 0,
      allocations: itemDrivers.map((d) => ({
        boqItemId: d.boqItemId,
        boqCode: d.boqCode,
        driverQty: 0,
        allocationRatio: 0,
        allocatedAmount: 0,
      })),
    };
  }

  const ratePerDriverUnit = Math.round((netPoolCost / totalDriverQty) * 1000000) / 1000000;

  // First pass: allocate proportionally with 3 decimal precision
  let runningAllocatedSum = 0;
  let maxAllocatedIdx = -1;
  let maxDriverQty = -1;

  const rawAllocations: ItemAllocationDetail[] = itemDrivers.map((d, idx) => {
    if (d.driverQty > maxDriverQty) {
      maxDriverQty = d.driverQty;
      maxAllocatedIdx = idx;
    }
    const ratio = d.driverQty / totalDriverQty;
    const rawAmount = Math.round(netPoolCost * ratio * 1000) / 1000;
    runningAllocatedSum = Math.round((runningAllocatedSum + rawAmount) * 1000) / 1000;

    return {
      boqItemId: d.boqItemId,
      boqCode: d.boqCode,
      driverQty: d.driverQty,
      allocationRatio: Math.round(ratio * 1000000) / 1000000,
      allocatedAmount: rawAmount,
    };
  });

  // Second pass: Penny / Millieme rounding reconciliation (Single Source of Truth)
  // Ensure sum(allocatedAmount) === netPoolCost exactly
  const discrepancy = Math.round((netPoolCost - runningAllocatedSum) * 1000) / 1000;
  if (discrepancy !== 0 && maxAllocatedIdx >= 0) {
    rawAllocations[maxAllocatedIdx].allocatedAmount =
      Math.round((rawAllocations[maxAllocatedIdx].allocatedAmount + discrepancy) * 1000) / 1000;
  }

  const finalAllocatedTotal = rawAllocations.reduce((sum, a) => sum + a.allocatedAmount, 0);
  const roundedAllocatedTotal = Math.round(finalAllocatedTotal * 1000) / 1000;

  return {
    poolId: pool.poolId,
    poolCode: pool.poolCode,
    poolName: pool.poolName,
    poolType: pool.poolType,
    driverType: pool.driverType,
    grossExpenseAmount: gross,
    recoveredBackchargeAmount: recovered,
    deferredInAmount: deferredIn,
    netPoolCost,
    totalDriverQty: Math.round(totalDriverQty * 10000) / 10000,
    ratePerDriverUnit,
    deferredOutAmount: 0,
    allocatedAmountTotal: roundedAllocatedTotal,
    allocations: rawAllocations,
  };
}

/**
 * Computes multi-pool batch allocation across all active pools and BOQ items.
 * Aggregates results per pool and per BOQ item, asserting invariants.
 */
export function computeBatchAllocation(pools: CostPoolInput[], items: BoqDriverMetricsInput[]): BatchAllocationSummary {
  const poolSummaries: PoolAllocationResult[] = pools.map((p) => computePoolAllocation(p, items));

  let totalGrossExpense = 0;
  let totalRecoveredBackcharge = 0;
  let totalDeferredIn = 0;
  let totalNetCost = 0;
  let totalAllocated = 0;
  let totalDeferredOut = 0;

  // Map to accumulate BOQ item allocations across all pools
  const itemMap = new Map<string, { boqCode: string; allocatedByPool: Record<string, number>; total: number }>();
  for (const it of items) {
    itemMap.set(it.boqItemId, {
      boqCode: it.boqCode,
      allocatedByPool: {},
      total: 0,
    });
  }

  for (const poolRes of poolSummaries) {
    totalGrossExpense += poolRes.grossExpenseAmount;
    totalRecoveredBackcharge += poolRes.recoveredBackchargeAmount;
    totalDeferredIn += poolRes.deferredInAmount;
    totalNetCost += poolRes.netPoolCost;
    totalAllocated += poolRes.allocatedAmountTotal;
    totalDeferredOut += poolRes.deferredOutAmount;

    for (const alloc of poolRes.allocations) {
      const entry = itemMap.get(alloc.boqItemId);
      if (entry) {
        entry.allocatedByPool[poolRes.poolCode] = alloc.allocatedAmount;
        entry.total = Math.round((entry.total + alloc.allocatedAmount) * 1000) / 1000;
      }
    }
  }

  const boqItemSummaries: BoqItemAggregatedSummary[] = Array.from(itemMap.entries()).map(([id, val]) => ({
    boqItemId: id,
    boqCode: val.boqCode,
    allocatedByPool: val.allocatedByPool,
    totalAllocatedIndirectCost: val.total,
  }));

  const summary: BatchAllocationSummary = {
    totalGrossExpense: Math.round(totalGrossExpense * 1000) / 1000,
    totalRecoveredBackcharge: Math.round(totalRecoveredBackcharge * 1000) / 1000,
    totalDeferredIn: Math.round(totalDeferredIn * 1000) / 1000,
    totalNetCost: Math.round(totalNetCost * 1000) / 1000,
    totalAllocated: Math.round(totalAllocated * 1000) / 1000,
    totalDeferredOut: Math.round(totalDeferredOut * 1000) / 1000,
    poolSummaries,
    boqItemSummaries,
  };

  // Assert Rule 13 Reconciliation Invariant
  reconcileAllocationInvariants(summary);

  return summary;
}

/**
 * Asserts the inviolable Single Source of Truth accounting invariant:
 * totalAllocated + totalDeferredOut === totalNetCost
 * Throws a hard error if any discrepancy exists.
 */
export function reconcileAllocationInvariants(summary: BatchAllocationSummary): void {
  const sumCheck = Math.round((summary.totalAllocated + summary.totalDeferredOut) * 1000) / 1000;
  const netCheck = summary.totalNetCost;
  const delta = Math.round(Math.abs(sumCheck - netCheck) * 1000) / 1000;

  if (delta > 0.001) {
    throw new Error(
      `[FieldIndirectAllocationEngine Invariant Violation] Discrepancy detected: totalAllocated (${summary.totalAllocated}) + totalDeferredOut (${summary.totalDeferredOut}) = ${sumCheck}, expected netPoolCost ${netCheck} (Delta: ${delta})`,
    );
  }

  for (const pool of summary.poolSummaries) {
    const poolSum = Math.round((pool.allocatedAmountTotal + pool.deferredOutAmount) * 1000) / 1000;
    const poolDelta = Math.round(Math.abs(poolSum - pool.netPoolCost) * 1000) / 1000;
    if (poolDelta > 0.001) {
      throw new Error(
        `[FieldIndirectAllocationEngine Invariant Violation] Pool ${pool.poolCode}: allocated (${pool.allocatedAmountTotal}) + deferredOut (${pool.deferredOutAmount}) = ${poolSum}, expected netPoolCost ${pool.netPoolCost} (Delta: ${poolDelta})`,
      );
    }
  }
}
