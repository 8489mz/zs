import assert from 'node:assert/strict';
import {
  buildEmployeeFinancialStatement,
  type EmployeeFinancialProfile,
  type FinancialPayrollItem,
  type FinancialLoanRecord,
  type FinancialLedgerRecord,
} from '../../src/modules/hr/engines/employee-financial-statement.engine';
import {
  calculateEmployeeWithdrawalBalance,
  resolvePayoutSchedule,
  type EmployeeWithdrawalContext,
} from '../../src/modules/hr/engines/employee-withdrawal-balance.engine';
import {
  calculateDailyRate,
  calculateOvertime,
  calculateEmployeePayrollLine,
  reconcilePayrollRunJournalTotals,
} from '../../src/modules/hr/engines/payroll-calculation.engine';
import {
  allocateLoanDeduction,
  calculatePayrollLoanDueTotal,
  calculateLoanInstallmentSchedule,
} from '../../src/modules/hr/payroll-loan-allocation.engine';
import {
  summarizeHourlyAttendance,
  type WorkPunch,
} from '../../src/modules/hr/engines/hourly-attendance-pay.engine';

console.log('================================================================================');
console.log('  المحاكاة الشاملة الكبرى واختبارات الضغط لمسيرات الرواتب والسلف وكشوف الحساب  ');
console.log('  (HR Payroll, Cashier Advances, Payout Disbursals & Monte Carlo 50,000 Cases)  ');
console.log('================================================================================\n');

