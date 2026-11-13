/*
 * PDC cheque posting (split-1 out of AccountingPostingService).
 * Pure move: the 10 PDC posting methods + exactPdcReversalSource, unchanged,
 * behind the AccountingPostingService delegating facade. The facade owns the
 * shared journal helpers; this service receives them bound via PdcPostingDeps,
 * so the moved bodies are byte-identical to the originals.
 */
import { areOppositeJournalLines } from '../engines/journal-reversal.engine';
import { pdcBookAmount } from '../engines/pdc-transition.engine';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../accounting-posting.service';

export type PdcPostingDeps = {
  foundation: AccountingTenantFoundationService;
  getTenantAccountingSettings: (queryable: DbOrTx, tenantId: string) => Promise<any>;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
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
  resolveSystemAccountByCode: (queryable: DbOrTx, tenantId: string, code: string) => Promise<number>;
};

export class PdcPostingService {
  private readonly foundation: AccountingTenantFoundationService;
  private readonly getTenantAccountingSettings: PdcPostingDeps['getTenantAccountingSettings'];
  private readonly toMoney: PdcPostingDeps['toMoney'];
  private readonly addLine: PdcPostingDeps['addLine'];
  private readonly insertPostedJournal: PdcPostingDeps['insertPostedJournal'];
  private readonly resolveSystemAccountByCode: PdcPostingDeps['resolveSystemAccountByCode'];

  constructor(deps: PdcPostingDeps) {
    this.foundation = deps.foundation;
    this.getTenantAccountingSettings = deps.getTenantAccountingSettings;
    this.toMoney = deps.toMoney;
    this.addLine = deps.addLine;
    this.insertPostedJournal = deps.insertPostedJournal;
    this.resolveSystemAccountByCode = deps.resolveSystemAccountByCode;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.foundation.ensureForAuth(queryable, auth);
  }

