import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import React from 'react';
import { ShoppingCartIcon, AwardIcon } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { PosTotalsBreakdown } from '@/features/pos/components/pos-cart-panel/PosTotalsBreakdown';
import type { CustomerDisplayPayload } from '@/features/pos/types/pos-customer-display.types';

interface CfdScanningViewProps {
  payload: CustomerDisplayPayload;
  latestItemKey: string | number | null | undefined;
  qrSvg: string;
}

export const CfdScanningView: React.FC<CfdScanningViewProps> = ({
  payload,
  latestItemKey,
  qrSvg,
}) => {
  const { t } = useTranslation();
  return (
    <div className="cfd-scanning-layout">
      {/* Right Column: Cart Items List */}
      <div className="cfd-cart-card">
        <div className="cfd-cart-header">
          <div className="cfd-cart-header-title">
            <ShoppingCartIcon size={20} color="#170e5e" />
            <span>{t('pos.customer_display.cfd_scanning_view.s0', "سلة المشتريات الحالية")}</span>
            <span className="cfd-item-count-badge">
              {payload.itemCount} {payload.itemCount === 1 ? t('pos.customer_display.cfd_scanning_view.s1', "صنف") : t('pos.customer_display.cfd_scanning_view.s2', "أصناف")}
            </span>
          </div>

          {payload.customer && (
            <div className="cfd-customer-pill">
              <AwardIcon size={16} color="#047857" />
              <span>{t('pos.customer_display.cfd_scanning_view.s3', "عميلنا العزيز:")} {payload.customer.name}</span>
              {typeof payload.customer.loyaltyPoints === 'number' && (
                <span style={{ fontWeight: 800, color: '#047857' }}>
                  ({payload.customer.loyaltyPoints} {t('pos.customer_display.cfd_scanning_view.s4', "نقطة)")}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="cfd-cart-items-scroll">
          {payload.items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              {t('pos.customer_display.cfd_scanning_view.s5', "في انتظار مسح الأصناف بواسطة الكاشير...")}
            </div>
          ) : (
            payload.items.map((item) => {
              const isLatest = item.id === latestItemKey;
              return (
                <div
                  key={item.id}
                  className={`cfd-item-row ${isLatest ? 'is-latest' : ''}`}
                >
                  <div className="cfd-item-info">
                    <span className="cfd-item-name">{item.name}</span>
                    {item.barcode && (
                      <span className="cfd-item-barcode">{t('pos.customer_display.cfd_scanning_view.s6', "باركود:")} {item.barcode}</span>
                    )}
                    {/* R5-A (INV-REST-TOTALS-TRUTH-2, R-I14): the modifier
                     * lines the line total charges for, so the customer
                     * can see why the unit price is above the base price. */}
                    {(item.modifiers || []).map((mod, modIndex) => (
                      <span key={modIndex} className="cfd-item-barcode">
                        + {mod.name}{Number(mod.qty || 1) > 1 ? ` (x${mod.qty})` : ''} {formatCurrency(Number(mod.price || 0) * Number(mod.qty || 1))}
                      </span>
                    ))}
                    {item.notes && (
                      <span className="cfd-item-barcode">{item.notes}</span>
                    )}
                  </div>

                  <div className="cfd-item-unit-price">
                    {formatCurrency(item.price)}
                  </div>

                  <div className="cfd-item-qty-badge" title={t('pos.customer_display.cfd_scanning_view.s7', "الكمية")}>
                    ×{item.qty}
                  </div>

                  <div className="cfd-item-total">
                    {formatCurrency(item.lineTotal)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Left Column: Totals & Payment Summary */}
      <div className="cfd-summary-card">
        <div className="cfd-summary-section">
          <div style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a', marginBottom: '8px' }}>
            {t('pos.customer_display.cfd_scanning_view.s8', "ملخص الحساب")}
          </div>

          {/* R5-A (INV-REST-TOTALS-TRUTH-2, R-I14/R-I46): the shared
           * breakdown — subtotal, discount, service charge, delivery,
           * tax, tip — with zero rows hidden, so the visible rows sum
           * to the total banner below. The banner itself stays. */}
          <PosTotalsBreakdown
            totals={{
              subTotal: payload.subtotal,
              discountValue: payload.discount,
              serviceCharge: payload.serviceCharge,
              deliveryFee: payload.deliveryFee,
              taxAmount: payload.tax,
              tipAmount: payload.tipAmount,
              total: payload.total,
            }}
            showTotal={false}
            rowClassName="cfd-summary-row"
          />

          <div className="cfd-total-banner">
            <div className="cfd-total-label">{t('pos.customer_display.cfd_scanning_view.s12', "المبلغ الإجمالي المطلوب سداده")}</div>
            <div className="cfd-total-amount">
              {payload.total.toFixed(2)}
              <span className="cfd-total-currency"><CurrencySymbol /></span>
            </div>
          </div>

          {/* Instant QR Payment Box */}
          {payload.status === 'payment' && (
            <div className="cfd-payment-box">
              <span className="cfd-payment-channel-badge">
                {payload.payment?.channel === 'instapay'
                  ? t('pos.customer_display.cfd_scanning_view.s13', "الدفع عبر InstaPay")
                  : payload.payment?.channel === 'wallet'
                  ? t('pos.customer_display.cfd_scanning_view.s14', "الدفع بالمحفظة الإلكترونية")
                  : payload.payment?.channel === 'card'
                  ? t('pos.customer_display.cfd_scanning_view.s15', "الدفع بالبطاقة البنكية")
                  : t('pos.customer_display.cfd_scanning_view.s16', "الدفع نقداً")}
              </span>

              {qrSvg ? (
                <div className="cfd-qr-container">
                  <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
                </div>
              ) : null}

              {payload.payment?.qrLabel && (
                <div className="cfd-payment-instruction">{payload.payment.qrLabel}</div>
              )}

              {payload.payment?.paidAmount && payload.payment.paidAmount > 0 ? (
                <div style={{ width: '100%', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
                  <div className="cfd-summary-row" style={{ fontSize: '14px' }}>
                    <span>{t('pos.customer_display.cfd_scanning_view.s17', "المدفوع:")}</span>
                    <span>{formatCurrency(payload.payment.paidAmount)}</span>
                  </div>
                  {payload.payment.change !== undefined && payload.payment.change > 0 && (
                    <div className="cfd-summary-row" style={{ fontSize: '16px', fontWeight: 900, color: '#16a34a' }}>
                      <span>{t('pos.customer_display.cfd_scanning_view.s18', "المتبقي للعميل:")}</span>
                      <span>{formatCurrency(payload.payment.change)}</span>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="cfd-footer-note">
          {t('pos.customer_display.cfd_scanning_view.s19', "يرجى مراجعة الأصناف والأسعار قبل الدفع • شكراً لزيارتكم")}
        </div>
      </div>
    </div>
  );
};
