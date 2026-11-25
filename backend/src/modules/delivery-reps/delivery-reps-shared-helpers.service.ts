/**
 * DeliveryRepsSharedHelpersService — slice S6 of the delivery-reps split.
 * Pure move of the two cross-slice private helpers from DeliveryRepsService:
 * the delivery-fee-mode lookup and the per-order cash-due formula. No
 * behavior change: the bodies are byte-identical apart from the visibility
 * keyword (public in the slice so the facade delegates can call them).
 * Deps: the database plus the posting service, and the tenant predicate
 * bound from the facade and stored under its original name. The facade
 * keeps two thin private delegates with the original signatures.
 */

import { Injectable } from '@nestjs/common';
import { Kysely } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../database/database.types';
import { roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';

export interface DeliveryRepsSharedHelpersDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;
}

@Injectable()
export class DeliveryRepsSharedHelpersService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;

  constructor(deps: DeliveryRepsSharedHelpersDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.tenantPredicate = deps.tenantPredicate;
  }

  async getDeliveryFeeMode(trx: Kysely<Database>, actor: AuthContext): Promise<'freelance_courier' | 'store_fleet'> {
    const row = await trx
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'deliveryFeeMode')
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!row?.value) return 'freelance_courier';
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return parsed === 'store_fleet' ? 'store_fleet' : 'freelance_courier';
    } catch {
      return String(row.value).includes('store_fleet') ? 'store_fleet' : 'freelance_courier';
    }
  }

  /**
   * INV-SF-REP-CUSTODY-NET-RETURNS (D-SF-10): the cash a rep still
   * owes (pending) or has handed over (collected) for ONE order,
   * derived from deliverySettlementBasis — the single source of
   * truth the settle gates and postDeliveryRepSettlement already
   * use — never from gross sales.total. A prior return already
   * reversed part of the receivable (and relieved part of the
   * fee), so the gross total charges the rep for money the
   * customer no longer owes (live divergence 131.60: return
   * ZR-261110-0601 reversed the sale JE while the badge kept
   * 131.60). The formula is settleAllOrders' cashDue exactly:
   * store-fleet owes the remaining receivable; a freelance
   * courier owes it minus the remaining fee, floored at zero.
   *
   * INV-REP-PREPAID-SHIFT-TREASURY (M6/A7): a rep-prepaid order
   * owes the PAID amount, not the remaining receivable — the sale
   * posted as paid at creation, so the remaining receivable is
   * already zero while the rep still holds the cash. The rep hands
   * over the paid amount minus the remaining courier fee (zero for
   * a store-fleet sale: the basis already reports a zero remaining
   * fee for it), floored at zero. The fee still comes from the
   * basis, so a prior return that relieved part of the fee is
   * honoured exactly like the COD formula.
   */
  async repOrderCashDue(
    order: {
      id: number;
      delivery_fee_mode: string | null;
      collection_status?: string | null;
      paid_amount?: number | string | null;
    },
    defaultMode: 'freelance_courier' | 'store_fleet',
    moneyDigits: MoneyDigits,
    actor: AuthContext,
  ): Promise<number> {
    const basis = await this.accountingPosting.deliverySettlementBasis(this.db, Number(order.id), actor);
    if (String(order.collection_status || '') === 'prepaid_by_rep') {
      return Math.max(0, roundMoney(Number(order.paid_amount || 0) - basis.remainingFee, moneyDigits));
    }
    return (order.delivery_fee_mode || defaultMode) === 'store_fleet'
      ? basis.remainingReceivable
      : Math.max(0, roundMoney(basis.remainingReceivable - basis.remainingFee, moneyDigits));
  }
}
