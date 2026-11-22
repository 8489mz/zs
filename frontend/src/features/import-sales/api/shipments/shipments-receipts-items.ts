import { useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';
import type { AddShipmentItemDto, ShipmentItem } from './shipments-core';

export interface ReverseImportReceiptDto {
  approvalRequestId: string;
  reason: string;
}

export interface ResolveLegacyReceiptDto {
  approvalRequestId: string;
  reason: string;
}

/** Approval-gated reversal of a posted receipt: restores stock/WAC/lots and mirrors the journal. */
export const useReversePostedReceiptMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: ReverseImportReceiptDto) => {
      return await http(`/api/import-sales/shipments/${shipmentId}/reverse-receipt`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['import-shipments'] });
    },
  });
};

/** Approval-gated review that unfreezes a legacy_review_required receipt on journal + movement proof. */
export const useResolveLegacyReceiptMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: ResolveLegacyReceiptDto) => {
      return await http(`/api/import-sales/shipments/${shipmentId}/resolve-legacy-review`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['import-shipments'] });
    },
  });
};

export const useAddShipmentItemMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dto: AddShipmentItemDto) => {
      const data = await http<ShipmentItem>(`/api/import-sales/shipments/${shipmentId}/items`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
    },
  });
};

export const useImportProjectItemsMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await http<{ success: boolean; importedCount: number }>(
        `/api/import-sales/shipments/${shipmentId}/import-project-items`,
        { method: 'POST' }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['import-shipments'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
};

export const useUpdateShipmentItemMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, dto }: { itemId: string, dto: { receivedQuantity?: number, targetRetailMargin?: number, targetWholesaleMargin?: number, shortageHandlingMethod?: 'capitalize' | 'expense', unitWeightKg?: number, unitCbm?: number } }) => {
      const data = await http(`/api/import-sales/shipment-items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
    },
  });
};

export const useApplyPricesMutation = (shipmentId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const data = await http<{success: boolean, updatedCount: number}>(`/api/import-sales/shipments/${shipmentId}/apply-prices`, {
        method: 'POST',
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-shipments', shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
};
