import { tenantBaseCurrency } from '../accounting-currency';
import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { AccountingPostingService } from '../accounting-posting.service';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { nextAccountingDay } from '../engines/accounting-date.engine';
import { calculateForexDifference, forexOffsetCode } from '../engines/forex-difference.engine';
import { currencyMoneyDigits, roundMoney } from '../engines/money-minor-units.engine';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** A string DTO body is not runtime validation; PostgreSQL numeric accepts 'NaN'. */
export function validateForexClosingRate(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw new BadRequestException('A finite, positive closing FX rate is required');
  }
  return raw;
}

// D6 (INV-DTO-ACCOUNTING-25): converted from an interface to a decorated
// class in place (DTO contract Rule 5). The preview endpoint takes this
// same class: its caller sends `items` too and the preview service reads
// dto.items (line 157) — a preview DTO without items would 400 every
// real preview call. items entries: the service requires a safe-int
// accountId and a finite foreignBalance (either sign); duplicates and
// the missing-balance-per-account checks stay service-side.
export class ForexRevaluationItemDto {
  @IsInt()
  @Min(1)
  accountId!: number;

  @IsNumber()
  foreignBalance!: number;
}

export class ExecuteForexRevaluationDto {
  @IsDateString()
  @IsNotEmpty()
  periodDate!: string;

  @IsString()
  @IsNotEmpty()
  currencyCode!: string;

  @IsNumber()
  @IsPositive()
  closingRate!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ForexRevaluationItemDto)
  items?: ForexRevaluationItemDto[];
}

