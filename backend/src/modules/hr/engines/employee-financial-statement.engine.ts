/**
 * محرك كشف الحساب والسجل المالي الموحد للموظف (Employee Financial Statement & Running Ledger Engine)
 *
 * يجمع كافة الحركات المالية للموظف في واجهة واحدة:
 * 1. المسحوبات النقدية والسلف السريعة من الكاشير أو الخزينة.
 * 2. المقبوضات الفعلية من المرتبات (القبض).
 * 3. الاستحقاقات الإجمالية (الراتب الأساسي، البدلات، الإضافي).
 * 4. الجزاءات والخصومات والتسويات الإدارية.
 * 5. سدادات السلف وخصوماتها من مسير الرواتب.
 * 6. احتساب الرصيد التراكمي (Running Balance) والمركز المالي (دائن / مدين / خالص).
 */

import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';


export interface EmployeeFinancialProfile {
  id: number | string;
  employeeNo?: string;
  displayName: string;
  hireDate?: string;
  status?: string;
  compensationType?: string;
  hourlyRate?: number;
  baseSalary?: number;
  departmentName?: string;
  jobTitleName?: string;
}

export interface FinancialPayrollItem {
  id: number | string;
  runId: number | string;
  periodMonth: string;
  runStatus: string; // 'draft' | 'approved' | 'paid'
  baseSalary: number;
  allowanceAmount: number;
  grossPay: number;
  deductionAmount: number;
  penaltyDeduction: number;
  loanDeductionAmount: number;
  netPay: number;
  itemStatus?: string; // 'draft' | 'approved' | 'excluded'
  paidAt?: string;
  paymentChannel?: string;
  paidByName?: string;
}

export interface FinancialLoanRecord {
  id: number | string;
  loanNo?: string;
  loanType: string; // 'advance' | 'loan'
  principalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string; // 'draft' | 'approved' | 'paid' | 'partially_repaid' | 'repaid'
  notes?: string;
  repaymentMode?: string;
  issueDate?: string;
  disbursedAt?: string;
  createdAt?: string;
  createdByName?: string;
}

export interface FinancialAdjustmentRecord {
  id: number | string;
  adjustmentType: string; // 'deduction' | 'allowance'
  amountType?: string;
  amount: number;
  date: string;
  reason?: string;
  status: string; // 'pending' | 'applied'
  appliedInRunId?: number | null;
  createdByName?: string;
}

export interface FinancialLedgerRecord {
  id: number | string;
  entryType: string; // 'loan_disbursement' | 'loan_repayment'
  amount: number;
  balanceAfter: number;
  note?: string;
  repaymentMethod?: string;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
  createdByName?: string;
}

export interface StatementFilter {
  from?: string;
  to?: string;
  month?: string;
}

export interface UnifiedTransaction {
  id: string;
  date: string;
  timestamp: string;
  category: 'withdrawal' | 'salary_entitlement' | 'salary_payout' | 'loan_repayment' | 'penalty' | 'allowance';
  typeLabel: string;
  description: string;
  referenceNo?: string;
  referenceType: string;
  referenceId: string;
  actorName: string;
  channel?: string;
  debit: number;   // مدين (أخذه الموظف أو مديونية عليه: مسحوب كاشير، قبض راتب، جزاء)
  credit: number;  // دائن (استحقاق للموظف: استحقاق راتب، بدل، أو سداد سلفة نقدي يقلل دينه)
  runningBalance: number;
}

export interface MonthlyBreakdownItem {
  month: string;
  grossSalary: number;
  paidSalary: number;
  withdrawals: number;
  repayments: number;
  penalties: number;
  netMonth: number;
}

export interface StatementSummary {
  totalGrossEarnings: number;     // إجمالي الاستحقاقات (الرواتب المعتمدة والبدلات)
  totalPaidSalaries: number;      // إجمالي ما تم قبضه واستلامه فعلياً من المرتبات
  totalWithdrawals: number;       // إجمالي المسحوبات والسلف النقدية
  totalRepayments: number;         // إجمالي سدادات السلف (نقداً أو خصماً من المسير)
  remainingLoanDebt: number;      // مديونية السلف المتبقية على الموظف حالياً
  totalPenalties: number;         // إجمالي الجزاءات والخصومات الإدارية
  totalAllowances: number;        // إجمالي البدلات والمكافآت الإضافية
  netFinancialBalance: number;    // صافي الحساب النهائي للموظف (دائن / مدين)
  balanceStatus: 'credit' | 'debit' | 'settled'; // 'credit' = له مستحقات، 'debit' = عليه مديونية
}

