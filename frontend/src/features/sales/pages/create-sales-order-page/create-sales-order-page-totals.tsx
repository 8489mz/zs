import { formatCurrencyWithSymbol } from '@/lib/format';
import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';

export interface CreateSalesOrderPageTotalsProps {
  t: ReturnType<typeof useTranslation>['t'];
  notes: string;
  setNotes: Dispatch<SetStateAction<string>>;
  subtotal: number;
  currency: string;
  totalDiscount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
}
export function CreateSalesOrderPageTotals({ t, notes, setNotes, subtotal, currency, totalDiscount, taxRate, taxAmount, totalAmount }: CreateSalesOrderPageTotalsProps) {
  return (
    <>
    {/* Section 5: Notes & Totals (60/40 Split) */}
    <section className="document-prototype-bottom-grid" style={{ marginTop: '12px' }}>
      {/* Notes Card (60%) */}
      <div className="document-prototype-section">
        <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s72', "ملاحظات")}</h3>
        <textarea
          className="purchase-prototype-notes-textarea"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('sales.create_sales_order_page.s73', "ملاحظات إضافية للتسليم أو العميل...")}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      {/* Totals Card (40%) */}
      <div className="document-prototype-section document-totals-card">
        <h3 className="document-prototype-section-title">{t('sales.create_sales_order_page.s74', "الإجماليات")}</h3>
        <div className="document-totals-panel">
          <div>
            <span>{t('sales.create_sales_order_page.s75', "الإجمالي الفرعي:")}</span>
            <strong>{formatCurrencyWithSymbol(subtotal, currency)}</strong>
          </div>
          {totalDiscount > 0 && (
            <div style={{ color: '#dc2626' }}>
              <span>{t('sales.create_sales_order_page.s76', "الخصم:")}</span>
              <strong>- {formatCurrencyWithSymbol(totalDiscount, currency)}</strong>
            </div>
          )}
          <div>
            <span>{t('sales.create_sales_order_page.s77', "الضريبة (")}{taxRate}%):</span>
            <strong>{formatCurrencyWithSymbol(taxAmount, currency)}</strong>
          </div>
          <div className="document-total-grand" style={{ borderTop: '2px solid #e2e8f0', paddingTop: '8px', marginTop: '6px' }}>
            <span>{t('sales.create_sales_order_page.s78', "الصافي المطلوب:")}</span>
            <strong>{formatCurrencyWithSymbol(totalAmount, currency)}</strong>
          </div>
        </div>
      </div>
    </section>
    </>
  );
}
