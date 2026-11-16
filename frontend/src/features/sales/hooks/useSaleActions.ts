import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateSalesDomain } from '@/app/query-invalidation';
import { queryKeys } from '@/app/query-keys';
import { salesApi } from '@/features/sales/api/sales.api';
import { buildSaleUpdatePayload } from '@/features/sales/contracts';
import type { Sale } from '@/types/domain';

export function useSaleActions(activeSaleId: string) {
  const queryClient = useQueryClient();

  const saleDetailQuery = useQuery({
    queryKey: queryKeys.saleDetail(activeSaleId),
    queryFn: () => salesApi.getById(activeSaleId),
    enabled: Boolean(activeSaleId)
  });

  const cancelMutation = useMutation({
    mutationFn: ({ saleId, reason, managerPin }: { saleId: string; reason: string; managerPin: string }) => salesApi.cancel(saleId, reason, managerPin),
    onSuccess: async (_, variables) => {
      await invalidateSalesDomain(queryClient, { saleId: variables.saleId });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ sale, payload }: { sale: Sale; payload: Parameters<typeof buildSaleUpdatePayload>[1] }) => salesApi.update(sale.id, buildSaleUpdatePayload(sale, payload)),
    onSuccess: async (_, variables) => {
      await invalidateSalesDomain(queryClient, { saleId: variables.sale.id });
    }
  });

  // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: payment corrections go through
  // the dedicated endpoint, never through the edit payload.
  const adjustPaymentsMutation = useMutation({
    mutationFn: ({ saleId, payload }: { saleId: string; payload: { payments: Array<{ paymentChannel: string; amount: number }>; reason: string; managerPin?: string } }) => salesApi.adjustPayments(saleId, payload),
    onSuccess: async (_, variables) => {
      await invalidateSalesDomain(queryClient, { saleId: variables.saleId });
    }
  });

  return {
    saleDetailQuery,
    cancelMutation,
    updateMutation,
    adjustPaymentsMutation
  };
}
