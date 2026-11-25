import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { type Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { CloseFiscalPeriodDto, ReopenFiscalPeriodDto } from '../dto/fiscal-period.dto';
import { type AccountingPostingService } from '../accounting-posting.service';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { nextAccountingDay, resolveBusinessDateKey } from '../engines/accounting-date.engine';
import { assertAccountingCloseReady } from '../accounting-close-readiness';

/**
 * FiscalYearPeriodCloseService — slice S4 of the fiscal-year split.
 * Pure move of the monthly period closing and reopening from the
 * fiscal-year service. No behavior change: the bodies are
 * byte-identical; the facade keeps thin public delegates with the
 * same names and signatures. This slice reaches the kernel helpers
 * only through bound deps — it never imports another slice service.
 * Each operation runs inside one transaction; the lock snapshot is
 * written by the same transaction that freezes the period.
 */

export interface FiscalYearPeriodCloseDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  // Bound kernel helpers (stay in the facade; passed bound so the moved
  // bodies stay byte-identical).
  formatDate: (date: any) => string;
  assertAdmin: (auth: AuthContext) => void;
}

@Injectable()
export class FiscalYearPeriodCloseService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly formatDate: (date: any) => string;
  private readonly assertAdmin: (auth: AuthContext) => void;

  constructor(deps: FiscalYearPeriodCloseDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.formatDate = deps.formatDate;
    this.assertAdmin = deps.assertAdmin;
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
      await this.accountingPosting.recognizeInstallmentInterest(
        trx,
        tenantId,
        endDateStr < today ? endDateStr : today,
        auth.userId || null,
      );
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
          .values({
            id: 1,
            tenant_id: tenantId,
            lock_date_all: endDateStr as any,
            updated_at: sql`NOW()` as any,
          } as any)
          .onConflict((oc) =>
            oc
              .columns(['tenant_id', 'id'])
              .doUpdateSet({ lock_date_all: endDateStr as any, updated_at: sql`NOW()` as any } as any),
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