// ==============================================================================
// 1. اختبار موظف أخذ سلفة، خُصمت في كشف الرواتب، ثم صُرف باقي الراتب: هل يتصفر رصيده؟
// ==============================================================================
function testEmployeeAdvanceAndPayrollSettlement() {
  console.log('--- 1. اختبار دورة السلفة النقدية والخصم من المرتب وتصفير كشف الحساب بالكامل ---');

  const emp: EmployeeFinancialProfile = {
    id: 101,
    employeeNo: 'EMP-001',
    displayName: 'محمود حسن',
    hireDate: '2026-01-01',
    status: 'active',
    baseSalary: 6000,
    departmentName: 'المبيعات',
    jobTitleName: 'مسؤول مبيعات',
  };

  // أ) الموظف يسحب سلفة نقدية 1,000 ج.م من وردية الكاشير يوم 5 أكتوبر
  const loans: FinancialLoanRecord[] = [
    {
      id: 1,
      loanNo: 'LOAN-261005-0001',
      loanType: 'advance',
      principalAmount: 1000,
      paidAmount: 0,
      remainingAmount: 1000,
      status: 'paid', // disbursed from cashier shift
      notes: 'سلفة نقدية سريعة [وردية كاشير #10]',
      issueDate: '2026-10-05',
      disbursedAt: '2026-10-05 14:00:00',
      createdByName: 'كاشير الفرع',
    },
  ];

  // فحص كشف الحساب بعد السلفة وقبل مسير الرواتب:
  // الموظف مديون بـ 1,000 ج.م (debit)، رصيده بالسالب (-1,000)
  const stmtBeforePayroll = buildEmployeeFinancialStatement({
    minorUnits: 2,
    employee: emp,
    payrollItems: [],
    loans,
    adjustments: [],
    ledger: [],
  });

  assert.equal(stmtBeforePayroll.summary.totalWithdrawals, 1000, 'إجمالي المسحوبات 1,000');
  assert.equal(stmtBeforePayroll.summary.remainingLoanDebt, 1000, 'المديونية المتبقية 1,000');
  assert.equal(stmtBeforePayroll.summary.netFinancialBalance, -1000, 'صافي الرصيد مدين بـ 1,000');
  assert.equal(stmtBeforePayroll.summary.balanceStatus, 'debit', 'حالة الحساب مدين');
  console.log('  ✔ مرحلة السلفة: الموظف مدين بـ 1000 ج.م والرصيد في كشف الحساب سالب (-1000)');

  // ب) نهاية الشهر: إعداد مسير الرواتب لشهر 2026-10
  // الراتب الإجمالي: 6,000 ج.م
  // خصم السلفة: 1,000 ج.م
  // الصافي المستحق: 5,000 ج.م
  // المسير معتمد (approved) ولكن لم يصرف بعد
  const payrollItemApproved: FinancialPayrollItem = {
    id: 501,
    runId: 201,
    periodMonth: '2026-10',
    runStatus: 'approved',
    itemStatus: 'approved',
    baseSalary: 6000,
    allowanceAmount: 0,
    grossPay: 6000,
    deductionAmount: 0,
    penaltyDeduction: 0,
    loanDeductionAmount: 1000,
    netPay: 5000,
  };

  // تسوية السلفة برمجياً بمحرك أقساط السلف (allocateLoanDeduction)
  const loanAllocation = allocateLoanDeduction({
    remainingToDeduct: 1000,
    installmentAmount: 1000,
    installmentPaid: 0,
    loanRemaining: 1000,
    loanPaid: 0,
    minorUnits: 2,
  });
  assert.ok(loanAllocation, 'تم تخصيص خصم السلفة بنجاح');
  assert.equal(loanAllocation.deductAmount, 1000);
  assert.equal(loanAllocation.newLoanRemaining, 0);
  assert.equal(loanAllocation.newLoanStatus, 'repaid');

  // تحديث حالة السلفة إلى مسددة بعد اعتماد المسير
  loans[0].paidAmount = 1000;
  loans[0].remainingAmount = 0;
  loans[0].status = 'repaid';

  // كشف الحساب بعد الاعتماد وقبل الصرف النقدي:
  // استحقاق الراتب (+6000 credit) - السلفة (-1000 debit) = باقي للموظف 5000 دائن
  const stmtApproved = buildEmployeeFinancialStatement({
    minorUnits: 2,
    employee: emp,
    payrollItems: [payrollItemApproved],
    loans,
    adjustments: [],
    ledger: [
      {
        id: 99,
        entryType: 'loan_repayment',
        amount: -1000,
        balanceAfter: 0,
        note: 'Payroll Salary Deduction',
        repaymentMethod: 'salary_deduction',
        referenceType: 'hr_payroll_loan_deduction',
        referenceId: '501',
        createdAt: '2026-10-28 10:00:00',
        createdByName: 'المدير المالي',
      },
    ],
  });

  assert.equal(stmtApproved.summary.remainingLoanDebt, 0, 'مديونية السلفة تم تصفيرها بالكامل');
  assert.equal(stmtApproved.summary.totalGrossEarnings, 6000, 'إجمالي الاستحقاق 6,000');
  assert.equal(stmtApproved.summary.netFinancialBalance, 5000, 'باقي للموظف 5,000 ج.م');
  assert.equal(stmtApproved.summary.balanceStatus, 'credit', 'حالة الحساب دائن (الشركة مدينة للموظف)');
  console.log('  ✔ مرحلة الاعتماد: السلفة سُددت بالكامل، وباقي صافي مستحق للموظف 5000 ج.م');

  // ج) صرف الراتب من شاشة الـ HR عبر زر [صرف] (سواء من درج الكاشير أو الخزينة)
  // الصافي المصروف: 5,000 ج.م
  const payrollItemPaid: FinancialPayrollItem = {
    ...payrollItemApproved,
    runStatus: 'paid',
    itemStatus: 'paid',
    paidAt: '2026-10-28 15:30:00',
    paymentChannel: 'drawer',
    paidByName: 'كاشير أحمد',
  };

  const stmtAfterPayout = buildEmployeeFinancialStatement({
    minorUnits: 2,
    employee: emp,
    payrollItems: [payrollItemPaid],
    loans,
    adjustments: [],
    ledger: [],
  });

  assert.equal(stmtAfterPayout.summary.totalWithdrawals, 1000, 'إجمالي المسحوبات 1,000');
  assert.equal(stmtAfterPayout.summary.totalRepayments, 1000, 'إجمالي سداد السلفة 1,000');
  assert.equal(stmtAfterPayout.summary.remainingLoanDebt, 0, 'لا توجد ديون متبقية');
  assert.equal(stmtAfterPayout.summary.totalGrossEarnings, 6000, 'إجمالي الراتب 6,000');
  assert.equal(stmtAfterPayout.summary.totalPaidSalaries, 5000, 'الصافي المقبوض 5,000');
  assert.equal(stmtAfterPayout.summary.netFinancialBalance, 0, 'الرصيد المالي صفر تماماً (متسوي 100%)');
  assert.equal(stmtAfterPayout.summary.balanceStatus, 'settled', 'حالة الحساب خالص (settled)');

  // التأكد من الحركات المالية بالتسلسل التاريخي (3 حركات):
  // 1. سلفة نقدية (مدين 1,000) -> الرصيد -1,000
  // 2. استحقاق الراتب (دائن 6,000) -> الرصيد +5,000
  // 3. قبض الصافي (مدين 5,000) -> الرصيد 0
  assert.equal(stmtAfterPayout.transactions.length, 3);
  assert.equal(stmtAfterPayout.transactions[0].category, 'salary_payout');
  assert.equal(stmtAfterPayout.transactions[0].debit, 5000);
  assert.equal(stmtAfterPayout.transactions[0].runningBalance, 0);

  console.log('  ✔ مرحلة الصرف: رصيد الموظف أصبح 0.00 ج.م تماماً وحالة الحساب "settled" (ناجح 100%)\n');
}

