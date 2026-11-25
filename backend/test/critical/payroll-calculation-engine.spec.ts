import { strict as assert } from 'node:assert';
import {
  calculateDailyRate,
  calculateOvertime,
  calculateHourlyOvertimePremium,
  calculateProgressiveDelayDeduction,
  calculateSocialInsurance,
  calculateIncomeTax,
  calculateEmployeePayrollLine,
  reconcilePayrollRunJournalTotals,
  type PayrollLineItemOutput,
} from '../../src/modules/hr/engines/payroll-calculation.engine';

console.log('=== بدء اختبارات التدقيق المالي لمسير الرواتب ومحرك الاستقطاعات والقيود المزدوجة ===\n');

function testOvertimeAndDailyRates() {
  console.log('--- 1. اختبارات احتساب أجر اليوم ومضاعفات العمل الإضافي (Overtime Multipliers) ---');

  // 1.1 Monthly employee daily rate & hourly rate
  const monthlyRate = calculateDailyRate({
    minorUnits: 2,
    isHourly: false,
    baseSalary: 12000,
    expectedDailyHours: 8,
  });
  assert.equal(monthlyRate.dailyRate, 400.0, 'أجر اليوم للموظف الشهري (12000 / 30 = 400)');
  assert.equal(monthlyRate.hourlyRate, 50.0, 'أجر الساعة (400 / 8 = 50)');

  // 1.2 Overtime 120 minutes (2 hours) at 1.5x
  const overtimePay = calculateOvertime({
    minorUnits: 2,
    overtimeMinutes: 120,
    calculatedHourlyRate: 50,
    overtimeMultiplier: 1.5,
  });
  // 2 hours * 50 * 1.5 = 150.00
  assert.equal(overtimePay, 150.0, 'أجر الإضافي لساعتين بمعدل 1.5x هو 150.00');
  // Hourly base includes 2h * 50 = 100 already; only the additional 50 is owed.
  assert.equal(
    calculateHourlyOvertimePremium({
      minorUnits: 2,
      overtimeMinutes: 120,
      calculatedHourlyRate: 50,
      overtimeMultiplier: 1.5,
    }),
    50,
  );
  assert.equal(
    calculateHourlyOvertimePremium({
      minorUnits: 2,
      overtimeMinutes: 120,
      calculatedHourlyRate: 50,
      overtimeMultiplier: 2,
    }),
    100,
  );
  assert.equal(
    calculateHourlyOvertimePremium({
      minorUnits: 2,
      overtimeMinutes: 120,
      calculatedHourlyRate: 50,
      overtimeMultiplier: 1,
    }),
    0,
  );

  // 1.3 Hourly employee daily rate
  const hourlyRateCalc = calculateDailyRate({
    minorUnits: 2,
    isHourly: true,
    hourlyRate: 35,
    expectedDailyHours: 8,
  });
  assert.equal(hourlyRateCalc.dailyRate, 280.0, 'أجر اليوم للموظف بالساعة (35 * 8 = 280)');
  assert.equal(hourlyRateCalc.hourlyRate, 35.0, 'أجر الساعة للموظف بالساعة');
  console.log('✔ احتساب معدلات الأجور والعمل الإضافي (ناجح)');
}

