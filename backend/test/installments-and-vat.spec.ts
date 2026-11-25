import { strict as assert } from 'node:assert';

// 1. Installments schedule simulation
function generateInstallmentPlan(params: {
  totalAmount: number;
  downPayment: number;
  interestRatePercent: number;
  installmentCount: number;
  startDate: Date;
}) {
  const totalAmount = Number((Number(params.totalAmount) || 0).toFixed(2));
  const downPayment = Number((Number(params.downPayment) || 0).toFixed(2));
  const financedAmount = Number((totalAmount - downPayment).toFixed(2));
  assert(financedAmount > 0, 'Financed amount must be positive');

  const interestRate = Number(params.interestRatePercent || 0);
  const interestAmount = Number(((financedAmount * interestRate) / 100).toFixed(2));
  const totalWithInterest = Number((financedAmount + interestAmount).toFixed(2));
  const count = Math.max(1, Math.floor(params.installmentCount || 1));
  const monthlyAmount = Number((totalWithInterest / count).toFixed(2));

  const installments = [];
  let accumulated = 0;

  for (let i = 1; i <= count; i++) {
    const dueDate = new Date(params.startDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    let currentAmount = monthlyAmount;
    if (i === count) {
      currentAmount = Number((totalWithInterest - accumulated).toFixed(2));
    } else {
      accumulated = Number((accumulated + currentAmount).toFixed(2));
    }

    installments.push({
      installmentNumber: i,
      dueDate,
      amount: currentAmount,
      paidAmount: 0,
      status: 'pending',
    });
  }

  return {
    totalAmount,
    downPayment,
    financedAmount,
    interestAmount,
    totalWithInterest,
    installmentCount: count,
    monthlyAmount,
    installments,
  };
}

// 2. VAT Declaration calculation simulation
function calculateVatDeclaration(data: {
  salesStandardBase: number;
  salesStandardTax: number;
  salesZeroBase: number;
  salesReturnsTotal: number;
  purchasesStandardBase: number;
  purchasesStandardTax: number;
  purchasesReturnsTotal: number;
  standardRate: number;
}) {
  const { standardRate } = data;

  const salesReturnsBase = Number(((data.salesReturnsTotal * 100) / (100 + standardRate)).toFixed(2));
  const salesReturnsTax = Number((data.salesReturnsTotal - salesReturnsBase).toFixed(2));

  const purchaseReturnsBase = Number(((data.purchasesReturnsTotal * 100) / (100 + standardRate)).toFixed(2));
  const purchaseReturnsTax = Number((data.purchasesReturnsTotal - purchaseReturnsBase).toFixed(2));

  const totalOutputVat = Number((data.salesStandardTax - salesReturnsTax).toFixed(2));
  const totalInputVat = Number((data.purchasesStandardTax - purchaseReturnsTax).toFixed(2));
  const netVatDue = Number((totalOutputVat - totalInputVat).toFixed(2));

  return {
    totalOutputVat: Math.max(0, totalOutputVat),
    totalInputVat: Math.max(0, totalInputVat),
    netVatDue,
    status: netVatDue >= 0 ? 'payable' : 'refundable',
    salesReturnsTax,
    purchaseReturnsTax,
  };
}

async function runTests() {
  console.log('--- Starting Installments & VAT Declaration Engine Tests ---');

  // Test 1: Installment plan with down payment and interest
  console.log('Test 1: Installment plan schedule & rounding verification...');
  const plan1 = generateInstallmentPlan({
    totalAmount: 10000,
    downPayment: 2000,
    interestRatePercent: 10, // 10% on 8000 = 800 -> 8800 total
    installmentCount: 6,
    startDate: new Date('2026-09-01'),
  });

  assert.equal(plan1.financedAmount, 8000, 'Financed amount should be 8000');
  assert.equal(plan1.interestAmount, 800, 'Interest amount should be 800');
  assert.equal(plan1.totalWithInterest, 8800, 'Total with interest should be 8800');
  assert.equal(plan1.installments.length, 6, 'Should have 6 installments');

  // Verify sum of installments equals exactly totalWithInterest (accounting precision)
  const sumInstallments = Number(plan1.installments.reduce((acc, cur) => acc + cur.amount, 0).toFixed(2));
  assert.equal(sumInstallments, 8800, `Sum of installments (${sumInstallments}) must match totalWithInterest (8800)`);
  console.log('✓ Test 1 passed: Installment schedule & penny rounding are exact.');

  // Test 2: VAT declaration (Egypt 14%)
  console.log('Test 2: Egypt ETA Form 10 VAT declaration math...');
  const vatEg = calculateVatDeclaration({
    salesStandardBase: 100000,
    salesStandardTax: 14000,
    salesZeroBase: 20000,
    salesReturnsTotal: 11400, // 10000 base + 1400 tax
    purchasesStandardBase: 50000,
    purchasesStandardTax: 7000,
    purchasesReturnsTotal: 5700, // 5000 base + 700 tax
    standardRate: 14,
  });

  assert.equal(vatEg.salesReturnsTax, 1400, 'Sales returns tax should be 1400');
  assert.equal(vatEg.totalOutputVat, 12600, 'Net output VAT should be 14000 - 1400 = 12600');
  assert.equal(vatEg.purchaseReturnsTax, 700, 'Purchase returns tax should be 700');
  assert.equal(vatEg.totalInputVat, 6300, 'Net input VAT should be 7000 - 700 = 6300');
  assert.equal(vatEg.netVatDue, 6300, 'Net VAT due should be 12600 - 6300 = 6300');
  assert.equal(vatEg.status, 'payable', 'Status should be payable');
  console.log('✓ Test 2 passed: Egypt VAT return math matches Form 10 specifications.');

  // Test 3: VAT declaration (Saudi ZATCA 15% with refundable credit)
  console.log('Test 3: Saudi ZATCA 15% VAT declaration with refundable credit...');
  const vatSa = calculateVatDeclaration({
    salesStandardBase: 20000,
    salesStandardTax: 3000,
    salesZeroBase: 0,
    salesReturnsTotal: 0,
    purchasesStandardBase: 40000,
    purchasesStandardTax: 6000,
    purchasesReturnsTotal: 0,
    standardRate: 15,
  });

  assert.equal(vatSa.totalOutputVat, 3000, 'Output VAT should be 3000');
  assert.equal(vatSa.totalInputVat, 6000, 'Input VAT should be 6000');
  assert.equal(vatSa.netVatDue, -3000, 'Net VAT due should be -3000 (credit)');
  assert.equal(vatSa.status, 'refundable', 'Status should be refundable');
  console.log('✓ Test 3 passed: Saudi ZATCA refund math verified.');

  console.log('--- All Installments & VAT Declaration Tests Passed 100% ---');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
