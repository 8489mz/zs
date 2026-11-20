import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { toast } from '@/shared/components/system-alert';
import { vanSalesApi, type VanLoadRequisitionRecord, type DriverAvailableProduct, type DriverWarehouse } from '../api/van-sales.api';
import {
  TruckIcon,
  PlusIcon,
  Trash2Icon,
  PrinterIcon,
} from '@/shared/components/icons/AppIcons';
import { DriverNewLoadRequisitionView } from './DriverNewLoadRequisitionView';
import { RequisitionsKpiCards } from './van-load-requisitions/requisitions-kpi-cards';
import { RequisitionsFilterBar } from './van-load-requisitions/requisitions-filter-bar';
import { RequisitionsTable } from './van-load-requisitions/requisitions-table';
import { ReviewDispatchModal } from './van-load-requisitions/review-dispatch-modal';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { printRequisition } from './van-load-requisitions/print-requisition';
import { useAdminRequisitionReview } from './van-load-requisitions/use-admin-requisition-review';
import { useRequisitionMutations } from './van-load-requisitions/use-requisition-mutations';
import type { AdminReviewLine } from './van-load-requisitions/van-load-requisitions-admin-types';


export function VanLoadRequisitionsAdminTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<'list' | 'create'>('list');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedReq, setSelectedReq] = useState<VanLoadRequisitionRecord | null>(null);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [adminNotes, setAdminNotes] = useState<string>('');
  const [activePrintMenuId, setActivePrintMenuId] = useState<number | null>(null);

  const { data: settings } = useSettingsQuery();
  const defaultPaperSize = (settings?.paperSize === 'receipt' ? 'receipt' : 'a4') as 'a4' | 'receipt';

  const [selectedSourceWarehouseId, setSelectedSourceWarehouseId] = useState<number | null>(null);

  // Fetch all active warehouses for supervisor warehouse switching
  const { data: adminWarehouses = [] } = useQuery<DriverWarehouse[]>({
    queryKey: ['admin-warehouses'],
    queryFn: () => vanSalesApi.getAdminWarehouses(),
    staleTime: 60_000,
  });

  const activeWarehouseId = selectedSourceWarehouseId ?? (selectedReq?.sourceWarehouseId ? Number(selectedReq.sourceWarehouseId) : undefined);

  // 1. Fetch available products in the warehouse for adding items
  const { data: warehouseProducts = [] } = useQuery<DriverAvailableProduct[]>({
    queryKey: ['admin-warehouse-products', activeWarehouseId],
    queryFn: () => vanSalesApi.getAdminAvailableProducts(activeWarehouseId),
    enabled: Boolean(selectedReq && selectedReq.status === 'pending'),
    staleTime: 30_000,
  });

  const {
    reviewLines,
    openReviewModal,
    handleUpdateLineApprovedQty,
    handleUpdateLineCartonsPieces,
    handleRemoveReviewLine,
    handleAddProductToReview,
    formatReviewLinesForPayload,
  } = useAdminRequisitionReview(warehouseProducts, {
    setSelectedReq,
    setSelectedSourceWarehouseId,
    setAdminNotes,
    setIsAddProductOpen,
    setProductSearch,
  });

  // Rejection modal state
  const [rejectModalReq, setRejectModalReq] = useState<VanLoadRequisitionRecord | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: requisitions = [],
    isLoading,
    refetch,
  } = useQuery<VanLoadRequisitionRecord[]>({
    queryKey: ['van-admin-load-requisitions', statusFilter],
    queryFn: () => vanSalesApi.listAdminRequisitions({ status: statusFilter || undefined }),
    refetchInterval: 15000,
  });

  // Query all requisitions for stable KPI statistics across filters
  const { data: allRequisitions = [] } = useQuery<VanLoadRequisitionRecord[]>({
    queryKey: ['van-admin-load-requisitions-all-stats'],
    queryFn: () => vanSalesApi.listAdminRequisitions(),
    staleTime: 15_000,
  });

  const statsSource = allRequisitions.length > 0 ? allRequisitions : requisitions;
  const pendingReqs = statsSource.filter((r) => r.status === 'pending');
  const dispatchedReqs = statsSource.filter((r) => r.status === 'dispatched');
  const rejectedReqs = statsSource.filter((r) => r.status === 'rejected');

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['van-admin-load-requisitions'] }),
        queryClient.invalidateQueries({ queryKey: ['van-admin-load-requisitions-all-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['van-admin-pending-requisitions-badge'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-warehouse-products'] }),
        refetch(),
      ]);
      await new Promise((r) => setTimeout(r, 450));
      toast.success('تم تحديث أذونات التحميل بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء تحديث البيانات');
    } finally {
      setIsRefreshing(false);
    }
  };

  const {
    reviewMutation,
    dispatchMutation,
    rejectMutation,
    deleteMutation,
    handleDeleteRequisition,
    handleDispatch,
    handleSaveReviewedItems,
    openRejectDialog,
    confirmReject,
  } = useRequisitionMutations({
    selectedReq,
    reviewLines,
    formatReviewLinesForPayload,
    adminNotes,
    activeWarehouseId,
    adminWarehouses,
    rejectModalReq,
    rejectReasonInput,
    setSelectedReq,
    setRejectModalReq,
    setRejectReasonInput,
  });
  };


  if (viewMode === 'create') {
    return (
      <DriverNewLoadRequisitionView
        mode="admin"
        onBack={() => {
          setViewMode('list');
          refetch();
        }}
        onRequisitionSubmitted={() => {
          refetch();
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
      <RequisitionsKpiCards
        pendingCount={pendingReqs.length}
        dispatchedCount={dispatchedReqs.length}
        rejectedCount={rejectedReqs.length}
        totalCount={requisitions.length}
      />
      <RequisitionsFilterBar
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        isRefreshing={isRefreshing}
        onManualRefresh={handleManualRefresh}
        onCreateClick={() => setViewMode('create')}
        pendingCount={pendingReqs.length}
        totalCount={requisitions.length}
      />
      </div>

      <RequisitionsTable
        requisitions={requisitions}
        isLoading={isLoading}
        onOpenReview={openReviewModal}
        onDelete={handleDeleteRequisition}
        onDispatch={handleDispatch}
        onReject={openRejectDialog}
        onPrint={(req, format) => printRequisition(req, { defaultPaperSize, settings }, format)}
        activePrintMenuId={activePrintMenuId}
        onPrintMenuChange={setActivePrintMenuId}
        isDispatchPending={dispatchMutation.isPending}
        isDeletePending={deleteMutation.isPending}
        defaultPaperSize={defaultPaperSize}
      />

      <ReviewDispatchModal
        selectedReq={selectedReq}
        reviewLines={reviewLines}
        onUpdateLineQty={handleUpdateLineApprovedQty}
        onUpdateLineCartonsPieces={handleUpdateLineCartonsPieces}
        onRemoveLine={handleRemoveReviewLine}
        onAddProduct={handleAddProductToReview}
        onSaveReviewed={handleSaveReviewedItems}
        onDispatch={handleDispatch}
        onReject={openRejectDialog}
        onDelete={handleDeleteRequisition}
        onPrint={(req, format) => printRequisition(req, { defaultPaperSize, settings }, format)}
        warehouseProducts={warehouseProducts}
        productSearch={productSearch}
        onProductSearchChange={setProductSearch}
        isAddProductOpen={isAddProductOpen}
        onAddProductOpenChange={setIsAddProductOpen}
        adminNotes={adminNotes}
        onAdminNotesChange={setAdminNotes}
        adminWarehouses={adminWarehouses}
        activeWarehouseId={activeWarehouseId}
        onSourceWarehouseChange={setSelectedSourceWarehouseId}
        isReviewPending={reviewMutation.isPending}
        isDispatchPending={dispatchMutation.isPending}
        isDeletePending={deleteMutation.isPending}
        onClose={() => setSelectedReq(null)}
      />

      {/* Reject Reason Modal */}
      {rejectModalReq && (
        <StandardDialog
          open={Boolean(rejectModalReq)}
          onClose={() => setRejectModalReq(null)}
          title={`رفض إذن تحميل البضاعة #${rejectModalReq.docNo}`}
          subtitle={`المندوب: ${rejectModalReq.repName} • المستودع: ${rejectModalReq.sourceWarehouseName}`}
          maxWidth="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
            <div>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                {t('delivery_reps.van_load_requisitions_admin_tab.s122', "سبب رفض إذن التحميل")} <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <textarea
                rows={3}
                placeholder={t('delivery_reps.van_load_requisitions_admin_tab.s123', "وضح سبب رفض طلب التحميل ليظهر للمندوب في تطبيق الفان...")}
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="secondary" onClick={() => setRejectModalReq(null)}>
                {t('delivery_reps.van_load_requisitions_admin_tab.s124', "إلغاء")}
              </Button>
              <Button
                variant="danger"
                disabled={rejectMutation.isPending}
                onClick={confirmReject}
                style={{ backgroundColor: '#dc2626', color: '#ffffff' }}
              >
                {rejectMutation.isPending ? t('delivery_reps.van_load_requisitions_admin_tab.s125', "جاري الرفض...") : t('delivery_reps.van_load_requisitions_admin_tab.s126', "تأكيد رفض الإذن")}
              </Button>
            </div>
          </div>
        </StandardDialog>
      )}

    </div>
  );
}
