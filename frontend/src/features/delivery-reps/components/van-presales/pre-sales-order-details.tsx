import { useTranslation } from 'react-i18next';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { PreSalesOrderRecord } from '../../api/van-sales.api';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';

export interface PreSalesOrderDetailsProps {
  convertInvoiceMutation: { isPending: boolean };
  getStatusBadge: (status: string) => ReactNode;
  handleApprove: (order: PreSalesOrderRecord) => Promise<void>;
  handleConvertInvoice: (order: PreSalesOrderRecord) => Promise<void>;
  inspectedOrder: PreSalesOrderRecord | null | undefined;
  inspectingOrderId: number | null;
  isInspectingLoading: boolean;
  openRejectDialog: (orderId: number) => void;
  setConsolidateTargetRepId: Dispatch<SetStateAction<number | ''>>;
  setInspectingOrderId: Dispatch<SetStateAction<number | null>>;
  setSelectedOrderIds: Dispatch<SetStateAction<number[]>>;
  setShowConsolidateDialog: Dispatch<SetStateAction<boolean>>;
}

export function PreSalesOrderDetails({
  convertInvoiceMutation,
  getStatusBadge,
  handleApprove,
  handleConvertInvoice,
  inspectedOrder,
  inspectingOrderId,
  isInspectingLoading,
  openRejectDialog,
  setConsolidateTargetRepId,
  setInspectingOrderId,
  setSelectedOrderIds,
  setShowConsolidateDialog,
}: PreSalesOrderDetailsProps) {
  const { t } = useTranslation();
  return (
    <StandardDialog
      open={true}
      onClose={() => setInspectingOrderId(null)}
      title={`تفاصيل طلبية المندوب #${inspectedOrder?.orderNumber || inspectingOrderId}`}
      subtitle={t('delivery_reps.van_pre_sales_admin_tab.s41', "مراجعة بنود الحجز من المخزن الرئيسي ومستويات الأسعار")}
      badge="Pre-Sales"
      width="min(820px, 96vw)"
      footerActions={
        <StandardDialogFooter
          onClose={() => setInspectingOrderId(null)}
          cancelText={t('delivery_reps.van_pre_sales_admin_tab.s42', "إغلاق")}
          extraActions={
            (inspectedOrder?.status === 'pending_supervisor' || inspectedOrder?.status === 'pending_approval') ? (
              <div style={{ display: 'inline-flex', gap: '8px' }}>
                <Button
                  variant="secondary"
                  onClick={() => openRejectDialog(inspectedOrder.id)}
                  style={{ color: '#b91c1c', borderColor: '#fca5a5', fontWeight: 700, fontSize: '12px' }}
                >
                  {t('delivery_reps.van_pre_sales_admin_tab.s43', "رفض الطلبية")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleApprove(inspectedOrder)}
                  style={{ backgroundColor: '#15803d', color: '#fff', fontWeight: 800, fontSize: '12px' }}
                >
                  {t('delivery_reps.van_pre_sales_admin_tab.s44', "اعتماد الطلبية الآن")}
                </Button>
              </div>
            ) : inspectedOrder?.status === 'approved' ? (
              <div style={{ display: 'inline-flex', gap: '8px' }}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSelectedOrderIds([inspectedOrder.id]);
                    setConsolidateTargetRepId(inspectedOrder.repId || '');
                    setInspectingOrderId(null);
                    setShowConsolidateDialog(true);
                  }}
                  style={{ fontWeight: 700, fontSize: '12px', color: '#170e5e', borderColor: '#c7d2fe' }}
                >
                  {t('delivery_reps.van_pre_sales_admin_tab.s45', "توليد إذن تحميل للسيارة")}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleConvertInvoice(inspectedOrder)}
                  disabled={convertInvoiceMutation.isPending}
                  style={{ backgroundColor: '#170e5e', color: '#fff', fontWeight: 800, fontSize: '12px' }}
                >
                  {convertInvoiceMutation.isPending ? t('delivery_reps.van_pre_sales_admin_tab.s46', "جاري الإصدار...") : t('delivery_reps.van_pre_sales_admin_tab.s47', "إصدار فاتورة بيع جملة مباشرة")}
                </Button>
              </div>
            ) : undefined
          }
        />
      }
    >
      {isInspectingLoading || !inspectedOrder ? (
        <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
          {t('delivery_reps.van_pre_sales_admin_tab.s48', "جاري تحميل تفاصيل الطلبية وبنود الحجز...")}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* ORDER SUMMARY STRIP */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '8px',
              backgroundColor: '#f8fafc',
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              fontSize: '12px',
            }}
          >
            <div>
              <span style={{ color: '#64748b' }}>{t('delivery_reps.van_pre_sales_admin_tab.s49', "المندوب:")} </span>
              <strong style={{ color: '#0f172a' }}>{inspectedOrder.repName}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>{t('delivery_reps.van_pre_sales_admin_tab.s50', "العميل:")} </span>
              <strong style={{ color: '#0f172a' }}>{inspectedOrder.customerName}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>{t('delivery_reps.van_pre_sales_admin_tab.s51', "طريقة الدفع:")} </span>
              <strong style={{ color: inspectedOrder.paymentTerms === 'cash' ? '#15803d' : '#b45309' }}>
                {inspectedOrder.paymentTerms === 'cash' ? t('delivery_reps.van_pre_sales_admin_tab.s52', "كاش نقدي") : t('delivery_reps.van_pre_sales_admin_tab.s53', "آجل على الحساب")}
              </strong>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>{t('delivery_reps.van_pre_sales_admin_tab.s54', "المخزن المحجوز منه:")} </span>
              <strong style={{ color: '#170e5e' }}>{inspectedOrder.warehouseLocationName || t('delivery_reps.van_pre_sales_admin_tab.s55', "المخزن الرئيسي")}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>{t('delivery_reps.van_pre_sales_admin_tab.s56', "الحالة:")} </span>
              {getStatusBadge(inspectedOrder.status)}
            </div>
            <div>
              <span style={{ color: '#64748b' }}>{t('delivery_reps.van_pre_sales_admin_tab.s57', "تاريخ التسليم المتوقع:")} </span>
              <strong>{inspectedOrder.deliveryDate || t('delivery_reps.van_pre_sales_admin_tab.s58', "فوري / اليوم")}</strong>
            </div>
          </div>

          {inspectedOrder.notes ? (
            <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fef3c7', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', color: '#92400e' }}>
              <b>{t('delivery_reps.van_pre_sales_admin_tab.s59', "ملاحظات المندوب:")}</b> {inspectedOrder.notes}
            </div>
          ) : null}

          {inspectedOrder.supervisorRejectionReason ? (
            <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fee2e2', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', color: '#b91c1c' }}>
              <b>{t('delivery_reps.van_pre_sales_admin_tab.s60', "سبب الرفض:")}</b> {inspectedOrder.supervisorRejectionReason}
            </div>
          ) : null}

          {/* ITEMS BREAKDOWN TABLE */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9', color: '#334155', fontWeight: 700, fontSize: '11.5px' }}>
                  <th style={{ padding: '8px 12px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s61', "الصنف")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s62', "الوحدة")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s63', "الكمية")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s64', "سعر البيع (للمحل)")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s65', "سعر المستهلك (SRP)")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s66', "وفر العرض")}</th>
                  <th style={{ padding: '8px 12px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s67', "الإجمالي")}</th>
                </tr>
              </thead>
              <tbody>
                {(inspectedOrder.items || []).map((it) => (
                  <tr key={it.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: '#0f172a' }}>{it.productName}</td>
                    <td style={{ padding: '8px 12px', color: '#64748b' }}>{it.unitName}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 700 }}>{it.quantity}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 700 }}>
                      {Number(it.unitPrice).toFixed(2)} <CurrencySymbol />
                      {it.pricingTierType === 'credit' ? (
                        <span style={{ fontSize: '10px', color: '#b45309', marginRight: '4px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s68', "(سعر آجل)")}</span>
                      ) : it.pricingTierType === 'offer' ? (
                        <span style={{ fontSize: '10px', color: '#15803d', marginRight: '4px' }}>{t('delivery_reps.van_pre_sales_admin_tab.s69', "(سعر عرض)")}</span>
                      ) : null}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#2563eb', fontWeight: 600 }}>
                      {it.consumerPrice != null && Number(it.consumerPrice) > 0 ? (
                        <>
                          {Number(it.consumerPrice).toFixed(2)} <CurrencySymbol />
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#16a34a', fontWeight: 600 }}>
                      {it.unitOfferSavings != null && Number(it.unitOfferSavings) > 0 ? (
                        <>
                          {Number(it.unitOfferSavings).toFixed(2)} <CurrencySymbol />
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 800, color: '#170e5e' }}>
                      {Number(it.lineTotal).toFixed(2)} <CurrencySymbol />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#f8fafc', fontWeight: 800, borderTop: '2px solid #e2e8f0' }}>
                  <td colSpan={6} style={{ padding: '10px 12px', textAlign: 'left' }}>
                    {t('delivery_reps.van_pre_sales_admin_tab.s70', "إجمالي الطلبية المستحقة:")}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '14px', color: '#059669' }}>
                    {Number(inspectedOrder.totalAmount).toFixed(2)} <CurrencySymbol />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </StandardDialog>
  );
}