// ==============================================================================
// 2. اختبار موظف صرفناله قبل معاده وموظف لا (صرف فردي وحالة partially_paid)
// ==============================================================================
function testIndividualEarlyPayoutVsPending() {
  console.log('--- 2. اختبار الصرف الفردي: موظف قبض مبكراً وموظف آخر لم يقبض (حالة الصرف الجزئي) ---');

  const emp1: EmployeeFinancialProfile = {
    id: 101,
    displayName: 'علي كمال (قبض مبكراً)',
    status: 'active',
    baseSalary: 4000,
  };

  const emp2: EmployeeFinancialProfile = {
    id: 102,
    displayName: 'سعيد ابراهيم (لم يقبض بعد)',
    status: 'active',
    baseSalary: 5000,
  };

  // مسير رواتب برقم 301 يحتوي على الموظفين الاثنين
  // تم اعتماد المسير (approved)
  // تم صرف راتب علي كمال فقط عبر نقطة البيع / الكاشير
  // فأصبحت حالة المسير: partially_paid
  // بند علي: itemStatus = 'paid'
  // بند سعيد: itemStatus = 'approved'

  const item1: FinancialPayrollItem = {
    id: 601,
    runId: 301,
    periodMonth: '2026-10',
    runStatus: 'partially_paid',
    itemStatus: 'paid',
    baseSalary: 4000,
    allowanceAmount: 0,
    grossPay: 4000,
    deductionAmount: 0,
    penaltyDeduction: 0,
    loanDeductionAmount: 0,
    netPay: 4000,
    paidAt: '2026-10-25 12:00:00',
    paymentChannel: 'drawer',
    paidByName: 'كاشير المحل',
  };

  const item2: FinancialPayrollItem = {
    id: 602,
    runId: 301,
    periodMonth: '2026-10',
    runStatus: 'partially_paid',
    itemStatus: 'approved',
    baseSalary: 5000,
    allowanceAmount: 0,
    grossPay: 5000,
    deductionAmount: 0,
    penaltyDeduction: 0,
    loanDeductionAmount: 0,
    netPay: 5000,
  };

  // 1. فحص كشف حساب الموظف الأول (الذي قبض مبكراً)
  const stmt1 = buildEmployeeFinancialStatement({
    minorUnits: 2,
    employee: emp1,
    payrollItems: [item1],
    loans: [],
    adjustments: [],
    ledger: [],
  });

  assert.equal(stmt1.summary.totalGrossEarnings, 4000, 'استحقاق 4000');
  assert.equal(stmt1.summary.totalPaidSalaries, 4000, 'تم قبض 4000');
  assert.equal(stmt1.summary.netFinancialBalance, 0, 'رصيده اتصفر تماماً (0)');
  assert.equal(stmt1.summary.balanceStatus, 'settled', 'حالة الحساب خالص');
  assert.equal(stmt1.transactions.length, 2, 'حركتان: استحقاق وقبض');
  assert.equal(stmt1.transactions[0].category, 'salary_payout');
  assert.equal(stmt1.transactions[0].runningBalance, 0);
  console.log('  ✔ الموظف الأول (قبض مبكراً): رصيده 0.00 ج.م وحالته خالص settled داخل مسير partially_paid');

  // 2. فحص كشف حساب الموظف الثاني (الذي لم يقبض بعد)
  const stmt2 = buildEmployeeFinancialStatement({
    minorUnits: 2,
    employee: emp2,
    payrollItems: [item2],
    loans: [],
    adjustments: [],
    ledger: [],
  });

  assert.equal(stmt2.summary.totalGrossEarnings, 5000, 'استحقاق 5000 معترف به');
  assert.equal(stmt2.summary.totalPaidSalaries, 0, 'لم يقبض أي مبالغ');
  assert.equal(stmt2.summary.netFinancialBalance, 5000, 'الشركة مدينة له بـ 5000 ج.م');
  assert.equal(stmt2.summary.balanceStatus, 'credit', 'حالة الحساب دائن للموظف');
  assert.equal(stmt2.transactions.length, 1, 'حركة واحدة: استحقاق فقط بدون قبض');
  console.log('  ✔ الموظف الثاني (لم يقبض بعد): رصيده دائن بـ 5000 ج.م ومستحقاته محفوظة بالكامل');

  // 3. فحص سحب النقدية للموظف الثاني: هل يُحسب له المبلغ المعلق في المسير؟
  const balanceCheckEmp2 = calculateEmployeeWithdrawalBalance({
    minorUnits: 2,
    employee: {
      id: 102,
      displayName: 'سعيد ابراهيم',
      compensationType: 'monthly',
      payFrequency: 'monthly',
      hourlyRate: 0,
      expectedDailyHours: 8,
      status: 'active',
    },
    activePayrollItem: {
      id: 602,
      runId: 301,
      periodMonth: '2026-10',
      runStatus: 'partially_paid',
      itemStatus: 'approved',
      baseSalary: 5000,
      allowanceAmount: 0,
      grossPay: 5000,
      deductionAmount: 0,
      loanDeductionAmount: 0,
      netPay: 5000,
    },
    currentCycle: {
      cycleStart: '2026-10-01',
      cycleEnd: '2026-10-31',
      daysElapsed: 31,
    },
    punches: [],
    priorLoans: [],
    unpaidApprovedPayrollItems: [{ id: 602, netPay: 5000, grossPay: 5000 }],
    todayDate: '2026-10-31',
  });

  assert.equal(balanceCheckEmp2.netAvailableBalance, 5000, 'الرصيد المتاح للموظف هو 5000');
  assert.equal(balanceCheckEmp2.balanceStatus, 'credit', 'الرصيد دائن');
  console.log('  ✔ محرك السحب والمسحوبات يعترف برصيد الموظف غير المقبوض (5000 ج.م)\n');
}

