import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import {
  vanSalesApi,
  PreSalesOrderRecord,
} from '../api/van-sales.api';
import { PreSalesKpiCards } from './van-presales/pre-sales-kpi-cards';
import { PreSalesFilterBar } from './van-presales/pre-sales-filter-bar';
import { PreSalesOrdersTable } from './van-presales/pre-sales-orders-table';
import { PreSalesOrderDetails } from './van-presales/pre-sales-order-details';
import { PreSalesConsolidateDialog } from './van-presales/pre-sales-consolidate-dialog';
import { PreSalesRejectDialog } from './van-presales/pre-sales-reject-dialog';

interface VanPreSalesAdminTabProps {
  reps: Array<{ id: number; name: string }>;
}

export const VanPreSalesAdminTab: React.FC<VanPreSalesAdminTabProps> = ({ reps }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [selectedRepId, setSelectedRepId] = useState<number | ''>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Selected Order for Details Modal
  const [inspectingOrderId, setInspectingOrderId] = useState<number | null>(null);

  // Rejection Dialog State
  const [rejectingOrderId, setRejectingOrderId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Multi-select approved orders for consolidation into a Van Load Requisition
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
  const [showConsolidateDialog, setShowConsolidateDialog] = useState(false);
  const [consolidateTargetRepId, setConsolidateTargetRepId] = useState<number | ''>('');
  const [consolidateNotes, setConsolidateNotes] = useState('');

  const {
    data: orders = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: [
      'van-admin-presales-orders',
      selectedRepId,
      selectedStatus,
      dateFrom,
      dateTo,
      searchQuery,
    ],
    queryFn: () =>
      vanSalesApi.listAdminPreSalesOrders({
        repId: selectedRepId ? Number(selectedRepId) : undefined,
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: searchQuery.trim() || undefined,
      }),
  });

  const { data: inspectedOrder, isLoading: isInspectingLoading } = useQuery({
    queryKey: ['van-admin-presales-order-details', inspectingOrderId],
    queryFn: () => (inspectingOrderId ? vanSalesApi.getAdminPreSalesOrderDetails(inspectingOrderId) : null),
    enabled: inspectingOrderId != null,
  });

  // Approve Order Mutation
  const approveMutation = useMutation({
    mutationFn: (orderId: number) => vanSalesApi.approveAdminPreSalesOrder(orderId),
    onSuccess: () => {
      toast.success('تم اعتماد طلبية المندوب وتثبيت الحجز بنجاح!');
      queryClient.invalidateQueries({ queryKey: ['van-admin-presales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['van-admin-presales-order-details'] });
      setInspectingOrderId(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر اعتماد طلبية المندوب');
    },
  });

  // Reject Order Mutation
  const rejectMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: number; reason: string }) =>
      vanSalesApi.rejectAdminPreSalesOrder(orderId, reason),
    onSuccess: () => {
      toast.success('تم رفض الطلبية وتحرير كميات المخزون المحجوزة بالمخزن الرئيسي بنجاح');
      queryClient.invalidateQueries({ queryKey: ['van-admin-presales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['van-admin-presales-order-details'] });
      setRejectingOrderId(null);
      setRejectionReason('');
      setInspectingOrderId(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر رفض الطلبية');
    },
  });

  // Consolidate Pre-Sales Orders to Van Load Requisition Mutation
  const consolidateMutation = useMutation({
    mutationFn: (payload: { orderIds: number[]; deliveryRepId: number; notes?: string }) =>
      vanSalesApi.consolidateAdminPreSalesOrdersToRequisition(payload),
    onSuccess: (res) => {
      toast.success(
        `تم تجميع ${res.consolidatedOrdersCount} طلبيات وتوليد إذن تحميل للسيارة رقم #${res.requisitionDocNo} (${res.totalDistinctItems} أصناف) بنجاح!`,
      );
      setSelectedOrderIds([]);
      setShowConsolidateDialog(false);
      setConsolidateNotes('');
      queryClient.invalidateQueries({ queryKey: ['van-admin-presales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['van-admin-requisitions'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر تجميع الطلبيات إلى إذن تحميل');
    },
  });

  // Direct Conversion of Approved Order to Wholesale Invoice Mutation
  const convertInvoiceMutation = useMutation({
    mutationFn: (orderId: number) => vanSalesApi.convertAdminPreSalesOrderToInvoice(orderId),
    onSuccess: (res) => {
      toast.success(`تم تحويل الطلبية #${res.orderNumber} إلى فاتورة بيع جملة رسمية رقم #${res.invoiceDocNo} بنجاح!`);
      queryClient.invalidateQueries({ queryKey: ['van-admin-presales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['van-admin-presales-order-details'] });
      setInspectingOrderId(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'تعذر تحويل الطلبية إلى فاتورة جملة');
    },
  });

  const handleApprove = async (order: PreSalesOrderRecord) => {
    const confirmed = await systemConfirm({
      title: 'اعتماد طلبية المندوب',
      message: `هل تود بالتأكيد اعتماد الطلبية رقم #${order.orderNumber} للعميل "${order.customerName || 'عميل'}" بقيمة إجمالية ${Number(order.totalAmount).toFixed(2)}؟`,
      confirmText: 'نعم، اعتمد الطلبية',
      cancelText: 'تراجع',
    });
    if (confirmed) {
      approveMutation.mutate(order.id);
    }
  };

  const handleConvertInvoice = async (order: PreSalesOrderRecord) => {
    const confirmed = await systemConfirm({
      title: 'تحويل الطلبية إلى فاتورة بيع جملة',
      message: `سيتم إصدار فاتورة بيع جملة رسمية للعميل "${order.customerName || 'عميل'}" من الطلبية المعتمدة #${order.orderNumber} بقيمة ${Number(order.totalAmount).toFixed(2)} (${order.paymentTerms === 'cash' ? 'نقدي' : 'آجل'}) وصرف الأصناف المحجوزة من المخزن مباشرة. هل تود المتابعة؟`,
      confirmText: 'نعم، أصدر فاتورة الجملة',
      cancelText: 'تراجع',
    });
    if (confirmed) {
      convertInvoiceMutation.mutate(order.id);
    }
  };

  const approvedOrders = orders.filter((o) => o.status === 'approved');

  const toggleSelectOrder = (orderId: number) => {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId],
    );
  };

  const toggleSelectAllApproved = () => {
    const allIds = approvedOrders.map((o) => o.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedOrderIds.includes(id));
    if (allSelected) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(allIds);
    }
  };

  const openConsolidateModal = () => {
    const idsToUse = selectedOrderIds.length > 0 ? selectedOrderIds : approvedOrders.map((o) => o.id);
    if (idsToUse.length === 0) {
      toast.warning('لا توجد طلبيات معتمدة جاهزة للتجميع حالياً');
      return;
    }
    if (selectedOrderIds.length === 0) {
      setSelectedOrderIds(idsToUse);
    }
    const firstOrder = orders.find((o) => idsToUse.includes(o.id));
    if (firstOrder?.repId && !consolidateTargetRepId) {
      setConsolidateTargetRepId(firstOrder.repId);
    }
    setShowConsolidateDialog(true);
  };

  const handleConfirmConsolidate = () => {
    if (!consolidateTargetRepId) {
      toast.warning('يرجى اختيار مندوب التوزيع / السيارة المستهدفة لإذن التحميل');
      return;
    }
    if (selectedOrderIds.length === 0) {
      toast.warning('يرجى تحديد طلبية معتمدة واحدة على الأقل');
      return;
    }
    consolidateMutation.mutate({
      orderIds: selectedOrderIds,
      deliveryRepId: Number(consolidateTargetRepId),
      notes: consolidateNotes.trim() || undefined,
    });
  };

  const openRejectDialog = (orderId: number) => {
    setRejectingOrderId(orderId);
    setRejectionReason('');
  };

  const handleConfirmReject = () => {
    if (!rejectingOrderId) return;
    if (!rejectionReason.trim()) {
      toast.warning('يرجى كتابة سبب رفض الطلبية للمندوب');
      return;
    }
    rejectMutation.mutate({ orderId: rejectingOrderId, reason: rejectionReason.trim() });
  };

  // Metrics
  const pendingCount = orders.filter((o) => o.status === 'pending_supervisor' || o.status === 'pending_approval').length;
  const approvedCount = approvedOrders.length;
  const convertedCount = orders.filter((o) => o.status === 'converted').length;
  const rejectedCount = orders.filter((o) => o.status === 'rejected').length;
  const totalAmount = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending_supervisor':
      case 'pending_approval':
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#fef3c7',
              color: '#b45309',
              border: '1px solid #fde68a',
            }}
          >
            {t('delivery_reps.van_pre_sales_admin_tab.s0', "بانتظار الاعتماد")}
          </span>
        );
      case 'approved':
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#dcfce7',
              color: '#15803d',
              border: '1px solid #bbf7d0',
            }}
          >
            {t('delivery_reps.van_pre_sales_admin_tab.s1', "معتمدة وجاهزة")}
          </span>
        );
      case 'converted':
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#e0e7ff',
              color: '#170e5e',
              border: '1px solid #c7d2fe',
            }}
          >
            {t('delivery_reps.van_pre_sales_admin_tab.s2', "تم التحويل والتنفيذ")}
          </span>
        );
      case 'rejected':
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#fee2e2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
            }}
          >
            {t('delivery_reps.van_pre_sales_admin_tab.s3', "مرفوضة")}
          </span>
        );
      default:
        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#f1f5f9',
              color: '#475569',
            }}
          >
            {status}
          </span>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* TOP KPI CARDS */}
      <PreSalesKpiCards
        pendingCount={pendingCount}
        approvedCount={approvedCount}
        rejectedCount={rejectedCount}
        totalAmount={totalAmount}
      />

      {/* FILTER BAR */}
      <PreSalesFilterBar
        approvedCount={approvedCount}
        convertedCount={convertedCount}
        dateFrom={dateFrom}
        dateTo={dateTo}
        isFetching={isFetching}
        openConsolidateModal={openConsolidateModal}
        refetch={refetch}
        reps={reps}
        searchQuery={searchQuery}
        selectedOrderIds={selectedOrderIds}
        selectedRepId={selectedRepId}
        selectedStatus={selectedStatus}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
        setSearchQuery={setSearchQuery}
        setSelectedRepId={setSelectedRepId}
        setSelectedStatus={setSelectedStatus}
      />

      {/* ORDERS TABLE CARD */}
      <PreSalesOrdersTable
        approveMutation={approveMutation}
        approvedOrders={approvedOrders}
        convertInvoiceMutation={convertInvoiceMutation}
        getStatusBadge={getStatusBadge}
        handleApprove={handleApprove}
        handleConvertInvoice={handleConvertInvoice}
        isLoading={isLoading}
        openRejectDialog={openRejectDialog}
        orders={orders}
        rejectMutation={rejectMutation}
        selectedOrderIds={selectedOrderIds}
        setInspectingOrderId={setInspectingOrderId}
        toggleSelectAllApproved={toggleSelectAllApproved}
        toggleSelectOrder={toggleSelectOrder}
      />

      {/* ORDER DETAILS MODAL */}
      {inspectingOrderId != null && (
        <PreSalesOrderDetails
          convertInvoiceMutation={convertInvoiceMutation}
          getStatusBadge={getStatusBadge}
          handleApprove={handleApprove}
          handleConvertInvoice={handleConvertInvoice}
          inspectedOrder={inspectedOrder}
          inspectingOrderId={inspectingOrderId}
          isInspectingLoading={isInspectingLoading}
          openRejectDialog={openRejectDialog}
          setConsolidateTargetRepId={setConsolidateTargetRepId}
          setInspectingOrderId={setInspectingOrderId}
          setSelectedOrderIds={setSelectedOrderIds}
          setShowConsolidateDialog={setShowConsolidateDialog}
        />
      )}

      {/* CONSOLIDATE PRE-SALES ORDERS TO VAN LOAD REQUISITION MODAL */}
      {showConsolidateDialog && (
        <PreSalesConsolidateDialog
          consolidateMutation={consolidateMutation}
          consolidateNotes={consolidateNotes}
          consolidateTargetRepId={consolidateTargetRepId}
          handleConfirmConsolidate={handleConfirmConsolidate}
          orders={orders}
          reps={reps}
          selectedOrderIds={selectedOrderIds}
          setConsolidateNotes={setConsolidateNotes}
          setConsolidateTargetRepId={setConsolidateTargetRepId}
          setShowConsolidateDialog={setShowConsolidateDialog}
        />
      )}

      {/* REJECTION REASON MODAL */}
      {rejectingOrderId != null && (
        <PreSalesRejectDialog
          handleConfirmReject={handleConfirmReject}
          rejectMutation={rejectMutation}
          rejectionReason={rejectionReason}
          setRejectingOrderId={setRejectingOrderId}
          setRejectionReason={setRejectionReason}
        />
      )}
    </div>
  );
};
