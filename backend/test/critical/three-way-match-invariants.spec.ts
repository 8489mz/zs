import { computeThreeWayMatch, ThreeWayMatchInput } from '../../src/modules/purchases/three-way-match.engine';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log('=== بدء اختبارات محرك المطابقة الثلاثية وإذن الاستلام GRNI (Phase 0) ===\n');

// -----------------------------------------------------------------------------
// Test 1: [MATCH-1 - Perfect 3-Way Match]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [{ id: 1, productId: 101, qty: 100, unitCost: 10.0 }],
    grnLines: [
      {
        id: 1,
        grnId: 1,
        poItemId: 1,
        productId: 101,
        receivedQty: 100,
        acceptedQty: 100,
        rejectedQty: 0,
        unitCost: 10.0,
      },
    ],
    invoiceItems: [{ poItemId: 1, productId: 101, qty: 100, unitCost: 10.0 }],
    tolerancePercentage: 2,
    vatRate: 0.14,
    minorUnits: 2,
  };

  const result = computeThreeWayMatch(input);
  assert(result.overallStatus === 'matched', `Test 1 Failed: Expected status 'matched', got '${result.overallStatus}'`);
  assert(result.isValidForPosting === true, 'Test 1 Failed: Expected valid for posting');
  assert(result.totalPpv === 0, `Test 1 Failed: Expected PPV 0, got ${result.totalPpv}`);
  assert(
    result.totalGrniClearing === 1000,
    `Test 1 Failed: Expected GRNI clearing 1000, got ${result.totalGrniClearing}`,
  );
  assert(
    result.totalInvoicedAmount === 1000,
    `Test 1 Failed: Expected invoiced amount 1000, got ${result.totalInvoicedAmount}`,
  );
  assert(result.reconciliationDiscrepancy === 0, `Test 1 Failed: Discrepancy ${result.reconciliationDiscrepancy}`);
  console.log('✓ Test 1 Passed: [MATCH-1] Perfect 3-way match approved with 0 discrepancy.');
}

// -----------------------------------------------------------------------------
// Test 2: [MATCH-1 - Direct Over-Billing Blocked]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [{ id: 1, productId: 101, qty: 100, unitCost: 10.0 }],
    grnLines: [
      {
        id: 1,
        grnId: 1,
        poItemId: 1,
        productId: 101,
        receivedQty: 100,
        acceptedQty: 100,
        rejectedQty: 0,
        unitCost: 10.0,
      },
    ],
    invoiceItems: [{ poItemId: 1, productId: 101, qty: 120, unitCost: 10.0 }],
    minorUnits: 2,
    vatRate: 0.14,
  };

  const result = computeThreeWayMatch(input);
  assert(
    result.overallStatus === 'quantity_mismatch',
    `Test 2 Failed: Expected 'quantity_mismatch', got '${result.overallStatus}'`,
  );
  assert(result.isValidForPosting === false, 'Test 2 Failed: Should not be valid for posting');
  assert(result.blockingReasons.length > 0, 'Test 2 Failed: Should have blocking reasons');
  console.log('✓ Test 2 Passed: [MATCH-1] Over-billing beyond GRN quantity blocked.');
}

// -----------------------------------------------------------------------------
// Test 3: [MATCH-1 - Cumulative Staged Invoicing Violation]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [{ id: 1, productId: 101, qty: 100, unitCost: 10.0 }],
    grnLines: [
      {
        id: 1,
        grnId: 1,
        poItemId: 1,
        productId: 101,
        receivedQty: 100,
        acceptedQty: 100,
        rejectedQty: 0,
        unitCost: 10.0,
      },
    ],
    historicalInvoicedLines: [{ poItemId: 1, productId: 101, qty: 60 }],
    invoiceItems: [{ poItemId: 1, productId: 101, qty: 50, unitCost: 10.0 }], // 60 + 50 = 110 > 100
    minorUnits: 2,
    vatRate: 0.14,
  };

  const result = computeThreeWayMatch(input);
  assert(
    result.overallStatus === 'quantity_mismatch',
    `Test 3 Failed: Expected 'quantity_mismatch', got '${result.overallStatus}'`,
  );
  assert(result.isValidForPosting === false, 'Test 3 Failed: Cumulative over-billing must be blocked');
  console.log('✓ Test 3 Passed: [MATCH-1] Cumulative staged invoicing overflow (60 + 50 > 100) caught and blocked.');
}

