import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { catalogApi } from '@/lib/api/catalog';
import { cashDrawerApi } from '@/lib/api/cash-drawer';
import { invalidateAuditLogs, invalidateCatalogDomain } from '@/app/query-invalidation';
import { queryKeys } from '@/app/query-keys';
import { posApi } from '@/features/pos/api/pos.api';
import { useVisibleRefetch } from '@/features/pos/hooks/useVisibleRefetch';
import type { HeldPosDraft } from '@/features/pos/hooks/usePosWorkspace';

export function usePosWorkspaceMutations({ queryClient, storedHeld }: { queryClient: QueryClient; storedHeld: HeldPosDraft[] }) {
  const heldDraftsQuery = useQuery({
    queryKey: queryKeys.posHeldDrafts,
    queryFn: () => posApi.listHeldDrafts(),
    placeholderData: storedHeld,
    staleTime: 5_000,
  });
  // INV-REST-FLOOR-VERIFY-REFETCH (T13-A, H7): this query inherits the
  // global focus-refetch-off default, so a draft moved by another
  // station while the POS tab sat in the background never appeared
  // until a manual reload. Refetch on visibilitychange -> visible,
  // bypassing staleTime; the global defaults stay untouched.
  useVisibleRefetch(queryKeys.posHeldDrafts);
  const openShiftsQuery = useQuery({
    queryKey: queryKeys.cashierShiftsPage('open:pos'),
    queryFn: () => cashDrawerApi.listPage({ page: 1, pageSize: 50, filter: 'open' }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const quickCustomerMutation = useMutation({
    mutationFn: (payload: unknown) => catalogApi.createCustomer(payload),
    onSuccess: async () => {
      await invalidateCatalogDomain(queryClient, { includeCustomers: true, includeCustomerBalances: true });
    },
  });
  const saveHeldDraftMutation = useMutation({
    mutationFn: (payload: unknown) => posApi.saveHeldDraft(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.posHeldDrafts });
    },
  });
  const deleteHeldDraftMutation = useMutation({
    mutationFn: (draftId: string) => posApi.deleteHeldDraft(draftId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.posHeldDrafts }),
        invalidateAuditLogs(queryClient),
      ]);
    },
  });
  const clearHeldDraftsMutation = useMutation({
    mutationFn: () => posApi.clearHeldDrafts(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.posHeldDrafts }),
        invalidateAuditLogs(queryClient),
      ]);
    },
  });

  const discountAuthorizationMutation = useMutation({
    mutationFn: (secret: string) => posApi.authorizeDiscountOverride(secret),
  });

  return {
    heldDraftsQuery,
    openShiftsQuery,
    quickCustomerMutation,
    saveHeldDraftMutation,
    deleteHeldDraftMutation,
    clearHeldDraftsMutation,
    discountAuthorizationMutation,
  };
}
