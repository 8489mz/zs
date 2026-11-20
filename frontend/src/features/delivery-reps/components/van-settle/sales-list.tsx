import React from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { ClockIcon, ReceiptIcon } from '@/shared/components/icons/AppIcons';
import type { TFunction } from 'i18next';
import type { VanSettleTabProps } from './van-settle-types';

export interface SalesListProps {
  // NonNullable: S0 declares sales optional, but the facade destructures
  // sales = [] (always defined) and the body calls sales.length/.map
  // unguarded; the plain indexed-access type would fail CI tsc (strict).
  sales: NonNullable<VanSettleTabProps['sales']>;
  formatTime: (iso?: string) => string;
  getPaymentMethodBadge: (method: string) => { label: string; bg: string; color: string };
  t: TFunction;
}

export const SalesList: React.FC<SalesListProps> = ({ sales = [], formatTime, getPaymentMethodBadge, t }) => {
  return (
    <>
    {/* 1. SALES INVOICES */}
      {sales.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
          <ReceiptIcon size={28} color="#cbd5e1" style={{ margin: '0 auto 6px', display: 'block' }} />
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('delivery_reps.van_settle_tab.s69', "لم تصدر أي فواتير بيع في هذه الرحلة حتى الآن")}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sales.map((sale) => {
            const badge = getPaymentMethodBadge(sale.paymentMethod);
            return (
              <div
                key={sale.id}
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#170e5e' }}>
                    {t('delivery_reps.van_settle_tab.s70', "فاتورة #")}{sale.docNo}
                  </span>
                  <span style={{ fontSize: '13.5px', fontWeight: 900, color: '#0f172a' }}>
                    {Number(sale.total || 0).toFixed(2)} <CurrencySymbol />
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '11.5px' }}>
                  <span style={{ color: '#334155', fontWeight: 700 }}>
                    {t('delivery_reps.van_settle_tab.s71', "العميل:")} {sale.customerName || t('delivery_reps.van_settle_tab.s72', "عميل نقدي سريع")}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        backgroundColor: badge.bg,
                        color: badge.color,
                        padding: '2px 8px',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '10.5px',
                      }}
                    >
                      {badge.label}
                    </span>
                    <span style={{ color: '#94a3b8', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <ClockIcon size={12} color="#94a3b8" />
                      {formatTime(sale.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
