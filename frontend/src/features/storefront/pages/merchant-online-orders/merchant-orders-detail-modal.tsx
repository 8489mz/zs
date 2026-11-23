import { MerchantOrderDetailModal } from '../../components/MerchantOrderDetailModal';
import type { Dispatch, SetStateAction } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { OnlineOrderRecord } from '../../types/storefront.types';

export interface MerchantOrdersDetailModalProps {
  selectedOrder: OnlineOrderRecord | null;
  setSelectedOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  updateStatusMutation: UseMutationResult<{ ok: boolean; status: string; saleId?: number }, Error, { id: number; status: string }>;
  confirmPaymentMutation: UseMutationResult<{ ok: boolean; paymentStatus: string; gatewayProvider?: string | null; paidAt?: string | null }, Error, { id: number; reference?: string }>;
  setDeliveryModalOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  setBostaModalOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  setGccModalOrder: Dispatch<SetStateAction<OnlineOrderRecord | null>>;
  handleLoadToPos: (orderId: number) => Promise<void>;
  loadingPosOrderId: number | null;
  isBostaConfigured: boolean;
  isGccConfigured: boolean;
}

export function MerchantOrdersDetailModal({
  selectedOrder,
  setSelectedOrder,
  updateStatusMutation,
  confirmPaymentMutation,
  setDeliveryModalOrder,
  setBostaModalOrder,
  setGccModalOrder,
  handleLoadToPos,
  loadingPosOrderId,
  isBostaConfigured,
  isGccConfigured,
}: MerchantOrdersDetailModalProps) {
  return (
    <MerchantOrderDetailModal
      order={selectedOrder}
      onClose={() => setSelectedOrder(null)}
      onUpdateStatus={(id, status) => updateStatusMutation.mutate({ id, status })}
      isUpdatingStatus={updateStatusMutation.isPending}
      onConfirmPayment={(id, reference) => confirmPaymentMutation.mutate({ id, reference })}
      isConfirmingPayment={confirmPaymentMutation.isPending}
      onConvertToDelivery={(order) => {
        setSelectedOrder(null);
        setDeliveryModalOrder(order);
      }}
      onShipBosta={(order) => {
        setSelectedOrder(null);
        setBostaModalOrder(order);
      }}
      onShipGcc={(order) => {
        setSelectedOrder(null);
        setGccModalOrder(order);
      }}
      onLoadToPos={(orderId) => {
        setSelectedOrder(null);
        handleLoadToPos(orderId);
      }}
      loadingPosOrderId={loadingPosOrderId}
      isBostaConfigured={isBostaConfigured}
      isGccConfigured={isGccConfigured}
    />
  );
}
