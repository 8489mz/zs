import { Inject, Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { CloseFiscalPeriodDto, ReopenFiscalPeriodDto, FiscalPeriodResponse } from '../dto/fiscal-period.dto';
import { buildMonthlyFiscalPeriods } from '../engines/fiscal-period-generation.engine';
import { AccountingPostingService } from '../accounting-posting.service';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { nextAccountingDay, resolveBusinessDateKey } from '../engines/accounting-date.engine';
import { assertAccountingCloseReady } from '../accounting-close-readiness';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';
import { FiscalYearCloseService } from './fiscal-year-close.service';
import { FiscalYearYearsService } from './fiscal-year-years.service';
import type { CreateFiscalYearDto, CloseFiscalYearDto, ReopenFiscalYearDto, FiscalYearPreviewResult } from './fiscal-year.types';
export type { CreateFiscalYearDto, CloseFiscalYearDto, ReopenFiscalYearDto, FiscalYearAccountBalance, ProposedClosingLine, FiscalYearPreviewResult } from './fiscal-year.types';
export { fiscalProfitAndLossCategory, resolveClosingJournalAccounts } from './fiscal-year.types';

@Injectable()
export class FiscalYearService {
  private readonly years: FiscalYearYearsService;
  private readonly close: FiscalYearCloseService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
  ) {
    this.years = new FiscalYearYearsService({
      db: this.db,
      formatDate: this.formatDate.bind(this),
      toMoney: this.toMoney.bind(this),
      assertAdmin: this.assertAdmin.bind(this),
      ensurePeriodsForFiscalYear: this.ensurePeriodsForFiscalYear.bind(this),
    });
    this.close = new FiscalYearCloseService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      formatDate: this.formatDate.bind(this),
      toBookMoney: this.toBookMoney.bind(this),
      assertAdmin: this.assertAdmin.bind(this),
    });
  }

  /* List/get shaping at the tenant's book digits (was hardcoded 2dp).
   * Non-finite input still shapes to 0, as before. */
  private toMoney(value: unknown, digits: MoneyDigits): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? roundMoney(n, digits) : 0;
  }

  /**
   * Close-path rounding: round once with the canonical engine at the
   * tenant's book digits. Kept separate from toMoney so the close
   * computation can never silently fall back to display shaping.
   */
  private toBookMoney(value: unknown, digits: MoneyDigits): number {
    return this.toMoney(value, digits);
  }

  private formatDate(date: any): string {
    if (!date) return '';
    if (typeof date === 'string') return date.substring(0, 10);
    if (date instanceof Date) return date.toISOString().substring(0, 10);
    return String(date).substring(0, 10);
  }

  private assertAdmin(auth: AuthContext): void {
    if (auth.role !== 'admin' && auth.role !== 'super_admin') {
      throw new ForbiddenException('هذه العملية تتطلب صلاحية مدير النظام أو المشرف المالي.');
    }
  }

  async listFiscalYears(auth: AuthContext): Promise<{
    data: any[];
    stats: {
      totalYears: number;
      openYears: number;
      closedYears: number;
      currentYearId: number | null;
    };
  }> {
    return this.years.listFiscalYears(auth);
  }

  async getFiscalYear(auth: AuthContext, id: number): Promise<any> {
    return this.years.getFiscalYear(auth, id);
  }

  async createFiscalYear(auth: AuthContext, dto: CreateFiscalYearDto): Promise<any> {
    return this.years.createFiscalYear(auth, dto);
  }

  async previewFiscalYearClose(auth: AuthContext, id: number): Promise<FiscalYearPreviewResult> {
    return this.close.previewFiscalYearClose(auth, id);
  }

  async executeFiscalYearClose(auth: AuthContext, id: number, dto: CloseFiscalYearDto): Promise<any> {
    return this.close.executeFiscalYearClose(auth, id, dto);
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
      const lockedFy = await trx.selectFrom('accounting_fiscal_years')
        .select(['id', 'status', 'closing_entry_id', 'start_date'])
        .where('id', '=', id).where('tenant_id', '=', tenantId)
        .forUpdate().executeTakeFirst();
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
                updated_at: sql`NOW()` as any,
              } as any)
              .where('id', '=', reversalEntryId)
              .where('tenant_id', '=', tenantId)
              .execute();
            await trx.updateTable('journal_entries')
              .set({ reversed_by_entry_id: reversalEntryId, updated_at: sql`NOW()` } as any)
              .where('tenant_id', '=', tenantId).where('id', '=', closingEntry.id).execute();
            await trx.updateTable('journal_entries')
              .set({ reversal_of_entry_id: closingEntry.id, updated_at: sql`NOW()` } as any)
              .where('tenant_id', '=', tenantId).where('id', '=', reversalEntryId).execute();
          }

          // Both closing and reversing entries remain posted and cancel numerically.
        }
      }

      const later = await trx.selectFrom('accounting_fiscal_years')
        .select('id').where('tenant_id', '=', tenantId)
        .where('status', '=', 'closed')
        .where('start_date', '>', lockedFy.start_date)
        .executeTakeFirst();
      if (later) throw new BadRequestException('يجب إعادة فتح السنوات المالية بالترتيب الزمني العكسي.');

      const reopenDay = await resolveBusinessDateKey(trx, tenantId, new Date());
      const reopenLog = `\n[أعيد فتحها بتاريخ ${reopenDay} بواسطة مستخدم #${auth.userId} - السبب: ${reason}]`;
      await trx.updateTable('accounting_fiscal_years')
        .set({
          status: 'open', closing_entry_id: null, closed_at: null, closed_by: null,
          closing_notes: sql`CONCAT(COALESCE(closing_notes, ''), ${reopenLog}::text)` as any,
          updated_at: sql`NOW()` as any,
        })
        .where('id', '=', id).where('tenant_id', '=', tenantId).execute();
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
      start_date: period.startDate as any,
      end_date: period.endDate as any,
      status: 'open' as const,
      created_at: sql`NOW()` as any,
      updated_at: sql`NOW()` as any,
    }));

    if (periodsToInsert.length > 0) {
      await this.db
        .insertInto('accounting_fiscal_periods')
        .values(periodsToInsert)
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'fiscal_year_id', 'period_number']).doNothing(),
        )
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
      closed_at: p.closed_at ? new Date(p.closed_at as any).toISOString() : null,
      created_at: p.created_at ? new Date(p.created_at as any).toISOString() : '',
      updated_at: p.updated_at ? new Date(p.updated_at as any).toISOString() : '',
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

  /**
   * إقفال فترة محاسبية شهرية وتجميد قيودها (البند O6).
   */
  async closeFiscalPeriod(auth: AuthContext, periodId: number, dto: CloseFiscalPeriodDto): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');
    const userId = auth.userId ? Number(auth.userId) : null;

    const period = await this.db
      .selectFrom('accounting_fiscal_periods')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', periodId)
      .executeTakeFirst();

    if (!period) {
      throw new NotFoundException('الفترة المحاسبية غير موجودة.');
    }

    if (period.status === 'closed') {
      throw new BadRequestException('هذه الفترة المحاسبية مقفلة بالفعل.');
    }

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'name', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', period.fiscal_year_id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية التابعة لها الفترة غير موجودة.');
    }

    if (fy.status === 'closed') {
      throw new BadRequestException('السنة المالية التابعة لها هذه الفترة مقفلة بالكامل.');
    }

    const startDateStr = this.formatDate(period.start_date);
    const endDateStr = this.formatDate(period.end_date);

    /**
     * FP-7: FP-2 (الترتيب الزمني) و FP-3 (المسودات) يُفحصان **داخل** المعاملة وتحت قفل الصف، لا قبلها.
     *
     * كانا يُقرآن على `this.db` قبل فتح المعاملة، فبين الفحص والكتابة توجد نافذة: مسودة تُحفظ
     * في تلك اللحظة تقع داخل شهر يُقفل بعدها مباشرةً، فلا تصلح للترحيل أبداً (يمنعها FP-3)
     * ولا يظهر سببها؛ وإقفالان متزامنان لشهرين يمكن أن يتجاوزا الترتيب الزمني معاً.
     * نفس درس F6 وحجز الكوبون واستهلاك رمز الاستعادة: الفحص والكتابة في معاملة واحدة.
     */
    await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const locked = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['id', 'status', 'period_number'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', period.id)
        .forUpdate()
        .executeTakeFirst();

      if (!locked) {
        throw new NotFoundException('الفترة المحاسبية غير موجودة.');
      }
      if (locked.status === 'closed') {
        throw new BadRequestException('هذه الفترة المحاسبية مقفلة بالفعل.');
      }

      // 1. الترتيب الزمني الصارم: لا يجوز إقفال شهر قبل إقفال الشهر السابق له
      const prevOpen = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['id', 'name', 'period_number'])
        .where('tenant_id', '=', tenantId)
        .where('fiscal_year_id', '=', period.fiscal_year_id)
        .where('period_number', '<', period.period_number)
        .where('status', '=', 'open')
        .orderBy('period_number', 'asc')
        .forUpdate()
        .executeTakeFirst();

      if (prevOpen) {
        throw new BadRequestException(
          `لا يمكن إقفال الفترة [${period.name}] قبل إقفال الفترة السابقة [${prevOpen.name}]. يجب إقفال الفترات المحاسبية بترتيب زمني متسلسل.`,
        );
      }

      const today = await resolveBusinessDateKey(trx, tenantId, new Date());
      await this.accountingPosting.recognizeInstallmentInterest(trx, tenantId, endDateStr < today ? endDateStr : today, auth.userId || null);
      await assertAccountingCloseReady(trx, tenantId, startDateStr, endDateStr);

      // 2. التحقق من القيود المعلقة (Draft entries)
      const draftEntries = await trx
        .selectFrom('journal_entries')
        .select(trx.fn.count('id').as('cnt'))
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'draft')
        .where('entry_date', '>=', startDateStr as any)
        .where('entry_date', '<', nextAccountingDay(endDateStr))
        .executeTakeFirst();

      const draftCount = Number(draftEntries?.cnt || 0);
      if (draftCount > 0) {
        throw new BadRequestException(
          `توجد ${draftCount} مسودات قيود محاسبية غير مرحّلة في هذه الفترة (${startDateStr} إلى ${endDateStr}). يجب ترحيلها أو حذفها قبل إقفال الفترة.`,
        );
      }

      // تحديث lock_date_all في accounting_settings
      const currentSettings = await trx
        .selectFrom('accounting_settings')
        .select(['id', 'lock_date_all'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', 1)
        .executeTakeFirst();

      const previousLock = currentSettings?.lock_date_all ? this.formatDate(currentSettings.lock_date_all) : null;

      await trx
        .updateTable('accounting_fiscal_periods')
        .set({
          status: 'closed',
          closed_at: sql`NOW()` as any,
          closed_by: userId,
          closing_notes: dto?.notes ? String(dto.notes).trim() : null,
          // FP-8: اللقطة تُلتقط هنا، قبل رفع القفل — وهي ما يُستعاد عند إعادة الفتح.
          previous_lock_date_all: previousLock as any,
          updated_at: sql`NOW()` as any,
        })
        .where('id', '=', period.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (currentSettings) {
        if (!previousLock || previousLock < endDateStr) {
          await trx
            .updateTable('accounting_settings')
            .set({ lock_date_all: endDateStr as any, updated_at: sql`NOW()` as any })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', 1)
            .execute();
        }
      } else {
        await trx
          .insertInto('accounting_settings')
          .values({ id: 1, tenant_id: tenantId, lock_date_all: endDateStr as any, updated_at: sql`NOW()` as any } as any)
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'id']).doUpdateSet({ lock_date_all: endDateStr as any, updated_at: sql`NOW()` as any } as any),
          )
          .execute();
      }
    });

    return {
      success: true,
      message: `تم إقفال الفترة المحاسبية [${period.name}] بنجاح وتأمين الحسابات حتى ${endDateStr}.`,
    };
  }

  /**
   * إعادة فتح فترة محاسبية شهرية بترتيب زمني عكسي صارم (البند O6).
   */
  async reopenFiscalPeriod(auth: AuthContext, periodId: number, dto: ReopenFiscalPeriodDto): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');
    const reason = String(dto?.reason || '').trim();

    if (!reason) {
      throw new BadRequestException('يجب ذكر سبب إعادة فتح الفترة المحاسبية للرقابة والتدقيق.');
    }

    const period = await this.db
      .selectFrom('accounting_fiscal_periods')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', periodId)
      .executeTakeFirst();

    if (!period) {
      throw new NotFoundException('الفترة المحاسبية غير موجودة.');
    }

    if (period.status !== 'closed') {
      throw new BadRequestException('هذه الفترة المحاسبية مفتوحة بالفعل.');
    }

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'name', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', period.fiscal_year_id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية التابعة لها الفترة غير موجودة.');
    }

    if (fy.status === 'closed') {
      throw new BadRequestException(
        `لا يمكن إعادة فتح فترة في السنة المالية [${fy.name}] لأن السنة المالية نفسها مقفلة. يجب إعادة فتح السنة المالية أولاً.`,
      );
    }

    // FP-7: FP-4 يُفحص داخل المعاملة وتحت قفل الصف، لنفس سبب الإقفال.
    await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const locked = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['id', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', period.id)
        .forUpdate()
        .executeTakeFirst();

      if (!locked) {
        throw new NotFoundException('الفترة المحاسبية غير موجودة.');
      }
      if (locked.status !== 'closed') {
        throw new BadRequestException('هذه الفترة المحاسبية مفتوحة بالفعل.');
      }

      // الترتيب العكسي: لا يمكن إعادة فتح شهر طالما هناك شهر بعده مقفل
      const nextClosed = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['id', 'name', 'period_number'])
        .where('tenant_id', '=', tenantId)
        .where('fiscal_year_id', '=', period.fiscal_year_id)
        .where('period_number', '>', period.period_number)
        .where('status', '=', 'closed')
        .orderBy('period_number', 'desc')
        .forUpdate()
        .executeTakeFirst();

      if (nextClosed) {
        throw new BadRequestException(
          `لا يمكن إعادة فتح الفترة [${period.name}] لأن الفترة اللاحقة [${nextClosed.name}] مقفلة. يجب إعادة فتح الفترات بترتيب زمني عكسي.`,
        );
      }

      const reopenDay = await resolveBusinessDateKey(trx, tenantId, new Date());
      const reopenNote = `\n[أعيد فتحها بتاريخ ${reopenDay} بواسطة مستخدم #${auth.userId} - السبب: ${reason}]`;
      await trx
        .updateTable('accounting_fiscal_periods')
        .set({
          status: 'open',
          closed_at: null,
          closed_by: null,
          closing_notes: sql`CONCAT(COALESCE(closing_notes, ''), ${reopenNote}::text)` as any,
          // اللقطة استُهلكت؛ إقفال لاحق يلتقط قيمة القفل السارية وقتها لا قيمة قديمة.
          previous_lock_date_all: null,
          updated_at: sql`NOW()` as any,
        })
        .where('id', '=', period.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      /**
       * FP-8: إعادة الفتح **تستعيد** القفل ولا تعيد حسابه من الصفر.
       *
       * كان هذا السطر يكتب `lock_date_all` بتاريخ آخر فترة شهرية مقفلة، و`NULL` إن لم توجد —
       * فمنشأة قفلت دفاترها يدوياً حتى 2025-12-31 (الطريقة الوحيدة قبل الفترات الشهرية)، ثم
       * أقفلت شهراً وأعادت فتحه، كان قفلها اليدوي **يُمحى وتُفتح دفاتر سنوات سابقة** بلا أن
       * يطلب أحد ذلك. الآن: نأخذ **الأبعد** بين اللقطة المحفوظة وقت الإقفال وبين نهاية آخر
       * فترة لا تزال مقفلة. القفل لا يتراجع أبداً عن حدٍّ لم يضعه إقفال هذه الفترة.
       */
      const latestClosedPeriod = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['end_date'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'closed')
        .orderBy('end_date', 'desc')
        .executeTakeFirst();

      const fromClosedPeriods = latestClosedPeriod ? this.formatDate(latestClosedPeriod.end_date) : null;
      const snapshot = period.previous_lock_date_all ? this.formatDate(period.previous_lock_date_all) : null;
      const candidates = [fromClosedPeriods, snapshot].filter((value): value is string => Boolean(value));
      const newLock = candidates.length > 0 ? candidates.sort().at(-1)! : null;

      await trx
        .updateTable('accounting_settings')
        .set({ lock_date_all: newLock as any, updated_at: sql`NOW()` as any })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', 1)
        .execute();
    });

    return {
      success: true,
      message: `تم إعادة فتح الفترة المحاسبية [${period.name}] بنجاح وتحديث تاريخ قفل الفترة.`,
    };
  }
}
