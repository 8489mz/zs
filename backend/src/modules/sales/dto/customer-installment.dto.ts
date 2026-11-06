export interface CreateInstallmentPlanDto {
  saleId?: number | null;
  customerId: number;
  totalAmount: number;
  downPayment?: number;
  interestRatePercent?: number;
  installmentCount: number;
  startDate?: string;
  // INV-INSTALLMENT-FIRST-DUE-DATE: the entered first-installment due
  // date. When supplied, the schedule starts on it; when absent, the
  // schedule keeps the old shape (first due one month after start).
  firstDueDate?: string;
  notes?: string;
  branchId?: number | null;
}

export interface PayInstallmentDto {
  amount: number;
  paymentMethod?: 'cash' | 'card' | 'bank_transfer' | 'instapay';
  notes?: string;
  receiptNo?: string;
}

export interface ListInstallmentsQueryDto {
  planId?: number;
  customerId?: number;
  status?: string;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}
