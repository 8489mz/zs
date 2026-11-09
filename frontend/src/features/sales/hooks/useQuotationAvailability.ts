/*
New file: frontend/src/features/sales/hooks/useQuotationAvailability.ts
INV-CI-I10-PAGE-COMPOSITION (CI repair on Import Batch I10): the
availability read for the quotation page lives in this hook, not in
the page — page files must go through feature hooks instead of
calling the api layer directly (page-composition guard).

INV-QUOTATION-RESERVED-STOCK-DISPLAY: the picker suggestion shows
ONLY the reserved-aware availability — never the catalog stock
(p.stock = products.stock_qty, on-hand before reservations, in no
warehouse in particular). A quotation has no warehouse, so the read
is the GLOBAL availability (locationId null): the backend returns
availableAtLocation = globalAvailable = stock_qty - reserved_qty in
that case, exactly the arithmetic the approval check enforces when
no warehouse is chosen.
*/

import { useCallback, useState } from 'react';
import { salesOrdersApi } from '../api/sales-orders.api';

export function useQuotationAvailability() {
  const [availabilityByProduct, setAvailabilityByProduct] = useState<Record<number, number>>({});

  const refreshAvailability = useCallback(async (productIds: number[]) => {
    const ids = [...new Set(productIds.filter((id) => Number(id) > 0))];
    if (ids.length === 0) return;
    const results = await Promise.all(
      ids.map(async (productId) => {
        try {
          const res = await salesOrdersApi.availability(productId, null);
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
  }, []);

  return { availabilityByProduct, refreshAvailability };
}
