import { useTranslation } from 'react-i18next';
import { MerchantOrdersTable } from '../../components/MerchantOrdersTable';
import type { Dispatch, SetStateAction } from 'react';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import type { OnlineOrderRecord } from '../../types/storefront.types';

export interface MerchantOrdersOrdersTabProps {
  counts: Record<string, number> | undefined;
  setStatusFilter: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  statusFilter: string;
  orders: OnlineOrderRecord[];
  ordersQuery: UseQueryResult<{ orders: OnlineOrderRecord[]; counts?: Record<string, number> }, Error>;
  setSelectedOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  setDeliveryModalOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  setBostaModalOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  setGccModalOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  handleLoadToPos: (orderId: number) => Promise<void>;
  loadingPosOrderId: number | null;
  updateStatusMutation: UseMutationResult<{ ok: boolean; status: string; saleId?: number }, Error, { id: number; status: string }>;
  isBostaConfigured: boolean;
  isGccConfigured: boolean;
  totalPages: number;
  page: number;
  pageSize: number;
  totalFilteredCount: number;
}

export function MerchantOrdersOrdersTab({
  counts,
  setStatusFilter,
  setPage,
  statusFilter,
  orders,
  ordersQuery,
  setSelectedOrder,
  setDeliveryModalOrder,
  setBostaModalOrder,
  setGccModalOrder,
  handleLoadToPos,
  loadingPosOrderId,
  updateStatusMutation,
  isBostaConfigured,
  isGccConfigured,
  totalPages,
  page,
  pageSize,
  totalFilteredCount,
}: MerchantOrdersOrdersTabProps) {
  const { t } = useTranslation();
  return (
    <div
      className="card"
      style={{
        background: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        padding: '16px',
        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* Status Filter Tabs */}
      <div
        className="merchant-orders-status-tabs"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          paddingBottom: '8px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        {[
          { id: 'all', label: t('storefront.merchant_online_orders_page.s23', "جميع الطلبات"), count: counts?.all },
          { id: 'pending', label: t('storefront.merchant_online_orders_page.s24', "قيد الانتظار (جديدة)"), count: counts?.pending },
          { id: 'confirmed', label: t('storefront.merchant_online_orders_page.s25', "تم التأكيد"), count: counts?.confirmed },
          { id: 'processing', label: t('storefront.merchant_online_orders_page.s26', "جاري التجهيز"), count: counts?.processing },
          { id: 'shipped', label: t('storefront.merchant_online_orders_page.s27', "خرجت للتوصيل"), count: counts?.shipped },
          { id: 'delivered', label: t('storefront.merchant_online_orders_page.s28', "مكتملة ومسلمة"), count: counts?.delivered },
          { id: 'cancelled', label: t('storefront.merchant_online_orders_page.s29', "ملغية"), count: counts?.cancelled },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setStatusFilter(tab.id);
              setPage(1);
            }}
            style={{
              padding: '7px 14px',
              borderRadius: '999px',
              fontSize: '12.5px',
              fontWeight: 700,
              background: statusFilter === tab.id ? '#170e5e' : '#ffffff',
              color: statusFilter === tab.id ? '#ffffff' : '#475569',
              border: statusFilter === tab.id ? '1px solid #170e5e' : '1px solid #e2e8f0',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: '999px',
                  background: statusFilter === tab.id ? 'rgba(255, 255, 255, 0.25)' : '#f1f5f9',
                  color: statusFilter === tab.id ? '#ffffff' : '#64748b',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Orders Table */}
      <MerchantOrdersTable
        orders={orders}
        isLoading={ordersQuery.isLoading}
        onSelectOrder={setSelectedOrder}
        onConvertToDelivery={(order) => setDeliveryModalOrder(order)}
        onShipBosta={(order) => setBostaModalOrder(order)}
        onShipGcc={(order) => setGccModalOrder(order)}
        onLoadToPos={handleLoadToPos}
        loadingPosOrderId={loadingPosOrderId}
        onUpdateStatus={(id, status) => updateStatusMutation.mutate({ id, status })}
        isUpdatingStatus={updateStatusMutation.isPending}
        isBostaConfigured={isBostaConfigured}
        isGccConfigured={isGccConfigured}
      />

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '12px',
            borderTop: '1px solid #f1f5f9',
            marginTop: '4px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ fontSize: '12.5px', color: '#64748b' }}>
            {t('storefront.merchant_online_orders_page.s30', "عرض")} <strong>{((page - 1) * pageSize) + 1}</strong> {t('storefront.merchant_online_orders_page.s31', "إلى")} <strong>{Math.min(page * pageSize, totalFilteredCount)}</strong> {t('storefront.merchant_online_orders_page.s32', "من إجمالي")} <strong>{totalFilteredCount.toLocaleString()}</strong> {t('storefront.merchant_online_orders_page.s33', "طلب")}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: page <= 1 ? '#f8fafc' : '#ffffff',
                color: page <= 1 ? '#94a3b8' : '#334155',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              {t('storefront.merchant_online_orders_page.s34', "الصفحة السابقة")}
            </button>
            <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#170e5e', padding: '0 8px' }}>
              {t('storefront.merchant_online_orders_page.s35', "صفحة")} {page} {t('storefront.merchant_online_orders_page.s36', "من")} {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: page >= totalPages ? '#f8fafc' : '#ffffff',
                color: page >= totalPages ? '#94a3b8' : '#334155',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              {t('storefront.merchant_online_orders_page.s37', "الصفحة التالية")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
