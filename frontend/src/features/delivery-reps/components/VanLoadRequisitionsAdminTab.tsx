import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui/button';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { vanSalesApi, type VanLoadRequisitionRecord, type DriverAvailableProduct, type DriverWarehouse } from '../api/van-sales.api';
import { CustomSelect } from '@/shared/ui/custom-select';
import {
  RefreshCwIcon,
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
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { printSmallReceiptDocument } from '@/lib/small-receipt-printer';

export interface AdminReviewLine {
  productId: number;
  productName: string;
  barcode?: string;
  unit?: string;
  isWeight?: boolean;
  packagingUnit?: { name: string; multiplier: number };
  requestedQty: number;
  requestedCartons?: number;
  requestedPieces?: number;
  requestedPackingText?: string;
  approvedQty: number;
  approvedCartons?: number;
  approvedPieces?: number;
  packingText?: string;
  warehouseAvailQty: number;
  warehouseStocks?: { warehouseId: number; warehouseName: string; qty: number }[];
}

export function VanLoadRequisitionsAdminTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<'list' | 'create'>('list');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedReq, setSelectedReq] = useState<VanLoadRequisitionRecord | null>(null);
  const [reviewLines, setReviewLines] = useState<AdminReviewLine[]>([]);
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

  // Sync real-time warehouse available quantities and packaging info
  useEffect(() => {
    if (!warehouseProducts || warehouseProducts.length === 0) return;
    setReviewLines((prev) =>
      prev.map((line) => {
        const found = warehouseProducts.find((p) => p.id === line.productId);
        if (found) {
          const mult = found.packagingUnit?.multiplier || 1;
          const pkg = found.packagingUnit && mult > 1 ? found.packagingUnit : line.packagingUnit;
          let appCartons = line.approvedCartons;
          let appPieces = line.approvedPieces;
          if (pkg && mult > 1 && (appCartons === undefined || appPieces === undefined)) {
            appCartons = Math.floor(line.approvedQty / mult);
            appPieces = Math.round(line.approvedQty % mult);
          }
          return {
            ...line,
            warehouseAvailQty: found.totalStock,
            warehouseStocks: found.warehouseStocks,
            unit: found.unit || line.unit,
            isWeight: found.isWeight ?? line.isWeight,
            packagingUnit: pkg,
            approvedCartons: appCartons,
            approvedPieces: appPieces,
          };
        }
        return line;
      }),
    );
  }, [warehouseProducts]);

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

  const openReviewModal = (req: VanLoadRequisitionRecord) => {
    setSelectedReq(req);
    setSelectedSourceWarehouseId(req.sourceWarehouseId ? Number(req.sourceWarehouseId) : null);
    setAdminNotes(req.notes || '');
    setIsAddProductOpen(false);
    setProductSearch('');
    const items = (req.approvedItems && req.approvedItems.length > 0 ? req.approvedItems : req.requestedItems) || [];
    const lines: AdminReviewLine[] = items.map((it: any) => {
      const orig = (req.requestedItems || []).find((r) => r.productId === it.productId);
      const mult = it.cartonMultiplier || orig?.cartonMultiplier || it.packagingUnit?.multiplier || orig?.packagingUnit?.multiplier || 1;
      const pkgName = it.packagingUnitName || orig?.packagingUnitName || it.packagingUnit?.name || orig?.packagingUnit?.name;
      const packagingUnit = pkgName && mult > 1 ? { name: pkgName, multiplier: mult } : undefined;
      const unit = it.unitName || orig?.unitName || it.unit || orig?.unit || 'قطعة';
      const isWeight = it.isWeight ?? orig?.isWeight ?? false;

      const appQty = Number(it.qty ?? 0);
      let appCartons = it.cartons;
      let appPieces = it.pieces;
      if (packagingUnit && mult > 1) {
        if (appCartons === undefined) appCartons = Math.floor(appQty / mult);
        if (appPieces === undefined) appPieces = Math.round(appQty % mult);
      }

      const reqQty = orig ? Number(orig.qty) : 0;
      let reqCartons = orig?.cartons;
      let reqPieces = orig?.pieces;
      if (packagingUnit && mult > 1 && orig) {
        if (reqCartons === undefined) reqCartons = Math.floor(reqQty / mult);
        if (reqPieces === undefined) reqPieces = Math.round(reqQty % mult);
      }

      return {
        productId: it.productId,
        productName: it.productName || orig?.productName || 'صنف',
        barcode: it.barcode || orig?.barcode || '',
        unit,
        isWeight,
        packagingUnit,
        requestedQty: reqQty,
        requestedCartons: reqCartons,
        requestedPieces: reqPieces,
        requestedPackingText: orig?.packingText || it.packingText,
        approvedQty: appQty,
        approvedCartons: appCartons,
        approvedPieces: appPieces,
        packingText: it.packingText,
        warehouseAvailQty: it.warehouseAvailQty ?? orig?.warehouseAvailQty ?? 0,
      };
    });
    setReviewLines(lines);
  };

  const handleUpdateLineApprovedQty = (productId: number, newQty: number) => {
    setReviewLines((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l;
        const safe = Math.max(0, newQty);
        const mult = l.packagingUnit?.multiplier || 1;
        let c = l.approvedCartons;
        let p = l.approvedPieces;
        if (l.packagingUnit && mult > 1) {
          c = Math.floor(safe / mult);
          p = Math.round(safe % mult);
        }
        return { ...l, approvedQty: safe, approvedCartons: c, approvedPieces: p };
      }),
    );
  };

  const handleUpdateLineCartonsPieces = (productId: number, cartons: number, pieces: number) => {
    setReviewLines((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l;
        const mult = l.packagingUnit?.multiplier || 1;
        const safeC = Math.max(0, cartons);
        const safeP = Math.max(0, pieces);
        const total = safeC * mult + safeP;
        return {
          ...l,
          approvedCartons: safeC,
          approvedPieces: safeP,
          approvedQty: total,
        };
      }),
    );
  };

  const handleRemoveReviewLine = (productId: number) => {
    setReviewLines((prev) => prev.filter((l) => l.productId !== productId));
    toast.info('تم استبعاد الصنف من إذن التحميل');
  };

  const handleAddProductToReview = (prod: DriverAvailableProduct) => {
    setReviewLines((prev) => {
      const existing = prev.find((l) => l.productId === prod.id);
      if (existing) {
        const mult = existing.packagingUnit?.multiplier || 1;
        const inc = mult > 1 ? mult : 1;
        const newQty = existing.approvedQty + inc;
        const newCartons = mult > 1 ? (existing.approvedCartons || 0) + 1 : undefined;
        return prev.map((l) =>
          l.productId === prod.id
            ? { ...l, approvedQty: newQty, approvedCartons: newCartons }
            : l,
        );
      }
      const mult = prod.packagingUnit?.multiplier || 1;
      const initialQty = mult > 1 ? mult : 1;
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          barcode: prod.barcode || '',
          unit: prod.unit || 'قطعة',
          isWeight: prod.isWeight,
          packagingUnit: prod.packagingUnit && mult > 1 ? prod.packagingUnit : undefined,
          requestedQty: 0,
          requestedCartons: 0,
          requestedPieces: 0,
          approvedQty: initialQty,
          approvedCartons: mult > 1 ? 1 : 0,
          approvedPieces: 0,
          warehouseAvailQty: prod.totalStock,
        },
      ];
    });
    setIsAddProductOpen(false);
    setProductSearch('');
    toast.success(`تمت إضافة الصنف "${prod.name}" بنجاح`);
  };

  const formatReviewLinesForPayload = (lines: AdminReviewLine[]) => {
    return lines.map((l) => {
      const mult = l.packagingUnit?.multiplier || 1;
      const isCarton = Boolean(l.packagingUnit && mult > 1);
      const cartons = l.approvedCartons !== undefined ? l.approvedCartons : (isCarton ? Math.floor(l.approvedQty / mult) : undefined);
      const pieces = l.approvedPieces !== undefined ? l.approvedPieces : (isCarton ? l.approvedQty % mult : undefined);
      let packingText = '';
      if (isCarton && (cartons !== undefined || pieces !== undefined)) {
        const c = cartons || 0;
        const p = pieces || 0;
        if (c > 0 && p > 0) packingText = `${c} ${l.packagingUnit?.name} + ${p} ${l.unit || 'قطعة'}`;
        else if (c > 0) packingText = `${c} ${l.packagingUnit?.name}`;
        else packingText = `${p} ${l.unit || 'قطعة'}`;
      } else {
        packingText = `${l.approvedQty} ${l.unit || 'قطعة'}`;
      }
      return {
        productId: l.productId,
        qty: l.approvedQty,
        productName: l.productName,
        barcode: l.barcode,
        cartons,
        pieces,
        cartonMultiplier: mult > 1 ? mult : undefined,
        packagingUnitName: l.packagingUnit?.name,
        unitName: l.unit,
        isWeight: l.isWeight,
        packingText,
      };
    });
  };

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

  const handlePrintRequisition = (req: VanLoadRequisitionRecord, preferredFormat?: 'a4' | 'receipt') => {
    const format = preferredFormat || defaultPaperSize;

    if (format === 'receipt') {
      const storeName = settings?.storeName || settings?.brandName || 'منظومة Z-ERP';
      const items = (req.approvedItems && req.approvedItems.length > 0 ? req.approvedItems : req.requestedItems) || [];
      const totalPieces = items.reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
      const now = new Date(req.createdAt);
      const dateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
      const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

      const statusLabel =
        req.status === 'dispatched' ? 'تم الصرف' : req.status === 'pending' ? 'قيد المراجعة' : 'مرفوض';

      const esc = (s: any) =>
        String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

      const rowsHtml = items
        .map(
          (it: any, idx: number) => `
          <tr style="border-bottom: 1px dashed #bbb;">
            <td style="text-align: right; padding: 5px 0; font-size: 11px; vertical-align: top;">
              <div style="font-weight: 800; color: #000; line-height: 1.35; margin-bottom: 2px;">
                ${idx + 1}. ${esc(it.productName || 'صنف')}
              </div>
              ${it.barcode ? `<div style="font-size: 9.5px; color: #555; font-family: monospace; letter-spacing: 0.5px;">${esc(it.barcode)}</div>` : ''}
              ${it.packingText ? `<div style="font-size: 10px; font-weight: 700; color: #170e5e; margin-top: 2px;">[ ${esc(it.packingText)} ]</div>` : ''}
            </td>
            <td style="text-align: left; vertical-align: top; padding: 5px 0; white-space: nowrap;">
              <span style="display: inline-block; border: 1.5px solid #000; border-radius: 4px; padding: 2px 6px; font-weight: 900; font-size: 13px; color: #000; background: #fff;">
                ${it.qty} <span style="font-size: 10px; font-weight: 600; color: #333;">${esc(it.unitName || it.unit || 'قطعة')}</span>
              </span>
            </td>
          </tr>
        `,
        )
        .join('');

      const thermalHtml = `
        <div style="font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; direction: rtl; text-align: right; color: #000;">
          <div style="text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
            <div style="font-size: 15px; font-weight: 900; color: #000;">${esc(storeName)}</div>
            <div style="font-size: 12px; font-weight: 800; margin-top: 3px;">إذن صرف وتحميل بضاعة</div>
            <div style="font-size: 14px; font-weight: 900; font-family: monospace; margin-top: 4px; direction: ltr; text-align: center;">#${esc(req.docNo)}</div>
            <div style="font-size: 10.5px; color: #444; margin-top: 3px;">${dateStr} - ${timeStr}</div>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 10.5px; line-height: 1.5; margin-bottom: 6px; border-bottom: 1px dashed #000; padding-bottom: 4px;">
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">المندوب:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">${esc(req.repName)}</td>
            </tr>
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">المركبة:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">${esc(req.vehiclePlate || '—')}</td>
            </tr>
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">المستودع المصدر:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">${esc(req.sourceWarehouseName)}</td>
            </tr>
            ${
              req.tripId
                ? `
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">رقم الرحلة:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">#${esc(req.tripId)}</td>
            </tr>`
                : ''
            }
            <tr>
              <td style="text-align: right; color: #333; padding: 2px 0;">حالة الإذن:</td>
              <td style="text-align: left; font-weight: 800; color: #000; padding: 2px 0;">${statusLabel}</td>
            </tr>
          </table>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
            <thead>
              <tr style="border-bottom: 1.5px solid #000;">
                <th style="text-align: right; padding: 3px 0; font-size: 11px;">الصنف والباركود</th>
                <th style="text-align: left; padding: 3px 0; font-size: 11px; width: 65px;">الكمية</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div style="border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 6px 0; margin-bottom: 10px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
              <tr>
                <td style="text-align: right; font-weight: 700; padding: 2px 0;">عدد الأصناف:</td>
                <td style="text-align: left; font-weight: 800; padding: 2px 0;">${items.length} صنف</td>
              </tr>
              <tr>
                <td style="text-align: right; font-weight: 900; font-size: 12.5px; padding: 3px 0;">إجمالي القطع المنصرفة:</td>
                <td style="text-align: left; font-weight: 900; font-size: 13.5px; padding: 3px 0; white-space: nowrap;">${totalPieces} قطعة</td>
              </tr>
            </table>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-top: 14px; margin-bottom: 12px; font-size: 10.5px;">
            <tr>
              <td style="text-align: center; width: 48%; padding: 0 4px; vertical-align: top;">
                <div style="font-weight: 700; margin-bottom: 26px;">توقيع الصارف (المستودع)</div>
                <div style="border-bottom: 1px dashed #000; width: 85%; margin: 0 auto;"></div>
              </td>
              <td style="width: 4%;"></td>
              <td style="text-align: center; width: 48%; padding: 0 4px; vertical-align: top;">
                <div style="font-weight: 700; margin-bottom: 26px;">توقيع المستلم (المندوب)</div>
                <div style="border-bottom: 1px dashed #000; width: 85%; margin: 0 auto;"></div>
              </td>
            </tr>
          </table>

          <div style="text-align: center; font-size: 9.5px; color: #555; border-top: 1px dotted #ccc; padding-top: 6px;">
            منظومة Z-ERP للتوزيع الميداني
          </div>
        </div>
      `;

      printSmallReceiptDocument(thermalHtml, {
        title: `إذن صرف #${req.docNo}`,
        widthMm: 80,
        marginMm: 2,
        fontSizePx: 11,
      });
      return;
    }

    const printWindow = window.open('', '_blank', 'width=840,height=900');
    if (!printWindow) {
      toast.error('يرجى السماح بالنوافذ المنبثقة للطباعة');
      return;
    }

    const storeName = settings?.storeName || settings?.brandName || 'منظومة Z-ERP';
    const items = (req.approvedItems && req.approvedItems.length > 0 ? req.approvedItems : req.requestedItems) || [];
    const totalPieces = items.reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const dateFormatted = new Date(req.createdAt).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const statusLabel =
      req.status === 'dispatched' ? 'تم الصرف' : req.status === 'pending' ? 'قيد المراجعة' : 'مرفوض';

    const esc = (s: any) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const rowsHtml = items
      .map(
        (it: any, idx: number) => `
        <tr style="border-bottom: 1px solid #cbd5e1;">
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; text-align: center; font-weight: 700; color: #334155;">${idx + 1}</td>
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; font-family: monospace; text-align: center; font-size: 12px; color: #334155;">${esc(it.barcode || '—')}</td>
          <td style="padding: 10px 12px; border: 1px solid #94a3b8; text-align: right; font-weight: 700; color: #0f172a; line-height: 1.45;">${esc(it.productName || 'صنف')}</td>
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; text-align: center; font-weight: 700; color: #170e5e; font-size: 12px; background: #f8fafc;">${esc(it.packingText || '—')}</td>
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; text-align: center; font-size: 14px; font-weight: 900; color: #0f172a;">${it.qty} ${esc(it.unitName || it.unit || '')}</td>
          <td style="padding: 10px 8px; border: 1px solid #94a3b8; text-align: center; color: #94a3b8;"></td>
        </tr>
      `,
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>إذن صرف وتحميل بضاعة - ${req.docNo}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 15mm;
            }
            *, *::before, *::after {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body {
              font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              direction: rtl;
              color: #0f172a;
              margin: 0;
              padding: 0;
              font-size: 12.5px;
              line-height: 1.5;
              background: #fff;
              -webkit-font-smoothing: antialiased;
            }
            .header-table {
              width: 100%;
              border-bottom: 2.5px solid #170e5e;
              padding-bottom: 12px;
              margin-bottom: 14px;
            }
            .meta-card {
              background: #f8fafc;
              border: 1.5px solid #cbd5e1;
              border-radius: 8px;
              padding: 10px 16px;
              margin-bottom: 16px;
            }
            .meta-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 12px;
            }
            .meta-table td {
              padding: 4px 6px;
              vertical-align: middle;
            }
            .meta-label {
              color: #475569;
              font-weight: 600;
              width: 120px;
            }
            .meta-value {
              color: #0f172a;
              font-weight: 800;
            }
            table.items {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 18px;
            }
            table.items th {
              background: #170e5e !important;
              color: #ffffff !important;
              padding: 10px 8px;
              border: 1px solid #170e5e;
              font-size: 12px;
              font-weight: 800;
              text-align: center;
            }
            table.items td {
              vertical-align: middle;
            }
            .summary-box {
              display: flex;
              justify-content: space-between;
              align-items: center;
              background: #f1f5f9;
              border: 1.5px solid #cbd5e1;
              border-radius: 8px;
              padding: 10px 18px;
              margin-bottom: 28px;
              font-size: 13px;
              font-weight: 700;
              color: #1e293b;
            }
            .summary-box b {
              color: #170e5e;
              font-size: 15px;
            }
            .signatures-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 16px;
              margin-top: 24px;
            }
            .sig-card {
              border: 1px solid #cbd5e1;
              border-radius: 8px;
              padding: 10px 14px;
              background: #fafafa;
              text-align: center;
            }
            .sig-title {
              font-size: 12px;
              font-weight: 800;
              color: #1e293b;
              padding-bottom: 6px;
              border-bottom: 1px dashed #cbd5e1;
            }
            .sig-space {
              height: 48px;
            }
            .sig-footer {
              font-size: 11px;
              font-weight: 600;
              color: #475569;
              border-top: 1px dashed #94a3b8;
              padding-top: 6px;
            }
            .doc-footer {
              margin-top: 20px;
              text-align: center;
              font-size: 10px;
              color: #64748b;
              border-top: 1px dotted #cbd5e1;
              padding-top: 6px;
            }
          </style>
        </head>
        <body>
          <table class="header-table">
            <tr>
              <td style="vertical-align: middle;">
                <div style="font-size: 19px; font-weight: 900; color: #170e5e; line-height: 1.2;">${esc(storeName)}</div>
                <div style="font-size: 12.5px; font-weight: 700; color: #475569; margin-top: 3px;">إذن صرف وتحميل بضاعة لسيارة التوزيع الميداني (Van Sales)</div>
              </td>
              <td style="text-align: left; vertical-align: middle;">
                <div style="font-size: 17px; font-weight: 900; color: #170e5e; font-family: monospace; direction: ltr; text-align: left;">#${esc(req.docNo)}</div>
                <div style="font-size: 11px; color: #64748b; margin-top: 3px;">${dateFormatted}</div>
              </td>
            </tr>
          </table>

          <div class="meta-card">
            <table class="meta-table">
              <tr>
                <td class="meta-label">مندوب التوزيع (السائق):</td>
                <td class="meta-value">${esc(req.repName)}</td>
                <td class="meta-label">المستودع المصدر:</td>
                <td class="meta-value">${esc(req.sourceWarehouseName)}</td>
              </tr>
              <tr>
                <td class="meta-label">رقم لوحة المركبة:</td>
                <td class="meta-value">${esc(req.vehiclePlate || '—')}</td>
                <td class="meta-label">مستودع الفان المتنقل:</td>
                <td class="meta-value">${esc(req.vanLocationName || 'مستودع سيارة المندوب')}</td>
              </tr>
              <tr>
                <td class="meta-label">رقم رحلة التوزيع:</td>
                <td class="meta-value">${req.tripId ? '#' + esc(req.tripId) : '—'}</td>
                <td class="meta-label">حالة الإذن:</td>
                <td class="meta-value">${statusLabel}</td>
              </tr>
            </table>
          </div>

          <table class="items">
            <thead>
              <tr>
                <th style="width: 45px;">م</th>
                <th style="width: 130px;">الباركود</th>
                <th style="text-align: right; padding-right: 14px;">بيان الصنف والمواصفات</th>
                <th style="width: 140px;">بيان التعبئة</th>
                <th style="width: 100px;">الكمية المنصرفة</th>
                <th style="width: 130px;">ملاحظات الفحص والمطابقة</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="summary-box">
            <div>إجمالي عدد البنود: <b>${items.length}</b> صنف</div>
            <div>إجمالي الكمية المنصرفة: <b>${totalPieces}</b> قطعة / وحدة</div>
          </div>

          <div class="signatures-grid">
            <div class="sig-card">
              <div class="sig-title">أمين المستودع (الصارف)</div>
              <div class="sig-space"></div>
              <div class="sig-footer">الاسم والتوقيع: ............................</div>
            </div>
            <div class="sig-card">
              <div class="sig-title">مندوب الفان (المستلم)</div>
              <div class="sig-space"></div>
              <div class="sig-footer">الاسم والتوقيع: ............................</div>
            </div>
            <div class="sig-card">
              <div class="sig-title">مشرف الحركة والاعتماد</div>
              <div class="sig-space"></div>
              <div class="sig-footer">الاعتماد والختم: ............................</div>
            </div>
          </div>

          <div class="doc-footer">
            منظومة Z-ERP لإدارة التوزيع والأسطول الميداني — تم استخراج هذا الإذن آلياً
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
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
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#d97706', display: 'block' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s0', "طلبات قيد المراجعة والصرف")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#b45309', display: 'block', marginTop: '4px' }}>
            {pendingReqs.length} <span style={{ fontSize: '13px', color: '#f59e0b' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s1', "طلب تحميل")}</span>
          </span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#16a34a', display: 'block' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s2', "طلبات تم صرفها وبدء رحلتها")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', display: 'block', marginTop: '4px' }}>
            {dispatchedReqs.length} <span style={{ fontSize: '13px', color: '#86efac' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s3', "رحلة منطلقة")}</span>
          </span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#dc2626', display: 'block' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s4', "طلبات تحميل مرفوضة")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#991b1b', display: 'block', marginTop: '4px' }}>
            {rejectedReqs.length} <span style={{ fontSize: '13px', color: '#f87171' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s5', "طلب")}</span>
          </span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca', display: 'block' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s6', "إجمالي أذونات التحميل المسجلة")}</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: '#312e81', display: 'block', marginTop: '4px' }}>
            {requisitions.length} <span style={{ fontSize: '13px', color: '#a5b4fc' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s7', "إذن")}</span>
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          background: '#ffffff',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{t('delivery_reps.van_load_requisitions_admin_tab.s8', "تصفية حسب الحالة:")}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[
              { label: t('delivery_reps.van_load_requisitions_admin_tab.s9', "كافة الطلبات"), value: '' },
              { label: `بانتظار الصرف (${pendingReqs.length})`, value: 'pending' },
              { label: t('delivery_reps.van_load_requisitions_admin_tab.s10', "تم الصرف"), value: 'dispatched' },
              { label: t('delivery_reps.van_load_requisitions_admin_tab.s11', "مرفوض"), value: 'rejected' },
            ].map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === f.value ? '#170e5e' : '#f1f5f9',
                  color: statusFilter === f.value ? '#ffffff' : '#475569',
                  transition: 'none',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>
            {t('delivery_reps.van_load_requisitions_admin_tab.s12', "إجمالي السجلات:")} {requisitions.length}
          </span>
          <Button
            variant="secondary"
            disabled={isRefreshing}
            style={{
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: isRefreshing ? 'wait' : 'pointer',
              opacity: isRefreshing ? 0.75 : 1,
            }}
            onClick={handleManualRefresh}
            title={t('delivery_reps.van_load_requisitions_admin_tab.s13', "تحديث قائمة أذونات التحميل من السيرفر")}
          >
            <RefreshCwIcon
              size={13}
              className={isRefreshing ? 'spin-animation' : undefined}
              style={isRefreshing ? { animation: 'spin 0.75s linear infinite' } : undefined}
            />
            {isRefreshing ? t('delivery_reps.van_load_requisitions_admin_tab.s14', "جارٍ التحديث...") : t('delivery_reps.van_load_requisitions_admin_tab.s15', "تحديث")}
          </Button>
          <Button
            variant="primary"
            style={{
              fontSize: '12px',
              backgroundColor: '#170e5e',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 700,
            }}
            onClick={() => setViewMode('create')}
          >
            <PlusIcon size={14} />
            {t('delivery_reps.van_load_requisitions_admin_tab.s16', "إنشاء إذن تحميل مباشر")}
          </Button>
        </div>
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
                            onClick={() => handlePrintRequisition(r)}
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
                                  handlePrintRequisition(r, 'a4');
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
                                  handlePrintRequisition(r, 'receipt');
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
                onClick={() => handlePrintRequisition(selectedReq, 'a4')}
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                title={t('delivery_reps.van_load_requisitions_admin_tab.s112', "طباعة نموذج المستودع الرسمي A4")}
              >
                <PrinterIcon size={13} />
                {t('delivery_reps.van_load_requisitions_admin_tab.s113', "طباعة A4")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => handlePrintRequisition(selectedReq, 'receipt')}
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
