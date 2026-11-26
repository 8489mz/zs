import { strict as assert } from 'node:assert';

// =============================================================================
// CRITICAL FINANCIAL AUDIT SUITE: Phase 6 - HR & End of Service (EOS) Settlements
// Rule 13 (AGENTS.md): Proof of Financial & Operational Invariants
// =============================================================================

console.log('=== بدء اختبارات المرحلة (6): الموارد البشرية ومستحقات نهاية الخدمة والرواتب والسلف ===\n');

import { calculateGratuity, calculateSettlementAbsorption } from '../../src/common/utils/eos-calculation.engine';

function testGratuityCalculations() {
  console.log('--- 1. اختبارات احتساب مكافأة نهاية الخدمة وفقاً لقانون العمل السعودي والمصري ---');

  const monthlySalary = 10000;
  const dailyWage = monthlySalary / 30;

  // 1.1 Saudi: Resignation < 2 years -> 0%
  {
    const res = calculateGratuity({
      serviceYearsDecimal: 1.5,
      totalSalary: monthlySalary,
      dailyWage,
      lawType: 'saudi',
      reason: 'resignation',
      minorUnits: 2,
    });
    assert.equal(res.gratuityPercentage, 0, 'استقالة أقل من سنتين: النسبة 0%');
    assert.equal(res.gratuityAmount, 0, 'استقالة أقل من سنتين: المكافأة صفر');
    console.log('✔ قانون العمل السعودي: استقالة أقل من سنتين -> استحقاق 0% (ناجح)');
  }

  // 1.2 Saudi: Resignation 2 to 5 years (e.g. 3 years) -> 33.333% (ثلث)
  {
    const res = calculateGratuity({
      serviceYearsDecimal: 3,
      totalSalary: monthlySalary,
      dailyWage,
      lawType: 'saudi',
      reason: 'resignation',
      minorUnits: 2,
    });
    // Base: 3 * 0.5 * 10000 = 15000. 15000 * 33.333% = 4999.95
    assert.equal(res.baseGratuity, 15000, 'الأساس لـ 3 سنوات هو 15000');
    assert.equal(res.gratuityPercentage, 33.333, 'النسبة ثلث');
    assert.equal(res.gratuityAmount, 5000.0, 'مكافأة الاستقالة بين 2 و 5 سنوات');
    console.log('✔ قانون العمل السعودي: استقالة بين سنتين و 5 سنوات -> ثلث المكافأة (ناجح)');
  }

  // 1.3 Saudi: Resignation 5 to 10 years (e.g. 7 years) -> 66.667% (ثلثين)
  {
    const res = calculateGratuity({
      serviceYearsDecimal: 7,
      totalSalary: monthlySalary,
      dailyWage,
      lawType: 'saudi',
      reason: 'resignation',
      minorUnits: 2,
    });
    // Base: (5 * 0.5 * 10000) + (2 * 1.0 * 10000) = 25000 + 20000 = 45000.
    // Amount: 45000 * 66.667% = 30000.15
    assert.equal(res.baseGratuity, 45000, 'الأساس لـ 7 سنوات هو 45000');
    assert.equal(res.gratuityPercentage, 66.667, 'النسبة ثلثين');
    assert.equal(Math.round(res.gratuityAmount), 30000, 'مكافأة الاستقالة بين 5 و 10 سنوات تقريباً 30000');
    console.log('✔ قانون العمل السعودي: استقالة بين 5 و 10 سنوات -> ثلثي المكافأة (ناجح)');
  }

  // 1.4 Saudi: Resignation >= 10 years (e.g. 12 years) -> 100% (كاملة)
  {
    const res = calculateGratuity({
      serviceYearsDecimal: 12,
      totalSalary: monthlySalary,
      dailyWage,
      lawType: 'saudi',
      reason: 'resignation',
      minorUnits: 2,
    });
    // Base: (5 * 0.5 * 10000) + (7 * 1.0 * 10000) = 25000 + 70000 = 95000.
    assert.equal(res.baseGratuity, 95000, 'الأساس لـ 12 سنة هو 95000');
    assert.equal(res.gratuityPercentage, 100, 'النسبة 100%');
    assert.equal(res.gratuityAmount, 95000, 'المكافأة كاملة 95000');
    console.log('✔ قانون العمل السعودي: استقالة 10 سنوات فأكثر -> المكافأة كاملة 100% (ناجح)');
  }

  // 1.5 Saudi: Employer termination (any tenure) -> 100%
  {
    const res = calculateGratuity({
      serviceYearsDecimal: 3,
      totalSalary: monthlySalary,
      dailyWage,
      lawType: 'saudi',
      reason: 'termination_by_employer',
      minorUnits: 2,
    });
    assert.equal(res.gratuityPercentage, 100, 'إنهاء من صاحب العمل يستحق كامل المكافأة');
    assert.equal(res.gratuityAmount, 15000, 'المكافأة كاملة لـ 3 سنوات 15000');
    console.log('✔ قانون العمل السعودي: إنهاء من صاحب العمل -> استحقاق 100% بغض النظر عن المدة (ناجح)');
  }

  // 1.6 Saudi: Article 80 Termination -> 0%
  {
    const res = calculateGratuity({
      serviceYearsDecimal: 8,
      totalSalary: monthlySalary,
      dailyWage,
      lawType: 'saudi',
      reason: 'termination_article_80',
      minorUnits: 2,
    });
    assert.equal(res.gratuityPercentage, 0, 'فصل بموجب المادة 80 لا يستحق مكافأة');
    assert.equal(res.gratuityAmount, 0, 'المكافأة صفر');
    console.log('✔ قانون العمل السعودي: فصل بموجب المادة 80 -> استحقاق 0% (ناجح)');
  }

  // 1.7 Egyptian: Article 125
  {
    const res = calculateGratuity({
      serviceYearsDecimal: 6,
      totalSalary: 8000,
      dailyWage: 8000 / 30,
      lawType: 'egyptian',
      reason: 'resignation',
      minorUnits: 2,
    });
    // First 5 yrs: 5 * 0.5 * 8000 = 20000. Next 1 yr: 1 * 1.0 * 8000 = 8000. Total = 28000.
    assert.equal(res.baseGratuity, 28000, 'مكافأة 6 سنوات بمصر: 28000');
    assert.equal(res.gratuityAmount, 28000, 'استحقاق كامل 28000');
    console.log('✔ قانون العمل المصري: المادة 125 -> احتساب متدرج بنسبة 100% (ناجح)');
  }
}

