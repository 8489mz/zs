import type { Transaction } from 'kysely';
import type { Database } from '../../../../database/database.types';
import type { AccountingTenantFoundationService } from '../../accounting-tenant-foundation.service';
import type { MoneyDigits } from '../../engines/money-minor-units.engine';
import type { Logger } from '@nestjs/common';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';

export type PurchasesAndTreasuryPostingDeps = {
  foundation: AccountingTenantFoundationService;
  logger: Logger;
  getTenantAccountingSettings: (queryable: DbOrTx, tenantId: string) => Promise<any>;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
  maxAllowedDifference: (bookDigits: MoneyDigits) => number;
  addLine: (lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3) => void;
  insertPostedJournal: (
    queryable: any,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date | string;
      description: string;
      branchId: number | null;
      locationId: number | null;
      createdBy: number | null;
      postedBy: number | null;
      cashFlowCategory?: 'operating' | 'investing' | 'financing' | null;
      lines: JournalLineDraft[];
      reversalOfEntryId?: number | null;
    },
  ) => Promise<number>;
  // params use the facade-private DomainJournalLineDraft type, so typed as any
  // (same shape the facade's own postDomainJournal accepts).
  postDomainJournal: (queryable: DbOrTx, params: any) => Promise<number>;
  resolveSystemAccountByCode: (queryable: DbOrTx, tenantId: string, code: string) => Promise<number>;
  resolveAccountWithFallback: (
    queryable: DbOrTx,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ) => Promise<number>;
  getActiveAccountMap: (queryable: DbOrTx, tenantId: string, accountIds: number[]) => Promise<Map<number, boolean>>;
  assertTransaction: (queryable: unknown, method: string) => asserts queryable is Transaction<Database>;
  getExistingPurchaseJournal: (queryable: DbOrTx, purchaseId: number, tenantId: string) => Promise<any>;
  getExistingPurchaseReversalJournal: (queryable: DbOrTx, purchaseId: number, tenantId: string) => Promise<any>;
  getExistingSupplierPaymentJournal: (queryable: DbOrTx, paymentId: number, tenantId: string) => Promise<any>;
  getExistingSupplierBillJournal: (queryable: DbOrTx, billId: number, tenantId: string) => Promise<any>;
  getExistingSupplierPaymentScheduleSettlementJournal: (
    queryable: DbOrTx,
    settlementId: number,
    tenantId: string,
  ) => Promise<any>;
  getExistingCustomerPaymentJournal: (queryable: DbOrTx, paymentId: number, tenantId: string) => Promise<any>;
  getExistingExpenseJournal: (queryable: DbOrTx, expenseId: number, tenantId: string) => Promise<any>;
};

export type ExpenseAccountCandidate = {
  id: number;
  code: string;
  name_ar: string;
  account_type: string;
  is_active: boolean;
  allow_manual_entries: boolean;
};
