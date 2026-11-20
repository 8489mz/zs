import { useMutation, useQueryClient } from '@tanstack/react-query';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import {
  vanSalesApi,
  type VanLoadRequisitionRecord,
  type DriverWarehouse,
} from '../../api/van-sales.api';
import type { Dispatch, SetStateAction } from 'react';
import type { AdminReviewLine } from './van-load-requisitions-admin-types';

interface UseRequisitionMutationsProps {
  selectedReq: VanLoadRequisitionRecord | null;
  reviewLines: AdminReviewLine[];
  formatReviewLinesForPayload: (
    lines: AdminReviewLine[],
  ) => { productId: number; qty: number; productName?: string; barcode?: string }[];
  adminNotes: string;
  activeWarehouseId: number | undefined;
  adminWarehouses: DriverWarehouse[];
  rejectModalReq: VanLoadRequisitionRecord | null;
  rejectReasonInput: string;
  setSelectedReq: Dispatch<SetStateAction<VanLoadRequisitionRecord | null>>;
  setRejectModalReq: Dispatch<SetStateAction<VanLoadRequisitionRecord | null>>;
  setRejectReasonInput: Dispatch<SetStateAction<string>>;
}

export function useRequisitionMutations({
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
}: UseRequisitionMutationsProps) {
  const queryClient = useQueryClient();

  // Review (Update Quantities & Items) Mutation
  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      items,
      notes,
      sourceWarehouseId,
    }: {
      id: number;
      items: { productId: number; qty: number; productName?: string; barcode?: string }[];
      notes?: string;
      sourceWarehouseId?: number;
    }) => vanSalesApi.reviewRequisition(id, items, notes, sourceWarehouseId),
    onSuccess: () => {
      toast.success('تم حفظ تعديل أصناف وكميات إذن التحميل بنجاح');
      queryClient.invalidateQueries({ queryKey: ['van-admin-load-requisitions'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل تحديث كميات الطلب');
    },
  });

  // Dispatch Mutation
  const dispatchMutation = useMutation({
    mutationFn: (id: number) => vanSalesApi.dispatchRequisition(id),
    onSuccess: (data) => {
      toast.success(
        data.isSupplementary
          ? `تم اعتماد وصرف البضاعة وتحميل السيارة بنجاح كشحن إضافي على الرحلة المفتوحة #${data.tripId}`
          : `تم اعتماد وصرف البضاعة وتحميل السيارة بنجاح! تم فتح الرحلة #${data.tripId}`,
      );
      queryClient.invalidateQueries({ queryKey: ['van-admin-load-requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['van-sales-admin-trips'] });
      // INV-VAN-ADMIN-INVALIDATIONS (P10): dispatch changes the pending
      // count — without this the pending-loads badge stays stale until a
      // manual refresh.
      queryClient.invalidateQueries({ queryKey: ['van-admin-pending-requisitions-badge'] });
      setSelectedReq(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل صرف وتحميل السيارة');
    },
  });

  // Reject Mutation
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => vanSalesApi.rejectRequisition(id, reason),
    onSuccess: () => {
      toast.info('تم رفض طلب التحميل');
      queryClient.invalidateQueries({ queryKey: ['van-admin-load-requisitions'] });
      // INV-VAN-ADMIN-INVALIDATIONS (P10): a rejection also changes the
      // pending count behind the badge.
      queryClient.invalidateQueries({ queryKey: ['van-admin-pending-requisitions-badge'] });
      setSelectedReq(null);
      setRejectModalReq(null);
      setRejectReasonInput('');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل رفض طلب التحميل');
    },
  });

  // Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => vanSalesApi.deleteRequisition(id),
    onSuccess: (data) => {
      toast.success(`تم حذف إذن التحميل #${data.docNo} بنجاح`);
      queryClient.invalidateQueries({ queryKey: ['van-admin-load-requisitions'] });
      // INV-VAN-ADMIN-INVALIDATIONS (P10): deleting a pending requisition
      // also changes the pending count behind the badge.
      queryClient.invalidateQueries({ queryKey: ['van-admin-pending-requisitions-badge'] });
      setSelectedReq(null);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل حذف إذن التحميل');
    },
  });

  const handleDeleteRequisition = async (req: VanLoadRequisitionRecord) => {
    const ok = await systemConfirm({
      title: 'حذف إذن التحميل',
      message: `هل أنت متأكد من حذف إذن التحميل #${req.docNo} للمندوب "${req.repName}" نهائياً؟ هذا الإجراء لا يمكن التراجع عنه.`,
      confirmText: 'نعم، حذف الطلب',
      cancelText: 'إلغاء',
      variant: 'danger',
    });
    if (ok) {
      deleteMutation.mutate(req.id);
    }
  };

  const handleDispatch = async (req: VanLoadRequisitionRecord) => {
    const isModalOpen = selectedReq?.id === req.id && reviewLines.length > 0;

    const items = isModalOpen
      ? formatReviewLinesForPayload(reviewLines)
      : (req.approvedItems && req.approvedItems.length > 0 ? req.approvedItems : req.requestedItems || []).map((it: any) => ({
          productId: Number(it.productId),
          qty: Number(it.qty ?? it.approvedQty ?? 0),
          productName: it.productName,
          barcode: it.barcode,
          cartons: it.cartons,
          pieces: it.pieces,
          cartonMultiplier: it.cartonMultiplier,
          packagingUnitName: it.packagingUnitName,
          unitName: it.unitName,
          isWeight: it.isWeight,
          packingText: it.packingText,
        }));

    if (!items || items.length === 0) {
      toast.error('لا يمكن اعتماد إذن تحميل خالٍ من الأصناف');
      return;
    }

    const hasZeroApproved = items.some((l) => l.qty <= 0);
    if (hasZeroApproved) {
      toast.error('يرجى حذف الأصناف ذات الكمية الصفرية أو اعتماد كمية أكبر من صفر قبل الصرف');
      return;
    }

    const totalPieces = items.reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const targetWhId = isModalOpen && activeWarehouseId ? activeWarehouseId : req.sourceWarehouseId;
    const targetWhName = adminWarehouses.find((w) => w.id === targetWhId)?.name || req.sourceWarehouseName;

    const ok = await systemConfirm({
      title: 'اعتماد وصرف وتحميل السيارة',
      message: `هل تود صرف البضاعة (${items.length} صنف بإجمالي ${totalPieces} قطعة) من مستودع "${targetWhName}" وتحميل سيارة المندوب "${req.repName}" وبدء رحلة التوزيع فوراً؟ سيتم خصم الكميات من المستودع وتحويلها لعهدة السيارة.`,
      confirmText: 'اعتماد وصرف وتحميل الآن',
      cancelText: 'إلغاء',
      variant: 'primary',
    });
    if (ok) {
      try {
        if (isModalOpen) {
          // Automatically save reviewed items and warehouse first, then dispatch!
          await vanSalesApi.reviewRequisition(
            req.id,
            formatReviewLinesForPayload(reviewLines),
            adminNotes,
            targetWhId,
          );
        }
        dispatchMutation.mutate(req.id);
      } catch (err: any) {
        toast.error(err?.message || 'فشل تحديث بيانات الإذن قبل الصرف');
      }
    }
  };

  const handleSaveReviewedItems = () => {
    if (!selectedReq) return;
    if (reviewLines.length === 0) {
      toast.error('لا يمكن حفظ إذن تحميل بدون أي أصناف');
      return;
    }
    reviewMutation.mutate({
      id: selectedReq.id,
      items: formatReviewLinesForPayload(reviewLines),
      notes: adminNotes,
      sourceWarehouseId: activeWarehouseId,
    });
  };

  const openRejectDialog = (req: VanLoadRequisitionRecord) => {
    setRejectModalReq(req);
    setRejectReasonInput('');
  };

  const confirmReject = () => {
    if (!rejectModalReq) return;
    rejectMutation.mutate({
      id: rejectModalReq.id,
      reason: rejectReasonInput.trim() || 'تم رفض طلب التحميل بواسطة إدارة المستودعات',
    });
  };

  return {
    reviewMutation,
    dispatchMutation,
    rejectMutation,
    deleteMutation,
    handleDeleteRequisition,
    handleDispatch,
    handleSaveReviewedItems,
    openRejectDialog,
    confirmReject,
  };
}
