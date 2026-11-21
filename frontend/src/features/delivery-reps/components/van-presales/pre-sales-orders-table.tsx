import { useTranslation } from 'react-i18next';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { PreSalesOrderRecord } from '../../api/van-sales.api';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';

export interface PreSalesOrdersTableProps {
  approveMutation: { isPending: boolean };
  approvedOrders: PreSalesOrderRecord[];
  convertInvoiceMutation: { isPending: boolean };
  getStatusBadge: (status: string) => ReactNode;
  handleApprove: (order: PreSalesOrderRecord) => Promise<void>;
  handleConvertInvoice: (order: PreSalesOrderRecord) => Promise<void>;
  isLoading: boolean;
  openRejectDialog: (orderId: number) => void;
  orders: PreSalesOrderRecord[];
  rejectMutation: { isPending: boolean };
  selectedOrderIds: number[];
  setInspectingOrderId: Dispatch<SetStateAction<number | null>>;
  toggleSelectAllApproved: () => void;
  toggleSelectOrder: (orderId: number) => void;
}

export function PreSalesOrdersTable({
  approveMutation,
  approvedOrders,
  convertInvoiceMutation,
  getStatusBadge,
  handleApprove,
  handleConvertInvoice,
  isLoading,
  openRejectDialog,
  orders,
  rejectMutation,
  selectedOrderIds,
  setInspectingOrderId,
  toggleSelectAllApproved,
  toggleSelectOrder,
}: PreSalesOrdersTableProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            textAlign: 'right',
            fontSize: '12.5px',
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                color: '#475569',
                fontSize: '11.5px',
                fontWeight: 700,
              }}
            >
              <th style={{ padding: '10px 10px', width: '36px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  title={t('delivery_reps.van_pre_sales_admin_tab.s19', "تحديد كافة الطلبيات المعتمدة")}
                  disabled={approvedOrders.length === 0}
                  checked={
                    approvedOrders.length > 0 &&
                    approvedOrders.every((o) => selectedOrderIds.includes(o.id))
                  }
                  onChange={toggleSelectAllApproved}
                  style={{ cursor: approvedOrders.length > 0 ? 'pointer' : 'not-allowed' }}
                />
              </th>
              <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s20', "رقم الطلبية")}</th>
              <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s21', "المندوب")}</th>
              <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s22', "العميل")}</th>
              <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s23', "المخزن المطلوب")}</th>
              <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s24', "طريقة الدفع")}</th>
              <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s25', "عدد البنود")}</th>
              <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s26', "الإجمالي")}</th>
              <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s27', "الحالة")}</th>
              <th style={{ padding: '10px 14px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s28', "تاريخ الحجز")}</th>
              <th style={{ padding: '10px 14px', textAlign: 'center' }}>{t('delivery_reps.van_pre_sales_admin_tab.s29', "الإجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
                  {t('delivery_reps.van_pre_sales_admin_tab.s30', "جاري تحميل طلبيات المناديب الميدانية...")}
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                  {t('delivery_reps.van_pre_sales_admin_tab.s31', "لا توجد طلبيات حجز ميدانية مطابقة لمعايير البحث الحالية")}
                </td>
              </tr>
            ) : (
              orders.map((ord) => (
                <tr
                  key={ord.id}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    backgroundColor: selectedOrderIds.includes(ord.id) ? '#f8fafc' : undefined,
                    transition: 'background-color 0.1s',
                  }}
                >
                  <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                    {ord.status === 'approved' ? (
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.includes(ord.id)}
                        onChange={() => toggleSelectOrder(ord.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    ) : null}
                  </td>
                  <td style={{ padding: '10px 14px', fontWeight: 800, fontFamily: 'monospace', color: '#170e5e' }}>
                    #{ord.orderNumber}
                  </td>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a' }}>
                    {ord.repName || `مندوب #${ord.repId}`}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{ord.customerName || t('delivery_reps.van_pre_sales_admin_tab.s32', "عميل نقدي")}</div>
                    {ord.customerPhone ? (
                      <div style={{ fontSize: '10.5px', color: '#64748b' }}>{ord.customerPhone}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#475569', fontSize: '11.5px' }}>
                    {ord.warehouseLocationName || t('delivery_reps.van_pre_sales_admin_tab.s33', "المخزن الرئيسي")}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span
                      style={{
                        padding: '2px 7px',
                        borderRadius: '5px',
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor: ord.paymentTerms === 'cash' ? '#dcfce7' : '#fef3c7',
                        color: ord.paymentTerms === 'cash' ? '#15803d' : '#b45309',
                      }}
                    >
                      {ord.paymentTerms === 'cash' ? t('delivery_reps.van_pre_sales_admin_tab.s34', "كاش نقدي") : t('delivery_reps.van_pre_sales_admin_tab.s35', "آجل على الحساب")}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{ord.itemsCount} {t('delivery_reps.van_pre_sales_admin_tab.s36', "أصناف")}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 800, color: '#170e5e' }}>
                    {Number(ord.totalAmount).toFixed(2)} <CurrencySymbol />
                  </td>
                  <td style={{ padding: '10px 14px' }}>{getStatusBadge(ord.status)}</td>
                  <td style={{ padding: '10px 14px', fontSize: '11px', color: '#64748b' }}>
                    {ord.createdAt ? new Date(ord.createdAt).toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Button
                        variant="secondary"
                        onClick={() => setInspectingOrderId(ord.id)}
                        style={{
                          height: '28px',
                          padding: '0 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                        }}
                      >
                        {t('delivery_reps.van_pre_sales_admin_tab.s37', "التفاصيل")}
                      </Button>

                      {(ord.status === 'pending_supervisor' || ord.status === 'pending_approval') ? (
                        <>
                          <Button
                            variant="primary"
                            onClick={() => handleApprove(ord)}
                            disabled={approveMutation.isPending}
                            style={{
                              height: '28px',
                              padding: '0 8px',
                              fontSize: '11px',
                              fontWeight: 800,
                              backgroundColor: '#15803d',
                              color: '#ffffff',
                            }}
                          >
                            {t('delivery_reps.van_pre_sales_admin_tab.s38', "اعتماد")}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => openRejectDialog(ord.id)}
                            disabled={rejectMutation.isPending}
                            style={{
                              height: '28px',
                              padding: '0 8px',
                              fontSize: '11px',
                              fontWeight: 700,
                              color: '#b91c1c',
                              borderColor: '#fca5a5',
                            }}
                          >
                            {t('delivery_reps.van_pre_sales_admin_tab.s39', "رفض")}
                          </Button>
                        </>
                      ) : ord.status === 'approved' ? (
                        <Button
                          variant="primary"
                          onClick={() => handleConvertInvoice(ord)}
                          disabled={convertInvoiceMutation.isPending}
                          style={{
                            height: '28px',
                            padding: '0 8px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: '#170e5e',
                            color: '#ffffff',
                          }}
                        >
                          {t('delivery_reps.van_pre_sales_admin_tab.s40', "تحويل لفاتورة جملة")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
