import { useTranslation } from 'react-i18next';
import type { Purchase, Sale } from '@/types/domain';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';
import { SINGLE_STORE_MODE } from '@/config/product-scope';

export function SharedSaleDetailCard({ sale, isLoading = false, onEdit, onCancel, onPrint }: { sale?: Sale; isLoading?: boolean; onEdit?: () => void; onCancel?: () => void; onPrint?: () => void; }) {
  const { t } = useTranslation();
  if (isLoading) return <Card title={t('shared.invoice_detail_cards.s0', "تفاصيل الفاتورة")}><div className="muted">{t('shared.invoice_detail_cards.s1', "جاري تحميل تفاصيل الفاتورة...")}</div></Card>;
  if (!sale) return <Card title={t('shared.invoice_detail_cards.s2', "تفاصيل الفاتورة")}><div className="muted">{t('shared.invoice_detail_cards.s3', "اختر فاتورة من الجدول لعرض التفاصيل.")}</div></Card>;

  const statusText = sale.status === 'posted' ? 'مرحلة' : sale.status === 'cancelled' ? 'ملغاة' : sale.status === 'draft' ? 'مسودة' : (sale.status || 'draft');

  return (
    <Card
      title={`تفاصيل ${sale.docNo || sale.id}`}
      actions={sale.status !== 'cancelled' ? (
        <div className="actions" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'nowrap' }}>
          {onPrint ? <Button variant="secondary" onClick={onPrint}>{t('shared.invoice_detail_cards.s4', "طباعة")}</Button> : null}
          {onEdit ? <Button variant="secondary" onClick={onEdit}>{t('shared.invoice_detail_cards.s5', "تعديل الفاتورة")}</Button> : null}
          {onCancel ? <Button variant="danger" onClick={onCancel}>{t('shared.invoice_detail_cards.s6', "إلغاء الفاتورة")}</Button> : null}
        </div>
      ) : <span className="status-badge status-cancelled">{t('shared.invoice_detail_cards.s7', "ملغاة")}</span>}
    >
      <div className="stats-grid compact-grid invoice-detail-summary-grid">
        <div className="stat-card"><span>{t('shared.invoice_detail_cards.s8', "العميل")}</span><strong>{sale.customerName || t('shared.invoice_detail_cards.s9', "عميل نقدي")}</strong></div>
        <div className="stat-card"><span>{t('shared.invoice_detail_cards.s10', "الحالة")}</span><strong className="status-chip">{statusText}</strong></div>
        <div className="stat-card"><span>{t('shared.invoice_detail_cards.s11', "الإجمالي")}</span><strong style={{ color: 'var(--primary, #0f172a)' }}>{formatCurrency(sale.total)}</strong></div>
        <div className="stat-card"><span>{t('shared.invoice_detail_cards.s12', "التاريخ")}</span><strong>{formatDate(sale.date)}</strong></div>
      </div>
      <div className="table-wrap invoice-detail-table-wrap" style={{ marginTop: 16 }}>
        <table style={{ width: '100%', minWidth: '100%', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'right', width: '35%' }}>{t('shared.invoice_detail_cards.s13', "الصنف")}</th>
              <th style={{ textAlign: 'center', width: '12%' }}>{t('shared.invoice_detail_cards.s14', "الوحدة")}</th>
              <th style={{ textAlign: 'center', width: '12%' }}>{t('shared.invoice_detail_cards.s15', "الكمية")}</th>
              <th style={{ textAlign: 'center', width: '13%' }}>{t('shared.invoice_detail_cards.s16', "السعر")}</th>
              <th style={{ textAlign: 'center', width: '13%' }}>{t('shared.invoice_detail_cards.s17b', "الخصم")}</th>
              <th style={{ textAlign: 'left', width: '15%' }}>{t('shared.invoice_detail_cards.s17', "الإجمالي")}</th>
            </tr>
          </thead>
          <tbody>
            {(sale.items || []).map((item) => (
              <tr key={item.id || `${item.productId}-${item.unitName}`}>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.name}</td>
                <td style={{ textAlign: 'center', color: '#64748b' }}>{item.unitName || '—'}</td>
                <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.qty}</td>
                <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(item.price)}</td>
                {/* INV-POS-LINE-DISCOUNT: the per-line discount for this
                  * row (0 when none) — the total column is already net
                  * of it, so the discount is what reconciles qty x
                  * price to the shown total. */}
                <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: '#065f46', fontWeight: 600 }}>{Number(item.lineDiscount || 0) > 0 ? `- ${formatCurrency(Number(item.lineDiscount))}` : '—'}</td>
                <td style={{ textAlign: 'left', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function SharedPurchaseDetailCard({ purchase, isLoading = false, onEdit, onCancel, onPrint }: { purchase?: Purchase; isLoading?: boolean; onEdit?: () => void; onCancel?: () => void; onPrint?: () => void; }) {
  const { t } = useTranslation();
  if (isLoading) return <Card title={t('shared.invoice_detail_cards.s18', "تفاصيل الفاتورة")} className="purchase-detail-card"><div className="muted">{t('shared.invoice_detail_cards.s19', "جاري تحميل تفاصيل الفاتورة...")}</div></Card>;
  if (!purchase) return <Card title={t('shared.invoice_detail_cards.s20', "تفاصيل الفاتورة")} className="purchase-detail-card"><div className="muted">{t('shared.invoice_detail_cards.s21', "اختر فاتورة من الجدول لعرض التفاصيل.")}</div></Card>;

  return (
    <Card
      className="purchase-detail-card"
      title={`تفاصيل ${purchase.docNo || purchase.id}`}
      actions={purchase.status !== 'cancelled' ? (
        <div className="actions compact-actions">
          {onPrint ? <Button variant="secondary" onClick={onPrint}>{t('shared.invoice_detail_cards.s22', "طباعة الفاتورة")}</Button> : null}
          {onEdit ? <Button variant="secondary" onClick={onEdit}>{t('shared.invoice_detail_cards.s23', "تعديل الفاتورة")}</Button> : null}
          {onCancel ? <Button variant="danger" onClick={onCancel}>{t('shared.invoice_detail_cards.s24', "إلغاء الفاتورة")}</Button> : null}
        </div>
      ) : <span className="status-badge status-cancelled">{t('shared.invoice_detail_cards.s25', "ملغاة")}</span>}
    >
      <div className="stats-grid compact-grid">
        <div className="stat-card"><span>{t('shared.invoice_detail_cards.s26', "المورد")}</span><strong>{purchase.supplierName || '—'}</strong></div>
        <div className="stat-card"><span>{t('shared.invoice_detail_cards.s27', "الحالة")}</span><strong>{purchase.status || 'draft'}</strong></div>
        <div className="stat-card"><span>{t('shared.invoice_detail_cards.s28', "الإجمالي")}</span><strong>{formatCurrency(purchase.total)}</strong></div>
        <div className="stat-card"><span>{t('shared.invoice_detail_cards.s29', "المدفوع الضمني")}</span><strong>{purchase.paymentType === 'credit' ? t('shared.invoice_detail_cards.s30', "آجل") : t('shared.invoice_detail_cards.s31', "نقدي")}</strong></div>
        <div className="stat-card"><span>{t('shared.invoice_detail_cards.s32', "التاريخ")}</span><strong>{formatDate(purchase.date)}</strong></div>
        <div className="stat-card"><span>{SINGLE_STORE_MODE ? t('shared.invoice_detail_cards.s33', "المخزن") : t('shared.invoice_detail_cards.s34', "الفرع/المخزن")}</span><strong>{SINGLE_STORE_MODE ? (purchase.locationName || t('shared.invoice_detail_cards.s35', "المخزن الأساسي")) : `${purchase.branchName || '—'} / ${purchase.locationName || '—'}`}</strong></div>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr><th>{t('shared.invoice_detail_cards.s36', "الصنف")}</th><th>{t('shared.invoice_detail_cards.s37', "الوحدة")}</th><th>{t('shared.invoice_detail_cards.s38', "الكمية")}</th><th>{t('shared.invoice_detail_cards.s39', "التكلفة")}</th><th>{t('shared.invoice_detail_cards.s40', "الإجمالي")}</th></tr>
          </thead>
          <tbody>
            {(purchase.items || []).map((item) => (
              <tr key={item.id || `${item.productId}-${item.unitName}`}>
                <td>{item.name}</td>
                <td>{item.unitName || '—'}</td>
                <td>{item.qty}</td>
                <td>{formatCurrency(item.cost)}</td>
                <td>{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