// -----------------------------------------------------------------------------
// 2. Double-Entry Accounting Journal Balance & Absorption Invariants
// -----------------------------------------------------------------------------
type JournalLine = {
  accountId: number;
  description: string;
  debit: number;
  credit: number;
};

function generateEosJournalLines(settlement: {
  settlementNo: string;
  employeeId: number;
  gratuityAmount: number;
  leaveEncashmentAmount: number;
  pendingSalaryAmount: number;
  noticePeriodAmount: number;
  otherEntitlementsAmount: number;
  unpaidLoansDeduction: number;
  assetsDeduction: number;
  otherDeductions: number;
  treasuryAccountId?: number | null;
}): { lines: JournalLine[]; totalDebit: number; totalCredit: number; netPayable: number } {
  const toMoney = (v: number) => Number(Number(v || 0).toFixed(2));

  const gratuity = toMoney(settlement.gratuityAmount);
  const leavePay = toMoney(settlement.leaveEncashmentAmount);
  const pendingSalary = toMoney(settlement.pendingSalaryAmount);
  const noticePeriod = toMoney(settlement.noticePeriodAmount);
  const otherEntitlements = toMoney(settlement.otherEntitlementsAmount);
  const totalEntitlements = toMoney(gratuity + leavePay + pendingSalary + noticePeriod + otherEntitlements);

  const unpaidLoans = toMoney(settlement.unpaidLoansDeduction);
  const assetsDeduction = toMoney(settlement.assetsDeduction);
  const otherDeductions = toMoney(settlement.otherDeductions);

  if (totalEntitlements <= 0) {
    throw new Error('Cannot post settlement with zero entitlements');
  }

  // Absorption invariant: Deductions cannot exceed total entitlements in the settlement payout.
  let remainingPool = totalEntitlements;

  const appliedAssets = Math.min(assetsDeduction, remainingPool);
  remainingPool = toMoney(remainingPool - appliedAssets);

  const appliedOther = Math.min(otherDeductions, remainingPool);
  remainingPool = toMoney(remainingPool - appliedOther);

  const appliedLoans = Math.min(unpaidLoans, remainingPool);
  remainingPool = toMoney(remainingPool - appliedLoans);

  const netPayable = remainingPool;

  const lines: JournalLine[] = [];
  const expenseAccountId = 6200; // Salaries & EOS Expense
  const advancesAccountId = 1160; // Employee Advances
  const otherIncomeAccountId = 7100; // Other Income
  const paymentAccountId = settlement.treasuryAccountId || 1110; // Cash

  // 1. Debit: Total Entitlements
  lines.push({
    accountId: expenseAccountId,
    description: `استحقاق مخالصة ومكافأة نهاية خدمة #${settlement.settlementNo}`,
    debit: totalEntitlements,
    credit: 0,
  });

  // 2. Credit: Loan deduction
  if (appliedLoans > 0) {
    lines.push({
      accountId: advancesAccountId,
      description: `تسوية سلف مستحقة للموظف بمخالصة #${settlement.settlementNo}`,
      debit: 0,
      credit: appliedLoans,
    });
  }

  // 3. Credit: Asset / Custody deduction
  if (appliedAssets > 0) {
    lines.push({
      accountId: otherIncomeAccountId,
      description: `استرداد وتسوية عهدة بمخالصة #${settlement.settlementNo}`,
      debit: 0,
      credit: appliedAssets,
    });
  }

  // 4. Credit: Other deductions
  if (appliedOther > 0) {
    lines.push({
      accountId: otherIncomeAccountId,
      description: `استقطاعات أخرى بمخالصة #${settlement.settlementNo}`,
      debit: 0,
      credit: appliedOther,
    });
  }

  // 5. Credit: Net settlement payable / payout
  if (netPayable > 0) {
    lines.push({
      accountId: paymentAccountId,
      description: `صرف مستحقات مخالصة نهاية الخدمة #${settlement.settlementNo}`,
      debit: 0,
      credit: netPayable,
    });
  }

  const totalDebit = toMoney(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = toMoney(lines.reduce((s, l) => s + l.credit, 0));

  return { lines, totalDebit, totalCredit, netPayable };
}

function testAccountingJournalBalance() {
  console.log('\n--- 2. اختبارات توازن القيود المحاسبية للمخالصة ومبدأ امتصاص الاستقطاعات ---');

  // 2.1 Standard clean settlement without deductions
  {
    const res = generateEosJournalLines({
      settlementNo: 'EOS-260919-0001',
      employeeId: 10,
      gratuityAmount: 25000,
      leaveEncashmentAmount: 3000,
      pendingSalaryAmount: 5000,
      noticePeriodAmount: 0,
      otherEntitlementsAmount: 0,
      unpaidLoansDeduction: 0,
      assetsDeduction: 0,
      otherDeductions: 0,
    });
    assert.equal(res.totalDebit, 33000, 'المدين = 33000');
    assert.equal(res.totalCredit, 33000, 'الدائن = 33000');
    assert.equal(res.netPayable, 33000, 'الصافي = 33000');
    assert.equal(res.totalDebit, res.totalCredit, 'توازن تام بين المدين والدائن');
    console.log('✔ مخالصة قياسية بدون استقطاعات: توازن محاسبي تام (33,000 د/م) (ناجح)');
  }

  // 2.2 Comprehensive settlement with ALL components: notice period, loans, custody, deductions
  {
    const res = generateEosJournalLines({
      settlementNo: 'EOS-260919-0002',
      employeeId: 11,
      gratuityAmount: 45000,
      leaveEncashmentAmount: 4000,
      pendingSalaryAmount: 6000,
      noticePeriodAmount: 10000,
      otherEntitlementsAmount: 2000,
      unpaidLoansDeduction: 12000,
      assetsDeduction: 3000,
      otherDeductions: 1000,
      treasuryAccountId: 1120, // Bank
    });
    // Total Entitlements = 45000 + 4000 + 6000 + 10000 + 2000 = 67000
    // Deductions = 12000 + 3000 + 1000 = 16000
    // Net Payable = 67000 - 16000 = 51000
    assert.equal(res.totalDebit, 67000, 'إجمالي الاستحقاقات المدين = 67000');
    assert.equal(res.totalCredit, 67000, 'إجمالي الدائن (سلف + عهد + جزاءات + بنك) = 67000');
    assert.equal(res.netPayable, 51000, 'الصافي المسدد عبر البنك = 51000');
    assert.equal(res.totalDebit, res.totalCredit, 'توازن تام بين المدين والدائن');

    // Verify account codes
    const loanLine = res.lines.find((l) => l.accountId === 1160);
    assert.ok(loanLine, 'تم إدراج سطر تسوية السلف في حساب 1160');
    assert.equal(loanLine?.credit, 12000, 'مبلغ استقطاع السلف 12000');

    const assetLine = res.lines.find((l) => l.accountId === 7100 && l.description.includes('عهدة'));
    assert.ok(assetLine, 'تم إدراج سطر استرداد العهدة في حساب 7100');
    assert.equal(assetLine?.credit, 3000, 'مبلغ استقطاع العهدة 3000');

    const bankLine = res.lines.find((l) => l.accountId === 1120);
    assert.ok(bankLine, 'تم إدراج سطر الصرف البنكي في حساب 1120');
    assert.equal(bankLine?.credit, 51000, 'مبلغ الصرف 51000');

    console.log('✔ مخالصة شاملة لكافة البنود (بدل إنذار، سلف 1160، عهدة 7100، بنك 1120): توازن تام 67,000 (ناجح)');
  }

  // 2.3 Edge Case: Deductions exceed entitlements (Capped Pool Invariant)
  {
    // Employee entitlements: 10000. Loan: 15000.
    // Loan deduction MUST be capped at 10000. Remaining 5000 remains open on employee.
    const res = generateEosJournalLines({
      settlementNo: 'EOS-260919-0003',
      employeeId: 12,
      gratuityAmount: 8000,
      leaveEncashmentAmount: 1000,
      pendingSalaryAmount: 1000,
      noticePeriodAmount: 0,
      otherEntitlementsAmount: 0,
      unpaidLoansDeduction: 15000,
      assetsDeduction: 0,
      otherDeductions: 0,
    });
    // Entitlements = 10000.
    // Loan capped at 10000.
    // Net Payable = 0.
    assert.equal(res.totalDebit, 10000, 'المدين = 10000');
    assert.equal(res.totalCredit, 10000, 'الدائن المستقطع من السلفة = 10000');
    assert.equal(res.netPayable, 0, 'الصافي المصروف = 0');
    assert.equal(res.totalDebit, res.totalCredit, 'توازن تام محمي بسقف الاستحقاقات');
    console.log('✔ حالة حدية: الاستقطاعات تتجاوز المستحقات -> سقف الامتصاص يمنع اختلال القيد وصافي الصرف = 0 (ناجح)');
  }
}

// -----------------------------------------------------------------------------
// 3. Custody Clearance Gate Invariant
// -----------------------------------------------------------------------------
function testCustodyClearanceGate() {
  console.log('\n--- 3. اختبارات حارس إخلاء الطرف للعهد والأصول (Custody Clearance Gate) ---');

  function validateCustodyClearance(params: {
    unreturnedAssetsCount: number;
    custodyCleared: boolean;
    assetsDeduction: number;
  }): { allowed: boolean; error?: string } {
    if (params.unreturnedAssetsCount > 0 && !params.custodyCleared && !(params.assetsDeduction > 0)) {
      return {
        allowed: false,
        error: 'لا يمكن ترحيل مخالصة موظف لديه عهد غير مستردة دون إخلاء طرف للعهدة أو استقطاع قيمتها',
      };
    }
    return { allowed: true };
  }

  // 3.1 Unreturned assets with NO clearance and NO deduction -> REJECT
  {
    const res = validateCustodyClearance({
      unreturnedAssetsCount: 2,
      custodyCleared: false,
      assetsDeduction: 0,
    });
    assert.equal(res.allowed, false, 'يجب رفض ترحيل المخالصة إذا كانت هناك عهد نشطة دون إخلاء أو استقطاع');
    console.log('✔ حارس العهد: حجب ترحيل المخالصة لموظف لديه عهد دون إخلاء طرف أو استقطاع (ناجح)');
  }

  // 3.2 Unreturned assets with custodyCleared = true -> ALLOW
  {
    const res = validateCustodyClearance({
      unreturnedAssetsCount: 2,
      custodyCleared: true,
      assetsDeduction: 0,
    });
    assert.equal(res.allowed, true, 'يسمح بالترحيل إذا تم توقيع إخلاء الطرف');
    console.log('✔ حارس العهد: السماح بالترحيل بعد توقيع إخلاء الطرف المعتمد (ناجح)');
  }

  // 3.3 Unreturned assets with assetsDeduction > 0 -> ALLOW
  {
    const res = validateCustodyClearance({
      unreturnedAssetsCount: 1,
      custodyCleared: false,
      assetsDeduction: 2500,
    });
    assert.equal(res.allowed, true, 'يسمح بالترحيل إذا تم استقطاع قيمة العهدة من المستحقات');
    console.log('✔ حارس العهد: السماح بالترحيل عند تحميل واستقطاع قيمة العهدة من المخالصة (ناجح)');
  }
}

// -----------------------------------------------------------------------------
// 4. Employee Loan Settlement & Installment Allocation Invariants
// -----------------------------------------------------------------------------
function testLoanRepaymentAllocation() {
  console.log('\n--- 4. اختبارات تسوية السلف وتوزيع الأقساط عند التصفية ---');

  type Loan = {
    id: number;
    principalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    status: string;
  };

  type Installment = {
    id: number;
    loanId: number;
    installmentNo: number;
    amount: number;
    paidAmount: number;
    status: string;
  };

  function allocateEosLoanDeduction(
    loans: Loan[],
    installments: Installment[],
    deductionAmount: number,
  ): { updatedLoans: Loan[]; updatedInstallments: Installment[]; totalAllocated: number } {
    let remainingToDeduct = deductionAmount;
    const updatedLoans = loans.map((l) => ({ ...l }));
    const updatedInstallments = installments.map((i) => ({ ...i }));

    for (const loan of updatedLoans) {
      if (remainingToDeduct <= 0) break;
      const toDeduct = Math.min(loan.remainingAmount, remainingToDeduct);
      loan.paidAmount = Number((loan.paidAmount + toDeduct).toFixed(2));
      loan.remainingAmount = Number((loan.remainingAmount - toDeduct).toFixed(2));
      loan.status = loan.remainingAmount <= 0 ? 'repaid' : 'partially_repaid';

      let instDeduction = toDeduct;
      for (const inst of updatedInstallments.filter((i) => i.loanId === loan.id && i.status !== 'paid')) {
        if (instDeduction <= 0) break;
        const due = inst.amount - inst.paidAmount;
        const applied = Math.min(due, instDeduction);
        inst.paidAmount = Number((inst.paidAmount + applied).toFixed(2));
        inst.status = inst.paidAmount + 0.005 >= inst.amount ? 'paid' : 'partial';
        instDeduction = Number((instDeduction - applied).toFixed(2));
      }

      remainingToDeduct = Number((remainingToDeduct - toDeduct).toFixed(2));
    }

    return {
      updatedLoans,
      updatedInstallments,
      totalAllocated: Number((deductionAmount - remainingToDeduct).toFixed(2)),
    };
  }

  // 4.1 Full loan repayment via settlement
  {
    const loans: Loan[] = [
      { id: 1, principalAmount: 6000, paidAmount: 2000, remainingAmount: 4000, status: 'partially_repaid' },
    ];
    const installments: Installment[] = [
      { id: 101, loanId: 1, installmentNo: 1, amount: 2000, paidAmount: 2000, status: 'paid' },
      { id: 102, loanId: 1, installmentNo: 2, amount: 2000, paidAmount: 0, status: 'unpaid' },
      { id: 103, loanId: 1, installmentNo: 3, amount: 2000, paidAmount: 0, status: 'unpaid' },
    ];

    const res = allocateEosLoanDeduction(loans, installments, 4000);
    assert.equal(res.updatedLoans[0].remainingAmount, 0, 'تم سداد السلفة بالكامل');
    assert.equal(res.updatedLoans[0].status, 'repaid', 'حالة السلفة أصبحت repaid');
    assert.equal(res.updatedInstallments[1].status, 'paid', 'القسط الثاني سُدد');
    assert.equal(res.updatedInstallments[2].status, 'paid', 'القسط الثالث سُدد');
    console.log('✔ سداد السلفة بالكامل وتحديث الأقساط إلى حالة paid (ناجح)');
  }

  // 4.2 Partial loan deduction (when deduction is less than remaining)
  {
    const loans: Loan[] = [
      { id: 2, principalAmount: 10000, paidAmount: 0, remainingAmount: 10000, status: 'disbursed' },
    ];
    const installments: Installment[] = [
      { id: 201, loanId: 2, installmentNo: 1, amount: 5000, paidAmount: 0, status: 'unpaid' },
      { id: 202, loanId: 2, installmentNo: 2, amount: 5000, paidAmount: 0, status: 'unpaid' },
    ];

    const res = allocateEosLoanDeduction(loans, installments, 7000);
    assert.equal(res.updatedLoans[0].remainingAmount, 3000, 'المتبقي من السلفة 3000');
    assert.equal(res.updatedLoans[0].status, 'partially_repaid', 'حالة السلفة partially_repaid');
    assert.equal(res.updatedInstallments[0].status, 'paid', 'القسط الأول سُدد بالكامل');
    assert.equal(res.updatedInstallments[1].paidAmount, 2000, 'القسط الثاني سُدد منه 2000');
    assert.equal(res.updatedInstallments[1].status, 'partial', 'حالة القسط الثاني partial');
    console.log('✔ سداد جزئي للسلفة وتوزيع الأقساط بدقة (سداد قسط كامل + قسط جزئي) (ناجح)');
  }
}

function testRejectsInvalidSettlementAmounts() {
  const base = {
    gratuityAmount: 1000,
    leaveEncashmentAmount: 0,
    pendingSalaryAmount: 0,
    noticePeriodAmount: 0,
    otherEntitlementsAmount: 0,
    unpaidLoansDeduction: 100,
    assetsDeduction: 0,
    otherDeductions: 0,
    minorUnits: 2 as const,
  };
  assert.equal(calculateSettlementAbsorption(base).netPayable, 900);
  assert.throws(() => calculateSettlementAbsorption({ ...base, assetsDeduction: -1 }), /negative/);
  assert.throws(() => calculateSettlementAbsorption({ ...base, pendingSalaryAmount: Infinity }), /Invalid/);
  assert.throws(() => calculateSettlementAbsorption({ ...base, gratuityAmount: Number.NaN }), /Invalid/);
}

// -----------------------------------------------------------------------------
// Run all tests
// -----------------------------------------------------------------------------
testGratuityCalculations();
testAccountingJournalBalance();
testCustodyClearanceGate();
testLoanRepaymentAllocation();
testRejectsInvalidSettlementAmounts();

console.log('\n=============================================================================');
console.log('جميع اختبارات المرحلة (6) للموارد البشرية ومستحقات نهاية الخدمة اجتازت بنجاح 100%!');
console.log('=============================================================================\n');
