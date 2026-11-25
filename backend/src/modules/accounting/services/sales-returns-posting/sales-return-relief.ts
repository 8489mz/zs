import { sql } from '../../../../database/kysely';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx } from '../../accounting-posting.service';
import type { SalesAndReturnsPostingDeps } from './sales-returns-posting-types';

export class SalesReturnReliefService {
  constructor(private readonly toMoney: SalesAndReturnsPostingDeps['toMoney']) {}

  /**
   * R6-E (INV-REST-SALE-MONEY-TRUTH-2) + R7-A F3: tip / courier-fee
   * relief already posted by earlier returns of the same sale, read
   * back from their posted return journals. Prior returns are found
   * via return_documents.invoice_id; their journals via
   * journal_entries.source_type IN ('sales_return','return'). The
   * 2147/2115 legs carry partnerType 'none', so there is no
   * per-sale subledger to read — the posted return journals ARE
   * the record. Exchange-collected returns post no return journal
   * (their lines ride inside the new sale's journal), so their
   * relief is read from the return row instead
   * (exchange_tip_relief / exchange_courier_relief, migration
   * 0311, recorded by postSalesReturn in the collectExchangeLines
   * branch). A prior return is counted exactly once: from its
   * journal when one exists, from its row columns otherwise.
   */
  async priorSalesReturnRelief(
    queryable: DbOrTx,
    tenantId: string,
    saleId: number,
    excludeReturnId: number | null,
  ): Promise<{ tip: number; courier: number }> {
    const empty = { tip: 0, courier: 0 };
    let priorReturnsQuery = queryable
      .selectFrom('return_documents')
      .select(['id', 'exchange_tip_relief', 'exchange_courier_relief'])
      .where('invoice_id', '=', saleId)
      .where('return_type', '=', 'sale')
      .where(sql<boolean>`tenant_id = ${tenantId}`);
    if (excludeReturnId != null) {
      priorReturnsQuery = priorReturnsQuery.where('id', '!=', excludeReturnId);
    }
    const priorReturns = await priorReturnsQuery.execute();
    if (priorReturns.length === 0) return empty;
    const priorJournals = await queryable
      .selectFrom('journal_entries')
      .select(['id', 'source_id'])
      .where('source_type', 'in', ['sales_return', 'return'])
      .where(
        'source_id',
        'in',
        priorReturns.map((row) => Number(row.id)),
      )
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('status', 'in', ['draft', 'posted'])
      .execute();
    const relieved = { tip: 0, courier: 0 };
    if (priorJournals.length > 0) {
      const reliefAccounts = await queryable
        .selectFrom('accounting_accounts')
        .select(['id', 'code'])
        .where('tenant_id', '=', tenantId)
        .where('code', 'in', ['2147', '2115'])
        .execute();
      const accountIdByCode = new Map(reliefAccounts.map((row) => [String(row.code), Number(row.id)]));
      const sums = await queryable
        .selectFrom('journal_entry_lines')
        .select(['account_id', sql<number>`coalesce(sum(debit), 0)`.as('relieved')])
        .where(
          'journal_entry_id',
          'in',
          priorJournals.map((row) => Number(row.id)),
        )
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .groupBy('account_id')
        .execute();
      for (const row of sums) {
        const amount = Number((row as any).relieved || 0);
        if (Number((row as any).account_id) === accountIdByCode.get('2147')) relieved.tip += amount;
        if (Number((row as any).account_id) === accountIdByCode.get('2115')) relieved.courier += amount;
      }
    }
    // R7-A F3: an exchange-collected prior return has no journal —
    // its relief lives only on its row. Count it here, and only
    // here (a return with a journal is already counted above).
    const journaledReturnIds = new Set(priorJournals.map((row) => Number((row as any).source_id)));
    for (const prior of priorReturns) {
      if (journaledReturnIds.has(Number(prior.id))) continue;
      relieved.tip += Number((prior as any).exchange_tip_relief || 0);
      relieved.courier += Number((prior as any).exchange_courier_relief || 0);
    }
    return relieved;
  }