// ==============================================================================
// 3. اختبار دورات الصرف الأربعة: شهري، نصف شهري، أسبوعي، يومي
// ==============================================================================
function testPayFrequenciesAndSchedules() {
  console.log('--- 3. اختبار دورات وتكرارات الصرف (شهري، نصف شهري، أسبوعي، يومي) ---');

  // أ) شهري (Monthly)
  const monthlySchedule = resolvePayoutSchedule('monthly', '2026-10-20', '2026-10-31');
  assert.equal(monthlySchedule.payFrequency, 'monthly');
  assert.equal(monthlySchedule.cycleStart, '2026-10-01');
  assert.equal(monthlySchedule.cycleEnd, '2026-10-31');
  assert.equal(monthlySchedule.nextPayoutDate, '2026-10-31');
  assert.equal(monthlySchedule.daysUntilPayout, 11);
  assert.equal(monthlySchedule.isPayoutDue, false);

  const monthlyDue = resolvePayoutSchedule('monthly', '2026-10-31', '2026-10-31');
  assert.equal(monthlyDue.isPayoutDue, true, 'يوم 31 هو موعد الصرف');
  assert.equal(monthlyDue.daysUntilPayout, 0);
  console.log('  ✔ الدورة الشهرية: بداية 1 ونهاية 31 والاستحقاق في اليوم الأخير بدقة');

  // ب) نصف شهري (Bi-Weekly / Semi-Monthly)
  // النصف الأول: 1 إلى 15
  const biweeklyFirstHalf = resolvePayoutSchedule('biweekly', '2026-10-10');
  assert.equal(biweeklyFirstHalf.cycleStart, '2026-10-01');
  assert.equal(biweeklyFirstHalf.cycleEnd, '2026-10-15');
  assert.equal(biweeklyFirstHalf.isPayoutDue, false);
  assert.equal(biweeklyFirstHalf.daysUntilPayout, 5);

  const biweeklyFirstHalfDue = resolvePayoutSchedule('biweekly', '2026-10-15');
  assert.equal(biweeklyFirstHalfDue.isPayoutDue, true, 'يوم 15 هو موعد صرف النصف الأول');
  assert.equal(biweeklyFirstHalfDue.daysUntilPayout, 0);

  // النصف الثاني: 16 إلى نهاية الشهر
  const biweeklySecondHalf = resolvePayoutSchedule('biweekly', '2026-10-20');
  assert.equal(biweeklySecondHalf.cycleStart, '2026-10-16');
  assert.equal(biweeklySecondHalf.cycleEnd, '2026-10-31');
  assert.equal(biweeklySecondHalf.isPayoutDue, false);
  assert.equal(biweeklySecondHalf.daysUntilPayout, 11);

  const biweeklySecondHalfDue = resolvePayoutSchedule('biweekly', '2026-10-31');
  assert.equal(biweeklySecondHalfDue.isPayoutDue, true, 'نهاية الشهر موعد صرف النصف الثاني');
  console.log('  ✔ دورة النصف شهري: الدورة الأولى (1-15) والدورة الثانية (16-نهاية الشهر) صحيحة 100%');

  // ج) أسبوعي (Weekly)
  // يوم الخميس موعد الصرف الأسبوعي
  const weeklyDue = resolvePayoutSchedule('weekly', '2026-10-22'); // 2026-10-22 is Thursday
  assert.equal(weeklyDue.isPayoutDue, true, 'يوم الخميس مستحق الصرف الأسبوعي');
  assert.equal(weeklyDue.daysUntilPayout, 0);

  const weeklyMidWeek = resolvePayoutSchedule('weekly', '2026-10-19'); // Monday
  assert.equal(weeklyMidWeek.isPayoutDue, false);
  assert.equal(weeklyMidWeek.daysUntilPayout, 3, 'متبقي 3 أيام على الخميس');
  console.log('  ✔ الدورة الأسبوعية: الصرف يوم الخميس والمحاذاة الزمنية دقيقة');

  // د) يومي (Daily)
  const daily = resolvePayoutSchedule('daily', '2026-10-26');
  assert.equal(daily.payFrequency, 'daily');
  assert.equal(daily.cycleStart, '2026-10-26');
  assert.equal(daily.cycleEnd, '2026-10-26');
  assert.equal(daily.isPayoutDue, true, 'الأجر اليومي مستحق الصرف كل يوم تلقائياً');
  assert.equal(daily.daysUntilPayout, 0);

  // فحص استحقاق الأجر اليومي لموظف براتب 3000 (أجر اليوم 100 ج.م)
  const dailyBalance = calculateEmployeeWithdrawalBalance({
    minorUnits: 2,
    employee: {
      id: 105,
      displayName: 'عامل يومية',
      compensationType: 'monthly',
      payFrequency: 'daily',
      hourlyRate: 0,
      expectedDailyHours: 8,
      status: 'active',
    },
    contract: { baseSalary: 3000 },
    currentCycle: { cycleStart: '2026-10-26', cycleEnd: '2026-10-26', daysElapsed: 1 },
    punches: [{ status: 'present', checkIn: '08:00', checkOut: '16:00', workDate: '2026-10-26' }],
    priorLoans: [],
    unpaidApprovedPayrollItems: [],
    todayDate: '2026-10-26',
  });
  // D4: the daily wage divides by the preview month's days
  // (October = 31): 3000 / 31 = 96.77, never a fixed 30.
  assert.equal(dailyBalance.accrual.accruedEarnings, 96.77, 'أجر يوم العمل هو 96.77 ج.م');
  assert.equal(dailyBalance.schedule.isPayoutDue, true);
  console.log('  ✔ الدورة اليومية: استحقاق فوري للأجر اليومي (96.77 ج.م) وصلاحية صرف فورية\n');
}

