import { tenantBaseCurrency } from '../accounting-currency';
import { bankStatementAmountsEqual } from '../accounting-types';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import {
  CreateBankFeeAdjustmentDto,
  CreateBankStatementDto,
  CreateManualJournalEntryDto,
  ReconcileMatchDto,
} from '../dto/accounting.dto';

/**
 * AccountingBankStatementsService — slice S10 of the accounting split.
 * Pure move of 8 methods from AccountingService (bank statements: list,
 * read, create, the reconciliation workspace, match/unmatch, and the bank
 * fee adjustment). No behavior change: the bodies are byte-identical; the
 * facade keeps thin delegates with the same names and signatures. Deps are
 * kernel (db + 3 bound kernel helpers: assertAccountingAccess,
 * tenantPredicate, toMoney) + the bound S2 method createManualJournalEntry
 * (the facade passes the journals-write slice's method bound; S2 merges
 * second). The slice never touches the foundation or the posting service
 * directly — the fee adjustment posts through the S2 method. The free
 * function bankStatementAmountsEqual is imported from accounting-types.ts
 * (lands with S1). reconcileMatchInTransaction stays private here (its
 * only callers, reconcileMatch and createBankFeeAdjustment, are in-slice);
 * the facade has NO delegate for it. The p0a tenant-join pin
 * (bs.id/bsl.statement_id) lives in reconcileMatchInTransaction — its
 * repoint to this file is merge-owned. Driving specs: createBankStatement
 * + createBankFeeAdjustment are pinned; getBankReconciliationWorkspace
 * (103L) is unpinned (controller-only) — recorded, not a blocker.
 */

export interface AccountingBankStatementsDeps {
  db: Kysely<Database>;
  // Bound kernel helpers (same names as the facade members, so the
  // moved bodies are byte-identical). assertAccountingAccess +
  // tenantPredicate + toMoney stay in the facade forever.
  assertAccountingAccess: (auth: AuthContext) => void;
  tenantPredicate: (auth: AuthContext, alias?: string) => any;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
  // Bound S2 slice method (same name as the facade member, so the
  // moved body is byte-identical). The facade passes the journals-write
  // slice's createManualJournalEntry bound; S2 merges second.
  createManualJournalEntry: (
    dto: CreateManualJournalEntryDto,
    auth: AuthContext,
    externalTrx?: Kysely<Database>,
  ) => Promise<Record<string, unknown>>;
}

@Injectable()
export class AccountingBankStatementsService {
  private readonly db: Kysely<Database>;
  private readonly assertAccountingAccess: (auth: AuthContext) => void;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => any;
  private readonly toMoney: (value: unknown, digits: MoneyDigits) => number;
  private readonly createManualJournalEntry: (
    dto: CreateManualJournalEntryDto,
    auth: AuthContext,
    externalTrx?: Kysely<Database>,
  ) => Promise<Record<string, unknown>>;

  constructor(deps: AccountingBankStatementsDeps) {
    this.db = deps.db;
    this.assertAccountingAccess = deps.assertAccountingAccess;
    this.tenantPredicate = deps.tenantPredicate;
    this.toMoney = deps.toMoney;
    this.createManualJournalEntry = deps.createManualJournalEntry;
  }

  async listBankStatements(auth: AuthContext, accountId?: number): Promise<any[]> {
    this.assertAccountingAccess(auth);

    let query = this.db
      .selectFrom('bank_statements as bs')
      .innerJoin('accounting_accounts as a', (join: any) =>
        join.onRef('a.id', '=', 'bs.account_id').onRef('a.tenant_id', '=', 'bs.tenant_id'),
      )
      .where(this.tenantPredicate(auth, 'bs'))
      .select([
        'bs.id',
        'bs.account_id',
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'bs.statement_no',
        'bs.statement_date',
        'bs.starting_balance',
        'bs.ending_balance',
        'bs.status',
        'bs.notes',
        'bs.created_at',
      ])
      .orderBy('bs.statement_date', 'desc');

    if (accountId && Number(accountId) > 0) {
      query = query.where('bs.account_id', '=', Number(accountId));
    }

    const rows = await query.execute();
    return rows.map((r: any) => ({
      id: Number(r.id),
      accountId: Number(r.account_id),
      accountCode: r.account_code,
      accountNameAr: r.account_name_ar,
      statementNo: r.statement_no,
      statementDate: String(r.statement_date).slice(0, 10),
      startingBalance: Number(r.starting_balance || 0),
      endingBalance: Number(r.ending_balance || 0),
      status: r.status,
      notes: r.notes || '',
      createdAt: r.created_at,
    }));
  }

