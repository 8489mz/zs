import {useState, useEffect, useCallback, useMemo, type Dispatch, type SetStateAction} from 'react';
import { toast } from '@/shared/components/system-alert';
import type {
  DriverAvailableProduct,
  DriverWarehouse,
} from '../../hooks/useDriverLoadRequisition';
import type { RequisitionLineItem } from './LoadRequisitionTypes';

export interface UseRequisitionCartArgs {
  selectedWarehouseFilter: string;
  warehouses: DriverWarehouse[];
  availableProducts: DriverAvailableProduct[];
  notes: string;
}

export interface UseRequisitionCartCounts {
  distinctItemsCount: number;
  distinctWarehousesCount: number;
}

export interface UseRequisitionCartReturn {
  lines: RequisitionLineItem[];
  setLines: Dispatch<SetStateAction<RequisitionLineItem[]>>;
  validLines: RequisitionLineItem[];
  counts: UseRequisitionCartCounts;
  totalUnitsCount: number;
  totalEstimatedValue: number;
  hasDraftContent: boolean;
  handleUpdateProductUnits: (
    product: DriverAvailableProduct,
    targetCartons: number,
    targetPieces: number,
  ) => void;
  handleCatalogAdd: (product: DriverAvailableProduct) => void;
  handleCartonIncrement: (
    product: DriverAvailableProduct,
    currentCartons: number,
    currentPieces: number,
  ) => void;
  handleCartonDecrement: (
    product: DriverAvailableProduct,
    currentCartons: number,
    currentPieces: number,
  ) => void;
  handlePieceIncrement: (
    product: DriverAvailableProduct,
    currentCartons: number,
    currentPieces: number,
  ) => void;
  handlePieceDecrement: (
    product: DriverAvailableProduct,
    currentCartons: number,
    currentPieces: number,
  ) => void;
  handleSingleIncrement: (product: DriverAvailableProduct, currentQty: number) => void;
  handleSingleDecrement: (product: DriverAvailableProduct, currentQty: number) => void;
  handleRemoveLine: (lineId: string) => void;
  handleChangeLineWarehouse: (lineId: string, warehouseIdStr: string) => void;
}

