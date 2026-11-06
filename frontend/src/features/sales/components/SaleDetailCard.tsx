import type { Sale } from '@/types/domain';
import { Link } from 'react-router-dom';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';
import { formatSalePaymentText } from '@/lib/pos-printing/shared';
import { useTranslation } from "react-i18next";
import { shareSaleViaWhatsApp } from '@/features/sales/utils/whatsappShare';
import { useAuthStore } from '@/stores/auth-store';

interface SaleDetailCardProps {
  sale?: Sale;
  isLoading?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onPrint?: () => void;
}

export function SaleDetailCard({ sale, isLoading = false, onEdit, onCancel, onPrint }: SaleDetailCardProps) {
  const { t: __t } = useTranslation();
  const { t } = useTranslation();
  const { storeName } = useAuthStore();

  if (isLoading) return <FormSection title={t('sales.8f6d39')}><div className="muted">{t('sales.ff88ae')}</div></FormSection>;
  if (!sale) return <FormSection title={t('sales.8f6d39')}><div className="muted">{t('sales.272f58')}</div></FormSection>;

  const statusText = sale.status === 'posted' ? 'مرحلة' : sale.status === 'cancelled' ? t('sales.e92ebe') : sale.status === 'draft' ? 'مسودة' : (sale.status || 'draft');
  const paidAmount = Number(sale.paidAmount ?? sale.total ?? 0);
  const remaining = Math.max(0, Number(sale.total || 0) - paidAmount);

  const handleWhatsAppShare = () => {
    shareSaleViaWhatsApp(sale, { storeName });
  };

  return (
    <div className="sale-detail-card-shell" dir="rtl">
      {/* 1. Header with Title and Status */}
      <div className="invoice-detail-header" style={{
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
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: '#f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#0f172a',
            fontWeight: 800,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
              {`تفاصيل ${sale.docNo || sale.id}`}
            </h3>
          </div>
        </div>
        <div>
          <span className={`status-badge ${sale.status === 'cancelled' ? 'status-cancelled' : 'status-posted'}`} style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11.5px',
            fontWeight: 700,
            background: sale.status === 'cancelled' ? '#fee2e2' : '#dcfce7',
            color: sale.status === 'cancelled' ? '#991b1b' : '#166534',
          }}>
            {statusText}
          </span>
        </div>
      </div>

      {/* 2. Action Buttons Toolbar (Responsive Grid on Mobile) */}
      {sale.status !== 'cancelled' && (
        <div className="invoice-detail-actions-bar" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: '8px',
          marginBottom: '14px',
        }}>
          <Button
            variant="secondary"
            className="btn-whatsapp-share"
            onClick={handleWhatsAppShare}
            style={{
              background: '#22c55e',
              color: '#ffffff',
              borderColor: '#16a34a',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontWeight: 700,
              fontSize: '12.5px',
              padding: '7px 8px',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
            </svg>
            <span>{__t('sales.sale_detail_card.s0', "واتساب")}</span>
          </Button>
          {onPrint ? <Button variant="secondary" style={{ fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center' }} onClick={onPrint}>{t('sales.88c5d1')}</Button> : null}
          {onEdit ? <Button variant="secondary" style={{ fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center' }} onClick={onEdit}>{t('sales.78b222')}</Button> : null}
          {onCancel ? <Button variant="danger" style={{ fontSize: '12.5px', padding: '7px 8px', justifyContent: 'center' }} onClick={onCancel}>{t('sales.d07516')}</Button> : null}
        </div>
      )}

      {/* 3. Stats Summary Grid */}
      <div className="stats-grid compact-grid invoice-detail-summary-grid" style={{ marginBottom: '14px' }}>
        <div className="stat-card"><span>{__t('sales.sale_detail_card.s1', "العميل")}</span><strong>{sale.customerName || __t('sales.sale_detail_card.s2', "عميل نقدي")}</strong></div>
        <div className="stat-card"><span>{__t('sales.sale_detail_card.s3', "الكاشير")}</span><strong>{sale.cashierName || __t('sales.sale_detail_card.s4', "كاشير عام")}</strong></div>
        <div className="stat-card"><span>{__t('sales.sale_detail_card.s5', "طريقة الدفع")}</span><strong>{sale.paymentType === 'credit' ? __t('sales.sale_detail_card.s6', "آجل") : formatSalePaymentText(sale.paymentType, sale.paymentChannel, paidAmount, sale.total, sale.orderType, sale.collectionStatus)}</strong></div>
        <div className="stat-card"><span>{__t('sales.sale_detail_card.s9', "التاريخ")}</span><strong style={{ fontSize: '11.5px' }}><bdi dir="ltr">{formatDate(sale.createdAt || sale.date || '')}</bdi></strong></div>
        <div className="stat-card"><span>{__t('sales.sale_detail_card.s10', "الإجمالي")}</span><strong style={{ color: 'var(--primary, #0f172a)' }}>{formatCurrency(sale.total)}</strong></div>
        <div className="stat-card"><span>{__t('sales.sale_detail_card.s11', "المدفوع")}</span><strong>{formatCurrency(paidAmount)}</strong></div>
        {remaining > 0 && <div className="stat-card"><span>{__t('sales.sale_detail_card.s12', "المتبقي")}</span><strong style={{ color: '#dc2626' }}>{formatCurrency(remaining)}</strong></div>}
      </div>

      {/* Linked returns */}
      {(sale.linkedReturns || []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <FormSection title={__t('sales.sale_detail_card.s15', "المرتجعات المرتبطة")}>
            {(sale.linkedReturns || []).map((ret) => (
              <div key={ret.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                <Link to="/returns" style={{ fontWeight: 700, color: '#0284c7', textDecoration: 'none' }}>{ret.docNo}</Link>
                <span style={{ color: '#64748b', fontSize: '12px' }}>{formatDate(ret.createdAt || '')}</span>
                <strong>{formatCurrency(ret.total)}</strong>
              </div>
            ))}
          </FormSection>
        </div>
      )}

      {/* Desktop Table */}
      <div className="table-wrap invoice-detail-table-wrap invoice-desktop-table" style={{ marginTop: 16 }}>
        <table style={{ width: '100%', minWidth: '100%', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'right', width: '40%' }}>{t('sales.77c42d')}</th>
              <th style={{ textAlign: 'center', width: '15%' }}>{t('sales.694ca7')}</th>
              <th style={{ textAlign: 'center', width: '15%' }}>{t('sales.510165')}</th>
              <th style={{ textAlign: 'center', width: '15%' }}>{t('sales.fa59c3')}</th>
              <th style={{ textAlign: 'left', width: '15%' }}>{t('sales.88fc73')}</th>
            </tr>
          </thead>
          <tbody>
            {(sale.items || []).map((item) => (
              <tr key={item.id || `${item.productId}-${item.unitName}`}>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.name}</td>
                <td style={{ textAlign: 'center', color: '#64748b' }}>{item.unitName || '—'}</td>
                <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.qty}</td>
                <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(item.price)}</td>
                <td style={{ textAlign: 'left', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Responsive Smart Item Cards */}
      <div className="invoice-mobile-items-list" style={{ marginTop: 12 }}>
        <h5 className="invoice-mobile-items-title">{__t('sales.sale_detail_card.s13', "بنود الفاتورة (")}{(sale.items || []).length})</h5>
        <div className="invoice-mobile-items-grid">
          {(sale.items || []).map((item, idx) => (
            <div key={item.id || `${item.productId}-${idx}`} className="invoice-mobile-item-card">
              <div className="mobile-item-card-top">
                <strong className="mobile-item-name">{item.name}</strong>
                <span className="mobile-item-total">{formatCurrency(item.total)}</span>
              </div>
              <div className="mobile-item-card-bottom">
                <span className="mobile-item-unit">{item.unitName || __t('sales.sale_detail_card.s14', "قطعة")}</span>
                <span className="mobile-item-calc">
                  {item.qty} × {formatCurrency(item.price)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