// -----------------------------------------------------------------------------
// Test 4: [Quarantine & Partial Rejection - Salable Stock Protection]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [{ id: 1, productId: 101, qty: 100, unitCost: 10.0 }],
    grnLines: [
      {
        id: 1,
        grnId: 1,
        poItemId: 1,
        productId: 101,
        receivedQty: 100,
        acceptedQty: 80,
        rejectedQty: 20,
        unitCost: 10.0,
      },
    ],
    invoiceItems: [{ poItemId: 1, productId: 101, qty: 90, unitCost: 10.0 }], // Invoiced 90 vs Accepted 80
    minorUnits: 2,
    vatRate: 0.14,
  };

  const result = computeThreeWayMatch(input);
  assert(
    result.overallStatus === 'quantity_mismatch',
    'Test 4 Failed: Invoicing against rejected quarantine stock must fail',
  );
  assert(
    result.lines[0].acceptedGrnQty === 80,
    `Test 4 Failed: Expected accepted qty 80, got ${result.lines[0].acceptedGrnQty}`,
  );
  console.log('✓ Test 4 Passed: [Quarantine Protection] Rejected items excluded from matchable accepted quantity.');
}

// -----------------------------------------------------------------------------
// Test 5: [MATCH-2 - Price Variance Within Tolerance Allowed to PPV]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [{ id: 1, productId: 101, qty: 100, unitCost: 10.0 }],
    grnLines: [
      {
        id: 1,
        grnId: 1,
        poItemId: 1,
        productId: 101,
        receivedQty: 100,
        acceptedQty: 100,
        rejectedQty: 0,
        unitCost: 10.0,
      },
    ],
    invoiceItems: [{ poItemId: 1, productId: 101, qty: 100, unitCost: 10.15 }], // 1.5% delta <= 2% tolerance
    tolerancePercentage: 2,
    minorUnits: 2,
    vatRate: 0.14,
  };

  const result = computeThreeWayMatch(input);
  assert(result.overallStatus === 'matched', `Test 5 Failed: Expected 'matched', got '${result.overallStatus}'`);
  assert(result.isValidForPosting === true, 'Test 5 Failed: Should be valid for posting');
  assert(result.totalPpv === 15.0, `Test 5 Failed: Expected PPV 15.00, got ${result.totalPpv}`);
  assert(result.totalGrniClearing === 1000.0, `Test 5 Failed: Expected GRNI 1000, got ${result.totalGrniClearing}`);
  assert(
    result.totalInvoicedAmount === 1015.0,
    `Test 5 Failed: Expected invoiced 1015, got ${result.totalInvoicedAmount}`,
  );
  assert(result.reconciliationDiscrepancy === 0, `Test 5 Failed: Discrepancy ${result.reconciliationDiscrepancy}`);
  console.log('✓ Test 5 Passed: [MATCH-2] Price variance within 2% tolerance absorbed into PPV without blocking.');
}

// -----------------------------------------------------------------------------
// Test 6: [MATCH-2 - Price Variance Exceeding Tolerance Blocked]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [{ id: 1, productId: 101, qty: 100, unitCost: 10.0 }],
    grnLines: [
      {
        id: 1,
        grnId: 1,
        poItemId: 1,
        productId: 101,
        receivedQty: 100,
        acceptedQty: 100,
        rejectedQty: 0,
        unitCost: 10.0,
      },
    ],
    invoiceItems: [{ poItemId: 1, productId: 101, qty: 100, unitCost: 10.5 }], // 5% delta > 2% tolerance
    tolerancePercentage: 2,
    minorUnits: 2,
    vatRate: 0.14,
  };

  const result = computeThreeWayMatch(input);
  assert(
    result.overallStatus === 'tolerance_exceeded',
    `Test 6 Failed: Expected 'tolerance_exceeded', got '${result.overallStatus}'`,
  );
  assert(result.isValidForPosting === false, 'Test 6 Failed: Tolerance exceed must block posting');
  console.log('✓ Test 6 Passed: [MATCH-2] Price variance exceeding tolerance (5% > 2%) blocked.');
}

// -----------------------------------------------------------------------------
// Test 7: [MATCH-3 - Service Item With Completion Certificate]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [{ id: 1, productId: 999, qty: 1, unitCost: 5000.0, isService: true }],
    grnLines: [], // No physical GRN
    invoiceItems: [{ poItemId: 1, productId: 999, qty: 1, unitCost: 5000.0 }],
    isServiceItem: true,
    serviceCompletionRef: 'CERT-260919-001',
    minorUnits: 2,
    vatRate: 0.14,
  };

  const result = computeThreeWayMatch(input);
  assert(
    result.overallStatus === 'service_approved',
    `Test 7 Failed: Expected 'service_approved', got '${result.overallStatus}'`,
  );
  assert(result.isValidForPosting === true, 'Test 7 Failed: Service with certificate must be valid');
  console.log('✓ Test 7 Passed: [MATCH-3] Service item with signed completion certificate approved without GRN.');
}

