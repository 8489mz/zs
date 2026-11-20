import React from 'react';
import { useTranslation } from 'react-i18next';
import type { QueryObserverResult } from '@tanstack/react-query';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import type { PreSalesOrderRecord } from '../../api/van-sales.api';

interface MyOrdersViewProps {
  myOrders: PreSalesOrderRecord[];
  isMyOrdersLoading: boolean;
  isMyOrdersFetching: boolean;
  refetchMyOrders: () => Promise<QueryObserverResult<PreSalesOrderRecord[], Error>>;
}

export const MyOrdersView: React.FC<MyOrdersViewProps> = ({
  myOrders,
  isMyOrdersLoading,
  isMyOrdersFetching,
  refetchMyOrders,
}) => {
  const { t } = useTranslation();

  const getOrderStatusBadge = (status: string) => {
    switch (status) {
      case 'pending_supervisor':
      case 'pending_approval':
        return (
          <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fef3c7', color: '#b45309' }}>
            {t('delivery_reps.van_pre_sales_tab.s0', "بانتظار اعتماد المشرف")}
          </span>
        );
      case 'approved':
      case 'confirmed':
        return (
          <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' }}>
            {t('delivery_reps.van_pre_sales_tab.s1', "معتمدة وجاهزة للتحميل")}
          </span>
        );
      case 'rejected':
        return (
          <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fee2e2', color: '#b91c1c' }}>
            {t('delivery_reps.van_pre_sales_tab.s2', "مرفوضة من المشرف")}
          </span>
        );
      default:
        return (
          <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, backgroundColor: '#f1f5f9', color: '#475569' }}>
            {status}
          </span>
        );
    }
  };

  return (
    <>
        /* MY ORDERS SUB-TAB */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{t('delivery_reps.van_pre_sales_tab.s71', "سجل طلبياتي المحجوزة:")}</span>
            <Button
              variant="secondary"
              onClick={() => refetchMyOrders()}
              disabled={isMyOrdersFetching}
              style={{ height: '30px', padding: '0 8px', fontSize: '11px' }}
            >
              <RefreshCwIcon size={13} className={isMyOrdersFetching ? 'spin' : ''} />
              <span>{t('delivery_reps.van_pre_sales_tab.s72', "تحديث")}</span>
            </Button>
          </div>

          {isMyOrdersLoading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '12px' }}>
              {t('delivery_reps.van_pre_sales_tab.s73', "جاري تحميل طلبياتك...")}
            </div>
          ) : myOrders.length === 0 ? (
            <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '12.5px' }}>
              {t('delivery_reps.van_pre_sales_tab.s74', "لم تقم بحجز أي طلبيات مسبقة حتى الآن.")}
            </div>
          ) : (
            myOrders.map((ord) => (
              <div
                key={ord.id}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#170e5e', fontSize: '12px' }}>
                    #{ord.orderNumber}
                  </span>
                  {getOrderStatusBadge(ord.status)}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>
                    {t('delivery_reps.van_pre_sales_tab.s75', "العميل:")} <strong style={{ color: '#0f172a' }}>{ord.customerName}</strong>
                  </span>
                  <span style={{ fontWeight: 800, color: '#059669' }}>
                    {Number(ord.totalAmount).toFixed(2)} <CurrencySymbol />
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
                  <span>
                    <span style={{ fontWeight: 700, color: ord.paymentTerms === 'cash' ? '#15803d' : '#b45309' }}>
                      {ord.paymentTerms === 'cash' ? t('delivery_reps.van_pre_sales_tab.s76', "كاش نقدي") : t('delivery_reps.van_pre_sales_tab.s77', "آجل على الحساب")}
                    </span>
                    {ord.discountAmount != null && ord.discountAmount > 0 ? (
                      <span style={{ marginInlineStart: '6px', color: '#059669', fontWeight: 700 }}>
                        {t('delivery_reps.van_pre_sales_tab.s78', "(خصم تعجيل: -")}{Number(ord.discountAmount).toFixed(2)})
                      </span>
                    ) : null}
                    {' '}| {ord.itemsCount} {t('delivery_reps.van_pre_sales_tab.s79', "أصناف")}
                  </span>
                  <span>
                    {ord.createdAt ? new Date(ord.createdAt).toLocaleDateString('ar-EG') : ''}
                  </span>
                </div>

                {ord.supervisorRejectionReason ? (
                  <div style={{ fontSize: '11px', color: '#b91c1c', backgroundColor: '#fef2f2', padding: '4px 8px', borderRadius: '4px' }}>
                    <b>{t('delivery_reps.van_pre_sales_tab.s80', "سبب الرفض:")}</b> {ord.supervisorRejectionReason}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
    </>
  );
};
