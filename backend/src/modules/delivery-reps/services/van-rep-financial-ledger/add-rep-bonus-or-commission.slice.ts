import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  roundMoney,
  type MoneyDigits,
} from '../../../accounting/engines/money-minor-units.engine';
import type { VanRepFinancialLedgerDeps } from './van-rep-financial-ledger.types';

export class AddRepBonusOrCommissionSlice {
  constructor(private readonly deps: VanRepFinancialLedgerDeps) {}

  private get anyDb(): any {
    return this.deps.db;
  }

  /**
   * Add manual bonus or commission to representative financial ledger.
   */
  async addRepBonusOrCommission(
    tenantId: string,
    accountId: string,
    payload: {
      repId: number;
      entryType: 'bonus' | 'commission';
      amount: number;
      notes: string;
    },
    authContext: AuthContext,
  ) {
    const rep = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name'])
      .where('id', '=', payload.repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!rep) throw new AppError('مندوب التوزيع غير موجود', 'REP_NOT_FOUND', 404);

    // Book digits resolved once (D4): the bonus/commission amount
    // below rounds at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const amount = roundMoney(Number(payload.amount || 0), moneyDigits);
    if (amount <= 0) throw new AppError('يجب أن يكون المبلغ أكبر من صفر', 'INVALID_AMOUNT', 400);

    const inserted = await this.anyDb
      .insertInto('van_rep_financial_settlements')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        rep_id: payload.repId,
        trip_id: null,
        entry_type: payload.entryType,
        amount,
        status: 'pending',
        notes: payload.notes || (payload.entryType === 'bonus' ? 'مكافأة تميز ميداني' : 'عمولة مبيعات'),
        created_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .returning(['id', 'amount', 'entry_type as entryType', 'status'])
      .executeTakeFirst();

    return {
      ok: true,
      settlement: inserted,
      repName: rep.name,
    };
  }
}
