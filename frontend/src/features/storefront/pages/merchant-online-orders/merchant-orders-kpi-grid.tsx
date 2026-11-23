import { useTranslation } from 'react-i18next';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { TrendingUpIcon } from '@/shared/components/icons/AppIcons';

interface MerchantOrdersKpiGridProps {
  totalRevenueAmount: number;
  totalOrdersCount: number;
  pendingOrdersCount: number;
  averageOrderVal: number;
  conversionRateVal: number;
  unrecoveredCount: number;
}

export function MerchantOrdersKpiGrid({
  totalRevenueAmount,
  totalOrdersCount,
  pendingOrdersCount,
  averageOrderVal,
  conversionRateVal,
  unrecoveredCount,
}: MerchantOrdersKpiGridProps) {
  const { t } = useTranslation();
  return (
    <div
      className="merchant-orders-kpi-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
        gap: '12px',
        marginBottom: '16px',
      }}
    >
      {/* Card 1: Revenue */}
      <div
        className="merchant-orders-kpi-card"
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '14px 16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>
          <span>{t('storefront.merchant_online_orders_page.s7', "إجمالي إيرادات المتجر")}</span>
          <TrendingUpIcon size={16} color="#16a34a" />
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
          {totalRevenueAmount.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600 }}>{getGlobalCurrencySymbol()}</span>
        </div>
        <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
          {t('storefront.merchant_online_orders_page.s8', "الطلبات الصالحة والمسلمة")}
        </span>
      </div>

      {/* Card 2: Orders Count */}
      <div
        className="merchant-orders-kpi-card"
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '14px 16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>
          <span>{t('storefront.merchant_online_orders_page.s9', "إجمالي عدد الطلبات")}</span>
          <span style={{ fontSize: '11px', color: '#170e5e', fontWeight: 700, background: '#f0f3ff', padding: '1px 6px', borderRadius: '4px' }}>{t('storefront.merchant_online_orders_page.s10', "متجر")}</span>
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
          {totalOrdersCount.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600 }}>{t('storefront.merchant_online_orders_page.s11', "طلب")}</span>
        </div>
        <span style={{ fontSize: '11px', color: '#64748b' }}>
          {t('storefront.merchant_online_orders_page.s12', "قيد التنفيذ:")} {pendingOrdersCount} {t('storefront.merchant_online_orders_page.s13', "طلبات")}
        </span>
      </div>

      {/* Card 3: AOV */}
      <div
        className="merchant-orders-kpi-card"
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '14px 16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>
          <span>{t('storefront.merchant_online_orders_page.s14', "متوسط قيمة السلة (AOV)")}</span>
          <span style={{ fontSize: '11px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff', padding: '1px 6px', borderRadius: '4px' }}>{t('storefront.merchant_online_orders_page.s15', "معدل")}</span>
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
          {averageOrderVal.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600 }}>{getGlobalCurrencySymbol()}</span>
        </div>
        <span style={{ fontSize: '11px', color: '#64748b' }}>
          {t('storefront.merchant_online_orders_page.s16', "متوسط الفاتورة لكل عميل")}
        </span>
      </div>

      {/* Card 4: Conversion Rate & Abandoned */}
      <div
        className="merchant-orders-kpi-card"
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '14px 16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>
          <span>{t('storefront.merchant_online_orders_page.s17', "معدل التحويل والسلات")}</span>
          <span style={{ fontSize: '11px', color: '#d97706', fontWeight: 700, background: '#fffbeb', padding: '1px 6px', borderRadius: '4px' }}>{t('storefront.merchant_online_orders_page.s18', "تحويل")}</span>
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
          {conversionRateVal}%
        </div>
        <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>
          {t('storefront.merchant_online_orders_page.s19', "سلات متروكة:")} {unrecoveredCount} {t('storefront.merchant_online_orders_page.s20', "سلة")}
        </span>
      </div>
    </div>
  );
}
