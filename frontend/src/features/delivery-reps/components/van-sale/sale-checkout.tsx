import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import type { CartItem } from './van-sale-types';
import { CreditCardIcon } from '@/shared/components/icons/AppIcons';

export interface SaleCheckoutProps {
  cart: CartItem[];
  cartDiscount: number;
  cartSubtotal: number;
  cartTotal: number;
  isSubmitting: boolean;
  onSubmitSale: () => void;
  totalPieces: number;
}

export function SaleCheckout({
  cart,
  cartDiscount,
  cartSubtotal,
  cartTotal,
  isSubmitting,
  onSubmitSale,
  totalPieces,
}: SaleCheckoutProps) {
  const { t } = useTranslation();
  return (
    <div
      id="van-sale-checkout-card"
      style={{
        borderTop: '1px solid #f1f5f9',
        paddingTop: '8px',
        paddingBottom: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Unified Compact Summary Strip */}
      <div
        style={{
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '9px',
          padding: '9px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {/* Row 1: Item counts & Discount badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px', color: '#475569' }}>
          <span>
            {t('delivery_reps.van_sale_tab.s43', "عدد البنود:")} <strong style={{ color: '#0f172a' }}>{cart.length} {t('delivery_reps.van_sale_tab.s44', "أصناف")}</strong> ({totalPieces} {t('delivery_reps.van_sale_tab.s45', "قطعة)")}
          </span>
          {cartDiscount > 0 && (
            <span style={{ fontSize: '10.5px', color: '#475569', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
              {t('delivery_reps.van_sale_tab.s46', "وفرت")} {cartDiscount.toFixed(2)} <CurrencySymbol />
            </span>
          )}
        </div>

        {/* Row 2: Subtotal if discount exists */}
        {cartDiscount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#64748b' }}>
            <span>{t('delivery_reps.van_sale_tab.s47', "المجموع الفرعي (قبل الخصم):")}</span>
            <span style={{ textDecoration: 'line-through' }}>
              {cartSubtotal.toFixed(2)} <CurrencySymbol />
            </span>
          </div>
        )}

        {/* Row 3: Final Total */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '5px', borderTop: '1px dashed #cbd5e1' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.van_sale_tab.s48', "إجمالي الفاتورة المطلوب:")}
          </span>
          <span style={{ fontSize: '16px', fontWeight: 900, color: '#170e5e' }}>
            {cartTotal.toFixed(2)} <CurrencySymbol />
          </span>
        </div>
      </div>

      {/* Primary Action Button */}
      <Button
        variant="primary"
        onClick={onSubmitSale}
        disabled={isSubmitting}
        style={{
          backgroundColor: '#170e5e',
          color: '#ffffff',
          height: '42px',
          fontSize: '13.5px',
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          borderRadius: '8px',
          boxShadow: '0 2px 6px rgba(23, 14, 94, 0.2)',
        }}
      >
        <CreditCardIcon size={16} color="#ffffff" />
        <span>{isSubmitting ? t('delivery_reps.van_sale_tab.s49', "جاري الحفظ والخصم...") : `إتمام البيع والسداد (${cartTotal.toFixed(2)} ج.م)`}</span>
      </Button>
    </div>
  );
}
