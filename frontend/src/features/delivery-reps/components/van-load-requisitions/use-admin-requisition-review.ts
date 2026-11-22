import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { toast } from '@/shared/components/system-alert';
import type { DriverAvailableProduct, VanLoadRequisitionRecord } from '../../api/van-sales.api';
import type { AdminReviewLine } from './van-load-requisitions-admin-types';

export interface UseAdminRequisitionReviewSetters {
  setSelectedReq: Dispatch<SetStateAction<VanLoadRequisitionRecord | null>>;
  setSelectedSourceWarehouseId: Dispatch<SetStateAction<number | null>>;
  setAdminNotes: Dispatch<SetStateAction<string>>;
  setIsAddProductOpen: Dispatch<SetStateAction<boolean>>;
  setProductSearch: Dispatch<SetStateAction<string>>;
}

export function useAdminRequisitionReview(
  warehouseProducts: DriverAvailableProduct[],
  setters: UseAdminRequisitionReviewSetters,
) {
  const {
    setSelectedReq,
    setSelectedSourceWarehouseId,
    setAdminNotes,
    setIsAddProductOpen,
    setProductSearch,
  } = setters;
  const [reviewLines, setReviewLines] = useState<AdminReviewLine[]>([]);

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
            warehouseAvailQty: found.availableQty ?? found.totalStock,
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
          warehouseAvailQty: prod.availableQty ?? prod.totalStock,
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

  return {
    reviewLines,
    openReviewModal,
    handleUpdateLineApprovedQty,
    handleUpdateLineCartonsPieces,
    handleRemoveReviewLine,
    handleAddProductToReview,
    formatReviewLinesForPayload,
  };
}
