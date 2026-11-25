import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting-types';

export class PostWithholdingTaxRemittanceService {
  constructor(
    private readonly toMoney: PurchasesAndTreasuryPostingDeps['toMoney'],
    private readonly getTenantAccountingSettings: PurchasesAndTreasuryPostingDeps['getTenantAccountingSettings'],
    private readonly resolveSystemAccountByCode: PurchasesAndTreasuryPostingDeps['resolveSystemAccountByCode'],
    private readonly addLine: PurchasesAndTreasuryPostingDeps['addLine'],
    private readonly insertPostedJournal: PurchasesAndTreasuryPostingDeps['insertPostedJournal'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  async postWithholdingTaxRemittance(
    queryable: DbOrTx,
    transactionId: number,
    paymentMethod: 'bank' | 'cash',
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const tx = await queryable
      .selectFrom('withholding_tax_transactions')
      .selectAll()
      .where('id', '=', transactionId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!tx) return { posted: false, journalEntryId: null };
    const taxAmount = toBookMoney(tx.tax_amount);
    if (taxAmount <= 0) return { posted: false, journalEntryId: null };

    const lines: JournalLineDraft[] = [];
    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    const partnerId = tx.partner_id ? Number(tx.partner_id) : null;
    if (tx.direction === 'payable') {
      // The withheld part of the supplier liability is reclassified to WHT payable, then remitted.
      let supplierApId = Number(settings?.supplier_payable_account_id || 0);
      if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');
      const whtPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2126');
      const paymentAccountId =
        paymentMethod === 'cash'
          ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110')
          : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');

      this.addLine(
        lines,
        {
          accountId: supplierApId,
          description: `استقطاع ضريبة خصم وإضافة من مستحقات المورد ${tx.partner_name} - فاتورة #${tx.invoice_number}`,
          debit: taxAmount,
          credit: 0,
          partnerType: partnerId ? 'supplier' : 'none',
          partnerId,
          branchId: null,
          locationId: null,
        },
        bookDigits,
      );
      this.addLine(
        lines,
        {
          accountId: whtPayableId,
          description: `أمانات ضريبة خصم وإضافة نموذج 41 - فاتورة #${tx.invoice_number}`,
          debit: 0,
          credit: taxAmount,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        },
        bookDigits,
      );
      this.addLine(
        lines,
        {
          accountId: whtPayableId,
          description: `سداد ضريبة خصم وإضافة نموذج 41 - فاتورة #${tx.invoice_number}`,
          debit: taxAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        },
        bookDigits,
      );
      this.addLine(
        lines,
        {
          accountId: paymentAccountId,
          description: `سداد وتوريد ضريبة الخصم والإضافة لمصلحة الضرائب (${paymentMethod === 'cash' ? 'نقداً' : 'بنكياً'})`,
          debit: 0,
          credit: taxAmount,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        },
        bookDigits,
      );
    } else {
      // Tax withheld by the customer is a credit against our income tax; it settles part of the customer's debt.
      let customerArId = Number(settings?.customer_receivable_account_id || 0);
      if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
      const whtReceivableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1155');

      this.addLine(
        lines,
        {
          accountId: whtReceivableId,
          description: `ضريبة خصم وإضافة مخصومة لدى العميل - فاتورة #${tx.invoice_number}`,
          debit: taxAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: null,
          locationId: null,
        },
        bookDigits,
      );
      this.addLine(
        lines,
        {
          accountId: customerArId,
          description: `تسوية مديونية العميل ${tx.partner_name} بقيمة الضريبة المخصومة - فاتورة #${tx.invoice_number}`,
          debit: 0,
          credit: taxAmount,
          partnerType: partnerId ? 'customer' : 'none',
          partnerId,
          branchId: null,
          locationId: null,
        },
        bookDigits,
      );
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'withholding_tax_remittance',
        sourceId: transactionId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد سداد وتوريد ضريبة الخصم والإضافة - معاملة #${transactionId} (${tx.partner_name})`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (
        e.code === '23505' &&
        (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') ||
          e.constraint?.includes('idx_journal_entries_round1_uniq'))
      ) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'withholding_tax_remittance')
          .where('source_id', '=', transactionId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }
}
