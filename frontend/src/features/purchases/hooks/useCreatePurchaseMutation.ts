import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidatePurchasesDomain } from '@/app/query-invalidation';
import { purchasesApi, type PurchaseMutationResult } from '@/features/purchases/api/purchases.api';
import { buildPurchasePayload, type PurchaseDraftItem } from '@/features/purchases/contracts';
import { withIdempotency } from '@/lib/idempotency';
import type { PurchaseHeaderOutput } from '@/features/purchases/schemas/purchase.schema';
import { currencyMoneyDigits } from '@/shared/utils/money';
import { getGlobalSystemCurrency } from '@/lib/currencies';

interface CreatePurchaseArgs {
  values: PurchaseHeaderOutput & {
    confirmedDuplicateWarning?: boolean;
    allowDuplicateOverride?: boolean;
    duplicateOverrideReason?: string;
  };
  items: PurchaseDraftItem[];
  taxRate: number;
  pricesIncludeTax: boolean;
  attachments?: any[];
}

export function useCreatePurchaseMutation(onSuccess?: (result: PurchaseMutationResult) => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ values, items, taxRate, pricesIncludeTax, attachments, idempotencyKey }: CreatePurchaseArgs & { idempotencyKey: string }) =>
      withIdempotency(
        // INV-FE2-FRONTEND-BOOK-DIGITS: discount/freight round at the
        // document currency's digits (tenant base as fallback).
        (headers) => purchasesApi.create(buildPurchasePayload(values, items, taxRate, pricesIncludeTax, attachments, currencyMoneyDigits(values.currency || getGlobalSystemCurrency())), headers),
        'purchase_create',
        idempotencyKey
      ),
    onSuccess: async (result) => {
      await invalidatePurchasesDomain(queryClient);
      onSuccess?.(result);
    }
  });
}
