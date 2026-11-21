import { useTranslation } from 'react-i18next';
import type { CartItem } from './van-sale-types';
import { ReceiptIcon } from '@/shared/components/icons/AppIcons';

export interface SaleHeaderProps {
  cart: CartItem[];
  onGoToSalesHistory?: () => void;
}

export function SaleHeader({ cart, onGoToSalesHistory }: SaleHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: '#f8fafc',
        margin: '-12px -14px 4px -14px',
        padding: '10px 14px',
        borderRadius: '12px 12px 0 0',
        borderBottom: '1px solid #e2e8f0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
          {t('delivery_reps.van_sale_tab.s0', "فاتورة بيع ميداني")}
        </h3>
        {cart.length > 0 && (
          <span style={{ fontSize: '10.5px', backgroundColor: '#eef2ff', color: '#170e5e', border: '1px solid #c7d2fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 800 }}>
            {cart.length} {cart.length === 1 ? t('delivery_reps.van_sale_tab.s1', "صنف") : cart.length === 2 ? t('delivery_reps.van_sale_tab.s2', "صنفان") : cart.length <= 10 ? t('delivery_reps.van_sale_tab.s3', "أصناف") : t('delivery_reps.van_sale_tab.s4', "صنف")}
          </span>
        )}
      </div>
      {onGoToSalesHistory && (
        <button
          type="button"
          onClick={onGoToSalesHistory}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            borderRadius: '6px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            color: '#170e5e',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          }}
          title={t('delivery_reps.van_sale_tab.s5', "الانتقال لسجل الفواتير السابقة وإعادة الطباعة")}
        >
          <ReceiptIcon size={12} color="#170e5e" />
          <span>{t('delivery_reps.van_sale_tab.s6', "سجل الفواتير")}</span>
        </button>
      )}
    </div>
  );
}
