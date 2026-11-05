import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateInventoryDomain } from '@/app/query-invalidation';
import { inventoryApi } from '@/features/inventory/api/inventory.api';
import { buildDamagedStockPayload, buildInventoryAdjustmentPayload } from '@/features/inventory/contracts';
import { withIdempotency } from '@/lib/idempotency';
import type { DamagedStockOutput, InventoryAdjustmentOutput } from '@/features/inventory/schemas/inventory.schema';

/* INV-PRODUCTS-WORKSPACE-SAVE: patch the stock of one product in every
 * cached products list, immediately, after a stock adjustment.
 * The old code patched only the exact ['products'] full-list entry — never the
 * paged ['products','page',...] entry the list actually reads — and its
 * comparison could never match (productId arrives as a string, cached ids
 * are numbers). The list therefore kept showing the old stock until a manual
 * refresh. This helper patches both cache shapes with a String() comparison,
 * so the row shows the new stock the moment the user returns to the list;
 * the invalidation below still marks everything stale for the next refetch
 * (which refreshes the summary totals). */
export function patchInventoryAdjustmentInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  adjustment: { productId: string | number; locationId?: string | number | null; scopeAfter?: number; globalAfter?: number },
) {
  const { productId, locationId, scopeAfter, globalAfter } = adjustment;

  if (locationId !== undefined && locationId !== null && scopeAfter !== undefined) {
    queryClient.setQueryData(['location-stocks'], (old: any) => {
      if (!Array.isArray(old)) return old;
      return old.map((ls: any) =>
        (String(ls.productId) === String(productId) && String(ls.locationId) === String(locationId))
          ? { ...ls, qty: scopeAfter }
          : ls
      );
    });
  }

  if (globalAfter !== undefined) {
    const patchProductStock = (old: any) => {
      if (!old?.products) return old;
      return {
        ...old,
        products: old.products.map((p: any) =>
          (String(p.id) === String(productId))
            ? { ...p, stock: globalAfter }
            : p
        )
      };
    };
    // The full-list cache…
    queryClient.setQueryData(['products'], patchProductStock);
    // …and every paged list entry (the entry the list actually reads).
    queryClient.setQueriesData({ queryKey: ['products', 'page'] }, patchProductStock);
  }
}

export function useInventoryAdjustmentMutation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: InventoryAdjustmentOutput) =>
      withIdempotency((headers) => inventoryApi.createInventoryAdjustment(buildInventoryAdjustmentPayload(values), headers), 'createInventoryAdjustment', crypto.randomUUID()),
    onSuccess: async (res: any) => {
      if (res?.adjustment?.productId) {
        patchInventoryAdjustmentInCache(queryClient, res.adjustment);
      }
      await invalidateInventoryDomain(queryClient, { includeProducts: true });
      onSuccess?.();
    }
  });
}

export function useDamagedStockMutation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: DamagedStockOutput) => inventoryApi.createDamaged(buildDamagedStockPayload(values)),
    onSuccess: async () => {
      await invalidateInventoryDomain(queryClient, { includeProducts: true });
      onSuccess?.();
    }
  });
}
