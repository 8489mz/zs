import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { CloseFiscalPeriodDto, ReopenFiscalPeriodDto, FiscalPeriodResponse } from '../dto/fiscal-period.dto';
import { AccountingPostingService } from '../accounting-posting.service';
import { roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';
import { FiscalYearPeriodCloseService } from './fiscal-year-period-close.service';
import { FiscalYearPeriodsService } from './fiscal-year-periods.service';
import { FiscalYearCloseService } from './fiscal-year-close.service';
import { FiscalYearYearsService } from './fiscal-year-years.service';
import type {
  CreateFiscalYearDto,
  CloseFiscalYearDto,
  ReopenFiscalYearDto,
  FiscalYearPreviewResult,
} from './fiscal-year.types';
export type {
  CreateFiscalYearDto,
  CloseFiscalYearDto,
  ReopenFiscalYearDto,
  FiscalYearAccountBalance,
  ProposedClosingLine,
  FiscalYearPreviewResult,
} from './fiscal-year.types';
export { fiscalProfitAndLossCategory, resolveClosingJournalAccounts } from './fiscal-year.types';

@Injectable()
export class FiscalYearService {
  private readonly years: FiscalYearYearsService;
  private readonly close: FiscalYearCloseService;
  private readonly periods: FiscalYearPeriodsService;
  private readonly periodClose: FiscalYearPeriodCloseService;

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
    this.periods = new FiscalYearPeriodsService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      formatDate: this.formatDate.bind(this),
      assertAdmin: this.assertAdmin.bind(this),
    });
    this.periodClose = new FiscalYearPeriodCloseService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      formatDate: this.formatDate.bind(this),
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

  async reopenFiscalYear(auth: AuthContext, id: number, dto: ReopenFiscalYearDto): Promise<any> {
    return this.periods.reopenFiscalYear(auth, id, dto);
  }

  async deleteFiscalYear(auth: AuthContext, id: number): Promise<any> {
    return this.periods.deleteFiscalYear(auth, id);
  }

  async ensurePeriodsForFiscalYear(
    tenantId: string,
    fiscalYearId: number,
    startDateStr: string,
    endDateStr: string,
  ): Promise<void> {
    return this.periods.ensurePeriodsForFiscalYear(tenantId, fiscalYearId, startDateStr, endDateStr);
  }

  async listFiscalPeriods(auth: AuthContext, fiscalYearId: number): Promise<FiscalPeriodResponse[]> {
    return this.periods.listFiscalPeriods(auth, fiscalYearId);
  }

  async generateFiscalPeriods(auth: AuthContext, fiscalYearId: number): Promise<FiscalPeriodResponse[]> {
    return this.periods.generateFiscalPeriods(auth, fiscalYearId);
  }

  async closeFiscalPeriod(auth: AuthContext, periodId: number, dto: CloseFiscalPeriodDto): Promise<any> {
    return this.periodClose.closeFiscalPeriod(auth, periodId, dto);
  }

  async reopenFiscalPeriod(auth: AuthContext, periodId: number, dto: ReopenFiscalPeriodDto): Promise<any> {
    return this.periodClose.reopenFiscalPeriod(auth, periodId, dto);
  }
}
