export interface WithdrawalBalanceResponse {
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
    totalDays?: number;
  };
  schedule?: {
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
    isProrated?: boolean;
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
  maxDirectAdvance?: number;
  directAdvanceCeilingPct?: number;
  directAdvanceCashCap?: number;
  canDisburseDirectly: boolean;
  maxDirectDisbursement: number;
}

export function money(val: unknown): string {
  const num = Number(val || 0);
  return Number.isFinite(num) ? num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}