function testProgressiveDelayDeductions() {
  console.log('--- 2. اختبارات سياسة استقطاع التأخير والانصراف المبكر (Progressive Delays) ---');

  // 2.1 Standard exact minutes deduction
  const standardDeduction = calculateProgressiveDelayDeduction({
    minorUnits: 2,
    policyMode: 'standard',
    totalIncidents: 2,
    totalLateMinutes: 90,
    calculatedHourlyRate: 40,
    dailyRate: 320,
  });
  // 1.5 hours * 40 = 60.00
  assert.equal(standardDeduction, 60.0, 'الاستقطاع المباشر لـ 90 دقيقة تأخير بمعدل 40/ساعة هو 60');

  // 2.2 Progressive tier policy: 4 incidents
  // 1st: 0.25 day, 2nd: 0.5 day, 3rd: 1 day, 4th: 1 day -> Total 2.75 days
  const progressiveDeduction = calculateProgressiveDelayDeduction({
    minorUnits: 2,
    policyMode: 'progressive',
    totalIncidents: 4,
    totalLateMinutes: 120,
    calculatedHourlyRate: 25,
    dailyRate: 200,
    tiers: {
      firstTimeDeductionDays: 0.25,
      secondTimeDeductionDays: 0.5,
      thirdTimeDeductionDays: 1,
      fourthTimeDeductionDays: 1,
    },
  });
  // 2.75 * 200 = 550.00
  assert.equal(progressiveDeduction, 550.0, 'الاستقطاع التصاعدي لـ 4 مرات تأخير هو 550 (2.75 يوم * 200)');
  console.log('✔ سياسات استقطاع التأخير القياسية والتصاعدية (ناجح)');
}

function testSocialInsuranceCalculations() {
  console.log('--- 3. اختبارات التأمينات الاجتماعية المزدوجة (Employee & Employer GOSI) ---');

  // 3.1 Standard GOSI (Employee 11%, Employer 18.75%)
  const gosi = calculateSocialInsurance({
    minorUnits: 2,
    isEnabled: true,
    hasEmployeeInsurance: true,
    insuranceSalary: 8000,
    employeePct: 11,
    employerPct: 18.75,
  });
  assert.equal(gosi.employeeShare, 880.0, 'حصة الموظف 11% من 8000 = 880');
  assert.equal(gosi.employerShare, 1500.0, 'حصة المنشأة 18.75% من 8000 = 1500');

  // 3.2 GOSI with statutory wage cap
  const cappedGosi = calculateSocialInsurance({
    minorUnits: 2,
    isEnabled: true,
    hasEmployeeInsurance: true,
    insuranceSalary: 55000,
    capAmount: 45000,
    employeePct: 9.75,
    employerPct: 11.75,
  });
  // 45000 * 9.75% = 4387.50
  assert.equal(cappedGosi.employeeShare, 4387.5, 'حصة الموظف المسقوفة بـ 45000 عند 9.75%');
  // 45000 * 11.75% = 5287.50
  assert.equal(cappedGosi.employerShare, 5287.5, 'حصة المنشأة المسقوفة بـ 45000 عند 11.75%');
  console.log('✔ احتساب التأمينات الاجتماعية لحصتي الموظف والمنشأة مع السقف النظامي (ناجح)');
}

function testIncomeTaxCalculations() {
  console.log('--- 4. اختبارات ضريبة كسب العمل والشرائح التصاعدية (Income Tax Brackets) ---');

  // 4.1 Income under tax exemption limit (<= 3333/month)
  // Synthetic progressive rates, supplied explicitly by the calling policy.
  const exampleBrackets = [
    { min: 0, max: 3333, rate: 0.0 },
    { min: 3333, max: 4583, rate: 0.1 },
    { min: 4583, max: 6250, rate: 0.15 },
    { min: 6250, max: 16666, rate: 0.2 },
    { min: 16666, max: null, rate: 0.225 },
  ];
  assert.throws(
    () =>
      calculateIncomeTax({
        minorUnits: 2,
        isEnabled: true,
        hasIncomeTax: true,
        taxableIncome: 10000,
      }),
    /Explicit tax brackets/,
  );
  const exempt = calculateIncomeTax({
    minorUnits: 2,
    isEnabled: true,
    hasIncomeTax: true,
    taxableIncome: 3000,
    brackets: exampleBrackets,
  });
  assert.equal(exempt, 0, 'الدخل الخاضع أقل من حد الإعفاء -> ضريبة 0');

  // 4.2 Income in 10% bracket (e.g. 4000)
  // (4000 - 3333) * 10% = 66.70
  const taxTier1 = calculateIncomeTax({
    minorUnits: 2,
    isEnabled: true,
    hasIncomeTax: true,
    taxableIncome: 4000,
    brackets: exampleBrackets,
  });
  assert.equal(taxTier1, 66.7, 'ضريبة الدخل في الشريحة الأولى 10%');

  // 4.3 Higher progressive bracket (e.g. 10000)
  // Tier 1 (3333 - 4583): 1250 * 10% = 125
  // Tier 2 (4583 - 6250): 1667 * 15% = 250.05
  // Tier 3 (6250 - 10000): 3750 * 20% = 750
  // Total = 125 + 250.05 + 750 = 1125.05
  const taxTier3 = calculateIncomeTax({
    minorUnits: 2,
    isEnabled: true,
    hasIncomeTax: true,
    taxableIncome: 10000,
    brackets: exampleBrackets,
  });
  assert.equal(taxTier3, 1125.05, 'الضريبة التصاعدية لدخل 10000 هي 1125.05');
  console.log('✔ احتساب الضرائب التصاعدية بالشرائح القانونية (ناجح)');
}

