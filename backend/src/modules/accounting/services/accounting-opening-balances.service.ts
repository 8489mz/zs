import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../engines/money-minor-units.engine';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { OpeningBalancesPreviewQueryDto, PostOpeningBalancesDto } from '../dto/accounting.dto';
import { type AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { type AccountingPostingService } from '../accounting-posting.service';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { type OpeningBalanceAccount, type OpeningBalanceLine } from '../accounting-types';

/**
 * AccountingOpeningBalancesService — slice S4 of the accounting split.
 * Pure move of 7 methods from AccountingService (opening balances: the 5
 * private preview builders + the 2 public preview/post entry points). No
 * behavior change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures. Deps are kernel (db,
 * foundation, optional posting) + 4 bound kernel helpers
 * (assertAccountingAccess, toBookMoney, normalizeDateInput, openingAmount)
 * + the bound S1 method assertNotInLockedPeriod (the facade passes the
 * journals-read slice's method bound; S1 merges first). The 5 privates
 * are public here (the facade delegate, a different class, cannot call a
 * private slice method — tsc TS2341); the facade delegates stay private,
 * so the facade public surface is unchanged. The posting fail-closed
 * guard travels byte-identical: postOpeningBalances throws when the
 * optional posting service is absent. Date handling travels verbatim:
 * postOpeningBalances builds the entry date with
 * new Date(preview.systemStartDate + 'T00:00:00.000Z') (L1848, business
 * timestamp, no instant comparison, no UTC-slice normalizer) and
 * recomputes the preview inside its transaction on the tx handle.
 * Driving specs: opening-balance-book-digits (preview + post) — its pin
 * range is REWORKED at merge (the end marker createDraftJournalEntry
 * moves to S2 while the range lives in S4); no spec repoint travels in
 * this patch — merge-owned.
 */

export interface AccountingOpeningBalancesDeps {
  db: Kysely<Database>;
  accountingTenantFoundation: AccountingTenantFoundationService;
  accountingPosting?: AccountingPostingService;
  // Bound kernel helpers (same names as the facade members, so the
  // moved bodies are byte-identical). assertAccountingAccess +
  // toBookMoney + normalizeDateInput + openingAmount stay in the
  // facade forever.
  assertAccountingAccess: (auth: AuthContext) => void;
  toBookMoney: (value: unknown, digits: MoneyDigits) => number;
  normalizeDateInput: (value: string | null | undefined, db: Kysely<Database>, tenantId: string) => Promise<string>;
  openingAmount: (value: unknown, digits: MoneyDigits) => number;
  // Bound S1 slice method (same name as the facade member, so the
  // moved body is byte-identical). The facade passes the journals-read
  // slice's assertNotInLockedPeriod bound; S1 merges first.
  assertNotInLockedPeriod: (
    tenantId: string,
    entryDate: Date | string,
    options?: {
      auth?: AuthContext;
      isTaxOperation?: boolean;
      queryable?: Kysely<Database>;
    },
  ) => Promise<void>;
}

@Injectable()
export class AccountingOpeningBalancesService {
  private readonly db: Kysely<Database>;
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly assertAccountingAccess: (auth: AuthContext) => void;
  private readonly toBookMoney: (value: unknown, digits: MoneyDigits) => number;
  private readonly normalizeDateInput: (
    value: string | null | undefined,
    db: Kysely<Database>,
    tenantId: string,
  ) => Promise<string>;
  private readonly openingAmount: (value: unknown, digits: MoneyDigits) => number;
  private readonly assertNotInLockedPeriod: (
    tenantId: string,
    entryDate: Date | string,
    options?: {
      auth?: AuthContext;
      isTaxOperation?: boolean;
      queryable?: Kysely<Database>;
    },
  ) => Promise<void>;

  constructor(deps: AccountingOpeningBalancesDeps) {
    this.db = deps.db;
    this.accountingTenantFoundation = deps.accountingTenantFoundation;
    this.accountingPosting = deps.accountingPosting;
    this.assertAccountingAccess = deps.assertAccountingAccess;
    this.toBookMoney = deps.toBookMoney;
    this.normalizeDateInput = deps.normalizeDateInput;
    this.openingAmount = deps.openingAmount;
    this.assertNotInLockedPeriod = deps.assertNotInLockedPeriod;
  }

  async getExistingOpeningBalanceEntry(
    auth: AuthContext,
    db: Kysely<Database> = this.db,
  ): Promise<{ id: number } | null> {
    const scope = requireTenantScope(auth);
    const row = await db
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'opening_balance')
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    return row ? { id: Number(row.id) } : null;
  }

  async resolveOpeningAccount(
    auth: AuthContext,
    code: string,
    expectedTypes: string[],
    db: Kysely<Database> = this.db,
  ): Promise<OpeningBalanceAccount> {
    const scope = requireTenantScope(auth);
    const row = await db
      .selectFrom('accounting_accounts')
      .select([
        'id',
        'code',
        'name_ar',
        'account_type',
        'is_active',
        'allow_manual_entries',
        'is_control_account',
        'is_tax',
        'is_receivable',
        'is_payable',
        'is_inventory',
      ])
      .where('tenant_id', '=', scope.tenantId)
      .where('code', '=', code)
      .executeTakeFirst();

    if (!row) {
      throw new BadRequestException(`حساب الأرصدة الافتتاحية ${code} غير موجود في شجرة الحسابات.`);
    }
    if (!row.is_active) {
      throw new BadRequestException(`حساب الأرصدة الافتتاحية ${code} غير نشط.`);
    }
    if (!row.allow_manual_entries) {
      throw new BadRequestException(`حساب الأرصدة الافتتاحية ${code} لا يسمح بالترحيل عليه.`);
    }
    const accountType = String(row.account_type || '');
    if (!expectedTypes.includes(accountType)) {
      throw new BadRequestException(`نوع الحساب ${code} غير مناسب للأرصدة الافتتاحية.`);
    }

    return {
      id: Number(row.id),
      code: String(row.code || ''),
      nameAr: String(row.name_ar || ''),
      accountType,
      isActive: Boolean(row.is_active),
      allowManualEntries: Boolean(row.allow_manual_entries),
    };
  }

  addOpeningLine(
    lines: OpeningBalanceLine[],
    account: OpeningBalanceAccount,
    description: string,
    debit: number,
    credit: number,
    digits: MoneyDigits,
  ): void {
    const normalizedDebit = this.toBookMoney(debit, digits);
    const normalizedCredit = this.toBookMoney(credit, digits);
    if (normalizedDebit <= 0 && normalizedCredit <= 0) return;
    if (normalizedDebit > 0 && normalizedCredit > 0) {
      throw new BadRequestException('لا يمكن أن يحتوي سطر الأرصدة الافتتاحية على مدين ودائن معًا.');
    }
    lines.push({
      accountId: account.id,
      accountCode: account.code,
      accountNameAr: account.nameAr,
      description,
      debit: normalizedDebit,
      credit: normalizedCredit,
    });
  }

  async calculateOpeningOperationalTotals(
    auth: AuthContext,
    digits: MoneyDigits,
    db: Kysely<Database> = this.db,
  ): Promise<{
    customerReceivables: number;
    supplierPayables: number;
    inventoryValue: number;
  }> {
    const scope = requireTenantScope(auth);
    const [customerResult, supplierResult, inventoryResult] = await Promise.all([
      sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(balance), 0) AS total
        FROM customers
        WHERE tenant_id = ${scope.tenantId}
          AND is_active = TRUE
          AND balance > 0
      `.execute(db),
      sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(balance), 0) AS total
        FROM suppliers
        WHERE tenant_id = ${scope.tenantId}
          AND is_active = TRUE
          AND balance > 0
      `.execute(db),
      sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(stock_qty * cost_price), 0) AS total
        FROM products
        WHERE tenant_id = ${scope.tenantId}
          AND is_active = TRUE
          AND stock_qty > 0
          AND cost_price > 0
      `.execute(db),
    ]);

    return {
      customerReceivables: this.toBookMoney(customerResult.rows[0]?.total, digits),
      supplierPayables: this.toBookMoney(supplierResult.rows[0]?.total, digits),
      inventoryValue: this.toBookMoney(inventoryResult.rows[0]?.total, digits),
    };
  }

  async buildOpeningBalancesPreview(
    input: OpeningBalancesPreviewQueryDto | PostOpeningBalancesDto,
    auth: AuthContext,
    digits: MoneyDigits,
    db: Kysely<Database> = this.db,
  ): Promise<{
    alreadyPosted: boolean;
    existingOpeningEntryId: number | null;
    systemStartDate: string;
    totals: {
      cashOpening: number;
      bankOpening: number;
      customerReceivables: number;
      supplierPayables: number;
      inventoryValue: number;
      balancingCapital: number;
    };
    linesPreview: OpeningBalanceLine[];
    warnings: string[];
  }> {
    const existing = await this.getExistingOpeningBalanceEntry(auth, db);
    const systemStartDate = await this.normalizeDateInput(input.system_start_date, db, String(auth.tenantId ?? ''));
    const cashOpening = this.openingAmount(input.cash_opening, digits);
    const bankOpening = this.openingAmount(input.bank_opening, digits);
    const operational = await this.calculateOpeningOperationalTotals(auth, digits, db);

    const [cash, bank, receivable, inventory, payable, capital] = await Promise.all([
      this.resolveOpeningAccount(auth, '1110', ['asset'], db),
      this.resolveOpeningAccount(auth, '1120', ['asset'], db),
      this.resolveOpeningAccount(auth, '1130', ['asset'], db),
      this.resolveOpeningAccount(auth, '1140', ['asset'], db),
      this.resolveOpeningAccount(auth, '2110', ['liability'], db),
      this.resolveOpeningAccount(auth, '3100', ['equity'], db),
    ]);

    const lines: OpeningBalanceLine[] = [];
    this.addOpeningLine(lines, cash, 'رصيد افتتاحي - الخزينة', cashOpening, 0, digits);
    this.addOpeningLine(lines, bank, 'رصيد افتتاحي - البنك', bankOpening, 0, digits);
    // Customer, supplier and inventory openings are posted by their source documents.
    // Current operational balances must never be posted a second time here.

    const debitBeforeCapital = this.toBookMoney(
      lines.reduce((sum, line) => sum + line.debit, 0),
      digits,
    );
    const creditBeforeCapital = this.toBookMoney(
      lines.reduce((sum, line) => sum + line.credit, 0),
      digits,
    );
    const balancingCapital = this.toBookMoney(debitBeforeCapital - creditBeforeCapital, digits);
    if (balancingCapital > 0) {
      this.addOpeningLine(lines, capital, 'موازنة الأرصدة الافتتاحية - رأس المال', 0, balancingCapital, digits);
    } else if (balancingCapital < 0) {
      this.addOpeningLine(
        lines,
        capital,
        'موازنة الأرصدة الافتتاحية - رأس المال',
        Math.abs(balancingCapital),
        0,
        digits,
      );
    }

    const warnings: string[] = [
      'هذا القيد يثبت افتتاحية الخزينة والبنك فقط؛ افتتاحيات الشركاء والمخزون تثبت من مستنداتها.',
    ];
    if (!lines.length) {
      warnings.push('لا توجد أرصدة افتتاحية ذات قيمة للترحيل.');
    }
    if (operational.inventoryValue <= 0) {
      warnings.push('قيمة المخزون الافتتاحية تساوي صفرًا حسب كميات وتكلفة الأصناف الحالية.');
    }

    return {
      alreadyPosted: Boolean(existing),
      existingOpeningEntryId: existing?.id ?? null,
      systemStartDate,
      totals: {
        cashOpening,
        bankOpening,
        customerReceivables: operational.customerReceivables,
        supplierPayables: operational.supplierPayables,
        inventoryValue: operational.inventoryValue,
        balancingCapital,
      },
      linesPreview: lines.map((line) => ({
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountNameAr: line.accountNameAr,
        description: line.description,
        debit: this.toBookMoney(line.debit, digits),
        credit: this.toBookMoney(line.credit, digits),
      })),
      warnings,
    };
  }

  async previewOpeningBalances(
    query: OpeningBalancesPreviewQueryDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    // Digits are the tenant's book digits, resolved on the caller's
    // handle with the P2 pattern (tenantBaseCurrency +
    // currencyMoneyDigits) and fail closed on a currency mismatch,
    // exactly like the posting boundary. The standalone preview and
    // the post path share one computation
    // (buildOpeningBalancesPreview); post re-runs it inside its
    // transaction on the transaction handle and posts the
    // recomputed lines through the boundary, so preview and post
    // can never disagree.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));
    return this.buildOpeningBalancesPreview(query, auth, digits);
  }

  async postOpeningBalances(body: PostOpeningBalancesDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    const posting = this.accountingPosting;
    if (!posting) throw new Error('Accounting posting service is required for opening balances');
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const preview = await this.buildOpeningBalancesPreview(body, auth, digits);

    if (preview.alreadyPosted && preview.existingOpeningEntryId) {
      return {
        posted: false,
        alreadyPosted: true,
        journalEntryId: String(preview.existingOpeningEntryId),
        message: 'تم ترحيل الأرصدة الافتتاحية مسبقًا.',
        preview,
      };
    }

    if (preview.linesPreview.length < 2) {
      throw new BadRequestException('لا توجد أرصدة افتتاحية كافية لإنشاء قيد متوازن.');
    }

    const totalDebit = this.toBookMoney(
      preview.linesPreview.reduce((sum, line) => sum + line.debit, 0),
      digits,
    );
    const totalCredit = this.toBookMoney(
      preview.linesPreview.reduce((sum, line) => sum + line.credit, 0),
      digits,
    );
    if (totalDebit !== totalCredit) {
      throw new BadRequestException('قيد الأرصدة الافتتاحية غير متوازن.');
    }

    const note = String(body.note || '').trim();
    const postResult = await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      const entryDate = new Date(`${preview.systemStartDate}T00:00:00.000Z`);
      await this.assertNotInLockedPeriod(scope.tenantId, entryDate, { auth, queryable: trx });
      const existing = await trx
        .selectFrom('journal_entries')
        .select('id')
        .where('source_type', '=', 'opening_balance')
        .where('status', '=', 'posted')
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('id', 'desc')
        .executeTakeFirst();
      if (existing) return { id: Number(existing.id), posted: false, preview };

      // Recompute the opening balance on THIS transaction handle at
      // the book digits resolved on this handle. The preview above
      // was computed outside the transaction (different handle,
      // possibly different digits if settings changed); posting it
      // verbatim would bake in stale precision. The recomputation
      // is the single source of truth for the posted lines.
      const postDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const recomputed = await this.buildOpeningBalancesPreview(body, auth, postDigits, trx);
      if (recomputed.alreadyPosted && recomputed.existingOpeningEntryId) {
        return { id: Number(recomputed.existingOpeningEntryId), posted: false, preview: recomputed };
      }

      // Fail closed on ANY difference between the preview and the
      // live recomputation: exact equality at book digits, per line
      // and for the totals. A changed balance, a changed account,
      // or a digits change since the preview all fail here instead
      // of posting stale lines.
      const previewLinesMatch =
        preview.systemStartDate === recomputed.systemStartDate &&
        preview.totals.cashOpening === recomputed.totals.cashOpening &&
        preview.totals.bankOpening === recomputed.totals.bankOpening &&
        preview.totals.balancingCapital === recomputed.totals.balancingCapital &&
        preview.linesPreview.length === recomputed.linesPreview.length &&
        preview.linesPreview.every((line, index) => {
          const actual = recomputed.linesPreview[index];
          return (
            actual &&
            actual.accountId === line.accountId &&
            actual.debit === line.debit &&
            actual.credit === line.credit
          );
        });
      if (!previewLinesMatch) {
        throw new BadRequestException('تغيرت الأرصدة الافتتاحية بعد المعاينة؛ يجب تحديث المعاينة قبل الترحيل.');
      }

      const recomputedDebit = this.toBookMoney(
        recomputed.linesPreview.reduce((sum, line) => sum + line.debit, 0),
        postDigits,
      );
      const recomputedCredit = this.toBookMoney(
        recomputed.linesPreview.reduce((sum, line) => sum + line.credit, 0),
        postDigits,
      );
      if (recomputedDebit !== recomputedCredit) {
        throw new BadRequestException('قيد الأرصدة الافتتاحية غير متوازن.');
      }

      // Post through the canonical posting boundary: it re-rounds
      // every line at book digits, validates accounts and balance,
      // and assigns the entry number. The direct journal_entry_lines
      // insert this replaces bypassed all of it. sourceId 0 follows
      // the forex-revaluation precedent for a sourceless journal;
      // the stored source_id was already null and no lookup keys
      // on it (the once-per-tenant guard is on source_type +
      // status, enforced above and by unique index).
      const id = await posting.postDomainJournal(trx, {
        sourceType: 'opening_balance',
        sourceId: 0,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate,
        description: note ? `قيد الأرصدة الافتتاحية - ${note}` : 'قيد الأرصدة الافتتاحية',
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines: recomputed.linesPreview.map((line) => ({
          accountId: line.accountId,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
          partnerType: 'none' as const,
          partnerId: null,
          branchId: null,
          locationId: null,
        })),
      });

      return { id, posted: true, preview: recomputed };
    });

    if (!postResult.posted) {
      return {
        posted: false,
        alreadyPosted: true,
        journalEntryId: String(postResult.id),
        message: 'تم ترحيل الأرصدة الافتتاحية مسبقًا.',
        preview: postResult.preview,
      };
    }

    return {
      posted: true,
      alreadyPosted: false,
      journalEntryId: String(postResult.id),
      message: 'تم ترحيل قيد الأرصدة الافتتاحية بنجاح.',
      preview: postResult.preview,
    };
  }
}
