import { summarizeHourlyAttendance, prorateMonthlyWage, WorkPunch } from './hourly-attendance-pay.engine';
import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export interface EmployeeWithdrawalContext {
  employee: {
    id: number;
    employeeNo?: string;
    displayName: string;
    compensationType: 'hourly' | 'monthly';
    payFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    hourlyRate: number;
    expectedDailyHours: number;
    hireDate?: string;
    status: string;
  };
  contract?: {
    baseSalary: number;
    currency?: string;
  };
  activePayrollItem?: {
    id: number;
    runId: number;
    periodMonth?: string;
    runStatus: string; // 'draft' | 'reviewed' | 'approved' | 'partially_paid'
    itemStatus?: string; // 'draft' | 'reviewed' | 'approved' | 'paid'
    baseSalary: number;
    allowanceAmount: number;
    grossPay: number;
    deductionAmount: number;
    loanDeductionAmount: number;
    netPay: number;
  };
  currentCycle: {
    cycleStart: string; // YYYY-MM-DD
    cycleEnd: string;   // YYYY-MM-DD
    daysElapsed: number;
  };
  punches: WorkPunch[];
  priorLoans: Array<{
    id: number;
    loanType: string;
    principalAmount: number;
    remainingAmount: number;
    issueDate: string;
    status: string;
  }>;
  unpaidApprovedPayrollItems: Array<{
    id: number;
    netPay: number;
    grossPay: number;
  }>;
  todayDate: string;
  /** Tenant book digits (REQUIRED): preview money is rounded at book precision, never a silent 2dp. */
  minorUnits: MoneyDigits;
}

export interface EmployeeWithdrawalBalanceResult {
  employee: {
    id: number;
    employeeNo?: string;
    displayName: string;
    compensationType: 'hourly' | 'monthly';
    payFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    hourlyRate: number;
    baseSalary: number;
  };
  cycle: {
    cycleStart: string;
    cycleEnd: string;
    daysElapsed: number;
    totalDays: number;
  };
  schedule: {
    payFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    cycleStart: string;
    cycleEnd: string;
    nextPayoutDate: string;
    isPayoutDue: boolean;
    daysUntilPayout: number;
    dueStatusText: string;
  };
  accrual: {
    workedHours: number;
    completedDays: number;
    hourlyRate: number;
    baseSalary: number;
    accruedEarnings: number;
    calculationText: string;
    source: 'payroll_item' | 'attendance_records' | 'contract_prorated';
    isProrated: boolean;
  };
  deductions: {
    currentCycleWithdrawals: number;
    priorOutstandingDebt: number;
    totalDebt: number;
    activeLoanCount: number;
  };
  unpaidApprovedPayroll: number;
  netAvailableBalance: number;
  balanceStatus: 'credit' | 'debit' | 'settled';
  maxDirectAdvance: number;
  directAdvanceCeilingPct: number;
  directAdvanceCashCap: number;
  canDisburseDirectly: boolean;
  maxDirectDisbursement: number;
}

function roundHours(val: number): number {
  // Hours are a quantity, not money: 2dp is the unit of hours, not book digits.
  return Number((Math.round(Number(val + 'e+2')) + 'e-2'));
}

