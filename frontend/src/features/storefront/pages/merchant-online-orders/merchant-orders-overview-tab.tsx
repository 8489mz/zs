import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { TrendingUpIcon, AlertTriangleIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { StorefrontAnalytics } from '../../types/storefront.types';

export interface MerchantOrdersOverviewTabProps {
  formatAmount: (val: number | null | undefined) => string;
  analyticsQuery: UseQueryResult<{ ok: boolean } & StorefrontAnalytics, Error>;
  setViewMode: Dispatch<SetStateAction<'overview' | 'orders' | 'abandoned'>>;
  setStatusFilter: Dispatch<SetStateAction<string>>;
  counts: Record<string, number> | undefined;
}

export function MerchantOrdersOverviewTab({
  formatAmount,
  analyticsQuery,
  setViewMode,
  setStatusFilter,
  counts,
}: MerchantOrdersOverviewTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Realtime Quick Stats Banner */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ borderInlineEnd: '1px solid #f1f5f9', paddingInlineEnd: '12px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, display: 'block' }}>مبيعات المتجر اليوم</span>
          <span style={{ fontSize: '22px', fontWeight: 900, color: '#16a34a', display: 'block', marginTop: '2px' }}>
            {formatAmount(analyticsQuery.data?.todayRevenue || 0)} <span style={{ fontSize: '13px', fontWeight: 700 }}>{getGlobalCurrencySymbol()}</span>
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            الطلبات اليومية: <strong>{analyticsQuery.data?.todayOrders || 0}</strong> طلبات
          </span>
        </div>

        <div style={{ borderInlineEnd: '1px solid #f1f5f9', paddingInlineEnd: '12px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, display: 'block' }}>طلبات بحاجة للمراجعة والتأكيد</span>
          <span style={{ fontSize: '22px', fontWeight: 900, color: (analyticsQuery.data?.pendingOrders || 0) > 0 ? '#b45309' : '#0f172a', display: 'block', marginTop: '2px' }}>
            {analyticsQuery.data?.pendingOrders || 0} <span style={{ fontSize: '13px', fontWeight: 700 }}>طلب</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setViewMode('orders');
              setStatusFilter('pending');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#170e5e',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            عرض الطلبات المعلقة فوراً ←
          </button>
        </div>

        <div>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, display: 'block' }}>السلات المتروكة غير المستردة</span>
          <span style={{ fontSize: '22px', fontWeight: 900, color: (analyticsQuery.data?.unrecoveredAbandoned || 0) > 0 ? '#dc2626' : '#0f172a', display: 'block', marginTop: '2px' }}>
            {analyticsQuery.data?.unrecoveredAbandoned || 0} <span style={{ fontSize: '13px', fontWeight: 700 }}>سلة</span>
          </span>
          <button
            type="button"
            onClick={() => setViewMode('abandoned')}
            style={{
              background: 'none',
              border: 'none',
              color: '#170e5e',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            استرداد المبيعات عبر واتساب ←
          </button>
        </div>
      </div>

      {/* Symmetrical 2-Column Insights Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '14px' }}>
        {/* Card 1: Top-Selling Online Products */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <TrendingUpIcon size={16} color="#16a34a" />
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>الأصناف الأكثر طلباً ومبيعاً أونلاين</span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>أعلى 5 منتجات</span>
          </div>

          {(!analyticsQuery.data?.topSellingProducts || analyticsQuery.data.topSellingProducts.length === 0) ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
              لا توجد بيانات مبيعات أونلاين مسجلة حتى الآن. ستظهر المنتجات الأكثر طلباً هنا تلقائياً عند ورود الطلبات.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {analyticsQuery.data.topSellingProducts.map((p, idx) => (
                <div
                  key={p.productId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #f1f5f9',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        background: idx === 0 ? '#fef3c7' : idx === 1 ? '#e2e8f0' : '#f1f5f9',
                        color: idx === 0 ? '#b45309' : '#475569',
                        fontSize: '11px',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>{p.productName}</span>
                  </div>
                  <div style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 700, background: '#dcfce7', padding: '2px 6px', borderRadius: '4px' }}>
                      {p.quantity} مبيعات
                    </span>
                    <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#0f172a' }}>
                      {formatAmount(p.revenue)} {getGlobalCurrencySymbol()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Card 2: Low-Stock Storefront Alerts */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangleIcon size={16} color="#d97706" />
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>تنبيهات نواقص مخزون المتجر</span>
            </div>
            <span style={{ fontSize: '11px', color: '#d97706', fontWeight: 700 }}>رصيد 5 قطع أو أقل</span>
          </div>

          {(!analyticsQuery.data?.lowStockStorefrontProducts || analyticsQuery.data.lowStockStorefrontProducts.length === 0) ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: '#16a34a', fontSize: '12px', fontWeight: 600 }}>
              مخزون الأصناف المعروضة بالمتجر في حالة ممتازة ولا توجد نواقص حرجة حالياً.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {analyticsQuery.data.lowStockStorefrontProducts.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: '#fffbeb',
                    border: '1px solid #fef3c7',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block' }}>{p.name}</span>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      السعر: {formatAmount(p.price)} {getGlobalCurrencySymbol()}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      padding: '3px 8px',
                      borderRadius: '4px',
                      background: p.stock <= 0 ? '#fef2f2' : '#fee2e2',
                      color: p.stock <= 0 ? '#b91c1c' : '#dc2626',
                      border: '1px solid #fecaca',
                    }}
                  >
                    {p.stock <= 0 ? 'نفد من المخزن' : `متبقي ${p.stock} فقط`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Card 3: Order Fulfillment Pipeline Kanban Cards */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            خط سير وتجهيز الطلبات (Fulfillment Pipeline)
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            انقر على أي مرحلة للانتقال المباشر لجدول طلباتها
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
          {[
            { id: 'pending', label: 'جديد / قيد الانتظار', count: counts?.pending ?? 0, bg: '#fefce8', color: '#854d0e', border: '#fef08a' },
            { id: 'confirmed', label: 'تم التأكيد', count: counts?.confirmed ?? 0, bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
            { id: 'processing', label: 'جاري التجهيز', count: counts?.processing ?? 0, bg: '#f0f9ff', color: '#0369a1', border: '#bae6fd' },
            { id: 'shipped', label: 'خرجت للتوصيل', count: counts?.shipped ?? 0, bg: '#fff7ed', color: '#c2410c', border: '#ffedd5' },
            { id: 'delivered', label: 'مكتملة ومسلمة', count: counts?.delivered ?? 0, bg: '#f0fdf4', color: '#15803d', border: '#dcfce7' },
          ].map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => {
                setViewMode('orders');
                setStatusFilter(step.id);
              }}
              style={{
                background: step.bg,
                border: `1px solid ${step.border}`,
                borderRadius: '8px',
                padding: '10px 8px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'transform 0.1s ease',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 700, color: step.color, display: 'block', marginBottom: '4px' }}>
                {step.label}
              </span>
              <span style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a' }}>
                {step.count}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
