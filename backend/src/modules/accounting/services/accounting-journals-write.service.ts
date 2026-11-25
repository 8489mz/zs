import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../engines/money-minor-units.engine';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { DraftJournalEntryInput, DraftJournalLineInput, PartnerType } from '../accounting-types';
import { CreateManualJournalEntryDto } from '../dto/accounting.dto';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { AccountingPostingService } from '../accounting-posting.service';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { assertTaxPeriodOpen } from '../accounting-tax-lock';
import { allocateJournalNumber, formatJournalEntryNo } from '../engines/journal-number.engine';
import { randomUUID } from 'node:crypto';

/**
 * Journals-write slice of AccountingService (facade: accounting.service.ts).
 * Pure move — the four journal-writing methods, byte-identical to the
 * facade; the facade delegates to this slice. Slices never import each
 * other: the S1 (journals-read) helpers arrive here as bound deps.
 */

export interface AccountingJournalsWriteDeps {
  db: Kysely<Database>;
  accountingTenantFoundation: AccountingTenantFoundationService;
  accountingPosting?: AccountingPostingService;
  assertAccountingAccess: (auth: AuthContext) => void;
  assertJournalReferences: (
    queryable: Kysely<Database>,
    tenantId: string,
    lines: Array<{
      costCenterId?: number | null;
      branchId?: number | null;
      locationId?: number | null;
      partnerType?: string;
      partnerId?: number | null;
    }>,
  ) => Promise<void>;
  assertNotInLockedPeriod: (
    tenantId: string,
    entryDate: Date | string,
    options?: { auth?: AuthContext; isTaxOperation?: boolean; queryable?: Kysely<Database> },
  ) => Promise<void>;
  toBookMoney: (value: unknown, digits: MoneyDigits) => number;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
  normalizePartnerType: (value: unknown) => PartnerType | null;
}

@Injectable()
export class AccountingJournalsWriteService {
  private readonly db: Kysely<Database>;
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly accountingPosting?: AccountingPostingService;
  private readonly assertAccountingAccess: (auth: AuthContext) => void;
  private readonly assertJournalReferences: (
    queryable: Kysely<Database>,
    tenantId: string,
    lines: Array<{
      costCenterId?: number | null;
      branchId?: number | null;
      locationId?: number | null;
      partnerType?: string;
      partnerId?: number | null;
    }>,
  ) => Promise<void>;
  private readonly assertNotInLockedPeriod: (
    tenantId: string,
    entryDate: Date | string,
    options?: { auth?: AuthContext; isTaxOperation?: boolean; queryable?: Kysely<Database> },
  ) => Promise<void>;
  private readonly toBookMoney: (value: unknown, digits: MoneyDigits) => number;
  private readonly toMoney: (value: unknown, digits: MoneyDigits) => number;
  private readonly normalizePartnerType: (value: unknown) => PartnerType | null;

  constructor(deps: AccountingJournalsWriteDeps) {
    this.db = deps.db;
    this.accountingTenantFoundation = deps.accountingTenantFoundation;
    this.accountingPosting = deps.accountingPosting;
    this.assertAccountingAccess = deps.assertAccountingAccess;
    this.assertJournalReferences = deps.assertJournalReferences;
    this.assertNotInLockedPeriod = deps.assertNotInLockedPeriod;
    this.toBookMoney = deps.toBookMoney;
    this.toMoney = deps.toMoney;
    this.normalizePartnerType = deps.normalizePartnerType;
  }

