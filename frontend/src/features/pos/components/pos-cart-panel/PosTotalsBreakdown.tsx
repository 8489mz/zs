/* R5-A (INV-REST-TOTALS-TRUTH-2, R-I46): the ONE totals breakdown for the
 * POS cart, the checkout dialog and the customer display. Before this,
 * no breakdown existed anywhere in checkout or the cart: the dialog
 * showed only items count, quantities and one total, and the cart showed
 * four tiles with no rows behind them. Every row is fed by the derived
 * hook's `totals` object; zero rows are hidden, subtotal and total always
 * show, so the visible rows always sum to the total. */

import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';

export interface PosTotalsBreakdownTotals {
  subTotal: number;
  discountValue?: number;
  manualDiscount?: number;
  loyaltyDiscount?: number;
  serviceCharge?: number;
  serviceChargePercent?: number;
  deliveryFee?: number;
  taxAmount?: number;
  taxRate?: number;
  tipAmount?: number;
  total: number;
}

interface PosTotalsBreakdownProps {
  totals: PosTotalsBreakdownTotals;
  /* CFD renders its own total banner, so it reuses the rows only. */
  showTotal?: boolean;
  /* CFD passes 'cfd-summary-row' to keep its own styling. */
  rowClassName?: string;
}

export function PosTotalsBreakdown({ totals, showTotal = true, rowClassName }: PosTotalsBreakdownProps) {
  const { t } = useTranslation();
  const discount = Number(totals.discountValue ?? (Number(totals.manualDiscount || 0) + Number(totals.loyaltyDiscount || 0)));
  const serviceCharge = Number(totals.serviceCharge || 0);
  const deliveryFee = Number(totals.deliveryFee || 0);
  const tax = Number(totals.taxAmount || 0);
  const tip = Number(totals.tipAmount || 0);
  const rowStyle: React.CSSProperties | undefined = rowClassName
    ? undefined
    : { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', fontWeight: 600, color: '#475569', padding: '2px 0' };

  return (
    <div>
      <div className={rowClassName} style={rowStyle}>
        <span>{t('pos.subtotal', 'المجموع الفرعي')}</span>
        <span>{formatCurrency(totals.subTotal)}</span>
      </div>

      {discount > 0 && (
        <div className={rowClassName} style={rowStyle}>
          <span>{t('pos.discount', 'الخصم')}</span>
          <span>- {formatCurrency(discount)}</span>
        </div>
      )}

      {serviceCharge > 0 && (
        <div className={rowClassName} style={rowStyle}>
          <span>{t('pos.service_charge', 'رسوم الخدمة')}{Number(totals.serviceChargePercent || 0) > 0 ? ` (${totals.serviceChargePercent}%)` : ''}</span>
          <span>+ {formatCurrency(serviceCharge)}</span>
        </div>
      )}

      {deliveryFee > 0 && (
        <div className={rowClassName} style={rowStyle}>
          <span>{t('pos.delivery_fee', 'التوصيل')}</span>
          <span>+ {formatCurrency(deliveryFee)}</span>
        </div>
      )}

      {tax > 0 && (
        <div className={rowClassName} style={rowStyle}>
          <span>{t('pos.tax', 'الضريبة')}{Number(totals.taxRate || 0) > 0 ? ` (${totals.taxRate}%)` : ''}</span>
          <span>+ {formatCurrency(tax)}</span>
        </div>
      )}

      {tip > 0 && (
        <div className={rowClassName} style={rowStyle}>
          <span>{t('pos.tip', 'الإكرامية')}</span>
          <span>+ {formatCurrency(tip)}</span>
        </div>
      )}

      {showTotal && (
        <div className={rowClassName} style={{ ...rowStyle, fontSize: '13px', fontWeight: 900, color: '#170e5e', borderTop: '1px solid #e2e8f0', paddingTop: '4px', marginTop: '2px' }}>
          <span>{t('pos.total', 'الإجمالي')}</span>
          <span>{formatCurrency(totals.total)}</span>
        </div>
      )}
    </div>
  );
}
