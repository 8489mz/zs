import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { FiscalPeriodResponse } from '../dto/fiscal-period.dto';
import { buildMonthlyFiscalPeriods } from '../engines/fiscal-period-generation.engine';
import { type AccountingPostingService } from '../accounting-posting.service';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { resolveBusinessDateKey } from '../engines/accounting-date.engine';
import { type ReopenFiscalYearDto } from './fiscal-year.types';

/**
 * FiscalYearPeriodsService — slice S3 of the fiscal-year split.
 * Pure move of the five period methods from FiscalYearService. No
 * behavior change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures. The two pure kernel
 * helpers this slice needs stay in the facade and are bound here
 * through the Deps interface. Calls between the moved methods stay
 * inside this slice, so no cross-slice binding is needed.
 */

export interface FiscalYearPeriodsDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  formatDate: (date: any) => string;
  assertAdmin: (auth: AuthContext) => void;
}

@Injectable()
export class FiscalYearPeriodsService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly formatDate: (date: any) => string;
  private readonly assertAdmin: (auth: AuthContext) => void;

  constructor(deps: FiscalYearPeriodsDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.formatDate = deps.formatDate;
    this.assertAdmin = deps.assertAdmin;
  }

  /**
   * Reopen a closed fiscal year: reverses/removes closing entry and unlocks period
   */
  async reopenFiscalYear(auth: AuthContext, id: number, dto: ReopenFiscalYearDto): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');

    const reason = String(dto.reason || '').trim();
    if (!reason) {
      throw new BadRequestException('يجب ذكر سبب إعادة فتح السنة المالية للتوثيق والرقابة.');
    }

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    if (fy.status !== 'closed') {
      throw new BadRequestException('هذه السنة المالية مفتوحة بالفعل ولا تحتاج إلى إعادة فتح.');
    }

    // Check if there is any subsequent closed fiscal year (must reopen in reverse order)
    const subsequentClosed = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'name', 'start_date'])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'closed')
      .where('start_date', '>', fy.start_date)
      .executeTakeFirst();

    if (subsequentClosed) {
      throw new BadRequestException(
        `لا يمكن إعادة فتح السنة المالية [${fy.name}] لأن السنة المالية اللاحقة [${subsequentClosed.name}] مقفلة. يجب إعادة فتح السنوات بترتيب زمني عكسي.`,
      );
    }

    await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const lockedFy = await trx
        .selectFrom('accounting_fiscal_years')
        .select(['id', 'status', 'closing_entry_id', 'start_date'])
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedFy || lockedFy.status !== 'closed') {
        throw new BadRequestException('السنة المالية تغيرت حالتها؛ يرجى إعادة التحميل.');
      }

      // 1. Post immutable reversal of closing journal entry if exists (ZS-042)
      if (lockedFy.closing_entry_id != null) {
        const closingEntry = await trx
          .selectFrom('journal_entries')
          .select(['id', 'entry_no', 'entry_date', 'description'])
          .where('id', '=', lockedFy.closing_entry_id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (closingEntry) {
          const originalLines = await trx
            .selectFrom('journal_entry_lines')
            .selectAll()
            .where('journal_entry_id', '=', closingEntry.id)
            .where('tenant_id', '=', tenantId)
            .execute();

          if (originalLines.length > 0) {
            const reversalLines = originalLines.map((l) => ({
              accountId: Number(l.account_id),
              description: `عكس قيد إقفال السنة المالية: ${fy.name} - [${l.description || ''}]`,
              debit: Number(l.credit) || 0,
              credit: Number(l.debit) || 0,
              partnerType: 'none' as const,
              partnerId: null,
              branchId: null,
              locationId: null,
            }));

            const reversalEntryId = await this.accountingPosting.postDomainJournal(trx, {
              sourceType: 'fiscal_year_reopen',
              sourceId: fy.id,
              tenantId,
              accountId: auth.accountId || tenantId,
              entryDate: new Date(closingEntry.entry_date),
              description: `عكس قيد إقفال السنة المالية [${fy.name}] بسبب إعادة الفتح: ${reason}`,
              createdBy: auth.userId,
              lines: reversalLines,
            });

            const reversalEntryNo = `REV-CLOSE-${fy.code || new Date().getFullYear()}-${String(reversalEntryId).padStart(6, '0')}`;
            await trx
              .updateTable('journal_entries')
              .set({
                entry_no: reversalEntryNo,
                updated_at: sql`NOW()`,
              })
              .where('id', '=', reversalEntryId)
              .where('tenant_id', '=', tenantId)
              .execute();
            await trx
              .updateTable('journal_entries')
              .set({ reversed_by_entry_id: reversalEntryId, updated_at: sql`NOW()` })
              .where('tenant_id', '=', tenantId)
              .where('id', '=', closingEntry.id)
              .execute();
            await trx
              .updateTable('journal_entries')
              .set({ reversal_of_entry_id: closingEntry.id, updated_at: sql`NOW()` })
              .where('tenant_id', '=', tenantId)
              .where('id', '=', reversalEntryId)
              .execute();
          }

          // Both closing and reversing entries remain posted and cancel numerically.
        }
      }

      const later = await trx
        .selectFrom('accounting_fiscal_years')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'closed')
        .where('start_date', '>', lockedFy.start_date)
        .executeTakeFirst();
      if (later) throw new BadRequestException('يجب إعادة فتح السنوات المالية بالترتيب الزمني العكسي.');

      const reopenDay = await resolveBusinessDateKey(trx, tenantId, new Date());
      const reopenLog = `\n[أعيد فتحها بتاريخ ${reopenDay} بواسطة مستخدم #${auth.userId} - السبب: ${reason}]`;
      await trx
        .updateTable('accounting_fiscal_years')
        .set({
          status: 'open',
          closing_entry_id: null,
          closed_at: null,
          closed_by: null,
          closing_notes: sql`CONCAT(COALESCE(closing_notes, ''), ${reopenLog}::text)`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .execute();
      // Do not alter accounting_settings.lock_date_all. It may contain a manual
      // administrative lock stricter than fiscal close; release requires a separate
      // explicit authorized workflow.
    });

    return {
      success: true,
      message: `تم إعادة فتح السنة المالية [${fy.name}] دون حذف قيود أو تغيير الأقفال الإدارية؛ يمكن تعديل القفل عبر الإعدادات المخولة.`,
    };
  }

  /**
   * Delete an open fiscal year period
   */
  async deleteFiscalYear(auth: AuthContext, id: number): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    if (fy.status === 'closed') {
      throw new BadRequestException('لا يمكن حذف سنة مالية مقفلة. يجب إعادة فتحها أولاً إذا كنت ترغب في حذفها.');
    }

    await this.db
      .deleteFrom('accounting_fiscal_years')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      success: true,
      message: 'تم حذف السنة المالية بنجاح.',
    };
  }

  /**
   * توليد وتقسيم الفترات المحاسبية الشهرية تلقائياً للسنة المالية (البند O6).
   */
  async ensurePeriodsForFiscalYear(
    tenantId: string,
    fiscalYearId: number,
    startDateStr: string,
    endDateStr: string,
  ): Promise<void> {
    const existing = await this.db
      .selectFrom('accounting_fiscal_periods')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('fiscal_year_id', '=', fiscalYearId)
      .executeTakeFirst();

    if (existing) return;

    const generated = buildMonthlyFiscalPeriods(startDateStr, endDateStr);

    const periodsToInsert = generated.map((period) => ({
      tenant_id: tenantId,
      fiscal_year_id: fiscalYearId,
      period_number: period.periodNumber,
      name: period.name,
      code: period.code,
      start_date: period.startDate,
      end_date: period.endDate,
      status: 'open' as const,
      created_at: sql`NOW()` as any,
      updated_at: sql`NOW()` as any,
    }));

    if (periodsToInsert.length > 0) {
      await this.db
        .insertInto('accounting_fiscal_periods')
        .values(periodsToInsert)
        .onConflict((oc) => oc.columns(['tenant_id', 'fiscal_year_id', 'period_number']).doNothing())
        .execute();
    }
  }

  /**
   * عرض الفترات الشهرية لسنة مالية — **قراءة بحتة**.
   *
   * كانت هذه الدالة تولّد الفترات وتكتبها في القاعدة إن لم تجدها، أي أن نداء `GET` كان يكتب.
   * نفس نمط O33 (`GET subscription/me` كان يُنشئ صف اشتراك) الذي أُغلق قبل يوم واحد: مسار
   * القراءة لا يكتب، والتوليد له مسار `POST` صريح يملكه مدير النظام.
   */
  async listFiscalPeriods(auth: AuthContext, fiscalYearId: number): Promise<FiscalPeriodResponse[]> {
    const tenantId = String(auth.tenantId || '');

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'start_date', 'end_date', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fiscalYearId)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    const rows = await this.db
      .selectFrom('accounting_fiscal_periods')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('fiscal_year_id', '=', fiscalYearId)
      .orderBy('period_number', 'asc')
      .execute();

    return rows.map((p) => ({
      ...p,
      start_date: this.formatDate(p.start_date),
      end_date: this.formatDate(p.end_date),
      closed_at: p.closed_at ? new Date(p.closed_at).toISOString() : null,
      created_at: p.created_at ? new Date(p.created_at).toISOString() : '',
      updated_at: p.updated_at ? new Date(p.updated_at).toISOString() : '',
    })) as FiscalPeriodResponse[];
  }

  /**
   * توليد الفترات الشهرية لسنة مالية قائمة (للسنوات التي أُنشئت قبل وجود الفترات الشهرية).
   *
   * مسار كتابة صريح ومحصور بمدير النظام، ولا يفعل شيئاً إن كانت الفترات موجودة بالفعل
   * (`ensurePeriodsForFiscalYear` تفحص أولاً، والإدراج بـ`onConflict ... doNothing`).
   */
  async generateFiscalPeriods(auth: AuthContext, fiscalYearId: number): Promise<FiscalPeriodResponse[]> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'start_date', 'end_date'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fiscalYearId)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    await this.ensurePeriodsForFiscalYear(
      tenantId,
      fiscalYearId,
      this.formatDate(fy.start_date),
      this.formatDate(fy.end_date),
    );

    return this.listFiscalPeriods(auth, fiscalYearId);
  }
}
