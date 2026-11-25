import { Transaction } from 'kysely';
import { Database } from '../../../../database/database.types';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { AccountingTenantFoundationService } from '../../accounting-tenant-foundation.service';
import { MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';

export type VanAndDeliveryPostingDeps = {
  foundation: AccountingTenantFoundationService;
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
      entryDate: Date;
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
  deliverySettlementBasis: (
    queryable: DbOrTx,
    saleId: number,
    auth: AuthContext,
  ) => Promise<{ totalDebt: number; remainingReceivable: number; remainingFee: number }>;
  hasDeliveryCustodyReclassification: (queryable: DbOrTx, saleId: number, auth: AuthContext) => Promise<boolean>;
  deliveryCustodyPartner: (
    queryable: DbOrTx,
    saleId: number,
  ) => Promise<{ partnerType: 'rep' | 'none'; partnerId: number | null }>;
  readSaleResidualLines: (
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
  ) => Promise<
    Array<{
      id: number;
      product_id: number | null;
      qty: number | string;
      cost_price: number | string | null;
      unit_multiplier: number | string | null;
      modifiers: unknown;
    }>
  >;
  salesReturnCogsResidual: (
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
    returnedQtyBySaleItemId: Map<number, number>,
  ) => Promise<number>;
};
