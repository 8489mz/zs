import { tenantBaseCurrency } from '../../accounting-currency';
import { resolveBusinessDateKey } from '../../engines/accounting-date.engine';
import { currencyMoneyDigits, type MoneyDigits } from '../../engines/money-minor-units.engine';
import { BadRequestException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Database } from '../../../../database/database.types';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { PdcChequesStats } from './pdc-cheques.types';

export interface ChequesStatsBoundDeps {
  toMoney(value: unknown, digits: MoneyDigits): number;
  formatDate(date: any): string;
}

export class ChequesStatsSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: ChequesStatsBoundDeps,
  ) {}

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private formatDate(date: any): string {
    return this.bound.formatDate(date);
  }
  /**
   * Get high-level KPI stats for Cheques Portfolio
   */
  async getStats(authContext: AuthContext): Promise<PdcChequesStats> {
    const tenantId = String(authContext.tenantId || '');
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
    // +7 calendar days from the tenant-local day (calendar math on a day string, not an instant cut).
    const in7DaysDate = new Date(`${today}T00:00:00.000Z`);
    in7DaysDate.setUTCDate(in7DaysDate.getUTCDate() + 7);
    const in7Days = `${in7DaysDate.getUTCFullYear()}-${String(in7DaysDate.getUTCMonth() + 1).padStart(2, '0')}-${String(in7DaysDate.getUTCDate()).padStart(2, '0')}`;

    const rows = await (this.db as any)
      .selectFrom('accounting_cheques')
      .where('tenant_id', '=', tenantId)
      .select(['type', 'status', 'amount', 'base_amount', 'currency', 'due_date'])
      .execute();

    const stats: PdcChequesStats = {
      receivables: {
        totalCount: 0,
        totalAmount: 0,
        inSafeCount: 0,
        inSafeAmount: 0,
        underCollectionCount: 0,
        underCollectionAmount: 0,
        collectedCount: 0,
        collectedAmount: 0,
        bouncedCount: 0,
        bouncedAmount: 0,
        dueSoonCount: 0,
        dueSoonAmount: 0,
        overdueCount: 0,
        overdueAmount: 0,
      },
      payables: {
        totalCount: 0,
        totalAmount: 0,
        issuedCount: 0,
        issuedAmount: 0,
        clearedCount: 0,
        clearedAmount: 0,
        bouncedCount: 0,
        bouncedAmount: 0,
        dueSoonCount: 0,
        dueSoonAmount: 0,
        overdueCount: 0,
        overdueAmount: 0,
      },
    };

    const base = await tenantBaseCurrency(this.db, tenantId);
    const baseDigits = currencyMoneyDigits(base);
    if (rows.some((r: any) => r.base_amount == null && r.currency !== base))
      throw new BadRequestException('إحصاءات الحافظة تتطلب مطابقة الشيكات الأجنبية القديمة أولاً.');
    for (const r of rows) {
      const amount = this.toMoney(r.base_amount ?? r.amount, baseDigits);
      const dueDate = this.formatDate(r.due_date);
      const isReceivable = r.type === 'receivable';

      if (isReceivable) {
        stats.receivables.totalCount += 1;
        stats.receivables.totalAmount = this.toMoney(stats.receivables.totalAmount + amount, baseDigits);

        if (r.status === 'in_safe') {
          stats.receivables.inSafeCount += 1;
          stats.receivables.inSafeAmount = this.toMoney(stats.receivables.inSafeAmount + amount, baseDigits);
        } else if (r.status === 'under_collection') {
          stats.receivables.underCollectionCount += 1;
          stats.receivables.underCollectionAmount = this.toMoney(
            stats.receivables.underCollectionAmount + amount,
            baseDigits,
          );
        } else if (r.status === 'collected') {
          stats.receivables.collectedCount += 1;
          stats.receivables.collectedAmount = this.toMoney(stats.receivables.collectedAmount + amount, baseDigits);
        } else if (r.status === 'bounced') {
          stats.receivables.bouncedCount += 1;
          stats.receivables.bouncedAmount = this.toMoney(stats.receivables.bouncedAmount + amount, baseDigits);
        }

        const isSettled = ['collected', 'cancelled', 'returned', 'endorsed'].includes(r.status);
        if (!isSettled) {
          if (dueDate < today) {
            stats.receivables.overdueCount += 1;
            stats.receivables.overdueAmount = this.toMoney(stats.receivables.overdueAmount + amount, baseDigits);
          } else if (dueDate >= today && dueDate <= in7Days) {
            stats.receivables.dueSoonCount += 1;
            stats.receivables.dueSoonAmount = this.toMoney(stats.receivables.dueSoonAmount + amount, baseDigits);
          }
        }
      } else {
        // Payable
        stats.payables.totalCount += 1;
        stats.payables.totalAmount = this.toMoney(stats.payables.totalAmount + amount, baseDigits);

        if (r.status === 'issued') {
          stats.payables.issuedCount += 1;
          stats.payables.issuedAmount = this.toMoney(stats.payables.issuedAmount + amount, baseDigits);
        } else if (r.status === 'cleared') {
          stats.payables.clearedCount += 1;
          stats.payables.clearedAmount = this.toMoney(stats.payables.clearedAmount + amount, baseDigits);
        } else if (r.status === 'bounced') {
          stats.payables.bouncedCount += 1;
          stats.payables.bouncedAmount = this.toMoney(stats.payables.bouncedAmount + amount, baseDigits);
        }

        const isSettled = ['cleared', 'cancelled'].includes(r.status);
        if (!isSettled) {
          if (dueDate < today) {
            stats.payables.overdueCount += 1;
            stats.payables.overdueAmount = this.toMoney(stats.payables.overdueAmount + amount, baseDigits);
          } else if (dueDate >= today && dueDate <= in7Days) {
            stats.payables.dueSoonCount += 1;
            stats.payables.dueSoonAmount = this.toMoney(stats.payables.dueSoonAmount + amount, baseDigits);
          }
        }
      }
    }

    return stats;
  }
}
