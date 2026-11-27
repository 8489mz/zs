import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { InventoryManufacturingCashPostingDeps } from './inventory-manufacturing-cash-posting.types';

export type ServicePostingBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: InventoryManufacturingCashPostingDeps['toMoney'];
  getTenantAccountingSettings: InventoryManufacturingCashPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: InventoryManufacturingCashPostingDeps['resolveSystemAccountByCode'];
  addLine: InventoryManufacturingCashPostingDeps['addLine'];
  insertPostedJournal: InventoryManufacturingCashPostingDeps['insertPostedJournal'];
};

export class ServicePostingSlice {
  private readonly bound: ServicePostingBoundDeps;

  constructor(bound: ServicePostingBoundDeps) {
    this.bound = bound;
  }

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

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    return this.bound.addLine(lines, next, digits);
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

  async postService(
    queryable: DbOrTx,
    serviceId: number,
    revision: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const service = await queryable
      .selectFrom('services')
      .selectAll()
      .where('id', '=', serviceId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!service) return { posted: false, journalEntryId: null };

    const amount = toBookMoney(service.amount);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let cashAccountId = Number(settings?.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');

    let bankAccountId = Number(settings?.bank_account_id || 0);
    if (!(bankAccountId > 0)) bankAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');

    const revenueAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '4200');

    const branchId = service.branch_id ? Number(service.branch_id) : null;
    const locationId = service.location_id ? Number(service.location_id) : null;
    const isCard = service.payment_channel === 'card';

    const lines: JournalLineDraft[] = [];
    if (isCard) {
      this.addLine(
        lines,
        {
          accountId: bankAccountId,
          description: `إيراد خدمة بنكي: ${service.name}`,
          debit: amount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        bookDigits,
      );
    } else {
      this.addLine(
        lines,
        {
          accountId: cashAccountId,
          description: `إيراد خدمة نقدي: ${service.name}`,
          debit: amount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        bookDigits,
      );
    }
    this.addLine(
      lines,
      {
        accountId: revenueAccountId,
        description: `إيراد خدمة: ${service.name}`,
        debit: 0,
        credit: amount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      },
      bookDigits,
    );

    // Use composite source_id for idempotency on revisions
    const sourceIdComposite = Number(`${serviceId}000${revision}`);

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'service',
        sourceId: sourceIdComposite,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: service.service_date ? new Date(service.service_date) : new Date(),
        description: `قيد إيراد خدمة - #${serviceId} Rev ${revision}`,
        branchId,
        locationId,
        createdBy: service.created_by ? Number(service.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'service')
          .where('source_id', '=', sourceIdComposite)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async reverseService(queryable: DbOrTx, serviceId: number, revision: number, auth: AuthContext): Promise<void> {
    const scope = requireTenantScope(auth);
    // Find the original journal entry for this specific revision
    const sourceIdComposite = Number(`${serviceId}000${revision}`);
    const original = await queryable
      .selectFrom('journal_entries')
      .selectAll()
      .where('source_type', '=', 'service')
      .where('source_id', '=', sourceIdComposite)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    if (!original) return; // Nothing to reverse

    const originalLines = await queryable
      .selectFrom('journal_entry_lines')
      .selectAll()
      .where('journal_entry_id', '=', original.id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    const lines: JournalLineDraft[] = originalLines.map((l) => ({
      accountId: Number(l.account_id),
      description: `عكس ${l.description}`,
      debit: Number(l.credit), // Flip
      credit: Number(l.debit), // Flip
      partnerType: l.partner_type,
      partnerId: l.partner_id ? Number(l.partner_id) : null,
      branchId: l.branch_id ? Number(l.branch_id) : null,
      locationId: l.location_id ? Number(l.location_id) : null,
    }));

    try {
      await this.insertPostedJournal(queryable, {
        sourceType: 'service_reversal',
        sourceId: sourceIdComposite,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `عكس قيد خدمة - #${serviceId} Rev ${revision}`,
        branchId: original.branch_id ? Number(original.branch_id) : null,
        locationId: original.location_id ? Number(original.location_id) : null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
        // Already reversed
        return;
      }
      throw e;
    }
  }
}
