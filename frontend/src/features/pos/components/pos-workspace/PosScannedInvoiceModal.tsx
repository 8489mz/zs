import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { AppSettings, Sale } from '@/types/domain';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';
import { printPostedSaleReceipt } from '@/lib/pos-printing';
import { paymentLabel } from '@/features/pos/lib/pos-workspace.helpers';

interface PosScannedInvoiceModalProps {
  sale: Sale | null;
  isOpen: boolean;
  onClose: () => void;
  settings?: Partial<AppSettings> | null;
  onOpenReturns?: (sale: Sale) => void;
}

export function PosScannedInvoiceModal({
  sale,
  isOpen,
  onClose,
  settings,
  onOpenReturns,
}: PosScannedInvoiceModalProps) {
  const { t } = useTranslation();
  const [printSuccess, setPrintSuccess] = useState(false);

  if (!sale) return null;

  const handlePrint = () => {
    try {
      printPostedSaleReceipt(sale, { pageSize: 'receipt', settings });
      setPrintSuccess(true);
      setTimeout(() => setPrintSuccess(false), 3000);
    } catch {
      // Fallback
    }
  };

  const handleGoToReturns = () => {
    onClose();
    onOpenReturns?.(sale);
  };

  const isCancelled = sale.status === 'cancelled';

  return (
    <DialogShell
      open={isOpen}
      onClose={onClose}
      width="min(820px, calc(100vw - 32px))"
      showCloseButton={true}
      ariaLabel={t('pos.pos_workspace.pos_scanned_invoice_modal.s0', "تفاصيل الفاتورة الممسوحة بالباركود")}
    >
      <div
        style={{
          padding: '24px 26px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #e2e8f0',
            paddingBottom: '14px',
            paddingInlineEnd: '40px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                {t('pos.pos_workspace.pos_scanned_invoice_modal.s1', "فاتورة مبيعات:")} <span style={{ color: 'var(--primary-color, #0284c7)', fontFamily: 'monospace' }}>{sale.docNo || `Z-${sale.id}`}</span>
              </h3>
              <span
                style={{
                  fontSize: '12px',
                  padding: '3px 10px',
                  borderRadius: '20px',
                  fontWeight: 700,
                  background: isCancelled ? '#fee2e2' : '#dcfce7',
                  color: isCancelled ? '#b91c1c' : '#15803d',
                  border: isCancelled ? '1px solid #fecaca' : '1px solid #bbf7d0',
                }}
              >
                {isCancelled ? t('pos.pos_workspace.pos_scanned_invoice_modal.s2', "ملغاة") : t('pos.pos_workspace.pos_scanned_invoice_modal.s3', "مكتملة")}
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              {t('pos.pos_workspace.pos_scanned_invoice_modal.s4', "تم العثور على الفاتورة بنجاح. يمكنك استعراض الأصناف، إعادة طباعة الإيصال، أو تحويلها لمرتجع.")}
            </p>
          </div>
        </div>

        {/* Info Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '12px',
          }}
        >
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s5', "العميل")}</div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b', marginTop: '3px' }}>
              {sale.customerName || t('pos.pos_workspace.pos_scanned_invoice_modal.s6', "عميل نقدي")}
            </div>
          </div>
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s7', "التاريخ والوقت")}</div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1e293b', marginTop: '3px' }}>
              {sale.date ? formatDate(sale.date) : '—'}
            </div>
          </div>
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s8', "طريقة الدفع")}</div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1e293b', marginTop: '3px' }}>
              {paymentLabel((sale.paymentType || 'cash') as 'cash' | 'credit', sale.paymentChannel || 'cash')}
            </div>
          </div>
          <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s9', "الكاشير / الفرع")}</div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1e293b', marginTop: '3px' }}>
              {sale.createdBy || sale.branchName || '—'}
            </div>
          </div>
        </div>

        {/* Items Table */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'right' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s10', "الصنف")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700 }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s11', "الكمية")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700 }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s12', "السعر")}</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700 }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s13', "الإجمالي")}</th>
              </tr>
            </thead>
            <tbody>
              {(sale.items || []).map((item, idx) => {
                const origPrice = Number(item.originalPrice || (Number(item.price || 0) + Number(item.offerDiscount || 0)));
                const hasOffer = origPrice > Number(item.price || 0);

                return (
                  <tr key={item.id || idx} style={{ borderBottom: idx < (sale.items?.length || 0) - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{item.name}</div>
                      {item.offerName ? (
                        <div style={{ fontSize: '11.5px', color: '#059669', fontWeight: 600, marginTop: '2px' }}>
                          {item.offerName}
                        </div>
                      ) : null}
                      {/* INV-POS-LINE-DISCOUNT: the line's own discount —
                       * the total column is already net of it, so the
                       * note is what reconciles qty x price to it. */}
                      {Number(item.lineDiscount || 0) > 0 ? (
                        <div style={{ fontSize: '11.5px', color: '#065f46', fontWeight: 600, marginTop: '2px' }}>
                          {t('pos.line_discount', 'خصم الصنف')}: - {formatCurrency(Number(item.lineDiscount))}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>
                      {item.qty} {item.unitName || t('pos.pos_workspace.pos_scanned_invoice_modal.s14', "قطعة")}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{formatCurrency(item.price)}</div>
                      {hasOffer ? (
                        <div style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: '11px', fontWeight: 500 }}>
                          {formatCurrency(origPrice)}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 800, color: '#0f172a' }}>
                      {formatCurrency(item.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '14px 18px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#64748b', flexWrap: 'wrap' }}>
            <div>{t('pos.pos_workspace.pos_scanned_invoice_modal.s15', "عدد البنود:")} <strong style={{ color: '#1e293b' }}>{(sale.items || []).length}</strong></div>
            {Number(sale.discount || 0) > 0 ? (
              <div style={{ color: '#059669' }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s16', "الخصم:")} <strong>{formatCurrency(sale.discount)}</strong></div>
            ) : null}
            {Number(sale.taxAmount || 0) > 0 ? (
              <div>{t('pos.pos_workspace.pos_scanned_invoice_modal.s17', "الضريبة:")} <strong style={{ color: '#1e293b' }}>{formatCurrency(sale.taxAmount)}</strong></div>
            ) : null}
          </div>
          <div style={{ textAlign: 'left', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>{t('pos.pos_workspace.pos_scanned_invoice_modal.s18', "الإجمالي النهائي:")}</span>
            <strong style={{ fontSize: '1.35rem', color: 'var(--primary-color, #0284c7)', fontWeight: 800 }}>
              {formatCurrency(sale.total)}
            </strong>
          </div>
        </div>

        {printSuccess ? (
          <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#dcfce7', color: '#15803d', fontSize: '13.5px', fontWeight: 700, textAlign: 'center', border: '1px solid #bbf7d0' }}>
            {t('pos.pos_workspace.pos_scanned_invoice_modal.s19', "تم إرسال أمر طباعة الإيصال بنجاح!")}
          </div>
        ) : null}

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingTop: '8px',
            borderTop: '1px solid #f1f5f9',
            flexWrap: 'wrap',
          }}
        >
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            style={{ padding: '9px 18px', fontWeight: 600 }}
          >
            {t('pos.pos_workspace.pos_scanned_invoice_modal.s20', "إغلاق (Esc)")}
          </Button>

          {sale.status !== 'cancelled' ? (
            <Button
              type="button"
              variant="secondary"
              onClick={handleGoToReturns}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 700,
                padding: '9px 20px',
                borderColor: '#cbd5e1',
                background: '#fff',
              }}
            >
              <span>{t('pos.pos_workspace.pos_scanned_invoice_modal.s21', "إنشاء مرتجع لهذه الفاتورة")}</span>
            </Button>
          ) : null}

          <Button
            type="button"
            variant="primary"
            onClick={handlePrint}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 700,
              padding: '9px 22px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            <span>{t('pos.pos_workspace.pos_scanned_invoice_modal.s22', "إعادة طباعة الإيصال")}</span>
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
