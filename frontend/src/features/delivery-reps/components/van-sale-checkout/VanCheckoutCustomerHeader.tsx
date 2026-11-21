import type { TFunction } from 'i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';

export interface VanCheckoutCustomerHeaderProps {
  t: TFunction;
  customerDisplayName: string;
  customer?: { id: number; name: string; phone?: string; balance: number; creditLimit?: number; customerCode?: string; route?: string } | null;
  cartTotal: number;
}

export function VanCheckoutCustomerHeader({
  t,
  customerDisplayName,
  customer,
  cartTotal,
}: VanCheckoutCustomerHeaderProps) {
  return (
    <>
      {/* Customer Header Info Strip - Breathable & Balanced */}
      <div
        style={{
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '9px',
          padding: '9px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 700 }}>{t('delivery_reps.van_sale_checkout_modal.s6', "العميل:")}</span>
            <strong style={{ fontSize: '13px', color: '#0f172a', fontWeight: 800 }}>
              {customerDisplayName}
            </strong>
            {customer?.customerCode && (
              <span style={{ fontSize: '10px', backgroundColor: '#e2e8f0', color: '#334155', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                [{customer.customerCode.replace(/^#/, '')}]
              </span>
            )}
          </div>
          {customer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px', fontSize: '11px', color: '#475569' }}>
              <span>
                {t('delivery_reps.van_sale_checkout_modal.s7', "المديونية:")} <strong style={{ color: customer.balance > 0 ? '#b91c1c' : '#15803d' }}>{customer.balance.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s8', "ج.م")}</strong>
              </span>
              {customer.creditLimit ? (
                <span>{t('delivery_reps.van_sale_checkout_modal.s9', "سقف الائتمان:")} <strong>{customer.creditLimit.toFixed(2)} {t('delivery_reps.van_sale_checkout_modal.s10', "ج.م")}</strong></span>
              ) : null}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'left' }}>
          <span style={{ fontSize: '10.5px', color: '#64748b', display: 'block' }}>{t('delivery_reps.van_sale_checkout_modal.s11', "المطلوب سداده")}</span>
          <span style={{ fontSize: '16px', fontWeight: 900, color: '#170e5e' }}>
            {cartTotal.toFixed(2)} <CurrencySymbol />
          </span>
        </div>
      </div>
    </>
  );
}
