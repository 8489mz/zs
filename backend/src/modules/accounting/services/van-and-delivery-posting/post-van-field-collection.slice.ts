import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { VanAndDeliveryPostingDeps } from './van-and-delivery-posting.types';

export type PostVanFieldCollectionBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: VanAndDeliveryPostingDeps['toMoney'];
  getTenantAccountingSettings: VanAndDeliveryPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  resolveAccountWithFallback: VanAndDeliveryPostingDeps['resolveAccountWithFallback'];
  insertPostedJournal: VanAndDeliveryPostingDeps['insertPostedJournal'];
};

export class PostVanFieldCollectionSlice {
  constructor(private readonly bound: PostVanFieldCollectionBoundDeps) {}

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private async resolveAccountWithFallback(
    queryable: DbOrTx,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ): Promise<number> {
    return this.bound.resolveAccountWithFallback(queryable, tenantId, configuredId, fallbackCode);
  }

  private insertPostedJournal(
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
  ): Promise<number> {
    return this.bound.insertPostedJournal(queryable, params);
  }

  /**
   * A field debt collection is also cash sitting with the rep until the trip is settled, so it
   * cannot go straight to the cash account either. It moves the amount out of the customer's own
   * receivable and into the same pooled "none"-partner receivable that postVanTripSettlement later
   * clears against cash — the mirror image of postSale crediting a customer's receivable into that
   * same pool at sale time.
   */
  async postVanFieldCollection(
    queryable: DbOrTx,
    collectionId: number,
    params: {
      amount: number;
      customerId: number;
      branchId: number | null;
      locationId: number | null;
      paymentMethod?: string;
      transferReference?: string;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);

    const amount = toBookMoney(params.amount);
    if (!(amount > 0)) return { posted: false, journalEntryId: null };

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_field_collection')
      .where('source_id', '=', collectionId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting van field collection ${collectionId}`);

    let receivableAccountId = Number(settings.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0))
      receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const branchId = params.branchId;
    const locationId = params.locationId;
    const electronic = params.paymentMethod != null && params.paymentMethod !== 'cash';
    // INV-VAN-FIELD-NONCASH-EVIDENCE-GATE: an electronic collection
    // debits bank 1120 below, so it must carry a transfer
    // reference — the field service enforces supervisor PIN +
    // reference before this point, and this is the last line of
    // defence for any future caller that reaches the posting
    // without evidence. Cash collections are untouched.
    if (electronic) {
      const reference = String(params.transferReference || '').trim();
      if (reference.length < 3) {
        throw new Error(
          `Van field collection ${collectionId}: refusing to debit bank 1120 for an electronic collection without a transfer reference of at least 3 characters`,
        );
      }
    }
    const debitAccountId = electronic
      ? await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120')
      : receivableAccountId;
    const lines: JournalLineDraft[] = [
      {
        accountId: debitAccountId,
        description: electronic ? 'تحصيل ميداني إلكتروني إلى البنك' : 'تحصيل ميداني بواسطة مندوب - عهدة نقدية',
        debit: amount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      },
      {
        accountId: receivableAccountId,
        description: `تحصيل ميداني بواسطة مندوب - سداد مديونية عميل`,
        debit: 0,
        credit: amount,
        partnerType: 'customer',
        partnerId: params.customerId,
        branchId,
        locationId,
      },
    ];

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_field_collection',
        sourceId: collectionId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد تحصيل ميداني #${collectionId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_van_sales_uniq')) {
        const existing2 = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'van_field_collection')
          .where('source_id', '=', collectionId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }
}
