import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import type {
  DriverAvailableProduct,
  VanLoadRequisitionRecord,
  useDriverLoadRequisition,
} from '../../hooks/useDriverLoadRequisition';
import type { RequisitionLineItem } from './LoadRequisitionTypes';

export interface AdminSubmitPayloadItem {
  productId: number;
  qty: number;
  productName: string;
  barcode: string;
  cartons?: number;
  pieces?: number;
  cartonMultiplier?: number;
  packagingUnitName?: string;
  unitName: string;
  isWeight?: boolean;
  packingText: string;
  sourceWarehouseId?: number;
  sourceWarehouseName: string;
}

export interface AdminSubmitPayload {
  repId: number;
  sourceWarehouseId?: number;
  items: AdminSubmitPayloadItem[];
  notes?: string;
  dispatchImmediately: boolean;
}

export interface UseRequisitionSubmitArgs {
  driverHook: Pick<ReturnType<typeof useDriverLoadRequisition>, 'cancelRequisition' | 'submitRequisition'>;
  adminSubmitMutation: { mutateAsync: (payload: AdminSubmitPayload) => Promise<unknown> };
  availableProducts: DriverAvailableProduct[];
  pendingRequisition: VanLoadRequisitionRecord | null;
  validLines: RequisitionLineItem[];
  distinctItemsCount: number;
  totalUnitsCount: number;
  driverName: string;
  isAdmin: boolean;
  notes: string;
  selectedRepId: string;
  selectedWarehouseFilter: string;
  hasDraftContent: boolean;
  hasSavedDraft: boolean;
  flushDraft: () => void;
  clearDraft: () => void;
  dismissRestoredNotice: () => void;
  onBack: () => void;
  onRequisitionSubmitted?: (docNo: string) => void;
  setLines: Dispatch<SetStateAction<RequisitionLineItem[]>>;
  setNotes: Dispatch<SetStateAction<string>>;
  setSelectedWarehouseFilter: Dispatch<SetStateAction<string>>;
  setActiveViewTab: Dispatch<SetStateAction<'catalog' | 'selected'>>;
  setSubmittedDocNo: Dispatch<SetStateAction<string | null>>;
}

