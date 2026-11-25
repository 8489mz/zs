import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting-types';

export class PostOpeningBalancesService {
  constructor(
    private readonly toMoney: PurchasesAndTreasuryPostingDeps['toMoney'],
    private readonly addLine: PurchasesAndTreasuryPostingDeps['addLine'],
    private readonly getTenantAccountingSettings: PurchasesAndTreasuryPostingDeps['getTenantAccountingSettings'],
    private readonly resolveSystemAccountByCode: PurchasesAndTreasuryPostingDeps['resolveSystemAccountByCode'],
    private readonly insertPostedJournal: PurchasesAndTreasuryPostingDeps['insertPostedJournal'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  /**
   * Customer opening balance double-entry posting
   */
  async postCustomerOpeningBalance(
    queryable: DbOrTx,
    customerId: number,
    amount: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    const absAmount = toBookMoney(Math.abs(amount));
    if (absAmount <= 0) return { posted: false, journalEntryId: null };

    // One opening-balance journal per customer: the race-window index is
    // the floor, this SELECT is the fast path (same shape as the other
    // one-journal post methods).
    const existingCustomerOpening = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'customer_opening_balance')
      .where('source_id', '=', customerId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existingCustomerOpening) return { posted: false, journalEntryId: Number(existingCustomerOpening.id) };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let arAccountId = Number(settings?.customer_receivable_account_id || 0);
    if (!(arAccountId > 0)) arAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    const openingEquityId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '3200');

    const customer = await queryable
      .selectFrom('customers')
      .select(['id', 'name'])
      .where('id', '=', customerId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const custName = customer?.name || `عميل #${customerId}`;

    const lines: JournalLineDraft[] = [];
    if (amount > 0) {
      addBookLine({
        accountId: arAccountId,
        description: `رصيد افتتاحي - مديونية على العميل ${custName}`,
        debit: absAmount,
        credit: 0,
        partnerType: 'customer',
        partnerId: customerId,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: openingEquityId,
        description: `رصيد افتتاحي حقوق ملكية - عميل ${custName}`,
        debit: 0,
        credit: absAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    } else {
      addBookLine({
        accountId: openingEquityId,
        description: `رصيد افتتاحي حقوق ملكية - دائنية للعميل ${custName}`,
        debit: absAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: arAccountId,
        description: `رصيد افتتاحي - دائنية للعميل ${custName}`,
        debit: 0,
        credit: absAmount,
        partnerType: 'customer',
        partnerId: customerId,
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'customer_opening_balance',
        sourceId: customerId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد رصيد افتتاحي للعميل ${custName}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'customer_opening_balance')
          .where('source_id', '=', customerId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  /**
   * Supplier opening balance double-entry posting
   */
  async postSupplierOpeningBalance(
    queryable: DbOrTx,
    supplierId: number,
    amount: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    const absAmount = toBookMoney(Math.abs(amount));
    if (absAmount <= 0) return { posted: false, journalEntryId: null };

    // One opening-balance journal per supplier: same shape as the
    // customer opening balance above.
    const existingSupplierOpening = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'supplier_opening_balance')
      .where('source_id', '=', supplierId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existingSupplierOpening) return { posted: false, journalEntryId: Number(existingSupplierOpening.id) };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let apAccountId = Number(settings?.supplier_payable_account_id || 0);
    if (!(apAccountId > 0)) apAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');
    const openingEquityId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '3200');

    const supplier = await queryable
      .selectFrom('suppliers')
      .select(['id', 'name'])
      .where('id', '=', supplierId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const supName = supplier?.name || `مورد #${supplierId}`;

    const lines: JournalLineDraft[] = [];
    if (amount > 0) {
      addBookLine({
        accountId: openingEquityId,
        description: `رصيد افتتاحي حقوق ملكية - التزام للمورد ${supName}`,
        debit: absAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: apAccountId,
        description: `رصيد افتتاحي - التزام للمورد ${supName}`,
        debit: 0,
        credit: absAmount,
        partnerType: 'supplier',
        partnerId: supplierId,
        branchId: null,
        locationId: null,
      });
    } else {
      addBookLine({
        accountId: apAccountId,
        description: `رصيد افتتاحي - دفعة مقدمة / مديونية على المورد ${supName}`,
        debit: absAmount,
        credit: 0,
        partnerType: 'supplier',
        partnerId: supplierId,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: openingEquityId,
        description: `رصيد افتتاحي حقوق ملكية - مورد ${supName}`,
        debit: 0,
        credit: absAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'supplier_opening_balance',
        sourceId: supplierId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد رصيد افتتاحي للمورد ${supName}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'supplier_opening_balance')
          .where('source_id', '=', supplierId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }
}
