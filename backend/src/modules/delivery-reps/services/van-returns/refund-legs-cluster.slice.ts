import { sql } from '../../../../database/kysely';
import { AppError } from '../../../../common/errors/app-error';
import { roundMoney, type MoneyDigits } from '../../../accounting/engines/money-minor-units.engine';

export class RefundLegsClusterSlice {
  constructor() {}

  /**
   * Refund-leg resolution for van field returns (INV-VAN-RETURN-METHOD-MATCH).
   *
   * A refund must match the original sale's payment legs: the cash leg
   * is the money that actually sits in the rep's custody (the 1130
   * 'none' pool), the credit leg is the customer's receivable. The
   * legs derive from the sale row exactly the way postSale splits the
   * receivable — cash sales hold the whole total in custody, credit
   * sales hold it all as receivable, card/InstaPay/Vodafone Cash
   * settled straight to the bank (no leg at all: a field return
   * cannot reverse a bank settlement), and a split sale's credit leg
   * is its customer_ledger sale_credit row with the remainder in
   * cash. Prior approved + pending returns on the same sale consume
   * their recorded leg, so each leg refunds only up to what it paid.
   * Anything that cannot be derived fails closed with
   * REFUND_SALE_LEGS_UNVERIFIABLE — never guessed, never clamped.
   */
  async resolveSaleRefundLegs(
    q: any,
    tenantId: string,
    sale: {
      id: number;
      payment_type?: string | null;
      total?: unknown;
      paid_amount?: unknown;
      store_credit_used?: unknown;
      customer_id?: number | null;
    },
    moneyDigits: MoneyDigits,
    opts: {
      excludeReturnId?: number | null;
      priorReturns?: Array<{ id?: unknown; refund_method?: string | null; total_amount?: unknown }> | null;
    } = {},
  ): Promise<{ paymentMethod: string; cashRemaining: number; creditRemaining: number }> {
    const paymentMethod = String(sale.payment_type || '').trim();
    const knownMethods = ['cash', 'credit', 'card', 'split', 'instapay', 'vodafone_cash'];
    if (!knownMethods.includes(paymentMethod)) {
      throw new AppError(
        `تعذّرت مطابقة طريقة رد المرتجع مع الفاتورة الأصلية — طريقة دفع الفاتورة غير معروفة (${paymentMethod || 'غير مسجلة'})`,
        'REFUND_SALE_LEGS_UNVERIFIABLE',
        400,
      );
    }
    const saleTotal = roundMoney(Number(sale.total || 0), moneyDigits);
    const paidAmount = roundMoney(Number(sale.paid_amount || 0), moneyDigits);
    const storeCreditUsed = roundMoney(Number(sale.store_credit_used || 0), moneyDigits);
    // The receivable is the unpaid remainder — the same basis postSale
    // splits into rep-cash custody and customer receivable.
    const receivable = Math.max(0, roundMoney(saleTotal - paidAmount - storeCreditUsed, moneyDigits));

    let prior = opts.priorReturns ?? null;
    if (!prior) {
      prior = await q
        .selectFrom('van_field_returns')
        .select(['id', 'refund_method', 'total_amount'])
        .where('sale_id', '=', Number(sale.id))
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`status in ('approved', 'pending_approval')`)
        .execute();
    }
    let priorCash = 0;
    let priorCredit = 0;
    for (const row of prior || []) {
      if (opts.excludeReturnId != null && Number(row.id) === Number(opts.excludeReturnId)) continue;
      const amount = roundMoney(Number(row.total_amount || 0), moneyDigits);
      const method = String(row.refund_method || '').trim();
      if (method === 'cash') priorCash += amount;
      else if (method === 'credit') priorCredit += amount;
      else {
        // A prior return with no recorded method cannot be attributed
        // to a leg: fail closed and count it against BOTH legs, so no
        // leg can be refunded twice through an unattributed record.
        // (submitFieldReturn always records the method, so this only
        // fires on malformed legacy rows.)
        priorCash += amount;
        priorCredit += amount;
      }
    }
    priorCash = roundMoney(priorCash, moneyDigits);
    priorCredit = roundMoney(priorCredit, moneyDigits);