export function useRequisitionSubmit({
  driverHook,
  adminSubmitMutation,
  availableProducts,
  pendingRequisition,
  validLines,
  distinctItemsCount,
  totalUnitsCount,
  driverName,
  isAdmin,
  notes,
  selectedRepId,
  selectedWarehouseFilter,
  hasDraftContent,
  hasSavedDraft,
  flushDraft,
  clearDraft,
  dismissRestoredNotice,
  onBack,
  onRequisitionSubmitted,
  setLines,
  setNotes,
  setSelectedWarehouseFilter,
  setActiveViewTab,
  setSubmittedDocNo,
}: UseRequisitionSubmitArgs) {
  const handleGoBack = useCallback(() => {
    flushDraft();
    onBack();
  }, [flushDraft, onBack]);

  const handleClearDraft = useCallback(async () => {
    if (!hasDraftContent && !hasSavedDraft) {
      clearDraft();
      toast.info('لا توجد مسودة حالية لحذفها');
      return;
    }

    const confirmed = await systemConfirm({
      title: 'حذف مسودة طلب التحميل',
      message: 'هل أنت متأكد من حذف مسودة طلب التحميل الحالية؟ سيتم مسح جميع الأصناف والبيانات المدخلة والبدء من جديد.',
      confirmText: 'نعم، احذف المسودة',
      cancelText: 'إلغاء',
      variant: 'danger',
    });

    if (confirmed) {
      clearDraft();
      setLines([]);
      setNotes('');
      dismissRestoredNotice();
      toast.success('تم حذف المسودة بنجاح وتفريغ البيانات');
    }
  }, [hasDraftContent, hasSavedDraft, clearDraft, dismissRestoredNotice]);

  // Handle cancel pending requisition and restore items into draft lines
  const handleCancelPendingAndRestore = async () => {
    if (!pendingRequisition) return;
    const confirmed = await systemConfirm({
      title: 'إلغاء طلب إذن التحميل المعلق',
      message: `هل أنت متأكد من إلغاء طلب إذن التحميل #${pendingRequisition.docNo}؟ سيتم إلغاؤه من لوحة المشرف واسترجاع الأصناف بالسلة لتتمكن من تعديل كمياتها وإعادة الإرسال.`,
      confirmText: 'نعم، إلغاء واسترجاع الأصناف',
      cancelText: 'تراجع',
    });
    if (!confirmed) return;

    try {
      const res = await driverHook.cancelRequisition(pendingRequisition.id);
      if (res?.previousItems && res.previousItems.length > 0) {
        if (res.sourceWarehouseId) {
          setSelectedWarehouseFilter(String(res.sourceWarehouseId));
        }
        if (res.notes) {
          setNotes(res.notes);
        }
        const restoredLines: RequisitionLineItem[] = [];
        for (const item of res.previousItems) {
          const pId = Number(item.productId);
          const prod = availableProducts.find((p) => p.id === pId);
          const mult = item.cartonMultiplier || item.packagingUnit?.multiplier || prod?.packagingUnit?.multiplier || 1;
          const isCartonItem = Boolean(mult > 1);
          const qty = Number(item.qty || 0);
          const cartons = item.cartons !== undefined ? Number(item.cartons) : (isCartonItem ? Math.floor(qty / mult) : undefined);
          const pieces = item.pieces !== undefined ? Number(item.pieces) : (isCartonItem ? qty % mult : undefined);

          restoredLines.push({
            id: `line-${Date.now()}-${pId}-${Math.random().toString(36).substr(2, 4)}`,
            productId: pId,
            productName: item.productName || prod?.name || `صنف #${pId}`,
            barcode: item.barcode || prod?.barcode || '',
            unitPrice: prod?.retailPrice || Number(item.unitPrice || 0),
            unit: item.unitName || item.unit || prod?.unit || 'قطعة',
            packagingUnit: item.packagingUnit || prod?.packagingUnit,
            isWeight: Boolean(item.isWeight ?? prod?.isWeight),
            cartons,
            pieces,
            sourceWarehouseId: item.sourceWarehouseId ? Number(item.sourceWarehouseId) : (res.sourceWarehouseId || 1),
            sourceWarehouseName: item.sourceWarehouseName || prod?.warehouseStocks?.[0]?.warehouseName || 'المستودع',
            availableInWarehouse: prod?.availableQty ?? prod?.totalStock ?? 0,
            warehouseStocks: prod?.warehouseStocks || [],
            qty,
            searchQuery: item.productName || prod?.name,
            isSearchOpen: false,
          });
        }
        setLines(restoredLines);
        setActiveViewTab('selected');
        toast.info(`تم استرجاع ${restoredLines.length} صنف بالسلة، يمكنك الآن تعديل الكميات وإعادة الإرسال.`);
      }
    } catch {
      // Toast handled in mutation onError
    }
  };

  // Handle submit in driver mode
  const handleSubmit = async () => {
    if (pendingRequisition && !isAdmin) {
      toast.warning(`لديك طلب إذن تحميل معلق بالفعل برقم #${pendingRequisition.docNo}. يرجى إلغاؤه لتعديل كمياته أو انتظار اعتماده وصرفه.`);
      return;
    }

    if (validLines.length === 0) {
      toast.error('يرجى اختيار صنف واحد على الأقل لطلب التحميل');
      return;
    }

    for (const line of validLines) {
      if (line.availableInWarehouse <= 0) {
        toast.error(`الصنف "${line.productName}" رصيده نافد في مستودع "${line.sourceWarehouseName}"`);
        return;
      }
      if (line.qty > line.availableInWarehouse) {
        toast.error(`الكمية المطلوبة من "${line.productName}" (${line.qty}) تتجاوز المتاح (${line.availableInWarehouse})`);
        return;
      }
    }

    const payload = {
      sourceWarehouseId: selectedWarehouseFilter !== 'all' ? Number(selectedWarehouseFilter) : undefined,
      items: validLines.map((item) => {
        const mult = item.packagingUnit?.multiplier || 1;
        const isCarton = Boolean(item.packagingUnit && mult > 1);
        const cartons = item.cartons !== undefined ? item.cartons : (isCarton ? Math.floor(item.qty / mult) : undefined);
        const pieces = item.pieces !== undefined ? item.pieces : (isCarton ? item.qty % mult : undefined);
        let packingText = '';
        if (isCarton && (cartons !== undefined || pieces !== undefined)) {
          const c = cartons || 0;
          const p = pieces || 0;
          if (c > 0 && p > 0) packingText = `${c} ${item.packagingUnit?.name} + ${p} ${item.unit}`;
          else if (c > 0) packingText = `${c} ${item.packagingUnit?.name}`;
          else packingText = `${p} ${item.unit}`;
        } else {
          packingText = `${item.qty} ${item.unit}`;
        }
        return {
          productId: Number(item.productId),
          qty: item.qty,
          cartons,
          pieces,
          cartonMultiplier: mult > 1 ? mult : undefined,
          packagingUnitName: item.packagingUnit?.name,
          unitName: item.unit,
          isWeight: item.isWeight,
          packingText,
          sourceWarehouseId: item.sourceWarehouseId ? Number(item.sourceWarehouseId) : undefined,
          sourceWarehouseName: item.sourceWarehouseName,
        };
      }),
      notes: notes.trim() || undefined,
    };

    try {
      const res = await driverHook.submitRequisition(payload);
      clearDraft();
      setLines([]);
      setNotes('');
      dismissRestoredNotice();
      setSubmittedDocNo(res.docNo);
      if (onRequisitionSubmitted) {
        onRequisitionSubmitted(res.docNo);
      }
    } catch {
      // Toast handled in mutation onError
    }
  };

  // Handle submit in admin mode
  const handleAdminSubmit = async (dispatchImmediately: boolean) => {
    if (!selectedRepId) {
      toast.error('يرجى اختيار مندوب التوزيع أولاً');
      return;
    }
    if (validLines.length === 0) {
      toast.error('يرجى اختيار صنف واحد على الأقل لطلب التحميل');
      return;
    }

    for (const line of validLines) {
      if (line.availableInWarehouse <= 0) {
        toast.error(`الصنف "${line.productName}" رصيده نافد في مستودع "${line.sourceWarehouseName}"`);
        return;
      }
      if (line.qty > line.availableInWarehouse) {
        toast.error(`الكمية المطلوبة من "${line.productName}" (${line.qty}) تتجاوز المتاح (${line.availableInWarehouse})`);
        return;
      }
    }

    if (dispatchImmediately) {
      const ok = await systemConfirm({
        title: 'اعتماد وصرف وتحميل السيارة فوراً',
        message: `هل تود صرف هذه الأصناف (${distinctItemsCount} صنف بإجمالي ${totalUnitsCount} قطعة) من المستودع وتحميل سيارة المندوب "${driverName}" وبدء رحلة التوزيع فوراً؟`,
        confirmText: 'صرف وتحميل السيارة وبدء الرحلة',
        cancelText: 'إلغاء',
        variant: 'primary',
      });
      if (!ok) return;
    }

    const payload = {
      repId: Number(selectedRepId),
      sourceWarehouseId: selectedWarehouseFilter !== 'all' ? Number(selectedWarehouseFilter) : undefined,
      items: validLines.map((item) => {
        const mult = item.packagingUnit?.multiplier || 1;
        const isCarton = Boolean(item.packagingUnit && mult > 1);
        const cartons = item.cartons !== undefined ? item.cartons : (isCarton ? Math.floor(item.qty / mult) : undefined);
        const pieces = item.pieces !== undefined ? item.pieces : (isCarton ? item.qty % mult : undefined);
        let packingText = '';
        if (isCarton && (cartons !== undefined || pieces !== undefined)) {
          const c = cartons || 0;
          const p = pieces || 0;
          if (c > 0 && p > 0) packingText = `${c} ${item.packagingUnit?.name} + ${p} ${item.unit}`;
          else if (c > 0) packingText = `${c} ${item.packagingUnit?.name}`;
          else packingText = `${p} ${item.unit}`;
        } else {
          packingText = `${item.qty} ${item.unit}`;
        }
        return {
          productId: Number(item.productId),
          qty: item.qty,
          productName: item.productName,
          barcode: item.barcode,
          cartons,
          pieces,
          cartonMultiplier: mult > 1 ? mult : undefined,
          packagingUnitName: item.packagingUnit?.name,
          unitName: item.unit,
          isWeight: item.isWeight,
          packingText,
          sourceWarehouseId: item.sourceWarehouseId ? Number(item.sourceWarehouseId) : undefined,
          sourceWarehouseName: item.sourceWarehouseName,
        };
      }),
      notes: notes.trim() || undefined,
      dispatchImmediately,
    };

    try {
      await adminSubmitMutation.mutateAsync(payload);
    } catch {
      // Toast handled in mutation onError
    }
  };
  return {
    handleGoBack,
    handleClearDraft,
    handleCancelPendingAndRestore,
    handleSubmit,
    handleAdminSubmit,
  };
}