export function calculateEmployeeWithdrawalBalance(ctx: EmployeeWithdrawalContext): EmployeeWithdrawalBalanceResult {
  const minorUnits = ctx.minorUnits;
  // Settled band is half a minor unit: at 3dp a 0.004 balance is a credit, not settled.
  const halfMinor = 1 / (2 * (10 ** minorUnits));
  const isHourly = ctx.employee.compensationType === 'hourly';
  const payFreq = ctx.employee.payFrequency || 'monthly';
  const baseSalary = Number(ctx.contract?.baseSalary || 0);
  const hourlyRate = Number(ctx.employee.hourlyRate || 0);

  const schedule = resolvePayoutSchedule(
    payFreq,
    ctx.todayDate || ctx.currentCycle.cycleEnd,
    ctx.currentCycle.cycleEnd
  );

  const cycleStart = schedule.cycleStart || ctx.currentCycle.cycleStart;
  const cycleEnd = schedule.cycleEnd || ctx.currentCycle.cycleEnd;
  const cycleStartMs = new Date(cycleStart + 'T00:00:00Z').getTime();
  const cycleEndMs = new Date(cycleEnd + 'T00:00:00Z').getTime();
  const totalCycleDays = Math.max(1, Math.round((cycleEndMs - cycleStartMs) / 86400000) + 1);
  const todayMs = new Date((ctx.todayDate || cycleStart) + 'T00:00:00Z').getTime();
  const daysElapsed = Math.min(totalCycleDays, Math.max(1, Math.round((todayMs - cycleStartMs) / 86400000) + 1));

  let workedHours = 0;
  let completedDays = 0;
  let accruedEarnings = 0;
  let calculationText = '';
  let accrualSource: 'payroll_item' | 'attendance_records' | 'contract_prorated' = 'contract_prorated';
  let isProrated = false;

  // 1. Accrual Calculation
  if (isHourly) {
    accrualSource = 'attendance_records';
    const work = summarizeHourlyAttendance(ctx.punches, hourlyRate, minorUnits);
    workedHours = roundHours(work.workedMinutes / 60);
    completedDays = work.completedDays;
    accruedEarnings = roundMoney(work.baseWage, minorUnits);
    calculationText = `${workedHours} س عمل × ${hourlyRate} ج.م/س`;
    isProrated = false;
  } else if (payFreq === 'daily') {
    accrualSource = 'attendance_records';
    const presentRecords = ctx.punches.filter(p => String(p.status || '').toLowerCase() === 'present');
    completedDays = presentRecords.length > 0 ? presentRecords.length : Math.max(1, daysElapsed);
    const dailyWage = baseSalary > 0 ? roundMoney(baseSalary / 30, minorUnits) : 0;
    accruedEarnings = roundMoney(completedDays * dailyWage, minorUnits);
    calculationText = `${completedDays} يوم استحقاق × ${dailyWage} ج.م/يوم`;
    isProrated = false;
  } else if (ctx.activePayrollItem) {
    accrualSource = 'payroll_item';
    const item = ctx.activePayrollItem;
    // Gross pay minus attendance deductions (before loan deduction)
    const rawEarned = roundMoney(Number(item.grossPay || item.baseSalary || 0) - Number(item.deductionAmount || 0), minorUnits);
    const fullCyclePay = rawEarned > 0 ? rawEarned : roundMoney(Number(item.netPay || 0) + Number(item.loanDeductionAmount || 0), minorUnits);
    const normalizedFullPay = fullCyclePay > 0 ? fullCyclePay : roundMoney(Number(item.baseSalary || 0), minorUnits);

    // If employee item was already disbursed/paid, cycle accrual is fully settled
    if (item.itemStatus === 'paid') {
      accruedEarnings = 0;
      completedDays = totalCycleDays;
      calculationText = `تم صرف وقبض راتب هذه الدورة بالكامل (${item.periodMonth || 'مكتمل'})`;
      isProrated = false;
    } else if (['approved', 'partially_paid'].includes(item.runStatus) && (ctx.todayDate || '') >= cycleEnd) {
      // If payroll run is approved and cycle period has fully ended: full earnings are recognized
      accruedEarnings = normalizedFullPay;
      completedDays = totalCycleDays;
      calculationText = `استحقاق كشف رواتب معتمد (${item.periodMonth || 'مكتمل'})`;
      isProrated = false;
    } else {
      // In-progress cycle or draft/reviewed run: strictly prorate by elapsed days in cycle!
      const prorationFactor = Math.min(1, Math.max(0, daysElapsed / totalCycleDays));
      accruedEarnings = roundMoney(normalizedFullPay * prorationFactor, minorUnits);
      completedDays = daysElapsed;
      calculationText = `استحقاق نسبي (${daysElapsed} من ${totalCycleDays} يوم) - مسودة كشف الرواتب`;
      isProrated = true;
    }
  } else {
    accrualSource = 'contract_prorated';
    accruedEarnings = roundMoney(prorateMonthlyWage(baseSalary, cycleStart, ctx.todayDate, minorUnits), minorUnits);
    completedDays = daysElapsed;
    calculationText = `استحقاق نسبي عن ${completedDays} يوم (من راتب ${baseSalary} ج.م)`;
    isProrated = true;
  }

  // 2. Calculate prior loans & advances
  let currentCycleWithdrawals = 0;
  let priorOutstandingDebt = 0;
  let activeLoanCount = 0;

  for (const loan of ctx.priorLoans) {
    const st = String(loan.status || '');
    if (!['paid', 'partially_repaid', 'disbursed'].includes(st)) continue;
    const remaining = roundMoney(Number(loan.remainingAmount || 0), minorUnits);
    if (remaining <= 0) continue;

    activeLoanCount++;
    const issue = String(loan.issueDate || '').slice(0, 10);
    const isAdvance = loan.loanType === 'advance';

    if (isAdvance && issue >= cycleStart) {
      currentCycleWithdrawals = roundMoney(currentCycleWithdrawals + remaining, minorUnits);
    } else {
      priorOutstandingDebt = roundMoney(priorOutstandingDebt + remaining, minorUnits);
    }
  }

  const totalDebt = roundMoney(currentCycleWithdrawals + priorOutstandingDebt, minorUnits);

  // 3. Unpaid past approved payroll items (if any prior run approved and not paid)
  let unpaidApprovedPayroll = 0;
  for (const item of ctx.unpaidApprovedPayrollItems) {
    // If activePayrollItem is already counted, do not duplicate
    if (ctx.activePayrollItem && Number(item.id) === Number(ctx.activePayrollItem.id)) continue;
    unpaidApprovedPayroll = roundMoney(unpaidApprovedPayroll + Number(item.netPay || 0), minorUnits);
  }

  // 4. Net Available Balance: (Accrued + Unpaid Payroll) - Total Debt
  const netAvailableBalance = roundMoney((unpaidApprovedPayroll + accruedEarnings) - totalDebt, minorUnits);

  let balanceStatus: 'credit' | 'debit' | 'settled' = 'settled';
  if (netAvailableBalance > halfMinor) {
    balanceStatus = 'credit';
  } else if (netAvailableBalance < -halfMinor) {
    balanceStatus = 'debit';
  }

  // 5. Governance Ceilings: Direct Cashier Advance Cap (50% max of net available, capped at 2,000 EGP)
  const directAdvanceCeilingPct = 50;
  const directAdvanceCashCap = 2000;
  const maxDirectAdvance = netAvailableBalance > halfMinor
    ? roundMoney(Math.min(directAdvanceCashCap, netAvailableBalance * (directAdvanceCeilingPct / 100)), minorUnits)
    : 0;

  return {
    employee: {
      id: ctx.employee.id,
      employeeNo: ctx.employee.employeeNo,
      displayName: ctx.employee.displayName,
      compensationType: ctx.employee.compensationType,
      payFrequency: ctx.employee.payFrequency,
      hourlyRate,
      baseSalary,
    },
    cycle: {
      cycleStart,
      cycleEnd,
      daysElapsed,
      totalDays: totalCycleDays,
    },
    schedule,
    accrual: {
      workedHours,
      completedDays,
      hourlyRate,
      baseSalary,
      accruedEarnings,
      calculationText,
      source: accrualSource,
      isProrated,
    },
    deductions: {
      currentCycleWithdrawals,
      priorOutstandingDebt,
      totalDebt,
      activeLoanCount,
    },
    unpaidApprovedPayroll,
    netAvailableBalance,
    balanceStatus,
    maxDirectAdvance,
    directAdvanceCeilingPct,
    directAdvanceCashCap,
    canDisburseDirectly: maxDirectAdvance > halfMinor,
    maxDirectDisbursement: maxDirectAdvance,
  };
}

