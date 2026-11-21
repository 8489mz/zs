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

export interface CreatePdcChequeDto {
  type: 'receivable' | 'payable';
  chequeNumber: string;
  bankName: string;
  branchName?: string;
  drawerName?: string;
  partnerType?: string;
  partnerId?: number;
  partnerName: string;
  amount: number;
  currency?: string;
  exchangeRate?: number;
  issueDate: string;
  dueDate: string;
  depositBankId?: number;
  notes?: string;
  status?: string;
}

export interface UpdateChequeStatusDto {
  action: 'deposit' | 'collect' | 'clear' | 'bounce' | 'endorse' | 'return' | 'cancel' | 'restore_to_safe';
  actionDate?: string;
  settlementExchangeRate?: number;
  depositBankId?: number;
  bouncedReason?: string;
  bouncedFee?: number;
  endorsedToSupplierId?: number;
  endorsedToSupplierName?: string;
  notes?: string;
}