export function useRequisitionCart({
  selectedWarehouseFilter,
  warehouses,
  availableProducts,
  notes,
}: UseRequisitionCartArgs): UseRequisitionCartReturn {
  // Selected Requisition Lines (Orders cart logic)
  const [lines, setLines] = useState<RequisitionLineItem[]>([]);

  // Update line's warehouse when top warehouse filter changes
  useEffect(() => {
    if (selectedWarehouseFilter === 'all') return;
    const whId = Number(selectedWarehouseFilter);
    const wh = warehouses.find((w) => w.id === whId);
    if (!wh) return;

    setLines((prev) =>
      prev.map((line) => {
        if (!line.productId) return line;
        const matchingStock = line.warehouseStocks.find((s) => s.warehouseId === whId);
        const avail = matchingStock?.availableQty ?? matchingStock?.qty ?? 0;
        return {
          ...line,
          sourceWarehouseId: whId,
          sourceWarehouseName: wh.name,
          availableInWarehouse: avail,
          qty: Math.min(line.qty, Math.max(1, avail)),
        };
      }),
    );
  }, [selectedWarehouseFilter, warehouses]);

  // Synchronize live warehouse stock & retail prices for restored draft items
  useEffect(() => {
    if (!availableProducts || availableProducts.length === 0) return;

    setLines((prevLines) => {
      let hasChanges = false;
      const updated = prevLines.map((line) => {
        if (!line.productId) return line;
        const prod = availableProducts.find((p) => p.id === Number(line.productId));
        if (!prod) return line;

        const whId = line.sourceWarehouseId !== '' ? Number(line.sourceWarehouseId) : undefined;
        let freshAvail = prod.availableQty ?? prod.totalStock;
        if (whId !== undefined) {
          const matchWh = (prod.warehouseStocks || []).find((s) => s.warehouseId === whId);
          freshAvail = matchWh?.availableQty ?? matchWh?.qty ?? 0;
        }

        const freshPrice = prod.retailPrice ?? line.unitPrice;
        const freshStocks = prod.warehouseStocks || [];

        if (
          line.availableInWarehouse !== freshAvail ||
          line.unitPrice !== freshPrice ||
          line.unit !== (prod.unit || line.unit) ||
          line.warehouseStocks !== freshStocks
        ) {
          hasChanges = true;
          return {
            ...line,
            availableInWarehouse: freshAvail,
            unitPrice: freshPrice,
            unit: prod.unit || line.unit,
            warehouseStocks: freshStocks,
            qty: freshAvail > 0 ? Math.min(line.qty, freshAvail) : line.qty,
          };
        }
        return line;
      });

      return hasChanges ? updated : prevLines;
    });
  }, [availableProducts]);

  // Update product quantities (Orders logic)
  const handleUpdateProductUnits = useCallback((
    product: DriverAvailableProduct,
    targetCartons: number,
    targetPieces: number,
  ) => {
    const mult = product.packagingUnit?.multiplier || 1;
    const isCartonItem = Boolean(product.packagingUnit && mult > 1);
    const safeCartons = isCartonItem ? Math.max(0, targetCartons) : 0;
    const safePieces = Math.max(0, targetPieces);
    const totalQty = (safeCartons * mult) + safePieces;

    // Determine source warehouse
    let sourceWhId: number;
    let sourceWhName: string;
    let availStock: number;

    if (selectedWarehouseFilter !== 'all') {
      const filterId = Number(selectedWarehouseFilter);
      const stockInFilter = (product.warehouseStocks || []).find((w) => w.warehouseId === filterId);
      sourceWhId = filterId;
      sourceWhName = stockInFilter?.warehouseName || warehouses.find((w) => w.id === filterId)?.name || 'المستودع المختار';
      availStock = stockInFilter?.availableQty ?? stockInFilter?.qty ?? 0;
    } else {
      const sortedStocks = [...(product.warehouseStocks || [])].sort((a, b) => (b.availableQty ?? b.qty) - (a.availableQty ?? a.qty));
      if (sortedStocks.length > 0 && (sortedStocks[0].availableQty ?? sortedStocks[0].qty) > 0) {
        sourceWhId = sortedStocks[0].warehouseId;
        sourceWhName = sortedStocks[0].warehouseName;
        availStock = sortedStocks[0].availableQty ?? sortedStocks[0].qty;
      } else if (warehouses.length > 0) {
        sourceWhId = warehouses[0].id;
        sourceWhName = warehouses[0].name;
        availStock = 0;
      } else {
        sourceWhId = 1;
        sourceWhName = 'المستودع الرئيسي';
        availStock = 0;
      }
    }

    if (availStock > 0 && totalQty > availStock) {
      toast.warning(`الكمية المطلوبة من "${product.name}" تتجاوز المتاح بالمخزن (${availStock})`);
    }

    setLines((prev) => {
      const existingIdx = prev.findIndex((l) => Number(l.productId) === product.id);

      if (totalQty <= 0) {
        if (existingIdx >= 0) {
          return prev.filter((l) => Number(l.productId) !== product.id);
        }
        return prev;
      }

      const newLine: RequisitionLineItem = {
        id: existingIdx >= 0 ? prev[existingIdx].id : `line-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        productId: product.id,
        productName: product.name,
        barcode: product.barcode || '',
        unitPrice: product.retailPrice || 0,
        unit: product.unit || 'قطعة',
        packagingUnit: product.packagingUnit,
        isWeight: Boolean(product.isWeight),
        cartons: isCartonItem ? safeCartons : undefined,
        pieces: isCartonItem ? safePieces : undefined,
        sourceWarehouseId: existingIdx >= 0 ? prev[existingIdx].sourceWarehouseId : sourceWhId,
        sourceWarehouseName: existingIdx >= 0 ? prev[existingIdx].sourceWarehouseName : sourceWhName,
        availableInWarehouse: availStock,
        warehouseStocks: product.warehouseStocks || [],
        qty: totalQty,
        searchQuery: product.name,
        isSearchOpen: false,
      };

      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = newLine;
        return next;
      } else {
        return [...prev, newLine];
      }
    });
  }, [selectedWarehouseFilter, warehouses]);

  // Stepper handlers
  const handleCatalogAdd = useCallback((product: DriverAvailableProduct) => {
    const mult = product.packagingUnit?.multiplier || 1;
    const isCarton = Boolean(product.packagingUnit && mult > 1);
    if (isCarton) {
      handleUpdateProductUnits(product, 1, 0);
    } else {
      handleUpdateProductUnits(product, 0, 1);
    }
  }, [handleUpdateProductUnits]);

  const handleCartonIncrement = useCallback((product: DriverAvailableProduct, currentCartons: number, currentPieces: number) => {
    handleUpdateProductUnits(product, currentCartons + 1, currentPieces);
  }, [handleUpdateProductUnits]);

  const handleCartonDecrement = useCallback((product: DriverAvailableProduct, currentCartons: number, currentPieces: number) => {
    handleUpdateProductUnits(product, Math.max(0, currentCartons - 1), currentPieces);
  }, [handleUpdateProductUnits]);

  const handlePieceIncrement = useCallback((product: DriverAvailableProduct, currentCartons: number, currentPieces: number) => {
    handleUpdateProductUnits(product, currentCartons, currentPieces + 1);
  }, [handleUpdateProductUnits]);

  const handlePieceDecrement = useCallback((product: DriverAvailableProduct, currentCartons: number, currentPieces: number) => {
    handleUpdateProductUnits(product, currentCartons, Math.max(0, currentPieces - 1));
  }, [handleUpdateProductUnits]);

  const handleSingleIncrement = useCallback((product: DriverAvailableProduct, currentQty: number) => {
    const step = product.isWeight ? 0.5 : 1;
    handleUpdateProductUnits(product, 0, Number((currentQty + step).toFixed(2)));
  }, [handleUpdateProductUnits]);

  const handleSingleDecrement = useCallback((product: DriverAvailableProduct, currentQty: number) => {
    const step = product.isWeight ? 0.5 : 1;
    const minQ = product.isWeight ? 0.05 : 0;
    const nextQ = Math.max(minQ, Number((currentQty - step).toFixed(2)));
    handleUpdateProductUnits(product, 0, nextQ);
  }, [handleUpdateProductUnits]);

  const handleRemoveLine = useCallback((lineId: string) => {
    setLines((prev) => prev.filter((l) => l.id !== lineId));
  }, []);

  const handleChangeLineWarehouse = useCallback((lineId: string, warehouseIdStr: string) => {
    const whId = Number(warehouseIdStr);
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const matchingStock = line.warehouseStocks.find((s) => s.warehouseId === whId);
        const whObj = warehouses.find((w) => w.id === whId);
        const newAvail = matchingStock?.availableQty ?? matchingStock?.qty ?? 0;
        return {
          ...line,
          sourceWarehouseId: whId,
          sourceWarehouseName: matchingStock?.warehouseName || whObj?.name || 'مستودع الصرف',
          availableInWarehouse: newAvail,
          qty: Math.min(line.qty, Math.max(1, newAvail)),
        };
      }),
    );
  }, [warehouses]);

  // Summary statistics
  const validLines = useMemo(() => lines.filter((l) => Boolean(l.productId)), [lines]);
  const distinctItemsCount = validLines.length;
  const distinctWarehousesCount = useMemo(() => {
    const whSet = new Set(validLines.map((l) => l.sourceWarehouseId).filter(Boolean));
    return whSet.size;
  }, [validLines]);
  const totalUnitsCount = useMemo(() => validLines.reduce((acc, l) => acc + l.qty, 0), [validLines]);
  const totalEstimatedValue = useMemo(() => validLines.reduce((acc, l) => acc + l.qty * l.unitPrice, 0), [validLines]);

  const hasDraftContent = useMemo(() => {
    return lines.some((l) => Boolean(l.productId)) || notes.trim() !== '';
  }, [lines, notes]);

  const counts = useMemo(
    () => ({ distinctItemsCount, distinctWarehousesCount }),
    [distinctItemsCount, distinctWarehousesCount],
  );

  return {
    lines,
    setLines,
    validLines,
    counts,
    totalUnitsCount,
    totalEstimatedValue,
    hasDraftContent,
    handleUpdateProductUnits,
    handleCatalogAdd,
    handleCartonIncrement,
    handleCartonDecrement,
    handlePieceIncrement,
    handlePieceDecrement,
    handleSingleIncrement,
    handleSingleDecrement,
    handleRemoveLine,
    handleChangeLineWarehouse,
  };
}