function testPayrollLinePriorityAndCaps() {
  console.log('--- 5. اختبارات حوكمة الاستقطاعات وسقف قانون العمل (50% Cap & Carried Forward) ---');

  // 5.1 Normal case: Total deductions well below 50% cap
  {
    const line = calculateEmployeePayrollLine({
      minorUnits: 2,
      employeeId: 101,
      baseSalary: 10000,
      allowanceAmount: 2000,
      overtimeAmount: 500,
      commissionAmount: 500,
      employeeSocialInsurance: 1100,
      employerSocialInsurance: 1875,
      incomeTax: 400,
      attendanceDeduction: 200,
      leaveDeduction: 0,
      assetRecoveryDeduction: 0,
      otherDeductions: 100,
      scheduledLoanDeduction: 1000,
      maxDeductionPct: 0.5,
    });

    assert.equal(line.grossPay, 13000.0, 'إجمالي الراتب (10000 + 2000 + 500 + 500 = 13000)');
    assert.equal(line.appliedLoanDeduction, 1000.0, 'استقطاع القسط بالكامل لتوفر الرصيد');
    assert.equal(line.deferredLoanDeduction, 0.0, 'لا يوجد قسط مؤجل');
    assert.equal(line.carriedForwardDeduction, 0.0, 'لا توجد جزاءات مرحلة');
    // Total deductions = 1100 (GOSI) + 400 (Tax) + 200 (Att) + 100 (Other) + 1000 (Loan) = 2800
    assert.equal(line.totalDeductions, 2800.0, 'إجمالي الاستقطاعات');
    assert.equal(line.netPay, 10200.0, 'صافي الراتب المستحق (13000 - 2800 = 10200)');
    console.log('✔ المسير الاعتيادي بدون بلوغ السقف (ناجح)');
  }

  // 5.2 Heavy Loan Installment exceeding 50% Labor Law Cap
  // Gross: 6000. Statutory GOSI+Tax: 600.
  // 50% Cap on Gross: 3000 max total deductions.
  // Non-statutory pool available: 3000 - 600 = 2400.
  // Operational deductions: 1000.
  // Remaining pool for loan: 2400 - 1000 = 1400.
  // Scheduled Loan Installment: 2000.
  // Applied Loan: 1400. Deferred Loan: 600.
  // Net Pay: 6000 - (600 + 1000 + 1400) = 3000 (exactly 50% preserved!).
  {
    const line = calculateEmployeePayrollLine({
      minorUnits: 2,
      employeeId: 102,
      baseSalary: 6000,
      allowanceAmount: 0,
      overtimeAmount: 0,
      commissionAmount: 0,
      employeeSocialInsurance: 500,
      employerSocialInsurance: 1000,
      incomeTax: 100,
      attendanceDeduction: 1000,
      leaveDeduction: 0,
      assetRecoveryDeduction: 0,
      otherDeductions: 0,
      scheduledLoanDeduction: 2000,
      maxDeductionPct: 0.5,
    });

    assert.equal(line.grossPay, 6000.0, 'إجمالي الراتب 6000');
    assert.equal(line.appliedLoanDeduction, 1400.0, 'تطبيق 1400 فقط من قسط السلفة لحماية سقف الـ 50%');
    assert.equal(line.deferredLoanDeduction, 600.0, 'تأجيل 600 من القسط رسمياً دون إسقاطه من دفتر القروض');
    assert.equal(line.carriedForwardDeduction, 0.0, 'لا جزاءات مرحلة');
    assert.equal(line.totalDeductions, 3000.0, 'إجمالي الاستقطاعات يطابق سقف الـ 50% بدقة');
    assert.equal(line.netPay, 3000.0, 'صافي الراتب المستحق لا يقل عن 50% من الأجر');
    assert.equal(line.isCapped, true, 'تم تفعيل قفل السقف القانوني');
    console.log('✔ حماية سقف الـ 50% وتأجيل أقساط السلف دون إسقاط الديون (ناجح)');
  }

  // 5.3 Over-penalized Employee: Penalties exceed non-statutory pool
  // Gross: 4000. Statutory: 400. Max 50% pool: 2000 - 400 = 1600.
  // Requested Attendance Penalty: 2500.
  // Applied Attendance: 1600.
  // Deferred / Carried Forward Penalty: 900.
  // Scheduled Loan: 800. Applied Loan: 0. Deferred Loan: 800.
  // Net Pay: 4000 - (400 + 1600) = 2000.
  {
    const line = calculateEmployeePayrollLine({
      minorUnits: 2,
      employeeId: 103,
      baseSalary: 4000,
      allowanceAmount: 0,
      overtimeAmount: 0,
      commissionAmount: 0,
      employeeSocialInsurance: 400,
      employerSocialInsurance: 800,
      incomeTax: 0,
      attendanceDeduction: 2500,
      leaveDeduction: 0,
      assetRecoveryDeduction: 0,
      otherDeductions: 0,
      scheduledLoanDeduction: 800,
      maxDeductionPct: 0.5,
    });

    assert.equal(line.grossPay, 4000.0, 'إجمالي الراتب 4000');
    assert.equal(line.attendanceDeduction, 1600.0, 'استقطاع 1600 فقط من الجزاءات حتى سقف الخصم');
    assert.equal(line.carriedForwardDeduction, 900.0, 'ترحيل 900 من الجزاءات للشهر القادم');
    assert.equal(line.appliedLoanDeduction, 0.0, 'تأجيل قسط السلفة بالكامل');
    assert.equal(line.deferredLoanDeduction, 800.0, 'تأجيل 800 من السلفة');
    assert.equal(line.netPay, 2000.0, 'صافي الراتب 2000');
    assert.ok(line.netPay >= 0, 'حظر الراتب السالب حظراً باتاً');
    console.log('✔ ترحيل الجزاءات الزائدة للشهر التالي ومنع الرواتب السالبة (ناجح)');
  }
}