  async getBankStatement(id: number, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);

    const statement = await this.db
      .selectFrom('bank_statements as bs')
      .innerJoin('accounting_accounts as a', (join: any) =>
        join.onRef('a.id', '=', 'bs.account_id').onRef('a.tenant_id', '=', 'bs.tenant_id'),
      )
      .where('bs.id', '=', id)
      .where(this.tenantPredicate(auth, 'bs'))
      .select([
        'bs.id',
        'bs.account_id',
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'bs.statement_no',
        'bs.statement_date',
        'bs.starting_balance',
        'bs.ending_balance',
        'bs.status',
        'bs.notes',
        'bs.created_at',
      ])
      .executeTakeFirst();

    if (!statement) {
      throw new NotFoundException('كشف الحساب البنكي غير موجود.');
    }

    const lines = await this.db
      .selectFrom('bank_statement_lines')
      .selectAll()
      .where('statement_id', '=', id)
      .where(this.tenantPredicate(auth))
      .orderBy('line_date', 'asc')
      .execute();

    return {
      statement: {
        id: Number(statement.id),
        accountId: Number(statement.account_id),
        accountCode: statement.account_code,
        accountNameAr: statement.account_name_ar,
        statementNo: statement.statement_no,
        statementDate: String(statement.statement_date).slice(0, 10),
        startingBalance: Number(statement.starting_balance || 0),
        endingBalance: Number(statement.ending_balance || 0),
        status: statement.status,
        notes: statement.notes || '',
      },
      lines: lines.map((l: any) => ({
        id: Number(l.id),
        statementId: Number(l.statement_id),
        lineDate: String(l.line_date).slice(0, 10),
        description: l.description,
        reference: l.reference || '',
        amount: Number(l.amount || 0),
        isReconciled: Boolean(l.is_reconciled),
        matchedJournalLineId: l.matched_journal_line_id ? Number(l.matched_journal_line_id) : null,
        reconciledAt: l.reconciled_at,
      })),
    };
  }

  async createBankStatement(dto: CreateBankStatementDto, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);

    // Header, lines and account eligibility must be validated and committed together.
    // Otherwise a failed line insert leaves a draft bank statement without its lines.
    const statementId = await this.db.transaction().execute(async (trx) => {
      const account = await trx
        .selectFrom('accounting_accounts')
        .select(['id', 'is_cash_bank'])
        .where('id', '=', dto.accountId)
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();

      if (!account) throw new BadRequestException('الحساب المالي المحدد غير موجود.');
      if (!account.is_cash_bank) {
        throw new BadRequestException('كشف الحساب البنكي يتطلب حساب خزينة أو بنك.');
      }

      const statement = await trx
        .insertInto('bank_statements')
        .values({
          tenant_id: scope.tenantId,
          account_id: dto.accountId,
          statement_no: dto.statementNo,
          statement_date: dto.statementDate,
          starting_balance: dto.startingBalance || 0,
          ending_balance: dto.endingBalance || 0,
          status: 'draft',
          notes: dto.notes || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (dto.lines && dto.lines.length > 0) {
        const lineRows = dto.lines.map((line) => ({
          tenant_id: scope.tenantId,
          statement_id: statement.id,
          line_date: line.lineDate,
          description: line.description,
          reference: line.reference || null,
          amount: line.amount,
          is_reconciled: false,
        }));
        await trx.insertInto('bank_statement_lines').values(lineRows).execute();
      }
      return Number(statement.id);
    });

    return this.getBankStatement(statementId, auth);
  }

  async getBankReconciliationWorkspace(statementId: number, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);
    const statementData = await this.getBankStatement(statementId, auth);
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const statement = statementData.statement;
    const statementLines = statementData.lines;

    // Fetch GL unreconciled journal lines for this bank account
    const glLines = await (this.db as any)
      .selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', (join: any) =>
        join.onRef('je.id', '=', 'jel.journal_entry_id').onRef('je.tenant_id', '=', 'jel.tenant_id'),
      )
      .where('jel.account_id', '=', statement.accountId)
      .where('je.status', '=', 'posted')
      .where(sql`(jel.is_reconciled = false OR jel.is_reconciled IS NULL)`)
      .where(this.tenantPredicate(auth, 'jel'))
      .select([
        'jel.id',
        'jel.journal_entry_id',
        'je.entry_no',
        'je.entry_date',
        'jel.description',
        'jel.debit',
        'jel.credit',
        'jel.is_reconciled',
      ])
      .orderBy('je.entry_date', 'asc')
      .execute();

    const formattedGlLines = glLines.map((gl: any) => ({
      id: Number(gl.id),
      journalEntryId: Number(gl.journal_entry_id),
      entryNo: gl.entry_no,
      entryDate: String(gl.entry_date).slice(0, 10),
      description: gl.description,
      debit: Number(gl.debit || 0),
      credit: Number(gl.credit || 0),
      netAmount: Number(gl.debit || 0) - Number(gl.credit || 0),
      isReconciled: Boolean(gl.is_reconciled),
    }));

    // Auto-match suggestions:
    // Match statement line (+deposit) with GL debit (+amount)
    // Match statement line (-withdrawal) with GL credit (+amount)
    const suggestions: any[] = [];
    const usedGlIds = new Set<number>();

    for (const sLine of statementLines) {
      if (sLine.isReconciled) continue;
      const targetAmount = sLine.amount;

      for (const glLine of formattedGlLines) {
        if (usedGlIds.has(glLine.id)) continue;
        const matchesDeposit = targetAmount > 0 && bankStatementAmountsEqual(glLine.debit, targetAmount, digits);
        const matchesWithdrawal =
          targetAmount < 0 && bankStatementAmountsEqual(glLine.credit, Math.abs(targetAmount), digits);

        if (matchesDeposit || matchesWithdrawal) {
          const sDate = new Date(sLine.lineDate).getTime();
          const gDate = new Date(glLine.entryDate).getTime();
          const daysDiff = Math.abs(sDate - gDate) / (1000 * 60 * 60 * 24);

          suggestions.push({
            statementLineId: sLine.id,
            journalLineId: glLine.id,
            confidence: daysDiff <= 7 ? 'high' : 'medium',
            reason: `تطابق تام في المبلغ (${Math.abs(targetAmount).toFixed(digits)}) وفارق زمني ${Math.round(daysDiff)} يوم`,
          });
          usedGlIds.add(glLine.id);
          break;
        }
      }
    }

    // Calculate balances
    const totalReconciledLinesAmount = statementLines
      .filter((l: any) => l.isReconciled)
      .reduce((sum: number, l: any) => sum + l.amount, 0);

    const calculatedEndingBalance = statement.startingBalance + totalReconciledLinesAmount;
    const difference = statement.endingBalance - calculatedEndingBalance;
    // Rounded to book precision, then balanced ONLY at exactly zero: a
    // 0.001 KWD difference is a real unexplained amount, not noise.
    const roundedDifference = roundMoney(difference, digits);

    return {
      statement,
      statementLines,
      glLines: formattedGlLines,
      suggestions,
      summary: {
        startingBalance: statement.startingBalance,
        endingBalance: statement.endingBalance,
        reconciledAmount: totalReconciledLinesAmount,
        calculatedEndingBalance,
        difference: roundedDifference,
        isBalanced: roundedDifference === 0,
        totalLines: statementLines.length,
        reconciledLinesCount: statementLines.filter((l: any) => l.isReconciled).length,
      },
    };
  }

  async reconcileMatch(dto: ReconcileMatchDto, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);
    return this.db.transaction().execute((trx) => this.reconcileMatchInTransaction(trx, dto, auth));
  }

  private async reconcileMatchInTransaction(trx: any, dto: ReconcileMatchDto, auth: AuthContext): Promise<any> {
    // 1. Lock and fetch statement line
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
    const sLine = await trx
      .selectFrom('bank_statement_lines as bsl')
      .innerJoin('bank_statements as bs', (join: any) =>
        join.onRef('bs.id', '=', 'bsl.statement_id').onRef('bs.tenant_id', '=', 'bsl.tenant_id'),
      )
      .where('bsl.id', '=', dto.statementLineId)
      .where(this.tenantPredicate(auth, 'bsl'))
      .select([
        'bsl.id',
        'bsl.amount',
        'bsl.is_reconciled',
        'bsl.statement_id',
        'bs.account_id as statement_account_id',
      ])
      .forUpdate()
      .executeTakeFirst();

    if (!sLine) {
      throw new NotFoundException('سطر كشف الحساب غير موجود.');
    }
    if (sLine.is_reconciled) {
      throw new BadRequestException('سطر كشف الحساب البنكي مطابق بالفعل.');
    }

    // 2. Lock and fetch journal entry line
    const glLine = await trx
      .selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', (join: any) =>
        join.onRef('je.id', '=', 'jel.journal_entry_id').onRef('je.tenant_id', '=', 'jel.tenant_id'),
      )
      .where('jel.id', '=', dto.journalLineId)
      .where(this.tenantPredicate(auth, 'jel'))
      .select([
        'jel.id',
        'jel.account_id',
        'jel.debit',
        'jel.credit',
        'jel.is_reconciled',
        'je.status as journal_status',
      ])
      .forUpdate()
      .executeTakeFirst();

    if (!glLine) {
      throw new NotFoundException('سطر القيد المحاسبي غير موجود.');
    }
    if (glLine.journal_status !== 'posted') {
      throw new BadRequestException('لا يمكن مطابقة قيد محاسبي غير مرحل.');
    }
    if (glLine.is_reconciled) {
      throw new BadRequestException('سطر القيد المحاسبي مطابق بالفعل مع حركة بنكية أخرى.');
    }

    // 3. Ensure GL line belongs to the bank account of this statement
    if (Number(glLine.account_id) !== Number(sLine.statement_account_id)) {
      throw new BadRequestException('لا يمكن مطابقة سطر كشف الحساب مع قيد لحساب مالي مختلف.');
    }

    // 4. Mathematical validation: net journal amount must match statement line amount at book precision
    const netJournalAmount = Number(glLine.debit || 0) - Number(glLine.credit || 0);
    const statementAmount = Number(sLine.amount || 0);
    if (!bankStatementAmountsEqual(statementAmount, netJournalAmount, digits)) {
      throw new BadRequestException(
        `عدم تطابق في المبلغ: سطر كشف الحساب (${statementAmount.toFixed(digits)}) لا يتطابق مع القيد المحاسبي (${netJournalAmount.toFixed(digits)}).`,
      );
    }

    const now = new Date();

    // 5. Update statement line
    await trx
      .updateTable('bank_statement_lines')
      .set({
        is_reconciled: true,
        matched_journal_line_id: dto.journalLineId,
        reconciled_at: now,
      })
      .where('id', '=', dto.statementLineId)
      .where(this.tenantPredicate(auth))
      .execute();

    // 6. Update journal line
    await trx
      .updateTable('journal_entry_lines')
      .set({
        is_reconciled: true,
        reconciled_at: now,
      })
      .where('id', '=', dto.journalLineId)
      .where(this.tenantPredicate(auth))
      .execute();

    return { success: true, message: 'تمت مطابقة السطر البنكي مع القيد المحاسبي بنجاح.' };
  }

  async unreconcileMatch(statementLineId: number, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);

    return this.db.transaction().execute(async (trx: any) => {
      const line = await trx
        .selectFrom('bank_statement_lines')
        .select(['id', 'matched_journal_line_id', 'is_reconciled'])
        .where('id', '=', statementLineId)
        .where(this.tenantPredicate(auth))
        .forUpdate()
        .executeTakeFirst();

      if (!line) throw new NotFoundException('سطر كشف الحساب غير موجود.');
      if (!line.is_reconciled && !line.matched_journal_line_id) {
        return { success: true, message: 'السطر غير مطابق بالفعل.' };
      }

      if (line.matched_journal_line_id) {
        const glLine = await trx
          .selectFrom('journal_entry_lines')
          .select(['id'])
          .where('id', '=', line.matched_journal_line_id)
          .where(this.tenantPredicate(auth))
          .forUpdate()
          .executeTakeFirst();

        if (glLine) {
          await trx
            .updateTable('journal_entry_lines')
            .set({ is_reconciled: false, reconciled_at: null })
            .where('id', '=', line.matched_journal_line_id)
            .where(this.tenantPredicate(auth))
            .execute();
        }
      }

      await trx
        .updateTable('bank_statement_lines')
        .set({ is_reconciled: false, matched_journal_line_id: null, reconciled_at: null })
        .where('id', '=', statementLineId)
        .where(this.tenantPredicate(auth))
        .execute();

      return { success: true, message: 'تم إلغاء المطابقة وإعادة السطر للحركات المعلقة.' };
    });
  }

  async createBankFeeAdjustment(dto: CreateBankFeeAdjustmentDto, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const sLine = await trx
        .selectFrom('bank_statement_lines as bsl')
        .innerJoin('bank_statements as bs', (join: any) =>
          join.onRef('bs.id', '=', 'bsl.statement_id').onRef('bs.tenant_id', '=', 'bsl.tenant_id'),
        )
        .where('bsl.id', '=', dto.statementLineId)
        .where(this.tenantPredicate(auth, 'bsl'))
        .where(this.tenantPredicate(auth, 'bs'))
        .select(['bsl.id', 'bsl.amount', 'bsl.line_date', 'bsl.description', 'bsl.is_reconciled', 'bs.account_id'])
        .forUpdate()
        .executeTakeFirst();

      if (!sLine) throw new NotFoundException('سطر كشف الحساب غير موجود.');
      if (sLine.is_reconciled) throw new BadRequestException('سطر كشف الحساب مطابق بالفعل.');
      const signedAmount = Number(sLine.amount);
      if (!Number.isFinite(signedAmount) || signedAmount >= 0) {
        throw new BadRequestException('عمولة البنك يجب أن تكون حركة خصم سالبة.');
      }
      const feeAmount = this.toMoney(Math.abs(signedAmount), digits);
      if (feeAmount <= 0) throw new BadRequestException('مبلغ العمولة غير صالح.');

      const entryResult = await this.createManualJournalEntry(
        {
          entryDate: String(sLine.line_date).slice(0, 10),
          description: dto.description || `مصاريف وعمولات بنكية - كشف حساب (${sLine.description})`,
          lines: [
            {
              accountId: dto.expenseAccountId,
              description: dto.description || 'مصاريف وعمولات بنكية',
              debit: feeAmount,
              credit: 0,
            },
            {
              accountId: Number(sLine.account_id),
              description: dto.description || 'مصاريف وعمولات بنكية خصماً من الحساب',
              debit: 0,
              credit: feeAmount,
            },
          ],
        },
        auth,
        trx,
      );
      const entryId = Number((entryResult as any)?.entry?.id);
      const bankCreditLine = await trx
        .selectFrom('journal_entry_lines')
        .select(['id'])
        .where('journal_entry_id', '=', entryId)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', Number(sLine.account_id))
        .where('credit', '=', feeAmount)
        .executeTakeFirst();
      if (!bankCreditLine) throw new BadRequestException('لم يتم إنشاء سطر بنك صالح لقيد العمولة.');
      // Both writes rollback together on any reconciliation error; no orphan journal.
      await this.reconcileMatchInTransaction(
        trx,
        {
          statementLineId: dto.statementLineId,
          journalLineId: Number(bankCreditLine.id),
        },
        auth,
      );
      return {
        success: true,
        message: 'تم إنشاء قيد المصاريف البنكية ومطابقته فورياً.',
        journalEntryId: entryId,
      };
    });
  }
}
