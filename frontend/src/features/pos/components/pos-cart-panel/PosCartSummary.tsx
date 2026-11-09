import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';
import { getBalanceState } from '@/features/pos/lib/pos-balance-state';
import { PosTotalsBreakdown } from './PosTotalsBreakdown';
import type { PosCartPanelProps } from './posCartPanel.types';

export function PosCartSummary({ totals, paymentType, paidAmount, amountDue, changeAmount }: Pick<PosCartPanelProps, 'totals' | 'paymentType' | 'paidAmount' | 'amountDue' | 'changeAmount'>) {
  const { t } = useTranslation();
  const actualPaid = Number(paidAmount || 0);
  const remainingDebt = Math.max(0, Number(totals.total || 0) - actualPaid);
  const isCredit = paymentType === 'credit';
  /* R5-A (INV-REST-TOTALS-TRUTH-2, M24): the 4th tile is the shared
   * balance helper — on a credit sale with a partial payment it shows
   * the remaining debt, not changeAmount (the old tile showed the
   * change while the 3rd tile showed the debt). An unpaid credit sale
   * still reads 'آجل'. */
  const balance = getBalanceState({
    paymentType,
    customerId: null,
    paidAmount: actualPaid,
    amountDue: Number(amountDue || 0),
    changeAmount: Number(changeAmount || 0),
    total: Number(totals.total || 0),
  });

  return (
    <div>
      {/* R5-A (INV-REST-TOTALS-TRUTH-2, R-I46): the breakdown rows
       * behind the four tiles, so the cashier can see what the total
       * is made of instead of one unexplained number. */}
      <PosTotalsBreakdown totals={totals} />
      <div className="pos-checkout-summary-grid">
        <div className="pos-checkout-summary tone-primary"><span>{t('pos.amount_due', 'المطلوب دفعه')}</span><strong>{formatCurrency(totals.total)}</strong></div>
        <div className="pos-checkout-summary tone-success"><span>{t('pos.paid', 'المدفوع')}</span><strong>{formatCurrency(actualPaid)}</strong></div>
        <div className="pos-checkout-summary tone-warning"><span>{isCredit || remainingDebt > 0 ? t('pos.remaining_debt', 'المتبقي على العميل') : t('pos.remaining', 'المتبقي الآن')}</span><strong>{formatCurrency(isCredit ? remainingDebt : amountDue)}</strong></div>
        <div className="pos-checkout-summary tone-surface"><span>{isCredit && actualPaid <= 0 ? t('pos.payment_label', 'الدفع') : balance.label}</span><strong>{isCredit && actualPaid <= 0 ? t('pos.credit_label', 'آجل') : formatCurrency(balance.value)}</strong></div>
      </div>
    </div>
  );
}