export interface PayoutScheduleResult {
  payFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  cycleStart: string;
  cycleEnd: string;
  nextPayoutDate: string;
  isPayoutDue: boolean;
  daysUntilPayout: number;
  dueStatusText: string;
}

export function resolvePayoutSchedule(
  payFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly',
  todayStr: string,
  payrollPeriodEnd?: string
): PayoutScheduleResult {
  const parts = todayStr.split('-').map(Number);
  const year = parts[0] || new Date().getUTCFullYear();
  const month = parts[1] || 1;
  const day = parts[2] || 1;

  const fmt = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (payFrequency === 'daily') {
    return {
      payFrequency: 'daily',
      cycleStart: todayStr,
      cycleEnd: todayStr,
      nextPayoutDate: todayStr,
      isPayoutDue: true,
      daysUntilPayout: 0,
      dueStatusText: 'مستحق للصرف اليوم (أجر يومي)',
    };
  }

  if (payFrequency === 'biweekly') {
    if (day <= 15) {
      const cycleStart = fmt(year, month, 1);
      const cycleEnd = fmt(year, month, 15);
      const nextPayoutDate = cycleEnd;
      const isPayoutDue = day === 15;
      const daysUntilPayout = 15 - day;
      return {
        payFrequency: 'biweekly',
        cycleStart,
        cycleEnd,
        nextPayoutDate,
        isPayoutDue,
        daysUntilPayout,
        dueStatusText: isPayoutDue
          ? 'مستحق للصرف اليوم (نهاية دورة النصف الأول)'
          : `موعد القبض القادم: ${nextPayoutDate} (متبقي ${daysUntilPayout} يوم على نهاية الدورة)`,
      };
    } else {
      const cycleStart = fmt(year, month, 16);
      const cycleEnd = fmt(year, month, lastDayOfMonth);
      const nextPayoutDate = cycleEnd;
      const isPayoutDue = day >= lastDayOfMonth - 1;
      const daysUntilPayout = Math.max(0, lastDayOfMonth - day);
      return {
        payFrequency: 'biweekly',
        cycleStart,
        cycleEnd,
        nextPayoutDate,
        isPayoutDue,
        daysUntilPayout,
        dueStatusText: isPayoutDue
          ? 'مستحق للصرف اليوم (نهاية دورة النصف الثاني)'
          : `موعد القبض القادم: ${nextPayoutDate} (متبقي ${daysUntilPayout} يوم على نهاية الدورة)`,
      };
    }
  }

  if (payFrequency === 'weekly') {
    const dateObj = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = dateObj.getUTCDay(); // 4 = Thu, 5 = Fri
    const isPayoutDue = dayOfWeek === 4 || dayOfWeek === 5;
    const daysUntilThu = (4 - dayOfWeek + 7) % 7;
    const daysUntilPayout = isPayoutDue ? 0 : (daysUntilThu === 0 ? 7 : daysUntilThu);
    const nextDateObj = new Date(dateObj.getTime() + daysUntilPayout * 86400000);
    const nextPayoutDate = fmt(nextDateObj.getUTCFullYear(), nextDateObj.getUTCMonth() + 1, nextDateObj.getUTCDate());

    const daysSinceSat = (dayOfWeek - 6 + 7) % 7;
    const startDateObj = new Date(dateObj.getTime() - daysSinceSat * 86400000);
    const cycleStart = fmt(startDateObj.getUTCFullYear(), startDateObj.getUTCMonth() + 1, startDateObj.getUTCDate());
    const cycleEnd = nextPayoutDate;

    return {
      payFrequency: 'weekly',
      cycleStart,
      cycleEnd,
      nextPayoutDate,
      isPayoutDue,
      daysUntilPayout,
      dueStatusText: isPayoutDue
        ? 'مستحق للصرف اليوم (موعد الصرف الأسبوعي)'
        : `موعد القبض القادم: يوم الخميس ${nextPayoutDate} (متبقي ${daysUntilPayout} يوم على نهاية الأسبوع)`,
    };
  }

  // Monthly
  const cycleStart = fmt(year, month, 1);
  const cycleEnd = payrollPeriodEnd && payrollPeriodEnd.slice(0, 7) === todayStr.slice(0, 7)
    ? payrollPeriodEnd
    : fmt(year, month, lastDayOfMonth);
  const nextPayoutDate = cycleEnd;
  const isPayoutDue = todayStr >= cycleEnd || day >= lastDayOfMonth - 1;
  const daysUntilPayout = Math.max(0, lastDayOfMonth - day);

  return {
    payFrequency: 'monthly',
    cycleStart,
    cycleEnd,
    nextPayoutDate,
    isPayoutDue,
    daysUntilPayout,
    dueStatusText: isPayoutDue
      ? 'مستحق للصرف اليوم (نهاية دورة الشهر)'
      : `موعد القبض القادم: ${nextPayoutDate} (متبقي ${daysUntilPayout} يوم على نهاية الشهر)`,
  };
}

function moneyText(val: number): string {
  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
}