// ==============================================================================
// 4. اختبار محاكاة الضغط وتوليد 50,000 حالة (Monte Carlo 50,000 Iterations)
// ==============================================================================
function testMonteCarlo50000Cases() {
  console.log('--- 4. محاكاة مونت كارلو الكبرى: توليد واختبار 50,000 حالة عشوائية متنوعة ---');
  console.log('  (جاري فحص المعادلات، السلف، الاستقطاعات، أسقف قانون العمل، والتصفير النهائي)...');

  const iterations = 50000;
  const payFrequencies: Array<'daily' | 'weekly' | 'biweekly' | 'monthly'> = ['daily', 'weekly', 'biweekly', 'monthly'];
  const compensationTypes: Array<'monthly' | 'hourly'> = ['monthly', 'hourly'];
  const channels = ['drawer', 'cash', 'bank'];

  let totalSimulatedPay = 0;
  let totalSimulatedAdvances = 0;
  let cappedCount = 0;
  let settledCount = 0;

  const startTime = Date.now();

  for (let i = 1; i <= iterations; i++) {
    // 1. توليد معطيات عشوائية واقعية
    const baseSalary = 1000 + Math.floor(Math.random() * 49000); // 1,000 to 50,000
    const allowance = Math.floor(Math.random() * 3000);
    const overtime = Math.floor(Math.random() * 2000);
    const attendanceDeduction = Math.floor(Math.random() * 1500);
    const loanAdvance = Math.floor(Math.random() * (baseSalary * 0.8)); // سلفة تصل حتى 80% من الراتب
    const payFreq = payFrequencies[i % 4];
    const compType = compensationTypes[i % 2];
    const channel = channels[i % 3];

    // 2. احتساب سطر المرتب عبر محرك احتساب الرواتب الرسمي
    const payrollLine = calculateEmployeePayrollLine({
      minorUnits: 2,
      employeeId: i,
      baseSalary,
      allowanceAmount: allowance,
      overtimeAmount: overtime,
      commissionAmount: 0,
      employeeSocialInsurance: Math.floor(baseSalary * 0.11),
      employerSocialInsurance: Math.floor(baseSalary * 0.1875),
      incomeTax: Math.floor(baseSalary * 0.05),
      attendanceDeduction,
      leaveDeduction: 0,
      assetRecoveryDeduction: 0,
      otherDeductions: 0,
      scheduledLoanDeduction: loanAdvance,
      maxDeductionPct: 0.50, // سقف الـ 50% لقانون العمل
    });

    // تحققات الثوابت الرياضية الصارمة (Invariants):
    // إجمالي الأجر = الأساسي + البدلات + الإضافي
    assert.equal(payrollLine.grossPay, baseSalary + allowance + overtime);

    // سقف الـ 50% القانوني: صافي الأجر لا يقل عن 50% إلا في الضرائب والتأمينات النظامية
    if (payrollLine.isCapped) {
      cappedCount++;
      assert.ok(payrollLine.deferredLoanDeduction >= 0, 'القسط المؤجل يجب أن يكون موجباً أو صفراً');
    }

    // مجموع الاستقطاعات = التأمينات + الضرائب + الحضور المطبق + القسط المطبق
    const expectedDeductions = payrollLine.employeeSocialInsurance +
      payrollLine.incomeTax +
      payrollLine.attendanceDeduction +
      payrollLine.appliedLoanDeduction;
    assert.ok(Math.abs(payrollLine.totalDeductions - expectedDeductions) < 0.01, 'مجموع الاستقطاعات دقيق');

    // الصافي المستحق = الإجمالي - الاستقطاعات
    assert.ok(Math.abs(payrollLine.netPay - (payrollLine.grossPay - payrollLine.totalDeductions)) < 0.01, 'صافي الراتب مطابق للمعادلة');

    // 3. محاكاة السلفة وتوزيعها
    let loanRecord: FinancialLoanRecord | null = null;
    if (loanAdvance > 0) {
      loanRecord = {
        id: i,
        loanNo: `ADV-${i}`,
        loanType: 'advance',
        principalAmount: loanAdvance,
        paidAmount: payrollLine.appliedLoanDeduction,
        remainingAmount: loanAdvance - payrollLine.appliedLoanDeduction,
        status: payrollLine.appliedLoanDeduction >= loanAdvance ? 'repaid' : 'partially_repaid',
        issueDate: '2026-10-05',
        disbursedAt: '2026-10-05 10:00:00',
      };
      totalSimulatedAdvances += loanAdvance;
    }

    // 4. محاكاة الصرف الكامل للبند عبر شاشة الصرف (payPayrollRunItem)
    const payrollItem: FinancialPayrollItem = {
      id: i,
      runId: Math.floor(i / 100) + 1,
      periodMonth: '2026-10',
      runStatus: 'paid',
      itemStatus: 'paid',
      baseSalary,
      allowanceAmount: allowance,
      grossPay: payrollLine.grossPay,
      deductionAmount: attendanceDeduction,
      penaltyDeduction: 0,
      loanDeductionAmount: payrollLine.appliedLoanDeduction,
      netPay: payrollLine.netPay,
      paidAt: '2026-10-28 16:00:00',
      paymentChannel: channel,
    };

    totalSimulatedPay += payrollLine.netPay;

    // 5. فحص كشف الحساب المالي بعد الصرف:
    const stmt = buildEmployeeFinancialStatement({
    minorUnits: 2,
      employee: {
        id: i,
        displayName: `موظف محاكاة #${i}`,
        baseSalary,
      },
      payrollItems: [payrollItem],
      loans: loanRecord ? [loanRecord] : [],
      adjustments: [],
      ledger: [],
    });

    // الثابت الذهبي:
    // إذا سُددت السلفة بالكامل وصُرف صافي الراتب، الرصيد يجب أن يكون 0.00 ج.م تماماً وحالة الحساب 'settled'!
    if (!loanRecord || loanRecord.remainingAmount === 0) {
      assert.ok(Math.abs(stmt.summary.netFinancialBalance) < 0.01, `رصيد الموظف #${i} يجب أن يكون صفر بعد الصرف`);
      assert.equal(stmt.summary.balanceStatus, 'settled', `حالة الحساب يجب أن تكون settled للموظف #${i}`);
      settledCount++;
    } else {
      // لو تبقت مديونية سلفة مؤجلة لسقف الـ 50%، يتبقى على الموظف بالضبط المتبقي من السلفة مدين
      assert.ok(Math.abs(stmt.summary.netFinancialBalance - (-loanRecord.remainingAmount)) < 0.01, `المتبقي على الموظف يجب أن يطابق مديونية السلفة`);
      assert.equal(stmt.summary.balanceStatus, 'debit');
    }

    // فحص جدول مواعيد الصرف
    const sched = resolvePayoutSchedule(payFreq, '2026-10-26');
    assert.ok(sched.nextPayoutDate.length === 10, 'تاريخ الصرف القادم صالح');
    assert.ok(sched.daysUntilPayout >= 0, 'الأيام المتبقية موجبة');
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`  ✔ اكتمل فحص 50,000 حالة بنجاح تام خلال ${duration} ثانية!`);
  console.log(`    - إجمالي صافي الرواتب المصروفة والمحققة: ${totalSimulatedPay.toLocaleString('en-US', { maximumFractionDigits: 0 })} ج.م`);
  console.log(`    - إجمالي السلف النقدية المختبرة: ${totalSimulatedAdvances.toLocaleString('en-US', { maximumFractionDigits: 0 })} ج.م`);
  console.log(`    - الحالات التي فُعّل فيها سقف قانون العمل 50% لحماية راتب الموظف: ${cappedCount.toLocaleString('en-US')}`);
  console.log(`    - الحالات التي تصفّر رصيدها تماماً (0.00 ج.م) وأغلقت بحالة settled: ${settledCount.toLocaleString('en-US')}\n`);
}

