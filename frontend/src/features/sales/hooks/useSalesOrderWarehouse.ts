/*
New file: frontend/src/features/sales/hooks/useSalesOrderWarehouse.ts
INV-SALES-ORDER-WAREHOUSE-SELECTION (Import Batch I3, D2): the single
source of truth for the sales-order warehouse on the frontend.

THE DEFECT: the order form had no warehouse selector at all, while
approval validated stock only in the branch's default selling
warehouse — and the line "available" badge read the GLOBAL product
stock. An order could show "10 متاح" and still fail approval with 0
in the default warehouse (trial SO-261108-0008).

THE RULE: the form offers a warehouse selector whose default is the
branch's default selling warehouse (the first branch's
defaultStockLocationId — the backend resolves the branch the same way
when none is sent); the order is submitted with that warehouse; and
the line availability is read from GET /api/sales-orders/availability
for the SELECTED warehouse — the same arithmetic the approval check
enforces on the backend. Display and validation never read two
different warehouses again.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBranchesQuery, useLocationsQuery } from '@/shared/hooks/use-catalog-queries';
import { salesOrdersApi } from '../api/sales-orders.api';

export function useSalesOrderWarehouse() {
  const { data: branches = [] } = useBranchesQuery();
  const { data: locations = [] } = useLocationsQuery();

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const userChoseRef = useRef(false);
  // Availability per product at the SELECTED warehouse, from the same
  // backend read the approval check uses (never the global stock).
  const [availabilityByProduct, setAvailabilityByProduct] = useState<Record<number, number>>({});

  // The backend picks the first branch (by id) when the order carries
  // no branch — the default warehouse must match that branch.
  const defaultBranch = useMemo(() => {
    const sorted = [...(branches || [])].sort((a: any, b: any) => Number(a.id) - Number(b.id));
    return sorted[0] ?? null;
  }, [branches]);

  const defaultWarehouseId = useMemo(() => {
    const raw = (defaultBranch as any)?.defaultStockLocationId;
    if (!raw) return null;
    const id = Number(raw);
    if (!Number.isFinite(id)) return null;
    return (locations || []).some((loc: any) => Number(loc.id) === id) ? id : null;
  }, [defaultBranch, locations]);

  // Default to the branch's default selling warehouse until the user
  // picks another one (or a draft restores one).
  useEffect(() => {
    if (!userChoseRef.current && defaultWarehouseId != null) {
      setSelectedWarehouseId(defaultWarehouseId);
    }
  }, [defaultWarehouseId]);

  const selectWarehouse = useCallback((id: number | null) => {
    userChoseRef.current = true;
    setSelectedWarehouseId(id);
  }, []);

  const resetWarehouse = useCallback(() => {
    userChoseRef.current = false;
    setSelectedWarehouseId(defaultWarehouseId);
  }, [defaultWarehouseId]);

  // Same filter as Settings: locations of the order's branch, plus
  // unassigned locations. Inactive locations are never offered.
  const warehouseOptions = useMemo(
    () =>
      (locations || [])
        .filter((loc: any) => {
          if (loc.isActive === false) return false;
          if (!defaultBranch) return true;
          return !loc.branchId || String(loc.branchId) === String((defaultBranch as any).id);
        })
        .map((loc: any) => ({ value: String(loc.id), label: loc.name })),
    [locations, defaultBranch],
  );

  const refreshAvailability = useCallback(
    async (productIds: number[]) => {
      const ids = [...new Set(productIds.filter((id) => Number(id) > 0))];
      if (ids.length === 0) return;
      const results = await Promise.all(
        ids.map(async (productId) => {
          try {
            const res = await salesOrdersApi.availability(productId, selectedWarehouseId);
            return [productId, Number(res.availableAtLocation ?? 0)] as const;
          } catch {
            return [productId, undefined] as const;
          }
        }),
      );
      setAvailabilityByProduct((prev) => {
        const next = { ...prev };
        for (const [productId, available] of results) {
          if (available !== undefined) next[productId] = available;
        }
        return next;
      });
    },
    [selectedWarehouseId],
  );

  return {
    defaultBranch,
    defaultWarehouseId,
    selectedWarehouseId,
    selectWarehouse,
    resetWarehouse,
    warehouseOptions,
    availabilityByProduct,
    refreshAvailability,
  };
}