function testDoubleEntryPayrollRunReconciliation() {
  console.log('--- 6. اختبارات توازن القيد المحاسبي المزدوج لمسير الرواتب (GL Double-Entry Balance) ---');

  // Create 3 diverse payroll line items:
  const line1: PayrollLineItemOutput = calculateEmployeePayrollLine({
    minorUnits: 2,
    employeeId: 1,
    baseSalary: 15000,
    allowanceAmount: 3000,
    overtimeAmount: 750,
    commissionAmount: 1250,
    employeeSocialInsurance: 1650,
    employerSocialInsurance: 2812.5,
    incomeTax: 850,
    attendanceDeduction: 300,
    leaveDeduction: 0,
    assetRecoveryDeduction: 150,
    otherDeductions: 100,
    scheduledLoanDeduction: 1500,
    maxDeductionPct: 0.5,
  });

  const line2: PayrollLineItemOutput = calculateEmployeePayrollLine({
    minorUnits: 2,
    employeeId: 2,
    baseSalary: 8000,
    allowanceAmount: 1000,
    overtimeAmount: 300,
    commissionAmount: 0,
    employeeSocialInsurance: 880,
    employerSocialInsurance: 1500,
    incomeTax: 250,
    attendanceDeduction: 400,
    leaveDeduction: 200,
    assetRecoveryDeduction: 0,
    otherDeductions: 0,
    scheduledLoanDeduction: 1000,
    maxDeductionPct: 0.5,
  });

  const line3: PayrollLineItemOutput = calculateEmployeePayrollLine({
    minorUnits: 2,
    employeeId: 3,
    baseSalary: 5000,
    allowanceAmount: 500,
    overtimeAmount: 0,
    commissionAmount: 0,
    employeeSocialInsurance: 550,
    employerSocialInsurance: 937.5,
    incomeTax: 80,
    attendanceDeduction: 1200,
    leaveDeduction: 0,
    assetRecoveryDeduction: 0,
    otherDeductions: 0,
    scheduledLoanDeduction: 1500,
    maxDeductionPct: 0.5,
  });

  const reconciliation = reconcilePayrollRunJournalTotals([line1, line2, line3], 2);

  console.log(`- إجمالي مصاريف الرواتب (مدين 6200): ${reconciliation.grossSalariesExpense}`);
  console.log(`- إجمالي حصة المنشأة في التأمينات (مدين 6210): ${reconciliation.employerInsuranceExpense}`);
  console.log(`- مجموع الجانب المدين: ${reconciliation.totalDebit}`);
  console.log(`- صافي الرواتب المستحقة (دائن 2140): ${reconciliation.netPayable}`);
  console.log(`- مستحقات هيئة التأمينات المشتركة (دائن 2145): ${reconciliation.socialInsurancePayable}`);
  console.log(`- ضريبة كسب العمل المستحقة (دائن 2146): ${reconciliation.incomeTaxPayable}`);
  console.log(`- تسوية أقساط السلف والعهد (دائن 1160): ${reconciliation.loanAdvancesCredit}`);
  console.log(`- استرداد الجزاءات والغياب (دائن 7100): ${reconciliation.otherIncomePenaltiesCredit}`);
  console.log(`- مجموع الجانب الدائن: ${reconciliation.totalCredit}`);
  console.log(`- الفارق المحاسبي: ${reconciliation.discrepancy}`);

  assert.equal(reconciliation.isBalanced, true, 'يجب أن يكون القيد المحاسبي المزدوج متوازناً تماماً');
  assert.equal(reconciliation.discrepancy, 0.0, 'الفارق المحاسبي يجب أن يكون صفراً تماماً (0.00)');
  assert.equal(reconciliation.totalDebit, reconciliation.totalCredit, 'تطابق مجموع المدين والدائن بدقة السنت');
  console.log('✔ توازن القيد المحاسبي المزدوج بنسبة 100% وخلوه من أي فروقات سنتات (ناجح)');
}

function runAllPayrollTests() {
  testOvertimeAndDailyRates();
  testProgressiveDelayDeductions();
  testSocialInsuranceCalculations();
  testIncomeTaxCalculations();
  testPayrollLinePriorityAndCaps();
  testDoubleEntryPayrollRunReconciliation();

  console.log('\n=============================================================================');
  console.log('✔ كافة اختبارات محرك الرواتب والقيود المزدوجة والحوكمة العمالية نجحت بنسبة 100%!');
  console.log('=============================================================================');
}

runAllPayrollTests();