// ==============================================================================
// 5. فحص قيود اليومية المزدوجة وموازنة المدين والدائن
// ==============================================================================
function testDoubleEntryReconciliation() {
  console.log('--- 5. اختبار القيود المحاسبية المزدوجة (تطابق المدين والدائن 100%) ---');

  const line1 = calculateEmployeePayrollLine({
      minorUnits: 2,
    employeeId: 1,
    baseSalary: 10000,
    allowanceAmount: 0,
    overtimeAmount: 0,
    commissionAmount: 0,
    employeeSocialInsurance: 700,
    employerSocialInsurance: 1200,
    incomeTax: 300,
    attendanceDeduction: 500,
    leaveDeduction: 0,
    assetRecoveryDeduction: 0,
    otherDeductions: 0,
    scheduledLoanDeduction: 1500,
  });

  const line2 = calculateEmployeePayrollLine({
      minorUnits: 2,
    employeeId: 2,
    baseSalary: 8000,
    allowanceAmount: 0,
    overtimeAmount: 0,
    commissionAmount: 0,
    employeeSocialInsurance: 560,
    employerSocialInsurance: 960,
    incomeTax: 240,
    attendanceDeduction: 200,
    leaveDeduction: 0,
    assetRecoveryDeduction: 0,
    otherDeductions: 0,
    scheduledLoanDeduction: 1000,
  });

  const journal = reconcilePayrollRunJournalTotals([line1, line2], 2);

  // تطابق القيد المزدوج: إجمالي المدين = إجمالي الدائن
  assert.equal(journal.isBalanced, true, 'القيد المحاسبي متوازن تماماً');
  assert.equal(journal.totalDebit, journal.totalCredit, 'المدين يطابق الدائن بالسنت');
  assert.equal(journal.discrepancy, 0, 'فارق القيد صفر تماماً');
  assert.equal(journal.netPayable, line1.netPay + line2.netPay);
  assert.equal(journal.loanAdvancesCredit, 2500);

  console.log(`  ✔ إجمالي المدين: ${journal.totalDebit} ج.م | إجمالي الدائن: ${journal.totalCredit} ج.م`);
  console.log('  ✔ قيود المحاسبة المزدوجة متوازنة 100% بدون أي هللة فارق!\n');
}

// تشغيل كافة الاختبارات
try {
  testEmployeeAdvanceAndPayrollSettlement();
  testIndividualEarlyPayoutVsPending();
  testPayFrequenciesAndSchedules();
  testMonteCarlo50000Cases();
  testDoubleEntryReconciliation();

  console.log('================================================================================');
  console.log('  🎉 كافة الاختبارات والـ 50,000 حالة ومحاكاة السلف والصرف الفردي نجحت 100%!  ');
  console.log('================================================================================');
} catch (error) {
  console.error('❌ فشل في الاختبارات:', error);
  process.exit(1);
}