// -----------------------------------------------------------------------------
// Test 8: [MATCH-3 - Service Item Without Certificate Blocked]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [{ id: 1, productId: 999, qty: 1, unitCost: 5000.0, isService: true }],
    grnLines: [],
    invoiceItems: [{ poItemId: 1, productId: 999, qty: 1, unitCost: 5000.0 }],
    isServiceItem: true,
    serviceCompletionRef: '', // Missing certificate!
    minorUnits: 2,
    vatRate: 0.14,
  };

  const result = computeThreeWayMatch(input);
  assert(
    result.overallStatus === 'service_rejected',
    `Test 8 Failed: Expected 'service_rejected', got '${result.overallStatus}'`,
  );
  assert(result.isValidForPosting === false, 'Test 8 Failed: Service without certificate must be blocked');
  console.log('✓ Test 8 Passed: [MATCH-3] Service item without completion certificate blocked.');
}

// -----------------------------------------------------------------------------
// Test 9: [GRNI Double-Entry Reconciliation & Multi-Item Balancing]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [
      { id: 1, productId: 101, qty: 50, unitCost: 10.0 },
      { id: 2, productId: 102, qty: 30, unitCost: 25.0 },
    ],
    grnLines: [
      {
        id: 1,
        grnId: 1,
        poItemId: 1,
        productId: 101,
        receivedQty: 50,
        acceptedQty: 50,
        rejectedQty: 0,
        unitCost: 10.0,
      },
      {
        id: 2,
        grnId: 1,
        poItemId: 2,
        productId: 102,
        receivedQty: 30,
        acceptedQty: 30,
        rejectedQty: 0,
        unitCost: 25.0,
      },
    ],
    invoiceItems: [
      { poItemId: 1, productId: 101, qty: 50, unitCost: 10.1 }, // PPV: +$5.00
      { poItemId: 2, productId: 102, qty: 30, unitCost: 24.8 }, // PPV: -$6.00 (Favorable)
    ],
    tolerancePercentage: 2,
    vatRate: 0.14,
    minorUnits: 2,
  };

  const result = computeThreeWayMatch(input);
  assert(result.overallStatus === 'matched', `Test 9 Failed: Expected 'matched', got '${result.overallStatus}'`);
  assert(result.totalGrniClearing === 1250.0, `Test 9 Failed: Expected GRNI 1250, got ${result.totalGrniClearing}`); // 50*10 + 30*25 = 500 + 750 = 1250
  assert(result.totalPpv === -1.0, `Test 9 Failed: Expected PPV -1.0, got ${result.totalPpv}`); // +5 - 6 = -1
  assert(
    result.totalInvoicedAmount === 1249.0,
    `Test 9 Failed: Expected Invoiced 1249, got ${result.totalInvoicedAmount}`,
  ); // 1250 - 1 = 1249
  assert(result.reconciliationDiscrepancy === 0, `Test 9 Failed: Discrepancy ${result.reconciliationDiscrepancy}`);
  console.log(
    '✓ Test 9 Passed: [GRNI Balancing] Multi-item GRNI clearing + favorable/unfavorable PPV reconciles exactly to 0.000.',
  );
}

// -----------------------------------------------------------------------------
// Test 10: [Manager Override Audit Trail]
// -----------------------------------------------------------------------------
{
  const input: ThreeWayMatchInput = {
    poItems: [{ id: 1, productId: 101, qty: 100, unitCost: 10.0 }],
    grnLines: [
      {
        id: 1,
        grnId: 1,
        poItemId: 1,
        productId: 101,
        receivedQty: 100,
        acceptedQty: 100,
        rejectedQty: 0,
        unitCost: 10.0,
      },
    ],
    invoiceItems: [{ poItemId: 1, productId: 101, qty: 100, unitCost: 10.5 }], // 5% delta > 2% tolerance
    tolerancePercentage: 2,
    allowOverride: true,
    overrideReason: 'Approved by CFO per contract amendment #4',
    minorUnits: 2,
    vatRate: 0.14,
  };

  const result = computeThreeWayMatch(input);
  assert(
    result.overallStatus === 'override_approved',
    `Test 10 Failed: Expected 'override_approved', got '${result.overallStatus}'`,
  );
  assert(result.isValidForPosting === true, 'Test 10 Failed: Override should allow posting');
  console.log('✓ Test 10 Passed: [Manager Override] Explicitly reasoned override recorded and approved.');
}

console.log('\n=============================================================================');
console.log('  كافة اختبارات محرك المطابقة الثلاثية وإذن الاستلام GRN (Phase 0) اجتازت 100%');
console.log('=============================================================================\n');