  /**
   * R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: the receivable a prior
   * return of this sale already reversed, read back from the posted
   * return journals (Cr 1130 legs). Mirrors priorSalesReturnRelief:
   * the journal is the record, so a stored allocation that was
   * topped up in-memory by postSalesReturn (pre-F1 documents) is
   * still counted at its posted value. Exchange-collected returns
   * cannot exist here: prepareExchangeReturn refuses an unpaid
   * source (EXCHANGE_UNPAID_SOURCE), and a COD sale's paid_amount
   * never moves on settlement — so no exchange return of an
   * unsettled COD sale can carry a receivable leg in the new
   * sale's journal. If that gate ever changes, this must count
   * exchange-collected receivable legs too.
   */
  async priorSalesReturnReceivableCredit(queryable: DbOrTx, tenantId: string, saleId: number): Promise<number> {
    const priorReturns = await queryable
      .selectFrom('return_documents')
      .select('id')
      .where('invoice_id', '=', saleId)
      .where('return_type', '=', 'sale')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .execute();
    if (priorReturns.length === 0) return 0;
    const priorJournals = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', 'in', ['sales_return', 'return'])
      .where(
        'source_id',
        'in',
        priorReturns.map((row) => Number(row.id)),
      )
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('status', 'in', ['draft', 'posted'])
      .execute();
    if (priorJournals.length === 0) return 0;
    const receivableAccount = await queryable
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', '1130')
      .executeTakeFirst();
    if (!receivableAccount) return 0;
    const credited = await queryable
      .selectFrom('journal_entry_lines')
      .select(sql<number>`coalesce(sum(credit), 0)`.as('credited'))
      .where(
        'journal_entry_id',
        'in',
        priorJournals.map((row) => Number(row.id)),
      )
      .where('account_id', '=', Number(receivableAccount.id))
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    return Number((credited as any)?.credited || 0);
  }

