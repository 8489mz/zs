import assert from 'assert';
import {
  computePoolAllocation,
  computeBatchAllocation,
  extractDriverQuantity,
  reconcileAllocationInvariants,
  CostPoolInput,
  BoqDriverMetricsInput,
} from '../../src/modules/contracting/field-indirect-allocation.engine';

// =============================================================================
// CRITICAL FINANCIAL AUDIT SUITE: Field Indirect Cost Allocation (Track 1)
// Directly imports production engine without mock duplications (Rule 13 AGENTS.md)
// Conforming to AACE RP 10S-90 / 34R-05 & Activity-Based Costing (ABC)
// =============================================================================

function runIndirectAllocationTestSuite() {
  console.log('=== بدء اختبارات محرك توزيع المصاريف غير المباشرة للموقع (Track 1) ===\n');

  // ---------------------------------------------------------------------------
  // Test 1: Pool 1 - Labor Logistics & Care (سكن عمال، إعاشة، انتقالات)
  // Driver: Labor Days (Man-Days)
  // ---------------------------------------------------------------------------
  {
    const pool: CostPoolInput = {
      poolId: 'pool-1',
      poolCode: 'P1_LABOR_CARE',
      poolName: 'سكن وإعاشة وانتقالات العمالة',
      poolType: 'labor_care',
      driverType: 'labor_days',
      grossExpenseAmount: 50000,
    };

    const items: BoqDriverMetricsInput[] = [
      {
        boqItemId: 'item-1',
        boqCode: 'BOQ-01',
        description: 'خرسانات مسلحة',
        laborDays: 10,
        laborCost: 5000,
        equipmentHours: 20,
      },
      {
        boqItemId: 'item-2',
        boqCode: 'BOQ-02',
        description: 'مباني وعزل',
        laborDays: 30,
        laborCost: 15000,
        equipmentHours: 5,
      },
      {
        boqItemId: 'item-3',
        boqCode: 'BOQ-03',
        description: 'تشطيبات وديكور',
        laborDays: 60,
        laborCost: 30000,
        equipmentHours: 0,
      },
    ];

    const result = computePoolAllocation(pool, items);

    assert.strictEqual(result.netPoolCost, 50000);
    assert.strictEqual(result.totalDriverQty, 100);
    assert.strictEqual(result.ratePerDriverUnit, 500); // 50000 / 100
    assert.strictEqual(result.deferredOutAmount, 0);
    assert.strictEqual(result.allocatedAmountTotal, 50000);

    const alloc1 = result.allocations.find((a) => a.boqItemId === 'item-1')!;
    const alloc2 = result.allocations.find((a) => a.boqItemId === 'item-2')!;
    const alloc3 = result.allocations.find((a) => a.boqItemId === 'item-3')!;

    assert.strictEqual(alloc1.allocatedAmount, 5000); // 10 * 500
    assert.strictEqual(alloc2.allocatedAmount, 15000); // 30 * 500
    assert.strictEqual(alloc3.allocatedAmount, 30000); // 60 * 500
    assert.strictEqual(alloc1.allocatedAmount + alloc2.allocatedAmount + alloc3.allocatedAmount, 50000);
    console.log('✓ Test 1 Passed: [Pool 1 - Labor Care] Allocated man-days proportionally with exact sum.');
  }

  // ---------------------------------------------------------------------------
  // Test 2: Subcontractor Backcharge Recovery (استرداد استقطاع سكن مقاول باطن)
  // Gross Pool Expense - Recovered Backcharges = Net Pool Cost
  // ---------------------------------------------------------------------------
  {
    const pool: CostPoolInput = {
      poolId: 'pool-1',
      poolCode: 'P1_LABOR_CARE',
      poolName: 'سكن وإعاشة الموقع',
      poolType: 'labor_care',
      driverType: 'labor_days',
      grossExpenseAmount: 80000,
      recoveredBackchargeAmount: 25000, // Backcharged to subcontractor for labor camp
    };

    const items: BoqDriverMetricsInput[] = [
      {
        boqItemId: 'item-1',
        boqCode: 'BOQ-01',
        description: 'حفر وردم',
        laborDays: 20,
        laborCost: 10000,
        equipmentHours: 50,
      },
      {
        boqItemId: 'item-2',
        boqCode: 'BOQ-02',
        description: 'هيكل خرساني',
        laborDays: 80,
        laborCost: 40000,
        equipmentHours: 150,
      },
    ];

    const result = computePoolAllocation(pool, items);

    // Net must be 80000 - 25000 = 55000
    assert.strictEqual(result.netPoolCost, 55000);
    assert.strictEqual(result.totalDriverQty, 100);
    assert.strictEqual(result.allocatedAmountTotal, 55000);

    const alloc1 = result.allocations.find((a) => a.boqItemId === 'item-1')!;
    const alloc2 = result.allocations.find((a) => a.boqItemId === 'item-2')!;

    assert.strictEqual(alloc1.allocatedAmount, 11000); // 20% of 55000
    assert.strictEqual(alloc2.allocatedAmount, 44000); // 80% of 55000
    assert.strictEqual(alloc1.allocatedAmount + alloc2.allocatedAmount, 55000);
    console.log('✓ Test 2 Passed: [Backcharge Recovery] Net pool cost correctly deducted without double counting.');
  }

  // ---------------------------------------------------------------------------
  // Test 3: Mobilization Period & Zero Production Defense (مرحلة التجهيز وصفرية الإنتاج)
  // If Driver === 0, net cost is carried forward (deferred_out) without division by zero!
  // ---------------------------------------------------------------------------
  {
    const pool: CostPoolInput = {
      poolId: 'pool-mfg',
      poolCode: 'P1_MOBILIZATION',
      poolName: 'تجهيز الموقع والأسوار المؤقتة',
      poolType: 'labor_care',
      driverType: 'labor_days',
      grossExpenseAmount: 45000,
      recoveredBackchargeAmount: 0,
    };

    // Month 1: Site mobilization, zero man-days logged for BOQ items yet
    const items: BoqDriverMetricsInput[] = [
      { boqItemId: 'item-1', boqCode: 'BOQ-01', description: 'خرسانات', laborDays: 0, laborCost: 0, equipmentHours: 0 },
      { boqItemId: 'item-2', boqCode: 'BOQ-02', description: 'مباني', laborDays: 0, laborCost: 0, equipmentHours: 0 },
    ];

    const result = computePoolAllocation(pool, items);

    assert.strictEqual(result.netPoolCost, 45000);
    assert.strictEqual(result.totalDriverQty, 0);
    assert.strictEqual(result.ratePerDriverUnit, 0);
    assert.strictEqual(result.allocatedAmountTotal, 0);
    // Full amount must be carried forward to next productive period
    assert.strictEqual(result.deferredOutAmount, 45000);
    assert.strictEqual(result.allocatedAmountTotal + result.deferredOutAmount, 45000);
    console.log('✓ Test 3 Passed: [Mobilization Defense] Zero-production carried forward cleanly without div-by-zero.');
  }

  // ---------------------------------------------------------------------------
  // Test 4: Subsequent Period with Deferred In (استيعاب الرصيد المرحل في شهر الإنتاج)
  // New Expenses + Carried Forward = Total Net Pool Cost
  // ---------------------------------------------------------------------------
  {
    const pool: CostPoolInput = {
      poolId: 'pool-mfg-2',
      poolCode: 'P1_MOBILIZATION',
      poolName: 'تجهيز الموقع وسكن العمال',
      poolType: 'labor_care',
      driverType: 'labor_days',
      grossExpenseAmount: 15000, // Month 2 new expenses
      deferredInAmount: 45000, // Carried forward from Month 1 mobilization
    };

    // Month 2: Production starts!
    const items: BoqDriverMetricsInput[] = [
      {
        boqItemId: 'item-1',
        boqCode: 'BOQ-01',
        description: 'حفر وأساسات',
        laborDays: 150,
        laborCost: 75000,
        equipmentHours: 50,
      },
      {
        boqItemId: 'item-2',
        boqCode: 'BOQ-02',
        description: 'هيكل خرساني',
        laborDays: 450,
        laborCost: 225000,
        equipmentHours: 150,
      },
    ];

    const result = computePoolAllocation(pool, items);

    // Total net cost to distribute = 15000 + 45000 = 60000
    assert.strictEqual(result.netPoolCost, 60000);
    assert.strictEqual(result.totalDriverQty, 600);
    assert.strictEqual(result.ratePerDriverUnit, 100); // 60000 / 600
    assert.strictEqual(result.allocatedAmountTotal, 60000);
    assert.strictEqual(result.deferredOutAmount, 0);

    const alloc1 = result.allocations.find((a) => a.boqItemId === 'item-1')!;
    const alloc2 = result.allocations.find((a) => a.boqItemId === 'item-2')!;

    assert.strictEqual(alloc1.allocatedAmount, 15000); // 150 * 100
    assert.strictEqual(alloc2.allocatedAmount, 45000); // 450 * 100
    assert.strictEqual(alloc1.allocatedAmount + alloc2.allocatedAmount, 60000);
    console.log('✓ Test 4 Passed: [Deferred-In Absorption] Carried forward balance absorbed into productive period.');
  }

  // ---------------------------------------------------------------------------
  // Test 5: Pool 3 - Equipment Shared (المعدات العامة ومولدات الموقع والمحروقات)
  // Driver: Equipment Operating Hours
  // ---------------------------------------------------------------------------
  {
    const pool: CostPoolInput = {
      poolId: 'pool-3',
      poolCode: 'P3_EQUIP_SHARED',
      poolName: 'المعدات العامة ومولدات الموقع والمحروقات',
      poolType: 'equipment_shared',
      driverType: 'equipment_hours',
      grossExpenseAmount: 24000,
    };

    const items: BoqDriverMetricsInput[] = [
      {
        boqItemId: 'item-1',
        boqCode: 'BOQ-01',
        description: 'أعمال الحفر',
        laborDays: 10,
        laborCost: 5000,
        equipmentHours: 50,
      },
      {
        boqItemId: 'item-2',
        boqCode: 'BOQ-02',
        description: 'خرسانة مسلحة',
        laborDays: 40,
        laborCost: 20000,
        equipmentHours: 150,
      },
      {
        boqItemId: 'item-3',
        boqCode: 'BOQ-03',
        description: 'دهانات يدوية',
        laborDays: 50,
        laborCost: 25000,
        equipmentHours: 0,
      },
    ];

    const result = computePoolAllocation(pool, items);

    assert.strictEqual(result.netPoolCost, 24000);
    assert.strictEqual(result.totalDriverQty, 200); // 50 + 150 + 0
    assert.strictEqual(result.ratePerDriverUnit, 120); // 24000 / 200

    const alloc1 = result.allocations.find((a) => a.boqItemId === 'item-1')!;
    const alloc2 = result.allocations.find((a) => a.boqItemId === 'item-2')!;
    const alloc3 = result.allocations.find((a) => a.boqItemId === 'item-3')!;

    assert.strictEqual(alloc1.allocatedAmount, 6000); // 50 * 120
    assert.strictEqual(alloc2.allocatedAmount, 18000); // 150 * 120
    assert.strictEqual(alloc3.allocatedAmount, 0); // 0 hours
    assert.strictEqual(result.allocatedAmountTotal, 24000);
    console.log('✓ Test 5 Passed: [Pool 3 - Equipment Shared] Machine hours allocated accurately.');
  }

  // ---------------------------------------------------------------------------
  // Test 6: Pool 4 - Site Supervision Constitutional Guard (حظر استخدام المواد كمحرك)
  // Driver: Direct Effort (Labor + Equipment). Strictly EXCLUDES Material Cost!
  // ---------------------------------------------------------------------------
  {
    const pool: CostPoolInput = {
      poolId: 'pool-4',
      poolCode: 'P4_SITE_SUPERVISION',
      poolName: 'إدارة وإشراف الموقع وكرفانات المهندسين',
      poolType: 'site_supervision',
      driverType: 'direct_effort',
      grossExpenseAmount: 40000,
    };

    // Item 1 has $1,000,000 in raw material (e.g. imported HVAC chiller), but only $10k labor & $10k equipment
    // Item 2 has $50k material, but $40k labor & $20k equipment
    const items: BoqDriverMetricsInput[] = [
      {
        boqItemId: 'item-chiller',
        boqCode: 'BOQ-MEP',
        description: 'توريد وتركيب مبرد مركزي تشيلر',
        laborDays: 5,
        laborCost: 10000,
        equipmentHours: 10,
        directEquipmentCost: 10000,
        directMaterialCost: 1000000, // $1M material must NOT distort supervision allocation!
      },
      {
        boqItemId: 'item-civil',
        boqCode: 'BOQ-CIVIL',
        description: 'خرسانات وأعمال مدنية كثيفة الجهد',
        laborDays: 40,
        laborCost: 40000,
        equipmentHours: 30,
        directEquipmentCost: 20000,
        directMaterialCost: 50000,
      },
    ];

    // Verify extractDriverQuantity excludes directMaterialCost
    const driver1 = extractDriverQuantity('direct_effort', items[0]);
    const driver2 = extractDriverQuantity('direct_effort', items[1]);

    assert.strictEqual(driver1, 20000); // 10000 labor + 10000 equipment (excludes $1M material)
    assert.strictEqual(driver2, 60000); // 40000 labor + 20000 equipment

    const result = computePoolAllocation(pool, items);

    assert.strictEqual(result.totalDriverQty, 80000);
    assert.strictEqual(result.ratePerDriverUnit, 0.5); // 40000 / 80000

    const alloc1 = result.allocations.find((a) => a.boqItemId === 'item-chiller')!;
    const alloc2 = result.allocations.find((a) => a.boqItemId === 'item-civil')!;

    // Item 1 with $1M material only absorbs 25% ($10,000) of supervision, exactly proportional to true effort
    assert.strictEqual(alloc1.allocatedAmount, 10000);
    assert.strictEqual(alloc2.allocatedAmount, 30000);
    assert.strictEqual(alloc1.allocatedAmount + alloc2.allocatedAmount, 40000);
    console.log('✓ Test 6 Passed: [Constitutional Guard] Material costs 100% excluded from direct effort driver.');
  }

  // ---------------------------------------------------------------------------
  // Test 7: Penny Rounding Reconciliation (جبر كسور السنتات في البند الأكبر)
  // Single Source of Truth / Zero Discrepancy
  // ---------------------------------------------------------------------------
  {
    const pool: CostPoolInput = {
      poolId: 'pool-penny',
      poolCode: 'P1_PENNY_TEST',
      poolName: 'اختبار دقة السنتات',
      poolType: 'labor_care',
      driverType: 'labor_days',
      grossExpenseAmount: 10000, // 10000 / 3 = 3333.333333...
    };

    const items: BoqDriverMetricsInput[] = [
      { boqItemId: 'item-1', boqCode: 'BOQ-01', description: 'بند 1', laborDays: 1, laborCost: 100, equipmentHours: 0 },
      { boqItemId: 'item-2', boqCode: 'BOQ-02', description: 'بند 2', laborDays: 1, laborCost: 100, equipmentHours: 0 },
      { boqItemId: 'item-3', boqCode: 'BOQ-03', description: 'بند 3', laborDays: 1, laborCost: 100, equipmentHours: 0 },
    ];

    const result = computePoolAllocation(pool, items);

    // Sum of allocated amounts must equal 10000.000 EXACTLY
    const sum = result.allocations.reduce((acc, a) => acc + a.allocatedAmount, 0);
    const roundedSum = Math.round(sum * 1000) / 1000;

    assert.strictEqual(roundedSum, 10000);
    assert.strictEqual(result.allocatedAmountTotal, 10000);
    assert.strictEqual(result.deferredOutAmount, 0);
    console.log('✓ Test 7 Passed: [Penny Rounding Reconciliation] Sum equals net cost exactly with 0.000 discrepancy.');
  }

  // ---------------------------------------------------------------------------
  // Test 8: Multi-Pool Batch Aggregation & Global Invariant
  // Simultaneous computation of all 4 pools & validation of batch totals
  // ---------------------------------------------------------------------------
  {
    const pools: CostPoolInput[] = [
      {
        poolId: 'p1',
        poolCode: 'P1_LABOR_CARE',
        poolName: 'سكن العمال والإعاشة',
        poolType: 'labor_care',
        driverType: 'labor_days',
        grossExpenseAmount: 30000,
        recoveredBackchargeAmount: 5000, // Net 25000
      },
      {
        poolId: 'p2',
        poolCode: 'P2_LABOR_BURDEN',
        poolName: 'أعباء وتأمينات العمالة',
        poolType: 'labor_burden',
        driverType: 'labor_cost',
        grossExpenseAmount: 12000, // Net 12000
      },
      {
        poolId: 'p3',
        poolCode: 'P3_EQUIP_SHARED',
        poolName: 'المعدات العامة والديزل',
        poolType: 'equipment_shared',
        driverType: 'equipment_hours',
        grossExpenseAmount: 18000, // Net 18000
      },
      {
        poolId: 'p4',
        poolCode: 'P4_SITE_SUPERVISION',
        poolName: 'إشراف الموقع',
        poolType: 'site_supervision',
        driverType: 'direct_effort',
        grossExpenseAmount: 20000, // Net 20000
      },
    ];

    const items: BoqDriverMetricsInput[] = [
      {
        boqItemId: 'item-A',
        boqCode: 'BOQ-A',
        description: 'أعمال ترابية وأساسات',
        laborDays: 40,
        laborCost: 20000,
        equipmentHours: 80,
        directEquipmentCost: 16000,
        directMaterialCost: 100000,
      },
      {
        boqItemId: 'item-B',
        boqCode: 'BOQ-B',
        description: 'أعمال تشطيبات',
        laborDays: 60,
        laborCost: 40000,
        equipmentHours: 20,
        directEquipmentCost: 4000,
        directMaterialCost: 50000,
      },
    ];

    const batchSummary = computeBatchAllocation(pools, items);

    // Verify batch totals
    // Gross: 30000 + 12000 + 18000 + 20000 = 80000
    assert.strictEqual(batchSummary.totalGrossExpense, 80000);
    assert.strictEqual(batchSummary.totalRecoveredBackcharge, 5000);
    // Net: 25000 + 12000 + 18000 + 20000 = 75000
    assert.strictEqual(batchSummary.totalNetCost, 75000);
    assert.strictEqual(batchSummary.totalAllocated, 75000);
    assert.strictEqual(batchSummary.totalDeferredOut, 0);

    // Verify invariant assertion doesn't throw
    assert.doesNotThrow(() => reconcileAllocationInvariants(batchSummary));

    // Check item aggregated summaries
    const summaryA = batchSummary.boqItemSummaries.find((s) => s.boqItemId === 'item-A')!;
    const summaryB = batchSummary.boqItemSummaries.find((s) => s.boqItemId === 'item-B')!;

    assert(summaryA.totalAllocatedIndirectCost > 0);
    assert(summaryB.totalAllocatedIndirectCost > 0);
    assert.strictEqual(
      Math.round((summaryA.totalAllocatedIndirectCost + summaryB.totalAllocatedIndirectCost) * 1000) / 1000,
      75000,
    );

    console.log(
      `✓ Test 8 Passed: Multi-pool batch aggregation (Item A = ${summaryA.totalAllocatedIndirectCost}, Item B = ${summaryB.totalAllocatedIndirectCost}, Total = 75000).`,
    );
  }

  console.log('\n=============================================================================');
  console.log('  جميع اختبارات محرك توزيع المصاريف غير المباشرة (Track 1) اجتازت بنجاح 100%');
  console.log('=============================================================================\n');
}

// Execute test suite
runIndirectAllocationTestSuite();
