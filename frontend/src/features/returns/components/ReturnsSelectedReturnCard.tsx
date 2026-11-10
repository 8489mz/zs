import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/shared/ui/empty-state';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';
import { getReturnDateValue, returnTypeLabel } from '@/features/returns/lib/returns-workspace.helpers';
import type { ReturnRecord } from '@/types/domain';

export function ReturnsSelectedReturnCard({
  selectedReturn,
  onPrint,
  onCopy,
}: {
  selectedReturn: ReturnRecord | null;
  onPrint: () => void;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  // T10-D: the actual refund is the stored goods total plus the
  // relief recorded on the document. Old documents carry no relief
  // fields, so they fall back to the stored total.
  const tipRelief = Number(selectedReturn?.tipRelief || 0);
  const courierRelief = Number(selectedReturn?.courierRelief || 0);
  const refundTotal = Number(selectedReturn?.refundTotal ?? (Number(selectedReturn?.total || 0) + tipRelief + courierRelief));

  return (
    <div className="workspace-panel returns-detail-card-shell" style={{ background: '#ffffff', borderRadius: '12px', padding: '16px' }}>
      {/* 1. Header with Title and Type Badge */}
      <div className="returns-detail-header" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '12px',
        paddingBottom: '10px',
        borderBottom: '1px solid #e2e8f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '4px', height: '18px', background: '#2563eb', borderRadius: '2px' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
              {t('returns.selected_return_title', 'تفاصيل المرتجع المحدد')}
            </h3>
          </div>
        </div>

        {selectedReturn && (
          <span className="status-badge" style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11.5px',
            fontWeight: 700,
            background: '#eff6ff',
            color: '#1d4ed8',
            border: '1px solid #bfdbfe',
          }}>
            {returnTypeLabel(selectedReturn, t)}
          </span>
        )}
      </div>

      {/* 2. Action Toolbar */}
      {selectedReturn && (
        <div className="returns-detail-actions-bar" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '8px',
          marginBottom: '14px',
        }}>
          <Button variant="secondary" onClick={onPrint} style={{ fontSize: '12.5px', padding: '7px 10px', justifyContent: 'center' }}>
            {t('common.print', 'طباعة')}
          </Button>
          <Button variant="secondary" onClick={onCopy} style={{ fontSize: '12.5px', padding: '7px 10px', justifyContent: 'center' }}>
            {t('returns.copy_details', 'نسخ التفاصيل')}
          </Button>
        </div>
      )}

      {selectedReturn ? (
        <div className="returns-detail-grid-wrap" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Card 1: Document & Item Info */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#334155', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
              {t('returns.doc_item_data', 'بيانات المستند والصنف')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 12px' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>{t('returns.col_doc_no', 'رقم المستند')}</span>
                <strong style={{ fontSize: '12.5px', color: '#0f172a', fontWeight: 700 }} className="doc-tag">{selectedReturn.docNo || selectedReturn.id}</strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>{t('returns.col_type', 'النوع')}</span>
                <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{returnTypeLabel(selectedReturn, t)}</strong>
              </div>
              {selectedReturn.invoiceDocNo || selectedReturn.invoiceId ? (
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>{t('returns.ref_invoice', 'مرجع الفاتورة')}</span>
                  <strong style={{ fontSize: '12.5px', color: '#2563eb' }} className="ref-tag">
                    {selectedReturn.invoiceDocNo || (selectedReturn.returnType === 'purchase' ? `PO-${selectedReturn.invoiceId}` : `Z-${selectedReturn.invoiceId}`)}
                  </strong>
                </div>
              ) : null}
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>{t('returns.col_qty', 'الكمية')}</span>
                <strong style={{ fontSize: '12.5px', color: '#0f172a', fontWeight: 700 }}>{selectedReturn.qty || 0}</strong>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>{t('returns.col_product', 'الصنف')}</span>
                <strong style={{ fontSize: '13px', color: '#0f172a', fontWeight: 800 }}>{selectedReturn.productName || '—'}</strong>
              </div>
            </div>
          </div>

          {/* Card 2: Financials & Customer Info */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#334155', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
              {t('returns.financial_data', 'البيانات المالية والطرف الآخر')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 12px' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>{t('returns.col_party', 'الجهة / العميل')}</span>
                <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{selectedReturn.partyName || selectedReturn.customerName || t('returns.cash_customer', 'عميل نقدي')}</strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>{t('returns.created_by', 'بواسطة')}</span>
                <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{selectedReturn.createdByName || selectedReturn.createdBy || t('returns.general_cashier', 'كاشير عام')}</strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>{t('returns.refund_method_label', 'طريقة الرد')}</span>
                <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>
                  {selectedReturn.refundMethod === 'card' ? t('returns.method_card_full', 'بطاقة / فيزا') : selectedReturn.settlementMode === 'store_credit' ? t('returns.customer_credit', 'رصيد عميل') : t('returns.cash_drawer', 'نقدي (من الدرج)')}
                </strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>{t('returns.col_date', 'التاريخ')}</span>
                <strong style={{ fontSize: '11.5px', color: '#0f172a' }}><bdi dir="ltr">{formatDate(getReturnDateValue(selectedReturn))}</bdi></strong>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{t('returns.refund_goods', 'قيمة البضاعة')}:</span>
                <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{formatCurrency(Number(selectedReturn.total || 0))}</strong>
              </div>
              {tipRelief > 0 ? (
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{t('returns.relief_tip', 'استرداد الإكرامية')}:</span>
                  <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{formatCurrency(tipRelief)}</strong>
                </div>
              ) : null}
              {courierRelief > 0 ? (
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{t('returns.relief_courier', 'استرداد رسوم التوصيل')}:</span>
                  <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{formatCurrency(courierRelief)}</strong>
                </div>
              ) : null}
              <div style={{
                gridColumn: '1 / -1',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '4px',
              }}>
                <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>{t('returns.total_refunded', 'الإجمالي المسترد:')}</span>
                <strong style={{ fontSize: '1.1rem', fontWeight: 800, color: '#2563eb' }}>{formatCurrency(refundTotal)}</strong>
              </div>
            </div>
          </div>

          {/* Notes Full-Width Box */}
          {selectedReturn.note ? (
            <div style={{
              background: '#fffbeb',
              border: '1px solid #fef3c7',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              gap: '6px',
              fontSize: '12.5px',
            }}>
              <span style={{ fontWeight: 800, color: '#92400e', flexShrink: 0 }}>{t('returns.col_note', 'ملاحظات')}:</span>
              <span style={{ color: '#78350f' }}>{selectedReturn.note}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState title={t('returns.empty_selected_title', 'اختر مرتجعًا من الجدول')} hint={t('returns.empty_selected_hint', 'ستظهر التفاصيل هنا بعد الاختيار.')} />
      )}
    </div>
  );
}