    let cashLeg = 0;
    let creditLeg = 0;
    if (paymentMethod === 'cash') {
      cashLeg = receivable;
    } else if (paymentMethod === 'credit') {
      creditLeg = receivable;
    } else if (paymentMethod === 'split') {
      // The credit leg of a split sale is the customer_ledger
      // sale_credit row — the same source postSale uses to split the
      // receivable into rep-cash custody and customer receivable.
      const creditRow = await q
        .selectFrom('customer_ledger')
        .select(['amount'])
        .where('reference_type', '=', 'sale')
        .where('reference_id', '=', Number(sale.id))
        .where('entry_type', '=', 'sale_credit')
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!creditRow && sale.customer_id == null) {
        throw new AppError(
          'تعذّرت مطابقة طريقة رد المرتجع مع الفاتورة الأصلية — فاتورة مجزأة بدون عميل ولا قيد ائتمان مسجل، فلا يمكن تحديد الجزء النقدي من الجزء الآجل',
          'REFUND_SALE_LEGS_UNVERIFIABLE',
          400,
        );
      }
      creditLeg = Math.min(receivable, Math.max(0, roundMoney(Number(creditRow?.amount || 0), moneyDigits)));
      cashLeg = Math.max(0, roundMoney(receivable - creditLeg, moneyDigits));
    }
    // card / instapay / vodafone_cash: settled straight to the bank —
    // no cash leg, no credit leg; a field return cannot reverse them.

    return {
      paymentMethod,
      cashRemaining: Math.max(0, roundMoney(cashLeg - priorCash, moneyDigits)),
      creditRemaining: Math.max(0, roundMoney(creditLeg - priorCredit, moneyDigits)),
    };
  }

  /**
   * Refuses a refund whose requested method is not covered by the
   * matching leg of the original sale (INV-VAN-RETURN-METHOD-MATCH):
   * never cash for a credit sale, never credit for a cash sale, and
   * each leg only up to what that leg paid. The refusal names the
   * sale's payment method and both remaining legs.
   */
  assertRefundMethodCoveredByLegs(
    legs: { paymentMethod: string; cashRemaining: number; creditRemaining: number },
    refundMethod: 'credit' | 'cash',
    totalAmount: number,
    moneyDigits: MoneyDigits,
  ): void {
    const tolerance = 1 / 10 ** moneyDigits;
    const cashRemaining = roundMoney(legs.cashRemaining, moneyDigits);
    const creditRemaining = roundMoney(legs.creditRemaining, moneyDigits);
    const amount = roundMoney(totalAmount, moneyDigits);
    const methodLabel: Record<string, string> = {
      cash: 'نقدي',
      credit: 'آجل',
      card: 'بطاقة/شبكة',
      split: 'مجزأ (نقدي + آجل)',
      instapay: 'إنستاباي',
      vodafone_cash: 'فودافون كاش',
    };
    const saleLabel = methodLabel[legs.paymentMethod] || legs.paymentMethod;
    if (legs.paymentMethod === 'card' || legs.paymentMethod === 'instapay' || legs.paymentMethod === 'vodafone_cash') {
      throw new AppError(
        `لا يمكن رد مرتجع على فاتورة مسددة (${saleLabel}) نقداً أو كائتمان من عهدة المندوب — المبلغ مستقر في البنك ويتطلب عكساً بنكياً`,
        'REFUND_METHOD_MISMATCH',
        400,
      );
    }
    if (refundMethod === 'cash') {
      if (amount > cashRemaining + tolerance) {
        throw new AppError(
          `المرتجع النقدي بقيمة (${amount}) يتجاوز المسدد نقداً المتبقي من الفاتورة الأصلية (${saleLabel}): المتبقي النقدي (${cashRemaining}) والآجل (${creditRemaining}) — لا يمكن صرف نقد من جزء آجل`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
    } else if (amount > creditRemaining + tolerance) {
      throw new AppError(
        `المرتجع كائتمان بقيمة (${amount}) يتجاوز المديونية المتبقية من الفاتورة الأصلية (${saleLabel}): المتبقي الآجل (${creditRemaining}) والنقدي (${cashRemaining}) — لا يمكن خصم كائتمان من بيع نقدي`,
        'REFUND_METHOD_MISMATCH',
        400,
      );
    }
  }
}