  /**
   * R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: the settlement basis
   * for a delivery order, derived from the REMAINING amounts —
   * the single source of truth for both postDeliveryRepSettlement
   * (validation + credit leg) and the delivery-reps callers (the
   * cash the rep actually hands over).
   *
   * Decision (recorded): the settlement is derived from the
   * remaining receivable, NOT by blocking returns of unsettled COD
   * orders. A customer returning part of a COD order before the
   * rep settles is ordinary merchant work; blocking it would stop
   * real returns for a bookkeeping convenience, against the
   * spirit-of-the-law (workflow guards block only real loss).
   *
   * remainingReceivable = sale total - store credit used at sale
   * time - paid amount - receivable already reversed by prior
   * returns (their posted Cr 1130 legs). That is exactly the Dr
   * 1130 postSale posted for this sale
   * (receivableAmount = total - paid - storeCreditUsed), minus
   * what returns already reversed — so the settlement credit
   * lands 1130 at zero instead of over-crediting it by the
   * returned share. remainingFee = original fee - prior courier
   * relief (0 for a store-fleet sale: its fee went to Cr 4200
   * revenue, never to 2115).
   */
  async deliverySettlementBasis(
    queryable: DbOrTx,
    saleId: number,
    auth: AuthContext,
  ): Promise<{ totalDebt: number; remainingReceivable: number; remainingFee: number }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const sale = await queryable
      .selectFrom('sales')
      .select(['total', 'delivery_fee', 'delivery_fee_mode', 'store_credit_used', 'paid_amount'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirstOrThrow();
    const totalDebt = toBookMoney(sale.total);
    const priorRelief = await this.priorSalesReturnRelief(queryable, scope.tenantId, saleId, null);
    const priorReceivable = await this.priorSalesReturnReceivableCredit(queryable, scope.tenantId, saleId);
    const isStoreFleetDelivery = String((sale as any)?.delivery_fee_mode ?? '').trim() === 'store_fleet';
    const remainingFee = toBookMoney(
      isStoreFleetDelivery ? 0 : Math.max(0, Number(sale.delivery_fee || 0) - priorRelief.courier),
    );
    const remainingReceivable = toBookMoney(
      Math.max(0, totalDebt - Number(sale.store_credit_used || 0) - Number(sale.paid_amount || 0) - priorReceivable),
    );
    return { totalDebt, remainingReceivable, remainingFee };
  }

  /**
   * R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F1: the tip / courier-fee
   * relief a return owes, shared by postSalesReturn (the journal)
   * and ReturnsService.createSaleReturn (the payout loop) so both
   * sides move the SAME numbers. One function, two call sites —
   * a second copy of this ratio would drift and re-open the F1
   * shortfall (journal top-up vs subledger movement).
   *
   * Rules (from R6-E, unchanged): relieve the tip / courier-fee
   * payables the original sale credited (Cr 2147 / Cr 2115),
   * pro-rata by the returned net goods value over the sale's net
   * goods base. Exclusive-tax base: subtotal - discount.
   * Tax-inclusive base: the SAME ex-tax goods leg postSale
   * stripped — (subtotal + serviceCharge - tax) with the service
   * share removed — net of the discount the return lines carry.
   * Tip only when the sale credited one; courier only for a
   * freelance delivery (NULL mode counts as freelance, as in
   * addSaleRevenueCreditLegs). A store-fleet fee went to Cr 4200
   * revenue, which a return does not relieve either.
   * FUNDING (decision, recorded): the relief is part of the REFUND
   * — the customer is refunded the relieved shares on top of the
   * return total. CUMULATIVE CAP: this return's relief is capped
   * at originalCredited - priorRelief (prior returns of the same
   * sale, via priorSalesReturnRelief); without it two 60%
   * returns relieve 120%.
   *
   * The caller supplies netReturnAmount (return total minus its
   * tax share): postSalesReturn reads it from the stored return
   * items, ReturnsService from the in-memory lines (the document
   * does not exist yet when it allocates). excludeReturnId is the
   * return being posted (its own journal does not exist yet, so
   * excluding it is belt-and-braces); pass null when the return
   * has no row yet.
   */
  async computeSalesReturnRelief(
    queryable: DbOrTx,
    tenantId: string,
    sale:
      | {
          id: number;
          subtotal?: unknown;
          discount?: unknown;
          tip_amount?: unknown;
          delivery_fee?: unknown;
          delivery_fee_mode?: unknown;
          service_charge?: unknown;
          tax_amount?: unknown;
          prices_include_tax?: unknown;
        }
      | null
      | undefined,
    returnTotal: number,
    netReturnAmount: number,
    excludeReturnId: number | null,
  ): Promise<{ tipRelief: number; courierRelief: number; totalRelief: number }> {
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const saleSubtotal = toBookMoney(sale?.subtotal ?? 0);
    const saleDiscount = toBookMoney(sale?.discount ?? 0);
    const saleTip = toBookMoney(sale?.tip_amount ?? 0);
    const saleDeliveryFee = toBookMoney(sale?.delivery_fee ?? 0);
    const saleDeliveryMode = String(sale?.delivery_fee_mode ?? '').trim();
    const isStoreFleetDelivery = saleDeliveryMode === 'store_fleet';
    const saleServiceCharge = toBookMoney(sale?.service_charge ?? 0);
    const saleTaxAmount = toBookMoney(sale?.tax_amount ?? 0);
    const salePricesIncludeTax = Boolean(sale?.prices_include_tax);
    let netGoodsBase = 0;
    if (sale) {
      if (salePricesIncludeTax) {
        const strippedBase = toBookMoney(saleSubtotal + saleServiceCharge - saleTaxAmount);
        if (strippedBase >= 0) {
          const inclusiveDenom = saleSubtotal + saleServiceCharge;
          const serviceLeg = inclusiveDenom > 0 ? toBookMoney((strippedBase * saleServiceCharge) / inclusiveDenom) : 0;
          netGoodsBase = toBookMoney(Math.max(0, strippedBase - serviceLeg - saleDiscount));
        }
      } else {
        netGoodsBase = toBookMoney(Math.max(0, saleSubtotal - saleDiscount));
      }
    }
    const reliefRatio =
      sale && returnTotal > 0 && netGoodsBase > 0 ? Math.min(1, Math.max(0, netReturnAmount / netGoodsBase)) : 0;
    let tipRelief = saleTip > 0 && reliefRatio > 0 ? toBookMoney(saleTip * reliefRatio) : 0;
    let courierRelief =
      saleDeliveryFee > 0 && !isStoreFleetDelivery && reliefRatio > 0 ? toBookMoney(saleDeliveryFee * reliefRatio) : 0;
    if (sale && (tipRelief > 0 || courierRelief > 0)) {
      const priorRelief = await this.priorSalesReturnRelief(queryable, tenantId, Number(sale.id), excludeReturnId);
      tipRelief = toBookMoney(Math.max(0, Math.min(tipRelief, saleTip - priorRelief.tip)));
      courierRelief = toBookMoney(Math.max(0, Math.min(courierRelief, saleDeliveryFee - priorRelief.courier)));
    }
    const totalRelief = toBookMoney(tipRelief + courierRelief);
    return { tipRelief, courierRelief, totalRelief };
  }
}