@Injectable()
export class ForexRevaluationService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  async listRuns(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const runs = await this.db
      .selectFrom('forex_revaluation_runs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('period_date', 'desc')
      .orderBy('created_at', 'desc')
      .execute();

    return runs;
  }

  async getRunDetails(id: string, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    const run = await this.db
      .selectFrom('forex_revaluation_runs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();

    if (!run) throw new NotFoundException('سجل إعادة التقييم غير موجود.');

    const lines = await this.db
      .selectFrom('forex_revaluation_lines')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('run_id', '=', id)
      .execute();

    return { run, lines };
  }

  async previewRevaluation(dto: ExecuteForexRevaluationDto, auth: AuthContext, queryable: Kysely<Database> = this.db) {
    const { tenantId } = requireTenantScope(auth);
    const currencyCode = String(dto.currencyCode || '')
      .trim()
      .toUpperCase();
    const closingRate = validateForexClosingRate(dto.closingRate);

    if (!currencyCode) throw new BadRequestException('رمز العملة مطلوب.');
    const baseCurrency = await tenantBaseCurrency(queryable, tenantId);
    if (currencyCode === baseCurrency) throw new BadRequestException('عملة الأساس لا يعاد تقييمها.');
    // INV-FX-CONVERSION-SINGLE-ENGINE: foreign balances normalize at the
    // foreign currency's digits, revalued amounts at the base digits, and
    // every 0.01 gate below is one minor unit of the base currency.
    const digits = currencyMoneyDigits(baseCurrency);
    const foreignDigits = currencyMoneyDigits(currencyCode);
    const minorUnit = 10 ** -digits;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dto.periodDate) ||
      Number.isNaN(new Date(dto.periodDate).getTime()) ||
      new Date(dto.periodDate).toISOString().slice(0, 10) !== dto.periodDate
    ) {
      throw new BadRequestException('تاريخ إعادة التقييم غير صالح.');
    }
    // The validated rate is shared by preview and actual execution.

    // Fetch current book rate
    const currentRateRow = await queryable
      .selectFrom('currency_exchange_rates')
      .select(['exchange_rate'])
      .where('tenant_id', '=', tenantId)
      .where('currency_code', '=', currencyCode)
      .executeTakeFirst();

    const bookRate = Number(currentRateRow?.exchange_rate || closingRate);
    if (!Number.isFinite(bookRate) || bookRate <= 0)
      throw new BadRequestException('Stored FX book rate is invalid; correct it before revaluation');

    // IAS 21 §23: retranslate MONETARY items only, and only those denominated in this currency.
    // The previous selection matched on a `name` column and a `type` column that do not exist on
    // accounting_accounts (the real columns are name_ar/name_en and account_type), and joined a
    // `treasuries` table that does not exist in the schema at all — so every call threw at runtime.
    // `(this.db as any)` hid all three errors from the compiler.
    // Fuzzy name matching also cannot distinguish monetary from non-monetary items: an account
    // named "مخزون بضاعة USD" would have been revalued, which is a material misstatement.
    const accounts = await queryable
      .selectFrom('accounting_accounts')
      .select([
        'id',
        'code',
        'name_ar',
        'name_en',
        'account_type',
        'normal_balance',
        'is_control_account',
        'is_receivable',
        'is_payable',
        'is_inventory',
      ])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .where('is_monetary', '=', true)
      .where('revaluation_currency', '=', currencyCode)
      .execute();

    const accountIds = accounts.map((account) => Number(account.id));
    const balances = accountIds.length
      ? await queryable
          .selectFrom('journal_entry_lines as l')
          .innerJoin('journal_entries as h', (join) =>
            join.onRef('h.id', '=', 'l.journal_entry_id').onRef('h.tenant_id', '=', 'l.tenant_id'),
          )
          .select(['l.account_id', sql<number>`COALESCE(SUM(l.debit - l.credit), 0)`.as('balance')])
          .where('l.tenant_id', '=', tenantId)
          .where('l.account_id', 'in', accountIds)
          .where('h.status', '=', 'posted')
          .where('h.entry_date', '<', nextAccountingDay(dto.periodDate))
          .groupBy('l.account_id')
          .execute()
      : [];
    const balanceByAccount = new Map(balances.map((row) => [Number(row.account_id), Number(row.balance || 0)]));

    const lines: any[] = [];
    let totalForeign = 0;
    let totalUnrealizedGainLoss = 0;
    const items = dto.items || [];
    const userItemMap = new Map<number, number>();
    for (const item of items) {
      if (
        !Number.isSafeInteger(Number(item.accountId)) ||
        !Number.isFinite(item.foreignBalance) ||
        userItemMap.has(Number(item.accountId))
      ) {
        throw new BadRequestException('رصيد العملة الأجنبية أو الحساب غير صالح أو مكرر.');
      }
      userItemMap.set(Number(item.accountId), item.foreignBalance);
    }

    const mapped = await queryable
      .selectFrom('accounting_settings')
      .select(['customer_receivable_account_id', 'supplier_payable_account_id', 'inventory_account_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', 1)
      .executeTakeFirst();
    const controlIds = new Set(Object.values(mapped || {}).map(Number));
    for (const acc of accounts) {
      if (
        acc.is_control_account ||
        acc.is_receivable ||
        acc.is_payable ||
        acc.is_inventory ||
        ['1130', '1140', '2110'].includes(acc.code) ||
        controlIds.has(Number(acc.id))
      )
        throw new BadRequestException(
          'إعادة تقييم الحساب الرقابي تتطلب مراكز عملة مفصلة للشركاء؛ استخدم حساب فروق مستقل إلى حين توفيرها.',
        );
      const localBalance = balanceByAccount.get(Number(acc.id)) || 0;
      if (Math.abs(localBalance) > minorUnit) {
        const userForeign = userItemMap.get(Number(acc.id));
        if (userForeign === undefined) {
          throw new BadRequestException(`يجب إدخال الرصيد الفعلي بالعملة الأجنبية للحساب [${acc.code}].`);
        }
        const signedForeign = localBalance < 0 && userForeign > 0 ? -userForeign : userForeign;
        const foreignBalance = roundMoney(signedForeign, foreignDigits);
        const { revaluedLocal, difference: diff } = calculateForexDifference(
          localBalance,
          foreignBalance,
          closingRate,
          digits,
        );

        lines.push({
          accountId: acc.id,
          accountCode: acc.code,
          accountName: acc.name_ar || acc.name_en,
          foreignBalance,
          bookLocalValue: localBalance,
          revaluedLocalValue: revaluedLocal,
          unrealizedDifference: diff,
        });

        totalForeign += foreignBalance;
        totalUnrealizedGainLoss += diff;
      }
    }

    return {
      periodDate: dto.periodDate,
      currencyCode,
      bookRate,
      closingRate,
      bookDigits: digits,
      totalForeignBalance: roundMoney(totalForeign, foreignDigits),
      netUnrealizedGainLoss: roundMoney(totalUnrealizedGainLoss, digits),
      lines,
    };
  }

  async executeRevaluation(dto: ExecuteForexRevaluationDto, auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    dto = {
      ...dto,
      currencyCode: String(dto.currencyCode || '')
        .trim()
        .toUpperCase(),
    };
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId} || ':forex:' || ${dto.periodDate} || ':' || ${dto.currencyCode}))`.execute(
        trx,
      );
      const preview = await this.previewRevaluation(dto, auth, trx);
      const minorUnit = 10 ** -preview.bookDigits;

      if (preview.lines.length === 0) {
        throw new BadRequestException('لا توجد أرصدة أو حسابات أجنبية تتطلب إعادة تقييم في هذا التاريخ.');
      }

      const isGain = preview.netUnrealizedGainLoss >= 0;
      const absDiff = Math.abs(preview.netUnrealizedGainLoss);
      const hasRevaluation = preview.lines.some((line) => Math.abs(line.unrealizedDifference) >= minorUnit);
      const gainLossCode = forexOffsetCode(preview.netUnrealizedGainLoss);
      const gainLossType = isGain ? 'revenue' : 'expense';
      let gainLossAccount =
        absDiff >= minorUnit
          ? await trx
              .selectFrom('accounting_accounts')
              .select(['id', 'is_active', 'account_type', 'name_en'])
              .where('tenant_id', '=', tenantId)
              .where('code', '=', gainLossCode)
              .executeTakeFirst()
          : null;
      if (absDiff >= minorUnit && !gainLossAccount) {
        const parent = await trx
          .selectFrom('accounting_accounts')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('code', '=', isGain ? '7100' : '7200')
          .executeTakeFirst();
        if (!parent) throw new BadRequestException('حساب الإيرادات أو المصروفات الأخرى غير موجود.');
        await trx
          .insertInto('accounting_accounts')
          .values({
            tenant_id: tenantId,
            account_id: auth.accountId || tenantId,
            code: gainLossCode,
            name_ar: isGain ? 'أرباح فروق عملة غير محققة' : 'خسائر فروق عملة غير محققة',
            name_en: isGain ? 'Unrealized FX Gains' : 'Unrealized FX Losses',
            account_type: gainLossType,
            normal_balance: isGain ? 'credit' : 'debit',
            account_group: isGain ? 'income' : 'operating_expenses',
            parent_id: Number(parent.id),
            is_active: true,
            is_system: true,
            allow_manual_entries: false,
            is_control_account: false,
            is_cash_bank: false,
            is_receivable: false,
            is_payable: false,
            is_inventory: false,
            is_tax: false,
            description_ar: '',
            sort_order: Number(gainLossCode),
          })
          .onConflict((oc) => oc.columns(['tenant_id', 'code']).doNothing())
          .execute();
        gainLossAccount = await trx
          .selectFrom('accounting_accounts')
          .select(['id', 'is_active', 'account_type', 'name_en'])
          .where('tenant_id', '=', tenantId)
          .where('code', '=', gainLossCode)
          .executeTakeFirst();
      }
      if (
        gainLossAccount &&
        (!gainLossAccount.is_active ||
          gainLossAccount.account_type !== gainLossType ||
          gainLossAccount.name_en !== (isGain ? 'Unrealized FX Gains' : 'Unrealized FX Losses'))
      ) {
        throw new BadRequestException('حساب فروق العملة غير نشط أو تصنيفه غير صحيح.');
      }

      // Build journal entry lines if difference != 0
      let createdEntryId: number | null = null;
      let entryNo: string | null = null;

      if (absDiff >= minorUnit && !gainLossAccount) {
        throw new BadRequestException('حساب فروق العملة غير موجود؛ لا يمكن ترحيل إعادة التقييم.');
      }

      const existingRun = await trx
        .selectFrom('forex_revaluation_runs')
        .select(['id', 'status', 'journal_entry_no'])
        .where('tenant_id', '=', tenantId)
        .where('period_date', '=', dto.periodDate)
        .where('currency_code', '=', dto.currencyCode)
        .where('status', '=', 'posted')
        .executeTakeFirst();

      if (existingRun) {
        throw new BadRequestException(
          `تم إجراء إعادة تقييم عملة (${dto.currencyCode}) لهذه الفترة (${dto.periodDate}) مسبقاً برقم قيد [${existingRun.journal_entry_no || existingRun.id}].`,
        );
      }

      if (hasRevaluation) {
        const entryLines: any[] = [];

        for (const line of preview.lines) {
          if (Math.abs(line.unrealizedDifference) >= minorUnit) {
            if (line.unrealizedDifference > 0) {
              // Asset increased in local currency value -> Debit Asset
              entryLines.push({
                account_id: line.accountId,
                debit: line.unrealizedDifference,
                credit: 0,
                description: `أرباح تقييم فروق عملة ${dto.currencyCode} لحساب ${line.accountName}`,
              });
            } else {
              // Asset decreased in local currency value -> Credit Asset
              entryLines.push({
                account_id: line.accountId,
                debit: 0,
                credit: Math.abs(line.unrealizedDifference),
                description: `خسائر تقييم فروق عملة ${dto.currencyCode} لحساب ${line.accountName}`,
              });
            }
          }
        }

        // Offsetting Gain/Loss Line
        if (absDiff >= minorUnit && isGain) {
          entryLines.push({
            account_id: gainLossAccount!.id,
            debit: 0,
            credit: absDiff,
            description: `إثبات أرباح فروق عملة غير محققة (${dto.currencyCode}) بنهاية فترة ${dto.periodDate}`,
          });
        } else if (absDiff >= minorUnit) {
          entryLines.push({
            account_id: gainLossAccount!.id,
            debit: absDiff,
            credit: 0,
            description: `إثبات خسائر فروق عملة غير محققة (${dto.currencyCode}) بنهاية فترة ${dto.periodDate}`,
          });
        }

        const description = `قيد تسوية فروق تقييم العملة الأجنبية (${dto.currencyCode}) بسعر ${dto.closingRate} ج.م وفق معيار IAS 21`;
        const entryId = await this.accountingPosting.postDomainJournal(trx, {
          sourceType: 'forex_revaluation',
          sourceId: 0,
          tenantId,
          accountId: auth.accountId || tenantId,
          entryDate: new Date(dto.periodDate),
          description,
          createdBy: auth.userId || null,
          lines: entryLines.map((line) => ({
            accountId: Number(line.account_id),
            description: line.description,
            debit: Number(line.debit),
            credit: Number(line.credit),
            partnerType: 'none' as const,
            partnerId: null,
            branchId: null,
            locationId: null,
          })),
        });
        createdEntryId = entryId;
        entryNo = formatDailyDocumentNumber(
          `FX-${dto.currencyCode}`,
          entryId,
          new Date(dto.periodDate),
          4,
          await getTenantTimezone(trx, tenantId),
        );

        await trx
          .updateTable('journal_entries')
          .set({
            entry_no: entryNo,
            updated_at: sql`NOW()` as any,
          } as any)
          .where('id', '=', entryId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // Save run record
      const runRow = await trx
        .insertInto('forex_revaluation_runs')
        .values({
          tenant_id: tenantId,
          period_date: dto.periodDate,
          currency_code: dto.currencyCode,
          book_exchange_rate: preview.bookRate,
          closing_exchange_rate: dto.closingRate,
          foreign_balance_total: preview.totalForeignBalance,
          unrealized_gain_loss: preview.netUnrealizedGainLoss,
          journal_entry_id: createdEntryId,
          journal_entry_no: entryNo,
          // INV-ZERO-DIFFERENCE-REVALUATION-NEVER-LOCKS: only a run
          // that actually posted a journal locks the period/currency
          // (the duplicate guard above matches status 'posted'). A
          // zero-difference run posted nothing, so it is recorded as
          // 'no_difference' for audit — and a later run with a
          // corrected closing rate can still execute for the period.
          status: createdEntryId ? 'posted' : 'no_difference',
          notes: dto.notes || `إعادة تقييم فروق عملة ${dto.currencyCode} بنهاية فترة ${dto.periodDate}`,
          created_by: auth.userId || 0,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (createdEntryId) {
        await trx
          .updateTable('journal_entries')
          .set({ source_id: Number(runRow.id), updated_at: sql`NOW()` as any } as any)
          .where('id', '=', createdEntryId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // Insert detail lines
      const lineRows = preview.lines.map((l) => ({
        tenant_id: tenantId,
        run_id: String(runRow.id),
        account_id: String(l.accountId),
        account_code: l.accountCode,
        account_name: l.accountName,
        foreign_balance: l.foreignBalance,
        book_local_value: l.bookLocalValue,
        revalued_local_value: l.revaluedLocalValue,
        unrealized_difference: l.unrealizedDifference,
      }));

      if (lineRows.length > 0) {
        await trx
          .insertInto('forex_revaluation_lines')
          .values(lineRows as any)
          .execute();
      }

      // Update the currency rate in currency_exchange_rates to the new closing rate
      await trx
        .updateTable('currency_exchange_rates')
        .set({
          exchange_rate: dto.closingRate,
          updated_at: sql`NOW()`,
        } as any)
        .where('tenant_id', '=', tenantId)
        .where('currency_code', '=', dto.currencyCode)
        .execute();

      return {
        ok: true,
        runId: runRow.id,
        journalEntryNo: entryNo,
        netUnrealizedGainLoss: preview.netUnrealizedGainLoss,
        totalForeignBalance: preview.totalForeignBalance,
        linesCount: preview.lines.length,
      };
    });
  }
}
