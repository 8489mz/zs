import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/format';

export function PurchaseTotals({ subTotal, discount, freight, taxAmount, total }: { subTotal: number; discount: number; freight?: number; taxAmount: number; total: number }) {
  const { t } = useTranslation();
  return (
    <div className="stats-grid compact-grid purchase-totals-grid" style={{ gridColumn: '1 / -1' }}>
      <div className="stat-card"><span>{t('purchases.purchase_composer.purchase_totals.s0', "الإجمالي قبل الضريبة")}</span><strong>{formatCurrency(subTotal)}</strong></div>
      <div className="stat-card"><span>{t('purchases.purchase_composer.purchase_totals.s1', "الخصم")}</span><strong>{formatCurrency(discount)}</strong></div>
      {/* INV-LANDED-COST-ALLOCATION: freight is shown only when entered; the total already includes it. */}
      {Number(freight || 0) > 0 ? (
        <div className="stat-card"><span>{t('purchases.purchase_composer.purchase_totals.s4', "الشحن")}</span><strong>{formatCurrency(Number(freight || 0))}</strong></div>
      ) : null}
      <div className="stat-card"><span>{t('purchases.purchase_composer.purchase_totals.s2', "الضريبة")}</span><strong>{formatCurrency(taxAmount)}</strong></div>
      <div className="stat-card"><span>{t('purchases.purchase_composer.purchase_totals.s3', "إجمالي الفاتورة")}</span><strong>{formatCurrency(total)}</strong></div>
    </div>
  );
}