export interface FinancialStatementResult {
  employee: EmployeeFinancialProfile;
  summary: StatementSummary;
  transactions: UnifiedTransaction[];
  monthlyBreakdown: MonthlyBreakdownItem[];
}

export function buildEmployeeFinancialStatement(params: {
  employee: EmployeeFinancialProfile;
  payrollItems: FinancialPayrollItem[];
  loans: FinancialLoanRecord[];
  adjustments: FinancialAdjustmentRecord[];
  ledger: FinancialLedgerRecord[];
  filter?: StatementFilter;
  /** Tenant book digits (REQUIRED): statement money is rounded at book precision, never a silent 2dp. */
  minorUnits: MoneyDigits;
}): FinancialStatementResult {
  const { employee, payrollItems, loans, adjustments, ledger, filter, minorUnits } = params;
  // Settled band is half a minor unit: at 3dp a 0.004 remainder is a credit, not settled.
  const halfMinor = 1 / (2 * (10 ** minorUnits));

  const rawTxns: Array<{
    id: string;
    date: string;
    timestamp: string;
    category: UnifiedTransaction['category'];
    typeLabel: string;
    description: string;
    referenceNo?: string;
    referenceType: string;
    referenceId: string;
    actorName: string;
    channel?: string;
    debit: number;
    credit: number;
  }> = [];

  // 1. Process Loans / Advances (Withdrawals from Cashier Shifts or Treasury)
  for (const loan of loans) {
    if (loan.status === 'cancelled' || loan.status === 'rejected') continue;
    const isDisbursed = ['paid', 'partially_repaid', 'repaid', 'disbursed'].includes(loan.status);
    // Approved but undisbursed loans are commitments, not employee cash withdrawals.
    if (!isDisbursed) continue;

    const date = (loan.disbursedAt || loan.createdAt || loan.issueDate || '').slice(0, 10);
    const timestamp = loan.disbursedAt || loan.createdAt || (date ? `${date} 00:00` : new Date().toISOString());
    const isAdvance = loan.loanType === 'advance';

    rawTxns.push({
      id: `loan-${loan.id}`,
      date: date || '1970-01-01',
      timestamp,
      category: 'withdrawal',
      typeLabel: isAdvance ? 'سلفة نقدية / مسحوب' : 'قرض موظف',
      description: loan.notes || (isAdvance ? `سلفة نقدية #${loan.loanNo || loan.id}` : `قرض #${loan.loanNo || loan.id}`),
      referenceNo: loan.loanNo ? String(loan.loanNo) : undefined,
      referenceType: 'hr_employee_loan',
      referenceId: String(loan.id),
      actorName: loan.createdByName || '',
      channel: loan.notes?.includes('وردية كاشير') ? 'وردية كاشير' : 'خزينة / بنك',
      debit: roundMoney(Number(loan.principalAmount || 0), minorUnits),
      credit: 0,
    });
  }

  // 2. Process Manual Cash Loan Repayments from Ledger
  for (const entry of ledger) {
    if (entry.entryType === 'loan_repayment' && entry.repaymentMethod === 'manual_cash') {
      const date = (entry.createdAt || '').slice(0, 10);
      const timestamp = entry.createdAt || (date ? `${date} 00:00` : new Date().toISOString());
      const amount = Math.abs(Number(entry.amount || 0));

      rawTxns.push({
        id: `repay-${entry.id}`,
        date: date || '1970-01-01',
        timestamp,
        category: 'loan_repayment',
        typeLabel: 'سداد سلفة نقدي',
        description: entry.note || 'سداد نقدي لحساب السلفة',
        referenceType: 'hr_employee_ledger',
        referenceId: String(entry.id),
        actorName: entry.createdByName || '',
        channel: 'نقدية',
        debit: 0,
        credit: roundMoney(amount, minorUnits),
      });
    }
  }

  // 3. Process Payroll Items (Gross Entitlements + Actual Payouts)
  for (const item of payrollItems) {
    if (item.runStatus === 'cancelled' || item.itemStatus === 'excluded') continue;

    const isItemPaid = item.itemStatus === 'paid' || item.runStatus === 'paid';
    const isRunApprovedOrPaid = ['approved', 'partially_paid', 'paid'].includes(item.runStatus) || isItemPaid;
    if (!isRunApprovedOrPaid) continue;

    const monthStr = item.periodMonth || '';
    const defaultDate = `${monthStr}-28`;
    const payoutDate = (item.paidAt || '').slice(0, 10);
    const entitlementDate = payoutDate && payoutDate < defaultDate ? payoutDate : defaultDate;
    const grossTimestamp = payoutDate && payoutDate < defaultDate
      ? `${payoutDate} 08:00`
      : `${defaultDate} 10:00`;
    const netTimestamp = item.paidAt || `${defaultDate} 12:00`;

    // 3.A Gross Earnings (Credit - استحقاق الراتب)
    const grossPay = roundMoney(Number(item.grossPay || 0), minorUnits);
    // A loan withheld from payroll offsets the employee's existing advance,
    // but tax/insurance, attendance reductions and asset recoveries are NOT
    // liabilities owed to the employee. Their gross amount is informational.
    const employeeEntitlement = roundMoney(Number(item.netPay || 0) + Number(item.loanDeductionAmount || 0), minorUnits);
    if (employeeEntitlement < 0 || employeeEntitlement > grossPay + halfMinor) {
      throw new RangeError('Employee payroll settlement exceeds gross accrued wage');
    }
    if (grossPay > 0) {
      rawTxns.push({
        id: `payroll-gross-${item.id}`,
        date: entitlementDate,
        timestamp: grossTimestamp,
        category: 'salary_entitlement',
        typeLabel: `استحقاق راتب شهر ${monthStr}`,
        description: `إجمالي المرتب: ${grossPay} | صافٍ مستحق نقديًا: ${roundMoney(item.netPay, minorUnits)} | سلفة مقاصة: ${roundMoney(item.loanDeductionAmount, minorUnits)}`,
        referenceType: 'hr_payroll_run_item',
        referenceId: String(item.id),
        actorName: item.paidByName || '',
        channel: item.paymentChannel || 'مسير رواتب',
        debit: 0,
        credit: employeeEntitlement,
      });
    }

    // 3.B Salary Actual Payout (Debit - قبض المرتب الفعلي)
    if (isItemPaid) {
      const netPay = roundMoney(Number(item.netPay || 0), minorUnits);
      if (netPay > 0) {
        rawTxns.push({
          id: `payroll-net-${item.id}`,
          date: payoutDate || defaultDate,
          timestamp: netTimestamp,
          category: 'salary_payout',
          typeLabel: `صرف وقبض صافي راتب شهر ${monthStr}`,
          description: `الصافي المقبوض بعد الخصومات والسلف (${netPay}) - قناة الصرف: ${item.paymentChannel || 'نقدية'}`,
          referenceType: 'hr_payroll_run_item',
          referenceId: String(item.id),
          actorName: item.paidByName || '',
          channel: item.paymentChannel || 'نقدية',
          debit: netPay,
          credit: 0,
        });
      }
    }
  }

  // 4. Administrative adjustments are provisional until posted via a payroll.
  // When already applied to a posted payroll, the amount is inside its
  // financial snapshot; never duplicate it as a second debit/credit.
  for (const adj of adjustments) {
    if (adj.status === 'cancelled') continue;
    const date = (adj.date || '').slice(0, 10);
    const timestamp = date ? `${date} 11:00` : new Date().toISOString();
    const amount = roundMoney(Number(adj.amount || 0), minorUnits);

    // If applied in an approved/paid run, it's already accounted in grossPay or deductions,
    // so we label it as unapplied or applied. For unapplied adjustments:
    if (adj.adjustmentType === 'deduction') {
      rawTxns.push({
        id: `adj-${adj.id}`,
        date: date || '1970-01-01',
        timestamp,
        category: 'penalty',
        typeLabel: 'جزاء / خصم إداري',
        description: `${adj.reason || 'خصم إداري'} — ${adj.status === 'applied' ? 'محتسب ضمن المسير' : 'تسوية غير مرحلة'} (${amount})`,
        referenceType: 'hr_employee_adjustment',
        referenceId: String(adj.id),
        actorName: adj.createdByName || '',
        debit: 0,
        credit: 0,
      });
    } else if (adj.adjustmentType === 'allowance') {
      rawTxns.push({
        id: `adj-${adj.id}`,
        date: date || '1970-01-01',
        timestamp,
        category: 'allowance',
        typeLabel: 'مكافأة / بدل إضافي',
        description: `${adj.reason || 'بدل إضافي'} — ${adj.status === 'applied' ? 'محتسب ضمن المسير' : 'تسوية غير مرحلة'} (${amount})`,
        referenceType: 'hr_employee_adjustment',
        referenceId: String(adj.id),
        actorName: adj.createdByName || '',
        debit: 0,
        credit: 0,
      });
    }
  }

  // 5. Sort Chronologically (Oldest to Newest) to calculate accurate Running Balance
  rawTxns.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.timestamp.localeCompare(b.timestamp);
  });

  let running = 0;
  const transactionsWithBalance: UnifiedTransaction[] = rawTxns.map((tx) => {
    // Balance formula: Credit (له / استحقاق) - Debit (عليه / مسحوب وقبض)
    running = roundMoney(running + tx.credit - tx.debit, minorUnits);
    return {
      ...tx,
      runningBalance: running,
    };
  });

  // Calculate Global Totals
  const totalGrossEarnings = roundMoney(
    payrollItems
      .filter((i) => (['approved', 'partially_paid', 'paid'].includes(i.runStatus) || i.itemStatus === 'paid') && i.itemStatus !== 'excluded')
      .reduce((sum, i) => sum + Number(i.grossPay || 0), 0)
  , minorUnits);

  const totalPaidSalaries = roundMoney(
    payrollItems
      .filter((i) => (i.itemStatus === 'paid' || i.runStatus === 'paid') && i.itemStatus !== 'excluded')
      .reduce((sum, i) => sum + Number(i.netPay || 0), 0)
  , minorUnits);

  const totalWithdrawals = roundMoney(
    loans
      .filter((l) => ['paid', 'partially_repaid', 'repaid', 'disbursed'].includes(l.status))
      .reduce((sum, l) => sum + Number(l.principalAmount || 0), 0)
  , minorUnits);

  const totalRepayments = roundMoney(
    loans
      .filter((l) => ['paid', 'partially_repaid', 'repaid', 'disbursed'].includes(l.status))
      .reduce((sum, l) => sum + Number(l.paidAmount || 0), 0)
  , minorUnits);

  const remainingLoanDebt = roundMoney(
    loans
      .filter((l) => ['paid', 'partially_repaid', 'disbursed'].includes(l.status))
      .reduce((sum, l) => sum + Number(l.remainingAmount || 0), 0)
  , minorUnits);

  const totalPenalties = roundMoney(
    payrollItems
      .filter((i) => ['approved', 'paid'].includes(i.runStatus) && i.itemStatus !== 'excluded')
      .reduce((sum, i) => sum + Number(i.penaltyDeduction || 0), 0)
  , minorUnits);

  const totalAllowances = roundMoney(
    payrollItems
      .filter((i) => ['approved', 'paid'].includes(i.runStatus) && i.itemStatus !== 'excluded')
      .reduce((sum, i) => sum + Number(i.allowanceAmount || 0), 0)
  , minorUnits);

  // Net Balance: Total Gross - Total Paid - Remaining Debt - Unapplied Penalties
  // If positive: Company owes employee (Credit)
  // If negative: Employee owes company (Debit / Over-withdrawn)
  const netFinancialBalance = running;
  let balanceStatus: 'credit' | 'debit' | 'settled' = 'settled';
  if (netFinancialBalance > halfMinor) {
    balanceStatus = 'credit';
  } else if (netFinancialBalance < -halfMinor) {
    balanceStatus = 'debit';
  }

  const summary: StatementSummary = {
    totalGrossEarnings,
    totalPaidSalaries,
    totalWithdrawals,
    totalRepayments,
    remainingLoanDebt,
    totalPenalties,
    totalAllowances,
    netFinancialBalance,
    balanceStatus,
  };

  // Build Monthly Breakdown
  const monthsSet = new Set<string>();
  for (const item of payrollItems) {
    if (item.periodMonth) monthsSet.add(item.periodMonth);
  }
  for (const loan of loans) {
    if (!['paid', 'partially_repaid', 'repaid', 'disbursed'].includes(loan.status)) continue;
    const d = (loan.disbursedAt || loan.createdAt || loan.issueDate || '').slice(0, 7);
    if (d && /^\d{4}-\d{2}$/.test(d)) monthsSet.add(d);
  }
  // A month with only manual repayments (and no loan disbursement or payroll)
  // still carries an actual financial movement and must not disappear.
  for (const entry of ledger) {
    if (entry.entryType !== 'loan_repayment' || entry.repaymentMethod !== 'manual_cash') continue;
    const month = String(entry.createdAt || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) monthsSet.add(month);
  }

  const sortedMonths = Array.from(monthsSet).sort().reverse();
  const monthlyBreakdown: MonthlyBreakdownItem[] = sortedMonths.map((m) => {
    const mPayrolls = payrollItems.filter((p) => p.periodMonth === m
      && (['approved', 'partially_paid', 'paid'].includes(p.runStatus) || p.itemStatus === 'paid') && p.itemStatus !== 'excluded');
    const gross = roundMoney(mPayrolls.reduce((sum, p) => sum + Number(p.grossPay || 0), 0), minorUnits);
    const paid = roundMoney(mPayrolls.filter((p) => p.itemStatus === 'paid' || p.runStatus === 'paid').reduce((sum, p) => sum + Number(p.netPay || 0), 0), minorUnits);

    const mLoans = loans.filter((l) => {
      const d = (l.disbursedAt || l.createdAt || l.issueDate || '').slice(0, 7);
      return d === m && ['paid', 'partially_repaid', 'repaid', 'disbursed'].includes(l.status);
    });
    const withdrawals = roundMoney(mLoans.reduce((sum, l) => sum + Number(l.principalAmount || 0), 0), minorUnits);
    // Repayments belong to the month they were actually recorded, not the
    // disbursement month of a now-partially-repaid loan.
    const repayments = roundMoney(ledger.filter(l =>
      l.entryType === 'loan_repayment' && (l.createdAt || '').slice(0, 7) === m
    ).reduce((sum, l) => sum + Math.abs(Number(l.amount || 0)), 0), minorUnits);

    const mPenalties = roundMoney(mPayrolls.reduce((sum, p) => sum + Number(p.penaltyDeduction || 0), 0), minorUnits);

    // Monthly net is the actual movement in this statement's running balance.
    // Re-deriving it from gross ignores statutory withholdings and duplicates
    // applied adjustments; use the same normalized transactions as the ledger.
    const netMonth = roundMoney(rawTxns
      .filter(tx => tx.date.slice(0, 7) === m)
      .reduce((sum, tx) => sum + tx.credit - tx.debit, 0), minorUnits);

    return {
      month: m,
      grossSalary: gross,
      paidSalary: paid,
      withdrawals,
      repayments,
      penalties: mPenalties,
      netMonth,
    };
  });

  // Apply Filter to Transactions list (Newest first for presentation, but keeping correct running balance)
  let filteredTxns = transactionsWithBalance;
  if (filter?.from) {
    filteredTxns = filteredTxns.filter((t) => t.date >= filter.from!);
  }
  if (filter?.to) {
    filteredTxns = filteredTxns.filter((t) => t.date <= filter.to!);
  }
  if (filter?.month) {
    filteredTxns = filteredTxns.filter((t) => t.date.startsWith(filter.month!));
  }

  // Presentation order: newest first
  const displayTxns = [...filteredTxns].reverse();

  return {
    employee,
    summary,
    transactions: displayTxns,
    monthlyBreakdown,
  };
}
