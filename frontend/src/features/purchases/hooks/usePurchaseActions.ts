import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidatePurchasesDomain } from '@/app/query-invalidation';
import { purchasesApi, type PurchaseMutationResult } from '@/features/purchases/api/purchases.api';
import { buildPurchaseUpdatePayload } from '@/features/purchases/contracts';
import type { Purchase } from '@/types/domain';
import { currencyMoneyDigits } from '@/shared/utils/money';
import { getGlobalSystemCurrency } from '@/lib/currencies';

export function usePurchaseActions(onUpdateSuccess?: (result: PurchaseMutationResult) => void) {
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: ({ purchaseId, reason, managerPin }: { purchaseId: string; reason: string; managerPin: string }) => purchasesApi.cancel(purchaseId, reason, managerPin),
    onSuccess: async (_, variables) => {
      await invalidatePurchasesDomain(queryClient, { purchaseId: variables.purchaseId });
    }
  });

  const updateMutation = useMutation({
    // INV-FE2-FRONTEND-BOOK-DIGITS: the purchase carries no currency of
    // its own, so the discount rounds at the tenant's book digits.
    mutationFn: ({ purchase, payload }: { purchase: Purchase; payload: Parameters<typeof buildPurchaseUpdatePayload>[1] }) => purchasesApi.update(purchase.id, buildPurchaseUpdatePayload(purchase, payload, currencyMoneyDigits(getGlobalSystemCurrency()))),
    onSuccess: async (result, variables) => {
      await invalidatePurchasesDomain(queryClient, { purchaseId: variables.purchase.id });
      onUpdateSuccess?.(result);
    }
  });

  return {
    cancelMutation,
    updateMutation
  };
}