  async createManualJournalEntry(
    dto: CreateManualJournalEntryDto,
    auth: AuthContext,
    externalTrx?: Kysely<Database>,
  ): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);

    if (!dto.lines || dto.lines.length < 2) {
      throw new BadRequestException('يجب أن يحتوي القيد اليومي على سطرين على الأقل (مدين ودائن).');
    }

    const entryDate = dto.entryDate ? new Date(dto.entryDate) : new Date();
    if (Number.isNaN(entryDate.getTime())) {
      throw new BadRequestException('تاريخ القيد غير صالح.');
    }

    // Check period lock dates
    await this.assertNotInLockedPeriod(scope.tenantId, entryDate, { auth });

    // Raw DTO lines are collected here unrounded. Rounding happens
    // inside writeJournal, on the transaction handle, at the tenant's
    // book digits (see below): resolving digits on the pool handle
    // outside the transaction could post stale precision.
    const pendingLines: Array<{
      accountId: number;
      costCenterId: number | null;
      description: string;
      debit: number;
      credit: number;
      partnerType: 'none' | 'customer' | 'supplier';
      partnerId: number | null;
    }> = [];

    const accountIds = new Set<number>();
    for (const line of dto.lines) {
      const accId = Number(line.accountId);
      if (!accId || accId <= 0) {
        throw new BadRequestException('يجب تحديد حساب صالح لكل سطر في القيد.');
      }
      accountIds.add(accId);

      const rawDebit = Number(line.debit ?? 0);
      const rawCredit = Number(line.credit ?? 0);
      if (!Number.isFinite(rawDebit) || !Number.isFinite(rawCredit)) {
        throw new BadRequestException('قيمة القيد يجب أن تكون رقمًا صالحًا.');
      }

      if (rawDebit < 0 || rawCredit < 0) {
        throw new BadRequestException('مبالغ المدين والدائن يجب ألا تكون سالبة.');
      }

      pendingLines.push({
        accountId: accId,
        costCenterId: line.costCenterId ? Number(line.costCenterId) : null,
        description: String(line.description || dto.description || '').trim(),
        debit: rawDebit,
        credit: rawCredit,
        partnerType: line.partnerType || 'none',
        partnerId: line.partnerId ? Number(line.partnerId) : null,
      });
    }

    // Verify all accounts belong to tenant and allow manual entries
    const existingAccounts = await this.db
      .selectFrom('accounting_accounts')
      .select([
        'id',
        'code',
        'name_ar',
        'is_active',
        'allow_manual_entries',
        'is_control_account',
        'is_tax',
        'is_receivable',
        'is_payable',
        'is_inventory',
      ])
      .where('tenant_id', '=', scope.tenantId)
      .where('id', 'in', Array.from(accountIds))
      .execute();

    if (existingAccounts.length !== accountIds.size) {
      throw new BadRequestException('واحد أو أكثر من الحسابات المحددة غير موجود في شجرة الحسابات.');
    }

    for (const acc of existingAccounts) {
      if (!acc.is_active) {
        throw new BadRequestException(`الحساب [${acc.code} - ${acc.name_ar}] غير نشط.`);
      }
      if (
        acc.is_control_account ||
        acc.is_receivable ||
        acc.is_payable ||
        acc.is_inventory ||
        ['1130', '1140', '2110'].includes(acc.code)
      )
        throw new BadRequestException('الحساب الرقابي يُعدّل من مستند الشريك أو المخزون لضمان تطابق الأستاذ المساعد.');
      if (!acc.allow_manual_entries) {
        throw new BadRequestException(`الحساب [${acc.code} - ${acc.name_ar}] لا يسمح بإدخال قيود يدوية.`);
      }
    }

    const userId = Number(auth.userId) || null;
    const branchId = dto.branchId ? Number(dto.branchId) : null;

    const writeJournal = async (trx: Kysely<Database>) => {
      const posting = this.accountingPosting;
      if (!posting) throw new Error('Accounting posting service is required for manual journal posting');

      // Book digits resolved on THIS transaction handle, fail closed
      // on a base-currency/rate mismatch (P0-1/P0-2 pattern). The
      // lines below are rounded once here, at book digits; the
      // posting boundary re-rounds idempotently and re-validates.
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const unit = 10 ** -digits;
      const maxDifference = unit;

      const validatedLines: Array<{
        accountId: number;
        costCenterId: number | null;
        description: string;
        debit: number;
        credit: number;
        partnerType: 'none' | 'customer' | 'supplier';
        partnerId: number | null;
      }> = [];

      let totalDebit = 0;
      let totalCredit = 0;
      for (const line of pendingLines) {
        const debit = this.toBookMoney(line.debit, digits);
        const credit = this.toBookMoney(line.credit, digits);

        if (debit <= 0 && credit <= 0) {
          throw new BadRequestException('يجب تحديد مبلغ مدين أو دائن أكبر من الصفر لكل سطر.');
        }
        if (debit > 0 && credit > 0) {
          throw new BadRequestException('لا يمكن أن يكون السطر مدين ودائن في نفس الوقت.');
        }

        totalDebit += debit;
        totalCredit += credit;
        validatedLines.push({ ...line, debit, credit });
      }

      totalDebit = this.toBookMoney(totalDebit, digits);
      totalCredit = this.toBookMoney(totalCredit, digits);

      // The difference itself is rounded at book digits before any
      // comparison (the boundary does the same): the raw float
      // subtraction of two rounded totals can exceed one minor
      // unit by float dust alone.
      const difference = this.toBookMoney(totalDebit - totalCredit, digits);
      if (Math.abs(difference) > maxDifference) {
        throw new BadRequestException(
          `القيد غير متزن: إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit}). الفارق: ${Math.abs(difference).toFixed(digits)}`,
        );
      }

      // Rounding plug, book-digit-relative: the boundary plugs a
      // difference of at least half a minor unit and at most one
      // minor unit into 7290. After book-digit rounding a nonzero
      // difference is exactly one minor unit, so the plug fires
      // exactly when the rounded lines differ by one minor unit.
      if (Math.abs(difference) >= unit / 2) {
        const roundingAccount = await trx
          .selectFrom('accounting_accounts')
          .select(['id', 'is_active'])
          .where('tenant_id', '=', scope.tenantId)
          .where('code', '=', '7290')
          .executeTakeFirst();
        if (!roundingAccount?.is_active)
          throw new BadRequestException('حساب فروق التقريب المحاسبي 7290 غير موجود أو غير نشط.');
        const debit = difference < 0 ? Math.abs(difference) : 0;
        const credit = difference > 0 ? difference : 0;
        validatedLines.push({
          accountId: Number(roundingAccount.id),
          costCenterId: null,
          description: 'فروق تقريب القيد',
          debit,
          credit,
          partnerType: 'none',
          partnerId: null,
        });
        totalDebit = this.toBookMoney(totalDebit + debit, digits);
        totalCredit = this.toBookMoney(totalCredit + credit, digits);
      }
      if (Math.abs(this.toBookMoney(totalDebit - totalCredit, digits)) >= unit / 2)
        throw new BadRequestException('القيد غير متزن بعد التسوية.');

      await lockAccountingPeriod(trx, scope.tenantId);
      await this.assertNotInLockedPeriod(scope.tenantId, entryDate, { auth, queryable: trx });
      await assertTaxPeriodOpen(
        trx,
        scope.tenantId,
        entryDate,
        validatedLines.map((line) => line.accountId),
      );
      await this.assertJournalReferences(
        trx,
        scope.tenantId,
        validatedLines.map((line) => ({ ...line, branchId })),
      );
      const lockedAccounts = await trx
        .selectFrom('accounting_accounts')
        .select([
          'id',
          'code',
          'name_ar',
          'is_active',
          'allow_manual_entries',
          'is_control_account',
          'is_tax',
          'is_receivable',
          'is_payable',
          'is_inventory',
        ])
        .where('tenant_id', '=', scope.tenantId)
        .where(
          'id',
          'in',
          Array.from(accountIds).sort((a, b) => a - b),
        )
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      if (lockedAccounts.length !== accountIds.size) {
        throw new BadRequestException('واحد أو أكثر من الحسابات المحددة غير موجود في شجرة الحسابات.');
      }
      const mapping = await trx
        .selectFrom('accounting_settings')
        .select(['customer_receivable_account_id', 'supplier_payable_account_id', 'inventory_account_id'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', 1)
        .executeTakeFirst();
      const mappedControls = new Set(Object.values(mapping || {}).map(Number));
      for (const account of lockedAccounts) {
        if (
          !account.is_active ||
          !account.allow_manual_entries ||
          account.is_control_account ||
          account.is_receivable ||
          account.is_payable ||
          account.is_inventory ||
          mappedControls.has(Number(account.id))
        ) {
          throw new BadRequestException(
            `الحساب [${account.code} - ${account.name_ar}] غير نشط أو لا يسمح بقيود يدوية.`,
          );
        }
      }
      await this.assertNotInLockedPeriod(scope.tenantId, entryDate, {
        auth,
        queryable: trx,
        isTaxOperation: lockedAccounts.some(
          (account) => account.is_tax || ['1150', '1155', '2120', '2126', '2146'].includes(account.code),
        ),
      });
      // Post through the canonical posting boundary (P0-2 precedent):
      // it owns numbering, re-rounding, the balance/plug backstop and
      // the automated period lock. The manual validations above stay:
      // the boundary checks active accounts only, not manual-entry
      // eligibility, control accounts or mapped control accounts.
      // sourceId 0 follows the forex-revaluation precedent for a
      // sourceless journal; 'manual' has no dedup lookup. The cash
      // flow category is carried by the boundary so the cash-flow
      // report keeps reading it from the posted entry.
      const entryId = await posting.postDomainJournal(trx, {
        sourceType: 'manual',
        sourceId: 0,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate,
        description: String(dto.description || '').trim(),
        branchId,
        createdBy: userId,
        postedBy: userId,
        cashFlowCategory: dto.cashFlowCategory ?? null,
        lines: validatedLines.map((line) => ({
          accountId: line.accountId,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
          partnerType: line.partnerType,
          partnerId: line.partnerId,
          branchId,
          locationId: null,
          costCenterId: line.costCenterId,
        })),
      });
      const stored = await trx
        .selectFrom('journal_entries')
        .select('entry_no')
        .where('id', '=', entryId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirstOrThrow();

      return {
        id: entryId,
        entryNo: String(stored.entry_no),
        totalDebit,
        totalCredit,
      };
    };
    const result = externalTrx ? await writeJournal(externalTrx) : await this.db.transaction().execute(writeJournal);

    return {
      ok: true,
      entry: result,
      message: `تم إنشاء وترحيل القيد اليومي بنجاح برقم ${result.entryNo}`,
    };
  }

  async reverseJournalEntry(
    entryId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ ok: boolean; message: string; reversalEntryId: number; reversalEntryNo: string }> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    const userId = Number(auth.userId || 0) || null;

    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) {
      throw new BadRequestException('سبب عكس القيد مطلوب');
    }

    const entry = await this.db
      .selectFrom('journal_entries')
      .selectAll()
      .where('id', '=', entryId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!entry) {
      throw new NotFoundException('القيد اليومي غير موجود');
    }

    if (entry.source_type !== 'manual')
      throw new BadRequestException('يجب عكس القيد الآلي من المستند الأصلي لضمان تزامن المخزون والأستاذ المساعد.');

    if (entry.status !== 'posted') {
      throw new BadRequestException('لا يمكن عكس قيد غير مرحل أو تم إلغاؤه مسبقاً');
    }

    if (entry.reversed_by_entry_id) {
      throw new BadRequestException('تم عكس هذا القيد بالفعل مسبقاً');
    }

    if (entry.source_type !== 'manual' || entry.reversal_of_entry_id) {
      throw new BadRequestException(
        'يجب إلغاء أو تسوية القيد الآلي من المستند الأصلي للحفاظ على المخزون وأرصدة الأطراف. العكس المباشر متاح للقيود اليدوية فقط.',
      );
    }

    const lines = await this.db
      .selectFrom('journal_entry_lines')
      .selectAll()
      .where('journal_entry_id', '=', entryId)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    if (!lines.length) {
      throw new BadRequestException('لا توجد سطور في هذا القيد لعكسها');
    }

    if (lines.some((line: any) => Boolean(line.is_reconciled))) {
      throw new BadRequestException('لا يمكن عكس قيد يومي تمت تسوية أحد سطوره في التسوية البنكية.');
    }

    const result = await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      // Re-read the original under a row lock. The guards above ran on an unlocked read, so two
      // concurrent reversal requests would both see reversed_by_entry_id = NULL, both pass, and the
      // entry would be reversed twice — doubling the reversal's effect on the ledger.
      const lockedEntry = await trx
        .selectFrom('journal_entries')
        .selectAll()
        .where('id', '=', entryId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedEntry) throw new NotFoundException('القيد اليومي غير موجود');
      if (lockedEntry.status !== 'posted') throw new BadRequestException('لا يمكن عكس قيد غير مرحل أو تم إلغاؤه مسبقاً');
      if (lockedEntry.reversed_by_entry_id) throw new BadRequestException('تم عكس هذا القيد بالفعل مسبقاً');
      if (lockedEntry.source_type !== 'manual' || lockedEntry.reversal_of_entry_id) {
        throw new BadRequestException('يجب تسوية القيد الآلي من المستند الأصلي.');
      }

      const lockedLines = await trx
        .selectFrom('journal_entry_lines')
        .selectAll()
        .where('journal_entry_id', '=', entryId)
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      if (!lockedLines.length) throw new BadRequestException('لا توجد سطور في هذا القيد لعكسها');
      if (lockedLines.some((line: any) => Boolean(line.is_reconciled))) {
        throw new BadRequestException('لا يمكن عكس قيد يومي تمت تسوية أحد سطوره في التسوية البنكية.');
      }

      // A reversal is a new posting and must respect the period lock like any other. Without this,
      // reversing into a closed fiscal year silently rewrites that year's balances after sign-off.
      const taxAccounts = await trx
        .selectFrom('accounting_accounts')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where(
          'id',
          'in',
          lines.map((line) => Number(line.account_id)),
        )
        .where((eb) => eb.or([eb('is_tax', '=', true), eb('code', 'in', ['1150', '1155', '2120', '2126', '2146'])]))
        .execute();
      const isTaxOperation = taxAccounts.length > 0;
      const reversalDate = new Date();
      await this.assertNotInLockedPeriod(scope.tenantId, lockedEntry.entry_date, {
        auth,
        queryable: trx,
        isTaxOperation,
      });
      await this.assertNotInLockedPeriod(scope.tenantId, reversalDate, { auth, queryable: trx, isTaxOperation });
      await assertTaxPeriodOpen(
        trx,
        scope.tenantId,
        reversalDate,
        lockedLines.map((line) => Number(line.account_id)),
      );
      await trx
        .selectFrom('accounting_accounts')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where(
          'id',
          'in',
          Array.from(new Set(lockedLines.map((line) => Number(line.account_id)))).sort((a, b) => a - b),
        )
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();

      // Gapless numbering (INV-JE-NUMBERING-GAP): allocate before the
      // insert (and after every check above) so a failure below leaves
      // no gap behind -- the number is computed from visible rows, never
      // from a consumable sequence.
      const reversalJournalNo = await allocateJournalNumber(trx);
      const tempEntryNo = `JE-TMP-${randomUUID()}`;
      const inserted = await trx
        .insertInto('journal_entries')
        .values({
          entry_no: tempEntryNo,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          entry_date: reversalDate,
          description: `قيد عكسي للقيد رقم ${entry.entry_no}: ${trimmedReason}`,
          source_type: `${entry.source_type}_reversal`,
          cash_flow_category: lockedEntry.cash_flow_category || null,
          source_id: entry.id,
          status: 'posted',
          branch_id: entry.branch_id,
          location_id: entry.location_id,
          created_by: userId,
          posted_by: userId,
          posted_at: sql`NOW()`,
          reversal_of_entry_id: entry.id,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const revId = Number(inserted.id);
      const officialEntryNo = formatJournalEntryNo(reversalJournalNo);

      await trx
        .updateTable('journal_entries')
        .set({ entry_no: officialEntryNo, updated_at: sql`NOW()` } as any)
        .where('id', '=', revId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      // Mirror lines: swap debit and credit
      const reversalLines = lockedLines.map((l) => ({
        journal_entry_id: revId,
        tenant_id: scope.tenantId,
        account_id: l.account_id,
        cost_center_id: l.cost_center_id || null,
        description: `عكس: ${l.description || ''}`.trim(),
        debit: Number(l.credit || 0),
        credit: Number(l.debit || 0),
        partner_type: l.partner_type,
        partner_id: l.partner_id,
        branch_id: l.branch_id,
        location_id: l.location_id,
      }));

      await trx
        .insertInto('journal_entry_lines')
        .values(reversalLines as any)
        .execute();

      // Keep both posted entries in the ledger so their financial effects offset.
      await trx
        .updateTable('journal_entries')
        .set({
          reversed_by_entry_id: revId,
          updated_at: sql`NOW()`,
        } as any)
        .where('id', '=', entry.id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      return {
        reversalEntryId: revId,
        reversalEntryNo: officialEntryNo,
      };
    });

    return {
      ok: true,
      message: `تم إنشاء القيد العكسي برقم ${result.reversalEntryNo} مع بقاء القيد الأصلي في سجل الأستاذ.`,
      reversalEntryId: result.reversalEntryId,
      reversalEntryNo: result.reversalEntryNo,
    };
  }

  async createDraftJournalEntry(input: DraftJournalEntryInput, auth: AuthContext): Promise<number> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    const validation = await this.validateBalancedLines(input.lines, auth);
    if (!validation.ok) throw new ForbiddenException(validation.message);

    const scope = requireTenantScope(auth);
    const inserted = await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await this.assertNotInLockedPeriod(scope.tenantId, input.entryDate ?? new Date(), { auth, queryable: trx });
      await assertTaxPeriodOpen(
        trx,
        scope.tenantId,
        input.entryDate ?? new Date(),
        validation.lines.map((line) => line.accountId),
      );
      await this.assertJournalReferences(
        trx,
        scope.tenantId,
        validation.lines.map((line) => ({
          ...line,
          branchId: line.branchId ?? input.branchId ?? null,
          locationId: line.locationId ?? input.locationId ?? null,
        })),
      );
      // Gapless numbering (INV-JE-NUMBERING-GAP): allocate before the
      // insert (and after every check above) so a failure below leaves
      // no gap behind -- the number is computed from visible rows, never
      // from a consumable sequence.
      const draftJournalNo = await allocateJournalNumber(trx);
      const entry = await trx
        .insertInto('journal_entries')
        .values({
          entry_no: `JE-DRAFT-TMP-${scope.tenantId}-${Date.now()}-${Math.random()}`,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          entry_date: input.entryDate ?? new Date(),
          description: String(input.description || '').trim(),
          source_type: String(input.sourceType || 'manual').trim() || 'manual',
          source_id: input.sourceId ?? null,
          status: 'draft',
          branch_id: input.branchId ?? null,
          location_id: input.locationId ?? null,
          created_by: auth.userId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('journal_entries')
        .set({ entry_no: formatJournalEntryNo(draftJournalNo), updated_at: sql`NOW()` } as any)
        .where('id', '=', Number(entry.id))
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      for (const line of validation.lines) {
        await trx
          .insertInto('journal_entry_lines')
          .values({
            journal_entry_id: Number(entry.id),
            tenant_id: scope.tenantId,
            account_id: line.accountId,
            cost_center_id: line.costCenterId ?? null,
            description: line.description,
            debit: line.debit,
            credit: line.credit,
            partner_type: line.partnerType,
            partner_id: line.partnerId,
            branch_id: line.branchId,
            location_id: line.locationId,
          } as any)
          .execute();
      }

      return Number(entry.id);
    });

    return inserted;
  }

  async validateBalancedLines(
    lines: DraftJournalLineInput[],
    auth?: AuthContext,
  ): Promise<{ ok: true; lines: Array<Required<DraftJournalLineInput>> } | { ok: false; message: string }> {
    // Book digits from the tenant when scoped; without a tenant there is
    // no book to read, so the previous 2dp shaping is kept as fallback.
    const digits: MoneyDigits = auth
      ? currencyMoneyDigits(await tenantBaseCurrency(this.db, requireTenantScope(auth).tenantId))
      : 2;
    const unit = 10 ** -digits;
    if (!Array.isArray(lines) || lines.length < 2) {
      return { ok: false, message: 'Journal entry must include at least two lines.' };
    }

    const normalized: Array<Required<DraftJournalLineInput>> = lines.map((line) => {
      const debit = this.toMoney(line.debit, digits);
      const credit = this.toMoney(line.credit, digits);
      const partnerType = this.normalizePartnerType(line.partnerType);
      if (!partnerType) {
        throw new ForbiddenException('Partner type must be one of: none, customer, supplier.');
      }
      return {
        accountId: Number(line.accountId || 0),
        costCenterId: line.costCenterId ? Number(line.costCenterId) : (null as any),
        description: String(line.description || '').trim(),
        debit,
        credit,
        partnerType,
        partnerId: line.partnerId ?? null,
        branchId: line.branchId ?? null,
        locationId: line.locationId ?? null,
      };
    });

    for (const line of normalized) {
      if (!(line.accountId > 0)) return { ok: false, message: 'Every line must reference an account.' };
      if (line.debit < 0 || line.credit < 0) return { ok: false, message: 'Debit and credit must be non-negative.' };
      if (line.debit > 0 && line.credit > 0) return { ok: false, message: 'A line cannot have both debit and credit.' };
      if (!(line.debit > 0 || line.credit > 0))
        return { ok: false, message: 'Each line must have debit or credit amount.' };
    }

    let accountsQuery = this.db
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active'])
      .where(
        'id',
        'in',
        normalized.map((line) => line.accountId),
      );
    if (auth) {
      const scope = requireTenantScope(auth);
      accountsQuery = accountsQuery.where('tenant_id', '=', scope.tenantId);
    }
    const accounts = await accountsQuery.execute();

    const activeMap = new Map(accounts.map((row) => [Number(row.id), Boolean(row.is_active)]));
    for (const line of normalized) {
      if (!activeMap.has(line.accountId)) return { ok: false, message: 'One or more accounts do not exist.' };
      if (!activeMap.get(line.accountId))
        return { ok: false, message: 'Inactive accounts are not allowed in journal lines.' };
    }

    const totalDebit = this.toMoney(
      normalized.reduce((sum, line) => sum + line.debit, 0),
      digits,
    );
    const totalCredit = this.toMoney(
      normalized.reduce((sum, line) => sum + line.credit, 0),
      digits,
    );
    const difference = this.toMoney(totalDebit - totalCredit, digits);
    if (Math.abs(difference) > 5 * unit) {
      return { ok: false, message: 'Total debit must equal total credit.' };
    }

    if (Math.abs(difference) >= unit) {
      if (!auth) return { ok: false, message: 'Tenant scope is required to resolve the rounding account.' };
      const scope = requireTenantScope(auth);
      const roundingAccount = await this.db
        .selectFrom('accounting_accounts')
        .select(['id', 'is_active'])
        .where('tenant_id', '=', scope.tenantId)
        .where('code', '=', '7290')
        .executeTakeFirst();
      if (!roundingAccount?.is_active)
        return { ok: false, message: 'Rounding difference account 7290 is missing or inactive.' };
      normalized.push({
        accountId: Number(roundingAccount.id),
        costCenterId: null as any,
        description: 'Rounding difference',
        debit: difference < 0 ? Math.abs(difference) : 0,
        credit: difference > 0 ? difference : 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    return { ok: true, lines: normalized };
  }
}
