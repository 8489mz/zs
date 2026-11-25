export interface PdcChequeRecord {
  id: number;
  tenant_id: string;
  account_id: number | null;
  type: 'receivable' | 'payable';
  cheque_number: string;
  bank_name: string;
  branch_name: string | null;
  drawer_name: string | null;
  partner_type: string;
  partner_id: number | null;
  partner_name: string;
  amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  status: string;
  deposit_bank_id: number | null;
  deposit_date: string | null;
  cleared_date: string | null;
  bounced_date: string | null;
  bounced_reason: string | null;
  bounced_fee: number;
  flagged_rate_variance: boolean;
  registered_exchange_rate: number | null;
  endorsed_to_supplier_id: number | null;
  endorsed_to_supplier_name: string | null;
  journal_entry_id: number | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface PdcChequesFilter {
  type?: 'receivable' | 'payable';
  status?: string;
  search?: string;
  dueFrom?: string;
  dueTo?: string;
  partnerId?: number;
  bankName?: string;
  page?: number;
  limit?: number;
}

export interface PdcChequesStats {
  receivables: {
    totalCount: number;
    totalAmount: number;
    inSafeCount: number;
    inSafeAmount: number;
    underCollectionCount: number;
    underCollectionAmount: number;
    collectedCount: number;
    collectedAmount: number;
    bouncedCount: number;
    bouncedAmount: number;
    dueSoonCount: number;
    dueSoonAmount: number;
    overdueCount: number;
    overdueAmount: number;
  };
  payables: {
    totalCount: number;
    totalAmount: number;
    issuedCount: number;
    issuedAmount: number;
    clearedCount: number;
    clearedAmount: number;
    bouncedCount: number;
    bouncedAmount: number;
    dueSoonCount: number;
    dueSoonAmount: number;
    overdueCount: number;
    overdueAmount: number;
  };
}

import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

// D6 (INV-DTO-ACCOUNTING-25): converted from interfaces to decorated
// classes in place (DTO contract Rule 5). CreatePdcChequeDto.status is
// optional and, when sent, must equal the type default ('in_safe' for
// receivable, 'issued' for payable) — the create slice throws otherwise.
// The caller never sends status. UpdateChequeStatusDto.action is exactly
// the 8 actions the update slice's switch handles.
export class CreatePdcChequeDto {
  @IsIn(['receivable', 'payable'])
  type!: 'receivable' | 'payable';

  @IsString()
  @IsNotEmpty()
  chequeNumber!: string;

  @IsString()
  @IsNotEmpty()
  bankName!: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsString()
  drawerName?: string;

  @IsOptional()
  @IsString()
  partnerType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  partnerId?: number;

  @IsString()
  @IsNotEmpty()
  partnerName!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  exchangeRate?: number;

  @IsDateString()
  @IsNotEmpty()
  issueDate!: string;

  @IsDateString()
  @IsNotEmpty()
  dueDate!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  depositBankId?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['in_safe', 'issued'])
  status?: string;
}

export class UpdateChequeStatusDto {
  @IsIn(['deposit', 'collect', 'clear', 'bounce', 'endorse', 'return', 'cancel', 'restore_to_safe'])
  action!: 'deposit' | 'collect' | 'clear' | 'bounce' | 'endorse' | 'return' | 'cancel' | 'restore_to_safe';

  @IsOptional()
  @IsDateString()
  actionDate?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  settlementExchangeRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  depositBankId?: number;

  @IsOptional()
  @IsString()
  bouncedReason?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bouncedFee?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  endorsedToSupplierId?: number;

  @IsOptional()
  @IsString()
  endorsedToSupplierName?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