  async postPdcChequeReceive(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const notesInSafeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');
    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let customerArId = Number(settings?.customer_receivable_account_id || 0);
    if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: notesInSafeId,
      description: `ورقة قبض في الخزينة - شيك #${cheque.cheque_number} (${cheque.bank_name})`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: customerArId,
      description: `استلام شيك قبض #${cheque.cheque_number} من ${cheque.partner_name}`,
      debit: 0,
      credit: amount,
      partnerType: cheque.partner_id ? 'customer' : 'none',
      partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_receive',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.issue_date ? new Date(cheque.issue_date) : new Date(),
        description: `قيد استلام ورقة قبض #${cheque.cheque_number} من ${cheque.partner_name}`,
        branchId: null,
        locationId: null,
        createdBy: cheque.created_by ? Number(cheque.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_receive')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeDeposit(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const notesUnderCollId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121');
    const notesInSafeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: notesUnderCollId,
      description: `ورقة قبض برسم التحصيل - شيك #${cheque.cheque_number}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: notesInSafeId,
      description: `إيداع شيك قبض #${cheque.cheque_number} للتحصيل`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_deposit',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.deposit_date ? new Date(cheque.deposit_date) : new Date(),
        description: `قيد إيداع ورقة قبض برسم التحصيل #${cheque.cheque_number}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_deposit')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeCollect(queryable: DbOrTx, chequeId: number, bankAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    // Debit Bank account
    let debitBankId = bankAccountId && Number(bankAccountId) > 0 ? Number(bankAccountId) : Number(cheque.deposit_bank_id || 0);
    if (!(debitBankId > 0)) {
      const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
      debitBankId = Number(settings?.bank_account_id || 0);
      if (!(debitBankId > 0)) debitBankId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');
    }

    // Credit account: was it under collection or in safe?
    const wasUnderCollection = cheque.status === 'under_collection';
    const creditAccountId = wasUnderCollection
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121')
      : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');

    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const settlementAmount = toBookMoney((cheque as any).settlement_base_amount ?? amount);
    const bank = await queryable.selectFrom('accounting_accounts').select('id').where('tenant_id', '=', scope.tenantId).where('id', '=', debitBankId).where('is_active', '=', true).where('is_cash_bank', '=', true).executeTakeFirst();
    if (!bank) throw new AppError('Invalid cheque settlement bank', 'INVALID_CHEQUE_BANK', 400);
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: debitBankId,
      description: `تحصيل ورقة قبض #${cheque.cheque_number} في البنك`,
      debit: settlementAmount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: creditAccountId,
      description: `إقفال ورقة قبض #${cheque.cheque_number} بعد التحصيل`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    const cashDifference = toBookMoney(settlementAmount - amount);
    const gain = cashDifference > 0;
    if (cashDifference !== 0) {
      const fxAccount = await this.resolveSystemAccountByCode(queryable, scope.tenantId, gain ? '7170' : '7270');
      addBookLine({ accountId: fxAccount, description: 'فرق صرف محقق عند تسوية الشيك', debit: gain ? 0 : Math.abs(cashDifference), credit: gain ? Math.abs(cashDifference) : 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_collect',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.cleared_date ? new Date(cheque.cleared_date) : new Date(),
        description: `قيد تحصيل ورقة قبض #${cheque.cheque_number} بحساب البنك`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_collect')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeBounce(queryable: DbOrTx, chequeId: number, bouncedFee: number, bankAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let customerArId = Number(settings?.customer_receivable_account_id || 0);
    if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const wasUnderCollection = cheque.status === 'under_collection';
    const creditAccountId = wasUnderCollection
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121')
      : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    // Restore Customer balance
    addBookLine({
      accountId: customerArId,
      description: `ارتداد شيك #${cheque.cheque_number} - إعادة المديونية للعميل ${cheque.partner_name}`,
      debit: amount,
      credit: 0,
      partnerType: cheque.partner_id ? 'customer' : 'none',
      partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: creditAccountId,
      description: `إلغاء ورقة قبض مرتدة #${cheque.cheque_number}`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    // Bank fee for bounced cheque if any
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const fee = toBookMoney(bouncedFee);
    if (fee > 0) {
      const bankFeeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6800');
      let bankId = bankAccountId && Number(bankAccountId) > 0 ? Number(bankAccountId) : Number(cheque.deposit_bank_id || 0);
      if (!(bankId > 0)) {
        bankId = Number(settings?.bank_account_id || 0);
        if (!(bankId > 0)) bankId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');
      }
      addBookLine({
        accountId: bankFeeId,
        description: `عمولة ومصاريف ارتداد شيك #${cheque.cheque_number}`,
        debit: fee,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: bankId,
        description: `خصم مصاريف بنكية لشيك مرتد #${cheque.cheque_number}`,
        debit: 0,
        credit: fee,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_bounce',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.bounced_date ? new Date(cheque.bounced_date) : new Date(),
        description: `قيد ارتداد ورقة قبض #${cheque.cheque_number} للعميل ${cheque.partner_name}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_bounce')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeEndorse(queryable: DbOrTx, chequeId: number, supplierId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let supplierApId = Number(settings?.supplier_payable_account_id || 0);
    if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');

    const notesInSafeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');
    const targetSupplierId = supplierId || cheque.endorsed_to_supplier_id;

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: supplierApId,
      description: `تظهير ورقة قبض #${cheque.cheque_number} سداداً لمستحقات المورد`,
      debit: amount,
      credit: 0,
      partnerType: targetSupplierId ? 'supplier' : 'none',
      partnerId: targetSupplierId ? Number(targetSupplierId) : null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: notesInSafeId,
      description: `خروج ورقة قبض #${cheque.cheque_number} من الخزينة بالتظهير`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_endorse',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : new Date(),
        description: `قيد تظهير ورقة قبض #${cheque.cheque_number} للمورد`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_endorse')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeIssue(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let supplierApId = Number(settings?.supplier_payable_account_id || 0);
    if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');

    const notesPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: supplierApId,
      description: `إصدار ورقة دفع #${cheque.cheque_number} للمورد ${cheque.partner_name}`,
      debit: amount,
      credit: 0,
      partnerType: cheque.partner_id ? 'supplier' : 'none',
      partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: notesPayableId,
      description: `ورقة دفع مصدرة #${cheque.cheque_number} للمورد ${cheque.partner_name}`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_issue',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.issue_date ? new Date(cheque.issue_date) : new Date(),
        description: `قيد إصدار ورقة دفع #${cheque.cheque_number} للمورد ${cheque.partner_name}`,
        branchId: null,
        locationId: null,
        createdBy: cheque.created_by ? Number(cheque.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_issue')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeClear(queryable: DbOrTx, chequeId: number, bankAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const notesPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');

    let bankId = bankAccountId && Number(bankAccountId) > 0 ? Number(bankAccountId) : Number(cheque.deposit_bank_id || 0);
    if (!(bankId > 0)) {
      const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
      bankId = Number(settings?.bank_account_id || 0);
      if (!(bankId > 0)) bankId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');
    }

    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const settlementAmount = toBookMoney((cheque as any).settlement_base_amount ?? amount);
    const bank = await queryable.selectFrom('accounting_accounts').select('id').where('tenant_id', '=', scope.tenantId).where('id', '=', bankId).where('is_active', '=', true).where('is_cash_bank', '=', true).executeTakeFirst();
    if (!bank) throw new AppError('Invalid cheque settlement bank', 'INVALID_CHEQUE_BANK', 400);
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: notesPayableId,
      description: `صرف وإقفال ورقة دفع #${cheque.cheque_number}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: bankId,
      description: `خصم ورقة دفع منصرفة #${cheque.cheque_number} من حساب البنك`,
      debit: 0,
      credit: settlementAmount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    const cashDifference = toBookMoney(settlementAmount - amount);
    const gain = cashDifference < 0;
    if (cashDifference !== 0) {
      const fxAccount = await this.resolveSystemAccountByCode(queryable, scope.tenantId, gain ? '7170' : '7270');
      addBookLine({ accountId: fxAccount, description: 'فرق صرف محقق عند تسوية الشيك', debit: gain ? 0 : Math.abs(cashDifference), credit: gain ? Math.abs(cashDifference) : 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_clear',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.cleared_date ? new Date(cheque.cleared_date) : new Date(),
        description: `قيد صرف ورقة دفع #${cheque.cheque_number} من البنك`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_clear')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequePayableBounce(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const notesPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let supplierApId = Number(settings?.supplier_payable_account_id || 0);
    if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: notesPayableId,
      description: `إلغاء ورقة دفع مرتدة #${cheque.cheque_number}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: supplierApId,
      description: `إعادة مديونية المورد ${cheque.partner_name} بسبب ارتداد شيك #${cheque.cheque_number}`,
      debit: 0,
      credit: amount,
      partnerType: cheque.partner_id ? 'supplier' : 'none',
      partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_payable_bounce',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.bounced_date ? new Date(cheque.bounced_date) : new Date(),
        description: `قيد ارتداد ورقة دفع #${cheque.cheque_number} وإعادة المديونية للمورد ${cheque.partner_name}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_payable_bounce')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  private async exactPdcReversalSource(queryable: DbOrTx, tenantId: string, candidateId: number | null, lines: JournalLineDraft[], digits: MoneyDigits): Promise<number | null> {
    if (!candidateId) return null;
    const header = await queryable.selectFrom('journal_entries').select('id').where('tenant_id', '=', tenantId)
      .where('id', '=', candidateId).where('status', '=', 'posted').where('reversed_by_entry_id', 'is', null).forUpdate().executeTakeFirst();
    if (!header) return null;
    const prior = await queryable.selectFrom('journal_entry_lines').selectAll().where('tenant_id', '=', tenantId).where('journal_entry_id', '=', candidateId).execute();
    const original = prior.map(line => ({ accountId: Number(line.account_id), debit: Number(line.debit), credit: Number(line.credit),
      partnerType: line.partner_type, partnerId: line.partner_id, branchId: line.branch_id, locationId: line.location_id, costCenterId: line.cost_center_id }));
    return areOppositeJournalLines(original, lines, digits) ? candidateId : null;
  }

  async postPdcChequeCancelOrReturn(
    queryable: DbOrTx,
    chequeId: number,
    action: 'cancel' | 'return',
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque || !cheque.journal_entry_id) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    if (cheque.type === 'receivable') {
      let customerArId = Number(settings?.customer_receivable_account_id || 0);
      if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
      // The cheque row is read before the status update, so status is the pre-cancel state.
      const notesAccountId = cheque.status === 'under_collection'
        ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121')
        : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');

      addBookLine({
        accountId: customerArId,
        description: `إلغاء/رد ورقة قبض #${cheque.cheque_number} - إعادة المديونية للعميل ${cheque.partner_name}`,
        debit: amount,
        credit: 0,
        partnerType: cheque.partner_id ? 'customer' : 'none',
        partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: notesAccountId,
        description: `إلغاء/رد ورقة قبض #${cheque.cheque_number}`,
        debit: 0,
        credit: amount,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    } else {
      let supplierApId = Number(settings?.supplier_payable_account_id || 0);
      if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');
      const payablePdcId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');

      addBookLine({
        accountId: payablePdcId,
        description: `إلغاء/رد ورقة دفع #${cheque.cheque_number}`,
        debit: amount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: supplierApId,
        description: `إلغاء/رد ورقة دفع #${cheque.cheque_number} - إعادة التزام المورد ${cheque.partner_name}`,
        debit: 0,
        credit: amount,
        partnerType: cheque.partner_id ? 'supplier' : 'none',
        partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
        branchId: null,
        locationId: null,
      });
    }

    const actionText = action === 'cancel' ? 'إلغاء' : 'رد';
    const reversalOfEntryId = await this.exactPdcReversalSource(queryable, scope.tenantId, Number(cheque.journal_entry_id) || null, lines, bookDigits);
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: `pdc_cheque_${action}`,
      sourceId: chequeId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : new Date(),
      description: `قيد ${actionText} شيك #${cheque.cheque_number} (${cheque.type === 'receivable' ? 'قبض' : 'دفع'}) لـ ${cheque.partner_name}`,
      reversalOfEntryId,
      branchId: null,
      locationId: null,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines,
    });
    return { posted: true, journalEntryId: entryId };
  }

  async postPdcChequeRestore(
    queryable: DbOrTx,
    chequeId: number,
    previousStatus: string,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    let description = '';

    if (cheque.type === 'receivable' && previousStatus === 'bounced') {
      let customerArId = Number(settings?.customer_receivable_account_id || 0);
      if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
      const safeAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');
      addBookLine({
        accountId: safeAccountId,
        description: `إعادة إيداع شيك مرتد في الخزينة #${cheque.cheque_number}`,
        debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      });
      addBookLine({
        accountId: customerArId,
        description: `تسوية مديونية العميل ${cheque.partner_name} بعد استعادة الشيك للخزينة #${cheque.cheque_number}`,
        debit: 0, credit: amount,
        partnerType: cheque.partner_id ? 'customer' : 'none',
        partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
        branchId: null, locationId: null,
      });
      description = `قيد استعادة شيك مرتد #${cheque.cheque_number} إلى الخزينة`;
    } else if (cheque.type === 'receivable' && previousStatus === 'under_collection') {
      const safeAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');
      const underCollectionId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121');
      addBookLine({
        accountId: safeAccountId,
        description: `سحب شيك #${cheque.cheque_number} من التحصيل وإعادته للخزينة`,
        debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      });
      addBookLine({
        accountId: underCollectionId,
        description: `إقفال ورقة قبض برسم التحصيل #${cheque.cheque_number}`,
        debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      });
      description = `قيد سحب شيك #${cheque.cheque_number} من التحصيل إلى الخزينة`;
    } else if (cheque.type === 'payable' && previousStatus === 'bounced') {
      let supplierApId = Number(settings?.supplier_payable_account_id || 0);
      if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');
      const notesPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');
      addBookLine({
        accountId: supplierApId,
        description: `إعادة إصدار ورقة دفع مرتدة #${cheque.cheque_number} للمورد ${cheque.partner_name}`,
        debit: amount, credit: 0,
        partnerType: cheque.partner_id ? 'supplier' : 'none',
        partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
        branchId: null, locationId: null,
      });
      addBookLine({
        accountId: notesPayableId,
        description: `ورقة دفع قائمة #${cheque.cheque_number}`,
        debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      });
      description = `قيد إعادة إصدار ورقة دفع مرتدة #${cheque.cheque_number}`;
    } else {
      return { posted: false, journalEntryId: null };
    }

    const priorSourceType = previousStatus === 'under_collection'
      ? 'pdc_cheque_deposit'
      : (cheque.type === 'receivable' ? 'pdc_cheque_bounce' : 'pdc_cheque_payable_bounce');
    const priorEntry = await queryable
      .selectFrom('journal_entries')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('source_type', '=', priorSourceType)
      .where('source_id', '=', chequeId)
      .where('reversed_by_entry_id', 'is', null)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    const reversalOfEntryId = await this.exactPdcReversalSource(queryable, scope.tenantId, Number(priorEntry?.id) || null, lines, bookDigits);
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'pdc_cheque_restore',
      sourceId: chequeId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : new Date(),
      description,
      branchId: null,
      locationId: null,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines,
      // Fees remain incurred; a changed custody account also prevents an exact
      // reversal link. Such restorations remain independently traceable events.
      reversalOfEntryId,
    });
    return { posted: true, journalEntryId: entryId };
  }
}
