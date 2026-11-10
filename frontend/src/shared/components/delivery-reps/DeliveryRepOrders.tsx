import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deliveryRepsApi } from '@/shared/api/delivery-reps.api';
import { salesApi } from '@/features/sales/api/sales.api';
import { Button } from '@/shared/ui/button';
import { formatCurrency, formatDate, formatDateTimeArabic } from '@/lib/format';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Card } from '@/shared/ui/card';
import { ActionConfirmDialog } from '@/shared/components/action-confirm-dialog';
import { printPostedSaleReceipt } from '@/lib/pos-printing';

function getLocalDateStr(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/* INV-SF-SINGLE-SETTLE-COUNTED-CASH (D-SF-01): the cash the rep
 * should hand over — the order total for a store-fleet delivery,
 * the total minus the freelance courier fee otherwise. This is
 * only the dialog's default: the cashier counts the physical cash
 * and corrects it, and the backend books exactly what was typed. */
function cashDueOf(order: any): number {
  const total = Number(order?.total || 0);
  if (order?.deliveryFeeMode === 'store_fleet') return total;
  return Math.max(0, total - Number(order?.deliveryFee || 0));
}

export function DeliveryRepOrders({ repId }: { repId: number | null }) {
  const { t: __t } = useTranslation();
  const queryClient = useQueryClient();
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState('unsettled');
  const [expectedAmountInput, setExpectedAmountInput] = useState('');
  const [feedbackPopup, setFeedbackPopup] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [orderToSettle, setOrderToSettle] = useState<any | null>(null);
  const [countedCashInput, setCountedCashInput] = useState('');
  const [viewingSaleId, setViewingSaleId] = useState<number | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['delivery-rep-orders', repId, filterDateFrom, filterDateTo, filterStatus],
    queryFn: () => deliveryRepsApi.listOrders(repId!, {
      dateFrom: filterDateFrom,
      dateTo: filterDateTo,
      status: filterStatus
    }),
    enabled: !!repId,
  });

  const summaryQuery = useQuery({
    queryKey: ['delivery-rep-summary', repId],
    queryFn: () => deliveryRepsApi.getSummary(repId!),
    enabled: !!repId,
  });

  const viewingSaleQuery = useQuery({
    queryKey: ['sale-detail', viewingSaleId],
    queryFn: () => salesApi.getById(String(viewingSaleId)),
    enabled: !!viewingSaleId,
  });

  const settleOrderMutation = useMutation({
    mutationFn: ({ saleId, countedCashAmount }: { saleId: number; countedCashAmount?: number }) =>
      deliveryRepsApi.settleOrder(saleId, { countedCashAmount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-rep-orders'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-rep-summary'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-rep-settlements'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-rep-kpis'] });
    }
  });

  const settleAllMutation = useMutation({
    mutationFn: ({ id, amount }: { id: number, amount: number }) => deliveryRepsApi.settleAllOrders(id, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-rep-orders'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-rep-summary'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-rep-settlements'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-rep-kpis'] });
      setExpectedAmountInput('');
      setFeedbackPopup({ message: 'تمت التسوية بنجاح', type: 'success' });
    },
    onError: (error: any) => {
      setFeedbackPopup({ message: error.message || 'حدث خطأ أثناء التسوية', type: 'error' });
    }
  });

  if (!repId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b', padding: '40px' }}>
        {__t('shared.delivery_reps.delivery_rep_orders.s0', "اختر مندوب من القائمة لعرض طلباته وتسويتها")}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header and Bulk Settlement */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', fontSize: '14px', color: '#475569', background: '#ffffff', padding: '12px 18px', borderRadius: '10px', border: '1px solid #cbd5e1', boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{__t('shared.delivery_reps.delivery_rep_orders.s1', "إجمالي الطلبات")}</span>
            <strong style={{ fontWeight: 800, color: '#0f172a', fontSize: '16px' }}>{summaryQuery.data?.totalOrders || 0}</strong>
          </div>
          <div style={{ width: '1px', background: '#e2e8f0' }}></div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{__t('shared.delivery_reps.delivery_rep_orders.s2', "تم تحصيله")}</span>
            <strong style={{ fontWeight: 800, color: '#15803d', fontSize: '16px' }}>{formatCurrency(summaryQuery.data?.collectedAmount || 0)}</strong>
          </div>
          <div style={{ width: '1px', background: '#e2e8f0' }}></div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{__t('shared.delivery_reps.delivery_rep_orders.s3', "متبقي للتحصيل (العهدة)")}</span>
            <strong style={{ fontWeight: 800, color: '#dc2626', fontSize: '17px' }}>{formatCurrency(summaryQuery.data?.pendingAmount || 0)}</strong>
          </div>
        </div>

        <div style={{ background: '#fef2f2', padding: '12px 16px', borderRadius: '10px', border: '1px solid #fecaca', display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 300px' }}>
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#991b1b' }}>{__t('shared.delivery_reps.delivery_rep_orders.s4', "تسوية سريعة لكل الطلبات المعلقة")}</h4>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input 
              type="number" 
              placeholder={__t('shared.delivery_reps.delivery_rep_orders.s5', "المبلغ المستلم من المندوب")}
              value={expectedAmountInput}
              onChange={(e) => setExpectedAmountInput(e.target.value)}
              style={{ padding: '6px 12px', border: '1px solid #fca5a5', borderRadius: '8px', flex: '1 1 160px', minHeight: '36px', background: '#ffffff', fontSize: '13px' }}
            />
            <Button 
              variant="primary"
              onClick={() => settleAllMutation.mutate({ id: repId, amount: Number(expectedAmountInput) })}
              disabled={!expectedAmountInput || settleAllMutation.isPending || !summaryQuery.data?.pendingAmount}
              style={{ minHeight: '36px', padding: '0 16px', fontSize: '13px', fontWeight: 700, flexShrink: 0 }}
            >
              {settleAllMutation.isPending ? __t('shared.delivery_reps.delivery_rep_orders.s6', "جاري التسوية...") : __t('shared.delivery_reps.delivery_rep_orders.s7', "تسوية الكل")}
            </Button>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div 
        style={{ 
          display: 'flex', 
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center', 
          gap: '8px', 
          background: '#f8fafc', 
          padding: '8px 12px', 
          borderRadius: '8px', 
          border: '1px solid #e2e8f0',
          width: '100%',
        }}
      >
        <span style={{ fontWeight: 700, color: '#475569', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {__t('shared.delivery_reps.delivery_rep_orders.s8', "فلترة الطلبات:")}
        </span>
        
        <input 
          type="date" 
          value={filterDateFrom} 
          onChange={(e) => setFilterDateFrom(e.target.value)} 
          style={{ width: '135px', minWidth: '125px', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '7px', fontSize: '12px', background: '#ffffff', minHeight: '34px', flexShrink: 0 }} 
        />

        <span style={{ color: '#64748b', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}>{__t('shared.delivery_reps.delivery_rep_orders.s9', "إلى")}</span>

        <input 
          type="date" 
          value={filterDateTo} 
          onChange={(e) => setFilterDateTo(e.target.value)} 
          style={{ width: '135px', minWidth: '125px', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '7px', fontSize: '12px', background: '#ffffff', minHeight: '34px', flexShrink: 0 }} 
        />
        
        <select 
          value={filterStatus} 
          onChange={(e) => setFilterStatus(e.target.value)} 
          style={{ width: '130px', minWidth: '110px', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: '7px', fontSize: '12px', background: '#ffffff', minHeight: '34px', cursor: 'pointer', flexShrink: 0 }}
        >
          <option value="">{__t('shared.delivery_reps.delivery_rep_orders.s10', "كل الحالات")}</option>
          <option value="settled">{__t('shared.delivery_reps.delivery_rep_orders.s11', "تمت التسوية")}</option>
          <option value="unsettled">{__t('shared.delivery_reps.delivery_rep_orders.s12', "معلق (لم يسدد)")}</option>
        </select>

        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap', flexShrink: 0 }}>
          <Button 
            variant="secondary" 
            onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterStatus('unsettled'); }}
            style={{ 
              background: (!filterDateFrom && !filterDateTo && filterStatus === 'unsettled') ? '#1d4ed8' : '#eff6ff', 
              color: (!filterDateFrom && !filterDateTo && filterStatus === 'unsettled') ? '#ffffff' : '#1d4ed8', 
              borderColor: '#bfdbfe', 
              fontSize: '11px', 
              minHeight: '32px', 
              padding: '0 10px', 
              whiteSpace: 'nowrap',
              fontWeight: 700
            }}
          >
            {__t('shared.delivery_reps.delivery_rep_orders.s13', "الطلبات المعلقة")}
          </Button>
          <Button 
            variant="secondary" 
            onClick={() => { const t = getLocalDateStr(); setFilterDateFrom(t); setFilterDateTo(t); setFilterStatus(''); }}
            style={{ 
              background: (filterDateFrom === getLocalDateStr() && filterDateTo === getLocalDateStr() && !filterStatus) ? '#0f172a' : '#f1f5f9', 
              color: (filterDateFrom === getLocalDateStr() && filterDateTo === getLocalDateStr() && !filterStatus) ? '#ffffff' : '#334155', 
              borderColor: '#cbd5e1', 
              fontSize: '11px', 
              minHeight: '32px', 
              padding: '0 10px', 
              whiteSpace: 'nowrap' 
            }}
          >
            {__t('shared.delivery_reps.delivery_rep_orders.s14', "طلبات اليوم")}
          </Button>
          {(filterDateFrom || filterDateTo || filterStatus) && (
            <Button 
              variant="secondary" 
              onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterStatus(''); }} 
              style={{ fontSize: '11px', minHeight: '32px', padding: '0 10px', whiteSpace: 'nowrap' }}
            >
              {__t('shared.delivery_reps.delivery_rep_orders.s15', "عرض الكل (مسح الفلاتر)")}
            </Button>
          )}
        </div>
      </div>

      {/* Orders Table */}
      <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className="table" style={{ width: '100%', minWidth: '700px', margin: 0, fontSize: '13px' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>{__t('shared.delivery_reps.delivery_rep_orders.s16', "رقم الطلب")}</th>
              <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>{__t('shared.delivery_reps.delivery_rep_orders.s17', "التاريخ")}</th>
              <th style={{ padding: '8px 4px' }}>{__t('shared.delivery_reps.delivery_rep_orders.s18', "العميل")}</th>
              <th style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>{__t('shared.delivery_reps.delivery_rep_orders.s19', "الكاشير")}</th>
              <th style={{ padding: '8px 4px' }}>{__t('shared.delivery_reps.delivery_rep_orders.s20', "حالة التحصيل")}</th>
              <th style={{ padding: '8px 4px' }}>{__t('shared.delivery_reps.delivery_rep_orders.s21', "الإجمالي")}</th>
              <th style={{ padding: '8px 4px' }}>{__t('shared.delivery_reps.delivery_rep_orders.s22', "مستلم المبلغ")}</th>
              <th style={{ padding: '8px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>{__t('shared.delivery_reps.delivery_rep_orders.s23', "إجراء التسوية")}</th>
            </tr>
          </thead>
          <tbody>
            {ordersQuery.isLoading && <tr><td colSpan={8} style={{ padding: '8px', textAlign: 'center', color: '#64748b' }}>{__t('shared.delivery_reps.delivery_rep_orders.s24', "جاري التحميل...")}</td></tr>}
            {ordersQuery.data?.length === 0 && <tr><td colSpan={8} style={{ padding: '8px', textAlign: 'center', color: '#64748b' }}>{__t('shared.delivery_reps.delivery_rep_orders.s25', "لا يوجد طلبات مطابقة")}</td></tr>}
            {ordersQuery.data?.map(order => {
              const isSettled = order.deliveryStatus === 'settled';
              return (
                <tr key={order.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      onClick={() => setViewingSaleId(order.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: '#2563eb',
                        fontWeight: 800,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        fontSize: '13px'
                      }}
                      title={__t('shared.delivery_reps.delivery_rep_orders.s26', "انقر لعرض تفاصيل وأصناف الفاتورة")}
                    >
                      {order.docNo}
                    </button>
                  </td>
                  <td style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>{formatDateTimeArabic(order.createdAt)}</td>
                  <td style={{ padding: '8px 4px' }}>{order.customerName || __t('shared.delivery_reps.delivery_rep_orders.s27', "عميل نقدي")}</td>
                  <td style={{ padding: '8px 4px', color: '#334155', fontWeight: 600, fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {order.createdByName || __t('shared.delivery_reps.delivery_rep_orders.s28', "غير معروف")}
                  </td>
                  <td style={{ padding: '8px 4px' }}>
                    {order.collectionStatus === 'cod' ? __t('shared.delivery_reps.delivery_rep_orders.s29', "تحصيل من العميل") : 
                     order.collectionStatus === 'prepaid_by_rep' ? __t('shared.delivery_reps.delivery_rep_orders.s30', "خالص من المندوب") : 
                     order.collectionStatus === 'prepaid_online' ? __t('shared.delivery_reps.delivery_rep_orders.s31', "خالص أونلاين") : '-'}
                  </td>
                  <td style={{ padding: '8px 4px', whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#0f172a' }}>{formatCurrency(order.total)}</div>
                    {Number(order.deliveryFee || 0) > 0 ? (
                      <div style={{ fontSize: '11px', color: '#059669', fontWeight: 600 }}>
                        {__t('shared.delivery_reps.delivery_rep_orders.s32', "أجرة:")} {formatCurrency(Number(order.deliveryFee))}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: '8px 4px', color: '#64748b', fontSize: '12px' }}>
                    {order.collectionStatus === 'prepaid_online' || order.collectionStatus === 'prepaid_by_rep'
                      ? (order.createdByName || __t('shared.delivery_reps.delivery_rep_orders.s33', "كاشير البيع"))
                      : (isSettled ? (order.settledByName || __t('shared.delivery_reps.delivery_rep_orders.s34', "غير معروف")) : '-')}
                  </td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {isSettled ? (
                      <span style={{ color: '#16a34a', fontSize: '13px', fontWeight: 'bold', background: '#dcfce7', padding: '4px 8px', borderRadius: '4px' }}>
                        {__t('shared.delivery_reps.delivery_rep_orders.s35', "تم السداد")}
                      </span>
                    ) : order.collectionStatus !== 'cod' ? (
                      <span style={{ color: '#64748b', fontSize: '13px' }}>
                        {__t('shared.delivery_reps.delivery_rep_orders.s36', "مدفوع مسبقاً")}
                      </span>
                    ) : (
                      <Button 
                        variant="secondary" 
                        onClick={() => {
                          setOrderToSettle(order);
                          setCountedCashInput(String(cashDueOf(order)));
                        }}
                        disabled={settleOrderMutation.isPending}
                        style={{ fontSize: '12px', padding: '4px 12px' }}
                      >
                        {settleOrderMutation.isPending ? '...' : __t('shared.delivery_reps.delivery_rep_orders.s37', "تأكيد السداد")}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sale Quick View Modal */}
      {viewingSaleId && (
        <DialogShell
          open={true}
          onClose={() => setViewingSaleId(null)}
          width="700px"
          ariaLabel={__t('shared.delivery_reps.delivery_rep_orders.s38', "تفاصيل الفاتورة")}
        >
          <Card
            title={viewingSaleQuery.data ? `تفاصيل الفاتورة #${viewingSaleQuery.data.docNo || viewingSaleQuery.data.id}` : __t('shared.delivery_reps.delivery_rep_orders.s39', "جاري التحميل...")}
            actions={
              <div style={{ display: 'flex', gap: '8px' }}>
                {viewingSaleQuery.data && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      void printPostedSaleReceipt(viewingSaleQuery.data);
                    }}
                    style={{ fontSize: '12px', padding: '4px 12px' }}
                  >
                    {__t('shared.delivery_reps.delivery_rep_orders.s40', "طباعة الفاتورة")}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setViewingSaleId(null)} style={{ fontSize: '12px', padding: '4px 12px' }}>
                  {__t('shared.delivery_reps.delivery_rep_orders.s41', "إغلاق")}
                </Button>
              </div>
            }
          >
            {viewingSaleQuery.isLoading ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{__t('shared.delivery_reps.delivery_rep_orders.s42', "جاري تحميل تفاصيل الفاتورة...")}</div>
            ) : viewingSaleQuery.data ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
                {/* Meta Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '11px', display: 'block' }}>{__t('shared.delivery_reps.delivery_rep_orders.s43', "العميل")}</span>
                    <strong>{viewingSaleQuery.data.customerName || __t('shared.delivery_reps.delivery_rep_orders.s44', "عميل نقدي")}</strong>
                    {viewingSaleQuery.data.customerPhone && (
                      <div style={{ fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                        </svg>
                        <span>{viewingSaleQuery.data.customerPhone}</span>
                      </div>
                    )}
                    {viewingSaleQuery.data.customerAddress && (
                      <div style={{ fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                          <circle cx="12" cy="10" r="3"/>
                        </svg>
                        <span>{viewingSaleQuery.data.customerAddress}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '11px', display: 'block' }}>{__t('shared.delivery_reps.delivery_rep_orders.s45', "الكاشير")}</span>
                    <strong>{viewingSaleQuery.data.cashierName || viewingSaleQuery.data.createdByName || '-'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '11px', display: 'block' }}>{__t('shared.delivery_reps.delivery_rep_orders.s46', "المندوب")}</span>
                    <strong>{viewingSaleQuery.data.deliveryRepName || '-'}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', fontSize: '11px', display: 'block' }}>{__t('shared.delivery_reps.delivery_rep_orders.s47', "التاريخ والوقت")}</span>
                    <strong style={{ direction: 'ltr', display: 'inline-block' }}>{formatDate(viewingSaleQuery.data.createdAt || viewingSaleQuery.data.date)}</strong>
                  </div>
                </div>

                {/* Items Table */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                  <table className="table" style={{ width: '100%', margin: 0, fontSize: '12px' }}>
                    <thead style={{ background: '#f1f5f9' }}>
                      <tr>
                        <th style={{ padding: '6px 8px' }}>{__t('shared.delivery_reps.delivery_rep_orders.s48', "الصنف")}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>{__t('shared.delivery_reps.delivery_rep_orders.s49', "الكمية")}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>{__t('shared.delivery_reps.delivery_rep_orders.s50', "السعر")}</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>{__t('shared.delivery_reps.delivery_rep_orders.s51', "الإجمالي")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewingSaleQuery.data.items?.map((item: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 600 }}>{item.name || item.productName}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>{item.qty} {item.unit || ''}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>{formatCurrency(Number(item.price || 0))}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 'bold' }}>{formatCurrency(Number(item.total || (item.qty * item.price) || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals Summary */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px', background: '#f8fafc', padding: '10px 14px', borderRadius: '6px', border: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                  {Number(viewingSaleQuery.data.deliveryFee || 0) > 0 && (
                    <div style={{ color: '#059669', fontWeight: 600 }}>
                      <span>{__t('shared.delivery_reps.delivery_rep_orders.s52', "أجرة التوصيل:")} </span>
                      <strong>{formatCurrency(Number(viewingSaleQuery.data.deliveryFee))}</strong>
                    </div>
                  )}
                  {Number(viewingSaleQuery.data.discount || 0) > 0 && (
                    <div style={{ color: '#dc2626', fontWeight: 600 }}>
                      <span>{__t('shared.delivery_reps.delivery_rep_orders.s53', "الخصم:")} </span>
                      <strong>{formatCurrency(Number(viewingSaleQuery.data.discount))}</strong>
                    </div>
                  )}
                  <div>
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>{__t('shared.delivery_reps.delivery_rep_orders.s54', "الإجمالي النهائي:")} </span>
                    <strong style={{ fontSize: '15px', color: '#170c5c', fontWeight: 900 }}>{formatCurrency(Number(viewingSaleQuery.data.total || 0))}</strong>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#dc2626' }}>{__t('shared.delivery_reps.delivery_rep_orders.s55', "تعذر تحميل بيانات الفاتورة")}</div>
            )}
          </Card>
        </DialogShell>
      )}

      {feedbackPopup && (
        <DialogShell 
          open={true}
          onClose={() => setFeedbackPopup(null)} 
          width="400px"
        >
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '16px', color: feedbackPopup.type === 'error' ? '#dc2626' : '#16a34a', fontWeight: 'bold' }}>
            {feedbackPopup.message}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: '24px' }}>
            <Button variant="primary" onClick={() => setFeedbackPopup(null)}>{__t('shared.delivery_reps.delivery_rep_orders.s56', "موافق")}</Button>
          </div>
        </DialogShell>
      )}

      <ActionConfirmDialog
        open={Boolean(orderToSettle)}
        title={__t('shared.delivery_reps.delivery_rep_orders.s57', "تأكيد التحصيل")}
        description={orderToSettle ? (
          <div>
            <p>{__t('shared.delivery_reps.delivery_rep_orders.s58', "هل أنت متأكد من تحصيل هذا المبلغ وإغلاق العهدة الخاصة بهذا الطلب؟")}</p>
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginTop: '16px', border: '1px solid #e2e8f0', fontSize: '0.95rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>{__t('shared.delivery_reps.delivery_rep_orders.s59', "رقم الطلب:")}</span>
                <strong style={{ color: '#0f172a' }}>{orderToSettle.docNo}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>{__t('shared.delivery_reps.delivery_rep_orders.s60', "تاريخ الطلب:")}</span>
                <strong style={{ color: '#0f172a', direction: 'ltr' }}>{formatDate(orderToSettle.createdAt)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#64748b' }}>{__t('shared.delivery_reps.delivery_rep_orders.s61', "اسم العميل:")}</span>
                <strong style={{ color: '#0f172a' }}>{orderToSettle.customerName || __t('shared.delivery_reps.delivery_rep_orders.s62', "عميل نقدي")}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed #cbd5e1' }}>
                <span style={{ color: '#64748b', alignSelf: 'center' }}>{__t('shared.delivery_reps.delivery_rep_orders.s63', "المبلغ المطلوب تحصيله:")}</span>
                <strong style={{ color: '#dc2626', fontSize: '1.2rem' }}>{formatCurrency(cashDueOf(orderToSettle))}</strong>
              </div>
              {Number(orderToSettle.deliveryFee || 0) > 0 && orderToSettle.deliveryFeeMode !== 'store_fleet' ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '12px', color: '#64748b' }}>
                  <span>{__t('shared.delivery_reps.delivery_rep_orders.s65', "إجمالي الطلب (منها أجرة المندوب):")}</span>
                  <span>{formatCurrency(Number(orderToSettle.total))} ({formatCurrency(Number(orderToSettle.deliveryFee))})</span>
                </div>
              ) : null}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed #cbd5e1' }}>
                <span style={{ color: '#64748b', alignSelf: 'center' }}>{__t('shared.delivery_reps.delivery_rep_orders.s66', "المبلغ المستلم فعلاً من المندوب:")}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={countedCashInput}
                  onChange={(e) => setCountedCashInput(e.target.value)}
                  style={{ width: '160px', padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', fontWeight: 700, textAlign: 'left', background: '#ffffff' }}
                />
              </div>
              {(() => {
                const due = cashDueOf(orderToSettle);
                const counted = Number(countedCashInput);
                if (countedCashInput === '' || !Number.isFinite(counted) || counted < 0) {
                  return (
                    <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '8px', fontWeight: 600 }}>
                      {__t('shared.delivery_reps.delivery_rep_orders.s67', "أدخل المبلغ المستلم فعلاً — رقم لا يقل عن صفر.")}
                    </div>
                  );
                }
                const diff = Math.round((counted - due) * 100) / 100;
                if (diff < 0) {
                  return (
                    <div style={{ color: '#b45309', fontSize: '12px', marginTop: '8px', fontWeight: 600 }}>
                      {__t('shared.delivery_reps.delivery_rep_orders.s68', "عجز:")} {formatCurrency(Math.abs(diff))} — {__t('shared.delivery_reps.delivery_rep_orders.s69', "يُقيد على حساب فروق التسوية (7200).")}
                    </div>
                  );
                }
                if (diff > 0) {
                  return (
                    <div style={{ color: '#15803d', fontSize: '12px', marginTop: '8px', fontWeight: 600 }}>
                      {__t('shared.delivery_reps.delivery_rep_orders.s70', "زيادة:")} {formatCurrency(diff)} — {__t('shared.delivery_reps.delivery_rep_orders.s71', "تُقيد على حساب فروق التسوية (7100).")}
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </div>
        ) : ''}
        confirmLabel={__t('shared.delivery_reps.delivery_rep_orders.s64', "تأكيد السداد")}
        isBusy={settleOrderMutation.isPending}
        onCancel={() => { setOrderToSettle(null); setCountedCashInput(''); }}
        onConfirm={async () => {
          if (!orderToSettle) return;
          const counted = Number(countedCashInput);
          if (countedCashInput === '' || !Number.isFinite(counted) || counted < 0) return;
          await settleOrderMutation.mutateAsync({ saleId: orderToSettle.id, countedCashAmount: counted });
          setOrderToSettle(null);
          setCountedCashInput('');
        }}
      />
    </div>
  );
}
