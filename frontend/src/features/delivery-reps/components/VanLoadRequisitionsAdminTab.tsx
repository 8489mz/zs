import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { toast } from '@/shared/components/system-alert';
import { vanSalesApi, type VanLoadRequisitionRecord, type DriverAvailableProduct, type DriverWarehouse } from '../api/van-sales.api';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  FileTextIcon,
  TruckIcon,
  PlusIcon,
  MinusIcon,
  Trash2Icon,
  XIcon,
  XCircleIcon,
  PrinterIcon,
  ChevronDownIcon,
} from '@/shared/components/icons/AppIcons';
import { DriverNewLoadRequisitionView } from './DriverNewLoadRequisitionView';
import { RequisitionsKpiCards } from './van-load-requisitions/requisitions-kpi-cards';
import { RequisitionsFilterBar } from './van-load-requisitions/requisitions-filter-bar';
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
      <style>{`
        input.no-spin-arrows::-webkit-outer-spin-button,
        input.no-spin-arrows::-webkit-inner-spin-button {
          -webkit-appearance: none !important;
          margin: 0 !important;
        }
        input.no-spin-arrows {
          -moz-appearance: textfield !important;
          appearance: textfield !important;
        }
      `}</style>
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

      {/* Requisitions Table (Zero Horizontal Scroll Standard) */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          overflowX: 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {isLoading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
            {t('delivery_reps.van_load_requisitions_admin_tab.s17', "جاري تحميل أذونات التحميل...")}
          </div>
        ) : requisitions.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>
            {t('delivery_reps.van_load_requisitions_admin_tab.s18', "لا توجد أذونات تحميل مطابقة للفلتر المحدد.")}
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              minWidth: '1080px',
              borderCollapse: 'collapse',
              textAlign: 'right',
              fontSize: '12px',
              tableLayout: 'fixed',
            }}
          >
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '10px 8px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s19', "رقم الإذن")}</th>
                <th style={{ padding: '10px 8px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s20', "مندوب التوزيع")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s21', "المركبة")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s22', "المستودع")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, textAlign: 'center', fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s23', "الأصناف")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, textAlign: 'center', fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s24', "القطع")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s25', "تاريخ الطلب")}</th>
                <th style={{ padding: '10px 6px', fontWeight: 700, textAlign: 'center', fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s26', "حالة الإذن والقرار")}</th>
                <th style={{ padding: '10px 8px', fontWeight: 700, textAlign: 'center', fontSize: '11.5px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s27', "المعاينة والطباعة")}</th>
              </tr>
            </thead>
            <tbody>
              {requisitions.map((r) => {
                const totalReqPieces = (r.requestedItems || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
                const isPending = r.status === 'pending';
                const isDispatched = r.status === 'dispatched';
                const isRejected = r.status === 'rejected';

                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: isPending ? '#fffdf7' : 'transparent', height: '48px' }}>
                    <td style={{ padding: '8px 8px', fontFamily: 'monospace', fontWeight: 800, color: '#170e5e', fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                      {r.docNo}
                    </td>
                    <td style={{ padding: '8px 8px', fontWeight: 700, color: '#0f172a', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                      {r.repName}
                    </td>
                    <td style={{ padding: '8px 6px', verticalAlign: 'middle' }}>
                      {r.vehiclePlate ? (
                        <span style={{ fontSize: '10.5px', background: '#f1f5f9', color: '#334155', padding: '1px 5px', borderRadius: '4px', border: '1px solid #e2e8f0', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s28', "لوحة:")} {r.vehiclePlate}
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s29', "غير محددة")}</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 6px', color: '#475569', fontWeight: 600, fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                      {r.sourceWarehouseName}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 700, fontSize: '11.5px', verticalAlign: 'middle' }}>
                      {(r.requestedItems || []).length} {t('delivery_reps.van_load_requisitions_admin_tab.s30', "صنف")}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 800, color: '#1e293b', fontSize: '11.5px', verticalAlign: 'middle' }}>
                      {totalReqPieces} {t('delivery_reps.van_load_requisitions_admin_tab.s31', "قطعة")}
                    </td>
                    <td style={{ padding: '8px 6px', fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      {new Date(r.createdAt).toLocaleDateString('ar-EG', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      {isPending && (
                        <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '10px', background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {t('delivery_reps.van_load_requisitions_admin_tab.s32', "بانتظار الصرف")}
                          </span>
                          <Button
                            variant="primary"
                            style={{ fontSize: '11px', padding: '3px 7px', background: '#15803d', color: '#ffffff', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                            onClick={() => handleDispatch(r)}
                            disabled={dispatchMutation.isPending}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s33', "صرف وتحميل السيارة فوراً")}
                          >
                            <TruckIcon size={12} />
                            {t('delivery_reps.van_load_requisitions_admin_tab.s34', "صرف")}
                          </Button>
                          <Button
                            variant="danger"
                            style={{ fontSize: '11px', padding: '3px 6px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                            onClick={() => openRejectDialog(r)}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s35', "رفض أو إلغاء الطلب")}
                          >
                            <XCircleIcon size={12} />
                            {t('delivery_reps.van_load_requisitions_admin_tab.s36', "رفض")}
                          </Button>
                          <Button
                            variant="danger"
                            style={{ fontSize: '11px', padding: '3px 5px', color: '#ef4444', background: '#fef2f2', border: '1px solid #fee2e2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => handleDeleteRequisition(r)}
                            disabled={deleteMutation.isPending}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s37', "حذف الطلب نهائياً")}
                          >
                            <Trash2Icon size={12} />
                          </Button>
                        </div>
                      )}
                      {isDispatched && (
                        <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '10px', background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s38', "تم الصرف #")}{r.tripId}
                        </span>
                      )}
                      {isRejected && (
                        <div style={{ display: 'inline-flex', gap: '5px', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '10px', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {t('delivery_reps.van_load_requisitions_admin_tab.s39', "مرفوض")}
                          </span>
                          <Button
                            variant="danger"
                            style={{ fontSize: '11px', padding: '3px 5px', color: '#ef4444', background: '#fef2f2', border: '1px solid #fee2e2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => handleDeleteRequisition(r)}
                            disabled={deleteMutation.isPending}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s40', "حذف الطلب نهائياً")}
                          >
                            <Trash2Icon size={12} />
                          </Button>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: '5px', justifyContent: 'center', alignItems: 'center', flexWrap: 'nowrap' }}>
                        <Button
                          variant="secondary"
                          style={{ fontSize: '11px', padding: '4px 8px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                          onClick={() => openReviewModal(r)}
                          title={t('delivery_reps.van_load_requisitions_admin_tab.s41', "معاينة ومراجعة الأصناف والكميات")}
                        >
                          <FileTextIcon size={12} />
                          {t('delivery_reps.van_load_requisitions_admin_tab.s42', "معاينة")}
                        </Button>
                        {/* Split Print Button */}
                        <div style={{ display: 'inline-flex', alignItems: 'stretch', position: 'relative' }}>
                          <button
                            type="button"
                            style={{
                              fontSize: '11px',
                              padding: '4px 7px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              whiteSpace: 'nowrap',
                              backgroundColor: '#ffffff',
                              color: '#334155',
                              border: '1px solid #cbd5e1',
                              borderInlineEnd: 'none',
                              borderStartStartRadius: '6px',
                              borderEndStartRadius: '6px',
                              cursor: 'pointer',
                              fontWeight: 600,
                              lineHeight: '1.2',
                            }}
                            onClick={() => printRequisition(r, { defaultPaperSize, settings })}
                            title={`طباعة مباشرة (${defaultPaperSize === 'receipt' ? t('delivery_reps.van_load_requisitions_admin_tab.s43', "إيصال حراري 80mm") : t('delivery_reps.van_load_requisitions_admin_tab.s44', "نموذج A4")})`}
                          >
                            <PrinterIcon size={12} />
                            {t('delivery_reps.van_load_requisitions_admin_tab.s45', "طباعة")}
                          </button>
                          <button
                            type="button"
                            style={{
                              padding: '4px 4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#f8fafc',
                              color: '#64748b',
                              border: '1px solid #cbd5e1',
                              borderStartEndRadius: '6px',
                              borderEndEndRadius: '6px',
                              cursor: 'pointer',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActivePrintMenuId(activePrintMenuId === r.id ? null : r.id);
                            }}
                            title={t('delivery_reps.van_load_requisitions_admin_tab.s46', "خيارات الطباعة (A4 أو حراري)")}
                          >
                            <ChevronDownIcon size={11} />
                          </button>

                          {/* Floating print format menu */}
                          {activePrintMenuId === r.id && (
                            <div
                              style={{
                                position: 'absolute',
                                top: 'calc(100% + 4px)',
                                left: 0,
                                zIndex: 100,
                                backgroundColor: '#ffffff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                                padding: '4px',
                                minWidth: '160px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                                textAlign: 'right',
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                style={{
                                  padding: '6px 10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: defaultPaperSize === 'a4' ? '#170e5e' : '#334155',
                                  backgroundColor: defaultPaperSize === 'a4' ? '#f1f5f9' : 'transparent',
                                  border: 'none',
                                  borderRadius: '5px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  width: '100%',
                                  textAlign: 'right',
                                }}
                                onClick={() => {
                                  setActivePrintMenuId(null);
                                  printRequisition(r, { defaultPaperSize, settings }, 'a4');
                                }}
                              >
                                <span>{t('delivery_reps.van_load_requisitions_admin_tab.s47', "طباعة A4 (المستودع)")}</span>
                                {defaultPaperSize === 'a4' && <span style={{ fontSize: '10px', color: '#15803d' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s48', "افتراضي")}</span>}
                              </button>
                              <button
                                type="button"
                                style={{
                                  padding: '6px 10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: defaultPaperSize === 'receipt' ? '#170e5e' : '#334155',
                                  backgroundColor: defaultPaperSize === 'receipt' ? '#f1f5f9' : 'transparent',
                                  border: 'none',
                                  borderRadius: '5px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  width: '100%',
                                  textAlign: 'right',
                                }}
                                onClick={() => {
                                  setActivePrintMenuId(null);
                                  printRequisition(r, { defaultPaperSize, settings }, 'receipt');
                                }}
                              >
                                <span>{t('delivery_reps.van_load_requisitions_admin_tab.s49', "إيصال حراري (80mm)")}</span>
                                {defaultPaperSize === 'receipt' && <span style={{ fontSize: '10px', color: '#15803d' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s50', "افتراضي")}</span>}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Backdrop to close print dropdown when clicking outside */}
      {activePrintMenuId !== null && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 90 }}
          onClick={() => setActivePrintMenuId(null)}
        />
      )}

      {/* Review & Dispatch Modal */}
      {selectedReq && (
        <StandardDialog
          open={Boolean(selectedReq)}
          onClose={() => setSelectedReq(null)}
          title={`مراجعة إذن تحميل البضاعة #${selectedReq.docNo}`}
          subtitle={`المندوب: ${selectedReq.repName} • المستودع المصدر: ${selectedReq.sourceWarehouseName}`}
          width="min(1080px, 96vw)"
          maxWidth="1080px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} dir="rtl">
            {/* Header summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', backgroundColor: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s51', "المندوب والسائق:")}</span>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>{selectedReq.repName}</strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s52', "المركبة المسندة:")}</span>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>{selectedReq.vehiclePlate || '—'}</strong>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s53', "مستودع الصرف:")}</span>
                {selectedReq.status === 'pending' ? (
                  <CustomSelect
                    value={String(activeWarehouseId || '')}
                    onChange={(val) => setSelectedSourceWarehouseId(Number(val))}
                    options={adminWarehouses.map((w) => ({
                      value: String(w.id),
                      label: w.name,
                    }))}
                    placeholder={t('delivery_reps.van_load_requisitions_admin_tab.s54', "اختر مستودع الصرف...")}
                  />
                ) : (
                  <strong style={{ fontSize: '13px', color: '#0369a1' }}>{selectedReq.sourceWarehouseName}</strong>
                )}
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s55', "حالة الإذن:")}</span>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 800,
                    backgroundColor: selectedReq.status === 'dispatched' ? '#ecfdf5' : selectedReq.status === 'rejected' ? '#fef2f2' : '#fef3c7',
                    color: selectedReq.status === 'dispatched' ? '#15803d' : selectedReq.status === 'rejected' ? '#b91c1c' : '#b45309',
                    border: `1px solid ${selectedReq.status === 'dispatched' ? '#bbf7d0' : selectedReq.status === 'rejected' ? '#fecaca' : '#fde68a'}`,
                  }}
                >
                  {selectedReq.status === 'dispatched' ? t('delivery_reps.van_load_requisitions_admin_tab.s56', "تم الصرف وبدء الرحلة") : selectedReq.status === 'rejected' ? t('delivery_reps.van_load_requisitions_admin_tab.s57', "مرفوض") : t('delivery_reps.van_load_requisitions_admin_tab.s58', "بانتظار الصرف")}
                </span>
              </div>
            </div>

            {/* Items Table with warehouse availability check */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#334155' }}>
                  {t('delivery_reps.van_load_requisitions_admin_tab.s59', "الأصناف ومطابقة رصيد المستودع (")}{reviewLines.length} {t('delivery_reps.van_load_requisitions_admin_tab.s60', "أصناف)")}
                </span>
                {selectedReq.status === 'pending' ? (
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {t('delivery_reps.van_load_requisitions_admin_tab.s61', "يمكنك تعديل الكمية المعتمدة، إضافة أصناف جديدة، أو استبعاد صنف")}
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 700 }}>
                    {t('delivery_reps.van_load_requisitions_admin_tab.s62', "تم اعتماد وصرف البضاعة وتحميلها لسيارة المندوب")}
                  </span>
                )}
              </div>

              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxHeight: '380px', overflowY: 'auto' }}>
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
                  <colgroup>
                    <col style={{ width: selectedReq.status === 'pending' ? '30%' : '36%' }} />
                    <col style={{ width: selectedReq.status === 'pending' ? '18%' : '20%' }} />
                    <col style={{ width: selectedReq.status === 'pending' ? '18%' : '20%' }} />
                    <col style={{ width: selectedReq.status === 'pending' ? '28%' : '24%' }} />
                    {selectedReq.status === 'pending' && <col style={{ width: '6%' }} />}
                  </colgroup>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', position: 'sticky', top: 0, zIndex: 2 }}>
                      <th style={{ padding: '9px 12px', fontWeight: 700 }}>{t('delivery_reps.van_load_requisitions_admin_tab.s63', "الصنف والباركود")}</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s64', "طلب المندوب")}</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s65', "المتاح بالمستودع")}</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s66', "المعتمد للصرف")}</th>
                      {selectedReq.status === 'pending' && (
                        <th style={{ padding: '9px 12px', textAlign: 'center' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s67', "حذف")}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {reviewLines.length === 0 ? (
                      <tr>
                        <td colSpan={selectedReq.status === 'pending' ? 5 : 4} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s68', "لا توجد أصناف في هذا الإذن. يمكنك إضافة أصناف بالأسفل.")}
                        </td>
                      </tr>
                    ) : (
                      reviewLines.map((it) => {
                        const avail = it.warehouseAvailQty ?? 0;
                        const isShortage = avail < it.approvedQty;
                        const isCarton = Boolean(it.packagingUnit && it.packagingUnit.multiplier > 1);
                        const mult = it.packagingUnit?.multiplier || 1;

                        return (
                          <tr key={it.productId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                              <div style={{ wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal', lineHeight: 1.45 }}>
                                <span style={{ fontWeight: 700, color: '#0f172a' }}>{it.productName}</span>
                                {it.requestedQty === 0 && (
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      fontWeight: 700,
                                      background: '#e0e7ff',
                                      color: '#3730a3',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      marginInlineStart: '6px',
                                      display: 'inline-block',
                                    }}
                                  >
                                    {t('delivery_reps.van_load_requisitions_admin_tab.s69', "إضافة المشرف")}
                                  </span>
                                )}
                              </div>
                              {it.barcode && (
                                <span style={{ fontSize: '10.5px', color: '#64748b', fontFamily: 'monospace', display: 'block', marginTop: '2px' }}>
                                  {t('delivery_reps.van_load_requisitions_admin_tab.s70', "باركود:")} {it.barcode}
                                </span>
                              )}
                              {isCarton && (
                                <span style={{ fontSize: '10px', color: '#170e5e', fontWeight: 600, display: 'inline-block', marginTop: '2px', backgroundColor: '#eef2ff', padding: '1px 5px', borderRadius: '4px' }}>
                                  {t('delivery_reps.van_load_requisitions_admin_tab.s71', "الكرتونة =")} {mult} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s72', "قطعة")}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, fontSize: '13px', verticalAlign: 'middle' }}>
                              {it.requestedQty > 0 ? (
                                <div>
                                  <div>
                                    <span>{it.requestedQty}</span> <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s73', "قطعة")}</span>
                                  </div>
                                  {it.requestedPackingText ? (
                                    <div style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700, marginTop: '2px' }}>
                                      {it.requestedPackingText}
                                    </div>
                                  ) : isCarton && it.packagingUnit ? (
                                    <div style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700, marginTop: '2px' }}>
                                      {Math.floor(it.requestedQty / mult)} {it.packagingUnit.name}
                                      {it.requestedQty % mult > 0 ? ` + ${it.requestedQty % mult} ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s74', "قطعة")}` : ''}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  background: isShortage ? '#fef2f2' : '#f0fdf4',
                                  color: isShortage ? '#b91c1c' : '#15803d',
                                  border: `1px solid ${isShortage ? '#fca5a5' : '#bbf7d0'}`,
                                }}
                              >
                                {avail} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s75', "قطعة")} {isShortage ? t('delivery_reps.van_load_requisitions_admin_tab.s76', "(عجز)") : t('delivery_reps.van_load_requisitions_admin_tab.s77', "(متوفر)")}
                              </span>
                              {isShortage && it.warehouseStocks && it.warehouseStocks.length > 0 && (
                                (() => {
                                  const other = it.warehouseStocks.find((w: any) => w.warehouseId !== activeWarehouseId && w.qty > 0);
                                  if (!other) return null;
                                  return (
                                    <div style={{ fontSize: '10px', color: '#0369a1', marginTop: '3px', fontWeight: 700 }}>
                                      {t('delivery_reps.van_load_requisitions_admin_tab.s78', "متوفر في")} {other.warehouseName}: {other.qty} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s79', "قطعة")}
                                    </div>
                                  );
                                })()
                              )}
                              {isCarton && it.packagingUnit && (
                                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', fontWeight: 600 }}>
                                  {Math.floor(avail / mult)} {it.packagingUnit.name}
                                  {avail % mult > 0 ? ` + ${avail % mult} ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s80', "قطعة")}` : ''}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                              {selectedReq.status === 'pending' ? (
                                isCarton ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                      {/* Cartons Stepper: + first (right in RTL), - last (left in RTL) */}
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                        <div
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '6px',
                                            backgroundColor: '#ffffff',
                                            overflow: 'hidden',
                                            height: '28px',
                                          }}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => handleUpdateLineCartonsPieces(it.productId, (it.approvedCartons || 0) + 1, it.approvedPieces || 0)}
                                            style={{
                                              width: '24px',
                                              height: '100%',
                                              border: 'none',
                                              backgroundColor: '#f8fafc',
                                              color: '#334155',
                                              cursor: 'pointer',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderInlineEnd: '1px solid #e2e8f0',
                                            }}
                                            title={`زيادة ${it.packagingUnit?.name || t('delivery_reps.van_load_requisitions_admin_tab.s81', "كرتونة")}`}
                                          >
                                            <PlusIcon size={11} />
                                          </button>
                                          <input
                                            type="number"
                                            min="0"
                                            className="no-spin-arrows"
                                            value={it.approvedCartons ?? 0}
                                            onChange={(e) => {
                                              const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                              handleUpdateLineCartonsPieces(it.productId, val, it.approvedPieces || 0);
                                            }}
                                            style={{
                                              width: '36px',
                                              height: '100%',
                                              border: 'none',
                                              textAlign: 'center',
                                              fontSize: '12px',
                                              fontWeight: 800,
                                              color: '#0f172a',
                                              outline: 'none',
                                            }}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => handleUpdateLineCartonsPieces(it.productId, Math.max(0, (it.approvedCartons || 0) - 1), it.approvedPieces || 0)}
                                            disabled={(it.approvedCartons || 0) <= 0}
                                            style={{
                                              width: '24px',
                                              height: '100%',
                                              border: 'none',
                                              backgroundColor: '#f8fafc',
                                              color: '#334155',
                                              cursor: (it.approvedCartons || 0) <= 0 ? 'not-allowed' : 'pointer',
                                              opacity: (it.approvedCartons || 0) <= 0 ? 0.4 : 1,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderInlineStart: '1px solid #e2e8f0',
                                            }}
                                            title={`إنقاص ${it.packagingUnit?.name || t('delivery_reps.van_load_requisitions_admin_tab.s82', "كرتونة")}`}
                                          >
                                            <MinusIcon size={11} />
                                          </button>
                                        </div>
                                        <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                                          {it.packagingUnit?.name || t('delivery_reps.van_load_requisitions_admin_tab.s83', "كرتونة")}
                                        </span>
                                      </div>

                                      {/* Pieces Stepper: + first (right in RTL), - last (left in RTL) */}
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                        <div
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '6px',
                                            backgroundColor: '#ffffff',
                                            overflow: 'hidden',
                                            height: '28px',
                                          }}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => handleUpdateLineCartonsPieces(it.productId, it.approvedCartons || 0, (it.approvedPieces || 0) + 1)}
                                            style={{
                                              width: '24px',
                                              height: '100%',
                                              border: 'none',
                                              backgroundColor: '#f8fafc',
                                              color: '#334155',
                                              cursor: 'pointer',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderInlineEnd: '1px solid #e2e8f0',
                                            }}
                                            title={`زيادة ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s84', "قطع")}`}
                                          >
                                            <PlusIcon size={11} />
                                          </button>
                                          <input
                                            type="number"
                                            min="0"
                                            className="no-spin-arrows"
                                            value={it.approvedPieces ?? 0}
                                            onChange={(e) => {
                                              const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                              handleUpdateLineCartonsPieces(it.productId, it.approvedCartons || 0, val);
                                            }}
                                            style={{
                                              width: '32px',
                                              height: '100%',
                                              border: 'none',
                                              textAlign: 'center',
                                              fontSize: '12px',
                                              fontWeight: 800,
                                              color: '#0f172a',
                                              outline: 'none',
                                            }}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => handleUpdateLineCartonsPieces(it.productId, it.approvedCartons || 0, Math.max(0, (it.approvedPieces || 0) - 1))}
                                            disabled={(it.approvedPieces || 0) <= 0}
                                            style={{
                                              width: '24px',
                                              height: '100%',
                                              border: 'none',
                                              backgroundColor: '#f8fafc',
                                              color: '#334155',
                                              cursor: (it.approvedPieces || 0) <= 0 ? 'not-allowed' : 'pointer',
                                              opacity: (it.approvedPieces || 0) <= 0 ? 0.4 : 1,
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderInlineStart: '1px solid #e2e8f0',
                                            }}
                                            title={`إنقاص ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s85', "قطع")}`}
                                          >
                                            <MinusIcon size={11} />
                                          </button>
                                        </div>
                                        <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                                          {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s86', "قطع")}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Total Approved Summary Badge */}
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        fontWeight: 800,
                                        color: isShortage ? '#dc2626' : '#170e5e',
                                        backgroundColor: isShortage ? '#fef2f2' : '#f1f5f9',
                                        padding: '2px 8px',
                                        borderRadius: '5px',
                                        border: `1px solid ${isShortage ? '#fca5a5' : '#cbd5e1'}`,
                                      }}
                                    >
                                      {t('delivery_reps.van_load_requisitions_admin_tab.s87', "إجمالي المعتمد:")} {it.approvedQty} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s88', "قطعة")}
                                    </span>
                                  </div>
                                ) : (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    <div
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        border: '1px solid #cbd5e1',
                                        borderRadius: '6px',
                                        backgroundColor: '#ffffff',
                                        overflow: 'hidden',
                                        height: '28px',
                                      }}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateLineApprovedQty(it.productId, (it.approvedQty || 0) + (it.isWeight ? 1 : 1))}
                                        style={{
                                          width: '26px',
                                          height: '100%',
                                          border: 'none',
                                          backgroundColor: '#f8fafc',
                                          color: '#475569',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          borderInlineEnd: '1px solid #e2e8f0',
                                        }}
                                        title={t('delivery_reps.van_load_requisitions_admin_tab.s89', "زيادة الكمية")}
                                      >
                                        <PlusIcon size={12} />
                                      </button>
                                      <input
                                        type="number"
                                        min="0"
                                        step={it.isWeight ? '0.1' : '1'}
                                        className="no-spin-arrows"
                                        value={it.approvedQty}
                                        onChange={(e) => {
                                          const val = Math.max(0, (it.isWeight ? parseFloat(e.target.value) : parseInt(e.target.value, 10)) || 0);
                                          handleUpdateLineApprovedQty(it.productId, val);
                                        }}
                                        style={{
                                          width: '46px',
                                          height: '100%',
                                          border: 'none',
                                          textAlign: 'center',
                                          fontSize: '13px',
                                          fontWeight: 800,
                                          color: isShortage ? '#dc2626' : '#0f172a',
                                          outline: 'none',
                                        }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateLineApprovedQty(it.productId, Math.max(0, (it.approvedQty || 0) - (it.isWeight ? 1 : 1)))}
                                        disabled={it.approvedQty <= 0}
                                        style={{
                                          width: '26px',
                                          height: '100%',
                                          border: 'none',
                                          backgroundColor: '#f8fafc',
                                          color: '#475569',
                                          cursor: it.approvedQty <= 0 ? 'not-allowed' : 'pointer',
                                          opacity: it.approvedQty <= 0 ? 0.4 : 1,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          borderInlineStart: '1px solid #e2e8f0',
                                        }}
                                        title={t('delivery_reps.van_load_requisitions_admin_tab.s90', "تقليل الكمية")}
                                      >
                                        <MinusIcon size={12} />
                                      </button>
                                    </div>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>
                                      {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s91', "قطعة")}
                                    </span>
                                  </div>
                                )
                              ) : (
                                <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '3px 10px',
                                      borderRadius: '6px',
                                      fontSize: '12px',
                                      fontWeight: 800,
                                      backgroundColor: '#ecfdf5',
                                      color: '#15803d',
                                      border: '1px solid #bbf7d0',
                                    }}
                                  >
                                    {it.approvedQty} {it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s92', "قطعة")}
                                  </span>
                                  {it.packingText ? (
                                    <span style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700 }}>
                                      {it.packingText}
                                    </span>
                                  ) : isCarton && it.packagingUnit ? (
                                    <span style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700 }}>
                                      {Math.floor(it.approvedQty / mult)} {it.packagingUnit.name}
                                      {it.approvedQty % mult > 0 ? ` + ${it.approvedQty % mult} ${it.unit || t('delivery_reps.van_load_requisitions_admin_tab.s93', "قطعة")}` : ''}
                                    </span>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            {selectedReq.status === 'pending' && (
                              <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveReviewLine(it.productId)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    borderRadius: '4px',
                                  }}
                                  title={t('delivery_reps.van_load_requisitions_admin_tab.s94', "استبعاد هذا الصنف")}
                                >
                                  <Trash2Icon size={14} />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {reviewLines.length > 0 && (
                    <tfoot style={{ backgroundColor: '#f8fafc', borderTop: '2px solid #e2e8f0', fontWeight: 800 }}>
                      <tr>
                        <td style={{ padding: '9px 12px', color: '#334155' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s95', "إجمالي الأصناف:")} <span style={{ color: '#170e5e' }}>{reviewLines.length} {t('delivery_reps.van_load_requisitions_admin_tab.s96', "صنف")}</span>
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', color: '#0f172a' }}>
                          {reviewLines.reduce((acc, l) => acc + (l.requestedQty || 0), 0)} <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{t('delivery_reps.van_load_requisitions_admin_tab.s97', "وحدة")}</span>
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', color: '#64748b' }}>
                          —
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', color: '#15803d' }}>
                          {reviewLines.reduce((acc, l) => acc + (l.approvedQty || 0), 0)} <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 500 }}>{t('delivery_reps.van_load_requisitions_admin_tab.s98', "وحدة")}</span>
                        </td>
                        {selectedReq.status === 'pending' && <td />}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Add Extra Item Section for Admin */}
              {selectedReq.status === 'pending' && (
                <div style={{ padding: '10px 12px', background: '#fafafa', borderTop: '1px solid #e2e8f0' }}>
                  {!isAddProductOpen ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => setIsAddProductOpen(true)}
                      style={{ fontSize: '12px', fontWeight: 700, color: '#170e5e', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <PlusIcon size={14} />
                      {t('delivery_reps.van_load_requisitions_admin_tab.s99', "+ إضافة صنف إضافي للإذن")}
                    </Button>
                  ) : (
                    <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e' }}>
                          {t('delivery_reps.van_load_requisitions_admin_tab.s100', "اختر صنفاً لإضافته من مستودع \"")}{selectedReq.sourceWarehouseName}":
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddProductOpen(false);
                            setProductSearch('');
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: '2px' }}
                        >
                          <XIcon size={16} />
                        </button>
                      </div>

                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder={t('delivery_reps.van_load_requisitions_admin_tab.s101', "ابحث بالاسم أو الباركود...")}
                        style={{
                          width: '100%',
                          height: '36px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '12px',
                          boxSizing: 'border-box',
                        }}
                        autoFocus
                      />

                      <div
                        style={{
                          maxHeight: '160px',
                          overflowY: 'auto',
                          marginTop: '6px',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                        }}
                      >
                        {warehouseProducts
                          .filter((p) => {
                            if (!productSearch.trim()) return true;
                            const q = productSearch.toLowerCase().trim();
                            return (p.name || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q);
                          })
                          .slice(0, 12)
                          .map((p) => {
                            const alreadyInReview = reviewLines.some((l) => l.productId === p.id);
                            return (
                              <div
                                key={p.id}
                                onClick={() => handleAddProductToReview(p)}
                                style={{
                                  padding: '8px 10px',
                                  borderBottom: '1px solid #f1f5f9',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                  backgroundColor: alreadyInReview ? '#f8fafc' : '#ffffff',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.backgroundColor = alreadyInReview ? '#f8fafc' : '#ffffff')
                                }
                              >
                                <div>
                                  <span style={{ fontWeight: 700, color: '#0f172a' }}>{p.name}</span>
                                  <span style={{ fontSize: '10.5px', color: '#94a3b8', marginRight: '6px' }}>
                                    {p.barcode || t('delivery_reps.van_load_requisitions_admin_tab.s102', "بدون باركود")}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span
                                    style={{
                                      fontSize: '11px',
                                      fontWeight: 800,
                                      color: p.totalStock > 0 ? '#15803d' : '#dc2626',
                                    }}
                                  >
                                    {t('delivery_reps.van_load_requisitions_admin_tab.s103', "متاح:")} {p.totalStock} {t('delivery_reps.van_load_requisitions_admin_tab.s104', "قطعة")}
                                  </span>
                                  <span style={{ fontSize: '11.5px', color: '#170e5e', fontWeight: 800 }}>
                                    {alreadyInReview ? t('delivery_reps.van_load_requisitions_admin_tab.s105', "+ زيادة كمية") : t('delivery_reps.van_load_requisitions_admin_tab.s106', "+ إضافة")}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedReq.status === 'pending' && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  {t('delivery_reps.van_load_requisitions_admin_tab.s107', "ملاحظات وتوجيهات الإدارة:")}
                </label>
                <input
                  type="text"
                  placeholder={t('delivery_reps.van_load_requisitions_admin_tab.s108', "ملاحظات تظهر للمندوب في تقرير الصرف والرحلة...")}
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12.5px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {selectedReq.rejectionReason && (
              <div style={{ fontSize: '12px', color: '#991b1b', backgroundColor: '#fef2f2', padding: '10px 12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                <strong>{t('delivery_reps.van_load_requisitions_admin_tab.s109', "سبب الرفض:")}</strong> {selectedReq.rejectionReason}
              </div>
            )}

            {selectedReq.reviewedByName && (
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                {t('delivery_reps.van_load_requisitions_admin_tab.s110', "تمت المراجعة بواسطة:")} <strong>{selectedReq.reviewedByName}</strong>{' '}
                {selectedReq.reviewedAt && `بتاريخ ${new Date(selectedReq.reviewedAt).toLocaleString('ar-EG')}`}
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
              <Button variant="secondary" onClick={() => setSelectedReq(null)}>
                {t('delivery_reps.van_load_requisitions_admin_tab.s111', "إغلاق")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => printRequisition(selectedReq, { defaultPaperSize, settings }, 'a4')}
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                title={t('delivery_reps.van_load_requisitions_admin_tab.s112', "طباعة نموذج المستودع الرسمي A4")}
              >
                <PrinterIcon size={13} />
                {t('delivery_reps.van_load_requisitions_admin_tab.s113', "طباعة A4")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => printRequisition(selectedReq, { defaultPaperSize, settings }, 'receipt')}
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                title={t('delivery_reps.van_load_requisitions_admin_tab.s114', "طباعة إيصال حراري 80mm للمندوب")}
              >
                <PrinterIcon size={13} />
                {t('delivery_reps.van_load_requisitions_admin_tab.s115', "إيصال حراري (80mm)")}
              </Button>
              {selectedReq.status === 'pending' && (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleSaveReviewedItems}
                    disabled={reviewMutation.isPending}
                    style={{ fontSize: '12px' }}
                  >
                    {reviewMutation.isPending ? t('delivery_reps.van_load_requisitions_admin_tab.s116', "جاري الحفظ...") : t('delivery_reps.van_load_requisitions_admin_tab.s117', "حفظ تعديل الكميات")}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => openRejectDialog(selectedReq)}
                    style={{ backgroundColor: '#dc2626', color: '#ffffff', fontSize: '12px' }}
                  >
                    {t('delivery_reps.van_load_requisitions_admin_tab.s118', "رفض / إلغاء الطلب")}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => handleDeleteRequisition(selectedReq)}
                    disabled={deleteMutation.isPending}
                    style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                  >
                    <Trash2Icon size={13} />
                    {t('delivery_reps.van_load_requisitions_admin_tab.s119', "حذف الطلب")}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => handleDispatch(selectedReq)}
                    disabled={dispatchMutation.isPending}
                    style={{ backgroundColor: '#15803d', color: '#ffffff', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <TruckIcon size={14} />
                    {dispatchMutation.isPending ? t('delivery_reps.van_load_requisitions_admin_tab.s120', "جاري الصرف والتحميل...") : t('delivery_reps.van_load_requisitions_admin_tab.s121', "اعتماد وصرف وتحميل وبدء الرحلة")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </StandardDialog>
      )}

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
