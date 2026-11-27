import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { resolveBusinessDateKey } from '../engines/accounting-date.engine';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../engines/money-minor-units.engine';
import { type CreateFiscalYearDto } from './fiscal-year.types';

/**
 * FiscalYearYearsService — slice S1 of the fiscal-year split.
 * Pure move of the three year methods from FiscalYearService. No
 * behavior change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures. The four pure kernel
 * helpers stay in the facade and are bound here through the Deps
 * interface, as is the later-slice method the create method calls — the
 * facade's own delegate exists before that slice lands and as the
 * delegate after, so this slice is merge-order-independent.
 */

export interface FiscalYearYearsDeps {
  db: Kysely<Database>;
  formatDate: (date: any) => string;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
  assertAdmin: (auth: AuthContext) => void;
  ensurePeriodsForFiscalYear: (
    tenantId: string,
    fiscalYearId: number,
    startDateStr: string,
    endDateStr: string,
  ) => Promise<void>;
}

@Injectable()
export class FiscalYearYearsService {
  private readonly db: Kysely<Database>;
  private readonly formatDate: (date: any) => string;
  private readonly toMoney: (value: unknown, digits: MoneyDigits) => number;
  private readonly assertAdmin: (auth: AuthContext) => void;
  private readonly ensurePeriodsForFiscalYear: (
    tenantId: string,
    fiscalYearId: number,
    startDateStr: string,
    endDateStr: string,
  ) => Promise<void>;

  constructor(deps: FiscalYearYearsDeps) {
    this.db = deps.db;
    this.formatDate = deps.formatDate;
    this.toMoney = deps.toMoney;
    this.assertAdmin = deps.assertAdmin;
    this.ensurePeriodsForFiscalYear = deps.ensurePeriodsForFiscalYear;
  }

  /**
   * List all fiscal years for the tenant with overall stats
   */
  async listFiscalYears(auth: AuthContext): Promise<{
    data: any[];
    stats: {
      totalYears: number;
      openYears: number;
      closedYears: number;
      currentYearId: number | null;
    };
  }> {
    const tenantId = String(auth.tenantId || '');
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));

    const years = await this.db
      .selectFrom('accounting_fiscal_years')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('start_date', 'desc')
      .execute();

    let openYears = 0;
    let closedYears = 0;
    let currentYearId: number | null = null;

    const formatted = years.map((y) => {
      const start = this.formatDate(y.start_date);
      const end = this.formatDate(y.end_date);
      if (y.status === 'closed') {
        closedYears++;
      } else {
        openYears++;
      }
      if (today >= start && today <= end) {
        currentYearId = y.id;
      }
      return {
        ...y,
        start_date: start,
        end_date: end,
        net_profit_loss: this.toMoney(y.net_profit_loss, digits),
        total_revenue: this.toMoney(y.total_revenue, digits),
        total_expense: this.toMoney(y.total_expense, digits),
      };
    });

    return {
      data: formatted,
      stats: {
        totalYears: years.length,
        openYears,
        closedYears,
        currentYearId,
      },
    };
  }

  /**
   * Get single fiscal year details
   */
  async getFiscalYear(auth: AuthContext, id: number): Promise<any> {
    const tenantId = String(auth.tenantId || '');
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    let closingEntry: any = null;
    if (fy.closing_entry_id) {
      closingEntry = await this.db
        .selectFrom('journal_entries')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', fy.closing_entry_id)
        .executeTakeFirst();
    }

    return {
      ...fy,
      start_date: this.formatDate(fy.start_date),
      end_date: this.formatDate(fy.end_date),
      net_profit_loss: this.toMoney(fy.net_profit_loss, digits),
      total_revenue: this.toMoney(fy.total_revenue, digits),
      total_expense: this.toMoney(fy.total_expense, digits),
      closingEntry,
    };
  }

  /**
   * Create a new fiscal year period
   */
  async createFiscalYear(auth: AuthContext, dto: CreateFiscalYearDto): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');

    const name = String(dto.name || '').trim();
    if (!name) {
      throw new BadRequestException('يجب إدخال اسم السنة المالية (مثال: السنة المالية 2025).');
    }

    const startDate = this.formatDate(dto.startDate);
    const endDate = this.formatDate(dto.endDate);

    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ بداية وتاريخ نهاية صالحين للسنة المالية.');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('تاريخ بداية السنة المالية يجب أن يكون قبل تاريخ النهاية.');
    }

    // Check overlapping periods in same tenant
    const overlapping = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'name', 'start_date', 'end_date'])
      .where('tenant_id', '=', tenantId)
      .where('start_date', '<=', endDate)
      .where('end_date', '>=', startDate)
      .executeTakeFirst();

    if (overlapping) {
      throw new BadRequestException(
        `توجد سنة مالية أخرى [${overlapping.name}] تتداخل مع هذه الفترة (${this.formatDate(overlapping.start_date)} إلى ${this.formatDate(overlapping.end_date)}).`,
      );
    }

    // The overlap SELECT above is only for a friendly message; it races with concurrent creates.
    // accounting_fiscal_years_no_overlap (EXCLUDE ... USING gist) is the actual guarantee.
    let inserted;
    try {
      inserted = await this.db
        .insertInto('accounting_fiscal_years')
        .values({
          tenant_id: tenantId,
          name,
          code: dto.code ? String(dto.code).trim() : null,
          start_date: startDate,
          end_date: endDate,
          status: 'open',
          net_profit_loss: 0,
          total_revenue: 0,
          total_expense: 0,
          created_at: sql`NOW()`,
          updated_at: sql`NOW()`,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (error: any) {
      if (error?.code === '23P01' || String(error?.constraint || '') === 'accounting_fiscal_years_no_overlap') {
        throw new BadRequestException('توجد سنة مالية أخرى تتداخل مع هذه الفترة. يرجى مراجعة التواريخ.');
      }
      throw error;
    }

    // Auto-generate 12 monthly fiscal periods for this fiscal year (البند O6)
    await this.ensurePeriodsForFiscalYear(tenantId, inserted.id, startDate, endDate);

    return {
      ...inserted,
      start_date: this.formatDate(inserted.start_date),
      end_date: this.formatDate(inserted.end_date),
    };
  }
}
