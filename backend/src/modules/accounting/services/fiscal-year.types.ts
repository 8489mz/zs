import { BadRequestException } from '@nestjs/common';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

// D6 (INV-DTO-ACCOUNTING-25): converted from interfaces to decorated
// classes in place (DTO contract Rule 5). Reopen reason is required:
// both reopen services throw when the trimmed reason is empty (audit
// trail). The startDate < endDate check stays service-side.
export class CreateFiscalYearDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @IsDateString()
  @IsNotEmpty()
  endDate!: string;
}

export class CloseFiscalYearDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  retainedEarningsAccountId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReopenFiscalYearDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export interface FiscalYearAccountBalance {
  id: number;
  code: string;
  name_ar: string;
  name_en: string | null;
  account_type: string;
  balance: number;
  closingDebit: number;
  closingCredit: number;
}

export interface ProposedClosingLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string;
}

/** Shared classification for preview and the locked, live closing check. */
export function fiscalProfitAndLossCategory(account: {
  code: string;
  account_type: string;
}): 'revenue' | 'expense' | null {
  const code = String(account.code || '');
  const type = String(account.account_type || '').toLowerCase();
  if (type === 'revenue' || type === 'contra_revenue' || code.startsWith('4') || code.startsWith('71'))
    return 'revenue';
  if (
    type === 'expense' ||
    type === 'operating_expenses' ||
    type === 'cogs' ||
    type === 'contra_expense' ||
    code.startsWith('5') ||
    code.startsWith('6') ||
    code.startsWith('72')
  )
    return 'expense';
  return null;
}

/** Retain the P&L accounts and redirect only the retained-earnings line. */
export function resolveClosingJournalAccounts(
  proposed: ProposedClosingLine[],
  defaultRetainedId: number | null,
  selectedRetainedId: number,
): ProposedClosingLine[] {
  if (!Number.isSafeInteger(selectedRetainedId) || selectedRetainedId <= 0) {
    throw new BadRequestException('حساب الأرباح المحتجزة غير صالح.');
  }
  return proposed.map((line) =>
    defaultRetainedId != null && line.accountId === defaultRetainedId && line.description.includes('الأرباح المحتجزة')
      ? { ...line, accountId: selectedRetainedId }
      : line,
  );
}

export interface FiscalYearPreviewResult {
  fiscalYear: any;
  unpostedEntriesCount: number;
  canClose: boolean;
  blockReason: string | null;
  totalRevenue: number;
  totalExpense: number;
  netProfitLoss: number;
  isProfit: boolean;
  retainedEarningsAccount: {
    id: number;
    code: string;
    name_ar: string;
  } | null;
  revenueAccounts: FiscalYearAccountBalance[];
  expenseAccounts: FiscalYearAccountBalance[];
  proposedClosingLines: ProposedClosingLine[];
}
